export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
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
      counters: {
        Row: {
          code: string
          created_at: string
          id: string
          invoice_prefix: string
          is_active: boolean
          kind: string
          print_width_mm: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          invoice_prefix: string
          is_active?: boolean
          kind: string
          print_width_mm?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          invoice_prefix?: string
          is_active?: boolean
          kind?: string
          print_width_mm?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          catalog_price: number
          cgst: number
          gst_rate: number
          hsn_code: string | null
          id: string
          invoice_id: string
          item_code: string
          line_no: number
          line_total: number
          mrp: number | null
          name: string
          price_edited: boolean
          product_id: string
          qty: number
          sgst: number
          taxable_value: number
          unit_price: number
          uom: string
        }
        Insert: {
          catalog_price: number
          cgst: number
          gst_rate: number
          hsn_code?: string | null
          id?: string
          invoice_id: string
          item_code: string
          line_no: number
          line_total: number
          mrp?: number | null
          name: string
          price_edited?: boolean
          product_id: string
          qty: number
          sgst: number
          taxable_value: number
          unit_price: number
          uom: string
        }
        Update: {
          catalog_price?: number
          cgst?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          invoice_id?: string
          item_code?: string
          line_no?: number
          line_total?: number
          mrp?: number | null
          name?: string
          price_edited?: boolean
          product_id?: string
          qty?: number
          sgst?: number
          taxable_value?: number
          unit_price?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          counter_id: string
          fy: string
          last_number: number
          updated_at: string
        }
        Insert: {
          counter_id: string
          fy: string
          last_number: number
          updated_at?: string
        }
        Update: {
          counter_id?: string
          fy?: string
          last_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_counter_id_fkey"
            columns: ["counter_id"]
            isOneToOne: false
            referencedRelation: "counters"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          cashier_name: string
          cashier_user_id: string
          cgst_total: number
          counter_code: string
          counter_id: string
          created_at: string
          fy: string
          grand_total: number
          has_price_edit: boolean
          id: string
          idempotency_key: string
          invoice_footer: string | null
          invoice_no: string
          item_count: number
          payment_method: string
          round_off: number
          seq_number: number
          sgst_total: number
          store_address: string
          store_gstin: string
          store_legal_name: string
          store_phone: string | null
          store_state_code: string
          store_state_name: string
          subtotal: number
          taxable_total: number
          total_qty: number
        }
        Insert: {
          cashier_name: string
          cashier_user_id: string
          cgst_total: number
          counter_code: string
          counter_id: string
          created_at?: string
          fy: string
          grand_total: number
          has_price_edit?: boolean
          id?: string
          idempotency_key: string
          invoice_footer?: string | null
          invoice_no: string
          item_count: number
          payment_method: string
          round_off: number
          seq_number: number
          sgst_total: number
          store_address: string
          store_gstin: string
          store_legal_name: string
          store_phone?: string | null
          store_state_code: string
          store_state_name: string
          subtotal: number
          taxable_total: number
          total_qty: number
        }
        Update: {
          cashier_name?: string
          cashier_user_id?: string
          cgst_total?: number
          counter_code?: string
          counter_id?: string
          created_at?: string
          fy?: string
          grand_total?: number
          has_price_edit?: boolean
          id?: string
          idempotency_key?: string
          invoice_footer?: string | null
          invoice_no?: string
          item_count?: number
          payment_method?: string
          round_off?: number
          seq_number?: number
          sgst_total?: number
          store_address?: string
          store_gstin?: string
          store_legal_name?: string
          store_phone?: string | null
          store_state_code?: string
          store_state_name?: string
          subtotal?: number
          taxable_total?: number
          total_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_counter_id_fkey"
            columns: ["counter_id"]
            isOneToOne: false
            referencedRelation: "counters"
            referencedColumns: ["id"]
          },
        ]
      }
      product_barcodes: {
        Row: {
          barcode: string
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          barcode: string
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          barcode?: string
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_barcodes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          department: string | null
          gst_rate: number
          hsn_code: string | null
          id: string
          is_active: boolean
          item_code: string
          mrp: number | null
          name: string
          selling_price: number
          stock_qty: number
          uom: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          department?: string | null
          gst_rate: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          item_code: string
          mrp?: number | null
          name: string
          selling_price: number
          stock_qty?: number
          uom?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          department?: string | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          item_code?: string
          mrp?: number | null
          name?: string
          selling_price?: number
          stock_qty?: number
          uom?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          counter_id: string | null
          created_at: string
          display_name: string
          is_active: boolean
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          counter_id?: string | null
          created_at?: string
          display_name: string
          is_active?: boolean
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          counter_id?: string | null
          created_at?: string
          display_name?: string
          is_active?: boolean
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_counter_id_fkey"
            columns: ["counter_id"]
            isOneToOne: false
            referencedRelation: "counters"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string
          created_at: string
          default_print_width_mm: number
          fy_label: string
          gstin: string
          id: boolean
          invoice_footer: string | null
          legal_name: string
          phone: string | null
          state_code: string
          state_name: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          default_print_width_mm?: number
          fy_label: string
          gstin: string
          id?: boolean
          invoice_footer?: string | null
          legal_name: string
          phone?: string | null
          state_code: string
          state_name: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          default_print_width_mm?: number
          fy_label?: string
          gstin?: string
          id?: boolean
          invoice_footer?: string | null
          legal_name?: string
          phone?: string | null
          state_code?: string
          state_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_invoice: {
        Args: {
          p_cashier_user_id: string
          p_counter_id: string
          p_idempotency_key: string
          p_items: Json
          p_payment_method: string
        }
        Returns: Json
      }
      get_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      invoice_day_totals: {
        Args: { p_counter_id?: string; p_from: string; p_to: string }
        Returns: {
          cgst_total: number
          edited_count: number
          grand_total: number
          invoice_count: number
          payment_method: string
          round_off: number
          sgst_total: number
          taxable_total: number
        }[]
      }
      invoice_export_lines: {
        Args: {
          p_after_created_at?: string
          p_after_invoice_no?: string
          p_after_line_no?: number
          p_counter_id?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          cashier_name: string
          catalog_price: number
          cgst: number
          counter_code: string
          created_at: string
          gst_rate: number
          hsn_code: string
          invoice_no: string
          item_code: string
          line_no: number
          line_total: number
          mrp: number
          name: string
          payment_method: string
          price_edited: boolean
          qty: number
          sgst: number
          taxable_value: number
          unit_price: number
          uom: string
        }[]
      }
      invoice_export_summary: {
        Args: {
          p_after_created_at?: string
          p_after_invoice_no?: string
          p_counter_id?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          cashier_name: string
          cgst_total: number
          counter_code: string
          created_at: string
          grand_total: number
          has_price_edit: boolean
          invoice_no: string
          item_count: number
          payment_method: string
          round_off: number
          sgst_total: number
          taxable_total: number
          total_qty: number
        }[]
      }
      invoice_json: { Args: { p_invoice_id: string }; Returns: Json }
      lookup_product: {
        Args: { p_code: string }
        Returns: {
          category: string | null
          created_at: string
          department: string | null
          gst_rate: number
          hsn_code: string | null
          id: string
          is_active: boolean
          item_code: string
          mrp: number | null
          name: string
          selling_price: number
          stock_qty: number
          uom: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
