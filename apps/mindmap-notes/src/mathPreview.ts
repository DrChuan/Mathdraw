import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import katex from "katex";
export function mathPreviewIssue(source: string): string | null {
  const ast = unified().use(remarkParse).use(remarkMath).parse(source);
  let issue: string | null = null;
  const visit = (node: {
    type: string;
    value?: string;
    children?: typeof ast.children;
    position?: { start: { offset?: number }; end: { offset?: number } };
  }) => {
    if (issue) return;
    if (node.type === "math" || node.type === "inlineMath") {
      try {
        katex.renderToString(node.value ?? "", {
          throwOnError: true,
          strict: false,
          trust: false,
          displayMode: node.type === "math",
        });
      } catch {
        issue = "公式尚未完成或语法有误，源码仍会保留。";
      }
    } else if (node.type === "text") {
      const raw = source.slice(
        node.position?.start.offset,
        node.position?.end.offset,
      );
      if (/(?<!\\)\$/.test(raw)) issue = "公式分隔符尚未闭合，可继续输入。";
    }
    node.children?.forEach(visit);
  };
  visit(ast);
  return issue;
}
