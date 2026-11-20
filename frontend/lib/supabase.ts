"use client";
// Supabase is used ONLY for login (publishable/anon key — public by design).
// All data goes through the SmartAttend API, which checks the login token.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("Login is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    }
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

export async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
