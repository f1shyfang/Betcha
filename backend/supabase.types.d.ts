// Generated Supabase types (partial) — used for TS projects
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      users: { Row: { id: string; email: string | null; display_name: string | null; created_at: string | null } }
      // ... other tables generated above
    }
  }
}
