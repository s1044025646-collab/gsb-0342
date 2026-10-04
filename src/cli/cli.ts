#!/usr/bin/env node
import { resolve } from 'node:path';
import { QmcDatabase } from '../db/database.js';
import { computeQmc, evaluateResult } from '../core/service.js';
import { QmcError } from '../common/errors.js';
import type { QmcResult } from '../core/types.js';
import {
  renderCoverage,
  renderExpression,
  renderPrimes,
  renderReport,
  renderRounds,
  renderTruthTable,
} from './render.js';

/**
 * CLI：本地直接计算/落库/查询，展示零一横线模式、合并来源与覆盖矩阵。
 * 默认数据库 data/qmc.db，可用环境变量 QMC_DB 覆盖。
 */
const args = process.argv.slice(2);
const command = args[0];
const dbPath = resolve(process.cwd(), process.env.QMC_DB ?? 'data/qmc.db');

function parseList(value: string): number[] {
  if (value.trim() === '') return [];
  return value.split(',').map((s) => Number(s.trim()));
}

function parseSpecArgs(rest: string[]): { variables: string[]; on: number[]; dc: number[] } {
  let variables: string[] = [];
  let on: number[] = [];
  let dc: number[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] as string;
    const value = rest[i + 1] ?? '';
    if (flag === '--vars') variables = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--on') on = parseList(value);
    else if (flag === '--dc') dc = parseList(value);
  }
  if (variables.length === 0) {
    throw new QmcError('BAD_REQUEST', '必须用 --vars A,B,C 指定有序变量');
  }
  return { variables, on, dc };
}

function loadResult(db: QmcDatabase, idArg: string | undefined): { result: QmcResult; versionNo: number } {
  if (!idArg) throw new QmcError('BAD_REQUEST', '需要提供函数 id，可选 :版本号，例如 coverage 3:2');
  const [idRaw, versionRaw] = idArg.split(':');
  const fnId = Number(idRaw);
  const version = versionRaw
    ? db.getVersionByNo(fnId, Number(versionRaw))
    : db.getLatestComputed(fnId);
  if (!version.result) throw new QmcError('NOT_COMPUTED', '该版本无已保存结果', 409);
  return { result: version.result, versionNo: version.versionNo };
}

function usage(): string {
  return [
    '用法: qmc <命令> [参数]',
    '命令:',
    '  compute --vars A,B,C --on 4,8,10 --dc 0,2   计算并落库，打印完整报告',
    '  primes <id[:版本]> [--all]                    素蕴含项（--all 含 DC-only）',
    '  rounds <id[:版本]>                            逐轮合并与来源',
    '  coverage <id[:版本]>                          覆盖矩阵与选择理由',
    '  expression <id[:版本]>                        最终表达式',
    '  truth <id[:版本]>                             真值表核验',
    '  report <id[:版本]>                            完整文本报告',
    '  eval <id[:版本]> --input 6                    求指定输入编号的值',
    '  list                                          列出函数',
  ].join('\n');
}

function main(): void {
  const db = new QmcDatabase(dbPath);
  try {
    switch (command) {
      case 'compute': {
        const outcome = computeQmc(parseSpecArgs(args.slice(1)));
        const fn = db.createFunction('cli-function');
        const version = db.addComputedVersion(fn.functionId, outcome.spec, outcome.result, null);
        console.log(`已保存: functionId=${fn.functionId} versionNo=${version.versionNo}`);
        console.log(renderReport(outcome.result));
        break;
      }
      case 'primes':
        console.log(renderPrimes(loadResult(db, args[1]).result, args.includes('--all')));
        break;
      case 'rounds':
        console.log(renderRounds(loadResult(db, args[1]).result));
        break;
      case 'coverage':
        console.log(renderCoverage(loadResult(db, args[1]).result));
        break;
      case 'expression':
        console.log(renderExpression(loadResult(db, args[1]).result));
        break;
      case 'truth':
        console.log(renderTruthTable(loadResult(db, args[1]).result));
        break;
      case 'report':
        console.log(renderReport(loadResult(db, args[1]).result));
        break;
      case 'eval': {
        const { result } = loadResult(db, args[1]);
        const inputIndex = args.indexOf('--input');
        const input = Number(args[inputIndex + 1]);
        console.log(JSON.stringify(evaluateResult(result, input), null, 2));
        break;
      }
      case 'list':
        for (const fn of db.listFunctions()) {
          console.log(`id=${fn.functionId} name=${fn.name} 最新版本=${fn.latestVersionNo}`);
        }
        break;
      default:
        console.log(usage());
        if (command) process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  if (err instanceof QmcError) console.error(`错误[${err.code}]: ${err.message}`);
  else console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
