-- Correo dentro de GNERAI OS: la bandeja de info@gnerai.com, con los mensajes enlazados al cliente
-- o al lead al que pertenecen.
--
-- Hasta ahora la conversación con cada cliente se apuntaba a mano (`activities`). Esto la llena sola:
-- el servidor se conecta por IMAP al buzón de siempre, guarda los mensajes y los ata a la ficha por
-- la dirección de correo. Enviar va por SMTP, con la misma cuenta de siempre: nada cambia para quien
-- recibe, y los correos siguen estando en IONOS (esto es una copia para trabajar, no un reemplazo).
--
-- La contraseña del buzón se guarda cifrada con la clave del servidor (igual que Ads y Google) y
-- ningún miembro puede leer esa columna: solo el servidor la abre para conectarse.

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  -- La dirección tal y como se envía (y el remitente que verá quien reciba).
  address text not null check (address = lower(btrim(address)) and address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text not null default '' check (char_length(display_name) <= 120),
  imap_host text not null check (char_length(imap_host) between 3 and 255),
  imap_port integer not null default 993 check (imap_port between 1 and 65535),
  smtp_host text not null check (char_length(smtp_host) between 3 and 255),
  smtp_port integer not null default 465 check (smtp_port between 1 and 65535),
  -- Usuario de IMAP/SMTP: en IONOS es la propia dirección, pero no en todos los proveedores.
  username text not null check (char_length(username) between 3 and 255),
  password_ciphertext text not null,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  archived_at timestamptz,
  unique (org_id, id),
  -- Una cuenta por dirección y org.
  unique (org_id, address)
);

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  account_id uuid not null,
  -- Carpeta y UID de IMAP: juntos identifican el mensaje en el servidor de correo.
  folder text not null check (char_length(folder) between 1 and 255),
  uid bigint not null,
  -- Message-ID de la cabecera: el mismo mensaje en dos carpetas es el mismo correo.
  message_id text check (message_id is null or char_length(message_id) <= 998),
  in_reply_to text check (in_reply_to is null or char_length(in_reply_to) <= 998),
  -- Con qué hilo agrupar: el primer Message-ID de la conversación, o el asunto normalizado.
  thread_key text not null check (char_length(thread_key) between 1 and 998),
  direction text not null check (direction in ('incoming', 'outgoing')),
  from_address text not null check (char_length(from_address) <= 320),
  from_name text not null default '' check (char_length(from_name) <= 320),
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null default '' check (char_length(subject) <= 998),
  -- El cuerpo en texto (lo que se busca y se enseña) y, si venía, el HTML ya saneado.
  body_text text not null default '' check (char_length(body_text) <= 500000),
  body_html text check (body_html is null or char_length(body_html) <= 2000000),
  snippet text not null default '' check (char_length(snippet) <= 500),
  sent_at timestamptz not null,
  seen boolean not null default false,
  has_attachments boolean not null default false,
  -- A qué ficha pertenece (por la dirección); null si no se reconoce a nadie.
  client_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (account_id, folder, uid),
  foreign key (org_id, account_id) references public.mail_accounts (org_id, id) on delete cascade,
  -- Al borrar el cliente se suelta el enlace, pero no la org: se dice qué columna se anula.
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete set null (client_id)
);
create index mail_messages_org_sent_idx on public.mail_messages (org_id, sent_at desc);
create index mail_messages_thread_idx on public.mail_messages (org_id, thread_key, sent_at);
create index mail_messages_client_idx on public.mail_messages (org_id, client_id, sent_at desc) where client_id is not null;
-- Búsqueda por asunto y cuerpo. Con el diccionario «simple» y los dos argumentos, que es la forma
-- inmutable: unaccent no lo es, así que aquí no cabe (quien busque con acentos los escribe igual).
create index mail_messages_search_idx on public.mail_messages
  using gin (to_tsvector('simple'::regconfig, subject || ' ' || body_text));

create trigger set_updated_at before update on public.mail_accounts for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.mail_accounts for each row execute function private.audit_row();

alter table public.mail_accounts enable row level security;
alter table public.mail_messages enable row level security;

-- La cuenta la ve y la configura un socio; la contraseña cifrada no la lee nadie.
create policy mail_accounts_select on public.mail_accounts for select to authenticated using (private.has_role(org_id, 'partner'));
create policy mail_accounts_insert on public.mail_accounts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy mail_accounts_update on public.mail_accounts for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy mail_accounts_delete on public.mail_accounts for delete to authenticated using (private.has_role(org_id, 'owner'));

revoke all on public.mail_accounts from anon, authenticated;
grant select (id, org_id, address, display_name, imap_host, imap_port, smtp_host, smtp_port, username, last_sync_at, last_error, created_at, updated_at, archived_at)
  on public.mail_accounts to authenticated;
grant update (display_name, archived_at) on public.mail_accounts to authenticated;
grant delete on public.mail_accounts to authenticated;

-- Los mensajes los lee el equipo; los escribe solo el servidor (la sincronización y el envío).
create policy mail_messages_select on public.mail_messages for select to authenticated using (private.has_role(org_id, 'partner'));
revoke all on public.mail_messages from anon;
revoke insert, update, delete, truncate on public.mail_messages from authenticated;

comment on table public.mail_accounts is 'Buzón conectado por IMAP/SMTP. La contraseña va cifrada y solo la abre el servidor.';
comment on table public.mail_messages is 'Copia de trabajo de los mensajes, enlazados al cliente por la dirección. El original sigue en el servidor de correo.';
