import { describe, expect, it } from "vitest";
import { copyBranch, readBranch } from "./branchClipboard";
import { markdownToMap, rootOf } from "./outline";
import type { ClipboardAdapter } from "./types";
describe("system branch clipboard", () => {
  it("writes readable Markdown and retains exact snapshot while text matches", async () => {
    let text = "";
    const adapter: ClipboardAdapter = {
      readText: async () => text,
      writeText: async (value) => {
        text = value;
      },
    };
    const doc = markdownToMap("# root\n- $E=mc^2$");
    rootOf(doc).collapsed = true;
    await copyBranch(doc, rootOf(doc).id, adapter);
    expect(text).toContain("# root");
    expect(text).toContain("$E=mc^2$");
    expect((await readBranch(adapter)).nodes[0].collapsed).toBe(true);
    text = "- 外部 A\n- 外部 B";
    expect((await readBranch(adapter)).roots).toHaveLength(2);
  });
  it("propagates clipboard failure without mutating the source", async () => {
    const doc = markdownToMap("# source\n- child"),
      before = JSON.stringify(doc);
    await expect(
      copyBranch(doc, rootOf(doc).id, {
        readText: async () => "",
        writeText: async () => {
          throw new Error("clipboard busy");
        },
      }),
    ).rejects.toThrow("clipboard busy");
    expect(JSON.stringify(doc)).toBe(before);
  });
});
