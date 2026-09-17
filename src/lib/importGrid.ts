import { ALL_SHIFT_CODES } from "./shifts";

export type GridEntry = { agent_name: string; date: string; shift_code: string };

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const pad2 = (n: number) => String(n).padStart(2, "0");

// Rows below the roster (per-day headcounts, the time legend) share column A
// with agent names. Their cells are numbers/times today, but a legend row with
// a code typed into it would otherwise be imported as a person called "S1".
const NON_AGENT_LABELS = new Set(
  [
    ...ALL_SHIFT_CODES,
    "Morning", "Evening", "Graveyard", "Total",
    "Annual Leave", "Sick Leave", "Day Off",
  ].map((s) => s.toLowerCase()),
);

// Parse the monthly schedule GRID (people down the rows, dates across the top,
// title block + time legend ignored) into long-format rows. Returns null if the
// file isn't a grid (so the caller can fall back to the plain long-format parser).
// Blank cells produce no entry: a blank means "not in this sheet", not "clear it".
export function parseScheduleGrid(rows: string[][]): GridEntry[] | null {
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

  const headerRow = rows[headerIdx];
  const cols: { idx: number; day: number }[] = [];
  for (let j = 1; j < headerRow.length; j++) {
    const m = (headerRow[j] || "").trim().match(dayRe);
    if (m) cols.push({ idx: j, day: parseInt(m[1], 10) });
  }
  if (!cols.length) return null;

  // The sheet is labelled with the month it's FOR, but the first week usually
  // starts in the previous month (e.g. "Sunday-27" of an Oct sheet is Sep 27),
  // so leading days before the "1" belong to the prior month and the month
  // rolls forward whenever the day number drops.
  const idx1 = cols.findIndex((c) => c.day === 1);
  let y = pY, mo = pM;
  if (idx1 > 0) { mo -= 1; if (mo < 0) { mo = 11; y--; } }
  const dateByCol = new Map<number, string>();
  for (let k = 0; k < cols.length; k++) {
    if (k > 0 && cols[k].day < cols[k - 1].day) { mo++; if (mo > 11) { mo = 0; y++; } }
    dateByCol.set(cols[k].idx, `${y}-${pad2(mo + 1)}-${pad2(cols[k].day)}`);
  }

  // Canonical code lookup — anything else (times, headcounts, "UK S1") is skipped.
  const codeByUpper = new Map<string, string>();
  for (const c of ALL_SHIFT_CODES) codeByUpper.set(c.toUpperCase(), c);

  const out: GridEntry[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[0] || "").trim();
    if (!name || isHeaderRow(r)) continue; // repeated section headers
    if (NON_AGENT_LABELS.has(name.toLowerCase().replace(/\s+/g, " "))) continue;
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

/* ---------- name resolution ---------- */

export type NameMatch<A> =
  | { kind: "exact"; agent: A }
  | { kind: "fuzzy"; agent: A; reason: string }
  | { kind: "none"; candidates: A[] };

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
// Spelling-insensitive key: drops spaces/punctuation and doubled letters so
// "Hasan Alaradi" ≈ "Hassan Alaradi" and "Al Ansari" ≈ "AlAnsari", without
// touching vowels — "Fatema"/"Fatima" are different people on this roster.
const looseKey = (s: string) =>
  normName(s).replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1");
const firstToken = (s: string) => normName(s).split(" ")[0] ?? "";

// Resolve sheet names to agents. Exact (case/space-insensitive) wins; otherwise
// a fuzzy match is accepted only when it points at exactly ONE agent and no
// other name in the same file already resolves to that agent — the roster has
// several near-twins (Hussain Ali / Hussain A. salman, Reem Ali / Reem AlRaddia),
// so anything ambiguous is left unresolved for the admin rather than guessed.
export function resolveAgentNames<A extends { name: string }>(
  names: string[],
  agents: A[],
): Map<string, NameMatch<A>> {
  const byNorm = new Map<string, A>();
  const byLoose = new Map<string, A[]>();
  const byFirst = new Map<string, A[]>();
  const push = (m: Map<string, A[]>, k: string, a: A) => {
    if (!k) return;
    const l = m.get(k);
    if (l) l.push(a); else m.set(k, [a]);
  };
  for (const a of agents) {
    byNorm.set(normName(a.name), a);
    push(byLoose, looseKey(a.name), a);
    push(byFirst, looseKey(firstToken(a.name)), a);
  }

  const unique = [...new Set(names)];
  const out = new Map<string, NameMatch<A>>();
  const claimed = new Map<A, string[]>();
  const claim = (a: A, n: string) => {
    const l = claimed.get(a);
    if (l) l.push(n); else claimed.set(a, [n]);
  };

  for (const n of unique) {
    const exact = byNorm.get(normName(n));
    if (exact) { out.set(n, { kind: "exact", agent: exact }); claim(exact, n); continue; }

    const loose = byLoose.get(looseKey(n)) ?? [];
    if (loose.length === 1) {
      out.set(n, { kind: "fuzzy", agent: loose[0], reason: "spelling" });
      claim(loose[0], n);
      continue;
    }
    // A bare first name ("Nora") is only trusted when one agent has it.
    const isSingle = !normName(n).includes(" ");
    const byFirstName = isSingle ? byFirst.get(looseKey(n)) ?? [] : [];
    if (loose.length === 0 && byFirstName.length === 1) {
      out.set(n, { kind: "fuzzy", agent: byFirstName[0], reason: "first name" });
      claim(byFirstName[0], n);
      continue;
    }
    out.set(n, { kind: "none", candidates: loose.length ? loose : byFirstName });
  }

  // Two sheet rows landing on one agent means one of them is wrong; demote the
  // fuzzy ones so a guessed row can never overwrite a real person's shifts.
  for (const [a, ns] of claimed) {
    if (ns.length < 2) continue;
    for (const n of ns) {
      if (out.get(n)?.kind === "fuzzy") out.set(n, { kind: "none", candidates: [a] });
    }
  }
  return out;
}
