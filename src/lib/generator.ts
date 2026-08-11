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
const GY_WINDOW_WEEKS = 1; // one week of nights, then the trio rotates out

export type Band = "M" | "E" | "G";
export type GenAgent = { id: string; name: string; is_lead: boolean };

export type GenInput = {
  agents: GenAgent[];
  startSunday: string; // yyyy-MM-dd, must be a Sunday
  weeks: number; // 4 or 5
  gyPool: string[]; // agent ids eligible for graveyard
  fixedShift?: Record<string, string>; // agentId -> code that never rotates
  leave?: Record<string, string>; // `${agentId}|${date}` -> AL / SL / ...
  /**
   * Rotates which agent holds which off-pattern, so consecutive months don't
   * hand the same people the same days off. Must be applied *after* the
   * internal sort, or that sort discards it.
   */
  offset?: number;
  /**
   * Codes for the days *before* startSunday, keyed `${agentId}|${yyyy-MM-dd}`.
   * Used to resume each agent's cycle across the month boundary rather than
   * restarting it: their off-pattern is inferred from it, and a block that was
   * already running on the 1st keeps its shift code.
   */
  history?: Record<string, string>;
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
  known: Map<string, number> = new Map(),
): Map<string, number> {
  // Pairs carried over from last month are fixed; only the rest are assigned.
  const pair = new Map<string, number>(known);
  const leads = agents.filter((a) => a.is_lead && !pair.has(a.id));
  const gy = agents.filter((a) => !a.is_lead && gyPool.has(a.id) && !pair.has(a.id));
  const rest = agents.filter((a) => !a.is_lead && !gyPool.has(a.id) && !pair.has(a.id));

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

const HISTORY_DAYS = 14;

export function bandOfCode(code: string): Band | null {
  const c = (code ?? "").trim().toUpperCase();
  if (["S1", "S2", "S3"].includes(c)) return "M";
  if (["S4", "S5", "S5.5"].includes(c)) return "E";
  if (c === "S6") return "G";
  return null; // OFF, AL, SL, holidays …
}

type Carried = { pair: number | null; band: Band | null; code: string | null; midBlock: boolean };

/**
 * Read an agent's rhythm off the tail of the previous month.
 *
 * The off-pattern is a 7-day cycle, so the pair that best explains the last two
 * weeks is the one to continue with. A weak match (someone on long leave, or a
 * newly hired agent) returns null and the agent is assigned a fresh pair.
 */
function derivePrev(agentId: string, history: Record<string, string>, start: Date): Carried {
  const obs: Array<{ wd: number; off: boolean }> = [];
  for (let k = 1; k <= HISTORY_DAYS; k++) {
    const d = addDays(start, -k);
    const code = history[`${agentId}|${format(d, "yyyy-MM-dd")}`];
    if (!code) continue;
    obs.push({ wd: d.getDay(), off: code.trim().toUpperCase() === "OFF" });
  }

  let pair: number | null = null;
  if (obs.length >= 7) {
    let best = -1;
    for (const p of PAIRS) {
      let score = 0;
      for (const o of obs) if (pairCovers(p, o.wd) === o.off) score++;
      if (score > best) { best = score; pair = p; }
    }
    if (best / obs.length < 0.85) pair = null; // too noisy to trust
  }

  // What they were working most recently, and whether a block was still running
  // on the day before the new month starts.
  let band: Band | null = null;
  let code: string | null = null;
  for (let k = 1; k <= HISTORY_DAYS; k++) {
    const c = history[`${agentId}|${format(addDays(start, -k), "yyyy-MM-dd")}`];
    if (!c) continue;
    const b = bandOfCode(c);
    if (b) { band = b; code = c.trim().toUpperCase(); break; }
  }
  const dayBefore = history[`${agentId}|${format(addDays(start, -1), "yyyy-MM-dd")}`];
  const midBlock = !!dayBefore && bandOfCode(dayBefore) !== null;

  return { pair, band, code, midBlock };
}

const overlap = (a: number, b: number) => PAIRS.some((d) => pairCovers(a, d) && pairCovers(b, d));

/**
 * Choose who works graveyard for the whole period.
 *
 * Rotating the trio mid-month cannot guarantee cover: blocks straddle Sundays,
 * so an incoming agent's first graveyard block may start days after the
 * outgoing one ended, leaving a day on 1. Holding three agents whose off-pairs
 * never coincide means at most one is off on any day, so cover is always 2-3.
 * `seed` rotates which three across months.
 */
/**
 * Split a group in two so that *both* halves have non-overlapping days off.
 * Picking one clean trio and letting the remainder fall into the other half
 * leaves the remainder free to collide — which is how two leads ended up off
 * on the same Tue/Wed and cover dropped to one.
 */
function splitDisjoint(
  list: GenAgent[], pairOf: Map<string, number>, seed: number,
): Set<string> {
  // Fill A to half with mutually non-overlapping pairs before starting B.
  // Balancing the two as we go tears a perfectly disjoint set apart: pairs
  // 0,2,4 would land as A=[0], B=[2] and cover collapses.
  const half = Math.ceil(list.length / 2);
  const A: GenAgent[] = [], B: GenAgent[] = [];
  const pA: number[] = [], pB: number[] = [];
  for (let k = 0; k < list.length; k++) {
    const ag = list[(seed + k) % list.length];
    const p = pairOf.get(ag.id) ?? 0;
    if (A.length < half && !pA.some((q) => overlap(q, p))) { A.push(ag); pA.push(p); }
    else if (!pB.some((q) => overlap(q, p))) { B.push(ag); pB.push(p); }
    else if (A.length < half) { A.push(ag); pA.push(p); }
    else { B.push(ag); pB.push(p); }
  }
  return new Set(A.map((x) => x.id));
}

function pickGyTrio(pool: GenAgent[], pairOf: Map<string, number>, seed: number): Set<string> {
  const chosen: GenAgent[] = [];
  const used: number[] = [];
  for (let k = 0; k < pool.length && chosen.length < GY_PER_WEEK; k++) {
    const a = pool[(seed + k) % pool.length];
    const p = pairOf.get(a.id) ?? 0;
    if (!used.some((q) => overlap(q, p))) { chosen.push(a); used.push(p); }
  }
  // Not enough disjoint pairs (carried-over history can cluster them) — fill up
  // anyway and let verify() report any resulting thin day.
  for (let k = 0; k < pool.length && chosen.length < GY_PER_WEEK; k++) {
    const a = pool[(seed + k) % pool.length];
    if (!chosen.some((c) => c.id === a.id)) chosen.push(a);
  }
  return new Set(chosen.map((a) => a.id));
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

  // Sort for determinism, then rotate. Off-patterns are handed out by position
  // in this list, so rotating it moves who gets the weekend off without
  // changing the overall coverage shape.
  const byName = [...agents].sort((x, y) => x.name.localeCompare(y.name));
  const rot = byName.length
    ? ((((input.offset ?? 0) % byName.length) + byName.length) % byName.length)
    : 0;
  const sorted = rot ? byName.slice(rot).concat(byName.slice(0, rot)) : byName;

  // Continuity: resume each agent's cycle from the previous month.
  const history = input.history ?? {};
  const carriedBy = new Map<string, Carried>();
  const knownPairs = new Map<string, number>();
  for (const a of sorted) {
    const c = derivePrev(a.id, history, start);
    carriedBy.set(a.id, c);
    if (c.pair != null) knownPairs.set(a.id, c.pair);
  }
  const pair = assignPairs(sorted, gyPool, knownPairs);
  const poolAgents = sorted.filter((a) => gyPool.has(a.id));
  // Rotate graveyard every GY_WINDOW_WEEKS, and never give anyone two stretches
  // in a row: each window is drawn from the pool minus whoever just finished.
  // Each trio still has non-overlapping days off, so cover holds within a window.
  const nWindows = Math.max(1, Math.ceil(weeks / GY_WINDOW_WEEKS));
  const gyByWindow: Array<Set<string>> = [];
  let servedLast = new Set<string>();
  for (let w = 0; w < nWindows; w++) {
    const seed = (input.offset ?? 0) + w * GY_PER_WEEK;
    const rested = poolAgents.filter((a) => !servedLast.has(a.id));
    let trio = pickGyTrio(rested, pair, seed);
    if (trio.size < Math.min(GY_PER_WEEK, poolAgents.length)) {
      // Pool too small to sit everyone out for a window — cover wins.
      trio = pickGyTrio(poolAgents, pair, seed);
      if (poolAgents.length >= GY_PER_WEEK * 2) {
        warnings.push("Graveyard pool too small to avoid back-to-back night stretches.");
      }
    }
    gyByWindow.push(trio);
    servedLast = trio;
  }
  const gyTrioFor = (week: number) =>
    gyByWindow[Math.min(Math.floor(week / GY_WINDOW_WEEKS), gyByWindow.length - 1)];
  if (poolAgents.length < GY_PER_WEEK) {
    warnings.push(
      `Graveyard pool has only ${poolAgents.length} eligible agents; need ${GY_PER_WEEK} per week for 2-3/day coverage.`,
    );
  }

  const leads = sorted.filter((a) => a.is_lead);
  const leadHalf = Math.ceil(leads.length / 2);
  const leadGroup = new Map<string, number>();
  leads.forEach((a, i) => leadGroup.set(a.id, i < leadHalf ? 0 : 1));

  // Leads hold one band for the whole period, swapped between months.
  //
  // With six leads, "one code per block", "flip band weekly" and "2-3 leads on
  // each band daily" cannot all hold: a block only stays inside a calendar week
  // when the off-pair is Fri+Sat or Sat+Sun, and only two such pairs exist. Any
  // other pair straddles Sunday, so weekly flips land on different days per lead
  // and the split drifts to 4-1. Daily cover is the stated rule, so it wins;
  // fairness comes from swapping the trios each month instead.
  // Partition once from a fixed start: rotating the iteration order makes the
  // greedy miss the clean split (with pairs 0..5 it finds {3,5,0} then is forced
  // to put an overlapping pair in the other half). The offset only decides
  // which half takes mornings, which is what rotates the load between months.
  const leadGroupA = splitDisjoint(leads, pair, 0);
  const leadsSwapped = ((input.offset ?? 0) % 2) === 1;
  const leadMorning = new Set(
    leads.filter((a) => leadGroupA.has(a.id) !== leadsSwapped).map((a) => a.id),
  );
  if (leads.length >= 4 && leadMorning.size < 2) {
    warnings.push("Could not find enough leads with non-overlapping days off for morning cover.");
  }

  const idxAll = new Map<string, number>();
  sorted.forEach((a, i) => idxAll.set(a.id, i));
  const rotators = sorted.filter((a) => !a.is_lead);
  const rotIndex = new Map<string, number>();
  rotators.forEach((a, i) => rotIndex.set(a.id, i));

  const dates: string[] = [];
  const totalDays = weeks * 7;
  for (let i = 0; i < totalDays; i++) dates.push(format(addDays(start, i), "yyyy-MM-dd"));

  const cells: GenCell[] = [];

  // Pass 1 — band per agent per day. Bands are decided per work block, so a
  // block never mixes morning with evening. That is the rule that matters; the
  // exact code may still move within a band (S1 -> S2), as the real sheets do.
  const bandByDay = new Map<string, Array<Band | null>>();
  const prefByDay = new Map<string, Array<string | null>>();
  const seedCode = new Map<string, string>();
  for (const a of sorted) {
    const p = pair.get(a.id) ?? 0;
    const isOff = (i: number) => pairCovers(p, i % 7);
    const blocks: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < totalDays; ) {
      if (isOff(i)) { i++; continue; }
      let j = i;
      while (j < totalDays && !isOff(j)) j++;
      blocks.push({ start: i, end: j - 1 });
      i = j;
    }
    const carried = carriedBy.get(a.id);
    const bands = new Array<Band | null>(totalDays).fill(null);
    const prefs = new Array<string | null>(totalDays).fill(null);
    const ai = idxAll.get(a.id) ?? 0;
    let nM = 0, nE = 0; // blocks served in each band, to rotate the code
    let prevWasG = carried?.band === "G"; // no two night stretches back to back
    blocks.forEach((blk, bi) => {
      let band: Band;
      let pref: string | null = null;
      if (bi === 0 && blk.start === 0 && carried?.midBlock && carried.band) {
        band = carried.band; // finish the run that was already under way
        pref = carried.code ?? null;
        if (carried.code) seedCode.set(a.id, carried.code);
      } else if (gyTrioFor(Math.floor(blk.start / 7)).has(a.id) && !prevWasG) {
        band = "G";
      } else if (a.is_lead) {
        band = leadMorning.has(a.id) ? "M" : "E";
      } else {
        const group = (rotIndex.get(a.id) ?? 0) % 2;
        band = (Math.floor(blk.start / 7) + group) % 2 === 0 ? "M" : "E";
      }
      // Step through the band's mix block by block. Without this a lead, whose
      // band never changes, keeps the same code every day for a month.
      if (!pref && band === "M") pref = MORNING_MIX[(ai + nM++) % MORNING_MIX.length];
      else if (!pref && band === "E") pref = EVENING_MIX[(ai + nE++) % EVENING_MIX.length];
      for (let d = blk.start; d <= blk.end; d++) { bands[d] = band; prefs[d] = pref; }
      prevWasG = band === "G";
    });
    bandByDay.set(a.id, bands);
    prefByDay.set(a.id, prefs);
  }

  // Rotating the graveyard trio can leave a day at the window seam short: an
  // outgoing block ends before the incoming one starts. Promote whole blocks
  // until every day carries at least two, so rotation never costs cover.
  for (let d = 0; d < totalDays; d++) {
    let onNights = sorted.filter((a) => bandByDay.get(a.id)![d] === "G").length;
    for (let guard = 0; onNights < 2 && guard < 8; guard++) {
      const nightsSoFar = (id: string) =>
        bandByDay.get(id)!.reduce((n, b) => n + (b === "G" ? 1 : 0), 0);
      // Prefer someone who would not end up on nights twice running; if nobody
      // qualifies, cover wins over the rest rule and we say so.
      const candidates = (strict: boolean) =>
        sorted
          .filter((a) => {
            const bands = bandByDay.get(a.id)!;
            const b = bands[d];
            if (!(gyPool.has(a.id) && b !== null && b !== "G" && !fixedShift[a.id])) return false;
            if (!strict) return true;
            let s0 = d, e0 = d;
            while (s0 > 0 && bands[s0 - 1] !== null) s0--;
            while (e0 < totalDays - 1 && bands[e0 + 1] !== null) e0++;
            let before = s0 - 1;
            while (before >= 0 && bands[before] === null) before--;
            let after = e0 + 1;
            while (after < totalDays && bands[after] === null) after++;
            if (before >= 0 && bands[before] === "G") return false;
            if (after < totalDays && bands[after] === "G") return false;
            return true;
          })
          .sort((x, y) => nightsSoFar(x.id) - nightsSoFar(y.id))[0];
      let cand = candidates(true);
      if (!cand) {
        cand = candidates(false);
        if (cand) {
          warnings.push(
            `Gave ${cand.name} a second night stretch to keep graveyard cover on ${dates[d]}.`,
          );
        }
      }
      if (!cand) break;
      const bands = bandByDay.get(cand.id)!;
      const prefs = prefByDay.get(cand.id)!;
      let s0 = d, e0 = d;
      while (s0 > 0 && bands[s0 - 1] !== null) s0--;
      while (e0 < totalDays - 1 && bands[e0 + 1] !== null) e0++;
      for (let x = s0; x <= e0; x++) { bands[x] = "G"; prefs[x] = null; }
      onNights++;
    }
  }

  // Pass 2 — pick the code inside each band, day by day, so the team's mix stays
  // balanced instead of a whole block locking one code and swinging the daily
  // headcount. Yesterday's code is kept whenever the quota allows, so a block
  // usually reads as one code and only moves within its band when needed.
  const codeAt = new Map<string, string>();
  const lastCode = new Map<string, string>(seedCode);
  for (let d = 0; d < totalDays; d++) {
    for (const band of ["M", "E"] as const) {
      const mix = band === "M" ? MORNING_MIX : EVENING_MIX;
      const uniq = [...new Set(mix)];
      const pool = sorted.filter(
        (a) => bandByDay.get(a.id)![d] === band && !fixedShift[a.id] && !leave[`${a.id}|${dates[d]}`],
      );
      const quota: Record<string, number> = {};
      let used = 0;
      uniq.forEach((c, i) => {
        const share = mix.filter((x) => x === c).length / mix.length;
        quota[c] = i === uniq.length - 1 ? pool.length - used : Math.round(share * pool.length);
        used += quota[c];
      });
      const pending: string[] = [];
      for (const a of pool) {
        const want = prefByDay.get(a.id)?.[d] ?? lastCode.get(a.id);
        if (want && quota[want] > 0) { codeAt.set(`${a.id}|${d}`, want); quota[want]--; }
        else pending.push(a.id);
      }
      for (const id of pending) {
        const c = uniq.find((x) => quota[x] > 0) ?? uniq[0];
        codeAt.set(`${id}|${d}`, c);
        quota[c]--;
      }
    }
    for (const a of sorted) {
      const c = codeAt.get(`${a.id}|${d}`);
      if (c) lastCode.set(a.id, c);
    }
  }

  // Pass 3 — emit.
  for (const a of sorted) {
    const p = pair.get(a.id) ?? 0;
    const bands = bandByDay.get(a.id)!;
    for (let d = 0; d < totalDays; d++) {
      const date = dates[d];
      const lv = leave[`${a.id}|${date}`];
      let code: string;
      if (lv) code = lv; // leave overrides everything, matching how the sheets read
      else if (pairCovers(p, d % 7)) code = "OFF";
      else if (fixedShift[a.id]) code = fixedShift[a.id];
      else if (bands[d] === "G") code = GY_CODE;
      else code = codeAt.get(`${a.id}|${d}`) ?? MORNING_MIX[0];
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

/**
 * Re-check an arbitrary set of cells — used to re-run the rule check after an
 * admin hand-edits the preview, so the warnings reflect what will actually be
 * applied rather than what was generated.
 */
export function auditSchedule(
  cells: GenCell[], dates: string[], agents: GenAgent[],
): { stats: GenStats; warnings: string[] } {
  const none = new Set<string>();
  return {
    stats: buildStats(cells, dates, agents, none),
    warnings: verify(cells, dates, agents, none),
  };
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
