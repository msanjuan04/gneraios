import type { MetadataRoute } from "next";
import { brand } from "@/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.product,
    short_name: brand.product,
    description: "Clientes, pipeline, contratos y facturación de GNERAI.",
    start_url: "/",
    display: "standalone",
    background_color: brand.palette.black,
    theme_color: brand.palette.black,
    icons: [{ src: brand.logos.isotypeMetal, sizes: "313x313", type: "image/png", purpose: "any" }],
  };
}
