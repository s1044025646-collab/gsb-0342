import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { QmcDatabase, type StoredVersion } from '../db/database.js';
import { QmcError } from '../common/errors.js';
import { computeQmc, evaluateResult } from '../core/service.js';
import { validateInputNumber } from '../core/validation.js';
import type { QmcResult } from '../core/types.js';

/**
 * 纯后端 JSON API。端口可配置；端口 0/缺省时由操作系统分配空闲端口。
 * 计算在事务内完成，只有真值核验通过的结果才以 status=computed 发布。
 */
export function createApp(db: QmcDatabase): Server {
  return createServer((req, res) => {
    handle(req, res, db).catch((err: unknown) => sendError(res, err));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, db: QmcDatabase): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (method === 'GET' && path === '/api/functions') {
    sendJson(res, 200, { functions: db.listFunctions() });
    return;
  }

  if (method === 'POST' && path === '/api/functions') {
    const body = await readJson(req);
    const outcome = computeQmc(body);
    const name =
      typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'function';
    const fn = db.createFunction(name);
    const version = db.addComputedVersion(fn.functionId, outcome.spec, outcome.result, null);
    sendJson(res, 201, { function: fn, version: versionSummary(version), result: version.result });
    return;
  }

  const m = path.match(/^\/api\/functions\/(\d+)(?:\/versions\/(\d+))?(\/.*)?$/);
  if (m) {
    const functionId = Number(m[1]);
    const versionNo = m[2] ? Number(m[2]) : null;
    const sub = m[3] ?? '';

    const getVersion = (): StoredVersion =>
      versionNo === null
        ? db.getLatestComputed(functionId)
        : db.getVersionByNo(functionId, versionNo);

    if (method === 'GET' && sub === '') {
      if (versionNo === null) {
        sendJson(res, 200, { function: db.getFunction(functionId), versions: db.listVersions(functionId) });
        return;
      }
      const version = getVersion();
      sendJson(res, 200, { version: versionSummary(version), result: version.result });
      return;
    }

    if (method === 'POST' && sub === '/versions') {
      db.getFunction(functionId);
      const body = await readJson(req);
      const outcome = computeQmc(body);
      const version = db.addComputedVersion(functionId, outcome.spec, outcome.result, null);
      sendJson(res, 201, { version: versionSummary(version), result: version.result });
      return;
    }

    if (method === 'GET' && sub === '/evaluate') {
      const result = requireResult(getVersion());
      const raw = url.searchParams.get('input');
      const input = validateInputNumber(
        raw === null ? undefined : Number(raw),
        result.variables.length,
      );
      sendJson(res, 200, evaluateResult(result, input));
      return;
    }

    if (method === 'GET') {
      const result = requireResult(getVersion());
      if (sub === '/primes') {
        const primes =
          url.searchParams.get('dcOnly') === 'true'
            ? result.allPrimeImplicants
            : result.usablePrimeImplicants;
        sendJson(res, 200, paginate(url, primes, 'primes'));
        return;
      }
      if (sub === '/rounds') {
        sendJson(res, 200, { rounds: result.rounds, mergeSteps: result.mergeSteps });
        return;
      }
      if (sub === '/coverage') {
        sendJson(res, 200, { coverageTable: result.coverageTable, selections: result.selections });
        return;
      }
      if (sub === '/expression') {
        sendJson(res, 200, {
          expression: result.expression,
          constant: result.constant,
          selections: result.selections,
          expressionMinterms: result.expressionMinterms,
        });
        return;
      }
      if (sub === '/verify') {
        sendJson(res, 200, { verification: result.verification });
        return;
      }
      if (sub === '/report') {
        sendJson(res, 200, buildReport(url, result));
        return;
      }
    }
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `无此路由：${method} ${path}` } });
}

function requireResult(version: StoredVersion): QmcResult {
  if (version.status !== 'computed' || !version.result) {
    throw new QmcError('NOT_COMPUTED', `版本 ${version.versionNo} 未成功计算，无结果可读`, 409);
  }
  return version.result;
}

function versionSummary(version: StoredVersion): unknown {
  return {
    versionId: version.versionId,
    versionNo: version.versionNo,
    status: version.status,
    algorithmVersion: version.algorithmVersion,
    expression: version.expression,
    constant: version.constant,
    verificationPassed: version.verificationPassed,
    createdAt: version.createdAt,
  };
}

/**
 * 列表分页。注意：计算阶段始终生成全部素蕴含项，分页仅是展示窗口，
 * total 反映真实总数，不会把尚未展示的项当作不存在。
 */
function paginate(url: URL, items: unknown[], key: string): unknown {
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '20', 10);
  if (!Number.isFinite(pageSizeRaw) || pageSizeRaw < 1 || pageSizeRaw > 200) {
    throw new QmcError('INVALID_PAGINATION', 'pageSize 必须是 1..200 的整数');
  }
  const start = (page - 1) * pageSizeRaw;
  return {
    [key]: items.slice(start, start + pageSizeRaw),
    page,
    pageSize: pageSizeRaw,
    total: items.length,
    totalPages: Math.ceil(items.length / pageSizeRaw),
  };
}

/**
 * 报告导出：素蕴含项/选择/表达式始终完整给出；
 * 仅 truthRows 支持分页窗口，避免超长输出。
 */
function buildReport(url: URL, result: QmcResult): unknown {
  const allRows = result.verification.rows;
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(allRows.length || 1), 10) || 64),
  );
  const start = (page - 1) * pageSize;
  return {
    variables: result.variables,
    on: result.on,
    dc: result.dc,
    expression: result.expression,
    constant: result.constant,
    usablePrimeImplicants: result.usablePrimeImplicants,
    allPrimeImplicants: result.allPrimeImplicants,
    selections: result.selections,
    rounds: result.rounds,
    mergeSteps: result.mergeSteps,
    verification: {
      passed: result.verification.passed,
      checkedAt: result.verification.checkedAt,
      totalRows: allRows.length,
      rows: allRows.slice(start, start + pageSize),
      page,
      pageSize,
    },
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new QmcError('BAD_REQUEST', '请求体不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new QmcError('BAD_REQUEST', '请求体必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof QmcError) {
    sendJson(res, err.httpStatus, {
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { error: { code: 'INTERNAL', message } });
}
