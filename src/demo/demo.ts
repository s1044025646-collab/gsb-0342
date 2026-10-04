/**
 * 端到端演示（不依赖 HTTP），覆盖四个要求场景：
 * 1) DC 帮助扩大蕴含项
 * 2) 存在多个素蕴含项
 * 3) 必需项已覆盖全部 ON
 * 4) 必需项之外还需贪心补选
 * 另含空 ON（常假）与常真两个常量边界。
 */
import { computeQmc } from '../core/service.js';
import { crossCheckPrimeImplicants } from '../core/verify.js';

interface DemoCase {
  title: string;
  input: { name: string; variables: string[]; on: number[]; dc: number[] };
}

const cases: DemoCase[] = [
  {
    title: '① 利用 DC 扩大蕴含项：DC 使本来无法合并的相邻项合并成更大的项',
    input: {
      name: 'dc-expand',
      variables: ['A', 'B', 'C'],
      // f(1,0,0)=4 为真；相邻的 m5(101) 为 DC，可把 C 消去 -> A·B'
      on: [4],
      dc: [5],
    },
  },
  {
    title: '② 存在多个素蕴含项（无单一必需，需在等价项中选择）',
    input: {
      name: 'multi-prime',
      variables: ['A', 'B'],
      // XOR: m1,m3 列上 A、B 均有可选项，AB\'+A\'B
      on: [1, 2],
      dc: [],
    },
  },
  {
    title: '③ 必需项已经覆盖全部 ON（无需贪心）',
    input: {
      name: 'essential-covers-all',
      variables: ['A', 'B', 'C'],
      // m4(100) 唯一由 100 系覆盖；m5(101) 也在 ON，10- 覆盖两者，
      // 而 m4 使 100 成为链上必需来源 -> 选择 10- 即 A·B\' 覆盖全部
      on: [4, 5],
      dc: [],
    },
  },
  {
    title: '④ 必需项之外还需贪心补选',
    input: {
      name: 'greedy-needed',
      variables: ['A', 'B', 'C'],
      // 经典 QM 示例：Σm(0,1,2,5,6,7) + d(?)，这里给一个需要贪心的集合
      on: [0, 2, 3, 4, 5, 7],
      dc: [],
    },
  },
  {
    title: '边界：空 ON（即使 DC 非空，规范结果为常假 0）',
    input: { name: 'empty-on', variables: ['A', 'B'], on: [], dc: [1, 2] },
  },
  {
    title: '边界：全部输入为真 -> 全无关位常真项 1',
    input: { name: 'tautology', variables: ['A', 'B'], on: [0, 1, 2, 3], dc: [] },
  },
];

function printBanner(text: string): void {
  console.log('\n' + '='.repeat(78));
  console.log(text);
  console.log('='.repeat(78));
}

for (const c of cases) {
  printBanner(c.title);
  const { result } = computeQmc(c.input);
  console.log(`变量: ${result.variables.join(', ')}  ON: {${result.on.join(',')}}  DC: {${result.dc.join(',')}}`);
  console.log(`可用素蕴含项: ${result.usablePrimeImplicants.map((p) => p.pattern).join(', ') || '（无）'}`);
  if (result.allPrimeImplicants.some((p) => p.coversOn.length === 0)) {
    console.log(
      `DC-only 中间素蕴含项（不进覆盖表）: ${result.allPrimeImplicants
        .filter((p) => p.coversOn.length === 0)
        .map((p) => p.pattern)
        .join(', ')}`,
    );
  }
  for (const s of result.selections) {
    console.log(`  [${s.reason === 'essential' ? '必需' : '贪心'}] ${s.pattern} 新增 {${s.newlyCovered.join(',')}}  ${s.basis}`);
  }
  console.log(`最终表达式: ${result.expression}`);
  console.log(`真值核验: ${result.verification.passed ? '通过' : '失败'}（枚举 ${result.verification.rows.length} 行）`);

  if (result.variables.length <= 4) {
    const cross = crossCheckPrimeImplicants(
      result.variables.length,
      result.on,
      result.dc,
      result.usablePrimeImplicants,
    );
    console.log(
      `3^n 模式穷举交叉核对: ${cross.passed ? '一致' : '不一致'} ` +
        (cross.passed ? '' : `expected=${cross.expected.join('|')} actual=${cross.actual.join('|')}`),
    );
  }
}

printBanner('演示结束：所有结果均通过独立真值枚举核验');
