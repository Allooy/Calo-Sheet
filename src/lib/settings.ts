import { supabase } from "./supabase";

/**
 * Shared admin settings, stored in Supabase so configuration is entered once
 * and follows every admin to every device.
 *
 * localStorage is kept as a cache only: it makes the UI populate instantly on
 * load and keeps things usable if the settings table hasn't been created yet.
 * The database is the source of truth whenever it answers.
 */

const cacheKey = (key: string) => `cx-settings-${key}`;

export function readCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function loadSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(data.value));
  } catch { /* quota or private mode — cache is optional */ }
  return data.value as T;
}

export async function saveSetting(key: string, value: unknown): Promise<string | null> {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(value));
  } catch { /* cache is optional */ }
  // delete-then-insert rather than upsert, matching the rest of the app's
  // write paths (upsert has bitten us with duplicate-key errors before).
  await supabase.from("app_settings").delete().eq("key", key);
  const { error } = await supabase
    .from("app_settings")
    .insert({ key, value, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}
