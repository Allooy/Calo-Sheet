import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
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
  type Agent,
  type AuditLog,
  type Schedule,
} from "@/lib/supabase";
import { ALL_SHIFT_CODES, categoryStyle, shiftCategory } from "@/lib/shifts";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "grid", label: "Schedule Grid" },
  { key: "bulk", label: "Bulk Edit" },
  { key: "edit", label: "Edit Shifts" },
  { key: "upload", label: "Upload" },
  { key: "agents", label: "Agents" },
  { key: "log", label: "Log" },
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
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                tab === t.key
                  ? "bg-white text-[#1e5a3d] shadow-sm"
                  : "text-slate-600 hover:bg-white/40"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div key={tab} className="animate-[fade-in_0.2s_ease-out]">
          {tab === "overview" && <TeamMonthGrid />}
          {tab === "grid" && <GridTab />}
          {tab === "bulk" && <BulkTab adminEmail={agent.email} />}
          {tab === "edit" && <EditTab adminEmail={agent.email} />}
          {tab === "upload" && <UploadTab adminEmail={agent.email} />}
          {tab === "agents" && <AgentsTab adminEmail={agent.email} />}
          {tab === "log" && <LogTab />}
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
        supabase.from("schedules").select("*").gte("date", from).lte("date", to),
      ]);
      if (cancel) return;
      setAgents((a.data as Agent[] | null) ?? []);
      setRows((s.data as Schedule[] | null) ?? []);
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
    const existing = lookup.get(`${agentId}|${dateKey}`);
    if (code === "—") {
      if (existing) {
        const { error } = await supabase.from("schedules").delete().eq("id", existing.id);
        if (error) return toast.error(error.message);
        setRows((r) => r.filter((x) => x.id !== existing.id));
      }
      return;
    }
    if (existing) {
      const { error } = await supabase
        .from("schedules")
        .update({ shift_code: code })
        .eq("id", existing.id);
      if (error) return toast.error(error.message);
      setRows((r) =>
        r.map((x) => (x.id === existing.id ? { ...x, shift_code: code } : x)),
      );
    } else {
      const { data, error } = await supabase
        .from("schedules")
        .insert({ agent_id: agentId, date: dateKey, shift_code: code })
        .select()
        .single();
      if (error) return toast.error(error.message);
      if (data) setRows((r) => [...r, data as Schedule]);
    }
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
        <button
          onClick={exportCSV}
          className="rounded-xl bg-[#1e5a3d] text-white px-3 py-2 text-xs font-semibold flex items-center gap-1.5 active:scale-95"
        >
          <Download size={14} /> Export CSV
        </button>
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
            className="overflow-x-auto show-scroll pb-1"
            onScroll={(e) => setCollapsed(e.currentTarget.scrollLeft > 24)}
          >
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-10 bg-white/85 backdrop-blur-md text-left px-3 py-2 font-semibold text-slate-700 border-b border-white/40 transition-all duration-300"
                    style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                  >
                    <span
                      className="inline-block overflow-hidden whitespace-nowrap align-middle transition-all duration-300"
                      style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
                    >
                      Agent
                    </span>
                  </th>
                  {days.map((d, i) => (
                    <th
                      key={d.toISOString()}
                      className="px-1.5 py-2 font-semibold text-slate-500 text-center min-w-[58px] border-b border-white/40"
                    >
                      <div className="text-[9px] uppercase">{format(d, "EEE")}</div>
                      <div className="text-sm text-slate-800">{format(d, "d")}</div>
                      <div className="text-[8px] text-slate-400 mt-0.5 leading-tight">
                        {dayStats[i].m}/{dayStats[i].e}/{dayStats[i].g}
                      </div>
                    </th>
                  ))}
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
                        <Avatar name={a.name} url={a.avatar_url} size="sm" />
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
                      const cat = shiftCategory(r?.shift_code);
                      const s = categoryStyle(cat);
                      return (
                        <td
                          key={dk}
                          className="p-0.5 border-b border-white/30 text-center"
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
                                {c}
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
      supabase.from("agents").select("*").eq("active", true).order("name"),
      supabase.from("schedules").select("*").gte("date", from).lte("date", to),
    ]);
    setAgents((a.data as Agent[] | null) ?? []);
    setRows((s.data as Schedule[] | null) ?? []);
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
    const upserts = changes
      .filter((c) => c.val !== null)
      .map((c) => {
        const [agent_id, date] = c.key.split("|");
        return { agent_id, date, shift_code: c.val as string };
      });
    const deleteIds = changes
      .filter((c) => c.val === null)
      .map((c) => lookup.get(c.key)?.id)
      .filter((x): x is string => !!x);

    if (upserts.length) {
      const { error } = await supabase
        .from("schedules")
        .upsert(upserts, { onConflict: "agent_id,date" });
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    if (deleteIds.length) {
      const { error } = await supabase.from("schedules").delete().in("id", deleteIds);
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
            const cat = shiftCategory(code);
            const s = categoryStyle(cat);
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
                  color: isErase ? "#64748b" : (cat === "graveyard" ? "#4338ca" : s.text),
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
            className="overflow-x-auto show-scroll select-none pb-1"
            onScroll={(e) => setCollapsed(e.currentTarget.scrollLeft > 24)}
            onPointerMove={onContainerMove}
          >
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-10 bg-white/85 backdrop-blur-md text-left px-3 py-2 font-semibold text-slate-700 border-b border-white/40 transition-all duration-300"
                    style={{ minWidth: collapsed ? 56 : 180, width: collapsed ? 56 : 180 }}
                  >
                    <span
                      className="inline-block overflow-hidden whitespace-nowrap align-middle transition-all duration-300"
                      style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
                    >
                      Agent
                    </span>
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.toISOString()}
                      className="px-1.5 py-2 font-semibold text-slate-500 text-center min-w-[52px] border-b border-white/40"
                    >
                      <div className="text-[9px] uppercase">{format(d, "EEE")}</div>
                      <div className="text-sm text-slate-800">{format(d, "d")}</div>
                    </th>
                  ))}
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
                        <Avatar name={a.name} url={a.avatar_url} size="sm" />
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
                      const cat = shiftCategory(eff);
                      const s = categoryStyle(cat);
                      return (
                        <td key={dk} className="p-0.5 border-b border-white/30 text-center">
                          <div
                            onPointerDown={(e) => onCellDown(a.id, dk, e)}
                            onPointerEnter={(e) => onCellEnter(a.id, dk, e)}
                            onPointerUp={onCellUp}
                            className="relative mx-auto rounded-md px-1 py-1 text-[10px] font-bold uppercase cursor-pointer transition-colors"
                            style={{
                              background: eff ? s.bg : "transparent",
                              color: eff ? (cat === "graveyard" ? "#4338ca" : s.text) : "#cbd5e1",
                              boxShadow: changed ? `inset 0 0 0 2px ${s.dot}` : "none",
                              touchAction: "pan-x pan-y",
                            }}
                          >
                            {eff ?? "·"}
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
        supabase.from("agents").select("*").eq("active", true).order("name"),
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
    const existing = byAgent.get(agentId);
    if (existing) {
      const { error } = await supabase
        .from("schedules")
        .update({ shift_code: code })
        .eq("id", existing.id);
      if (error) return toast.error(error.message);
      setRows((r) => r.map((x) => (x.id === existing.id ? { ...x, shift_code: code } : x)));
    } else {
      const { data, error } = await supabase
        .from("schedules")
        .insert({ agent_id: agentId, date, shift_code: code })
        .select()
        .single();
      if (error) return toast.error(error.message);
      if (data) setRows((r) => [...r, data as Schedule]);
    }
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
    setImporting(true);
    const chunk = 100;
    let ok = 0;
    let lastError = "";
    for (let i = 0; i < valid.length; i += chunk) {
      const slice = valid.slice(i, i + chunk).map((r) => ({
        agent_id: r.match!.id,
        date: r.date,
        shift_code: r.shift_code,
      }));
      const { error } = await supabase
        .from("schedules")
        .upsert(slice, { onConflict: "agent_id,date" });
      // Keep going past a bad chunk so one failure doesn't block everyone else.
      if (error) lastError = error.message;
      else ok += slice.length;
      setProgress(Math.round(((i + slice.length) / valid.length) * 100));
    }
    setImporting(false);
    setProgress(0);
    const skipped = parsed.length - valid.length;
    if (lastError) {
      toast.error(`Imported ${ok}/${valid.length}. Some failed: ${lastError}`);
    } else {
      toast.success(`Imported ${ok} rows${skipped ? ` · ${skipped} unmatched skipped` : ""}`);
    }
    setParsed(null);
    await supabase.from("audit_log").insert({
      user_email: adminEmail,
      action: "schedules_imported",
      details: { count: ok, unmatched: skipped },
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
      .order("name")
      .then(({ data }) => {
        if (cancel) return;
        setAgents((data as Agent[] | null) ?? []);
        setLoading(false);
      });
    return () => { cancel = true; };
  }, []);

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

  async function toggleLead(a: Agent) {
    const { error } = await supabase.from("agents").update({ is_lead: !a.is_lead }).eq("id", a.id);
    if (error) return toast.error(error.message);
    setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, is_lead: !a.is_lead } : x)));
    await supabase.from("audit_log").insert({ user_email: adminEmail, action: "agent_lead_toggled", details: { id: a.id, is_lead: !a.is_lead } });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-slate-500">
          {agents.length} total · {agents.filter((a) => a.active).length} active
        </div>
        <button
          onClick={openAdd}
          className="rounded-xl bg-[#1e5a3d] text-white px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 active:scale-95"
        >
          <Plus size={15} /> Add agent
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)
        ) : (
          agents.map((a) => (
            <GlassCard key={a.id} className={`p-3 flex items-center gap-3 ${a.active ? "" : "opacity-60"}`}>
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
