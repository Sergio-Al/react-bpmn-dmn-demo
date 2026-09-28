import type { JevHttpResponse } from './types.js';

const answers = (attention: number, switching: number, objective: string, objectiveProbability: number, confidence: number, risk: number): JevHttpResponse => ({
  model: 'jev-1.13.0-mock', usage: { input_tokens: 0, output_tokens: 0 }, answers: {
    needs_commercial_attention: { type: 'noul', noul: attention },
    switching_risk: { type: 'noul', noul: switching },
    commercial_objective: { type: 'choice', choice: objective, probabilities: { [objective]: objectiveProbability }, confidence },
    relationship_risk: { type: 'score', score: risk, probabilities: { [String(Math.round(risk))]: 1 }, confidence },
  },
});

const canned: Record<string, JevHttpResponse> = {
  'healthy-customer': answers(0.1, 0.05, 'NORMAL_FOLLOWUP', 0.9, 0.9, 0.1),
  'andes-retail': answers(0.95, 0.91, 'RETENTION', 0.92, 0.88, 2.6),
  'upsell-customer': answers(0.9, 0.1, 'UPSELL', 0.91, 0.83, 0.6),
  'payment-customer': answers(0.95, 0.2, 'COLLECTION', 0.9, 0.9, 2.2),
  'ambiguous-customer': answers(0.7, 0.55, 'RETENTION', 0.55, 0.4, 1.5),
};

export function mockJevResponse(customerId: unknown): JevHttpResponse | null {
  return typeof customerId === 'string' ? canned[customerId] ?? null : null;
}
