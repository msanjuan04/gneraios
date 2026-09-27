"use client";

import { Check, Copy, KeyRound, Laptop, PencilLine, ShieldCheck, Smartphone, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import type { TrustedDeviceView } from "@/server/auth/access-code";

// Piezas de los códigos de acceso que comparten Ajustes → Equipo (los owners, para cada socio) y
// Ajustes → Preferencias (cada uno, el suyo): generar un código y enseñarlo una sola vez, y la
// lista de dispositivos de confianza.

/** "12345678" → "1234 5678", como se lee en voz alta. */
const pretty = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

/**
 * Botón para generar (o cambiar) un código. Si ya hay uno, antes pregunta: el actual deja de
 * funcionar. El código nuevo solo existe en este diálogo; al cerrarlo, desaparece.
 */
export function GenerateCodeButton({
  hasCode,
  generate,
  self,
  name,
  size = "sm",
}: {
  hasCode: boolean;
  generate: () => Promise<ActionResult<{ code: string }>>;
  /** El código es de quien lo genera (Preferencias) o de otro socio (Equipo). */
  self: boolean;
  name: string;
  size?: "sm" | "default";
}) {
  const t = useTranslations("settings.accessCode");
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await generate();
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCopied(false);
      setCode(result.code);
    });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("copied"));
    } catch {
      // Sin permiso de portapapeles: el código sigue a la vista para apuntarlo.
    }
  };

  return (
    <>
      <Button
        variant={hasCode ? "outline" : "default"}
        size={size}
        disabled={pending}
        onClick={() => (hasCode ? setConfirming(true) : run())}
      >
        <KeyRound data-icon="inline-start" />
        {hasCode ? t("regenerate") : t("generate")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={self ? t("regenerateSelfTitle") : t("regenerateTitle", { name })}
        description={t("regenerateBody")}
        confirmLabel={t("regenerate")}
        onConfirm={run}
        pending={pending}
      />
      <Dialog open={code !== null} onOpenChange={(open) => !open && setCode(null)}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold">
              <ShieldCheck className="size-4 text-primary" />
              {self ? t("revealSelfTitle") : t("revealTitle", { name })}
            </DialogTitle>
            <DialogDescription>{self ? t("revealSelfBody") : t("revealBody")}</DialogDescription>
          </DialogHeader>
          {code && (
            <div className="rounded-2xl border bg-muted/40 px-4 py-6 text-center">
              <p
                className="select-all font-mono text-4xl font-bold tracking-[0.2em] tabular"
                aria-label={code.split("").join(" ")}
                data-testid="access-code"
              >
                {pretty(code)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {t("copy")}
            </Button>
            <Button onClick={() => setCode(null)}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Estado del código en una línea: "Creado el 26 sept 2026 · último uso el 26 sept 2026". */
export function CodeStatusLine({ hasCode, createdAt, lastUsedAt }: { hasCode: boolean; createdAt: string | null; lastUsedAt: string | null }) {
  const t = useTranslations("settings.accessCode");
  const format = useFormatter();
  if (!hasCode || !createdAt) return <span>{t("none")}</span>;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  return (
    <span>
      {t("created", { date: date(createdAt) })} · {lastUsedAt ? t("lastUsed", { date: date(lastUsedAt) }) : t("neverUsed")}
    </span>
  );
}

/** Los dispositivos en los que se entra solo con el código, con un botón para dejar de confiar en cada uno. */
export function TrustedDeviceList({
  devices,
  revoke,
  revokeBody,
}: {
  devices: TrustedDeviceView[];
  revoke: (deviceId: string) => Promise<ActionResult>;
  /** Qué más pasa al quitarlo (se cierran sesiones…), según quién lo quita. */
  revokeBody: (device: TrustedDeviceView) => string;
}) {
  const t = useTranslations("settings.accessCode");
  const format = useFormatter();
  const [target, setTarget] = useState<TrustedDeviceView | null>(null);
  const [pending, startTransition] = useTransition();

  if (devices.length === 0) return <p className="text-xs text-muted-foreground">{t("noDevices")}</p>;

  const apply = () =>
    startTransition(async () => {
      if (!target) return;
      const result = await revoke(target.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("revoked"));
      setTarget(null);
    });

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {devices.map((device) => {
          const Icon = /iphone|android|ipad/i.test(device.label) ? Smartphone : Laptop;
          return (
            <li key={device.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-medium">
                  {device.label}
                  {device.current && <Badge variant="secondary">{t("thisDevice")}</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {device.confirmedAt && t("deviceSince", { date: date(device.confirmedAt) })}
                  {device.lastUsedAt && ` · ${t("lastUsed", { date: date(device.lastUsedAt) })}`}
                </span>
              </span>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTarget(device)}>
                <X data-icon="inline-start" />
                {t("revoke")}
              </Button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t("revokeTitle", { device: target?.label ?? "" })}
        description={target ? revokeBody(target) : ""}
        confirmLabel={t("revoke")}
        onConfirm={apply}
        pending={pending}
      />
    </>
  );
}

/**
 * «Elegir mi código»: el socio escribe sus 8 cifras dos veces. El servidor las valida (no obvias,
 * no las de otro socio) y solo guarda su hash; el anterior deja de valer.
 */
export function ChooseCodeButton({ save }: { save: (code: string, repeat: string) => Promise<ActionResult> }) {
  const t = useTranslations("settings.accessCode");
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setCode("");
    setRepeat("");
    setError(null);
  };
  const submit = () =>
    startTransition(async () => {
      const result = await save(code, repeat);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t("chosen"));
      close();
    });
  const digits = (value: string) => value.replace(/[^\d\s-]/g, "").slice(0, 10);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PencilLine data-icon="inline-start" />
        {t("choose")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : !pending && close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-bold">{t("chooseTitle")}</DialogTitle>
            <DialogDescription>{t("chooseBody")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t("chooseNew")}</span>
              <Input
                value={code}
                onChange={(e) => {
                  setCode(digits(e.target.value));
                  setError(null);
                }}
                inputMode="numeric"
                autoComplete="new-password"
                autoFocus
                placeholder="•••• ••••"
                aria-invalid={Boolean(error)}
                className="h-12 rounded-xl text-center font-mono text-xl tracking-[0.3em]"
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t("chooseRepeat")}</span>
              <Input
                value={repeat}
                onChange={(e) => {
                  setRepeat(digits(e.target.value));
                  setError(null);
                }}
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="•••• ••••"
                aria-invalid={Boolean(error)}
                className="h-12 rounded-xl text-center font-mono text-xl tracking-[0.3em]"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                {t("chooseCancel")}
              </Button>
              <Button type="submit" disabled={pending || code.replace(/\D/g, "").length < 8}>
                <KeyRound data-icon="inline-start" />
                {t("chooseSave")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
