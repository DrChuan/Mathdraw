import { unified } from "unified";
import remarkParse from "remark-parse";
export interface CursorFormula {
  start: number;
  end: number;
  latex: string;
  display: boolean;
  complete: boolean;
}
/** Only the active dollar-delimited formula is previewed; code and escaped dollars are literal. */
export function formulaAtCursor(
  source: string,
  caret: number,
  selectionEnd = caret,
): CursorFormula | null {
  const ast = unified().use(remarkParse).parse(source);
  const ignored: { start: number; end: number }[] = [];
  const visit = (n: {
    type: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: typeof ast.children;
  }) => {
    if (n.type === "code" || n.type === "inlineCode") {
      ignored.push({
        start: n.position?.start.offset ?? 0,
        end: n.position?.end.offset ?? 0,
      });
      return;
    }
    n.children?.forEach(visit);
  };
  visit(ast);
  const excluded = (i: number) =>
    ignored.find((range) => i >= range.start && i < range.end);
  const escaped = (i: number) => {
    let count = 0;
    while (i > 0 && source[--i] === "\\") count++;
    return count % 2 === 1;
  };
  for (let i = 0; i < source.length; i++) {
    const code = excluded(i);
    if (code) {
      i = code.end - 1;
      continue;
    }
    if (source[i] !== "$" || escaped(i)) continue;
    const start = i;
    let length = 1;
    while (source[i + length] === "$") length++;
    let close = -1;
    for (let j = i + length; j < source.length; j++) {
      const code = excluded(j);
      if (code) {
        j = code.end - 1;
        continue;
      }
      if (source[j] !== "$" || escaped(j)) continue;
      let run = 1;
      while (source[j + run] === "$") run++;
      if (run === length) {
        close = j;
        break;
      }
      j += run - 1;
    }
    const contentEnd = close < 0 ? source.length : close;
    if (caret >= start + length && selectionEnd <= contentEnd)
      return {
        start,
        end: close < 0 ? source.length : close + length,
        latex: source.slice(start + length, contentEnd),
        display: length >= 2,
        complete: close >= 0,
      };
    if (close < 0) return null;
    i = close + length - 1;
  }
  return null;
}
