# @absolutejs/outcomes

The outcome feedback loop that makes an AI agent **measurably better per
user** — without training anything.

Built for the AbsoluteJS AI Studio.

## The idea

An agent produces artifacts (outreach emails, generated pages, drafts). Things
happen to them (opens, replies, conversions, meetings). If you record both
sides with typed features frozen at production time, the agent's **context**
can get smarter every week — and you can show users the receipts.

You define the vocabulary once — artifact kinds with typed, bucketable
features, and an ordered list of outcome events — and the package derives:

- **The ledger contract** (`OutcomeStore`): record artifacts + outcomes,
  attribution is the join on your artifact id.
- **The stats** (`computeOutcomeStats`): each outcome's rate overall, per
  feature bucket, and per experiment variant when present (the A/B bolt-on).
  Below your `minSample` it reports not-ready, so hosts stay **quiet instead
  of showing confident noise** — the cold-start contract.
- **The evidence** (`renderEvidence`): a compact text block your OWN AI call
  distills into a "what works for you" memo that conditions future
  generations. The package never calls a model itself.

```ts
import {
  computeOutcomeStats,
  defineOutcomeVocabulary,
  renderEvidence,
} from "@absolutejs/outcomes";

const vocabulary = defineOutcomeVocabulary({
  artifacts: {
    outreach_email: {
      label: "Outreach email",
      features: {
        subjectWords: {
          type: "number",
          buckets: [
            { label: "short", max: 7 },
            { label: "medium", max: 12 },
          ],
          overflowLabel: "long",
        },
        mode: { type: "string", values: ["outreach", "followup"] },
        hasQuestion: { type: "boolean" },
      },
    },
  },
  outcomes: ["opened", "replied", "meeting_scheduled"],
});

// At production time: store.recordArtifact({ id: sendId, ownerId, kind, features })
// From your signal hooks: store.recordOutcome({ artifactId: sendId, outcome: "replied" })

const rows = await store.listArtifactsWithOutcomes(
  ownerId,
  "outreach_email",
  since,
);
const stats = computeOutcomeStats(vocabulary, "outreach_email", rows, {
  minSample: 10,
});
if (stats.ready) {
  const memo = await yourAiCall(
    `Distill what works:\n${renderEvidence(stats)}`,
  );
  // …feed `memo` into every future draft; show `stats` in your UI.
}
```

Same machinery for an outreach copilot (features: subject length, tone;
outcomes: replies) and an AI website builder (features: hero copy length,
layout; outcomes: conversions from your analytics beacon).

## License

Business Source License 1.1 — free for your own products and internal use;
you may not offer it as a competing hosted experimentation/analytics/
optimization service. Converts to Apache 2.0 on July 8, 2030. See
[LICENSE](./LICENSE).
