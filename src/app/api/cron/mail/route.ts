import { NextResponse } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { listMailAccounts } from "@/server/mail/account";
import { syncMailAccount } from "@/server/mail/sync";

// imapflow abre un socket TLS: hace falta Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Un buzón por org y 200 mensajes como mucho por carpeta: con 2 minutos sobra.
export const maxDuration = 120;

/**
 * Trae el correo de todos los buzones conectados (docs/CRON.md: cada 5 minutos, con
 * `Authorization: Bearer <CRON_SECRET>`). Cada vuelta pide solo lo que hay por encima del último
 * UID guardado, así que repetirlo no duplica nada ni cuesta.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const accounts = await listMailAccounts();
    const results = [];
    for (const account of accounts) {
      const result = await syncMailAccount(account);
      results.push({ account: account.address, ...result });
    }
    const ok = results.every((result) => result.error === null);
    return NextResponse.json({ ok, accounts: results.length, results }, { status: ok ? 200 : 207 });
  } catch (error) {
    console.error("[cron] mail", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
