import { Download, FileText, Repeat, Sparkles, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { QuoteView } from "@/pdf";
import type { QuoteRowView, QuoteTableView, QuoteTotalsView } from "@/pdf/quote-view-model";
import type { PublicQuote } from "@/server/portal/quote";
import { portalCopy } from "@/server/portal/copy";
import { Eyebrow, pillClass } from "./ui";

/**
 * El presupuesto en HTML: exactamente lo que imprime el PDF (buildQuoteView, en su idioma), con
 * lo puntual, lo recurrente y lo de uso por separado y el plan de pagos. Sin tablas anchas: cada
 * línea es una fila legible en el móvil.
 */

function Block({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card/80 p-5 sm:p-7">
      <h2 className="mb-4 flex items-center gap-2.5 text-lg font-extrabold heading-tight">
        <Icon className="size-5 text-primary" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function LineItem({ row, headers }: { row: QuoteRowView; headers: QuoteTableView["headers"] }) {
  const detail = [
    row.quantity !== "1" ? `${row.quantity} × ${row.unitPrice}` : null,
    headers.discount && row.discount ? `${headers.discount} ${row.discount}` : null,
    headers.vat ? `${headers.vat} ${row.vat}` : null,
  ].filter(Boolean);
  return (
    <li className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{row.description}</p>
        {row.detail && <p className="mt-0.5 text-sm text-muted-foreground">{row.detail}</p>}
        {detail.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground tabular">{detail.join(" · ")}</p>}
      </div>
      <p className="shrink-0 text-right font-semibold tabular">{row.amount}</p>
    </li>
  );
}

function Lines({ table }: { table: QuoteTableView }) {
  return (
    <ul className="divide-y divide-border">
      {table.rows.map((row, index) => (
        <LineItem key={`${index}-${row.description}`} row={row} headers={table.headers} />
      ))}
    </ul>
  );
}

function Totals({ totals }: { totals: QuoteTotalsView }) {
  return (
    <dl className="mt-3 ml-auto max-w-sm space-y-1.5 border-t pt-3 text-sm">
      {totals.rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4 text-muted-foreground">
          <dt>
            {row.label}
            {row.hint && <span className="ml-1 text-xs">({row.hint})</span>}
          </dt>
          <dd className="tabular">{row.value}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 pt-1.5 text-base font-extrabold">
        <dt>{totals.total.label}</dt>
        <dd className="tabular">{totals.total.value}</dd>
      </div>
    </dl>
  );
}

export function QuoteDocumentView({ quote, pdfHref, banner, action }: { quote: PublicQuote; pdfHref: string; banner?: ReactNode; action?: ReactNode }) {
  const t = portalCopy(quote.locale);
  const view: QuoteView = quote.view;
  return (
    <div className="space-y-6">
      <header className="portal-rise">
        <Eyebrow>{t("quote.eyebrow", { number: quote.number })}</Eyebrow>
        <h1 className="mt-2 text-3xl font-extrabold heading-tight text-balance sm:text-5xl">{view.subtitle || quote.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span>{t("quote.preparedFor", { client: quote.clientName })}</span>
          <span>{t("quote.issuedBy", { issuer: quote.issuerName })}</span>
          {view.dates.map((d) => (
            <span key={d.label}>
              {d.label}: <span className="font-semibold text-foreground tabular">{d.value}</span>
            </span>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {action}
          <a href={pdfHref} className={pillClass("secondary")} download>
            <Download aria-hidden />
            {t("quote.download")}
          </a>
        </div>
      </header>

      {banner}

      {view.summary && (
        <section aria-label={t("quote.summary")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.summary.items.map((item) => (
            <div key={item.label} className="glass rounded-3xl border p-5">
              <Eyebrow>{item.label}</Eyebrow>
              <p className="mt-2 text-2xl font-extrabold heading-tight tabular">{item.value}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{view.summary.note}</p>
        </section>
      )}

      {view.oneOff && (
        <Block icon={Sparkles} title={view.oneOff.title}>
          <Lines table={view.oneOff.table} />
          <Totals totals={view.oneOff.totals} />
          {view.oneOff.plan && (
            <div className="mt-6 rounded-2xl bg-muted/60 p-4 sm:p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Wallet className="size-4 text-primary" aria-hidden />
                {view.oneOff.plan.title}
              </h3>
              <ol className="space-y-2.5">
                {view.oneOff.plan.rows.map((row, index) => (
                  <li key={`${index}-${row.label}`} className="flex items-start justify-between gap-4 text-sm">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-bold text-primary tabular">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">{row.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.when} · {row.percent}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular">{row.total}</p>
                      <p className="text-xs text-muted-foreground tabular">{row.amount}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Block>
      )}

      {view.recurring && (
        <Block icon={Repeat} title={view.recurring.title}>
          <Lines table={view.recurring.table} />
          {view.recurring.totals.map((totals) => (
            <Totals key={totals.total.label} totals={totals} />
          ))}
        </Block>
      )}

      {view.usage && (
        <Block icon={Repeat} title={view.usage.title}>
          <p className="-mt-2 mb-2 text-sm text-muted-foreground">{view.usage.note}</p>
          <Lines table={view.usage.table} />
        </Block>
      )}

      {(view.notes || view.legalNotes) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {view.notes && (
            <div className="rounded-3xl border p-5">
              <Eyebrow>{view.notes.title}</Eyebrow>
              <p className="mt-2 text-sm whitespace-pre-line">{view.notes.text}</p>
            </div>
          )}
          {view.legalNotes && (
            <div className="rounded-3xl border p-5">
              <Eyebrow>{view.legalNotes.title}</Eyebrow>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {view.legalNotes.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        {[view.issuer, view.client].map((party) => (
          <div key={party.heading} className="rounded-3xl border p-5 text-sm">
            <Eyebrow>{party.heading}</Eyebrow>
            <p className="mt-2 font-bold">{party.name}</p>
            {party.tradeName && <p className="text-muted-foreground">{party.tradeName}</p>}
            {party.lines.map((line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ))}
      </section>
      {view.footer.registryInfo && <p className="text-center text-xs text-muted-foreground">{view.footer.registryInfo}</p>}
    </div>
  );
}
