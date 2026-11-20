"use client";
// Login state via Supabase Auth. After sign-in, /api/me confirms the account has a
// SmartAttend staff profile (admin or teacher); accounts without one are signed out.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, setUnauthorizedHandler, type User } from "./api";
import { supabase } from "./supabase";

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setUser(null);
    try { supabase().auth.signOut(); } catch { /* not configured */ }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    let alive = true;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const sb = supabase();
        const { data } = await sb.auth.getSession();
        if (data.session) {
          try { const me = await api<User>("/api/me"); if (alive) setUser(me); }
          catch { await sb.auth.signOut(); }
        }
        const sub = sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT" && alive) setUser(null); });
        unsub = () => sub.data.subscription.unsubscribe();
      } catch { /* login not configured: stay signed out */ }
      if (alive) setReady(true);
    })();
    return () => { alive = false; unsub?.(); };
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const sb = supabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password" : error.message);
    try {
      setUser(await api<User>("/api/me"));
    } catch (e) {
      await sb.auth.signOut();
      throw e instanceof ApiError && e.status === 403 ? new Error(e.message) : e;
    }
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
