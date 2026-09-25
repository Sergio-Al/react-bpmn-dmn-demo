import type { DecisionService } from '@app/decisions';

type ServiceScope = { environment: { variables: Record<string, unknown> } };
type Callback = (error: Error | null, result?: unknown) => void;

export function createServiceRegistry(decisions: DecisionService, variables: Record<string, unknown>) {
  function setVariable(scope: ServiceScope, key: string, value: unknown) {
    scope.environment.variables[key] = value;
    variables[key] = value;
    return value;
  }

  return {
    async evaluateDecision(this: { behaviour?: { decisionRef?: string } }, scope: ServiceScope, callback: Callback) {
      try {
        const key = this.behaviour?.decisionRef;
        if (!key) throw new Error('Business rule task has no decisionRef');
        const result = await decisions.evaluate(key, variables);
        Object.assign(scope.environment.variables, result);
        Object.assign(variables, result);
        callback(null, result);
      } catch (error) { callback(error as Error); }
    },
    applyDiscount(scope: ServiceScope, callback: Callback) {
      const total = Number(scope.environment.variables.orderTotal);
      const rate = Number(scope.environment.variables.discountRate);
      callback(null, setVariable(scope, 'discountedTotal', Number((total * (1 - rate)).toFixed(2))));
    },
    flagForReview(scope: ServiceScope, callback: Callback) {
      callback(null, setVariable(scope, 'reviewStatus', 'flagged'));
    },
    reviewLoan(scope: ServiceScope, callback: Callback) {
      callback(null, setVariable(scope, 'loanStatus', 'manual-review'));
    },
    approveLoan(scope: ServiceScope, callback: Callback) {
      callback(null, setVariable(scope, 'loanStatus', 'approved'));
    },
  };
}
