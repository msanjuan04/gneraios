import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TeamMemberToday } from "@/server/projects/team-today";

/**
 * Qué tiene hoy cada uno. Primero quien va más apurado: así se ve de un vistazo a quién hay que
 * echar una mano. Quien no tiene nada abierto no sale.
 */
export async function TeamTodayCard({ team, basePath, className }: { team: TeamMemberToday[]; basePath: string; className?: string }) {
  const t = await getTranslations("dashboard.team");

  return (
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {team.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {team.map((member) => (
              <li key={member.memberId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: member.color ?? "var(--primary)" }}
                  >
                    {member.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{member.fullName}</p>
                    {member.next ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {member.next.title}
                        <span className="text-muted-foreground/70">
                          {" · "}
                          {[member.next.clientName, member.next.projectName].filter(Boolean).join(" · ")}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("nothingToday")}</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums">
                  {member.overdue > 0 && (
                    <span className="rounded-full bg-destructive/12 px-2 py-0.5 text-destructive">{t("overdue", { count: member.overdue })}</span>
                  )}
                  {member.today > 0 && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">{t("today", { count: member.today })}</span>}
                  <span className={cn("rounded-full bg-secondary px-2 py-0.5 text-muted-foreground", member.overdue + member.today === 0 && "text-foreground")}>
                    {t("open", { count: member.open })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <div className="border-t px-5 py-3">
        <Link href={`${basePath}/projects/tasks`} className="text-sm font-semibold text-primary hover:underline">
          {t("allTasks")}
        </Link>
      </div>
    </Card>
  );
}
