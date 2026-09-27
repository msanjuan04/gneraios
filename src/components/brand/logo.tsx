import type { CSSProperties } from "react";
import Image from "next/image";
import { brand } from "@/brand";
import { cn } from "@/lib/utils";

/** Isotipo de GNERAI: metálico en oscuro, silueta negra en claro. */
export function Isotype({
  size = 24,
  className,
  priority,
  style,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Image
      src={brand.logos.isotypeMetal}
      alt=""
      width={size}
      height={size}
      priority={priority}
      style={style}
      className={cn("shrink-0 select-none brightness-0 dark:brightness-100", className)}
    />
  );
}

/** Isotipo + logotipo planos (el de las facturas): negro en claro, blanco en oscuro. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Image
      src={brand.logos.logoFlat}
      alt={brand.name}
      width={900}
      height={220}
      className={cn("h-6 w-auto select-none dark:invert", className)}
    />
  );
}
