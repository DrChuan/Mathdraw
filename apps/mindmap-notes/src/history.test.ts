import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./history";
describe("per-document bounded history", () => {
  it("retains cut undo while switching documents", () => {
    const h = new DocumentHistory();
    h.activate("a", "whole");
    h.record("cut");
    h.activate("b", "b");
    h.record("pasted");
    h.activate("a", "cut");
    expect(h.undo()).toBe("whole");
    expect(h.redo()).toBe("cut");
    h.activate("b", "pasted");
    expect(h.undo()).toBe("b");
  });
  it("invalidates only the externally changed document", () => {
    const h = new DocumentHistory();
    h.activate("a", "0");
    h.record("1");
    h.activate("b", "0");
    h.record("1");
    h.activate("a", "external");
    expect(h.canUndo).toBe(false);
    h.activate("b", "1");
    expect(h.canUndo).toBe(true);
  });
  it("groups continuous editing and preserves redo when applying undo text", () => {
    const h = new DocumentHistory();
    h.activate("a", "start");
    h.record("a");
    h.record("ab", false);
    h.record("abc", false);
    const text = h.undo()!;
    expect(text).toBe("start");
    h.record(text, false);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe("abc");
  });
  it("limits each document to 100 undo steps", () => {
    const h = new DocumentHistory();
    h.activate("a", "0");
    for (let i = 1; i <= 110; i++) h.record(String(i));
    let count = 0;
    while (h.undo() !== undefined) count++;
    expect(count).toBe(100);
  });
  it("evicts old history and inactive heads under the global byte budget", () => {
    const h = new DocumentHistory(32);
    h.activate("a", "12345678");
    h.record("abcdefgh");
    h.activate("b", "12345678");
    h.record("abcdefgh");
    h.activate("c", "12345678");
    expect(h.bytes).toBeLessThanOrEqual(32);
    expect(h.canUndo).toBe(false);
    h.clear();
    expect(h.bytes).toBe(0);
  });
});
