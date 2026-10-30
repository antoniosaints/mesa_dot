import { describe, expect, it } from 'vitest';
import {
  applyBusinessHoursDays,
  businessAvailability,
  businessHoursSchema,
  readBusinessHours,
  type BusinessHours,
} from '../packages/shared/src/business-hours.js';
function schedule(): BusinessHours {
  const value = readBusinessHours(null);
  return {
    ...value,
    enabled: true,
    days: value.days.map((day) => ({ ...day, enabled: false, periods: [] })),
  };
}
function open(hours: BusinessHours, instant: string, is_open = true) {
  return businessAvailability({ is_open, opening_hours: hours }, new Date(instant));
}
describe('agenda semanal de funcionamento', () => {
  it('preserva horários legados como descritivos e respeita a pausa manual', () => {
    const legacy = { daily: '17:00 - 02:00' };
    expect(readBusinessHours(legacy).enabled).toBe(false);
    expect(readBusinessHours(legacy).days[0].periods).toEqual([{ start: '17:00', end: '02:00' }]);
    expect(
      businessAvailability({ is_open: 1, opening_hours: legacy }, new Date('2026-10-26T12:00:00Z'))
        .is_open,
    ).toBe(true);
    expect(businessAvailability({ is_open: false, opening_hours: legacy }).reason).toBe(
      'MANUALLY_CLOSED',
    );
  });
  it('usa Brasília, inclui a abertura, exclui o fechamento e permite dois turnos', () => {
    const hours = schedule();
    hours.days[1] = {
      weekday: 1,
      enabled: true,
      all_day: false,
      periods: [
        { start: '11:00', end: '14:00' },
        { start: '18:00', end: '23:00' },
      ],
    };
    expect(businessHoursSchema.safeParse(hours).success).toBe(true);
    expect(open(hours, '2026-10-26T13:59:59Z').is_open).toBe(false);
    expect(open(hours, '2026-10-26T14:00:00Z').is_open).toBe(true);
    expect(open(hours, '2026-10-26T17:00:00Z').is_open).toBe(false);
    expect(open(hours, '2026-10-26T21:00:00Z').is_open).toBe(true);
    expect(open(hours, '2026-10-27T02:00:00Z').is_open).toBe(false);
  });
  it('continua o período noturno do dia anterior e atravessa o fim da semana', () => {
    const hours = schedule();
    hours.days[6] = {
      weekday: 6,
      enabled: true,
      all_day: false,
      periods: [{ start: '20:00', end: '02:00' }],
    };
    expect(open(hours, '2026-11-01T03:00:00Z').is_open).toBe(true);
    expect(open(hours, '2026-11-01T04:59:59Z').is_open).toBe(true);
    expect(open(hours, '2026-11-01T05:00:00Z').is_open).toBe(false);
    expect(open(hours, '2026-10-31T22:59:00Z').is_open).toBe(false);
  });
  it('aceita 24 horas e todos os dias fechados', () => {
    const hours = schedule();
    expect(businessHoursSchema.safeParse(hours).success).toBe(true);
    expect(open(hours, '2026-10-26T12:00:00Z').reason).toBe('OUTSIDE_HOURS');
    hours.days[1] = { weekday: 1, enabled: true, all_day: true, periods: [] };
    expect(businessHoursSchema.safeParse(hours).success).toBe(true);
    expect(open(hours, '2026-10-26T03:00:00Z').is_open).toBe(true);
    expect(open(hours, '2026-10-27T02:59:59Z').is_open).toBe(true);
    expect(open(hours, '2026-10-27T03:00:00Z').is_open).toBe(false);
    expect(open(hours, '2026-10-26T12:00:00Z', false).is_open).toBe(false);
  });
  it('rejeita dias duplicados, horários inválidos, períodos vazios e sobrepostos', () => {
    const hours = schedule();
    hours.days[1] = {
      weekday: 1,
      enabled: true,
      all_day: false,
      periods: [{ start: '20:00', end: '02:00' }],
    };
    hours.days[2] = {
      weekday: 2,
      enabled: true,
      all_day: false,
      periods: [{ start: '01:00', end: '04:00' }],
    };
    expect(businessHoursSchema.safeParse(hours).success).toBe(false);
    hours.days[2].enabled = false;
    hours.days[1].periods[0].start = '25:00';
    expect(businessHoursSchema.safeParse(hours).success).toBe(false);
    hours.days[1].periods = [];
    expect(businessHoursSchema.safeParse(hours).success).toBe(false);
    hours.days[1].periods = [{ start: '12:00', end: '12:00' }];
    expect(businessHoursSchema.safeParse(hours).success).toBe(false);
    hours.days[1].periods = [{ start: '12:00', end: '13:00' }];
    hours.days[0].weekday = 1;
    expect(businessHoursSchema.safeParse(hours).success).toBe(false);
  });
});

describe('horário compartilhado entre dias selecionados', () => {
  it('aplica vários períodos somente aos dias selecionados, com cópias independentes', () => {
    const hours = schedule();
    hours.days[2].periods = [{ start: '10:00', end: '17:00' }];
    const before = structuredClone(hours);
    const template = {
      enabled: true,
      all_day: false,
      periods: [
        { start: '11:00', end: '14:00' },
        { start: '18:00', end: '23:00' },
      ],
    };
    const result = applyBusinessHoursDays(hours, [1, 3, 6], template);
    expect(result.enabled).toBe(hours.enabled);
    for (const weekday of [1, 3, 6]) expect(result.days[weekday]).toEqual({ ...template, weekday });
    for (const weekday of [0, 2, 4, 5]) expect(result.days[weekday]).toEqual(hours.days[weekday]);
    result.days[1].periods[0].start = '12:00';
    expect(result.days[3].periods[0].start).toBe('11:00');
    expect(template.periods[0].start).toBe('11:00');
    expect(hours).toEqual(before);
  });
  it('permite aplicar 24 horas ou fechar dias sem manter períodos residuais', () => {
    const hours = schedule();
    const allDay = applyBusinessHoursDays(hours, [1, 2, 3, 4, 5, 6, 0], {
      enabled: true,
      all_day: true,
      periods: [{ start: '09:00', end: '18:00' }],
    });
    expect(allDay.days.every((day) => day.all_day && day.enabled && day.periods.length === 0)).toBe(
      true,
    );
    const closed = applyBusinessHoursDays(allDay, [0, 6], {
      enabled: false,
      all_day: false,
      periods: [],
    });
    expect(closed.days[0].enabled).toBe(false);
    expect(closed.days[6].enabled).toBe(false);
    expect(closed.days[5]).toEqual(allDay.days[5]);
  });
  it('valida seleção, horários e conflitos com o dia seguinte antes de alterar a agenda', () => {
    const hours = schedule(),
      template = { enabled: true, all_day: false, periods: [{ start: '20:00', end: '02:00' }] };
    expect(() => applyBusinessHoursDays(hours, [], template)).toThrow(
      'Selecione pelo menos um dia',
    );
    expect(() => applyBusinessHoursDays(hours, [7], template)).toThrow('dias válidos');
    expect(() =>
      applyBusinessHoursDays(hours, [1], {
        ...template,
        periods: [{ start: '25:00', end: '02:00' }],
      }),
    ).toThrow();
    const night = applyBusinessHoursDays(hours, [6], template),
      before = structuredClone(night);
    expect(() =>
      applyBusinessHoursDays(night, [0], {
        ...template,
        periods: [{ start: '01:00', end: '04:00' }],
      }),
    ).toThrow('sobrepostos');
    expect(night).toEqual(before);
  });
});
