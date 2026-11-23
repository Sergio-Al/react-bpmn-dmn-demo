import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Col, Collapse, Descriptions, Empty, Input, Progress, Row, Segmented, Select, Space, Table, Tag, Timeline, Tooltip, Tour, Typography, type TourProps } from 'antd';
import { CheckCircleFilled, CloseCircleOutlined, DeleteOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { api, ApiError } from './api';
import ProcessViewer, { type PathNote } from './ProcessViewer';
import { markTourSeen, TOUR_KEYS, tourSeen, tourTarget, useTourKeys } from './tour';

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
const actionLabels: Record<string, string> = {
  NO_ACTION: 'No action', HUMAN_REVIEW: 'Human review', CREATE_RETENTION_VISIT: 'Retention visit',
  CREATE_UPSELL_FOLLOWUP: 'Upsell follow-up', CREATE_ACCOUNT_FOLLOWUP: 'Account follow-up',
  COLLECTION_FOLLOWUP: 'Collection follow-up',
};
const action = (value: string | undefined) => value ? actionLabels[value] ?? value.replaceAll('_', ' ') : '—';
const modeLabels: Record<Mode, string> = { 'rules-only': 'Rules only', hybrid: 'Rules + Jev' };

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

const Rule = ({ children }: { children: ReactNode }) => <code className="rule-code">{children}</code>;

function FactValue({ value }: { value: boolean | undefined }) {
  if (value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  return value
    ? <span className="fact fact-yes"><CheckCircleFilled aria-hidden="true" /> Yes</span>
    : <span className="fact fact-no"><CloseCircleOutlined aria-hidden="true" /> No</span>;
}

/** One sentence on why the two modes agree or differ, built from the trace only. */
function explain(rules: Steps, hybrid: Steps): ReactNode {
  const r = rules.policy, h = hybrid.policy, a = hybrid.assessment;
  if (!r || !h) return null;
  if (a?.status === 'unavailable') return <>Jev was unavailable ({a.errorKind ?? 'unknown'}), so the hybrid run fell back to <Rule>{h.rule}</Rule> and chose <strong>{action(h.nextAction)}</strong>.</>;
  if (r.nextAction === h.nextAction) return r.rule === h.rule
    ? <>Both modes choose <strong>{action(r.nextAction)}</strong>. Policy rule <Rule>{r.rule}</Rule> fires on the facts alone, so Jev's signals don't change the outcome.</>
    : <>Both modes choose <strong>{action(r.nextAction)}</strong>, through different policy rules (<Rule>{r.rule}</Rule> and <Rule>{h.rule}</Rule>).</>;
  const signals = a?.status === 'ok'
    ? <span className="ai-text">switching risk {percent(a.switchingRisk)}, needs attention {percent(a.needsAttention)}, objective {a.objective?.toLowerCase()} ({percent(a.objectiveProbability)})</span>
    : null;
  return <>The facts alone send this customer to <strong>{action(r.nextAction)}</strong> (<Rule>{r.rule}</Rule>). {signals ? <>With Jev's signals ({signals}), policy rule</> : <>With Jev, policy rule</>} <Rule>{h.rule}</Rule> chooses <strong>{action(h.nextAction)}</strong> instead.</>;
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
  return <div className="probability">
    <div className="probability-head"><Typography.Text type="secondary">{label}</Typography.Text><strong>{percent(value)}</strong></div>
    <Progress percent={Math.round((value ?? 0) * 100)} showInfo={false} strokeColor="var(--ai)" trailColor="var(--ai-soft)" size="small" aria-label={label} />
  </div>;
}

function PanelTitle({ tone, step, children }: { tone?: 'rules' | 'ai'; step: number; children: ReactNode }) {
  return <span className="panel-title">{tone && <span className={`role-dot tone-${tone}`} aria-hidden="true" />}<span className="panel-step">{step}</span>{children}</span>;
}

const TOUR_SCENARIO = 'churn';
const COMPARE_STEP = 3;

export default function CrmShowcase({ tourSignal }: { tourSignal: number }) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<CrmPayload | null>(null);
  const [result, setResult] = useState<CrmResult | null>(null);
  const [comparison, setComparison] = useState<Record<Mode, CrmResult> | null>(null);
  const [status, setStatus] = useState('');
  const [violations, setViolations] = useState<Violation[]>([]);
  const [busy, setBusy] = useState<'run' | 'compare' | null>(null);
  const [xml, setXml] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  useEffect(() => {
    api<Fixture[]>('/fixtures/crm-customer').then(items => {
      setFixtures(items);
      if (items.length) { setSelectedId(items[0].id); setPayload(structuredClone(items[0].payload)); }
    }).catch(error => setStatus(String(error)));
    api<{ xml: string }>('/processes/crm-next-best-action').then(data => setXml(data.xml)).catch(error => setStatus(String(error)));
  }, []);

  // First visit: open the tour once the scenarios are there to point at.
  useEffect(() => {
    if (fixtures.length && !tourSeen(TOUR_KEYS.crm)) { setTourStep(0); setTourOpen(true); }
  }, [fixtures.length]);
  // Replay from the header.
  useEffect(() => {
    if (tourSignal) { setTourStep(0); setTourOpen(true); }
  }, [tourSignal]);

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
    setBusy('run'); setResult(null); setComparison(null); setViolations([]); setStatus('');
    try { setResult(await submit(payload.mode)); }
    catch (error) { reportError(error); }
    finally { setBusy(null); }
  }
  async function compare() {
    if (!payload || busy) return;
    setBusy('compare'); setResult(null); setComparison(null); setViolations([]); setStatus('');
    try {
      const [rulesOnly, hybrid] = await Promise.all([submit('rules-only'), submit('hybrid')]);
      setComparison({ 'rules-only': rulesOnly, hybrid });
    } catch (error) { reportError(error); }
    finally { setBusy(null); }
  }

  function closeTour() { setTourOpen(false); markTourSeen(TOUR_KEYS.crm); }
  // The tour drives the page so each step points at something real: it picks the
  // switching-risk customer, turns Jev on, and runs the comparison itself.
  async function changeTourStep(next: number) {
    if (busy) return;
    if (next === 1 && selectedId !== TOUR_SCENARIO && fixtures.some(item => item.id === TOUR_SCENARIO)) selectScenario(TOUR_SCENARIO);
    if (next === 2 && payload && payload.mode !== 'hybrid') setMode('hybrid');
    if (next === COMPARE_STEP + 1 && !comparison) await compare();
    setTourStep(next);
  }
  const tourSteps: TourProps['steps'] = [
    { title: 'Four roles, one decision', target: tourTarget('roles'),
      description: "Rules derive hard facts. Jev, an AI model, judges what the data can't state for sure. Policy decides what's allowed, and BPMN carries it out." },
    { title: 'Pick a customer', target: tourTarget('scenario'),
      description: 'Each scenario is a CRM record. The tour uses Andes Retail: a strategic account whose notes mention a competitor.' },
    { title: 'Rules only, or Rules + Jev', target: tourTarget('mode'),
      description: "Rules only decides on facts alone. Rules + Jev adds AI signals the policy can read. Jev never picks the action." },
    { title: 'Run both modes', target: tourTarget('compare'),
      description: 'Next sends the same customer through both modes at once.',
      nextButtonProps: { children: busy === 'compare' ? 'Running…' : 'Run comparison' } },
    { title: 'Same customer, different answers?', target: tourTarget('verdict'),
      description: 'Each card shows the action a mode chose and the policy rule behind it. The sentence below says why they differ, built from the run itself.' },
    { title: 'Follow the path', target: tourTarget('diagram'),
      description: 'The bronze line is the path the process took; skipped branches fade. Notes show what each step found. Click the other card to redraw it.' },
    { title: 'Signals, not decisions', target: tourTarget('jev'), placement: 'left',
      description: 'Jev returns probabilities with confidence. The policy reads them through fixed, testable thresholds, so every action traces back to a rule.',
      nextButtonProps: { children: 'Done' } },
  ];

  useTourKeys(tourOpen, tourStep, tourSteps.length, { close: closeTour, go: changeTourStep });

  const signalRows = rulesSteps && hybridSteps ? [
    ...factLabels.map(([key, label]) => ({ key, label, rules: <FactValue value={rulesSteps.facts?.[key]} />, hybrid: <FactValue value={hybridSteps.facts?.[key]} />, diff: rulesSteps.facts?.[key] !== hybridSteps.facts?.[key], ai: false })),
    { key: 'switching', label: 'Switching risk', rules: 'not assessed', hybrid: signal(hybridSteps.assessment, hybridSteps.assessment?.switchingRisk), diff: false, ai: true },
    { key: 'attention', label: 'Needs attention', rules: 'not assessed', hybrid: signal(hybridSteps.assessment, hybridSteps.assessment?.needsAttention), diff: false, ai: true },
    { key: 'objective', label: 'Objective', rules: 'not assessed', hybrid: hybridSteps.assessment?.status === 'ok' ? `${hybridSteps.assessment.objective} (${percent(hybridSteps.assessment.objectiveProbability)}, confidence ${percent(hybridSteps.assessment.objectiveConfidence)})` : 'not assessed', diff: false, ai: true },
    { key: 'relationship', label: 'Relationship level', rules: 'not assessed', hybrid: hybridSteps.assessment?.status === 'ok' ? hybridSteps.assessment.relationshipLevel : 'not assessed', diff: false, ai: true },
    { key: 'rule', label: 'Policy rule', rules: <Rule>{rulesSteps.policy?.rule ?? '—'}</Rule>, hybrid: <Rule>{hybridSteps.policy?.rule ?? '—'}</Rule>, diff: rulesSteps.policy?.rule !== hybridSteps.policy?.rule, ai: false },
    { key: 'action', label: 'Final action', rules: action(rulesSteps.policy?.nextAction), hybrid: action(hybridSteps.policy?.nextAction), diff: rulesSteps.policy?.nextAction !== hybridSteps.policy?.nextAction, ai: false },
  ] : [];

  return <div className="crm-page">
    <header className="page-intro">
      <Typography.Text className="eyebrow">CRM next best action</Typography.Text>
      <Typography.Title level={1} className="display-title">Rules for what we know. <em>Jev</em> for what we judge.</Typography.Title>
      <ol className="role-strip" aria-label="Four roles" data-tour="roles">
        <li className="tone-rules"><span className="role-dot" aria-hidden="true" /><strong>Rules</strong> What do we know?</li>
        <li className="tone-ai"><span className="role-dot" aria-hidden="true" /><strong>Jev</strong> What appears true?</li>
        <li className="tone-rules"><span className="role-dot" aria-hidden="true" /><strong>Policy</strong> What may we do?</li>
        <li className="tone-path"><span className="role-dot" aria-hidden="true" /><strong>BPMN</strong> What happens next?</li>
      </ol>
    </header>

    <Card className="controls" size="small">
      <div className="controls-row">
        <label className="control" data-tour="scenario"><Typography.Text type="secondary">Scenario</Typography.Text>
          <Select value={selectedId || undefined} onChange={selectScenario} disabled={!!busy} popupMatchSelectWidth={false} style={{ minWidth: 260 }}
            options={fixtures.map(item => ({ value: item.id, label: item.title }))} aria-label="Scenario" />
        </label>
        <div className="control" data-tour="mode"><Typography.Text type="secondary" id="mode-label">Mode</Typography.Text>
          <Segmented<Mode> aria-labelledby="mode-label" value={payload?.mode ?? 'rules-only'} onChange={setMode} disabled={!payload || !!busy}
            options={[{ value: 'rules-only', label: 'Rules only' }, { value: 'hybrid', label: <span className="ai-option"><span className="role-dot tone-ai" aria-hidden="true" />Rules + Jev</span> }]} />
        </div>
        <Space className="control-actions">
          <Button icon={<PlayCircleOutlined />} onClick={run} disabled={!payload || (!!busy && busy !== 'run')} loading={busy === 'run'}>Run</Button>
          <Button data-tour="compare" type="primary" icon={<SwapOutlined />} onClick={compare} disabled={!payload || (!!busy && busy !== 'compare')} loading={busy === 'compare'}>Compare both modes</Button>
        </Space>
      </div>
      {selected && <Typography.Paragraph type="secondary" className="scenario-description">{selected.description}</Typography.Paragraph>}
    </Card>

    {(status || violations.length > 0) && <Alert type="error" showIcon className="crm-alert" message={status || 'Request failed'}
      description={violations.length > 0 && <ul className="violations">{violations.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</li>)}</ul>} />}

    {comparison && rulesSteps && hybridSteps && payload && <Card className="verdict" aria-label="Mode comparison" data-tour="verdict">
      <div className="verdict-head">
        <Typography.Title level={2} className="verdict-title">{rulesSteps.policy?.nextAction === hybridSteps.policy?.nextAction ? 'Both modes agree' : <>Same customer, <em>two different answers</em></>}</Typography.Title>
        <Typography.Text type="secondary">Select a result to draw its path on the diagram.</Typography.Text>
      </div>
      <div className="verdict-cards">
        {(['rules-only', 'hybrid'] as Mode[]).map(mode => {
          const item = mode === 'hybrid' ? hybridSteps : rulesSteps;
          return <button key={mode} type="button" className={`verdict-card ${mode === 'hybrid' ? 'tone-ai' : 'tone-rules'}`} aria-pressed={payload.mode === mode} onClick={() => setMode(mode)} disabled={!!busy}>
            <span className="eyebrow verdict-eyebrow"><span className="role-dot" aria-hidden="true" />{modeLabels[mode]}</span>
            <strong className="verdict-action">{action(item.policy?.nextAction)}</strong>
            <Rule>{item.policy?.rule ?? '—'}</Rule>
            <span className="verdict-show">{payload.mode === mode ? 'Shown on diagram' : 'Show on diagram'}</span>
          </button>;
        })}
      </div>
      <p className="verdict-why">{explain(rulesSteps, hybridSteps)}</p>
      <Collapse ghost size="small" className="signals" items={[{ key: 'signals', label: 'All facts and signals', children:
        <Table size="small" pagination={false} rowKey="key" dataSource={signalRows} scroll={{ x: true }}
          rowClassName={row => [row.diff ? 'is-diff' : '', row.ai ? 'is-ai-row' : ''].join(' ')}
          columns={[
            { title: 'Result', dataIndex: 'label', render: (value: string) => <span className="row-label">{value}</span> },
            { title: 'Rules only', dataIndex: 'rules' },
            { title: 'Rules + Jev', dataIndex: 'hybrid' },
          ]} /> }]} />
    </Card>}

    <Card className="diagram-card" data-tour="diagram" title={<span>Process path{displayed && payload ? <Typography.Text type="secondary" className="title-suffix"> · {modeLabels[payload.mode]}</Typography.Text> : null}</span>}
      extra={<ul className="legend" aria-label="Legend">
        <li><span className="swatch swatch-path" aria-hidden="true" />Path taken</li>
        <li><span className="swatch swatch-rules" aria-hidden="true" />Rules and policy</li>
        <li><span className="swatch swatch-ai" aria-hidden="true" />AI signals (Jev)</li>
      </ul>}>
      {!displayed && <Typography.Text type="secondary" className="diagram-hint">Run a scenario to see which way the process goes.</Typography.Text>}
      {xml && <ProcessViewer xml={xml} path={runPath} notes={notes} label={displayed ? `Process path: ${(bpmn?.path ?? []).join(', ')}` : 'CRM next best action process'} />}
    </Card>

    <Row gutter={[16, 16]} className="panels">
      <Col xs={24} lg={12}>
        <Card title={<PanelTitle step={1}>Customer state</PanelTitle>} extra={<Button size="small" icon={<ReloadOutlined />} onClick={resetScenario} disabled={!selected || !!busy}>Reset</Button>}>
          {payload ? <>
            <Typography.Title level={4} className="customer-name">{payload.customer.name}</Typography.Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} colon={false} layout="vertical" items={[
              { key: 'segment', label: 'Segment', children: payload.customer.segment },
              { key: 'revenue', label: 'Annual revenue', children: money.format(payload.customer.annualRevenue) },
              { key: 'trend', label: 'Sales trend (90 days)', children: <span className={payload.sales.trend90Days < 0 ? 'trend-down' : ''}>{payload.sales.trend90Days}%</span> },
              { key: 'visit', label: 'Days since last visit', children: payload.activity.daysSinceLastVisit },
              { key: 'order', label: 'Days since last order', children: payload.sales.daysSinceLastOrder },
              { key: 'invoices', label: 'Overdue invoices', children: payload.payments.overdueInvoices },
              { key: 'overdue', label: 'Overdue amount', children: money.format(payload.payments.overdueAmount) },
              { key: 'active', label: 'Active', children: payload.customer.active ? 'Yes' : 'No' },
            ]} />
            <div className="notes-head"><Typography.Title level={5}>Notes</Typography.Title>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setNotes([...payload.notes, ''])} disabled={!!busy || payload.notes.length >= 10}>Add note</Button></div>
            <Space direction="vertical" size={8} className="notes">
              {payload.notes.map((note, index) => <div className="note" key={index}>
                <Input.TextArea aria-label={`Note ${index + 1}`} value={note} maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={!!busy}
                  onChange={event => setNotes(payload.notes.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                <Tooltip title="Remove note"><Button type="text" icon={<DeleteOutlined />} aria-label={`Remove note ${index + 1}`} disabled={!!busy}
                  onClick={() => setNotes(payload.notes.filter((_, itemIndex) => itemIndex !== index))} /></Tooltip>
              </div>)}
            </Space>
          </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Loading scenarios…" />}
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Space direction="vertical" size={16} className="stack">
          <Card className="tone-card tone-rules" title={<PanelTitle tone="rules" step={2}>Business rules</PanelTitle>} extra={<Tag bordered={false}>ZEN</Tag>}>
            {facts ? <ul className="facts">{factLabels.map(([key, label]) => <li key={key}><span>{label}</span><FactValue value={facts[key]} /></li>)}</ul>
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run a scenario to see the facts the rules derive." />}
          </Card>
          <Card className="tone-card tone-ai" data-tour="jev" title={<PanelTitle tone="ai" step={3}>Jev assessment</PanelTitle>}
            extra={assessment?.source === 'mock' ? <Tooltip title="Canned answers per fixture; edited notes are ignored."><Tag color="purple">MOCK</Tag></Tooltip> : <Tag bordered={false} className="ai-tag">AI signals</Tag>}>
            {!assessment ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run a scenario to see the assessment." /> : <>
              {assessment.status === 'skipped' && <Alert type="info" className="ai-alert" message="Skipped in Rules only mode." />}
              {assessment.status === 'unavailable' && <Alert type="warning" showIcon message={`Unavailable: ${assessment.errorKind ?? 'unknown'}`}
                description={policy?.nextAction === 'HUMAN_REVIEW' ? 'Routed to human review.' : `Policy selected ${action(policy?.nextAction)}.`} />}
              {assessment.status === 'ok' && <>
                <ProbabilityBar label="Switching risk" value={assessment.switchingRisk} />
                <ProbabilityBar label="Needs attention" value={assessment.needsAttention} />
                <Descriptions size="small" column={1} colon={false} className="ai-details" items={[
                  { key: 'objective', label: 'Objective', children: `${assessment.objective} · ${percent(assessment.objectiveProbability)} probability · ${percent(assessment.objectiveConfidence)} confidence` },
                  { key: 'relationship', label: 'Relationship risk', children: `${assessment.relationshipLevel} · ${assessment.relationshipRisk?.toFixed(2)} / 3 · ${percent(assessment.relationshipConfidence)} confidence` },
                ]} />
              </>}
              <Typography.Text type="secondary" className="ai-meta">{assessment.model ?? 'No model called'} · {assessment.elapsedMs} ms · signals, not guarantees</Typography.Text>
            </>}
          </Card>
        </Space>
      </Col>
      <Col span={24}>
        <Card title={<PanelTitle step={4}>Decision trace</PanelTitle>}>
          {displayed ? <Timeline className="trace" items={[
            { color: 'var(--rules)', dot: <Tag bordered={false} className="trace-tag tone-rules">ZEN</Tag>, children: <><strong>Facts</strong><div className="trace-facts">{factLabels.map(([key, label]) => <span key={key}>{label} <FactValue value={facts?.[key]} /></span>)}</div></> },
            { color: 'var(--ai)', dot: <Tag bordered={false} className="trace-tag tone-ai">JEV</Tag>, children: <><strong>Signals</strong><p>{assessment?.status === 'ok' ? `Switching ${percent(assessment.switchingRisk)}, attention ${percent(assessment.needsAttention)}, objective ${assessment.objective}, relationship ${assessment.relationshipLevel}` : assessment?.status === 'skipped' ? 'Not assessed (Rules only)' : `Unavailable: ${assessment?.errorKind ?? 'unknown'}`}</p></> },
            { color: 'var(--rules)', dot: <Tag bordered={false} className="trace-tag tone-rules">POLICY</Tag>, children: <><Rule>{policy?.rule ?? '—'}</Rule><p>Next action: <strong>{action(policy?.nextAction)}</strong></p></> },
            { color: 'var(--path)', dot: <Tag bordered={false} className="trace-tag tone-path">BPMN</Tag>, children: <><strong>Path</strong><p>{(bpmn?.path ?? []).map(id => displayed.path.find(item => item.id === id)?.name ?? id).join(' → ')}</p></> },
          ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run a scenario to see ZEN → JEV → POLICY → BPMN." />}
        </Card>
      </Col>
    </Row>
    <Tour open={tourOpen} current={tourStep} onChange={changeTourStep} onClose={closeTour} onFinish={closeTour} steps={tourSteps}
      indicatorsRender={(current, total) => <span className="tour-count">{current + 1} / {total}</span>} />
  </div>;
}
