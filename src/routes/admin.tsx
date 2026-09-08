import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import Papa from "papaparse";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Upload as UploadIcon,
  X,
  Check,
  Undo2,
  Eraser,
  Crown,
  Pencil,
  Trash2,
  ImagePlus,
  Sparkles,
  Star,
  GripVertical,
  ArrowDownNarrowWide,
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/GlassCard";
import { Avatar } from "@/components/Avatar";
import { LeadBadge } from "@/components/LeadBadge";
import { TeamMonthGrid } from "@/components/TeamMonthGrid";
import { ShiftBadge } from "@/components/ShiftBadge";
import { Skeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth";
import {
  supabase,
  fetchSchedulesInRange,
  type Agent,
  type AuditLog,
  type Schedule,
  type ShiftRequest,
  type RequestStatus,
} from "@/lib/supabase";
import { ALL_SHIFT_CODES, categoryStyle, codeStyle, shiftCategory, shortCode } from "@/lib/shifts";
import { useDragScroll } from "@/lib/useDragScroll";
import { generateSchedule, auditSchedule, defaultCoverage, MORNING_CODES, EVENING_CODES, type GenResult } from "@/lib/generator";
import { loadSetting, saveSetting, readCached } from "@/lib/settings";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "requests", label: "Requests" },
  { key: "grid", label: "Schedule Grid" },
  { key: "bulk", label: "Bulk Edit" },
  { key: "edit", label: "Edit Shifts" },
  { key: "upload", label: "Upload" },
  { key: "agents", label: "Agents" },
  { key: "log", label: "Log" },
  { key: "auto", label: "Automation" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { agent, ready } = useAuth();
  const [tab, setTab] = useState<TabKey>("grid");

  if (!ready) return null;
  if (agent?.role !== "admin") return <Navigate to="/today" />;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
        <div className="glass rounded-2xl p-1.5 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const magic = t.key === "auto"; // the automation tab gets its own identity
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  tab === t.key
                    ? magic
                      ? "text-white shadow-md"
                      : "bg-white text-[#1e5a3d] shadow-sm"
                    : magic
                      ? "text-violet-600 hover:bg-violet-500/10"
                      : "text-slate-600 hover:bg-white/40"
                }`}
                style={
                  tab === t.key && magic
                    ? { background: "linear-gradient(120deg,#7c3aed,#a855f7 55%,#52B788)" }
                    : undefined
                }
              >
                {magic && <Sparkles size={13} className={tab === t.key ? "" : "opacity-80"} />}
                {t.label}
              </button>
            );
          })}
        </div>
        <div key={tab} className="animate-[fade-in_0.2s_ease-out]">
          {tab === "overview" && <TeamMonthGrid />}
          {tab === "requests" && <RequestsTab adminEmail={agent.email} />}
          {tab === "grid" && <GridTab />}
          {tab === "bulk" && <BulkTab adminEmail={agent.email} />}
          {tab === "edit" && <EditTab adminEmail={agent.email} />}
          {tab === "upload" && <UploadTab adminEmail={agent.email} />}
          {tab === "agents" && <AgentsTab adminEmail={agent.email} />}
          {tab === "log" && <LogTab />}
          {tab === "auto" && <AutomationTab adminEmail={agent.email} />}
        </div>
    </div>
  );
}

/* ============ Schedule Grid ============ */
function GridTab() {
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<Schedule[]>([]);
  // Collapse the agent name column to just avatars once the table is scrolled right.
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollX = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  useDragScroll(scrollRef);

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
        supabase.from("agents").select("*").eq("active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        fetchSchedulesInRange(from, to),
      ]);
      if (cancel) return;
      setAgents((a.data as Agent[] | null) ?? []);
      setRows(s);
      setLoading(false);
    }
    load();
    return () => {
      cancel = true;
    };
  }, [cursor]);

  const lookup = useMemo(() => {
    const m = new Map<string, Schedule>();
    for (const r of rows) m.set(`${r.agent_id}|${r.date}`, r);
    return m;
  }, [rows]);

  const dayStats = useMemo(() => {
    return days.map((d) => {
      const dk = format(d, "yyyy-MM-dd");
      let m = 0,
        e = 0,
        g = 0;
      for (const r of rows) {
        if (r.date !== dk) continue;
        const c = shiftCategory(r.shift_code);
        if (c === "morning") m++;
        else if (c === "evening") e++;
        else if (c === "graveyard") g++;
      }
      return { m, e, g };
    });
  }, [days, rows]);

  async function changeCell(agentId: string, dateKey: string, code: string) {
    if (code === "—") {
      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("agent_id", agentId)
        .eq("date", dateKey);
      if (error) return toast.error(error.message);
      setRows((r) => r.filter((x) => !(x.agent_id === agentId && x.date === dateKey)));
      return;
    }
    // Delete any existing row for this agent+date, then insert — bulletproof
    // against duplicate-key errors from rows we didn't have loaded.
    const { error: delErr } = await supabase
      .from("schedules")
      .delete()
      .eq("agent_id", agentId)
      .eq("date", dateKey);
    if (delErr) return toast.error(delErr.message);
    const { data, error } = await supabase
      .from("schedules")
      .insert({ agent_id: agentId, date: dateKey, shift_code: code })
      .select()
      .single();
    if (error) return toast.error(error.message);
    if (data) setRows((r) => [...r.filter((x) => !(x.agent_id === agentId && x.date === dateKey)), data as Schedule]);
    toast.success("Saved");
  }

  function exportCSV() {
    const head = ["Agent", ...days.map((d) => format(d, "yyyy-MM-dd"))];
    const lines = [head.join(",")];
    for (const a of agents) {
      const cells = days.map((d) => {
        const r = lookup.get(`${a.id}|${format(d, "yyyy-MM-dd")}`);
        return r?.shift_code ?? "";
      });
      lines.push([`"${a.name}"`, ...cells].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule-${format(cursor, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((c) => subMonths(c, 1))}
            className="w-9 h-9 rounded-full glass grid place-items-center"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="font-bold text-lg">{format(cursor, "MMMM yyyy")}</div>
          <button
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="w-9 h-9 rounded-full glass grid place-items-center"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => scrollX(-320)} className="w-8 h-8 rounded-full glass grid place-items-center active:scale-90" aria-label="Scroll left">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => scrollX(320)} className="w-8 h-8 rounded-full glass grid place-items-center active:scale-90" aria-label="Scroll right">
              <ChevronRight size={15} />
            </button>
          </div>
          <button
            onClick={exportCSV}
            className="rounded-xl bg-[#1e5a3d] text-white px-3 py-2 text-xs font-semibold flex items-center gap-1.5 active:scale-95"
          >
            <Download size={14} /> Export CSV
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
                  {days.map((d, i) => {
                    const today = isSameDay(d, new Date());
                    return (
                      <th
                        key={d.toISOString()}
                        className="px-1.5 py-2 font-semibold text-center min-w-[58px] border-b border-white/40 sticky top-0 z-20 backdrop-blur-md"
                        style={{
                          background: today ? "rgba(82,183,136,0.22)" : "var(--surface-sticky)",
                          boxShadow: today ? "inset 0 -3px 0 #52B788" : undefined,
                        }}
                      >
                        <div
                          className="text-[9px] uppercase"
                          style={{ color: today ? "var(--today-ink)" : "var(--text-muted)", fontWeight: today ? 700 : 500 }}
                        >
                          {format(d, "EEE")}
                        </div>
                        <div
                          className="text-sm"
                          style={{ color: today ? "var(--today-ink)" : "var(--text-strong)", fontWeight: today ? 800 : 600 }}
                        >
                          {format(d, "d")}
                        </div>
                        <div className="text-[8px] text-slate-400 mt-0.5 leading-tight">
                          {dayStats[i].m}/{dayStats[i].e}/{dayStats[i].g}
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
                      className="sticky left-0 z-10 bg-white/80 backdrop-blur-md px-3 py-1.5 border-b border-white/30 transition-all duration-300"
                      style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          tabIndex={0}
                          className="relative group/pfp outline-none shrink-0"
                          aria-label={a.name}
                        >
                          <Avatar name={a.name} url={a.avatar_url} size="sm" />
                          <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 opacity-0 group-hover/pfp:opacity-100 group-focus/pfp:opacity-100 transition-opacity duration-150 bg-slate-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
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
                      const today = isSameDay(d, new Date());
                      return (
                        <td
                          key={dk}
                          className="p-0.5 border-b border-white/30 text-center"
                          style={today ? { background: "rgba(82,183,136,0.08)" } : undefined}
                        >
                          <select
                            value={r?.shift_code ?? "—"}
                            onChange={(e) => changeCell(a.id, dk, e.target.value)}
                            className="appearance-none w-full rounded-md px-1 py-1 text-[10px] font-bold uppercase cursor-pointer outline-none text-center"
                            style={{
                              background: r ? s.bg : "transparent",
                              color: r ? s.text : "#94a3b8",
                            }}
                          >
                            <option value="—">—</option>
                            {ALL_SHIFT_CODES.map((c) => (
                              <option key={c} value={c}>
                                {shortCode(c)}
                              </option>
                            ))}
                          </select>
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

/* ============ Bulk Edit (paint) ============ */
const ERASE = "—";

function BulkTab({ adminEmail }: { adminEmail: string }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [brush, setBrush] = useState<string>("S1");
  const [collapsed, setCollapsed] = useState(false);

  // staged edits layered over loaded rows: key `agentId|date` -> code | null(clear)
  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());
  const [undoStack, setUndoStack] = useState<Array<Array<{ key: string; prev: string | null | undefined }>>>([]);

  const bulkScrollRef = useRef<HTMLDivElement>(null);
  useDragScroll(bulkScrollRef);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = useMemo(
    () => eachDayOfInterval({ start: monthStart, end: monthEnd }),
    [monthStart, monthEnd],
  );

  // Depend on the stable `cursor` (state), not the per-render Date objects, or
  // the effect re-runs every render → infinite fetch loop.
  const reload = useCallback(async () => {
    setLoading(true);
    const from = format(startOfMonth(cursor), "yyyy-MM-dd");
    const to = format(endOfMonth(cursor), "yyyy-MM-dd");
    const [a, s] = await Promise.all([
      supabase.from("agents").select("*").eq("active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
      fetchSchedulesInRange(from, to),
    ]);
    setAgents((a.data as Agent[] | null) ?? []);
    setRows(s);
    setLoading(false);
  }, [cursor]);

  useEffect(() => {
    setEdits(new Map());
    setUndoStack([]);
    reload();
  }, [reload]);

  const lookup = useMemo(() => {
    const m = new Map<string, Schedule>();
    for (const r of rows) m.set(`${r.agent_id}|${r.date}`, r);
    return m;
  }, [rows]);

  // ── painting machinery ──
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const paintingRef = useRef(false);
  const strokeRef = useRef<Array<{ key: string; prev: string | null | undefined }>>([]);
  const strokeKeys = useRef<Set<string>>(new Set());
  const strokeSnapshot = useRef<Map<string, string | null>>(new Map());
  const downPos = useRef<{ x: number; y: number; agentId: string; date: string } | null>(null);
  const movedRef = useRef(false);

  function startStroke() {
    strokeSnapshot.current = new Map(editsRef.current);
    strokeKeys.current = new Set();
    strokeRef.current = [];
  }
  function endStroke() {
    if (strokeRef.current.length) {
      const s = strokeRef.current;
      setUndoStack((st) => [...st, s]);
    }
    strokeRef.current = [];
  }
  function paintCell(agentId: string, date: string) {
    const key = `${agentId}|${date}`;
    const val = brush === ERASE ? null : brush;
    if (!strokeKeys.current.has(key)) {
      const prev = strokeSnapshot.current.has(key)
        ? strokeSnapshot.current.get(key)!
        : undefined;
      strokeRef.current.push({ key, prev });
      strokeKeys.current.add(key);
    }
    setEdits((prevMap) => {
      const n = new Map(prevMap);
      n.set(key, val);
      return n;
    });
  }

  function onCellDown(agentId: string, date: string, e: React.PointerEvent) {
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return; // right-drag is reserved for pan-scroll, don't paint
      e.preventDefault();
      paintingRef.current = true;
      startStroke();
      paintCell(agentId, date);
    } else {
      downPos.current = { x: e.clientX, y: e.clientY, agentId, date };
      movedRef.current = false;
    }
  }
  function onCellEnter(agentId: string, date: string, e: React.PointerEvent) {
    if (paintingRef.current && e.pointerType === "mouse") paintCell(agentId, date);
  }
  function onCellUp(e: React.PointerEvent) {
    if (e.pointerType !== "mouse") {
      if (downPos.current && !movedRef.current) {
        startStroke();
        paintCell(downPos.current.agentId, downPos.current.date);
        endStroke();
      }
      downPos.current = null;
    }
  }
  function onContainerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch" && downPos.current) {
      if (Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) > 8)
        movedRef.current = true;
    }
  }

  // end a mouse stroke even if released outside the grid
  useEffect(() => {
    const up = () => {
      if (paintingRef.current) {
        paintingRef.current = false;
        endStroke();
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  function undo() {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const last = stack[stack.length - 1];
      setEdits((prevMap) => {
        const n = new Map(prevMap);
        for (const { key, prev } of last) {
          if (prev === undefined) n.delete(key);
          else n.set(key, prev);
        }
        return n;
      });
      return stack.slice(0, -1);
    });
  }

  // net changes (ignore edits that match the original)
  const changes = useMemo(() => {
    const list: { key: string; val: string | null; orig: string | null }[] = [];
    for (const [key, val] of edits) {
      const orig = lookup.get(key)?.shift_code ?? null;
      if (val !== orig) list.push({ key, val, orig });
    }
    return list;
  }, [edits, lookup]);

  async function save() {
    if (!changes.length) return;
    setSaving(true);
    const sets = changes
      .filter((c) => c.val !== null)
      .map((c) => {
        const [agent_id, date] = c.key.split("|");
        return { agent_id, date, shift_code: c.val as string };
      });

    // Clear EVERY changed cell by (agent_id, date) — not by loaded row id — so a
    // row that exists in the DB but wasn't loaded still gets removed. Grouped per
    // agent to keep the queries simple. Then insert the new values.
    const datesByAgent = new Map<string, string[]>();
    for (const c of changes) {
      const [agent_id, date] = c.key.split("|");
      const arr = datesByAgent.get(agent_id) ?? [];
      arr.push(date);
      datesByAgent.set(agent_id, arr);
    }
    for (const [agent_id, dates] of datesByAgent) {
      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("agent_id", agent_id)
        .in("date", dates);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    if (sets.length) {
      const { error } = await supabase.from("schedules").insert(sets);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    await supabase.from("audit_log").insert({
      user_email: adminEmail,
      action: "bulk_shift_edit",
      details: { changes: changes.length, month: format(cursor, "yyyy-MM") },
    });
    const n = changes.length;
    setEdits(new Map());
    setUndoStack([]);
    await reload();
    setSaving(false);
    toast.success(`Saved ${n} change${n === 1 ? "" : "s"}`);
  }

  function discard() {
    setEdits(new Map());
    setUndoStack([]);
  }

  const palette = [ERASE, ...ALL_SHIFT_CODES];

  return (
    <div className="flex flex-col gap-4">
      {/* Month nav */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCursor((c) => subMonths(c, 1))}
          className="w-9 h-9 rounded-full glass grid place-items-center"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="font-bold text-lg">{format(cursor, "MMMM yyyy")}</div>
        <button
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="w-9 h-9 rounded-full glass grid place-items-center"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Brush palette */}
      <div>
        <div className="label-caps text-slate-500 mb-2 px-0.5">
          Pick a shift, then tap or drag across cells
        </div>
        <div className="flex flex-wrap gap-1.5">
          {palette.map((code) => {
            const isErase = code === ERASE;
            const s = codeStyle(code);
            const active = brush === code;
            return (
              <button
                key={code}
                onClick={() => setBrush(code)}
                className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-all active:scale-95 ${
                  active ? "ring-2 ring-offset-1" : ""
                }`}
                style={{
                  background: isErase ? "#f1f5f9" : s.bg,
                  color: isErase ? "#64748b" : s.text,
                  // @ts-expect-error css var for ring color
                  "--tw-ring-color": isErase ? "#94a3b8" : s.dot,
                  boxShadow: active ? `0 2px 10px ${isErase ? "rgba(148,163,184,0.4)" : s.dot + "55"}` : "none",
                }}
              >
                {isErase ? <Eraser size={13} /> : null}
                {isErase ? "Erase" : code}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <GlassCard className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-4 flex flex-col gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : (
          <div
            ref={bulkScrollRef}
            className="overflow-auto show-scroll select-none pb-28 md:pb-20 max-h-[70vh]"
            onScroll={(e) => setCollapsed(e.currentTarget.scrollLeft > 24)}
            onPointerMove={onContainerMove}
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
                        className="px-1.5 py-2 font-semibold text-center min-w-[52px] border-b border-white/40 sticky top-0 z-20 backdrop-blur-md"
                        style={{
                          background: today ? "rgba(82,183,136,0.22)" : "var(--surface-sticky)",
                          boxShadow: today ? "inset 0 -3px 0 #52B788" : undefined,
                        }}
                      >
                        <div
                          className="text-[9px] uppercase"
                          style={{ color: today ? "var(--today-ink)" : "var(--text-muted)", fontWeight: today ? 700 : 500 }}
                        >
                          {format(d, "EEE")}
                        </div>
                        <div
                          className="text-sm"
                          style={{ color: today ? "var(--today-ink)" : "var(--text-strong)", fontWeight: today ? 800 : 600 }}
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
                  <tr key={a.id}>
                    <td
                      className="sticky left-0 z-10 bg-white/85 backdrop-blur-md px-3 py-1.5 border-b border-white/30 transition-all duration-300"
                      style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          tabIndex={0}
                          className="relative group/pfp outline-none shrink-0"
                          aria-label={a.name}
                        >
                          <Avatar name={a.name} url={a.avatar_url} size="sm" />
                          <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-40 opacity-0 group-hover/pfp:opacity-100 group-focus/pfp:opacity-100 transition-opacity duration-150 bg-slate-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
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
                      const key = `${a.id}|${dk}`;
                      const orig = lookup.get(key)?.shift_code ?? null;
                      const eff = edits.has(key) ? edits.get(key)! : orig;
                      const changed = eff !== orig;
                      const s = codeStyle(eff);
                      const today = isSameDay(d, new Date());
                      return (
                        <td
                          key={dk}
                          className="p-0.5 border-b border-white/30 text-center"
                          style={today ? { background: "rgba(82,183,136,0.08)" } : undefined}
                        >
                          <div
                            onPointerDown={(e) => onCellDown(a.id, dk, e)}
                            onPointerEnter={(e) => onCellEnter(a.id, dk, e)}
                            onPointerUp={onCellUp}
                            className="relative mx-auto rounded-md px-1 py-1 text-[10px] font-bold uppercase cursor-pointer transition-colors"
                            style={{
                              background: eff ? s.bg : "transparent",
                              color: eff ? s.text : "#cbd5e1",
                              boxShadow: changed ? `inset 0 0 0 2px ${s.dot}` : "none",
                              touchAction: "pan-x pan-y",
                            }}
                          >
                            {eff ? shortCode(eff) : "·"}
                          </div>
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

      {/* Staged-changes bar */}
      {changes.length > 0 && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-40 glass rounded-2xl px-3 py-2.5 flex items-center gap-2 animate-[slide-up_0.25s_ease-out] shadow-xl">
          <span className="text-sm font-bold text-slate-800 px-1">
            {changes.length} change{changes.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-black/5 disabled:opacity-40"
          >
            <Undo2 size={14} /> Undo
          </button>
          <button
            onClick={discard}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-black/5"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[#1e5a3d] text-white px-3.5 py-1.5 text-xs font-bold active:scale-95 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ============ Edit Shifts ============ */
function EditTab({ adminEmail }: { adminEmail: string }) {
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCode, setBulkCode] = useState("S1");

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      const [a, s] = await Promise.all([
        supabase.from("agents").select("*").eq("active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("schedules").select("*").eq("date", date),
      ]);
      if (cancel) return;
      setAgents((a.data as Agent[] | null) ?? []);
      setRows((s.data as Schedule[] | null) ?? []);
      setSelected(new Set());
      setLoading(false);
    }
    load();
    return () => {
      cancel = true;
    };
  }, [date]);

  const byAgent = useMemo(() => {
    const m = new Map<string, Schedule>();
    for (const r of rows) m.set(r.agent_id, r);
    return m;
  }, [rows]);

  async function upsert(agentId: string, code: string) {
    // delete-then-insert so a stale/unloaded row can't cause a duplicate-key error
    const { error: delErr } = await supabase
      .from("schedules")
      .delete()
      .eq("agent_id", agentId)
      .eq("date", date);
    if (delErr) return toast.error(delErr.message);
    const { data, error } = await supabase
      .from("schedules")
      .insert({ agent_id: agentId, date, shift_code: code })
      .select()
      .single();
    if (error) return toast.error(error.message);
    if (data) setRows((r) => [...r.filter((x) => x.agent_id !== agentId), data as Schedule]);
    await supabase.from("audit_log").insert({
      user_email: adminEmail,
      action: "shift_set",
      details: { agent_id: agentId, date, shift_code: code },
    });
  }

  async function applyBulk() {
    if (selected.size === 0) return;
    for (const id of selected) await upsert(id, bulkCode);
    toast.success(`Updated ${selected.size} agent(s)`);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="glass rounded-xl px-3 py-2 text-sm font-medium outline-none"
        />
        <div className="text-xs text-slate-500">
          {agents.length} active · {rows.length} scheduled
        </div>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((a) => {
            const r = byAgent.get(a.id);
            const sel = selected.has(a.id);
            return (
              <GlassCard key={a.id} className="p-3 flex items-center gap-3">
                <button
                  onClick={() => toggle(a.id)}
                  className={`w-5 h-5 rounded-md grid place-items-center border-2 transition-colors shrink-0 ${
                    sel
                      ? "bg-[#52B788] border-[#52B788] text-white"
                      : "border-slate-300"
                  }`}
                  aria-label="Select"
                >
                  {sel && <Check size={12} />}
                </button>
                <Avatar name={a.name} url={a.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{a.email}</div>
                </div>
                <select
                  value={r?.shift_code ?? ""}
                  onChange={(e) => upsert(a.id, e.target.value)}
                  className="glass rounded-xl px-3 py-2 text-xs font-semibold outline-none cursor-pointer"
                >
                  <option value="">— Set —</option>
                  {ALL_SHIFT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </GlassCard>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-40 glass rounded-2xl p-3 flex items-center gap-3 animate-[slide-up_0.25s_ease-out] shadow-xl">
          <div className="text-sm font-semibold">{selected.size} selected</div>
          <select
            value={bulkCode}
            onChange={(e) => setBulkCode(e.target.value)}
            className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold outline-none border border-slate-200"
          >
            {ALL_SHIFT_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={applyBulk}
            className="rounded-lg bg-[#1e5a3d] text-white px-3 py-1.5 text-xs font-semibold active:scale-95"
          >
            Apply
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="w-7 h-7 rounded-full hover:bg-black/5 grid place-items-center"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ============ Upload ============ */
type ParsedRow = { agent_name: string; date: string; shift_code: string; match?: Agent };

// Parse the monthly schedule GRID (people down the rows, dates across the top,
// title block + time legend ignored) into long-format rows. Returns null if the
// file isn't a grid (so we can fall back to the plain long-format parser).
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const pad2 = (n: number) => String(n).padStart(2, "0");

function parseScheduleGrid(rows: string[][]): { agent_name: string; date: string; shift_code: string }[] | null {
  const dayRe = /^[A-Za-z]+-(\d{1,2})$/; // "Sunday-28"
  const isHeaderRow = (r: string[]) => r.filter((c) => dayRe.test((c || "").trim())).length >= 5;

  const headerIdx = rows.findIndex(isHeaderRow);
  if (headerIdx < 0) return null;

  // Month + year from a "Jul/2026" / "July 2026" token anywhere in the file.
  let pM: number | null = null, pY: number | null = null;
  const monRe = /([A-Za-z]{3,9})\s*[/\-\s]\s*(\d{4})/;
  for (const r of rows) {
    for (const c of r) {
      const m = (c || "").trim().match(monRe);
      const mi = m ? MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined;
      if (m && mi !== undefined) { pM = mi; pY = parseInt(m[2], 10); break; }
    }
    if (pM !== null) break;
  }
  if (pM === null) {
    const first = (rows[headerIdx][0] || "").trim().slice(0, 3).toLowerCase();
    if (MONTHS[first] !== undefined) { pM = MONTHS[first]; pY = new Date().getFullYear(); }
  }
  if (pM === null || pY === null) return null;

  // date columns
  const headerRow = rows[headerIdx];
  const cols: { idx: number; day: number }[] = [];
  for (let j = 1; j < headerRow.length; j++) {
    const m = (headerRow[j] || "").trim().match(dayRe);
    if (m) cols.push({ idx: j, day: parseInt(m[1], 10) });
  }
  if (!cols.length) return null;

  // map columns → ISO dates (leading days before the "1" belong to prev month;
  // roll the month forward whenever the day number drops).
  const idx1 = cols.findIndex((c) => c.day === 1);
  let y = pY, mo = pM;
  if (idx1 > 0) { mo -= 1; if (mo < 0) { mo = 11; y--; } }
  const dateByCol = new Map<number, string>();
  for (let k = 0; k < cols.length; k++) {
    if (k > 0 && cols[k].day < cols[k - 1].day) { mo++; if (mo > 11) { mo = 0; y++; } }
    dateByCol.set(cols[k].idx, `${y}-${pad2(mo + 1)}-${pad2(cols[k].day)}`);
  }

  // canonical code lookup (skips times/junk/unknown codes like "UK S1")
  const codeByUpper = new Map<string, string>();
  for (const c of ALL_SHIFT_CODES) codeByUpper.set(c.toUpperCase(), c);

  const out: { agent_name: string; date: string; shift_code: string }[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[0] || "").trim();
    if (!name || isHeaderRow(r)) continue; // skip repeated section headers
    for (const { idx } of cols) {
      const cell = (r[idx] || "").trim();
      if (!cell) continue;
      const code = codeByUpper.get(cell.toUpperCase());
      const date = dateByCol.get(idx);
      if (code && date) out.push({ agent_name: name, date, shift_code: code });
    }
  }
  return out.length ? out : null;
}

function UploadTab({ adminEmail }: { adminEmail: string }) {
  const [drag, setDrag] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<"schedules" | "agents">("schedules");
  const [parsedAgents, setParsedAgents] = useState<
    Array<{ name: string; email: string; role: string; exists?: boolean }>
  | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (mode === "agents") {
      const rows = res.data.map((r) => ({
        name: (r.name || r.Name || "").trim(),
        email: (r.email || r.Email || "").trim().toLowerCase(),
        role: (r.role || r.Role || "agent").trim().toLowerCase(),
      }));
      const emails = rows.map((r) => r.email).filter(Boolean);
      const { data: existing } = await supabase
        .from("agents")
        .select("email")
        .in("email", emails.length ? emails : ["__none__"]);
      const have = new Set((existing ?? []).map((e: { email: string }) => e.email));
      setParsedAgents(rows.map((r) => ({ ...r, exists: have.has(r.email) })));
      setParsed(null);
    } else {
      // Try the monthly grid first; fall back to plain long-format columns.
      const matrix = (Papa.parse<string[]>(text, { skipEmptyLines: false }).data) as unknown as string[][];
      const grid = parseScheduleGrid(matrix);
      const rows: ParsedRow[] = grid
        ? grid
        : res.data.map((r) => ({
            agent_name: (r.agent_name || r.name || r.Name || "").trim(),
            date: (r.date || r.Date || "").trim(),
            shift_code: (r.shift_code || r.shift || r.Shift || "").trim(),
          }));
      // Match by NORMALIZED name (trim + lowercase) against ALL agents, so a
      // stray trailing space or different casing in the DB never blocks a match.
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const { data: agents } = await supabase.from("agents").select("*");
      const byName = new Map<string, Agent>();
      for (const a of (agents as Agent[] | null) ?? []) byName.set(norm(a.name), a);
      setParsed(rows.map((r) => ({ ...r, match: byName.get(norm(r.agent_name)) })));
      setParsedAgents(null);
    }
  }

  async function importAll() {
    if (mode === "agents" && parsedAgents) {
      setImporting(true);
      const fresh = parsedAgents.filter((r) => r.email && !r.exists);
      const { error } = await supabase.from("agents").insert(
        fresh.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role === "admin" ? "admin" : "agent",
          active: true,
        })),
      );
      setImporting(false);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${fresh.length} agents`);
      setParsedAgents(null);
      await supabase.from("audit_log").insert({
        user_email: adminEmail,
        action: "agents_imported",
        details: { count: fresh.length },
      });
      return;
    }
    if (!parsed) return;
    const valid = parsed.filter((r) => r.match && r.date && r.shift_code);
    const skipped = parsed.length - valid.length;
    if (!valid.length) {
      toast.error("No matched rows to import");
      return;
    }
    setImporting(true);

    // Dedupe payload by agent+date (last wins) so a batch never conflicts with itself.
    const byKey = new Map<string, { agent_id: string; date: string; shift_code: string }>();
    for (const r of valid) {
      byKey.set(`${r.match!.id}|${r.date}`, { agent_id: r.match!.id, date: r.date, shift_code: r.shift_code });
    }
    const payload = [...byKey.values()];
    const agentIds = [...new Set(payload.map((p) => p.agent_id))];
    const dates = payload.map((p) => p.date).sort();
    const minD = dates[0];
    const maxD = dates[dates.length - 1];

    // REPLACE the month: clear existing shifts for these agents in the imported
    // range, then insert fresh. This avoids any duplicate-key conflict and makes
    // the sheet the source of truth.
    const { error: delErr } = await supabase
      .from("schedules")
      .delete()
      .in("agent_id", agentIds)
      .gte("date", minD)
      .lte("date", maxD);
    if (delErr) {
      setImporting(false);
      return toast.error(`Clearing old shifts failed: ${delErr.message}`);
    }

    let ok = 0;
    let lastError = "";
    const chunk = 200;
    for (let i = 0; i < payload.length; i += chunk) {
      const slice = payload.slice(i, i + chunk);
      const { error } = await supabase.from("schedules").insert(slice);
      if (error) lastError = error.message;
      else ok += slice.length;
      setProgress(Math.round(((i + slice.length) / payload.length) * 100));
    }
    setImporting(false);
    setProgress(0);
    if (lastError) {
      toast.error(`Imported ${ok}/${payload.length}. Some failed: ${lastError}`);
    } else {
      toast.success(`Imported ${ok} shifts${skipped ? ` · ${skipped} unmatched skipped` : ""}`);
    }
    setParsed(null);
    await supabase.from("audit_log").insert({
      user_email: adminEmail,
      action: "schedules_imported",
      details: { count: ok, unmatched: skipped, range: [minD, maxD] },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["schedules", "agents"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setParsed(null);
              setParsedAgents(null);
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              mode === m ? "bg-[#1e5a3d] text-white" : "glass text-slate-600"
            }`}
          >
            {m === "schedules" ? "Schedules CSV" : "Agents CSV"}
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-3xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${
          drag
            ? "border-[#52B788] bg-[#52B788]/10 shadow-[0_0_0_8px_rgba(82,183,136,0.12)]"
            : "border-slate-300 bg-white/40"
        }`}
      >
        <UploadIcon size={32} className="mx-auto text-[#2d7a56]" />
        <div className="mt-3 font-semibold">Drop CSV or click to browse</div>
        <div className="text-xs text-slate-500 mt-1">
          {mode === "schedules"
            ? "Monthly grid (people × dates) or columns: agent_name, date, shift_code — auto-detected"
            : "Columns: name, email, role (agent|admin)"}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {parsedAgents && (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-white/40">
            <div className="text-sm font-semibold">
              {parsedAgents.length} rows · {parsedAgents.filter((r) => !r.exists).length} new
            </div>
            <button
              onClick={importAll}
              disabled={importing}
              className="rounded-xl bg-[#1e5a3d] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {parsedAgents.map((r, i) => (
                  <tr key={i} className="border-b border-white/30">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2 text-slate-500">{r.email}</td>
                    <td className="p-2 uppercase font-semibold">{r.role}</td>
                    <td className="p-2 text-right">
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          r.exists ? "text-amber-700" : "text-[#2d7a56]"
                        }`}
                      >
                        {r.exists ? "Exists" : "New"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {parsed && (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-white/40 gap-3">
            <div className="text-sm font-semibold">
              {parsed.length} rows · {parsed.filter((r) => r.match).length} matched
            </div>
            {importing && (
              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#52B788] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            <button
              onClick={importAll}
              disabled={importing}
              className="rounded-xl bg-[#1e5a3d] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {parsed.map((r, i) => (
                  <tr key={i} className="border-b border-white/30">
                    <td className="p-2">{r.agent_name}</td>
                    <td className="p-2 text-slate-500">{r.date}</td>
                    <td className="p-2">
                      <ShiftBadge code={r.shift_code} size="sm" />
                    </td>
                    <td className="p-2 text-right">
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          r.match ? "text-[#2d7a56]" : "text-red-600"
                        }`}
                      >
                        {r.match ? "Match" : "No match"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/* ============ Agents ============ */
function AgentsTab({ adminEmail }: { adminEmail: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  // form / editor
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancel = false;
    supabase
      .from("agents")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name")
      .then(({ data }) => {
        if (cancel) return;
        setAgents((data as Agent[] | null) ?? []);
        setLoading(false);
      });
    return () => { cancel = true; };
  }, []);

  // Pointer-driven reorder. HTML5 drag-and-drop gives a ghost image that
  // follows the cursor in both axes; this keeps the row on the vertical axis
  // and slides the others aside to open the gap it will drop into.
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<{ from: number; startY: number; slot: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; slot: number } | null>(null);

  function openAdd() {
    setEditing(null);
    setName(""); setEmail(""); setRole("agent");
    setAvatar(null); setFile(null);
    setOpen(true);
  }
  function openEdit(a: Agent) {
    setEditing(a);
    setName(a.name); setEmail(a.email ?? ""); setRole(a.role);
    setAvatar(a.avatar_url); setFile(null);
    setOpen(true);
  }

  function pickFile(f: File | null) {
    setFile(f);
    if (f) setAvatar(URL.createObjectURL(f)); // local preview
  }

  async function uploadAvatar(agentId: string, f: File): Promise<string | null> {
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${agentId}.${ext}`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, f, { upsert: true, contentType: f.type });
    if (error) { toast.error(`Image: ${error.message}`); return null; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`; // cache-bust
  }

  async function save() {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("agents")
          .update({ name: name.trim(), email: email.trim().toLowerCase() || null, role })
          .eq("id", editing.id);
        if (error) { toast.error(error.message); return; }
        let url = editing.avatar_url;
        if (file) {
          const up = await uploadAvatar(editing.id, file);
          if (up) {
            url = up;
            await supabase.from("agents").update({ avatar_url: up }).eq("id", editing.id);
          }
        }
        setAgents((arr) =>
          arr.map((x) => (x.id === editing.id ? { ...x, name: name.trim(), email: email.trim().toLowerCase(), role, avatar_url: url } : x))
            .sort((p, q) => p.name.localeCompare(q.name)),
        );
        toast.success("Agent updated");
        await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_updated", details: { id: editing.id } });
      } else {
        const { data, error } = await supabase
          .from("agents")
          .insert({ name: name.trim(), email: email.trim().toLowerCase() || null, role, active: true })
          .select()
          .single();
        if (error) { toast.error(error.message); return; }
        let created = data as Agent;
        if (file) {
          const up = await uploadAvatar(created.id, file);
          if (up) {
            await supabase.from("agents").update({ avatar_url: up }).eq("id", created.id);
            created = { ...created, avatar_url: up };
          }
        }
        setAgents((arr) => [...arr, created].sort((p, q) => p.name.localeCompare(q.name)));
        toast.success("Agent added");
        await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_added", details: { name: created.name } });
      }
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAgent(a: Agent) {
    if (!window.confirm(`Delete ${a.name}? This also removes all of their schedule entries. This cannot be undone.`)) return;
    const { error } = await supabase.from("agents").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    setAgents((arr) => arr.filter((x) => x.id !== a.id));
    toast.success(`${a.name} deleted`);
    await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_deleted", details: { id: a.id, name: a.name } });
  }

  async function toggleActive(a: Agent) {
    const { error } = await supabase.from("agents").update({ active: !a.active }).eq("id", a.id);
    if (error) return toast.error(error.message);
    setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, active: !a.active } : x)));
    await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_active_toggled", details: { id: a.id, active: !a.active } });
  }

  /** Persist the current row order; only rows whose position actually moved. */
  async function persistOrder(list: Agent[]) {
    const changed = list
      .map((a, i) => ({ a, want: (i + 1) * 10 }))
      .filter(({ a, want }) => a.sort_order !== want);
    if (!changed.length) return;
    for (let i = 0; i < changed.length; i += 10) {
      await Promise.all(
        changed.slice(i, i + 10).map(({ a, want }) =>
          supabase.from("agents").update({ sort_order: want }).eq("id", a.id),
        ),
      );
    }
    setAgents((arr) => arr.map((x) => {
      const hit = changed.find((c) => c.a.id === x.id);
      return hit ? { ...x, sort_order: hit.want } : x;
    }));
    await supabase.from("audit_log").insert({
      user_email: adminEmail, action: "agents_reordered",
      details: { moved: changed.length },
    });
  }

  /** Shift Leads, then Specialists, then Agents; alphabetical within each. */
  const rankOf = (a: Agent) => (a.is_lead ? 0 : a.is_specialist ? 1 : 2);

  // Derived, not stored: comparing the live order against each sort means the
  // label can never drift out of step with what is actually on screen.
  const sortMode: "rank" | "name" | "custom" = useMemo(() => {
    const same = (cmp: (x: Agent, y: Agent) => number) => {
      const t = [...agents].sort(cmp);
      return agents.every((a, i) => a.id === t[i].id);
    };
    if (agents.length < 2) return "rank";
    if (same((x, y) => rankOf(x) - rankOf(y) || x.name.localeCompare(y.name))) return "rank";
    if (same((x, y) => x.name.localeCompare(y.name))) return "name";
    return "custom";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);
  function sortByRank() {
    const next = [...agents].sort(
      (x, y) => rankOf(x) - rankOf(y) || x.name.localeCompare(y.name),
    );
    setAgents(next);
    void persistOrder(next);
  }

  function onGrabStart(e: React.PointerEvent, from: number) {
    const rows = rowRefs.current;
    const self = rows[from];
    if (!self) return;
    const next = rows[from + 1] ?? null;
    const prev = rows[from - 1] ?? null;
    // Slot height includes the flex gap, so one slot of travel equals one row.
    const r = self.getBoundingClientRect();
    const slot = next
      ? next.getBoundingClientRect().top - r.top
      : prev
        ? r.top - prev.getBoundingClientRect().top
        : r.height + 8;
    dragRef.current = { from, startY: e.clientY, slot };
    setDrag({ from, to: from, dy: 0, slot });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onGrabMove(e: React.PointerEvent) {
    const st = dragRef.current;
    if (!st) return;
    const dy = e.clientY - st.startY;
    const to = Math.max(0, Math.min(agents.length - 1, st.from + Math.round(dy / st.slot)));
    setDrag((d) => (d ? { ...d, dy, to } : d));
  }

  function onGrabEnd() {
    const st = dragRef.current;
    const d = drag;
    dragRef.current = null;
    setDrag(null);
    if (!st || !d || d.to === st.from) return;
    const next = [...agents];
    next.splice(d.to, 0, next.splice(st.from, 1)[0]);
    setAgents(next);
    void persistOrder(next);
  }

  /** Transform for row i while a drag is in flight. */
  function rowStyle(i: number): React.CSSProperties {
    const ease = "transform 0.18s cubic-bezier(0.22,1,0.36,1)";
    if (!drag) return { transition: ease };
    if (i === drag.from) {
      return {
        transform: `translateY(${drag.dy}px)`,
        transition: "none", // must track the pointer exactly, not lag behind it
        zIndex: 30,
        position: "relative",
        boxShadow: "0 14px 30px rgba(0,0,0,0.20)",
      };
    }
    let shift = 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.slot;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) shift = drag.slot;
    return { transform: `translateY(${shift}px)`, transition: ease };
  }

  function exportAgentsCSV() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Name", "Email", "Role", "Lead", "Active", "Avatar URL", "Created"];
    const lines = [head.join(",")];
    for (const a of agents) {
      lines.push([
        esc(a.name), esc(a.email), esc(a.role),
        a.is_lead ? "yes" : "no", a.active ? "yes" : "no",
        esc(a.avatar_url), esc(a.created_at),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `agents-${format(new Date(), "yyyy-MM-dd")}.csv`;
    el.click();
    URL.revokeObjectURL(url);
  }

  async function toggleSpecialist(a: Agent) {
    const { error } = await supabase
      .from("agents").update({ is_specialist: !a.is_specialist }).eq("id", a.id);
    if (error) return toast.error(error.message);
    setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, is_specialist: !a.is_specialist } : x)));
    await supabase.from("audit_log").insert({
      user_email: adminEmail, action: "agent_specialist_toggled",
      details: { id: a.id, is_specialist: !a.is_specialist },
    });
  }

  async function toggleLead(a: Agent) {
    const { error } = await supabase.from("agents").update({ is_lead: !a.is_lead }).eq("id", a.id);
    if (error) return toast.error(error.message);
    setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, is_lead: !a.is_lead } : x)));
    await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_lead_toggled", details: { id: a.id, is_lead: !a.is_lead } });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {agents.length} total · {agents.filter((a) => a.active).length} active
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
              sortMode === "custom"
                ? "bg-violet-100 text-violet-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {sortMode === "rank" ? "By rank" : sortMode === "name" ? "A–Z" : "Custom order"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sortByRank}
            title="Order by position: Shift Leads, Specialists, then Agents"
            className="rounded-xl glass px-3 py-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5 active:scale-95"
          >
            <ArrowDownNarrowWide size={14} /> Sort by rank
          </button>
          <button
            onClick={exportAgentsCSV}
            className="rounded-xl glass px-3 py-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5 active:scale-95"
          >
            <Download size={14} /> CSV
          </button>
          <button
            onClick={openAdd}
            className="rounded-xl bg-[#1e5a3d] text-white px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 active:scale-95"
          >
            <Plus size={15} /> Add agent
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)
        ) : (
          agents.map((a, i) => (
            <GlassCard
              key={a.id}
              ref={(el) => { rowRefs.current[i] = el; }}
              className={`p-3 flex items-center gap-3 ${a.active ? "" : "opacity-60"}`}
              style={rowStyle(i)}
            >
              <span
                onPointerDown={(e) => onGrabStart(e, i)}
                onPointerMove={onGrabMove}
                onPointerUp={onGrabEnd}
                onPointerCancel={onGrabEnd}
                // none, so a touch drag moves the row instead of scrolling the page
                style={{ touchAction: "none" }}
                className="shrink-0 -m-1 p-1 cursor-grab active:cursor-grabbing"
                aria-label={`Reorder ${a.name}`}
              >
                <GripVertical size={15} className="text-slate-300" />
              </span>
              <Avatar name={a.name} url={a.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">{a.name}</span>
                  {a.is_lead && <LeadBadge />}
                </div>
                <div className="text-[11px] text-slate-500 truncate">{a.email || "no email"}</div>
              </div>

              <button
                onClick={() => toggleLead(a)}
                title={a.is_lead ? "Remove shift lead" : "Make shift lead"}
                className="w-8 h-8 rounded-full grid place-items-center transition-colors shrink-0 hover:bg-amber-50"
                style={a.is_lead ? { background: "#fde68a", color: "#92400e" } : { color: "#cbd5e1" }}
              >
                <Crown size={15} strokeWidth={2.4} fill={a.is_lead ? "currentColor" : "none"} />
              </button>
              <button
                onClick={() => toggleSpecialist(a)}
                title={a.is_specialist ? "Remove CX Specialist" : "Make CX Specialist"}
                className="w-8 h-8 rounded-full grid place-items-center transition-colors shrink-0 hover:bg-blue-50"
                style={a.is_specialist ? { background: "#6d9eeb", color: "#fff" } : { color: "#cbd5e1" }}
              >
                <Star size={15} strokeWidth={2.4} fill={a.is_specialist ? "currentColor" : "none"} />
              </button>
              <span
                className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                  a.role === "admin" ? "bg-[#e0e7ff] text-[#4338ca]" : "bg-slate-100 text-slate-600"
                }`}
              >
                {a.role}
              </span>
              <button
                role="switch"
                aria-checked={a.active}
                onClick={() => toggleActive(a)}
                title={a.active ? "Deactivate" : "Activate"}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${a.active ? "bg-[#52B788]" : "bg-slate-300"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${a.active ? "translate-x-5" : ""}`} />
              </button>
              <button onClick={() => openEdit(a)} title="Edit" className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:text-slate-700 hover:bg-black/5 shrink-0">
                <Pencil size={15} />
              </button>
              <button onClick={() => deleteAgent(a)} title="Delete" className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0">
                <Trash2 size={15} />
              </button>
            </GlassCard>
          ))
        )}
      </div>

      {/* Add / Edit sheet */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-[fade-in_0.2s_ease-out]"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-3xl p-6 animate-[slide-up_0.25s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="font-bold text-lg">{editing ? "Edit agent" : "Add agent"}</div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full hover:bg-black/5 grid place-items-center">
                <X size={16} className="text-slate-500" />
              </button>
            </div>

            {/* photo */}
            <div className="flex flex-col items-center gap-2 mb-5">
              <button
                onClick={() => fileRef.current?.click()}
                className="relative group"
                title="Upload photo"
              >
                <Avatar name={name || "?"} url={avatar} size="lg" className="!w-20 !h-20 !text-2xl" />
                <span className="absolute inset-0 rounded-full grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity text-white">
                  <ImagePlus size={20} />
                </span>
              </button>
              <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-[#2d7a56]">
                {avatar ? "Change photo" : "Add photo"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <div className="label-caps text-slate-500 mb-1">Name</div>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full glass rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="Full name" />
              </div>
              <div>
                <div className="label-caps text-slate-500 mb-1">Email</div>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full glass rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="you@calo.app" />
              </div>
              <div>
                <div className="label-caps text-slate-500 mb-1">Role</div>
                <div className="flex gap-2">
                  {(["agent", "admin"] as const).map((r) => (
                    <button key={r} onClick={() => setRole(r)} className={`flex-1 rounded-xl py-2 text-xs font-semibold uppercase tracking-wide transition-all ${role === r ? "bg-[#1e5a3d] text-white" : "glass text-slate-600"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={save} disabled={saving} className="rounded-xl bg-[#52B788] text-white py-2.5 text-sm font-semibold active:scale-[0.97] disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save changes" : "Add agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ Requests ============ */
const REQ_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: "#e0e7ff", text: "#4338ca", label: "Pending" },
  resolved: { bg: "#d6f2e4", text: "#1e5a3d", label: "Approved" },
  dismissed: { bg: "#fee2e2", text: "#b91c1c", label: "Declined" },
};

function RequestsTab({ adminEmail }: { adminEmail: string }) {
  const [rows, setRows] = useState<ShiftRequest[]>([]);
  const [agentsById, setAgentsById] = useState<Record<string, Agent>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [r, a] = await Promise.all([
        supabase.from("requests").select("*").order("created_at", { ascending: false }),
        supabase.from("agents").select("*"),
      ]);
      if (cancel) return;
      const map: Record<string, Agent> = {};
      for (const ag of (a.data as Agent[] | null) ?? []) map[ag.id] = ag;
      setAgentsById(map);
      setRows((r.data as ShiftRequest[] | null) ?? []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  async function setStatus(id: string, status: RequestStatus) {
    const { error } = await supabase
      .from("requests")
      .update({ status, resolved_at: status === "open" ? null : new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, status } : x)));
    await supabase.from("audit_log").insert({ user_email: adminEmail, action: `request_${status}`, details: { id } });
  }

  const openCount = rows.filter((r) => r.status === "open").length;
  const shown = rows.filter((r) => filter === "all" || r.status === "open");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              filter === f ? "bg-[#1e5a3d] text-white" : "glass text-slate-600"
            }`}
          >
            {f === "open" ? `Open (${openCount})` : "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : shown.length === 0 ? (
        <GlassCard className="p-8 text-center text-sm text-slate-500">
          {filter === "open" ? "No open requests." : "No requests yet."}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((r) => {
            const ag = agentsById[r.agent_id];
            const s = REQ_STATUS[r.status] ?? REQ_STATUS.open;
            return (
              <GlassCard key={r.id} className="p-3 flex items-start gap-3">
                <Avatar name={ag?.name ?? "?"} url={ag?.avatar_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">{ag?.name ?? "Unknown"}</span>
                    {ag?.is_lead && <LeadBadge />}
                  </div>
                  <div className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{r.message}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {format(new Date(r.created_at), "MMM d, HH:mm")}
                  </div>
                </div>
                {r.status === "open" ? (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => setStatus(r.id, "resolved")} className="rounded-lg bg-[#52B788] text-white px-2.5 py-1 text-[11px] font-bold active:scale-95">
                      Approve
                    </button>
                    <button onClick={() => setStatus(r.id, "dismissed")} className="rounded-lg bg-slate-100 text-slate-600 px-2.5 py-1 text-[11px] font-bold active:scale-95">
                      Decline
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: s.bg, color: s.text }}>
                    {s.label}
                  </span>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ Log ============ */
function LogTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditLog[]>([]);

  useEffect(() => {
    let cancel = false;
    supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (cancel) return;
        setRows((data as AuditLog[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <GlassCard className="p-8 text-center text-sm text-slate-500">
        No activity yet.
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <GlassCard key={r.id} className="p-3 flex gap-3">
          <div className="w-1 rounded-full bg-[#72c9a0] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-semibold truncate">{r.action}</div>
              <div className="text-[10px] text-slate-500 shrink-0">
                {format(new Date(r.created_at), "MMM d, HH:mm")}
              </div>
            </div>
            {r.details && (
              <div className="text-[11px] text-slate-500 truncate font-mono">
                {JSON.stringify(r.details)}
              </div>
            )}
            <div className="text-[10px] text-slate-400 mt-0.5">{r.user_email}</div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

/* ============ Automation (schedule generator) ============ */

// Best-guess defaults, matched by name tokens so a small spelling drift in the
// DB doesn't silently drop someone. The admin can always correct them below.
const GY_DEFAULTS = [
  ["hussain", "salman"], ["nawaf"], ["mohammed", "hussain"], ["ali", "eid"],
  ["khaled"], ["fahad"], ["osama"], ["mohsen"], ["omar"],
];
const FIXED_DEFAULTS: Array<[string[], string]> = [
  [["ali", "jalal"], "S3"],
  [["reem", "alraddia"], "S2"],
];
const CFG_KEY = "cx-automation-config";
type AutoConfig = {
  gyPool?: string[];
  fixed?: Record<string, string>;
  sheetUrl?: string;
  sheetToken?: string;
  coverage?: Array<Record<string, number>>;
  useCoverage?: boolean;
};
const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COV_CODES = ["S1", "S2", "S3", "S4", "S5", "S6"];

const nrm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const hits = (name: string, toks: string[]) => toks.every((t) => nrm(name).includes(t));

/** The Sunday closest to the 1st — reproduces how the real sheets were anchored. */
function nearestSunday(d: Date) {
  const dow = d.getDay();
  const fwd = (7 - dow) % 7;
  return dow <= fwd ? addDays(d, -dow) : addDays(d, fwd);
}

function Toggle({ on, set, label, hint }: {
  on: boolean; set: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <button onClick={() => set(!on)} className="flex items-start gap-2.5 text-left w-full">
      <span
        className={`mt-0.5 w-9 h-5 rounded-full shrink-0 transition-colors relative ${
          on ? "bg-violet-600" : "bg-slate-300"
        }`}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
          style={{ left: on ? 18 : 2 }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
      </span>
    </button>
  );
}

function StatChip({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 border ${good ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-extrabold ${good ? "text-emerald-700" : "text-amber-700"}`}>{value}</div>
    </div>
  );
}

function AutomationTab({ adminEmail }: { adminEmail: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => format(addMonths(new Date(), 1), "yyyy-MM"));
  const [weeks, setWeeks] = useState(4);
  const [keepLeave, setKeepLeave] = useState(true);
  const [continuePrev, setContinuePrev] = useState(true);
  const [useCoverage, setUseCoverage] = useState(false);
  const [coverage, setCoverage] = useState<Array<Record<string, number>> | null>(null);
  const [offset, setOffset] = useState(0);
  const [gyPool, setGyPool] = useState<string[]>([]);
  const [fixed, setFixed] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<GenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPool, setShowPool] = useState(false);
  // Kept in localStorage, never in the bundle — the token would be public
  // otherwise, and anyone could trigger a rewrite of the sheet.
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetToken, setSheetToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  // Hand-edits layered over the preview: `${agentId}|${date}` -> code
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const previewScroll = useRef<HTMLDivElement>(null);
  useDragScroll(previewScroll);

  // The month picker suggests an anchor; startOverride wins when set, so a
  // period can begin on any date rather than the computed Sunday.
  const [startOverride, setStartOverride] = useState<string | null>(null);
  const anchor = useMemo(() => nearestSunday(parseISO(`${month}-01`)), [month]);
  const start = useMemo(
    () => (startOverride ? parseISO(startOverride) : anchor),
    [startOverride, anchor],
  );
  const end = useMemo(() => addDays(start, weeks * 7 - 1), [start, weeks]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase.from("agents").select("*").eq("active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name");
      if (cancel) return;
      const list = (data as Agent[] | null) ?? [];
      setAgents(list);
      // Database first (shared by every admin, on every device); the cached
      // copy only covers the first paint and the not-yet-migrated case.
      const saved =
        (await loadSetting<AutoConfig>(CFG_KEY)) ?? readCached<AutoConfig>(CFG_KEY);
      if (cancel) return;
      if (saved?.gyPool?.length) {
        setGyPool(saved.gyPool.filter((id: string) => list.some((a) => a.id === id)));
      } else {
        setGyPool(list.filter((a) => !a.is_lead && GY_DEFAULTS.some((t) => hits(a.name, t))).map((a) => a.id));
      }
      if (saved?.coverage) setCoverage(saved.coverage);
      if (saved?.useCoverage) setUseCoverage(true);
      if (saved?.sheetUrl) setSheetUrl(saved.sheetUrl);
      if (saved?.sheetToken) setSheetToken(saved.sheetToken);
      if (saved?.fixed) setFixed(saved.fixed);
      else {
        const f: Record<string, string> = {};
        for (const [toks, code] of FIXED_DEFAULTS) {
          const m = list.find((a) => hits(a.name, toks));
          if (m) f[m.id] = code;
        }
        setFixed(f);
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Persist to Supabase, debounced so typing a URL doesn't write on every key.
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(async () => {
      const err = await saveSetting(CFG_KEY, { gyPool, fixed, sheetUrl, sheetToken, coverage, useCoverage });
      setCfgError(err);
    }, 800);
    return () => clearTimeout(t);
  }, [gyPool, fixed, sheetUrl, sheetToken, coverage, useCoverage, loading]);

  /**
   * Push the month to Google Sheets via the Apps Script web app.
   * Apps Script 302-redirects to a googleusercontent origin, which some
   * browsers refuse to expose to fetch — so fall back to a fire-and-forget
   * no-cors post rather than reporting a false failure.
   */
  async function pushToSheet(silent = false) {
    if (!sheetUrl || !sheetToken) {
      if (!silent) toast.error("Add the Web App URL and token below first");
      return;
    }
    const payload = JSON.stringify({ token: sheetToken, month, weeks });
    const opts = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: payload };
    setSyncing(true);
    try {
      const res = await fetch(sheetUrl, opts);
      const j = await res.json();
      if (j.ok) toast.success(`Sheet updated — ${j.agents} rows for ${j.month}`);
      else toast.error(`Sheet: ${j.error}`);
    } catch {
      try {
        await fetch(sheetUrl, { ...opts, mode: "no-cors" });
        toast.message("Sync sent to Sheets — response not readable, check the sheet");
      } catch {
        toast.error("Could not reach the Apps Script URL");
      }
    } finally {
      setSyncing(false);
    }
  }

  const leads = agents.filter((a) => a.is_lead);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  async function runPreview() {
    setBusy(true);
    setPreview(null);
    setEdits(new Map());
    try {
      const from = format(start, "yyyy-MM-dd");
      const to = format(end, "yyyy-MM-dd");
      // Carry across leave already recorded so generating never wipes a real
      // AL/SL/holiday that someone entered by hand.
      const leave: Record<string, string> = {};
      if (keepLeave) {
        const existing = await fetchSchedulesInRange(from, to);
        for (const r of existing) {
          const c = r.shift_code.trim().toUpperCase();
          if (!/^S[0-9.]+$/.test(c) && c !== "OFF") leave[`${r.agent_id}|${r.date}`] = r.shift_code;
        }
      }
      // The fortnight before the start date, so each agent's cycle resumes
      // across the boundary instead of restarting.
      const history: Record<string, string> = {};
      if (continuePrev) {
        const hFrom = format(addDays(start, -14), "yyyy-MM-dd");
        const hTo = format(addDays(start, -1), "yyyy-MM-dd");
        for (const r of await fetchSchedulesInRange(hFrom, hTo)) {
          history[`${r.agent_id}|${r.date}`] = r.shift_code;
        }
      }
      const res = generateSchedule({
        agents: agents.map((a) => ({ id: a.id, name: a.name, is_lead: a.is_lead })),
        startDate: from,
        weeks,
        gyPool,
        fixedShift: fixed,
        leave,
        offset,
        history,
        coverage: useCoverage ? (coverage ?? defaultCoverage(agents.length)) : null,
      });
      setPreview(res);
      if (res.warnings.length) toast.warning(`${res.warnings.length} rule warning(s)`);
      else toast.success("Preview ready — all rules satisfied");
    } finally {
      setBusy(false);
    }
  }

  // What will actually be written: the generated cells with any hand-edits on
  // top. The rule check re-runs against this, not the pristine generation.
  const effective = useMemo(
    () =>
      preview
        ? preview.cells.map((c) => ({
            ...c,
            shift_code: edits.get(`${c.agent_id}|${c.date}`) ?? c.shift_code,
          }))
        : [],
    [preview, edits],
  );
  const audit = useMemo(
    () =>
      preview
        ? auditSchedule(
            effective,
            preview.dates,
            agents.map((a) => ({ id: a.id, name: a.name, is_lead: a.is_lead })),
          )
        : null,
    [effective, preview, agents],
  );

  function setCell(agentId: string, date: string, code: string) {
    setEdits((m) => {
      const n = new Map(m);
      const orig = preview?.cells.find((c) => c.agent_id === agentId && c.date === date);
      if (orig && orig.shift_code === code) n.delete(`${agentId}|${date}`);
      else n.set(`${agentId}|${date}`, code);
      return n;
    });
  }

  async function apply() {
    if (!preview) return;
    if (!confirm(`Replace the schedule for ${agents.length} agents from ${format(start, "MMM d")} to ${format(end, "MMM d, yyyy")}?`)) return;
    setBusy(true);
    try {
      const from = preview.dates[0];
      const to = preview.dates[preview.dates.length - 1];
      const ids = agents.map((a) => a.id);
      const { error: delErr } = await supabase
        .from("schedules").delete().gte("date", from).lte("date", to).in("agent_id", ids);
      if (delErr) { toast.error(delErr.message); return; }
      const rows = effective.map((c) => ({ agent_id: c.agent_id, date: c.date, shift_code: c.shift_code }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("schedules").insert(rows.slice(i, i + 500));
        if (error) { toast.error(error.message); return; }
      }
      toast.success(`Applied ${rows.length} shifts`);
      await supabase.from("audit_log").insert({
        user_email: adminEmail, action: "schedule_generated",
        details: { from, to, weeks, cells: rows.length, manualEdits: edits.size },
      });
      // Push straight to Sheets if it's configured; silent when it isn't.
      await pushToSheet(true);
    } finally {
      setBusy(false);
    }
  }

  /** CSV shaped like the existing Google Sheet, ready to paste into it. */
  function exportForSheet() {
    if (!preview) return;
    const head = [format(start, "MMMM"), ...preview.dates.map((d) => format(parseISO(d), "EEEE-dd"))];
    const lookup = new Map(preview.cells.map((c) => [`${c.agent_id}|${c.date}`, c.shift_code]));
    const lines = [head.join(",")];
    for (const a of agents) {
      lines.push([`"${a.name}"`, ...preview.dates.map((d) => lookup.get(`${a.id}|${d}`) ?? "")].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `CX Schedule - ${format(start, "MMMM yyyy")}.csv`;
    el.click();
    URL.revokeObjectURL(url);
  }

  const s = audit?.stats;
  const rng = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`;
  const onlyKey = (o: Record<number, number>, k: number) => Object.keys(o).every((x) => +x === k);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-2xl px-5 py-4 text-white flex items-center gap-3"
        style={{ background: "linear-gradient(120deg,#6d28d9,#a855f7 55%,#52B788)" }}
      >
        <div className="w-9 h-9 rounded-xl bg-white/20 grid place-items-center backdrop-blur-sm shrink-0">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">Schedule Generator</div>
          <div className="text-[12px] text-white/85">
            {loading ? "Loading roster…" : `${agents.length} active agents · ${leads.length} shift leads · ${gyPool.length} graveyard-eligible`}
          </div>
        </div>
      </div>

      {/* Period */}
      <GlassCard className="p-4 flex flex-col gap-3">
        <div className="label-caps text-slate-500">Period</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">Month</label>
            <input
              type="month" value={month}
              onChange={(e) => { setMonth(e.target.value); setStartOverride(null); setPreview(null); }}
              className="glass rounded-xl px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">Start date</label>
            <input
              type="date" value={format(start, "yyyy-MM-dd")}
              onChange={(e) => { setStartOverride(e.target.value || null); setPreview(null); }}
              className="glass rounded-xl px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">Weeks</label>
            <div className="flex gap-1">
              {[4, 5].map((w) => (
                <button
                  key={w} onClick={() => { setWeeks(w); setPreview(null); }}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                    weeks === w ? "bg-violet-600 text-white shadow-sm" : "glass text-slate-600"
                  }`}
                >{w}</button>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">Covers</div>
            <div className="text-sm font-bold text-violet-800">
              {format(start, "EEE d MMM")} → {format(end, "EEE d MMM yyyy")}
            </div>
            {startOverride && (
              <button
                onClick={() => { setStartOverride(null); setPreview(null); }}
                className="text-[10px] font-semibold text-violet-600 underline mt-0.5"
              >
                reset to {format(anchor, "d MMM")}
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Options */}
      <GlassCard className="p-4 flex flex-col gap-3.5">
        <div className="label-caps text-slate-500">Options</div>
        <Toggle
          on={keepLeave} set={(v) => { setKeepLeave(v); setPreview(null); }}
          label="Keep existing leave"
          hint="Preserves AL, SL, DL, birthdays and holidays already entered for these dates."
        />
        <Toggle
          on={continuePrev} set={(v) => { setContinuePrev(v); setPreview(null); }}
          label="Continue from last month"
          hint="Resumes each agent's 5-on/2-off cycle across the boundary, keeping their days off and finishing a block that was still running."
        />
        <div className="flex items-center gap-3 pt-1">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-700">Rotation offset</div>
            <div className="text-[11px] text-slate-500 leading-snug">
              Shifts who gets which days off, so consecutive months don't repeat the same
              pattern. Only applies to agents without carried-over history.
            </div>
          </div>
          <input
            type="number" min={0} max={20} value={offset}
            onChange={(e) => { setOffset(Math.max(0, Number(e.target.value) || 0)); setPreview(null); }}
            className="glass rounded-xl px-3 py-2 text-sm w-20 text-center outline-none shrink-0"
          />
        </div>
      </GlassCard>

      {/* Coverage targets */}
      <GlassCard className="p-4 flex flex-col gap-3">
        <Toggle
          on={useCoverage}
          set={(v) => {
            setUseCoverage(v);
            if (v && !coverage) setCoverage(defaultCoverage(agents.length));
            setPreview(null);
          }}
          label="Set headcount per shift"
          hint="Type how many people you want on each shift for each weekday. Leave off to use the pattern measured from your past sheets."
        />
        {useCoverage && coverage && (
          <>
            <div className="overflow-x-auto show-scroll">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1 font-semibold text-slate-500"> </th>
                    {COV_CODES.map((c) => (
                      <th key={c} className="px-1 py-1 font-bold text-center w-14" style={{ color: codeStyle(c).text }}>{c}</th>
                    ))}
                    <th className="px-2 py-1 text-center text-slate-500 font-semibold">Morning</th>
                    <th className="px-2 py-1 text-center text-slate-500 font-semibold">Evening</th>
                    <th className="px-2 py-1 text-center text-slate-500 font-semibold">Off</th>
                  </tr>
                </thead>
                <tbody>
                  {WD_LABELS.map((lbl, wd) => {
                    const row = coverage[wd] ?? {};
                    const m = MORNING_CODES.reduce((n, c) => n + (row[c] ?? 0), 0);
                    const e = EVENING_CODES.reduce((n, c) => n + (row[c] ?? 0), 0);
                    const total = m + e + (row.S6 ?? 0);
                    const off = agents.length - total;
                    const heavy = wd === 5 || wd === 6;
                    return (
                      <tr key={lbl}>
                        <td className={`px-2 py-1 font-bold ${heavy ? "text-violet-600" : "text-slate-600"}`}>{lbl}</td>
                        {COV_CODES.map((c) => (
                          <td key={c} className="px-0.5 py-0.5">
                            <input
                              type="number" min={0} max={99} value={row[c] ?? 0}
                              onChange={(ev) => {
                                const v = Math.max(0, Number(ev.target.value) || 0);
                                setCoverage((prev) => {
                                  const next = (prev ?? defaultCoverage(agents.length)).map((r) => ({ ...r }));
                                  next[wd] = { ...next[wd], [c]: v };
                                  return next;
                                });
                                setPreview(null);
                              }}
                              className="glass rounded-lg w-14 px-1 py-1 text-center text-xs outline-none"
                            />
                          </td>
                        ))}
                        <td className="px-2 text-center font-bold text-slate-600">{m}</td>
                        <td className="px-2 text-center font-bold text-slate-600">{e}</td>
                        <td className={`px-2 text-center font-bold ${off < 0 ? "text-red-600" : "text-slate-500"}`}>{off}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setCoverage(defaultCoverage(agents.length)); setPreview(null); }}
                className="text-[11px] font-semibold text-violet-600"
              >
                Reset to measured pattern
              </button>
              <span className="text-[11px] text-slate-500">
                The daily total also decides how many are off, so Off cannot go negative.
                Per-code numbers are met closely; band totals are aimed at, since a band is
                held for a whole 5-day block.
              </span>
            </div>
          </>
        )}
      </GlassCard>

      {/* Roster rules */}
      <GlassCard className="p-4 flex flex-col gap-3">
        <button onClick={() => setShowPool((v) => !v)} className="flex items-center justify-between w-full">
          <span className="label-caps text-slate-500">Roster rules</span>
          <span className="text-[11px] font-semibold text-violet-600">{showPool ? "Hide" : "Edit"}</span>
        </button>
        <div className="flex flex-wrap gap-1.5">
          {leads.map((a) => (
            <span key={a.id} className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
              <Crown size={11} /> {a.name}
            </span>
          ))}
          {Object.entries(fixed).map(([id, code]) => (
            <span key={id} className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-200">
              {byId.get(id)?.name ?? "?"} · fixed {code}
            </span>
          ))}
        </div>
        {leads.length < 4 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Only {leads.length} lead(s) marked. 2–3 leads are needed on morning and evening every
            day, so at least 4 are required — mark more with the crown in the Agents tab.
          </div>
        )}
        {showPool && (
          <div className="flex flex-col gap-3 pt-1">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                Graveyard eligible (S6) — leads are excluded automatically
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agents.filter((a) => !a.is_lead).map((a) => {
                  const on = gyPool.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() => { setGyPool((p) => on ? p.filter((x) => x !== a.id) : [...p, a.id]); setPreview(null); }}
                      className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border transition-all ${
                        on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white/60 text-slate-500 border-slate-200"
                      }`}
                    >{a.name}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                Fixed shift — these agents never rotate
              </div>
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto show-scroll pr-1">
                {agents.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 flex-1 truncate">{a.name}</span>
                    <select
                      value={fixed[a.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFixed((f) => { const n = { ...f }; if (v) n[a.id] = v; else delete n[a.id]; return n; });
                        setPreview(null);
                      }}
                      className="glass rounded-lg px-2 py-1 text-[11px] outline-none shrink-0"
                    >
                      <option value="">rotates</option>
                      {ALL_SHIFT_CODES.filter((c) => /^S[0-9.]+$/.test(c)).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Google Sheet */}
      <GlassCard className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="label-caps text-slate-500">Google Sheet</span>
          <span className={`text-[11px] font-semibold ${sheetUrl && sheetToken ? "text-emerald-600" : "text-slate-400"}`}>
            {sheetUrl && sheetToken ? "Connected — syncs on Apply" : "Not connected"}
          </span>
        </div>
        {cfgError && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Settings aren't saving to the database ({cfgError}). They'll persist in this
            browser only until <span className="font-mono">supabase-settings.sql</span> is run.
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value.trim())}
            placeholder="Apps Script Web App URL (…/exec)"
            className="glass rounded-xl px-3 py-2 text-sm outline-none w-full"
          />
          <input
            type="password"
            value={sheetToken}
            onChange={(e) => setSheetToken(e.target.value.trim())}
            placeholder="Sync token (must match SYNC_TOKEN in the script)"
            className="glass rounded-xl px-3 py-2 text-sm outline-none w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => pushToSheet(false)}
            disabled={syncing || !sheetUrl || !sheetToken}
            className="rounded-xl glass px-3.5 py-2 text-sm font-semibold text-slate-600 flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
          >
            <UploadIcon size={14} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
          <span className="text-[11px] text-slate-500">
            {cfgError
              ? "This browser only — run supabase-settings.sql to share it."
              : "Saved for every admin, on every device."}
          </span>
        </div>
      </GlassCard>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runPreview} disabled={busy || loading || agents.length === 0}
          className="rounded-xl px-4 py-2.5 text-sm font-bold text-white flex items-center gap-2 active:scale-95 disabled:opacity-50"
          style={{ background: "linear-gradient(120deg,#6d28d9,#a855f7)" }}
        >
          <Sparkles size={15} /> {busy ? "Working…" : "Generate preview"}
        </button>
        {preview && (
          <>
            <button
              onClick={apply} disabled={busy}
              className="rounded-xl bg-[#1e5a3d] text-white px-4 py-2.5 text-sm font-bold flex items-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <Check size={15} /> Apply to schedule
            </button>
            <button
              onClick={exportForSheet}
              className="rounded-xl glass px-3.5 py-2.5 text-sm font-semibold text-slate-600 flex items-center gap-1.5 active:scale-95"
            >
              <Download size={15} /> CSV for Sheets
            </button>
          </>
        )}
      </div>

      {/* Result */}
      {preview && s && (
        <GlassCard className="p-4 flex flex-col gap-3">
          <div className="label-caps text-slate-500">Rule check</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatChip label="Work blocks" value={onlyKey(s.workBlocks, 5) ? "all 5 days" : "mixed"} good={onlyKey(s.workBlocks, 5)} />
            <StatChip label="Off blocks" value={onlyKey(s.offBlocks, 2) ? "all 2 days" : "mixed"} good={onlyKey(s.offBlocks, 2)} />
            <StatChip label="Graveyard / day" value={rng(s.gyPerDay)} good={Math.min(...s.gyPerDay) >= 2} />
            <StatChip label="Leads morning" value={rng(s.morningLeadsPerDay)} good={Math.min(...s.morningLeadsPerDay) >= 2} />
            <StatChip label="Leads evening" value={rng(s.eveningLeadsPerDay)} good={Math.min(...s.eveningLeadsPerDay) >= 2} />
            <StatChip label="Shifts" value={String(effective.length)} good />
          </div>

          <div className="label-caps text-slate-500 mt-1">Off per weekday</div>
          <div className="flex flex-col gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
              <div key={d} className="flex items-center gap-2">
                <span className="w-9 text-[11px] font-bold text-slate-600">{d}</span>
                <div className="flex-1 h-4 rounded-md bg-slate-100 overflow-hidden">
                  <div className="h-full bg-violet-400" style={{ width: `${Math.min(100, (s.offByWeekday[i] / Math.max(1, agents.length)) * 100 * 2.2)}%` }} />
                </div>
                <span className="text-[11px] font-semibold text-slate-500 w-16 text-right">
                  {s.offByWeekday[i].toFixed(1)} off
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="label-caps text-slate-500">Edit before applying</span>
            {edits.size > 0 && (
              <button
                onClick={() => setEdits(new Map())}
                className="text-[11px] font-semibold text-violet-600 flex items-center gap-1"
              >
                <Undo2 size={12} /> Reset {edits.size} edit{edits.size === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-500 -mt-2">
            Change any cell — set someone OFF or AL to pull them out of a week, or give
            them a shift to add them. The rule check above updates as you edit.
          </div>
          <div ref={previewScroll} className="overflow-auto show-scroll max-h-[60vh] rounded-xl">
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 top-0 z-30 backdrop-blur-md text-left px-2 py-2 font-semibold text-slate-700"
                    style={{ background: "var(--surface-sticky)", minWidth: 150 }}
                  >
                    Agent
                  </th>
                  {preview.dates.map((d) => {
                    const dd = parseISO(d);
                    return (
                      <th
                        key={d}
                        className="px-1 py-2 font-semibold text-center min-w-[46px] sticky top-0 z-20 backdrop-blur-md"
                        style={{ background: "var(--surface-sticky)" }}
                      >
                        <div className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>
                          {format(dd, "EEE")}
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--text-strong)" }}>
                          {format(dd, "d")}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td
                      className="sticky left-0 z-10 backdrop-blur-md px-2 py-1 truncate"
                      style={{ background: "var(--surface-sticky-soft)", minWidth: 150, maxWidth: 150 }}
                    >
                      <span className="flex items-center gap-1.5">
                        {a.is_lead && <Crown size={11} className="text-amber-500 shrink-0" />}
                        <span className="truncate">{a.name}</span>
                      </span>
                    </td>
                    {preview.dates.map((d) => {
                      const key = `${a.id}|${d}`;
                      const code = edits.get(key)
                        ?? preview.cells.find((c) => c.agent_id === a.id && c.date === d)?.shift_code
                        ?? "";
                      const st = codeStyle(code);
                      const changed = edits.has(key);
                      return (
                        <td key={d} className="p-0.5 text-center">
                          <select
                            value={code}
                            onChange={(e) => setCell(a.id, d, e.target.value)}
                            className="appearance-none w-full rounded-md px-0.5 py-1 text-[10px] font-bold uppercase cursor-pointer outline-none text-center"
                            style={{
                              background: st.bg,
                              color: st.text,
                              boxShadow: changed ? `inset 0 0 0 2px ${st.dot}` : "none",
                            }}
                          >
                            {ALL_SHIFT_CODES.map((c) => (
                              <option key={c} value={c}>{shortCode(c)}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(audit?.warnings.length ?? 0) > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex flex-col gap-1">
              {audit!.warnings.map((w) => (
                <div key={w} className="text-[11px] text-amber-800">• {w}</div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}
