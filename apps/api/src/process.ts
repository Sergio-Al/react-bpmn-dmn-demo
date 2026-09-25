import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Engine } from 'bpmn-engine';
import type { DecisionService } from '@app/decisions';

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
    services: {
      async evaluateDecision(this: any, scope: any, callback: (error: Error | null, result?: unknown) => void) {
        try {
          const key = this.behaviour?.decisionRef;
          if (!key || typeof key !== 'string') throw new Error('Business rule task has no decisionRef');
          const result = await decisions.evaluate(key, finalVariables);
          Object.assign(scope.environment.variables, result);
          Object.assign(finalVariables, result);
          callback(null, result);
        } catch (error) { callback(error as Error); }
      },
      applyDiscount(scope: any, callback: (error: Error | null, result?: unknown) => void) {
        const variables = scope.environment.variables as Record<string, unknown>;
        variables.discountedTotal = Number((Number(variables.orderTotal) * (1 - Number(variables.discountRate))).toFixed(2));
        finalVariables.discountedTotal = variables.discountedTotal;
        callback(null, variables.discountedTotal);
      },
    },
  });
  await done;
  return { variables: finalVariables, path };
}
