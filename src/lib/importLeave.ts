import Papa from "papaparse";
import { resolveAgentNames, type NameMatch } from "./importGrid";

export type LeaveCode = "AL" | "SL" | "DL" | "Public holiday" | "Birthday Off" | "EID OFF";
export type LeaveEntry = { name: string; date: string; code: LeaveCode };
export type LeaveRun = { name: string; code: LeaveCode; from: string; to: string; days: number };
export type LeaveGrid = {
  entries: LeaveEntry[];
  /** "yyyy-MM" of the month the sheet is for, or null if no header was found. */
  month: string | null;
  /** Non-blank day cells that aren't a known leave marker (raw text, deduped). */
  unknownMarkers: string[];
  /** Every person row, with or without leave — the sheet is the full picture for them. */
  names: string[];
  /** First and last date the header covers (yyyy-MM-dd), or null. */
  from: string | null;
  to: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const monthOf = (s: string | undefined) =>
  s ? MONTHS[s.slice(0, 3).toLowerCase()] : undefined;

// Cell marker -> app leave code. Keys are upper-cased with dots/dashes/spaces
// removed, so "a", "A", "A.L", "Sick leave", "B-Day" and "P.H" all land here.
const MARKERS: Record<string, LeaveCode> = {
  A: "AL", AL: "AL", ANNUAL: "AL", ANNUALLEAVE: "AL", LEAVE: "AL",
  SL: "SL", SICK: "SL", SICKLEAVE: "SL",
  DL: "DL",
  PH: "Public holiday", HOLIDAY: "Public holiday", PUBLICHOLIDAY: "Public holiday",
  BDAY: "Birthday Off", BIRTHDAY: "Birthday Off", BIRTHDAYOFF: "Birthday Off", BD: "Birthday Off",
  EID: "EID OFF", EIDOFF: "EID OFF", EIDHOLIDAY: "EID OFF",
};
const markerKey = (s: string) => s.toUpperCase().replace(/[\s.\-_]+/g, "");

// "1/Oct", "1-Oct", "1 Oct", "Oct 1" or a bare "1".
const dayCellRe = /^(?:(\d{1,2})(?:\s*[/\-\s.]\s*([A-Za-z]{3,9}))?|([A-Za-z]{3,9})\s*[/\-\s.]?\s*(\d{1,2}))$/;
const monthYearRe = /([A-Za-z]{3,9})\s*[/\-\s]\s*(\d{4})/;

type DayCol = { idx: number; day: number; mon?: number };

function headerCols(r: string[]): DayCol[] | null {
  const cols: DayCol[] = [];
  for (let j = 1; j < r.length; j++) {
    const m = (r[j] || "").trim().match(dayCellRe);
    if (!m) continue;
    const day = parseInt(m[1] ?? m[4], 10);
    const monTok = m[2] ?? m[3];
    const mon = monthOf(monTok);
    if (day < 1 || day > 31 || (monTok && mon === undefined)) continue;
    cols.push({ idx: j, day, mon });
  }
  if (cols.length < 5) return null;
  // A headcount row ("Total Agents,3,3,2,...") also looks like numbers; a real
  // header never repeats a day back to back and wraps at most once.
  let drops = 0;
  for (let k = 1; k < cols.length; k++) {
    if (cols[k].day === cols[k - 1].day && cols[k].mon === cols[k - 1].mon) return null;
    if (cols[k].day < cols[k - 1].day) drops++;
  }
  return drops <= 1 ? cols : null;
}

// Column-A text that is never a person: totals, the title, legends.
const isLabel = (name: string) => {
  const n = name.toLowerCase();
  return (
    MARKERS[markerKey(name)] !== undefined ||
    /^(total|agents?\b|legend|key\b|shift leads?$|count\b|annual leave|sick leave|day off)/.test(n) ||
    monthYearRe.test(name)
  );
};

/**
 * Parse the team's annual-leave sheet (people down column A, one column per day,
 * a marker such as "a"/"A" on leave days). Blank cells produce nothing. Rows
 * above the day header, blank rows, totals and legend rows are skipped.
 * Year/month come from a "Oct/2026" token (else the header's month names);
 * `opts.year` / `opts.month` (1-12) are fallbacks when the sheet doesn't say.
 */
export function parseLeaveGrid(csvText: string, opts: { year?: number; month?: number } = {}): LeaveGrid {
  const rows = (Papa.parse<string[]>(csvText, { skipEmptyLines: false }).data as unknown) as string[][];
  const empty: LeaveGrid = { entries: [], month: null, unknownMarkers: [], names: [], from: null, to: null };

  let headerIdx = -1;
  let cols: DayCol[] | null = null;
  for (let i = 0; i < rows.length && !cols; i++) {
    cols = headerCols(rows[i] ?? []);
    if (cols) headerIdx = i;
  }
  if (!cols) return empty;

  // Month + year: the first "Mon/yyyy" token in the file (the month row).
  let pM: number | undefined, pY: number | undefined;
  outer: for (const r of rows) {
    for (const c of r ?? []) {
      const m = (c || "").trim().match(monthYearRe);
      const mi = m ? monthOf(m[1]) : undefined;
      if (m && mi !== undefined) { pM = mi; pY = parseInt(m[2], 10); break outer; }
    }
  }
  const headerMonths = cols.map((c) => c.mon).filter((m): m is number => m !== undefined);
  if (pM === undefined) {
    // Most common month in the header, e.g. all "x/Oct".
    const freq = new Map<number, number>();
    for (const m of headerMonths) freq.set(m, (freq.get(m) ?? 0) + 1);
    pM = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (pM === undefined && opts.month && opts.month >= 1 && opts.month <= 12) pM = opts.month - 1;
  if (pY === undefined) pY = opts.year ?? new Date().getFullYear();
  if (pM === undefined) return empty;

  // Date per column. With month names in the header, trust them (bumping the
  // year when they wrap Dec -> Jan); with bare numbers, days before the "1"
  // belong to the previous month and the month rolls on each drop.
  const dateByCol = new Map<number, string>();
  let y = pY, mo: number;
  const first = cols[0];
  if (first.mon !== undefined) {
    mo = first.mon;
    if (mo - pM > 6) y--; // "28/Dec" on a Jan sheet
    else if (pM - mo > 6) y++; // "1/Jan" on a Dec sheet
  } else {
    mo = pM;
    if (cols.findIndex((c) => c.day === 1) > 0) { mo--; if (mo < 0) { mo = 11; y--; } }
  }
  for (let k = 0; k < cols.length; k++) {
    const c = cols[k];
    if (k > 0) {
      const prev = cols[k - 1];
      const next = c.mon ?? (c.day < prev.day ? (mo + 1) % 12 : mo);
      if (next !== mo) { if (next < mo) y++; mo = next; }
    }
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    if (c.day <= dim) dateByCol.set(c.idx, `${y}-${pad2(mo + 1)}-${pad2(c.day)}`);
  }

  const entries: LeaveEntry[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const names: string[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    // Names can carry trailing spaces or an embedded newline ("Hussain Ali\n").
    const name = (r[0] || "").replace(/["\u00a0]/g, " ").replace(/\s+/g, " ").trim();
    if (!name || !/[A-Za-z\u0600-\u06FF]/.test(name) || isLabel(name)) continue;
    if (headerCols(r)) continue; // repeated header

    const cells = cols.map((c) => ({ c, v: (r[c.idx] || "").trim() })).filter((x) => x.v);
    if (cells.length && cells.every((x) => /^\d+(\.\d+)?$/.test(x.v))) continue; // a count row
    if (!names.includes(name)) names.push(name);

    for (const { c, v } of cells) {
      const code = MARKERS[markerKey(v)];
      const date = dateByCol.get(c.idx);
      if (!code) { unknown.add(v); continue; }
      if (!date) continue;
      const key = `${name.toLowerCase()}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, date, code });
    }
  }

  const span = [...dateByCol.values()].sort();
  return {
    entries,
    month: `${pY}-${pad2(pM + 1)}`,
    unknownMarkers: [...unknown],
    names,
    from: span[0] ?? null,
    to: span[span.length - 1] ?? null,
  };
}

// Collapse per-day entries into consecutive runs (same person + code) for previews.
export function groupLeaveRuns(entries: LeaveEntry[]): LeaveRun[] {
  const sorted = [...entries].sort(
    (a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date),
  );
  const nextDay = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };
  const runs: LeaveRun[] = [];
  for (const e of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.name === e.name && last.code === e.code && nextDay(last.to) === e.date) {
      last.to = e.date;
      last.days++;
    } else {
      runs.push({ name: e.name, code: e.code, from: e.date, to: e.date, days: 1 });
    }
  }
  return runs;
}

/* ---------- name resolution for the leave sheet ---------- */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const looseTok = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1");
const toks = (s: string) => norm(s).split(" ").map(looseTok).filter(Boolean);

/** Remembered sheet-name -> agent id picks. "" means "skip this row" (e.g. left the company). */
export type NameAliases = Record<string, string>;
export const aliasKey = norm;

export type LeaveMatch<A> = NameMatch<A> | { kind: "alias"; agent: A } | { kind: "skip" };

/**
 * The leave sheet uses fuller names than the app ("Nora Alahaimer" for "Nora",
 * "Hassan Jassim Alaradi" for "Hasan Alaradi"). On top of the schedule
 * matcher this accepts, when exactly one agent fits:
 *  - every word of the agent's name appears in the sheet name (middle names);
 *  - one name is the other plus a letter ("Abdulla" / "Abdullah").
 * Saved picks win over everything. Several rows may land on one agent here —
 * the admin said duplicate rows are the same person — and their leave merges.
 */
export function resolveLeaveNames<A extends { id: string; name: string }>(
  names: string[],
  agents: A[],
  aliases: NameAliases = {},
): Map<string, LeaveMatch<A>> {
  const base = resolveAgentNames(names, agents);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out = new Map<string, LeaveMatch<A>>();
  for (const n of names) {
    const saved = aliases[aliasKey(n)];
    if (saved === "") { out.set(n, { kind: "skip" }); continue; }
    if (saved && byId.has(saved)) { out.set(n, { kind: "alias", agent: byId.get(saved)! }); continue; }

    const m = base.get(n)!;
    if (m.kind !== "none") { out.set(n, m); continue; }
    // A demoted duplicate still has its one candidate; accept it.
    if (m.candidates.length === 1) {
      out.set(n, { kind: "fuzzy", agent: m.candidates[0], reason: "duplicate row" });
      continue;
    }
    const st = toks(n);
    const sub = agents.filter((a) => {
      const at = toks(a.name);
      return at.length > 0 && at.length < st.length && at.every((t) => st.includes(t)) && at[0] === st[0];
    });
    if (sub.length === 1) {
      out.set(n, { kind: "fuzzy", agent: sub[0], reason: "fuller name in sheet" });
      continue;
    }
    const k = st.join("");
    const near = agents.filter((a) => {
      const ak = toks(a.name).join("");
      const [short, long] = ak.length < k.length ? [ak, k] : [k, ak];
      return short.length >= 6 && long.length - short.length === 1 && long.startsWith(short);
    });
    if (near.length === 1) {
      out.set(n, { kind: "fuzzy", agent: near[0], reason: "one letter apart" });
      continue;
    }
    out.set(n, m);
  }
  return out;
}
