import { BASE_METRICS, missing, type BaseMetric, type Metric, type Value } from './domain.ts';
import { decimal, money } from './decimal.ts';
export type Calculation = Record<Metric, Value>;
export class FinanceCalculationService {
  calculate(input: Partial<Record<BaseMetric, Value>>): Calculation {
    const result = Object.fromEntries(BASE_METRICS.map(key => [key, input[key] ?? missing(`${key}: coverage unavailable`)])) as Calculation;
    for (const key of BASE_METRICS) {
      const value = result[key];
      if (value.status === 'Available' && value.amount !== null) result[key] = { ...value, amount: money(decimal(value.amount)) };
      else result[key] = { ...value, amount: null, status: value.status === 'Available' ? 'Missing' : value.status };
    }
    const compute = (target: Metric, terms: [Metric, bigint][]) => {
      const unavailable = terms.map(([key]) => result[key]).filter(value => value.status !== 'Available' || value.amount === null);
      if (unavailable.length) {
        const status = unavailable.some(v => v.status === 'Error') ? 'Error' : unavailable.some(v => v.status === 'Unmapped') ? 'Unmapped' : 'Missing';
        result[target] = { amount: null, status, reasons: [...new Set(unavailable.flatMap(v => v.reasons))] };
      } else result[target] = { amount: money(terms.reduce((sum, [key, sign]) => sum + decimal(result[key].amount!) * sign, 0n)), status: 'Available', reasons: [] };
    };
    compute('CM', [['SI', 1n], ['OI', 1n], ['SH', -1n]]);
    compute('COGS', [['CRW', 1n], ['CSM', 1n], ['CPM', 1n]]);
    compute('CI', [['CM', 1n], ['COGS', -1n]]);
    compute('DC', ['LC', 'UC', 'MC', 'TC', 'AC', 'LP', 'TX'].map(key => [key as Metric, 1n]));
    compute('DA', [['DA01', 1n], ['DA02', 1n]]);
    compute('EBITDA', [['CI', 1n], ['DC', -1n]]);
    compute('EBIT', [['CI', 1n], ['DC', -1n], ['DA', -1n]]);
    return result;
  }
}
