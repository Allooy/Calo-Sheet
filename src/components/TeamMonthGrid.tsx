import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GlassCard } from "./GlassCard";
import { Avatar } from "./Avatar";
import { Skeleton } from "./Skeleton";
import { LeadBadge } from "./LeadBadge";
import { supabase, fetchSchedulesInRange, type Agent, type Schedule } from "@/lib/supabase";
import { codeStyle, shortCode } from "@/lib/shifts";
import { useDragScroll } from "@/lib/useDragScroll";

/** Read-only full-team month grid (agents × dates). Used by Admin Overview and
 * the top-level Roster tab. No editing. */
export function TeamMonthGrid() {
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = useMemo(
    () => eachDayOfInterval({ start: monthStart, end: monthEnd }),
    [monthStart, monthEnd],
  );

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      const from = format(monthStart, "yyyy-MM-dd");
      const to = format(monthEnd, "yyyy-MM-dd");
      const [a, s] = await Promise.all([
        supabase.from("agents").select("*").eq("active", true).order("name"),
        fetchSchedulesInRange(from, to),
      ]);
      if (cancel) return;
      setAgents((a.data as Agent[] | null) ?? []);
      setRows(s);
      setLoading(false);
    }
    load();
    return () => { cancel = true; };
  }, [cursor]);

  const lookup = useMemo(() => {
    const m = new Map<string, Schedule>();
    for (const r of rows) m.set(`${r.agent_id}|${r.date}`, r);
    return m;
  }, [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollX = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  useDragScroll(scrollRef);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCursor((c) => subMonths(c, 1))} className="w-9 h-9 rounded-full glass grid place-items-center">
          <ChevronLeft size={16} />
        </button>
        <div className="font-bold text-lg">{format(cursor, "MMMM yyyy")}</div>
        <button onClick={() => setCursor((c) => addMonths(c, 1))} className="w-9 h-9 rounded-full glass grid place-items-center">
          <ChevronRight size={16} />
        </button>
        <span className="text-xs text-slate-500 ml-1">{agents.length} agents · read-only</span>
        {/* Scroll the table horizontally */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">Scroll dates</span>
          <button onClick={() => scrollX(-320)} className="w-8 h-8 rounded-full glass grid place-items-center active:scale-90" aria-label="Scroll left">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => scrollX(320)} className="w-8 h-8 rounded-full glass grid place-items-center active:scale-90" aria-label="Scroll right">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-4 flex flex-col gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto show-scroll pb-1 max-h-[70vh]"
            onScroll={(e) => setCollapsed(e.currentTarget.scrollLeft > 24)}
          >
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-30 bg-white/95 backdrop-blur-md text-left px-3 py-2 font-semibold text-slate-700 border-b border-white/40 transition-all duration-300"
                    style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                  >
                    <span
                      className="inline-block overflow-hidden whitespace-nowrap align-middle transition-all duration-300"
                      style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
                    >
                      Agent
                    </span>
                  </th>
                  {days.map((d) => {
                    const today = isSameDay(d, new Date());
                    return (
                      <th
                        key={d.toISOString()}
                        className="px-1.5 py-2 font-semibold text-center min-w-[46px] border-b border-white/40 sticky top-0 z-20 backdrop-blur-md"
                        style={{
                          background: today ? "rgba(82,183,136,0.22)" : "rgba(255,255,255,0.95)",
                          boxShadow: today ? "inset 0 -3px 0 #52B788" : undefined,
                        }}
                      >
                        <div
                          className="text-[9px] uppercase"
                          style={{ color: today ? "#2d7a56" : "#64748b", fontWeight: today ? 700 : 500 }}
                        >
                          {format(d, "EEE")}
                        </div>
                        <div
                          className="text-sm"
                          style={{ color: today ? "#2d7a56" : "#1e293b", fontWeight: today ? 800 : 600 }}
                        >
                          {format(d, "d")}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="hover:bg-white/30">
                    <td
                      className="sticky left-0 z-10 bg-white/90 backdrop-blur-md px-3 py-1.5 border-b border-white/30 transition-all duration-300"
                      style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          tabIndex={0}
                          className="relative group/pfp outline-none shrink-0"
                          aria-label={a.name}
                        >
                          <Avatar name={a.name} url={a.avatar_url} size="sm" />
                          <span
                            className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 opacity-0 group-hover/pfp:opacity-100 group-focus/pfp:opacity-100 transition-opacity duration-150 bg-slate-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap shadow-lg"
                          >
                            {a.name}
                            {a.is_lead ? " · Lead" : ""}
                          </span>
                        </div>
                        <span
                          className="font-medium whitespace-nowrap overflow-hidden transition-all duration-300"
                          style={{ maxWidth: collapsed ? 0 : 140, opacity: collapsed ? 0 : 1 }}
                        >
                          {a.name}
                        </span>
                        {!collapsed && a.is_lead && <LeadBadge variant="icon" />}
                      </div>
                    </td>
                    {days.map((d) => {
                      const dk = format(d, "yyyy-MM-dd");
                      const r = lookup.get(`${a.id}|${dk}`);
                      const s = codeStyle(r?.shift_code);
                      const cc = s.text;
                      const today = isSameDay(d, new Date());
                      return (
                        <td
                          key={dk}
                          className="p-0.5 border-b border-white/30 text-center"
                          style={today ? { background: "rgba(82,183,136,0.08)" } : undefined}
                        >
                          {r ? (
                            <div
                              className="rounded-md px-1 py-1 text-[10px] font-bold uppercase leading-none"
                              style={{ background: s.bg, color: cc }}
                            >
                              {shortCode(r.shift_code)}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-300">·</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
