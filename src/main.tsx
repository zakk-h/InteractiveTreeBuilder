import { type CSSProperties, type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  CircleDot,
  Download,
  RotateCcw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
} from 'lucide-react';

import type {
  AndOrGraph,
  BuildNode,
  ChoiceBudget,
  FeatureMeta,
  HistorySnapshot,
} from './types';

import { sampleGraph, sampleMeta } from './sampleData';

import {
  annotateChoicesFor,
  applyLeaf,
  applySplit,
  choicesFor,
  featureLabel,
  findNode,
  formatObjective,
  groupName,
  isComplete,
  lowerBound,
  makeRoot,
  nodeBudgetFor,
  normalizedObjective,
  rewind,
  rootBudget,
  rootSize,
  thresholdLabel,
  treePaths,
  unresolvedNodes,
  autoExpandSingletons,
  randomComplete,
} from './graphUtils';

import { layoutTree } from './layout';
import './style.css';

declare global {
  interface Window {
    PRAXIS_ANDOR_GRAPH?: AndOrGraph;
    PRAXIS_ANDOR_META?: FeatureMeta & Record<string, unknown>;

    PRAXIS_BUILDER_PAYLOAD?: {
      graph?: AndOrGraph;
      meta?: FeatureMeta & Record<string, unknown>;

      feature_names?: string[];
      featureNames?: string[];

      continuous_groups?: Record<string, number[]>;
      continuousGroups?: Record<string, number[]>;

      thresholds?: Record<string, unknown>;

      gamma?: number;
      lambda_reg?: number;
      lambdaReg?: number;
    };
  }
}

type BuilderColors = {
  splitNode: string;
  leafNode: string;
  leafNodesByClass: Record<string, string>;
  edge: string;
  background: string;
};

type BuilderUi = {
  labelNames: Record<string, string>;
  featureNames: Record<string, string>;
  groupNames: Record<string, string>;
  colors: BuilderColors;
};

type NodeData = {
  b: BuildNode;
  active: boolean;
  choices: number;
  feasibleChoices: number;
  meta: FeatureMeta & Record<string, unknown>;
  graph: AndOrGraph;
  thresholdDecimals: number;
  ui: BuilderUi;
};

const DEFAULT_COLORS: BuilderColors = {
  splitNode: '#ffffff',
  leafNode: '#f0fdf4',
  leafNodesByClass: {
    '-1': '#D1D5DB',
  },
  edge: '#8da2b8',
  background: '#fbfdff',
};

const BINARY_GROUP_LABEL = 'Binary / already-binarized features';

function makeDefaultUi(): BuilderUi {
  return {
    labelNames: {},
    featureNames: {},
    groupNames: {},
    colors: {
      ...DEFAULT_COLORS,
      leafNodesByClass: {...DEFAULT_COLORS.leafNodesByClass},
    },
  };
}

function predictionLabel(prediction: number | undefined, ui: BuilderUi): string {
  if (prediction === undefined || prediction === null) return 'predict —';

  if (Number(prediction) === -1) return 'defer';

  const custom = ui.labelNames[String(prediction)]?.trim();
  return custom || `predict ${prediction}`;
}

function continuousGroupEntries(meta: FeatureMeta): Array<{ key: string; features: number[] }> {
  const g = meta.continuousGroups;

  if (!g) return [];

  if (Array.isArray(g)) {
    return g.map((features, i) => ({
      key: `group_${i}`,
      features,
    }));
  }

  return Object.entries(g).map(([key, features]) => ({
    key,
    features,
  }));
}

function allSplitFeatures(graph: AndOrGraph): number[] {
  return Array.from(new Set(graph.split_nodes.map((s) => s.feature))).sort((a, b) => a - b);
}

function customGroupName(group: string, ui: BuilderUi): string {
  return ui.groupNames[group]?.trim() || group;
}

function customFeatureName(feature: number, meta: FeatureMeta, ui: BuilderUi): string {
  return ui.featureNames[String(feature)]?.trim() || featureLabel(feature, meta);
}

function displayGroupName(feature: number, meta: FeatureMeta, ui: BuilderUi): string | undefined {
  const group = groupName(feature, meta);
  return group ? customGroupName(group, ui) : undefined;
}

function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HistorySnapshot;
}

function coerceMeta(
  payload: Window['PRAXIS_BUILDER_PAYLOAD'],
): FeatureMeta & Record<string, unknown> {
  const payloadMeta = (payload?.meta ?? {}) as FeatureMeta & Record<string, unknown>;
  const globalMeta = (window.PRAXIS_ANDOR_META ?? {}) as FeatureMeta & Record<string, unknown>;

  return {
    ...sampleMeta,
    ...globalMeta,
    ...payloadMeta,

    featureNames:
      payloadMeta.featureNames ??
      payload?.featureNames ??
      payload?.feature_names ??
      globalMeta.featureNames ??
      sampleMeta.featureNames,

    continuousGroups:
      payloadMeta.continuousGroups ??
      payload?.continuousGroups ??
      payload?.continuous_groups ??
      globalMeta.continuousGroups ??
      sampleMeta.continuousGroups,

    thresholds:
      payloadMeta.thresholds ??
      payload?.thresholds ??
      globalMeta.thresholds ??
      sampleMeta.thresholds,

    gamma:
      payloadMeta.gamma ??
      payload?.gamma ??
      globalMeta.gamma,

    lambda_reg:
      payloadMeta.lambda_reg ??
      payload?.lambda_reg ??
      payload?.lambdaReg ??
      globalMeta.lambda_reg ??
      globalMeta.lambdaReg,
  } as FeatureMeta & Record<string, unknown>;
}

function stripZeros(x: string): string {
  return x.replace(/\.?0+$/, '');
}

function compactFeatureName(name: string, maxLen = 19): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen).trimEnd()}…`;
}

function formatThresholdValue(value: unknown, decimals = 3): string {
  const num = Number(value);

  if (Number.isFinite(num)) {
    return stripZeros(num.toFixed(decimals));
  }

  return String(value);
}

function prettyThresholdLabel(
  feature: number,
  meta: FeatureMeta,
  thresholdDecimals = 3,
): string {
  return formatThresholdValue(thresholdLabel(feature, meta), thresholdDecimals);
}

function prettySplitLabel(
  feature: number,
  meta: FeatureMeta,
  thresholdDecimals = 3,
  ui: BuilderUi = makeDefaultUi(),
): string {
  const group = groupName(feature, meta);

  if (group) {
    return `${compactFeatureName(customGroupName(group, ui))} ≤ ${prettyThresholdLabel(
      feature,
      meta,
      thresholdDecimals,
    )}`;
  }

  const raw = customFeatureName(feature, meta, ui);

  const formatted = raw.replace(
    /(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i,
    (_match, op, value) => `${op} ${formatThresholdValue(value, thresholdDecimals)}`,
  );

  return compactFeatureName(formatted, 28);
}

function fullSplitLabel(
  feature: number,
  meta: FeatureMeta,
  thresholdDecimals = 3,
  ui: BuilderUi = makeDefaultUi(),
): string {
  const group = groupName(feature, meta);

  if (group) {
    return `${customGroupName(group, ui)} ≤ ${prettyThresholdLabel(
      feature,
      meta,
      thresholdDecimals,
    )}`;
  }

  return customFeatureName(feature, meta, ui).replace(
    /(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i,
    (_match, op, value) => `${op} ${formatThresholdValue(value, thresholdDecimals)}`,
  );
}

function gammaRaw(
  graph: AndOrGraph,
  meta: FeatureMeta & Record<string, unknown>,
): number | undefined {
  const explicit =
    meta.gamma ??
    meta.leafPenalty ??
    meta.leaf_penalty ??
    meta.lambda_gamma;

  const explicitNum = Number(explicit);
  if (Number.isFinite(explicitNum)) {
    return explicitNum;
  }

  const lambdaValue = meta.lambda_reg ?? meta.lambdaReg ?? meta.lambda;
  const lambdaNum = Number(lambdaValue);

  if (Number.isFinite(lambdaNum)) {
    return Math.round(lambdaNum * rootSize(graph));
  }

  return undefined;
}

function llroundNonnegative(x: number): number {
  return Math.floor(x + 0.5);
}

function etaDeferRaw(meta: FeatureMeta & Record<string, unknown>): number {
  const eta = Number(meta.eta_defer);
  return Number.isFinite(eta) ? eta : 0;
}

function leafMisclassificationRate(
  graph: AndOrGraph,
  meta: FeatureMeta & Record<string, unknown>,
  leafId?: number,
): string {
  if (leafId === undefined || leafId === null) return 'err —';

  const leaf = graph.leaf_nodes.find((x) => x.id === leafId) as
    | {
        id: number;
        prediction?: number;
        loss?: number;
        subproblem_size?: number;
      }
    | undefined;

  if (!leaf || leaf.loss === undefined || !leaf.subproblem_size || leaf.subproblem_size <= 0) {
    return 'err —';
  }

  const gamma = gammaRaw(graph, meta);

  if (gamma === undefined) {
    return 'err needs γ';
  }

  const n = Number(leaf.subproblem_size);
  const loss = Number(leaf.loss);

  let mistakes: number;

  if (Number(leaf.prediction) === -1) {
    const eta = etaDeferRaw(meta);
    mistakes = loss - gamma - llroundNonnegative(eta * n);
  } else {
    mistakes = loss - gamma;
  }

  mistakes = Math.max(0, mistakes);

  const pct = (100 * mistakes) / n;

  return `${stripZeros(pct.toFixed(2))}% err`;
}

function PraxisNode({ data }: { data: NodeData }) {
  const { b, active, choices, feasibleChoices, meta, graph, thresholdDecimals, ui } = data;

  const icon =
    b.kind === 'split' || b.kind === 'leaf' ? null : (
      <CircleDot size={30} />
    );

  const title =
    b.kind === 'split'
      ? prettySplitLabel(b.feature, meta, thresholdDecimals, ui)
      : b.kind === 'leaf'
        ? predictionLabel(b.prediction, ui)
        : `${feasibleChoices}/${choices} choices`;

  const subtitle =
    b.kind === 'split'
      ? ''
      : b.kind === 'leaf'
        ? leafMisclassificationRate(graph, meta, b.leafId)
        : `best ${formatObjective(graph, lowerBound(graph, b))}`;

  const nodeStyle =
    b.kind === 'leaf'
      ? ({
          '--leaf-node-bg':
            ui.colors.leafNodesByClass[String(b.prediction)] ||
            ui.colors.leafNode,
        } as CSSProperties)
      : undefined;

  return (
    <div
      className={`praxis-node praxis-node-${b.kind} ${active ? 'active' : ''}`}
      style={nodeStyle}
    >
      <Handle type="target" position={Position.Top} className="handle" />

      <div className="node-icon">{icon}</div>

      <div className="node-copy">
        <div
          className="node-title"
          title={b.kind === 'split' ? fullSplitLabel(b.feature, meta, thresholdDecimals, ui) : title}
        >
          {title}
        </div>
        {subtitle && <div className="node-subtitle">{subtitle}</div>}
      </div>

      {b.kind === 'choice' && <div className="choice-pill">{feasibleChoices}</div>}

      <Handle type="source" position={Position.Bottom} className="handle" />
    </div>
  );
}

const nodeTypes = {
  praxis: PraxisNode,
};

function downloadJson(name: string, x: unknown) {
  const blob = new Blob([JSON.stringify(x, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);
}

function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function SplitButton({
  annotated,
  graph,
  meta,
  thresholdDecimals,
  ui,
  onClick,
}: {
  annotated: ChoiceBudget;
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  thresholdDecimals: number;
  ui: BuilderUi;
  onClick: () => void;
}) {
  const { choice, objective, feasible, excess } = annotated;
  const excessValue = excess ?? 0;

  const disabledTitle = feasible
    ? undefined
    : `Not feasible under the current partial tree. Free ${formatObjective(
        graph,
        excessValue,
      )} objective somewhere else, then this choice can become available again.`;

  if (choice.kind === 'leaf') {
    return (
      <button
        className={`choice-card leaf-choice ${
          feasible ? '' : 'choice-card-disabled'
        }`}
        onClick={feasible ? onClick : undefined}
        disabled={!feasible}
        title={disabledTitle}
      >
        {!feasible && (
          <div className="blocked-mark">
            <Ban size={15} />
          </div>
        )}

        <div className="choice-card-main">
          Leaf prediction {predictionLabel(choice.leaf.prediction, ui)}
        </div>

        <div className="choice-card-sub">
          {leafMisclassificationRate(graph, meta, choice.leaf.id)} · obj{' '}
          {formatObjective(graph, objective)} · n={choice.leaf.subproblem_size ?? '—'}
          {!feasible ? ` · over by ${formatObjective(graph, excessValue)}` : ''}
        </div>
      </button>
    );
  }

  const f = choice.split.feature;

  return (
    <button
      className={`choice-card split-choice ${
        feasible ? '' : 'choice-card-disabled'
      }`}
      onClick={feasible ? onClick : undefined}
      disabled={!feasible}
      title={disabledTitle}
    >
      {!feasible && (
        <div className="blocked-mark">
          <Ban size={15} />
        </div>
      )}

      <div className="choice-card-main">{prettySplitLabel(f, meta, thresholdDecimals, ui)}</div>

      <div className="choice-card-sub">
        obj {formatObjective(graph, objective)} · feature {f} · split #
        {choice.split.id}
        {!feasible ? ` · over by ${formatObjective(graph, excessValue)}` : ''}
      </div>
    </button>
  );
}

function SidePanel({
  graph,
  meta,
  snapshot,
  active,
  thresholdDecimals,
  ui,
  onApplySplit,
  onApplyLeaf,
  onSetActive,
  onReset,
  onRandom,
  onUndo,
  canUndo,
}: {
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  snapshot: HistorySnapshot;
  active?: BuildNode;
  thresholdDecimals: number;
  ui: BuilderUi;
  onApplySplit: (splitId: number) => void;
  onApplyLeaf: (leafId: number) => void;
  onSetActive: (uid: number) => void;
  onReset: () => void;
  onRandom: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    setExpandedGroup(null);
    setQuery('');
  }, [active?.uid]);

  const unresolved = unresolvedNodes(snapshot.root);

  const activeChoices =
    active && active.kind === 'choice'
      ? annotateChoicesFor(graph, snapshot, active.uid)
      : [];

  const budget =
    active && active.kind === 'choice'
      ? nodeBudgetFor(graph, snapshot, active.uid)
      : undefined;

  const currentLower = lowerBound(graph, snapshot.root);
  const feasibleTotal = activeChoices.filter((x) => x.feasible).length;

  const q = query.trim().toLowerCase();

  const filtered = activeChoices.filter((x) => {
    const c = x.choice;

    if (!q) return true;

    if (c.kind === 'leaf') {
      return `leaf ${predictionLabel(c.leaf.prediction, ui)} ${leafMisclassificationRate(
        graph,
        meta,
        c.leaf.id,
      )} objective ${formatObjective(graph, x.objective)}`
        .toLowerCase()
        .includes(q);
    }

    return `${prettySplitLabel(c.split.feature, meta, thresholdDecimals, ui)} ${
      displayGroupName(c.split.feature, meta, ui) ?? ''
    } ${prettyThresholdLabel(c.split.feature, meta, thresholdDecimals)} objective ${formatObjective(
      graph,
      x.objective,
    )}`
      .toLowerCase()
      .includes(q);
  });

  const makeChoiceGroups = (feasibleXs: ChoiceBudget[], allXs: ChoiceBudget[]) => {
    const grouped = new Map<string, ChoiceBudget[]>();
    const totalByGroup = new Map<string, number>();
    const leaves: ChoiceBudget[] = [];
    const totalLeaves = allXs.filter((x) => x.choice.kind === 'leaf').length;

    for (const c of allXs) {
      if (c.choice.kind === 'split') {
        const key =
          displayGroupName(c.choice.split.feature, meta, ui) ??
          BINARY_GROUP_LABEL;
        totalByGroup.set(key, (totalByGroup.get(key) ?? 0) + 1);
      }
    }

    for (const c of feasibleXs) {
      if (c.choice.kind === 'leaf') {
        leaves.push(c);
      } else {
        const key =
          displayGroupName(c.choice.split.feature, meta, ui) ??
          BINARY_GROUP_LABEL;

        grouped.set(key, [...(grouped.get(key) ?? []), c]);
      }
    }

    const sortedGroupEntries = Array.from(grouped.entries()).map(([name, choices]) => {
      const sorted = [...choices].sort((a, b) => {
        if (a.choice.kind !== 'split' || b.choice.kind !== 'split') return 0;

        return prettyThresholdLabel(a.choice.split.feature, meta, thresholdDecimals).localeCompare(
          prettyThresholdLabel(b.choice.split.feature, meta, thresholdDecimals),
          undefined,
          { numeric: true },
        );
      });

      const bestObjective = Math.min(...sorted.map((x) => x.objective));

      return {
        name,
        choices: sorted,
        validCount: sorted.length,
        totalCount: totalByGroup.get(name) ?? sorted.length,
        bestObjective,
        collapsed: name !== BINARY_GROUP_LABEL && sorted.length > 4,
      };
    });

    return { leaves, totalLeaves, sortedGroupEntries };
  };

  const feasibleFiltered = filtered.filter((x) => x.feasible);

  const { leaves, totalLeaves, sortedGroupEntries } = makeChoiceGroups(
    feasibleFiltered,
    filtered,
  );

  const expandedEntry =
    expandedGroup === null
      ? undefined
      : sortedGroupEntries.find((g) => g.name === expandedGroup);

  const visibleGroupEntries =
    expandedGroup === null
      ? sortedGroupEntries
      : expandedEntry
        ? [expandedEntry]
        : [];

  const paths = treePaths(snapshot.root);

  return (
    <aside className="panel">
      <div className="brand">
        <div className="brand-badge">
          <Sparkles size={19} />
        </div>
        <div>
          <div className="brand-title">PRAXIS Tree Builder</div>
          <div className="brand-subtitle">Guaranteed Rashomon membership</div>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric">
          <b>{formatObjective(graph, currentLower)}</b>
          <span>current lower bound</span>
        </div>
        <div className="metric">
          <b>{formatObjective(graph, rootBudget(graph))}</b>
          <span>Rashomon budget</span>
        </div>
        <div className="metric">
          <b>{formatObjective(graph, rootBudget(graph) - currentLower)}</b>
          <span>remaining slack</span>
        </div>
        <div className="metric">
          <b>{rootSize(graph).toLocaleString()}</b>
          <span>training samples</span>
        </div>
      </div>

      <div className="toolbar-row">
        <button className="ghost-button" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={15} /> Undo
        </button>

        <button className="ghost-button" onClick={onReset}>
          <RotateCcw size={15} /> Reset
        </button>

        <button
          className="ghost-button"
          onClick={onRandom}
          disabled={isComplete(snapshot.root)}
        >
          <Shuffle size={15} /> Random
        </button>

        <button
          className="ghost-button"
          onClick={() =>
            downloadJson('praxis-built-tree.json', {
              complete: isComplete(snapshot.root),
              objective_lower_bound: currentLower,
              normalized_objective_lower_bound: normalizedObjective(
                graph,
                currentLower,
              ),
              paths,
              tree: snapshot.root,
            })
          }
        >
          <Download size={15} /> Export
        </button>
      </div>

      <section className="panel-section">
        <div className="section-title">Remaining Choices</div>

        <div className="frontier-list">
          {unresolved.map((n) => {
            const ann = annotateChoicesFor(graph, snapshot, n.uid);
            const feasible = ann.filter((x) => x.feasible).length;

            return (
              <button
                key={n.uid}
                className={`frontier-item ${
                  n.uid === snapshot.activeUid ? 'selected' : ''
                }`}
                onClick={() => onSetActive(n.uid)}
              >
                <span>node {n.uid}</span>
                <b>
                  {feasible}/{ann.length}
                </b>
              </button>
            );
          })}

          {unresolved.length === 0 && (
            <div className="empty">
              Tree complete. Export it or rewind a branch.
            </div>
          )}
        </div>
      </section>

      <section className="panel-section choice-panel">
        <div className="section-title">
          {expandedEntry
            ? `Thresholds for ${expandedEntry.name}`
            : `Choices for node ${active?.uid ?? '—'}`}
        </div>

        {budget && (
          <div className="budget-box">
            <div>
              <span>available here</span>
              <b>{formatObjective(graph, budget.nodeAvailableBudget)}</b>
            </div>
            <div>
              <span>best here</span>
              <b>{formatObjective(graph, budget.nodeBestObjective)}</b>
            </div>
            <div>
              <span>already committed</span>
              <b>{formatObjective(graph, budget.otherLowerBound)}</b>
            </div>
            <div>
              <span>feasible choices</span>
              <b>
                {feasibleTotal}/{activeChoices.length}
              </b>
            </div>
          </div>
        )}

        {expandedEntry && (
          <button
            className="back-button"
            onClick={() => {
              setExpandedGroup(null);
              setQuery('');
            }}
          >
            ← Back to feature choices
          </button>
        )}

        <label className="search-box">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              expandedEntry
                ? 'Search thresholds'
                : 'Search features or thresholds'
            }
          />
        </label>

        <AnimatePresence mode="popLayout">
          {!expandedEntry && leaves.length > 0 && (
            <motion.div
              className="choice-group"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="choice-group-title">
                Leaf options
                <span className="choice-group-count">
                  {leaves.length}/{totalLeaves} valid
                </span>
              </div>

              {leaves.map((x) =>
                x.choice.kind === 'leaf' ? (
                  <SplitButton
                    key={`l-${x.choice.leaf.id}`}
                    annotated={x}
                    graph={graph}
                    meta={meta}
                    thresholdDecimals={thresholdDecimals}
                    ui={ui}
                    onClick={() => onApplyLeaf(x.choice.leaf.id)}
                  />
                ) : null,
              )}
            </motion.div>
          )}

          {visibleGroupEntries.map((entry) => {
            if (entry.collapsed && !expandedEntry) {
              return (
                <motion.div
                  className="choice-group collapsed-choice-group"
                  layout
                  key={entry.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <div className="choice-group-title">
                    {entry.name}
                    <span className="choice-group-count">
                      {entry.totalCount} choices
                    </span>
                  </div>

                  <button
                    className="feature-summary-card"
                    onClick={() => {
                      setExpandedGroup(entry.name);
                      setQuery('');
                    }}
                  >
                    <div className="feature-summary-main">
                      <span>Choose threshold</span>
                      <b>{entry.validCount}/{entry.totalCount}</b>
                    </div>

                    <div className="feature-summary-sub">
                      best obj {formatObjective(graph, entry.bestObjective)}
                    </div>

                    <div className="feature-summary-hint">
                      Click to choose threshold for {entry.name}
                    </div>
                  </button>
                </motion.div>
              );
            }

            return (
              <motion.div
                className="choice-group"
                layout
                key={entry.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <div className="choice-group-title">
                  {entry.name}
                  {expandedEntry && (
                    <span className="choice-group-count">
                      {entry.totalCount} choices
                    </span>
                  )}
                </div>

                <div className="choice-grid">
                  {entry.choices.map((x) =>
                    x.choice.kind === 'split' ? (
                      <SplitButton
                        key={`s-${x.choice.split.id}`}
                        annotated={x}
                        graph={graph}
                        meta={meta}
                        thresholdDecimals={thresholdDecimals}
                        ui={ui}
                        onClick={() => onApplySplit(x.choice.split.id)}
                      />
                    ) : null,
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </section>


    </aside>
  );
}

function BuilderSettingsMenu({
  graph,
  meta,
  ui,
  setUi,
  thresholdDecimals,
  setThresholdDecimals,
}: {
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  ui: BuilderUi;
  setUi: Dispatch<SetStateAction<BuilderUi>>;
  thresholdDecimals: number;
  setThresholdDecimals: Dispatch<SetStateAction<number>>;
}) {
  const [open, setOpen] = useState(false);

  const labels = useMemo(
    () =>
      Array.from(new Set(graph.leaf_nodes.map((leaf) => leaf.prediction))).sort(
        (a, b) => a - b,
      ),
    [graph],
  );

  const groups = useMemo(() => continuousGroupEntries(meta), [meta]);

  const binaryFeatures = useMemo(() => {
    const grouped = new Set(groups.flatMap((g) => g.features));
    return allSplitFeatures(graph).filter((feature) => !grouped.has(feature));
  }, [graph, groups]);

  const updateLabelName = (prediction: number, value: string) => {
    setUi((cur) => ({
      ...cur,
      labelNames: {
        ...cur.labelNames,
        [String(prediction)]: value,
      },
    }));
  };

  const updateGroupName = (group: string, value: string) => {
    setUi((cur) => ({
      ...cur,
      groupNames: {
        ...cur.groupNames,
        [group]: value,
      },
    }));
  };

  const updateFeatureName = (feature: number, value: string) => {
    setUi((cur) => ({
      ...cur,
      featureNames: {
        ...cur.featureNames,
        [String(feature)]: value,
      },
    }));
  };

  const updateColor = (
    key: Exclude<keyof BuilderColors, 'leafNodesByClass'>,
    value: string,
  ) => {
    setUi((cur) => ({
      ...cur,
      colors: {
        ...cur.colors,
        [key]: value,
      },
    }));
  };

  const updateLeafClassColor = (prediction: number, value: string) => {
    setUi((cur) => ({
      ...cur,
      colors: {
        ...cur.colors,
        leafNodesByClass: {
          ...cur.colors.leafNodesByClass,
          [String(prediction)]: value,
        },
      },
    }));
  };

  const resetNames = () => {
    setUi((cur) => ({
      ...cur,
      labelNames: {},
      featureNames: {},
      groupNames: {},
    }));
  };

  const resetColors = () => {
    setUi((cur) => ({
      ...cur,
      colors: {
        ...DEFAULT_COLORS,
        leafNodesByClass: {
          ...DEFAULT_COLORS.leafNodesByClass,
        },
      },
    }));
  };

  return (
    <div className="settings-wrap">
      <button className="ghost-button" onClick={() => setOpen((x) => !x)}>
        <SlidersHorizontal size={15} /> Customize
      </button>

      {open && (
        <div className="settings-popover">
          <div className="settings-header">
            <div>
              <b>Customize UI</b>
              <span>Names and colors only affect display.</span>
            </div>

            <button className="mini-button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Feature display</div>

            <label className="settings-row">
              <span>Threshold Decimals</span>
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={thresholdDecimals}
                onChange={(e) => setThresholdDecimals(Number(e.target.value))}
              />
            </label>

            <div className="settings-empty">
              Current: {thresholdDecimals}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Label names</div>

            {labels.map((prediction) => (
              <label className="settings-row" key={`label-${prediction}`}>
                <span>class {prediction}</span>
                <input
                  value={ui.labelNames[String(prediction)] ?? ''}
                  placeholder={`predict ${prediction}`}
                  onChange={(e) => updateLabelName(prediction, e.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Continuous feature names</div>

            {groups.length === 0 && (
              <div className="settings-empty">No continuous groups in this payload.</div>
            )}

            {groups.map((group) => (
              <label className="settings-row" key={`group-${group.key}`}>
                <span>{group.key}</span>
                <input
                  value={ui.groupNames[group.key] ?? ''}
                  placeholder={group.key}
                  onChange={(e) => updateGroupName(group.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Independent binary feature names</div>

            {binaryFeatures.length === 0 && (
              <div className="settings-empty">No independent binary features in this payload.</div>
            )}

            {binaryFeatures.map((feature) => (
              <label className="settings-row" key={`feature-${feature}`}>
                <span>feature {feature}</span>
                <input
                  value={ui.featureNames[String(feature)] ?? ''}
                  placeholder={featureLabel(feature, meta)}
                  onChange={(e) => updateFeatureName(feature, e.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Colors</div>

            <label className="settings-row color-row">
              <span>split nodes</span>
              <input
                type="color"
                value={ui.colors.splitNode}
                onChange={(e) => updateColor('splitNode', e.target.value)}
              />
            </label>

            <label className="settings-row color-row">
              <span>leaves</span>
              <input
                type="color"
                value={ui.colors.leafNode}
                onChange={(e) => updateColor('leafNode', e.target.value)}
              />
            </label>

            {labels.map((prediction) => (
              <label className="settings-row color-row" key={`leaf-color-${prediction}`}>
                <span>{predictionLabel(prediction, ui)} leaf</span>
                <input
                  type="color"
                  value={
                    ui.colors.leafNodesByClass[String(prediction)] ||
                    ui.colors.leafNode
                  }
                  onChange={(e) => updateLeafClassColor(prediction, e.target.value)}
                />
              </label>
            ))}

            <label className="settings-row color-row">
              <span>edges</span>
              <input
                type="color"
                value={ui.colors.edge}
                onChange={(e) => updateColor('edge', e.target.value)}
              />
            </label>

            <label className="settings-row color-row">
              <span>background</span>
              <input
                type="color"
                value={ui.colors.background}
                onChange={(e) => updateColor('background', e.target.value)}
              />
            </label>
          </div>

          <div className="settings-actions">
            <button className="mini-button" onClick={resetNames}>
              Reset names
            </button>

            <button className="mini-button" onClick={resetColors}>
              Reset colors
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowView({
  graph,
  meta,
  snapshot,
  thresholdDecimals,
  ui,
  setSnapshot,
  pushHistory,
}: {
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  snapshot: HistorySnapshot;
  thresholdDecimals: number;
  ui: BuilderUi;
  setSnapshot: (s: HistorySnapshot) => void;
  pushHistory: () => void;
}) {
  const rf = useReactFlow();

  const { nodes: laidNodes, edges: laidEdges } = useMemo(
    () => layoutTree(snapshot.root),
    [snapshot.root],
  );

  const nodes: Node<NodeData>[] = useMemo(
    () =>
      laidNodes.map((n) => {
        const ann =
          n.kind === 'choice' ? annotateChoicesFor(graph, snapshot, n.uid) : [];

        return {
          id: String(n.uid),
          type: 'praxis',
          position: { x: n.x, y: n.y },
          data: {
            b: n,
            active: n.uid === snapshot.activeUid,
            choices:
              n.kind === 'choice' ? choicesFor(graph, n.graphTrieId).length : 0,
            feasibleChoices: ann.filter((x) => x.feasible).length,
            meta,
            graph,
            thresholdDecimals,
            ui,
          },
          draggable: false,
        };
      }),
    [laidNodes, snapshot, graph, meta, thresholdDecimals, ui],
  );

  const edges: Edge[] = useMemo(
    () =>
      laidEdges.map((e) => ({
        id: e.id,
        source: String(e.source),
        target: String(e.target),
        label: e.label,
        type: 'straight',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: ui.colors.edge },
        labelBgPadding: [16, 11] as [number, number],
        labelBgBorderRadius: 999,
        style: {
          strokeWidth: 4.0,
          stroke: ui.colors.edge,
        },
        labelStyle: {
          fontWeight: 950,
          fontSize: 34,
        },
      })),
    [laidEdges, ui.colors.edge],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      rf.fitView({ padding: 0.22, duration: 450 });
    }, 40);

    return () => window.clearTimeout(t);
  }, [nodes.length, rf]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodeOrigin={[0.5, 0]}
      minZoom={0.12}
      maxZoom={2.2}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      onNodeClick={(_, node) => {
        const b = (node.data as NodeData).b;

        if (b.kind === 'choice') {
          setSnapshot({ ...snapshot, activeUid: b.uid });
        } else {
          pushHistory();
          setSnapshot(rewind(snapshot, b.uid));
        }
      }}
    >
      <Controls />
    </ReactFlow>
  );
}

function App() {
  const initialPayload = window.PRAXIS_BUILDER_PAYLOAD;

  const initialGraph =
    window.PRAXIS_ANDOR_GRAPH ??
    initialPayload?.graph ??
    sampleGraph;

  const initialMeta = coerceMeta(initialPayload);

  const [graph, setGraph] = useState<AndOrGraph>(initialGraph);
  const [meta, setMeta] = useState<FeatureMeta & Record<string, unknown>>(initialMeta);
  const [payloadName, setPayloadName] = useState<string>('embedded PRAXIS graph');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [thresholdDecimals, setThresholdDecimals] = useState(3);
  const [ui, setUi] = useState<BuilderUi>(() => makeDefaultUi());

  const [snapshot, setSnapshot] = useState<HistorySnapshot>(() => autoExpandSingletons(makeRoot(initialGraph), initialGraph));
  const [history, setHistory] = useState<HistorySnapshot[]>([]);

  const active = findNode(snapshot.root, snapshot.activeUid);

  const loadPayload = (raw: unknown, name: string) => {
    const payload = raw as Window['PRAXIS_BUILDER_PAYLOAD'];

    const nextGraph = payload?.graph;

    if (!nextGraph) {
      throw new Error('Payload must contain a top-level "graph" field.');
    }

    const nextMeta = coerceMeta(payload);

    setGraph(nextGraph);
    setMeta(nextMeta);
    setSnapshot(autoExpandSingletons(makeRoot(nextGraph), nextGraph));
    setHistory([]);
    setPayloadName(name);
    setUploadError(null);
    setUi(makeDefaultUi());
  };

  const pushHistory = () => {
    setHistory((h) => [...h, cloneSnapshot(snapshot)]);
  };

  const setWithHistory = (next: HistorySnapshot) => {
    if (next === snapshot) return;

    pushHistory();
    setSnapshot(next);
  };

  const themeStyle = {
    '--builder-bg': ui.colors.background,
    '--split-node-bg': ui.colors.splitNode,
    '--leaf-node-bg': ui.colors.leafNode,
    '--edge-color': ui.colors.edge,
  } as CSSProperties;

  return (
    <div className="app-shell" style={themeStyle}>
      <div className="canvas-card">
        <div className="canvas-header">
          <div>
            <h1>Interactive Rashomon Tree Builder</h1>
            <p>
              Choose from splits that perserve near-optimality.
            </p>
            <p className="payload-name">Loaded: {payloadName}</p>
            {uploadError && <p className="upload-error">{uploadError}</p>}
          </div>

          <div className="header-actions">
            <BuilderSettingsMenu
              graph={graph}
              meta={meta}
              ui={ui}
              setUi={setUi}
              thresholdDecimals={thresholdDecimals}
              setThresholdDecimals={setThresholdDecimals}
            />

            <label className="ghost-button upload-button">
              <Upload size={15} /> Upload
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = '';

                  if (!file) return;

                  try {
                    const raw = await readJsonFile(file);
                    loadPayload(raw, file.name);
                  } catch (err) {
                    setUploadError(
                      err instanceof Error
                        ? err.message
                        : 'Could not load payload JSON.',
                    );
                  }
                }}
              />
            </label>

            <div className={`status ${isComplete(snapshot.root) ? 'done' : ''}`}>
              {isComplete(snapshot.root) ? 'complete' : 'building'}
            </div>
          </div>
        </div>

        <ReactFlowProvider>
          <div className="flow-wrap">
            <FlowView
              graph={graph}
              meta={meta}
              snapshot={snapshot}
              thresholdDecimals={thresholdDecimals}
              ui={ui}
              setSnapshot={setSnapshot}
              pushHistory={pushHistory}
            />
          </div>
        </ReactFlowProvider>
      </div>

      <SidePanel
        graph={graph}
        meta={meta}
        snapshot={snapshot}
        active={active}
        thresholdDecimals={thresholdDecimals}
        ui={ui}
        canUndo={history.length > 0}
        onUndo={() => {
          const last = history[history.length - 1];
          if (!last) return;

          setHistory((h) => h.slice(0, -1));
          setSnapshot(last);
        }}
        onReset={() => {
          pushHistory();
          setSnapshot(autoExpandSingletons(makeRoot(graph), graph));
        }}
        onRandom={() => {
          setWithHistory(randomComplete(snapshot, graph));
        }}
        onSetActive={(uid) => setSnapshot({ ...snapshot, activeUid: uid })}
        onApplyLeaf={(leafId) => {
          if (!active) return;
          setWithHistory(applyLeaf(snapshot, graph, active.uid, leafId));
        }}
        onApplySplit={(splitId) => {
          if (!active) return;
          setWithHistory(applySplit(snapshot, graph, active.uid, splitId));
        }}
      />
    </div>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element.');
}

createRoot(rootElement).render(<App />);