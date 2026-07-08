import { bucketFeatureValue, type OutcomeVocabulary } from "./vocabulary";
import type { ArtifactWithOutcomes } from "./store";

/**
 * Attribution-joined stats: for one owner's artifacts of one kind, the rate
 * of each outcome overall, per feature bucket, and per experiment variant
 * (the A/B bolt-on — variants group automatically whenever they're present).
 * Below `minSample` the result reports not-ready so hosts stay QUIET instead
 * of showing confident noise (the cold-start contract).
 */

const RATE_DECIMALS = 3;

export type OutcomeRates = {
  count: number;
  /** outcome → {count, rate} — rate is per artifact in this slice. */
  outcomes: Record<string, { count: number; rate: number }>;
};

export type OutcomeStats = {
  ready: boolean;
  sampleSize: number;
  /** Artifacts still needed before `ready` (0 when ready). */
  needed: number;
  overall: OutcomeRates;
  /** feature → bucket label → rates. */
  byFeature: Record<string, Record<string, OutcomeRates>>;
  /** Present only when any artifact carried a variant. */
  byVariant?: Record<string, OutcomeRates>;
};

const round = (value: number) => Number(value.toFixed(RATE_DECIMALS));

const emptyRates = (outcomes: readonly string[]): OutcomeRates => ({
  count: 0,
  outcomes: Object.fromEntries(
    outcomes.map((outcome) => [outcome, { count: 0, rate: 0 }]),
  ),
});

const addToRates = (
  rates: OutcomeRates,
  artifact: ArtifactWithOutcomes,
  outcomes: readonly string[],
) => {
  rates.count += 1;
  for (const outcome of outcomes) {
    const entry = rates.outcomes[outcome];
    if (!entry) continue;
    if (artifact.outcomes.includes(outcome)) entry.count += 1;
  }
};

const finalizeRates = (rates: OutcomeRates) => {
  for (const entry of Object.values(rates.outcomes)) {
    entry.rate = rates.count > 0 ? round(entry.count / rates.count) : 0;
  }
};

export const computeOutcomeStats = <
  TKind extends string,
  TOutcome extends string,
>(
  vocabulary: OutcomeVocabulary<TKind, TOutcome>,
  kind: TKind,
  artifacts: ArtifactWithOutcomes[],
  options: { minSample: number },
): OutcomeStats => {
  const { outcomes } = vocabulary;
  const overall = emptyRates(outcomes);
  const byFeature: Record<string, Record<string, OutcomeRates>> = {};
  const byVariant: Record<string, OutcomeRates> = {};
  const definition = vocabulary.artifacts[kind];

  for (const artifact of artifacts) {
    addToRates(overall, artifact, outcomes);
    for (const [feature, spec] of Object.entries(definition.features)) {
      const bucket = bucketFeatureValue(spec, artifact.features[feature]);
      if (bucket === null) continue;
      const buckets = (byFeature[feature] ??= {});
      const rates = (buckets[bucket] ??= emptyRates(outcomes));
      addToRates(rates, artifact, outcomes);
    }
    if (artifact.variant) {
      const rates = (byVariant[artifact.variant] ??= emptyRates(outcomes));
      addToRates(rates, artifact, outcomes);
    }
  }

  finalizeRates(overall);
  for (const buckets of Object.values(byFeature)) {
    for (const rates of Object.values(buckets)) finalizeRates(rates);
  }
  for (const rates of Object.values(byVariant)) finalizeRates(rates);

  const sampleSize = overall.count;
  const ready = sampleSize >= options.minSample;

  return {
    byFeature,
    ...(Object.keys(byVariant).length > 0 ? { byVariant } : {}),
    needed: ready ? 0 : options.minSample - sampleSize,
    overall,
    ready,
    sampleSize,
  };
};

const PERCENT = 100;

const formatRates = (label: string, rates: OutcomeRates) => {
  const parts = Object.entries(rates.outcomes)
    .filter(([, entry]) => entry.count > 0)
    .map(
      ([outcome, entry]) =>
        `${outcome} ${Math.round(entry.rate * PERCENT)}% (${entry.count})`,
    );

  return `${label}: n=${rates.count}${parts.length > 0 ? ` — ${parts.join(", ")}` : ""}`;
};

/** Compact plain-text evidence block for the HOST'S OWN AI call to distill
 *  into a "what works" memo. The package never calls a model itself. */
export const renderEvidence = (stats: OutcomeStats) => {
  if (!stats.ready) {
    return `Not enough data yet: ${stats.sampleSize} artifacts tracked, ${stats.needed} more needed.`;
  }
  const lines = [formatRates("OVERALL", stats.overall)];
  for (const [feature, buckets] of Object.entries(stats.byFeature)) {
    for (const [bucket, rates] of Object.entries(buckets)) {
      lines.push(formatRates(`${feature}=${bucket}`, rates));
    }
  }
  if (stats.byVariant) {
    for (const [variant, rates] of Object.entries(stats.byVariant)) {
      lines.push(formatRates(`variant=${variant}`, rates));
    }
  }

  return lines.join("\n");
};
