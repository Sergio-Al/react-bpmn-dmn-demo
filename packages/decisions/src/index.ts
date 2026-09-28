import { ZenEngine } from '@gorules/zen-engine';
export * from './jev/index.js';

export interface DecisionService {
  evaluate(decisionKey: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export type DecisionLoader = (decisionKey: string) => Promise<unknown>;

export class ZenDecisionService implements DecisionService {
  private readonly engine = new ZenEngine();

  constructor(private readonly load: DecisionLoader) {}

  async evaluate(decisionKey: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const model = await this.load(decisionKey);
    const decision = this.engine.createDecision(model as object);
    const result = await decision.evaluate(input);
    if (result.result === null || typeof result.result !== 'object' || Array.isArray(result.result)) {
      throw new Error(`Decision ${decisionKey} did not return an object`);
    }
    return result.result as Record<string, unknown>;
  }
}
