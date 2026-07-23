import type { OutcomeFeatures } from "./vocabulary";

/**
 * Storage contract: an artifact ledger (what the agent produced, with its
 * features frozen at production time) and an outcome ledger (what happened
 * to it). Attribution is the join; hosts back this with two small tables.
 */

export type OutcomeArtifactInput = {
  /** Host-supplied id (the send/page/action id) — the attribution key. */
  id: string;
  ownerId: string;
  kind: string;
  features: OutcomeFeatures;
  /** Experiment bolt-on: set when this artifact was a deliberate variant. */
  variant?: string | null;
  experimentId?: string | null;
  at?: Date;
};

export type ArtifactWithOutcomes = {
  id: string;
  features: OutcomeFeatures;
  variant?: string | null;
  /** Distinct outcome names recorded for this artifact. */
  outcomes: string[];
};

export type OutcomeStore = {
  recordArtifact: (input: OutcomeArtifactInput) => Promise<void>;
  /** No-op when the artifact id is unknown (host hooks fire broadly). */
  recordOutcome: (input: {
    artifactId: string;
    ownerId: string;
    outcome: string;
    at?: Date;
  }) => Promise<void>;
  /** EVERY owner's artifacts of this kind — product-wide learning ("what makes
   *  answers bad for everyone") as opposed to the per-owner loop ("what works
   *  for THIS member"). Optional: a store that only serves the per-owner loop
   *  needn't implement it. Without it a host has to reach past the store and
   *  hand-roll the query, which is exactly the seam leaking. */
  listAllArtifactsWithOutcomes?: (
    kind: string,
    since: Date,
  ) => Promise<ArtifactWithOutcomes[]>;
  listArtifactsWithOutcomes: (
    ownerId: string,
    kind: string,
    since: Date,
  ) => Promise<ArtifactWithOutcomes[]>;
};

type MemoryArtifact = OutcomeArtifactInput & { at: Date };

/** In-memory store — tests and prototypes. */
export const createMemoryOutcomeStore = (): OutcomeStore & {
  artifacts: MemoryArtifact[];
  events: { artifactId: string; outcome: string; at: Date }[];
} => {
  const artifacts: MemoryArtifact[] = [];
  const events: { artifactId: string; outcome: string; at: Date }[] = [];

  const join = (artifact: MemoryArtifact) => ({
    features: artifact.features,
    id: artifact.id,
    outcomes: [
      ...new Set(
        events
          .filter((event) => event.artifactId === artifact.id)
          .map((event) => event.outcome),
      ),
    ],
    variant: artifact.variant ?? null,
  });

  return {
    artifacts,
    events,
    listAllArtifactsWithOutcomes: (kind, since) =>
      Promise.resolve(
        artifacts
          .filter((artifact) => artifact.kind === kind && artifact.at >= since)
          .map(join),
      ),
    listArtifactsWithOutcomes: (ownerId, kind, since) =>
      Promise.resolve(
        artifacts
          .filter(
            (artifact) =>
              artifact.ownerId === ownerId &&
              artifact.kind === kind &&
              artifact.at >= since,
          )
          .map(join),
      ),
    recordArtifact: (input) => {
      artifacts.push({ ...input, at: input.at ?? new Date() });

      return Promise.resolve();
    },
    recordOutcome: (input) => {
      if (
        artifacts.some(
          (artifact) =>
            artifact.id === input.artifactId &&
            artifact.ownerId === input.ownerId,
        )
      ) {
        events.push({
          artifactId: input.artifactId,
          at: input.at ?? new Date(),
          outcome: input.outcome,
        });
      }

      return Promise.resolve();
    },
  };
};
