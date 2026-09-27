import { cn } from "@/lib/utils";

/** Píldora de acción de gnerai.com: primaria con el degradado de marca o secundaria con borde. */
export function pillClass(variant: "primary" | "secondary" | "ghost" = "primary", size: "md" | "lg" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-all outline-none",
    "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
    size === "lg" ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-sm",
    variant === "primary" && "bg-brand-gradient text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_8px_24px_-12px_rgb(46_128_255/0.8)] hover:brightness-110",
    variant === "secondary" && "border border-border bg-background/60 text-foreground hover:bg-muted",
    variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}
