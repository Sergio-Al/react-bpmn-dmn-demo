import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, App as AntApp, Button, Card, ConfigProvider, Empty, Input, Layout, Segmented, Select, Skeleton, Space, Timeline, Tooltip, Tour, Typography, type TourProps } from 'antd';
import { BranchesOutlined, CompassOutlined, MoonOutlined, PlayCircleOutlined, SendOutlined, SunOutlined, TableOutlined, TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import enUS from 'antd/locale/en_US';
import esES from 'antd/locale/es_ES';
import { api } from './api';
import { currentLanguage, LANGUAGES, type Language } from './i18n';
import { antdThemeFor, cssVars, ThemeModeContext, type Mode } from './theme';
import { markTourSeen, TOUR_KEYS, tourSeen, tourTarget, useTourKeys } from './tour';

const ProcessEditor = lazy(() => import('./ProcessEditor'));
const DecisionEditor = lazy(() => import('./DecisionEditor'));
const SendRequest = lazy(() => import('./SendRequest'));
const CrmShowcase = lazy(() => import('./CrmShowcase'));

type Page = 'process' | 'decision' | 'send' | 'crm';
type RunResult = { variables: Record<string, unknown>; path: Array<{ id: string; name: string }> };
type ContractExample = { examples?: Record<string, unknown>[] };
type CrmFixture = { payload: Record<string, unknown> };
const allowedNodes = new Set(['inputNode', 'outputNode', 'decisionTableNode']);
const nodeNames: Record<string, string> = { functionNode: 'Function', expressionNode: 'Expression', switchNode: 'Switch' };

const pages: Array<{ value: Page; icon: ReactNode }> = [
  { value: 'crm', icon: <TeamOutlined /> },
  { value: 'process', icon: <BranchesOutlined /> },
  { value: 'decision', icon: <TableOutlined /> },
  { value: 'send', icon: <SendOutlined /> },
];
const antdLocales = { en: enUS, es: esES } as const;

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage can be unavailable; fall back to the OS setting */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const loading = <div className="page-loading"><Skeleton active paragraph={{ rows: 6 }} /></div>;

export function App() {
  const { t, i18n } = useTranslation();
  const lng = currentLanguage();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [page, setPage] = useState<Page>('crm');
  const [processes, setProcesses] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [processKey, setProcessKey] = useState('order-discount');
  const [decisionKey, setDecisionKey] = useState('order-discount');
  const [taskDecisionKey, setTaskDecisionKey] = useState('');
  const [xml, setXml] = useState('');
  const [graph, setGraph] = useState<any>(null);
  const [variables, setVariables] = useState('{"customerTier":"gold","orderTotal":150,"country":"US"}');
  const inputRevision = useRef(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [highlight, setHighlight] = useState<string[] | null>(null);
  const clearHighlight = useCallback(() => setHighlight(null), []);
  const [processSaveStatus, setProcessSaveStatus] = useState('');
  const [decisionSaveStatus, setDecisionSaveStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [loadStatus, setLoadStatus] = useState('');
  const [crmTourSignal, setCrmTourSignal] = useState(0);
  const [processTourOpen, setProcessTourOpen] = useState(false);
  const [processTourStep, setProcessTourStep] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    try { localStorage.setItem('theme', mode); } catch { /* ignore */ }
  }, [mode]);

  useEffect(() => {
    Promise.all([api<string[]>('/processes'), api<string[]>('/decisions')]).then(([p, d]) => { setProcesses(p); setDecisions(d); }).catch(error => setLoadStatus(String(error)));
  }, []);
  useEffect(() => {
    setProcessSaveStatus('');
    api<{ xml: string }>(`/processes/${processKey}`).then(data => { setXml(data.xml); setLoadStatus(''); }).catch(error => setLoadStatus(String(error)));
  }, [processKey]);
  useEffect(() => {
    let cancelled = false;
    const revision = inputRevision.current;
    async function loadExample() {
      let example: Record<string, unknown> = {};
      if (processKey === 'crm-next-best-action') {
        const fixtures = await api<CrmFixture[]>('/fixtures/crm-customer');
        example = { ...(fixtures[0]?.payload ?? {}), mode: 'hybrid' };
      } else if (processKey.startsWith('loan-')) {
        const contract = await api<ContractExample>('/contracts/loan-application/1');
        example = contract.examples?.[0] ?? {};
      } else if (processKey.startsWith('order-') || processKey === 'high-value-order') {
        const contract = await api<ContractExample>('/contracts/order/1');
        example = { ...(contract.examples?.[0] ?? {}), ...(processKey === 'high-value-order' ? { orderTotal: 1200 } : {}) };
      }
      if (!cancelled && inputRevision.current === revision) setVariables(JSON.stringify(example, null, 2));
    }
    loadExample().catch(error => { if (!cancelled) setLoadStatus(String(error)); });
    return () => { cancelled = true; };
  }, [processKey]);
  useEffect(() => {
    setDecisionSaveStatus('');
    api<any>(`/decisions/${decisionKey}`).then(data => { setGraph(data); setLoadStatus(''); }).catch(error => setLoadStatus(String(error)));
  }, [decisionKey]);

  // Process modeler tour: opens once on the first visit, after bpmn-js has drawn its palette.
  useEffect(() => {
    if (page !== 'process' || !xml || tourSeen(TOUR_KEYS.process)) return;
    const timer = window.setTimeout(() => { setProcessTourStep(0); setProcessTourOpen(true); }, 600);
    return () => window.clearTimeout(timer);
  }, [page, xml]);

  function startTour() {
    if (page === 'crm') setCrmTourSignal(value => value + 1);
    if (page === 'process') { setProcessTourStep(0); setProcessTourOpen(true); }
  }
  function closeProcessTour() { setProcessTourOpen(false); markTourSeen(TOUR_KEYS.process); }
  async function changeProcessTourStep(next: number) {
    if (running) return;
    if (next === 4 && !highlight) await run(); // "Run it" runs the process so the last step shows the drawn path
    setProcessTourStep(next);
  }
  const tourText = (key: string) => ({ title: t(`tours.process.${key}.title`), description: t(`tours.process.${key}.description`) });
  const processTourSteps: TourProps['steps'] = [
    { ...tourText('palette'), target: () => document.querySelector<HTMLElement>('.djs-palette') as HTMLElement, placement: 'right' },
    { ...tourText('tasks'), target: tourTarget('canvas') },
    { ...tourText('input'), target: tourTarget('run-input'), placement: 'left' },
    { ...tourText('run'), target: tourTarget('run'), placement: 'left', nextButtonProps: { children: running ? t('common.running') : t('tours.process.run.next') } },
    { ...tourText('path'), target: tourTarget('canvas'), nextButtonProps: { children: t('common.done') } },
  ];

  useTourKeys(processTourOpen, processTourStep, processTourSteps.length, { close: closeProcessTour, go: changeProcessTourStep });

  async function saveDecision() {
    if (!graph || !Array.isArray(graph.nodes)) {
      setDecisionSaveStatus(t('editor.notLoaded'));
      return;
    }
    const disallowed = [...new Set(graph.nodes
      .filter((node: { type?: string }) => !node.type || !allowedNodes.has(node.type))
      .map((node: { type?: string }) => nodeNames[node.type ?? ''] ?? node.type ?? 'Unknown'))];
    if (disallowed.length) {
      setDecisionSaveStatus(t('editor.unsupported', { count: disallowed.length, nodes: disallowed.join(', ') }));
      return;
    }
    try {
      setDecisionSaveStatus(t('editor.saving'));
      await api(`/decisions/${decisionKey}`, { method: 'PUT', body: JSON.stringify(graph) });
      setDecisionSaveStatus(t('editor.saved'));
    } catch (error) { setDecisionSaveStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function saveProcess(source: string) {
    try {
      setProcessSaveStatus(t('editor.saving'));
      await api(`/processes/${processKey}`, { method: 'PUT', body: JSON.stringify({ xml: source }) });
      setProcessSaveStatus(t('editor.saved'));
    } catch (error) { setProcessSaveStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function run() {
    try {
      setRunning(true);
      setRunError('');
      setResult(null);
      setHighlight(null);
      const parsed = JSON.parse(variables);
      const response = await api<RunResult>(`/processes/${processKey}/start`, { method: 'POST', body: JSON.stringify({ variables: parsed }) });
      setResult(response);
      setHighlight(response.path.map(step => step.id));
    } catch (error) { setRunError(String(error)); }
    finally { setRunning(false); }
  }

  function changeProcess(key: string) {
    if (key === processKey) return;
    inputRevision.current++;
    setProcessKey(key);
    setVariables('{}');
    setResult(null);
    setHighlight(null);
    setRunError('');
  }

  const isEditor = page === 'process' || page === 'decision';
  const keys = page === 'process' ? processes : decisions;

  return <ConfigProvider theme={antdThemeFor(mode)} locale={antdLocales[lng]}>
    <ThemeModeContext.Provider value={mode}>
      <AntApp>
        <Layout className={`app-shell theme-${mode}`} style={cssVars(mode)}>
          <Layout.Header className="app-header">
            <div className="brand"><span className="brand-mark" aria-hidden="true" /><span className="brand-name">{t('app.brandStart')} <em>{t('app.brandEnd')}</em></span></div>
            <Segmented<Page> className="app-nav" value={page} onChange={setPage}
              options={pages.map(item => ({ value: item.value, label: <span className="nav-item">{item.icon}<span className="nav-label">{t(`app.nav.${item.value}`)}</span></span> }))} />
            {(page === 'crm' || page === 'process') && <Tooltip title={t('app.tourTooltip')}>
              <Button type="text" icon={<CompassOutlined />} onClick={startTour}><span className="nav-label">{t('app.tour')}</span></Button>
            </Tooltip>}
            <Segmented<Language> size="small" className="lang-switch" aria-label={t('app.language')} value={lng}
              onChange={value => i18n.changeLanguage(value)}
              options={LANGUAGES.map(code => ({ value: code, label: <span lang={code}>{code.toUpperCase()}</span> }))} />
            <Tooltip title={mode === 'dark' ? t('app.toLight') : t('app.toDark')}>
              <Button type="text" shape="circle" aria-label={mode === 'dark' ? t('app.toLight') : t('app.toDark')}
                icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} />
            </Tooltip>
          </Layout.Header>
          <Layout.Content className={`app-main page-${page}`}>
            {page === 'send' && <Suspense fallback={loading}><SendRequest /></Suspense>}
            {page === 'crm' && <Suspense fallback={loading}><CrmShowcase tourSignal={crmTourSignal} /></Suspense>}
            {isEditor && <div className="editor-layout">
              <Card className="workspace" size="small"
                title={<Space size={8}><Typography.Text type="secondary">{page === 'process' ? t('editor.process') : t('editor.decision')}</Typography.Text>
                  <Select size="middle" style={{ minWidth: 220 }} value={page === 'process' ? processKey : decisionKey}
                    onChange={value => page === 'process' ? changeProcess(value) : setDecisionKey(value)}
                    options={keys.map(key => ({ value: key, label: key }))} /></Space>}
                extra={page === 'decision' && <Space><Typography.Text type="secondary" role="status">{decisionSaveStatus}</Typography.Text><Button type="primary" onClick={saveDecision}>{t('editor.saveDecision')}</Button></Space>}>
                {loadStatus && <Alert type="error" showIcon message={loadStatus} className="load-status" />}
                <Suspense fallback={loading}>
                  {page === 'process'
                    ? <ProcessEditor xml={xml} onSave={saveProcess} saveStatus={processSaveStatus} decisionKey={taskDecisionKey} setDecisionKey={setTaskDecisionKey} highlight={highlight} onEdit={clearHighlight} />
                    : <DecisionEditor graph={graph} onChange={setGraph} />}
                </Suspense>
              </Card>
              <Card className="run-panel" size="small" title={t('editor.runTitle')}>
                <Typography.Text type="secondary">{t('editor.inputVariables')}</Typography.Text>
                <Input.TextArea data-tour="run-input" className="code-input" value={variables} autoSize={{ minRows: 6, maxRows: 14 }} spellCheck={false}
                  onChange={event => { inputRevision.current++; setVariables(event.target.value); }} />
                <Button data-tour="run" type="primary" block icon={<PlayCircleOutlined />} loading={running} onClick={run}>{t('editor.run')}</Button>
                {runError && <Alert type="error" showIcon message={runError} />}
                {result ? <>
                  <div className="run-section">
                    <Typography.Title level={5}>{t('editor.pathTaken')}</Typography.Title>
                    {page === 'process' && <Typography.Text type="secondary">{highlight ? t('editor.drawn') : t('editor.stale')}</Typography.Text>}
                    <Timeline className="run-path" items={result.path.map(step => ({ color: 'var(--path)', children: step.name }))} />
                  </div>
                  <div className="run-section">
                    <Typography.Title level={5}>{t('editor.finalVariables')}</Typography.Title>
                    <pre className="code-block">{JSON.stringify(result.variables, null, 2)}</pre>
                  </div>
                </> : !runError && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('editor.runEmpty')} />}
              </Card>
            </div>}
          </Layout.Content>
          {page === 'process' && <Tour open={processTourOpen} current={processTourStep} onChange={changeProcessTourStep} onClose={closeProcessTour} onFinish={closeProcessTour}
            steps={processTourSteps} indicatorsRender={(current, total) => <span className="tour-count">{current + 1} / {total}</span>} />}
        </Layout>
      </AntApp>
    </ThemeModeContext.Provider>
  </ConfigProvider>;
}
