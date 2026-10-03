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

// quotes.landing_url (20261003110000_landing_presupuesto.sql), hasta regenerar los tipos.
type GeneratedQuotes = GeneratedPublic["Tables"]["quotes"];
type Quotes = Omit<GeneratedQuotes, "Row" | "Insert" | "Update"> & {
  Row: GeneratedQuotes["Row"] & { landing_url: string | null };
  Insert: GeneratedQuotes["Insert"] & { landing_url?: string | null };
  Update: GeneratedQuotes["Update"] & { landing_url?: string | null };
};

// vault_settings y vault_items (20261003100000 + 20261003150000), hasta regenerar los tipos.
type VaultSettingsTable = {
  Row: { org_id: string; kdf_salt: string; kdf_iterations: number; verifier: string; rotated_at: string; rotated_by: string | null; created_at: string };
  Insert: { org_id: string; kdf_salt: string; kdf_iterations: number; verifier: string; rotated_at?: string; rotated_by?: string | null; created_at?: string };
  Update: { org_id?: string; kdf_salt?: string; kdf_iterations?: number; verifier?: string; rotated_at?: string; rotated_by?: string | null; created_at?: string };
  Relationships: [];
};
type VaultItems = {
  Row: { id: string; org_id: string; client_id: string | null; ciphertext: string; created_at: string; updated_at: string; created_by: string | null; archived_at: string | null };
  Insert: { id?: string; org_id: string; client_id?: string | null; ciphertext: string; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Update: { id?: string; org_id?: string; client_id?: string | null; ciphertext?: string; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Relationships: [];
};

// ads_accounts y ads_insights (20261002200000_ads_cuentas.sql), hasta regenerar los tipos.
type AdsProvider = "openai" | "google" | "meta" | "linkedin";
type AdsAccounts = {
  Row: { id: string; org_id: string; provider: AdsProvider; label: string; owner_client_id: string | null; external_account_id: string; login_customer_id: string | null; credential_ciphertext: string | null; developer_token_ciphertext: string | null; platform_name: string | null; currency: string | null; timezone: string | null; account_email: string | null; last_synced_at: string | null; last_error: string | null; created_at: string; updated_at: string; created_by: string | null; archived_at: string | null };
  Insert: { id?: string; org_id: string; provider: AdsProvider; label: string; owner_client_id?: string | null; external_account_id: string; login_customer_id?: string | null; credential_ciphertext?: string | null; developer_token_ciphertext?: string | null; platform_name?: string | null; currency?: string | null; timezone?: string | null; account_email?: string | null; last_synced_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Update: { id?: string; org_id?: string; provider?: AdsProvider; label?: string; owner_client_id?: string | null; external_account_id?: string; login_customer_id?: string | null; credential_ciphertext?: string | null; developer_token_ciphertext?: string | null; platform_name?: string | null; currency?: string | null; timezone?: string | null; account_email?: string | null; last_synced_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Relationships: [];
};
type AdsInsights = {
  Row: { org_id: string; account_id: string; period_from: string; period_to: string; fetched_at: string; campaigns: Json };
  Insert: { org_id: string; account_id: string; period_from: string; period_to: string; fetched_at?: string; campaigns?: Json };
  Update: { org_id?: string; account_id?: string; period_from?: string; period_to?: string; fetched_at?: string; campaigns?: Json };
  Relationships: [];
};

// deals_board.last_contact_* (20261002190000_ultimo_contacto_deal.sql), hasta regenerar los tipos.
type GeneratedDealsBoard = GeneratedPublic["Views"]["deals_board"];
type DealsBoard = Omit<GeneratedDealsBoard, "Row"> & {
  Row: GeneratedDealsBoard["Row"] & {
    last_contact_at: string | null;
    last_contact_direction: "incoming" | "outgoing" | "internal" | null;
    temperature: DealTemperature | null;
  };
};

// mail_accounts y mail_messages (20261003170000_correo.sql), hasta regenerar los tipos.
type MailAccounts = {
  Row: { id: string; org_id: string; address: string; display_name: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number; username: string; password_ciphertext: string; last_sync_at: string | null; last_error: string | null; created_at: string; updated_at: string; created_by: string | null; archived_at: string | null };
  Insert: { id?: string; org_id: string; address: string; display_name?: string; imap_host: string; imap_port?: number; smtp_host: string; smtp_port?: number; username: string; password_ciphertext: string; last_sync_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Update: { id?: string; org_id?: string; address?: string; display_name?: string; imap_host?: string; imap_port?: number; smtp_host?: string; smtp_port?: number; username?: string; password_ciphertext?: string; last_sync_at?: string | null; last_error?: string | null; created_at?: string; updated_at?: string; created_by?: string | null; archived_at?: string | null };
  Relationships: [];
};
type MailMessages = {
  Row: { id: string; org_id: string; account_id: string; folder: string; uid: number; message_id: string | null; in_reply_to: string | null; thread_key: string; direction: "incoming" | "outgoing"; from_address: string; from_name: string; to_addresses: string[]; cc_addresses: string[]; subject: string; body_text: string; body_html: string | null; snippet: string; sent_at: string; seen: boolean; has_attachments: boolean; client_id: string | null; created_at: string };
  Insert: { id?: string; org_id: string; account_id: string; folder: string; uid: number; message_id?: string | null; in_reply_to?: string | null; thread_key: string; direction: "incoming" | "outgoing"; from_address: string; from_name?: string; to_addresses?: string[]; cc_addresses?: string[]; subject?: string; body_text?: string; body_html?: string | null; snippet?: string; sent_at: string; seen?: boolean; has_attachments?: boolean; client_id?: string | null; created_at?: string };
  Update: { id?: string; org_id?: string; account_id?: string; folder?: string; uid?: number; message_id?: string | null; in_reply_to?: string | null; thread_key?: string; direction?: "incoming" | "outgoing"; from_address?: string; from_name?: string; to_addresses?: string[]; cc_addresses?: string[]; subject?: string; body_text?: string; body_html?: string | null; snippet?: string; sent_at?: string; seen?: boolean; has_attachments?: boolean; client_id?: string | null; created_at?: string };
  Relationships: [];
};

// deals.temperature (20261003180000_leads_temperatura.sql), hasta regenerar los tipos.
export type DealTemperature = "hot" | "warm" | "cold";
type GeneratedDeals = GeneratedPublic["Tables"]["deals"];
type Deals = Omit<GeneratedDeals, "Row" | "Insert" | "Update"> & {
  Row: GeneratedDeals["Row"] & { temperature: DealTemperature | null };
  Insert: GeneratedDeals["Insert"] & { temperature?: DealTemperature | null };
  Update: GeneratedDeals["Update"] & { temperature?: DealTemperature | null };
};

// notification_kind + mail_new_lead y mail_accepted (20261003190000_avisos_correo.sql), hasta regenerar los tipos.
type MailNotificationKind = "mail_new_lead" | "mail_accepted";
type GeneratedNotifications = GeneratedPublic["Tables"]["notifications"];
type Notifications = Omit<GeneratedNotifications, "Row" | "Insert" | "Update"> & {
  Row: Omit<GeneratedNotifications["Row"], "kind"> & { kind: GeneratedNotifications["Row"]["kind"] | MailNotificationKind };
  Insert: Omit<GeneratedNotifications["Insert"], "kind"> & { kind: GeneratedNotifications["Insert"]["kind"] | MailNotificationKind };
  Update: Omit<GeneratedNotifications["Update"], "kind"> & { kind?: GeneratedNotifications["Update"]["kind"] | MailNotificationKind };
};

export type Database = Omit<Generated, "public"> & {
  public: Omit<GeneratedPublic, "Tables" | "Functions" | "Views"> & {
    Views: Omit<GeneratedPublic["Views"], "deals_board"> & { deals_board: DealsBoard };
    Tables: Omit<GeneratedPublic["Tables"], "issuers" | "outbound_emails" | "quotes" | "deals" | "notifications"> & {
      quotes: Quotes;
      deals: Deals;
      notifications: Notifications;
      issuers: Omit<GeneratedIssuers, "Insert"> & { Insert: IssuersInsert };
      outbound_emails: OutboundEmails;
      calendar_entries: CalendarEntries;
      google_calendar_connections: GoogleCalendarConnections;
      ads_client_campaigns: AdsClientCampaigns;
      ads_accounts: AdsAccounts;
      vault_settings: VaultSettingsTable;
      vault_items: VaultItems;
      ads_insights: AdsInsights;
      quote_templates: QuoteTemplates;
      org_documents: OrgDocuments;
      mail_accounts: MailAccounts;
      mail_messages: MailMessages;
    };
    Functions: GeneratedPublic["Functions"] & {
      quote_template_used: { Args: { p_template_id: string }; Returns: undefined };
      set_quote_landing: { Args: { p_quote: string; p_url: string }; Returns: undefined };
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
