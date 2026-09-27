-- GNERAI OS · Entrada con código personal
-- Cada socio entra con su código de 8 cifras. El código nunca se guarda: solo su hash (scrypt con
-- sal, lo calcula el servidor en src/server/auth/access-code.ts). Y un código solo sirve en un
-- dispositivo de confianza: la primera vez que se usa en un móvil u ordenador nuevo, además del
-- código hay que confirmar ese dispositivo con un enlace que llega al email del socio. Así, quien
-- probara códigos al azar no llegaría a ninguna parte (y los intentos están limitados).
--
-- Van por usuario (auth.users), no por org: el acceso es de la persona. Ningún usuario lee estas
-- tablas; las usa solo el servidor con service_role (RLS activa y sin políticas).

create table public.access_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^scrypt\$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  last_used_at timestamptz
);

create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 del token del dispositivo (cookie httpOnly); el token nunca se guarda. Un mismo
  -- ordenador puede ser de confianza para varios socios (una fila por socio).
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  label text check (char_length(label) <= 200),
  -- null = pendiente: se ha escrito el código bien, falta el enlace del email.
  confirmed_at timestamptz,
  confirm_token_hash text unique check (confirm_token_hash is null or confirm_token_hash ~ '^[0-9a-f]{64}$'),
  confirm_expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create unique index trusted_devices_user_device_idx on public.trusted_devices (user_id, device_hash);

-- Intentos de entrada con código: frenan a quien pruebe códigos (por IP y en total).
create table public.access_code_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users (id) on delete cascade,
  ok boolean not null,
  at timestamptz not null default now()
);
create index access_code_attempts_ip_idx on public.access_code_attempts (ip_hash, at desc);
create index access_code_attempts_at_idx on public.access_code_attempts (at desc);

alter table public.access_codes enable row level security;
alter table public.trusted_devices enable row level security;
alter table public.access_code_attempts enable row level security;
revoke all on public.access_codes, public.trusted_devices, public.access_code_attempts from anon, authenticated;

-- Aviso a los socios cuando alguien confirma un dispositivo nuevo.
alter type public.notification_kind add value if not exists 'new_device';
