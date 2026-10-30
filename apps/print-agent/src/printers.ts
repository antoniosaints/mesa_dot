import { z } from 'zod';
const target = z
  .object({ host: z.string().min(1).max(255), port: z.coerce.number().int().min(1).max(65535) })
  .strict();
export type PrinterTarget = z.infer<typeof target>;
export function printerTargets(
  environment: Record<string, string | undefined>,
): Record<string, PrinterTarget> {
  if (environment.PRINT_PRINTERS_JSON) {
    const mapping = z.record(z.uuid(), target).parse(JSON.parse(environment.PRINT_PRINTERS_JSON));
    if (!Object.keys(mapping).length) throw new Error('Mapeie ao menos uma impressora local.');
    return mapping;
  }
  const id = z.uuid().parse(environment.PRINT_PRINTER_ID);
  return {
    [id]: target.parse({
      host: environment.PRINT_HOST ?? '127.0.0.1',
      port: environment.PRINT_PORT ?? '9100',
    }),
  };
}
