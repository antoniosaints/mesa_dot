import { z } from 'zod';
export const businessTimeZone = 'America/Sao_Paulo';
export const weekdayNames = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Informe um horário válido (HH:MM).');
const period = z.strictObject({ start: time, end: time });
const day = z.strictObject({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  all_day: z.boolean(),
  periods: z.array(period).max(4),
});
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const weekMinutes = 7 * 1440;
function segments(days: z.infer<typeof day>[]) {
  return days.flatMap((entry) => {
    if (!entry.enabled) return [];
    const periods = entry.all_day ? [{ start: '00:00', end: '00:00' }] : entry.periods;
    return periods.flatMap((item) => {
      const start = entry.weekday * 1440 + minutes(item.start);
      let end = entry.weekday * 1440 + minutes(item.end);
      if (end <= start) end += 1440;
      return end > weekMinutes
        ? [
            [start, weekMinutes],
            [0, end - weekMinutes],
          ]
        : [[start, end]];
    });
  });
}
export const businessHoursSchema = z
  .strictObject({
    enabled: z.boolean(),
    timezone: z.literal(businessTimeZone),
    days: z.array(day).length(7),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.days.map((item) => item.weekday)).size !== 7)
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Informe cada dia da semana uma única vez.',
      });
    for (const [index, entry] of value.days.entries()) {
      if (entry.enabled && !entry.all_day && !entry.periods.length)
        ctx.addIssue({
          code: 'custom',
          path: ['days', index, 'periods'],
          message: 'Informe pelo menos um período para o dia aberto.',
        });
      for (const [position, item] of entry.periods.entries())
        if (item.start === item.end)
          ctx.addIssue({
            code: 'custom',
            path: ['days', index, 'periods', position],
            message:
              'A abertura e o fechamento devem ser diferentes. Para o dia inteiro, use 24 horas.',
          });
    }
    const ranges = segments(value.days).sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1][1]))
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message:
          'Existem períodos sobrepostos. Confira também os horários que terminam no dia seguinte.',
      });
  });
export type BusinessHours = z.infer<typeof businessHoursSchema>;
/** Apply one template without changing unselected days; validate the complete weekly agenda. */
export function applyBusinessHoursDays(
  hours: BusinessHours,
  weekdays: number[],
  template: Omit<BusinessHours['days'][number], 'weekday'>,
): BusinessHours {
  if (!weekdays.length) throw new Error('Selecione pelo menos um dia para aplicar o horário.');
  if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    throw new Error('Selecione dias válidos da semana.');
  const selected = new Set(weekdays);
  return businessHoursSchema.parse({
    ...hours,
    days: hours.days.map((day) => {
      if (!selected.has(day.weekday))
        return { ...day, periods: day.periods.map((period) => ({ ...period })) };
      const value = selected.has(day.weekday) ? { ...template, weekday: day.weekday } : day;
      return {
        ...value,
        periods:
          value.enabled && !value.all_day ? value.periods.map((period) => ({ ...period })) : [],
      };
    }),
  });
}
export function readBusinessHours(value: unknown): BusinessHours {
  const parsed = businessHoursSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Legacy hours were descriptive only. Import the daily period without enabling enforcement.
  const legacy = value && typeof value === 'object' && 'daily' in value ? String(value.daily) : '';
  const match = legacy.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  const start = match && time.safeParse(match[1]).success ? match[1] : '09:00';
  const end = match && time.safeParse(match[2]).success && match[2] !== start ? match[2] : '18:00';
  return {
    enabled: false,
    timezone: businessTimeZone,
    days: weekdayNames.map((_, weekday) => ({
      weekday,
      enabled: true,
      all_day: false,
      periods: [{ start, end }],
    })),
  };
}
export function businessAvailability(
  unit: { is_open: unknown; opening_hours?: unknown },
  now = new Date(),
) {
  const hours = readBusinessHours(unit.opening_hours);
  const manualOpen = unit.is_open === true || unit.is_open === 1;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: businessTimeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts.find((item) => item.type === 'weekday')!.value,
  );
  const point =
    weekday * 1440 +
    Number(parts.find((item) => item.type === 'hour')!.value) * 60 +
    Number(parts.find((item) => item.type === 'minute')!.value);
  const withinHours =
    !hours.enabled || segments(hours.days).some(([start, end]) => point >= start && point < end);
  return {
    is_open: manualOpen && withinHours,
    schedule_enabled: hours.enabled,
    reason: !manualOpen ? 'MANUALLY_CLOSED' : !withinHours ? 'OUTSIDE_HOURS' : 'OPEN',
    message: !manualOpen
      ? 'O estabelecimento está com os pedidos pausados.'
      : !withinHours
        ? 'Estamos fora do horário de funcionamento. Consulte os horários para fazer seu pedido.'
        : 'Aberto para pedidos',
  };
}
export function dayHoursLabel(entry: BusinessHours['days'][number]) {
  if (!entry.enabled) return 'Fechado';
  if (entry.all_day) return '24 horas';
  return entry.periods
    .map((item) => `${item.start} às ${item.end}${item.end < item.start ? ' (dia seguinte)' : ''}`)
    .join(' · ');
}
