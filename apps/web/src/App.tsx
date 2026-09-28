import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api';

const ProcessEditor = lazy(() => import('./ProcessEditor'));
const DecisionEditor = lazy(() => import('./DecisionEditor'));
const SendRequest = lazy(() => import('./SendRequest'));
const CrmShowcase = lazy(() => import('./CrmShowcase'));

type Page = 'process' | 'decision' | 'send' | 'crm';
type RunResult = { variables: Record<string, unknown>; path: Array<{ id: string; name: string }> };
const allowedNodes = new Set(['inputNode', 'outputNode', 'decisionTableNode']);
const nodeNames: Record<string, string> = { functionNode: 'Function', expressionNode: 'Expression', switchNode: 'Switch' };

export function App() {
  const [page, setPage] = useState<Page>('process');
  const [processes, setProcesses] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [processKey, setProcessKey] = useState('order-discount');
  const [decisionKey, setDecisionKey] = useState('order-discount');
  const [taskDecisionKey, setTaskDecisionKey] = useState('');
  const [xml, setXml] = useState('');
  const [graph, setGraph] = useState<any>(null);
  const [variables, setVariables] = useState('{"customerTier":"gold","orderTotal":150}');
  const [result, setResult] = useState<RunResult | null>(null);
  const [processSaveStatus, setProcessSaveStatus] = useState('');
  const [decisionSaveStatus, setDecisionSaveStatus] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [loadStatus, setLoadStatus] = useState('');

  useEffect(() => {
    Promise.all([api<string[]>('/processes'), api<string[]>('/decisions')]).then(([p, d]) => { setProcesses(p); setDecisions(d); }).catch(error => setLoadStatus(String(error)));
  }, []);
  useEffect(() => {
    setProcessSaveStatus('');
    api<{ xml: string }>(`/processes/${processKey}`).then(data => { setXml(data.xml); setLoadStatus(''); }).catch(error => setLoadStatus(String(error)));
  }, [processKey]);
  useEffect(() => {
    setDecisionSaveStatus('');
    api<any>(`/decisions/${decisionKey}`).then(data => { setGraph(data); setLoadStatus(''); }).catch(error => setLoadStatus(String(error)));
  }, [decisionKey]);

  async function saveDecision() {
    if (!graph || !Array.isArray(graph.nodes)) {
      setDecisionSaveStatus('Cannot save: decision is not loaded.');
      return;
    }
    const disallowed = [...new Set(graph.nodes
      .filter((node: { type?: string }) => !node.type || !allowedNodes.has(node.type))
      .map((node: { type?: string }) => nodeNames[node.type ?? ''] ?? node.type ?? 'Unknown'))];
    if (disallowed.length) {
      setDecisionSaveStatus(`Cannot save: ${disallowed.join(', ')} ${disallowed.length === 1 ? 'node is' : 'nodes are'} not supported. Use Request, Response, or Decision table.`);
      return;
    }
    try {
      setDecisionSaveStatus('Saving…');
      await api(`/decisions/${decisionKey}`, { method: 'PUT', body: JSON.stringify(graph) });
      setDecisionSaveStatus('Saved');
    } catch (error) { setDecisionSaveStatus(String(error)); }
  }

  async function saveProcess(source: string) {
    try {
      setProcessSaveStatus('Saving…');
      await api(`/processes/${processKey}`, { method: 'PUT', body: JSON.stringify({ xml: source }) });
      setProcessSaveStatus('Saved');
    } catch (error) { setProcessSaveStatus(String(error)); }
  }

  async function run() {
    try {
      setRunStatus('Running…');
      setResult(null);
      const parsed = JSON.parse(variables);
      setResult(await api<RunResult>(`/processes/${processKey}/start`, { method: 'POST', body: JSON.stringify({ variables: parsed }) }));
      setRunStatus('Process completed');
    } catch (error) { setRunStatus(String(error)); }
  }

  return <div className="app-shell">
    <header><h1>BPMN + Decisions</h1><nav><button className={page === 'process' ? 'active' : ''} onClick={() => setPage('process')}>Process modeler</button><button className={page === 'decision' ? 'active' : ''} onClick={() => setPage('decision')}>Decision editor</button><button className={page === 'send' ? 'active' : ''} onClick={() => setPage('send')}>Send request</button><button className={page === 'crm' ? 'active' : ''} onClick={() => setPage('crm')}>CRM showcase</button></nav></header>
    <main className={page === 'send' ? 'send-layout' : page === 'crm' ? 'crm-layout' : ''}>
      {page === 'send' ? <Suspense fallback={<div className="editor-loading">Loading request form…</div>}><SendRequest /></Suspense> : <>
      {page === 'crm' ? <Suspense fallback={<div className="editor-loading">Loading CRM showcase…</div>}><CrmShowcase /></Suspense> : <>
      <section className="workspace">
        <div className="bar"><label>{page === 'process' ? 'Process' : 'Decision'} <select value={page === 'process' ? processKey : decisionKey} onChange={event => page === 'process' ? setProcessKey(event.target.value) : setDecisionKey(event.target.value)}>{(page === 'process' ? processes : decisions).map(key => <option key={key}>{key}</option>)}</select></label>{page === 'decision' && <div className="save-actions"><span role="status">{decisionSaveStatus}</span><button onClick={saveDecision}>Save decision</button></div>}</div>
        {loadStatus && <p className="load-status" role="alert">{loadStatus}</p>}
        <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
          {page === 'process' ? <ProcessEditor xml={xml} onSave={saveProcess} saveStatus={processSaveStatus} decisionKey={taskDecisionKey} setDecisionKey={setTaskDecisionKey} /> : <DecisionEditor graph={graph} onChange={setGraph} />}
        </Suspense>
      </section>
      <aside className="run-panel"><h2>Run process</h2><label>Input variables<textarea value={variables} onChange={event => setVariables(event.target.value)} spellCheck={false} /></label><button onClick={run}>Run</button>{runStatus && <p role="status">{runStatus}</p>}{result && <><h3>Path taken</h3><ol>{result.path.map((step, index) => <li key={`${step.id}-${index}`}>{step.name}</li>)}</ol><h3>Final variables</h3><pre>{JSON.stringify(result.variables, null, 2)}</pre></>}</aside>
      </>}
      </>}
    </main>
  </div>;
}
