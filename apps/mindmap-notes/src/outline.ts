import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import type { RootContent, List, Heading, Paragraph, ListItem } from "mdast";
import type { MindmapDocument, MindmapNode } from "./types";
const uid = () => crypto.randomUUID();
export const childrenOf = (nodes: MindmapNode[], id: string) =>
  nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order);
export const rootOf = (doc: MindmapDocument) =>
  doc.nodes.find((n) => n.parentId === null)!;
export function emptyMap(title = "新的想法"): MindmapDocument {
  return {
    schemaVersion: 1,
    id: uid(),
    nodes: [
      { id: uid(), parentId: null, text: title, order: 0, collapsed: false },
    ],
  };
}
export function parseMap(raw: string): MindmapDocument {
  const doc = JSON.parse(raw) as MindmapDocument;
  if (
    doc.schemaVersion !== 1 ||
    !Array.isArray(doc.nodes) ||
    !doc.nodes.length ||
    doc.nodes.length > 5000 ||
    typeof doc.id !== "string"
  )
    throw new Error("不支持的思维导图格式");
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    if (
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      typeof n.text !== "string" ||
      !Number.isFinite(n.order) ||
      typeof n.collapsed !== "boolean" ||
      !(n.parentId === null || typeof n.parentId === "string")
    )
      throw new Error("节点内容或 ID 无效");
    if (
      n.position &&
      (!Number.isFinite(n.position.x) || !Number.isFinite(n.position.y))
    )
      throw new Error("节点位置无效");
    ids.add(n.id);
  }
  const roots = doc.nodes.filter((n) => n.parentId === null);
  if (
    roots.length !== 1 ||
    doc.nodes.some((n) => n.parentId !== null && !ids.has(n.parentId))
  )
    throw new Error("导图必须有一个中心主题，且所有节点都连接到父节点");
  const children = new Map<string, string[]>();
  for (const n of doc.nodes)
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  const visited = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth > 128 || visited.has(id))
      throw new Error("导图层级过深或存在循环");
    visited.add(id);
    (children.get(id) ?? []).forEach((child) => walk(child, depth + 1));
  };
  walk(roots[0].id, 0);
  if (visited.size !== doc.nodes.length)
    throw new Error("导图包含循环或断开的节点");
  return doc;
}
export function markdownToMap(
  source: string,
  fallbackTitle = "未命名导图",
  options: { virtualRoot?: boolean } = {},
): MindmapDocument {
  const doc = emptyMap(fallbackTitle);
  const root = rootOf(doc);
  const ast = unified().use(remarkParse).use(remarkMath).parse(source);
  const raw = (node: {
    position?: {
      start: { offset?: number; column?: number };
      end: { offset?: number };
    };
  }) => {
    const lines = source
      .slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
      .split("\n");
    const indent = Math.max(0, (node.position?.start.column ?? 1) - 1);
    return lines
      .map((line, i) =>
        i ? line.replace(new RegExp(`^ {0,${indent}}`), "") : line,
      )
      .join("\n");
  };
  const inline = (node: Heading | Paragraph) => {
    const first = node.children[0],
      last = node.children.at(-1);
    return first && last
      ? raw({
          position: {
            start: {
              ...first.position?.start,
              column: node.position?.start.column,
            },
            end: last.position?.end ?? { offset: 0 },
          },
        })
      : "";
  };
  const add = (text: string, parentId: string) => {
    const node: MindmapNode = {
      id: uid(),
      parentId,
      order: childrenOf(doc.nodes, parentId).length,
      text: text.trim() || "空节点",
      collapsed: false,
    };
    doc.nodes.push(node);
    return node;
  };
  const list = (block: List, parentId: string) => {
    for (const item of block.children) {
      addItem(item, parentId);
    }
  };
  const addItem = (item: ListItem, parentId: string) => {
    const blocks = item.children.filter((n) => n.type !== "list");
    // Remove structural indentation, while preserving LaTeX and inline Markdown verbatim.
    const text = blocks
      .map((b) => (b.type === "paragraph" ? inline(b) : raw(b)))
      .join("\n\n");
    const node = add(text, parentId);
    item.children
      .filter((n): n is List => n.type === "list")
      .forEach((b) => list(b, node.id));
  };
  let blocks = [...ast.children] as RootContent[];
  const headingStack: { depth: number; id: string }[] = [];
  if (
    !options.virtualRoot &&
    blocks[0]?.type === "heading" &&
    blocks[0].depth === 1
  ) {
    root.text = inline(blocks[0]);
    headingStack.push({ depth: 1, id: root.id });
    blocks = blocks.slice(1);
  } else if (
    !options.virtualRoot &&
    blocks.length === 1 &&
    blocks[0].type === "list" &&
    blocks[0].children.length === 1
  ) {
    const item = blocks[0].children[0];
    root.text = item.children
      .filter((n) => n.type !== "list")
      .map((n) => (n.type === "paragraph" ? inline(n) : raw(n)))
      .join("\n\n");
    item.children
      .filter((n): n is List => n.type === "list")
      .forEach((b) => list(b, root.id));
    return parseMap(JSON.stringify(doc));
  }
  for (const block of blocks) {
    if (block.type === "heading") {
      while (headingStack.length && headingStack.at(-1)!.depth >= block.depth)
        headingStack.pop();
      const node = add(inline(block), headingStack.at(-1)?.id ?? root.id);
      headingStack.push({ depth: block.depth, id: node.id });
    } else if (block.type === "list")
      list(block, headingStack.at(-1)?.id ?? root.id);
    else if (block.type !== "definition") {
      const target = headingStack.at(-1);
      if (target) {
        const node = doc.nodes.find((n) => n.id === target.id)!;
        node.text += "\n\n" + raw(block);
      } else add(raw(block), root.id);
    }
  }
  if (doc.nodes.length > 5000)
    throw new Error("单篇思维导图最多支持 5000 个节点");
  return parseMap(JSON.stringify(doc));
}
export function mapToMarkdown(doc: MindmapDocument): string {
  const root = rootOf(doc),
    lines = root.text.split("\n");
  const out = [
    `# ${lines[0] || "未命名导图"}`,
    ...(lines.length > 1 ? ["", ...lines.slice(1)] : []),
    "",
  ];
  const walk = (id: string, depth: number) => {
    for (const node of childrenOf(doc.nodes, id)) {
      const indent = "  ".repeat(depth);
      const text = node.text.split("\n");
      out.push(`${indent}- ${text[0]}`);
      for (const line of text.slice(1)) out.push(`${indent}  ${line}`);
      walk(node.id, depth + 1);
    }
  };
  walk(root.id, 0);
  return out.join("\n") + "\n";
}
export function applyOutline(
  doc: MindmapDocument,
  source: string,
): MindmapDocument {
  const next = markdownToMap(source, rootOf(doc).text);
  const oldPaths = new Map<string, MindmapNode>();
  const index = (nodes: MindmapNode[], id: string, path: string) => {
    oldPaths.set(path, nodes.find((n) => n.id === id)!);
    childrenOf(nodes, id).forEach((n, i) => index(nodes, n.id, `${path}/${i}`));
  };
  index(doc.nodes, rootOf(doc).id, "root");
  const ids = new Map<string, string>();
  const set = (id: string, path: string) => {
    ids.set(id, oldPaths.get(path)?.id ?? id);
    childrenOf(next.nodes, id).forEach((n, i) => set(n.id, `${path}/${i}`));
  };
  set(rootOf(next).id, "root");
  return {
    schemaVersion: 1,
    id: doc.id,
    nodes: next.nodes.map((n) => ({
      ...n,
      id: ids.get(n.id)!,
      parentId: n.parentId ? ids.get(n.parentId)! : null,
    })),
  };
}
export function deleteBranch(
  doc: MindmapDocument,
  id: string,
): MindmapDocument {
  if (rootOf(doc).id === id) return doc;
  const ids = new Set<string>();
  const collect = (key: string) => {
    ids.add(key);
    childrenOf(doc.nodes, key).forEach((n) => collect(n.id));
  };
  collect(id);
  return { ...doc, nodes: doc.nodes.filter((n) => !ids.has(n.id)) };
}
