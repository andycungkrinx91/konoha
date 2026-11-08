'use strict';

const { Annotation } = require('@langchain/langgraph');

const KonohaWorkflowState = Annotation.Root({
  threadId: Annotation({ default: () => '' }),
  taskDir: Annotation({ default: () => '' }),
  projectPath: Annotation({ default: () => '' }),
  prompt: Annotation({ default: () => '' }),
  intent: Annotation({ default: () => '' }),
  sessionId: Annotation({ default: () => '' }),
  client: Annotation({ default: () => '' }),
  flowHash: Annotation({ default: () => '' }),
  invocationMode: Annotation({ default: () => 'konoha_orchestrator' }),
  directSubagent: Annotation({ default: () => '' }),
  mandatoryKageReview: Annotation({ default: () => false }),
  isFastTrack: Annotation({ default: () => false }),
  phase: Annotation({ default: () => 'init' }),

  plan: Annotation({ default: () => null }),
  brief: Annotation({ default: () => null }),
  todos: Annotation({
    reducer: (curr, update) => {
      if (Array.isArray(update)) return update;
      if (update == null) return curr;
      const base = curr || [];
      return [...base, update];
    },
    default: () => [],
  }),

  slices: Annotation({
    reducer: (curr, update) => {
      if (Array.isArray(update)) return update;
      if (update == null) return curr;
      const base = curr || [];
      return [...base, update];
    },
    default: () => [],
  }),

  sliceResults: Annotation({
    reducer: (curr, update) => {
      if (!update || typeof update !== 'object') return curr;
      const base = curr || {};
      return { ...base, ...update };
    },
    default: () => ({}),
  }),

  tokenBudget: Annotation({ default: () => 8192 }),
  tokensUsed: Annotation({
    reducer: (curr, update) => (curr || 0) + (typeof update === 'number' ? update : 0),
    default: () => 0,
  }),
  turnTokensUsed: Annotation({
    reducer: (curr, update) => (typeof update === 'number' ? update : (curr || 0)),
    default: () => 0,
  }),
  turnIndex: Annotation({ default: () => 1 }),
  resumeNode: Annotation({ default: () => '' }),
  trace: Annotation({
    reducer: (curr, update) => {
      if (Array.isArray(update)) return [...(curr || []), ...update];
      if (update != null && update !== '') return [...(curr || []), update];
      return curr || [];
    },
    default: () => [],
  }),
  budgetExceeded: Annotation({ default: () => false }),

  remediationCount: Annotation({
    reducer: (curr, update) => {
      if (typeof update === 'number') return update;
      return (curr || 0) + 1;
    },
    default: () => 0,
  }),
  circuitOpen: Annotation({ default: () => false }),
  circuitState: Annotation({ default: () => 'CLOSED' }),

  status: Annotation({ default: () => null }),
  report: Annotation({ default: () => '' }),
  confidence: Annotation({ default: () => 100 }),
  gateVerdict: Annotation({ default: () => '' }),

  hitlPending: Annotation({ default: () => false }),
  hitlStage: Annotation({ default: () => null }),
  hitlChoice: Annotation({ default: () => null }),
  hitlRefinement: Annotation({ default: () => null }),
  autoSignoff: Annotation({ default: () => false }),

  result: Annotation({ default: () => null }),
  error: Annotation({ default: () => null }),
});

module.exports = {
  KonohaWorkflowState,
};
