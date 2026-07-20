import { Link, useRouterState } from "@tanstack/react-router";
import { Clock, Calendar, Users, Shield, Table2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { UserMenu } from "./UserMenu";

const ITEMS = [
  { to: "/today", label: "Today", icon: Clock, admin: false },
  { to: "/schedule", label: "My Schedule", icon: Calendar, admin: false },
  { to: "/team", label: "Team", icon: Users, admin: false },
  { to: "/roster", label: "Roster", icon: Table2, admin: false },
  { to: "/admin", label: "Admin", icon: Shield, admin: true },
] as const;

const TITLES: Record<string, string> = {
  "/today": "Today",
  "/schedule": "My Schedule",
  "/team": "Team",
  "/roster": "Roster",
  "/admin": "Admin",
};

// Persists across AppShell remounts (each route renders its own AppShell), so
// the sliding pill always starts from where it last was instead of resetting to 0.
let lastPill: { x: number; w: number } | null = null;

// Smooth ease-out (no overshoot, so it glides and settles without jiggling).
const PILL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const PILL_TRANSITION = `transform 0.5s ${PILL_EASE}, width 0.5s ${PILL_EASE}`;

export function AppShell({ children }: { children: ReactNode }) {
  const { agent } = useAuth();
  const isAdmin = agent?.role === "admin";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = ITEMS.filter((i) => !i.admin || isAdmin);
  const title = TITLES[pathname] ?? "CX Workforce";
  const [scrolled, setScrolled] = useState(false);

  // Per-page browser tab title.
  useEffect(() => {
    document.title = `${title} · Calo CX`;
  }, [title]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Liquid-glass bottom nav: sliding pill ──
  // The pill's transform/width are driven imperatively (not via React state) so
  // that re-renders (e.g. on scroll) never reset an in-flight transition, and
  // so we fully control the start→end frames the browser sees.
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const activeIndex = items.findIndex(
    ({ to }) => pathname === to || (to !== "/today" && pathname.startsWith(to)),
  );

  useLayoutEffect(() => {
    const pillEl = pillRef.current;
    const nav = navRef.current;
    const item = itemRefs.current[activeIndex];
    if (!pillEl || !nav || !item) return;

    const compute = () => {
      const navRect = nav.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      return { x: r.left - navRect.left, w: r.width };
    };

    const next = compute();
    const start = lastPill ?? next;

    // Place at the start (previous) position instantly, before the first paint.
    pillEl.style.transition = "none";
    pillEl.style.opacity = "1";
    pillEl.style.width = `${start.w}px`;
    pillEl.style.transform = `translateX(${start.x}px)`;
    void pillEl.offsetWidth; // flush the start frame

    // Next frame (after the browser has painted `start`): animate to the target.
    // Commit lastPill HERE, not synchronously — Strict Mode double-invokes this
    // effect (setup→cleanup→setup); the cleanup cancels this rAF, so updating
    // lastPill inside it prevents the second setup from seeing start === next
    // (which would make it teleport).
    const id = requestAnimationFrame(() => {
      pillEl.style.transition = PILL_TRANSITION;
      pillEl.style.width = `${next.w}px`;
      pillEl.style.transform = `translateX(${next.x}px)`;
      lastPill = next;
    });

    const onResize = () => {
      const n = compute();
      pillEl.style.transition = "none";
      pillEl.style.width = `${n.w}px`;
      pillEl.style.transform = `translateX(${n.x}px)`;
      lastPill = n;
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [activeIndex, items.length]);

  return (
    <div className="min-h-screen w-full">
      <aside className="hidden md:flex fixed top-3 left-3 bottom-3 flex-col group/sb transition-[width] duration-300 ease-out w-16 hover:w-[220px] glass rounded-3xl overflow-hidden z-30 will-change-[width]">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2">
          <img src="/calologo.avif" alt="Calo" className="w-8 h-8 object-contain shrink-0" />
          <span className="opacity-0 group-hover/sb:opacity-100 transition-opacity text-sm font-bold whitespace-nowrap">
            CX Workforce
          </span>
        </div>
        <nav className="flex-1 px-2 py-2 flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/today" && pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  active ? "bg-white/80 text-[#2d7a56] shadow-sm" : "text-slate-600 hover:bg-white/50"
                }`}
              >
                <span className="relative grid place-items-center w-6 h-6 shrink-0">
                  <Icon size={20} strokeWidth={active ? 2.5 : 2} fill="none" />
                  {active && <span className="absolute -left-3 w-1 h-5 rounded-full bg-[#52B788]" />}
                </span>
                <span className="opacity-0 group-hover/sb:opacity-100 transition-opacity text-sm font-medium whitespace-nowrap">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 opacity-0 group-hover/sb:opacity-100 transition-opacity">
          <UserMenu />
        </div>
      </aside>

      <div className="min-w-0 flex flex-col min-h-screen">
        <header
          className="sticky top-0 z-20 px-4 md:px-8 md:pl-[88px] pt-4 pb-3 flex items-center justify-between transition-all duration-300"
          style={
            scrolled
              ? {
                  background: "rgba(255,255,255,0.72)",
                  backdropFilter: "blur(20px) saturate(180%)",
                  WebkitBackdropFilter: "blur(20px) saturate(180%)",
                  borderBottom: "1px solid rgba(82,183,136,0.12)",
                  boxShadow: "0 1px 12px rgba(82,183,136,0.06)",
                }
              : {
                  background: "transparent",
                  borderBottom: "1px solid transparent",
                }
          }
        >
          <h1
            className="text-2xl md:text-3xl font-extrabold tracking-[-0.02em] text-slate-900 truncate min-w-0"
          >
            {title ?? "CX Workforce"}
          </h1>
          <div className="flex items-center gap-2.5 shrink-0 pl-3">
            <div className="text-right leading-tight">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Hey 👋
              </div>
              <div className="text-[13px] font-bold text-slate-800 max-w-[140px] truncate">
                {agent?.name ?? "Welcome"}
              </div>
            </div>
            <UserMenu compact />
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 md:pl-[88px] pb-28 md:pb-8 pt-2 animate-[fade-in_0.25s_ease-out]">
          {children}
        </main>
      </div>

      {/* White veil so nothing shows behind / beside the floating nav */}
      <div
        className="md:hidden fixed left-0 right-0 bottom-0 z-[39] pointer-events-none"
        style={{
          height: "calc(56px + 2.75rem)",
          background:
            "linear-gradient(to top, #ffffff 0%, #ffffff 45%, rgba(255,255,255,0.85) 65%, transparent 100%)",
        }}
      />

      <nav
        ref={navRef}
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center p-1.5 rounded-full"
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(240,249,245,0.95) 100%)",
          backdropFilter: "blur(28px) saturate(125%)",
          WebkitBackdropFilter: "blur(28px) saturate(125%)",
          border: "1px solid rgba(255,255,255,0.9)",
          boxShadow:
            "0 10px 36px rgba(82,183,136,0.22), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        {/* Sliding liquid pill — transform/width set imperatively (see effect) */}
        <span
          ref={pillRef}
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-0 rounded-full opacity-0 pointer-events-none"
          style={{
            background: "linear-gradient(165deg, #61c497 0%, #52B788 45%, #3d9a70 100%)",
            boxShadow:
              "0 6px 18px rgba(61,154,112,0.5), inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -2px 4px rgba(0,0,0,0.08)",
          }}
        />

        {items.map(({ to, label, icon: Icon }, i) => {
          const active = i === activeIndex;
          const isSchedule = label === "My Schedule";
          const short = isSchedule ? "Schedule" : label.split(" ")[0];
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              ref={(el) => { itemRefs.current[i] = el; }}
              className={`relative z-10 flex items-center justify-center h-11 ${isSchedule ? "w-[112px]" : "w-[86px]"} rounded-full active:scale-90 transition-transform duration-200`}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.5 : 1.9}
                fill="none"
                className="shrink-0"
                style={{ color: active ? "#ffffff" : "#94a3b8", transition: "color 0.3s ease" }}
              />
              <span
                className="font-bold text-[13px] whitespace-nowrap overflow-hidden"
                style={{
                  color: "#ffffff",
                  maxWidth: active ? "68px" : "0px",
                  marginLeft: active ? "6px" : "0px",
                  opacity: active ? 1 : 0,
                  transition:
                    "max-width 0.5s cubic-bezier(0.22, 1, 0.36, 1), margin-left 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease",
                }}
              >
                {short}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}