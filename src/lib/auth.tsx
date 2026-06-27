import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Agent } from "./supabase";

type AuthCtx = {
  ready: boolean;
  session: Session | null;
  agent: Agent | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [ready, setReady] = useState(false);

  async function loadAgent(s: Session | null) {
    if (!s?.user?.email) {
      setAgent(null);
      return;
    }
    const { data } = await supabase
      .from("agents")
      .select("*")
      .eq("email", s.user.email)
      .maybeSingle();
    setAgent((data as Agent | null) ?? null);
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadAgent(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      loadAgent(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        ready,
        session,
        agent,
        signOut: async () => {
          await supabase.auth.signOut();
        },
        refresh: () => loadAgent(session),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}