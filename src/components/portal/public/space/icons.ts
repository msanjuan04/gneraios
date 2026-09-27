import { ChartLine, FileText, FolderOpen, History, Layers, MessageSquarePlus, Route, type LucideIcon } from "lucide-react";
import type { PortalSectionKey } from "@/domain/portal";

/** Icono de cada sección de «Tu espacio» (el índice y la cabecera de cada tarjeta usan el mismo). */
export const SPACE_SECTION_ICONS: Record<PortalSectionKey, LucideIcon> = {
  progress: Route,
  work_log: History,
  files: FolderOpen,
  services: Layers,
  documents: FileText,
  requests: MessageSquarePlus,
  web_data: ChartLine,
};
