import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  Background,
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
  autoExpandSingletons
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

type NodeData = {
  b: BuildNode;
  active: boolean;
  choices: number;
  feasibleChoices: number;
  meta: FeatureMeta & Record<string, unknown>;
  graph: AndOrGraph;
  thresholdDecimals: number;
};

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
): string {
  const group = groupName(feature, meta);

  if (group) {
    return `${compactFeatureName(group)} ≤ ${prettyThresholdLabel(feature, meta, thresholdDecimals)}`;
  }

  const raw = featureLabel(feature, meta);

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
): string {
  const group = groupName(feature, meta);

  if (group) {
    return `${group} ≤ ${prettyThresholdLabel(feature, meta, thresholdDecimals)}`;
  }

  return featureLabel(feature, meta).replace(
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

function leafMisclassificationRate(
  graph: AndOrGraph,
  meta: FeatureMeta & Record<string, unknown>,
  leafId?: number,
): string {
  if (leafId === undefined || leafId === null) return 'err —';

  const leaf = graph.leaf_nodes.find((x) => x.id === leafId) as
    | {
        id: number;
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

  const mistakes = Math.max(0, Number(leaf.loss) - gamma);
  const pct = (100 * mistakes) / Number(leaf.subproblem_size);

  return `${stripZeros(pct.toFixed(2))}% err`;
}

function PraxisNode({ data }: { data: NodeData }) {
  const { b, active, choices, feasibleChoices, meta, graph, thresholdDecimals } = data;

  const icon =
    b.kind === 'split' || b.kind === 'leaf' ? null : (
      <CircleDot size={30} />
    );

  const title =
    b.kind === 'split'
      ? prettySplitLabel(b.feature, meta, thresholdDecimals)
      : b.kind === 'leaf'
        ? `predict ${b.prediction}`
        : `${feasibleChoices}/${choices} choices`;

  const subtitle =
    b.kind === 'split'
      ? ''
      : b.kind === 'leaf'
        ? leafMisclassificationRate(graph, meta, b.leafId)
        : `best ${formatObjective(graph, lowerBound(graph, b))}`;

  return (
    <div
      className={`praxis-node praxis-node-${b.kind} ${active ? 'active' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="handle" />

      <div className="node-icon">{icon}</div>

      <div className="node-copy">
        <div
          className="node-title"
          title={b.kind === 'split' ? fullSplitLabel(b.feature, meta, thresholdDecimals) : title}
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
  onClick,
}: {
  annotated: ChoiceBudget;
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  thresholdDecimals: number;
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
          Leaf prediction {choice.leaf.prediction}
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

      <div className="choice-card-main">{prettySplitLabel(f, meta, thresholdDecimals)}</div>

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
  onApplySplit,
  onApplyLeaf,
  onSetActive,
  onReset,
  onUndo,
  canUndo,
}: {
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  snapshot: HistorySnapshot;
  active?: BuildNode;
  thresholdDecimals: number;
  onApplySplit: (splitId: number) => void;
  onApplyLeaf: (leafId: number) => void;
  onSetActive: (uid: number) => void;
  onReset: () => void;
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
      return `leaf predict ${c.leaf.prediction} ${leafMisclassificationRate(
        graph,
        meta,
        c.leaf.id,
      )} objective ${formatObjective(graph, x.objective)}`
        .toLowerCase()
        .includes(q);
    }

    return `${prettySplitLabel(c.split.feature, meta, thresholdDecimals)} ${
      groupName(c.split.feature, meta) ?? ''
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
          groupName(c.choice.split.feature, meta) ??
          'Binary / already-binarized features';
        totalByGroup.set(key, (totalByGroup.get(key) ?? 0) + 1);
      }
    }

    for (const c of feasibleXs) {
      if (c.choice.kind === 'leaf') {
        leaves.push(c);
      } else {
        const key =
          groupName(c.choice.split.feature, meta) ??
          'Binary / already-binarized features';

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
        collapsed: name !== 'Binary / already-binarized features' && sorted.length > 4,
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

function FlowView({
  graph,
  meta,
  snapshot,
  thresholdDecimals,
  setSnapshot,
  pushHistory,
}: {
  graph: AndOrGraph;
  meta: FeatureMeta & Record<string, unknown>;
  snapshot: HistorySnapshot;
  thresholdDecimals: number;
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
          },
          draggable: false,
        };
      }),
    [laidNodes, snapshot, graph, meta, thresholdDecimals],
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
        markerEnd: { type: MarkerType.ArrowClosed },
        labelBgPadding: [16, 11] as [number, number],
        labelBgBorderRadius: 999,
        style: {
          strokeWidth: 4.0,
        },
        labelStyle: {
          fontWeight: 950,
          fontSize: 34,
        },
      })),
    [laidEdges],
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
      <Background gap={26} size={1.1} color="#d8e2ec" />
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
  };

  const pushHistory = () => {
    setHistory((h) => [...h, cloneSnapshot(snapshot)]);
  };

  const setWithHistory = (next: HistorySnapshot) => {
    if (next === snapshot) return;

    pushHistory();
    setSnapshot(next);
  };

  return (
    <div className="app-shell">
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
            <label className="decimal-control">
              <span>Feature decimals: {thresholdDecimals}</span>
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={thresholdDecimals}
                onChange={(e) => setThresholdDecimals(Number(e.target.value))}
              />
            </label>

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