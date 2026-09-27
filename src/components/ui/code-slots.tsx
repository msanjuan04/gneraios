"use client";

import { type CSSProperties, Fragment, type RefObject, useMemo, useRef, useState } from "react";

// Casillas para escribir un código (OTP): las cifras suben con un muelle al escribirlas, un cursor
// parpadea en la casilla activa y el resultado se anima en cascada (aceptado: las casillas se
// encienden una tras otra; error: tiemblan en rojo). Por debajo hay un único <input> transparente,
// así que pegar el código, el teclado numérico del móvil y los lectores de pantalla funcionan solos.

export type CodeSlotsStatus = "idle" | "pending" | "error" | "locked" | "success";

export type CodeSlotsProps = {
  length: number;
  /** Controlado: el valor lo lleva el padre. Sin `value`, el componente guarda el suyo. */
  value?: string;
  status?: CodeSlotsStatus;
  onChange?: (value: string) => void;
  /** Se llama al escribir la última cifra. */
  onComplete?: (code: string) => void;
  /** Cursor y casilla activa; y, al aceptar, el fondo de las casillas. */
  accentColor?: string;
  /** Color de las cifras. */
  inkColor?: string;
  /** Fondo de cada casilla. */
  slotColor?: string;
  /** Color de las cifras sobre la casilla encendida (aceptado). */
  digitColor?: string;
  dangerColor?: string;
  /** Tamaño máximo de la casilla; si no caben, se encogen para ocupar el ancho disponible. */
  slotSize?: number;
  gap?: number;
  radius?: number;
  /** Muelle de cada cifra: rebote (0 = ninguno) y segundos hasta asentarse. */
  bounce?: number;
  settle?: number;
  /** Píxeles que sube cada cifra al aparecer. */
  rise?: number;
  /** Milisegundos entre una casilla y la siguiente en las animaciones en cascada. */
  cascade?: number;
  mask?: boolean;
  caret?: boolean;
  outcome?: "accept" | "none";
  disabled?: boolean;
  /** Hueco extra cada N casillas (8 cifras se leen mejor como 4 · 4). */
  groupSize?: number;
  id?: string;
  name?: string;
  label: string;
  describedBy?: string;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * La curva de un muelle amortiguado como easing `linear()` de CSS: `bounce` 0–1 (0 = sin rebote)
 * y `settle` en segundos. Así la animación es CSS pura y va fluida aunque React esté ocupado.
 */
export function springEasing(bounce: number, settle: number, samples = 28): string {
  const zeta = Math.min(Math.max(1 - bounce, 0.05), 1);
  // Frecuencia para que la oscilación quede por debajo de 1/1000 al acabar `settle`.
  const omega = Math.log(1000) / (zeta * Math.max(settle, 0.05));
  const points: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * settle;
    let x: number;
    if (zeta < 1) {
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    } else {
      x = 1 - Math.exp(-omega * t) * (1 + omega * t);
    }
    points.push(i === samples ? 1 : Math.round(x * 1000) / 1000);
  }
  return `linear(${points.join(", ")})`;
}

export function CodeSlots({
  length,
  value: controlled,
  status = "idle",
  onChange,
  onComplete,
  accentColor = "#f5f5f5",
  inkColor = "#f5f5f5",
  slotColor = "#27272a",
  digitColor = "#18181b",
  dangerColor = "#ff3b30",
  slotSize = 44,
  gap = 8,
  radius = 12,
  bounce = 0.2,
  settle = 0.3,
  rise = 8,
  cascade = 20,
  mask = false,
  caret = true,
  outcome = "accept",
  disabled = false,
  groupSize,
  id,
  name,
  label,
  describedBy,
  autoFocus,
  inputRef,
}: CodeSlotsProps) {
  const [own, setOwn] = useState("");
  const fallbackRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? fallbackRef;
  const value = controlled ?? own;
  const easing = useMemo(() => springEasing(bounce, settle), [bounce, settle]);

  const groups = groupSize && groupSize < length ? Math.ceil(length / groupSize) - 1 : 0;
  const totalGap = (length - 1) * gap + groups * gap;
  const active = Math.min(value.length, length - 1);
  const accepted = status === "success" && outcome === "accept";
  const readOnly = disabled || status === "success" || status === "pending";

  const change = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, length);
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
    if (next.length === length && next !== value) onComplete?.(next);
  };

  const style = {
    "--cs-accent": accentColor,
    "--cs-ink": inkColor,
    "--cs-slot": slotColor,
    "--cs-digit": digitColor,
    "--cs-danger": dangerColor,
    "--cs-rise": `${rise}px`,
    "--cs-spring": easing,
    "--cs-settle": `${settle}s`,
    containerType: "inline-size",
  } as CSSProperties;

  return (
    <div className="cs-root relative w-full" style={style} onPointerDown={() => !disabled && ref.current?.focus()}>
      <div
        className={status === "error" ? "cs-shake flex justify-center" : "flex justify-center"}
        style={{ gap }}
      >
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          // La siguiente casilla por llenar. Que se vea activa (anillo y cursor) lo decide el CSS con
          // :focus-within: con autofocus el foco llega antes de hidratar y un estado se desincroniza.
          const isNext = caret && status === "idle" && i === active && value.length < length;
          const tone = status === "error" ? "error" : accepted ? "accept" : status === "locked" ? "locked" : "idle";
          return (
            <Fragment key={i}>
              {groupSize && i > 0 && i % groupSize === 0 && <span aria-hidden style={{ width: gap }} className="shrink-0" />}
              <span
                aria-hidden
                data-tone={tone}
                data-next={isNext || undefined}
                data-filled={digit ? true : undefined}
                data-pending={status === "pending" || undefined}
                className="cs-slot relative flex shrink-0 items-center justify-center overflow-hidden font-semibold tabular"
                style={{
                  width: `min(${slotSize}px, calc((100cqw - ${totalGap}px) / ${length}))`,
                  aspectRatio: "44 / 52",
                  borderRadius: radius,
                  fontSize: `min(${Math.round(slotSize * 0.5)}px, calc((100cqw - ${totalGap}px) / ${length} * 0.5))`,
                  transitionDelay: tone === "accept" || tone === "error" ? `${i * cascade}ms` : "0ms",
                  animationDelay: status === "pending" ? `${i * cascade * 3}ms` : undefined,
                }}
              >
                {digit ? (
                  <span key={`${i}:${digit}`} className="cs-digit">
                    {mask ? "•" : digit}
                  </span>
                ) : (
                  isNext && <span className="cs-caret" />
                )}
              </span>
            </Fragment>
          );
        })}
      </div>
      <input
        ref={ref}
        id={id}
        name={name}
        value={value}
        onChange={(e) => change(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        autoFocus={autoFocus}
        readOnly={readOnly}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={status === "error"}
        className="absolute inset-0 h-full w-full cursor-text appearance-none border-0 bg-transparent text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent"
      />
    </div>
  );
}
