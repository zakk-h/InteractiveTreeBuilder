import type { BuildNode } from './types';

export type LayoutNode = BuildNode & {
  x: number;
  y: number;
};

export type LayoutEdge = {
  id: string;
  source: number;
  target: number;
  label: string;
};

const NODE_WIDTH = 420;
const NODE_Y_GAP = 220;
const SIBLING_GAP = 0;

function measure(node: BuildNode, cache: Map<number, number>): number {
  const cached = cache.get(node.uid);
  if (cached !== undefined) return cached;

  let w: number;
  if (!node.left && !node.right) {
    w = NODE_WIDTH;
  } else if (node.left && node.right) {
    w = measure(node.left, cache) + SIBLING_GAP + measure(node.right, cache);
  } else if (node.left) {
    w = Math.max(NODE_WIDTH, measure(node.left, cache));
  } else {
    w = Math.max(NODE_WIDTH, measure(node.right!, cache));
  }

  cache.set(node.uid, w);
  return w;
}

function place(
  node: BuildNode,
  depth: number,
  boxLeft: number,
  widths: Map<number, number>,
  pos: Map<number, { centerX: number; y: number }>,
  edges: LayoutEdge[],
): void {
  const w = widths.get(node.uid)!;
  const centerX = boxLeft + w / 2;
  pos.set(node.uid, { centerX, y: depth * NODE_Y_GAP });

  if (node.left && node.right) {
    const lw = widths.get(node.left.uid)!;
    const rw = widths.get(node.right.uid)!;

    edges.push({
      id: `${node.uid}-${node.left.uid}`,
      source: node.uid,
      target: node.left.uid,
      label: depth === 0 ? 'T' : '',
    });
    edges.push({
      id: `${node.uid}-${node.right.uid}`,
      source: node.uid,
      target: node.right.uid,
      label: depth === 0 ? 'F' : '',
    });

    place(node.left,  depth + 1, boxLeft,                   widths, pos, edges);
    place(node.right, depth + 1, boxLeft + lw + SIBLING_GAP, widths, pos, edges);
    return;
  }

  if (node.left) {
    edges.push({
      id: `${node.uid}-${node.left.uid}`,
      source: node.uid,
      target: node.left.uid,
      label: depth === 0 ? 'T' : '',
    });
    const lw = widths.get(node.left.uid)!;
    const childBoxLeft = boxLeft + (w - lw) / 2;
    place(node.left, depth + 1, childBoxLeft, widths, pos, edges);
    return;
  }

  if (node.right) {
    edges.push({
      id: `${node.uid}-${node.right.uid}`,
      source: node.uid,
      target: node.right!.uid,
      label: depth === 0 ? 'F' : '',
    });
    const rw = widths.get(node.right!.uid)!;
    const childBoxLeft = boxLeft + (w - rw) / 2;
    place(node.right!, depth + 1, childBoxLeft, widths, pos, edges);
  }
}

export function layoutTree(root: BuildNode): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
} {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const pos = new Map<number, { centerX: number; y: number }>();
  const widths = new Map<number, number>();

  measure(root, widths);
  place(root, 0, 0, widths, pos, edges);

  function isTerminal(node?: BuildNode): boolean {
    return !!node && !node.left && !node.right;
  }

  function pullTerminalChildrenIn(node: BuildNode) {
    const parent = pos.get(node.uid);
    if (!parent) return;

    const terminalOffset = NODE_WIDTH * 0.42;

    if (isTerminal(node.left)) {
      const child = pos.get(node.left!.uid);
      if (child) child.centerX = parent.centerX - terminalOffset;
    }

    if (isTerminal(node.right)) {
      const child = pos.get(node.right!.uid);
      if (child) child.centerX = parent.centerX + terminalOffset;
    }

    if (node.left) pullTerminalChildrenIn(node.left);
    if (node.right) pullTerminalChildrenIn(node.right);
  }

  function shiftSubtree(node: BuildNode, dx: number) {
    const p = pos.get(node.uid);
    if (p) p.centerX += dx;
    if (node.left) shiftSubtree(node.left, dx);
    if (node.right) shiftSubtree(node.right, dx);
  }

  function enforceSiblingMinimums(node: BuildNode) {
    if (node.left) enforceSiblingMinimums(node.left);
    if (node.right) enforceSiblingMinimums(node.right);

    if (!node.left || !node.right) return;

    const left = pos.get(node.left.uid);
    const right = pos.get(node.right.uid);
    if (!left || !right) return;

    const minCenterGap = NODE_WIDTH * 1.12;
    const currentGap = right.centerX - left.centerX;

    if (currentGap >= minCenterGap) return;

    const extra = minCenterGap - currentGap;
    shiftSubtree(node.left, -extra / 2);
    shiftSubtree(node.right, extra / 2);
  }

  pullTerminalChildrenIn(root);
  enforceSiblingMinimums(root);

  function collect(node: BuildNode) {
    const p = pos.get(node.uid);
    if (!p) return;
    nodes.push({ ...node, x: p.centerX - NODE_WIDTH / 2, y: p.y });
    if (node.left)  collect(node.left);
    if (node.right) collect(node.right);
  }

  collect(root);

  if (nodes.length > 0) {
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
    const midX = 0.5 * (minX + maxX);
    for (const n of nodes) n.x -= midX;
  }

  return { nodes, edges };
}