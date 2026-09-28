import { JevError, requestJev } from './client.js';
import { mapJevResponse } from './mapping.js';
import { mockJevResponse } from './mock.js';
import type { JevAssessment, JevAssessor, JevConfig } from './types.js';

export { JevError, requestJev } from './client.js';
export { crmQuestions } from './crm-questions.js';
export { mapJevResponse } from './mapping.js';
export type { JevAssessment, JevAssessor, JevConfig, JevErrorKind, JevHttpResponse, JevQuestion, JevQuestions } from './types.js';

export function emptyAssessment(status: 'skipped' | 'unavailable', elapsedMs = 0): JevAssessment {
  return { status, source: null, model: null, elapsedMs, needsAttention: null, switchingRisk: null,
    objective: null, objectiveProbability: null, objectiveConfidence: null,
    relationshipRisk: null, relationshipLevel: null, relationshipConfidence: null };
}

export function createJevAssessor(config: JevConfig, fetchImpl?: typeof fetch): JevAssessor {
  return async state => {
    const started = performance.now();
    try {
      if (config.mode === 'mock') {
        const customer = state.customer as Record<string, unknown> | undefined;
        const response = mockJevResponse(customer?.id);
        if (!response) throw new JevError('bad-response', 'No mock answer for this customer');
        return mapJevResponse(response, 'mock', Math.round(performance.now() - started));
      }
      const response = await requestJev(state, config.apiKey, config.model || 'jev-1.13.0', fetchImpl);
      return mapJevResponse(response, 'live', Math.round(performance.now() - started));
    } catch (error) {
      const result = emptyAssessment('unavailable', Math.round(performance.now() - started));
      return { ...result, errorKind: error instanceof JevError ? error.kind : 'bad-response', message: error instanceof JevError ? error.message : 'Jev assessment failed' };
    }
  };
}
