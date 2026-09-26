import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ReadOnlyNotice, SettingsSectionHeader } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initialsFrom } from "@/domain/people";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getOrgContext, hasRole } from "@/server/session";
import { InvitationActions, InviteButton } from "./invitation-controls";
import { MemberAccessButton, MemberRoleSelect } from "./member-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.team")} · ${t("title")}` };
}

/** Ids de las invitaciones que ya han caducado. */
function expiredInvitations(invitations: { id: string; expires_at: string }[]): Set<string> {
  const now = Date.now();
  return new Set(invitations.filter((i) => Date.parse(i.expires_at) <= now).map((i) => i.id));
}

export default async function TeamSettingsPage({ params }: PageProps<"/[org]/settings/team">) {
  const { org: slug } = await params;
  const { org, member: me } = await getOrgContext(slug);
  const canEdit = hasRole(me.role, "owner");
  // RLS solo deja ver las invitaciones a partir de socio.
  const canSeeInvitations = hasRole(me.role, "partner");
  const t = await getTranslations("settings.team");
  const tRoles = await getTranslations("roles");
  const tCommon = await getTranslations("common");
  const format = await getFormatter();
  const supabase = await createClient();

  const [membersRes, invitationsRes] = await Promise.all([
    supabase
      .from("members")
      .select("id, full_name, initials, role, is_active")
      .eq("org_id", org.id)
      .order("is_active", { ascending: false })
      .order("full_name"),
    canSeeInvitations
      ? supabase
          .from("member_invitations")
          .select("id, email, full_name, role, expires_at")
          .eq("org_id", org.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : null,
  ]);
  if (membersRes.error) throw membersRes.error;
  if (invitationsRes?.error) throw invitationsRes.error;

  const members = membersRes.data;
  const invitations = invitationsRes?.data ?? [];
  const expired = expiredInvitations(invitations);

  return (
    <div className="space-y-10">
      <section>
        <SettingsSectionHeader
          title={t("title")}
          description={t("description")}
          actions={canEdit ? <InviteButton slug={org.slug} /> : undefined}
        />
        {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}
        <div className="rounded-2xl border bg-card px-2 py-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs text-muted-foreground">{t("member")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("role")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("status")}</TableHead>
                {canEdit && (
                  <TableHead className="w-0">
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.id === me.id;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white",
                            !m.is_active && "opacity-40 grayscale",
                          )}
                          aria-hidden
                        >
                          {m.initials}
                        </span>
                        <span className={cn("font-medium", !m.is_active && "text-muted-foreground")}>{m.full_name}</span>
                        {isSelf && <Badge variant="secondary">{t("you")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <MemberRoleSelect slug={org.slug} memberId={m.id} role={m.role} isSelf={isSelf} />
                      ) : (
                        <span className="text-muted-foreground">{tRoles(m.role)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.is_active ? (
                        <Badge className="bg-success/15 text-success">{t("active")}</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          {t("inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        {!isSelf && (
                          <MemberAccessButton slug={org.slug} memberId={m.id} name={m.full_name} active={m.is_active} />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {canSeeInvitations && (
        <section>
          <SettingsSectionHeader title={t("invitesTitle")} description={t("invitesDescription")} />
          {invitations.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              {t("noInvites")}
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card text-sm">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed text-xs font-bold text-muted-foreground"
                    aria-hidden
                  >
                    {initialsFrom(invitation.full_name || invitation.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invitation.full_name || invitation.email}</p>
                    {invitation.full_name && <p className="truncate text-xs text-muted-foreground">{invitation.email}</p>}
                  </div>
                  <Badge variant="outline">{tRoles(invitation.role)}</Badge>
                  {expired.has(invitation.id) ? (
                    <Badge className="bg-destructive/15 text-destructive">{t("expired")}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular">
                      {t("expires", { date: format.dateTime(new Date(invitation.expires_at), { dateStyle: "medium" }) })}
                    </span>
                  )}
                  {canEdit && <InvitationActions slug={org.slug} invitationId={invitation.id} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
