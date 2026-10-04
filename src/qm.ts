/**
 * Quine-McCluskey 核心算法。
 *
 * 位序约定：变量按声明顺序排列，variables[0] 为最高位。
 * 输入编号 index 的第 (nvars-1-i) 位对应 variables[i] 的真假。
 * 模式串从左到右对应 variables[0..n-1]：
 * '0' 表示该变量取反，'1' 表示原变量，'-' 表示无关位。
 *
 * 项的内部表示：mask 中为 1 的位是固定位，bits 给出固定位的取值。
 */

export const ALGO_VERSION = "qm-1.0.0";
export const MAX_VARS = 6;
export const MAX_TERMS = 20000;

export interface Term {
  id: number;
  round: number;
  mask: number;
  bits: number;
  merged: boolean;
  sources: number[];
  sourcePairs: Array<[number, number]>;
  covers: number[];
}

export interface Round {
  round: number;
  terms: Term[];
}

export interface Prime {
  mask: number;
  bits: number;
  coversOn: number[];
}

export interface CoverChoice {
  step: number;
  mask: number;
  bits: number;
  reason: string;
  newlyCovered: number[];
}

export interface QMResult {
  rounds: Round[];
  primes: Prime[];
  coverChoices: CoverChoice[];
  selected: Prime[];
  uncoveredOn: number[];
}

export class QmError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function patternOf(mask: number, bits: number, nvars: number): string {
  let s = "";
  for (let i = nvars - 1; i >= 0; i--) {
    if (mask & (1 << i)) s += bits & (1 << i) ? "1" : "0";
    else s += "-";
  }
  return s;
}

export function literalCount(mask: number): number {
  let c = 0;
  while (mask) {
    c += mask & 1;
    mask >>= 1;
  }
  return c;
}

export function coversIndex(mask: number, bits: number, idx: number): boolean {
  return (idx & mask) === bits;
}

function isPowerOfTwo(x: number): boolean {
  return x > 0 && (x & (x - 1)) === 0;
}

/**
 * 执行 Quine-McCluskey 合并。
 * DC 项参与全部合并轮次（不能提前丢弃），最终只保留至少覆盖一个 ON 的素蕴含项。
 */
export function quineMcCluskey(
  nvars: number,
  onSet: number[],
  dcSet: number[]
): QMResult {
  const size = 1 << nvars;
  const on = new Set(onSet);
  const minterms = [...onSet, ...dcSet].sort((a, b) => a - b);

  let nextId = 0;
  const rounds: Round[] = [];
  let current: Term[] = minterms.map((m) => ({
    id: nextId++,
    round: 0,
    mask: size - 1,
    bits: m,
    merged: false,
    sources: [] as number[],
    sourcePairs: [] as Array<[number, number]>,
    covers: [m],
  }));
  rounds.push({ round: 0, terms: current });

  while (current.length > 0) {
    const byKey = new Map<string, Term>();
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (a.mask !== b.mask) continue;
        const diff = a.bits ^ b.bits;
        if (!isPowerOfTwo(diff)) continue;
        a.merged = true;
        b.merged = true;
        const mask = a.mask & ~diff;
        const bits = a.bits & mask;
        const key = mask + ":" + bits;
        const covers = [...new Set([...a.covers, ...b.covers])].sort(
          (x, y) => x - y
        );
        const existing = byKey.get(key);
        if (existing) {
          existing.sourcePairs.push([a.id, b.id]);
          existing.sources = [
            ...new Set([...existing.sources, a.id, b.id]),
          ].sort((x, y) => x - y);
        } else {
          byKey.set(key, {
            id: nextId++,
            round: a.round + 1,
            mask,
            bits,
            merged: false,
            sources: [a.id, b.id].sort((x, y) => x - y),
            sourcePairs: [[a.id, b.id]],
            covers,
          });
        }
        if (nextId > MAX_TERMS) {
          throw new QmError(
            "SCALE_LIMIT",
            "合并产生的项数超过上限 " + MAX_TERMS + "，请减少变量或输入规模"
          );
        }
      }
    }
    if (byKey.size === 0) break;
    current = [...byKey.values()];
    rounds.push({ round: current[0].round, terms: current });
  }

  const primeMap = new Map<string, Prime>();
  for (const r of rounds) {
    for (const t of r.terms) {
      if (t.merged) continue;
      const coversOn = t.covers.filter((c) => on.has(c));
      if (coversOn.length === 0) continue;
      const key = t.mask + ":" + t.bits;
      if (!primeMap.has(key)) {
        primeMap.set(key, { mask: t.mask, bits: t.bits, coversOn });
      }
    }
  }
  const primes = [...primeMap.values()].sort((a, b) => {
    const pa = patternOf(a.mask, a.bits, nvars);
    const pb = patternOf(b.mask, b.bits, nvars);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  const coverCount = new Map<number, number>();
  for (const p of primes) {
    for (const m of p.coversOn) {
      coverCount.set(m, (coverCount.get(m) ?? 0) + 1);
    }
  }

  const selected: Prime[] = [];
  const coverChoices: CoverChoice[] = [];
  const covered = new Set<number>();
  let step = 0;

  for (const m of [...on].sort((a, b) => a - b)) {
    if (covered.has(m)) continue;
    if (coverCount.get(m) === 1) {
      const p = primes.find((q) => q.coversOn.includes(m))!;
      if (selected.includes(p)) continue;
      const newly = p.coversOn.filter((c) => !covered.has(c));
      selected.push(p);
      for (const c of p.coversOn) covered.add(c);
      coverChoices.push({
        step: step++,
        mask: p.mask,
        bits: p.bits,
        reason: "必需项：ON 编号 " + m + " 仅被该素蕴含项覆盖",
        newlyCovered: newly,
      });
    }
  }

  while (true) {
    const remaining = [...on].filter((m) => !covered.has(m));
    if (remaining.length === 0) break;
    let best: Prime | null = null;
    let bestNew: number[] = [];
    for (const p of primes) {
      if (selected.includes(p)) continue;
      const newly = p.coversOn.filter((c) => !covered.has(c));
      if (newly.length === 0) continue;
      if (!best) {
        best = p;
        bestNew = newly;
        continue;
      }
      const cmp =
        newly.length - bestNew.length ||
        literalCount(p.mask) - literalCount(best.mask) ||
        patternOf(p.mask, p.bits, nvars).localeCompare(
          patternOf(best.mask, best.bits, nvars)
        );
      if (cmp > 0) {
        best = p;
        bestNew = newly;
      }
    }
    if (!best) break;
    selected.push(best);
    for (const c of best.coversOn) covered.add(c);
    coverChoices.push({
      step: step++,
      mask: best.mask,
      bits: best.bits,
      reason:
        "贪心选择：新增覆盖 " +
        bestNew.length +
        " 个 ON（" +
        bestNew.join(", ") +
        "），文字数 " +
        literalCount(best.mask) +
        "，同分时按模式串固定排序",
      newlyCovered: bestNew,
    });
  }

  const uncoveredOn = [...on]
    .filter((m) => !covered.has(m))
    .sort((a, b) => a - b);
  return { rounds, primes, coverChoices, selected, uncoveredOn };
}

export function buildExpression(
  selected: Prime[],
  variables: string[],
  hasOn: boolean
): string {
  if (!hasOn) return "0";
  const nvars = variables.length;
  const products = selected.map((p) => {
    if (p.mask === 0) return "1";
    const lits: string[] = [];
    for (let i = 0; i < nvars; i++) {
      const bit = 1 << (nvars - 1 - i);
      if (p.mask & bit) {
        lits.push(p.bits & bit ? variables[i] : variables[i] + "'");
      }
    }
    return lits.join("");
  });
  if (products.includes("1")) return "1";
  return products.join(" + ");
}

export function evalExpression(selected: Prime[], idx: number): boolean {
  return selected.some((p) => coversIndex(p.mask, p.bits, idx));
}

export function verifyExpression(
  selected: Prime[],
  nvars: number,
  onSet: number[],
  dcSet: number[]
): { ok: boolean; mismatches: Array<{ idx: number; expected: string }> } {
  const on = new Set(onSet);
  const dc = new Set(dcSet);
  const mismatches: Array<{ idx: number; expected: string }> = [];
  for (let idx = 0; idx < 1 << nvars; idx++) {
    const v = evalExpression(selected, idx);
    if (on.has(idx)) {
      if (!v) mismatches.push({ idx, expected: "ON(1)" });
    } else if (!dc.has(idx)) {
      if (v) mismatches.push({ idx, expected: "OFF(0)" });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
