import { BASE_METRICS, worstStatus, type BaseMetric, type DataStatus, type Metric, type Value } from './domain.ts';
import { decimal, money } from './decimal.ts';

export type Calculation = Record<Metric, Value>;
export type Adjustment = { status: Exclude<DataStatus, 'Available'>; reasons: string[] };

// Formulas:
//   CM = (SI + OI) − SH        COGS = CRW + CSM + CPM      CI = CM − COGS
//   DC = LC + UC + MC + TC + AC + LP + TX                  DA = DA01 + DA02
//   EBITDA = CI − DC           EBIT = CI − (DC + DA)
// A result's status is the worst of its terms; its amount is always the exact sum.
// `adjust` lowers the status of a metric itself (e.g. DC while an HD Outlet
// expense still waits for its account code), and that flows into what uses it.
export const FORMULAS: [Metric, [Metric, bigint][]][] = [
  ['CM', [['SI', 1n], ['OI', 1n], ['SH', -1n]]],
  ['COGS', [['CRW', 1n], ['CSM', 1n], ['CPM', 1n]]],
  ['CI', [['CM', 1n], ['COGS', -1n]]],
  ['DC', [['LC', 1n], ['UC', 1n], ['MC', 1n], ['TC', 1n], ['AC', 1n], ['LP', 1n], ['TX', 1n]]],
  ['DA', [['DA01', 1n], ['DA02', 1n]]],
  ['EBITDA', [['CI', 1n], ['DC', -1n]]],
  ['EBIT', [['CI', 1n], ['DC', -1n], ['DA', -1n]]],
];

export class FinanceCalculationService {
  calculate(input: Partial<Record<BaseMetric, Value>>, adjust: Partial<Record<Metric, Adjustment>> = {}): Calculation {
    const result = {} as Calculation;
    for (const key of BASE_METRICS) {
      const value = input[key] ?? { amount: '0', status: 'Missing', reasons: [`${key}: data tidak tersedia`] };
      result[key] = merge({ ...value, amount: money(decimal(value.amount)) }, adjust[key]);
    }
    for (const [target, terms] of FORMULAS) {
      const values = terms.map(([key]) => result[key]);
      const computed: Value = {
        amount: money(terms.reduce((sum, [key, sign]) => sum + decimal(result[key].amount) * sign, 0n)),
        status: worstStatus(values.map(v => v.status)),
        reasons: [...new Set(values.flatMap(v => v.reasons))],
      };
      result[target] = merge(computed, adjust[target]);
    }
    return result;
  }
}

function merge(value: Value, adjustment?: Adjustment): Value {
  if (!adjustment) return value;
  return { amount: value.amount, status: worstStatus([value.status, adjustment.status]), reasons: [...new Set([...value.reasons, ...adjustment.reasons])] };
}
