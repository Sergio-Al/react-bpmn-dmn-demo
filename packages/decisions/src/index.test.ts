import assert from 'node:assert/strict';
import test from 'node:test';
import { ZenDecisionService } from './index.js';

const model = {
  contentType: 'application/vnd.gorules.decision',
  nodes: [
    { id: 'input', type: 'inputNode', name: 'Input', position: { x: 0, y: 0 } },
    { id: 'table', type: 'decisionTableNode', name: 'Discount', position: { x: 200, y: 0 }, content: {
      hitPolicy: 'first',
      inputs: [{ id: 'tier', name: 'Tier', field: 'customerTier' }],
      outputs: [{ id: 'rate', name: 'Rate', field: 'discountRate' }],
      rules: [
        { _id: 'gold', tier: '"gold"', rate: '0.1' },
        { _id: 'other', tier: '', rate: '0' },
      ],
    } },
  ],
  edges: [{ id: 'edge', type: 'edge', sourceId: 'input', targetId: 'table' }],
};

test('DecisionService evaluates a decision table by key', async () => {
  const requested: string[] = [];
  const service = new ZenDecisionService(async key => { requested.push(key); return model; });
  assert.deepEqual(await service.evaluate('order-discount', { customerTier: 'gold' }), { discountRate: 0.1 });
  assert.deepEqual(await service.evaluate('order-discount', { customerTier: 'silver' }), { discountRate: 0 });
  assert.deepEqual(requested, ['order-discount', 'order-discount']);
});
