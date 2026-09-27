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
      access_code_attempts: {
        Row: {
          at: string
          id: number
          ip_hash: string
          ok: boolean
          user_id: string | null
        }
        Insert: {
          at?: string
          id?: never
          ip_hash: string
          ok: boolean
          user_id?: string | null
        }
        Update: {
          at?: string
          id?: never
          ip_hash?: string
          ok?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      access_codes: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string | null
          last_used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by?: string | null
          last_used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string | null
          last_used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
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
          client_visible: boolean
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
          client_visible?: boolean
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
          client_visible?: boolean
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
      agent_jobs: {
        Row: {
          agent: Database["public"]["Enums"]["council_agent"]
          attempts: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          org_id: string
          payload: Json
          requested_by: string | null
          run_after: string
          status: Database["public"]["Enums"]["agent_job_status"]
          trigger: string
        }
        Insert: {
          agent: Database["public"]["Enums"]["council_agent"]
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          org_id: string
          payload?: Json
          requested_by?: string | null
          run_after?: string
          status?: Database["public"]["Enums"]["agent_job_status"]
          trigger: string
        }
        Update: {
          agent?: Database["public"]["Enums"]["council_agent"]
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          org_id?: string
          payload?: Json
          requested_by?: string | null
          run_after?: string
          status?: Database["public"]["Enums"]["agent_job_status"]
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent: Database["public"]["Enums"]["council_agent"]
          attempts: number
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd_micros: number
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          input_tokens: number
          job_id: string | null
          model: string | null
          org_id: string
          output: Json | null
          output_tokens: number
          parent_run_id: string | null
          policy_version: number | null
          runtime: string
          started_at: string
          status: Database["public"]["Enums"]["agent_run_status"]
          tool_calls: Json
          trigger: string
        }
        Insert: {
          agent: Database["public"]["Enums"]["council_agent"]
          attempts?: number
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd_micros?: number
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          input_tokens?: number
          job_id?: string | null
          model?: string | null
          org_id: string
          output?: Json | null
          output_tokens?: number
          parent_run_id?: string | null
          policy_version?: number | null
          runtime: string
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          tool_calls?: Json
          trigger: string
        }
        Update: {
          agent?: Database["public"]["Enums"]["council_agent"]
          attempts?: number
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd_micros?: number
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          input_tokens?: number
          job_id?: string | null
          model?: string | null
          org_id?: string
          output?: Json | null
          output_tokens?: number
          parent_run_id?: string | null
          policy_version?: number | null
          runtime?: string
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          tool_calls?: Json
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_org_id_job_id_fkey"
            columns: ["org_id", "job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "agent_runs_org_id_parent_run_id_fkey"
            columns: ["org_id", "parent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      agent_settings: {
        Row: {
          agent: Database["public"]["Enums"]["council_agent"]
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          model: string | null
          monthly_budget_usd_cents: number | null
          org_id: string
          thresholds: Json
          updated_at: string
        }
        Insert: {
          agent: Database["public"]["Enums"]["council_agent"]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          model?: string | null
          monthly_budget_usd_cents?: number | null
          org_id: string
          thresholds?: Json
          updated_at?: string
        }
        Update: {
          agent?: Database["public"]["Enums"]["council_agent"]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          model?: string | null
          monthly_budget_usd_cents?: number | null
          org_id?: string
          thresholds?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
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
      bank_ignores: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          org_id: string
          reason: Database["public"]["Enums"]["bank_ignore_reason"]
          transaction_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          org_id: string
          reason: Database["public"]["Enums"]["bank_ignore_reason"]
          transaction_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          org_id?: string
          reason?: Database["public"]["Enums"]["bank_ignore_reason"]
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_ignores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_ignores_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_ignores_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      bank_matches: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          created_expense: boolean
          created_payment: boolean
          expense_id: string | null
          id: string
          marked_paid: boolean
          org_id: string
          payment_id: string | null
          remittance_id: string | null
          settled_remittance: boolean
          transaction_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          created_expense?: boolean
          created_payment?: boolean
          expense_id?: string | null
          id?: string
          marked_paid?: boolean
          org_id: string
          payment_id?: string | null
          remittance_id?: string | null
          settled_remittance?: boolean
          transaction_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          created_expense?: boolean
          created_payment?: boolean
          expense_id?: string | null
          id?: string
          marked_paid?: boolean
          org_id?: string
          payment_id?: string | null
          remittance_id?: string | null
          settled_remittance?: boolean
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_matches_org_id_expense_id_fkey"
            columns: ["org_id", "expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_expense_id_fkey"
            columns: ["org_id", "expense_id"]
            isOneToOne: false
            referencedRelation: "expenses_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_payment_id_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      bank_rules: {
        Row: {
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["bank_direction"]
          field: Database["public"]["Enums"]["bank_rule_field"]
          id: string
          org_id: string
          pattern: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["bank_direction"]
          field: Database["public"]["Enums"]["bank_rule_field"]
          id?: string
          org_id: string
          pattern: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["bank_direction"]
          field?: Database["public"]["Enums"]["bank_rule_field"]
          id?: string
          org_id?: string
          pattern?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_rules_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_rules_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_rules_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_rules_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_rules_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          file_hash: string
          file_name: string
          format: Database["public"]["Enums"]["bank_statement_format"]
          id: string
          movements_in_file: number
          org_id: string
          period_end: string
          period_start: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          file_hash: string
          file_name: string
          format: Database["public"]["Enums"]["bank_statement_format"]
          id?: string
          movements_in_file: number
          org_id: string
          period_end: string
          period_start: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          file_hash?: string
          file_name?: string
          format?: Database["public"]["Enums"]["bank_statement_format"]
          id?: string
          movements_in_file?: number
          org_id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_statements_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_position"
            referencedColumns: ["org_id", "account_id"]
          },
          {
            foreignKeyName: "bank_statements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string
          amount_cents: number
          balance_after_cents: number | null
          bank_code: string | null
          booked_on: string
          concept: string
          counterparty: string | null
          counterparty_iban: string | null
          created_at: string
          created_by: string | null
          fingerprint: string
          id: string
          org_id: string
          position: number
          reference: string | null
          statement_id: string
          updated_at: string
          value_on: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          balance_after_cents?: number | null
          bank_code?: string | null
          booked_on: string
          concept?: string
          counterparty?: string | null
          counterparty_iban?: string | null
          created_at?: string
          created_by?: string | null
          fingerprint: string
          id?: string
          org_id: string
          position: number
          reference?: string | null
          statement_id: string
          updated_at?: string
          value_on?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          balance_after_cents?: number | null
          bank_code?: string | null
          booked_on?: string
          concept?: string
          counterparty?: string | null
          counterparty_iban?: string | null
          created_at?: string
          created_by?: string | null
          fingerprint?: string
          id?: string
          org_id?: string
          position?: number
          reference?: string | null
          statement_id?: string
          updated_at?: string
          value_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_position"
            referencedColumns: ["org_id", "account_id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_statement_id_account_id_fkey"
            columns: ["org_id", "statement_id", "account_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["org_id", "id", "account_id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_statement_id_account_id_fkey"
            columns: ["org_id", "statement_id", "account_id"]
            isOneToOne: false
            referencedRelation: "bank_statements_overview"
            referencedColumns: ["org_id", "id", "account_id"]
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
            foreignKeyName: "billable_items_org_id_invoice_line_id_fkey"
            columns: ["org_id", "invoice_line_id"]
            isOneToOne: false
            referencedRelation: "project_contract_revenue"
            referencedColumns: ["org_id", "invoice_line_id"]
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
      calendar_feeds: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string | null
          member_id: string
          org_id: string
          revoked_at: string | null
          scope: Database["public"]["Enums"]["calendar_feed_scope"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          member_id: string
          org_id: string
          revoked_at?: string | null
          scope?: Database["public"]["Enums"]["calendar_feed_scope"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          member_id?: string
          org_id?: string
          revoked_at?: string | null
          scope?: Database["public"]["Enums"]["calendar_feed_scope"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feeds_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          iban: string | null
          id: string
          is_active: boolean
          issuer_id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          issuer_id: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          issuer_id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      cash_balances: {
        Row: {
          account_id: string
          balance_cents: number
          balance_on: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          org_id: string
          source: Database["public"]["Enums"]["cash_balance_source"]
          updated_at: string
        }
        Insert: {
          account_id: string
          balance_cents: number
          balance_on: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          org_id: string
          source?: Database["public"]["Enums"]["cash_balance_source"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          balance_cents?: number
          balance_on?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          org_id?: string
          source?: Database["public"]["Enums"]["cash_balance_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_balances_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cash_balances_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_position"
            referencedColumns: ["org_id", "account_id"]
          },
          {
            foreignKeyName: "cash_balances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_bundle_items: {
        Row: {
          bundle_id: string
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          org_id: string
          position: number
          quantity: number | null
          updated_at: string
        }
        Insert: {
          bundle_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          org_id: string
          position?: number
          quantity?: number | null
          updated_at?: string
        }
        Update: {
          bundle_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          org_id?: string
          position?: number
          quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_bundle_items_org_id_bundle_id_fkey"
            columns: ["org_id", "bundle_id"]
            isOneToOne: false
            referencedRelation: "catalog_bundles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "catalog_bundle_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_bundle_items_org_id_item_id_fkey"
            columns: ["org_id", "item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      catalog_bundles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          discount_bps: number
          id: string
          is_active: boolean
          name: string
          org_id: string
          position: number
          translations: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_bps?: number
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          position?: number
          translations?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_bps?: number
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          position?: number
          translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_bundles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          billing_type: Database["public"]["Enums"]["billing_type"]
          category: Database["public"]["Enums"]["catalog_category"]
          created_at: string
          created_by: string | null
          default_quantity: number
          description: string | null
          id: string
          irpf_applies: boolean
          is_active: boolean
          name: string
          org_id: string
          position: number
          tax_rate_id: string
          translations: Json
          unit_label: string | null
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          billing_type: Database["public"]["Enums"]["billing_type"]
          category?: Database["public"]["Enums"]["catalog_category"]
          created_at?: string
          created_by?: string | null
          default_quantity?: number
          description?: string | null
          id?: string
          irpf_applies?: boolean
          is_active?: boolean
          name: string
          org_id: string
          position?: number
          tax_rate_id: string
          translations?: Json
          unit_label?: string | null
          unit_price_cents: number
          updated_at?: string
        }
        Update: {
          billing_type?: Database["public"]["Enums"]["billing_type"]
          category?: Database["public"]["Enums"]["catalog_category"]
          created_at?: string
          created_by?: string | null
          default_quantity?: number
          description?: string | null
          id?: string
          irpf_applies?: boolean
          is_active?: boolean
          name?: string
          org_id?: string
          position?: number
          tax_rate_id?: string
          translations?: Json
          unit_label?: string | null
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_org_id_tax_rate_id_fkey"
            columns: ["org_id", "tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_files: {
        Row: {
          client_id: string
          content_type: string | null
          contract_id: string | null
          created_at: string
          created_by: string | null
          file_name: string | null
          id: string
          kind: Database["public"]["Enums"]["client_file_kind"]
          org_id: string
          size_bytes: number | null
          storage_path: string | null
          title: string
          updated_at: string
          uploaded_at: string | null
          url: string | null
        }
        Insert: {
          client_id: string
          content_type?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          kind: Database["public"]["Enums"]["client_file_kind"]
          org_id: string
          size_bytes?: number | null
          storage_path?: string | null
          title: string
          updated_at?: string
          uploaded_at?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string
          content_type?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["client_file_kind"]
          org_id?: string
          size_bytes?: number | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          uploaded_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_files_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_files_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_files_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "client_files_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "client_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      client_mandates: {
        Row: {
          bic: string | null
          client_id: string
          created_at: string
          created_by: string | null
          debtor_name: string
          iban: string
          id: string
          issuer_id: string
          notes: string | null
          org_id: string
          reference: string
          revoke_reason: string | null
          revoked_at: string | null
          signed_on: string
          updated_at: string
        }
        Insert: {
          bic?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          debtor_name: string
          iban: string
          id?: string
          issuer_id: string
          notes?: string | null
          org_id: string
          reference: string
          revoke_reason?: string | null
          revoked_at?: string | null
          signed_on: string
          updated_at?: string
        }
        Update: {
          bic?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          debtor_name?: string
          iban?: string
          id?: string
          issuer_id?: string
          notes?: string | null
          org_id?: string
          reference?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          signed_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_mandates_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_portal_settings: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          next_steps: string | null
          org_id: string
          sections: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string | null
          org_id: string
          sections?: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string | null
          org_id?: string
          sections?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_settings_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_portal_settings_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: true
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_portal_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      client_receipts: {
        Row: {
          amount_cents: number
          client_id: string
          concept: string
          created_at: string
          created_by: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          org_id: string
          project_id: string | null
          received_on: string
          reference: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          client_id: string
          concept: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id: string
          project_id?: string | null
          received_on: string
          reference?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          client_id?: string
          concept?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id?: string
          project_id?: string | null
          received_on?: string
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_receipts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_receipts_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_receipts_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_receipts_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects_overview"
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
          manual_status:
            | Database["public"]["Enums"]["client_manual_status"]
            | null
          manual_status_at: string | null
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
          manual_status?:
            | Database["public"]["Enums"]["client_manual_status"]
            | null
          manual_status_at?: string | null
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
          manual_status?:
            | Database["public"]["Enums"]["client_manual_status"]
            | null
          manual_status_at?: string | null
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
      council_reports: {
        Row: {
          agent: Database["public"]["Enums"]["council_agent"]
          content: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: Json | null
          decision_note: string | null
          evidence: Json
          id: string
          kind: Database["public"]["Enums"]["council_report_kind"]
          org_id: string
          period_end: string
          period_start: string
          policy_version: number | null
          run_id: string | null
          status: Database["public"]["Enums"]["council_report_status"]
        }
        Insert: {
          agent: Database["public"]["Enums"]["council_agent"]
          content: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: Json | null
          decision_note?: string | null
          evidence?: Json
          id?: string
          kind: Database["public"]["Enums"]["council_report_kind"]
          org_id: string
          period_end: string
          period_start: string
          policy_version?: number | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["council_report_status"]
        }
        Update: {
          agent?: Database["public"]["Enums"]["council_agent"]
          content?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: Json | null
          decision_note?: string | null
          evidence?: Json
          id?: string
          kind?: Database["public"]["Enums"]["council_report_kind"]
          org_id?: string
          period_end?: string
          period_start?: string
          policy_version?: number | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["council_report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "council_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "council_reports_org_id_run_id_fkey"
            columns: ["org_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      council_tasks: {
        Row: {
          assignee_member_id: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          due_on: string | null
          id: string
          org_id: string
          position: number
          recommendation_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_member_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_on?: string | null
          id?: string
          org_id: string
          position?: number
          recommendation_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_member_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_on?: string | null
          id?: string
          org_id?: string
          position?: number
          recommendation_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "council_tasks_org_id_assignee_member_id_fkey"
            columns: ["org_id", "assignee_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "council_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "council_tasks_org_id_recommendation_id_fkey"
            columns: ["org_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["org_id", "id"]
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
      expense_categories: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          expense_group: Database["public"]["Enums"]["expense_group"]
          id: string
          is_fixed: boolean
          is_infrastructure: boolean
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          expense_group?: Database["public"]["Enums"]["expense_group"]
          id?: string
          is_fixed?: boolean
          is_infrastructure?: boolean
          name: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          expense_group?: Database["public"]["Enums"]["expense_group"]
          id?: string
          is_fixed?: boolean
          is_infrastructure?: boolean
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_subscriptions: {
        Row: {
          allocation: Database["public"]["Enums"]["cost_allocation"]
          base_cents: number
          billing_day: number | null
          billing_interval: Database["public"]["Enums"]["subscription_interval"]
          category_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string
          ends_on: string | null
          id: string
          irpf_bps: number
          is_active: boolean
          issuer_id: string
          member_id: string | null
          notes: string | null
          org_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          rebill: boolean
          rebill_markup_bps: number
          starts_on: string
          updated_at: string
          vat_bps: number
          vat_deductible: boolean
          vendor_id: string | null
        }
        Insert: {
          allocation?: Database["public"]["Enums"]["cost_allocation"]
          base_cents: number
          billing_day?: number | null
          billing_interval?: Database["public"]["Enums"]["subscription_interval"]
          category_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          ends_on?: string | null
          id?: string
          irpf_bps?: number
          is_active?: boolean
          issuer_id: string
          member_id?: string | null
          notes?: string | null
          org_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rebill?: boolean
          rebill_markup_bps?: number
          starts_on: string
          updated_at?: string
          vat_bps?: number
          vat_deductible?: boolean
          vendor_id?: string | null
        }
        Update: {
          allocation?: Database["public"]["Enums"]["cost_allocation"]
          base_cents?: number
          billing_day?: number | null
          billing_interval?: Database["public"]["Enums"]["subscription_interval"]
          category_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          ends_on?: string | null
          id?: string
          irpf_bps?: number
          is_active?: boolean
          issuer_id?: string
          member_id?: string | null
          notes?: string | null
          org_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rebill?: boolean
          rebill_markup_bps?: number
          starts_on?: string
          updated_at?: string
          vat_bps?: number
          vat_deductible?: boolean
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_subscriptions_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expense_subscriptions_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      expenses: {
        Row: {
          allocation: Database["public"]["Enums"]["cost_allocation"]
          attachment_path: string | null
          base_cents: number
          category_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_on: string | null
          external_id: string | null
          id: string
          irpf_bps: number
          irpf_cents: number
          issued_on: string
          issuer_id: string
          member_id: string | null
          notes: string | null
          org_id: string
          paid_on: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          period_start: string | null
          rebill: boolean
          rebill_invoice_line_id: string | null
          rebill_markup_bps: number
          source: Database["public"]["Enums"]["expense_source"]
          subscription_id: string | null
          total_cents: number
          updated_at: string
          vat_bps: number
          vat_cents: number
          vat_deductible: boolean
          vendor_id: string | null
          vendor_invoice_number: string | null
        }
        Insert: {
          allocation?: Database["public"]["Enums"]["cost_allocation"]
          attachment_path?: string | null
          base_cents: number
          category_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_on?: string | null
          external_id?: string | null
          id?: string
          irpf_bps?: number
          irpf_cents?: number
          issued_on: string
          issuer_id: string
          member_id?: string | null
          notes?: string | null
          org_id: string
          paid_on?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          period_start?: string | null
          rebill?: boolean
          rebill_invoice_line_id?: string | null
          rebill_markup_bps?: number
          source?: Database["public"]["Enums"]["expense_source"]
          subscription_id?: string | null
          total_cents: number
          updated_at?: string
          vat_bps?: number
          vat_cents?: number
          vat_deductible?: boolean
          vendor_id?: string | null
          vendor_invoice_number?: string | null
        }
        Update: {
          allocation?: Database["public"]["Enums"]["cost_allocation"]
          attachment_path?: string | null
          base_cents?: number
          category_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_on?: string | null
          external_id?: string | null
          id?: string
          irpf_bps?: number
          irpf_cents?: number
          issued_on?: string
          issuer_id?: string
          member_id?: string | null
          notes?: string | null
          org_id?: string
          paid_on?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          period_start?: string | null
          rebill?: boolean
          rebill_invoice_line_id?: string | null
          rebill_markup_bps?: number
          source?: Database["public"]["Enums"]["expense_source"]
          subscription_id?: string | null
          total_cents?: number
          updated_at?: string
          vat_bps?: number
          vat_cents?: number
          vat_deductible?: boolean
          vendor_id?: string | null
          vendor_invoice_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_subscription_id_fkey"
            columns: ["org_id", "subscription_id"]
            isOneToOne: false
            referencedRelation: "expense_subscriptions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_rebill_line_fk"
            columns: ["org_id", "rebill_invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_rebill_line_fk"
            columns: ["org_id", "rebill_invoice_line_id"]
            isOneToOne: false
            referencedRelation: "project_contract_revenue"
            referencedColumns: ["org_id", "invoice_line_id"]
          },
        ]
      }
      financial_policies: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          note: string | null
          org_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          note?: string | null
          org_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          note?: string | null
          org_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      import_job_rows: {
        Row: {
          action: Database["public"]["Enums"]["import_row_action"] | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          id: string
          issues: Json
          job_id: string
          message: string | null
          org_id: string
          raw: Json
          row_number: number
          updated_at: string
        }
        Insert: {
          action?: Database["public"]["Enums"]["import_row_action"] | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          id?: string
          issues?: Json
          job_id: string
          message?: string | null
          org_id: string
          raw: Json
          row_number: number
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["import_row_action"] | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          id?: string
          issues?: Json
          job_id?: string
          message?: string | null
          org_id?: string
          raw?: Json
          row_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_job_rows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_job_rows_org_id_job_id_fkey"
            columns: ["org_id", "job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          committed_at: string | null
          committed_by: string | null
          created_at: string
          created_by: string | null
          error: string | null
          file_hash: string | null
          file_meta: Json
          file_name: string
          headers: string[]
          id: string
          kind: Database["public"]["Enums"]["import_kind"]
          mapping: Json
          org_id: string
          simulated_at: string | null
          status: Database["public"]["Enums"]["import_status"]
          summary: Json | null
          updated_at: string
        }
        Insert: {
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          file_hash?: string | null
          file_meta?: Json
          file_name: string
          headers?: string[]
          id?: string
          kind: Database["public"]["Enums"]["import_kind"]
          mapping?: Json
          org_id: string
          simulated_at?: string | null
          status?: Database["public"]["Enums"]["import_status"]
          summary?: Json | null
          updated_at?: string
        }
        Update: {
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          file_hash?: string | null
          file_meta?: Json
          file_name?: string
          headers?: string[]
          id?: string
          kind?: Database["public"]["Enums"]["import_kind"]
          mapping?: Json
          org_id?: string
          simulated_at?: string | null
          status?: Database["public"]["Enums"]["import_status"]
          summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
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
          discovered_at: string | null
          discovered_sites: Json
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
          discovered_at?: string | null
          discovered_sites?: Json
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
          discovered_at?: string | null
          discovered_sites?: Json
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
      invoice_attachments: {
        Row: {
          content_type: string
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          invoice_id: string
          kind: Database["public"]["Enums"]["invoice_attachment_kind"]
          org_id: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          invoice_id: string
          kind?: Database["public"]["Enums"]["invoice_attachment_kind"]
          org_id: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          invoice_id?: string
          kind?: Database["public"]["Enums"]["invoice_attachment_kind"]
          org_id?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_attachments_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_attachments_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
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
            foreignKeyName: "invoice_lines_org_id_rectifies_line_id_fkey"
            columns: ["org_id", "rectifies_line_id"]
            isOneToOne: false
            referencedRelation: "project_contract_revenue"
            referencedColumns: ["org_id", "invoice_line_id"]
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
      member_costs: {
        Row: {
          created_at: string
          created_by: string | null
          hourly_cost_cents: number
          id: string
          member_id: string
          org_id: string
          updated_at: string
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hourly_cost_cents: number
          id?: string
          member_id: string
          org_id: string
          updated_at?: string
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hourly_cost_cents?: number
          id?: string
          member_id?: string
          org_id?: string
          updated_at?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_costs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_costs_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
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
          weekly_digest: boolean
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
          weekly_digest?: boolean
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
          weekly_digest?: boolean
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
          pushed_at: string | null
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
          pushed_at?: string | null
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
          pushed_at?: string | null
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
          require_mfa: boolean
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
          require_mfa?: boolean
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
          require_mfa?: boolean
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
          report_hours: boolean
          report_month: string | null
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
          report_hours?: boolean
          report_month?: string | null
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
          report_hours?: boolean
          report_month?: string | null
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
      project_tasks: {
        Row: {
          assignee_member_id: string | null
          client_visible: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_on: string | null
          estimate_minutes: number | null
          id: string
          org_id: string
          position: number
          priority: Database["public"]["Enums"]["project_task_priority"]
          project_id: string
          status: Database["public"]["Enums"]["project_task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_member_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_on?: string | null
          estimate_minutes?: number | null
          id?: string
          org_id: string
          position: number
          priority?: Database["public"]["Enums"]["project_task_priority"]
          project_id: string
          status?: Database["public"]["Enums"]["project_task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_member_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_on?: string | null
          estimate_minutes?: number | null
          id?: string
          org_id?: string
          position?: number
          priority?: Database["public"]["Enums"]["project_task_priority"]
          project_id?: string
          status?: Database["public"]["Enums"]["project_task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_org_id_assignee_member_id_fkey"
            columns: ["org_id", "assignee_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "project_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "project_tasks_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      project_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["project_kind"]
          name: string
          org_id: string
          tasks: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["project_kind"]
          name: string
          org_id: string
          tasks?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["project_kind"]
          name?: string
          org_id?: string
          tasks?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          budget_minutes: number | null
          client_id: string | null
          contract_id: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          kind: Database["public"]["Enums"]["project_kind"]
          name: string
          notes: string | null
          org_id: string
          owner_member_id: string | null
          portal_visible: boolean
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          budget_minutes?: number | null
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["project_kind"]
          name: string
          notes?: string | null
          org_id: string
          owner_member_id?: string | null
          portal_visible?: boolean
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          budget_minutes?: number | null
          client_id?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["project_kind"]
          name?: string
          notes?: string | null
          org_id?: string
          owner_member_id?: string | null
          portal_visible?: boolean
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "projects_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "projects_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "projects_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      public_links: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["public_link_kind"]
          last_viewed_at: string | null
          org_id: string
          quote_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          updated_at: string
          view_count: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          kind: Database["public"]["Enums"]["public_link_kind"]
          last_viewed_at?: string | null
          org_id: string
          quote_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["public_link_kind"]
          last_viewed_at?: string | null
          org_id?: string
          quote_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "public_links_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "public_links_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "public_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_links_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "public_links_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_secret: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          member_id: string
          org_id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          auth_secret: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          member_id: string
          org_id: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          auth_secret?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          member_id?: string
          org_id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      quote_acceptances: {
        Row: {
          accepted_at: string
          consent_text: string
          created_at: string
          forwarded_for: string | null
          id: string
          ip_address: string | null
          link_id: string
          locale: Database["public"]["Enums"]["app_locale"]
          org_id: string
          pdf_path: string | null
          pdf_sha256: string
          quote_id: string
          quote_number: string
          quote_version: string
          signature: string | null
          signer_email: string
          signer_name: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          consent_text: string
          created_at?: string
          forwarded_for?: string | null
          id?: string
          ip_address?: string | null
          link_id: string
          locale: Database["public"]["Enums"]["app_locale"]
          org_id: string
          pdf_path?: string | null
          pdf_sha256: string
          quote_id: string
          quote_number: string
          quote_version: string
          signature?: string | null
          signer_email: string
          signer_name: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          consent_text?: string
          created_at?: string
          forwarded_for?: string | null
          id?: string
          ip_address?: string | null
          link_id?: string
          locale?: Database["public"]["Enums"]["app_locale"]
          org_id?: string
          pdf_path?: string | null
          pdf_sha256?: string
          quote_id?: string
          quote_number?: string
          quote_version?: string
          signature?: string | null
          signer_email?: string
          signer_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_acceptances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_acceptances_org_id_link_id_fkey"
            columns: ["org_id", "link_id"]
            isOneToOne: false
            referencedRelation: "public_links"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_acceptances_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "quote_acceptances_org_id_quote_id_fkey"
            columns: ["org_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes_overview"
            referencedColumns: ["org_id", "id"]
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
      recommendation_reviews: {
        Row: {
          actual_impact_cents: number | null
          created_at: string
          due_on: string
          estimated_impact_cents: number | null
          evidence: Json
          horizon_days: number
          id: string
          notes: string | null
          org_id: string
          outcome: Database["public"]["Enums"]["review_outcome"] | null
          recommendation_id: string
          reviewed_at: string | null
          run_id: string | null
          state: Database["public"]["Enums"]["review_state"]
        }
        Insert: {
          actual_impact_cents?: number | null
          created_at?: string
          due_on: string
          estimated_impact_cents?: number | null
          evidence?: Json
          horizon_days: number
          id?: string
          notes?: string | null
          org_id: string
          outcome?: Database["public"]["Enums"]["review_outcome"] | null
          recommendation_id: string
          reviewed_at?: string | null
          run_id?: string | null
          state?: Database["public"]["Enums"]["review_state"]
        }
        Update: {
          actual_impact_cents?: number | null
          created_at?: string
          due_on?: string
          estimated_impact_cents?: number | null
          evidence?: Json
          horizon_days?: number
          id?: string
          notes?: string | null
          org_id?: string
          outcome?: Database["public"]["Enums"]["review_outcome"] | null
          recommendation_id?: string
          reviewed_at?: string | null
          run_id?: string | null
          state?: Database["public"]["Enums"]["review_state"]
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_reviews_org_id_recommendation_id_fkey"
            columns: ["org_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "recommendation_reviews_org_id_run_id_fkey"
            columns: ["org_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      recommendations: {
        Row: {
          agent: Database["public"]["Enums"]["council_agent"]
          challenge: Json | null
          confidence: Database["public"]["Enums"]["recommendation_confidence"]
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dedupe_key: string
          evidence: Json
          id: string
          impact_eur_cents: number | null
          kind: Database["public"]["Enums"]["recommendation_kind"]
          missing_data: Json
          org_id: string
          policy_version: number | null
          postponed_until: string | null
          proposed_actions: Json
          reasoning: string
          requires_professional_review: boolean
          risks: string | null
          run_id: string | null
          status: Database["public"]["Enums"]["recommendation_status"]
          subject: string
          summary: string
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["recommendation_urgency"]
        }
        Insert: {
          agent: Database["public"]["Enums"]["council_agent"]
          challenge?: Json | null
          confidence: Database["public"]["Enums"]["recommendation_confidence"]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dedupe_key: string
          evidence?: Json
          id?: string
          impact_eur_cents?: number | null
          kind?: Database["public"]["Enums"]["recommendation_kind"]
          missing_data?: Json
          org_id: string
          policy_version?: number | null
          postponed_until?: string | null
          proposed_actions?: Json
          reasoning: string
          requires_professional_review?: boolean
          risks?: string | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          subject: string
          summary: string
          title: string
          updated_at?: string
          urgency: Database["public"]["Enums"]["recommendation_urgency"]
        }
        Update: {
          agent?: Database["public"]["Enums"]["council_agent"]
          challenge?: Json | null
          confidence?: Database["public"]["Enums"]["recommendation_confidence"]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dedupe_key?: string
          evidence?: Json
          id?: string
          impact_eur_cents?: number | null
          kind?: Database["public"]["Enums"]["recommendation_kind"]
          missing_data?: Json
          org_id?: string
          policy_version?: number | null
          postponed_until?: string | null
          proposed_actions?: Json
          reasoning?: string
          requires_professional_review?: boolean
          risks?: string | null
          run_id?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          subject?: string
          summary?: string
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["recommendation_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_org_id_run_id_fkey"
            columns: ["org_id", "run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
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
      sepa_creditors: {
        Row: {
          bic: string | null
          created_at: string
          created_by: string | null
          creditor_identifier: string | null
          creditor_identifier_confirmed_at: string | null
          creditor_identifier_confirmed_by: string | null
          iban: string | null
          id: string
          issuer_id: string
          name: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          bic?: string | null
          created_at?: string
          created_by?: string | null
          creditor_identifier?: string | null
          creditor_identifier_confirmed_at?: string | null
          creditor_identifier_confirmed_by?: string | null
          iban?: string | null
          id?: string
          issuer_id: string
          name?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          bic?: string | null
          created_at?: string
          created_by?: string | null
          creditor_identifier?: string | null
          creditor_identifier_confirmed_at?: string | null
          creditor_identifier_confirmed_by?: string | null
          iban?: string | null
          id?: string
          issuer_id?: string
          name?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sepa_creditors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_creditors_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sepa_remittance_items: {
        Row: {
          amount_cents: number | null
          created_at: string
          created_by: string | null
          end_to_end_id: string | null
          id: string
          invoice_id: string
          mandate_id: string | null
          org_id: string
          payment_id: string | null
          remittance_id: string
          return_code: string | null
          return_reason: string | null
          returned_on: string | null
          reversal_payment_id: string | null
          sequence_type:
            | Database["public"]["Enums"]["sepa_sequence_type"]
            | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          end_to_end_id?: string | null
          id?: string
          invoice_id: string
          mandate_id?: string | null
          org_id: string
          payment_id?: string | null
          remittance_id: string
          return_code?: string | null
          return_reason?: string | null
          returned_on?: string | null
          reversal_payment_id?: string | null
          sequence_type?:
            | Database["public"]["Enums"]["sepa_sequence_type"]
            | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          end_to_end_id?: string | null
          id?: string
          invoice_id?: string
          mandate_id?: string | null
          org_id?: string
          payment_id?: string | null
          remittance_id?: string
          return_code?: string | null
          return_reason?: string | null
          returned_on?: string | null
          reversal_payment_id?: string | null
          sequence_type?:
            | Database["public"]["Enums"]["sepa_sequence_type"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sepa_remittance_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_mandate_id_fkey"
            columns: ["org_id", "mandate_id"]
            isOneToOne: false
            referencedRelation: "client_mandates"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_mandate_id_fkey"
            columns: ["org_id", "mandate_id"]
            isOneToOne: false
            referencedRelation: "client_mandates_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_payment_id_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_reversal_payment_id_fkey"
            columns: ["org_id", "reversal_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sepa_remittances: {
        Row: {
          collection_on: string
          created_at: string
          created_by: string | null
          creditor_snapshot: Json | null
          file_path: string | null
          generated_at: string | null
          id: string
          issuer_id: string
          message_id: string | null
          notes: string | null
          org_id: string
          sent_at: string | null
          settled_at: string | null
          settled_on: string | null
          status: Database["public"]["Enums"]["sepa_remittance_status"]
          updated_at: string
        }
        Insert: {
          collection_on: string
          created_at?: string
          created_by?: string | null
          creditor_snapshot?: Json | null
          file_path?: string | null
          generated_at?: string | null
          id?: string
          issuer_id: string
          message_id?: string | null
          notes?: string | null
          org_id: string
          sent_at?: string | null
          settled_at?: string | null
          settled_on?: string | null
          status?: Database["public"]["Enums"]["sepa_remittance_status"]
          updated_at?: string
        }
        Update: {
          collection_on?: string
          created_at?: string
          created_by?: string | null
          creditor_snapshot?: Json | null
          file_path?: string | null
          generated_at?: string | null
          id?: string
          issuer_id?: string
          message_id?: string | null
          notes?: string | null
          org_id?: string
          sent_at?: string | null
          settled_at?: string | null
          settled_on?: string | null
          status?: Database["public"]["Enums"]["sepa_remittance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sepa_remittances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_remittances_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      shareholdings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          org_id: string
          percent_bps: number
          updated_at: string
          valid_from: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          org_id: string
          percent_bps: number
          updated_at?: string
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          org_id?: string
          percent_bps?: number
          updated_at?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "shareholdings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shareholdings_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      site_checks: {
        Row: {
          checked_at: string
          error: string | null
          id: number
          ok: boolean
          org_id: string
          response_ms: number | null
          site_id: string
          status_code: number | null
          tls_expires_at: string | null
        }
        Insert: {
          checked_at?: string
          error?: string | null
          id?: never
          ok: boolean
          org_id: string
          response_ms?: number | null
          site_id: string
          status_code?: number | null
          tls_expires_at?: string | null
        }
        Update: {
          checked_at?: string
          error?: string | null
          id?: never
          ok?: boolean
          org_id?: string
          response_ms?: number | null
          site_id?: string
          status_code?: number | null
          tls_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_checks_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "site_checks_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sites: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          domain_expires_on: string | null
          hosted_by_us: boolean
          id: string
          is_active: boolean
          label: string | null
          notes: string | null
          org_id: string
          updated_at: string
          url: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          domain_expires_on?: string | null
          hosted_by_us?: boolean
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          org_id: string
          updated_at?: string
          url: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          domain_expires_on?: string | null
          hosted_by_us?: boolean
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          org_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sites_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
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
      time_entries: {
        Row: {
          billable: boolean
          created_at: string
          created_by: string | null
          external_id: string | null
          id: string
          member_id: string
          minutes: number | null
          note: string | null
          org_id: string
          project_id: string
          source: Database["public"]["Enums"]["time_entry_source"]
          started_at: string | null
          task_id: string | null
          updated_at: string
          worked_on: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          member_id: string
          minutes?: number | null
          note?: string | null
          org_id: string
          project_id: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string | null
          task_id?: string | null
          updated_at?: string
          worked_on: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          member_id?: string
          minutes?: number | null
          note?: string | null
          org_id?: string
          project_id?: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string | null
          task_id?: string | null
          updated_at?: string
          worked_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "time_entries_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "time_entries_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "time_entries_org_id_project_id_task_id_fkey"
            columns: ["org_id", "project_id", "task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["org_id", "project_id", "id"]
          },
        ]
      }
      trusted_devices: {
        Row: {
          confirm_expires_at: string | null
          confirm_token_hash: string | null
          confirmed_at: string | null
          created_at: string
          device_hash: string
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          confirm_expires_at?: string | null
          confirm_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          device_hash: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          confirm_expires_at?: string | null
          confirm_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          device_hash?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      upsell_rules: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          excludes_any: string[]
          id: string
          label: string
          max_services: number | null
          min_months: number | null
          org_id: string
          position: number
          reference_mrr_cents: number | null
          requires_any: string[]
          suggestion: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          excludes_any?: string[]
          id?: string
          label: string
          max_services?: number | null
          min_months?: number | null
          org_id: string
          position?: number
          reference_mrr_cents?: number | null
          requires_any?: string[]
          suggestion: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          excludes_any?: string[]
          id?: string
          label?: string
          max_services?: number | null
          min_months?: number | null
          org_id?: string
          position?: number
          reference_mrr_cents?: number | null
          requires_any?: string[]
          suggestion?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          archived_at: string | null
          contact_name: string | null
          country_code: string
          created_at: string
          created_by: string | null
          default_category_id: string | null
          email: string | null
          iban: string | null
          id: string
          kind: Database["public"]["Enums"]["vendor_kind"]
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          tax_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          archived_at?: string | null
          contact_name?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_category_id?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["vendor_kind"]
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          archived_at?: string | null
          contact_name?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          default_category_id?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["vendor_kind"]
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_org_id_default_category_id_fkey"
            columns: ["org_id", "default_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "vendors_org_id_fkey"
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
      bank_matches_overview: {
        Row: {
          amount_cents: number | null
          category_id: string | null
          category_name: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          created_expense: boolean | null
          created_payment: boolean | null
          expense_description: string | null
          expense_id: string | null
          expense_total_cents: number | null
          id: string | null
          invoice_id: string | null
          invoice_number: string | null
          marked_paid: boolean | null
          org_id: string | null
          payment_amount_cents: number | null
          payment_id: string | null
          payment_paid_on: string | null
          remittance_collection_on: string | null
          remittance_id: string | null
          remittance_status:
            | Database["public"]["Enums"]["sepa_remittance_status"]
            | null
          settled_remittance: boolean | null
          target_kind: string | null
          transaction_id: string | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_matches_org_id_expense_id_fkey"
            columns: ["org_id", "expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_expense_id_fkey"
            columns: ["org_id", "expense_id"]
            isOneToOne: false
            referencedRelation: "expenses_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_payment_id_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_matches_org_id_transaction_id_fkey"
            columns: ["org_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      bank_statements_overview: {
        Row: {
          account_id: string | null
          balance_gap_cents: number | null
          closing_balance_cents: number | null
          file_name: string | null
          format: Database["public"]["Enums"]["bank_statement_format"] | null
          id: string | null
          imported_at: string | null
          imported_by: string | null
          imported_by_name: string | null
          movements_in_file: number | null
          new_count: number | null
          opening_balance_cents: number | null
          org_id: string | null
          period_end: string | null
          period_movements_cents: number | null
          period_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_statements_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_position"
            referencedColumns: ["org_id", "account_id"]
          },
          {
            foreignKeyName: "bank_statements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions_overview: {
        Row: {
          account_id: string | null
          account_is_active: boolean | null
          account_name: string | null
          amount_cents: number | null
          balance_after_cents: number | null
          bank_code: string | null
          booked_on: string | null
          concept: string | null
          counterparty: string | null
          counterparty_iban: string | null
          created_at: string | null
          direction: Database["public"]["Enums"]["bank_direction"] | null
          fingerprint: string | null
          id: string | null
          ignored_at: string | null
          ignored_note: string | null
          ignored_reason:
            | Database["public"]["Enums"]["bank_ignore_reason"]
            | null
          issuer_id: string | null
          last_matched_at: string | null
          matched_cents: number | null
          matches_count: number | null
          org_id: string | null
          position: number | null
          reference: string | null
          remaining_cents: number | null
          statement_id: string | null
          status:
            | Database["public"]["Enums"]["bank_reconciliation_status"]
            | null
          value_on: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "cash_position"
            referencedColumns: ["org_id", "account_id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_statement_id_account_id_fkey"
            columns: ["org_id", "statement_id", "account_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["org_id", "id", "account_id"]
          },
          {
            foreignKeyName: "bank_transactions_org_id_statement_id_account_id_fkey"
            columns: ["org_id", "statement_id", "account_id"]
            isOneToOne: false
            referencedRelation: "bank_statements_overview"
            referencedColumns: ["org_id", "id", "account_id"]
          },
        ]
      }
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
            foreignKeyName: "billable_items_org_id_invoice_line_id_fkey"
            columns: ["org_id", "invoice_line_id"]
            isOneToOne: false
            referencedRelation: "project_contract_revenue"
            referencedColumns: ["org_id", "invoice_line_id"]
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
      cash_position: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          balance_on: string | null
          iban: string | null
          is_active: boolean | null
          issuer_id: string | null
          issuer_name: string | null
          name: string | null
          org_id: string | null
          org_latest_balance_on: string | null
          org_oldest_balance_on: string | null
          org_total_cents: number | null
          source: Database["public"]["Enums"]["cash_balance_source"] | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_mandates_overview: {
        Row: {
          bic: string | null
          client_id: string | null
          client_name: string | null
          collections_count: number | null
          created_at: string | null
          debtor_name: string | null
          iban: string | null
          id: string | null
          in_use: boolean | null
          is_active: boolean | null
          issuer_id: string | null
          issuer_name: string | null
          last_collection_on: string | null
          next_sequence_type:
            | Database["public"]["Enums"]["sepa_sequence_type"]
            | null
          notes: string | null
          org_id: string | null
          reference: string | null
          revoke_reason: string | null
          revoked_at: string | null
          signed_on: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_mandates_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_mandates_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
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
          manual_status:
            | Database["public"]["Enums"]["client_manual_status"]
            | null
          manual_status_at: string | null
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
      expenses_by_month: {
        Row: {
          base_cents: number | null
          category_id: string | null
          cost_cents: number | null
          deductible_vat_cents: number | null
          expense_group: Database["public"]["Enums"]["expense_group"] | null
          expenses_count: number | null
          irpf_cents: number | null
          is_fixed: boolean | null
          issuer_id: string | null
          month: string | null
          org_id: string | null
          quarter: string | null
          total_cents: number | null
          vat_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      expenses_overview: {
        Row: {
          allocation: Database["public"]["Enums"]["cost_allocation"] | null
          attachment_path: string | null
          base_cents: number | null
          category_id: string | null
          category_name: string | null
          client_id: string | null
          client_name: string | null
          cost_cents: number | null
          created_at: string | null
          deductible_vat_cents: number | null
          description: string | null
          due_on: string | null
          expense_group: Database["public"]["Enums"]["expense_group"] | null
          external_id: string | null
          id: string | null
          irpf_bps: number | null
          irpf_cents: number | null
          is_fixed: boolean | null
          issued_on: string | null
          issuer_id: string | null
          issuer_name: string | null
          member_id: string | null
          member_initials: string | null
          member_name: string | null
          month: string | null
          notes: string | null
          org_id: string | null
          paid_on: string | null
          payable_on: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          period_start: string | null
          quarter: string | null
          rebill: boolean | null
          rebill_invoice_id: string | null
          rebill_invoice_line_id: string | null
          rebill_invoice_number: string | null
          rebill_markup_bps: number | null
          rebill_state:
            | Database["public"]["Enums"]["expense_rebill_state"]
            | null
          source: Database["public"]["Enums"]["expense_source"] | null
          status: Database["public"]["Enums"]["expense_status"] | null
          subscription_id: string | null
          total_cents: number | null
          updated_at: string | null
          vat_bps: number | null
          vat_cents: number | null
          vat_deductible: boolean | null
          vendor_id: string | null
          vendor_invoice_number: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_subscription_id_fkey"
            columns: ["org_id", "subscription_id"]
            isOneToOne: false
            referencedRelation: "expense_subscriptions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_rebill_line_fk"
            columns: ["org_id", "rebill_invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_rebill_line_fk"
            columns: ["org_id", "rebill_invoice_line_id"]
            isOneToOne: false
            referencedRelation: "project_contract_revenue"
            referencedColumns: ["org_id", "invoice_line_id"]
          },
        ]
      }
      invoice_taxes_by_month: {
        Row: {
          base_cents: number | null
          invoices_count: number | null
          irpf_cents: number | null
          issuer_id: string | null
          month: string | null
          org_id: string | null
          quarter: string | null
          vat_cents: number | null
        }
        Relationships: [
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
      project_contract_revenue: {
        Row: {
          base_cents: number | null
          contract_id: string | null
          invoice_id: string | null
          invoice_kind: Database["public"]["Enums"]["series_kind"] | null
          invoice_line_id: string | null
          invoice_number: string | null
          issued_on: string | null
          org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      projects_overview: {
        Row: {
          archived_at: string | null
          billable_minutes: number | null
          budget_minutes: number | null
          client_id: string | null
          client_name: string | null
          contract_id: string | null
          contract_minutes: number | null
          contract_projects: number | null
          contract_title: string | null
          created_at: string | null
          due_on: string | null
          id: string | null
          is_overdue: boolean | null
          kind: Database["public"]["Enums"]["project_kind"] | null
          last_worked_on: string | null
          logged_minutes: number | null
          name: string | null
          next_task_due_on: string | null
          next_task_id: string | null
          next_task_title: string | null
          notes: string | null
          org_id: string | null
          owner_color: string | null
          owner_initials: string | null
          owner_member_id: string | null
          owner_name: string | null
          portal_visible: boolean | null
          revenue_cents: number | null
          running_timers: number | null
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          tasks_client_visible: number | null
          tasks_done: number | null
          tasks_overdue: number | null
          tasks_total: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "projects_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "projects_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "projects_org_id_contract_id_client_id_fkey"
            columns: ["org_id", "contract_id", "client_id"]
            isOneToOne: false
            referencedRelation: "contracts_overview"
            referencedColumns: ["org_id", "id", "client_id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_owner_member_id_fkey"
            columns: ["org_id", "owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
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
      sepa_remittance_items_overview: {
        Row: {
          amount_cents: number | null
          client_id: string | null
          client_name: string | null
          collection_on: string | null
          created_at: string | null
          due_on: string | null
          end_to_end_id: string | null
          frozen: boolean | null
          id: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_status: Database["public"]["Enums"]["invoice_status"] | null
          issued_on: string | null
          issuer_id: string | null
          mandate_id: string | null
          org_id: string | null
          outstanding_cents: number | null
          payment_id: string | null
          remittance_id: string | null
          remittance_status:
            | Database["public"]["Enums"]["sepa_remittance_status"]
            | null
          return_code: string | null
          return_reason: string | null
          returned_on: string | null
          reversal_payment_id: string | null
          sequence_type:
            | Database["public"]["Enums"]["sepa_sequence_type"]
            | null
          state: Database["public"]["Enums"]["sepa_item_state"] | null
        }
        Relationships: [
          {
            foreignKeyName: "sepa_remittance_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_invoice_id_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_mandate_id_fkey"
            columns: ["org_id", "mandate_id"]
            isOneToOne: false
            referencedRelation: "client_mandates"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_mandate_id_fkey"
            columns: ["org_id", "mandate_id"]
            isOneToOne: false
            referencedRelation: "client_mandates_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_payment_id_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_remittance_id_fkey"
            columns: ["org_id", "remittance_id"]
            isOneToOne: false
            referencedRelation: "sepa_remittances_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sepa_remittance_items_org_id_reversal_payment_id_fkey"
            columns: ["org_id", "reversal_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sepa_remittances_overview: {
        Row: {
          collection_on: string | null
          created_at: string | null
          creditor_snapshot: Json | null
          file_path: string | null
          generated_at: string | null
          id: string | null
          issuer_id: string | null
          issuer_name: string | null
          items_count: number | null
          message_id: string | null
          notes: string | null
          org_id: string | null
          returned_cents: number | null
          returned_count: number | null
          sent_at: string | null
          settled_at: string | null
          settled_on: string | null
          status: Database["public"]["Enums"]["sepa_remittance_status"] | null
          total_cents: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sepa_remittances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sepa_remittances_org_id_issuer_id_fkey"
            columns: ["org_id", "issuer_id"]
            isOneToOne: false
            referencedRelation: "issuers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sites_overview: {
        Row: {
          checks_24h: number | null
          checks_30d: number | null
          checks_7d: number | null
          client_id: string | null
          client_name: string | null
          consecutive_failures: number | null
          created_at: string | null
          domain_expires_on: string | null
          failing_since: string | null
          hosted_by_us: boolean | null
          id: string | null
          is_active: boolean | null
          label: string | null
          last_checked_at: string | null
          last_error: string | null
          last_ok: boolean | null
          last_ok_at: string | null
          last_response_ms: number | null
          last_status_code: number | null
          notes: string | null
          ok_24h: number | null
          ok_30d: number | null
          ok_7d: number | null
          org_id: string | null
          tls_expires_at: string | null
          updated_at: string | null
          url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sites_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_costs_by_allocation: {
        Row: {
          allocation: Database["public"]["Enums"]["cost_allocation"] | null
          base_cents: number | null
          client_id: string | null
          client_name: string | null
          cost_cents: number | null
          expenses_count: number | null
          first_expense_on: string | null
          last_expense_on: string | null
          org_id: string | null
          pending_cents: number | null
          vendor_archived_at: string | null
          vendor_id: string | null
          vendor_kind: Database["public"]["Enums"]["vendor_kind"] | null
          vendor_name: string | null
          year_cost_cents: number | null
          year_expenses_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_client_fk"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_overview"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "expenses_org_id_vendor_id_fkey"
            columns: ["org_id", "vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_overview"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      vendors_overview: {
        Row: {
          archived_at: string | null
          base_cents: number | null
          clients_count: number | null
          contact_name: string | null
          cost_cents: number | null
          country_code: string | null
          created_at: string | null
          default_category_id: string | null
          email: string | null
          expenses_count: number | null
          first_expense_on: string | null
          iban: string | null
          id: string | null
          kind: Database["public"]["Enums"]["vendor_kind"] | null
          last_expense_on: string | null
          name: string | null
          notes: string | null
          org_id: string | null
          overdue_cents: number | null
          overdue_count: number | null
          pending_cents: number | null
          pending_count: number | null
          phone: string | null
          tax_id: string | null
          updated_at: string | null
          website: string | null
          year_cost_cents: number | null
          year_expenses_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_org_id_default_category_id_fkey"
            columns: ["org_id", "default_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "vendors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_monthly_close: {
        Args: { p_buckets: Json; p_note?: string; p_report_id: string }
        Returns: undefined
      }
      accept_pending_invitations: { Args: never; Returns: number }
      accept_quote: { Args: { p_quote_id: string }; Returns: string }
      apply_billing_run: { Args: { p: Json }; Returns: Json }
      bank_apply: { Args: { p: Json }; Returns: Json }
      bank_create_expense: { Args: { p: Json }; Returns: Json }
      bank_delete_statement: {
        Args: { p_statement_id: string }
        Returns: number
      }
      bank_ignore: {
        Args: {
          p_note?: string
          p_reason: Database["public"]["Enums"]["bank_ignore_reason"]
          p_transaction_id: string
        }
        Returns: undefined
      }
      bank_import_statement: { Args: { p: Json }; Returns: Json }
      bank_undo_match: { Args: { p_match_id: string }; Returns: Json }
      bank_unignore: { Args: { p_transaction_id: string }; Returns: undefined }
      claim_agent_jobs: {
        Args: { p_ids?: string[]; p_limit?: number; p_org?: string }
        Returns: {
          agent: Database["public"]["Enums"]["council_agent"]
          attempts: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          org_id: string
          payload: Json
          requested_by: string | null
          run_after: string
          status: Database["public"]["Enums"]["agent_job_status"]
          trigger: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
      council_enqueue_run: {
        Args: {
          p_agent: Database["public"]["Enums"]["council_agent"]
          p_org: string
          p_payload?: Json
        }
        Returns: string
      }
      council_status: {
        Args: { p_org: string }
        Returns: {
          agent: Database["public"]["Enums"]["council_agent"]
          last_error: string
          last_finished_at: string
          last_status: Database["public"]["Enums"]["agent_job_status"]
          month_cost_usd_micros: number
          pending_jobs: number
          running_jobs: number
        }[]
      }
      create_calendar_feed: {
        Args: {
          p_org: string
          p_scope?: Database["public"]["Enums"]["calendar_feed_scope"]
          p_token_hash: string
        }
        Returns: string
      }
      create_contract: { Args: { p: Json }; Returns: string }
      create_organization: { Args: { p: Json }; Returns: string }
      create_project_from_template: {
        Args: { p: Json; p_template_id: string }
        Returns: string
      }
      create_public_link: {
        Args: {
          p_kind: Database["public"]["Enums"]["public_link_kind"]
          p_target: string
          p_token_hash: string
        }
        Returns: Json
      }
      create_rectification: {
        Args: { p_full?: boolean; p_invoice_id: string; p_reason: string }
        Returns: string
      }
      delete_expense_subscription: {
        Args: { p_id: string; p_with_expenses?: boolean }
        Returns: number
      }
      disconnect_integration: {
        Args: {
          p_org: string
          p_provider: Database["public"]["Enums"]["integration_provider"]
        }
        Returns: undefined
      }
      finalize_quote: { Args: { p_quote_id: string }; Returns: Json }
      import_historical_invoice: { Args: { p: Json }; Returns: string }
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
      portal_accept_quote: {
        Args: {
          p_evidence: Json
          p_quote_id: string
          p_token_hash: string
          p_version: string
        }
        Returns: string
      }
      portal_create_request: {
        Args: { p: Json; p_token_hash: string }
        Returns: string
      }
      portal_hit: {
        Args: {
          p_action: string
          p_limit: number
          p_token_hash: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      portal_link: {
        Args: { p_token_hash: string; p_track?: boolean; p_viewer?: string }
        Returns: Json
      }
      portal_reject_quote: {
        Args: { p_quote_id: string; p_reason?: string; p_token_hash: string }
        Returns: undefined
      }
      portal_save_invoice_draft: {
        Args: { p: Json; p_token_hash: string }
        Returns: string
      }
      rebill_expenses: { Args: { p: Json }; Returns: string }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_org: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: string
      }
      reject_quote: {
        Args: { p_quote_id: string; p_reason?: string }
        Returns: undefined
      }
      release_invoice_items: {
        Args: { p_invoice_id: string; p_reason?: string; p_waive: boolean }
        Returns: number
      }
      renew_public_link: { Args: { p_link_id: string }; Returns: string }
      reorder_catalog_bundles: { Args: { p_ids: string[] }; Returns: number }
      reorder_catalog_items: { Args: { p_ids: string[] }; Returns: number }
      reschedule_milestone: {
        Args: { p_milestone_id: string; p_planned_on: string }
        Returns: undefined
      }
      revoke_calendar_feed: { Args: { p_feed_id: string }; Returns: undefined }
      revoke_member_sessions: {
        Args: { p_member: string; p_org: string }
        Returns: number
      }
      revoke_public_link: { Args: { p_link_id: string }; Returns: undefined }
      save_catalog_bundle: { Args: { p: Json }; Returns: string }
      save_contract_milestones: {
        Args: { p: Json; p_contract_id: string }
        Returns: undefined
      }
      save_financial_policy: {
        Args: { p_data: Json; p_note?: string; p_org: string }
        Returns: number
      }
      save_invoice_draft: { Args: { p: Json }; Returns: string }
      save_quote: { Args: { p: Json }; Returns: string }
      save_shareholdings: {
        Args: {
          p: Json
          p_org: string
          p_previous_valid_from?: string
          p_valid_from: string
        }
        Returns: undefined
      }
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
      sepa_mark_generated: { Args: { p: Json }; Returns: undefined }
      sepa_mark_sent: { Args: { p_remittance_id: string }; Returns: undefined }
      sepa_return_item: {
        Args: {
          p_code?: string
          p_item_id: string
          p_reason?: string
          p_returned_on: string
        }
        Returns: undefined
      }
      sepa_revert_to_draft: {
        Args: { p_remittance_id: string }
        Returns: string
      }
      sepa_save_remittance: { Args: { p: Json }; Returns: string }
      sepa_settle_remittance: {
        Args: { p_remittance_id: string; p_settled_on: string }
        Returns: number
      }
      sepa_undo_return: { Args: { p_item_id: string }; Returns: undefined }
      series_counters: {
        Args: { p_org: string }
        Returns: {
          last_number: number
          series_id: string
          year: number
        }[]
      }
      set_my_weekly_digest: {
        Args: { p_enabled: boolean; p_org: string }
        Returns: undefined
      }
      set_series_last_number: {
        Args: { p_last_number: number; p_series_id: string; p_year: number }
        Returns: undefined
      }
      start_timer: {
        Args: { p_project_id: string; p_task_id?: string }
        Returns: string
      }
      stop_timer: { Args: never; Returns: string }
      unregister_push_subscription: {
        Args: { p_endpoint: string; p_org: string }
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
      agent_job_status:
        | "pending"
        | "running"
        | "done"
        | "failed"
        | "skipped"
        | "cancelled"
      agent_run_status: "running" | "succeeded" | "failed" | "skipped"
      app_locale: "es" | "ca" | "en"
      bank_direction: "credit" | "debit"
      bank_ignore_reason:
        | "internal_transfer"
        | "partner_movement"
        | "financing"
        | "tax_settlement"
        | "personal"
        | "other"
      bank_reconciliation_status:
        | "unmatched"
        | "partial"
        | "reconciled"
        | "ignored"
      bank_rule_field: "counterparty" | "concept"
      bank_statement_format: "n43" | "csv"
      billable_source: "recurring" | "usage" | "milestone"
      billable_state: "pending" | "drafted" | "invoiced" | "waived"
      billing_type: "one_off" | "monthly" | "yearly" | "usage"
      calendar_feed_scope: "mine" | "all"
      cash_balance_source: "manual" | "import"
      catalog_category:
        | "web"
        | "seo"
        | "ads"
        | "branding"
        | "social"
        | "hosting"
        | "maintenance"
        | "consulting"
        | "other"
      client_file_kind: "file" | "link"
      client_manual_status:
        | "pending_contact"
        | "lead"
        | "active"
        | "paused"
        | "finished"
        | "discarded"
      client_status: "lead" | "active" | "paused" | "former"
      contract_status: "draft" | "scheduled" | "active" | "paused" | "ended"
      cost_allocation: "company" | "client" | "hosted_sites"
      council_agent:
        | "cfo"
        | "commercial"
        | "pricing"
        | "retention"
        | "operations"
        | "growth"
        | "fiscal"
        | "devils_advocate"
        | "chief_of_staff"
      council_report_kind: "weekly_briefing" | "monthly_close"
      council_report_status: "published" | "accepted"
      email_status: "pending_approval" | "sent" | "failed" | "cancelled"
      email_template: "invoice" | "payment_reminder" | "quote" | "client_report"
      expense_group:
        | "operating"
        | "payroll"
        | "partner_compensation"
        | "cost_of_sales"
        | "taxes"
        | "financial"
        | "other"
      expense_rebill_state: "pending" | "drafted" | "invoiced"
      expense_source: "manual" | "import" | "subscription"
      expense_status: "pending" | "paid" | "overdue"
      fiscal_provider: "internal"
      import_kind: "clients" | "invoices"
      import_row_action: "create" | "update" | "skip" | "error"
      import_status: "draft" | "simulated" | "committed" | "failed"
      integration_provider: "google"
      integration_status: "connected" | "error" | "disconnected"
      invoice_attachment_kind: "original"
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
        | "quote_accepted"
        | "quote_rejected"
        | "portal_request"
        | "new_device"
        | "site_down"
        | "site_up"
        | "ssl_expiring"
        | "domain_expiring"
        | "subscription_renewal"
      payment_method: "transfer" | "sepa_debit" | "card" | "cash" | "other"
      project_kind:
        | "web"
        | "seo"
        | "ads"
        | "branding"
        | "social"
        | "maintenance"
        | "internal"
        | "other"
      project_status: "planned" | "active" | "paused" | "done" | "cancelled"
      project_task_priority: "low" | "normal" | "high" | "urgent"
      project_task_status: "todo" | "doing" | "review" | "done"
      public_link_kind: "quote" | "client"
      quote_state: "draft" | "sent" | "expired" | "accepted" | "rejected"
      quote_status: "draft" | "sent" | "accepted" | "rejected"
      recommendation_confidence: "alta" | "media" | "baja"
      recommendation_kind: "decision" | "alert" | "data_gap"
      recommendation_status:
        | "nueva"
        | "aceptada"
        | "descartada"
        | "pospuesta"
        | "hecha"
      recommendation_urgency: "hoy" | "esta_semana" | "este_mes"
      review_outcome: "hit" | "partial" | "miss" | "no_data"
      review_state: "pending" | "done" | "skipped"
      seo_source: "gsc" | "ga4" | "demo"
      sepa_item_state: "pending" | "collected" | "returned"
      sepa_remittance_status: "draft" | "generated" | "sent" | "settled"
      sepa_sequence_type: "FRST" | "RCUR"
      series_kind: "ordinary" | "rectifying"
      stage_kind: "open" | "won" | "lost"
      subscription_interval: "monthly" | "yearly"
      tax_id_kind: "es" | "eu_vat" | "foreign"
      tax_kind: "vat" | "irpf"
      time_entry_source: "app" | "gtiq"
      vat_regime: "general" | "exempt" | "reverse_charge_eu" | "not_subject"
      vendor_kind: "company" | "freelancer"
      web_channel:
        | "all"
        | "organic_search"
        | "paid_search"
        | "organic_social"
        | "paid_social"
        | "direct"
        | "referral"
        | "email"
        | "other"
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
      agent_job_status: [
        "pending",
        "running",
        "done",
        "failed",
        "skipped",
        "cancelled",
      ],
      agent_run_status: ["running", "succeeded", "failed", "skipped"],
      app_locale: ["es", "ca", "en"],
      bank_direction: ["credit", "debit"],
      bank_ignore_reason: [
        "internal_transfer",
        "partner_movement",
        "financing",
        "tax_settlement",
        "personal",
        "other",
      ],
      bank_reconciliation_status: [
        "unmatched",
        "partial",
        "reconciled",
        "ignored",
      ],
      bank_rule_field: ["counterparty", "concept"],
      bank_statement_format: ["n43", "csv"],
      billable_source: ["recurring", "usage", "milestone"],
      billable_state: ["pending", "drafted", "invoiced", "waived"],
      billing_type: ["one_off", "monthly", "yearly", "usage"],
      calendar_feed_scope: ["mine", "all"],
      cash_balance_source: ["manual", "import"],
      catalog_category: [
        "web",
        "seo",
        "ads",
        "branding",
        "social",
        "hosting",
        "maintenance",
        "consulting",
        "other",
      ],
      client_file_kind: ["file", "link"],
      client_manual_status: [
        "pending_contact",
        "lead",
        "active",
        "paused",
        "finished",
        "discarded",
      ],
      client_status: ["lead", "active", "paused", "former"],
      contract_status: ["draft", "scheduled", "active", "paused", "ended"],
      cost_allocation: ["company", "client", "hosted_sites"],
      council_agent: [
        "cfo",
        "commercial",
        "pricing",
        "retention",
        "operations",
        "growth",
        "fiscal",
        "devils_advocate",
        "chief_of_staff",
      ],
      council_report_kind: ["weekly_briefing", "monthly_close"],
      council_report_status: ["published", "accepted"],
      email_status: ["pending_approval", "sent", "failed", "cancelled"],
      email_template: ["invoice", "payment_reminder", "quote", "client_report"],
      expense_group: [
        "operating",
        "payroll",
        "partner_compensation",
        "cost_of_sales",
        "taxes",
        "financial",
        "other",
      ],
      expense_rebill_state: ["pending", "drafted", "invoiced"],
      expense_source: ["manual", "import", "subscription"],
      expense_status: ["pending", "paid", "overdue"],
      fiscal_provider: ["internal"],
      import_kind: ["clients", "invoices"],
      import_row_action: ["create", "update", "skip", "error"],
      import_status: ["draft", "simulated", "committed", "failed"],
      integration_provider: ["google"],
      integration_status: ["connected", "error", "disconnected"],
      invoice_attachment_kind: ["original"],
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
        "quote_accepted",
        "quote_rejected",
        "portal_request",
        "new_device",
        "site_down",
        "site_up",
        "ssl_expiring",
        "domain_expiring",
        "subscription_renewal",
      ],
      payment_method: ["transfer", "sepa_debit", "card", "cash", "other"],
      project_kind: [
        "web",
        "seo",
        "ads",
        "branding",
        "social",
        "maintenance",
        "internal",
        "other",
      ],
      project_status: ["planned", "active", "paused", "done", "cancelled"],
      project_task_priority: ["low", "normal", "high", "urgent"],
      project_task_status: ["todo", "doing", "review", "done"],
      public_link_kind: ["quote", "client"],
      quote_state: ["draft", "sent", "expired", "accepted", "rejected"],
      quote_status: ["draft", "sent", "accepted", "rejected"],
      recommendation_confidence: ["alta", "media", "baja"],
      recommendation_kind: ["decision", "alert", "data_gap"],
      recommendation_status: [
        "nueva",
        "aceptada",
        "descartada",
        "pospuesta",
        "hecha",
      ],
      recommendation_urgency: ["hoy", "esta_semana", "este_mes"],
      review_outcome: ["hit", "partial", "miss", "no_data"],
      review_state: ["pending", "done", "skipped"],
      seo_source: ["gsc", "ga4", "demo"],
      sepa_item_state: ["pending", "collected", "returned"],
      sepa_remittance_status: ["draft", "generated", "sent", "settled"],
      sepa_sequence_type: ["FRST", "RCUR"],
      series_kind: ["ordinary", "rectifying"],
      stage_kind: ["open", "won", "lost"],
      subscription_interval: ["monthly", "yearly"],
      tax_id_kind: ["es", "eu_vat", "foreign"],
      tax_kind: ["vat", "irpf"],
      time_entry_source: ["app", "gtiq"],
      vat_regime: ["general", "exempt", "reverse_charge_eu", "not_subject"],
      vendor_kind: ["company", "freelancer"],
      web_channel: [
        "all",
        "organic_search",
        "paid_search",
        "organic_social",
        "paid_social",
        "direct",
        "referral",
        "email",
        "other",
      ],
    },
  },
} as const

