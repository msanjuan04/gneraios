-- Auditoría del 03/10/2026: permisos mínimos y un dato que pesaba sin servir.
--
-- 1) Supabase da por defecto TODOS los permisos de tabla a `anon` y `authenticated`. La seguridad por
--    filas (RLS) los frena hoy, pero es una sola capa: si una política se escribiera mal, `anon` (sin
--    sesión) llegaría a los datos. Ocho tablas lo tenían abierto (las migraciones antiguas ya hacían
--    `revoke ... from anon` en el resto). Ninguna función pública es ejecutable por `anon` y la app
--    no usa ese rol: el portal público pasa por el servidor con la clave de servicio.
-- 2) `authenticated` no necesita TRUNCATE, REFERENCES ni TRIGGER (RLS no limita TRUNCATE).
-- 3) El HTML de los correos (`mail_messages.body_html`) no se enseña ni se usa: la app lee el texto.
--    Ocupaba 24 de los 26 MB de la tabla con solo 634 mensajes (≈ 39 KB cada uno).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- Y lo mismo para lo que se cree a partir de ahora.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

update public.mail_messages set body_html = null where body_html is not null;
comment on column public.mail_messages.body_html is 'Sin uso: la app lee body_text. No se guarda (pesaba ≈ 39 KB por mensaje).';

-- 4) El registro de auditoría es de solo añadir: lo escriben los triggers (security definer) y lo lee un
--    owner. Quien tiene sesión no necesita, ni debe poder, escribirlo o borrarlo; hoy solo lo frenaba
--    la seguridad por filas.
revoke insert, update, delete on public.audit_log from authenticated;
