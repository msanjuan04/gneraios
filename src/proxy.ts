import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { mfaRequired } from "@/lib/auth-policy";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

/**
 * Rutas accesibles sin sesión. Las de máquina se autentican solas: el cron con CRON_SECRET, los
 * webhooks con su firma y el calendario (ICS) y el portal de cliente con un token secreto.
 */
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/preview",
  "/api/health",
  "/api/cron",
  "/api/webhooks",
  "/api/calendar",
  "/api/public",
  "/p",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refresca la sesión de Supabase en cada petición y manda a /login a quien no
 * la tenga. No autoriza nada más: eso lo hace RLS en la base de datos.
 */
export async function proxy(request: NextRequest) {
  // Sin Supabase configurado, la app enseña en /login cómo conectarlo.
  if (!isSupabaseConfigured()) {
    if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Nada entre crear el cliente y getClaims(): es lo que renueva la sesión.
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  if (!data?.claims && !isPublic(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Segundo paso: quien tiene la verificación en dos pasos configurada la pasa en cada sesión; si
  // se exige (producción), quien aún no la tiene la configura antes de entrar. La base de datos lo
  // vuelve a exigir por su cuenta en las orgs con `require_mfa`.
  if (data?.claims && !isPublic(pathname) && data.claims.aal !== "aal2") {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.nextLevel === "aal2" || mfaRequired()) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "mfa_required" }, { status: 401 });
      const mfa = new URL("/auth/mfa", request.url);
      if (pathname !== "/") mfa.searchParams.set("next", `${pathname}${search}`);
      return copyCookies(response, NextResponse.redirect(mfa));
    }
  }

  return response;
}

/** Una redirección que conserva las cookies de sesión que Supabase acaba de renovar. */
function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

export const config = {
  matcher: [
    // Todo menos estáticos, imágenes optimizadas, ficheros de /public y el service worker (un
    // navegador nunca acepta un sw.js redirigido al login).
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js$|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
