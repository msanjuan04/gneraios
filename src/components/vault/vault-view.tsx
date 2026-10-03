"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Lock, LockOpen, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveVaultItem, grantVaultAccess, registerVaultKeys, revokeVaultAccess, saveVaultItem } from "@/app/[org]/passwords/actions";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createMemberKeys,
  createVaultKey,
  decryptWithKey,
  EMPTY_SECRET,
  encryptWithKey,
  generatePassword,
  matchesQuery,
  passwordStrength,
  readVaultSecret,
  unlockPrivateKey,
  unwrapVaultKey,
  type VaultEntry,
  type VaultSecret,
  VaultCryptoError,
  wrapVaultKey,
} from "@/domain/vault";
import { cn } from "@/lib/utils";
import type { VaultMemberKey, VaultRow, VaultState } from "@/server/vault/queries";

/** Minutos de inactividad tras los que la bóveda se cierra sola. */
const AUTO_LOCK_MINUTES = 15;
const NO_CLIENT = "__none__";

type Props = {
  slug: string;
  state: VaultState;
  rows: VaultRow[];
  clients: { id: string; name: string }[];
  canManageAccess: boolean;
};

/**
 * Contraseñas del equipo. Todo se cifra y descifra aquí, en el navegador: la contraseña maestra no
 * sale nunca y el servidor solo guarda texto cifrado.
 */
export function VaultView({ slug, state, rows, clients, canManageAccess }: Props) {
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

  if (!state.myKeys) return <CreateMasterPassword slug={slug} first={!state.exists} />;
  if (!state.myWrappedKey) return <AwaitingAccess members={state.members} />;
  if (!vaultKey) return <Unlock keys={state.myKeys} wrappedKey={state.myWrappedKey} onOpen={openWith} />;

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

      {canManageAccess && <AccessPanel slug={slug} members={state.members} vaultKey={vaultKey} />}

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

function CreateMasterPassword({ slug, first }: { slug: string; first: boolean }) {
  const t = useTranslations("passwords.setup");
  const tCommon = useTranslations("common");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, startTransition] = useTransition();
  const strength = passwordStrength(password);
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = repeat.length > 0 && repeat !== password;

  const submit = () => {
    startTransition(async () => {
      const keys = await createMemberKeys(password);
      // El primero crea la bóveda y se queda con la llave; los demás esperan a que se la den.
      const wrapped = first ? await wrapVaultKey(await createVaultKey(), keys.publicKey) : undefined;
      const result = await registerVaultKeys(slug, {
        public_key: keys.publicKey,
        private_key_ciphertext: keys.privateKeyCiphertext,
        kdf_salt: keys.kdfSalt,
        kdf_iterations: keys.kdfIterations,
        wrapped_key: wrapped,
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(first ? t("createdVault") : t("createdKeys"));
    });
  };

  return (
    <SettingsCard title={t("title")} description={first ? t("descriptionFirst") : t("descriptionJoin")}>
      <div className="grid max-w-md gap-4">
        <FormField id="master" label={t("master")} description={t("masterHint")}>
          <Input id="master" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <StrengthBar score={strength} />
        <FormField id="master-repeat" label={t("repeat")} error={mismatch ? t("mismatch") : undefined}>
          <Input id="master-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </FormField>
        <p className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs">{t("warning")}</p>
        <div>
          <Button onClick={submit} disabled={pending || tooShort || password.length < 12 || password !== repeat}>
            {pending ? tCommon("saving") : t("submit")}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

function AwaitingAccess({ members }: { members: VaultMemberKey[] }) {
  const t = useTranslations("passwords.waiting");
  const holders = members.filter((member) => member.hasAccess);
  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <p className="text-sm text-muted-foreground">
        {holders.length > 0 ? t("askThem", { names: holders.map((h) => h.fullName).join(", ") }) : t("noHolders")}
      </p>
    </SettingsCard>
  );
}

// --- desbloqueo ----------------------------------------------------------------------------------

function Unlock({
  keys,
  wrappedKey,
  onOpen,
}: {
  keys: NonNullable<VaultState["myKeys"]>;
  wrappedKey: string;
  onOpen: (key: CryptoKey) => Promise<void>;
}) {
  const t = useTranslations("passwords.unlock");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const privateKey = await unlockPrivateKey(password, keys);
        await onOpen(await unwrapVaultKey(privateKey, wrappedKey));
        setPassword("");
      } catch (err) {
        setError(err instanceof VaultCryptoError && err.code === "wrong_password" ? t("wrong") : t("failed"));
      }
    });
  };

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <FormField id="unlock" label={t("master")} error={error ?? undefined}>
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

// --- quién tiene acceso -----------------------------------------------------------------------------

function AccessPanel({ slug, members, vaultKey }: { slug: string; members: VaultMemberKey[]; vaultKey: CryptoKey }) {
  const t = useTranslations("passwords.access");
  const [pending, startTransition] = useTransition();

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      <ul className="divide-y">
        {members.map((member) => (
          <li key={member.memberId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex items-center gap-2 text-sm">
              <span className="flex size-7 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: member.color ?? "var(--primary)" }}>
                {member.initials}
              </span>
              {member.fullName}
              {member.hasAccess && <ShieldCheck className="size-4 text-success" aria-label={t("hasAccess")} />}
            </span>
            {member.hasAccess ? (
              member.isMe ? (
                <span className="text-xs text-muted-foreground">{t("you")}</span>
              ) : (
                <ConfirmButton
                  label={t("revoke")}
                  description={t("revokeConfirm")}
                  tone="destructive"
                  pending={pending}
                  onConfirm={() =>
                    startTransition(async () => {
                      const result = await revokeVaultAccess(slug, member.memberId);
                      if (!result.ok) toast.error(result.error);
                      else toast.success(t("revoked"));
                    })
                  }
                />
              )
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    // El sobre se prepara aquí: la clave de la bóveda no sale del navegador.
                    const wrapped = await wrapVaultKey(vaultKey, member.publicKey);
                    const result = await grantVaultAccess(slug, member.memberId, wrapped);
                    if (!result.ok) toast.error(result.error);
                    else toast.success(t("granted", { name: member.fullName }));
                  })
                }
              >
                <UserPlus data-icon="inline-start" />
                {t("grant")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">{t("note")}</p>
    </SettingsCard>
  );
}
