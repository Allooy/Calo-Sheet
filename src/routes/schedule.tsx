import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, X, Users } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { ShiftBadge } from "@/components/ShiftBadge";
import { Avatar } from "@/components/Avatar";
import { AgentRequests } from "@/components/AgentRequests";
import { LeadBadge } from "@/components/LeadBadge";
import { Skeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import { supabase, type Agent, type Schedule, type ShiftType } from "@/lib/supabase";
import {
  categoryStyle,
  codeStyle,
  formatTimeRange,
  shiftCategory,
  shortCode,
  DEFAULT_TIMES,
  type ShiftCategory,
} from "@/lib/shifts";

export const Route = createFileRoute("/schedule")({
  component: SchedulePage,
});

// Shift time window in minutes-from-midnight; overnight shifts extend past 1440.
function toMin(t?: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m ?? "0", 10);
}
function shiftWindow(
  code: string,
  types: Record<string, ShiftType>,
): [number, number] | null {
  const ft = types[code];
  const s = toMin(ft?.start_time ?? DEFAULT_TIMES[code]?.[0]);
  let e = toMin(ft?.end_time ?? DEFAULT_TIMES[code]?.[1]);
  if (s == null || e == null) return null;
  if (e <= s) e += 1440; // crosses midnight
  return [s, e];
}
function overlaps(a: [number, number], b: [number, number]) {
  return a[0] < b[1] && b[0] < a[1];
}

function SchedulePage() {
  const { agent } = useAuth();
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [shiftTypes, setShiftTypes] = useState<Record<string, ShiftType>>({});
  const [selected, setSelected] = useState<Date | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  useEffect(() => {
    if (!agent) return;
    let cancel = false;
    async function load() {
      setLoading(true);
      const from = format(gridStart, "yyyy-MM-dd");
      const to = format(gridEnd, "yyyy-MM-dd");
      const [s, t] = await Promise.all([
        supabase
          .from("schedules")
          .select("*")
          .eq("agent_id", agent!.id)
          .gte("date", from)
          .lte("date", to),
        supabase.from("shift_types").select("*"),
      ]);
      if (cancel) return;
      setRows((s.data as Schedule[] | null) ?? []);
      const map: Record<string, ShiftType> = {};
      for (const r of (t.data as ShiftType[] | null) ?? []) map[r.code] = r;
      setShiftTypes(map);
      setLoading(false);
    }
    load();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Schedule>();
    for (const r of rows) map.set(r.date, r);
    return map;
  }, [rows]);

  const summary = useMemo(() => {
    let m = 0,
      e = 0,
      g = 0,
      o = 0;
    for (const r of rows) {
      if (!isSameMonth(new Date(r.date), cursor)) continue;
      const c = shiftCategory(r.shift_code);
      if (c === "morning") m++;
      else if (c === "evening") e++;
      else if (c === "graveyard") g++;
      else if (c === "off") o++;
    }
    return { m, e, g, o };
  }, [rows, cursor]);

  // Month conclusion: only categories that actually occur.
  const legend = useMemo(
    () =>
      (
        [
          { cat: "morning" as ShiftCategory, label: "Morning", v: summary.m },
          { cat: "evening" as ShiftCategory, label: "Evening", v: summary.e },
          { cat: "graveyard" as ShiftCategory, label: "Graveyard", v: summary.g },
          { cat: "off" as ShiftCategory, label: "Off", v: summary.o },
        ]
      ).filter((d) => d.v > 0),
    [summary],
  );

  const selectedRow = selected ? byDate.get(format(selected, "yyyy-MM-dd")) : null;

  // Colleagues whose shift overlaps mine on the selected day.
  const [roster, setRoster] = useState<{ agent: Agent; schedule: Schedule }[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // If I'm working → show colleagues whose shift overlaps mine.
  // If I'm OFF (or the day is unset) → show everyone who IS working that day.
  const myWindow = selectedRow ? shiftWindow(selectedRow.shift_code, shiftTypes) : null;

  useEffect(() => {
    if (!agent || !selected) {
      setRoster([]);
      return;
    }
    let cancel = false;
    (async () => {
      setRosterLoading(true);
      const dateStr = format(selected, "yyyy-MM-dd");
      const [a, s] = await Promise.all([
        supabase.from("agents").select("*").eq("active", true),
        supabase.from("schedules").select("*").eq("date", dateStr),
      ]);
      if (cancel) return;
      const byId = new Map(((a.data as Agent[] | null) ?? []).map((x) => [x.id, x]));
      const list = (((s.data as Schedule[] | null) ?? [])
        .filter((sc) => sc.agent_id !== agent.id)
        .map((sc) => {
          const win = shiftWindow(sc.shift_code, shiftTypes);
          if (!win) return null; // skip OFF / AL / PH etc.
          if (myWindow && !overlaps(myWindow, win)) return null; // only overlaps when I'm working
          const ag = byId.get(sc.agent_id);
          return ag ? { agent: ag, schedule: sc } : null;
        })
        .filter(Boolean) as { agent: Agent; schedule: Schedule }[])
        .sort((x, y) => {
          if (x.agent.is_lead !== y.agent.is_lead)
            return Number(y.agent.is_lead) - Number(x.agent.is_lead);
          const sx = shiftWindow(x.schedule.shift_code, shiftTypes)?.[0] ?? 0;
          const sy = shiftWindow(y.schedule.shift_code, shiftTypes)?.[0] ?? 0;
          return sx - sy || x.agent.name.localeCompare(y.agent.name);
        });
      setRoster(list);
      setRosterLoading(false);
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedRow?.shift_code, agent?.id, shiftTypes]);

  return (
    <>
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setCursor((c) => subMonths(c, 1))}
            className="w-10 h-10 rounded-full glass grid place-items-center active:scale-95 transition-transform"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            key={cursor.toISOString()}
            className="text-xl md:text-2xl font-bold tracking-tight animate-[fade-in_0.25s_ease-out]"
          >
            {format(cursor, "MMMM yyyy")}
          </div>
          <button
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="w-10 h-10 rounded-full glass grid place-items-center active:scale-95 transition-transform"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Month conclusion (legend, no bar) — height reserved to avoid layout shift */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 min-h-[22px]">
          {loading ? (
            <>
              <div className="h-4 w-24 rounded-full bg-slate-200/60 animate-pulse" />
              <div className="h-4 w-16 rounded-full bg-slate-200/60 animate-pulse" />
            </>
          ) : (
            legend.map(({ cat, label, v }) => (
              <div key={cat} className="flex items-center gap-1.5 animate-[fade-in_0.3s_ease-out]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: categoryStyle(cat).dot }} />
                <span className="text-sm font-semibold text-slate-500">{label}</span>
                <span className="text-sm font-bold text-slate-800">{v}</span>
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-7 gap-1.5 px-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="label-caps text-center text-slate-500">
              {d}
            </div>
          ))}
        </div>

        <GlassCard className="p-3">
          {loading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d) => {
                const row = byDate.get(format(d, "yyyy-MM-dd"));
                const today = isSameDay(d, new Date());
                const inMonth = isSameMonth(d, cursor);
                const s = codeStyle(row?.shift_code);
                const empty = !row;
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => inMonth && setSelected(d)}
                    className={`relative min-h-[64px] md:min-h-[78px] rounded-xl p-1.5 text-left transition-all duration-200 active:scale-[0.97] ${
                      !inMonth ? "opacity-40 cursor-default" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:brightness-[0.98]"
                    } ${empty && inMonth ? "opacity-80" : ""}`}
                    style={{
                      background: today
                        ? "#52B788"
                        : empty
                          ? "rgba(255,255,255,0.55)"
                          : s.bg,
                      color: today ? "#fff" : s.text,
                      ...(today
                        ? { boxShadow: "0 6px 18px rgba(82,183,136,0.35), 0 0 0 2px rgba(82,183,136,0.25)" }
                        : {}),
                    }}
                  >
                    <div
                      className={`text-[11px] font-bold ${
                        today ? "text-white" : empty ? "text-slate-400" : ""
                      }`}
                    >
                      {format(d, "d")}
                    </div>
                    {row && (
                      <div className="mt-1 text-center">
                        <div
                          className="text-[12px] font-extrabold uppercase tracking-tight leading-tight"
                          style={{ color: today ? "#fff" : s.text }}
                        >
                          {shortCode(row.shift_code)}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </GlassCard>

        <div className="grid grid-cols-4 gap-2">
          {[
            { e: "🌅", l: "Morning", v: summary.m },
            { e: "🌆", l: "Evening", v: summary.e },
            { e: "🌃", l: "GY", v: summary.g },
            { e: "📴", l: "Off", v: summary.o },
          ].map((x) => (
            <div key={x.l} className="glass rounded-2xl p-3 flex flex-col items-center">
              <div className="text-lg">{x.e}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {x.l}
              </div>
              <div className="text-base font-bold">{x.v}</div>
            </div>
          ))}
        </div>

        {agent && <AgentRequests agentId={agent.id} />}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-[fade-in_0.2s_ease-out]"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass w-full md:max-w-md rounded-t-3xl md:rounded-3xl p-6 animate-[slide-up_0.25s_ease-out] max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between shrink-0">
              <div>
                <div className="label-caps text-slate-500">
                  {selectedRow ? "Shift detail" : "Day overview"}
                </div>
                <div className="text-lg font-bold mt-0.5">
                  {format(selected, "EEEE, MMMM d")}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-8 h-8 rounded-full hover:bg-black/5 grid place-items-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2 shrink-0">
              {selectedRow ? (
                <>
                  <ShiftBadge code={selectedRow.shift_code} size="lg" />
                  {formatTimeRange(selectedRow.shift_code, shiftTypes) && (
                    <div className="text-sm text-slate-600 font-medium">
                      {formatTimeRange(selectedRow.shift_code, shiftTypes)}
                    </div>
                  )}
                  {selectedRow.notes && (
                    <div className="text-xs text-slate-500 mt-1">{selectedRow.notes}</div>
                  )}
                </>
              ) : (
                <div className="text-sm text-slate-500 font-medium">Nothing scheduled for you.</div>
              )}
            </div>

            <div className="mt-5 pt-5 border-t border-black/5 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Users size={15} className="text-slate-400" />
                  <span className="label-caps text-slate-500">
                    {myWindow ? "Working with you" : "On shift"}
                  </span>
                </div>
                {!rosterLoading && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#52B788]/15 text-[#2d7a56]">
                    {roster.length}
                  </span>
                )}
              </div>

                {rosterLoading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12" />
                    ))}
                  </div>
                ) : roster.length === 0 ? (
                  <div className="text-sm text-slate-400 text-center py-4">
                    {myWindow ? "No one else overlaps your shift this day." : "No one is scheduled to work this day."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 overflow-y-auto -mx-1 px-1">
                    {roster.map(({ agent: a, schedule: sc }) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-black/[0.03] transition-colors"
                      >
                        <Avatar name={a.name} url={a.avatar_url} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-semibold truncate text-slate-800">{a.name}</span>
                            {a.is_lead && <LeadBadge />}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {formatTimeRange(sc.shift_code, shiftTypes) ?? sc.shift_code}
                          </div>
                        </div>
                        <ShiftBadge code={sc.shift_code} size="sm" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>
        </div>
      )}
    </>
  );
}
