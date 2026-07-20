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
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { Skeleton } from "./Skeleton";
import { supabase, type Agent, type Schedule } from "@/lib/supabase";
import { categoryStyle, codeStyle, shiftCategory, type ShiftCategory } from "@/lib/shifts";

const SHORT_CODE: Record<string, string> = {
  "PUBLIC HOLIDAY": "PH",
  "BIRTHDAY OFF": "BDAY",
  "EID OFF": "EID",
};
function cellCode(code: string) {
  const up = code.trim().toUpperCase();
  if (SHORT_CODE[up]) return SHORT_CODE[up];
  return code.length > 4 ? code.slice(0, 4) : code;
}

export function TeammateScheduleModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Schedule[]>([]);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("schedules")
        .select("*")
        .eq("agent_id", agent.id)
        .gte("date", format(gridStart, "yyyy-MM-dd"))
        .lte("date", format(gridEnd, "yyyy-MM-dd"));
      if (cancel) return;
      setRows((data as Schedule[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, cursor]);

  const byDate = useMemo(() => {
    const m = new Map<string, Schedule>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);

  const legend = useMemo(() => {
    let m = 0, e = 0, g = 0, o = 0;
    for (const r of rows) {
      if (!isSameMonth(new Date(r.date), cursor)) continue;
      const c = shiftCategory(r.shift_code);
      if (c === "morning") m++;
      else if (c === "evening") e++;
      else if (c === "graveyard") g++;
      else if (c === "off") o++;
    }
    return (
      [
        { cat: "morning" as ShiftCategory, label: "Morning", v: m },
        { cat: "evening" as ShiftCategory, label: "Evening", v: e },
        { cat: "graveyard" as ShiftCategory, label: "Graveyard", v: g },
        { cat: "off" as ShiftCategory, label: "Off", v: o },
      ]
    ).filter((d) => d.v > 0);
  }, [rows, cursor]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-[fade-in_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-2xl rounded-t-3xl md:rounded-3xl overflow-hidden max-h-[92vh] flex flex-col animate-[slide-up_0.28s_cubic-bezier(0.22,1,0.36,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 p-5 border-b border-slate-100 shrink-0">
          <Avatar name={agent.name} url={agent.avatar_url} size="md" />
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-900 truncate">{agent.name}</div>
            <div className="text-xs text-slate-400">Schedule</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-black/5 grid place-items-center">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {/* month nav */}
          <div className="flex items-center justify-center gap-4 mb-3">
            <button
              onClick={() => setCursor((c) => subMonths(c, 1))}
              className="w-9 h-9 rounded-full grid place-items-center text-slate-500 hover:text-slate-800 transition-colors"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-lg font-bold tracking-tight">{format(cursor, "MMMM yyyy")}</div>
            <button
              onClick={() => setCursor((c) => addMonths(c, 1))}
              className="w-9 h-9 rounded-full grid place-items-center text-slate-500 hover:text-slate-800 transition-colors"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* legend */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 min-h-[20px] mb-3">
            {!loading &&
              legend.map(({ cat, label, v }) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: categoryStyle(cat).dot }} />
                  <span className="text-xs font-semibold text-slate-500">{label}</span>
                  <span className="text-xs font-bold text-slate-800">{v}</span>
                </div>
              ))}
          </div>

          {/* weekday header */}
          <div className="grid grid-cols-7 gap-1.5 px-0.5 mb-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-[10px] font-bold uppercase tracking-wider text-center text-slate-400">
                {d}
              </div>
            ))}
          </div>

          {/* calendar */}
          {loading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
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
                const cc = s.text;
                return (
                  <div
                    key={d.toISOString()}
                    className={`relative min-h-[56px] md:min-h-[64px] rounded-2xl p-1.5 flex flex-col ${!inMonth ? "opacity-35" : ""}`}
                    style={{
                      background: today
                        ? "linear-gradient(160deg, #61c497, #3d9a70)"
                        : empty
                          ? "rgba(241,245,249,0.5)"
                          : `${s.dot}1f`,
                      boxShadow: today ? "0 8px 20px rgba(82,183,136,0.4)" : "none",
                    }}
                  >
                    <div
                      className="text-[11px] font-bold"
                      style={{ color: today ? "rgba(255,255,255,0.95)" : empty ? "#cbd5e1" : cc }}
                    >
                      {format(d, "d")}
                    </div>
                    {row && (
                      <div className="flex-1 grid place-items-center">
                        <div
                          className="text-[12px] font-extrabold tracking-tight leading-none text-center"
                          style={{ color: today ? "#fff" : cc }}
                        >
                          {cellCode(row.shift_code)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
