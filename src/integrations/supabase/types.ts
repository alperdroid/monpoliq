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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_history: {
        Row: {
          current_value: number
          id: string
          message: string
          rule_id: string | null
          triggered_at: string
          user_id: string
        }
        Insert: {
          current_value?: number
          id?: string
          message?: string
          rule_id?: string | null
          triggered_at?: string
          user_id: string
        }
        Update: {
          current_value?: number
          id?: string
          message?: string
          rule_id?: string | null
          triggered_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_history_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          bank: string | null
          created_at: string
          email_notify: boolean
          id: string
          is_active: boolean
          last_triggered_at: string | null
          metric: string
          name: string
          operator: string
          rule_type: string
          threshold: number
          user_id: string
        }
        Insert: {
          bank?: string | null
          created_at?: string
          email_notify?: boolean
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          metric?: string
          name?: string
          operator?: string
          rule_type?: string
          threshold?: number
          user_id: string
        }
        Update: {
          bank?: string | null
          created_at?: string
          email_notify?: boolean
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          metric?: string
          name?: string
          operator?: string
          rule_type?: string
          threshold?: number
          user_id?: string
        }
        Relationships: []
      }
      analysis_cache: {
        Row: {
          analysis_type: string
          bank: string
          created_at: string
          data_hash: string
          id: string
          result: Json
        }
        Insert: {
          analysis_type: string
          bank: string
          created_at?: string
          data_hash: string
          id?: string
          result: Json
        }
        Update: {
          analysis_type?: string
          bank?: string
          created_at?: string
          data_hash?: string
          id?: string
          result?: Json
        }
        Relationships: []
      }
      committee_members: {
        Row: {
          bank: string
          created_at: string | null
          id: string
          institution: string
          is_core_board: boolean | null
          is_permanent_voter: boolean | null
          name: string
          notes: string | null
          role: string
          term_end: string | null
          term_start: string | null
          voting_years: number[] | null
        }
        Insert: {
          bank: string
          created_at?: string | null
          id?: string
          institution: string
          is_core_board?: boolean | null
          is_permanent_voter?: boolean | null
          name: string
          notes?: string | null
          role: string
          term_end?: string | null
          term_start?: string | null
          voting_years?: number[] | null
        }
        Update: {
          bank?: string
          created_at?: string | null
          id?: string
          institution?: string
          is_core_board?: boolean | null
          is_permanent_voter?: boolean | null
          name?: string
          notes?: string | null
          role?: string
          term_end?: string | null
          term_start?: string | null
          voting_years?: number[] | null
        }
        Relationships: []
      }
      dissent_history: {
        Row: {
          bank: string
          committee_action: string | null
          created_at: string | null
          dissent_direction: string
          id: string
          meeting_date: string
          member_name: string
          notes: string | null
          preferred_action: string | null
        }
        Insert: {
          bank?: string
          committee_action?: string | null
          created_at?: string | null
          dissent_direction: string
          id?: string
          meeting_date: string
          member_name: string
          notes?: string | null
          preferred_action?: string | null
        }
        Update: {
          bank?: string
          committee_action?: string | null
          created_at?: string | null
          dissent_direction?: string
          id?: string
          meeting_date?: string
          member_name?: string
          notes?: string | null
          preferred_action?: string | null
        }
        Relationships: []
      }
      prediction_cache: {
        Row: {
          created_at: string
          data_hash: string
          id: string
          predictions: Json
        }
        Insert: {
          created_at?: string
          data_hash: string
          id?: string
          predictions: Json
        }
        Update: {
          created_at?: string
          data_hash?: string
          id?: string
          predictions?: Json
        }
        Relationships: []
      }
      sentiment_items: {
        Row: {
          bank: string
          created_at: string
          dove_pts: number | null
          fetched_at: string
          hawk_pts: number | null
          id: string
          is_statistical: boolean
          item_date: string
          label: string | null
          net_score: number | null
          policy_dimensions: Json | null
          reasons: string[] | null
          source: string
          stat_metric: string | null
          stat_value: number | null
          stat_weight: number | null
          title: string
          topics: string[] | null
          url: string | null
          word_count: number | null
        }
        Insert: {
          bank: string
          created_at?: string
          dove_pts?: number | null
          fetched_at?: string
          hawk_pts?: number | null
          id?: string
          is_statistical?: boolean
          item_date: string
          label?: string | null
          net_score?: number | null
          policy_dimensions?: Json | null
          reasons?: string[] | null
          source: string
          stat_metric?: string | null
          stat_value?: number | null
          stat_weight?: number | null
          title: string
          topics?: string[] | null
          url?: string | null
          word_count?: number | null
        }
        Update: {
          bank?: string
          created_at?: string
          dove_pts?: number | null
          fetched_at?: string
          hawk_pts?: number | null
          id?: string
          is_statistical?: boolean
          item_date?: string
          label?: string | null
          net_score?: number | null
          policy_dimensions?: Json | null
          reasons?: string[] | null
          source?: string
          stat_metric?: string | null
          stat_value?: number | null
          stat_weight?: number | null
          title?: string
          topics?: string[] | null
          url?: string | null
          word_count?: number | null
        }
        Relationships: []
      }
      sentiment_scores: {
        Row: {
          bank: string
          created_at: string
          fetched_at: string
          id: string
          score_1_avg: number | null
          score_1_count: number | null
          score_1_dist: Json | null
          score_1_label: string | null
          score_2_avg: number | null
          score_2_count: number | null
          score_2_dist: Json | null
          score_2_label: string | null
        }
        Insert: {
          bank: string
          created_at?: string
          fetched_at?: string
          id?: string
          score_1_avg?: number | null
          score_1_count?: number | null
          score_1_dist?: Json | null
          score_1_label?: string | null
          score_2_avg?: number | null
          score_2_count?: number | null
          score_2_dist?: Json | null
          score_2_label?: string | null
        }
        Update: {
          bank?: string
          created_at?: string
          fetched_at?: string
          id?: string
          score_1_avg?: number | null
          score_1_count?: number | null
          score_1_dist?: Json | null
          score_1_label?: string | null
          score_2_avg?: number | null
          score_2_count?: number | null
          score_2_dist?: Json | null
          score_2_label?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
