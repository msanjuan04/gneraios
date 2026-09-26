export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      acquisition_sources: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          body: string | null
          client_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          id: string
          kind: Database["public"]["Enums"]["activity_kind"]
          member_id: string | null
          occurred_at: string
          org_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          client_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["activity_kind"]
          member_id?: string | null
          occurred_at?: string
          org_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          client_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["activity_kind"]
          member_id?: string | null
          occurred_at?: string
          org_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "activities_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "activities_org_id_contact_id_fkey"
            columns: ["org_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "activities_org_id_deal_id_fkey"
            columns: ["org_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "activities_org_id_deal_id_fkey"
            columns: ["org_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          org_id: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          org_id: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          org_id?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      billable_items: {
        Row: {
          amount_cents: number
          billable_on: string
          contract_line_id: string
          created_at: string
          created_by: string | null
          description: string
          discount_bps: number
          id: string
          invoice_line_id: string | null
          milestone_id: string | null
          org_id: string
          period_end: string | null
          period_start: string | null
          quantity: number
          source: Database["public"]["Enums"]["billable_source"]
          unit_price_cents: number
          updated_at: string
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
        }
        Insert: {
          amount_cents: number
          billable_on: string
          contract_line_id: string
          created_at?: string
          created_by?: string | null
          description: string
          discount_bps?: number
          id?: string
          invoice_line_id?: string | null
          milestone_id?: string | null
          org_id: string
          period_end?: string | null
          period_start?: string | null
          quantity: number
          source: Database["public"]["Enums"]["billable_source"]
          unit_price_cents: number
          updated_at?: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Update: {
          amount_cents?: number
          billable_on?: string
          contract_line_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_bps?: number
          id?: string
          invoice_line_id?: string | null
          milestone_id?: string | null
          org_id?: string
          period_end?: string | null
          period_start?: string | null
          quantity?: number
          source?: Database["public"]["Enums"]["billable_source"]
          unit_price_cents?: number
          updated_at?: string
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billable_items_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billable_items_org_id_invoice_line_id_fkey"
            columns: ["org_id", "invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_milestone_id_fkey"
            columns: ["org_id", "milestone_id"]
            isOneToOne: false
            referencedRelation: "contract_milestones"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line: string | null
          archived_at: string | null
          city: string | null
          country_code: string
          created_at: string
          created_by: string | null
          display_name: string
          external_id: string | null
          id: string
          imported_source_id: string | null
          is_business: boolean
          legal_name: string | null
          notes: string | null
          org_id: string
          owner_member_id: string | null
          payment_terms_days: number | null
          postal_code: string | null
          preferred_language: Database["public"]["Enums"]["app_locale"]
          province: string | null
          sector: string | null
          tax_id: string | null
          tax_id_kind: Database["public"]["Enums"]["tax_id_kind"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          display_name: string
          external_id?: string | null
          id?: string
          imported_source_id?: string | null
          is_business?: boolean
          legal_name?: string | null
          notes?: string | null
          org_id: string
          owner_member_id?: string | null
          payment_terms_days?: number | null
          postal_code?: string | null
          preferred_language?: Database["public"]["Enums"]["app_locale"]
          province?: string | null
          sector?: string | null
          tax_id?: string | null
          tax_id_kind?: Database["public"]["Enums"]["tax_id_kind"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          external_id?: string | null
          id?: string
          imported_source_id?: string | null
          is_business?: boolean
          legal_name?: string | null
          notes?: string | null
          org_id?: string
          owner_member_id?: string | null
          payment_terms_days?: number | null
          postal_code?: string | null
          preferred_language?: Database["public"]["Enums"]["app_locale"]
          province?: string | null
          sector?: string | null
          tax_id?: string | null
          tax_id_kind?: Database["public"]["Enums"]["tax_id_kind"]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_org_id_imported_source_id_fkey"
            columns: ["org_id", "imported_source_id"]
            isOneToOne: false
            referencedRelation: "acquisition_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          is_billing: boolean
          is_primary: boolean
          notes: string | null
          org_id: string
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_billing?: boolean
          is_primary?: boolean
          notes?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_billing?: boolean
          is_primary?: boolean
          notes?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contacts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_issuers: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          issuer_id: string
          org_id: string
          transfer_id: string | null
          updated_at: string
          valid_from: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          issuer_id: string
          org_id: string
          transfer_id?: string | null
          updated_at?: string
          valid_from: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issuer_id?: string
          org_id?: string
          transfer_id?: string | null
          updated_at?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_issuers_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_issuers_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_issuers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_issuers_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_issuers_org_id_transfer_id_fkey"
            columns: ["org_id", "transfer_id"]
            isOneToOne: false
            referencedRelation: "issuer_transfers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contract_line_pauses: {
        Row: {
          created_at: string
          created_by: string | null
          ends_on: string | null
          id: string
          line_id: string
          org_id: string
          reason: string | null
          starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          id?: string
          line_id: string
          org_id: string
          reason?: string | null
          starts_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          id?: string
          line_id?: string
          org_id?: string
          reason?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_line_pauses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_line_pauses_org_id_line_id_fkey"
            columns: ["org_id", "line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_line_pauses_org_id_line_id_fkey"
            columns: ["org_id", "line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contract_lines: {
        Row: {
          billing_day: number | null
          billing_type: Database["public"]["Enums"]["billing_type"]
          cancel_reason: string | null
          cancelled_on: string | null
          contract_id: string
          created_at: string
          created_by: string | null
          description: string
          discount_bps: number
          ends_on: string | null
          id: string
          irpf_applies: boolean
          org_id: string
          position: number
          prorate_first: boolean
          quantity: number
          replaces_line_id: string | null
          starts_on: string | null
          tax_rate_id: string
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          billing_day?: number | null
          billing_type: Database["public"]["Enums"]["billing_type"]
          cancel_reason?: string | null
          cancelled_on?: string | null
          contract_id: string
          created_at?: string
          created_by?: string | null
          description: string
          discount_bps?: number
          ends_on?: string | null
          id?: string
          irpf_applies?: boolean
          org_id: string
          position?: number
          prorate_first?: boolean
          quantity?: number
          replaces_line_id?: string | null
          starts_on?: string | null
          tax_rate_id: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          billing_day?: number | null
          billing_type?: Database["public"]["Enums"]["billing_type"]
          cancel_reason?: string | null
          cancelled_on?: string | null
          contract_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_bps?: number
          ends_on?: string | null
          id?: string
          irpf_applies?: boolean
          org_id?: string
          position?: number
          prorate_first?: boolean
          quantity?: number
          replaces_line_id?: string | null
          starts_on?: string | null
          tax_rate_id?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_lines_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_replaces_line_id_fkey"
            columns: ["org_id", "replaces_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_replaces_line_id_fkey"
            columns: ["org_id", "replaces_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_tax_rate_id_fkey"
            columns: ["org_id", "tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contract_milestones: {
        Row: {
          auto: boolean
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          org_id: string
          percent_bps: number
          planned_on: string | null
          position: number
          updated_at: string
        }
        Insert: {
          auto?: boolean
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          org_id: string
          percent_bps: number
          planned_on?: string | null
          position: number
          updated_at?: string
        }
        Update: {
          auto?: boolean
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          org_id?: string
          percent_bps?: number
          planned_on?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_milestones_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_milestones_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_milestones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          id: string
          invoice_grouping: Database["public"]["Enums"]["invoice_grouping"]
          notes: string | null
          org_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_terms_days: number | null
          signed_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          invoice_grouping?: Database["public"]["Enums"]["invoice_grouping"]
          notes?: string | null
          org_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_terms_days?: number | null
          signed_on?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          invoice_grouping?: Database["public"]["Enums"]["invoice_grouping"]
          notes?: string | null
          org_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_terms_days?: number | null
          signed_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contracts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contracts_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "contracts_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          deal_id: string
          from_stage_id: string | null
          id: number
          org_id: string
          to_stage_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          deal_id: string
          from_stage_id?: string | null
          id?: never
          org_id: string
          to_stage_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          deal_id?: string
          from_stage_id?: string | null
          id?: never
          org_id?: string
          to_stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_history_org_id_deal_id_fkey"
            columns: ["org_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deal_stage_history_org_id_deal_id_fkey"
            columns: ["org_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deal_stage_history_org_id_from_stage_id_fkey"
            columns: ["org_id", "from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deal_stage_history_org_id_to_stage_id_fkey"
            columns: ["org_id", "to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      deals: {
        Row: {
          archived_at: string | null
          brought_by_member_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          est_mrr_cents: number
          est_one_off_cents: number
          id: string
          loss_note: string | null
          loss_reason_id: string | null
          next_action: string | null
          next_action_on: string | null
          org_id: string
          owner_member_id: string | null
          probability_bps: number | null
          source_id: string | null
          stage_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          brought_by_member_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          est_mrr_cents?: number
          est_one_off_cents?: number
          id?: string
          loss_note?: string | null
          loss_reason_id?: string | null
          next_action?: string | null
          next_action_on?: string | null
          org_id: string
          owner_member_id?: string | null
          probability_bps?: number | null
          source_id?: string | null
          stage_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          brought_by_member_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          est_mrr_cents?: number
          est_one_off_cents?: number
          id?: string
          loss_note?: string | null
          loss_reason_id?: string | null
          next_action?: string | null
          next_action_on?: string | null
          org_id?: string
          owner_member_id?: string | null
          probability_bps?: number | null
          source_id?: string | null
          stage_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_org_id_brought_by_member_id_fkey"
            columns: ["org_id", "brought_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_loss_reason_id_fkey"
            columns: ["org_id", "loss_reason_id"]
            isOneToOne: false
            referencedRelation: "loss_reasons"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_source_id_fkey"
            columns: ["org_id", "source_id"]
            isOneToOne: false
            referencedRelation: "acquisition_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_stage_id_fkey"
            columns: ["org_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      integrations: {
        Row: {
          account_email: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          org_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_encrypted: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        Insert: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          org_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_encrypted?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Update: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          org_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          refresh_token_encrypted?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          base_cents: number
          billing_type: Database["public"]["Enums"]["billing_type"]
          contract_line_id: string | null
          created_at: string
          created_by: string | null
          description: string
          discount_bps: number
          id: string
          invoice_id: string
          irpf_applies: boolean
          irpf_cents: number
          legal_note: string | null
          org_id: string
          period_end: string | null
          period_start: string | null
          position: number
          quantity: number
          rectifies_line_id: string | null
          tax_rate_id: string | null
          unit_price_cents: number
          updated_at: string
          vat_bps: number
          vat_cents: number
          vat_regime: Database["public"]["Enums"]["vat_regime"]
        }
        Insert: {
          base_cents: number
          billing_type: Database["public"]["Enums"]["billing_type"]
          contract_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          discount_bps?: number
          id?: string
          invoice_id: string
          irpf_applies?: boolean
          irpf_cents?: number
          legal_note?: string | null
          org_id: string
          period_end?: string | null
          period_start?: string | null
          position?: number
          quantity: number
          rectifies_line_id?: string | null
          tax_rate_id?: string | null
          unit_price_cents: number
          updated_at?: string
          vat_bps: number
          vat_cents: number
          vat_regime?: Database["public"]["Enums"]["vat_regime"]
        }
        Update: {
          base_cents?: number
          billing_type?: Database["public"]["Enums"]["billing_type"]
          contract_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          discount_bps?: number
          id?: string
          invoice_id?: string
          irpf_applies?: boolean
          irpf_cents?: number
          legal_note?: string | null
          org_id?: string
          period_end?: string | null
          period_start?: string | null
          position?: number
          quantity?: number
          rectifies_line_id?: string | null
          tax_rate_id?: string | null
          unit_price_cents?: number
          updated_at?: string
          vat_bps?: number
          vat_cents?: number
          vat_regime?: Database["public"]["Enums"]["vat_regime"]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_rectifies_line_id_fkey"
            columns: ["org_id", "rectifies_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_tax_rate_id_fkey"
            columns: ["org_id", "tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      invoice_series: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          created_by: string | null
          format: string
          id: string
          is_default: boolean
          issuer_id: string
          kind: Database["public"]["Enums"]["series_kind"]
          name: string
          org_id: string
          provider_series_ref: string | null
          reset_yearly: boolean
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          is_default?: boolean
          issuer_id: string
          kind?: Database["public"]["Enums"]["series_kind"]
          name: string
          org_id: string
          provider_series_ref?: string | null
          reset_yearly?: boolean
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          format?: string
          id?: string
          is_default?: boolean
          issuer_id?: string
          kind?: Database["public"]["Enums"]["series_kind"]
          name?: string
          org_id?: string
          provider_series_ref?: string | null
          reset_yearly?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_series_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_series_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          client_snapshot: Json | null
          contract_id: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          external_id: string | null
          fiscal_provider: Database["public"]["Enums"]["fiscal_provider"]
          fiscal_year: number | null
          grouping_key: string | null
          id: string
          irpf_bps: number
          irpf_cents: number
          issued_at: string | null
          issued_on: string | null
          issuer_id: string
          issuer_snapshot: Json | null
          issuing_started_at: string | null
          kind: Database["public"]["Enums"]["series_kind"]
          language: Database["public"]["Enums"]["app_locale"]
          lifecycle: Database["public"]["Enums"]["invoice_lifecycle"]
          notes: string | null
          number: string | null
          operation_on: string | null
          org_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_terms_days: number | null
          pdf_path: string | null
          provider_payload: Json | null
          provider_ref: string | null
          rectification_reason: string | null
          rectifies_invoice_id: string | null
          sequence: number | null
          series_id: string | null
          source: Database["public"]["Enums"]["invoice_source"]
          subtotal_cents: number
          total_cents: number
          updated_at: string
          vat_cents: number
        }
        Insert: {
          client_id: string
          client_snapshot?: Json | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          external_id?: string | null
          fiscal_provider?: Database["public"]["Enums"]["fiscal_provider"]
          fiscal_year?: number | null
          grouping_key?: string | null
          id?: string
          irpf_bps?: number
          irpf_cents?: number
          issued_at?: string | null
          issued_on?: string | null
          issuer_id: string
          issuer_snapshot?: Json | null
          issuing_started_at?: string | null
          kind?: Database["public"]["Enums"]["series_kind"]
          language?: Database["public"]["Enums"]["app_locale"]
          lifecycle?: Database["public"]["Enums"]["invoice_lifecycle"]
          notes?: string | null
          number?: string | null
          operation_on?: string | null
          org_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_terms_days?: number | null
          pdf_path?: string | null
          provider_payload?: Json | null
          provider_ref?: string | null
          rectification_reason?: string | null
          rectifies_invoice_id?: string | null
          sequence?: number | null
          series_id?: string | null
          source?: Database["public"]["Enums"]["invoice_source"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          vat_cents?: number
        }
        Update: {
          client_id?: string
          client_snapshot?: Json | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          external_id?: string | null
          fiscal_provider?: Database["public"]["Enums"]["fiscal_provider"]
          fiscal_year?: number | null
          grouping_key?: string | null
          id?: string
          irpf_bps?: number
          irpf_cents?: number
          issued_at?: string | null
          issued_on?: string | null
          issuer_id?: string
          issuer_snapshot?: Json | null
          issuing_started_at?: string | null
          kind?: Database["public"]["Enums"]["series_kind"]
          language?: Database["public"]["Enums"]["app_locale"]
          lifecycle?: Database["public"]["Enums"]["invoice_lifecycle"]
          notes?: string | null
          number?: string | null
          operation_on?: string | null
          org_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_terms_days?: number | null
          pdf_path?: string | null
          provider_payload?: Json | null
          provider_ref?: string | null
          rectification_reason?: string | null
          rectifies_invoice_id?: string | null
          sequence?: number | null
          series_id?: string | null
          source?: Database["public"]["Enums"]["invoice_source"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          vat_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "invoices_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_rectifies_invoice_id_fkey"
            columns: ["org_id", "rectifies_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_rectifies_invoice_id_fkey"
            columns: ["org_id", "rectifies_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_series_id_fkey"
            columns: ["org_id", "series_id"]
            isOneToOne: false
            referencedRelation: "invoice_series"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      issuer_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          effective_on: string
          executed_at: string
          from_issuer_id: string
          id: string
          notes: string | null
          org_id: string
          to_issuer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_on: string
          executed_at?: string
          from_issuer_id: string
          id?: string
          notes?: string | null
          org_id: string
          to_issuer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_on?: string
          executed_at?: string
          from_issuer_id?: string
          id?: string
          notes?: string | null
          org_id?: string
          to_issuer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issuer_transfers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issuer_transfers_org_id_from_issuer_id_fkey"
            columns: ["org_id", "from_issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "issuer_transfers_org_id_to_issuer_id_fkey"
            columns: ["org_id", "to_issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      issuers: {
        Row: {
          active_from: string | null
          active_until: string | null
          address_line: string | null
          archived_at: string | null
          city: string | null
          country_code: string
          created_at: string
          created_by: string | null
          default_irpf_bps: number
          email: string | null
          fiscal_provider: Database["public"]["Enums"]["fiscal_provider"]
          iban: string | null
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["issuer_kind"]
          legal_name: string
          logo_path: string | null
          member_id: string | null
          org_id: string
          phone: string | null
          postal_code: string | null
          provider_config: Json
          province: string | null
          registry_info: string | null
          tax_id: string | null
          trade_name: string | null
          updated_at: string
          verifactu_from: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          address_line?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_irpf_bps?: number
          email?: string | null
          fiscal_provider?: Database["public"]["Enums"]["fiscal_provider"]
          iban?: string | null
          id?: string
          is_primary?: boolean
          kind: Database["public"]["Enums"]["issuer_kind"]
          legal_name: string
          logo_path?: string | null
          member_id?: string | null
          org_id: string
          phone?: string | null
          postal_code?: string | null
          provider_config?: Json
          province?: string | null
          registry_info?: string | null
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          verifactu_from: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          address_line?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_irpf_bps?: number
          email?: string | null
          fiscal_provider?: Database["public"]["Enums"]["fiscal_provider"]
          iban?: string | null
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["issuer_kind"]
          legal_name?: string
          logo_path?: string | null
          member_id?: string | null
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          provider_config?: Json
          province?: string | null
          registry_info?: string | null
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
          verifactu_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "issuers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issuers_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: number
          job: string
          org_id: string
          run_on: string
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
          summary: Json | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: never
          job: string
          org_id: string
          run_on: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          summary?: Json | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: never
          job?: string
          org_id?: string
          run_on?: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          full_name: string | null
          id: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          initials: string
          is_active: boolean
          locale: Database["public"]["Enums"]["app_locale"]
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          initials: string
          is_active?: boolean
          locale?: Database["public"]["Enums"]["app_locale"]
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          initials?: string
          is_active?: boolean
          locale?: Database["public"]["Enums"]["app_locale"]
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_snapshots: {
        Row: {
          active_clients: number
          arr_cents: number
          churn_mrr_cents: number
          computed_at: string
          contraction_mrr_cents: number
          definition_version: number
          expansion_mrr_cents: number
          id: string
          is_estimated: boolean
          month: string
          mrr_cents: number
          new_mrr_cents: number
          org_id: string
          outstanding_cents: number
          overdue_cents: number
          revenue_one_off_cents: number
          revenue_recurring_cents: number
          revenue_usage_cents: number
          weighted_pipeline_mrr_cents: number
          weighted_pipeline_one_off_cents: number
        }
        Insert: {
          active_clients: number
          arr_cents: number
          churn_mrr_cents: number
          computed_at?: string
          contraction_mrr_cents: number
          definition_version: number
          expansion_mrr_cents: number
          id?: string
          is_estimated?: boolean
          month: string
          mrr_cents: number
          new_mrr_cents: number
          org_id: string
          outstanding_cents: number
          overdue_cents: number
          revenue_one_off_cents: number
          revenue_recurring_cents: number
          revenue_usage_cents: number
          weighted_pipeline_mrr_cents: number
          weighted_pipeline_one_off_cents: number
        }
        Update: {
          active_clients?: number
          arr_cents?: number
          churn_mrr_cents?: number
          computed_at?: string
          contraction_mrr_cents?: number
          definition_version?: number
          expansion_mrr_cents?: number
          id?: string
          is_estimated?: boolean
          month?: string
          mrr_cents?: number
          new_mrr_cents?: number
          org_id?: string
          outstanding_cents?: number
          overdue_cents?: number
          revenue_one_off_cents?: number
          revenue_recurring_cents?: number
          revenue_usage_cents?: number
          weighted_pipeline_mrr_cents?: number
          weighted_pipeline_one_off_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "metrics_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string
          due_on: string | null
          href: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          member_id: string | null
          org_id: string
          params: Json
          read_at: string | null
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          due_on?: string | null
          href?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          member_id?: string | null
          org_id: string
          params?: Json
          read_at?: string | null
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          due_on?: string | null
          href?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          member_id?: string | null
          org_id?: string
          params?: Json
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      orgs: {
        Row: {
          branding: Json
          created_at: string
          created_by: string | null
          currency: string
          id: string
          locale: string
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          locale?: string
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          locale?: string
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_emails: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attach_pdf: boolean
          body: string
          client_id: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          error: string | null
          id: string
          invoice_id: string | null
          language: Database["public"]["Enums"]["app_locale"]
          org_id: string
          provider_message_id: string | null
          quote_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_status"]
          subject: string
          template: Database["public"]["Enums"]["email_template"]
          to_emails: string[]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attach_pdf?: boolean
          body: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          error?: string | null
          id?: string
          invoice_id?: string | null
          language?: Database["public"]["Enums"]["app_locale"]
          org_id: string
          provider_message_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject: string
          template: Database["public"]["Enums"]["email_template"]
          to_emails?: string[]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attach_pdf?: boolean
          body?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          error?: string | null
          id?: string
          invoice_id?: string | null
          language?: Database["public"]["Enums"]["app_locale"]
          org_id?: string
          provider_message_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          subject?: string
          template?: Database["public"]["Enums"]["email_template"]
          to_emails?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_emails_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "outbound_emails_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "outbound_emails_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_emails_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "outbound_emails_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "outbound_emails_quote_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "outbound_emails_quote_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          org_id: string
          paid_on: string
          provider_ref: string | null
          reference: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id: string
          paid_on: string
          provider_ref?: string | null
          reference?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id?: string
          paid_on?: string
          provider_ref?: string | null
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payments_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          default_probability_bps: number
          id: string
          kind: Database["public"]["Enums"]["stage_kind"]
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          default_probability_bps?: number
          id?: string
          kind?: Database["public"]["Enums"]["stage_kind"]
          name: string
          org_id: string
          position: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          default_probability_bps?: number
          id?: string
          kind?: Database["public"]["Enums"]["stage_kind"]
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          base_cents: number
          billing_day: number | null
          billing_type: Database["public"]["Enums"]["billing_type"]
          contract_line_id: string | null
          created_at: string
          created_by: string | null
          description: string
          discount_bps: number
          ends_on: string | null
          id: string
          irpf_applies: boolean
          org_id: string
          position: number
          prorate_first: boolean
          quantity: number
          quote_id: string
          starts_on: string | null
          tax_rate_id: string
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          base_cents: number
          billing_day?: number | null
          billing_type: Database["public"]["Enums"]["billing_type"]
          contract_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          discount_bps?: number
          ends_on?: string | null
          id?: string
          irpf_applies?: boolean
          org_id: string
          position?: number
          prorate_first?: boolean
          quantity?: number
          quote_id: string
          starts_on?: string | null
          tax_rate_id: string
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          base_cents?: number
          billing_day?: number | null
          billing_type?: Database["public"]["Enums"]["billing_type"]
          contract_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          discount_bps?: number
          ends_on?: string | null
          id?: string
          irpf_applies?: boolean
          org_id?: string
          position?: number
          prorate_first?: boolean
          quantity?: number
          quote_id?: string
          starts_on?: string | null
          tax_rate_id?: string
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_lines_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_lines_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_lines_org_id_tax_rate_id_fkey"
            columns: ["org_id", "tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          client_id: string
          contract_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          id: string
          issued_on: string | null
          issuer_id: string
          language: Database["public"]["Enums"]["app_locale"]
          notes: string | null
          number: string | null
          org_id: string
          payment_plan: Json
          rejected_at: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["quote_status"]
          title: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          issued_on?: string | null
          issuer_id: string
          language?: Database["public"]["Enums"]["app_locale"]
          notes?: string | null
          number?: string | null
          org_id: string
          payment_plan?: Json
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          id?: string
          issued_on?: string | null
          issuer_id?: string
          language?: Database["public"]["Enums"]["app_locale"]
          notes?: string | null
          number?: string | null
          org_id?: string
          payment_plan?: Json
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quotes_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quotes_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      seo_daily_metrics: {
        Row: {
          clicks: number
          ctr_bps: number | null
          impressions: number
          metric_on: string
          org_id: string
          position: number | null
          property_id: string
          source: Database["public"]["Enums"]["seo_source"]
        }
        Insert: {
          clicks: number
          ctr_bps?: number | null
          impressions: number
          metric_on: string
          org_id: string
          position?: number | null
          property_id: string
          source: Database["public"]["Enums"]["seo_source"]
        }
        Update: {
          clicks?: number
          ctr_bps?: number | null
          impressions?: number
          metric_on?: string
          org_id?: string
          position?: number | null
          property_id?: string
          source?: Database["public"]["Enums"]["seo_source"]
        }
        Relationships: [
          {
            foreignKeyName: "seo_daily_metrics_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_daily_metrics_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      seo_properties: {
        Row: {
          archived_at: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          ga4_property_id: string | null
          gsc_site_url: string | null
          id: string
          is_primary: boolean
          label: string
          org_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ga4_property_id?: string | null
          gsc_site_url?: string | null
          id?: string
          is_primary?: boolean
          label: string
          org_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ga4_property_id?: string | null
          gsc_site_url?: string | null
          id?: string
          is_primary?: boolean
          label?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_properties_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_properties_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_query_daily: {
        Row: {
          clicks: number
          impressions: number
          key_hash: string
          metric_on: string
          org_id: string
          page: string
          position: number | null
          property_id: string
          query: string
          source: Database["public"]["Enums"]["seo_source"]
        }
        Insert: {
          clicks: number
          impressions: number
          key_hash?: string
          metric_on: string
          org_id: string
          page: string
          position?: number | null
          property_id: string
          query: string
          source: Database["public"]["Enums"]["seo_source"]
        }
        Update: {
          clicks?: number
          impressions?: number
          key_hash?: string
          metric_on?: string
          org_id?: string
          page?: string
          position?: number | null
          property_id?: string
          query?: string
          source?: Database["public"]["Enums"]["seo_source"]
        }
        Relationships: [
          {
            foreignKeyName: "seo_query_daily_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_query_daily_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      seo_sync_state: {
        Row: {
          last_error: string | null
          last_run_at: string | null
          org_id: string
          property_id: string
          provider: Database["public"]["Enums"]["seo_source"]
          synced_from: string | null
          synced_to: string | null
        }
        Insert: {
          last_error?: string | null
          last_run_at?: string | null
          org_id: string
          property_id: string
          provider: Database["public"]["Enums"]["seo_source"]
          synced_from?: string | null
          synced_to?: string | null
        }
        Update: {
          last_error?: string | null
          last_run_at?: string | null
          org_id?: string
          property_id?: string
          provider?: Database["public"]["Enums"]["seo_source"]
          synced_from?: string | null
          synced_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_sync_state_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_sync_state_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["tax_kind"]
          legal_note: string | null
          name: string
          org_id: string
          position: number
          rate_bps: number
          regime: Database["public"]["Enums"]["vat_regime"] | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind: Database["public"]["Enums"]["tax_kind"]
          legal_note?: string | null
          name: string
          org_id: string
          position?: number
          rate_bps: number
          regime?: Database["public"]["Enums"]["vat_regime"] | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["tax_kind"]
          legal_note?: string | null
          name?: string
          org_id?: string
          position?: number
          rate_bps?: number
          regime?: Database["public"]["Enums"]["vat_regime"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      web_analytics_daily: {
        Row: {
          channel: Database["public"]["Enums"]["web_channel"]
          conversions: number
          engaged_sessions: number
          metric_on: string
          org_id: string
          property_id: string
          sessions: number
          source: Database["public"]["Enums"]["seo_source"]
          users: number
        }
        Insert: {
          channel: Database["public"]["Enums"]["web_channel"]
          conversions: number
          engaged_sessions: number
          metric_on: string
          org_id: string
          property_id: string
          sessions: number
          source: Database["public"]["Enums"]["seo_source"]
          users: number
        }
        Update: {
          channel?: Database["public"]["Enums"]["web_channel"]
          conversions?: number
          engaged_sessions?: number
          metric_on?: string
          org_id?: string
          property_id?: string
          sessions?: number
          source?: Database["public"]["Enums"]["seo_source"]
          users?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_analytics_daily_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "web_analytics_daily_org_id_property_id_fkey"
            columns: ["org_id", "property_id"]
            isOneToOne: false
            referencedRelation: "seo_properties_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
    }
    Views: {
      billable_items_overview: {
        Row: {
          amount_cents: number | null
          billable_on: string | null
          billing_type: Database["public"]["Enums"]["billing_type"] | null
          client_id: string | null
          client_name: string | null
          contract_id: string | null
          contract_line_id: string | null
          contract_title: string | null
          created_at: string | null
          description: string | null
          discount_bps: number | null
          id: string | null
          invoice_id: string | null
          invoice_line_id: string | null
          invoice_number: string | null
          milestone_id: string | null
          org_id: string | null
          period_end: string | null
          period_start: string | null
          quantity: number | null
          source: Database["public"]["Enums"]["billable_source"] | null
          state: Database["public"]["Enums"]["billable_state"] | null
          unit_price_cents: number | null
          waive_reason: string | null
          waived_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billable_items_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_contract_line_id_fkey"
            columns: ["org_id", "contract_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billable_items_org_id_invoice_line_id_fkey"
            columns: ["org_id", "invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billable_items_org_id_milestone_id_fkey"
            columns: ["org_id", "milestone_id"]
            isOneToOne: false
            referencedRelation: "contract_milestones"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_timeline: {
        Row: {
          at: string | null
          body: string | null
          client_id: string | null
          deal_id: string | null
          event_id: string | null
          kind: string | null
          member_id: string | null
          meta: Json | null
          org_id: string | null
          title: string | null
        }
        Relationships: []
      }
      clients_overview: {
        Row: {
          acquisition_source_id: string | null
          archived_at: string | null
          billed_net_cents: number | null
          city: string | null
          created_at: string | null
          deals_count: number | null
          display_name: string | null
          first_invoice_on: string | null
          id: string | null
          last_activity_at: string | null
          legal_name: string | null
          org_id: string | null
          owner_initials: string | null
          owner_member_id: string | null
          sector: string | null
          status: Database["public"]["Enums"]["client_status"] | null
          tax_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contract_lines_overview: {
        Row: {
          billed_items_count: number | null
          billed_until: string | null
          billing_day: number | null
          billing_type: Database["public"]["Enums"]["billing_type"] | null
          cancel_reason: string | null
          cancelled_on: string | null
          client_id: string | null
          contract_id: string | null
          created_at: string | null
          description: string | null
          discount_bps: number | null
          ends_on: string | null
          id: string | null
          irpf_applies: boolean | null
          org_id: string | null
          position: number | null
          prorate_first: boolean | null
          quantity: number | null
          replaces_line_id: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["line_status"] | null
          tax_rate_id: string | null
          unit_price_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_lines_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_contract_id_fkey"
            columns: ["org_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_replaces_line_id_fkey"
            columns: ["org_id", "replaces_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_replaces_line_id_fkey"
            columns: ["org_id", "replaces_line_id"]
            isOneToOne: false
            referencedRelation: "contract_lines_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contract_lines_org_id_tax_rate_id_fkey"
            columns: ["org_id", "tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      contracts_overview: {
        Row: {
          archived_at: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          deal_id: string | null
          ends_on: string | null
          id: string | null
          invoice_grouping:
            | Database["public"]["Enums"]["invoice_grouping"]
            | null
          issuer_id: string | null
          lines_count: number | null
          notes: string | null
          org_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_terms_days: number | null
          signed_on: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["contract_status"] | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contracts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "contracts_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "contracts_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      deals_board: {
        Row: {
          brought_by_member_id: string | null
          client_id: string | null
          client_name: string | null
          closed_at: string | null
          created_at: string | null
          est_mrr_cents: number | null
          est_one_off_cents: number | null
          id: string | null
          loss_note: string | null
          loss_reason_id: string | null
          next_action: string | null
          next_action_on: string | null
          org_id: string | null
          owner_initials: string | null
          owner_member_id: string | null
          probability_bps: number | null
          probability_override_bps: number | null
          source_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          stage_kind: Database["public"]["Enums"]["stage_kind"] | null
          stage_position: number | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_org_id_brought_by_member_id_fkey"
            columns: ["org_id", "brought_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_loss_reason_id_fkey"
            columns: ["org_id", "loss_reason_id"]
            isOneToOne: false
            referencedRelation: "loss_reasons"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_source_id_fkey"
            columns: ["org_id", "source_id"]
            isOneToOne: false
            referencedRelation: "acquisition_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "deals_org_id_stage_id_fkey"
            columns: ["org_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      invoices_overview: {
        Row: {
          client_id: string | null
          client_name: string | null
          contract_id: string | null
          created_at: string | null
          due_on: string | null
          grouping_key: string | null
          id: string | null
          irpf_bps: number | null
          irpf_cents: number | null
          issued_at: string | null
          issued_on: string | null
          issuer_id: string | null
          issuer_name: string | null
          kind: Database["public"]["Enums"]["series_kind"] | null
          language: Database["public"]["Enums"]["app_locale"] | null
          last_paid_on: string | null
          lifecycle: Database["public"]["Enums"]["invoice_lifecycle"] | null
          lines_count: number | null
          net_total_cents: number | null
          number: string | null
          org_id: string | null
          outstanding_cents: number | null
          paid_cents: number | null
          pdf_path: string | null
          rectified_cents: number | null
          rectifies_invoice_id: string | null
          series_code: string | null
          series_id: string | null
          source: Database["public"]["Enums"]["invoice_source"] | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          subtotal_cents: number | null
          total_cents: number | null
          updated_at: string | null
          vat_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "invoices_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_rectifies_invoice_id_fkey"
            columns: ["org_id", "rectifies_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_rectifies_invoice_id_fkey"
            columns: ["org_id", "rectifies_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_series_id_fkey"
            columns: ["org_id", "series_id"]
            isOneToOne: false
            referencedRelation: "invoice_series"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      quotes_overview: {
        Row: {
          accepted_at: string | null
          client_id: string | null
          client_name: string | null
          contract_id: string | null
          created_at: string | null
          deal_id: string | null
          deal_title: string | null
          id: string | null
          issued_on: string | null
          issuer_id: string | null
          issuer_name: string | null
          language: Database["public"]["Enums"]["app_locale"] | null
          lines_count: number | null
          monthly_cents: number | null
          number: string | null
          one_off_cents: number | null
          org_id: string | null
          rejected_at: string | null
          state: Database["public"]["Enums"]["quote_state"] | null
          status: Database["public"]["Enums"]["quote_status"] | null
          title: string | null
          updated_at: string | null
          usage_lines_count: number | null
          valid_until: string | null
          yearly_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quotes_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quotes_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_deal_id_client_id_fkey"
            columns: ["org_id", "deal_id", "client_id"]
            isOneToOne: false
            referencedRelation: "deals_board"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "quotes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      revenue_by_client_month: {
        Row: {
          base_cents: number | null
          client_id: string | null
          month: string | null
          org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_by_month: {
        Row: {
          base_cents: number | null
          billing_type: Database["public"]["Enums"]["billing_type"] | null
          month: string | null
          org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_properties_overview: {
        Row: {
          archived_at: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          first_metric_on: string | null
          first_web_on: string | null
          ga4_last_error: string | null
          ga4_last_run_at: string | null
          ga4_property_id: string | null
          ga4_synced_from: string | null
          ga4_synced_to: string | null
          gsc_last_error: string | null
          gsc_last_run_at: string | null
          gsc_site_url: string | null
          gsc_synced_from: string | null
          gsc_synced_to: string | null
          id: string | null
          is_primary: boolean | null
          label: string | null
          last_metric_on: string | null
          last_web_on: string | null
          metric_source: Database["public"]["Enums"]["seo_source"] | null
          org_id: string | null
          web_source: Database["public"]["Enums"]["seo_source"] | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_properties_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_properties_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "seo_properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_pending_invitations: { Args: never; Returns: number }
      accept_quote: { Args: { p_quote_id: string }; Returns: string }
      apply_billing_run: { Args: { p: Json }; Returns: Json }
      client_statuses_on: {
        Args: { p_on: string; p_org: string }
        Returns: {
          client_id: string
          status: Database["public"]["Enums"]["client_status"]
        }[]
      }
      connect_integration: {
        Args: {
          p_account_email: string
          p_org: string
          p_provider: Database["public"]["Enums"]["integration_provider"]
          p_scopes: string[]
          p_secret: string
        }
        Returns: string
      }
      create_contract: { Args: { p: Json }; Returns: string }
      create_organization: { Args: { p: Json }; Returns: string }
      create_rectification: {
        Args: { p_full?: boolean; p_invoice_id: string; p_reason: string }
        Returns: string
      }
      disconnect_integration: {
        Args: {
          p_org: string
          p_provider: Database["public"]["Enums"]["integration_provider"]
        }
        Returns: undefined
      }
      finalize_quote: { Args: { p_quote_id: string }; Returns: Json }
      invoice_next_number: {
        Args: { p_invoice_id: string; p_issued_on?: string }
        Returns: string
      }
      issue_invoice_begin: {
        Args: { p_invoice_id: string; p_issued_on?: string }
        Returns: Json
      }
      issue_invoice_complete: {
        Args: { p: Json; p_invoice_id: string }
        Returns: undefined
      }
      new_line_version: {
        Args: { p: Json; p_from: string; p_line_id: string }
        Returns: string
      }
      open_deals_on: {
        Args: { p_on: string; p_org: string }
        Returns: {
          deal_id: string
          est_mrr_cents: number
          est_one_off_cents: number
          probability_bps: number
          stage_id: string
          stage_kind: Database["public"]["Enums"]["stage_kind"]
        }[]
      }
      open_invoices_on: {
        Args: { p_on: string; p_org: string }
        Returns: {
          client_id: string
          due_on: string
          invoice_id: string
          outstanding_cents: number
          status: Database["public"]["Enums"]["invoice_status"]
        }[]
      }
      reject_quote: {
        Args: { p_quote_id: string; p_reason?: string }
        Returns: undefined
      }
      release_invoice_items: {
        Args: { p_invoice_id: string; p_reason?: string; p_waive: boolean }
        Returns: number
      }
      save_contract_milestones: {
        Args: { p: Json; p_contract_id: string }
        Returns: undefined
      }
      save_invoice_draft: { Args: { p: Json }; Returns: string }
      save_quote: { Args: { p: Json }; Returns: string }
      search_org: {
        Args: { p_limit?: number; p_org: string; p_query: string }
        Returns: {
          client_id: string
          id: string
          kind: string
          subtitle: string
          title: string
        }[]
      }
      seo_query_stats: {
        Args: {
          p_compare_from?: string
          p_compare_to?: string
          p_dimension: string
          p_from: string
          p_limit?: number
          p_max_position?: number
          p_min_impressions?: number
          p_min_position?: number
          p_order?: string
          p_property_id: string
          p_to: string
        }
        Returns: {
          avg_position: number
          clicks: number
          compare_avg_position: number
          compare_clicks: number
          compare_impressions: number
          impressions: number
          key: string
        }[]
      }
      series_counters: {
        Args: { p_org: string }
        Returns: {
          last_number: number
          series_id: string
          year: number
        }[]
      }
      set_series_last_number: {
        Args: { p_last_number: number; p_series_id: string; p_year: number }
        Returns: undefined
      }
      update_my_profile: {
        Args: {
          p_full_name: string
          p_initials: string
          p_locale: Database["public"]["Enums"]["app_locale"]
          p_org: string
        }
        Returns: undefined
      }
    }
    Enums: {
      activity_kind: "call" | "meeting" | "email" | "note"
      app_locale: "es" | "ca" | "en"
      billable_source: "recurring" | "usage" | "milestone"
      billable_state: "pending" | "drafted" | "invoiced" | "waived"
      billing_type: "one_off" | "monthly" | "yearly" | "usage"
      client_status: "lead" | "active" | "paused" | "former"
      contract_status: "draft" | "scheduled" | "active" | "paused" | "ended"
      email_status: "pending_approval" | "sent" | "failed" | "cancelled"
      email_template: "invoice" | "payment_reminder" | "quote"
      fiscal_provider: "internal"
      integration_provider: "google"
      integration_status: "connected" | "error" | "disconnected"
      invoice_grouping: "client" | "contract"
      invoice_lifecycle: "draft" | "issuing" | "issued"
      invoice_source: "app" | "import"
      invoice_status:
        | "draft"
        | "issuing"
        | "issued"
        | "overdue"
        | "paid"
        | "voided"
      issuer_kind: "company" | "self_employed"
      job_status: "running" | "succeeded" | "failed"
      line_status: "scheduled" | "active" | "paused" | "ended"
      member_role: "viewer" | "partner" | "owner"
      notification_kind:
        | "renewal"
        | "reminder_ready"
        | "job_failed"
        | "verifactu_deadline"
      payment_method: "transfer" | "sepa_debit" | "card" | "cash" | "other"
      quote_state: "draft" | "sent" | "expired" | "accepted" | "rejected"
      quote_status: "draft" | "sent" | "accepted" | "rejected"
      seo_source: "gsc" | "ga4" | "demo"
      series_kind: "ordinary" | "rectifying"
      stage_kind: "open" | "won" | "lost"
      tax_id_kind: "es" | "eu_vat" | "foreign"
      tax_kind: "vat" | "irpf"
      vat_regime: "general" | "exempt" | "reverse_charge_eu" | "not_subject"
      web_channel: "all" | "organic_search"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_kind: ["call", "meeting", "email", "note"],
      app_locale: ["es", "ca", "en"],
      billable_source: ["recurring", "usage", "milestone"],
      billable_state: ["pending", "drafted", "invoiced", "waived"],
      billing_type: ["one_off", "monthly", "yearly", "usage"],
      client_status: ["lead", "active", "paused", "former"],
      contract_status: ["draft", "scheduled", "active", "paused", "ended"],
      email_status: ["pending_approval", "sent", "failed", "cancelled"],
      email_template: ["invoice", "payment_reminder", "quote"],
      fiscal_provider: ["internal"],
      integration_provider: ["google"],
      integration_status: ["connected", "error", "disconnected"],
      invoice_grouping: ["client", "contract"],
      invoice_lifecycle: ["draft", "issuing", "issued"],
      invoice_source: ["app", "import"],
      invoice_status: [
        "draft",
        "issuing",
        "issued",
        "overdue",
        "paid",
        "voided",
      ],
      issuer_kind: ["company", "self_employed"],
      job_status: ["running", "succeeded", "failed"],
      line_status: ["scheduled", "active", "paused", "ended"],
      member_role: ["viewer", "partner", "owner"],
      notification_kind: [
        "renewal",
        "reminder_ready",
        "job_failed",
        "verifactu_deadline",
      ],
      payment_method: ["transfer", "sepa_debit", "card", "cash", "other"],
      quote_state: ["draft", "sent", "expired", "accepted", "rejected"],
      quote_status: ["draft", "sent", "accepted", "rejected"],
      seo_source: ["gsc", "ga4", "demo"],
      series_kind: ["ordinary", "rectifying"],
      stage_kind: ["open", "won", "lost"],
      tax_id_kind: ["es", "eu_vat", "foreign"],
      tax_kind: ["vat", "irpf"],
      vat_regime: ["general", "exempt", "reverse_charge_eu", "not_subject"],
      web_channel: ["all", "organic_search"],
    },
  },
} as const

