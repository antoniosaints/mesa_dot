import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import net from 'node:net';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local');
const config = parse(readFileSync(resolve(root, '.env')));
const environment = { ...process.env, ...config };
for (const directory of ['logs', 'pids', 'redis-data'])
  mkdirSync(resolve(local, directory), { recursive: true, mode: 0o700 });
const url = new URL(config.DATABASE_URL);
const redis = new URL(config.REDIS_URL);
const apiPort = Number(config.API_PORT ?? 3000);
const node = process.execPath;
const services = [
  {
    name: 'mysql',
    port: Number(url.port || 3306),
    command: resolve(local, 'runtime/mysql/bin/mysqld'),
    args: [
      '--no-defaults',
      `--basedir=${resolve(local, 'runtime/mysql')}`,
      `--datadir=${resolve(local, 'mysql-data')}`,
      `--socket=${resolve(local, 'mysql.sock')}`,
      `--port=${url.port || 3306}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=OFF',
      `--pid-file=${resolve(local, 'mysql-server.pid')}`,
      `--log-error=${resolve(local, 'logs/mysql-server.log')}`,
    ],
    env: { LD_LIBRARY_PATH: resolve(local, 'runtime/libs') },
  },
  {
    name: 'redis',
    port: Number(redis.port || 6379),
    command: resolve(local, 'runtime/redis-server'),
    args: [
      '--bind',
      '127.0.0.1',
      '--protected-mode',
      'yes',
      '--port',
      redis.port || '6379',
      '--dir',
      resolve(local, 'redis-data'),
      '--appendonly',
      'yes',
      '--save',
      '60',
      '1',
    ],
  },
  {
    name: 'api',
    port: apiPort,
    command: node,
    args: [resolve(root, 'dist/apps/api/src/index.js')],
  },
  { name: 'worker', command: node, args: [resolve(root, 'dist/apps/worker/src/index.js')] },
  ...[
    ['admin-web', 5173],
    ['customer-pwa', 5174],
    ['waiter-pwa', 5175],
    ['kitchen-display', 5176],
  ].map(([name, port]) => ({
    name,
    port,
    command: node,
    args: [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    cwd: resolve(root, 'apps', name),
    env: {
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_CUSTOMER_URL: 'http://localhost:5174',
    },
  })),
];
const pidPath = (name) => resolve(local, 'pids', `${name}.pid`);
function managed(service) {
  try {
    const pid = Number(readFileSync(pidPath(service.name), 'utf8'));
    process.kill(pid, 0);
    const executable = readlinkSync(`/proc/${pid}/exe`);
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (
      executable === service.command &&
      (service.command !== node || command.includes(service.args[0]))
    )
      return pid;
  } catch {
    /* stopped or no longer belongs to this project */
  }
  return null;
}
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function waitFor(service) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!managed(service))
      throw new Error(`${service.name} encerrou. Consulte .local/logs/${service.name}.log.`);
    if (!service.port || (await listening(service.port))) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timeout de ${service.name}. Consulte .local/logs.`);
}
const action = process.argv[2] ?? 'start';
if (action === 'stop') {
  for (const service of [...services].reverse()) {
    const pid = managed(service);
    if (!pid) continue;
    process.kill(pid, 'SIGTERM');
    for (let attempt = 0; attempt < 40 && managed(service); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 200));
    if (!managed(service) && existsSync(pidPath(service.name))) unlinkSync(pidPath(service.name));
    console.log(`${service.name}: encerramento solicitado`);
  }
} else if (action === 'status') {
  for (const service of services)
    console.log(
      `${service.name}: ${managed(service) ? 'em execução' : 'parado'}${service.port ? ` (127.0.0.1:${service.port})` : ''}`,
    );
} else if (action === 'start' || action === 'deps') {
  const selected = action === 'deps' ? services.slice(0, 2) : services;
  for (const service of selected) {
    if (managed(service)) {
      console.log(`${service.name}: já está em execução`);
      continue;
    }
    if (service.port && (await listening(service.port)))
      throw new Error(
        `Porta ${service.port} em uso por outro processo. Nenhum serviço existente foi interrompido.`,
      );
    if (!existsSync(service.command)) throw new Error(`Runtime ausente: ${service.command}`);
    const log = openSync(resolve(local, 'logs', `${service.name}.log`), 'a', 0o600);
    const child = spawn(service.command, service.args, {
      cwd: service.cwd ?? root,
      env: { ...environment, ...service.env },
      detached: true,
      stdio: ['ignore', log, log],
    });
    await once(child, 'spawn');
    closeSync(log);
    writeFileSync(pidPath(service.name), String(child.pid), { mode: 0o600 });
    child.unref();
    await waitFor(service);
    console.log(`${service.name}: iniciado`);
  }
  if (action === 'start') {
    const health = await fetch(`http://127.0.0.1:${apiPort}/health/ready`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!health.ok) throw new Error('API ainda não está pronta. Consulte .local/logs/api.log.');
    console.log(
      'Admin: http://localhost:5173 | Cliente: http://localhost:5174 | Garçom: http://localhost:5175 | Cozinha: http://localhost:5176',
    );
  }
} else throw new Error('Use start, stop ou status.');
