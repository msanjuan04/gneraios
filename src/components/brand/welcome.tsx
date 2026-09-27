"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { brand } from "@/brand";
import { Isotype } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { WELCOME_COOKIE } from "@/lib/welcome";

// Bienvenida al entrar con el código. En /login, la pantalla se abre en círculo desde las casillas
// hacia un fondo de la marca con «Hola, {nombre}»; se navega y, ya en la app, el mismo fondo se
// disuelve sobre el dashboard (WelcomeVeil). Entre las dos páginas pasa el nombre en una cookie
// de 30 s que deja el servidor al entrar (src/lib/welcome.ts) y que el velo borra.

/** Lo que dura la cascada de las casillas encendiéndose antes de que se abra la bienvenida. */
const ACCEPT_PAUSE_MS = 420;

const backdrop: CSSProperties = {
  backgroundColor: brand.palette.black,
  backgroundImage: `radial-gradient(60% 50% at 50% 42%, color-mix(in oklab, ${brand.palette.blueBright} 34%, transparent), transparent 72%)`,
};

/** Logo, «Hola, {nombre}» y una línea: entra animado en /login y ya quieto en el velo de la app. */
function WelcomeContent({ name, subtitle, animated }: { name: string; subtitle: string; animated: boolean }) {
  const t = useTranslations("auth.code");
  return (
    <>
      <Isotype
        size={92}
        className={cn("relative brightness-100 drop-shadow-[0_12px_48px_rgb(46_128_255/0.55)]", animated && "gos-logo-in")}
        style={animated ? { animationDelay: `${ACCEPT_PAUSE_MS}ms` } : undefined}
      />
      <p
        className={cn("relative mt-8 text-center text-3xl font-extrabold text-white heading-tight sm:text-5xl", animated && "gos-rise")}
        style={animated ? { animationDelay: `${ACCEPT_PAUSE_MS + 260}ms` } : undefined}
      >
        {t("welcome", { name })}
      </p>
      <p className={cn("relative mt-3 text-center text-sm text-white/60", animated && "gos-rise")} style={animated ? { animationDelay: `${ACCEPT_PAUSE_MS + 420}ms` } : undefined}>
        {subtitle}
      </p>
    </>
  );
}

/** En /login, tras un código correcto: la apertura en círculo y, al acabar, la navegación. */
export function WelcomeTransition({ name, next, origin }: { name: string; next: string; origin: { x: number; y: number } }) {
  const t = useTranslations("auth.code");
  useEffect(() => {
    // La cookie de la bienvenida la deja el servidor al entrar; aquí solo se espera y se navega.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Primero se encienden las casillas (la cascada de «aceptado»), luego se abre el círculo.
    const timer = window.setTimeout(() => window.location.assign(next), reduced ? 0 : ACCEPT_PAUSE_MS + 1400);
    return () => window.clearTimeout(timer);
  }, [next]);

  return createPortal(
    <div
      role="status"
      className="gos-reveal fixed inset-0 z-[100] flex flex-col items-center justify-center px-6"
      style={{
        ...backdrop,
        animationDelay: `${ACCEPT_PAUSE_MS}ms`,
        ["--gos-x" as string]: `${origin.x}px`,
        ["--gos-y" as string]: `${origin.y}px`,
      }}
    >
      <WelcomeContent name={name} subtitle={t("entering")} animated />
    </div>,
    document.body,
  );
}

/**
 * En la app, justo después de entrar: el mismo fondo de la bienvenida, ya pintado desde el
 * servidor (sin parpadeo), que se disuelve sobre el dashboard.
 */
export function WelcomeVeil({ name }: { name: string }) {
  const t = useTranslations("auth.code");
  const [done, setDone] = useState(false);
  useEffect(() => {
    document.cookie = `${WELCOME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, []);
  if (done) return null;
  return (
    <div
      aria-hidden
      className="gos-veil-out pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center px-6"
      style={backdrop}
      onAnimationEnd={(e) => e.target === e.currentTarget && setDone(true)}
    >
      <WelcomeContent name={name} subtitle={t("ready")} animated={false} />
    </div>
  );
}
