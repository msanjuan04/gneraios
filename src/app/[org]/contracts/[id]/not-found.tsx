"use client";

import { ArrowLeft, FileSignature } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Contrato que no existe (o que la RLS no deja ver): dentro del shell, con vuelta al listado. */
export default function ContractNotFound() {
  const t = useTranslations("contracts.notFound");
  const { org } = useParams<{ org: string }>();
  return (
    <div className="mx-auto mt-10 max-w-md rounded-3xl border bg-card/50 px-8 py-12 text-center md:mt-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileSignature className="size-5" />
      </div>
      <h2 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href={`/${org}/contracts`}>
          <ArrowLeft data-icon="inline-start" />
          {t("back")}
        </Link>
      </Button>
    </div>
  );
}
