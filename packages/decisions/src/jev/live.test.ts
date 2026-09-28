import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJevAssessor } from './index.js';

test('live Jev answer shape for Andes Retail', { skip: !process.env.JEV_API_KEY && 'JEV_API_KEY is not set' }, async () => {
  const path = fileURLToPath(new URL('../../../../apps/api/data/fixtures/crm-customer.json', import.meta.url));
  const fixtures = JSON.parse(await readFile(path, 'utf8')) as Array<{ id: string; payload: Record<string, unknown> }>;
  const { mode: _mode, ...state } = fixtures.find(fixture => fixture.id === 'churn')!.payload;
  const assessment = await createJevAssessor({ apiKey: process.env.JEV_API_KEY, model: process.env.JEV_MODEL || 'jev-1.13.0' })(state);
  assert.equal(assessment.status, 'ok', `${assessment.errorKind ?? ''}: ${assessment.message ?? ''}`);
  assert.equal(assessment.source, 'live');
  assert.equal(typeof assessment.model, 'string');
  for (const value of [assessment.needsAttention, assessment.switchingRisk, assessment.objectiveProbability, assessment.objectiveConfidence, assessment.relationshipConfidence]) {
    assert.equal(typeof value, 'number');
    assert.ok(value! >= 0 && value! <= 1);
  }
  assert.ok(['RETENTION', 'UPSELL', 'COLLECTION', 'NORMAL_FOLLOWUP', 'OTHER'].includes(assessment.objective!));
  assert.equal(typeof assessment.relationshipRisk, 'number');
  assert.ok(assessment.relationshipRisk! >= 0 && assessment.relationshipRisk! <= 3);
  assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(assessment.relationshipLevel!));
});
