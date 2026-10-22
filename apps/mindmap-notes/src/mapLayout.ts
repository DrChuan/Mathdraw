import type { MindmapDocument, MindmapNode } from "./types";
import { rootOf } from "./outline";
export interface NodeSize {
  width: number;
  height: number;
}
const colors = [
  "#558b7c",
  "#8183ba",
  "#bd8e60",
  "#6b9ab2",
  "#b77791",
  "#8f9b62",
];
// Coordinates use the top-left corner; subtrees are centered on each parent's actual height.
export function rightLayout(
  doc: MindmapDocument,
  sizes: Map<string, NodeSize>,
) {
  const children = new Map<string, MindmapNode[]>();
  for (const n of doc.nodes)
    if (n.parentId) {
      const siblings = children.get(n.parentId) ?? [];
      siblings.push(n);
      children.set(n.parentId, siblings);
    }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const size = (n: MindmapNode): NodeSize => {
    const measured = sizes.get(n.id);
    if (measured) return measured;
    const hasImage = /!\[[^\]]*\]\(data:image\//.test(n.text);
    const lines = n.text
      .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, "图片")
      .split("\n")
      .map((line) =>
        [...line].reduce(
          (sum, char) => sum + (char.charCodeAt(0) > 255 ? 14 : 8),
          0,
        ),
      );
    const width = Math.max(
      104,
      Math.min(
        600,
        lines.reduce((longest, length) => Math.max(longest, length), 0) + 32,
      ),
    );
    return {
      width,
      height: Math.max(
        40,
        18 +
          (hasImage ? 260 : 0) +
          lines.reduce(
            (sum, length) =>
              sum + Math.max(1, Math.ceil(length / (width - 32))) * 24,
            0,
          ),
      ),
    };
  };
  const heights = new Map<string, number>();
  const gap = 18;
  const kidsOf = (n: MindmapNode) =>
    n.collapsed ? [] : (children.get(n.id) ?? []);
  const height = (n: MindmapNode): number => {
    if (heights.has(n.id)) return heights.get(n.id)!;
    const kids = kidsOf(n);
    const h = Math.max(
      size(n).height,
      kids.reduce((sum, k) => sum + height(k), 0) +
        Math.max(0, kids.length - 1) * gap,
    );
    heights.set(n.id, h);
    return h;
  };
  const result = new Map<string, { x: number; y: number; color: string }>();
  const root = rootOf(doc);
  const place = (n: MindmapNode, x: number, center: number, color: string) => {
    if (n.position) {
      x = n.position.x;
      center = n.position.y + size(n).height / 2;
    }
    result.set(n.id, { x, y: center - size(n).height / 2, color });
    const kids = kidsOf(n);
    const total =
      kids.reduce((sum, k) => sum + height(k), 0) +
      Math.max(0, kids.length - 1) * gap;
    let top = center - total / 2;
    kids.forEach((k, i) => {
      const h = height(k);
      place(
        k,
        x + size(n).width + 64,
        top + h / 2,
        n.id === root.id ? colors[i % colors.length] : color,
      );
      top += h + gap;
    });
  };
  place(root, 0, size(root).height / 2, "#335f51");
  return result;
}
