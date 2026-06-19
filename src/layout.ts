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

const NODE_WIDTH = 178;
const NODE_Y_GAP = 142;
const SIBLING_GAP = 90;

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

    edges.push({ id: `${node.uid}-${node.left.uid}`,  source: node.uid, target: node.left.uid,  label: 'T' });
    edges.push({ id: `${node.uid}-${node.right.uid}`, source: node.uid, target: node.right.uid, label: 'F' });

    place(node.left,  depth + 1, boxLeft,                   widths, pos, edges);
    place(node.right, depth + 1, boxLeft + lw + SIBLING_GAP, widths, pos, edges);
    return;
  }

  if (node.left) {
    edges.push({ id: `${node.uid}-${node.left.uid}`, source: node.uid, target: node.left.uid, label: 'T' });
    const lw = widths.get(node.left.uid)!;
    const childBoxLeft = boxLeft + (w - lw) / 2;
    place(node.left, depth + 1, childBoxLeft, widths, pos, edges);
    return;
  }

  if (node.right) {
    edges.push({ id: `${node.uid}-${node.right.uid}`, source: node.uid, target: node.right!.uid, label: 'F' });
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