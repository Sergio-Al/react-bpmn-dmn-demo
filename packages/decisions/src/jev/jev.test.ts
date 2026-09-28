import assert from 'node:assert/strict';
import test from 'node:test';
import { createJevAssessor } from './index.js';
import { crmQuestions } from './crm-questions.js';

const state = { customer: { id: 'andes-retail' }, notes: ['private note'] };
const body = {
  model: 'jev-1.13.0', usage: { input_tokens: 10, output_tokens: 5 }, answers: {
    needs_commercial_attention: { type: 'noul', noul: 0.95 },
    switching_risk: { type: 'noul', noul: 0.9 },
    commercial_objective: { type: 'choice', choice: 'RETENTION', probabilities: { RETENTION: 0.88 }, confidence: 0.8 },
    relationship_risk: { type: 'score', score: 2.6, legend: { '3': 'CRITICAL' }, probabilities: { '3': 0.6 }, confidence: 0.7 },
  },
};

test('Jev maps all four recorded answer shapes and sends one shared-state request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.state, state);
    assert.deepEqual(Object.keys(request.questions), Object.keys(crmQuestions));
    assert.equal(request.model, 'jev-1.13.0');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const assessment = await createJevAssessor({ apiKey: 'test-secret' }, fetchImpl)(state);
  assert.equal(calls, 1);
  assert.equal(assessment.status, 'ok');
  assert.equal(assessment.source, 'live');
  assert.equal(assessment.needsAttention, 0.95);
  assert.equal(assessment.objectiveProbability, 0.88);
  assert.equal(assessment.relationshipLevel, 'CRITICAL');
});

test('Jev never throws for missing key, auth, timeout, network, invalid JSON or answer shape', async () => {
  const cases: Array<[string, typeof fetch | undefined, string | undefined]> = [
    ['missing-key', undefined, undefined],
    ['auth', async () => new Response('', { status: 401 }), 'key'],
    ['timeout', async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'key'],
    ['timeout', async () => { const response = new Response('', { status: 200 }); response.json = async () => { throw new DOMException('body aborted', 'AbortError'); }; return response; }, 'key'],
    ['network', async () => { throw new TypeError('offline'); }, 'key'],
    ['bad-response', async () => new Response('{', { status: 200 }), 'key'],
    ['bad-response', async () => new Response(JSON.stringify({ ...body, answers: {} }), { status: 200 }), 'key'],
  ];
  for (const [kind, fetchImpl, apiKey] of cases) {
    const assessment = await createJevAssessor({ apiKey }, fetchImpl)(state);
    assert.equal(assessment.status, 'unavailable', kind);
    assert.equal(assessment.errorKind, kind);
    assert.equal(assessment.source, null);
  }
});

test('Jev retries rate-limit and overload once, without exposing error response text', async () => {
  for (const status of [429, 529]) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return calls === 1 ? new Response('secret server detail', { status, headers: { 'retry-after': '0' } }) : new Response(JSON.stringify(body), { status: 200 });
    };
    const assessment = await createJevAssessor({ apiKey: 'key' }, fetchImpl)(state);
    assert.equal(calls, 2);
    assert.equal(assessment.status, 'ok');
  }
});

test('mock mode is explicit and uses fixture customer ids', async () => {
  const assessment = await createJevAssessor({ mode: 'mock' })(state);
  assert.equal(assessment.status, 'ok');
  assert.equal(assessment.source, 'mock');
  assert.equal(assessment.switchingRisk, 0.91);
});
