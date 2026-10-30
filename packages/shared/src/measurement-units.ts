/** Catálogo padrão, também cadastrado pela migration 0025. Não converte quantidades. */
export const measurementUnits = [
  { code: 'UN', name: 'Unidade', symbol: 'un' },
  { code: 'KG', name: 'Quilograma', symbol: 'kg' },
  { code: 'G', name: 'Grama', symbol: 'g' },
  { code: 'MG', name: 'Miligrama', symbol: 'mg' },
  { code: 'L', name: 'Litro', symbol: 'L' },
  { code: 'ML', name: 'Mililitro', symbol: 'ml' },
  { code: 'DZ', name: 'Dúzia', symbol: 'dz' },
  { code: 'CX', name: 'Caixa', symbol: 'cx' },
  { code: 'PCT', name: 'Pacote', symbol: 'pct' },
  { code: 'FD', name: 'Fardo', symbol: 'fd' },
  { code: 'GRF', name: 'Garrafa', symbol: 'grf' },
  { code: 'LT', name: 'Lata', symbol: 'lata' },
  { code: 'PR', name: 'Porção', symbol: 'porção' },
] as const;
export type MeasurementUnitCode = (typeof measurementUnits)[number]['code'];
export const measurementUnitCodes = measurementUnits.map((unit) => unit.code) as [
  MeasurementUnitCode,
  ...MeasurementUnitCode[],
];
export function measurementUnit(code: unknown) {
  return measurementUnits.find((unit) => unit.code === code) ?? measurementUnits[0];
}
export const unitSymbol = (code: unknown) => measurementUnit(code).symbol;
