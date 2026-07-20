import { useState } from "react";
import { Avatar } from "./Avatar";
import { useAuth } from "@/lib/auth";
import { LogOut } from "lucide-react";

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { agent, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const displayName = agent?.name ?? session?.user?.email ?? "You";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-2 rounded-full p-1 pr-3 hover:bg-white/40 transition-colors"
      >
        <Avatar name={displayName} url={agent?.avatar_url} size="sm" />
        {!compact && (
          <span className="text-sm font-medium text-slate-800 max-w-[140px] truncate">
            {displayName}
          </span>
        )}
      </button>
      {open && (
        <div className="glass absolute right-0 mt-2 w-48 rounded-2xl p-2 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="px-3 py-2 text-xs text-slate-500 truncate">{session?.user?.email}</div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-800 hover:bg-white/60 transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}