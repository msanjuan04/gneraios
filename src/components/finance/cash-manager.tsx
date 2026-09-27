"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { deleteCashBalance, saveCashAccount, saveCashBalance } from "@/app/[org]/finance/actions";
import {
  type CashAccountFormInput,
  cashAccountFormSchema,
  type CashBalanceFormInput,
  cashBalanceFormSchema,
} from "@/app/[org]/finance/schema";
import { Sparkline } from "@/components/dashboard/sparkline";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useFinanceFormat, useFinanceValidationMessage } from "./format";
import { MoneyInput } from "./inputs";
import type { CashAccountItem, IssuerOption } from "./types";

const HISTORY_SHOWN = 6;

/** "ES9121000418450200051332" → "ES91 2100 0418 4502 0005 1332". */
function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

type Sheet = { kind: "closed" } | { kind: "balance"; accountId: string | null } | { kind: "account"; account: CashAccountItem | null };

/**
 * Caja: las cuentas de cada emisor con su último saldo y su histórico. Los saldos se apuntan a
 * mano (o llegarán importados del banco); la caja de hoy y la previsión salen de aquí.
 */
export function CashManager({
  slug,
  accounts,
  issuers,
  canEdit,
  today,
}: {
  slug: string;
  accounts: CashAccountItem[];
  issuers: IssuerOption[];
  canEdit: boolean;
  today: string;
}) {
  const t = useTranslations("finance.cash");
  const { money, date, dateShort } = useFinanceFormat();
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const active = accounts.filter((a) => a.isActive);
  const total = active.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);

  const removeBalance = (id: string) =>
    startTransition(async () => {
      const result = await deleteCashBalance(slug, id);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("balanceDeleted"));
    });

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("total")}</p>
          <p className={cn("mt-1 text-3xl font-extrabold heading-tight tabular", total < 0 && "text-destructive")}>{money(total)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("totalHint", { count: active.length })}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSheet({ kind: "account", account: null })}>
              <Plus data-icon="inline-start" />
              {t("newAccount")}
            </Button>
            {accounts.some((a) => a.isActive) && (
              <Button onClick={() => setSheet({ kind: "balance", accountId: null })}>
                <Plus data-icon="inline-start" />
                {t("newBalance")}
              </Button>
            )}
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white">
            <Landmark className="size-5" />
          </div>
          <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          {canEdit && (
            <Button className="mt-6" onClick={() => setSheet({ kind: "account", account: null })}>
              <Plus data-icon="inline-start" />
              {t("newAccount")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((account) => {
            const history = [...account.balances].reverse();
            const open = expanded.has(account.id);
            const shown = open ? account.balances : account.balances.slice(0, HISTORY_SHOWN);
            return (
              <section key={account.id} className={cn("rounded-2xl border bg-card", !account.isActive && "opacity-70")}>
                <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 font-bold">
                      <span className="truncate">{account.name}</span>
                      {!account.isActive && <Badge variant="outline">{t("closed")}</Badge>}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {account.issuerName}
                      {account.iban && <span className="font-mono"> · {formatIban(account.iban)}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-2xl font-extrabold heading-tight tabular", (account.balanceCents ?? 0) < 0 && "text-destructive")}>
                      {account.balanceCents === null ? "—" : money(account.balanceCents)}
                    </p>
                    <p className="text-xs text-muted-foreground">{account.balanceOn ? t("asOf", { date: date(account.balanceOn) }) : t("noBalance")}</p>
                  </div>
                </header>
                <div className="px-5 py-4">
                  {history.length >= 2 && (
                    <Sparkline
                      className="mb-4"
                      label={t("history", { name: account.name })}
                      points={history.slice(-24).map((b) => ({ key: b.id, value: b.balanceCents, estimated: false, title: `${dateShort(b.balanceOn)}: ${money(b.balanceCents)}` }))}
                    />
                  )}
                  {account.balances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noBalances")}</p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {shown.map((b) => (
                        <li key={b.id} className="flex items-center gap-3 py-1.5">
                          <span className="w-24 shrink-0 text-muted-foreground tabular">{date(b.balanceOn)}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {b.source === "import" && <Badge variant="outline" className="mr-1.5">{t("imported")}</Badge>}
                            {b.note}
                          </span>
                          <span className={cn("font-semibold tabular", b.balanceCents < 0 && "text-destructive")}>{money(b.balanceCents)}</span>
                          {canEdit && (
                            <Button variant="ghost" size="icon-xs" aria-label={t("deleteBalance")} onClick={() => removeBalance(b.id)} disabled={pending}>
                              <Trash2 />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {account.balances.length > HISTORY_SHOWN && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(account.id)) next.delete(account.id);
                            else next.add(account.id);
                            return next;
                          })
                        }
                      >
                        {open ? t("showLess") : t("showAll", { count: account.balances.length })}
                      </Button>
                    )}
                    {canEdit && (
                      <div className="ml-auto flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSheet({ kind: "account", account })}>
                          <Pencil data-icon="inline-start" />
                          {t("editAccount")}
                        </Button>
                        {account.isActive && (
                          <Button variant="outline" size="sm" onClick={() => setSheet({ kind: "balance", accountId: account.id })}>
                            <Plus data-icon="inline-start" />
                            {t("addBalance")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("footnote")}</p>

      <SettingsSheet
        open={sheet.kind === "balance"}
        onOpenChange={(open) => !open && setSheet({ kind: "closed" })}
        title={t("balanceTitle")}
        description={t("balanceDescription")}
      >
        {sheet.kind === "balance" && (
          <BalanceForm slug={slug} accounts={active} accountId={sheet.accountId} today={today} onDone={() => setSheet({ kind: "closed" })} />
        )}
      </SettingsSheet>
      <SettingsSheet
        open={sheet.kind === "account"}
        onOpenChange={(open) => !open && setSheet({ kind: "closed" })}
        title={sheet.kind === "account" && sheet.account ? t("editAccountTitle") : t("newAccountTitle")}
        description={t("accountDescription")}
      >
        {sheet.kind === "account" && <AccountForm slug={slug} account={sheet.account} issuers={issuers} onDone={() => setSheet({ kind: "closed" })} />}
      </SettingsSheet>
    </div>
  );
}

function BalanceForm({
  slug,
  accounts,
  accountId,
  today,
  onDone,
}: {
  slug: string;
  accounts: CashAccountItem[];
  accountId: string | null;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("finance.cash");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const form = useForm<CashBalanceFormInput>({
    resolver: zodResolver(cashBalanceFormSchema),
    defaultValues: { account_id: accountId ?? accounts[0]?.id ?? "", balance_on: today, balance: "", note: "" },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const submit = form.handleSubmit(async () => {
    const result = await saveCashBalance(slug, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("balanceSaved"));
    onDone();
  });
  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="account_id"
          render={({ field }) => (
            <FormField id="balance-account" label={t("account")} className="sm:col-span-2" error={message(errors.account_id?.message)}>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="balance-account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.issuerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="balance-on" label={t("balanceOn")} description={t("balanceOnHint")} error={message(errors.balance_on?.message)}>
          <Input id="balance-on" type="date" max={today} {...register("balance_on")} aria-invalid={Boolean(errors.balance_on)} />
        </FormField>
        <FormField id="balance-amount" label={t("balance")} description={t("balanceHint")} error={message(errors.balance?.message)}>
          <MoneyInput id="balance-amount" {...register("balance")} aria-invalid={Boolean(errors.balance)} autoFocus />
        </FormField>
        <FormField id="balance-note" label={t("note")} optional className="sm:col-span-2" error={message(errors.note?.message)}>
          <Input id="balance-note" {...register("note")} placeholder={t("notePlaceholder")} />
        </FormField>
      </div>
    </SheetForm>
  );
}

function AccountForm({ slug, account, issuers, onDone }: { slug: string; account: CashAccountItem | null; issuers: IssuerOption[]; onDone: () => void }) {
  const t = useTranslations("finance.cash");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const form = useForm<CashAccountFormInput>({
    resolver: zodResolver(cashAccountFormSchema),
    defaultValues: {
      issuer_id: account?.issuerId ?? issuers.find((i) => !i.archived && i.kind === "company")?.id ?? issuers[0]?.id ?? "",
      name: account?.name ?? "",
      iban: account?.iban ?? "",
      is_active: account?.isActive ?? true,
    },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const submit = form.handleSubmit(async () => {
    const result = await saveCashAccount(slug, account?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(account ? t("accountSaved") : t("accountCreated"));
    onDone();
  });
  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : account ? tCommon("save") : tCommon("create")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField id="account-name" label={t("accountName")} className="sm:col-span-2" error={message(errors.name?.message)}>
          <Input id="account-name" {...register("name")} placeholder={t("accountNamePlaceholder")} autoFocus aria-invalid={Boolean(errors.name)} />
        </FormField>
        <Controller
          control={control}
          name="issuer_id"
          render={({ field }) => (
            <FormField id="account-issuer" label={t("accountIssuer")} description={t("accountIssuerHint")} error={message(errors.issuer_id?.message)}>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger id="account-issuer" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {issuers
                    .filter((i) => !i.archived || i.id === field.value)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="account-iban" label={t("iban")} optional error={message(errors.iban?.message)}>
          <Input id="account-iban" {...register("iban")} className="font-mono uppercase" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.iban)} />
        </FormField>
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <ToggleField
              id="account-active"
              label={t("accountActive")}
              description={t("accountActiveHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              className="sm:col-span-2"
            />
          )}
        />
      </div>
    </SheetForm>
  );
}
