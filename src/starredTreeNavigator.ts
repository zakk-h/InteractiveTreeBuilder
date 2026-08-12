const STYLE_ID = 'arborenum-starred-trees-style';
const WRAP_ID = 'arborenum-starred-trees-wrap';

type BuildNodeLike = {
  uid: number;
  graphTrieId: number;
  kind: 'choice' | 'split' | 'leaf';
  left?: BuildNodeLike;
  right?: BuildNodeLike;
};

type SnapshotLike = {
  root: BuildNodeLike;
  activeUid: number;
  nextUid: number;
};

type HookLike = {
  memoizedState: unknown;
  next?: HookLike | null;
  queue?: {
    dispatch?: (value: unknown) => void;
  } | null;
};

type FiberLike = {
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  alternate?: FiberLike | null;
  memoizedState?: HookLike | unknown;
};

type SnapshotBridge = {
  snapshot: SnapshotLike;
  snapshotHook: HookLike;
  historyHook?: HookLike;
};

type StarredTree = {
  id: number;
  label: string;
  snapshot: SnapshotLike;
  signature: string;
  savedAt: number;
  accuracy?: string;
};

type TreeCounts = {
  total: number;
  splits: number;
  leaves: number;
  open: number;
  depth: number;
};

type ThumbPoint = {
  node: BuildNodeLike;
  x: number;
  depth: number;
};

let starred: StarredTree[] = [];
let nextStarId = 1;
let open = false;

function cloneSnapshot(snapshot: SnapshotLike): SnapshotLike {
  return JSON.parse(JSON.stringify(snapshot)) as SnapshotLike;
}

function isSnapshot(value: unknown): value is SnapshotLike {
  if (!value || typeof value !== 'object') return false;
  const x = value as Partial<SnapshotLike>;
  return (
    !!x.root &&
    typeof x.root === 'object' &&
    Number.isInteger(x.activeUid) &&
    Number.isInteger(x.nextUid)
  );
}

function nodeCounts(root: BuildNodeLike): TreeCounts {
  let total = 0;
  let splits = 0;
  let leaves = 0;
  let openNodes = 0;
  let maxDepth = 0;

  const walk = (node: BuildNodeLike | undefined, depth: number) => {
    if (!node) return;
    total += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (node.kind === 'split') splits += 1;
    else if (node.kind === 'leaf') leaves += 1;
    else openNodes += 1;
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  };

  walk(root, 0);
  return { total, splits, leaves, open: openNodes, depth: maxDepth };
}

function treeSignature(snapshot: SnapshotLike): string {
  const encode = (node?: BuildNodeLike): unknown => {
    if (!node) return null;
    return {
      graphTrieId: node.graphTrieId,
      kind: node.kind,
      left: encode(node.left),
      right: encode(node.right),
    };
  };
  return JSON.stringify(encode(snapshot.root));
}

function rootFiber(): FiberLike | undefined {
  const root = document.getElementById('root') as (HTMLElement & Record<string, unknown>) | null;
  if (!root) return undefined;
  const key = Object.keys(root).find((x) => x.startsWith('__reactContainer$'));
  return key ? (root[key] as FiberLike | undefined) : undefined;
}

function activeUidFromDom(): number | undefined {
  const active = document.querySelector('.react-flow__node-praxis .praxis-node.active');
  const flowNode = active?.closest<HTMLElement>('.react-flow__node-praxis');
  const raw = flowNode?.dataset.id ?? flowNode?.getAttribute('data-id');
  const uid = Number(raw);
  return Number.isInteger(uid) ? uid : undefined;
}

function findSnapshotHooks(start?: FiberLike): SnapshotBridge[] {
  if (!start) return [];
  const out: SnapshotBridge[] = [];
  const seen = new Set<FiberLike>();
  const stack: FiberLike[] = [start];

  while (stack.length > 0) {
    const fiber = stack.pop()!;
    if (seen.has(fiber)) continue;
    seen.add(fiber);

    const state = fiber.memoizedState;
    if (state && typeof state === 'object' && 'memoizedState' in state) {
      let hook = state as HookLike;
      while (hook) {
        if (isSnapshot(hook.memoizedState) && typeof hook.queue?.dispatch === 'function') {
          const historyHook =
            hook.next &&
            Array.isArray(hook.next.memoizedState) &&
            typeof hook.next.queue?.dispatch === 'function'
              ? hook.next
              : undefined;
          out.push({
            snapshot: hook.memoizedState,
            snapshotHook: hook,
            historyHook,
          });
        }
        hook = hook.next ?? (undefined as unknown as HookLike);
      }
    }

    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.alternate) stack.push(fiber.alternate);
  }

  return out;
}

function currentBridge(): SnapshotBridge | undefined {
  const candidates = findSnapshotHooks(rootFiber());
  if (candidates.length === 0) return undefined;

  const activeUid = activeUidFromDom();
  const renderedNodes = document.querySelectorAll('.react-flow__node-praxis').length;

  return (
    candidates.find((x) => {
      const counts = nodeCounts(x.snapshot.root);
      return x.snapshot.activeUid === activeUid && counts.total === renderedNodes;
    }) ??
    candidates.find((x) => nodeCounts(x.snapshot.root).total === renderedNodes) ??
    candidates[0]
  );
}

function currentSignature(): string | undefined {
  const bridge = currentBridge();
  return bridge ? treeSignature(bridge.snapshot) : undefined;
}

function completedAccuracyFromDom(): string | undefined {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.panel-section'));
  const completed = sections.find(
    (section) =>
      section.querySelector('.section-title')?.textContent?.trim().toLowerCase() ===
      'completed tree',
  );
  if (!completed) return undefined;

  for (const row of completed.querySelectorAll<HTMLElement>('.budget-box > div')) {
    const label = row.querySelector('span')?.textContent?.trim().toLowerCase();
    if (label === 'accuracy') {
      return row.querySelector('b')?.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

function afterReactPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function restoreStar(tree: StarredTree) {
  const bridge = currentBridge();
  if (!bridge || typeof bridge.snapshotHook.queue?.dispatch !== 'function') return;

  const current = cloneSnapshot(bridge.snapshot);
  if (bridge.historyHook && typeof bridge.historyHook.queue?.dispatch === 'function') {
    bridge.historyHook.queue.dispatch((previous: unknown) =>
      Array.isArray(previous) ? [...previous, current] : [current],
    );
  }

  bridge.snapshotHook.queue.dispatch(cloneSnapshot(tree.snapshot));
  open = false;
  afterReactPaint(render);
}

function starCurrentTree() {
  const bridge = currentBridge();
  if (!bridge) return;

  const snapshot = cloneSnapshot(bridge.snapshot);
  const signature = treeSignature(snapshot);
  const existing = starred.find((x) => x.signature === signature);

  if (existing) {
    open = true;
    render();
    return;
  }

  const counts = nodeCounts(snapshot.root);
  starred.push({
    id: nextStarId,
    label: `Tree ${nextStarId}`,
    snapshot,
    signature,
    savedAt: Date.now(),
    accuracy: counts.open === 0 ? completedAccuracyFromDom() : undefined,
  });
  nextStarId += 1;
  open = true;
  render();
}

function removeStar(id: number) {
  starred = starred.filter((x) => x.id !== id);
  render();
}

function renameStar(id: number, label: string) {
  const tree = starred.find((x) => x.id === id);
  if (!tree) return;
  tree.label = label.slice(0, 60);
}

function formatSavedTime(time: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(time));
  } catch {
    return '';
  }
}

function thumbnailLayout(root: BuildNodeLike): {
  points: ThumbPoint[];
  edges: Array<[ThumbPoint, ThumbPoint]>;
  maxX: number;
  maxDepth: number;
} {
  const points: ThumbPoint[] = [];
  const edges: Array<[ThumbPoint, ThumbPoint]> = [];
  let leafX = 0;
  let maxDepth = 0;

  const visit = (node: BuildNodeLike, depth: number): ThumbPoint => {
    maxDepth = Math.max(maxDepth, depth);
    const children = [node.left, node.right].filter((x): x is BuildNodeLike => !!x);
    let x: number;

    if (children.length === 0) {
      x = leafX;
      leafX += 1;
    } else {
      const childPoints = children.map((child) => visit(child, depth + 1));
      x = childPoints.reduce((sum, p) => sum + p.x, 0) / childPoints.length;
      const point: ThumbPoint = { node, x, depth };
      points.push(point);
      for (const childPoint of childPoints) edges.push([point, childPoint]);
      return point;
    }

    const point: ThumbPoint = { node, x, depth };
    points.push(point);
    return point;
  };

  visit(root, 0);
  return {
    points,
    edges,
    maxX: Math.max(1, leafX - 1),
    maxDepth: Math.max(1, maxDepth),
  };
}

function makeTreeThumbnail(tree: StarredTree): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 220 98');
  svg.setAttribute('class', 'starred-tree-thumbnail');
  svg.setAttribute('aria-hidden', 'true');

  const layout = thumbnailLayout(tree.snapshot.root);
  const px = (x: number) => 18 + (184 * x) / layout.maxX;
  const py = (depth: number) => 13 + (70 * depth) / layout.maxDepth;

  for (const [from, to] of layout.edges) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(px(from.x)));
    line.setAttribute('y1', String(py(from.depth)));
    line.setAttribute('x2', String(px(to.x)));
    line.setAttribute('y2', String(py(to.depth)));
    line.setAttribute('class', 'starred-thumb-edge');
    svg.appendChild(line);
  }

  for (const point of layout.points) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(px(point.x)));
    circle.setAttribute('cy', String(py(point.depth)));
    circle.setAttribute('r', point.node.kind === 'split' ? '4.5' : '4');
    circle.setAttribute('class', `starred-thumb-node starred-thumb-${point.node.kind}`);
    svg.appendChild(circle);
  }

  return svg;
}

function hideRedundantToolbarButtons() {
  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar) return;

  for (const button of toolbar.querySelectorAll<HTMLButtonElement>('.ghost-button')) {
    const text = button.textContent?.trim().toLowerCase() ?? '';
    if (text.startsWith('undo') || text.startsWith('reset')) {
      button.hidden = true;
    }
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${WRAP_ID} {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .starred-tree-save,
    .starred-tree-open {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .starred-tree-icon {
      font-size: 15px;
      line-height: 1;
    }

    .starred-tree-count {
      min-width: 17px;
      height: 17px;
      padding: 0 5px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #fff7df;
      color: #9a6700;
      font-size: 9px;
      font-weight: 900;
      line-height: 1;
    }

    .starred-tree-gallery {
      position: absolute;
      z-index: 1200;
      top: calc(100% + 9px);
      right: 0;
      width: min(790px, calc(100vw - 36px));
      max-height: min(650px, calc(100vh - 120px));
      overflow: hidden;
      padding: 13px;
      border: 1px solid #d7e1eb;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.20);
      backdrop-filter: blur(10px);
    }

    .starred-gallery-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 2px 3px 12px;
      border-bottom: 1px solid #edf2f7;
    }

    .starred-gallery-head-copy {
      display: grid;
      gap: 2px;
    }

    .starred-gallery-head-copy b {
      color: #1e293b;
      font-size: 14px;
    }

    .starred-gallery-head-copy span {
      color: #64748b;
      font-size: 10px;
      line-height: 1.35;
    }

    .starred-gallery-close {
      width: 29px;
      height: 29px;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      background: #f8fafc;
      color: #64748b;
      cursor: pointer;
      font-size: 17px;
      line-height: 1;
    }

    .starred-gallery-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      max-height: min(555px, calc(100vh - 205px));
      overflow-y: auto;
      padding: 12px 3px 3px;
      scrollbar-gutter: stable;
    }

    .starred-gallery-empty {
      grid-column: 1 / -1;
      display: grid;
      place-items: center;
      min-height: 170px;
      padding: 26px;
      border: 1px dashed #cbd5e1;
      border-radius: 13px;
      color: #94a3b8;
      text-align: center;
      font-size: 11px;
      line-height: 1.5;
    }

    .starred-tree-card {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid #dbe4ee;
      border-radius: 13px;
      background: #ffffff;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .starred-tree-card:hover {
      transform: translateY(-2px);
      border-color: #e4bb48;
      box-shadow: 0 12px 26px rgba(15, 23, 42, 0.11);
    }

    .starred-tree-card.current {
      border-color: #78a9d1;
      box-shadow: 0 0 0 2px rgba(0, 114, 178, 0.10), 0 8px 22px rgba(15, 23, 42, 0.08);
    }

    .starred-tree-visual {
      position: relative;
      height: 104px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-bottom: 1px solid #edf2f7;
      background: linear-gradient(180deg, #f8fbfe 0%, #ffffff 100%);
    }

    .starred-tree-thumbnail {
      width: 94%;
      height: 90px;
      overflow: visible;
    }

    .starred-thumb-edge {
      stroke: #9eb2c6;
      stroke-width: 2.3;
      stroke-linecap: round;
    }

    .starred-thumb-node {
      stroke: #ffffff;
      stroke-width: 1.6;
    }

    .starred-thumb-split { fill: #4b87b6; }
    .starred-thumb-leaf { fill: #6ca980; }
    .starred-thumb-choice { fill: #d49b2a; }

    .starred-tree-number,
    .starred-tree-current-badge {
      position: absolute;
      top: 8px;
      padding: 3px 6px;
      border-radius: 999px;
      font-size: 8px;
      font-weight: 900;
      letter-spacing: 0.02em;
    }

    .starred-tree-number {
      left: 8px;
      background: #fff7df;
      color: #956200;
    }

    .starred-tree-current-badge {
      right: 8px;
      background: #e8f3fb;
      color: #00679f;
    }

    .starred-tree-card-body {
      display: grid;
      gap: 7px;
      padding: 10px;
    }

    .starred-tree-name {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 4px 5px;
      margin: -4px -5px 0;
      background: transparent;
      color: #25364a;
      font: inherit;
      font-size: 11px;
      font-weight: 900;
      text-overflow: ellipsis;
    }

    .starred-tree-name:hover,
    .starred-tree-name:focus {
      outline: none;
      border-color: #cbd9e7;
      background: #f8fbfe;
    }

    .starred-tree-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .starred-tree-status {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 8px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .starred-tree-status.partial {
      background: #fff7df;
      color: #8a5a00;
    }

    .starred-tree-status.complete {
      background: #e9f7ee;
      color: #27733f;
    }

    .starred-tree-time {
      color: #94a3b8;
      font-size: 8px;
      font-weight: 750;
      white-space: nowrap;
    }

    .starred-tree-summary {
      min-height: 26px;
      color: #607086;
      font-size: 9px;
      font-weight: 750;
      line-height: 1.35;
    }

    .starred-tree-summary.partial {
      display: flex;
      align-items: center;
      color: #7c8796;
      font-weight: 800;
    }

    .starred-tree-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      opacity: 0.68;
      transition: opacity 0.15s ease;
    }

    .starred-tree-card:hover .starred-tree-actions,
    .starred-tree-card.current .starred-tree-actions {
      opacity: 1;
    }

    .starred-tree-open-card,
    .starred-tree-delete {
      min-height: 29px;
      border: 1px solid #dbe4ee;
      border-radius: 8px;
      background: #f8fbfe;
      color: #40546a;
      cursor: pointer;
      font-size: 9px;
      font-weight: 850;
    }

    .starred-tree-open-card:hover {
      border-color: #83b6d9;
      background: #eef7fd;
      color: #075f93;
    }

    .starred-tree-delete {
      width: 31px;
      background: white;
      color: #94a3b8;
      font-size: 14px;
    }

    .starred-tree-delete:hover {
      border-color: #fecaca;
      background: #fff7f7;
      color: #b42318;
    }

    @media (max-width: 980px) {
      .starred-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .starred-tree-gallery { width: min(560px, calc(100vw - 28px)); }
    }

    @media (max-width: 620px) {
      .starred-gallery-grid { grid-template-columns: 1fr; }
      .starred-tree-gallery { width: min(350px, calc(100vw - 22px)); }
    }
  `;
  document.head.appendChild(style);
}

function renderCard(tree: StarredTree, current: string | undefined): HTMLElement {
  const counts = nodeCounts(tree.snapshot.root);
  const complete = counts.open === 0;
  const card = document.createElement('article');
  card.className = `starred-tree-card ${tree.signature === current ? 'current' : ''}`;

  const visual = document.createElement('div');
  visual.className = 'starred-tree-visual';
  visual.appendChild(makeTreeThumbnail(tree));

  const number = document.createElement('span');
  number.className = 'starred-tree-number';
  number.textContent = `★ ${tree.id}`;
  visual.appendChild(number);

  if (tree.signature === current) {
    const badge = document.createElement('span');
    badge.className = 'starred-tree-current-badge';
    badge.textContent = 'Current';
    visual.appendChild(badge);
  }

  const body = document.createElement('div');
  body.className = 'starred-tree-card-body';

  const name = document.createElement('input');
  name.className = 'starred-tree-name';
  name.value = tree.label;
  name.title = 'Click to rename';
  name.maxLength = 60;
  name.addEventListener('click', (event) => event.stopPropagation());
  name.addEventListener('input', () => renameStar(tree.id, name.value));
  name.addEventListener('blur', () => {
    if (!name.value.trim()) {
      tree.label = `Tree ${tree.id}`;
      name.value = tree.label;
    } else {
      tree.label = name.value.trim();
      name.value = tree.label;
    }
  });

  const statusRow = document.createElement('div');
  statusRow.className = 'starred-tree-status-row';

  const status = document.createElement('span');
  status.className = `starred-tree-status ${complete ? 'complete' : 'partial'}`;
  status.textContent = complete ? 'Complete' : 'Partial';

  const time = document.createElement('span');
  time.className = 'starred-tree-time';
  time.textContent = formatSavedTime(tree.savedAt);
  statusRow.append(status, time);

  const summary = document.createElement('div');
  summary.className = `starred-tree-summary ${complete ? 'complete' : 'partial'}`;
  if (complete) {
    const accuracy = tree.accuracy ? `Accuracy ${tree.accuracy}` : 'Complete tree';
    summary.textContent = `${accuracy} · ${counts.leaves} ${counts.leaves === 1 ? 'leaf' : 'leaves'}`;
  } else {
    summary.textContent = 'Partial';
  }

  const actions = document.createElement('div');
  actions.className = 'starred-tree-actions';

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'starred-tree-open-card';
  restore.textContent = tree.signature === current ? 'Currently open' : 'Open tree';
  restore.disabled = tree.signature === current;
  restore.addEventListener('click', () => restoreStar(tree));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'starred-tree-delete';
  remove.title = `Delete ${tree.label}`;
  remove.textContent = '×';
  remove.addEventListener('click', () => removeStar(tree.id));

  actions.append(restore, remove);
  body.append(name, statusRow, summary, actions);
  card.append(visual, body);
  return card;
}

function render() {
  injectStyles();
  hideRedundantToolbarButtons();

  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar) return;

  let wrap = document.getElementById(WRAP_ID);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    toolbar.prepend(wrap);
  }

  wrap.replaceChildren();

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'ghost-button starred-tree-save';
  save.innerHTML = '<span class="starred-tree-icon">☆</span> Star';
  save.title = 'Save the exact current partial or completed tree';
  save.addEventListener('click', (event) => {
    event.stopPropagation();
    starCurrentTree();
  });
  wrap.appendChild(save);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'ghost-button starred-tree-open';
  openButton.innerHTML = `<span class="starred-tree-icon">★</span> Favorites <span class="starred-tree-count">${starred.length}</span>`;
  openButton.title = 'Browse starred trees';
  openButton.addEventListener('click', (event) => {
    event.stopPropagation();
    open = !open;
    render();
  });
  wrap.appendChild(openButton);

  if (!open) return;

  const gallery = document.createElement('div');
  gallery.className = 'starred-tree-gallery';
  gallery.addEventListener('click', (event) => event.stopPropagation());

  const head = document.createElement('div');
  head.className = 'starred-gallery-head';

  const copy = document.createElement('div');
  copy.className = 'starred-gallery-head-copy';
  const title = document.createElement('b');
  title.textContent = 'Favorite trees';
  const subtitle = document.createElement('span');
  subtitle.textContent = 'Save different directions, name them, and jump between them whenever you want.';
  copy.append(title, subtitle);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'starred-gallery-close';
  close.textContent = '×';
  close.title = 'Close favorites';
  close.addEventListener('click', () => {
    open = false;
    render();
  });
  head.append(copy, close);

  const grid = document.createElement('div');
  grid.className = 'starred-gallery-grid';

  if (starred.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'starred-gallery-empty';
    empty.textContent = 'No favorites yet. Star the current tree, explore another branch, and come back here when you want to compare directions.';
    grid.appendChild(empty);
  } else {
    const current = currentSignature();
    for (const tree of [...starred].reverse()) {
      grid.appendChild(renderCard(tree, current));
    }
  }

  gallery.append(head, grid);
  wrap.appendChild(gallery);
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (open && !target.closest(`#${WRAP_ID}`)) {
    open = false;
    requestAnimationFrame(render);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && open) {
    open = false;
    render();
  }
});

document.addEventListener(
  'change',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') {
      starred = [];
      nextStarId = 1;
      open = false;
      requestAnimationFrame(render);
    }
  },
  true,
);

const observer = new MutationObserver(() => {
  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar) return;
  hideRedundantToolbarButtons();
  if (!document.getElementById(WRAP_ID)) render();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

render();
