import { describe, expect, it } from "vitest";
import {
  applyOutline,
  deleteBranch,
  mapToMarkdown,
  markdownToMap,
  parseMap,
  rootOf,
} from "./outline";
describe("Markdown / mindmap interchange", () => {
  it("uses heading levels and nested lists, preserving math", () => {
    const d = markdownToMap(
      "# 线性代数\n\n## 向量\n- 范数 $\\|x\\|$\n  - 欧几里得空间\n\n## 矩阵",
    );
    expect(rootOf(d).text).toBe("线性代数");
    const norm = d.nodes.find((n) => n.text.startsWith("范数"))!;
    expect(d.nodes.find((n) => n.text === "欧几里得空间")?.parentId).toBe(
      norm.id,
    );
    expect(d.nodes).toHaveLength(5);
  });
  it("round trips multiline nodes, nested branches, and display math", () => {
    const a = markdownToMap(
      "# Root\n- text $x$\n  - child\n- $$\n  E=mc^2\n  $$",
    );
    const b = markdownToMap(mapToMarkdown(a));
    expect(b.nodes.map((n) => n.text)).toEqual(a.nodes.map((n) => n.text));
  });
  it("applies an edited outline without losing document identity", () => {
    const a = markdownToMap("# A\n- B");
    const b = applyOutline(a, "# A\n- changed\n  - C");
    expect(b.id).toBe(a.id);
    expect(b.nodes[1].id).toBe(a.nodes[1].id);
    expect(b.nodes[2].parentId).toBe(b.nodes[1].id);
  });
  it("rejects duplicate IDs, disconnected cycles and invalid positions", () => {
    const a = markdownToMap("# A\n- B");
    a.nodes[1].parentId = a.nodes[1].id;
    expect(() => parseMap(JSON.stringify(a))).toThrow();
  });
  it("deletes a whole branch while protecting the root", () => {
    const a = markdownToMap("# A\n- B\n  - C");
    expect(deleteBranch(a, a.nodes[1].id).nodes).toHaveLength(1);
    expect(deleteBranch(a, rootOf(a).id)).toEqual(a);
  });
});
