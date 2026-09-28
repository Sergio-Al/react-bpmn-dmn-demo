import assert from 'node:assert/strict';
import test from 'node:test';
import type { JevAssessment } from '@app/decisions';
import { emptyAssessment } from '@app/decisions';
import { buildApp } from './app.js';
import { getModel } from './store.js';
import { validatePortableDecision } from './portable-decision.js';

type Fixture = { id: string; payload: Record<string, unknown> };
const signal = (overrides: Partial<JevAssessment> = {}): JevAssessment => ({
  status: 'ok', source: 'mock', model: 'jev-1.13.0', elapsedMs: 12,
  needsAttention: 0.95, switchingRisk: 0.91, objective: 'RETENTION', objectiveProbability: 0.92,
  objectiveConfidence: 0.8, relationshipRisk: 2.6, relationshipLevel: 'CRITICAL', relationshipConfidence: 0.7,
  ...overrides,
});

test('CRM route, facts, and policy decisions are portable', async () => {
  for (const key of ['route-crm-customer', 'crm-customer-facts', 'crm-policy']) {
    const graph = JSON.parse(await getModel('decisions', key));
    assert.doesNotThrow(() => validatePortableDecision(graph));
  }
});

test('CRM fixtures endpoint and strict contract', async () => {
  const app = buildApp({ assessor: async () => signal(), logCrmRun: () => {} });
  try {
    const fixtures = await app.inject({ method: 'GET', url: '/fixtures/crm-customer' });
    assert.equal(fixtures.statusCode, 200);
    assert.equal(fixtures.json().length, 5);
    assert.equal((await app.inject({ method: 'GET', url: '/fixtures/unknown' })).statusCode, 404);
    const invalid = await app.inject({ method: 'POST', url: '/requests', payload: { requestId: 'x', type: 'crm-customer', version: 1,
      payload: { ...fixtures.json()[0].payload, notes: ['x'.repeat(1001)] } } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, 'CONTRACT_VIOLATION');
    assert.ok(invalid.json().errors.some((error: { path: string }) => error.path === '/notes/0'));
  } finally { await app.close(); }
});

test('CRM process follows every policy route and emits one safe structured log', async () => {
  const entries: Record<string, unknown>[] = [];
  const app = buildApp({ assessor: async state => {
    const id = (state.customer as { id: string }).id;
    if (id === 'ambiguous-customer') return signal({ switchingRisk: 0.55, needsAttention: 0.7 });
    if (id === 'upsell-customer') return signal({ switchingRisk: 0.1, objective: 'UPSELL', objectiveProbability: 0.9, objectiveConfidence: 0.8 });
    if (id === 'healthy-customer') return signal({ switchingRisk: 0.1, needsAttention: 0.1 });
    return signal();
  }, logCrmRun: entry => entries.push(entry) });
  try {
    const fixtures = (await app.inject({ method: 'GET', url: '/fixtures/crm-customer' })).json() as Fixture[];
    const cases = [
      ['churn', 'hybrid', 'RETENTION_STRATEGIC_ACCOUNT', 'retention-visit'],
      ['ambiguous', 'hybrid', 'AMBIGUOUS_SWITCHING_RISK', 'human-review'],
      ['upsell', 'hybrid', 'UPSELL_CONFIDENT', 'upsell-followup'],
      ['payment', 'hybrid', 'PAYMENT_DELINQUENCY', 'collection-followup'],
      ['healthy', 'hybrid', 'NO_ATTENTION_NEEDED', 'no-action'],
      ['churn', 'rules-only', 'RULES_ONLY_RISK_UNCLEAR', 'human-review'],
      ['healthy', 'rules-only', 'RULES_ONLY_NO_SIGNAL', 'no-action'],
    ] as const;
    for (const [id, mode, rule, task] of cases) {
      const fixture = fixtures.find(item => item.id === id)!;
      const payload = { ...fixture.payload, mode };
      const response = await app.inject({ method: 'POST', url: '/requests', payload: { requestId: `crm-${id}-${mode}`, type: 'crm-customer', version: 1, payload } });
      assert.equal(response.statusCode, 200, response.body);
      const result = response.json();
      assert.equal(result.variables.policy.rule, rule);
      assert.ok(result.path.some((step: { id: string }) => step.id === task), `${id}/${mode}: ${JSON.stringify(result.path)}`);
      assert.deepEqual(result.variables.trace.map((step: { step: string }) => step.step), ['ZEN', 'JEV', 'ZEN', 'BPMN']);
      assert.equal(result.variables.trace[0].decision, 'crm-customer-facts');
      assert.deepEqual(result.variables.trace[0].output.facts, result.variables.facts);
      assert.equal(result.variables.trace[2].decision, 'crm-policy');
      assert.deepEqual(result.variables.trace[2].output.policy, result.variables.policy);
      assert.equal(Object.keys(result.variables).some(key => key.startsWith('route')), false);
      if (mode === 'rules-only') assert.equal(result.variables.jev.status, 'skipped');
    }
    assert.equal(entries.length, cases.length);
    assert.equal(entries[0].jevStatus, 'ok');
    assert.equal(entries[0].jevSource, 'mock');
    assert.ok('answers' in entries[0]);
    for (const entry of entries.slice(-2)) {
      assert.equal(entry.jevStatus, 'skipped');
      assert.equal(entry.jevSource, null);
      for (const key of ['answers', 'probabilities', 'confidence', 'errorKind']) assert.equal(key in entry, false);
    }
    assert.ok(!JSON.stringify(entries).includes('The customer said a competitor'));
    assert.ok(!JSON.stringify(entries).includes('private note'));
  } finally { await app.close(); }
});

test('unavailable Jev selects human review; payment and inactive rules take precedence', async () => {
  const entries: Record<string, unknown>[] = [];
  const app = buildApp({ assessor: async () => ({ ...emptyAssessment('unavailable'), errorKind: 'network', message: 'offline' }), logCrmRun: entry => entries.push(entry) });
  try {
    const fixtures = (await app.inject({ method: 'GET', url: '/fixtures/crm-customer' })).json() as Fixture[];
    for (const [id, active, rule] of [
      ['churn', true, 'JEV_UNAVAILABLE'], ['payment', true, 'PAYMENT_DELINQUENCY'], ['churn', false, 'INACTIVE_ACCOUNT'],
    ] as const) {
      const fixture = fixtures.find(item => item.id === id)!;
      const payload = { ...fixture.payload, mode: 'hybrid', customer: { ...(fixture.payload.customer as object), active } };
      const response = await app.inject({ method: 'POST', url: '/requests', payload: { requestId: 'x', type: 'crm-customer', version: 1, payload } });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().variables.policy.rule, rule);
    }
    assert.equal(entries[0].jevStatus, 'unavailable');
    assert.equal(entries[0].jevSource, null);
    assert.equal(entries[0].errorKind, 'network');
    for (const key of ['answers', 'probabilities', 'confidence']) assert.equal(key in entries[0], false);
  } finally { await app.close(); }
});

test('strategic decline with low Jev signals creates an account follow-up', async () => {
  const app = buildApp({ assessor: async () => signal({ switchingRisk: 0.1, needsAttention: 0.2 }), logCrmRun: () => {} });
  try {
    const fixtures = (await app.inject({ method: 'GET', url: '/fixtures/crm-customer' })).json() as Fixture[];
    const payload = { ...fixtures.find(item => item.id === 'churn')!.payload, mode: 'hybrid' };
    const response = await app.inject({ method: 'POST', url: '/requests', payload: { requestId: 'strategic-low-signal', type: 'crm-customer', version: 1, payload } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().variables.policy, { nextAction: 'CREATE_ACCOUNT_FOLLOWUP', rule: 'STRATEGIC_DECLINE_FOLLOWUP' });
    assert.ok(response.json().path.some((step: { id: string }) => step.id === 'account-followup'));
    assert.deepEqual(response.json().variables.crmAction, { type: 'CREATE_ACCOUNT_FOLLOWUP', customerId: 'andes-retail' });
  } finally { await app.close(); }
});
