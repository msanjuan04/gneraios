"use client";

import { ArrowLeft, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Proveedor que no existe (o que la RLS no deja ver): dentro de Finanzas, con vuelta al listado. */
export default function VendorNotFound() {
  const t = useTranslations("vendors.notFound");
  const { org } = useParams<{ org: string }>();
  return (
    <div className="mx-auto mt-10 max-w-md rounded-3xl border bg-card/50 px-8 py-12 text-center md:mt-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Truck className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href={`/${org}/finance/vendors`}>
          <ArrowLeft data-icon="inline-start" />
          {t("back")}
        </Link>
      </Button>
    </div>
  );
}
