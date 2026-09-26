/**
 * Tipos de la base de datos que usa la app.
 *
 * La base es `database.generated.ts`, salida intacta de `pnpm db:types`. Aquí solo
 * se corrige lo que el generador no puede saber: `issuers.verifactu_from` es
 * NOT NULL, pero lo rellena un trigger según el tipo de emisor, así que al
 * insertar es opcional.
 */
import type { Database as Generated } from "./database.generated";

export type { Json } from "./database.generated";
export { Constants } from "./database.generated";

type GeneratedPublic = Generated["public"];
type GeneratedIssuers = GeneratedPublic["Tables"]["issuers"];

type IssuersInsert = Omit<GeneratedIssuers["Insert"], "verifactu_from"> & { verifactu_from?: string };

export type Database = Omit<Generated, "public"> & {
  public: Omit<GeneratedPublic, "Tables"> & {
    Tables: Omit<GeneratedPublic["Tables"], "issuers"> & {
      issuers: Omit<GeneratedIssuers, "Insert"> & { Insert: IssuersInsert };
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
