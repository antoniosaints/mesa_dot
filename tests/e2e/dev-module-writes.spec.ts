import { test } from './test.js';
import { expect } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

test('Vite não transforma um módulo temporariamente vazio durante gravação', async ({
  request,
}) => {
  const directory = resolve('.local/hmr');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, 'probe-' + randomUUID() + '.ts');
  const url = 'http://127.0.0.1:35173/@fs' + file;
  const source = (value: string) => `export const stableModuleProbe = '${value}';\n`;
  try {
    await writeFile(file, source('before'));
    const initial = await request.get(url);
    expect(initial.ok()).toBe(true);
    expect(await initial.text()).toContain('stableModuleProbe');
    await writeFile(file, '');
    // Simulate an editor's truncate/write gap, shorter than watcher stability.
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(await (await request.get(url)).text()).toContain('stableModuleProbe');
    await writeFile(file, source('after'));
    await expect.poll(async () => (await request.get(url)).text()).toContain('"after"');
  } finally {
    await rm(file, { force: true });
  }
});
