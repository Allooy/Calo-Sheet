import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import { GlassCard } from "@/components/GlassCard";
import { Avatar } from "@/components/Avatar";
import { LeadBadge } from "@/components/LeadBadge";
import { ShiftBadge } from "@/components/ShiftBadge";
import { Skeleton } from "@/components/Skeleton";
import { EmptyIllustration } from "@/components/EmptyIllustration";
import { useAuth } from "@/lib/auth";
import { supabase, type Agent, type Schedule, type ShiftType } from "@/lib/supabase";
import {
  categoryStyle,
  formatTimeRange,
  shiftCategory,
  type ShiftCategory,
} from "@/lib/shifts";

export const Route = createFileRoute("/today")({
  component: TodayPage,
});

function TodayPage() {
  const { agent } = useAuth();
  const todayDate = useMemo(() => new Date(), []);
  const today = useMemo(() => format(todayDate, "yyyy-MM-dd"), [todayDate]);
  const tomorrowDate = useMemo(() => addDays(todayDate, 1), [todayDate]);
  const tomorrow = useMemo(() => format(tomorrowDate, "yyyy-MM-dd"), [tomorrowDate]);
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tomorrowSchedules, setTomorrowSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [shiftTypes, setShiftTypes] = useState<Record<string, ShiftType>>({});

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      const [s, st, a, t] = await Promise.all([
        supabase.from("schedules").select("*").eq("date", today),
        supabase.from("schedules").select("*").eq("date", tomorrow),
        supabase.from("agents").select("*").eq("active", true),
        supabase.from("shift_types").select("*"),
      ]);
      if (cancel) return;
      setSchedules((s.data as Schedule[] | null) ?? []);
      setTomorrowSchedules((st.data as Schedule[] | null) ?? []);
      setAgents((a.data as Agent[] | null) ?? []);
      const map: Record<string, ShiftType> = {};
      for (const row of (t.data as ShiftType[] | null) ?? []) map[row.code] = row;
      setShiftTypes(map);
      setLoading(false);
    }
    load();
    return () => { cancel = true; };
  }, [today, tomorrow]);

  const mySchedule = agent ? schedules.find((s) => s.agent_id === agent.id) : null;
  const myCat: ShiftCategory = shiftCategory(mySchedule?.shift_code);
  const myCatStyle = categoryStyle(myCat);
  const timeRange = mySchedule ? formatTimeRange(mySchedule.shift_code, shiftTypes) : null;

  // graveyard text (#a5b4fc) is designed for dark backgrounds — use the deeper dot color on white
  const heroCodeColor =
    myCat === "graveyard" ? "#4338ca" :
    myCat === "off" ? "#64748b" :
    myCatStyle.text;

  const tomorrowRow = agent ? tomorrowSchedules.find((s) => s.agent_id === agent.id) : null;
  const tomorrowCat: ShiftCategory = shiftCategory(tomorrowRow?.shift_code);
  const tomorrowTime = tomorrowRow ? formatTimeRange(tomorrowRow.shift_code, shiftTypes) : null;
  const tomorrowCodeColor =
    tomorrowCat === "graveyard" ? "#4338ca" :
    tomorrowCat === "off" ? "#64748b" :
    categoryStyle(tomorrowCat).text;

  const teammates = useMemo(() => {
    if (!agent || !mySchedule) return [];
    return schedules
      .filter((s) => s.agent_id !== agent.id && shiftCategory(s.shift_code) === myCat)
      .map((s) => {
        const a = agents.find((x) => x.id === s.agent_id);
        return a ? { agent: a, schedule: s } : null;
      })
      .filter((x): x is { agent: Agent; schedule: Schedule } => !!x)
      .sort(
        (x, y) =>
          Number(y.agent.is_lead) - Number(x.agent.is_lead) ||
          x.agent.name.localeCompare(y.agent.name),
      );
  }, [schedules, agents, agent, mySchedule, myCat]);

  const stats = useMemo(() => {
    let m = 0, e = 0, g = 0;
    for (const s of schedules) {
      const c = shiftCategory(s.shift_code);
      if (c === "morning") m++;
      else if (c === "evening") e++;
      else if (c === "graveyard") g++;
    }
    return { m, e, g };
  }, [schedules]);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">

        {/* ── Hero card ── */}
        <div
          className="rounded-3xl overflow-hidden animate-[fade-in_0.3s_ease-out]"
          style={{
            background: "linear-gradient(155deg, #c2e8d8 0%, #d6f2e4 45%, #e8f5ef 100%)",
            boxShadow: "0 6px 32px rgba(82,183,136,0.22), 0 1px 4px rgba(0,0,0,0.04)",
            border: "1px solid rgba(255,255,255,0.7)",
          }}
        >
          <div className="p-6 md:p-8">
            {/* Date row */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="label-caps" style={{ color: "rgba(30,90,61,0.55)" }}>Your shift today</div>
                <div className="mt-1 text-xl font-bold" style={{ color: "#1a3d2b" }}>
                  {format(new Date(), "EEEE, MMMM d")}
                </div>
              </div>
              {mySchedule && !loading && (
                <div
                  className="shrink-0 mt-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
                  style={{ background: "rgba(255,255,255,0.55)", color: "#1e5a3d" }}
                >
                  {myCat === "off" ? "Day Off" : myCat}
                </div>
              )}
            </div>

            {/* Shift display */}
            {loading ? (
              <div className="mt-8 flex flex-col items-center gap-3">
                <div className="h-24 w-36 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.4)" }} />
                <div className="h-4 w-28 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.3)" }} />
              </div>
            ) : !mySchedule ? (
              <div className="mt-10 text-center text-sm" style={{ color: "rgba(30,90,61,0.45)" }}>
                Schedule not set for today
              </div>
            ) : myCat === "off" ? (
              <div className="mt-8 text-center">
                <div className="text-5xl mb-3 animate-[scale-in_0.3s_ease-out]">🌿</div>
                <div className="text-3xl font-black tracking-tight" style={{ color: "#1a3d2b" }}>
                  You're off today
                </div>
                <div className="mt-2 label-caps" style={{ color: "rgba(30,90,61,0.45)" }}>
                  {mySchedule.shift_code}
                </div>
              </div>
            ) : (
              <div className="mt-6 text-center animate-[scale-in_0.3s_ease-out]">
                <div
                  className="text-[92px] md:text-[112px] font-black leading-none tracking-tighter select-none"
                  style={{ color: heroCodeColor }}
                >
                  {mySchedule.shift_code}
                </div>
                {timeRange && (
                  <div className="mt-3 text-base font-semibold" style={{ color: "rgba(30,90,61,0.55)" }}>{timeRange}</div>
                )}
                {mySchedule.notes && (
                  <div className="mt-1.5 text-sm" style={{ color: "rgba(30,90,61,0.4)" }}>{mySchedule.notes}</div>
                )}
              </div>
            )}

            {/* Bottom greeting */}
            <div
              className="mt-6 pt-4 flex items-center justify-between"
              style={{ borderTop: "1px solid rgba(30,90,61,0.12)" }}
            >
              <span className="text-sm font-medium" style={{ color: "rgba(30,90,61,0.6)" }}>
                {agent?.name ? `Hey, ${agent.name.split(" ")[0]} 👋` : "Welcome back"}
              </span>
              <span className="text-xs" style={{ color: "rgba(30,90,61,0.4)" }}>
                {format(new Date(), "EEE · MMM d")}
              </span>
            </div>
          </div>
        </div>

        {/* ── On shift with you ── */}
        {mySchedule && myCat !== "off" && (
          <section className="animate-[slide-up_0.3s_ease-out_0.08s_both]">
            <div className="flex items-baseline justify-between mb-3 px-1">
              <div>
                <div className="label-caps text-slate-400">On shift with you</div>
                <div className="text-sm text-slate-400 font-medium mt-0.5">
                  Same shift window today
                </div>
              </div>
              {!loading && (
                <div
                  className="text-xs font-black px-2.5 py-0.5 rounded-full"
                  style={{ background: myCatStyle.bg, color: myCatStyle.text }}
                >
                  {teammates.length}
                </div>
              )}
            </div>
            {loading ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-40 shrink-0" />
                ))}
              </div>
            ) : teammates.length === 0 ? (
              <GlassCard className="p-6 text-center flex flex-col items-center gap-2">
                <EmptyIllustration size={72} />
                <div className="text-sm text-slate-500">You're the only one on this shift today</div>
              </GlassCard>
            ) : (
              <div className="flex md:grid md:grid-cols-3 lg:grid-cols-4 gap-3 overflow-x-auto md:overflow-visible pb-2 -mx-1 px-1">
                {teammates.map(({ agent: a, schedule: s }, i) => (
                  <GlassCard
                    key={a.id}
                    hoverable
                    className="p-3 flex items-center gap-3 min-w-[190px] md:min-w-0"
                    style={{ animation: `scale-in 0.25s ease-out ${i * 20}ms both` }}
                  >
                    <Avatar name={a.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-semibold truncate text-slate-800">{a.name}</span>
                        {a.is_lead && <LeadBadge />}
                      </div>
                      <div className="mt-1">
                        <ShiftBadge code={s.shift_code} size="sm" />
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Team stats (list card) ── */}
        <section className="animate-[slide-up_0.3s_ease-out_0.15s_both]">
          <div className="label-caps text-slate-400 mb-3 px-1">Team on shift today</div>
          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.82)",
              backdropFilter: "blur(24px) saturate(140%)",
              border: "1px solid rgba(255,255,255,0.6)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.05)",
            }}
          >
            {(
              [
                { label: "Morning",   value: stats.m, cat: "morning"   as ShiftCategory },
                { label: "Evening",   value: stats.e, cat: "evening"   as ShiftCategory },
                { label: "Graveyard", value: stats.g, cat: "graveyard" as ShiftCategory },
              ] as const
            ).map(({ label, value, cat }, i, arr) => {
              const s = categoryStyle(cat);
              const numColor = cat === "graveyard" ? "#4338ca" : s.text;
              return (
                <Link
                  key={cat}
                  to="/team"
                  search={{ cat }}
                  className={`flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-slate-50/80 active:bg-slate-100/60 ${
                    i < arr.length - 1 ? "border-b border-slate-100/80" : ""
                  }`}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: s.dot }}
                  />
                  <span className="text-sm font-semibold text-slate-700 flex-1">{label}</span>
                  {loading ? (
                    <div className="h-7 w-10 rounded-lg bg-slate-100 animate-pulse" />
                  ) : (
                    <span
                      className="text-2xl font-black tabular-nums"
                      style={{ color: numColor }}
                    >
                      {value}
                    </span>
                  )}
                  <svg
                    className="ml-0.5 shrink-0"
                    width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="#cbd5e1" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Tomorrow ── */}
        <section className="animate-[slide-up_0.3s_ease-out_0.2s_both]">
          <div className="label-caps text-slate-400 mb-3 px-1">Up next</div>
          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #c2e8d8 0%, #d6f2e4 55%, #e8f5ef 100%)",
              border: "1px solid rgba(255,255,255,0.7)",
              boxShadow: "0 4px 20px rgba(82,183,136,0.18)",
            }}
          >
            <div className="p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="label-caps" style={{ color: "rgba(30,90,61,0.55)" }}>Tomorrow</div>
                <div className="text-base font-bold mt-0.5 truncate" style={{ color: "#1a3d2b" }}>
                  {format(tomorrowDate, "EEEE, MMM d")}
                </div>
                {tomorrowTime && (
                  <div className="text-sm font-semibold mt-1" style={{ color: "rgba(30,90,61,0.55)" }}>
                    {tomorrowTime}
                  </div>
                )}
              </div>

              <div className="text-right shrink-0">
                {loading ? (
                  <div className="h-12 w-20 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.5)" }} />
                ) : !tomorrowRow ? (
                  <div className="text-sm font-medium" style={{ color: "rgba(30,90,61,0.45)" }}>Not set</div>
                ) : tomorrowCat === "off" ? (
                  <div className="text-3xl font-black tracking-tight" style={{ color: "#1a3d2b" }}>
                    Off 🌿
                  </div>
                ) : (
                  <div
                    className="text-5xl font-black tracking-tighter leading-none"
                    style={{ color: tomorrowCodeColor }}
                  >
                    {tomorrowRow.shift_code}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

    </div>
  );
}
