import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Mode = 'rules-only' | 'hybrid';
type Facts = { strategicAccount: boolean; salesDeclining: boolean; visitOverdue: boolean; paymentProblem: boolean };
type Assessment = {
  status: 'ok' | 'unavailable' | 'skipped'; source: 'live' | 'mock' | null; model: string | null;
  elapsedMs: number; needsAttention: number | null; switchingRisk: number | null;
  objective: string | null; objectiveProbability: number | null; objectiveConfidence: number | null;
  relationshipLevel: string | null; relationshipRisk: number | null; relationshipConfidence: number | null;
  errorKind?: string;
};
type Policy = { nextAction: string; rule: string };
type TraceEntry = { step: 'ZEN' | 'JEV' | 'BPMN'; decision?: string; output?: { facts?: Facts; policy?: Policy }; assessment?: Assessment; path?: string[] };
type CrmPayload = {
  mode: Mode;
  customer: { id: string; name: string; segment: string; annualRevenue: number; active: boolean };
  sales: { trend90Days: number; daysSinceLastOrder: number };
  payments: { overdueInvoices: number; overdueAmount: number };
  activity: { daysSinceLastVisit: number };
  notes: string[];
};
type Fixture = { id: string; title: string; description: string; payload: CrmPayload };
type CrmResult = { requestId: string; variables: { trace: TraceEntry[] }; path: Array<{ id: string; name: string }> };
type Violation = { path: string; message: string };

const factLabels: Array<[keyof Facts, string]> = [
  ['strategicAccount', 'Strategic account'], ['salesDeclining', 'Sales declining'],
  ['visitOverdue', 'Visit overdue'], ['paymentProblem', 'Payment problem'],
];
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const percent = (value: number | null | undefined) => value == null ? 'not assessed' : `${Math.round(value * 100)}%`;
const signal = (assessment: Assessment | undefined, value: number | null | undefined) => assessment?.status === 'ok' ? percent(value) : 'not assessed';
const fact = (value: boolean | undefined) => value === undefined ? '—' : value ? '✓' : '✕';
const actionLabels: Record<string, string> = {
  NO_ACTION: 'No action', HUMAN_REVIEW: 'Human review', CREATE_RETENTION_VISIT: 'Retention visit',
  CREATE_UPSELL_FOLLOWUP: 'Upsell follow-up', CREATE_ACCOUNT_FOLLOWUP: 'Account follow-up',
  COLLECTION_FOLLOWUP: 'Collection follow-up',
};
const action = (value: string | undefined) => value ? actionLabels[value] ?? value.replaceAll('_', ' ') : '—';

function steps(result: CrmResult | null) {
  const trace = result?.variables.trace ?? [];
  return {
    facts: trace.find(item => item.step === 'ZEN' && item.decision === 'crm-customer-facts')?.output?.facts,
    assessment: trace.find(item => item.step === 'JEV')?.assessment,
    policy: trace.find(item => item.step === 'ZEN' && item.decision === 'crm-policy')?.output?.policy,
    bpmn: trace.find(item => item.step === 'BPMN'),
  };
}

function ProbabilityBar({ label, value }: { label: string; value: number | null }) {
  return <div className="crm-probability"><div><span>{label}</span><strong>{percent(value)}</strong></div><progress max={1} value={value ?? 0} aria-label={label} /></div>;
}

export default function CrmShowcase() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<CrmPayload | null>(null);
  const [result, setResult] = useState<CrmResult | null>(null);
  const [comparison, setComparison] = useState<Record<Mode, CrmResult> | null>(null);
  const [status, setStatus] = useState('');
  const [violations, setViolations] = useState<Violation[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Fixture[]>('/fixtures/crm-customer').then(items => {
      setFixtures(items);
      if (items.length) { setSelectedId(items[0].id); setPayload(structuredClone(items[0].payload)); }
    }).catch(error => setStatus(String(error)));
  }, []);

  const selected = fixtures.find(item => item.id === selectedId);
  const displayed = payload ? comparison?.[payload.mode] ?? result : null;
  const { facts, assessment, policy, bpmn } = steps(displayed);

  function clearResults() { setResult(null); setComparison(null); setStatus(''); setViolations([]); }
  function selectScenario(id: string) {
    const fixture = fixtures.find(item => item.id === id);
    if (!fixture) return;
    setSelectedId(id);
    setPayload(structuredClone(fixture.payload));
    clearResults();
  }
  function resetScenario() {
    if (!selected) return;
    setPayload(structuredClone(selected.payload));
    clearResults();
  }
  function setMode(mode: Mode) {
    if (!payload) return;
    setPayload({ ...payload, mode });
    setResult(null);
    setStatus('');
    setViolations([]);
  }
  function setNotes(notes: string[]) {
    if (!payload) return;
    setPayload({ ...payload, notes });
    clearResults();
  }
  async function submit(mode: Mode): Promise<CrmResult> {
    return api<CrmResult>('/requests', { method: 'POST', body: JSON.stringify({
      requestId: crypto.randomUUID(), type: 'crm-customer', version: 1, payload: { ...payload, mode },
    }) });
  }
  function reportError(error: unknown) {
    if (error instanceof ApiError && error.details && typeof error.details === 'object') {
      const details = error.details as { code?: string; message?: string; errors?: Violation[] };
      setViolations(details.code === 'CONTRACT_VIOLATION' ? details.errors ?? [] : []);
      setStatus(details.code ? `${details.code}${details.message ? `: ${details.message}` : ''}` : error.message);
    } else setStatus(String(error));
  }
  async function run() {
    if (!payload) return;
    setBusy(true); setResult(null); setComparison(null); setViolations([]); setStatus('Running…');
    try { setResult(await submit(payload.mode)); setStatus('Process completed'); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  }
  async function compare() {
    if (!payload) return;
    setBusy(true); setResult(null); setComparison(null); setViolations([]); setStatus('Comparing both modes…');
    try {
      const [rulesOnly, hybrid] = await Promise.all([submit('rules-only'), submit('hybrid')]);
      setComparison({ 'rules-only': rulesOnly, hybrid });
      setStatus('Comparison completed');
    } catch (error) { reportError(error); }
    finally { setBusy(false); }
  }

  return <div className="crm-page">
    <div className="crm-header">
      <div><h2>CRM showcase</h2><p>Rules: what do we know? · Jev: what appears true? · Policy: what may we do? · BPMN: what happens next?</p></div>
      <div className="crm-controls">
        <label>Scenario <select value={selectedId} onChange={event => selectScenario(event.target.value)} disabled={busy}>{fixtures.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Mode <select value={payload?.mode ?? 'rules-only'} onChange={event => setMode(event.target.value as Mode)} disabled={!payload || busy}><option value="rules-only">Rules only</option><option value="hybrid">Rules + Jev</option></select></label>
        <button onClick={run} disabled={!payload || busy}>Run</button><button onClick={compare} disabled={!payload || busy}>Compare</button>
      </div>
    </div>
    {selected && <p className="crm-scenario-description">{selected.description}</p>}
    {status && <p role="status" className="crm-status">{status}</p>}
    {violations.length > 0 && <div role="alert" className="crm-errors"><h3>Contract violations</h3><ul>{violations.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</li>)}</ul></div>}

    {comparison && <section className="crm-panel crm-compare" aria-label="Mode comparison">
      <h2>Compare modes</h2><div className="crm-table-scroll"><table><thead><tr><th>Result</th><th>Rules only</th><th>Rules + Jev</th></tr></thead><tbody>
        {factLabels.map(([key, label]) => <tr key={key}><th>{label}</th><td>{fact(steps(comparison['rules-only']).facts?.[key])}</td><td>{fact(steps(comparison.hybrid).facts?.[key])}</td></tr>)}
        <tr><th>Switching risk</th><td>not assessed</td><td>{signal(steps(comparison.hybrid).assessment, steps(comparison.hybrid).assessment?.switchingRisk)}</td></tr>
        <tr><th>Needs attention</th><td>not assessed</td><td>{signal(steps(comparison.hybrid).assessment, steps(comparison.hybrid).assessment?.needsAttention)}</td></tr>
        <tr><th>Objective</th><td>not assessed</td><td>{steps(comparison.hybrid).assessment?.status === 'ok' ? `${steps(comparison.hybrid).assessment?.objective} (${percent(steps(comparison.hybrid).assessment?.objectiveProbability)}, confidence ${percent(steps(comparison.hybrid).assessment?.objectiveConfidence)})` : 'not assessed'}</td></tr>
        <tr><th>Relationship level</th><td>not assessed</td><td>{steps(comparison.hybrid).assessment?.status === 'ok' ? steps(comparison.hybrid).assessment?.relationshipLevel : 'not assessed'}</td></tr>
        <tr><th>Policy rule</th><td>{steps(comparison['rules-only']).policy?.rule ?? '—'}</td><td>{steps(comparison.hybrid).policy?.rule ?? '—'}</td></tr>
        <tr><th>Final action</th><td>{action(steps(comparison['rules-only']).policy?.nextAction)}</td><td>{action(steps(comparison.hybrid).policy?.nextAction)}</td></tr>
      </tbody></table></div>
    </section>}

    <div className="crm-panels">
      <section className="crm-panel"><div className="crm-panel-heading"><h2>1 · Customer state</h2><button onClick={resetScenario} disabled={!selected || busy}>Reset scenario</button></div>
        {payload ? <><h3>{payload.customer.name}</h3><dl className="crm-details">
          <div><dt>Segment</dt><dd>{payload.customer.segment}</dd></div><div><dt>Annual revenue</dt><dd>{money.format(payload.customer.annualRevenue)}</dd></div>
          <div><dt>Sales trend (90 days)</dt><dd>{payload.sales.trend90Days}%</dd></div><div><dt>Days since last visit</dt><dd>{payload.activity.daysSinceLastVisit}</dd></div>
          <div><dt>Days since last order</dt><dd>{payload.sales.daysSinceLastOrder}</dd></div><div><dt>Overdue invoices</dt><dd>{payload.payments.overdueInvoices}</dd></div>
          <div><dt>Overdue amount</dt><dd>{money.format(payload.payments.overdueAmount)}</dd></div><div><dt>Active</dt><dd>{payload.customer.active ? 'Yes' : 'No'}</dd></div>
        </dl><div className="crm-notes-heading"><h3>Notes</h3><button onClick={() => setNotes([...payload.notes, ''])} disabled={busy || payload.notes.length >= 10}>Add note</button></div>
          {payload.notes.map((note, index) => <div className="crm-note" key={index}><label>Note {index + 1}<textarea value={note} maxLength={1000} onChange={event => setNotes(payload.notes.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} disabled={busy} /></label><button onClick={() => setNotes(payload.notes.filter((_, itemIndex) => itemIndex !== index))} disabled={busy}>Remove note</button></div>)}
        </> : <p>Loading scenarios…</p>}
      </section>
      <section className="crm-panel"><h2>2 · Business rules</h2>{facts ? <ul className="crm-facts">{factLabels.map(([key, label]) => <li key={key}><span aria-label={facts[key] ? 'true' : 'false'} className={facts[key] ? 'crm-yes' : 'crm-no'}>{fact(facts[key])}</span>{label}</li>)}</ul> : <p>Run a scenario to see the ZEN-derived facts.</p>}</section>
      <section className="crm-panel"><h2>3 · Jev assessment</h2>
        {!assessment ? <p>Run a scenario to see the assessment.</p> : <>
          {assessment.status === 'skipped' && <p className="crm-banner">skipped (Rules only)</p>}
          {assessment.status === 'unavailable' && <p className="crm-banner crm-warning">unavailable: {assessment.errorKind ?? 'unknown'} — {policy?.nextAction === 'HUMAN_REVIEW' ? 'routed to human review' : `policy selected ${action(policy?.nextAction)}`}</p>}
          {assessment.source === 'mock' && <p className="crm-banner"><strong className="crm-mock-badge">MOCK</strong> Mock answers ignore edited notes.</p>}
          {assessment.status === 'ok' && <><ProbabilityBar label="Switching risk" value={assessment.switchingRisk} /><ProbabilityBar label="Needs attention" value={assessment.needsAttention} />
            <dl className="crm-details"><div><dt>Objective</dt><dd>{assessment.objective} · {percent(assessment.objectiveProbability)} probability · {percent(assessment.objectiveConfidence)} confidence</dd></div>
              <div><dt>Relationship risk</dt><dd>{assessment.relationshipLevel} · {assessment.relationshipRisk?.toFixed(2)} / 3 · {percent(assessment.relationshipConfidence)} confidence</dd></div></dl></>}
          <dl className="crm-details"><div><dt>Model</dt><dd>{assessment.model ?? 'not assessed'}</dd></div><div><dt>Elapsed</dt><dd>{assessment.elapsedMs} ms</dd></div></dl>
          <p className="crm-caption">Jev outputs are signals, not guarantees.</p>
        </>}
      </section>
      <section className="crm-panel"><h2>4 · Decision trace</h2>{displayed ? <ol className="crm-trace">
        <li><strong>ZEN — facts</strong><div>{factLabels.map(([key, label]) => <span key={key}>{label}: {fact(facts?.[key])}</span>)}</div></li>
        <li><strong>JEV — signals</strong><p>{assessment?.status === 'ok' ? `Switching ${percent(assessment.switchingRisk)}, attention ${percent(assessment.needsAttention)}, objective ${assessment.objective}, relationship ${assessment.relationshipLevel}` : assessment?.status === 'skipped' ? 'Not assessed (Rules only)' : `Unavailable: ${assessment?.errorKind ?? 'unknown'}`}</p></li>
        <li><strong>POLICY — {policy?.rule ?? '—'}</strong><p>Next action: {action(policy?.nextAction)}</p></li>
        <li><strong>BPMN — path</strong><p>{(bpmn?.path ?? []).map(id => displayed.path.find(item => item.id === id)?.name ?? id).join(' → ')}</p><p>Final action: {action(policy?.nextAction)}</p></li>
      </ol> : <p>Run a scenario to see ZEN → JEV → POLICY → BPMN.</p>}</section>
    </div>
  </div>;
}
