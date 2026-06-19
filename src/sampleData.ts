import type { AndOrGraph, FeatureMeta } from './types';

export const sampleGraph: AndOrGraph = {
  root_trie_id: 0,
  trie_nodes: [
    { id: 0, leaf_ids: [], split_ids: [0, 1, 2] },
    { id: 1, leaf_ids: [0], split_ids: [3] },
    { id: 2, leaf_ids: [1], split_ids: [4] },
    { id: 3, leaf_ids: [2], split_ids: [] },
    { id: 4, leaf_ids: [3], split_ids: [] },
    { id: 5, leaf_ids: [4], split_ids: [] },
    { id: 6, leaf_ids: [5], split_ids: [] }
  ],
  split_nodes: [
    { id: 0, parent_trie_id: 0, feature: 0, left_trie_id: 1, right_trie_id: 2, count: 48 },
    { id: 1, parent_trie_id: 0, feature: 1, left_trie_id: 3, right_trie_id: 4, count: 22 },
    { id: 2, parent_trie_id: 0, feature: 2, left_trie_id: 5, right_trie_id: 6, count: 16 },
    { id: 3, parent_trie_id: 1, feature: 3, left_trie_id: 3, right_trie_id: 4, count: 9 },
    { id: 4, parent_trie_id: 2, feature: 4, left_trie_id: 5, right_trie_id: 6, count: 7 }
  ],
  leaf_nodes: [
    { id: 0, parent_trie_id: 1, prediction: 0 },
    { id: 1, parent_trie_id: 2, prediction: 1 },
    { id: 2, parent_trie_id: 3, prediction: 0 },
    { id: 3, parent_trie_id: 4, prediction: 1 },
    { id: 4, parent_trie_id: 5, prediction: 1 },
    { id: 5, parent_trie_id: 6, prediction: 0 }
  ]
};

export const sampleMeta: FeatureMeta = {
  featureNames: ['age <= 43.5', 'income > 52k', 'prior count <= 2', 'credit score <= 680', 'balance <= 1200'],
  continuousGroups: { age: [0], income: [1], prior_count: [2], credit_score: [3], balance: [4] },
  thresholds: { '0': 43.5, '1': 52000, '2': 2, '3': 680, '4': 1200 }
};
