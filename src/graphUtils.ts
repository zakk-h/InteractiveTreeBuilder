import type { AndOrGraph, BuildNode, Choice, ChoiceBudget, FeatureMeta, HistorySnapshot, NodeBudget } from './types';

type GraphIndex = {
  trie: Map<number, AndOrGraph['trie_nodes'][number]>;
  splits: Map<number, AndOrGraph['split_nodes'][number]>;
  leaves: Map<number, AndOrGraph['leaf_nodes'][number]>;
};

const indexCache = new WeakMap<AndOrGraph, GraphIndex>();

function buildIndexUncached(graph: AndOrGraph): GraphIndex {
  return {
    trie: new Map(graph.trie_nodes.map((x) => [x.id, x])),
    splits: new Map(graph.split_nodes.map((x) => [x.id, x])),
    leaves: new Map(graph.leaf_nodes.map((x) => [x.id, x]))
  };
}

export function buildIndex(graph: AndOrGraph): GraphIndex {
  const cached = indexCache.get(graph);
  if (cached) return cached;

  const idx = buildIndexUncached(graph);
  indexCache.set(graph, idx);
  return idx;
}

export function cloneTree<T>(x: T): T {
  return structuredClone(x);
}

export function makeRoot(graph: AndOrGraph): HistorySnapshot {
  return {
    root: { uid: 0, graphTrieId: graph.root_trie_id, kind: 'choice' },
    activeUid: 0,
    nextUid: 1
  };
}

export function walk(root: BuildNode): BuildNode[] {
  const out: BuildNode[] = [];
  const dfs = (n?: BuildNode) => {
    if (!n) return;
    out.push(n);
    dfs(n.left);
    dfs(n.right);
  };
  dfs(root);
  return out;
}

export function findNode(root: BuildNode, uid: number): BuildNode | undefined {
  return walk(root).find((n) => n.uid === uid);
}

export function unresolvedNodes(root: BuildNode): BuildNode[] {
  return walk(root).filter((n) => n.kind === 'choice');
}

export function choicesFor(graph: AndOrGraph, graphTrieId: number): Choice[] {
  const idx = buildIndex(graph);
  const t = idx.trie.get(graphTrieId);
  if (!t) return [];
  const leaves: Choice[] = t.leaf_ids
    .map((id) => idx.leaves.get(id))
    .filter(Boolean)
    .map((leaf) => ({ kind: 'leaf', leaf: leaf! }));
  const splits: Choice[] = t.split_ids
    .map((id) => idx.splits.get(id))
    .filter(Boolean)
    .map((split) => ({ kind: 'split', split: split! }));
  return [...leaves, ...splits];
}

export function rootTrie(graph: AndOrGraph) {
  return buildIndex(graph).trie.get(graph.root_trie_id);
}

export function rootBudget(graph: AndOrGraph): number {
  const b = Number(rootTrie(graph)?.budget);
  return Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
}

export function rootSize(graph: AndOrGraph): number {
  const n = Number(rootTrie(graph)?.subproblem_size);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function fallbackMin(graph: AndOrGraph, trieId: number): number {
  const choices = choicesFor(graph, trieId);
  if (choices.length === 0) return 0;
  return Math.min(...choices.map((c) => choiceObjective(graph, c)));
}

export function trieMinObjective(graph: AndOrGraph, graphTrieId: number): number {
  const t = buildIndex(graph).trie.get(graphTrieId);
  const x = Number(t?.min_objective);
  return Number.isFinite(x) ? x : fallbackMin(graph, graphTrieId);
}

export function leafObjective(leaf: { loss?: number; objective?: number }): number {
  const loss = Number(leaf.loss);
  if (Number.isFinite(loss)) return loss;
  const objective = Number(leaf.objective);
  return Number.isFinite(objective) ? objective : Number.POSITIVE_INFINITY;
}

export function splitObjective(graph: AndOrGraph, split: { min_objective?: number; objective?: number; left_trie_id: number; right_trie_id: number }): number {
  const minObj = Number(split.min_objective);
  if (Number.isFinite(minObj)) return minObj;
  const objective = Number(split.objective);
  if (Number.isFinite(objective)) return objective;
  return trieMinObjective(graph, split.left_trie_id) + trieMinObjective(graph, split.right_trie_id);
}

export function choiceObjective(graph: AndOrGraph, choice: Choice): number {
  return choice.kind === 'leaf' ? leafObjective(choice.leaf) : splitObjective(graph, choice.split);
}

export function lowerBound(graph: AndOrGraph, node?: BuildNode): number {
  if (!node) return 0;
  const idx = buildIndex(graph);

  if (node.kind === 'choice') {
    return trieMinObjective(graph, node.graphTrieId);
  }

  if (node.kind === 'leaf') {
    const leaf = node.leafId == null ? undefined : idx.leaves.get(node.leafId);
    return leaf ? leafObjective(leaf) : Number.POSITIVE_INFINITY;
  }

  return lowerBound(graph, node.left) + lowerBound(graph, node.right);
}

export function nodeBudgetFor(graph: AndOrGraph, snapshot: HistorySnapshot, uid: number): NodeBudget | undefined {
  const node = findNode(snapshot.root, uid);
  if (!node || node.kind !== 'choice') return undefined;

  const rootBound = rootBudget(graph);
  const totalLower = lowerBound(graph, snapshot.root);
  const nodeBest = trieMinObjective(graph, node.graphTrieId);
  const otherLower = totalLower - nodeBest;
  const available = rootBound - otherLower;

  return {
    rootBudget: rootBound,
    rootSize: rootSize(graph),
    currentLowerBound: totalLower,
    otherLowerBound: otherLower,
    nodeBestObjective: nodeBest,
    nodeAvailableBudget: available,
    globalSlack: rootBound - totalLower
  };
}

export function annotateChoicesFor(graph: AndOrGraph, snapshot: HistorySnapshot, uid: number): ChoiceBudget[] {
  const node = findNode(snapshot.root, uid);
  if (!node || node.kind !== 'choice') return [];
  const budget = nodeBudgetFor(graph, snapshot, uid);
  const available = budget?.nodeAvailableBudget ?? Number.POSITIVE_INFINITY;

  return choicesFor(graph, node.graphTrieId).map((choice) => {
    const objective = choiceObjective(graph, choice);
    const excess = objective - available;
    return {
      choice,
      objective,
      feasible: objective <= available + 1e-9,
      excess: Math.max(0, excess)
    };
  });
}

export function normalizedObjective(graph: AndOrGraph, value: number): number {
  return value / rootSize(graph);
}

export function formatObjective(graph: AndOrGraph, value: number): string {
  if (!Number.isFinite(value)) return '∞';
  return normalizedObjective(graph, value).toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function applySplit(snapshot: HistorySnapshot, graph: AndOrGraph, uid: number, splitId: number): HistorySnapshot {
  const feasible = annotateChoicesFor(graph, snapshot, uid).some(
    (x) => x.feasible && x.choice.kind === 'split' && x.choice.split.id === splitId
  );
  if (!feasible) return snapshot;

  const next = cloneTree(snapshot);
  const idx = buildIndex(graph);
  const node = findNode(next.root, uid);
  const split = idx.splits.get(splitId);
  if (!node || !split || node.kind !== 'choice') return snapshot;

  const left: BuildNode = { uid: next.nextUid++, graphTrieId: split.left_trie_id, kind: 'choice' };
  const right: BuildNode = { uid: next.nextUid++, graphTrieId: split.right_trie_id, kind: 'choice' };

  node.kind = 'split';
  node.feature = split.feature;
  node.splitId = split.id;
  node.prediction = undefined;
  node.left = left;
  node.right = right;
  next.activeUid = left.uid;

  return autoExpandSingletons(next, graph);
}

export function applyLeaf(snapshot: HistorySnapshot, graph: AndOrGraph, uid: number, leafId: number): HistorySnapshot {
  const feasible = annotateChoicesFor(graph, snapshot, uid).some(
    (x) => x.feasible && x.choice.kind === 'leaf' && x.choice.leaf.id === leafId
  );
  if (!feasible) return snapshot;

  const next = cloneTree(snapshot);
  const idx = buildIndex(graph);
  const node = findNode(next.root, uid);
  const leaf = idx.leaves.get(leafId);
  if (!node || !leaf || node.kind !== 'choice') return snapshot;

  node.kind = 'leaf';
  node.prediction = leaf.prediction;
  node.leafId = leaf.id;
  node.feature = undefined;
  node.left = undefined;
  node.right = undefined;

  const unresolved = unresolvedNodes(next.root);
  next.activeUid = unresolved[0]?.uid ?? node.uid;

  return autoExpandSingletons(next, graph);
}

export function rewind(snapshot: HistorySnapshot, uid: number): HistorySnapshot {
  const next = cloneTree(snapshot);
  const node = findNode(next.root, uid);
  if (!node) return snapshot;
  node.kind = 'choice';
  node.feature = undefined;
  node.prediction = undefined;
  node.splitId = undefined;
  node.leafId = undefined;
  node.left = undefined;
  node.right = undefined;
  next.activeUid = uid;
  next.nextUid = Math.max(...walk(next.root).map((n) => n.uid)) + 1;
  return next;
}

export function autoExpandSingletons(snapshot: HistorySnapshot, graph: AndOrGraph): HistorySnapshot {
  let cur = snapshot;

  while (true) {
    const singleton = unresolvedNodes(cur.root).find((node) => {
      const feasibleChoices = annotateChoicesFor(graph, cur, node.uid).filter((x) => x.feasible);
      return feasibleChoices.length === 1;
    });

    if (!singleton) {
      return cur;
    }

    const feasibleChoices = annotateChoicesFor(graph, cur, singleton.uid).filter((x) => x.feasible);
    const only = feasibleChoices[0].choice;

    if (only.kind === 'leaf') {
      const next = cloneTree(cur);
      const n = findNode(next.root, singleton.uid);
      if (!n || n.kind !== 'choice') return cur;

      n.kind = 'leaf';
      n.prediction = only.leaf.prediction;
      n.leafId = only.leaf.id;
      n.feature = undefined;
      n.left = undefined;
      n.right = undefined;

      const unresolved = unresolvedNodes(next.root);
      next.activeUid = unresolved[0]?.uid ?? n.uid;
      cur = next;
      continue;
    }

    const next = cloneTree(cur);
    const n = findNode(next.root, singleton.uid);
    if (!n || n.kind !== 'choice') return cur;

    const s = only.split;

    n.kind = 'split';
    n.feature = s.feature;
    n.splitId = s.id;
    n.prediction = undefined;
    n.left = { uid: next.nextUid++, graphTrieId: s.left_trie_id, kind: 'choice' };
    n.right = { uid: next.nextUid++, graphTrieId: s.right_trie_id, kind: 'choice' };

    const unresolved = unresolvedNodes(next.root);
    next.activeUid = unresolved[0]?.uid ?? n.uid;
    cur = next;
  }
}

export function randomComplete(
  snapshot: HistorySnapshot,
  graph: AndOrGraph,
  rng: () => number = Math.random,
): HistorySnapshot {
  let cur = autoExpandSingletons(cloneTree(snapshot), graph);

  while (!isComplete(cur.root)) {
    const node = unresolvedNodes(cur.root)[0];
    if (!node) break;

    const feasibleChoices = annotateChoicesFor(graph, cur, node.uid).filter((x) => x.feasible);

    if (feasibleChoices.length === 0) {
      return cur;
    }

    const ix = Math.floor(rng() * feasibleChoices.length);
    const chosen = feasibleChoices[ix].choice;

    if (chosen.kind === 'leaf') {
      cur = applyLeaf(cur, graph, node.uid, chosen.leaf.id);
    } else {
      cur = applySplit(cur, graph, node.uid, chosen.split.id);
    }
  }

  return cur;
}


export function optimalComplete(
  snapshot: HistorySnapshot,
  graph: AndOrGraph,
): HistorySnapshot {
  let cur = autoExpandSingletons(cloneTree(snapshot), graph);

  while (!isComplete(cur.root)) {
    const node = unresolvedNodes(cur.root)[0];
    if (!node) break;

    const feasibleChoices = annotateChoicesFor(graph, cur, node.uid)
      .filter((x) => x.feasible);

    if (feasibleChoices.length === 0) {
      return cur;
    }

    let best = feasibleChoices[0];

    for (let i = 1; i < feasibleChoices.length; i++) {
      if (feasibleChoices[i].objective < best.objective) {
        best = feasibleChoices[i];
      }
    }

    const chosen = best.choice;

    if (chosen.kind === 'leaf') {
      cur = applyLeaf(cur, graph, node.uid, chosen.leaf.id);
    } else {
      cur = applySplit(cur, graph, node.uid, chosen.split.id);
    }
  }

  return cur;
}

export function featureLabel(feature: number | undefined, meta: FeatureMeta): string {
  if (feature == null) return '';
  const names = meta.featureNames ?? [];
  return names[feature] ?? `f${feature}`;
}

export function thresholdLabel(feature: number, meta: FeatureMeta): string {
  const raw = Array.isArray(meta.thresholds) ? meta.thresholds[feature] : meta.thresholds?.[String(feature)];
  if (raw == null) return featureLabel(feature, meta);
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : String(raw);
}

export function groupName(feature: number, meta: FeatureMeta): string | undefined {
  const g = meta.continuousGroups;
  if (!g) return undefined;
  if (Array.isArray(g)) {
    const ix = g.findIndex((cols) => cols.includes(feature));
    return ix >= 0 ? `group_${ix}` : undefined;
  }
  return Object.entries(g).find(([, cols]) => cols.includes(feature))?.[0];
}

export function treePaths(root: BuildNode): Array<{ path: string[]; prediction: number }> {
  const out: Array<{ path: string[]; prediction: number }> = [];
  const dfs = (n: BuildNode, path: string[]) => {
    if (n.kind === 'leaf') {
      out.push({ path, prediction: n.prediction ?? 0 });
      return;
    }
    if (n.kind === 'split') {
      dfs(n.left!, [...path, `+${n.feature}`]);
      dfs(n.right!, [...path, `-${n.feature}`]);
    }
  };
  dfs(root, []);
  return out;
}

export function isComplete(root: BuildNode): boolean {
  return unresolvedNodes(root).length === 0;
}