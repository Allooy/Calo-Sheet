import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "./GlassCard";
import { supabase, type ShiftRequest } from "@/lib/supabase";

const STATUS: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: "#e0e7ff", text: "#4338ca", label: "Pending" },
  resolved: { bg: "#d6f2e4", text: "#1e5a3d", label: "Approved" },
  dismissed: { bg: "#fee2e2", text: "#b91c1c", label: "Declined" },
};

export function AgentRequests({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<ShiftRequest[]>([]);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancel = false;
    supabase
      .from("requests")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancel) setRows((data as ShiftRequest[] | null) ?? []);
      });
    return () => { cancel = true; };
  }, [agentId]);

  async function send() {
    const text = msg.trim();
    if (!text) return;
    setSending(true);
    const { data, error } = await supabase
      .from("requests")
      .insert({ agent_id: agentId, message: text })
      .select()
      .single();
    setSending(false);
    if (error) return toast.error(error.message);
    setMsg("");
    if (data) setRows((r) => [data as ShiftRequest, ...r]);
    toast.success("Request sent to your admin");
  }

  async function withdraw(id: string) {
    const { error } = await supabase.from("requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  return (
    <section>
      <div className="label-caps text-slate-400 mb-3 px-1">Requests</div>
      <GlassCard className="p-4">
        <div className="flex flex-col gap-2">
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={2}
            placeholder="e.g. Can I please get S4 next week? I'm traveling."
            className="w-full rounded-xl bg-white/70 border border-slate-200 px-3 py-2.5 text-sm outline-none resize-none transition-all focus:border-[#52B788] focus:ring-4 focus:ring-[#52B788]/15"
          />
          <div className="flex justify-end">
            <button
              onClick={send}
              disabled={sending || !msg.trim()}
              className="rounded-xl bg-[#52B788] text-white px-4 py-2 text-sm font-semibold flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <Send size={15} /> {sending ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {rows.map((r) => {
              const s = STATUS[r.status] ?? STATUS.open;
              return (
                <div key={r.id} className="rounded-xl border border-slate-100 p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{r.message}</div>
                    {r.admin_note && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        <span className="font-semibold">Admin:</span> {r.admin_note}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-1">
                      {format(new Date(r.created_at), "MMM d, HH:mm")}
                    </div>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                    style={{ background: s.bg, color: s.text }}
                  >
                    {s.label}
                  </span>
                  {r.status === "open" && (
                    <button
                      onClick={() => withdraw(r.id)}
                      title="Withdraw request"
                      className="shrink-0 text-slate-300 hover:text-red-500 transition-colors mt-0.5"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </section>
  );
}
