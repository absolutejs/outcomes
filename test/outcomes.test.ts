import { describe, expect, test } from "bun:test";
import { computeOutcomeStats, renderEvidence } from "../src/stats";
import { createMemoryOutcomeStore } from "../src/store";
import { bucketFeatureValue, defineOutcomeVocabulary } from "../src/vocabulary";

const vocabulary = defineOutcomeVocabulary({
  artifacts: {
    outreach_email: {
      features: {
        hasQuestion: { type: "boolean" },
        mode: { type: "string", values: ["outreach", "followup"] },
        subjectWords: {
          buckets: [
            { label: "short", max: 7 },
            { label: "medium", max: 12 },
          ],
          overflowLabel: "long",
          type: "number",
        },
      },
      label: "Outreach email",
    },
  },
  outcomes: ["opened", "replied", "meeting_scheduled"],
});

describe("bucketFeatureValue", () => {
  test("buckets numbers, narrows strings, stringifies booleans", () => {
    const spec = vocabulary.artifacts.outreach_email.features.subjectWords;
    expect(spec && bucketFeatureValue(spec, 5)).toBe("short");
    expect(spec && bucketFeatureValue(spec, 12)).toBe("medium");
    expect(spec && bucketFeatureValue(spec, 30)).toBe("long");
    const mode = vocabulary.artifacts.outreach_email.features.mode;
    expect(mode && bucketFeatureValue(mode, "followup")).toBe("followup");
    expect(mode && bucketFeatureValue(mode, "junk")).toBe(null);
    const flag = vocabulary.artifacts.outreach_email.features.hasQuestion;
    expect(flag && bucketFeatureValue(flag, true)).toBe("true");
  });
});

describe("store + stats", () => {
  const seed = async () => {
    const store = createMemoryOutcomeStore();
    // 6 short-subject sends (4 replied), 6 long (1 replied).
    for (let index = 0; index < 12; index += 1) {
      const short = index < 6;
      await store.recordArtifact({
        features: {
          hasQuestion: short,
          mode: "outreach",
          subjectWords: short ? 5 : 20,
        },
        id: `send-${index}`,
        kind: "outreach_email",
        ownerId: "member-1",
      });
      await store.recordOutcome({
        artifactId: `send-${index}`,
        outcome: "opened",
        ownerId: "member-1",
      });
      const replied = short ? index < 4 : index === 6;
      if (replied) {
        await store.recordOutcome({
          artifactId: `send-${index}`,
          outcome: "replied",
          ownerId: "member-1",
        });
      }
    }
    // Outcome for an unknown artifact is dropped, not errored.
    await store.recordOutcome({
      artifactId: "ghost",
      outcome: "replied",
      ownerId: "member-1",
    });

    return store;
  };

  test("attribution-joined rates overall and per bucket", async () => {
    const store = await seed();
    const rows = await store.listArtifactsWithOutcomes(
      "member-1",
      "outreach_email",
      new Date(0),
    );
    const stats = computeOutcomeStats(vocabulary, "outreach_email", rows, {
      minSample: 10,
    });
    expect(stats.ready).toBe(true);
    expect(stats.sampleSize).toBe(12);
    expect(stats.overall.outcomes.opened?.rate).toBe(1);
    expect(stats.overall.outcomes.replied?.count).toBe(5);
    expect(
      stats.byFeature.subjectWords?.short?.outcomes.replied?.rate,
    ).toBeCloseTo(0.667, 2);
    expect(
      stats.byFeature.subjectWords?.long?.outcomes.replied?.rate,
    ).toBeCloseTo(0.167, 2);
    const evidence = renderEvidence(stats);
    expect(evidence).toContain("OVERALL: n=12");
    expect(evidence).toContain("subjectWords=short");
  });

  test("stays quiet below the sample threshold", async () => {
    const store = await seed();
    const rows = await store.listArtifactsWithOutcomes(
      "member-1",
      "outreach_email",
      new Date(0),
    );
    const stats = computeOutcomeStats(vocabulary, "outreach_email", rows, {
      minSample: 20,
    });
    expect(stats.ready).toBe(false);
    expect(stats.needed).toBe(8);
    expect(renderEvidence(stats)).toContain("Not enough data yet");
  });

  test("variants group when present (experiment bolt-on)", async () => {
    const store = createMemoryOutcomeStore();
    await store.recordArtifact({
      features: { mode: "outreach", subjectWords: 5 },
      id: "a",
      kind: "outreach_email",
      ownerId: "member-1",
      variant: "warm-intro",
    });
    await store.recordOutcome({
      artifactId: "a",
      outcome: "replied",
      ownerId: "member-1",
    });
    await store.recordArtifact({
      features: { mode: "outreach", subjectWords: 5 },
      id: "b",
      kind: "outreach_email",
      ownerId: "member-1",
      variant: "direct-ask",
    });
    const rows = await store.listArtifactsWithOutcomes(
      "member-1",
      "outreach_email",
      new Date(0),
    );
    const stats = computeOutcomeStats(vocabulary, "outreach_email", rows, {
      minSample: 1,
    });
    expect(stats.byVariant?.["warm-intro"]?.outcomes.replied?.rate).toBe(1);
    expect(stats.byVariant?.["direct-ask"]?.outcomes.replied?.rate).toBe(0);
  });
});
