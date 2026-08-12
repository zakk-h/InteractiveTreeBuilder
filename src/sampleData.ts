import type { AndOrGraph, FeatureMeta } from './types';
import payload from './samplePayload.json';

type FeatureRegistryEntry = {
  internalFeature: number;
  originalFeature: number;
  originalName: string;
  threshold: number;
  kind: 'binary_threshold' | 'continuous_threshold';
  continuousGroup: number | null;
};

const registry = payload.meta.featureRegistry as FeatureRegistryEntry[];

export const sampleGraph = payload.graph as AndOrGraph;

const featureNames = registry.map(
  (entry) => `${entry.originalName} <= ${entry.threshold}`,
);

const thresholds = Object.fromEntries(
  registry.map((entry) => [
    String(entry.internalFeature),
    entry.threshold,
  ]),
);

const continuousGroups: Record<string, number[]> = {};

for (const entry of registry) {
  if (
    entry.kind !== 'continuous_threshold' ||
    entry.continuousGroup === null
  ) {
    continue;
  }

  if (!continuousGroups[entry.originalName]) {
    continuousGroups[entry.originalName] = [];
  }

  continuousGroups[entry.originalName].push(entry.internalFeature);
}

export const sampleMeta: FeatureMeta & Record<string, unknown> = {
  ...payload.meta,

  featureNames,
  thresholds,
  continuousGroups,
};