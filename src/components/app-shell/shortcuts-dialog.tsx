"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useShell } from "./shell-context";

type Shortcut = { keys: string[]; label: string; sequence?: boolean };

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "groupGlobal",
    items: [
      { keys: ["⌘", "K"], label: "commandMenu" },
      { keys: ["G", "D"], label: "goDashboard", sequence: true },
      { keys: ["G", "L"], label: "goCalendar", sequence: true },
      { keys: ["G", "A"], label: "goCouncil", sequence: true },
      { keys: ["G", "E"], label: "goSeo", sequence: true },
      { keys: ["G", "P"], label: "goPipeline", sequence: true },
      { keys: ["G", "C"], label: "goClients", sequence: true },
      { keys: ["G", "R"], label: "goProjects", sequence: true },
      { keys: ["G", "Q"], label: "goQuotes", sequence: true },
      { keys: ["G", "O"], label: "goContracts", sequence: true },
      { keys: ["G", "F"], label: "goInvoices", sequence: true },
      { keys: ["G", "N"], label: "goFinance", sequence: true },
      { keys: ["G", "S"], label: "goSettings", sequence: true },
      { keys: ["⌘", "B"], label: "toggleSidebar" },
      { keys: ["?"], label: "help" },
    ],
  },
  {
    title: "groupLists",
    items: [
      { keys: ["J", "K"], label: "listMove" },
      { keys: ["Enter"], label: "listOpen" },
      { keys: ["C"], label: "listCreate" },
    ],
  },
  {
    title: "groupPipeline",
    items: [
      { keys: ["N"], label: "pipelineNew" },
      { keys: ["⇧", "←"], label: "pipelinePrev" },
      { keys: ["⇧", "→"], label: "pipelineNext" },
      { keys: ["Espacio"], label: "pipelineDrag" },
    ],
  },
  {
    title: "groupCalendar",
    items: [
      { keys: ["T"], label: "calendarToday" },
      { keys: ["←", "→"], label: "calendarPrevNext" },
      { keys: ["M"], label: "calendarMonth" },
      { keys: ["W"], label: "calendarWeek" },
      { keys: ["A"], label: "calendarAgenda" },
      { keys: ["J", "K"], label: "calendarAgendaMove" },
    ],
  },
];

export function ShortcutsDialog() {
  const t = useTranslations("shortcuts");
  const { shortcutsOpen, setShortcutsOpen } = useShell();

  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t(group.title)}</h3>
              <ul className="divide-y">
                {group.items.map((s) => (
                  <li key={s.label} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">{t(s.label)}</span>
                    <KbdGroup>
                      {s.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {s.sequence && i > 0 && <span className="text-xs text-muted-foreground">{t("then")}</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
