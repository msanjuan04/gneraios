-- Campañas de ChatGPT Ads asignadas a clientes. Una clave global solo lee su cuenta;
-- este vínculo explícito impide enseñar la cuenta completa a un cliente.
create table public.ads_client_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null,
  ad_account_id text not null check (char_length(ad_account_id) between 1 and 120),
  campaign_id text not null check (char_length(campaign_id) between 1 and 120),
  visible_to_client boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, ad_account_id, campaign_id),
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade
);

create index ads_client_campaigns_client_idx on public.ads_client_campaigns (org_id, client_id)
  where visible_to_client;
create trigger ads_client_campaigns_updated_at before update on public.ads_client_campaigns
  for each row execute function private.set_updated_at();

alter table public.ads_client_campaigns enable row level security;
create policy ads_client_campaigns_select on public.ads_client_campaigns for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy ads_client_campaigns_insert on public.ads_client_campaigns for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy ads_client_campaigns_update on public.ads_client_campaigns for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy ads_client_campaigns_delete on public.ads_client_campaigns for delete to authenticated
  using (private.has_role(org_id, 'partner'));
