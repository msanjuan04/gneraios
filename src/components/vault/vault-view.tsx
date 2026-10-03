"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Lock, LockOpen, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveVaultItem, createVault, rotateVaultPassword, saveVaultItem } from "@/app/[org]/passwords/actions";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createVaultSettings,
  decryptWithKey,
  EMPTY_SECRET,
  encryptWithKey,
  generatePassword,
  matchesQuery,
  openVault,
  passwordStrength,
  readVaultSecret,
  type VaultEntry,
  type VaultSecret,
  VaultCryptoError,
} from "@/domain/vault";
import { cn } from "@/lib/utils";
import type { VaultRow, VaultState } from "@/server/vault/queries";

/** Minutos de inactividad tras los que la bóveda se cierra sola. */
const AUTO_LOCK_MINUTES = 15;
const NO_CLIENT = "__none__";

type Props = {
  slug: string;
  state: VaultState;
  rows: VaultRow[];
  clients: { id: string; name: string }[];
};

/**
 * Contraseñas del equipo. Todo se cifra y descifra aquí, en el navegador: la contraseña maestra no
 * sale nunca y el servidor solo guarda texto cifrado.
 */
export function VaultView({ slug, state, rows, clients }: Props) {
  const t = useTranslations("passwords");
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ entry: VaultEntry | null } | null>(null);

  const lock = useCallback(() => {
    setVaultKey(null);
    setEntries([]);
  }, []);

  // Se cierra sola tras un rato sin tocarla: una pantalla abierta no es una bóveda abierta.
  useEffect(() => {
    if (!vaultKey) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lock();
        toast.info(t("autoLocked", { minutes: AUTO_LOCK_MINUTES }));
      }, AUTO_LOCK_MINUTES * 60_000);
    };
    arm();
    const events = ["pointerdown", "keydown"] as const;
    for (const event of events) window.addEventListener(event, arm);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, arm);
    };
  }, [vaultKey, lock, t]);

  const openWith = useCallback(
    async (key: CryptoKey) => {
      const opened: VaultEntry[] = [];
      for (const row of rows) {
        try {
          opened.push({ id: row.id, clientId: row.clientId, updatedAt: row.updatedAt, secret: readVaultSecret(await decryptWithKey(key, row.ciphertext)) });
        } catch {
          // Un secreto que no se abre (de otra bóveda, corrupto) no tumba la lista.
          opened.push({ id: row.id, clientId: row.clientId, updatedAt: row.updatedAt, secret: { ...EMPTY_SECRET, name: t("unreadable") } });
        }
      }
      setVaultKey(key);
      setEntries(opened);
    },
    [rows, t],
  );

  const visible = useMemo(() => entries.filter((entry) => matchesQuery(entry.secret, query)), [entries, query]);
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? "") : t("ours"));

  if (!state.settings) return <CreateTeamPassword slug={slug} />;
  if (!vaultKey) return <Unlock settings={state.settings} onOpen={openWith} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="pl-9" />
        </div>
        <Button onClick={() => setEditing({ entry: null })}>
          <Plus data-icon="inline-start" />
          {t("new")}
        </Button>
        <Button variant="outline" onClick={lock}>
          <Lock data-icon="inline-start" />
          {t("lock")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <SettingsCard>
          <p className="py-8 text-center text-sm text-muted-foreground">{entries.length === 0 ? t("empty") : t("noMatches")}</p>
        </SettingsCard>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((entry) => (
            <EntryCard key={entry.id} entry={entry} clientName={clientName(entry.clientId)} onEdit={() => setEditing({ entry })} />
          ))}
        </ul>
      )}

      <ChangePasswordPanel slug={slug} entries={entries} rotated={state.rotated} onChanged={setVaultKey} />

      {editing && (
        <SecretSheet
          slug={slug}
          vaultKey={vaultKey}
          entry={editing.entry}
          clients={clients}
          open
          onClose={(saved) => {
            setEditing(null);
            if (saved) toast.success(t("saved"));
          }}
        />
      )}
    </div>
  );
}


/** Botón que, al pulsarlo, enseña la confirmación en línea del resto de la app (nunca un modal). */
function ConfirmButton({
  label,
  description,
  confirmLabel,
  tone = "default",
  icon,
  pending,
  onConfirm,
}: {
  label: string;
  description: string;
  confirmLabel?: string;
  tone?: "default" | "destructive";
  icon?: ReactNode;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" className={tone === "destructive" ? "text-destructive" : undefined} disabled={pending} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <InlineConfirm
      tone={tone === "destructive" ? "destructive" : "default"}
      confirmLabel={confirmLabel ?? label}
      pending={pending}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        onConfirm();
      }}
    >
      {description}
    </InlineConfirm>
  );
}

// --- primera vez ---------------------------------------------------------------------------------

/** Campo de contraseña con el medidor y la repetición: igual al crearla que al cambiarla. */
function PasswordPair({
  idPrefix,
  label,
  hint,
  password,
  repeat,
  onPassword,
  onRepeat,
}: {
  idPrefix: string;
  label: string;
  hint?: string;
  password: string;
  repeat: string;
  onPassword: (value: string) => void;
  onRepeat: (value: string) => void;
}) {
  const t = useTranslations("passwords.setup");
  return (
    <>
      <FormField id={idPrefix} label={label} description={hint}>
        <Input id={idPrefix} type="password" autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} />
      </FormField>
      <StrengthBar score={passwordStrength(password)} />
      <FormField id={`${idPrefix}-repeat`} label={t("repeat")} error={repeat.length > 0 && repeat !== password ? t("mismatch") : undefined}>
        <Input id={`${idPrefix}-repeat`} type="password" autoComplete="new-password" value={repeat} onChange={(e) => onRepeat(e.target.value)} />
      </FormField>
    </>
  );
}

/** La bóveda aún no existe: el primero que entra elige la contraseña que usará todo el equipo. */
function CreateTeamPassword({ slug }: { slug: string }) {
  const t = useTranslations("passwords.setup");
  const tCommon = useTranslations("common");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = password.length >= 12 && password === repeat;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const { settings } = await createVaultSettings(password);
      const result = await createVault(slug, {
        kdf_salt: settings.kdfSalt,
        kdf_iterations: settings.kdfIterations,
        verifier: settings.verifier,
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("created"));
    });
  };

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <PasswordPair idPrefix="team-password" label={t("password")} hint={t("passwordHint")} password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
        <p className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs">{t("warning")}</p>
        <div>
          <Button type="submit" disabled={pending || !ready}>
            {pending ? tCommon("saving") : t("submit")}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

// --- desbloqueo ----------------------------------------------------------------------------------

function Unlock({ settings, onOpen }: { settings: NonNullable<VaultState["settings"]>; onOpen: (key: CryptoKey) => Promise<void> }) {
  const t = useTranslations("passwords.unlock");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await onOpen(await openVault(password, settings));
        setPassword("");
      } catch (err) {
        setError(err instanceof VaultCryptoError && err.code === "wrong_password" ? t("wrong") : t("failed"));
      }
    });
  };

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <FormField id="unlock" label={t("password")} error={error ?? undefined}>
          <Input id="unlock" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <div>
          <Button type="submit" disabled={pending || !password}>
            <LockOpen data-icon="inline-start" />
            {pending ? t("opening") : t("submit")}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

// --- lista ---------------------------------------------------------------------------------------

function EntryCard({ entry, clientName, onEdit }: { entry: VaultEntry; clientName: string; onEdit: () => void }) {
  const t = useTranslations("passwords");
  const [shown, setShown] = useState(false);
  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{entry.secret.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {clientName}
            {entry.secret.username && ` · ${entry.secret.username}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t("edit")}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1.5 text-sm">
          {shown ? entry.secret.password || "—" : "••••••••••••"}
        </code>
        <Button variant="ghost" size="icon-sm" aria-label={shown ? t("hide") : t("show")} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff /> : <Eye />}
        </Button>
        <CopyButton value={entry.secret.password} label={t("copyPassword")} />
        {entry.secret.username && <CopyButton value={entry.secret.username} label={t("copyUser")} icon="user" />}
      </div>
      {entry.secret.url && (
        <a href={entry.secret.url} target="_blank" rel="noreferrer noopener" className="mt-2 block truncate text-xs text-primary hover:underline">
          {entry.secret.url}
        </a>
      )}
    </li>
  );
}

/** Copia al portapapeles y lo borra a los 30 s, para no dejar la contraseña dando vueltas. */
function CopyButton({ value, label, icon }: { value: string; label: string; icon?: "user" }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!value) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setDone(false);
          navigator.clipboard.writeText("").catch(() => {});
        }, 30_000);
      }}
    >
      {done ? <Check className="text-success" /> : icon === "user" ? <KeyRound /> : <Copy />}
    </Button>
  );
}

function StrengthBar({ score }: { score: number }) {
  const t = useTranslations("passwords.strength");
  const labels = ["veryWeak", "weak", "fair", "good", "strong"] as const;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("flex-1 rounded-full", i < score ? (score >= 3 ? "bg-success" : "bg-warning") : "bg-muted")} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{t(labels[score] ?? "veryWeak")}</span>
    </div>
  );
}

// --- ficha de un secreto --------------------------------------------------------------------------

function SecretSheet({
  slug,
  vaultKey,
  entry,
  clients,
  open,
  onClose,
}: {
  slug: string;
  vaultKey: CryptoKey;
  entry: VaultEntry | null;
  clients: { id: string; name: string }[];
  open: boolean;
  onClose: (saved: boolean) => void;
}) {
  const t = useTranslations("passwords.sheet");
  const tCommon = useTranslations("common");
  const [secret, setSecret] = useState<VaultSecret>(entry?.secret ?? EMPTY_SECRET);
  const [clientId, setClientId] = useState(entry?.clientId ?? "");
  const [pending, startTransition] = useTransition();
  const set = (key: keyof VaultSecret) => (event: { target: { value: string } }) => setSecret((s) => ({ ...s, [key]: event.target.value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const ciphertext = await encryptWithKey(vaultKey, JSON.stringify(secret));
      const result = await saveVaultItem(slug, entry?.id ?? null, { ciphertext, client_id: clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onClose(true);
    });
  };

  return (
    <SettingsSheet open={open} onOpenChange={(value) => !value && onClose(false)} title={entry ? t("editTitle") : t("createTitle")} description={t("description")}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            {entry && (
              <ConfirmButton
                label={t("archive")}
                description={t("archiveConfirm")}
                tone="destructive"
                pending={pending}
                icon={<Trash2 data-icon="inline-start" />}
                onConfirm={() =>
                  startTransition(async () => {
                    const result = await archiveVaultItem(slug, entry.id);
                    if (!result.ok) toast.error(result.error);
                    else onClose(true);
                  })
                }
              />
            )}
            <Button type="button" variant="ghost" onClick={() => onClose(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !secret.name.trim()}>
              {pending ? tCommon("saving") : tCommon("save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField id="secret-name" label={t("name")}>
            <Input id="secret-name" maxLength={200} autoFocus value={secret.name} onChange={set("name")} />
          </FormField>
          <FormField id="secret-client" label={t("client")} optional>
            <Select value={clientId || NO_CLIENT} onValueChange={(value) => setClientId(value === NO_CLIENT ? "" : value)}>
              <SelectTrigger id="secret-client" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>{t("ours")}</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="secret-user" label={t("username")} optional>
            <Input id="secret-user" maxLength={200} autoComplete="off" value={secret.username} onChange={set("username")} />
          </FormField>
          <FormField id="secret-password" label={t("password")} optional>
            <div className="flex gap-2">
              <Input id="secret-password" maxLength={1000} autoComplete="off" value={secret.password} onChange={set("password")} />
              <Button type="button" variant="outline" size="icon" aria-label={t("generate")} title={t("generate")} onClick={() => setSecret((s) => ({ ...s, password: generatePassword() }))}>
                <RefreshCw />
              </Button>
            </div>
          </FormField>
          <StrengthBar score={passwordStrength(secret.password)} />
          <FormField id="secret-url" label={t("url")} optional>
            <Input id="secret-url" maxLength={500} inputMode="url" value={secret.url} onChange={set("url")} />
          </FormField>
          <FormField id="secret-totp" label={t("totp")} description={t("totpHint")} optional>
            <Input id="secret-totp" maxLength={200} autoComplete="off" value={secret.totp} onChange={set("totp")} />
          </FormField>
          <FormField id="secret-notes" label={t("notes")} optional>
            <Textarea id="secret-notes" rows={4} maxLength={10_000} value={secret.notes} onChange={set("notes")} />
          </FormField>
        </div>
      </SheetForm>
    </SettingsSheet>
  );
}

// --- cambiar la contraseña del equipo ---------------------------------------------------------------

/**
 * Cambiar la contraseña: se vuelven a cifrar aquí todos los secretos con la nueva (es el único sitio
 * donde están en claro) y se guardan con los parámetros nuevos. Hay que hacerlo cuando alguien deja
 * el equipo: lo que ya vio no se puede borrar de su cabeza, pero deja de poder entrar.
 */
function ChangePasswordPanel({
  slug,
  entries,
  rotated,
  onChanged,
}: {
  slug: string;
  entries: VaultEntry[];
  rotated: VaultState["rotated"];
  onChanged: (key: CryptoKey) => void;
}) {
  const t = useTranslations("passwords.change");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = password.length >= 12 && password === repeat;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const { settings, key } = await createVaultSettings(password);
      // Todo lo guardado, vuelto a cifrar con la contraseña nueva antes de tocar nada.
      const items = await Promise.all(
        entries.map(async (entry) => ({ id: entry.id, ciphertext: await encryptWithKey(key, JSON.stringify(entry.secret)) })),
      );
      const result = await rotateVaultPassword(
        slug,
        { kdf_salt: settings.kdfSalt, kdf_iterations: settings.kdfIterations, verifier: settings.verifier },
        items,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged(key);
      setPassword("");
      setRepeat("");
      setOpen(false);
      toast.success(t("changed"));
    });
  };

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      actions={
        !open ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <KeyRound data-icon="inline-start" />
            {t("action")}
          </Button>
        ) : undefined
      }
    >
      {open ? (
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <PasswordPair idPrefix="new-team-password" label={t("newPassword")} hint={t("newPasswordHint", { count: entries.length })} password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !ready}>
              {pending ? t("changing") : t("action")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {rotated ? t("lastChange", { date: format.dateTime(new Date(rotated.at), { dateStyle: "long" }), who: rotated.by ?? t("someone") }) : t("never")}
        </p>
      )}
    </SettingsCard>
  );
}
