import { BASE_METRICS, missing, unitKey, type BaseMetric, type Fact, type Filter, type SourceResult, type Unit, type Value } from './domain.ts';
import { sumMoney, decimal } from './decimal.ts';
import { FinanceCalculationService } from './FinanceCalculationService.ts';
import { date } from './validation.ts';
const SALES_COST = new Set<BaseMetric>(['SI', 'CRW', 'CSM', 'CPM']);
const expectedSource = (unit: Unit, metric: BaseMetric) => unit.type === 'OUTLET' && SALES_COST.has(metric) ? 'OUTLET' : 'WAREHOUSE';
export class FinanceAggregationService {
  constructor(private readonly calculator = new FinanceCalculationService()) {}
  aggregate(filter: Filter, sources: SourceResult[], eliminationVerified = false) {
    const issues = sources.flatMap(s => s.issues);
    if (!sources.some(s => s.source === 'WAREHOUSE')) issues.push({ status: 'Missing', reason: 'Warehouse ledger source absent' });
    if (filter.mode !== 'WAREHOUSE' && !sources.some(s => s.source === 'OUTLET')) issues.push({ status: 'Missing', reason: 'Outlet source absent' });
    if (new Set(sources.map(s => s.source)).size !== sources.length) issues.push({ status: 'Error', reason: 'Duplicate source result' });
    const selected = (unit: Unit) => unit.type === 'WAREHOUSE' ? filter.mode !== 'OUTLET' : filter.mode !== 'WAREHOUSE' && (!filter.outletIds || filter.outletIds.includes(unit.outletId));
    const units = new Map<string, Unit>();
    if (filter.mode !== 'OUTLET') units.set('WAREHOUSE', { type: 'WAREHOUSE' });
    if (filter.mode !== 'WAREHOUSE') for (const outletId of filter.outletIds ?? []) units.set(`OUTLET:${outletId}`, { type: 'OUTLET', outletId });
    for (const source of sources) for (const unit of source.units) if (selected(unit)) units.set(unitKey(unit), unit);
    const seen = new Map<string, string>();
    const facts: Fact[] = [];
    const internalFacts: Fact[] = [];
    for (const source of sources) for (const fact of source.facts) {
      try {
        if (fact.source !== source.source || !BASE_METRICS.includes(fact.metric) || decimal(fact.amount) < 0n || !fact.id || !fact.reference || !['INTERNAL', 'EXTERNAL'].includes(fact.nature)) throw new Error('Invalid fact');
        const businessDate = date(fact.date);
        if (businessDate < filter.startDate || businessDate > filter.endDate || !selected(fact.unit)) continue;
        if (!units.has(unitKey(fact.unit)) || expectedSource(fact.unit, fact.metric) !== source.source) throw new Error('Fact has no authoritative unit/source');
        const identity = `${fact.source}:${fact.id}:${fact.metric}`;
        const signature = JSON.stringify(fact);
        if (seen.has(identity)) { if (seen.get(identity) !== signature) throw new Error('Conflicting fact duplicate'); else continue; }
        seen.set(identity, signature);
        (fact.nature === 'INTERNAL' ? internalFacts : facts).push(fact);
      } catch { issues.push({ status: 'Error', reason: 'Invalid/conflicting source fact' }); }
    }
    if (filter.mode !== 'WAREHOUSE' && ![...units.values()].some(u => u.type === 'OUTLET')) issues.push({ status: 'Missing', reason: 'Outlet population not certified' });
    const byUnit = [...units.values()].map(unit => {
      const input: Partial<Record<BaseMetric, Value>> = {};
      const knownAmounts: Partial<Record<BaseMetric, string>> = {};
      for (const metric of BASE_METRICS) {
        const relevant = facts.filter(f => unitKey(f.unit) === unitKey(unit) && f.metric === metric);
        const coverage = sources.filter(s => s.source === expectedSource(unit, metric)).flatMap(s => s.coverage).filter(c => unitKey(c.unit) === unitKey(unit) && c.metric === metric);
        knownAmounts[metric] = sumMoney(relevant.map(f => f.amount));
        if (issues.length) {
          const status = issues.some(i => i.status === 'Error') ? 'Error' : issues.some(i => i.status === 'Unmapped') ? 'Unmapped' : 'Missing';
          input[metric] = { amount: null, status, reasons: [...new Set(issues.map(i => i.reason))] };
        } else if (coverage.length !== 1) input[metric] = missing(`${unitKey(unit)}/${metric}: unique completeness evidence required`);
        else if (coverage[0].status !== 'Available') input[metric] = missing(coverage[0].reason, coverage[0].status);
        else input[metric] = { amount: knownAmounts[metric]!, status: 'Available', reasons: [] };
      }
      return { unit, metrics: this.calculator.calculate(input), knownAmounts };
    });
    const totals: Partial<Record<BaseMetric, Value>> = {};
    for (const metric of BASE_METRICS) {
      const values = byUnit.map(u => u.metrics[metric]);
      const incomplete = values.filter(v => v.status !== 'Available');
      if (!values.length) totals[metric] = { amount: null, status: issues.some(i => i.status === 'Error') ? 'Error' : issues.some(i => i.status === 'Unmapped') ? 'Unmapped' : 'Missing', reasons: ['Unit population unavailable', ...new Set(issues.map(i => i.reason))] };
      else if (incomplete.length) totals[metric] = { amount: null, status: incomplete.some(v => v.status === 'Error') ? 'Error' : incomplete.some(v => v.status === 'Unmapped') ? 'Unmapped' : 'Missing', reasons: [...new Set(incomplete.flatMap(v => v.reasons))] };
      else totals[metric] = { amount: sumMoney(values.map(v => v.amount!)), status: 'Available', reasons: [] };
    }
    if (filter.mode === 'ALL' && !eliminationVerified) {
      for (const metric of BASE_METRICS) totals[metric] = missing('Consolidation elimination/closing inventory evidence not verified', totals[metric]?.status === 'Error' ? 'Error' : totals[metric]?.status === 'Unmapped' ? 'Unmapped' : 'Missing');
    }
    const metrics = this.calculator.calculate(totals);
    return { filter, metrics, byUnit, complete: Object.values(metrics).every(v => v.status === 'Available'), issues,
      outlets: sources.flatMap(s => s.outlets ?? []).filter((outlet, index, rows) => rows.findIndex(o => o.id === outlet.id) === index),
      reconciliation: { distributions: sources.flatMap(s => s.distributions), internalFacts, excludedFromExternalIncome: true },
      sourceTimes: sources.map(s => ({ source: s.source, fetchedAt: s.fetchedAt, status: s.issues.some(i => i.status === 'Error') ? 'Error' as const : s.issues.some(i => i.status === 'Unmapped') ? 'Unmapped' as const : s.issues.some(i => i.status === 'Missing') ? 'Missing' as const : 'Available' as const, reasons: s.issues.map(i => i.reason) })),
      eliminationVerified: filter.mode === 'ALL' ? eliminationVerified : null };
  }
}
