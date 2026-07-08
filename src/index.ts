/**
 * `@absolutejs/outcomes` — the outcome feedback loop that makes an AI agent
 * measurably better per user WITHOUT training anything: record what the
 * agent produced (artifacts with typed features), record what happened
 * (ordered outcome events), compute attribution-joined stats by feature
 * bucket ({@link computeOutcomeStats} — quiet below a sample threshold), and
 * render the evidence ({@link renderEvidence}) the HOST'S own AI distills
 * into a "what works" memo that conditions future generations. Experiment
 * variants group automatically when present (the A/B bolt-on).
 */

export {
  computeOutcomeStats,
  renderEvidence,
  type OutcomeRates,
  type OutcomeStats,
} from "./stats";
export {
  createMemoryOutcomeStore,
  type ArtifactWithOutcomes,
  type OutcomeArtifactInput,
  type OutcomeStore,
} from "./store";
export {
  bucketFeatureValue,
  defineOutcomeVocabulary,
  type OutcomeArtifactDefinition,
  type OutcomeFeatureSpec,
  type OutcomeFeatures,
  type OutcomeVocabulary,
} from "./vocabulary";
