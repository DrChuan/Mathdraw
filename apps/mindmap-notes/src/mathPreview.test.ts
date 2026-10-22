import { describe, expect, it } from "vitest";
import { mathPreviewIssue } from "./mathPreview";
describe("math preview hints", () => {
  it("accepts inline, display, long and mixed formulas", () => {
    expect(
      mathPreviewIssue(
        "余弦定理 $a^2=b^2+c^2-2bc\\cos A$\n\n$$\\int_0^1 x^2 dx=\\frac13$$",
      ),
    ).toBeNull();
  });
  it("reports invalid or incomplete formulas without throwing", () => {
    expect(mathPreviewIssue("$\\unknowncommand{x}$")).toContain("语法");
    expect(mathPreviewIssue("$\\frac{1}{")).toContain("闭合");
  });
  it("does not mistake escaped dollars and code for incomplete formulas", () => {
    expect(
      mathPreviewIssue("价格 \\$5，代码 `$x`\n\n```tex\n$x\n```"),
    ).toBeNull();
  });
});
