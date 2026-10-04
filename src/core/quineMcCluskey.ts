import {
  comparePattern,
  countLiterals,
  countOnes,
  expandPattern,
  mergePatterns,
  mergePosition,
  mintermToPattern,
} from './pattern.js';
import type {
  CoverageRow,
  CoverageSelection,
  MergeEntry,
  MergeRound,
  MergeStep,
  PrimeImplicant,
  QmcResult,
  ValidatedSpec,
} from './types.js';

interface InternalEntry extends MergeEntry {
  sources: string[];
}

/**
 * Quine–McCluskey 合并主流程：
 * 第 0 轮是 ON∪DC 最小项；逐轮按「固定位置一致且恰好一位相反」合并，
 * 同轮去重，未再被合并的条目最终收集为素蕴含项。
 * DC 始终参与合并（避免遗漏），但只覆盖 DC 的项在覆盖表前被剔除。
 */
export function runQuineMcCluskey(spec: ValidatedSpec): QmcResult {
  const { variables, variableCount } = spec;
  const onSorted = [...spec.on].sort((a, b) => a - b);
  const dcSorted = [...spec.dc].sort((a, b) => a - b);
  const onSet = new Set(onSorted);

  const startMinterms = [...new Set([...onSorted, ...dcSorted])].sort((a, b) => a - b);

  const rounds: MergeRound[] = [];
  const mergeSteps: MergeStep[] = [];
  const primeByPattern = new Map<string, PrimeImplicant>();

  let current: InternalEntry[] = startMinterms.map((m) => {
    const pattern = mintermToPattern(m, variableCount);
    return { pattern, minterms: [m], ones: countOnes(pattern), merged: false, sources: [] };
  });
  current.sort((a, b) => a.ones - b.ones || comparePattern(a.pattern, b.pattern));

  let round = 0;
  while (current.length > 0) {
    const nextByPattern = new Map<string, InternalEntry>();
    for (let i = 0; i < current.length; i += 1) {
      for (let k = i + 1; k < current.length; k += 1) {
        const a = current[i] as InternalEntry;
        const b = current[k] as InternalEntry;
        if (b.ones - a.ones > 1) break;
        if (b.ones - a.ones !== 1) continue;
        const position = mergePosition(a.pattern, b.pattern);
        if (position === -1) continue;

        a.merged = true;
        b.merged = true;
        const resultPattern = mergePatterns(a.pattern, b.pattern, position);

        const existing = nextByPattern.get(resultPattern);
        if (existing) {
          for (const src of [a.pattern, b.pattern]) {
            if (!existing.sources.includes(src)) existing.sources.push(src);
          }
        } else {
          nextByPattern.set(resultPattern, {
            pattern: resultPattern,
            minterms: [...new Set([...a.minterms, ...b.minterms])].sort((x, y) => x - y),
            ones: countOnes(resultPattern),
            merged: false,
            sources: [a.pattern, b.pattern],
          });
        }
        recordStep(mergeSteps, round + 1, a.pattern, b.pattern, resultPattern);
      }
    }

    // 在合并标记完成后再快照本轮，merged 才真实反映是否继续被扩展。
    rounds.push(snapshotRound(round, current));

    for (const entry of current) {
      if (!entry.merged) addPrime(primeByPattern, entry.pattern, onSet);
    }

    if (nextByPattern.size === 0) break;
    current = [...nextByPattern.values()].sort(
      (a, b) => a.ones - b.ones || comparePattern(a.pattern, b.pattern),
    );
    round += 1;
  }

  const allPrimeImplicants = [...primeByPattern.values()].sort((a, b) =>
    comparePattern(a.pattern, b.pattern),
  );
  const usable = allPrimeImplicants.filter((p) => p.coversOn.length > 0);

  const coverageRows = buildCoverageRows(onSorted, usable);
  const selections = selectCoverage(onSorted, usable);
  const chosenPatterns = selections.map((s) => s.pattern);

  const expressionMinterms = [...new Set(chosenPatterns.flatMap((p) => expandPattern(p)))].sort(
    (a, b) => a - b,
  );

  const constant: QmcResult['constant'] =
    chosenPatterns.length === 0
      ? 'false'
      : chosenPatterns.some((p) => countLiterals(p) === 0)
        ? 'true'
        : 'none';

  return {
    variables,
    on: onSorted,
    dc: dcSorted,
    rounds,
    mergeSteps,
    allPrimeImplicants,
    usablePrimeImplicants: usable,
    coverageTable: { onMinterms: onSorted, rows: coverageRows },
    selections,
    expression: '',
    expressionMinterms,
    verification: { passed: false, rows: [], checkedAt: '' },
    constant,
  };
}

function snapshotRound(round: number, entries: InternalEntry[]): MergeRound {
  return {
    round,
    entries: entries.map((e) => ({
      pattern: e.pattern,
      minterms: [...e.minterms],
      ones: e.ones,
      merged: e.merged,
    })),
  };
}

function recordStep(steps: MergeStep[], round: number, left: string, right: string, result: string): void {
  const [lo, hi] = comparePattern(left, right) <= 0 ? [left, right] : [right, left];
  if (steps.some((s) => s.round === round && s.left === lo && s.right === hi && s.result === result)) {
    return;
  }
  steps.push({ round, left: lo, right: hi, result });
}

function addPrime(map: Map<string, PrimeImplicant>, pattern: string, onSet: Set<number>): void {
  if (map.has(pattern)) return;
  const minterms = expandPattern(pattern);
  map.set(pattern, {
    pattern,
    minterms,
    coversOn: minterms.filter((m) => onSet.has(m)),
    literals: countLiterals(pattern),
  });
}

function buildCoverageRows(onMinterms: number[], primes: PrimeImplicant[]): CoverageRow[] {
  return primes.map((prime) => ({
    pattern: prime.pattern,
    marks: onMinterms.map((m) => (prime.coversOn.includes(m) ? '1' : '0')),
  }));
}

/**
 * 覆盖选择：
 * 1) 必需项：某 ON 只被唯一一个可用素蕴含项覆盖，则该项必选；
 * 2) 贪心补选：新增覆盖数量多 > 文字数少 > 模式固定排序（- < 0 < 1）。
 * 保证覆盖全部 ON 且不覆盖 OFF；不承诺全局最少项数或文字数。
 */
export function selectCoverage(onMinterms: number[], primes: PrimeImplicant[]): CoverageSelection[] {
  const selections: CoverageSelection[] = [];
  if (onMinterms.length === 0) return selections;

  const remaining = new Set(onMinterms);
  const chosen = new Set<string>();

  const choose = (prime: PrimeImplicant, reason: CoverageSelection['reason'], basis: string): void => {
    const newlyCovered = prime.coversOn.filter((m) => remaining.has(m));
    chosen.add(prime.pattern);
    for (const m of prime.coversOn) remaining.delete(m);
    const rationale =
      reason === 'essential'
        ? `必需项：${basis}；新增覆盖 {${newlyCovered.join(', ')}}`
        : `贪心补选：${basis}；新增覆盖 {${newlyCovered.join(', ')}}`;
    selections.push({ pattern: prime.pattern, reason, rationale, newlyCovered, basis });
  };

  let changed = true;
  while (remaining.size > 0 && changed) {
    changed = false;
    for (const m of [...remaining].sort((a, b) => a - b)) {
      const owners = primes.filter((p) => !chosen.has(p.pattern) && p.coversOn.includes(m));
      if (owners.length === 1) {
        const prime = owners[0] as PrimeImplicant;
        choose(prime, 'essential', `ON 最小项 ${m} 只被模式 ${prime.pattern} 覆盖`);
        changed = true;
        break;
      }
    }
  }

  while (remaining.size > 0) {
    let best: PrimeImplicant | undefined;
    let bestNew = -1;
    for (const prime of primes) {
      if (chosen.has(prime.pattern)) continue;
      const newCount = prime.coversOn.reduce((acc, m) => acc + (remaining.has(m) ? 1 : 0), 0);
      if (newCount === 0) continue;
      if (
        best === undefined ||
        newCount > bestNew ||
        (newCount === bestNew &&
          (prime.literals < best.literals ||
            (prime.literals === best.literals && comparePattern(prime.pattern, best.pattern) < 0)))
      ) {
        best = prime;
        bestNew = newCount;
      }
    }
    if (!best) break;
    choose(
      best,
      'greedy',
      `新增覆盖=${bestNew}（最多），文字数=${best.literals}，模式固定排序（-<0<1）选中 ${best.pattern}`,
    );
  }

  return selections;
}
