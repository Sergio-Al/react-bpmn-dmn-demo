import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import ProcessViewer, { type PathNote } from './ProcessViewer';

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

type Steps = ReturnType<typeof steps>;
const modeLabels: Record<Mode, string> = { 'rules-only': 'Rules only', hybrid: 'Rules + Jev' };

/** One sentence on why the two modes agree or differ, built from the trace only. */
function explain(rules: Steps, hybrid: Steps): ReactNode {
  const r = rules.policy, h = hybrid.policy, a = hybrid.assessment;
  if (!r || !h) return null;
  const rule = (value: string) => <code className="crm-rule">{value}</code>;
  if (a?.status === 'unavailable') return <>Jev was unavailable ({a.errorKind ?? 'unknown'}), so the hybrid run fell back to {rule(h.rule)} and chose <strong>{action(h.nextAction)}</strong>.</>;
  if (r.nextAction === h.nextAction) return r.rule === h.rule
    ? <>Both modes choose <strong>{action(r.nextAction)}</strong>. Policy rule {rule(r.rule)} fires on the facts alone, so Jev's signals don't change the outcome.</>
    : <>Both modes choose <strong>{action(r.nextAction)}</strong>, through different policy rules ({rule(r.rule)} and {rule(h.rule)}).</>;
  const signals = a?.status === 'ok'
    ? <span className="crm-ai-text">switching risk {percent(a.switchingRisk)}, needs attention {percent(a.needsAttention)}, objective {a.objective?.toLowerCase()} ({percent(a.objectiveProbability)})</span>
    : null;
  return <>The facts alone send this customer to <strong>{action(r.nextAction)}</strong> ({rule(r.rule)}). {signals ? <>With Jev's signals ({signals}), policy rule</> : <>With Jev, policy rule</>} {rule(h.rule)} chooses <strong>{action(h.nextAction)}</strong> instead.</>;
}

function pathNotes(result: CrmResult | null): PathNote[] {
  if (!result) return [];
  const { facts, assessment, policy } = steps(result);
  const notes: PathNote[] = [];
  if (facts) notes.push({ id: 'derive-facts', tone: 'rules', text: `${factLabels.filter(([key]) => facts[key]).length} of ${factLabels.length} facts true` });
  if (assessment) notes.push({ id: 'assess-with-jev', tone: 'ai', text: assessment.status === 'ok'
    ? `Switching ${percent(assessment.switchingRisk)} · ${assessment.objective?.toLowerCase()}`
    : assessment.status === 'skipped' ? 'Skipped (rules only)' : `Unavailable: ${assessment.errorKind ?? 'unknown'}` });
  if (policy) notes.push({ id: 'apply-policy', tone: 'rules', text: policy.rule });
  return notes;
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
  const [xml, setXml] = useState('');

  useEffect(() => {
    api<Fixture[]>('/fixtures/crm-customer').then(items => {
      setFixtures(items);
      if (items.length) { setSelectedId(items[0].id); setPayload(structuredClone(items[0].payload)); }
    }).catch(error => setStatus(String(error)));
    api<{ xml: string }>('/processes/crm-next-best-action').then(data => setXml(data.xml)).catch(error => setStatus(String(error)));
  }, []);

  const selected = fixtures.find(item => item.id === selectedId);
  const displayed = payload ? comparison?.[payload.mode] ?? result : null;
  const { facts, assessment, policy, bpmn } = steps(displayed);
  const runPath = useMemo(() => displayed ? displayed.path.map(step => step.id) : null, [displayed]);
  const notes = useMemo(() => pathNotes(displayed), [displayed]);
  const rulesSteps = comparison ? steps(comparison['rules-only']) : null;
  const hybridSteps = comparison ? steps(comparison.hybrid) : null;

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

    {comparison && rulesSteps && hybridSteps && payload && <section className="crm-verdict" aria-label="Mode comparison">
      <div className="crm-verdict-head">
        <h2>{rulesSteps.policy?.nextAction === hybridSteps.policy?.nextAction ? 'Both modes agree' : 'Same customer, two different answers'}</h2>
        <p>Select a result to draw its path on the diagram.</p>
      </div>
      <div className="crm-verdict-cards">
        {(['rules-only', 'hybrid'] as Mode[]).map(mode => {
          const item = mode === 'hybrid' ? hybridSteps : rulesSteps;
          return <button key={mode} type="button" className={`crm-verdict-card ${mode === 'hybrid' ? 'tone-ai' : 'tone-rules'}`} aria-pressed={payload.mode === mode} onClick={() => setMode(mode)} disabled={busy}>
            <span className="crm-eyebrow"><span className="crm-dot" aria-hidden="true" />{modeLabels[mode]}</span>
            <strong className="crm-verdict-action">{action(item.policy?.nextAction)}</strong>
            <code className="crm-rule">{item.policy?.rule ?? '—'}</code>
            <span className="crm-verdict-show">{payload.mode === mode ? 'Shown on diagram' : 'Show on diagram'}</span>
          </button>;
        })}
      </div>
      <p className="crm-why">{explain(rulesSteps, hybridSteps)}</p>
      <details className="crm-signals"><summary>All facts and signals</summary><div className="crm-table-scroll"><table><thead><tr><th>Result</th><th>Rules only</th><th>Rules + Jev</th></tr></thead><tbody>
        {factLabels.map(([key, label]) => { const a = rulesSteps.facts?.[key], b = hybridSteps.facts?.[key]; return <tr key={key} className={a !== b ? 'is-diff' : ''}><th>{label}</th><td>{fact(a)}</td><td>{fact(b)}</td></tr>; })}
        <tr className="is-ai-row"><th>Switching risk</th><td>not assessed</td><td>{signal(hybridSteps.assessment, hybridSteps.assessment?.switchingRisk)}</td></tr>
        <tr className="is-ai-row"><th>Needs attention</th><td>not assessed</td><td>{signal(hybridSteps.assessment, hybridSteps.assessment?.needsAttention)}</td></tr>
        <tr className="is-ai-row"><th>Objective</th><td>not assessed</td><td>{hybridSteps.assessment?.status === 'ok' ? `${hybridSteps.assessment.objective} (${percent(hybridSteps.assessment.objectiveProbability)}, confidence ${percent(hybridSteps.assessment.objectiveConfidence)})` : 'not assessed'}</td></tr>
        <tr className="is-ai-row"><th>Relationship level</th><td>not assessed</td><td>{hybridSteps.assessment?.status === 'ok' ? hybridSteps.assessment.relationshipLevel : 'not assessed'}</td></tr>
        <tr className={rulesSteps.policy?.rule !== hybridSteps.policy?.rule ? 'is-diff' : ''}><th>Policy rule</th><td>{rulesSteps.policy?.rule ?? '—'}</td><td>{hybridSteps.policy?.rule ?? '—'}</td></tr>
        <tr className={rulesSteps.policy?.nextAction !== hybridSteps.policy?.nextAction ? 'is-diff' : ''}><th>Final action</th><td>{action(rulesSteps.policy?.nextAction)}</td><td>{action(hybridSteps.policy?.nextAction)}</td></tr>
      </tbody></table></div></details>
    </section>}

    <section className="crm-panel crm-diagram">
      <div className="crm-panel-heading">
        <h2>Process path{displayed && payload ? <span className="crm-subtle"> · {modeLabels[payload.mode]}</span> : null}</h2>
        <ul className="crm-legend" aria-label="Legend">
          <li><span className="crm-swatch swatch-path" aria-hidden="true" />Path taken</li>
          <li><span className="crm-swatch swatch-rules" aria-hidden="true" />Rules and policy</li>
          <li><span className="crm-swatch swatch-ai" aria-hidden="true" />AI signals (Jev)</li>
        </ul>
      </div>
      {!displayed && <p className="crm-caption">Run a scenario to see which way the process goes.</p>}
      {xml && <ProcessViewer xml={xml} path={runPath} notes={notes} label={displayed ? `Process path: ${(bpmn?.path ?? []).join(', ')}` : 'CRM next best action process'} />}
    </section>

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
      <section className="crm-panel tone-rules"><h2><span className="crm-dot" aria-hidden="true" />2 · Business rules</h2>{facts ? <ul className="crm-facts">{factLabels.map(([key, label]) => <li key={key}><span aria-label={facts[key] ? 'true' : 'false'} className={facts[key] ? 'crm-yes' : 'crm-no'}>{fact(facts[key])}</span>{label}</li>)}</ul> : <p>Run a scenario to see the ZEN-derived facts.</p>}</section>
      <section className="crm-panel tone-ai"><h2><span className="crm-dot" aria-hidden="true" />3 · Jev assessment</h2>
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
        <li className="tone-rules"><span className="crm-badge">ZEN</span><div><strong>Facts</strong><div className="crm-trace-facts">{factLabels.map(([key, label]) => <span key={key}>{label}: {fact(facts?.[key])}</span>)}</div></div></li>
        <li className="tone-ai"><span className="crm-badge">JEV</span><div><strong>Signals</strong><p>{assessment?.status === 'ok' ? `Switching ${percent(assessment.switchingRisk)}, attention ${percent(assessment.needsAttention)}, objective ${assessment.objective}, relationship ${assessment.relationshipLevel}` : assessment?.status === 'skipped' ? 'Not assessed (Rules only)' : `Unavailable: ${assessment?.errorKind ?? 'unknown'}`}</p></div></li>
        <li className="tone-rules"><span className="crm-badge">POLICY</span><div><strong><code className="crm-rule">{policy?.rule ?? '—'}</code></strong><p>Next action: {action(policy?.nextAction)}</p></div></li>
        <li className="tone-path"><span className="crm-badge">BPMN</span><div><strong>Path</strong><p>{(bpmn?.path ?? []).map(id => displayed.path.find(item => item.id === id)?.name ?? id).join(' → ')}</p></div></li>
      </ol> : <p>Run a scenario to see ZEN → JEV → POLICY → BPMN.</p>}</section>
    </div>
  </div>;
}
