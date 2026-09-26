import { NextResponse } from "next/server";

/** Healthcheck para DigitalOcean App Platform. No toca la base de datos. */
export function GET() {
  return NextResponse.json({ ok: true, service: "gnerai-os" });
}
