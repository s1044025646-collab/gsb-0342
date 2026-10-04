import { resolve } from 'node:path';
import { QmcDatabase } from '../db/database.js';
import { createApp } from './http.js';

/**
 * 启动入口：
 * - 端口：环境变量 PORT 或 --port；默认 0（操作系统分配空闲端口）。
 * - 数据库：项目内 data/qmc.db，可用 --db 或 QMC_DB 覆盖。
 */
function parseArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) return args[index + 1];
  return undefined;
}

const port = Number(parseArg('--port') ?? process.env.PORT ?? '0');
const dbPath = resolve(process.cwd(), parseArg('--db') ?? process.env.QMC_DB ?? 'data/qmc.db');

const db = new QmcDatabase(dbPath);
const server = createApp(db);

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(JSON.stringify({
    service: 'qmc-backend',
    status: 'listening',
    host: '127.0.0.1',
    port: actualPort,
    db: dbPath,
  }, null, 2));
});

const shutdown = (): void => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
