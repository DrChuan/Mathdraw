import type { MindmapDocument, MindmapNode } from "./types";
import {
  childrenOf,
  mapToMarkdown,
  markdownToMap,
  parseMap,
  rootOf,
} from "./outline";
import { unified } from "unified";
import remarkParse from "remark-parse";
export const MAX_NOTE_BYTES = 8 * 1024 * 1024;
export interface BranchSnapshot {
  roots: string[];
  nodes: MindmapNode[];
}
export type Placement = "before" | "inside" | "after";
export function validateDocument(doc: MindmapDocument) {
  const raw = JSON.stringify(doc);
  if (new TextEncoder().encode(raw).length > MAX_NOTE_BYTES)
    throw new Error("笔记超过 8 MB，操作未应用");
  parseMap(raw);
  return doc;
}
export function branchIds(doc: MindmapDocument, id: string): Set<string> {
  if (!doc.nodes.some((n) => n.id === id)) throw new Error("节点已不存在");
  const children = new Map<string, string[]>();
  for (const n of doc.nodes)
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  const ids = new Set<string>(),
    pending = [id];
  while (pending.length) {
    const key = pending.pop()!;
    if (ids.has(key)) continue;
    ids.add(key);
    pending.push(...(children.get(key) ?? []));
  }
  return ids;
}
export function extractBranch(
  doc: MindmapDocument,
  id: string,
): BranchSnapshot {
  const ids = branchIds(doc, id);
  return {
    roots: [id],
    nodes: doc.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => ({
        ...n,
        parentId: n.id === id ? null : n.parentId,
        order: n.id === id ? 0 : n.order,
        position: undefined,
      })),
  };
}
export function branchMarkdown(snapshot: BranchSnapshot) {
  return snapshot.roots
    .map((id) => {
      const virtual: MindmapDocument = {
        schemaVersion: 1,
        id: "clipboard",
        nodes: snapshot.nodes,
      };
      return mapToMarkdown({
        ...virtual,
        nodes: extractBranch(virtual, id).nodes,
      });
    })
    .join("\n");
}
export function outlineToForest(source: string): BranchSnapshot {
  if (new TextEncoder().encode(source).length > MAX_NOTE_BYTES)
    throw new Error("剪贴板内容超过 8 MB");
  if (!source.trim()) throw new Error("剪贴板没有可粘贴的文字");
  const ast = unified().use(remarkParse).parse(source);
  if (!ast.children.some((n) => n.type === "heading" || n.type === "list")) {
    const id = crypto.randomUUID();
    return {
      roots: [id],
      nodes: [
        { id, parentId: null, order: 0, text: source.trim(), collapsed: false },
      ],
    };
  }
  const doc = markdownToMap(source, "", { virtualRoot: true }),
    root = rootOf(doc);
  const roots = childrenOf(doc.nodes, root.id).map((n) => n.id);
  return {
    roots,
    nodes: doc.nodes
      .filter((n) => n.id !== root.id)
      .map((n) => ({
        ...n,
        parentId: n.parentId === root.id ? null : n.parentId,
      })),
  };
}
export function insertBranch(
  doc: MindmapDocument,
  parentId: string,
  snapshot: BranchSnapshot,
) {
  if (!doc.nodes.some((n) => n.id === parentId))
    throw new Error("目标节点已不存在");
  if (!snapshot.roots.length || snapshot.nodes.length + doc.nodes.length > 5000)
    throw new Error("单篇导图最多支持 5000 个节点");
  const ids = new Map(snapshot.nodes.map((n) => [n.id, crypto.randomUUID()]));
  if (ids.size !== snapshot.nodes.length) throw new Error("分支节点 ID 重复");
  const roots = new Set(snapshot.roots),
    offset = childrenOf(doc.nodes, parentId).length;
  const added = snapshot.nodes.map((n) => ({
    ...n,
    id: ids.get(n.id)!,
    parentId: roots.has(n.id)
      ? parentId
      : (ids.get(n.parentId!) ?? "missing-parent"),
    order: roots.has(n.id) ? offset + snapshot.roots.indexOf(n.id) : n.order,
    position: undefined,
  }));
  return {
    doc: validateDocument({
      ...doc,
      nodes: normalized([
        ...doc.nodes.map((n) =>
          n.id === parentId ? { ...n, collapsed: false } : n,
        ),
        ...added,
      ]),
    }),
    firstId: ids.get(snapshot.roots[0])!,
  };
}
function normalized(nodes: MindmapNode[]) {
  const groups = new Map<string | null, MindmapNode[]>();
  for (const n of nodes) {
    const group = groups.get(n.parentId) ?? [];
    group.push(n);
    groups.set(n.parentId, group);
  }
  const order = new Map<string, number>();
  for (const group of groups.values())
    group
      .sort((a, b) => a.order - b.order)
      .forEach((n, i) => order.set(n.id, i));
  return nodes.map((n) => ({ ...n, order: order.get(n.id)! }));
}
export function moveBranch(
  doc: MindmapDocument,
  id: string,
  targetId: string,
  placement: Placement,
) {
  const source = doc.nodes.find((n) => n.id === id),
    target = doc.nodes.find((n) => n.id === targetId);
  if (!source || !target) throw new Error("节点已不存在");
  if (source.parentId === null)
    throw new Error("根主题不能调整层级，可按 Alt 自由移动");
  const ids = branchIds(doc, id);
  if (ids.has(targetId)) throw new Error("不能移动到自身或自己的子分支");
  if (target.parentId === null && placement !== "inside")
    throw new Error("根主题不能有同级节点");
  const parentId = placement === "inside" ? targetId : target.parentId!;
  const siblings = childrenOf(doc.nodes, parentId)
    .filter((n) => n.id !== id)
    .map((n) => n.id);
  const index =
    placement === "inside"
      ? siblings.length
      : siblings.indexOf(targetId) + (placement === "after" ? 1 : 0);
  siblings.splice(index, 0, id);
  return validateDocument({
    ...doc,
    nodes: normalized(
      doc.nodes.map((n) => {
        if (n.id === id)
          return { ...n, parentId, order: index, position: undefined };
        return {
          ...n,
          ...(n.parentId === parentId ? { order: siblings.indexOf(n.id) } : {}),
          ...(n.id === parentId ? { collapsed: false } : {}),
          ...(ids.has(n.id) ? { position: undefined } : {}),
        };
      }),
    ),
  });
}
export function removeBranch(doc: MindmapDocument, id: string) {
  if (rootOf(doc).id === id) throw new Error("不能删除根主题");
  const ids = branchIds(doc, id);
  return validateDocument({
    ...doc,
    nodes: normalized(doc.nodes.filter((n) => !ids.has(n.id))),
  });
}
export function translateBranch(
  doc: MindmapDocument,
  id: string,
  dx: number,
  dy: number,
  positions: Map<string, { x: number; y: number }>,
) {
  const ids = branchIds(doc, id);
  return validateDocument({
    ...doc,
    nodes: doc.nodes.map((n) => {
      const p = positions.get(n.id) ?? n.position;
      return ids.has(n.id) && p
        ? { ...n, position: { x: p.x + dx, y: p.y + dy } }
        : n;
    }),
  });
}
export function findNodes(doc: MindmapDocument, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const children = new Map<string, MindmapNode[]>();
  for (const n of doc.nodes)
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const result: string[] = [];
  const visit = (n: MindmapNode) => {
    if (n.text.toLowerCase().includes(q)) result.push(n.id);
    children.get(n.id)?.forEach(visit);
  };
  visit(rootOf(doc));
  return result;
}
export function revealNode(doc: MindmapDocument, id: string) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n])),
    ancestors = new Set<string>();
  let n = byId.get(id);
  while (n?.parentId) {
    ancestors.add(n.parentId);
    n = byId.get(n.parentId);
  }
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      ancestors.has(n.id) && n.collapsed ? { ...n, collapsed: false } : n,
    ),
  };
}
