import { supabase, isSupabaseConfigured } from "./supabase";

// Auth is only enforced when Supabase is configured. In local/demo mode
// (no Supabase env vars) the app runs unauthenticated against localStorage.
export const isAuthEnabled = () => isSupabaseConfigured();

export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  if (!isSupabaseConfigured()) throw new Error("Authentication is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
}

// Subscribe to auth state changes. Returns an unsubscribe function.
export function onAuthChange(callback) {
  if (!isSupabaseConfigured()) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
