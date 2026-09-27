-- GNERAI OS · SEO: el tráfico de GA4 por canales
-- Hasta ahora se guardaba el total del día y el orgánico. Ahora, cada canal por defecto de GA4
-- (agrupados: los de pago aparte de los orgánicos, que es lo que se mira en una campaña), así se
-- ve de dónde vienen las visitas y qué traen las campañas de Google y de Meta sin conectar aún
-- sus APIs. Los canales suman el total; los usuarios no se suman (la misma persona repite).

alter type public.web_channel add value if not exists 'paid_search';
alter type public.web_channel add value if not exists 'organic_social';
alter type public.web_channel add value if not exists 'paid_social';
alter type public.web_channel add value if not exists 'direct';
alter type public.web_channel add value if not exists 'referral';
alter type public.web_channel add value if not exists 'email';
alter type public.web_channel add value if not exists 'other';

-- La próxima sincronización vuelve a bajar los 16 meses de GA4 con los canales nuevos (los
-- upserts son idempotentes: el total y el orgánico quedan igual).
update public.seo_sync_state set synced_from = null, synced_to = null where provider = 'ga4';
