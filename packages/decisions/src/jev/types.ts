export type JevErrorKind = 'missing-key' | 'auth' | 'timeout' | 'network' | 'rate-limit' | 'bad-response' | 'http';
export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };
export type JevQuestions = Record<string, JevQuestion>;
export interface JevHttpResponse {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}
export interface JevAssessment {
  status: 'ok' | 'unavailable' | 'skipped';
  source: 'live' | 'mock' | null;
  model: string | null;
  elapsedMs: number;
  needsAttention: number | null;
  switchingRisk: number | null;
  objective: string | null;
  objectiveProbability: number | null;
  objectiveConfidence: number | null;
  relationshipRisk: number | null;
  relationshipLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  relationshipConfidence: number | null;
  errorKind?: JevErrorKind;
  message?: string;
}
export type JevAssessor = (state: Record<string, unknown>) => Promise<JevAssessment>;
export interface JevConfig { apiKey?: string; model?: string; mode?: 'live' | 'mock' }
