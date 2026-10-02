-- Ads por plataforma y por dueño.
--
-- Hasta ahora Ads leía una sola clave de ChatGPT Ads del entorno del servidor. Ahora cada org conecta
-- cuentas publicitarias: una por plataforma (OpenAI = ChatGPT Ads, Google = Google Ads y YouTube Ads,
-- Meta = Facebook e Instagram, LinkedIn) y por dueño (la propia agencia o un cliente). Dos tipos de
-- anuncio que viven en la misma API (Google Ads y YouTube Ads) comparten la misma conexión.
--
-- La credencial (clave de API, token de acceso o token de refresco) se guarda cifrada con la clave del
-- servidor y ningún miembro puede leer esa columna: solo el servidor (service_role) la abre.
-- Las cifras de la API se guardan como caché (`ads_insights`): se refrescan al abrir la página si tienen
-- más de 15 minutos, o a mano con «Actualizar». No son datos propios: se pueden borrar sin perder nada.

create type public.ads_provider as enum ('openai', 'google', 'meta', 'linkedin');

create table public.ads_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  provider public.ads_provider not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  -- null = cuenta de la propia agencia; si no, la cuenta es de ese cliente.
  owner_client_id uuid,
  -- Identificador de la cuenta en la plataforma: act_… (Meta), customer ID (Google), ID de sponsoredAccount (LinkedIn), id de ad_account (OpenAI).
  external_account_id text not null check (char_length(btrim(external_account_id)) between 1 and 120),
  -- Google: cuenta administradora (MCC) con la que se accede a la cuenta, si la hay.
  login_customer_id text check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$'),
  -- Clave de API (OpenAI, Meta, LinkedIn) o token de refresco (Google). Null en Google hasta conectar con OAuth.
  credential_ciphertext text,
  -- Solo Google: developer token de la API de Google Ads.
  developer_token_ciphertext text,
  platform_name text,
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  timezone text,
  account_email text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, owner_client_id) references public.clients (org_id, id),
  check (provider = 'google' or developer_token_ciphertext is null),
  check (provider = 'google' or credential_ciphertext is not null)
);
-- Una conexión por plataforma y dueño (la agencia cuenta como un dueño más).
create unique index ads_accounts_one_per_owner_idx
  on public.ads_accounts (org_id, provider, coalesce(owner_client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where archived_at is null;
create index ads_accounts_org_idx on public.ads_accounts (org_id) where archived_at is null;

create trigger set_updated_at before update on public.ads_accounts for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.ads_accounts for each row execute function private.audit_row();

alter table public.ads_accounts enable row level security;
create policy ads_accounts_select on public.ads_accounts for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy ads_accounts_insert on public.ads_accounts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy ads_accounts_update on public.ads_accounts for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy ads_accounts_delete on public.ads_accounts for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Las credenciales cifradas no las lee ni escribe ningún miembro: solo el servidor.
revoke all on public.ads_accounts from anon, authenticated;
grant select (id, org_id, provider, label, owner_client_id, external_account_id, login_customer_id, platform_name, currency, timezone, account_email, last_synced_at, last_error, created_at, updated_at, created_by, archived_at)
  on public.ads_accounts to authenticated;
grant update (label, owner_client_id, login_customer_id, archived_at) on public.ads_accounts to authenticated;
grant delete on public.ads_accounts to authenticated;

-- Caché de la API: una foto de 28 días por cuenta. La escribe solo el servidor.
create table public.ads_insights (
  org_id uuid not null,
  account_id uuid not null,
  period_from date not null,
  period_to date not null,
  fetched_at timestamptz not null default now(),
  -- [{ id, name, channel, impressions, clicks, spend_cents }] tal y como lo normaliza src/server/ads.
  campaigns jsonb not null default '[]'::jsonb check (jsonb_typeof(campaigns) = 'array'),
  primary key (org_id, account_id),
  foreign key (org_id, account_id) references public.ads_accounts (org_id, id) on delete cascade,
  check (period_from <= period_to)
);
alter table public.ads_insights enable row level security;
create policy ads_insights_select on public.ads_insights for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke all on public.ads_insights from anon;
revoke insert, update, delete, truncate on public.ads_insights from authenticated;

-- Las campañas vinculadas a clientes apuntan ahora a la cuenta conectada (antes, al id externo de la
-- única cuenta de ChatGPT Ads). La tabla está vacía en producción: el cambio de tipo es seguro.
alter table public.ads_client_campaigns
  drop constraint ads_client_campaigns_ad_account_id_check,
  alter column ad_account_id type uuid using ad_account_id::uuid;
alter table public.ads_client_campaigns
  add constraint ads_client_campaigns_account_fkey foreign key (org_id, ad_account_id) references public.ads_accounts (org_id, id) on delete cascade;

comment on table public.ads_accounts is 'Cuentas publicitarias conectadas, una por plataforma y dueño (agencia o cliente). La credencial va cifrada y solo la lee el servidor.';
comment on table public.ads_insights is 'Caché de 28 días de la API de cada cuenta publicitaria; se refresca cada 15 minutos al abrir Ads o a mano.';
