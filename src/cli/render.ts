import type { QmcResult } from '../core/types.js';

/** 终端渲染：零一横线模式、合并来源、覆盖矩阵。 */

export function renderRounds(result: QmcResult): string {
  const lines: string[] = [];
  lines.push('合并轮次（merged=✓ 表示该条目继续被合并，✗ 表示终止成为素蕴含项）：');
  for (const round of result.rounds) {
    lines.push(`  轮次 ${round.round}:`);
    for (const entry of round.entries) {
      lines.push(
        `    ${entry.pattern}  ones=${entry.ones}  minterms={${entry.minterms.join(',')}}  merged=${entry.merged ? '✓' : '✗'}`,
      );
    }
  }
  lines.push('');
  lines.push('合并关系（左 + 右 -> 结果）：');
  for (const step of result.mergeSteps) {
    lines.push(`  R${step.round}: ${step.left} + ${step.right} -> ${step.result}`);
  }
  if (result.mergeSteps.length === 0) lines.push('  （无可合并项）');
  return lines.join('\n');
}

export function renderPrimes(result: QmcResult, includeDcOnly: boolean): string {
  const primes = includeDcOnly
    ? result.allPrimeImplicants
    : result.usablePrimeImplicants;
  const lines: string[] = [];
  lines.push(
    includeDcOnly
      ? '全部素蕴含项（含只覆盖 DC 的中间项）：'
      : '可用素蕴含项（至少覆盖一个 ON）：',
  );
  for (const p of primes) {
    const tag = p.coversOn.length === 0 ? '  [DC-only]' : '';
    lines.push(
      `  ${p.pattern}  文字数=${p.literals}  覆盖={${p.minterms.join(',')}}  ON={${p.coversOn.join(',')}}${tag}`,
    );
  }
  if (primes.length === 0) lines.push('  （空）');
  return lines.join('\n');
}

export function renderCoverage(result: QmcResult): string {
  const { onMinterms, rows } = result.coverageTable;
  const lines: string[] = [];
  lines.push('覆盖矩阵（列按 ON 编号排序，x=覆盖）：');
  const header = 'pattern     | ' + onMinterms.map((m) => String(m).padStart(2, ' ')).join(' ');
  lines.push('  ' + header);
  lines.push('  ' + '-'.repeat(header.length + 2));
  for (const row of rows) {
    const cells = row.marks.map((mark) => (mark === '1' ? ' x' : ' .'));
    lines.push(`  ${row.pattern.padEnd(11)}| ${cells.join(' ')}`);
  }
  if (rows.length === 0) lines.push('  （空 ON，无需覆盖）');
  lines.push('');
  lines.push('选择过程：');
  if (result.selections.length === 0) {
    lines.push('  空 ON -> 规范结果为常假 0');
  }
  for (const selection of result.selections) {
    lines.push(`  [${selection.reason === 'essential' ? '必需' : '贪心'}] ${selection.pattern}`);
    lines.push(`      新增覆盖: {${selection.newlyCovered.join(', ')}}`);
    lines.push(`      依据: ${selection.basis}`);
  }
  return lines.join('\n');
}

export function renderExpression(result: QmcResult): string {
  const lines: string[] = [];
  lines.push(`表达式: ${result.expression}`);
  lines.push(`常量类型: ${result.constant}`);
  lines.push(`展开覆盖编号: {${result.expressionMinterms.join(', ')}}`);
  lines.push(`真值核验: ${result.verification.passed ? '通过 ✓' : '失败 ✗'}`);
  return lines.join('\n');
}

export function renderTruthTable(result: QmcResult): string {
  const lines: string[] = [];
  lines.push(`编号 赋值(${result.variables.join('')}) 规格 表达式`);
  for (const row of result.verification.rows) {
    lines.push(
      `${String(row.minterm).padStart(2)}   ${row.assignment}      ${row.spec.padEnd(3)}  ${row.expressionValue}${row.passed ? '' : '  ✗'}`,
    );
  }
  return lines.join('\n');
}

export function renderReport(result: QmcResult): string {
  return [
    `变量顺序(MSB..LSB): ${result.variables.join(', ')}`,
    `ON: {${result.on.join(', ')}}   DC: {${result.dc.join(', ')}}`,
    '',
    renderPrimes(result, true),
    '',
    renderRounds(result),
    '',
    renderCoverage(result),
    '',
    renderExpression(result),
    '',
    renderTruthTable(result),
  ].join('\n');
}
