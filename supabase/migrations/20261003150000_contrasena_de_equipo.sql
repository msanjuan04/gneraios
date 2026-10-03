-- Una sola contraseña para toda la bóveda: la del equipo.
--
-- La primera versión daba a cada socio su propia contraseña maestra y repartía la llave en sobres.
-- Era más fino (se podía quitar el acceso a uno solo), pero obligaba a un paso manual de «dar
-- acceso» y a que cada uno recordara una contraseña distinta. El equipo quiere lo contrario: una
-- contraseña que saben los tres, y quien la sabe lo ve todo.
--
-- Sigue siendo cifrado de extremo a extremo: la clave de la bóveda sale de la contraseña del equipo
-- (PBKDF2-SHA256 con la sal de la org) dentro del navegador. El servidor guarda la sal, las
-- iteraciones y una prueba cifrada para saber si la contraseña escrita es la buena; con eso no se
-- puede abrir nada. Quien no sepa la contraseña no lee un secreto, ni siendo owner ni entrando por
-- la base de datos.
--
-- Al cambiar la contraseña hay que volver a cifrar todos los secretos (lo hace el navegador de quien
-- la cambia, que es el único sitio donde existen en claro).

-- Las políticas de los secretos miraban los sobres: se rehacen antes de quitar las tablas viejas.
drop policy if exists vault_items_select on public.vault_items;
drop policy if exists vault_items_insert on public.vault_items;
drop policy if exists vault_items_update on public.vault_items;
drop table if exists public.vault_grants;
drop table if exists public.vault_keys;

create table public.vault_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  -- Sal del KDF e iteraciones (suben con los años, no bajan).
  kdf_salt text not null check (char_length(kdf_salt) between 16 and 128),
  kdf_iterations integer not null check (kdf_iterations between 100000 and 10000000),
  -- Un texto conocido cifrado con la clave: si se descifra, la contraseña escrita es la correcta.
  verifier text not null check (char_length(verifier) between 20 and 500),
  -- Cuándo se cambió por última vez (al irse alguien hay que cambiarla).
  rotated_at timestamptz not null default now(),
  rotated_by uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, rotated_by) references public.members (org_id, id)
);

alter table public.vault_settings enable row level security;
-- Cualquier socio ve los parámetros (los necesita para intentar abrirla) y puede crearla o cambiarla.
create policy vault_settings_select on public.vault_settings for select to authenticated using (private.has_role(org_id, 'partner'));
create policy vault_settings_insert on public.vault_settings for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy vault_settings_update on public.vault_settings for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
revoke all on public.vault_settings from anon;

-- Los secretos: los ve y los escribe cualquier socio (cifrados). Sin la contraseña no sirven de nada.
create policy vault_items_select on public.vault_items for select to authenticated using (private.has_role(org_id, 'partner'));
create policy vault_items_insert on public.vault_items for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy vault_items_update on public.vault_items for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create trigger vault_settings_audit after insert or update or delete on public.vault_settings
  for each row execute function private.audit_row();

comment on table public.vault_settings is 'Parámetros de la contraseña del equipo. No permiten descifrar nada: la clave sale de la contraseña, que solo existe en el navegador.';
