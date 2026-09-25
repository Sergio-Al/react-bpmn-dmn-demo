import { Ajv, type ErrorObject, type SchemaObject, type ValidateFunction } from 'ajv';
import type { FastifyInstance } from 'fastify';
import type { DecisionService } from '@app/decisions';
import { defaultContractsRoot, getContract, getContractMtime, listContracts } from './contracts.js';
import { getModel } from './store.js';
import { runProcess } from './process.js';
import { ClientError, notFound } from './errors.js';

interface RequestEnvelope {
  requestId: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
}

const envelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'type', 'version', 'payload'],
  properties: {
    requestId: { type: 'string', minLength: 1 },
    type: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
    version: { type: 'integer', minimum: 1 },
    payload: { type: 'object', additionalProperties: true },
  },
} as const;

function escapePointer(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }

function validationErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map(error => {
    let path = error.instancePath;
    if ('missingProperty' in error.params) path += `/${escapePointer(String(error.params.missingProperty))}`;
    if ('additionalProperty' in error.params) path += `/${escapePointer(String(error.params.additionalProperty))}`;
    return { path: path || '/', message: error.message ?? 'Invalid value' };
  });
}

const routingFailure = () => ({ code: 'ROUTING_ERROR', message: 'Routing decision did not select an existing process' });

export function registerRequestRoutes(
  app: FastifyInstance,
  decisions: DecisionService,
  options: { contractsRoot?: string; ajv?: Ajv } = {},
): void {
  const ajv = options.ajv ?? new Ajv({ allErrors: true, strict: true });
  const contractsRoot = options.contractsRoot ?? defaultContractsRoot;
  const validateEnvelope = ajv.compile<RequestEnvelope>(envelopeSchema);
  const validators = new Map<string, { mtimeMs: number; schema: SchemaObject; validate: ValidateFunction }>();

  async function getPayloadValidator(type: string, version: number): Promise<ValidateFunction | null> {
    const key = `${type}@${version}`;
    const mtimeMs = await getContractMtime(type, version, contractsRoot);
    const cached = validators.get(key);
    if (mtimeMs === null) {
      if (cached) {
        ajv.removeSchema(cached.schema);
        validators.delete(key);
      }
      return null;
    }
    if (cached?.mtimeMs === mtimeMs) return cached.validate;
    const schema = await getContract(type, version, contractsRoot);
    if (!schema) return null;
    // Recheck after the read so concurrent requests do not compile the same $id twice.
    const latest = validators.get(key);
    if (latest?.mtimeMs === mtimeMs) return latest.validate;
    if (latest) {
      ajv.removeSchema(latest.schema);
      validators.delete(key);
    }
    const validate = ajv.compile(schema);
    validators.set(key, { mtimeMs, schema, validate });
    return validate;
  }

  app.get('/contracts', async () => listContracts(contractsRoot));
  app.get<{ Params: { type: string; version: string } }>('/contracts/:type/:version', async (request) => {
    const version = Number(request.params.version);
    const contract = await getContract(request.params.type, version, contractsRoot);
    if (!contract) throw notFound('Contract was not found');
    return contract;
  });

  app.post<{ Body: unknown }>('/requests', async (request, reply) => {
    if (!validateEnvelope(request.body)) {
      return reply.code(400).send({ code: 'INVALID_ENVELOPE', errors: validationErrors(validateEnvelope.errors) });
    }
    const envelope = request.body;
    const validatePayload = await getPayloadValidator(envelope.type, envelope.version);
    if (!validatePayload) {
      return reply.code(400).send({ code: 'UNKNOWN_CONTRACT', message: `No contract for ${envelope.type} v${envelope.version}` });
    }
    if (!validatePayload(envelope.payload)) {
      return reply.code(400).send({ code: 'CONTRACT_VIOLATION', errors: validationErrors(validatePayload.errors) });
    }

    let route: Record<string, unknown>;
    try {
      route = await decisions.evaluate(`route-${envelope.type}`, envelope.payload);
    } catch {
      return reply.code(500).send(routingFailure());
    }
    const processKey = route.processKey;
    if (typeof processKey !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(processKey)) {
      return reply.code(500).send(routingFailure());
    }
    let source: string;
    try {
      source = await getModel('processes', processKey);
    } catch (error) {
      if (error instanceof ClientError && error.statusCode === 404) return reply.code(500).send(routingFailure());
      throw error;
    }
    const { processKey: _discard, ...extraVariables } = route;
    const variables = { ...envelope.payload, ...extraVariables, request: {
      requestId: envelope.requestId, type: envelope.type, version: envelope.version,
    } };
    const result = await runProcess(source, variables, decisions);
    return { requestId: envelope.requestId, type: envelope.type, version: envelope.version, processKey, ...result };
  });
}
