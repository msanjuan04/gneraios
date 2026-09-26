import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <SpaceBackdrop>
      <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
        <Isotype size={56} className="mb-8" />
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-3xl font-extrabold heading-tight">{t("title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("body")}</p>
        <Button asChild className="mt-8">
          <Link href="/">{t("home")}</Link>
        </Button>
      </main>
    </SpaceBackdrop>
  );
}
