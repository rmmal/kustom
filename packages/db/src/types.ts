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
      companion_commands: {
        Row: {
          acked_at: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["companion_command_kind"]
          payload: Json
          status: Database["public"]["Enums"]["companion_command_status"]
          target_player_id: string
        }
        Insert: {
          acked_at?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["companion_command_kind"]
          payload?: Json
          status?: Database["public"]["Enums"]["companion_command_status"]
          target_player_id: string
        }
        Update: {
          acked_at?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["companion_command_kind"]
          payload?: Json
          status?: Database["public"]["Enums"]["companion_command_status"]
          target_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_commands_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_commands_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_tokens: {
        Row: {
          created_at: string
          id: string
          label: string | null
          last_seen_at: string | null
          player_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          player_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          player_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_tokens_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_tokens_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_config: {
        Row: {
          blue_voice_channel_id: string | null
          created_at: string
          guild_id: string
          lobby_voice_channel_id: string | null
          red_voice_channel_id: string | null
          results_channel_id: string | null
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          blue_voice_channel_id?: string | null
          created_at?: string
          guild_id: string
          lobby_voice_channel_id?: string | null
          red_voice_channel_id?: string | null
          results_channel_id?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          blue_voice_channel_id?: string | null
          created_at?: string
          guild_id?: string
          lobby_voice_channel_id?: string | null
          red_voice_channel_id?: string | null
          results_channel_id?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      game_players: {
        Row: {
          assists: number
          champion_id: number | null
          cs: number
          damage_to_champs: number
          deaths: number
          game_id: string
          gold: number
          kills: number
          mu_after: number | null
          mu_before: number | null
          player_id: string
          role: Database["public"]["Enums"]["player_role"] | null
          side: number
          sigma_after: number | null
          sigma_before: number | null
        }
        Insert: {
          assists?: number
          champion_id?: number | null
          cs?: number
          damage_to_champs?: number
          deaths?: number
          game_id: string
          gold?: number
          kills?: number
          mu_after?: number | null
          mu_before?: number | null
          player_id: string
          role?: Database["public"]["Enums"]["player_role"] | null
          side: number
          sigma_after?: number | null
          sigma_before?: number | null
        }
        Update: {
          assists?: number
          champion_id?: number | null
          cs?: number
          damage_to_champs?: number
          deaths?: number
          game_id?: string
          gold?: number
          kills?: number
          mu_after?: number | null
          mu_before?: number | null
          player_id?: string
          role?: Database["public"]["Enums"]["player_role"] | null
          side?: number
          sigma_after?: number | null
          sigma_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "game_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          duration_s: number
          id: string
          lcu_game_id: number
          lobby_id: string | null
          raw: Json
          season_id: string
          source: Database["public"]["Enums"]["game_source"]
          started_at: string
          winning_side: number
        }
        Insert: {
          created_at?: string
          duration_s: number
          id?: string
          lcu_game_id: number
          lobby_id?: string | null
          raw: Json
          season_id?: string
          source?: Database["public"]["Enums"]["game_source"]
          started_at: string
          winning_side: number
        }
        Update: {
          created_at?: string
          duration_s?: number
          id?: string
          lcu_game_id?: number
          lobby_id?: string | null
          raw?: Json
          season_id?: string
          source?: Database["public"]["Enums"]["game_source"]
          started_at?: string
          winning_side?: number
        }
        Relationships: [
          {
            foreignKeyName: "games_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      lobbies: {
        Row: {
          created_at: string
          id: string
          lcu_party_id: string
          lobby_name: string | null
          lobby_password: string | null
          reported_by_player_id: string | null
          status: Database["public"]["Enums"]["lobby_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lcu_party_id: string
          lobby_name?: string | null
          lobby_password?: string | null
          reported_by_player_id?: string | null
          status?: Database["public"]["Enums"]["lobby_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lcu_party_id?: string
          lobby_name?: string | null
          lobby_password?: string | null
          reported_by_player_id?: string | null
          status?: Database["public"]["Enums"]["lobby_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobbies_reported_by_player_id_fkey"
            columns: ["reported_by_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_reported_by_player_id_fkey"
            columns: ["reported_by_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lobby_members: {
        Row: {
          created_at: string
          is_spectator: boolean
          lobby_id: string
          player_id: string
          role: Database["public"]["Enums"]["player_role"] | null
          role_override: Database["public"]["Enums"]["player_role"] | null
          side: number | null
        }
        Insert: {
          created_at?: string
          is_spectator?: boolean
          lobby_id: string
          player_id: string
          role?: Database["public"]["Enums"]["player_role"] | null
          role_override?: Database["public"]["Enums"]["player_role"] | null
          side?: number | null
        }
        Update: {
          created_at?: string
          is_spectator?: boolean
          lobby_id?: string
          player_id?: string
          role?: Database["public"]["Enums"]["player_role"] | null
          role_override?: Database["public"]["Enums"]["player_role"] | null
          side?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lobby_members_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobby_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobby_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          discord_id: string | null
          display_name: string | null
          game_name: string | null
          id: string
          is_admin: boolean
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        Insert: {
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string
          is_admin?: boolean
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Update: {
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string
          is_admin?: boolean
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          games: number
          mu: number
          ordinal: number | null
          player_id: string
          season_id: string
          sigma: number
          updated_at: string
          wins: number
        }
        Insert: {
          games?: number
          mu: number
          ordinal?: number | null
          player_id: string
          season_id: string
          sigma: number
          updated_at?: string
          wins?: number
        }
        Update: {
          games?: number
          mu?: number
          ordinal?: number | null
          player_id?: string
          season_id?: string
          sigma?: number
          updated_at?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          starts_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          starts_at?: string
        }
        Relationships: []
      }
      splits: {
        Row: {
          blue: Json
          blue_win_prob: number
          created_at: string
          explanation: string
          gap: number
          id: string
          is_chosen: boolean
          lobby_id: string
          off_role_count: number
          rank: number
          red: Json
          roster_key: string
          score: number
        }
        Insert: {
          blue: Json
          blue_win_prob: number
          created_at?: string
          explanation: string
          gap: number
          id?: string
          is_chosen?: boolean
          lobby_id: string
          off_role_count: number
          rank: number
          red: Json
          roster_key: string
          score: number
        }
        Update: {
          blue?: Json
          blue_win_prob?: number
          created_at?: string
          explanation?: string
          gap?: number
          id?: string
          is_chosen?: boolean
          lobby_id?: string
          off_role_count?: number
          rank?: number
          red?: Json
          roster_key?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "splits_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      players_public: {
        Row: {
          created_at: string | null
          display_name: string | null
          game_name: string | null
          id: string | null
          is_admin: boolean | null
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string | null
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string | null
          is_admin?: boolean | null
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string | null
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string | null
          is_admin?: boolean | null
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string | null
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      active_season_id: { Args: never; Returns: string }
      bootstrap_admin: {
        Args: { p_puuid: string }
        Returns: {
          created_at: string
          discord_id: string | null
          display_name: string | null
          game_name: string | null
          id: string
          is_admin: boolean
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        SetofOptions: {
          from: "*"
          to: "players"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_active_season: {
        Args: { p_id: string }
        Returns: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_season: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      companion_command_kind: "create_lobby" | "invite" | "switch_side"
      companion_command_status: "pending" | "sent" | "acked" | "failed"
      game_source: "eog" | "backfill"
      lobby_status: "open" | "balanced" | "in_game" | "finished" | "abandoned"
      player_role: "top" | "jungle" | "mid" | "adc" | "support"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      companion_command_kind: ["create_lobby", "invite", "switch_side"],
      companion_command_status: ["pending", "sent", "acked", "failed"],
      game_source: ["eog", "backfill"],
      lobby_status: ["open", "balanced", "in_game", "finished", "abandoned"],
      player_role: ["top", "jungle", "mid", "adc", "support"],
    },
  },
} as const

