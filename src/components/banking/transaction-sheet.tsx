"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Search, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  applyBankAllocations,
  confirmBankSuggestion,
  createBankExpense,
  ignoreBankMovements,
  searchBankTargets,
  undoBankMatches,
  unignoreBankMovements,
} from "@/app/[org]/finance/bank/actions";
import { IGNORE_REASON_VALUES } from "@/app/[org]/finance/bank/schema";
import {
  bpsToInput,
  centsToInput,
  expenseAmountsFromInput,
  type ExpenseFormInput,
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/app/[org]/finance/schema";
import { useFinanceFormat, useFinanceValidationMessage } from "@/components/finance/format";
import { MoneyInput, RateField, VendorPicker } from "@/components/finance/inputs";
import type { FinanceConfig } from "@/components/finance/types";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { baseFromTotal } from "@/domain/finance/expense";
import { EXPENSE_GROUPS } from "@/domain/finance";
import { parseMoneyInput } from "@/domain/money";
import type { ExpenseDraft, Suggestion } from "@/domain/banking/matcher";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";
import { Amount, ConfidenceDot, StatusBadge, useBankCodeLabel, useReasonText, useSuggestionLabel } from "./labels";
import type { BankAccountOption, BankMatchItem, BankTargetOption, BankTransactionItem, IgnoreReason } from "./types";

export type SheetTab = "suggestions" | "search" | "expense" | "ignore";

type Props = {
  slug: string;
  tx: BankTransactionItem | null;
  account: BankAccountOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  config: FinanceConfig;
  tab: SheetTab;
  onTabChange: (tab: SheetTab) => void;
  /** Tras conciliar, ignorar o crear un gasto: el panel se cierra y la lista pasa al siguiente. */
  onDone: () => void;
};

/** Panel lateral de un movimiento: lo que lo explica, las propuestas, buscar a mano, crear un gasto e ignorar. */
export function TransactionSheet({ open, onOpenChange, tx, ...props }: Props) {
  const t = useTranslations("banking.sheet");
  const tCommon = useTranslations("common");
  return (
    <Sheet open={open && tx !== null} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {tx && (
          <>
            <SheetHeader className="border-b px-5 py-4 pr-14">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base font-bold">
                <Amount cents={tx.amountCents} className="text-lg" />
                <StatusBadge status={tx.status} />
              </SheetTitle>
              <SheetDescription asChild>
                <div>
                  <TxHeader tx={tx} />
                </div>
              </SheetDescription>
            </SheetHeader>
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" className="absolute top-3.5 right-3.5" aria-label={tCommon("close")}>
                <XIcon />
              </Button>
            </SheetClose>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <SheetBody key={tx.id} tx={tx} {...props} />
            </div>
            <p className="sr-only">{t("title")}</p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TxHeader({ tx }: { tx: BankTransactionItem }) {
  const t = useTranslations("banking.sheet");
  const { date, money } = useFinanceFormat();
  const codeLabel = useBankCodeLabel();
  const code = codeLabel(tx.bankCode);
  return (
    <span className="mt-1 block space-y-1 text-sm">
      <span className="block text-muted-foreground tabular">
        {date(tx.bookedOn)}
        {tx.valueOn && tx.valueOn !== tx.bookedOn ? ` · ${t("valueOn", { date: date(tx.valueOn) })}` : ""}
        {code ? ` · ${code}` : ""}
      </span>
      <span className="block font-medium break-words text-foreground">{tx.concept || code || t("noConcept")}</span>
      {tx.counterparty && <span className="block text-muted-foreground">{t("counterparty", { name: tx.counterparty })}</span>}
      {tx.reference && <span className="block font-mono text-xs text-muted-foreground">{t("reference", { reference: tx.reference })}</span>}
      {tx.balanceAfterCents !== null && <span className="block text-xs text-muted-foreground">{t("balanceAfter", { amount: money(tx.balanceAfterCents) })}</span>}
      {tx.status === "partial" && <span className="block text-xs text-primary">{t("remaining", { amount: money(tx.remainingCents) })}</span>}
    </span>
  );
}

function SheetBody({ tx, slug, account, canEdit, config, tab, onTabChange, onDone }: Omit<Props, "open" | "onOpenChange" | "tx"> & { tx: BankTransactionItem }) {
  const t = useTranslations("banking.sheet");
  const pending = tx.status === "unmatched" || tx.status === "partial";
  const [draft, setDraft] = useState<ExpenseDraft | null>(() => tx.suggestions.find((s) => s.kind === "new_expense")?.draft ?? null);

  return (
    <div className="space-y-6">
      {tx.matches.length > 0 && <MatchesList slug={slug} matches={tx.matches} canEdit={canEdit} onDone={onDone} />}
      {tx.status === "ignored" && <IgnoredInfo slug={slug} tx={tx} canEdit={canEdit} onDone={onDone} />}
      {pending && !canEdit && <SuggestionsList slug={slug} tx={tx} canEdit={false} onDone={onDone} onReviewDraft={() => undefined} />}
      {pending && canEdit && (
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as SheetTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="suggestions">{t("tabs.suggestions", { count: tx.suggestions.length })}</TabsTrigger>
            <TabsTrigger value="search">{t("tabs.search")}</TabsTrigger>
            <TabsTrigger value="expense">{t("tabs.expense")}</TabsTrigger>
            <TabsTrigger value="ignore">{t("tabs.ignore")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suggestions" className="pt-3">
            <SuggestionsList
              slug={slug}
              tx={tx}
              canEdit
              onDone={onDone}
              onReviewDraft={(d) => {
                setDraft(d);
                onTabChange("expense");
              }}
            />
          </TabsContent>
          <TabsContent value="search" className="pt-3">
            <SearchPanel slug={slug} tx={tx} onDone={onDone} />
          </TabsContent>
          <TabsContent value="expense" className="pt-3">
            <ExpensePanel key={draft ? `${draft.purpose}:${draft.vendorId}:${draft.categoryId}` : "blank"} slug={slug} tx={tx} account={account} config={config} draft={draft} onDone={onDone} />
          </TabsContent>
          <TabsContent value="ignore" className="pt-3">
            <IgnorePanel slug={slug} tx={tx} onDone={onDone} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lo que ya lo explica
// ---------------------------------------------------------------------------

function MatchesList({ slug, matches, canEdit, onDone }: { slug: string; matches: BankMatchItem[]; canEdit: boolean; onDone: () => void }) {
  const t = useTranslations("banking.match");
  const { money, date } = useFinanceFormat();
  const [pending, start] = useTransition();
  const undo = (match: BankMatchItem) =>
    start(async () => {
      const result = await undoBankMatches(slug, [match.id]);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.remittanceKept ? t("undoneRemittance") : t("undone"));
      onDone();
    });
  return (
    <Section title={t("title")}>
      <ul className="divide-y overflow-hidden rounded-xl border">
        {matches.map((m) => (
          <li key={m.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {m.kind === "payment"
                  ? t("payment", { number: m.invoiceNumber ?? "—", client: m.clientName ?? "—" })
                  : m.kind === "expense"
                    ? t("expense", { vendor: m.vendorName ?? m.expenseDescription ?? "—" })
                    : t("remittance", { date: m.remittanceCollectionOn ? date(m.remittanceCollectionOn) : "—" })}
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  m.kind === "expense" ? m.categoryName : null,
                  m.createdPayment ? t("createdPayment") : null,
                  m.createdExpense ? t("createdExpense") : null,
                  m.markedPaid ? t("markedPaid") : null,
                  m.settledRemittance ? t("settledRemittance") : null,
                  m.createdByName ? t("by", { name: m.createdByName, date: date(m.createdAt.slice(0, 10)) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <span className="shrink-0 font-semibold tabular">{money(m.amountCents)}</span>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => undo(m)} disabled={pending} title={t("undoHint")}>
                <Undo2 data-icon="inline-start" />
                {t("undo")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function IgnoredInfo({ slug, tx, canEdit, onDone }: { slug: string; tx: BankTransactionItem; canEdit: boolean; onDone: () => void }) {
  const t = useTranslations("banking");
  const [pending, start] = useTransition();
  const restore = () =>
    start(async () => {
      const result = await unignoreBankMovements(slug, [tx.id]);
      if (!result.ok) return void toast.error(result.error);
      toast.success(t("toasts.unignored"));
      onDone();
    });
  return (
    <Section title={t("sheet.ignoredTitle")}>
      <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
        <p className="font-semibold">{tx.ignoredReason ? t(`ignore.reasons.${tx.ignoredReason}`) : "—"}</p>
        {tx.ignoredNote && <p className="mt-0.5 text-muted-foreground">{tx.ignoredNote}</p>}
        {canEdit && (
          <Button variant="outline" size="sm" className="mt-3" onClick={restore} disabled={pending}>
            <Undo2 data-icon="inline-start" />
            {t("sheet.unignore")}
          </Button>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Propuestas
// ---------------------------------------------------------------------------

export function useConfirmSuggestion(slug: string) {
  const t = useTranslations("banking");
  return async (tx: BankTransactionItem, suggestion: Suggestion): Promise<boolean> => {
    const result = await confirmBankSuggestion(slug, tx.id, suggestion.key);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    const undo = result.kind === "ignore" ? () => unignoreBankMovements(slug, [tx.id]) : () => undoBankMatches(slug, result.matchIds);
    toast.success(result.kind === "ignore" ? t("toasts.ignored") : t("toasts.confirmed"), {
      action: {
        label: t("toasts.undo"),
        onClick: () => {
          void undo().then((r) => (r.ok ? toast.success(t("toasts.undone")) : toast.error(r.error)));
        },
      },
    });
    return true;
  };
}

function SuggestionsList({
  slug,
  tx,
  canEdit,
  onDone,
  onReviewDraft,
}: {
  slug: string;
  tx: BankTransactionItem;
  canEdit: boolean;
  onDone: () => void;
  onReviewDraft: (draft: ExpenseDraft) => void;
}) {
  const t = useTranslations("banking.sheet");
  const reasonText = useReasonText();
  const label = useSuggestionLabel();
  const { money } = useFinanceFormat();
  const confirm = useConfirmSuggestion(slug);
  const [busy, setBusy] = useState<string | null>(null);

  if (tx.suggestions.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("noSuggestions")}</p>;
  }
  return (
    <ul className="space-y-2">
      {tx.suggestions.map((s, index) => {
        const l = label(s);
        return (
          <li key={s.key} className={cn("rounded-xl border px-3.5 py-3", index === 0 && "border-primary/40 bg-primary/5")}>
            <div className="flex items-start gap-3">
              <ConfidenceDot confidence={s.confidence} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="text-muted-foreground">{l.kind} · </span>
                  <span className="font-semibold">{l.subject}</span>
                  {l.detail && <span className="text-muted-foreground"> · {l.detail}</span>}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {s.reasons.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {reasonText(r)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {s.amountCents > 0 && s.kind !== "ignore" && <span className="text-sm font-semibold tabular">{money(s.amountCents)}</span>}
                {canEdit &&
                  (s.kind === "new_expense" ? (
                    <Button size="sm" variant="outline" onClick={() => s.draft && onReviewDraft(s.draft)}>
                      {t("reviewDraft")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={index === 0 ? "default" : "outline"}
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(s.key);
                        const ok = await confirm(tx, s);
                        setBusy(null);
                        if (ok) onDone();
                      }}
                    >
                      {busy === s.key ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                      {t("confirm")}
                    </Button>
                  ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Buscar a mano y repartir
// ---------------------------------------------------------------------------

type Picked = { option: BankTargetOption; amount: string };

function optionTitle(option: BankTargetOption, t: ReturnType<typeof useTranslations>, date: (d: string) => string) {
  switch (option.kind) {
    case "invoice":
      return { title: t("search.invoice", { number: option.number ?? "—" }), detail: option.clientName, when: t("search.due", { date: date(option.dueOn ?? option.issuedOn) }) };
    case "payment":
      return { title: t("search.payment", { number: option.invoiceNumber ?? "—" }), detail: option.clientName, when: t("search.paid", { date: date(option.paidOn) }) };
    case "expense":
      return {
        title: option.vendorName ?? option.description,
        detail: option.vendorName ? option.description : null,
        when: option.paidOn ? t("search.paid", { date: date(option.paidOn) }) : t("search.issued", { date: date(option.issuedOn) }),
      };
    case "remittance":
      return { title: t("search.remittance", { date: date(option.collectionOn) }), detail: t("search.items", { count: option.itemsCount }), when: null };
  }
}

function SearchPanel({ slug, tx, onDone }: { slug: string; tx: BankTransactionItem; onDone: () => void }) {
  const t = useTranslations("banking");
  const { money, date } = useFinanceFormat();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<BankTargetOption[] | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [learn, setLearn] = useState(true);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  const run = (q: string) =>
    startSearch(async () => {
      const result = await searchBankTargets(slug, tx.id, q);
      if (!result.ok) return void toast.error(result.error);
      setOptions(result.options);
    });

  useEffect(() => {
    run("");
    const current = timer;
    return () => window.clearTimeout(current.current);
    // Solo al abrir: después busca lo que se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assigned = picked.reduce((sum, p) => sum + (parseMoneyInput(p.amount) ?? 0), 0);
  const invalid = picked.some((p) => {
    const cents = parseMoneyInput(p.amount);
    return cents === null || cents <= 0 || cents > p.option.availableCents;
  });
  const tooMuch = assigned > tx.remainingCents;

  const toggle = (option: BankTargetOption, checked: boolean) => {
    if (!checked) return setPicked((list) => list.filter((p) => p.option.id !== option.id));
    const left = Math.max(0, tx.remainingCents - assigned);
    setPicked((list) => [...list, { option, amount: centsToInput(Math.min(left || option.availableCents, option.availableCents)) }]);
  };

  const apply = () =>
    startSave(async () => {
      const allocations = picked.map((p) => ({ kind: p.option.kind, id: p.option.id, amountCents: parseMoneyInput(p.amount) ?? 0 }));
      const result = await applyBankAllocations(slug, tx.id, allocations, learn);
      if (!result.ok) return void toast.error(result.error);
      toast.success(t("toasts.confirmed"), {
        action: {
          label: t("toasts.undo"),
          onClick: () => void undoBankMatches(slug, result.matchIds).then((r) => (r.ok ? toast.success(t("toasts.undone")) : toast.error(r.error))),
        },
      });
      onDone();
    });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => run(value), 250);
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="pl-8"
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("search.hint")}</p>
      {options === null || (searching && options.length === 0) ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("search.loading")}
        </p>
      ) : options.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("search.empty")}</p>
      ) : (
        <ul className={cn("divide-y overflow-hidden rounded-xl border", searching && "opacity-60")}>
          {options.map((option) => {
            const pick = picked.find((p) => p.option.id === option.id);
            const o = optionTitle(option, t, date);
            return (
              <li key={`${option.kind}:${option.id}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox checked={Boolean(pick)} onCheckedChange={(c) => toggle(option, c === true)} aria-label={o.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    <span className="text-muted-foreground">{t(`search.kinds.${option.kind}`)} · </span>
                    <span className="font-semibold">{o.title}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{[o.detail, o.when].filter(Boolean).join(" · ")}</p>
                </div>
                {pick ? (
                  <MoneyInput
                    className="w-28"
                    value={pick.amount}
                    onChange={(e) => setPicked((list) => list.map((p) => (p.option.id === option.id ? { ...p, amount: e.target.value } : p)))}
                    aria-label={t("search.amountLabel")}
                  />
                ) : (
                  <span className={cn("shrink-0 text-xs tabular", option.availableCents === tx.remainingCents ? "font-semibold text-success" : "text-muted-foreground")}>
                    {money(option.availableCents)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
          <p className={cn("text-sm tabular", tooMuch && "text-destructive")}>
            {tooMuch ? t("search.tooMuch") : t("search.total", { assigned: money(assigned), total: money(tx.remainingCents) })}
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={learn} onCheckedChange={(c) => setLearn(c === true)} />
              {t("sheet.learn")}
            </label>
            <Button size="sm" onClick={apply} disabled={saving || invalid || tooMuch || assigned === 0}>
              {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {t("search.apply", { amount: money(assigned) })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crear un gasto (el mismo formulario y la misma validación que Finanzas)
// ---------------------------------------------------------------------------

function useDraftDescription() {
  const t = useTranslations("banking.drafts");
  return (draft: ExpenseDraft | null, fallback: string): string => {
    if (!draft) return fallback;
    if (draft.description) return draft.description;
    if (draft.tax?.authority === "aeat") {
      const quarter = draft.tax.quarter ? draft.tax.quarter.replace(/^(\d{4})-Q(\d)$/, "$2T $1") : null;
      return draft.tax.model ? t("aeatModel", { model: draft.tax.model, quarter: quarter ?? "" }).trim() : t("aeat");
    }
    if (draft.tax?.authority === "tgss") return t("tgss");
    if (draft.purpose === "fee") return t("fee");
    return fallback;
  };
}

function defaults(tx: BankTransactionItem, account: BankAccountOption, config: FinanceConfig, draft: ExpenseDraft | null, description: string): ExpenseFormInput {
  const sign = tx.amountCents < 0 ? 1 : -1;
  const vatBps = draft?.vatBps ?? config.defaultVatBps;
  const irpfBps = draft?.irpfBps ?? 0;
  const base = draft?.baseCents ?? baseFromTotal(tx.remainingCents, vatBps, irpfBps);
  return {
    issuer_id: account.issuerId,
    vendor_id: draft?.vendorId ?? "",
    new_vendor_name: "",
    category_id: draft?.categoryId ?? "",
    description,
    vendor_invoice_number: "",
    issued_on: tx.bookedOn,
    due_on: "",
    base: base === null ? "" : centsToInput(sign * base),
    vat: bpsToInput(vatBps),
    vat_deductible: draft?.vatDeductible ?? true,
    irpf: irpfBps ? bpsToInput(irpfBps) : "",
    paid: true,
    paid_on: tx.bookedOn,
    payment_method: "",
    member_id: "",
    notes: "",
  };
}

function ExpensePanel({
  slug,
  tx,
  account,
  config,
  draft,
  onDone,
}: {
  slug: string;
  tx: BankTransactionItem;
  account: BankAccountOption;
  config: FinanceConfig;
  draft: ExpenseDraft | null;
  onDone: () => void;
}) {
  const t = useTranslations("banking");
  const tFinance = useTranslations("finance.expenseSheet");
  const tGroup = useTranslations("finance.groups");
  const message = useFinanceValidationMessage();
  const { money } = useFinanceFormat();
  const describe = useDraftDescription();
  const [learn, setLearn] = useState(true);
  const form = useForm<ExpenseFormInput, unknown, ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: defaults(tx, account, config, draft, describe(draft, tx.concept.slice(0, 200))),
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const [base, vat, irpf, newVendorName] = useWatch({ control, name: ["base", "vat", "irpf", "new_vendor_name"] });
  const amounts = expenseAmountsFromInput({ base: base ?? "", vat: vat ?? "", irpf: irpf ?? "" });
  const total = amounts ? Math.abs(amounts.totalCents) : null;
  const categories = config.categories.filter((c) => !c.archived);
  const grouped = EXPENSE_GROUPS.map((group) => ({ group, items: categories.filter((c) => c.expenseGroup === group) })).filter((g) => g.items.length > 0);

  const submit = form.handleSubmit(async () => {
    const result = await createBankExpense(slug, tx.id, getValues(), learn);
    if (!result.ok) return void toast.error(result.error);
    toast.success(t("toasts.expenseCreated"), {
      action: {
        label: t("toasts.undo"),
        onClick: () => void undoBankMatches(slug, [result.matchId]).then((r) => (r.ok ? toast.success(t("toasts.undone")) : toast.error(r.error))),
      },
    });
    onDone();
  });

  const field = (name: keyof ExpenseFormInput) => ({ id: `bank-expense-${name}`, error: message(errors[name]?.message) });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {draft && <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">{t("expense.fromDraft")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tFinance("vendor")} optional {...field("vendor_id")}>
          <Controller
            control={control}
            name="vendor_id"
            render={({ field: f }) => (
              <VendorPicker
                id="bank-expense-vendor_id"
                vendors={config.vendors}
                vendorId={f.value ?? ""}
                newVendorName={newVendorName ?? ""}
                onChange={({ vendorId, newVendorName: typed }) => {
                  f.onChange(vendorId);
                  setValue("new_vendor_name", typed, { shouldDirty: true });
                  const vendor = config.vendors.find((v) => v.id === vendorId);
                  if (vendor?.defaultCategoryId && !getValues("category_id")) setValue("category_id", vendor.defaultCategoryId, { shouldValidate: true });
                }}
              />
            )}
          />
        </FormField>
        <FormField label={tFinance("category")} {...field("category_id")}>
          <Controller
            control={control}
            name="category_id"
            render={({ field: f }) => (
              <Select value={f.value || undefined} onValueChange={f.onChange}>
                <SelectTrigger id="bank-expense-category_id" className="w-full" aria-invalid={Boolean(errors.category_id)}>
                  <SelectValue placeholder={tFinance("categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {grouped.map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{tGroup(g.group)}</SelectLabel>
                      {g.items.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>
      <FormField label={tFinance("concept")} {...field("description")}>
        <Input {...register("description")} id="bank-expense-description" aria-invalid={Boolean(errors.description)} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={tFinance("issuer")} {...field("issuer_id")}>
          <Controller
            control={control}
            name="issuer_id"
            render={({ field: f }) => (
              <Select value={f.value || undefined} onValueChange={f.onChange}>
                <SelectTrigger id="bank-expense-issuer_id" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.issuers
                    .filter((i) => !i.archived || i.id === f.value)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label={tFinance("issuedOn")} {...field("issued_on")}>
          <Input type="date" {...register("issued_on")} id="bank-expense-issued_on" />
        </FormField>
        <FormField label={tFinance("invoiceNumber")} optional {...field("vendor_invoice_number")}>
          <Input {...register("vendor_invoice_number")} id="bank-expense-vendor_invoice_number" />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={tFinance("base")} {...field("base")}>
          <MoneyInput {...register("base")} id="bank-expense-base" aria-invalid={Boolean(errors.base)} />
        </FormField>
        <FormField label={tFinance("vat")} {...field("vat")}>
          <Controller
            control={control}
            name="vat"
            render={({ field: f }) => (
              <RateField id="bank-expense-vat" rates={config.vatRates} value={f.value ?? ""} onChange={f.onChange} onPick={(v) => setValue("vat", v, { shouldValidate: true })} />
            )}
          />
        </FormField>
        <FormField label={tFinance("irpf")} optional {...field("irpf")}>
          <Controller
            control={control}
            name="irpf"
            render={({ field: f }) => (
              <RateField id="bank-expense-irpf" rates={config.irpfRates} value={f.value ?? ""} onChange={f.onChange} onPick={(v) => setValue("irpf", v, { shouldValidate: true })} />
            )}
          />
        </FormField>
      </div>
      <Controller
        control={control}
        name="vat_deductible"
        render={({ field: f }) => (
          <ToggleField id="bank-expense-deductible" label={tFinance("deductible")} description={tFinance("deductibleHint")} checked={f.value} onCheckedChange={f.onChange} />
        )}
      />
      <FormField label={tFinance("notes")} optional {...field("notes")}>
        <Textarea rows={2} {...register("notes")} id="bank-expense-notes" />
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
        <p className={cn("text-sm tabular", total !== null && total !== tx.remainingCents && "text-warning")}>
          {total === null
            ? t("expense.totalUnknown")
            : total === tx.remainingCents
              ? t("expense.totalMatches", { total: money(total) })
              : t("expense.totalMismatch", { total: money(total), amount: money(tx.remainingCents) })}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={learn} onCheckedChange={(c) => setLearn(c === true)} />
            {t("sheet.learn")}
          </label>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t("expense.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Ignorar
// ---------------------------------------------------------------------------

function IgnorePanel({ slug, tx, onDone }: { slug: string; tx: BankTransactionItem; onDone: () => void }) {
  const t = useTranslations("banking");
  const suggested = tx.suggestions.find((s) => s.kind === "ignore")?.ignoreReason ?? null;
  const [reason, setReason] = useState<IgnoreReason>(suggested ?? "internal_transfer");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const result = await ignoreBankMovements(slug, [tx.id], { reason, note });
      if (!result.ok) return void toast.error(result.error);
      toast.success(t("toasts.ignored"), {
        action: {
          label: t("toasts.undo"),
          onClick: () => void unignoreBankMovements(slug, [tx.id]).then((r) => (r.ok ? toast.success(t("toasts.undone")) : toast.error(r.error))),
        },
      });
      onDone();
    });
  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">{t("ignore.reasonLabel")}</legend>
        {IGNORE_REASON_VALUES.map((r) => (
          <label key={r} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm", reason === r && "border-primary/50 bg-primary/5")}>
            <input type="radio" name={`ignore-${tx.id}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-(--primary)" />
            <span className="flex-1">{t(`ignore.reasons.${r}`)}</span>
            {suggested === r && <span className="text-[11px] text-primary">{t("ignore.suggested")}</span>}
          </label>
        ))}
      </fieldset>
      <FormField id={`ignore-note-${tx.id}`} label={t("ignore.noteLabel")} optional={reason !== "other"}>
        <Textarea id={`ignore-note-${tx.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ignore.notePlaceholder")} maxLength={500} />
      </FormField>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending || (reason === "other" && !note.trim())}>
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {t("ignore.submit")}
        </Button>
      </div>
    </div>
  );
}
