"use client";

import { BellOff, BellRing, Download, Send, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { getPushDeviceStatus, registerPushDevice, sendTestPush, unregisterPushDevice } from "@/server/push/actions";

// Activar los avisos push en este dispositivo e instalar la app (PWA). El service worker
// (public/sw.js) solo se registra aquí, al activarlos: sin avisos no hace falta.

type Support = "checking" | "unsupported" | "ios-install" | "ready";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function detectSupport(): Support {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !isStandalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ready";
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function PushSettings({ slug }: { slug: string }) {
  const t = useTranslations("settings.preferences.push");
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; registered: boolean; devices: number } | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const detected = detectSupport();
    setSupport(detected);
    setInstalled(isStandalone());
    if (detected !== "ready") {
      setStatus(await getPushDeviceStatus(slug, null));
      return;
    }
    setPermission(Notification.permission);
    const sub = await currentSubscription();
    setEndpoint(sub?.endpoint ?? null);
    setStatus(await getPushDeviceStatus(slug, sub?.endpoint ?? null));
  }, [slug]);

  useEffect(() => {
    // Lo que admite el navegador solo se sabe aquí, tras montar: se consulta una vez al abrir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstall(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [refresh]);

  const enable = () =>
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const granted = await Notification.requestPermission();
        setPermission(granted);
        if (granted !== "granted") return;
        // Si la suscripción es de otras claves (se cambiaron en el servidor), se rehace.
        const previous = await registration.pushManager.getSubscription();
        if (previous) await previous.unsubscribe();
        const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
        const result = await registerPushDevice(slug, sub.toJSON(), navigator.userAgent);
        if (!result.ok) {
          await sub.unsubscribe();
          toast.error(result.error);
          return;
        }
        toast.success(t("enabled"));
      } catch (error) {
        console.error("[push] enable", error);
        toast.error(t("enableFailed"));
      }
      await refresh();
    });

  const disable = () =>
    startTransition(async () => {
      const sub = await currentSubscription();
      if (sub) {
        const result = await unregisterPushDevice(slug, sub.endpoint);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        await sub.unsubscribe();
      }
      toast.success(t("disabled"));
      await refresh();
    });

  const test = () =>
    startTransition(async () => {
      if (!endpoint) return;
      const result = await sendTestPush(slug, endpoint);
      if (result.ok) toast.success(t("testSent"));
      else toast.error(result.error);
      await refresh();
    });

  const promptInstall = () =>
    startTransition(async () => {
      if (!install) return;
      await install.prompt();
      const choice = await install.userChoice;
      if (choice.outcome === "accepted") setInstall(null);
    });

  const active = support === "ready" && permission === "granted" && Boolean(status?.registered);

  let notice: string | null = null;
  if (support === "unsupported") notice = t("unsupported");
  else if (support === "ios-install") notice = t("iosInstall");
  else if (status && !status.configured) notice = t("notConfigured");
  else if (permission === "denied") notice = t("denied");

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          {active ? <BellRing className="size-4 text-success" /> : <BellOff className="size-4 text-muted-foreground" />}
          {t("title")}
        </span>
      }
      description={t("description")}
      actions={
        support === "ready" && status?.configured && permission !== "denied" ? (
          active ? (
            <>
              <Button variant="outline" size="sm" onClick={test} disabled={pending}>
                <Send data-icon="inline-start" />
                {t("test")}
              </Button>
              <Button variant="ghost" size="sm" onClick={disable} disabled={pending}>
                {t("disable")}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={enable} disabled={pending}>
              <BellRing data-icon="inline-start" />
              {pending ? t("enabling") : t("enable")}
            </Button>
          )
        ) : null
      }
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2">
          <span className={active ? "font-medium text-success" : "text-muted-foreground"}>
            {support === "checking" ? "…" : active ? t("on") : t("off")}
          </span>
          {status && status.devices > 0 && (
            <span className="text-xs text-muted-foreground">· {t("devices", { count: status.devices })}</span>
          )}
        </p>
        {notice && <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-muted-foreground">{notice}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Smartphone className="size-4 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-muted-foreground">{installed ? t("installed") : t("installHint")}</p>
          {install && !installed && (
            <Button variant="outline" size="sm" onClick={promptInstall} disabled={pending}>
              <Download data-icon="inline-start" />
              {t("install")}
            </Button>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
