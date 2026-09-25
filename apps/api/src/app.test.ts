import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from './app.js';
import { getModel } from './store.js';

test('API runs the order discount process through both gateway paths', async () => {
  const app = buildApp();
  try {
    const processes = await app.inject({ method: 'GET', url: '/processes' });
    assert.equal(processes.statusCode, 200);
    assert.deepEqual(processes.json(), ['order-discount']);

    const gold = await app.inject({ method: 'POST', url: '/processes/order-discount/start', payload: { variables: { customerTier: 'gold', orderTotal: 150 } } });
    assert.equal(gold.statusCode, 200, gold.body);
    assert.equal(gold.json().variables.discountRate, 0.15);
    assert.equal(gold.json().variables.discountedTotal, 127.5);
    assert.ok(gold.json().path.some((step: { id: string }) => step.id === 'apply-discount'));

    const silver = await app.inject({ method: 'POST', url: '/processes/order-discount/start', payload: { variables: { customerTier: 'silver', orderTotal: 150 } } });
    assert.equal(silver.statusCode, 200, silver.body);
    assert.equal(silver.json().variables.discountRate, 0);
    assert.ok(silver.json().path.some((step: { id: string }) => step.id === 'no-discount'));
  } finally { await app.close(); }
});

test('API returns 400 for invalid keys, payloads, BPMN XML, and non-portable decisions', async () => {
  const app = buildApp();
  try {
    const graph = JSON.parse(await getModel('decisions', 'order-discount'));
    graph.nodes[1].content.rules[0].rate = 'max(0.1, 0.2)';
    const requests = [
      { method: 'GET', url: '/processes/bad_key' },
      { method: 'GET', url: '/decisions/bad_key' },
      { method: 'PUT', url: '/processes/order-discount', payload: {} },
      { method: 'PUT', url: '/processes/order-discount', payload: { xml: '<not-bpmn' } },
      { method: 'PUT', url: '/processes/order-discount', payload: { xml: '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="empty" />' } },
      { method: 'PUT', url: '/decisions/order-discount', payload: {} },
      { method: 'PUT', url: '/decisions/order-discount', payload: graph },
      { method: 'POST', url: '/processes/order-discount/start', payload: {} },
      { method: 'POST', url: '/processes/order-discount/start', payload: { variables: [] } },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 400, `${request.method} ${request.url}: ${response.body}`);
    }
    for (const request of [
      { method: 'POST', url: '/processes/order-discount/start' },
      { method: 'PUT', url: '/processes/order-discount' },
      { method: 'PUT', url: '/decisions/order-discount' },
    ] as const) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 400, `${request.method} ${request.url}: ${response.body}`);
    }
    const invalidJson = await app.inject({ method: 'PUT', url: '/decisions/order-discount', headers: { 'content-type': 'application/json' }, payload: '{' });
    assert.equal(invalidJson.statusCode, 400);
  } finally { await app.close(); }
});

test('API returns 404 for unknown model ids', async () => {
  const app = buildApp();
  try {
    const xml = await getModel('processes', 'order-discount');
    const graph = JSON.parse(await getModel('decisions', 'order-discount'));
    const requests = [
      { method: 'GET', url: '/processes/unknown' },
      { method: 'GET', url: '/decisions/unknown' },
      { method: 'POST', url: '/processes/unknown/start', payload: { variables: {} } },
      { method: 'PUT', url: '/processes/unknown', payload: { xml } },
      { method: 'PUT', url: '/decisions/unknown', payload: graph },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 404, `${request.method} ${request.url}: ${response.body}`);
    }
  } finally { await app.close(); }
});
