-- GNERAI OS · Cobros · Permisos de las funciones auxiliares
-- Las vistas de cobros (security_invoker) llaman a funciones de `private` que 20260926260000_cobros
-- solo dejaba ejecutar a `authenticated`. El servidor (service_role: cron, agentes, portal) también
-- lee esas vistas, así que también tiene que poder ejecutarlas. Es idempotente.
grant execute on function private.mandate_sequence_type(uuid) to service_role;
grant execute on function private.invoice_outstanding(uuid) to service_role;
