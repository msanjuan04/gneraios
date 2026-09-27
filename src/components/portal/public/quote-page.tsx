import { ArrowLeft, CircleCheck, CircleX, Clock, PartyPopper, TimerOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PublicQuote } from "@/server/portal/quote";
import { portalCopy } from "@/server/portal/copy";
import { AcceptQuoteForm } from "./accept-quote-form";
import { QuoteDocumentView } from "./quote-view";
import { PortalShell } from "./shell";
import { civil, money, pillClass } from "./ui";

type Done = "accepted" | "rejected" | null;

function Banner({ tone, icon, title, children }: { tone: "primary" | "success" | "muted" | "warning"; icon: ReactNode; title: string; children: ReactNode }) {
  const tones = {
    primary: "border-primary/30 bg-primary/8",
    success: "border-success/30 bg-success/10",
    muted: "border-border bg-muted/60",
    warning: "border-warning/30 bg-warning/10",
  } as const;
  return (
    <div role="status" className={`portal-rise flex items-start gap-4 rounded-3xl border p-5 sm:p-6 ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-extrabold heading-tight">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function StateBanner({ quote, done }: { quote: PublicQuote; done: Done }) {
  const t = portalCopy(quote.locale);
  const answered = quote.answeredOn ? civil(quote.answeredOn, quote.locale) : "";
  switch (quote.state) {
    case "accepted": {
      const name = quote.acceptance?.signerName ?? "";
      if (done === "accepted") {
        return (
          <Banner tone="success" icon={<PartyPopper className="size-7 text-success" aria-hidden />} title={t("quote.done.accepted.title", { name: name.split(" ")[0] ?? name })}>
            {t("quote.done.accepted.text", { number: quote.number })}
          </Banner>
        );
      }
      return (
        <Banner tone="success" icon={<CircleCheck className="size-7 text-success" aria-hidden />} title={t("quote.state.accepted.title")}>
          {name ? t("quote.state.accepted.byName", { name, date: answered }) : t("quote.state.accepted.noName", { date: answered })}
        </Banner>
      );
    }
    case "rejected":
      return done === "rejected" ? (
        <Banner tone="muted" icon={<CircleX className="size-7 text-muted-foreground" aria-hidden />} title={t("quote.done.rejected.title")}>
          {t("quote.done.rejected.text")}
        </Banner>
      ) : (
        <Banner tone="muted" icon={<CircleX className="size-7 text-muted-foreground" aria-hidden />} title={t("quote.state.rejected.title")}>
          {t("quote.state.rejected.text", { date: answered })}
        </Banner>
      );
    case "expired":
      return (
        <Banner
          tone="warning"
          icon={<TimerOff className="size-7 text-warning" aria-hidden />}
          title={t("quote.state.expired.title", { date: quote.validUntil ? civil(quote.validUntil, quote.locale) : "" })}
        >
          {t("quote.state.expired.text")}
        </Banner>
      );
    case "open":
      return (
        <Banner tone="primary" icon={<Clock className="size-7 text-primary" aria-hidden />} title={t("quote.state.open.title")}>
          {t("quote.state.open.text", { date: quote.validUntil ? civil(quote.validUntil, quote.locale) : "" })}
        </Banner>
      );
    default:
      return (
        <Banner tone="muted" icon={<CircleX className="size-7 text-muted-foreground" aria-hidden />} title={t("quote.state.closed.title")}>
          {t("quote.state.closed.text")}
        </Banner>
      );
  }
}

/**
 * La página pública de un presupuesto: el enlace del presupuesto (/p/q/<token>) o uno del
 * portal del cliente (/p/c/<token>/q/<id>). Lo mismo en los dos casos; solo cambian las rutas.
 */
export function PublicQuotePage({
  token,
  quote,
  done,
  pdfHref,
  backHref,
  footer,
}: {
  token: string;
  quote: PublicQuote;
  done: Done;
  pdfHref: string;
  /** Desde el portal: volver a «Tu espacio». */
  backHref?: string;
  footer: { issuers: string[]; email: string | null };
}) {
  const t = portalCopy(quote.locale);
  const open = quote.state === "open";
  return (
    <PortalShell
      locale={quote.locale}
      footer={footer}
      headerEnd={
        backHref ? (
          <Link href={backHref} className={pillClass("ghost")}>
            <ArrowLeft aria-hidden />
            {t("quote.backToSpace")}
          </Link>
        ) : null
      }
    >
      <div className="space-y-6">
        <QuoteDocumentView
          quote={quote}
          pdfHref={pdfHref}
          banner={<StateBanner quote={quote} done={done} />}
          action={
            open ? (
              <a href="#accept" className={pillClass("primary")}>
                <CircleCheck aria-hidden />
                {t("quote.accept.submit")}
              </a>
            ) : null
          }
        />
        {open && (
          <AcceptQuoteForm
            token={token}
            quoteId={quote.quoteId}
            version={quote.version}
            locale={quote.locale}
            copy={{
              title: t("quote.accept.title"),
              intro: t("quote.accept.intro"),
              name: t("quote.accept.name"),
              email: t("quote.accept.email"),
              signature: t("quote.accept.signature"),
              signatureHint: t("quote.accept.signatureHint"),
              consent: t("quote.accept.consent", { number: quote.number }),
              submit: t("quote.accept.submit"),
              submitting: t("quote.accept.submitting"),
              evidence: t("quote.accept.evidence"),
              firstPayment: quote.firstPayment
                ? t("quote.accept.firstPayment", { label: quote.firstPayment.label, amount: money(quote.firstPayment.totalCents, quote.locale) })
                : null,
              reject: {
                open: t("quote.reject.open"),
                title: t("quote.reject.title"),
                reason: t("quote.reject.reason"),
                reasonPlaceholder: t("quote.reject.reasonPlaceholder"),
                submit: t("quote.reject.submit"),
                submitting: t("quote.reject.submitting"),
              },
            }}
          />
        )}
      </div>
    </PortalShell>
  );
}
