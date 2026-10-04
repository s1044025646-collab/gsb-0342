/** HTTP API（node:http，无外部依赖）。 */
import * as http from "node:http";
import { Store, validateSpec } from "./store";
import { QmError, patternOf, literalCount } from "./qm";

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendError(res: http.ServerResponse, e: unknown): void {
  if (e instanceof QmError) {
    const httpCode =
      e.code === "NOT_FOUND"
        ? 404
        : e.code === "SCALE_LIMIT"
        ? 413
        : e.code === "NOT_VERIFIED"
        ? 409
        : 400;
    send(res, httpCode, { error: { code: e.code, message: e.message } });
  } else {
    send(res, 500, {
      error: { code: "INTERNAL", message: String(e) },
    });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new QmError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","functions","1","primes"]
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true });
      }
      if (parts[0] !== "api" || parts[1] !== "functions") {
        throw new QmError("NOT_FOUND", "未知路径：" + url.pathname);
      }

      // POST /api/functions  创建函数
      if (parts.length === 2 && method === "POST") {
        const spec = validateSpec(await readBody(req));
        const id = store.createFunction(spec);
        return send(res, 201, store.getFunction(id));
      }
      // GET /api/functions  列表
      if (parts.length === 2 && method === "GET") {
        return send(res, 200, { functions: store.listFunctions() });
      }

      const id = Number(parts[2]);
      if (!Number.isInteger(id)) {
        throw new QmError("BAD_REQUEST", "函数 id 必须是整数");
      }
      const sub = parts[3];

      // GET /api/functions/:id
      if (!sub && method === "GET") {
        return send(res, 200, store.getFunction(id));
      }
      // PUT /api/functions/:id  修改集合，创建新版本
      if (!sub && method === "PUT") {
        const old = store.getFunction(id);
        const spec = validateSpec(await readBody(req));
        const nid = store.createFunction(spec, old.groupId);
        return send(res, 201, store.getFunction(nid));
      }
      // POST /api/functions/:id/validate  仅校验不保存
      if (sub === "validate" && method === "POST") {
        const spec = validateSpec(await readBody(req));
        return send(res, 200, { valid: true, normalized: spec });
      }

      const f = store.getFunction(id);
      const nvars = f.variables.length;

      // GET /api/functions/:id/primes
      if (sub === "primes" && method === "GET") {
        const primes = store.getPrimes(id).map((p) => ({
          pattern: patternOf(p.mask, p.bits, nvars),
          literals: literalCount(p.mask),
          coversOn: p.coversOn,
        }));
        return send(res, 200, { primes });
      }
      // GET /api/functions/:id/rounds
      if (sub === "rounds" && method === "GET") {
        const terms = store.getRounds(id).map((t) => ({
          ...t,
          pattern: patternOf(t.mask, t.bits, nvars),
        }));
        const rounds: Record<number, typeof terms> = {};
        for (const t of terms) {
          (rounds[t.round] ??= []).push(t);
        }
        return send(res, 200, { rounds });
      }
      // GET /api/functions/:id/cover-table
      if (sub === "cover-table" && method === "GET") {
        const primes = store.getPrimes(id);
        const rows = primes.map((p) => {
          const cells: Record<string, string> = {};
          for (const m of f.on) {
            cells[String(m)] = p.coversOn.includes(m) ? "x" : ".";
          }
          return { pattern: patternOf(p.mask, p.bits, nvars), cells };
        });
        return send(res, 200, { on: f.on, rows });
      }
      // GET /api/functions/:id/expression
      if (sub === "expression" && method === "GET") {
        const choices = store.getCoverChoices(id).map((c) => ({
          ...c,
          pattern: patternOf(c.mask, c.bits, nvars),
        }));
        return send(res, 200, {
          expression: f.expression,
          choices,
          note: "该覆盖保证正确（覆盖全部 ON、不覆盖 OFF），但不承诺全局最少项或最少文字。",
        });
      }
      // POST /api/functions/:id/eval  {index} 或 {assignment:{A:1,...}}
      if (sub === "eval" && method === "POST") {
        const body = (await readBody(req)) as Record<string, unknown>;
        let idx: number;
        if (typeof body.index === "number") {
          idx = body.index;
        } else if (typeof body.assignment === "object" && body.assignment) {
          idx = 0;
          const a = body.assignment as Record<string, unknown>;
          for (let i = 0; i < nvars; i++) {
            const name = f.variables[i];
            const v = a[name];
            if (v !== 0 && v !== 1 && v !== false && v !== true) {
              throw new QmError(
                "BAD_REQUEST",
                "assignment 缺少变量 " + name + " 的 0/1 取值"
              );
            }
            if (v === 1 || v === true) idx |= 1 << (nvars - 1 - i);
          }
        } else {
          throw new QmError("BAD_REQUEST", "需要提供 index 或 assignment");
        }
        return send(res, 200, { index: idx, value: store.evalAt(id, idx) });
      }
      // GET /api/functions/:id/report?page=1&size=50
      if (sub === "report" && method === "GET") {
        const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
        const size = Math.min(
          500,
          Math.max(1, Number(url.searchParams.get("size") ?? 100))
        );
        const primes = store.getPrimes(id).map((p) => ({
          pattern: patternOf(p.mask, p.bits, nvars),
          coversOn: p.coversOn,
        }));
        const start = (page - 1) * size;
        return send(res, 200, {
          function: f,
          primes: {
            total: primes.length,
            page,
            size,
            items: primes.slice(start, start + size),
          },
          coverChoices: store.getCoverChoices(id).map((c) => ({
            ...c,
            pattern: patternOf(c.mask, c.bits, nvars),
          })),
          expression: f.expression,
        });
      }
      throw new QmError(
        "NOT_FOUND",
        "未知路径或方法：" + method + " " + url.pathname
      );
    } catch (e) {
      sendError(res, e);
    }
  });
}

/** 启动服务；port=0 时由系统分配空闲端口（默认行为） */
export function startServer(
  store: Store,
  port: number
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
  });
}
