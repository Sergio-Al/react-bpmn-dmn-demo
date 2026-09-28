import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Engine } from 'bpmn-engine';
import type { DecisionService } from '@app/decisions';
import { createServiceRegistry, type ServiceDependencies } from './services/index.js';

const require = createRequire(import.meta.url);
const camunda = require('camunda-bpmn-moddle/resources/camunda.json');

export interface ProcessResult {
  variables: Record<string, unknown>;
  path: Array<{ id: string; name: string }>;
}

export async function runProcess(
  source: string,
  input: Record<string, unknown>,
  decisions: DecisionService,
  deps?: ServiceDependencies,
): Promise<ProcessResult> {
  const path: ProcessResult['path'] = [];
  const finalVariables: Record<string, unknown> = { ...input };
  const listener = new EventEmitter();
  listener.on('activity.start', (api: { id: string; name?: string; type?: string }) => {
    if (api.type !== 'bpmn:Process') path.push({ id: api.id, name: api.name ?? api.id });
  });

  const engine = new Engine({ source, moddleOptions: { camunda } });
  const done = engine.waitFor('end');
  await engine.execute({
    listener,
    variables: { ...input },
    services: createServiceRegistry(decisions, finalVariables, deps),
  });
  await done;
  const trace = Array.isArray(finalVariables.trace) ? finalVariables.trace : [];
  trace.push({ step: 'BPMN', path: path.map(activity => activity.id) });
  finalVariables.trace = trace;
  return { variables: finalVariables, path };
}

export function crmRunLog(result: ProcessResult, requestId?: string): Record<string, unknown> {
  const jev = result.variables.jev as Record<string, unknown> | undefined;
  const policy = result.variables.policy as Record<string, unknown> | undefined;
  const status = jev?.status;
  return { event: 'crm-run', requestId: requestId ?? null, model: jev?.model ?? null,
    jevStatus: status ?? null, jevSource: jev?.source ?? null,
    questionIds: ['needs_commercial_attention', 'switching_risk', 'commercial_objective', 'relationship_risk'],
    ...(status === 'ok' ? {
      answers: { needsAttention: jev?.needsAttention, switchingRisk: jev?.switchingRisk, objective: jev?.objective,
        relationshipRisk: jev?.relationshipRisk },
      probabilities: { objective: jev?.objectiveProbability },
      confidence: { objective: jev?.objectiveConfidence, relationship: jev?.relationshipConfidence },
    } : {}),
    ...(status === 'unavailable' ? { errorKind: jev?.errorKind } : {}),
    elapsedMs: jev?.elapsedMs, policyRule: policy?.rule, nextAction: policy?.nextAction,
    bpmnPath: result.path.map(step => step.id) };
}
