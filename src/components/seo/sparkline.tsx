import { cn } from "@/lib/utils";
import { SEO_MUTED } from "./chart-colors";

/**
 * Sparkline de una tarjeta de cifra: SVG puro (se pinta en el servidor, sin esperar a hidratar).
 * La línea va en el gris de contexto y el último punto, el periodo actual, en el azul de marca.
 * `invert` pone arriba los valores bajos (la posición: la 1 es la mejor). Es decorativa: la cifra
 * y su variación están escritas al lado.
 */
export function Sparkline({
  values,
  invert = false,
  className,
}: {
  values: readonly (number | null)[];
  invert?: boolean;
  className?: string;
}) {
  const points = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  if (points.length < 2) return <div aria-hidden className={cn("h-8", className)} />;

  const width = 100;
  const height = 32;
  const pad = 3;
  const ys = points.map(([, v]) => v);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const last = values.length - 1 || 1;
  const x = (i: number) => (i / last) * width;
  const y = (v: number) => {
    const t = (v - min) / span;
    return pad + (invert ? t : 1 - t) * (height - pad * 2);
  };
  const d = points.map(([i, v], k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1]!;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
    >
      <path d={d} fill="none" stroke={SEO_MUTED} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* El punto final no se deforma con el viewBox estirado: se dibuja como un trazo de longitud cero. */}
      <path
        d={`M${x(lastX).toFixed(2)},${y(lastY).toFixed(2)} l0,0`}
        stroke="var(--card)"
        strokeWidth={9}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${x(lastX).toFixed(2)},${y(lastY).toFixed(2)} l0,0`}
        stroke="var(--chart-1)"
        strokeWidth={6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
