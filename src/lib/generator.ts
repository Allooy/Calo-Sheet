import { addDays, format, parseISO } from "date-fns";

/**
 * Deterministic schedule generator.
 *
 * Same inputs always produce the same output — no randomness — so an admin can
 * re-run it and trust the result, and a diff against the DB is meaningful.
 *
 * Coverage shape is taken from three real months (June–Aug 2026): Fri/Sat are
 * the weekend here, so OFF is deliberately heavier then rather than flat.
 */

// Off-per-day weights, Sun..Sat, measured from the real sheets.
export const WEEKDAY_OFF_WEIGHTS = [6.5, 6.5, 8.6, 8.7, 11.0, 16.8, 13.2];

// A "pair" p is an agent's 2 consecutive off days: weekdays p and (p+1)%7.
// Holding one pair for the whole period is what produces an exact 5-on/2-off
// cycle — any week-to-week drift in the pair turns a 5-day block into 4 or 6.
const PAIRS = [0, 1, 2, 3, 4, 5, 6];
const pairCovers = (p: number, weekday: number) =>
  weekday === p || weekday === (p + 1) % 7;

// Leads are split across two disjoint pair sets so that, within either band,
// at most one lead is ever off on the same day → always 2-3 leads on duty.
const LEAD_PAIRS_A = [0, 2, 4]; // off Sun/Mon, Tue/Wed, Thu/Fri
const LEAD_PAIRS_B = [1, 3, 5]; // off Mon/Tue, Wed/Thu, Fri/Sat
// The graveyard pool reuses the same disjoint structure so any 3 consecutive
// pool members can cover a week without two of them being off together.
const GY_PAIR_CYCLE = [0, 2, 4, 1, 3, 5];

export const GY_CODE = "S6";
// S1 runs about 2x as often as S2 in the real sheets; S4/S5 are near 1:1.
// S3 is effectively a fixed-shift-only code (Ali Jalal / Fahad), so it is not
// part of the rotating morning mix.
const MORNING_MIX = ["S1", "S1", "S2"];
const EVENING_MIX = ["S4", "S5"];

const GY_PER_WEEK = 3; // 3 assigned → 2-3 actually on duty each day

export type Band = "M" | "E" | "G";
export type GenAgent = { id: string; name: string; is_lead: boolean };

export type GenInput = {
  agents: GenAgent[];
  startSunday: string; // yyyy-MM-dd, must be a Sunday
  weeks: number; // 4 or 5
  gyPool: string[]; // agent ids eligible for graveyard
  fixedShift?: Record<string, string>; // agentId -> code that never rotates
  leave?: Record<string, string>; // `${agentId}|${date}` -> AL / SL / ...
};

export type GenCell = { agent_id: string; date: string; shift_code: string };

export type GenStats = {
  offByWeekday: number[];
  offTargetByWeekday: number[];
  gyPerDay: number[];
  morningLeadsPerDay: number[];
  eveningLeadsPerDay: number[];
  workBlocks: Record<number, number>;
  offBlocks: Record<number, number>;
};

export type GenResult = {
  cells: GenCell[];
  dates: string[];
  warnings: string[];
  stats: GenStats;
};

/** Assign every agent one off-pair held for the whole period. */
function assignPairs(
  agents: GenAgent[],
  gyPool: Set<string>,
): Map<string, number> {
  const pair = new Map<string, number>();
  const leads = agents.filter((a) => a.is_lead);
  const gy = agents.filter((a) => !a.is_lead && gyPool.has(a.id));
  const rest = agents.filter((a) => !a.is_lead && !gyPool.has(a.id));

  // Leads first — their spacing is a hard constraint, not a preference.
  leads.forEach((a, i) => {
    const half = Math.ceil(leads.length / 2);
    const set = i < half ? LEAD_PAIRS_A : LEAD_PAIRS_B;
    pair.set(a.id, set[(i < half ? i : i - half) % set.length]);
  });
  gy.forEach((a, i) => pair.set(a.id, GY_PAIR_CYCLE[i % GY_PAIR_CYCLE.length]));

  // Everyone else fills the measured weekday curve as closely as possible.
  const n = agents.length;
  const wsum = WEEKDAY_OFF_WEIGHTS.reduce((s, x) => s + x, 0);
  const target = WEEKDAY_OFF_WEIGHTS.map((w) => (w / wsum) * 2 * n);
  const cur = new Array(7).fill(0);
  for (const [, p] of pair) for (const d of PAIRS) if (pairCovers(p, d)) cur[d]++;

  for (const a of rest) {
    let best = 0;
    let bestCost = Infinity;
    for (const p of PAIRS) {
      let cost = 0;
      for (let d = 0; d < 7; d++) {
        const v = cur[d] + (pairCovers(p, d) ? 1 : 0) - target[d];
        cost += v * v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    pair.set(a.id, best);
    for (let d = 0; d < 7; d++) if (pairCovers(best, d)) cur[d]++;
  }
  return pair;
}

/** Which agents work graveyard in a given week (rotates through the pool). */
function gyForWeek(pool: GenAgent[], week: number): Set<string> {
  const out = new Set<string>();
  if (pool.length === 0) return out;
  const take = Math.min(GY_PER_WEEK, pool.length);
  for (let i = 0; i < take; i++) {
    out.add(pool[(week * take + i) % pool.length].id);
  }
  return out;
}

export function generateSchedule(input: GenInput): GenResult {
  const { agents, startSunday, weeks } = input;
  const fixedShift = input.fixedShift ?? {};
  const leave = input.leave ?? {};
  const warnings: string[] = [];

  const start = parseISO(startSunday);
  if (start.getDay() !== 0) warnings.push("Start date is not a Sunday.");
  if (agents.length === 0) {
    warnings.push("No agents to schedule.");
  }

  // Leads never work graveyard, so they can never be in the GY pool.
  const gyPool = new Set(input.gyPool);
  for (const a of agents) if (a.is_lead) gyPool.delete(a.id);

  const sorted = [...agents].sort((x, y) => x.name.localeCompare(y.name));
  const pair = assignPairs(sorted, gyPool);
  const poolAgents = sorted.filter((a) => gyPool.has(a.id));
  if (poolAgents.length < GY_PER_WEEK) {
    warnings.push(
      `Graveyard pool has only ${poolAgents.length} eligible agents; need ${GY_PER_WEEK} per week for 2-3/day coverage.`,
    );
  }

  const leads = sorted.filter((a) => a.is_lead);
  const leadHalf = Math.ceil(leads.length / 2);
  const leadGroup = new Map<string, number>();
  leads.forEach((a, i) => leadGroup.set(a.id, i < leadHalf ? 0 : 1));

  const rotators = sorted.filter((a) => !a.is_lead);
  const rotIndex = new Map<string, number>();
  rotators.forEach((a, i) => rotIndex.set(a.id, i));
  // Separate index over *all* agents for code selection. Reusing rotIndex here
  // would correlate the pick with the band's own parity and pin every evening
  // block to a single code.
  const idxOf = new Map<string, number>();
  sorted.forEach((a, i) => idxOf.set(a.id, i));

  const dates: string[] = [];
  const totalDays = weeks * 7;
  for (let i = 0; i < totalDays; i++) dates.push(format(addDays(start, i), "yyyy-MM-dd"));

  const cells: GenCell[] = [];
  const bandOf = new Map<string, Band>(); // per (agent|week)
  const codeOf = new Map<string, string>(); // per (agent|week)
  // Per-agent counters rather than a hash: a hash's low bit stays correlated
  // with the band parity, which pins every evening block to one code.
  const mCount = new Map<string, number>();
  const eCount = new Map<string, number>();

  for (let w = 0; w < weeks; w++) {
    const gyThisWeek = gyForWeek(poolAgents, w);
    for (const a of sorted) {
      let band: Band;
      if (gyThisWeek.has(a.id)) {
        band = "G";
      } else if (a.is_lead) {
        // Leads alternate morning/evening weekly; the two halves stay opposite
        // so both bands always hold a full disjoint set of off-pairs.
        band = (w + (leadGroup.get(a.id) ?? 0)) % 2 === 0 ? "M" : "E";
      } else {
        band = (w + (rotIndex.get(a.id) ?? 0)) % 2 === 0 ? "M" : "E";
      }
      bandOf.set(`${a.id}|${w}`, band);

      if (band !== "G") {
        const mix = band === "M" ? MORNING_MIX : EVENING_MIX;
        const counter = band === "M" ? mCount : eCount;
        const n = counter.get(a.id) ?? 0;
        // Offset by agent index so the whole team doesn't start on the same code.
        codeOf.set(`${a.id}|${w}`, mix[((idxOf.get(a.id) ?? 0) + n) % mix.length]);
        counter.set(a.id, n + 1);
      }
    }
  }

  for (const a of sorted) {
    const p = pair.get(a.id) ?? 0;
    for (let i = 0; i < totalDays; i++) {
      const date = dates[i];
      const w = Math.floor(i / 7);
      const weekday = i % 7;
      const lv = leave[`${a.id}|${date}`];
      let code: string;
      if (lv) {
        code = lv; // leave overrides everything, matching how the sheets read
      } else if (pairCovers(p, weekday)) {
        code = "OFF";
      } else {
        const band = bandOf.get(`${a.id}|${w}`)!;
        const fixed = fixedShift[a.id];
        // One code per agent per week, so a whole 5-day block reads as one
        // block the way the real sheets do.
        if (fixed) code = fixed;
        else if (band === "G") code = GY_CODE;
        else code = codeOf.get(`${a.id}|${w}`)!;
      }
      cells.push({ agent_id: a.id, date, shift_code: code });
    }
  }

  return { cells, dates, warnings: warnings.concat(verify(cells, dates, sorted, gyPool)), stats: buildStats(cells, dates, sorted, gyPool) };
}

function seqFor(cells: GenCell[], agentId: string, dates: string[]) {
  const m = new Map(cells.filter((c) => c.agent_id === agentId).map((c) => [c.date, c.shift_code]));
  return dates.map((d) => m.get(d) ?? "");
}

function blocks(seq: string[]) {
  const work: Record<number, number> = {};
  const off: Record<number, number> = {};
  const kind = (c: string) => (c === "OFF" ? "O" : /^S[0-9.]+$/.test(c) ? "W" : "L");
  for (const seg of kind3(seq.map(kind))) {
    let i = 0;
    while (i < seg.length) {
      let j = i;
      while (j < seg.length && seg[j] === seg[i]) j++;
      const len = j - i;
      const interior = i > 0 && j < seg.length; // ignore truncated edge runs
      if (interior) (seg[i] === "W" ? work : off)[len] = ((seg[i] === "W" ? work : off)[len] ?? 0) + 1;
      i = j;
    }
  }
  return { work, off };
}

/** Split on leave so an AL stretch doesn't fake a broken work block. */
function kind3(k: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const c of k) {
    if (c === "L") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(c);
  }
  if (cur.length) out.push(cur);
  return out;
}

function buildStats(cells: GenCell[], dates: string[], agents: GenAgent[], gyPool: Set<string>): GenStats {
  const byDate = new Map<string, GenCell[]>();
  for (const c of cells) {
    const arr = byDate.get(c.date) ?? [];
    arr.push(c);
    byDate.set(c.date, arr);
  }
  const leadIds = new Set(agents.filter((a) => a.is_lead).map((a) => a.id));
  const offByWeekday = new Array(7).fill(0);
  const weekdayCount = new Array(7).fill(0);
  const gyPerDay: number[] = [];
  const morningLeadsPerDay: number[] = [];
  const eveningLeadsPerDay: number[] = [];

  dates.forEach((d) => {
    const col = byDate.get(d) ?? [];
    const wd = parseISO(d).getDay();
    offByWeekday[wd] += col.filter((c) => c.shift_code === "OFF").length;
    weekdayCount[wd]++;
    gyPerDay.push(col.filter((c) => c.shift_code === GY_CODE).length);
    morningLeadsPerDay.push(
      col.filter((c) => leadIds.has(c.agent_id) && ["S1", "S2", "S3"].includes(c.shift_code)).length,
    );
    eveningLeadsPerDay.push(
      col.filter((c) => leadIds.has(c.agent_id) && ["S4", "S5"].includes(c.shift_code)).length,
    );
  });

  const work: Record<number, number> = {};
  const off: Record<number, number> = {};
  for (const a of agents) {
    const b = blocks(seqFor(cells, a.id, dates));
    for (const [k, v] of Object.entries(b.work)) work[+k] = (work[+k] ?? 0) + v;
    for (const [k, v] of Object.entries(b.off)) off[+k] = (off[+k] ?? 0) + v;
  }

  const n = agents.length;
  const wsum = WEEKDAY_OFF_WEIGHTS.reduce((s, x) => s + x, 0);
  return {
    offByWeekday: offByWeekday.map((v, i) => (weekdayCount[i] ? v / weekdayCount[i] : 0)),
    offTargetByWeekday: WEEKDAY_OFF_WEIGHTS.map((w) => (w / wsum) * 2 * n),
    gyPerDay,
    morningLeadsPerDay,
    eveningLeadsPerDay,
    workBlocks: work,
    offBlocks: off,
  };
}

function verify(cells: GenCell[], dates: string[], agents: GenAgent[], gyPool: Set<string>): string[] {
  const out: string[] = [];
  const s = buildStats(cells, dates, agents, gyPool);
  const bad = (arr: number[], min: number, label: string) => {
    const days = arr.filter((v) => v < min).length;
    if (days) out.push(`${label}: below ${min} on ${days} of ${arr.length} days (min ${Math.min(...arr)}).`);
  };
  bad(s.gyPerDay, 2, "Graveyard cover");
  bad(s.morningLeadsPerDay, 2, "Morning leads");
  bad(s.eveningLeadsPerDay, 2, "Evening leads");
  const offLens = Object.keys(s.offBlocks).map(Number).filter((k) => k !== 2);
  if (offLens.length) out.push(`Off-blocks not equal to 2 days: ${offLens.join(", ")}.`);
  const workLens = Object.keys(s.workBlocks).map(Number).filter((k) => k !== 5);
  if (workLens.length) out.push(`Work-blocks not equal to 5 days: ${workLens.join(", ")}.`);
  return out;
}
