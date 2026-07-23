import { PGlite } from "@electric-sql/pglite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { Value } from "@sinclair/typebox/value";
import {
  createDrizzleOutcomeStore,
  OutcomeArtifactInsertSchema,
  OutcomeEventInsertSchema,
} from "../src/drizzle";

const createTestStore = async () => {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE outcome_artifacts (
      id text PRIMARY KEY,
      owner_id text NOT NULL,
      kind text NOT NULL,
      features jsonb NOT NULL,
      variant text,
      experiment_id text,
      at timestamptz NOT NULL
    );
    CREATE TABLE outcome_events (
      id bigserial PRIMARY KEY,
      artifact_id text NOT NULL REFERENCES outcome_artifacts(id) ON DELETE CASCADE,
      outcome text NOT NULL,
      at timestamptz NOT NULL
    );
  `);

  return createDrizzleOutcomeStore({ db: drizzle({ client }) });
};

describe("createDrizzleOutcomeStore", () => {
  test("exports database TypeBoxes generated from the Drizzle tables", () => {
    expect(
      Value.Check(OutcomeArtifactInsertSchema, {
        at: new Date(),
        features: { cta: "start" },
        id: "page-1",
        kind: "landing_page",
        ownerId: "owner-a",
      }),
    ).toBe(true);
    expect(
      Value.Check(OutcomeEventInsertSchema, {
        artifactId: "page-1",
        at: new Date(),
        outcome: "conversion",
      }),
    ).toBe(true);
  });

  test("persists typed features and fences outcome writes by owner", async () => {
    const store = await createTestStore();
    await store.recordArtifact({
      at: new Date("2026-01-01T00:00:00.000Z"),
      features: { cta: "start" },
      id: "page-1",
      kind: "landing_page",
      ownerId: "owner-a",
      variant: "hero-a",
    });
    await store.recordOutcome({
      artifactId: "page-1",
      outcome: "conversion",
      ownerId: "owner-b",
    });
    await store.recordOutcome({
      artifactId: "page-1",
      outcome: "conversion",
      ownerId: "owner-a",
    });
    await store.recordOutcome({
      artifactId: "missing",
      outcome: "conversion",
      ownerId: "owner-a",
    });

    expect(
      await store.listArtifactsWithOutcomes(
        "owner-a",
        "landing_page",
        new Date(0),
      ),
    ).toEqual([
      {
        features: { cta: "start" },
        id: "page-1",
        outcomes: ["conversion"],
        variant: "hero-a",
      },
    ]);
    expect(
      await store.listArtifactsWithOutcomes(
        "owner-b",
        "landing_page",
        new Date(0),
      ),
    ).toEqual([]);
    expect(
      await store.listAllArtifactsWithOutcomes?.("landing_page", new Date(0)),
    ).toHaveLength(1);
  });
});
