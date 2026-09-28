import type { JevQuestions } from './types.js';

export const crmQuestions: JevQuestions = {
  needs_commercial_attention: {
    type: 'noul',
    instructions: 'Does this account currently require proactive commercial attention? Evaluate the customer, sales, payments, activity, and notes in the shared state.',
    criteria: { true: 'Proactive attention is warranted now.', false: 'No proactive commercial attention is warranted now.' },
  },
  switching_risk: {
    type: 'noul',
    instructions: 'Is there meaningful evidence that this customer may switch suppliers? Consider sales.trend90Days, activity.daysSinceLastVisit, and notes in the shared state.',
    criteria: { true: 'There is meaningful evidence of switching risk.', false: 'There is no meaningful evidence of switching risk.' },
  },
  commercial_objective: {
    type: 'choice',
    instructions: 'Which single commercial objective best describes this account right now, based on the shared state?',
    criteria: {
      RETENTION: 'Preserve an account at risk of leaving.',
      UPSELL: 'Expand sales to an account with growth potential.',
      COLLECTION: 'Follow up on overdue payments.',
      NORMAL_FOLLOWUP: 'Routine relationship maintenance.',
      OTHER: 'None of these objectives fit the available evidence.',
    },
  },
  relationship_risk: {
    type: 'score',
    instructions: 'How serious is the overall risk to the customer relationship, based on the shared state?',
    criteria: [
      'LOW: The account is healthy and the relationship is stable.',
      'MEDIUM: Some concerns exist but there is no strong sign of imminent loss.',
      'HIGH: Several concrete warning signs threaten the relationship.',
      'CRITICAL: Strong evidence indicates immediate danger to the relationship.',
    ],
  },
};
