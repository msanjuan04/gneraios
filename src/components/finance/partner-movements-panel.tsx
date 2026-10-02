"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createPartnerMovement, updatePartnerMovementStatus } from "@/app/[org]/finance/actions";
import { moneyToCents } from "@/app/[org]/finance/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { useFinanceFormat } from "./format";
import type { PartnersData } from "./types";

const KINDS = ["capital_contribution", "shareholder_funds_contribution", "partner_loan", "loan_repayment", "expense_reimbursement", "dividend"] as const;
export function PartnerMovementsPanel({ slug, data, canRecord, canApprove, today }: { slug: string; data: PartnersData; canRecord: boolean; canApprove: boolean; today: string }) {
  const t = useTranslations("finance.partners.movements");
  const tc = useTranslations("common");
  const { money, date } = useFinanceFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ memberId: "", kind: "partner_loan" as (typeof KINDS)[number], amount: "", effectiveOn: today, reference: "", notes: "" });
  const memberName = (id: string) => data.members.find((member) => member.id === id)?.fullName ?? t("unknownMember");
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cents = moneyToCents(form.amount);
    if (!form.memberId || cents <= 0) { toast.error(t("invalid")); return; }
    startTransition(async () => {
      const result = await createPartnerMovement(slug, { member_id: form.memberId, kind: form.kind, amount_cents: cents, effective_on: form.effectiveOn, reference: form.reference, notes: form.notes });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(t("created"));
      setForm({ memberId: "", kind: "partner_loan", amount: "", effectiveOn: today, reference: "", notes: "" });
      router.refresh();
    });
  };
  const changeStatus = (id: string, status: "approved" | "paid" | "void") => startTransition(async () => {
    const result = await updatePartnerMovementStatus(slug, id, status);
    if (!result.ok) toast.error(result.error);
    else { toast.success(t("updated")); router.refresh(); }
  });

  return <SettingsCard title={t("title")} description={t("description")}>
    <p className="mb-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{t("legalNotice")}</p>
    {canRecord && <form onSubmit={submit} className="mb-5 grid gap-3 rounded-xl border bg-muted/10 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="partner-movement-member" label={t("member")}><Select value={form.memberId} onValueChange={(memberId) => setForm({ ...form, memberId })}><SelectTrigger id="partner-movement-member" className="w-full"><SelectValue placeholder={t("chooseMember")} /></SelectTrigger><SelectContent>{data.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.fullName}</SelectItem>)}</SelectContent></Select></FormField>
      <FormField id="partner-movement-kind" label={t("kind")}><Select value={form.kind} onValueChange={(kind: (typeof KINDS)[number]) => setForm({ ...form, kind })}><SelectTrigger id="partner-movement-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t(`kinds.${kind}`)}</SelectItem>)}</SelectContent></Select></FormField>
      <FormField id="partner-movement-amount" label={t("amount")}><Input id="partner-movement-amount" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" required /></FormField>
      <FormField id="partner-movement-date" label={t("date")}><Input id="partner-movement-date" type="date" value={form.effectiveOn} onChange={(event) => setForm({ ...form, effectiveOn: event.target.value })} required /></FormField>
      <FormField id="partner-movement-reference" label={t("reference")}><Input id="partner-movement-reference" maxLength={200} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></FormField>
      <FormField id="partner-movement-notes" label={t("notes")}><Input id="partner-movement-notes" maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></FormField>
      <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={pending || !form.memberId || moneyToCents(form.amount) <= 0}>{pending ? tc("saving") : t("registerProposed")}</Button></div>
    </form>}
    {data.movements.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/30 text-left"><tr>{["date", "member", "kind", "direction", "amount", "status", "reference", "actions"].map((key) => <th key={key} className="px-3 py-2 font-medium">{t(`columns.${key}`)}</th>)}</tr></thead><tbody className="divide-y">{data.movements.map((item) => { const incoming = item.kind === "capital_contribution" || item.kind === "shareholder_funds_contribution" || item.kind === "partner_loan"; return <tr key={item.id}><td className="px-3 py-2 tabular">{date(item.effectiveOn)}</td><td className="px-3 py-2">{memberName(item.memberId)}</td><td className="px-3 py-2">{t(`kinds.${item.kind}`)}</td><td className="px-3 py-2">{t(incoming ? "inflow" : "outflow")}</td><td className="px-3 py-2 text-right tabular">{money(item.amountCents)}</td><td className="px-3 py-2">{t(`statuses.${item.status}`)}</td><td className="max-w-48 truncate px-3 py-2">{item.reference || item.notes || "—"}</td><td className="px-3 py-2">{canApprove && item.status !== "paid" && item.status !== "void" && <div className="flex gap-1">{item.status === "proposed" && <Button size="sm" variant="outline" disabled={pending} onClick={() => changeStatus(item.id, "approved")}>{t("approve")}</Button>}{item.status === "approved" && <Button size="sm" disabled={pending} onClick={() => changeStatus(item.id, "paid")}>{t("markPaid")}</Button>}<Button size="sm" variant="ghost" disabled={pending} onClick={() => changeStatus(item.id, "void")}>{t("void")}</Button></div>}</td></tr>; })}</tbody></table></div>}
  </SettingsCard>;
}
