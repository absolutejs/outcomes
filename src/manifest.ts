import {
  defineImplementation,
  defineManifest,
  toolFactory,
} from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import { computeOutcomeStats } from "./stats";
import type { OutcomeStore } from "./store";
import type { OutcomeVocabulary } from "./vocabulary";

/* Composite runtime (v1 convention): the stats tool needs both the store and
 * the host's vocabulary, so TRuntime is a structural object of the two. */
type OutcomesRuntime = {
  store: OutcomeStore;
  vocabulary: OutcomeVocabulary;
};

/* The package's only serializable knob is the stats threshold; everything
 * else (vocabulary, store) is instance-valued → wiring concerns. */
type StatsOptions = Parameters<typeof computeOutcomeStats>[3];

const tool = toolFactory<OutcomesRuntime>();

const DAYS_PER_YEAR = 365;
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_MIN_SAMPLE = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const manifest = defineManifest<StatsOptions, OutcomesRuntime>()({
  contract: 1,
  identity: {
    accent: "#22c55e",
    category: "ai",
    description:
      "The outcome feedback loop that makes an AI agent measurably better per user without training anything: record what the agent produced (artifacts with typed features frozen at production time), record what happened (opens, replies, conversions), and get attribution-joined stats by feature bucket — quiet below a sample threshold — plus an evidence block your own AI distills into a \"what works\" memo.",
    docsUrl: "https://github.com/absolutejs/outcomes",
    name: "@absolutejs/outcomes",
    tagline: "Learn what your AI produces that actually works.",
  },
  implements: [
    defineImplementation<never>()({
      contract: "outcomes/store",
      factory: "createMemoryOutcomeStore",
      from: "@absolutejs/outcomes",
      title: "In memory (development only — history resets on restart)",
      wiring: {
        code: "createMemoryOutcomeStore()",
        imports: [
          { from: "@absolutejs/outcomes", names: ["createMemoryOutcomeStore"] },
        ],
      },
    }),
  ],
  settings: Type.Object({
    minSample: Type.Optional(
      Type.Integer({
        description:
          "How many tracked artifacts are needed before results are shown. Below this the loop stays quiet instead of showing confident noise. Default is 10.",
        minimum: 1,
        title: "Minimum sample size",
      }),
    ),
  }),
  slots: {
    store: {
      configPath: "$self",
      contract: "outcomes/store",
      description: "Where artifacts and their outcomes are kept",
      known: ["@absolutejs/outcomes#memory"],
      required: true,
    },
  },
  tools: {
    outcome_stats: tool.runtime({
      annotations: { readOnlyHint: true },
      description:
        "Outcome rates for one person's artifacts of one kind — overall, per feature bucket, and per experiment variant. Reports not-ready below the sample threshold instead of guessing.",
      handler: async ({ kind, minSample, ownerId, sinceDays }, runtime) => {
        const { store, vocabulary } = runtime;
        if (!(kind in vocabulary.artifacts)) {
          return `unknown artifact kind "${kind}" — available: ${vocabulary.kindNames.join(", ")}`;
        }
        const since = new Date(
          Date.now() - (sinceDays ?? DEFAULT_SINCE_DAYS) * MS_PER_DAY,
        );
        const rows = await store.listArtifactsWithOutcomes(
          ownerId,
          kind,
          since,
        );

        return JSON.stringify(
          computeOutcomeStats(vocabulary, kind, rows, {
            minSample: minSample ?? DEFAULT_MIN_SAMPLE,
          }),
        );
      },
      input: Type.Object({
        kind: Type.String({ minLength: 1 }),
        minSample: Type.Optional(Type.Integer({ minimum: 1 })),
        ownerId: Type.String({ minLength: 1 }),
        sinceDays: Type.Optional(
          Type.Integer({ maximum: DAYS_PER_YEAR, minimum: 1 }),
        ),
      }),
    }),
    record_outcome: tool.runtime({
      description:
        "Record that an outcome happened to a tracked artifact (e.g. an email got a reply). No-ops when the artifact id is unknown.",
      handler: async ({ artifactId, outcome }, { store }) => {
        await store.recordOutcome({ artifactId, outcome });

        return `recorded ${outcome} for ${artifactId}`;
      },
      input: Type.Object({
        artifactId: Type.String({ minLength: 1 }),
        outcome: Type.String({ minLength: 1 }),
      }),
    }),
  },
  wiring: [
    {
      description:
        "Declare what your agent produces and what can happen to it, pick a store, and record both sides — stats and evidence come from the join.",
      id: "default",
      server: {
        code: [
          "// The vocabulary is the contract: artifact kinds with typed,",
          "// bucketable features, and the outcomes that can happen to them",
          "// (ordered weakest → strongest).",
          "const outcomeVocabulary = defineOutcomeVocabulary({",
          "\t// TODO: replace the example with your real kinds and outcomes.",
          "\tartifacts: {",
          "\t\toutreach_email: {",
          "\t\t\tfeatures: {",
          "\t\t\t\thasQuestion: { type: 'boolean' },",
          "\t\t\t\tsubjectWords: {",
          "\t\t\t\t\tbuckets: [",
          "\t\t\t\t\t\t{ label: 'short', max: 7 },",
          "\t\t\t\t\t\t{ label: 'medium', max: 12 }",
          "\t\t\t\t\t],",
          "\t\t\t\t\toverflowLabel: 'long',",
          "\t\t\t\t\ttype: 'number'",
          "\t\t\t\t}",
          "\t\t\t},",
          "\t\t\tlabel: 'Outreach email'",
          "\t\t}",
          "\t},",
          "\toutcomes: ['opened', 'replied', 'meeting_scheduled']",
          "});",
          "",
          "const outcomeStore = ${slot.store};",
          "",
          "// At production time, freeze the artifact's features:",
          "//   await outcomeStore.recordArtifact({ features, id, kind, ownerId });",
          "// From your signal hooks, record what happened:",
          "//   await outcomeStore.recordOutcome({ artifactId, outcome: 'replied' });",
          "// Periodically, compute stats and let YOUR AI distill the evidence:",
          "//   const rows = await outcomeStore.listArtifactsWithOutcomes(ownerId, kind, since);",
          "//   const stats = computeOutcomeStats(outcomeVocabulary, kind, rows, {",
          "//   \tminSample: ${settings.minSample} ?? 10",
          "//   });",
          "//   if (stats.ready) console.log(renderEvidence(stats));",
        ].join("\n"),
        imports: [
          {
            from: "@absolutejs/outcomes",
            names: [
              "computeOutcomeStats",
              "defineOutcomeVocabulary",
              "renderEvidence",
            ],
          },
        ],
        placement: "module-scope",
      },
      title: "Define the vocabulary and start the loop",
    },
  ],
});
