import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useViewport } from "@xyflow/react";
import Markdown from "./Markdown";
import { mathPreviewIssue } from "./mathPreview";
import type { CursorFormula } from "./formulaAtCursor";
export default function FormulaPreview({
  formula,
  anchor,
}: {
  formula: CursorFormula;
  anchor: HTMLElement | null;
}) {
  const [latex, setLatex] = useState(formula.latex),
    card = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ left: 0, top: 0 });
  const viewport = useViewport();
  useEffect(() => {
    const timer = setTimeout(() => setLatex(formula.latex), 120);
    return () => clearTimeout(timer);
  }, [formula.latex]);
  const source = formula.display ? `$$\n${latex}\n$$` : `$${latex}$`;
  const issue = useMemo(() => mathPreviewIssue(source), [source]);
  const place = useCallback(() => {
    if (!anchor || !card.current) return;
    const rect = anchor.getBoundingClientRect(),
      { width, height } = card.current.getBoundingClientRect();
    const next = {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(
        8,
        rect.bottom + height + 12 < window.innerHeight
          ? rect.bottom + 8
          : rect.top - height - 8,
      ),
    };
    setPoint((old) =>
      JSON.stringify(old) === JSON.stringify(next) ? old : next,
    );
  }, [anchor, viewport]);
  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(place);
    if (card.current) observer.observe(card.current);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place, anchor]);
  return createPortal(
    <div
      ref={card}
      className="formula-preview"
      role="region"
      aria-label="当前公式预览"
      tabIndex={-1}
      style={point}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="formula-preview-heading">
        公式预览{!formula.complete && <span>尚未闭合</span>}
      </div>
      <div className="formula-preview-math">
        <Markdown text={source} compact />
      </div>
      {issue && (
        <div className="math-preview-issue" role="status">
          {issue}
        </div>
      )}
    </div>,
    document.body,
  );
}
