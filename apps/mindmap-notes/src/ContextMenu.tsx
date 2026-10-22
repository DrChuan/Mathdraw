import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
export interface MenuAction {
  label: string;
  run: () => void;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}
export default function ContextMenu({
  x,
  y,
  actions,
  close,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  close: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const [point, setPoint] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect();
    setPoint({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    const dismiss = () => close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      if (
        document.activeElement === document.body &&
        previousFocus.current instanceof HTMLElement &&
        previousFocus.current.isConnected
      )
        previousFocus.current.focus();
    };
  }, [close]);
  return (
    <div
      ref={menu}
      role="menu"
      className="context-menu"
      style={{ left: point.x, top: point.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const buttons = [
            ...menu.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
          ]?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <div
          key={action.label}
          className={action.separator ? "menu-group-start" : undefined}
        >
          <button
            role="menuitem"
            disabled={action.disabled}
            className={action.danger ? "text-danger" : ""}
            onClick={() => {
              close();
              action.run();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
            {action.shortcut && <kbd>{action.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
