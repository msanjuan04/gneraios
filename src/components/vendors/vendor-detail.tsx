"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  Globe,
  IdCard,
  Landmark,
  Mail,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  ReceiptEuro,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveVendor } from "@/app/[org]/finance/vendors/actions";
import { ExpenseStatusBadge, SubscriptionMark } from "@/components/finance/badges";
import { ExpenseSheet } from "@/components/finance/expense-sheet";
import type { ExpenseListItem } from "@/components/finance/types";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatIban } from "@/domain/tax-id";
import { phoneHref, summarizeAllocations, websiteLink } from "@/domain/vendors";
import { cn } from "@/lib/utils";
import { AllocationBreakdown } from "./allocation-breakdown";
import { useVendorFormat } from "./format";
import type { VendorDetailData } from "./types";
import { ALLOCATION_ICONS, VendorKindPill } from "./vendor-kind";
import { VendorSheet } from "./vendor-sheet";

type Props = { slug: string; basePath: string; data: VendorDetailData; canEdit: boolean };

type Sheet = { mode: "closed" } | { mode: "vendor" } | { mode: "createExpense" } | { mode: "expense"; id: string };

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * La ficha de un proveedor: quién es y cómo contactarle o pagarle, lo que nos cuesta (este año,
 * en total, lo pendiente y para cuántos clientes), para quién ha trabajado y sus últimos gastos.
 * «Registrar gasto» abre el panel del gasto con el proveedor ya elegido.
 */
export function VendorDetail({ slug, basePath, data, canEdit }: Props) {
  const t = useTranslations("vendors.detail");
  const router = useRouter();
  const fmt = useVendorFormat();
  const [sheet, setSheet] = useState<Sheet>({ mode: "closed" });
  const [pending, startTransition] = useTransition();
  const { vendor } = data;
  const allExpensesHref = `${basePath}/finance/expenses?vendor=${vendor.id}`;
  const total = summarizeAllocations(data.allocation, "total");

  const editingExpense = sheet.mode === "expense" ? (data.recentExpenses.find((e) => e.id === sheet.id) ?? null) : null;
  const expenseSheetOpen = sheet.mode === "createExpense" || editingExpense !== null;

  const setArchived = (next: boolean) =>
    startTransition(async () => {
      const result = await archiveVendor(slug, vendor.id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (next) toast.success(t("archivedToast", { name: vendor.name }), { action: { label: t("undo"), onClick: () => setArchived(false) } });
      else toast.success(t("restoredToast", { name: vendor.name }));
    });

  const copyIban = async (iban: string) => {
    try {
      await navigator.clipboard.writeText(iban);
      toast.success(t("ibanCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const website = vendor.website ? websiteLink(vendor.website) : null;
  const meta: { key: string; label: string; icon: ReactNode; content: ReactNode }[] = [];
  if (vendor.contactName) meta.push({ key: "contact", label: t("meta.contact"), icon: <UserRound className="size-3.5" />, content: vendor.contactName });
  if (vendor.email)
    meta.push({
      key: "email",
      label: t("meta.email"),
      icon: <Mail className="size-3.5" />,
      content: (
        <a href={`mailto:${vendor.email}`} className="hover:text-primary">
          {vendor.email}
        </a>
      ),
    });
  if (vendor.phone)
    meta.push({
      key: "phone",
      label: t("meta.phone"),
      icon: <Phone className="size-3.5" />,
      content: (
        <a href={phoneHref(vendor.phone)} className="tabular hover:text-primary">
          {vendor.phone}
        </a>
      ),
    });
  if (website)
    meta.push({
      key: "website",
      label: t("meta.website"),
      icon: <Globe className="size-3.5" />,
      content: (
        <a href={website.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
          {website.label}
          <ExternalLink aria-hidden className="size-3" />
        </a>
      ),
    });
  meta.push({
    key: "taxId",
    label: t("meta.taxId"),
    icon: <IdCard className="size-3.5" />,
    content: (
      <span>
        {vendor.taxId ? <span className="font-mono">{vendor.taxId}</span> : t("noTaxId")}
        <span className="text-muted-foreground/70"> · {vendor.countryCode}</span>
      </span>
    ),
  });
  if (vendor.iban) {
    const iban = vendor.iban;
    meta.push({
      key: "iban",
      label: t("meta.iban"),
      icon: <Landmark className="size-3.5" />,
      content: (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-[13px]">{formatIban(iban)}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t("copyIban")} onClick={() => copyIban(iban)}>
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("copyIban")}</TooltipContent>
          </Tooltip>
        </span>
      ),
    });
  }

  const clientsHint =
    vendor.expensesCount === 0
      ? t("stats.noExpenses")
      : vendor.clientsCount === 0
        ? t("stats.clientsNone")
        : t("stats.clientsHint", { share: fmt.share(total.clientShareBps) });

  return (
    <div>
      <Link
        href={`${basePath}/finance/vendors`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="min-w-0 text-2xl font-extrabold break-words heading-tight md:text-3xl">{vendor.name}</h3>
            <VendorKindPill kind={vendor.kind} className="h-6 px-2.5 text-xs" />
            {vendor.archived && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("archivedBadge")}
              </Badge>
            )}
          </div>
          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {meta.map((item) => (
              <div key={item.key} className="inline-flex min-w-0 items-center gap-1.5">
                <dt className="shrink-0" title={item.label}>
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                </dt>
                <dd className="min-w-0 truncate">{item.content}</dd>
              </div>
            ))}
          </dl>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {!vendor.archived && (
              <Button onClick={() => setSheet({ mode: "createExpense" })}>
                <Plus data-icon="inline-start" />
                {t("newExpense")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setSheet({ mode: "vendor" })}>
              <Pencil data-icon="inline-start" />
              {t("edit")}
            </Button>
            <Button variant={vendor.archived ? "outline" : "ghost"} onClick={() => setArchived(!vendor.archived)} disabled={pending}>
              {vendor.archived ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
              {vendor.archived ? t("restore") : t("archive")}
            </Button>
          </div>
        )}
      </header>
      {!canEdit && <ReadOnlyNotice className="-mt-2 mb-6">{t("readOnly")}</ReadOnlyNotice>}
      {canEdit && vendor.archived && <ReadOnlyNotice className="-mt-2 mb-6">{t("archivedHint")}</ReadOnlyNotice>}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("stats.year", { year: String(data.year) })}
          value={fmt.money(vendor.yearCostCents)}
          hint={t("stats.yearHint", { count: vendor.yearExpensesCount, year: String(data.year) })}
        />
        <Stat
          label={t("stats.total")}
          value={fmt.money(vendor.costCents)}
          hint={
            vendor.firstExpenseOn
              ? t("stats.totalHint", { count: vendor.expensesCount, date: fmt.dateMedium(vendor.firstExpenseOn) })
              : t("stats.noExpenses")
          }
        />
        <Stat
          label={t("stats.pending")}
          value={fmt.money(vendor.pendingCents)}
          hint={
            vendor.overdueCents > 0 ? (
              <span className="font-semibold text-destructive">{t("stats.overdueHint", { amount: fmt.money(vendor.overdueCents), count: vendor.overdueCount })}</span>
            ) : (
              t("stats.pendingHint", { count: vendor.pendingCount })
            )
          }
          tone={vendor.overdueCents > 0 ? "danger" : undefined}
        />
        <Stat label={t("stats.clients")} value={String(vendor.clientsCount)} hint={clientsHint} />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <AllocationBreakdown rows={data.allocation} basePath={basePath} className="min-w-0 lg:col-span-2" />

        <SettingsCard
          title={t("expenses.title")}
          description={vendor.expensesCount > 0 ? t("expenses.description", { count: vendor.expensesCount }) : undefined}
          className="min-w-0 lg:col-span-3"
          bodyClassName={data.recentExpenses.length > 0 ? "p-0" : undefined}
          actions={
            vendor.expensesCount > 0 ? (
              <Link
                href={allExpensesHref}
                className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
              >
                {t("expenses.all")}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : undefined
          }
        >
          {data.recentExpenses.length === 0 ? (
            <div className="py-4 text-center">
              <ReceiptEuro aria-hidden className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-muted-foreground">{t("expenses.empty")}</p>
              {canEdit && !vendor.archived && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setSheet({ mode: "createExpense" })}>
                  <Plus data-icon="inline-start" />
                  {t("expenses.emptyAction")}
                </Button>
              )}
            </div>
          ) : (
            <RecentExpenses
              rows={data.recentExpenses}
              basePath={basePath}
              fmt={fmt}
              onOpen={(id) => setSheet({ mode: "expense", id })}
              more={vendor.expensesCount > data.recentExpenses.length ? { href: allExpensesHref, count: vendor.expensesCount } : null}
            />
          )}
        </SettingsCard>
      </div>

      {vendor.notes && (
        <SettingsCard title={t("notes")} className="mt-6">
          <p className="whitespace-pre-line">{vendor.notes}</p>
        </SettingsCard>
      )}

      {canEdit && (
        <VendorSheet
          slug={slug}
          open={sheet.mode === "vendor"}
          onOpenChange={(open) => !open && setSheet({ mode: "closed" })}
          vendor={vendor}
          categories={data.categories}
        />
      )}
      <ExpenseSheet
        slug={slug}
        open={expenseSheetOpen}
        onOpenChange={(open) => !open && setSheet({ mode: "closed" })}
        expense={editingExpense}
        config={data.financeConfig}
        canEdit={canEdit}
        today={data.today}
        initial={{ vendorId: vendor.id }}
        onCreated={(id) => {
          // Como en Gastos: el panel sigue abierto con el gasto ya creado, para adjuntar el justificante.
          setSheet({ mode: "expense", id });
          router.refresh();
        }}
      />
    </div>
  );
}

function RecentExpenses({
  rows,
  basePath,
  fmt,
  onOpen,
  more,
}: {
  rows: ExpenseListItem[];
  basePath: string;
  fmt: ReturnType<typeof useVendorFormat>;
  onOpen: (id: string) => void;
  more: { href: string; count: number } | null;
}) {
  const t = useTranslations("vendors.detail.expenses");
  const onRowClick = (event: MouseEvent<HTMLLIElement>, id: string) => {
    if (closest(event.target, "a, button")) return;
    onOpen(id);
  };
  return (
    <>
      <ul className="divide-y">
        {rows.map((row) => {
          const Icon = ALLOCATION_ICONS[row.allocation];
          const target =
            row.allocation === "client" ? (
              row.clientId ? (
                <Link href={`${basePath}/clients/${row.clientId}`} className="truncate hover:text-primary">
                  {row.clientName ?? t("client")}
                </Link>
              ) : (
                <span className="truncate">{t("client")}</span>
              )
            ) : (
              <span className="truncate">{row.allocation === "company" ? t("company") : t("hostedSites")}</span>
            );
          return (
            <li
              key={row.id}
              onClick={(e) => onRowClick(e, row.id)}
              className="group grid cursor-pointer grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="text-xs text-muted-foreground tabular">{fmt.date(row.issuedOn)}</span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="truncate text-left font-semibold outline-none group-hover:text-primary focus-visible:text-primary focus-visible:underline"
                  >
                    {row.description}
                  </button>
                  {row.source === "subscription" && <SubscriptionMark />}
                  {row.hasAttachment && <Paperclip aria-label={t("hasAttachment")} className="size-3.5 shrink-0 text-muted-foreground" />}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <Icon aria-hidden className="size-3 shrink-0" />
                  {target}
                  <span className="hidden truncate sm:inline">· {row.categoryName}</span>
                </span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <span className="font-semibold tabular">{fmt.money(row.totalCents)}</span>
                <span className="flex items-center gap-1.5">
                  {row.status !== "paid" && (
                    <span className={cn("hidden text-[11px] tabular sm:inline", row.status === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                      {t("due", { date: fmt.dateShort(row.payableOn) })}
                    </span>
                  )}
                  <ExpenseStatusBadge status={row.status} />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {more && (
        <footer className="border-t px-5 py-2.5">
          <Link href={more.href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t("more", { count: more.count })}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </footer>
      )}
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint: ReactNode; tone?: "danger" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("mt-1 truncate text-xl font-bold tabular heading-tight", tone === "danger" && "text-destructive")}>{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}
