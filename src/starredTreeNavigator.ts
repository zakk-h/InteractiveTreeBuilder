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
  type?: { name?: string } | ((...args: unknown[]) => unknown) | string | null;
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

function nodeCounts(root: BuildNodeLike): {
  total: number;
  splits: number;
  leaves: number;
  open: number;
} {
  let total = 0;
  let splits = 0;
  let leaves = 0;
  let openNodes = 0;

  const walk = (node?: BuildNodeLike) => {
    if (!node) return;
    total += 1;
    if (node.kind === 'split') splits += 1;
    else if (node.kind === 'leaf') leaves += 1;
    else openNodes += 1;
    walk(node.left);
    walk(node.right);
  };

  walk(root);
  return { total, splits, leaves, open: openNodes };
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
  requestAnimationFrame(render);
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
  const label = counts.open === 0 ? `Tree ${nextStarId}` : `Partial tree ${nextStarId}`;

  starred.push({
    id: nextStarId,
    label,
    snapshot,
    signature,
  });
  nextStarId += 1;
  render();
}

function removeStar(id: number) {
  starred = starred.filter((x) => x.id !== id);
  render();
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

    .starred-tree-popover {
      position: absolute;
      z-index: 1000;
      top: calc(100% + 7px);
      left: 0;
      width: 292px;
      max-height: 360px;
      overflow-y: auto;
      padding: 8px;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      background: white;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
    }

    .starred-tree-title {
      padding: 4px 5px 7px;
      color: #64748b;
      font-size: 10px;
      font-weight: 850;
    }

    .starred-tree-empty {
      padding: 10px 8px;
      color: #94a3b8;
      font-size: 10px;
      line-height: 1.4;
    }

    .starred-tree-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: stretch;
      gap: 5px;
      margin-top: 5px;
    }

    .starred-tree-restore {
      min-width: 0;
      display: grid;
      gap: 3px;
      padding: 9px 10px;
      border: 1px solid #e1e8f0;
      border-radius: 9px;
      background: #fbfdff;
      color: #334155;
      text-align: left;
      cursor: pointer;
    }

    .starred-tree-restore:hover {
      border-color: #f1c75b;
      background: #fffdf7;
    }

    .starred-tree-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 900;
    }

    .starred-tree-meta {
      color: #64748b;
      font-size: 9px;
      font-weight: 700;
    }

    .starred-tree-remove {
      width: 30px;
      border: 1px solid #e1e8f0;
      border-radius: 9px;
      background: white;
      color: #94a3b8;
      cursor: pointer;
      font-size: 16px;
    }

    .starred-tree-remove:hover {
      color: #b42318;
      border-color: #fecaca;
      background: #fff7f7;
    }
  `;
  document.head.appendChild(style);
}

function render() {
  injectStyles();

  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar) return;

  let wrap = document.getElementById(WRAP_ID);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    const undo = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('.ghost-button')).find(
      (button) => button.textContent?.trim().toLowerCase().startsWith('undo'),
    );
    if (undo) undo.insertAdjacentElement('afterend', wrap);
    else toolbar.prepend(wrap);
  }

  wrap.replaceChildren();

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'ghost-button starred-tree-save';
  save.innerHTML = '<span class="starred-tree-icon">☆</span> Star';
  save.title = 'Save the current partial or completed tree';
  save.addEventListener('click', (event) => {
    event.stopPropagation();
    starCurrentTree();
  });
  wrap.appendChild(save);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'ghost-button starred-tree-open';
  openButton.innerHTML = `<span class="starred-tree-icon">★</span><span class="starred-tree-count">${starred.length}</span>`;
  openButton.title = 'Open starred trees';
  openButton.addEventListener('click', (event) => {
    event.stopPropagation();
    open = !open;
    render();
  });
  wrap.appendChild(openButton);

  if (!open) return;

  const popover = document.createElement('div');
  popover.className = 'starred-tree-popover';
  popover.addEventListener('click', (event) => event.stopPropagation());

  const title = document.createElement('div');
  title.className = 'starred-tree-title';
  title.textContent = 'Starred trees and partial trees';
  popover.appendChild(title);

  if (starred.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'starred-tree-empty';
    empty.textContent = 'Star the current tree, explore another direction, then come back here to restore it.';
    popover.appendChild(empty);
  }

  for (const tree of [...starred].reverse()) {
    const counts = nodeCounts(tree.snapshot.root);
    const row = document.createElement('div');
    row.className = 'starred-tree-item';

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'starred-tree-restore';

    const label = document.createElement('span');
    label.className = 'starred-tree-label';
    label.textContent = tree.label;

    const meta = document.createElement('span');
    meta.className = 'starred-tree-meta';
    meta.textContent =
      counts.open === 0
        ? `complete · ${counts.splits} splits · ${counts.leaves} leaves`
        : `partial · ${counts.splits} splits · ${counts.open} open nodes`;

    restore.append(label, meta);
    restore.addEventListener('click', () => restoreStar(tree));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'starred-tree-remove';
    remove.title = `Remove ${tree.label}`;
    remove.textContent = '×';
    remove.addEventListener('click', () => removeStar(tree.id));

    row.append(restore, remove);
    popover.appendChild(row);
  }

  wrap.appendChild(popover);
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
  if (document.querySelector('.toolbar-row') && !document.getElementById(WRAP_ID)) {
    render();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

render();
