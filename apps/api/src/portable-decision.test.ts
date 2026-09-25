import assert from 'node:assert/strict';
import test from 'node:test';
import { getModel } from './store.js';
import { validatePortableDecision } from './portable-decision.js';

test('portable decision guard accepts example and rejects function cells', async () => {
  const graph = JSON.parse(await getModel('decisions', 'order-discount'));
  assert.doesNotThrow(() => validatePortableDecision(graph));
  graph.nodes[1].content.rules[0].rate = 'max(0.1, 0.2)';
  assert.throws(() => validatePortableDecision(graph), /literal/);
});
