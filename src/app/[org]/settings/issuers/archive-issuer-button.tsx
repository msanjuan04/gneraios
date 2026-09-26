"use client";

import { Archive } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveIssuer } from "./actions";

export function ArchiveIssuerButton({ slug, issuerId, name }: { slug: string; issuerId: string; name: string }) {
  const t = useTranslations("settings.issuers");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const result = await archiveIssuer(slug, issuerId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archivedToast", { name }));
      setOpen(false);
    });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("archive")} onClick={() => setOpen(true)}>
            <Archive />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("archive")}</TooltipContent>
      </Tooltip>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("archiveTitle", { name })}
        description={t("archiveBody")}
        confirmLabel={t("archive")}
        onConfirm={confirm}
        pending={pending}
      />
    </>
  );
}
