import Papa from "papaparse";

export type LeaveCode = "AL" | "SL" | "DL" | "Public holiday" | "Birthday Off" | "EID OFF";
export type LeaveEntry = { name: string; date: string; code: LeaveCode };
export type LeaveRun = { name: string; code: LeaveCode; from: string; to: string; days: number };
export type LeaveGrid = {
  entries: LeaveEntry[];
  /** "yyyy-MM" of the month the sheet is for, or null if no header was found. */
  month: string | null;
  /** Non-blank day cells that aren't a known leave marker (raw text, deduped). */
  unknownMarkers: string[];
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
 * Year/month come from a "Oct/2026" token; `opts.year` is the fallback year.
 */
export function parseLeaveGrid(csvText: string, opts: { year?: number } = {}): LeaveGrid {
  const rows = (Papa.parse<string[]>(csvText, { skipEmptyLines: false }).data as unknown) as string[][];
  const empty: LeaveGrid = { entries: [], month: null, unknownMarkers: [] };

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
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    // Names can carry trailing spaces or an embedded newline ("Hussain Ali\n").
    const name = (r[0] || "").replace(/[" ]/g, " ").replace(/\s+/g, " ").trim();
    if (!name || !/[A-Za-z؀-ۿ]/.test(name) || isLabel(name)) continue;
    if (headerCols(r)) continue; // repeated header

    const cells = cols.map((c) => ({ c, v: (r[c.idx] || "").trim() })).filter((x) => x.v);
    if (!cells.length) continue;
    if (cells.every((x) => /^\d+(\.\d+)?$/.test(x.v))) continue; // a count row

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

  return { entries, month: `${pY}-${pad2(pM + 1)}`, unknownMarkers: [...unknown] };
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
