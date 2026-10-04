/** CLI 入口：创建/查看函数、素蕴含项、合并轮次、覆盖矩阵、表达式、求值、报告、演示、启动服务。 */
import * as path from "node:path";
import { Store, validateSpec } from "./store";
import { startServer } from "./server";
import { patternOf, literalCount, QmError } from "./qm";
import { runDemo } from "./demo";

const DB_PATH =
  process.env.QM_DB ?? path.join(process.cwd(), "data", "qm.sqlite");

function openStore(): Store {
  return new Store(DB_PATH);
}

function readJsonArg(arg: string): unknown {
  try {
    return JSON.parse(arg);
  } catch {
    // 尝试当作文件路径
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    if (fs.existsSync(arg)) {
      return JSON.parse(fs.readFileSync(arg, "utf-8"));
    }
    throw new QmError("BAD_REQUEST", "无法解析 JSON 参数，也不是存在的文件：" + arg);
  }
}

function printRounds(store: Store, id: number): void {
  const f = store.getFunction(id);
  const n = f.variables.length;
  const terms = store.getRounds(id);
  const byRound = new Map<number, typeof terms>();
  for (const t of terms) {
    const arr = byRound.get(t.round) ?? [];
    arr.push(t);
    byRound.set(t.round, arr);
  }
  for (const [round, arr] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    console.log("第 " + round + " 轮（" + arr.length + " 项）：");
    for (const t of arr) {
      const src =
        t.sourcePairs.length > 0
          ? " 来源 " + t.sourcePairs.map((p) => p[0] + "+" + p[1]).join(", ")
          : "";
      console.log(
        "  #" +
          t.termId +
          "  " +
          patternOf(t.mask, t.bits, n) +
          "  覆盖[" +
          t.covers.join(",") +
          "]" +
          (t.merged ? "  →已合并" : "  ★素蕴含项") +
          src
      );
    }
  }
}

function printCoverTable(store: Store, id: number): void {
  const f = store.getFunction(id);
  const n = f.variables.length;
  const primes = store.getPrimes(id);
  const choices = store.getCoverChoices(id);
  const chosen = new Set(choices.map((c) => c.mask + ":" + c.bits));
  const header = "模式".padEnd(n + 2) + f.on.map((m) => String(m).padStart(3)).join("");
  console.log("覆盖矩阵（ON 编号：" + f.on.join(", ") + "）：");
  console.log(header);
  for (const p of primes) {
    const row = f.on
      .map((m) => (p.coversOn.includes(m) ? "  x" : "  ."))
      .join("");
    const mark = chosen.has(p.mask + ":" + p.bits) ? " *" : "";
    console.log(patternOf(p.mask, p.bits, n).padEnd(n + 2) + row + mark);
  }
  console.log("（* 为最终选中的项）");
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const store = openStore();
  try {
    switch (cmd) {
      case "serve": {
        const portArg = args.find((a) => a.startsWith("--port="));
        const port = portArg
          ? Number(portArg.split("=")[1])
          : Number(process.env.PORT ?? 0); // 默认选择空闲端口
        const { port: actual } = await startServer(store, port);
        console.log("QM 服务已启动：http://127.0.0.1:" + actual + " （数据库 " + DB_PATH + "）");
        return; // 保持进程
      }
      case "create": {
        const spec = validateSpec(readJsonArg(args[0]));
        const id = store.createFunction(spec);
        console.log(JSON.stringify(store.getFunction(id), null, 2));
        break;
      }
      case "update": {
        const id = Number(args[0]);
        const old = store.getFunction(id);
        const spec = validateSpec(readJsonArg(args[1]));
        const nid = store.createFunction(spec, old.groupId);
        console.log(JSON.stringify(store.getFunction(nid), null, 2));
        break;
      }
      case "validate": {
        const spec = validateSpec(readJsonArg(args[0]));
        console.log(JSON.stringify({ valid: true, normalized: spec }, null, 2));
        break;
      }
      case "list": {
        console.log(JSON.stringify(store.listFunctions(), null, 2));
        break;
      }
      case "show": {
        console.log(JSON.stringify(store.getFunction(Number(args[0])), null, 2));
        break;
      }
      case "primes": {
        const id = Number(args[0]);
        const f = store.getFunction(id);
        for (const p of store.getPrimes(id)) {
          console.log(
            patternOf(p.mask, p.bits, f.variables.length) +
              "  文字数 " +
              literalCount(p.mask) +
              "  覆盖ON [" +
              p.coversOn.join(", ") +
              "]"
          );
        }
        break;
      }
      case "rounds": {
        printRounds(store, Number(args[0]));
        break;
      }
      case "cover": {
        printCoverTable(store, Number(args[0]));
        break;
      }
      case "expr": {
        const id = Number(args[0]);
        const f = store.getFunction(id);
        console.log("表达式：F(" + f.variables.join(",") + ") = " + f.expression);
        for (const c of store.getCoverChoices(id)) {
          console.log(
            "  步骤" +
              c.step +
              "  " +
              patternOf(c.mask, c.bits, f.variables.length) +
              "  " +
              c.reason +
              "；新增覆盖 [" +
              c.newlyCovered.join(", ") +
              "]"
          );
        }
        break;
      }
      case "eval": {
        const id = Number(args[0]);
        const idx = Number(args[1]);
        console.log("F(" + idx + ") = " + (store.evalAt(id, idx) ? 1 : 0));
        break;
      }
      case "report": {
        const id = Number(args[0]);
        const f = store.getFunction(id);
        console.log(JSON.stringify(f, null, 2));
        printRounds(store, id);
        printCoverTable(store, id);
        console.log("表达式：F = " + f.expression);
        break;
      }
      case "demo": {
        runDemo(store);
        break;
      }
      default:
        console.log(
          [
            "用法：node dist/src/cli.js <命令> [参数]",
            "  serve [--port=N]        启动 HTTP API（默认自动选择空闲端口）",
            "  create '<json|文件>'    创建函数并计算",
            "  update <id> '<json>'    修改集合，创建新版本",
            "  validate '<json>'       仅校验",
            "  list / show <id>",
            "  primes <id>             素蕴含项",
            "  rounds <id>             合并轮次与来源",
            "  cover <id>              覆盖矩阵",
            "  expr <id>               表达式与选择理由",
            "  eval <id> <index>       求值",
            "  report <id>             完整报告",
            "  demo                    运行内置演示",
          ].join("\n")
        );
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main().catch((e) => {
  if (e instanceof QmError) {
    console.error("错误 [" + e.code + "] " + e.message);
  } else {
    console.error(e);
  }
  process.exitCode = 1;
});
