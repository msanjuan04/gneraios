"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CodeStatusLine, GenerateCodeButton, TrustedDeviceList } from "@/components/settings/access-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateMyAccessCode, revokeMemberDevice } from "@/server/auth/actions";
import type { AccessStatus } from "@/server/auth/access-code";

/** Un socio en la lista de códigos: su estado, generar o cambiar su código y sus dispositivos. */
export function MemberAccessCodeRow({
  slug,
  memberId,
  name,
  initials,
  isSelf,
  status,
}: {
  slug: string;
  memberId: string;
  name: string;
  initials: string;
  isSelf: boolean;
  status: AccessStatus;
}) {
  const t = useTranslations("settings.accessCode");
  const tTeam = useTranslations("settings.team");
  const [open, setOpen] = useState(false);
  const count = status.devices.length;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white"
          aria-hidden
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 font-medium">
            {name}
            {isSelf && <Badge variant="secondary">{tTeam("you")}</Badge>}
          </span>
          <span className="block text-xs text-muted-foreground">
            <CodeStatusLine hasCode={status.hasCode} createdAt={status.codeCreatedAt} lastUsedAt={status.lastUsedAt} />
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={count === 0}
        >
          {t("devicesCount", { count })}
          {count > 0 && <ChevronDown data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />}
        </Button>
        {isSelf && (
          <GenerateCodeButton
            hasCode={status.hasCode}
            self
            name={name}
            generate={() => generateMyAccessCode(slug)}
          />
        )}
      </div>
      {open && count > 0 && (
        <div className="mt-3 sm:pl-11">
          <TrustedDeviceList
            devices={status.devices}
            revoke={(deviceId) => revokeMemberDevice(slug, memberId, deviceId)}
            revokeBody={(device) =>
              isSelf ? (device.current ? t("revokeCurrentBody") : t("revokeSelfBody")) : t("revokeMemberBody", { name })
            }
          />
        </div>
      )}
    </li>
  );
}
