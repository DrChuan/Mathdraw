import { describe, expect, it } from "vitest";
import {
  branchIds,
  extractBranch,
  insertBranch,
  moveBranch,
  outlineToForest,
  removeBranch,
  findNodes,
  revealNode,
  translateBranch,
  validateDocument,
} from "./branches";
import { childrenOf, markdownToMap, rootOf } from "./outline";
import { rightLayout } from "./mapLayout";
const fixture = () =>
  markdownToMap(
    "# 根\n## A\n- 公式 $a^2=b^2+c^2-2bc\\cos A$\n- 孙节点\n## B\n- 待查找",
    "test",
  );
describe("branch operations", () => {
  it("copies a whole collapsed branch with fresh IDs and exact math source", () => {
    const source = fixture(),
      a = source.nodes.find((n) => n.text === "A")!;
    a.collapsed = true;
    a.position = { x: 800, y: 300 };
    const snapshot = extractBranch(source, a.id),
      target = markdownToMap("# 目标");
    const result = insertBranch(target, rootOf(target).id, snapshot);
    expect(result.doc.nodes).toHaveLength(4);
    expect(
      result.doc.nodes.find((n) => n.id === result.firstId)?.collapsed,
    ).toBe(true);
    expect(
      result.doc.nodes.every(
        (n) => !snapshot.nodes.some((old) => old.id === n.id),
      ),
    ).toBe(true);
    expect(result.doc.nodes.some((n) => n.text.includes("2bc\\cos A"))).toBe(
      true,
    );
    expect(result.doc.nodes.every((n) => !n.position)).toBe(true);
    expect(source.nodes).toHaveLength(6);
  });
  it("pastes a plain multiline block as one node", () => {
    const forest = outlineToForest("第一行\n\n$$\\frac{1}{2}$$");
    expect(forest.roots).toHaveLength(1);
    expect(forest.nodes[0].text).toBe("第一行\n\n$$\\frac{1}{2}$$");
  });
  it("pastes headings and lists without a synthetic wrapper", () => {
    for (const text of ["# A\n- 子节点\n# B", "- A\n  - 子节点\n- B"]) {
      const forest = outlineToForest(text);
      expect(
        forest.roots.map((id) => forest.nodes.find((n) => n.id === id)?.text),
      ).toEqual(["A", "B"]);
      expect(forest.nodes).toHaveLength(3);
    }
  });
  it("rejects empty, oversized, or malformed clipboard branches", () => {
    expect(() => outlineToForest("  ")).toThrow();
    expect(() => outlineToForest("x".repeat(8 * 1024 * 1024 + 1))).toThrow(
      /8 MB/,
    );
    const doc = fixture();
    expect(() =>
      insertBranch(doc, rootOf(doc).id, {
        roots: ["x"],
        nodes: [
          { id: "x", parentId: null, text: "x", order: 0, collapsed: false },
          { id: "x", parentId: null, text: "y", order: 0, collapsed: false },
        ],
      }),
    ).toThrow(/重复/);
  });
  it("reparents a branch, preserves IDs, expands target and leaves unrelated positions", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!,
      b = doc.nodes.find((n) => n.text === "B")!;
    b.collapsed = true;
    b.position = { x: 1000, y: 400 };
    const ids = branchIds(doc, a.id);
    doc.nodes
      .filter((n) => ids.has(n.id))
      .forEach((n) => (n.position = { x: 20, y: 30 }));
    const next = moveBranch(doc, a.id, b.id, "inside");
    expect(next.nodes.find((n) => n.id === a.id)?.parentId).toBe(b.id);
    expect(next.nodes.find((n) => n.id === b.id)).toMatchObject({
      collapsed: false,
      position: { x: 1000, y: 400 },
    });
    expect(
      next.nodes.filter((n) => ids.has(n.id)).every((n) => !n.position),
    ).toBe(true);
    expect(doc.nodes.find((n) => n.id === a.id)?.parentId).toBe(rootOf(doc).id);
  });
  it("reorders siblings and normalizes old and new sibling orders", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!,
      b = doc.nodes.find((n) => n.text === "B")!;
    const next = moveBranch(doc, b.id, a.id, "before");
    expect(
      childrenOf(next.nodes, rootOf(next).id).map((n) => [n.text, n.order]),
    ).toEqual([
      ["B", 0],
      ["A", 1],
    ]);
    const removed = removeBranch(next, b.id);
    expect(childrenOf(removed.nodes, rootOf(removed).id)[0].order).toBe(0);
  });
  it("rejects root moves, cycles, missing targets and excessive depth atomically", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!,
      child = childrenOf(doc.nodes, a.id)[0];
    const original = JSON.stringify(doc);
    for (const [id, target, placement] of [
      [rootOf(doc).id, a.id, "inside"],
      [a.id, child.id, "inside"],
      [a.id, a.id, "inside"],
      [a.id, rootOf(doc).id, "before"],
      [a.id, "missing", "inside"],
    ] as const)
      expect(() => moveBranch(doc, id, target, placement)).toThrow();
    expect(JSON.stringify(doc)).toBe(original);
    const deep = markdownToMap("# deep");
    let parent = rootOf(deep).id;
    for (let i = 0; i < 128; i++) {
      const id = `d${i}`;
      deep.nodes.push({
        id,
        parentId: parent,
        text: id,
        order: 0,
        collapsed: false,
      });
      parent = id;
    }
    expect(() => insertBranch(deep, parent, extractBranch(doc, a.id))).toThrow(
      /过深/,
    );
  });
  it("enforces 5000-node and file-size limits before applying", () => {
    const doc = markdownToMap("# root"),
      root = rootOf(doc);
    for (let i = 0; i < 4999; i++)
      doc.nodes.push({
        id: `n${i}`,
        parentId: root.id,
        text: "n",
        order: i,
        collapsed: false,
      });
    expect(() => insertBranch(doc, root.id, outlineToForest("one"))).toThrow(
      /5000/,
    );
    expect(doc.nodes).toHaveLength(5000);
    expect(() =>
      validateDocument({
        ...doc,
        nodes: [{ ...root, text: "中".repeat(3 * 1024 * 1024) }],
      }),
    ).toThrow(/8 MB/);
  });
  it("translates the whole branch without changing hierarchy", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!;
    const positions = new Map(
      doc.nodes.map((n, i) => [n.id, { x: i * 10, y: i * 20 }]),
    );
    const moved = translateBranch(doc, a.id, 100, 200, positions),
      ids = branchIds(doc, a.id);
    for (const n of moved.nodes)
      if (ids.has(n.id))
        expect(n.position).toEqual({
          x: positions.get(n.id)!.x + 100,
          y: positions.get(n.id)!.y + 200,
        });
    expect(rootOf(moved).position).toBeUndefined();
  });
  it("searches hidden formula source in tree order and reveals only ancestors", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!;
    a.collapsed = true;
    const ids = findNodes(doc, "COS A");
    expect(ids).toHaveLength(1);
    const next = revealNode(doc, ids[0]);
    expect(next.nodes.find((n) => n.id === a.id)?.collapsed).toBe(false);
    expect(a.collapsed).toBe(true);
    expect(findNodes(doc, "不存在")).toEqual([]);
  });
  it("lays out children relative to a manually positioned parent", () => {
    const doc = fixture(),
      a = doc.nodes.find((n) => n.text === "A")!;
    a.position = { x: 1000, y: 400 };
    const sizes = new Map(
      doc.nodes.map((n) => [n.id, { width: 200, height: 60 }]),
    );
    const positions = rightLayout(doc, sizes);
    expect(positions.get(a.id)).toMatchObject({ x: 1000, y: 400 });
    expect(positions.get(childrenOf(doc.nodes, a.id)[0].id)?.x).toBe(1264);
    expect(
      (positions.get(childrenOf(doc.nodes, a.id)[0].id)!.y +
        positions.get(childrenOf(doc.nodes, a.id)[1].id)!.y) /
        2,
    ).toBe(400);
  });
});
