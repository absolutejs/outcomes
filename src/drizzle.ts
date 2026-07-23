import { and, asc, eq, gte } from "drizzle-orm";
import {
  bigserial,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";
import type { OutcomeStore, ArtifactWithOutcomes } from "./store";
import type { OutcomeFeatures } from "./vocabulary";
import { createInsertSchema, createSelectSchema } from "drizzle-typebox";

const portableJsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  fromDriver: (value) =>
    typeof value === "string" ? JSON.parse(value) : value,
  toDriver: (value) => JSON.stringify(value),
});

export const outcomeArtifacts = pgTable(
  "outcome_artifacts",
  {
    at: timestamp({ mode: "date", withTimezone: true }).notNull(),
    experimentId: text("experiment_id"),
    features: portableJsonb().$type<OutcomeFeatures>().notNull(),
    id: text().primaryKey(),
    kind: text().notNull(),
    ownerId: text("owner_id").notNull(),
    variant: text(),
  },
  (table) => [
    index("outcome_artifacts_owner_kind_at_idx").on(
      table.ownerId,
      table.kind,
      table.at,
    ),
    index("outcome_artifacts_kind_at_idx").on(table.kind, table.at),
  ],
);

export const outcomeEvents = pgTable(
  "outcome_events",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => outcomeArtifacts.id, { onDelete: "cascade" }),
    at: timestamp({ mode: "date", withTimezone: true }).notNull(),
    id: bigserial({ mode: "number" }).notNull(),
    outcome: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id], name: "outcome_events_pkey" }),
    index("outcome_events_artifact_idx").on(table.artifactId),
  ],
);

export const outcomesDrizzleSchema = { outcomeArtifacts, outcomeEvents };
export const OutcomeArtifactInsertSchema = createInsertSchema(outcomeArtifacts);
export const OutcomeArtifactSelectSchema = createSelectSchema(outcomeArtifacts);
export const OutcomeEventInsertSchema = createInsertSchema(outcomeEvents);
export const OutcomeEventSelectSchema = createSelectSchema(outcomeEvents);

type AnyPgDatabase = PgAsyncDatabase<any, any>;

export type CreateDrizzleOutcomeStoreOptions<DB extends AnyPgDatabase> = {
  db: DB;
};

const rowsToArtifacts = (
  rows: ReadonlyArray<{
    artifact: typeof outcomeArtifacts.$inferSelect;
    event: typeof outcomeEvents.$inferSelect | null;
  }>,
) => {
  const byId = new Map<string, ArtifactWithOutcomes>();
  for (const row of rows) {
    const current = byId.get(row.artifact.id) ?? {
      features: row.artifact.features,
      id: row.artifact.id,
      outcomes: [],
      variant: row.artifact.variant,
    };
    if (row.event !== null && !current.outcomes.includes(row.event.outcome)) {
      current.outcomes.push(row.event.outcome);
    }
    byId.set(row.artifact.id, current);
  }

  return [...byId.values()];
};

export const createDrizzleOutcomeStore = <DB extends AnyPgDatabase>({
  db,
}: CreateDrizzleOutcomeStoreOptions<DB>): OutcomeStore => {
  const list = async (kind: string, since: Date, ownerId?: string) => {
    const conditions = [
      eq(outcomeArtifacts.kind, kind),
      gte(outcomeArtifacts.at, since),
    ];
    if (ownerId !== undefined)
      conditions.push(eq(outcomeArtifacts.ownerId, ownerId));
    const rows = await db
      .select({ artifact: outcomeArtifacts, event: outcomeEvents })
      .from(outcomeArtifacts)
      .leftJoin(
        outcomeEvents,
        eq(outcomeEvents.artifactId, outcomeArtifacts.id),
      )
      .where(and(...conditions))
      .orderBy(asc(outcomeArtifacts.at), asc(outcomeEvents.at));

    return rowsToArtifacts(rows);
  };

  return {
    listAllArtifactsWithOutcomes: (kind, since) => list(kind, since),
    listArtifactsWithOutcomes: (ownerId, kind, since) =>
      list(kind, since, ownerId),
    recordArtifact: async (input) => {
      await db.insert(outcomeArtifacts).values({
        at: input.at ?? new Date(),
        experimentId: input.experimentId,
        features: input.features,
        id: input.id,
        kind: input.kind,
        ownerId: input.ownerId,
        variant: input.variant,
      });
    },
    recordOutcome: async (input) => {
      const [artifact] = await db
        .select({ id: outcomeArtifacts.id })
        .from(outcomeArtifacts)
        .where(
          and(
            eq(outcomeArtifacts.id, input.artifactId),
            eq(outcomeArtifacts.ownerId, input.ownerId),
          ),
        )
        .limit(1);
      if (artifact === undefined) return;
      await db.insert(outcomeEvents).values({
        artifactId: input.artifactId,
        at: input.at ?? new Date(),
        outcome: input.outcome,
      });
    },
  };
};
