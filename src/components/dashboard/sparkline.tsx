import { cn } from "@/lib/utils";

type Point = { key: string; value: number; estimated: boolean; title: string };

const W = 240;
const H = 56;
const PAD_TOP = 6;

/**
 * Tendencia de una cifra (12 meses) en SVG puro, sin JavaScript en el cliente. Escala desde 0
 * (no exagera los cambios), tramo punteado donde el valor es una reconstrucción y el último
 * punto marcado. Cada mes tiene su título nativo al pasar el ratón; la tabla completa está en
 * la gráfica del histórico.
 */
export function Sparkline({ points, label, className }: { points: readonly Point[]; label: string; className?: string }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (value: number) => PAD_TOP + (1 - Math.max(0, value) / max) * (H - PAD_TOP);
  const coords = points.map((p, i) => [x(i), y(p.value)] as const);
  const segment = (i: number) => `M${coords[i]![0]},${coords[i]![1]}L${coords[i + 1]![0]},${coords[i + 1]![1]}`;
  const solid: string[] = [];
  const dashed: string[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    (points[i]!.estimated || points[i + 1]!.estimated ? dashed : solid).push(segment(i));
  }
  const area = `M0,${H}${coords.map(([cx, cy]) => `L${cx},${cy}`).join("")}L${W},${H}Z`;
  const last = coords.at(-1)!;
  const step = W / (points.length - 1);

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-14 w-full overflow-visible">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={solid.join("")} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path
          d={dashed.join("")}
          fill="none"
          stroke="var(--chart-1)"
          strokeOpacity="0.75"
          strokeWidth="2"
          strokeDasharray="3 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <rect key={p.key} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent">
            <title>{p.title}</title>
          </rect>
        ))}
      </svg>
      {/* El punto final va en HTML para que no se deforme con el SVG estirado. */}
      <span
        aria-hidden
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[var(--chart-1)] shadow-[0_0_12px_var(--chart-1)]"
        style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}
      />
    </div>
  );
}
