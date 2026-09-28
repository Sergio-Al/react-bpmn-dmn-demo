import { emptyAssessment, type DecisionService, type JevAssessor } from '@app/decisions';

type ServiceScope = { environment: { variables: Record<string, unknown> } };
type Callback = (error: Error | null, result?: unknown) => void;

export interface ServiceDependencies { assessor: JevAssessor }

export function createServiceRegistry(decisions: DecisionService, variables: Record<string, unknown>, deps?: ServiceDependencies) {
  function setVariable(scope: ServiceScope, key: string, value: unknown) {
    scope.environment.variables[key] = value;
    variables[key] = value;
    return value;
  }

  function appendTrace(step: Record<string, unknown>) {
    const trace = Array.isArray(variables.trace) ? variables.trace as Record<string, unknown>[] : [];
    trace.push(step);
    variables.trace = trace;
  }

  return {
    async evaluateDecision(this: { behaviour?: { decisionRef?: string } }, scope: ServiceScope, callback: Callback) {
      try {
        const key = this.behaviour?.decisionRef;
        if (!key) throw new Error('Business rule task has no decisionRef');
        const result = await decisions.evaluate(key, variables);
        Object.assign(scope.environment.variables, result);
        Object.assign(variables, result);
        appendTrace({ step: 'ZEN', decision: key, output: result });
        callback(null, result);
      } catch (error) { callback(error as Error); }
    },
    async assessWithJev(scope: ServiceScope, callback: Callback) {
      try {
        const assessment = variables.mode === 'rules-only' ? emptyAssessment('skipped') :
          deps ? await deps.assessor({ customer: variables.customer, sales: variables.sales, payments: variables.payments,
            activity: variables.activity, notes: variables.notes }) : { ...emptyAssessment('unavailable'), errorKind: 'missing-key' as const, message: 'Jev assessor is not configured' };
        setVariable(scope, 'jev', assessment);
        appendTrace({ step: 'JEV', assessment });
        callback(null, assessment);
      } catch {
        const assessment = { ...emptyAssessment('unavailable'), errorKind: 'bad-response' as const, message: 'Jev assessment failed' };
        setVariable(scope, 'jev', assessment);
        appendTrace({ step: 'JEV', assessment });
        callback(null, assessment);
      }
    },
    recordCrmAction(scope: ServiceScope, callback: Callback) {
      const policy = variables.policy as { nextAction?: string } | undefined;
      const customer = variables.customer as { id?: string } | undefined;
      callback(null, setVariable(scope, 'crmAction', { type: policy?.nextAction, customerId: customer?.id }));
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
