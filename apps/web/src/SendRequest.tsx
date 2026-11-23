import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Input, Row, Select, Space, Timeline, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from './api';

type ContractRef = { type: string; version: number };
type Contract = { title?: string; examples?: Record<string, unknown>[] };
type SendResult = {
  requestId: string; type: string; version: number; processKey: string;
  variables: Record<string, unknown>; path: Array<{ id: string; name: string }>;
};
type Violation = { path: string; message: string };

export default function SendRequest() {
  const { t } = useTranslation();
  const [contracts, setContracts] = useState<ContractRef[]>([]);
  const [selected, setSelected] = useState('');
  const [envelope, setEnvelope] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
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
    setStatus('');
    setSending(true);
    try {
      const body = JSON.parse(envelope);
      const response = await api<SendResult>('/requests', { method: 'POST', body: JSON.stringify(body) });
      setResult(response);
    } catch (error) {
      if (error instanceof ApiError && error.details && typeof error.details === 'object') {
        const details = error.details as { code?: string; message?: string; errors?: Violation[] };
        setViolations(details.code === 'CONTRACT_VIOLATION' ? details.errors ?? [] : []);
        setStatus(details.code ? `${details.code}${details.message ? `: ${details.message}` : ''}` : error.message);
      } else {
        setStatus(String(error));
      }
    } finally { setSending(false); }
  }

  return <Row gutter={[16, 16]} className="send-page">
    <Col xs={24} lg={12}>
      <Card title={t('send.title')} className="fill-card">
        <Space direction="vertical" size={12} className="stack">
          <label className="control"><Typography.Text type="secondary">{t('send.contract')}</Typography.Text>
            <Select value={selected || undefined} onChange={setSelected} style={{ minWidth: 220 }} aria-label={t('send.contract')}
              options={contracts.map(item => ({ value: `${item.type}:${item.version}`, label: `${item.type} v${item.version}` }))} />
          </label>
          <label><Typography.Text type="secondary">{t('send.envelope')}</Typography.Text>
            <Input.TextArea className="code-input" value={envelope} onChange={event => setEnvelope(event.target.value)} spellCheck={false} autoSize={{ minRows: 14, maxRows: 28 }} />
          </label>
          <Button type="primary" icon={<SendOutlined />} onClick={send} disabled={!envelope} loading={sending}>{t('send.send')}</Button>
          {status && <Alert type="error" showIcon message={status}
            description={violations.length > 0 && <ul className="violations">{violations.map((error, index) => <li key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</li>)}</ul>} />}
        </Space>
      </Card>
    </Col>
    <Col xs={24} lg={12}>
      <Card title={t('send.result')} className="fill-card">
        {result ? <Space direction="vertical" size={16} className="stack">
          <Descriptions size="small" column={1} colon={false} items={[
            { key: 'process', label: t('send.process'), children: <code className="rule-code">{result.processKey}</code> },
            { key: 'request', label: t('send.requestId'), children: <Typography.Text copyable className="mono">{result.requestId}</Typography.Text> },
          ]} />
          <div><Typography.Title level={5}>{t('editor.pathTaken')}</Typography.Title>
            <Timeline className="run-path" items={result.path.map(step => ({ color: 'var(--path)', children: step.name }))} /></div>
          <div><Typography.Title level={5}>{t('editor.finalVariables')}</Typography.Title>
            <pre className="code-block">{JSON.stringify(result.variables, null, 2)}</pre></div>
        </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('send.empty')} />}
      </Card>
    </Col>
  </Row>;
}
