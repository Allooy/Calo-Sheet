import { useState } from "react";
import { Avatar } from "./Avatar";
import { useAuth } from "@/lib/auth";
import { LogOut, Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";

const MODES: Array<{ key: Theme; icon: typeof Sun; label: string }> = [
  { key: "light", icon: Sun, label: "Light" },
  { key: "dark", icon: Moon, label: "Dark" },
  { key: "system", icon: Monitor, label: "Auto" },
];

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { agent, session, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
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
        <div className="glass absolute right-0 mt-2 w-52 rounded-2xl p-2 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="px-3 py-2 text-xs text-slate-500 truncate">{session?.user?.email}</div>

          <div className="px-1 py-1">
            <div className="label-caps text-slate-400 px-2 pb-1.5">Theme</div>
            {/* onMouseDown, not onClick: the trigger's onBlur closes the menu
                before a click would ever land. */}
            <div className="flex gap-1 bg-black/[0.04] rounded-xl p-1">
              {MODES.map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onMouseDown={(e) => { e.preventDefault(); setTheme(key); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold transition-all ${
                    theme === key
                      ? "bg-[#52B788] text-white shadow-sm"
                      : "text-slate-500 hover:bg-white/50"
                  }`}
                  aria-pressed={theme === key}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onMouseDown={(e) => { e.preventDefault(); signOut(); }}
            className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-800 hover:bg-white/60 transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
