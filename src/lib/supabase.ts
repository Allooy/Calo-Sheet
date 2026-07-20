import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qaimveqjebgmermefsya.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhaW12ZXFqZWJnbWVybWVmc3lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTcyMDcsImV4cCI6MjA5Nzg3MzIwN30.n3iCR06N23T1vNHrEcMZ233QzUMFab7lK4DrfQmYMnE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

export type Role = "agent" | "admin";

export type Agent = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  is_lead: boolean;
  avatar_url: string | null;
  created_at: string;
};

export type Schedule = {
  id: string;
  agent_id: string;
  date: string; // YYYY-MM-DD
  shift_code: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Fetch ALL schedules in a date range, paging past Supabase's 1000-row cap so a
// full-month, all-agents grid never silently truncates (which made some agents
// look empty).
export async function fetchSchedulesInRange(from: string, to: string): Promise<Schedule[]> {
  const all: Schedule[] = [];
  const size = 1000;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase
      .from("schedules")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .range(page * size, page * size + size - 1);
    if (error) break;
    const rows = (data as Schedule[] | null) ?? [];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

export type ShiftType = {
  code: string;
  label: string;
  start_time: string | null;
  end_time: string | null;
  category: string | null;
};

export type AuditLog = {
  id: string;
  user_email: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
};