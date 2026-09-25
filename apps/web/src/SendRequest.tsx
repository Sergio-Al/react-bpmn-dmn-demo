import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type ContractRef = { type: string; version: number };
type Contract = { title?: string; examples?: Record<string, unknown>[] };
type SendResult = {
  requestId: string; type: string; version: number; processKey: string;
  variables: Record<string, unknown>; path: Array<{ id: string; name: string }>;
};
type Violation = { path: string; message: string };

export default function SendRequest() {
  const [contracts, setContracts] = useState<ContractRef[]>([]);
  const [selected, setSelected] = useState('');
  const [envelope, setEnvelope] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<SendResult | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);

  useEffect(() => {
    api<ContractRef[]>('/contracts').then(items => {
      setContracts(items);
      const first = items.find(item => item.type === 'order') ?? items[0];
      if (first) setSelected(`${first.type}:${first.version}`);
    }).catch(error => setStatus(String(error)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const [type, versionText] = selected.split(':');
    const version = Number(versionText);
    api<Contract>(`/contracts/${type}/${version}`).then(contract => {
      setEnvelope(JSON.stringify({ requestId: crypto.randomUUID(), type, version, payload: contract.examples?.[0] ?? {} }, null, 2));
      setResult(null);
      setViolations([]);
      setStatus('');
    }).catch(error => setStatus(String(error)));
  }, [selected]);

  async function send() {
    setResult(null);
    setViolations([]);
    setStatus('Sending…');
    try {
      const body = JSON.parse(envelope);
      const response = await api<SendResult>('/requests', { method: 'POST', body: JSON.stringify(body) });
      setResult(response);
      setStatus('Request completed');
    } catch (error) {
      if (error instanceof ApiError && error.details && typeof error.details === 'object') {
        const details = error.details as { code?: string; message?: string; errors?: Violation[] };
        setViolations(details.code === 'CONTRACT_VIOLATION' ? details.errors ?? [] : []);
        setStatus(details.code ? `${details.code}${details.message ? `: ${details.message}` : ''}` : error.message);
      } else {
        setStatus(String(error));
      }
    }
  }

  return <section className="send-page">
    <div className="send-form">
      <h2>Send request</h2>
      <label>Contract <select value={selected} onChange={event => setSelected(event.target.value)}>{contracts.map(item => <option key={`${item.type}:${item.version}`} value={`${item.type}:${item.version}`}>{item.type} v{item.version}</option>)}</select></label>
      <label className="envelope-label">Request envelope<textarea value={envelope} onChange={event => setEnvelope(event.target.value)} spellCheck={false} /></label>
      <button onClick={send} disabled={!envelope}>Send</button>
      {status && <p role="status">{status}</p>}
      {violations.length > 0 && <div role="alert"><h3>Contract violations</h3><ul>{violations.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</li>)}</ul></div>}
    </div>
    <div className="send-result">
      <h2>Result</h2>
      {result ? <><p><strong>Process:</strong> {result.processKey}</p><p><strong>Request ID:</strong> {result.requestId}</p><h3>Path taken</h3><ol>{result.path.map((step, index) => <li key={`${step.id}-${index}`}>{step.name}</li>)}</ol><h3>Final variables</h3><pre>{JSON.stringify(result.variables, null, 2)}</pre></> : <p>Send a request to see its selected process and output.</p>}
    </div>
  </section>;
}
