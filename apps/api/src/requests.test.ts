import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Ajv } from 'ajv';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { getModel } from './store.js';
import { registerRequestRoutes } from './requests.js';
import { validatePortableDecision } from './portable-decision.js';

const order = { customerTier: 'gold', orderTotal: 150, country: 'US' };
const loan = { applicantAge: 30, monthlyIncome: 5000, amount: 20000, termMonths: 24 };
const envelope = (type: string, payload: Record<string, unknown>, version = 1) => ({ requestId: 'test-1', type, version, payload });
const tempSchemaId = 'https://example.test/contracts/cache-test-order-v1';

async function withTempContract(run: (root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'bpmn-contract-cache-'));
  const directory = join(root, 'order');
  const file = join(directory, 'v1.json');
  try {
    await mkdir(directory);
    await writeFile(file, JSON.stringify({
      $id: tempSchemaId,
      type: 'object', additionalProperties: false, required: ['customerTier'],
      properties: { customerTier: { type: 'string', enum: ['gold'] } },
    }));
    await run(root, file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('contract registry lists and reads strict schemas', async () => {
  const app = buildApp();
  try {
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json(), [{ type: 'loan-application', version: 1 }, { type: 'order', version: 1 }]);
    const read = await app.inject({ method: 'GET', url: '/contracts/order/1' });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().additionalProperties, false);
    assert.deepEqual(read.json().required, ['customerTier', 'orderTotal', 'country']);
    assert.equal((await app.inject({ method: 'GET', url: '/contracts/order/2' })).statusCode, 404);
  } finally { await app.close(); }
});

test('routing decisions satisfy the portability guard', async () => {
  for (const type of ['order', 'loan-application']) {
    const graph = JSON.parse(await getModel('decisions', `route-${type}`));
    assert.doesNotThrow(() => validatePortableDecision(graph));
  }
});

test('POST /requests runs every order and loan routing branch', async () => {
  const app = buildApp();
  try {
    const cases = [
      { type: 'order', payload: order, processKey: 'order-discount', step: 'apply-discount', variable: ['discountedTotal', 127.5] },
      { type: 'order', payload: { ...order, orderTotal: 1200 }, processKey: 'high-value-order', step: 'flag-for-review', variable: ['reviewStatus', 'flagged'] },
      { type: 'loan-application', payload: { ...loan, applicantAge: 19 }, processKey: 'loan-manual-review', step: 'review-loan', variable: ['loanStatus', 'manual-review'] },
      { type: 'loan-application', payload: { ...loan, amount: 60000 }, processKey: 'loan-manual-review', step: 'review-loan', variable: ['loanStatus', 'manual-review'] },
      { type: 'loan-application', payload: loan, processKey: 'loan-auto-approve', step: 'approve-loan', variable: ['loanStatus', 'approved'] },
    ] as const;
    for (const entry of cases) {
      const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope(entry.type, entry.payload) });
      assert.equal(response.statusCode, 200, response.body);
      const result = response.json();
      assert.equal(result.processKey, entry.processKey);
      assert.equal(result.requestId, 'test-1');
      assert.equal(result.type, entry.type);
      assert.equal(result.version, 1);
      assert.deepEqual(result.variables.request, { requestId: 'test-1', type: entry.type, version: 1 });
      assert.equal(result.variables[entry.variable[0]], entry.variable[1]);
      assert.ok(result.path.some((step: { id: string }) => step.id === entry.step));
    }
  } finally { await app.close(); }
});

test('POST /requests rejects invalid strict envelopes', async () => {
  const app = buildApp();
  try {
    for (const payload of [
      { ...envelope('order', order), unexpected: true },
      { ...envelope('order', order), requestId: '' },
      { ...envelope('order', order), version: 0 },
      { ...envelope('order', order), payload: [] },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/requests', payload });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, 'INVALID_ENVELOPE');
      assert.ok(response.json().errors.length);
    }
  } finally { await app.close(); }
});

test('POST /requests rejects unknown type and version', async () => {
  const app = buildApp();
  try {
    for (const payload of [envelope('unknown', {}), envelope('order', order, 2)]) {
      const response = await app.inject({ method: 'POST', url: '/requests', payload });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, 'UNKNOWN_CONTRACT');
    }
  } finally { await app.close(); }
});

test('POST /requests returns all contract violation paths', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', { customerTier: 'platinum', orderTotal: -1, extra: true }) });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'CONTRACT_VIOLATION');
    const paths = response.json().errors.map((error: { path: string }) => error.path);
    for (const path of ['/country', '/customerTier', '/orderTotal', '/extra']) assert.ok(paths.includes(path), path);
  } finally { await app.close(); }
});

test('POST /requests treats missing and unknown routing targets as server configuration errors', async () => {
  for (const output of [{}, { processKey: 'not-a-process' }]) {
    const app = Fastify();
    registerRequestRoutes(app, { evaluate: async () => output });
    try {
      const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', order) });
      assert.equal(response.statusCode, 500, response.body);
      assert.equal(response.json().code, 'ROUTING_ERROR');
    } finally { await app.close(); }
  }
  const app = Fastify();
  registerRequestRoutes(app, { evaluate: async () => { throw new Error('Broken routing decision'); } });
  try {
    const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', order) });
    assert.equal(response.statusCode, 500, response.body);
    assert.equal(response.json().code, 'ROUTING_ERROR');
  } finally { await app.close(); }
});

test('a contract with $id validates two consecutive requests', async () => {
  await withTempContract(async root => {
    const app = Fastify();
    registerRequestRoutes(app, { evaluate: async () => ({ processKey: 'loan-auto-approve' }) }, { contractsRoot: root });
    try {
      for (let index = 0; index < 2; index++) {
        const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', { customerTier: 'gold' }) });
        assert.equal(response.statusCode, 200, response.body);
      }
    } finally { await app.close(); }
  });
});

test('contract validator compiles once across requests and replaces its $id after an mtime change', async () => {
  await withTempContract(async (root, file) => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const originalCompile = ajv.compile.bind(ajv);
    const originalRemove = ajv.removeSchema.bind(ajv);
    let contractCompiles = 0;
    let removedSchemas = 0;
    (ajv as any).compile = (schema: any) => {
      if (schema.$id === tempSchemaId) contractCompiles++;
      return originalCompile(schema);
    };
    (ajv as any).removeSchema = (schema: any) => {
      if (schema.$id === tempSchemaId) removedSchemas++;
      return originalRemove(schema);
    };
    const app = Fastify();
    registerRequestRoutes(app, { evaluate: async () => ({ processKey: 'loan-auto-approve' }) }, { contractsRoot: root, ajv });
    try {
      for (let index = 0; index < 25; index++) {
        const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', { customerTier: 'silver' }) });
        assert.equal(response.statusCode, 400, response.body);
        assert.equal(response.json().code, 'CONTRACT_VIOLATION');
      }
      assert.equal(contractCompiles, 1);
      await writeFile(file, JSON.stringify({
        $id: tempSchemaId,
        type: 'object', additionalProperties: false, required: ['customerTier'],
        properties: { customerTier: { type: 'string', enum: ['silver'] } },
      }));
      const changedAt = new Date(Date.now() + 10_000);
      await utimes(file, changedAt, changedAt);
      const response = await app.inject({ method: 'POST', url: '/requests', payload: envelope('order', { customerTier: 'silver' }) });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(contractCompiles, 2);
      assert.equal(removedSchemas, 1);
    } finally { await app.close(); }
  });
});
