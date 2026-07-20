import { useState, type FormEvent } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Product-relevant floating decoration: shift codes + category pills drifting
// behind the card. `mobile` ones are placed top/bottom so they frame the card
// without crowding it on small screens.
// Scattered organic placement (kept clear of the centered card), staggered
// heights + varied sizes/depths so it never reads as neat rows.
// Scattered organic placement. `mobile` ones are the 4 corner badges (airy);
// the rest fill in on larger screens where there's room.
// Scattered organic placement. `mobile` ones (5 — 3 sharp + 2 blurred for
// depth) stay clear of the centered card; the rest fill in on larger screens.
const FLOATERS = [
  { c: "S2",  bg: "#d6f2e4", t: "#1e5a3d", top: "5%",  left: "9%",  size: "text-sm",  anim: "float-a", dur: "15s", delay: "0s",   op: 0.9,  blur: 0,   mobile: true },
  { c: "S4",  bg: "#fff3e0", t: "#b45309", top: "8%",  left: "70%", size: "text-sm",  anim: "float-b", dur: "18s", delay: "1.2s", op: 0.85, blur: 0,   mobile: true },
  { c: "S6",  bg: "#e0e7ff", t: "#4338ca", top: "14%", left: "22%", size: "text-xs",  anim: "float-c", dur: "21s", delay: "0.7s", op: 0.5,  blur: 2,   mobile: true },
  { c: "OFF", bg: "#fee2e2", t: "#b91c1c", top: "86%", left: "11%", size: "text-sm",  anim: "float-b", dur: "17s", delay: "2s",   op: 0.85, blur: 0,   mobile: true },
  { c: "S3",  bg: "#d6f2e4", t: "#1e5a3d", top: "90%", left: "74%", size: "text-xs",  anim: "float-a", dur: "20s", delay: "0.9s", op: 0.55, blur: 1.5, mobile: true },
  { c: "S1",  bg: "#d6f2e4", t: "#1e5a3d", top: "24%", left: "87%", size: "text-xs",  anim: "float-a", dur: "23s", delay: "1.6s", op: 0.55, blur: 1.5 },
  { c: "S5",  bg: "#fff3e0", t: "#b45309", top: "92%", left: "40%", size: "text-xs",  anim: "float-c", dur: "16s", delay: "0.3s", op: 0.5,  blur: 2   },
  { c: "S6",  bg: "#e0e7ff", t: "#4338ca", top: "62%", left: "92%", size: "text-xs",  anim: "float-b", dur: "24s", delay: "1.3s", op: 0.45, blur: 2   },
];

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div
      className="min-h-screen w-full relative overflow-hidden grid place-items-center p-5"
      style={{ background: "linear-gradient(150deg, #123828 0%, #1a4a30 48%, #0c2417 100%)" }}
    >
      {/* aurora wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(55% 55% at 18% 18%, rgba(82,183,136,0.4), transparent 60%), radial-gradient(45% 45% at 85% 25%, rgba(114,201,160,0.28), transparent 60%), radial-gradient(60% 60% at 65% 92%, rgba(174,227,202,0.2), transparent 60%)",
          backgroundSize: "200% 200%",
          animation: "aurora-pan 18s ease-in-out infinite",
        }}
      />
      {/* big drifting orbs */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-35" style={{ background: "#52B788", animation: "float-a 18s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute top-1/3 -right-28 w-80 h-80 rounded-full blur-3xl opacity-25" style={{ background: "#72c9a0", animation: "float-b 22s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-20" style={{ background: "#aee3ca", animation: "float-c 24s ease-in-out infinite" }} />

      {/* grid texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(75% 65% at 50% 45%, #000 25%, transparent 100%)",
        }}
      />

      {/* floating shift badges */}
      {FLOATERS.map((f, i) => (
        <span
          key={i}
          className={`pointer-events-none absolute rounded-full px-3 py-1.5 ${f.size} font-extrabold uppercase tracking-wide shadow-lg select-none ${
            f.mobile ? "block" : "hidden sm:block"
          }`}
          style={{
            top: f.top,
            left: f.left,
            background: f.bg,
            color: f.t,
            opacity: f.op,
            filter: f.blur ? `blur(${f.blur}px)` : undefined,
            animation: `${f.anim} ${f.dur} ease-in-out ${f.delay} infinite`,
          }}
        >
          {f.c}
        </span>
      ))}

      {/* ── Center content ── */}
      <div className="relative z-10 w-full max-w-sm">
        {/* logo + heading */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="relative mb-5 animate-[scale-in_0.5s_cubic-bezier(0.22,1,0.36,1)]">
            <div className="absolute inset-0 rounded-3xl blur-2xl opacity-70" style={{ background: "#52B788", animation: "float-c 6s ease-in-out infinite" }} />
            <img
              src="/favicon.png"
              alt="Calo"
              className="relative w-[68px] h-[68px] rounded-3xl shadow-2xl shadow-black/40 ring-1 ring-white/20"
            />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white animate-[slide-up_0.5s_ease-out_0.05s_both]">
            Welcome back
          </h1>
          <p className="mt-1.5 text-sm text-white/55 animate-[slide-up_0.5s_ease-out_0.12s_both]">
            Sign in to your CX Workforce account
          </p>
        </div>

        {/* glass card form */}
        <form
          onSubmit={submit}
          className={`relative rounded-3xl p-6 sm:p-7 overflow-hidden animate-[slide-up_0.55s_cubic-bezier(0.22,1,0.36,1)_0.18s_both] ${
            shake ? "animate-[shake_0.4s_ease-in-out]" : ""
          }`}
          style={{
            background: "rgba(15, 38, 27, 0.55)",
            backdropFilter: "blur(30px) saturate(160%)",
            WebkitBackdropFilter: "blur(30px) saturate(160%)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 30px 70px -25px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.12)",
          }}
        >
          {/* email */}
          <label className="block">
            <span className="label-caps text-white/45">Email</span>
            <div className="mt-1.5 relative group">
              <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-[#72c9a0]" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl pl-11 pr-4 py-3.5 text-[15px] text-white placeholder-white/35 outline-none transition-all bg-white/[0.06] border border-white/15 focus:border-[#72c9a0] focus:bg-white/[0.1] focus:ring-4 focus:ring-[#52B788]/20"
                placeholder="you@calo.app"
              />
            </div>
          </label>

          {/* password */}
          <label className="block mt-4">
            <span className="label-caps text-white/45">Password</span>
            <div className="mt-1.5 relative group">
              <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-[#72c9a0]" />
              <input
                type={show ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl pl-11 pr-11 py-3.5 text-[15px] text-white placeholder-white/35 outline-none transition-all bg-white/[0.06] border border-white/15 focus:border-[#72c9a0] focus:bg-white/[0.1] focus:ring-4 focus:ring-[#52B788]/20"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition-colors"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          {/* error */}
          {error && (
            <div className="mt-3 text-xs font-medium text-red-200 bg-red-500/20 border border-red-400/30 rounded-lg px-3 py-2 animate-[fade-in_0.2s_ease-out]">
              {error}
            </div>
          )}

          {/* submit */}
          <button
            type="submit"
            disabled={loading}
            className="group relative mt-6 w-full overflow-hidden rounded-xl py-3.5 font-semibold text-[#0c2417] transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] disabled:opacity-70 disabled:hover:translate-y-0"
            style={{
              background: "linear-gradient(135deg, #aee3ca 0%, #72c9a0 45%, #52B788 100%)",
              boxShadow: "0 14px 34px -10px rgba(82,183,136,0.8)",
            }}
          >
            <span
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg] opacity-0 group-hover:opacity-100"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", animation: "sheen 1.4s ease-in-out infinite" }}
            />
            <span className="relative flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </span>
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-white/35 animate-[fade-in_0.6s_ease-out_0.4s_both]">
          Calo · Healthy meals, perfectly scheduled
        </p>
      </div>
    </div>
  );
}
