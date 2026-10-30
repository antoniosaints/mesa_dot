import { Socket } from 'node:net';
import { env } from '../../../packages/shared/src/config.js';
import { printerTargets, type PrinterTarget } from './printers.js';
import { escpos } from './escpos.js';
const base = process.env.PRINT_API_URL ?? 'http://localhost:3000/api/v1';
const printers = printerTargets(process.env);
const credential = process.env.PRINT_AGENT_TOKEN;
if (!credential) throw new Error('Configure PRINT_AGENT_TOKEN obtido no painel administrativo.');
if (env.NODE_ENV === 'production' && !base.startsWith('https://'))
  throw new Error('Agente em produção exige HTTPS.');
async function api(path: string, body?: unknown, key = crypto.randomUUID()) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Falha na API');
  return data;
}
async function send(data: Buffer, printer: PrinterTarget) {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(10000);
    socket.on('error', reject);
    socket.on('timeout', () => socket.destroy(new Error('Timeout da impressora')));
    socket.connect(printer.port, printer.host, () => socket.end(data));
    socket.on('close', (hadError) =>
      hadError ? reject(new Error('Falha na conexão da impressora')) : resolve(),
    );
  });
}
let running = true;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    running = false;
  });
while (running) {
  try {
    const job = await api('/print/jobs/claim', { printer_ids: Object.keys(printers) });
    if (!job.idle) {
      try {
        const document = await api(`/print/jobs/${job.id}/document`);
        const printer = printers[job.printer.id];
        if (!printer) throw new Error('Impressora não mapeada neste agente.');
        if ((await api(`/print/jobs/${job.id}/state`)).status === 'PROCESSING') {
          await send(escpos(document), printer);
          await api(`/print/jobs/${job.id}/finish`, { success: true });
        }
      } catch (error) {
        await api(`/print/jobs/${job.id}/finish`, {
          success: false,
          error: error instanceof Error ? error.message : 'Falha',
        });
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'print.error',
        message: error instanceof Error ? error.message : 'Falha',
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
