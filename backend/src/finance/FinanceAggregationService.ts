import { BASE_METRICS, LEDGER_INPUT, missing, unitKey, type BaseMetric, type Fact, type Filter, type SourceResult, type Unit, type Value } from './domain.ts';
import { sumMoney, decimal } from './decimal.ts';
import { FinanceCalculationService } from './FinanceCalculationService.ts';
import { date } from './validation.ts';
const SALES_COST = new Set<BaseMetric>(['SI', 'CRW', 'CSM', 'CPM']);
const expectedSource = (unit: Unit, metric: BaseMetric) => unit.type === 'OUTLET' && SALES_COST.has(metric) ? 'OUTLET' : 'WAREHOUSE';
export class FinanceAggregationService {
  constructor(private readonly calculator = new FinanceCalculationService()) {}
  aggregate(filter: Filter, sources: SourceResult[], eliminationVerified = false) {
    // A source's issues block only the metrics that source is authoritative for
    // (expectedSource): HD Outlet being unavailable leaves outlet SI/COGS
    // Missing but not the Labor Cost Finance posted for that outlet. Issues
    // raised here (absent/duplicate source, invalid fact) block everything.
    type Issue = SourceResult['issues'][number];
    const sourceIssues = new Map<string, Issue[]>(sources.map(s => [s.source, [...s.issues]]));
    const global: Issue[] = [];
    if (!sources.some(s => s.source === 'WAREHOUSE')) sourceIssues.set('WAREHOUSE', [{ status: 'Missing', reason: 'Warehouse ledger source absent' }]);
    if (filter.mode !== 'WAREHOUSE' && !sources.some(s => s.source === 'OUTLET')) sourceIssues.set('OUTLET', [{ status: 'Missing', reason: 'Outlet source absent' }]);
    if (new Set(sources.map(s => s.source)).size !== sources.length) global.push({ status: 'Error', reason: 'Duplicate source result' });
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
      } catch { global.push({ status: 'Error', reason: 'Invalid/conflicting source fact' }); }
    }
    if (filter.mode !== 'WAREHOUSE' && ![...units.values()].some(u => u.type === 'OUTLET')) global.push({ status: 'Missing', reason: 'Outlet population not certified' });
    const issuesFor = (unit: Unit, metric: BaseMetric) => [...global, ...(sourceIssues.get(expectedSource(unit, metric)) ?? [])];
    const issues = [...global, ...[...sourceIssues.values()].flat()];
    const byUnit = [...units.values()].map(unit => {
      const input: Partial<Record<BaseMetric, Value>> = {};
      const knownAmounts: Partial<Record<BaseMetric, string>> = {};
      for (const metric of BASE_METRICS) {
        const relevant = facts.filter(f => unitKey(f.unit) === unitKey(unit) && f.metric === metric);
        const coverage = sources.filter(s => s.source === expectedSource(unit, metric)).flatMap(s => s.coverage).filter(c => unitKey(c.unit) === unitKey(unit) && c.metric === metric);
        knownAmounts[metric] = sumMoney(relevant.map(f => f.amount));
        const blocking = issuesFor(unit, metric);
        if (blocking.length) {
          const status = blocking.some(i => i.status === 'Error') ? 'Error' : blocking.some(i => i.status === 'Unmapped') ? 'Unmapped' : 'Missing';
          input[metric] = { amount: null, status, reasons: [...new Set(blocking.map(i => i.reason))] };
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
      // HD Outlet issues concern outlets that may not be units at all (unmapped
      // or unknown population): the totals of what HD Outlet provides carry them.
      const outletIssues = sourceIssues.get('OUTLET') ?? [];
      if (filter.mode !== 'WAREHOUSE' && SALES_COST.has(metric) && outletIssues.length) {
        const all = [...outletIssues, ...(totals[metric]!.status === 'Available' ? [] : [{ status: totals[metric]!.status as Issue['status'], reason: '' }])];
        totals[metric] = { amount: null, status: all.some(i => i.status === 'Error') ? 'Error' : all.some(i => i.status === 'Unmapped') ? 'Unmapped' : 'Missing', reasons: [...new Set([...totals[metric]!.reasons, ...outletIssues.map(i => i.reason)])] };
      }
    }
    // Consolidation eliminates internal Warehouse→Outlet sales and their COGS.
    // Ledger costs are external by construction (internal facts are already
    // set aside), so their totals need no elimination.
    if (filter.mode === 'ALL' && !eliminationVerified) {
      for (const metric of BASE_METRICS.filter(m => !LEDGER_INPUT.includes(m))) totals[metric] = missing('Consolidation elimination/closing inventory evidence not verified', totals[metric]?.status === 'Error' ? 'Error' : totals[metric]?.status === 'Unmapped' ? 'Unmapped' : 'Missing');
    }
    const metrics = this.calculator.calculate(totals);
    // Rp0 is a real answer for a ledger cost only if nobody forgot to enter it:
    // list, per unit, the ledger costs with nothing posted in the period.
    const notices = byUnit.flatMap(({ unit, metrics: m }) => {
      const empty = LEDGER_INPUT.filter(metric => m[metric].status === 'Available' && decimal(m[metric].amount!) === 0n);
      return empty.length ? [{ unit, metrics: empty }] : [];
    });
    return { filter, metrics, byUnit, notices, complete: Object.values(metrics).every(v => v.status === 'Available'), issues,
      outlets: sources.flatMap(s => s.outlets ?? []).filter((outlet, index, rows) => rows.findIndex(o => o.id === outlet.id) === index),
      reconciliation: { distributions: sources.flatMap(s => s.distributions), internalFacts, excludedFromExternalIncome: true },
      sourceTimes: sources.map(s => ({ source: s.source, fetchedAt: s.fetchedAt, status: s.issues.some(i => i.status === 'Error') ? 'Error' as const : s.issues.some(i => i.status === 'Unmapped') ? 'Unmapped' as const : s.issues.some(i => i.status === 'Missing') ? 'Missing' as const : 'Available' as const, reasons: s.issues.map(i => i.reason) })),
      eliminationVerified: filter.mode === 'ALL' ? eliminationVerified : null };
  }
}
