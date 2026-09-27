"use client";

import { Check, CheckCheck, EyeOff, Loader2, PartyPopper, Search, Upload, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmAllBankSuggestions, ignoreBankMovements, undoBankMatches, unignoreBankMovements } from "@/app/[org]/finance/bank/actions";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { useFinanceFormat } from "@/components/finance/format";
import type { FinanceConfig } from "@/components/finance/types";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Suggestion } from "@/domain/banking/matcher";
import { cn } from "@/lib/utils";
import { Amount, ConfidenceDot, StatusBadge, useBankCodeLabel, useReasonText, useSuggestionLabel } from "./labels";
import { NoAccounts, NoStatements, RulesPanel, StatementsPanel } from "./panels";
import { StatementImport } from "./statement-import";
import { type SheetTab, TransactionSheet, useConfirmSuggestion } from "./transaction-sheet";
import { BANK_STATUS_FILTERS, type BankFilters, type BankPageData, type BankTransactionItem, type IgnoreReason, IGNORE_REASONS } from "./types";

const ALL = "all";
const SEARCH_DEBOUNCE_MS = 250;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';
/** Motivos que se pueden elegir sin escribir nada (el resto se ignora desde el panel). */
const QUICK_IGNORE: readonly IgnoreReason[] = IGNORE_REASONS.filter((r) => r !== "other");

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

function filtersQuery(filters: BankFilters): string {
  const params = new URLSearchParams();
  if (filters.account) params.set("account", filters.account);
  if (filters.status !== "pending") params.set("status", filters.status);
  if (filters.month) params.set("month", filters.month);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

const isPendingItem = (tx: BankTransactionItem) => tx.status === "unmatched" || tx.status === "partial";

type Props = {
  slug: string;
  data: BankPageData;
  config: FinanceConfig;
  filters: BankFilters;
  /** Socio u owner: importa extractos y concilia. */
  canEdit: boolean;
  today: string;
};

/**
 * Banco: la cuenta, sus cifras y sus movimientos con la propuesta de GNERAI OS para cada uno.
 * j/k para moverse, Enter para abrir, a para aceptar la propuesta, i para ignorar. El detalle, en
 * un panel lateral; la importación del extracto, en otro.
 */
export function BankView({ slug, data, config, filters, canEdit }: Props) {
  const t = useTranslations("banking");
  const { money, date, month: monthLabel } = useFinanceFormat();
  const router = useRouter();
  const pathname = usePathname();
  const { commandOpen, shortcutsOpen } = useShell();
  const confirm = useConfirmSuggestion(slug);
  const { account, transactions: rows } = data;

  const [query, setQuery] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    if (filters.q !== query.trim()) setQuery(filters.q);
  }
  const [active, setActive] = useState<{ id: string | null; index: number }>({ id: null, index: -1 });
  const [sheet, setSheet] = useState<{ id: string; tab: SheetTab } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [ignoreMenu, setIgnoreMenu] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
  const [bulk, startBulk] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  // La fila activa sigue siendo la misma aunque la lista cambie; si ha desaparecido (se ha
  // conciliado y el filtro es «por conciliar»), la que ahora ocupa su sitio.
  const byId = active.id ? rows.findIndex((r) => r.id === active.id) : -1;
  const activeIndex = byId !== -1 ? byId : rows.length > 0 && active.index >= 0 ? Math.min(active.index, rows.length - 1) : -1;
  const activeRow = activeIndex >= 0 ? rows[activeIndex]! : null;
  const sheetTx = sheet ? (rows.find((r) => r.id === sheet.id) ?? null) : null;

  useEffect(() => {
    const timer = searchTimer;
    return () => window.clearTimeout(timer.current);
  }, []);

  const navigate = (next: Partial<BankFilters>) => {
    const href = `${pathname}${filtersQuery({ ...filters, q: query, ...next })}`;
    startNavigation(() => router.replace(href, { scroll: false }));
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => navigate({ q: value }), SEARCH_DEBOUNCE_MS);
  };

  const select = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setActive({ id: row.id, index });
    document.getElementById(`bank-row-${row.id}`)?.scrollIntoView({ block: "nearest" });
  };
  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    select(activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1));
  };
  /** Después de decidir un movimiento, la siguiente fila queda activa. */
  const advanceFrom = (id: string) => {
    const index = rows.findIndex((r) => r.id === id);
    const next = rows[index + 1] ?? rows[index - 1];
    setActive({ id: next?.id ?? null, index: Math.max(0, index) });
  };

  const openSheet = (id: string, tab: SheetTab = "suggestions") => setSheet({ id, tab });

  const accept = async (tx: BankTransactionItem) => {
    const best = tx.suggestions[0];
    if (!best) return openSheet(tx.id, "search");
    // Un gasto nuevo se revisa antes de crearlo: el formulario ya viene relleno con la propuesta.
    if (best.kind === "new_expense") return openSheet(tx.id, "expense");
    setBusyRow(tx.id);
    const ok = await confirm(tx, best);
    setBusyRow(null);
    if (ok) advanceFrom(tx.id);
  };

  const quickIgnore = async (tx: BankTransactionItem, reason: IgnoreReason) => {
    setIgnoreMenu(null);
    setBusyRow(tx.id);
    const result = await ignoreBankMovements(slug, [tx.id], { reason, note: "" });
    setBusyRow(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(t("toasts.ignored"), {
      action: {
        label: t("toasts.undo"),
        onClick: () => void unignoreBankMovements(slug, [tx.id]).then((r) => (r.ok ? toast.success(t("toasts.undone")) : toast.error(r.error))),
      },
    });
    advanceFrom(tx.id);
  };

  const confirmAll = () =>
    startBulk(async () => {
      if (!account) return;
      const result = await confirmAllBankSuggestions(slug, account.id);
      if (!result.ok) return void toast.error(result.error);
      const message = t("bulk.done", { applied: result.applied });
      const undo = () =>
        void Promise.all([
          result.matchIds.length ? undoBankMatches(slug, result.matchIds) : Promise.resolve({ ok: true as const }),
          result.ignoredIds.length ? unignoreBankMovements(slug, result.ignoredIds) : Promise.resolve({ ok: true as const }),
        ]).then(([a, b]) => (a.ok && b.ok ? toast.success(t("toasts.undone")) : toast.error(!a.ok ? a.error : !b.ok ? b.error : "")));
      const options = result.applied > 0 ? { action: { label: t("toasts.undo"), onClick: undo } } : undefined;
      if (result.failed > 0) toast.warning(`${message} · ${t("bulk.failed", { failed: result.failed })}`, options);
      else toast.success(message, options);
    });

  const listIsFocused = (event: KeyboardEvent) =>
    sheet === null && !importOpen && !commandOpen && !shortcutsOpen && ignoreMenu === null && !closest(event.target, OVERLAY);

  useHotkeys({
    j: (event) => {
      if (!listIsFocused(event)) return;
      event.preventDefault();
      move(1);
    },
    k: (event) => {
      if (!listIsFocused(event)) return;
      event.preventDefault();
      move(-1);
    },
    Enter: (event) => {
      if (!listIsFocused(event) || closest(event.target, INTERACTIVE) || !activeRow) return;
      event.preventDefault();
      openSheet(activeRow.id);
    },
    a: (event) => {
      if (!canEdit || !listIsFocused(event) || !activeRow || !isPendingItem(activeRow) || busyRow) return;
      event.preventDefault();
      void accept(activeRow);
    },
    i: (event) => {
      if (!canEdit || !listIsFocused(event) || !activeRow || !isPendingItem(activeRow)) return;
      event.preventDefault();
      setIgnoreMenu(activeRow.id);
    },
  });

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = activeRow ?? rows[0];
      if (target) openSheet(target.id);
    } else if (event.key === "Escape") {
      if (query) onSearchChange("");
      else searchRef.current?.blur();
    }
  };

  const onRowClick = (event: MouseEvent<HTMLElement>, id: string) => {
    if (closest(event.target, "a, button, [role='menuitem']")) return;
    openSheet(id);
  };

  if (!account) {
    return (
      <div className="space-y-4">
        {!canEdit && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}
        <NoAccounts slug={slug} />
      </div>
    );
  }

  const hasHistory = data.statements.length > 0 || data.months.length > 0;
  const filtering = Boolean(filters.month || filters.q || filters.status !== "pending");
  const kpis = data.kpis;

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label={t("accounts.label")} className="-mx-4 min-w-0 flex-1 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex min-w-max gap-1 rounded-full border bg-card/60 p-1">
            {data.accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate({ account: a.id, month: "", q: "" })}
                aria-current={a.id === account.id ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  a.id === account.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="max-w-56 truncate">{a.name}</span>
                {a.pendingCount > 0 && (
                  <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-bold text-warning tabular" aria-label={t("accounts.pending", { count: a.pendingCount })}>
                    {a.pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
        {canEdit && (
          <Button onClick={() => setImportOpen(true)}>
            <Upload data-icon="inline-start" />
            {t("upload.button")}
          </Button>
        )}
      </div>

      {!hasHistory ? (
        <NoStatements canEdit={canEdit} onUpload={() => setImportOpen(true)} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3" aria-label={t("kpi.label")} role="group">
            <Stat
              label={t("kpi.pending")}
              value={kpis.pending.count === 0 ? t("kpi.pendingNone") : t("kpi.pendingValue", { count: kpis.pending.count })}
              hint={
                kpis.pending.count === 0
                  ? t("kpi.pendingNoneHint")
                  : t("kpi.pendingHint", { credits: money(kpis.pending.creditsCents), debits: money(kpis.pending.debitsCents) })
              }
              tone={kpis.pending.count > 0 ? "warning" : "success"}
              onClick={filters.status !== "pending" && kpis.pending.count > 0 ? () => navigate({ status: "pending", month: "" }) : undefined}
            />
            <Stat
              label={t("kpi.month")}
              value={t("kpi.monthValue", { explained: kpis.month.explained, total: kpis.month.total })}
              hint={
                <span className="flex items-center gap-2">
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-success"
                      style={{ width: `${kpis.month.total === 0 ? 0 : Math.round((kpis.month.explained / kpis.month.total) * 100)}%` }}
                    />
                  </span>
                  <span className="truncate capitalize">{monthLabel(`${kpis.month.month}-01`)}</span>
                </span>
              }
            />
            <Stat
              label={t("kpi.unexplained")}
              value={money(kpis.unexplainedNetCents)}
              tone={kpis.unexplainedNetCents === 0 ? "success" : undefined}
              hint={
                account.balanceCents !== null && account.balanceOn
                  ? t("kpi.unexplainedHint", { amount: money(account.balanceCents), date: date(account.balanceOn) })
                  : t("kpi.unexplainedNoBalance")
              }
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border bg-card/60 p-0.5" role="group" aria-label={t("filters.statusLabel")}>
              {BANK_STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => navigate({ status: s })}
                  aria-pressed={filters.status === s}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    filters.status === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`filters.${s}`)}
                  {s === "pending" && account.pendingCount > 0 && <span className="ml-1 tabular">{account.pendingCount}</span>}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t("filters.searchPlaceholder")}
                aria-label={t("filters.searchLabel")}
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <Button variant="ghost" size="icon-xs" className="absolute top-1/2 right-1 -translate-y-1/2" aria-label={t("filters.clearSearch")} onClick={() => onSearchChange("")}>
                  <X />
                </Button>
              )}
            </div>

            <Select value={filters.month || ALL} onValueChange={(v) => navigate({ month: v === ALL ? "" : v })}>
              <SelectTrigger size="sm" className="w-44" aria-label={t("filters.monthLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.monthAll")}</SelectItem>
                {[...new Set([...(filters.month ? [filters.month] : []), ...data.months])].map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="capitalize">{monthLabel(`${m}-01`)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filtering && (
              <Button variant="ghost" size="sm" onClick={() => navigate({ status: "pending", month: "", q: "" })}>
                {t("filters.clear")}
              </Button>
            )}

            <div className="ml-auto flex items-center gap-3">
              <p className="text-xs text-muted-foreground tabular">{t("list.count", { count: rows.length })}</p>
              {canEdit && kpis.highCount > 0 && (
                <Button onClick={confirmAll} disabled={bulk}>
                  {bulk ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <CheckCheck data-icon="inline-start" />}
                  {t("bulk.button", { count: kpis.highCount })}
                </Button>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            filters.status === "pending" && !filters.q && !filters.month ? (
              <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
                <PartyPopper className="mx-auto size-5 text-success" />
                <p className="mt-3 font-semibold">{t("empty.allDone.title")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("empty.allDone.body")}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
                <Search className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 font-semibold">{t("empty.filtered.title")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("empty.filtered.body")}</p>
              </div>
            )
          ) : (
            <div className={cn("overflow-hidden rounded-2xl border bg-card transition-opacity", navigating && "opacity-60")}>
              <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_8rem_7rem_minmax(0,22rem)_2.5rem] gap-3 border-b px-5 py-2 text-xs text-muted-foreground lg:grid">
                <span>{t("list.columns.date")}</span>
                <span>{t("list.columns.concept")}</span>
                <span className="text-right">{t("list.columns.amount")}</span>
                <span>{t("list.columns.status")}</span>
                <span>{t("list.columns.suggestion")}</span>
                <span className="sr-only">{t("list.columns.actions")}</span>
              </div>
              <ul role="list">
                {rows.map((tx, index) => (
                  <Row
                    key={tx.id}
                    tx={tx}
                    active={index === activeIndex}
                    busy={busyRow === tx.id}
                    canEdit={canEdit}
                    ignoreOpen={ignoreMenu === tx.id}
                    onIgnoreOpenChange={(open) => setIgnoreMenu(open ? tx.id : null)}
                    onHover={() => index !== activeIndex && setActive({ id: tx.id, index })}
                    onClick={(e) => onRowClick(e, tx.id)}
                    onAccept={() => void accept(tx)}
                    onIgnore={(reason) => void quickIgnore(tx, reason)}
                    onIgnoreOther={() => {
                      setIgnoreMenu(null);
                      openSheet(tx.id, "ignore");
                    }}
                  />
                ))}
              </ul>
            </div>
          )}

          {data.truncated && <p className="mt-3 text-xs text-muted-foreground">{t("list.truncated", { count: rows.length })}</p>}
          {rows.length > 0 && (
            <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              {t.rich(canEdit ? "list.keyboardHint" : "list.keyboardHintReadOnly", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
            </p>
          )}

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <StatementsPanel slug={slug} statements={data.statements} canEdit={canEdit} />
            <RulesPanel slug={slug} rules={data.rules} canEdit={canEdit} />
          </div>
        </>
      )}

      <TransactionSheet
        slug={slug}
        tx={sheetTx}
        account={account}
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
        canEdit={canEdit}
        config={config}
        tab={sheet?.tab ?? "suggestions"}
        onTabChange={(tab) => setSheet((s) => (s ? { ...s, tab } : s))}
        onDone={() => {
          if (sheet) advanceFrom(sheet.id);
          setSheet(null);
        }}
      />
      {canEdit && (
        <StatementImport
          slug={slug}
          account={account}
          accounts={data.accounts}
          open={importOpen}
          onOpenChange={setImportOpen}
          onSwitchAccount={(id) => {
            setImportOpen(false);
            navigate({ account: id, month: "", q: "" });
          }}
        />
      )}
    </div>
  );
}

function Row({
  tx,
  active,
  busy,
  canEdit,
  ignoreOpen,
  onIgnoreOpenChange,
  onHover,
  onClick,
  onAccept,
  onIgnore,
  onIgnoreOther,
}: {
  tx: BankTransactionItem;
  active: boolean;
  busy: boolean;
  canEdit: boolean;
  ignoreOpen: boolean;
  onIgnoreOpenChange: (open: boolean) => void;
  onHover: () => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onAccept: () => void;
  onIgnore: (reason: IgnoreReason) => void;
  onIgnoreOther: () => void;
}) {
  const t = useTranslations("banking");
  const { date, money } = useFinanceFormat();
  const codeLabel = useBankCodeLabel();
  const pending = isPendingItem(tx);
  const best = tx.suggestions[0];
  const code = codeLabel(tx.bankCode);
  const secondary = [tx.counterparty, tx.reference, tx.concept ? code : null].filter(Boolean).join(" · ");
  return (
    <li
      id={`bank-row-${tx.id}`}
      data-active={active}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      onMouseMove={onHover}
      className="group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 last:border-b-0 data-[active=true]:bg-muted/60 lg:grid-cols-[6.5rem_minmax(0,1fr)_8rem_7rem_minmax(0,22rem)_2.5rem] lg:px-5"
    >
      <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100" />
      {/* En el móvil: concepto e importe; fecha, estado y acciones; la propuesta. En pantalla ancha, las columnas de la cabecera. */}
      <div className="order-1 min-w-0 lg:order-2">
        <p className="truncate text-sm font-semibold">{tx.concept || code || t("list.noConcept")}</p>
        {secondary && <p className="truncate text-xs text-muted-foreground">{secondary}</p>}
        {tx.status === "partial" && <p className="text-xs text-primary tabular">{t("list.remaining", { amount: money(tx.remainingCents) })}</p>}
      </div>
      <Amount cents={tx.amountCents} className="order-2 text-right text-sm lg:order-3" />
      <div className="order-3 flex min-w-0 items-center gap-2 lg:contents">
        <span className="text-xs text-muted-foreground tabular lg:order-1 lg:text-sm">{date(tx.bookedOn)}</span>
        <span className="lg:order-4">
          <StatusBadge status={tx.status} />
        </span>
      </div>
      <div className="order-4 flex justify-end lg:order-6">
        {canEdit && pending && (
          <DropdownMenu open={ignoreOpen} onOpenChange={onIgnoreOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("ignore.menuLabel")} title={t("ignore.menuLabel")}>
                <EyeOff />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>{t("ignore.menuLabel")}</DropdownMenuLabel>
              {QUICK_IGNORE.map((reason) => (
                <DropdownMenuItem key={reason} onSelect={() => onIgnore(reason)}>
                  {t(`ignore.reasons.${reason}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={onIgnoreOther}>{t("ignore.withNote")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="order-5 col-span-2 min-w-0 lg:col-span-1">
        {pending ? (
          best ? (
            <SuggestionChip suggestion={best} canEdit={canEdit} busy={busy} onAccept={onAccept} />
          ) : (
            <span className="text-xs text-muted-foreground">{t("list.noSuggestion")}</span>
          )
        ) : tx.status === "ignored" ? (
          <span className="truncate text-xs text-muted-foreground">{tx.ignoredReason ? t(`ignore.reasons.${tx.ignoredReason}`) : null}</span>
        ) : (
          <MatchesSummary tx={tx} />
        )}
      </div>
    </li>
  );
}

function MatchesSummary({ tx }: { tx: BankTransactionItem }) {
  const t = useTranslations("banking.match");
  const { date } = useFinanceFormat();
  const first = tx.matches[0];
  if (!first) return null;
  const label =
    first.kind === "payment"
      ? t("payment", { number: first.invoiceNumber ?? "—", client: first.clientName ?? "—" })
      : first.kind === "expense"
        ? t("expense", { vendor: first.vendorName ?? first.expenseDescription ?? "—" })
        : t("remittance", { date: first.remittanceCollectionOn ? date(first.remittanceCollectionOn) : "—" });
  return (
    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
      <Check className="size-3.5 shrink-0 text-success" />
      <span className="truncate">{label}</span>
      {tx.matches.length > 1 && <span className="shrink-0">{t("more", { count: tx.matches.length - 1 })}</span>}
    </p>
  );
}

function SuggestionChip({ suggestion, canEdit, busy, onAccept }: { suggestion: Suggestion; canEdit: boolean; busy: boolean; onAccept: () => void }) {
  const t = useTranslations("banking.list");
  const label = useSuggestionLabel();
  const reasonText = useReasonText();
  const l = label(suggestion);
  const chip: ReactNode = (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs">
      <ConfidenceDot confidence={suggestion.confidence} />
      <span className="shrink-0 text-muted-foreground">{l.kind}</span>
      <span className="truncate font-semibold">{l.subject}</span>
      {l.detail && <span className="hidden truncate text-muted-foreground xl:inline">· {l.detail}</span>}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0">{chip}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <ul className="space-y-0.5">
            {suggestion.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`}>· {reasonText(r)}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
      {canEdit && (
        <Button
          variant={suggestion.confidence === "alta" ? "default" : "outline"}
          size="icon-sm"
          className="shrink-0"
          aria-label={suggestion.kind === "new_expense" ? t("reviewDraft") : t("accept")}
          title={suggestion.kind === "new_expense" ? t("reviewDraft") : t("acceptHint")}
          onClick={onAccept}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  hint: ReactNode;
  tone?: "warning" | "success";
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-bold tabular heading-tight", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
    </>
  );
  const className = "block min-w-0 rounded-2xl border bg-card px-4 py-3.5 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(className, "transition-colors hover:bg-muted/40")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
