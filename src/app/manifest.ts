import type { MetadataRoute } from "next";
import { brand } from "@/brand";

// La app se instala en el móvil y el escritorio (PWA). Los avisos push los reparte
// src/server/push y los muestra public/sw.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: brand.product,
    short_name: brand.name,
    description: "Clientes, pipeline, proyectos, contratos, facturación y SEO de GNERAI.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: brand.palette.black,
    theme_color: brand.palette.black,
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Calendario", url: "/?go=calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mis tareas", url: "/?go=projects/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Nueva factura", url: "/?go=invoices/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Nuevo presupuesto", url: "/?go=quotes/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
