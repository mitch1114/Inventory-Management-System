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
      .select("data, updated_at")
      .eq("id", ROW_ID)
      .single();
    if (error) throw error;
    if (data && data.data && Object.keys(data.data).length > 0) {
      lastKnownRemoteTs = data.updated_at || lastKnownRemoteTs;
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

// Optional listener so the UI can surface database save failures instead of
// silently claiming "Synced" while changes live only in this browser.
let saveResultHandler = null;
export function onSaveResult(fn) {
  saveResultHandler = fn;
}

// Timestamp of the remote document this browser's state is based on. Used as
// an optimistic-concurrency token: a save is refused when the database holds
// a NEWER document than we last saw (stale tab -- e.g. a laptop that slept
// through other users' changes), because writing would silently overwrite
// their work. The conflict handler reloads fresh data instead.
let lastKnownRemoteTs = null;
let conflictHandler = null;
export function onConflict(fn) {
  conflictHandler = fn;
}

async function saveToSupabaseOnce(d) {
  if (!isSupabaseConfigured()) return;
  try {
    // Stale-write guard: refuse to clobber a newer document.
    if (lastKnownRemoteTs) {
      const { data: cur } = await supabase
        .from("app_state")
        .select("updated_at")
        .eq("id", ROW_ID)
        .single();
      if (cur && cur.updated_at && cur.updated_at > lastKnownRemoteTs) {
        console.warn(
          `Stale write blocked: database has ${cur.updated_at}, this tab is based on ${lastKnownRemoteTs}`,
        );
        if (conflictHandler) conflictHandler();
        return;
      }
    }
    const ts = new Date().toISOString();
    const { error } = await supabase
      .from("app_state")
      .upsert({ id: ROW_ID, data: d, updated_at: ts }, { onConflict: "id" });
    if (error) throw error;
    lastKnownRemoteTs = ts;
    if (saveResultHandler) saveResultHandler(true);
  } catch (e) {
    console.warn("Failed to save to Supabase:", e);
    if (saveResultHandler) saveResultHandler(false, e);
  }
}

// Serialize saves (latest-wins): rapid successive changes never interleave
// their guard-check/write pairs, which would trip the guard on our own saves.
let saveInFlight = false;
let pendingDoc = null;
async function saveToSupabase(d) {
  if (saveInFlight) {
    pendingDoc = d;
    return;
  }
  saveInFlight = true;
  try {
    await saveToSupabaseOnce(d);
  } finally {
    saveInFlight = false;
    if (pendingDoc) {
      const next = pendingDoc;
      pendingDoc = null;
      saveToSupabase(next);
    }
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
 * Re-fetch the latest document from Supabase if it is newer than what this
 * tab has seen. Returns the fresh document, or null when already current.
 * Called when the tab regains focus (sleeping laptops miss realtime events).
 */
export async function refreshFromRemote() {
  if (!isSupabaseConfigured()) return null;
  const before = lastKnownRemoteTs;
  const fresh = await loadFromSupabase();
  if (fresh && lastKnownRemoteTs !== before) {
    saveLocal(fresh);
    return fresh;
  }
  return null;
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
          // Track the remote timestamp even for our own save's echo -- it is
          // the basis for the stale-write guard.
          if (payload.new.updated_at) lastKnownRemoteTs = payload.new.updated_at;
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
