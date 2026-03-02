import { STORAGE_KEY } from "./constants";
import { defaultData } from "./defaultData";
import { supabase, isSupabaseConfigured } from "./supabase";

const ROW_ID = "main";

// ---------------------------------------------------------------------------
// localStorage helpers (used as cache and offline fallback)
// ---------------------------------------------------------------------------
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultData,
        ...parsed,
        counters: { ...defaultData.counters, ...parsed.counters },
      };
    }
  } catch (e) {
    console.warn("Failed to load from localStorage:", e);
  }
  return null;
}

function saveLocal(d) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    console.warn("Failed to save to localStorage:", e);
  }
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------
async function loadFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from("app_state")
      .select("data")
      .eq("id", ROW_ID)
      .single();
    if (error) throw error;
    if (data && data.data && Object.keys(data.data).length > 0) {
      return {
        ...defaultData,
        ...data.data,
        counters: { ...defaultData.counters, ...(data.data.counters || {}) },
      };
    }
  } catch (e) {
    console.warn("Failed to load from Supabase:", e);
  }
  return null;
}

async function saveToSupabase(d) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("app_state")
      .upsert(
        { id: ROW_ID, data: d, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (error) throw error;
  } catch (e) {
    console.warn("Failed to save to Supabase:", e);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load data on startup.
 * Tries Supabase first, falls back to localStorage, then defaults.
 */
export async function loadData() {
  // Try Supabase
  const remote = await loadFromSupabase();
  if (remote) {
    saveLocal(remote); // cache locally
    return remote;
  }

  // Fall back to localStorage
  const local = loadLocal();
  if (local) return local;

  // Fall back to defaults
  return defaultData;
}

/**
 * Save data after every change.
 * Writes to both localStorage (instant) and Supabase (async).
 */
export function saveData(d) {
  saveLocal(d);
  saveToSupabase(d); // fire-and-forget
}

/**
 * Subscribe to real-time changes from other users.
 * Returns an unsubscribe function.
 */
export function subscribeToChanges(onUpdate) {
  if (!isSupabaseConfigured()) return () => {};

  const channel = supabase
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "app_state", filter: `id=eq.${ROW_ID}` },
      (payload) => {
        if (payload.new && payload.new.data && Object.keys(payload.new.data).length > 0) {
          const merged = {
            ...defaultData,
            ...payload.new.data,
            counters: { ...defaultData.counters, ...(payload.new.data.counters || {}) },
          };
          saveLocal(merged); // update local cache
          onUpdate(merged);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
