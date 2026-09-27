import type { SpaceData } from "@/components/portal/types";
import { portalCopy } from "@/server/portal/copy";
import { RequestForm } from "../request-form";
import { SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

/** «Pedir algo»: una petición llega al equipo como un deal nuevo con su nota. */
export function RequestsSection({ data, token }: { data: SpaceData; token: string }) {
  const t = portalCopy(data.locale);
  const c = (key: Parameters<typeof t>[0]) => t(key);
  return (
    <SectionCard id="requests" icon={SPACE_SECTION_ICONS.requests} title={t("space.sections.requests.title")} subtitle={t("space.sections.requests.subtitle")}>
      <RequestForm
        token={token}
        locale={data.locale}
        copy={{
          subject: c("space.sections.requests.subject"),
          subjectPlaceholder: c("space.sections.requests.subjectPlaceholder"),
          description: c("space.sections.requests.description"),
          descriptionPlaceholder: c("space.sections.requests.descriptionPlaceholder"),
          urgent: c("space.sections.requests.urgent"),
          submit: c("space.sections.requests.submit"),
          submitting: c("space.sections.requests.submitting"),
          sentTitle: c("space.sections.requests.sent.title"),
          sentText: c("space.sections.requests.sent.text"),
          another: c("space.sections.requests.another"),
        }}
      />
    </SectionCard>
  );
}
