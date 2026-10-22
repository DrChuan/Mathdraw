import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./Markdown";
describe("safe local Markdown and math rendering", () => {
  it("renders inline and display formulas from their original LaTeX", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"$E=mc^2$\n\n$$\n\\frac{1}{3}\n$$"} />,
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).toContain("E=mc^2");
  });
  it("retains invalid formulas as readable editable source", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"$\\definitelyUnsupported{x}$"} />,
    );
    expect(html).toContain("#cc0000");
    expect(html).toContain("definitelyUnsupported");
    expect(html).toContain("application/x-tex");
  });
  it("does not execute HTML or fetch remote note images", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={
          "<script>alert(1)</script>\n\n![private](https://example.invalid/pixel)\n\n[bad](javascript:alert(1))"
        }
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });
});
