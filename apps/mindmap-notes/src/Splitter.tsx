import { useRef } from "react";

export default function Splitter({
  label,
  value,
  min,
  max,
  reset,
  onChange,
  percent = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  reset: number;
  onChange: (value: number) => void;
  percent?: boolean;
}) {
  const drag = useRef<{ x: number; value: number; scale: number } | null>(null);
  const update = (next: number) =>
    onChange(Math.round(Math.max(min, Math.min(max, next))));
  return (
    <div
      className="pane-splitter"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      title="拖动调整宽度，双击恢复默认；方向键微调"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          value,
          scale: percent
            ? (e.currentTarget.parentElement?.clientWidth ?? 100) / 100
            : 1,
        };
        document.body.classList.add("resizing-pane");
      }}
      onPointerMove={(e) => {
        if (drag.current)
          update(
            drag.current.value +
              (e.clientX - drag.current.x) / drag.current.scale,
          );
      }}
      onPointerUp={(e) => {
        drag.current = null;
        document.body.classList.remove("resizing-pane");
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        document.body.classList.remove("resizing-pane");
      }}
      onDoubleClick={() => update(reset)}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        update(
          e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : value +
                (e.key === "ArrowLeft" ? -1 : 1) *
                  (percent ? 2 : e.shiftKey ? 30 : 10),
        );
      }}
    />
  );
}
