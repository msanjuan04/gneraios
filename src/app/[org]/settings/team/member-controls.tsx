"use client";

import { UserCheck, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { changeMemberRole, setMemberActive } from "./actions";
import { type Role, ROLES } from "./schema";

/**
 * Rol de un miembro, editable por un owner. Si un owner se quita el rol a sí mismo
 * se le pide confirmación: pierde el acceso a esta pantalla en el acto.
 */
export function MemberRoleSelect({
  slug,
  memberId,
  role,
  isSelf,
}: {
  slug: string;
  memberId: string;
  role: Role;
  isSelf: boolean;
}) {
  const t = useTranslations("settings.team");
  const tRoles = useTranslations("roles");
  const tHints = useTranslations("roleHints");
  const [optimisticRole, setOptimisticRole] = useOptimistic(role);
  const [pending, startTransition] = useTransition();
  const [confirmRole, setConfirmRole] = useState<Role | null>(null);

  const apply = (next: Role) =>
    startTransition(async () => {
      setOptimisticRole(next);
      const result = await changeMemberRole(slug, { member_id: memberId, role: next });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("roleChanged"));
      setConfirmRole(null);
    });

  const onChange = (value: string) => {
    const next = ROLES.find((r) => r === value);
    if (!next || next === role) return;
    if (isSelf && role === "owner") setConfirmRole(next);
    else apply(next);
  };

  return (
    <>
      <Select value={optimisticRole} onValueChange={onChange} disabled={pending}>
        <SelectTrigger size="sm" className="w-36" aria-label={t("role")}>
          <SelectValue>{tRoles(optimisticRole)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-72">
          {ROLES.map((r) => (
            <SelectItem key={r} value={r} className="items-start py-1.5">
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{tRoles(r)}</span>
                <span className="text-xs whitespace-normal text-muted-foreground">{tHints(r)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ConfirmDialog
        open={confirmRole !== null}
        onOpenChange={(open) => !open && setConfirmRole(null)}
        title={t("selfDemoteTitle")}
        description={t("selfDemoteBody")}
        confirmLabel={confirmRole ? t("selfDemoteConfirm", { role: tRoles(confirmRole) }) : ""}
        onConfirm={() => confirmRole && apply(confirmRole)}
        pending={pending}
      />
    </>
  );
}

/** Quitar el acceso (con confirmación) o devolverlo. */
export function MemberAccessButton({
  slug,
  memberId,
  name,
  active,
}: {
  slug: string;
  memberId: string;
  name: string;
  active: boolean;
}) {
  const t = useTranslations("settings.team");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const apply = (next: boolean) =>
    startTransition(async () => {
      const result = await setMemberActive(slug, { member_id: memberId, active: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? t("accessRestored", { name }) : t("accessRemoved", { name }));
      setConfirming(false);
    });

  if (!active) {
    return (
      <Button variant="ghost" size="sm" onClick={() => apply(true)} disabled={pending}>
        <UserCheck data-icon="inline-start" />
        {t("reactivate")}
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirming(true)}>
        <UserX data-icon="inline-start" />
        {t("deactivate")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("deactivateTitle", { name })}
        description={t("deactivateBody")}
        confirmLabel={t("deactivate")}
        onConfirm={() => apply(false)}
        pending={pending}
      />
    </>
  );
}
