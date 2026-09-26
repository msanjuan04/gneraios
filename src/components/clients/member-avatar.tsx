"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MemberRef } from "./types";

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
} as const;

/** Iniciales del socio en una píldora con el degradado de marca; el nombre, al pasar el ratón. */
export function MemberAvatar({
  member,
  size = "sm",
  className,
}: {
  member: MemberRef;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const avatar = (
    <span
      role="img"
      aria-label={member.fullName ?? member.initials}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient font-bold text-white select-none",
        SIZES[size],
        className,
      )}
    >
      {member.initials}
    </span>
  );
  if (!member.fullName) return avatar;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{member.fullName}</TooltipContent>
    </Tooltip>
  );
}
