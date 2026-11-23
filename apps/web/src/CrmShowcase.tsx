import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Col, Collapse, Descriptions, Empty, Input, Progress, Row, Segmented, Select, Space, Table, Tag, Timeline, Tooltip, Tour, Typography, type TourProps } from 'antd';
import { CheckCircleFilled, CloseCircleOutlined, DeleteOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api, ApiError } from './api';
import i18n, { bpmnName, currentLanguage, LANGUAGES, type Language } from './i18n';
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

const factKeys: Array<keyof Facts> = ['strategicAccount', 'salesDeclining', 'visitOverdue', 'paymentProblem'];
const percent = (value: number | null | undefined, t: TFunction) => value == null ? t('common.notAssessed') : `${Math.round(value * 100)}%`;
const action = (value: string | undefined, t: TFunction) => value ? t(`actions.${value}`, { defaultValue: value.replaceAll('_', ' ') }) : '—';
const objective = (value: string | null | undefined, t: TFunction) => value ? t(`objectives.${value}`, { defaultValue: value.toLowerCase() }) : '—';
const level = (value: string | null | undefined, t: TFunction) => value ? t(`levels.${value}`, { defaultValue: value }) : '—';
const money = (value: number, lng: Language) => new Intl.NumberFormat(lng === 'es' ? 'es-BO' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

/** Scenario text comes from the locale files; the API fixtures stay English. */
function scenarioText(fixture: Fixture, lng: Language) {
  const text = i18n.getResource(lng, 'translation', `scenarios.${fixture.id}`) as { title?: string; description?: string; notes?: string[] } | undefined;
  return { title: text?.title ?? fixture.title, description: text?.description ?? fixture.description, notes: Array.isArray(text?.notes) ? text.notes : fixture.payload.notes };
}
const localizedPayload = (fixture: Fixture, lng: Language): CrmPayload => ({ ...structuredClone(fixture.payload), notes: [...scenarioText(fixture, lng).notes] });
const sameNotes = (a: string[], b: string[]) => a.length === b.length && a.every((note, index) => note === b[index]);

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

const Rule = ({ children }: { children?: ReactNode }) => <code className="rule-code">{children}</code>;
const transComponents = { strong: <strong />, rule: <Rule />, ai: <span className="ai-text" /> };

function FactValue({ value }: { value: boolean | undefined }) {
  const { t } = useTranslation();
  if (value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  return value
    ? <span className="fact fact-yes"><CheckCircleFilled aria-hidden="true" /> {t('common.yes')}</span>
    : <span className="fact fact-no"><CloseCircleOutlined aria-hidden="true" /> {t('common.no')}</span>;
}

/** One sentence on why the two modes agree or differ, built from the trace only. */
function Explain({ rules, hybrid }: { rules: Steps; hybrid: Steps }) {
  const { t } = useTranslation();
  const r = rules.policy, h = hybrid.policy, a = hybrid.assessment;
  if (!r || !h) return null;
  const say = (key: string, values: Record<string, string>) => <Trans i18nKey={`crm.explain.${key}`} values={values} components={transComponents} />;
  if (a?.status === 'unavailable') return say('unavailable', { error: a.errorKind ?? 'unknown', rule: h.rule, action: action(h.nextAction, t) });
  if (r.nextAction === h.nextAction) return r.rule === h.rule
    ? say('sameRule', { action: action(r.nextAction, t), rule: r.rule })
    : say('sameAction', { action: action(r.nextAction, t), rulesRule: r.rule, hybridRule: h.rule });
  const base = { rulesAction: action(r.nextAction, t), rulesRule: r.rule, hybridRule: h.rule, hybridAction: action(h.nextAction, t) };
  return a?.status === 'ok'
    ? say('differWithSignals', { ...base, switching: percent(a.switchingRisk, t), attention: percent(a.needsAttention, t), objective: objective(a.objective, t), probability: percent(a.objectiveProbability, t) })
    : say('differ', base);
}

function pathNotes(result: CrmResult | null, t: TFunction): PathNote[] {
  if (!result) return [];
  const { facts, assessment, policy } = steps(result);
  const notes: PathNote[] = [];
  if (facts) notes.push({ id: 'derive-facts', tone: 'rules', text: t('crm.notes.facts', { count: factKeys.filter(key => facts[key]).length, total: factKeys.length }) });
  if (assessment) notes.push({ id: 'assess-with-jev', tone: 'ai', text: assessment.status === 'ok'
    ? t('crm.notes.jevOk', { switching: percent(assessment.switchingRisk, t), objective: objective(assessment.objective, t) })
    : assessment.status === 'skipped' ? t('crm.notes.jevSkipped') : t('crm.notes.jevUnavailable', { error: assessment.errorKind ?? 'unknown' }) });
  if (policy) notes.push({ id: 'apply-policy', tone: 'rules', text: policy.rule });
  return notes;
}

function ProbabilityBar({ label, value }: { label: string; value: number | null }) {
  const { t } = useTranslation();
  return <div className="probability">
    <div className="probability-head"><Typography.Text type="secondary">{label}</Typography.Text><strong>{percent(value, t)}</strong></div>
    <Progress percent={Math.round((value ?? 0) * 100)} showInfo={false} strokeColor="var(--ai)" trailColor="var(--ai-soft)" size="small" aria-label={label} />
  </div>;
}

function PanelTitle({ tone, step, children }: { tone?: 'rules' | 'ai'; step: number; children: ReactNode }) {
  return <span className="panel-title">{tone && <span className={`role-dot tone-${tone}`} aria-hidden="true" />}<span className="panel-step">{step}</span>{children}</span>;
}

const TOUR_SCENARIO = 'churn';
const COMPARE_STEP = 3;

export default function CrmShowcase({ tourSignal }: { tourSignal: number }) {
  const { t, i18n: i18nInstance } = useTranslation();
  const lng = currentLanguage();
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
      if (items.length) { setSelectedId(items[0].id); setPayload(localizedPayload(items[0], currentLanguage())); }
    }).catch(error => setStatus(String(error)));
    api<{ xml: string }>('/processes/crm-next-best-action').then(data => setXml(data.xml)).catch(error => setStatus(String(error)));
  }, []);

  const selected = fixtures.find(item => item.id === selectedId);

  // Switching language swaps the scenario notes too, unless the user has edited them.
  useEffect(() => {
    if (!selected || !payload) return;
    const untouched = LANGUAGES.some(other => sameNotes(payload.notes, scenarioText(selected, other).notes));
    const wanted = scenarioText(selected, lng).notes;
    if (untouched && !sameNotes(payload.notes, wanted)) setPayload({ ...payload, notes: [...wanted] });
  }, [lng]);

  // First visit: open the tour once the scenarios are there to point at.
  useEffect(() => {
    if (fixtures.length && !tourSeen(TOUR_KEYS.crm)) { setTourStep(0); setTourOpen(true); }
  }, [fixtures.length]);
  // Replay from the header.
  useEffect(() => {
    if (tourSignal) { setTourStep(0); setTourOpen(true); }
  }, [tourSignal]);

  const displayed = payload ? comparison?.[payload.mode] ?? result : null;
  const { facts, assessment, policy, bpmn } = steps(displayed);
  const runPath = useMemo(() => displayed ? displayed.path.map(step => step.id) : null, [displayed]);
  const notes = useMemo(() => pathNotes(displayed, t), [displayed, t, i18nInstance.resolvedLanguage]);
  const rulesSteps = comparison ? steps(comparison['rules-only']) : null;
  const hybridSteps = comparison ? steps(comparison.hybrid) : null;
  const modeLabel = (mode: Mode) => t(`modes.${mode}`);
  const factLabel = (key: keyof Facts) => t(`facts.${key}`);

  function clearResults() { setResult(null); setComparison(null); setStatus(''); setViolations([]); }
  function selectScenario(id: string) {
    const fixture = fixtures.find(item => item.id === id);
    if (!fixture) return;
    setSelectedId(id);
    setPayload(localizedPayload(fixture, lng));
    clearResults();
  }
  function resetScenario() {
    if (!selected) return;
    setPayload(localizedPayload(selected, lng));
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
  const tourStepText = (key: string) => ({ title: t(`tours.crm.${key}.title`), description: t(`tours.crm.${key}.description`) });
  const tourSteps: TourProps['steps'] = [
    { ...tourStepText('roles'), target: tourTarget('roles') },
    { ...tourStepText('scenario'), target: tourTarget('scenario') },
    { ...tourStepText('mode'), target: tourTarget('mode') },
    { ...tourStepText('compare'), target: tourTarget('compare'),
      nextButtonProps: { children: busy === 'compare' ? t('common.running') : t('tours.crm.compare.next') } },
    { ...tourStepText('verdict'), target: tourTarget('verdict') },
    { ...tourStepText('diagram'), target: tourTarget('diagram') },
    { ...tourStepText('jev'), target: tourTarget('jev'), placement: 'left', nextButtonProps: { children: t('common.done') } },
  ];

  useTourKeys(tourOpen, tourStep, tourSteps.length, { close: closeTour, go: changeTourStep });

  const notAssessed = t('common.notAssessed');
  const signalRows = rulesSteps && hybridSteps ? [
    ...factKeys.map(key => ({ key, label: factLabel(key), rules: <FactValue value={rulesSteps.facts?.[key]} />, hybrid: <FactValue value={hybridSteps.facts?.[key]} />, diff: rulesSteps.facts?.[key] !== hybridSteps.facts?.[key], ai: false })),
    { key: 'switching', label: t('crm.rows.switching'), rules: notAssessed, hybrid: hybridSteps.assessment?.status === 'ok' ? percent(hybridSteps.assessment.switchingRisk, t) : notAssessed, diff: false, ai: true },
    { key: 'attention', label: t('crm.rows.attention'), rules: notAssessed, hybrid: hybridSteps.assessment?.status === 'ok' ? percent(hybridSteps.assessment.needsAttention, t) : notAssessed, diff: false, ai: true },
    { key: 'objective', label: t('crm.rows.objective'), rules: notAssessed, hybrid: hybridSteps.assessment?.status === 'ok' ? t('crm.objectiveValue', { objective: objective(hybridSteps.assessment.objective, t), probability: percent(hybridSteps.assessment.objectiveProbability, t), confidence: percent(hybridSteps.assessment.objectiveConfidence, t) }) : notAssessed, diff: false, ai: true },
    { key: 'relationship', label: t('crm.rows.relationship'), rules: notAssessed, hybrid: hybridSteps.assessment?.status === 'ok' ? level(hybridSteps.assessment.relationshipLevel, t) : notAssessed, diff: false, ai: true },
    { key: 'rule', label: t('crm.rows.rule'), rules: <Rule>{rulesSteps.policy?.rule ?? '—'}</Rule>, hybrid: <Rule>{hybridSteps.policy?.rule ?? '—'}</Rule>, diff: rulesSteps.policy?.rule !== hybridSteps.policy?.rule, ai: false },
    { key: 'action', label: t('crm.rows.action'), rules: action(rulesSteps.policy?.nextAction, t), hybrid: action(hybridSteps.policy?.nextAction, t), diff: rulesSteps.policy?.nextAction !== hybridSteps.policy?.nextAction, ai: false },
  ] : [];
  const pathText = (bpmn?.path ?? []).map(id => bpmnName(displayed?.path.find(item => item.id === id)?.name ?? id)).join(' → ');

  return <div className="crm-page">
    <header className="page-intro">
      <Typography.Text className="eyebrow">{t('crm.eyebrow')}</Typography.Text>
      <Typography.Title level={1} className="display-title">{t('crm.headlineStart')} <em>{t('crm.headlineAi')}</em> {t('crm.headlineEnd')}</Typography.Title>
      <ol className="role-strip" aria-label={t('crm.rolesLabel')} data-tour="roles">
        {(['rules', 'jev', 'policy', 'bpmn'] as const).map(role => <li key={role} className={role === 'jev' ? 'tone-ai' : role === 'bpmn' ? 'tone-path' : 'tone-rules'}>
          <span className="role-dot" aria-hidden="true" /><strong>{t(`crm.roles.${role}.name`)}</strong> {t(`crm.roles.${role}.question`)}
        </li>)}
      </ol>
    </header>

    <Card className="controls" size="small">
      <div className="controls-row">
        <label className="control" data-tour="scenario"><Typography.Text type="secondary">{t('crm.scenario')}</Typography.Text>
          <Select value={selectedId || undefined} onChange={selectScenario} disabled={!!busy} popupMatchSelectWidth={false} style={{ minWidth: 260 }}
            options={fixtures.map(item => ({ value: item.id, label: scenarioText(item, lng).title }))} aria-label={t('crm.scenario')} />
        </label>
        <div className="control" data-tour="mode"><Typography.Text type="secondary" id="mode-label">{t('crm.mode')}</Typography.Text>
          <Segmented<Mode> aria-labelledby="mode-label" value={payload?.mode ?? 'rules-only'} onChange={setMode} disabled={!payload || !!busy}
            options={[{ value: 'rules-only', label: modeLabel('rules-only') }, { value: 'hybrid', label: <span className="ai-option"><span className="role-dot tone-ai" aria-hidden="true" />{modeLabel('hybrid')}</span> }]} />
        </div>
        <Space className="control-actions">
          <Button icon={<PlayCircleOutlined />} onClick={run} disabled={!payload || (!!busy && busy !== 'run')} loading={busy === 'run'}>{t('crm.run')}</Button>
          <Button data-tour="compare" type="primary" icon={<SwapOutlined />} onClick={compare} disabled={!payload || (!!busy && busy !== 'compare')} loading={busy === 'compare'}>{t('crm.compare')}</Button>
        </Space>
      </div>
      {selected && <Typography.Paragraph type="secondary" className="scenario-description">{scenarioText(selected, lng).description}</Typography.Paragraph>}
    </Card>

    {(status || violations.length > 0) && <Alert type="error" showIcon className="crm-alert" message={status || t('common.requestFailed')}
      description={violations.length > 0 && <ul className="violations">{violations.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</li>)}</ul>} />}

    {comparison && rulesSteps && hybridSteps && payload && <Card className="verdict" aria-label={t('crm.verdictLabel')} data-tour="verdict">
      <div className="verdict-head">
        <Typography.Title level={2} className="verdict-title">{rulesSteps.policy?.nextAction === hybridSteps.policy?.nextAction ? t('crm.agree') : <>{t('crm.differStart')} <em>{t('crm.differEnd')}</em></>}</Typography.Title>
        <Typography.Text type="secondary">{t('crm.selectHint')}</Typography.Text>
      </div>
      <div className="verdict-cards">
        {(['rules-only', 'hybrid'] as Mode[]).map(mode => {
          const item = mode === 'hybrid' ? hybridSteps : rulesSteps;
          return <button key={mode} type="button" className={`verdict-card ${mode === 'hybrid' ? 'tone-ai' : 'tone-rules'}`} aria-pressed={payload.mode === mode} onClick={() => setMode(mode)} disabled={!!busy}>
            <span className="eyebrow verdict-eyebrow"><span className="role-dot" aria-hidden="true" />{modeLabel(mode)}</span>
            <strong className="verdict-action">{action(item.policy?.nextAction, t)}</strong>
            <Rule>{item.policy?.rule ?? '—'}</Rule>
            <span className="verdict-show">{payload.mode === mode ? t('crm.shown') : t('crm.show')}</span>
          </button>;
        })}
      </div>
      <p className="verdict-why"><Explain rules={rulesSteps} hybrid={hybridSteps} /></p>
      <Collapse ghost size="small" className="signals" items={[{ key: 'signals', label: t('crm.allSignals'), children:
        <Table size="small" pagination={false} rowKey="key" dataSource={signalRows} scroll={{ x: true }}
          rowClassName={row => [row.diff ? 'is-diff' : '', row.ai ? 'is-ai-row' : ''].join(' ')}
          columns={[
            { title: t('crm.column.result'), dataIndex: 'label', render: (value: string) => <span className="row-label">{value}</span> },
            { title: modeLabel('rules-only'), dataIndex: 'rules' },
            { title: modeLabel('hybrid'), dataIndex: 'hybrid' },
          ]} /> }]} />
    </Card>}

    <Card className="diagram-card" data-tour="diagram" title={<span>{t('crm.diagram.title')}{displayed && payload ? <Typography.Text type="secondary" className="title-suffix"> · {modeLabel(payload.mode)}</Typography.Text> : null}</span>}
      extra={<ul className="legend" aria-label={t('crm.diagram.legend')}>
        <li><span className="swatch swatch-path" aria-hidden="true" />{t('crm.diagram.path')}</li>
        <li><span className="swatch swatch-rules" aria-hidden="true" />{t('crm.diagram.rules')}</li>
        <li><span className="swatch swatch-ai" aria-hidden="true" />{t('crm.diagram.ai')}</li>
      </ul>}>
      {!displayed && <Typography.Text type="secondary" className="diagram-hint">{t('crm.diagram.hint')}</Typography.Text>}
      {xml && <ProcessViewer xml={xml} path={runPath} notes={notes} label={displayed ? t('crm.diagram.labelRun', { path: pathText }) : t('crm.diagram.label')} />}
    </Card>

    <Row gutter={[16, 16]} className="panels">
      <Col xs={24} lg={12}>
        <Card title={<PanelTitle step={1}>{t('crm.customer.title')}</PanelTitle>} extra={<Button size="small" icon={<ReloadOutlined />} onClick={resetScenario} disabled={!selected || !!busy}>{t('crm.customer.reset')}</Button>}>
          {payload ? <>
            <Typography.Title level={4} className="customer-name">{payload.customer.name}</Typography.Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} colon={false} layout="vertical" items={[
              { key: 'segment', label: t('crm.customer.segment'), children: payload.customer.segment },
              { key: 'revenue', label: t('crm.customer.revenue'), children: money(payload.customer.annualRevenue, lng) },
              { key: 'trend', label: t('crm.customer.trend'), children: <span className={payload.sales.trend90Days < 0 ? 'trend-down' : ''}>{payload.sales.trend90Days}%</span> },
              { key: 'visit', label: t('crm.customer.visit'), children: payload.activity.daysSinceLastVisit },
              { key: 'order', label: t('crm.customer.order'), children: payload.sales.daysSinceLastOrder },
              { key: 'invoices', label: t('crm.customer.invoices'), children: payload.payments.overdueInvoices },
              { key: 'overdue', label: t('crm.customer.overdue'), children: money(payload.payments.overdueAmount, lng) },
              { key: 'active', label: t('crm.customer.active'), children: payload.customer.active ? t('common.yes') : t('common.no') },
            ]} />
            <div className="notes-head"><Typography.Title level={5}>{t('crm.customer.notes')}</Typography.Title>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setNotes([...payload.notes, ''])} disabled={!!busy || payload.notes.length >= 10}>{t('crm.customer.addNote')}</Button></div>
            <Space direction="vertical" size={8} className="notes">
              {payload.notes.map((note, index) => <div className="note" key={index}>
                <Input.TextArea aria-label={t('crm.customer.note', { n: index + 1 })} value={note} maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={!!busy}
                  onChange={event => setNotes(payload.notes.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                <Tooltip title={t('crm.customer.removeNote')}><Button type="text" icon={<DeleteOutlined />} aria-label={t('crm.customer.removeNoteN', { n: index + 1 })} disabled={!!busy}
                  onClick={() => setNotes(payload.notes.filter((_, itemIndex) => itemIndex !== index))} /></Tooltip>
              </div>)}
            </Space>
          </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('crm.customer.loading')} />}
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Space direction="vertical" size={16} className="stack">
          <Card className="tone-card tone-rules" title={<PanelTitle tone="rules" step={2}>{t('crm.rules.title')}</PanelTitle>} extra={<Tag bordered={false}>ZEN</Tag>}>
            {facts ? <ul className="facts">{factKeys.map(key => <li key={key}><span>{factLabel(key)}</span><FactValue value={facts[key]} /></li>)}</ul>
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('crm.rules.empty')} />}
          </Card>
          <Card className="tone-card tone-ai" data-tour="jev" title={<PanelTitle tone="ai" step={3}>{t('crm.jev.title')}</PanelTitle>}
            extra={assessment?.source === 'mock' ? <Tooltip title={t('crm.jev.mockTooltip')}><Tag color="purple">MOCK</Tag></Tooltip> : <Tag bordered={false} className="ai-tag">{t('crm.jev.tag')}</Tag>}>
            {!assessment ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('crm.jev.empty')} /> : <>
              {assessment.status === 'skipped' && <Alert type="info" className="ai-alert" message={t('crm.jev.skipped')} />}
              {assessment.status === 'unavailable' && <Alert type="warning" showIcon message={t('crm.jev.unavailable', { error: assessment.errorKind ?? 'unknown' })}
                description={policy?.nextAction === 'HUMAN_REVIEW' ? t('crm.jev.routedReview') : t('crm.jev.policySelected', { action: action(policy?.nextAction, t) })} />}
              {assessment.status === 'ok' && <>
                <ProbabilityBar label={t('crm.rows.switching')} value={assessment.switchingRisk} />
                <ProbabilityBar label={t('crm.rows.attention')} value={assessment.needsAttention} />
                <Descriptions size="small" column={1} colon={false} className="ai-details" items={[
                  { key: 'objective', label: t('crm.rows.objective'), children: t('crm.jev.objectiveValue', { objective: objective(assessment.objective, t), probability: percent(assessment.objectiveProbability, t), confidence: percent(assessment.objectiveConfidence, t) }) },
                  { key: 'relationship', label: t('crm.jev.relationshipRisk'), children: t('crm.jev.relationshipValue', { level: level(assessment.relationshipLevel, t), risk: assessment.relationshipRisk?.toFixed(2) ?? '—', confidence: percent(assessment.relationshipConfidence, t) }) },
                ]} />
              </>}
              <Typography.Text type="secondary" className="ai-meta">{t('crm.jev.meta', { model: assessment.model ?? t('crm.jev.noModel'), ms: assessment.elapsedMs })}</Typography.Text>
            </>}
          </Card>
        </Space>
      </Col>
      <Col span={24}>
        <Card title={<PanelTitle step={4}>{t('crm.trace.title')}</PanelTitle>}>
          {displayed ? <Timeline className="trace" items={[
            { color: 'var(--rules)', dot: <Tag bordered={false} className="trace-tag tone-rules">ZEN</Tag>, children: <><strong>{t('crm.trace.facts')}</strong><div className="trace-facts">{factKeys.map(key => <span key={key}>{factLabel(key)} <FactValue value={facts?.[key]} /></span>)}</div></> },
            { color: 'var(--ai)', dot: <Tag bordered={false} className="trace-tag tone-ai">JEV</Tag>, children: <><strong>{t('crm.trace.signals')}</strong><p>{assessment?.status === 'ok'
              ? t('crm.trace.signalsOk', { switching: percent(assessment.switchingRisk, t), attention: percent(assessment.needsAttention, t), objective: objective(assessment.objective, t), relationship: level(assessment.relationshipLevel, t) })
              : assessment?.status === 'skipped' ? t('crm.trace.notAssessed') : t('crm.trace.unavailable', { error: assessment?.errorKind ?? 'unknown' })}</p></> },
            { color: 'var(--rules)', dot: <Tag bordered={false} className="trace-tag tone-rules">POLICY</Tag>, children: <><Rule>{policy?.rule ?? '—'}</Rule><p>{t('crm.trace.nextAction')} <strong>{action(policy?.nextAction, t)}</strong></p></> },
            { color: 'var(--path)', dot: <Tag bordered={false} className="trace-tag tone-path">BPMN</Tag>, children: <><strong>{t('crm.trace.path')}</strong><p>{pathText}</p></> },
          ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('crm.trace.empty')} />}
        </Card>
      </Col>
    </Row>
    <Tour open={tourOpen} current={tourStep} onChange={changeTourStep} onClose={closeTour} onFinish={closeTour} steps={tourSteps}
      indicatorsRender={(current, total) => <span className="tour-count">{current + 1} / {total}</span>} />
  </div>;
}
