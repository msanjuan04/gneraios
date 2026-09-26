import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Botón de icono de una fila con su tooltip. Si está deshabilitado por una regla
 * (`reason`), el tooltip la explica en lugar de repetir la etiqueta.
 */
export function RowAction({
  label,
  onClick,
  disabled = false,
  reason,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  children: ReactNode;
}) {
  const blocked = disabled && Boolean(reason);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Un botón deshabilitado no recibe el ratón ni el foco: el span sostiene el tooltip. */}
        <span
          className="inline-flex rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          tabIndex={blocked ? 0 : undefined}
        >
          <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{blocked ? reason : label}</TooltipContent>
    </Tooltip>
  );
}
