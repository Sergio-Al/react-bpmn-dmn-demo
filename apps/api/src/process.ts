import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Engine } from 'bpmn-engine';
import type { DecisionService } from '@app/decisions';
import { createServiceRegistry } from './services/index.js';

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
    services: createServiceRegistry(decisions, finalVariables),
  });
  await done;
  return { variables: finalVariables, path };
}
