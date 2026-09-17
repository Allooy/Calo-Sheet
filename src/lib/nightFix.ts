// Night-cover fixer: looks at an existing schedule and suggests the smallest set
// of edits so every day in [from, to] has 2–3 people on graveyard (S6).
//
// Pure and deterministic. Edits are whole work-blocks where possible (a whole
// M/E block → S6, or a whole S6 block → S1); only when no whole-block answer
// is cheap enough does it change a prefix/suffix of a block (partial, which
// counts as two edits when comparing answers).
// Ties are broken by a soft-rule penalty (mixed blocks, back-to-back nights,
// nights → evenings, >2 night blocks a month, needless 3s).

export type NightFixEdit = {
  agentId: string;
  from: string; // yyyy-MM-dd inclusive
  to: string;
  code: string; // every day in from..to becomes this code
  before: string[]; // previous code per day ("" = blank)
  partial: boolean; // only part of a work block was changed
  reason: string;
};

export type NightFixResult = {
  badDays: Array<{ date: string; count: number }>; // before fixing
  edits: NightFixEdit[];
  after: Array<{ date: string; count: number }>; // every day in [from, to], after edits
  unresolved: string[]; // dates still outside 2–3
  notes: string[]; // soft rules the suggestion breaks
};

export type NightFixInput = {
  cells: Array<{ agent_id: string; date: string; shift_code: string }>;
  agents: Array<{ id: string; name: string }>;
  gyPool: string[];
  fixed?: Record<string, string>;
  from: string;
  to: string;
};

const MIN_G = 2;
const MAX_G = 3;
const MAX_EDITS = 4;
const MAX_PARTIAL = 2; // partial edits allowed in one cluster's answer
// Search cost: a whole-block edit costs 1, a partial one 2, so one partial edit
// beats a chain of three or four whole-block swaps but never a single clean one.
const PARTIAL_COST = 2;
const MAX_COST = MAX_EDITS + MAX_PARTIAL;
const WINDOW = 6; // days either side of a bad day to look for blocks
const CLUSTER_GAP = 7; // bad days this close are solved together
const NODE_BUDGET = 150_000; // per cluster; keeps worst cases bounded (deterministic)

const W_PARTIAL = 5;
const W_MIXED = 4;
const W_NIGHT_TO_DAY_INSIDE = 6;
const W_BACK_TO_BACK = 5;
const W_NIGHT_TO_EVENING = 3;
const W_TOO_MANY_BLOCKS = 4;
const W_THREE = 1;
const W_CHANGED_DAY = 0.1;

type Band = "M" | "E" | "G" | "X" | "O"; // X = not work, O = other work (Training…)

const NOT_WORK = new Set(["", "OFF", "AL", "SL", "DL", "PUBLIC HOLIDAY", "BIRTHDAY OFF", "EID OFF"]);

function band(code: string): Band {
  const c = code.trim().toUpperCase();
  if (c === "S1" || c === "S2" || c === "S3") return "M";
  if (c === "S4" || c === "S5" || c === "S5.5") return "E";
  if (c === "S6") return "G";
  if (NOT_WORK.has(c)) return "X";
  return "O";
}
const isG = (code: string) => code.trim().toUpperCase() === "S6";
const viol = (c: number) => (c < MIN_G ? MIN_G - c : c > MAX_G ? c - MAX_G : 0);

/* ---------- dates (UTC, yyyy-MM-dd) ---------- */

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: string) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`;
function fmtRange(a: string, b: string) {
  if (a === b) return fmtDay(a);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${+a.slice(8, 10)}–${fmtDay(b)}`;
  return `${fmtDay(a)}–${fmtDay(b)}`;
}
function fmtDays(ds: string[]) {
  if (!ds.length) return "";
  // collapse consecutive runs: "14–15 Oct, 18 Oct"
  const out: string[] = [];
  let s = ds[0], p = ds[0];
  for (let i = 1; i <= ds.length; i++) {
    const d = ds[i];
    if (d && toMs(d) - toMs(p) === DAY_MS) { p = d; continue; }
    out.push(fmtRange(s, p));
    if (d) { s = d; p = d; }
  }
  return out.join(", ");
}

type Block = { idx: number; ai: number; s: number; e: number };
type Op = {
  id: number;
  ai: number;
  block: number;
  s: number;
  e: number;
  code: string;
  partial: boolean;
  changes: Array<[number, number]>; // [dayIdx, ±1 on the S6 count]
  changedDays: number;
};

export function suggestNightFixes(input: NightFixInput): NightFixResult {
  const { cells, agents, from, to } = input;
  const fixed = input.fixed ?? {};
  const pool = new Set(input.gyPool);
  const empty: NightFixResult = { badDays: [], edits: [], after: [], unresolved: [], notes: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return empty;

  /* ---------- grid ---------- */
  let lo = from, hi = to;
  for (const c of cells) {
    if (c.date < lo) lo = c.date;
    if (c.date > hi) hi = c.date;
  }
  const dates: string[] = [];
  for (let ms = toMs(lo); ms <= toMs(hi); ms += DAY_MS) dates.push(fromMs(ms));
  const dayIdx = new Map(dates.map((d, i) => [d, i]));
  const N = dates.length;
  const fromIdx = dayIdx.get(from)!;
  const toIdx = dayIdx.get(to)!;

  const ids = agents.map((a) => a.id);
  const known = new Set(ids);
  const extra = [...new Set(cells.map((c) => c.agent_id))].filter((id) => !known.has(id)).sort();
  ids.push(...extra);
  const agentIdx = new Map(ids.map((id, i) => [id, i]));
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const nameOf = (ai: number) => nameById.get(ids[ai]) ?? ids[ai];

  const grid: string[][] = ids.map(() => new Array<string>(N).fill(""));
  for (const c of cells) {
    const di = dayIdx.get(c.date);
    const ai = agentIdx.get(c.agent_id);
    if (di !== undefined && ai !== undefined) grid[ai][di] = (c.shift_code ?? "").trim();
  }

  const counts = new Array<number>(N).fill(0);
  for (const row of grid) for (let d = 0; d < N; d++) if (isG(row[d])) counts[d]++;

  const listCounts = () => {
    const out: Array<{ date: string; count: number }> = [];
    for (let d = fromIdx; d <= toIdx; d++) out.push({ date: dates[d], count: counts[d] });
    return out;
  };
  const badNow = () => {
    const out: number[] = [];
    for (let d = fromIdx; d <= toIdx; d++) if (viol(counts[d])) out.push(d);
    return out;
  };

  const initialBad = badNow();
  const initialCounts = counts.slice();
  const badDays = initialBad.map((d) => ({ date: dates[d], count: counts[d] }));
  if (!initialBad.length) return { ...empty, after: listCounts() };

  /* ---------- blocks (static: edits never turn work into rest) ---------- */
  const blocks: Block[] = [];
  const blocksOf: Block[][] = ids.map(() => []);
  for (let ai = 0; ai < ids.length; ai++) {
    let d = 0;
    while (d < N) {
      if (band(grid[ai][d]) === "X") { d++; continue; }
      const s = d;
      while (d < N && band(grid[ai][d]) !== "X") d++;
      const b = { idx: blocks.length, ai, s, e: d - 1 };
      blocks.push(b);
      blocksOf[ai].push(b);
    }
  }

  /* ---------- soft rules ---------- */
  type Soft = { text: string; w: number };
  const softOf = (ai: number): Soft[] => {
    const out: Soft[] = [];
    const nm = nameOf(ai);
    const bl = blocksOf[ai];
    const row = grid[ai];
    let nightBlocks = 0;
    for (let k = 0; k < bl.length; k++) {
      const b = bl[k];
      const inRange = b.e >= fromIdx && b.s <= toIdx;
      const bands = new Set<Band>();
      let hasG = false;
      for (let d = b.s; d <= b.e; d++) {
        const x = band(row[d]);
        if (x !== "O") bands.add(x);
        if (x === "G") hasG = true;
      }
      if (hasG && inRange) nightBlocks++;
      if (b.e < fromIdx) continue; // history-only block: not ours to judge
      const span = fmtRange(dates[b.s], dates[b.e]);
      if (bands.size > 1) {
        const names = [...bands].map((x) => (x === "M" ? "mornings" : x === "E" ? "evenings" : "nights"));
        out.push({ text: `${nm}: ${span} mixes ${names.join(" and ")} in one block`, w: W_MIXED });
      }
      for (let d = b.s; d < b.e; d++) {
        const x = band(row[d]), y = band(row[d + 1]);
        if (x === "G" && (y === "M" || y === "E")) {
          out.push({
            text: `${nm}: goes straight from a night on ${fmtDay(dates[d])} to a day shift on ${fmtDay(dates[d + 1])}`,
            w: W_NIGHT_TO_DAY_INSIDE,
          });
        }
      }
      const prev = bl[k - 1];
      if (!prev || b.s - prev.e > CLUSTER_GAP + 1) continue;
      let prevG = false;
      for (let d = prev.s; d <= prev.e; d++) if (band(row[d]) === "G") prevG = true;
      const pSpan = fmtRange(dates[prev.s], dates[prev.e]);
      if (prevG && hasG) {
        out.push({ text: `${nm}: night blocks back to back (${pSpan}, then ${span})`, w: W_BACK_TO_BACK });
      }
      if (band(row[prev.e]) === "G" && band(row[b.s]) === "E") {
        out.push({ text: `${nm}: goes from nights (${pSpan}) straight to evenings (${span}) instead of mornings`, w: W_NIGHT_TO_EVENING });
      }
    }
    if (nightBlocks > 2) {
      out.push({ text: `${nm}: ${nightBlocks} night blocks this month (max 2)`, w: W_TOO_MANY_BLOCKS * (nightBlocks - 2) });
    }
    return out;
  };
  const softSum = (s: Soft[]) => s.reduce((a, x) => a + x.w, 0);
  const originalSoft = ids.map((_, ai) => softOf(ai));

  /* ---------- clusters, solved one after another ---------- */
  const edits: Array<{ op: Op; before: string[]; helped: string[] }> = [];
  const attempted = new Set<number>();

  for (;;) {
    const bad = badNow().filter((d) => !attempted.has(d));
    if (!bad.length) break;
    const cluster = [bad[0]];
    for (let i = 1; i < bad.length && bad[i] - cluster[cluster.length - 1] <= CLUSTER_GAP; i++) cluster.push(bad[i]);
    for (const d of cluster) attempted.add(d);

    // Days the answer must leave OK: this cluster + every day that's OK now.
    const target = new Array<boolean>(N).fill(false);
    const others = new Set(badNow().filter((d) => !cluster.includes(d)));
    for (let d = fromIdx; d <= toIdx; d++) target[d] = !others.has(d);

    const ops = buildOps(cluster[0] - WINDOW, cluster[cluster.length - 1] + WINDOW);
    const opsByDay = new Map<number, Op[]>();
    for (const op of ops) {
      for (const [d] of op.changes) {
        const l = opsByDay.get(d);
        if (l) l.push(op); else opsByDay.set(d, [op]);
      }
    }

    const baseSoft = ids.map((_, ai) => softSum(softOf(ai)));
    const baseThrees = countThrees();
    const scoreNow = () => {
      let s = 0;
      for (let d = fromIdx; d <= toIdx; d++) if (target[d]) s += viol(counts[d]);
      return s;
    };
    const startScore = scoreNow();

    let nodes = 0;
    let best: { ops: Op[]; pen: number } | null = null;
    let fallback: { ops: Op[]; score: number; pen: number } | null = null;
    const chosen: Op[] = [];
    const usedBlocks = new Set<number>();
    let visited = new Set<string>();

    const penalty = () => {
      let p = 0;
      const touched = new Set<number>();
      for (const op of chosen) {
        touched.add(op.ai);
        p += (op.partial ? W_PARTIAL : 0) + op.changedDays * W_CHANGED_DAY;
      }
      for (const ai of touched) p += softSum(softOf(ai)) - baseSoft[ai];
      p += (countThrees() - baseThrees) * W_THREE;
      return p;
    };

    const dfs = (maxCost: number, cost: number, partials: number) => {
      if (nodes >= NODE_BUDGET) return;
      nodes++;
      if (chosen.length) {
        const key = chosen.map((o) => o.id).sort((a, b) => a - b).join(",");
        if (visited.has(key)) return;
        visited.add(key);
      }
      let first = -1, maxV = 0, score = 0;
      for (let d = fromIdx; d <= toIdx; d++) {
        if (!target[d]) continue;
        const v = viol(counts[d]);
        if (!v) continue;
        if (first < 0) first = d;
        if (v > maxV) maxV = v;
        score += v;
      }
      if (first < 0) {
        const pen = penalty();
        if (!best || pen < best.pen - 1e-9) best = { ops: chosen.slice(), pen };
        return;
      }
      if (chosen.length && score < startScore) {
        const better =
          !fallback ||
          score < fallback.score ||
          (score === fallback.score && chosen.length < fallback.ops.length);
        const tie = fallback && score === fallback.score && chosen.length === fallback.ops.length;
        if (better || tie) {
          const pen = penalty();
          if (better || pen < fallback!.pen - 1e-9) fallback = { ops: chosen.slice(), score, pen };
        }
      }
      const left = maxCost - cost;
      if (left <= 0 || maxV > left || chosen.length >= MAX_EDITS) return;
      const need = counts[first] < MIN_G ? 1 : -1;
      for (const op of opsByDay.get(first) ?? []) {
        if (usedBlocks.has(op.block)) continue;
        const c = op.partial ? PARTIAL_COST : 1;
        if (c > left || (op.partial && partials >= MAX_PARTIAL)) continue;
        if (!op.changes.some(([d, delta]) => d === first && delta === need)) continue;
        const saved = apply(op);
        chosen.push(op);
        usedBlocks.add(op.block);
        dfs(maxCost, cost + c, partials + (op.partial ? 1 : 0));
        usedBlocks.delete(op.block);
        chosen.pop();
        undo(op, saved);
      }
    };

    // Iterative deepening on cost; within one cost level the penalty decides.
    for (let maxCost = 1; maxCost <= MAX_COST && !best; maxCost++) {
      visited = new Set();
      dfs(maxCost, 0, 0);
    }

    const pick: Op[] | null = best ? (best as { ops: Op[] }).ops : fallback ? (fallback as { ops: Op[] }).ops : null;
    if (!pick) continue;
    const beforeCounts = counts.slice();
    for (const op of pick) {
      const before = grid[op.ai].slice(op.s, op.e + 1);
      apply(op);
      const helped: string[] = [];
      for (const [d, delta] of op.changes) {
        if (d < fromIdx || d > toIdx) continue;
        const c = beforeCounts[d];
        if ((delta > 0 && c < MIN_G) || (delta < 0 && c > MAX_G)) helped.push(dates[d]);
      }
      edits.push({ op, before, helped });
    }
  }

  /* ---------- result ---------- */
  const outEdits: NightFixEdit[] = edits
    .map(({ op, before, helped }) => {
      const adding = isG(op.code);
      const nm = nameOf(op.ai);
      const span = fmtRange(dates[op.s], dates[op.e]);
      const oldCodes = [...new Set(before.filter((c) => c !== op.code))].join("/");
      let reason = `${nm}: ${span} ${oldCodes} → ${op.code}`;
      if (helped.length) {
        reason += adding
          ? ` — adds a night person on ${fmtDays(helped)}`
          : ` — takes a night person off ${fmtDays(helped)}`;
      } else {
        const kept = op.changes.filter(([d]) => d >= fromIdx && d <= toIdx).map(([d]) => dates[d]);
        reason += ` — keeps ${fmtDays(kept)} at ${MIN_G}–${MAX_G} on nights after the other changes`;
      }
      if (op.partial) reason += " (changes only part of the block: no single whole-block swap fixes this)";
      return {
        agentId: ids[op.ai],
        from: dates[op.s],
        to: dates[op.e],
        code: op.code,
        before,
        partial: op.partial,
        reason,
      };
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.agentId < b.agentId ? -1 : 1));

  const notes: string[] = [];
  const touched = [...new Set(edits.map((e) => e.op.ai))].sort((a, b) => a - b);
  for (const ai of touched) {
    const was = new Set(originalSoft[ai].map((s) => s.text));
    for (const s of softOf(ai)) if (!was.has(s.text)) notes.push(s.text);
  }
  const newThrees: string[] = [];
  for (let d = fromIdx; d <= toIdx; d++) if (counts[d] === MAX_G && initialCounts[d] !== MAX_G) newThrees.push(dates[d]);
  if (newThrees.length) notes.push(`${MAX_G} on nights (2 preferred) on ${fmtDays(newThrees)}`);

  const unresolved = badNow().map((d) => dates[d]);
  return { badDays, edits: outEdits, after: listCounts(), unresolved, notes };

  /* ---------- helpers (hoisted) ---------- */

  function countThrees() {
    let n = 0;
    for (let d = fromIdx; d <= toIdx; d++) if (counts[d] === MAX_G) n++;
    return n;
  }

  function apply(op: Op): string[] {
    const row = grid[op.ai];
    const saved = row.slice(op.s, op.e + 1);
    for (let d = op.s; d <= op.e; d++) row[d] = op.code;
    for (const [d, delta] of op.changes) counts[d] += delta;
    return saved;
  }

  function undo(op: Op, saved: string[]) {
    const row = grid[op.ai];
    for (let d = op.s; d <= op.e; d++) row[d] = saved[d - op.s];
    for (const [d, delta] of op.changes) counts[d] -= delta;
  }

  function buildOps(winLo: number, winHi: number): Op[] {
    const out: Op[] = [];
    let nextId = 0;
    const add = (b: Block, s: number, e: number, code: string, partial: boolean) => {
      const row = grid[b.ai];
      const changes: Array<[number, number]> = [];
      let changedDays = 0;
      for (let d = s; d <= e; d++) {
        if (row[d] === code) continue;
        changedDays++;
        const delta = (isG(code) ? 1 : 0) - (isG(row[d]) ? 1 : 0);
        if (delta) changes.push([d, delta]);
      }
      if (!changes.some(([d]) => d >= fromIdx && d <= toIdx)) return;
      out.push({ id: nextId++, ai: b.ai, block: b.idx, s, e, code, partial, changes, changedDays });
    };

    for (const b of blocks) {
      if (b.e < Math.max(winLo, fromIdx) || b.s > Math.min(winHi, toIdx)) continue;
      const id = ids[b.ai];
      if (fixed[id] !== undefined) continue;
      const row = grid[b.ai];
      let gDays = 0, dayDays = 0, other = false;
      const dayCodes = new Map<string, number>();
      for (let d = b.s; d <= b.e; d++) {
        const x = band(row[d]);
        if (x === "G") gDays++;
        else if (x === "M" || x === "E") {
          dayDays++;
          dayCodes.set(row[d], (dayCodes.get(row[d]) ?? 0) + 1);
        } else other = true;
      }
      if (other) continue; // never overwrite Training / unknown codes
      // most common day code in the block (ties: first seen)
      let mainDay = "";
      for (const [c, n] of dayCodes) if (!mainDay || n > dayCodes.get(mainDay)!) mainDay = c;
      const canAdd = pool.has(id) && dayDays > 0;
      const canRemove = gDays > 0;

      const s0 = Math.max(b.s, fromIdx); // never touch days before `from`
      const wholeOk = s0 === b.s;
      if (wholeOk) {
        if (canRemove) add(b, b.s, b.e, "S1", false);
        if (canAdd) add(b, b.s, b.e, "S6", false);
      }
      // partial: prefixes and suffixes of the editable part
      const len = b.e - s0 + 1;
      for (let k = 1; k <= len; k++) {
        const pre: [number, number] = [s0, s0 + k - 1];
        const suf: [number, number] = [b.e - k + 1, b.e];
        const ranges: Array<[number, number]> = k === len ? (wholeOk ? [] : [pre]) : [pre, suf];
        for (const [s, e] of ranges) {
          const isPrefix = s === s0;
          if (canRemove) {
            // day part before the nights: keep the block's day code (evening
            // leads into nights nicely); nights → day at the end: mornings.
            const code = isPrefix && e < b.e ? mainDay || "S4" : "S1";
            add(b, s, e, code, true);
          }
          if (canAdd) add(b, s, e, "S6", true);
        }
      }
    }
    // whole-block ops first, then fewer changed days; stable by construction order
    out.sort((a, b) => Number(a.partial) - Number(b.partial) || a.changedDays - b.changedDays || a.id - b.id);
    return out;
  }
}
