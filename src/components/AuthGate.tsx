import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Login } from "./Login";
import { Skeleton } from "./Skeleton";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, session, agent } = useAuth();
  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Skeleton className="w-48 h-12" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (!agent) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="glass rounded-2xl p-8 max-w-sm">
          <div className="text-base font-bold mb-2">Account not provisioned</div>
          <p className="text-sm text-slate-600">
            Your sign-in is valid but no agent record exists for this email. Ask an admin to add you to the roster.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}