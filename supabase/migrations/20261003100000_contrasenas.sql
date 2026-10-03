-- Contraseñas del equipo, cifradas de extremo a extremo.
--
-- El servidor NUNCA ve una contraseña en claro, ni la contraseña maestra, ni la clave de la bóveda:
-- todo se cifra y descifra en el navegador (WebCrypto). Aquí solo se guarda texto cifrado y lo
-- imprescindible para repartir el acceso.
--
--   · vault_keys: por miembro, su clave pública y su clave privada cifrada con su contraseña maestra
--     (PBKDF2-SHA256 → AES-GCM). Quien no sepa su contraseña maestra no abre nada, ni siendo owner.
--   · vault_grants: la clave de la bóveda de la org envuelta con la clave pública de cada miembro
--     (RSA-OAEP). Dar acceso a alguien = añadir su sobre; quitárselo = borrarlo.
--   · vault_items: cada secreto, cifrado entero con la clave de la bóveda (título incluido). En claro
--     solo quedan a qué cliente pertenece y cuándo se tocó, para poder ordenar y filtrar sin abrirlo.
--
-- Rotar: si alguien que tuvo acceso se va, hay que cambiar las contraseñas de verdad; borrar su
-- sobre impide futuros accesos, pero lo que ya vio, visto está.

-- Quién es «yo» en esta org. Mismo estilo que private.has_role: las políticas se leen enteras.
create function private.current_member_id(p_org uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m
  where m.org_id = p_org and m.user_id = (select auth.uid()) and m.is_active
  limit 1;
$$;
revoke all on function private.current_member_id(uuid) from public;
grant execute on function private.current_member_id(uuid) to authenticated;

create table public.vault_keys (
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  -- Clave pública del miembro (SPKI en base64, RSA-OAEP 2048 / SHA-256).
  public_key text not null check (char_length(public_key) between 100 and 2000),
  -- Su clave privada (PKCS#8) cifrada con la clave que sale de su contraseña maestra.
  private_key_ciphertext text not null check (char_length(private_key_ciphertext) between 100 and 8000),
  -- Parámetros del KDF: sal propia de cada miembro e iteraciones (suben con los años, no bajan).
  kdf_salt text not null check (char_length(kdf_salt) between 16 and 128),
  kdf_iterations integer not null check (kdf_iterations between 100000 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, member_id),
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade
);

create table public.vault_grants (
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  -- La clave de la bóveda (AES-GCM 256) envuelta con la clave pública de este miembro.
  wrapped_key text not null check (char_length(wrapped_key) between 100 and 2000),
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, member_id),
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade,
  foreign key (org_id, granted_by) references public.members (org_id, id)
);

create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- De qué cliente es la contraseña; null = de GNERAI.
  client_id uuid,
  -- Todo el contenido (nombre, usuario, contraseña, web, notas) cifrado con la clave de la bóveda.
  ciphertext text not null check (char_length(ciphertext) between 20 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id)
);
create index vault_items_org_idx on public.vault_items (org_id, updated_at desc) where archived_at is null;
create index vault_items_client_idx on public.vault_items (org_id, client_id) where archived_at is null;

create trigger set_updated_at before update on public.vault_keys for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.vault_items for each row execute function private.set_updated_at();
-- La auditoría guarda quién tocó qué y cuándo; el contenido sigue cifrado.
create trigger audit after insert or update or delete on public.vault_grants for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.vault_items for each row execute function private.audit_row();

alter table public.vault_keys enable row level security;
alter table public.vault_grants enable row level security;
alter table public.vault_items enable row level security;

-- Las claves públicas de la org las ve cualquier socio (hacen falta para darle acceso a alguien);
-- la clave privada cifrada solo la escribe y lee su dueño.
create policy vault_keys_select on public.vault_keys for select to authenticated using (private.has_role(org_id, 'partner'));
create policy vault_keys_write on public.vault_keys for insert to authenticated
  with check (private.has_role(org_id, 'partner') and member_id = private.current_member_id(org_id));
create policy vault_keys_update on public.vault_keys for update to authenticated
  using (member_id = private.current_member_id(org_id)) with check (member_id = private.current_member_id(org_id));

-- Los sobres: los ve el equipo (para saber quién tiene acceso) y los reparte quien ya tiene acceso.
create policy vault_grants_select on public.vault_grants for select to authenticated using (private.has_role(org_id, 'partner'));
create policy vault_grants_insert on public.vault_grants for insert to authenticated
  with check (
    private.has_role(org_id, 'partner')
    -- El primero se lo da a sí mismo (bóveda nueva); después, solo quien ya tiene acceso.
    and (
      not exists (select 1 from public.vault_grants g where g.org_id = vault_grants.org_id)
      or exists (select 1 from public.vault_grants g where g.org_id = vault_grants.org_id and g.member_id = private.current_member_id(org_id))
    )
  );
create policy vault_grants_delete on public.vault_grants for delete to authenticated
  using (private.has_role(org_id, 'owner') or member_id = private.current_member_id(org_id));

-- Los secretos: solo los lee (cifrados) quien tiene sobre; sin la contraseña maestra no sirven de nada.
create policy vault_items_select on public.vault_items for select to authenticated
  using (exists (select 1 from public.vault_grants g where g.org_id = vault_items.org_id and g.member_id = private.current_member_id(org_id)));
create policy vault_items_insert on public.vault_items for insert to authenticated
  with check (exists (select 1 from public.vault_grants g where g.org_id = vault_items.org_id and g.member_id = private.current_member_id(org_id)));
create policy vault_items_update on public.vault_items for update to authenticated
  using (exists (select 1 from public.vault_grants g where g.org_id = vault_items.org_id and g.member_id = private.current_member_id(org_id)))
  with check (exists (select 1 from public.vault_grants g where g.org_id = vault_items.org_id and g.member_id = private.current_member_id(org_id)));
create policy vault_items_delete on public.vault_items for delete to authenticated using (private.has_role(org_id, 'owner'));

revoke all on public.vault_keys, public.vault_grants, public.vault_items from anon;

comment on table public.vault_keys is 'Par de claves de cada miembro; la privada va cifrada con su contraseña maestra, que nunca sale de su navegador.';
comment on table public.vault_grants is 'Clave de la bóveda envuelta para cada miembro con acceso. Sin sobre no se puede descifrar nada.';
comment on table public.vault_items is 'Secretos cifrados de extremo a extremo con la clave de la bóveda. El servidor no puede leerlos.';
