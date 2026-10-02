/**
 * Tipos de la base de datos que usa la app.
 *
 * La base es `database.generated.ts`, salida intacta de `pnpm db:types`. Aquí solo
 * se corrige lo que el generador no puede saber: `issuers.verifactu_from` es
 * NOT NULL, pero lo rellena un trigger según el tipo de emisor, así que al
 * insertar es opcional.
 */
import type { Database as Generated, Json } from "./database.generated";

export type { Json } from "./database.generated";
export { Constants } from "./database.generated";

type GeneratedPublic = Generated["public"];
type GeneratedIssuers = GeneratedPublic["Tables"]["issuers"];

// Tipos de migraciones nuevas mientras no esté disponible el Supabase local para regenerar
// database.generated.ts. db:types reemplazará estos dos bloques al conectar el proyecto real.
type CalendarEntries = {
  Row: { id: string; org_id: string; member_id: string; title: string; description: string; starts_at: string; ends_at: string; all_day: boolean; google_event_id: string | null; dirty: boolean; deleted_at: string | null; created_at: string; updated_at: string; created_by: string | null };
  Insert: { id?: string; org_id: string; member_id: string; title: string; description?: string; starts_at: string; ends_at: string; all_day?: boolean; google_event_id?: string | null; dirty?: boolean; deleted_at?: string | null; created_at?: string; updated_at?: string; created_by?: string | null };
  Update: { id?: string; org_id?: string; member_id?: string; title?: string; description?: string; starts_at?: string; ends_at?: string; all_day?: boolean; google_event_id?: string | null; dirty?: boolean; deleted_at?: string | null; created_at?: string; updated_at?: string; created_by?: string | null };
  Relationships: [];
};
type GoogleCalendarConnections = {
  Row: { id: string; org_id: string; member_id: string; account_email: string; calendar_id: string | null; refresh_token_ciphertext: string; granted_scopes: string[]; connected_at: string; last_synced_at: string | null; last_error: string | null; created_at: string; updated_at: string };
  Insert: { id?: string; org_id: string; member_id: string; account_email?: string; calendar_id?: string | null; refresh_token_ciphertext: string; granted_scopes?: string[]; connected_at?: string; last_synced_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string };
  Update: { id?: string; org_id?: string; member_id?: string; account_email?: string; calendar_id?: string | null; refresh_token_ciphertext?: string; granted_scopes?: string[]; connected_at?: string; last_synced_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string };
  Relationships: [];
};
type AdsClientCampaigns = {
  Row: { id: string; org_id: string; client_id: string; ad_account_id: string; campaign_id: string; visible_to_client: boolean; created_at: string; updated_at: string };
  Insert: { id?: string; org_id: string; client_id: string; ad_account_id: string; campaign_id: string; visible_to_client?: boolean; created_at?: string; updated_at?: string };
  Update: { id?: string; org_id?: string; client_id?: string; ad_account_id?: string; campaign_id?: string; visible_to_client?: boolean; created_at?: string; updated_at?: string };
  Relationships: [];
};

type IssuersInsert = Omit<GeneratedIssuers["Insert"], "verifactu_from"> & { verifactu_from?: string };

// outbound_emails.claimed_at (20261002150000_envios_email_atomicos.sql), hasta regenerar los tipos.
type GeneratedOutboundEmails = GeneratedPublic["Tables"]["outbound_emails"];
type OutboundEmails = Omit<GeneratedOutboundEmails, "Row" | "Insert" | "Update"> & {
  Row: GeneratedOutboundEmails["Row"] & { claimed_at: string | null };
  Insert: GeneratedOutboundEmails["Insert"] & { claimed_at?: string | null };
  Update: GeneratedOutboundEmails["Update"] & { claimed_at?: string | null };
};

// org_documents (20261002180000_expediente_sociedad.sql), hasta regenerar los tipos.
type OrgDocumentCategory = "constitution" | "statutes" | "registry" | "tax" | "social_security" | "partner_agreement" | "bank" | "other";
type OrgDocumentStatus = "draft" | "pending_signature" | "signed" | "filed" | "registered" | "superseded";
type OrgDocuments = {
  Row: { id: string; org_id: string; category: OrgDocumentCategory; status: OrgDocumentStatus; title: string; description: string | null; effective_on: string | null; member_id: string | null; storage_path: string; file_name: string; content_type: string; size_bytes: number; sha256: string; created_at: string; updated_at: string; created_by: string | null; archived_at: string | null };
  Insert: { id?: string; org_id: string; category?: OrgDocumentCategory; status?: OrgDocumentStatus; title: string; description?: string | null; effective_on?: string | null; member_id?: string | null; storage_path: string; file_name: string; content_type: string; size_bytes: number; sha256: string; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Update: { id?: string; org_id?: string; category?: OrgDocumentCategory; status?: OrgDocumentStatus; title?: string; description?: string | null; effective_on?: string | null; member_id?: string | null; storage_path?: string; file_name?: string; content_type?: string; size_bytes?: number; sha256?: string; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Relationships: [];
};

// quote_templates (20261002160000_plantillas_presupuesto.sql), hasta regenerar los tipos.
type QuoteTemplates = {
  Row: { id: string; org_id: string; name: string; category: GeneratedPublic["Enums"]["catalog_category"]; summary: string | null; title: string | null; language: GeneratedPublic["Enums"]["app_locale"]; notes: string | null; lines: Json; payment_plan: Json; source_quote_id: string | null; uses_count: number; created_at: string; updated_at: string; created_by: string | null; archived_at: string | null };
  Insert: { id?: string; org_id: string; name: string; category?: GeneratedPublic["Enums"]["catalog_category"]; summary?: string | null; title?: string | null; language?: GeneratedPublic["Enums"]["app_locale"]; notes?: string | null; lines: Json; payment_plan?: Json; source_quote_id?: string | null; uses_count?: number; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Update: { id?: string; org_id?: string; name?: string; category?: GeneratedPublic["Enums"]["catalog_category"]; summary?: string | null; title?: string | null; language?: GeneratedPublic["Enums"]["app_locale"]; notes?: string | null; lines?: Json; payment_plan?: Json; source_quote_id?: string | null; uses_count?: number; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Relationships: [];
};

// deals_board.last_contact_* (20261002190000_ultimo_contacto_deal.sql), hasta regenerar los tipos.
type GeneratedDealsBoard = GeneratedPublic["Views"]["deals_board"];
type DealsBoard = Omit<GeneratedDealsBoard, "Row"> & {
  Row: GeneratedDealsBoard["Row"] & { last_contact_at: string | null; last_contact_direction: "incoming" | "outgoing" | "internal" | null };
};

export type Database = Omit<Generated, "public"> & {
  public: Omit<GeneratedPublic, "Tables" | "Functions" | "Views"> & {
    Views: Omit<GeneratedPublic["Views"], "deals_board"> & { deals_board: DealsBoard };
    Tables: Omit<GeneratedPublic["Tables"], "issuers" | "outbound_emails"> & {
      issuers: Omit<GeneratedIssuers, "Insert"> & { Insert: IssuersInsert };
      outbound_emails: OutboundEmails;
      calendar_entries: CalendarEntries;
      google_calendar_connections: GoogleCalendarConnections;
      ads_client_campaigns: AdsClientCampaigns;
      quote_templates: QuoteTemplates;
      org_documents: OrgDocuments;
    };
    Functions: GeneratedPublic["Functions"] & {
      quote_template_used: { Args: { p_template_id: string }; Returns: undefined };
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
