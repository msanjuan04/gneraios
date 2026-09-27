"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MemberRef } from "./types";

const SIZES = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-7 text-[11px]" } as const;

/** Avatar de un socio: sus iniciales sobre su color (members.color) o el degradado de marca. */
export function MemberAvatar({
  member,
  size = "sm",
  className,
  tooltip = true,
}: {
  member: MemberRef | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
  tooltip?: boolean;
}) {
  const t = useTranslations("projects");
  if (!member) {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground", SIZES[size], className)}
        title={t("unassigned")}
        aria-label={t("unassigned")}
      />
    );
  }
  const avatar = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        !member.color && "bg-brand-gradient",
        !member.active && "opacity-60",
        SIZES[size],
        className,
      )}
      style={member.color ? { backgroundColor: member.color } : undefined}
      aria-label={member.fullName}
      role="img"
    >
      {member.initials}
    </span>
  );
  if (!tooltip) return avatar;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>{member.fullName}</TooltipContent>
    </Tooltip>
  );
}

export function memberLookup(members: readonly MemberRef[]) {
  const byId = new Map(members.map((m) => [m.id, m]));
  return (id: string | null | undefined) => (id ? byId.get(id) : undefined);
}
