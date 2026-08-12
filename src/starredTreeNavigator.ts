const STYLE_ID = 'arborenum-starred-trees-style';
const WRAP_ID = 'arborenum-starred-trees-wrap';
const OVERLAY_ID = 'arborenum-starred-trees-overlay';

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
    if (row.querySelector('span')?.textContent?.trim().toLowerCase() === 'accuracy') {
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
  closeGallery();
  afterReactPaint(renderToolbar);
}

function starCurrentTree() {
  const bridge = currentBridge();
  if (!bridge) return;

  const snapshot = cloneSnapshot(bridge.snapshot);
  const signature = treeSignature(snapshot);
  const existing = starred.find((x) => x.signature === signature);

  if (!existing) {
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
  }

  openGallery();
}

function removeStar(id: number) {
  starred = starred.filter((x) => x.id !== id);
  renderToolbar();
  renderGallery();
}

function renameStar(id: number, label: string) {
  const tree = starred.find((x) => x.id === id);
  if (tree) tree.label = label.slice(0, 60);
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

    if (children.length === 0) {
      const point = { node, x: leafX++, depth };
      points.push(point);
      return point;
    }

    const childPoints = children.map((child) => visit(child, depth + 1));
    const point = {
      node,
      x: childPoints.reduce((sum, p) => sum + p.x, 0) / childPoints.length,
      depth,
    };
    points.push(point);
    childPoints.forEach((child) => edges.push([point, child]));
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
  svg.setAttribute('viewBox', '0 0 220 104');
  svg.setAttribute('class', 'starred-tree-thumbnail');
  svg.setAttribute('aria-hidden', 'true');

  const layout = thumbnailLayout(tree.snapshot.root);
  const px = (x: number) => 18 + (184 * x) / layout.maxX;
  const py = (depth: number) => 14 + (76 * depth) / layout.maxDepth;

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
    circle.setAttribute('r', point.node.kind === 'split' ? '4.6' : '4.1');
    circle.setAttribute('class', `starred-thumb-node starred-thumb-${point.node.kind}`);
    svg.appendChild(circle);
  }

  return svg;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The original first two direct toolbar buttons are Undo and Reset. */
    .toolbar-row > button.ghost-button:nth-of-type(1),
    .toolbar-row > button.ghost-button:nth-of-type(2) {
      display: none !important;
    }

    #${WRAP_ID} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
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
      background: #fff4cf;
      color: #8b5d00;
      font-size: 9px;
      font-weight: 900;
      line-height: 1;
    }

    .starred-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
      background: rgba(15, 23, 42, 0.34);
      backdrop-filter: blur(4px);
    }

    .starred-gallery {
      width: min(980px, calc(100vw - 56px));
      max-height: min(760px, calc(100vh - 56px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #d7e1eb;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 28px 90px rgba(15, 23, 42, 0.28);
    }

    .starred-gallery-head {
      flex: 0 0 auto;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 20px 16px;
      border-bottom: 1px solid #e8eef5;
    }

    .starred-gallery-head-copy {
      display: grid;
      gap: 4px;
    }

    .starred-gallery-head-copy b {
      color: #17263a;
      font-size: 18px;
    }

    .starred-gallery-head-copy span {
      color: #66788d;
      font-size: 11px;
      line-height: 1.4;
    }

    .starred-gallery-close {
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      border: 1px solid #dbe4ee;
      border-radius: 10px;
      background: #f7f9fc;
      color: #607086;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }

    .starred-gallery-grid {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-content: start;
      gap: 14px;
      overflow-y: auto;
      padding: 18px 20px 22px;
      background: #f7f9fc;
      scrollbar-gutter: stable;
    }

    .starred-gallery-empty {
      grid-column: 1 / -1;
      min-height: 290px;
      display: grid;
      place-items: center;
      padding: 30px;
      border: 1px dashed #bfd0df;
      border-radius: 15px;
      background: #ffffff;
      color: #8a9bae;
      text-align: center;
      font-size: 12px;
      line-height: 1.55;
    }

    .starred-tree-card {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 1px solid #d8e3ed;
      border-radius: 15px;
      background: #ffffff;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
      transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
    }

    .starred-tree-card:hover {
      transform: translateY(-3px);
      border-color: #dfb43d;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.13);
    }

    .starred-tree-card.current {
      border-color: #5c9dcc;
      box-shadow: 0 0 0 2px rgba(0, 114, 178, 0.10), 0 9px 25px rgba(15, 23, 42, 0.08);
    }

    .starred-tree-visual {
      position: relative;
      height: 122px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border-bottom: 1px solid #eaf0f5;
      background: linear-gradient(180deg, #f5f9fc 0%, #ffffff 100%);
    }

    .starred-tree-thumbnail {
      width: 94%;
      height: 104px;
      overflow: visible;
    }

    .starred-thumb-edge {
      stroke: #9fb3c7;
      stroke-width: 2.3;
      stroke-linecap: round;
    }

    .starred-thumb-node {
      stroke: #ffffff;
      stroke-width: 1.6;
    }

    .starred-thumb-split { fill: #4f8bb8; }
    .starred-thumb-leaf { fill: #67a77d; }
    .starred-thumb-choice { fill: #d49a26; }

    .starred-tree-number,
    .starred-tree-current-badge {
      position: absolute;
      top: 9px;
      padding: 4px 7px;
      border-radius: 999px;
      font-size: 8px;
      font-weight: 900;
      letter-spacing: 0.02em;
    }

    .starred-tree-number {
      left: 9px;
      background: #fff4cf;
      color: #855800;
    }

    .starred-tree-current-badge {
      right: 9px;
      background: #e4f1fa;
      color: #00679d;
    }

    .starred-tree-card-body {
      display: grid;
      gap: 9px;
      padding: 12px;
    }

    .starred-tree-name {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 5px 6px;
      margin: -5px -6px 0;
      background: transparent;
      color: #25364a;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      text-overflow: ellipsis;
    }

    .starred-tree-name:hover,
    .starred-tree-name:focus {
      outline: none;
      border-color: #cbd9e7;
      background: #f7fafc;
    }

    .starred-tree-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .starred-tree-status {
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 8px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .starred-tree-status.partial {
      background: #fff4cf;
      color: #855800;
    }

    .starred-tree-status.complete {
      background: #e7f6ec;
      color: #24713c;
    }

    .starred-tree-time {
      color: #99a7b6;
      font-size: 8px;
      font-weight: 750;
      white-space: nowrap;
    }

    .starred-tree-summary {
      min-height: 30px;
      color: #5f7185;
      font-size: 10px;
      font-weight: 750;
      line-height: 1.4;
    }

    .starred-tree-summary.partial {
      display: flex;
      align-items: center;
      color: #7d8997;
      font-weight: 850;
    }

    .starred-tree-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 7px;
      opacity: 0.72;
      transition: opacity 0.16s ease;
    }

    .starred-tree-card:hover .starred-tree-actions,
    .starred-tree-card.current .starred-tree-actions {
      opacity: 1;
    }

    .starred-tree-open-card,
    .starred-tree-delete {
      min-height: 32px;
      border: 1px solid #d7e2ec;
      border-radius: 9px;
      background: #f7fafc;
      color: #40546a;
      cursor: pointer;
      font-size: 9px;
      font-weight: 850;
    }

    .starred-tree-open-card:hover:not(:disabled) {
      border-color: #79add2;
      background: #edf7fd;
      color: #075f93;
    }

    .starred-tree-open-card:disabled {
      cursor: default;
      color: #6f8398;
      background: #f2f6f9;
    }

    .starred-tree-delete {
      width: 34px;
      background: #ffffff;
      color: #98a5b3;
      font-size: 15px;
    }

    .starred-tree-delete:hover {
      border-color: #fecaca;
      background: #fff6f6;
      color: #b42318;
    }

    @media (max-width: 900px) {
      .starred-gallery-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 600px) {
      .starred-overlay { padding: 12px; }
      .starred-gallery { width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
      .starred-gallery-grid { grid-template-columns: 1fr; padding: 12px; }
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
  name.addEventListener('input', () => renameStar(tree.id, name.value));
  name.addEventListener('blur', () => {
    tree.label = name.value.trim() || `Tree ${tree.id}`;
    name.value = tree.label;
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
    const accuracy = tree.accuracy ? `Accuracy ${tree.accuracy}` : 'Complete';
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

function closeGallery() {
  open = false;
  document.getElementById(OVERLAY_ID)?.remove();
}

function openGallery() {
  open = true;
  renderGallery();
}

function renderGallery() {
  document.getElementById(OVERLAY_ID)?.remove();
  if (!open) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'starred-overlay';
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeGallery();
  });

  const gallery = document.createElement('section');
  gallery.className = 'starred-gallery';

  const head = document.createElement('div');
  head.className = 'starred-gallery-head';

  const copy = document.createElement('div');
  copy.className = 'starred-gallery-head-copy';
  const title = document.createElement('b');
  title.textContent = `Favorite trees${starred.length ? ` (${starred.length})` : ''}`;
  const subtitle = document.createElement('span');
  subtitle.textContent = 'Save different directions, rename them, and jump between partial or completed trees.';
  copy.append(title, subtitle);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'starred-gallery-close';
  close.textContent = '×';
  close.title = 'Close favorites';
  close.addEventListener('click', closeGallery);
  head.append(copy, close);

  const grid = document.createElement('div');
  grid.className = 'starred-gallery-grid';

  if (starred.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'starred-gallery-empty';
    empty.textContent = 'No favorites yet. Close this window, build or modify a tree, and press ☆ Star when you want to save that exact state.';
    grid.appendChild(empty);
  } else {
    const current = currentSignature();
    for (const tree of [...starred].reverse()) {
      grid.appendChild(renderCard(tree, current));
    }
  }

  gallery.append(head, grid);
  overlay.appendChild(gallery);
  document.body.appendChild(overlay);
}

function renderToolbar() {
  injectStyles();

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
  save.addEventListener('click', starCurrentTree);

  const favorites = document.createElement('button');
  favorites.type = 'button';
  favorites.className = 'ghost-button starred-tree-open';
  favorites.innerHTML = `<span class="starred-tree-icon">★</span> Favorites <span class="starred-tree-count">${starred.length}</span>`;
  favorites.title = 'Browse favorite trees';
  favorites.addEventListener('click', () => {
    if (open) closeGallery();
    else openGallery();
  });

  wrap.append(save, favorites);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && open) closeGallery();
});

document.addEventListener(
  'change',
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') {
      starred = [];
      nextStarId = 1;
      closeGallery();
      requestAnimationFrame(renderToolbar);
    }
  },
  true,
);

const observer = new MutationObserver(() => {
  if (document.querySelector('.toolbar-row') && !document.getElementById(WRAP_ID)) {
    renderToolbar();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

renderToolbar();
