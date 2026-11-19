import {
  ALL_METRICS, BASE_METRICS, LEDGER_INPUT, unitKey, worstStatus,
  type BaseMetric, type Coverage, type Fact, type Filter, type FinanceOutlet, type Issue, type Metric, type SourceLabel, type Unit, type Value,
} from './domain.ts';
import { decimal, money, sumMoney } from './decimal.ts';
import { FinanceCalculationService, FORMULAS, type Adjustment, type Calculation } from './FinanceCalculationService.ts';

export type ReportInput = { outlets: FinanceOutlet[]; facts: Fact[]; coverage: Coverage[]; issues: Issue[] };
export type Sources = Record<Metric, SourceLabel[]>;
export type UnitReport = { unit: Unit; metrics: Calculation; sources: Sources };
export type Report = ReturnType<typeof buildReport>;

// Which base components a metric is made of (CI → SI, OI, SH, CRW, CSM, CPM).
export function baseComponents(metric: Metric): BaseMetric[] {
  if ((BASE_METRICS as readonly string[]).includes(metric)) return [metric as BaseMetric];
  const formula = FORMULAS.find(([target]) => target === metric);
  return formula ? [...new Set(formula[1].flatMap(([term]) => baseComponents(term)))] : [];
}

const selector = (filter: Filter) => (unit: Unit) => unit.type === 'WAREHOUSE'
  ? filter.mode !== 'OUTLET'
  : filter.mode !== 'WAREHOUSE' && (!filter.outletIds || filter.outletIds.includes(unit.outletId));

// The units a report covers: Warehouse (unless Outlet only) and the selected
// outlets, or every active outlet, plus any outlet that has data in the period.
// Once outlets are mapped to HD Outlet / HD Attendance, an active outlet
// without a mapping shows only when it has data; a merged outlet never shows
// (its data is already under the outlet it joined).
function reportUnits(filter: Filter, input: ReportInput, facts: Fact[]) {
  const units = new Map<string, Unit>();
  if (filter.mode !== 'OUTLET') units.set('WAREHOUSE', { type: 'WAREHOUSE' });
  if (filter.mode !== 'WAREHOUSE') {
    const anyMapped = input.outlets.some(o => o.mapped);
    const ids = filter.outletIds ?? input.outlets.filter(o => o.isActive && o.mergedInto == null && (!anyMapped || o.mapped)).map(o => o.id);
    for (const id of ids) units.set(`OUTLET:${id}`, { type: 'OUTLET', outletId: id });
  }
  for (const fact of facts) units.set(unitKey(fact.unit), fact.unit);
  return [...units.values()].sort((a, b) => a.type === b.type ? (a.type === 'OUTLET' && b.type === 'OUTLET' ? a.outletId - b.outletId : 0) : a.type === 'WAREHOUSE' ? 1 : -1);
}

function factsInScope(filter: Filter, input: ReportInput) {
  const selected = selector(filter);
  return input.facts.filter(f => f.date >= filter.startDate && f.date <= filter.endDate && selected(f.unit));
}

const emptySources = () => Object.fromEntries(ALL_METRICS.map(m => [m, []])) as unknown as Sources;
function deriveSources(sources: Sources) {
  for (const [target, terms] of FORMULAS) sources[target] = [...new Set(terms.flatMap(([term]) => sources[term]))].sort();
  return sources;
}
function adjustmentsFrom(entries: { metrics: Metric[]; status: Adjustment['status']; reason: string }[]) {
  const adjust: Partial<Record<Metric, Adjustment>> = {};
  for (const entry of entries) for (const metric of entry.metrics) {
    const previous = adjust[metric];
    adjust[metric] = { status: worstStatus([previous?.status ?? 'Available', entry.status]) as Adjustment['status'], reasons: [...new Set([...(previous?.reasons ?? []), entry.reason])] };
  }
  return adjust;
}

export function buildReport(filter: Filter, input: ReportInput) {
  const calculator = new FinanceCalculationService();
  const facts = factsInScope(filter, input);
  const units = reportUnits(filter, input, facts);
  const byUnit: UnitReport[] = units.map(unit => {
    const own = facts.filter(f => unitKey(f.unit) === unitKey(unit));
    const sources = emptySources();
    const values: Partial<Record<BaseMetric, Value>> = {};
    for (const metric of BASE_METRICS) {
      const rows = own.filter(f => f.metric === metric);
      sources[metric] = [...new Set(rows.map(f => f.source))].sort();
      values[metric] = { amount: sumMoney(rows.map(f => f.amount)), status: 'Available', reasons: [] };
    }
    const coverage = input.coverage.filter(c => unitKey(c.unit) === unitKey(unit));
    return { unit, metrics: calculator.calculate(values, adjustmentsFrom(coverage)), sources: deriveSources(sources) };
  });

  // Totals: base components summed over the units, each with the worst unit
  // status; a unit's own gap on a computed metric (DC) and the issues outside
  // every unit lower the totals too.
  const totals: Partial<Record<BaseMetric, Value>> = {};
  const totalSources = emptySources();
  for (const metric of BASE_METRICS) {
    const values = byUnit.map(u => u.metrics[metric]);
    totals[metric] = { amount: sumMoney(values.map(v => v.amount)), status: worstStatus(values.map(v => v.status)), reasons: [...new Set(values.flatMap(v => v.reasons))] };
    totalSources[metric] = [...new Set(byUnit.flatMap(u => u.sources[metric]))].sort();
  }
  // Keseluruhan = outlets + Warehouse as one business. What Warehouse sold to an
  // outlet in scope is both Warehouse SI and that outlet's COGS: internal, so it
  // leaves the totals of SI and COGS (by category). CI, EBITDA and EBIT do not
  // change: the same amount leaves revenue and cost.
  const elimination = { amount: '0.000000', byMetric: {} as Partial<Record<BaseMetric, string>> };
  if (filter.mode === 'ALL' && units.some(u => u.type === 'WAREHOUSE')) {
    const internal = facts.filter(f => f.kind === 'cogs' && f.source === 'Warehouse' && f.unit.type === 'OUTLET');
    for (const metric of ['CRW', 'CSM', 'CPM'] as const) {
      const amount = sumMoney(internal.filter(f => f.metric === metric).map(f => f.amount));
      if (decimal(amount) === 0n) continue;
      elimination.byMetric[metric] = amount;
      totals[metric] = { ...totals[metric]!, amount: money(decimal(totals[metric]!.amount) - decimal(amount)) };
    }
    elimination.amount = sumMoney(internal.map(f => f.amount));
    if (decimal(elimination.amount) !== 0n) {
      elimination.byMetric.SI = elimination.amount;
      totals.SI = { ...totals.SI!, amount: money(decimal(totals.SI!.amount) - decimal(elimination.amount)) };
    }
  }
  const derivedGaps = input.coverage.filter(c => units.some(u => unitKey(u) === unitKey(c.unit))).map(c => ({ ...c, metrics: c.metrics.filter(m => !(BASE_METRICS as readonly string[]).includes(m)) }));
  const metrics = calculator.calculate(totals, adjustmentsFrom([...derivedGaps, ...input.issues]));

  // Rp0 is a real answer for a typed-in cost only if nobody forgot to enter it.
  const notices = byUnit.flatMap(({ unit, metrics: m }) => {
    const empty = LEDGER_INPUT.filter(metric => decimal(m[metric].amount) === 0n);
    return empty.length ? [{ unit, metrics: empty }] : [];
  });
  return {
    filter, metrics, sources: deriveSources(totalSources), byUnit, notices, elimination,
    issues: input.issues.map(({ status, reason }) => ({ status, reason })),
    outlets: input.outlets,
    complete: Object.values(metrics).every(v => v.status === 'Available'),
  };
}

// Drill-down of one metric (base or computed), optionally for one unit: the
// account codes it is made of (LC01, LC02, …) and every entry behind them.
export function buildDetail(filter: Filter, input: ReportInput, metric: Metric, unit: Unit | null) {
  const components = baseComponents(metric);
  const entries = factsInScope(filter, input)
    .filter(f => components.includes(f.metric) && (!unit || unitKey(f.unit) === unitKey(unit)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.accountCode.localeCompare(b.accountCode) || a.id.localeCompare(b.id));
  const accounts = new Map<string, { code: string; name: string; metric: BaseMetric; amounts: string[]; sources: Set<SourceLabel>; count: number }>();
  for (const f of entries) {
    const row = accounts.get(f.accountCode) ?? { code: f.accountCode, name: f.accountName, metric: f.metric, amounts: [], sources: new Set<SourceLabel>(), count: 0 };
    row.amounts.push(f.amount); row.sources.add(f.source); row.count++;
    accounts.set(f.accountCode, row);
  }
  return {
    metric, unit, components,
    accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code))
      .map(a => ({ code: a.code, name: a.name, metric: a.metric, amount: sumMoney(a.amounts), sources: [...a.sources].sort(), count: a.count })),
    entries,
  };
}
