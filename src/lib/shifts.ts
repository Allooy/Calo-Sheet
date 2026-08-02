export type ShiftCategory = "morning" | "evening" | "graveyard" | "off" | "other";

export function shiftCategory(code: string | null | undefined): ShiftCategory {
  if (!code) return "off";
  const c = code.trim().toUpperCase();
  if (["S1", "S2", "S3"].includes(c)) return "morning";
  if (["S4", "S5"].includes(c)) return "evening";
  if (["S5.5", "S6"].includes(c)) return "graveyard";
  if (
    ["OFF", "AL", "SL", "DL", "EID OFF", "BIRTHDAY OFF", "PUBLIC HOLIDAY"].includes(c)
  )
    return "off";
  return "other";
}

// Colors resolve through CSS variables (defined per theme in styles.css) rather
// than literal hex, because these land in inline styles — where a dark-mode CSS
// override could never reach them.
export function categoryStyle(cat: ShiftCategory) {
  switch (cat) {
    case "morning":
      return { bg: "var(--sh-morning-bg)", text: "var(--sh-morning-text)", dot: "var(--sh-morning-dot)", soft: "var(--sh-morning-soft)" };
    case "evening":
      return { bg: "var(--sh-evening-bg)", text: "var(--sh-evening-text)", dot: "var(--sh-evening-dot)", soft: "var(--sh-evening-soft)" };
    case "graveyard":
      return { bg: "var(--sh-grave-bg)", text: "var(--sh-grave-text)", dot: "var(--sh-grave-dot)", soft: "var(--sh-grave-soft)" };
    case "off":
      return { bg: "var(--sh-off-bg)", text: "var(--sh-off-text)", dot: "var(--sh-off-dot)", soft: "var(--sh-off-soft)" };
    case "other":
      return { bg: "var(--sh-other-bg)", text: "var(--sh-other-text)", dot: "var(--sh-other-dot)", soft: "var(--sh-other-soft)" };
  }
}

// Per-code styling: the literal OFF code is light red; every other code (AL, SL,
// DL, holidays, shifts…) follows its category color.
const OFF_STYLE = { bg: "var(--sh-offcode-bg)", text: "var(--sh-offcode-text)", dot: "var(--sh-offcode-dot)", soft: "var(--sh-offcode-soft)" };
export function codeStyle(code: string | null | undefined) {
  if ((code ?? "").trim().toUpperCase() === "OFF") return OFF_STYLE;
  return categoryStyle(shiftCategory(code));
}

// Short display alias for long codes (used inside tight table cells so
// "BIRTHDAY OFF" doesn't wrap and blow out the cell height). Case-insensitive.
const SHORT_CODE_MAP: Record<string, string> = {
  "BIRTHDAY OFF": "BDAY",
  "PUBLIC HOLIDAY": "PH",
  "EID OFF": "EID",
};
export function shortCode(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (!raw) return "";
  const up = raw.toUpperCase();
  if (SHORT_CODE_MAP[up]) return SHORT_CODE_MAP[up];
  return raw.length > 4 ? raw.slice(0, 4).toUpperCase() : raw;
}

export const ALL_SHIFT_CODES = [
  "S1", "S2", "S3", "S4", "S5", "S5.5", "S6",
  "OFF", "AL", "SL", "DL", "EID OFF", "Birthday Off", "Public holiday", "Training", "Other",
];

// Default time windows (HH:mm – HH:mm) per code, used when shift_types table doesn't return one
export const DEFAULT_TIMES: Record<string, [string, string]> = {
  S1: ["07:00", "16:00"],
  S2: ["08:00", "17:00"],
  S3: ["10:00", "19:00"],
  S4: ["13:00", "22:00"],
  S5: ["16:00", "01:00"],
  "S5.5": ["20:00", "05:00"],
  S6: ["22:00", "07:00"],
};

export function formatTimeRange(code: string, types?: Record<string, { start_time: string | null; end_time: string | null }>) {
  const fromTable = types?.[code];
  const start = fromTable?.start_time ?? DEFAULT_TIMES[code]?.[0];
  const end = fromTable?.end_time ?? DEFAULT_TIMES[code]?.[1];
  if (!start || !end) return null;
  return `${prettyTime(start)} – ${prettyTime(end)}`;
}

function prettyTime(t: string) {
  // Accept "HH:mm" or "HH:mm:ss"
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

// Hash a name to a stable gradient index
const GRADIENTS: Array<[string, string]> = [
  ["#52B788", "#3d9a70"], // Mint
  ["#4facde", "#2d89c8"], // Ocean
  ["#a78bfa", "#7c3aed"], // Lavender
  ["#fb7185", "#e11d48"], // Coral
  ["#fbbf24", "#d97706"], // Amber
  ["#2dd4bf", "#0d9488"], // Teal
  ["#f472b6", "#db2777"], // Rose
  ["#94a3b8", "#475569"], // Slate
];

export function gradientFor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "?";
}