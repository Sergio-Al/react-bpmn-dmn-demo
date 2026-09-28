import { JevError } from './client.js';
import type { JevAssessment, JevHttpResponse } from './types.js';

const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const objectives = new Set(['RETENTION', 'UPSELL', 'COLLECTION', 'NORMAL_FOLLOWUP', 'OTHER']);
const levels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export function mapJevResponse(response: JevHttpResponse, source: 'live' | 'mock', elapsedMs: number): JevAssessment {
  const attention = response.answers.needs_commercial_attention;
  const switching = response.answers.switching_risk;
  const objective = response.answers.commercial_objective;
  const relationship = response.answers.relationship_risk;
  if (!record(attention) || attention.type !== 'noul' || !probability(attention.noul)
    || !record(switching) || switching.type !== 'noul' || !probability(switching.noul)
    || !record(objective) || objective.type !== 'choice' || !objectives.has(String(objective.choice))
    || !record(objective.probabilities) || !probability(objective.probabilities[String(objective.choice)]) || !probability(objective.confidence)
    || !record(relationship) || relationship.type !== 'score' || typeof relationship.score !== 'number'
    || !Number.isFinite(relationship.score) || relationship.score < 0 || relationship.score > 3 || !probability(relationship.confidence)) {
    throw new JevError('bad-response', 'Jev answers have an invalid shape');
  }
  return {
    status: 'ok', source, model: response.model, elapsedMs,
    needsAttention: attention.noul as number, switchingRisk: switching.noul as number,
    objective: objective.choice as string,
    objectiveProbability: objective.probabilities[objective.choice as string] as number,
    objectiveConfidence: objective.confidence as number,
    relationshipRisk: relationship.score as number,
    relationshipLevel: levels[Math.round(relationship.score as number)],
    relationshipConfidence: relationship.confidence as number,
  };
}
