/**
 * The outcome vocabulary is the contract: the host declares WHAT its agent
 * produces (artifact kinds with typed, bucketable features) and WHAT can
 * happen to it (an ordered list of outcome events, weakest → strongest).
 * From that one definition the package derives attribution-joined stats by
 * feature bucket and the evidence block a host feeds its own AI to distill a
 * "what works" memo. No model is trained — the agent's CONTEXT gets smarter.
 */

/** A typed artifact feature. Numbers report by the buckets you define;
 *  strings by their closed value set; booleans by true/false. */
export type OutcomeFeatureSpec =
  | {
      type: "number";
      /** Ordered ascending; a value falls in the first bucket whose
       *  `max` it does not exceed, else the final overflow bucket. */
      buckets: readonly { label: string; max: number }[];
      /** Label for values above every bucket's max. */
      overflowLabel: string;
    }
  | { type: "string"; values: readonly string[] }
  | { type: "boolean" };

export type OutcomeFeatures = Record<string, number | string | boolean>;

export type OutcomeArtifactDefinition = {
  /** Human label ("Outreach email", "Generated landing page"). */
  label: string;
  features: Record<string, OutcomeFeatureSpec>;
};

export type OutcomeVocabulary<
  TKind extends string = string,
  TOutcome extends string = string,
> = {
  artifacts: Record<TKind, OutcomeArtifactDefinition>;
  /** Ordered weakest → strongest ("opened" < "replied" < "meeting"). */
  outcomes: readonly TOutcome[];
  kindNames: readonly TKind[];
};

export const defineOutcomeVocabulary = <
  TKind extends string,
  TOutcome extends string,
>(definition: {
  artifacts: Record<TKind, OutcomeArtifactDefinition>;
  outcomes: readonly TOutcome[];
}): OutcomeVocabulary<TKind, TOutcome> => ({
  artifacts: definition.artifacts,
  kindNames: Object.keys(definition.artifacts).sort() as TKind[],
  outcomes: definition.outcomes,
});

/** The bucket label a feature value reports under. */
export const bucketFeatureValue = (
  spec: OutcomeFeatureSpec,
  value: number | string | boolean | undefined,
) => {
  if (value === undefined) return null;
  if (spec.type === "boolean") {
    return typeof value === "boolean" ? String(value) : null;
  }
  if (spec.type === "string") {
    return typeof value === "string" &&
      spec.values.some((entry) => entry === value)
      ? value
      : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const bucket = spec.buckets.find((entry) => value <= entry.max);

  return bucket ? bucket.label : spec.overflowLabel;
};
