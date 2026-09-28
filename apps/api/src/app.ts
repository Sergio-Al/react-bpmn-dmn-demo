import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Engine } from 'bpmn-engine';
import { createJevAssessor, type JevAssessor, ZenDecisionService } from '@app/decisions';
import { getModel, listModels, saveModel } from './store.js';
import { crmRunLog, runProcess } from './process.js';
import { validatePortableDecision } from './portable-decision.js';
import { badRequest, ClientError } from './errors.js';
import { registerRequestRoutes } from './requests.js';

export function buildApp(options: { assessor?: JevAssessor; logCrmRun?: (entry: Record<string, unknown>) => void } = {}) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ClientError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.code(500).send({ error: 'Internal server error' });
  });
  const decisions = new ZenDecisionService(async key => {
    const graph = JSON.parse(await getModel('decisions', key));
    if (key.startsWith('route-')) validatePortableDecision(graph);
    return graph;
  });
  const assessor = options.assessor ?? createJevAssessor({
    apiKey: process.env.JEV_API_KEY, model: process.env.JEV_MODEL, mode: process.env.JEV_MODE === 'mock' ? 'mock' : 'live',
  });
  registerRequestRoutes(app, decisions, { assessor, logCrmRun: options.logCrmRun });

  app.get('/health', async () => ({ ok: true }));
  app.get('/processes', async () => listModels('processes'));
  app.get<{ Params: { id: string } }>('/processes/:id', async request => ({ xml: await getModel('processes', request.params.id) }));
  app.put<{ Params: { id: string }; Body: { xml: string } }>('/processes/:id', async request => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || typeof request.body.xml !== 'string' || !request.body.xml.trim()) throw badRequest('Expected xml string');
    await getModel('processes', request.params.id);
    try {
      const definitions = await new Engine({ source: request.body.xml }).getDefinitions();
      if (!definitions.some(definition => definition.getProcesses().length > 0)) throw new Error('No BPMN process found');
    } catch { throw badRequest('Invalid BPMN XML'); }
    await saveModel('processes', request.params.id, request.body.xml);
    return { saved: true };
  });
  app.post<{ Params: { id: string }; Body: { variables: Record<string, unknown> } }>('/processes/:id/start', async request => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || !request.body.variables || typeof request.body.variables !== 'object' || Array.isArray(request.body.variables)) throw badRequest('Expected variables object');
    const result = await runProcess(await getModel('processes', request.params.id), request.body.variables, decisions, { assessor });
    if (request.params.id === 'crm-next-best-action') {
      (options.logCrmRun ?? (value => console.info(JSON.stringify(value))))(crmRunLog(result));
    }
    return result;
  });
  app.get('/decisions', async () => listModels('decisions'));
  app.get<{ Params: { id: string } }>('/decisions/:id', async request => JSON.parse(await getModel('decisions', request.params.id)));
  app.put<{ Params: { id: string }; Body: object }>('/decisions/:id', async request => {
    const graph = request.body;
    await getModel('decisions', request.params.id);
    try { validatePortableDecision(graph); } catch (error) { throw badRequest((error as Error).message); }
    await saveModel('decisions', request.params.id, JSON.stringify(graph, null, 2));
    return { saved: true };
  });
  return app;
}
