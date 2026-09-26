# Capa fiscal y Verifactu

**Decisión (25/09/2026):** GNERAI OS no implementa Verifactu. Delega la emisión legal en un
`FiscalProvider` y se queda con lo que le diferencia: contratos, recurrencias, CRM y métricas.

## Por qué no lo implementamos nosotros

- Cumplir Verifactu es un producto en sí mismo: huella encadenada, QR, envío a la AEAT con
  certificado, gestión de rechazos, cambios normativos y declaración responsable del productor.
- Un fallo bloquea la facturación, y usar un sistema que no cumple se sanciona con 50.000 € por
  ejercicio (art. 201 bis LGT).
- Hay proveedores ya adaptados que mantienen los cambios por nosotros.

## Proveedores

| Implementación | Estado | Qué hace |
|---|---|---|
| `internalDraftProvider` (`internal.ts`) | **Activo** | Numeración propia sin huecos (contador en Postgres, dentro de la transacción de emisión) y PDF propio. Emite legalmente solo mientras el emisor no esté obligado a Verifactu |
| `FakeCertifiedProvider` (`fake-certified.ts`) | Solo tests | Numera él, devuelve QR de cotejo, falla a propósito y se reintenta. Deja probado el camino externo |
| Adaptador real | Cuando se elija (hito 1.6) | FacturaDirecta, Invopop u Holded. Credenciales en Vault |

## Flujo de emisión (`issue-flow.ts`)

```
draft ──(begin: validar · congelar · nº interno)──▶ issuing ──(proveedor OK · PDF guardado)──▶ issued
```

- `begin` (RPC `issue_invoice_begin`) valida en la base de datos: datos fiscales completos, emisor
  activo, totales = Σ líneas, fechas no decrecientes en la serie y **bloqueo Verifactu**: si
  `issued_on ≥ issuers.verifactu_from` y el proveedor es el interno, no se emite.
- Con el proveedor interno, el número se asigna en esa misma transacción. Si algo falla antes de
  confirmar, el incremento se deshace: no quedan huecos.
- Si algo falla después (proveedor caído, PDF que no se guarda), la factura se queda en
  `issuing`. El reintento vuelve a entrar por `begin` (idempotente) y el proveedor recibe la
  misma clave de idempotencia: nunca se registra dos veces.
- Los totales que devuelve el proveedor se comparan con los nuestros. Si no cuadran, la factura
  no se da por emitida.

## Fechas que mandan

RDL 15/2025: la SL, antes del **01/01/2027**; los autónomos, antes del **01/07/2027**. La fecha
vive en `issuers.verifactu_from` y es editable, porque ya se ha movido más de una vez. La app
avisa desde 90 días antes (`verifactuCountdown`).

## Antes de conectar un proveedor

La AEAT define el SIF de forma amplia, y los módulos conectados forman un único SIF. Hay que
validar con la gestoría que la combinación GNERAI OS + proveedor cumple. La opción más segura:
que el PDF que recibe el cliente sea el del proveedor, con su QR (`capabilities.providesPdf`).
