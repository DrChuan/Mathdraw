import { describe, expect, it } from "vitest";
import { formulaAtCursor } from "./formulaAtCursor";

describe("formula at editing cursor", () => {
  it("only shows the formula containing the cursor", () => {
    const source = "文字 $a^2+b^2=c^2$ 后文 $x+y$";
    expect(formulaAtCursor(source, 1)).toBeNull();
    expect(formulaAtCursor(source, 7)?.latex).toBe("a^2+b^2=c^2");
    expect(formulaAtCursor(source, source.indexOf(" 后文"))).toBeNull();
    expect(formulaAtCursor(source, source.indexOf("x+y") + 1)?.latex).toBe(
      "x+y",
    );
    expect(formulaAtCursor(source, source.length)).toBeNull();
  });
  it("supports block and unfinished formulas", () => {
    expect(formulaAtCursor("前文 $$\\int_0^1 x dx$$", 10)).toMatchObject({
      latex: "\\int_0^1 x dx",
      display: true,
      complete: true,
    });
    expect(formulaAtCursor("文字 $a^", 6)).toMatchObject({
      latex: "a^",
      display: false,
      complete: false,
    });
  });
  it("ignores escaped dollars and code", () => {
    expect(formulaAtCursor("\\$a$", 2)).toBeNull();
    expect(formulaAtCursor("`$a$`", 3)).toBeNull();
    expect(formulaAtCursor("```\n$a$\n```", 6)).toBeNull();
    expect(formulaAtCursor("`$a$` $b$", 8)?.latex).toBe("b");
    expect(formulaAtCursor("$a\\$b$", 3)?.latex).toBe("a\\$b");
  });
  it("does not preview a selection crossing formula boundaries", () => {
    expect(formulaAtCursor("文字 $x$ 后文", 4, 8)).toBeNull();
    expect(formulaAtCursor("文字 $x$ 后文", 4, 5)?.latex).toBe("x");
  });
});
