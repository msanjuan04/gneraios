-- Avisos que genera el correo: un lead nuevo que ha escrito y un cliente que parece aceptar un
-- presupuesto enviado. Los dos llevan su clave de duplicado (un aviso por mensaje), así que
-- sincronizar dos veces el mismo buzón no avisa dos veces.
alter type public.notification_kind add value if not exists 'mail_new_lead';
alter type public.notification_kind add value if not exists 'mail_accepted';
