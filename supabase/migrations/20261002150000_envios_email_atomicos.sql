-- Envío de emails sin duplicados (auditoría A10): quien va a enviar un email de la bandeja lo
-- reclama antes con una actualización condicional (claimed_at vacío o caducado). Dos peticiones a
-- la vez no pueden enviar el mismo email: solo una consigue la fila. La reclamación caduca a los
-- diez minutos por si el proceso muere a medias.
alter table public.outbound_emails add column claimed_at timestamptz;
comment on column public.outbound_emails.claimed_at is 'Instante en que una petición reclamó el envío; caduca a los 10 minutos. Solo lo pone el servidor al enviar.';
