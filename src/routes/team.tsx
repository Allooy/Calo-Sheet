import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { Search, Calendar as CalIcon } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { Avatar } from "@/components/Avatar";
import { LeadBadge } from "@/components/LeadBadge";
import { TeammateScheduleModal } from "@/components/TeammateScheduleModal";
import { ShiftBadge } from "@/components/ShiftBadge";
import { Skeleton } from "@/components/Skeleton";
import { EmptyIllustration } from "@/components/EmptyIllustration";
import { supabase, type Agent, type Schedule } from "@/lib/supabase";
import { shiftCategory, type ShiftCategory } from "@/lib/shifts";

export const Route = createFileRoute("/team")({
  component: TeamPage,
  validateSearch: (s: Record<string, unknown>) => ({
    cat: typeof s.cat === "string" ? (s.cat as string) : undefined,
  }),
});

const FILTERS: { key: "all" | ShiftCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "graveyard", label: "Graveyard" },
  { key: "off", label: "Off" },
];

function TeamPage() {
  const search = Route.useSearch();
  const initialCat = (FILTERS.find((f) => f.key === search.cat)?.key ?? "all") as
    | "all"
    | ShiftCategory;
  const [date, setDate] = useState(() => new Date());
  const [filter, setFilter] = useState<"all" | ShiftCategory>(initialCat);
  const [q, setQ] = useState("");
  const [viewAgent, setViewAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const stripRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => new Date(), []);
  // Stable 90-day window anchored on today (14 past + ~11 weeks future). It does
  // NOT regenerate when the selected date changes, so selecting never re-centers
  // or jumps — you scroll / drag / arrow to reach other dates.
  const strip = useMemo(
    () => Array.from({ length: 90 }, (_, i) => addDays(today, i - 14)),
    [today],
  );

  // Bring today into view once on mount (instant, no animation).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const idx = strip.findIndex((d) => isSameDay(d, today));
    el.querySelectorAll<HTMLButtonElement>("button")[idx]?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-to-scroll (desktop mouse); touch uses native momentum scrolling.
  const drag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 });
  const onDragDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = stripRef.current;
    if (!el) return;
    drag.current = { down: true, moved: false, startX: e.clientX, startScroll: el.scrollLeft };
  };
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.down) return;
    const el = stripRef.current;
    if (!el) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 4) d.moved = true;
    el.scrollLeft = d.startScroll - dx;
  };
  const onDragUp = () => { drag.current.down = false; };
  const scrollStrip = (dir: number) => {
    stripRef.current?.scrollBy({ left: dir * stripRef.current.clientWidth * 0.7, behavior: "smooth" });
  };

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      const d = format(date, "yyyy-MM-dd");
      const [a, s] = await Promise.all([
        supabase.from("agents").select("*").eq("active", true).order("name"),
        supabase.from("schedules").select("*").eq("date", d),
      ]);
      if (cancel) return;
      setAgents((a.data as Agent[] | null) ?? []);
      setSchedules((s.data as Schedule[] | null) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      cancel = true;
    };
  }, [date]);

  const byAgent = useMemo(() => {
    const map = new Map<string, Schedule>();
    for (const s of schedules) map.set(s.agent_id, s);
    return map;
  }, [schedules]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return agents
      .map((a) => ({ agent: a, schedule: byAgent.get(a.id) ?? null }))
      .filter(({ agent }) => !ql || agent.name.toLowerCase().includes(ql))
      .filter(({ schedule }) => {
        if (filter === "all") return true;
        const cat = shiftCategory(schedule?.shift_code);
        return cat === filter;
      });
  }, [agents, byAgent, q, filter]);

  const onShift = rows.filter(
    (r) => r.schedule && shiftCategory(r.schedule.shift_code) !== "off",
  );
  const offShift = rows.filter(
    (r) => !r.schedule || shiftCategory(r.schedule.shift_code) === "off",
  );

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
        {/* Date strip */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollStrip(-1)}
            className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-sm font-bold text-slate-500 transition-colors hover:text-slate-800 active:scale-95"
            style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.06)" }}
            aria-label="Scroll back"
          >
            ‹
          </button>
          <div
            ref={stripRef}
            onPointerDown={onDragDown}
            onPointerMove={onDragMove}
            onPointerUp={onDragUp}
            onPointerLeave={onDragUp}
            className="flex-1 flex gap-2 overflow-x-auto px-1 py-1 select-none cursor-grab active:cursor-grabbing"
            style={{
              scrollbarWidth: "none",
              maskImage:
                "linear-gradient(to right, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%)",
            }}
          >
            {strip.map((d) => {
              const selected = isSameDay(d, date);
              const isToday = isSameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => { if (!drag.current.moved) setDate(d); }}
                  className="shrink-0 rounded-2xl px-3 py-2 min-w-[56px] text-center transition-all active:scale-95"
                  style={
                    selected
                      ? { background: "#52B788", color: "#fff", boxShadow: "0 4px 12px rgba(82,183,136,0.35)" }
                      : { background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.05)", color: "#334155" }
                  }
                >
                  <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                    {format(d, "EEE")}
                  </div>
                  <div
                    className="text-lg font-bold"
                    style={isToday && !selected ? { color: "#52B788" } : {}}
                  >
                    {format(d, "d")}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => scrollStrip(1)}
            className="w-9 h-9 shrink-0 rounded-full grid place-items-center text-sm font-bold text-slate-500 transition-colors hover:text-slate-800 active:scale-95"
            style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.06)" }}
            aria-label="Scroll forward"
          >
            ›
          </button>
          <label
            className="w-9 h-9 shrink-0 rounded-full grid place-items-center cursor-pointer text-slate-500 hover:text-slate-700 transition-colors"
            style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.06)" }}
          >
            <CalIcon size={15} />
            <input
              type="date"
              className="sr-only"
              value={format(date, "yyyy-MM-dd")}
              onChange={(e) => e.target.value && setDate(new Date(e.target.value))}
            />
          </label>
        </div>

        {/* Filters + search */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex gap-1.5 overflow-x-auto px-0.5 py-2 -my-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95"
                style={
                  filter === f.key
                    ? { background: "#1e5a3d", color: "#fff", boxShadow: "0 3px 9px rgba(30,90,61,0.28)" }
                    : { background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.05)", color: "#475569" }
                }
              >
                {f.label}
              </button>
            ))}
          </div>
          <div
            className="rounded-xl flex items-center px-3 gap-2 flex-1"
            style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.05)" }}
          >
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teammates…"
              className="bg-transparent outline-none py-2 text-sm w-full"
            />
          </div>
        </div>

        {/* List — keep prior rows visible (dimmed) while refetching so the day
            switch never flashes to an empty/white state. */}
        {loading && agents.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <GlassCard className="p-8 flex flex-col items-center text-center gap-2">
            <EmptyIllustration />
            <div className="text-sm font-semibold text-slate-700">No teammates match</div>
            <div className="text-xs text-slate-500">Try changing the filter or date.</div>
          </GlassCard>
        ) : (
          <div
            className="flex flex-col gap-2 transition-opacity duration-200"
            style={{ opacity: loading ? 0.55 : 1 }}
          >
            {onShift.map(({ agent, schedule }) => (
              <Row key={agent.id} agent={agent} schedule={schedule} onClick={() => setViewAgent(agent)} />
            ))}
            {offShift.length > 0 && onShift.length > 0 && (
              <div className="label-caps text-slate-500 mt-4 mb-1 px-1">Off today</div>
            )}
            {offShift.map(({ agent, schedule }) => (
              <Row key={agent.id} agent={agent} schedule={schedule} dimmed onClick={() => setViewAgent(agent)} />
            ))}
          </div>
        )}

      {viewAgent && (
        <TeammateScheduleModal agent={viewAgent} onClose={() => setViewAgent(null)} />
      )}
    </div>
  );
}

function Row({
  agent,
  schedule,
  dimmed = false,
  onClick,
}: {
  agent: Agent;
  schedule: Schedule | null;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  return (
    <GlassCard
      hoverable
      onClick={onClick}
      className={`p-3 flex items-center gap-3 cursor-pointer active:scale-[0.99] ${dimmed ? "opacity-60" : ""}`}
    >
      <Avatar name={agent.name} url={agent.avatar_url} size="sm" />
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{agent.name}</span>
        {agent.is_lead && <LeadBadge />}
      </div>
      <ShiftBadge code={schedule?.shift_code ?? "—"} size="sm" />
    </GlassCard>
  );
}