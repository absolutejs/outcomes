import { describe, expect, test } from "bun:test";
import {
  compareOutcomeSlices,
  computeOutcomeStats,
  createMemoryOutcomeStore,
  defineOutcomeVocabulary,
} from "../src/index";
import type { ArtifactWithOutcomes } from "../src/store";

/** A chat response, sliced by things you CANNOT enumerate when you write the
 *  code — the hash of the prompt that produced it. */
const VOCABULARY = defineOutcomeVocabulary({
  artifacts: {
    chat_response: {
      features: {
        // Open vocabulary: no `values`. This is the whole point — the prompt
        // version you want to compare didn't exist when this line was written.
        promptVersion: { type: "string" },
        slow: { type: "boolean" },
      },
      label: "Chat response",
    },
  },
  outcomes: ["rated_bad", "rated_good"],
});

const artifact = (
  id: string,
  promptVersion: string,
  slow: boolean,
  outcome: string,
): ArtifactWithOutcomes => ({
  features: { promptVersion, slow },
  id,
  outcomes: [outcome],
  variant: null,
});

describe("open-vocabulary features", () => {
  test("a value nobody enumerated still gets its own bucket", () => {
    const stats = computeOutcomeStats(
      VOCABULARY,
      "chat_response",
      [
        artifact("1", "a1b2c3", false, "rated_good"),
        artifact("2", "a1b2c3", false, "rated_good"),
        artifact("3", "d4e5f6", true, "rated_bad"),
      ],
      { minSample: 1 },
    );
    // Both hashes are present, though neither was ever declared.
    expect(Object.keys(stats.byFeature.promptVersion ?? {}).sort()).toEqual([
      "a1b2c3",
      "d4e5f6",
    ]);
    expect(
      stats.byFeature.promptVersion?.d4e5f6?.outcomes.rated_bad?.rate,
    ).toBe(1);
  });

  test("a closed vocabulary still rejects values outside its set", () => {
    const closed = defineOutcomeVocabulary({
      artifacts: {
        chat_response: {
          features: { model: { type: "string", values: ["opus"] } },
          label: "Chat response",
        },
      },
      outcomes: ["rated_bad"],
    });
    const stats = computeOutcomeStats(
      closed,
      "chat_response",
      [
        {
          features: { model: "some-model-we-never-declared" },
          id: "1",
          outcomes: ["rated_bad"],
          variant: null,
        },
      ],
      { minSample: 1 },
    );
    expect(stats.byFeature.model).toBeUndefined();
  });
});

describe("compareOutcomeSlices", () => {
  // 10 fast answers, 1 bad. 8 slow answers, 7 bad. Slow is clearly the problem.
  const artifacts: ArtifactWithOutcomes[] = [
    ...Array.from({ length: 10 }, (_, index) =>
      artifact(
        `f${index}`,
        "v1",
        false,
        index === 0 ? "rated_bad" : "rated_good",
      ),
    ),
    ...Array.from({ length: 8 }, (_, index) =>
      artifact(`s${index}`, "v1", true, index < 7 ? "rated_bad" : "rated_good"),
    ),
  ];
  const stats = computeOutcomeStats(VOCABULARY, "chat_response", artifacts, {
    minSample: 10,
  });

  test("it finds the slice that is dragging the product down", () => {
    const worst = compareOutcomeSlices(stats, "rated_bad")[0];
    expect(worst?.feature).toBe("slow");
    expect(worst?.bucket).toBe("true");
    expect(worst?.confident).toBe(true);
    expect(worst?.lift).toBeGreaterThan(0); // worse than the baseline
  });

  test("a slice too small to believe is returned but NOT confident", () => {
    const thin = computeOutcomeStats(
      VOCABULARY,
      "chat_response",
      [
        artifact("1", "v1", true, "rated_bad"),
        artifact("2", "v1", true, "rated_bad"),
        artifact("3", "v1", false, "rated_good"),
      ],
      { minSample: 1 },
    );
    const slices = compareOutcomeSlices(thin, "rated_bad");
    // The host still SEES it — it just must not render it as a finding.
    expect(slices.length).toBeGreaterThan(0);
    expect(slices.every((slice) => !slice.confident)).toBe(true);
  });

  test("a big sample with a tiny difference is not confident either", () => {
    // 50/50 either way — a real sample, no real signal.
    const even = computeOutcomeStats(
      VOCABULARY,
      "chat_response",
      Array.from({ length: 40 }, (_, index) =>
        artifact(
          `e${index}`,
          "v1",
          index % 2 === 0,
          index % 2 === 0 ? "rated_bad" : "rated_bad",
        ),
      ),
      { minSample: 10 },
    );
    expect(
      compareOutcomeSlices(even, "rated_bad").every(
        (slice) => !slice.confident,
      ),
    ).toBe(true);
  });
});

describe("product-wide listing", () => {
  test("the store can answer 'what is bad for EVERYONE', not just one owner", async () => {
    const store = createMemoryOutcomeStore();
    await store.recordArtifact({
      features: { slow: true },
      id: "1",
      kind: "chat_response",
      ownerId: "member-a",
    });
    await store.recordArtifact({
      features: { slow: true },
      id: "2",
      kind: "chat_response",
      ownerId: "member-b",
    });
    await store.recordOutcome({
      artifactId: "1",
      outcome: "rated_bad",
      ownerId: "member-a",
    });
    await store.recordOutcome({
      artifactId: "2",
      outcome: "rated_bad",
      ownerId: "member-b",
    });

    const mine = await store.listArtifactsWithOutcomes(
      "member-a",
      "chat_response",
      new Date(0),
    );
    const everyone = await store.listAllArtifactsWithOutcomes?.(
      "chat_response",
      new Date(0),
    );
    expect(mine.length).toBe(1);
    expect(everyone?.length).toBe(2);
  });
});
