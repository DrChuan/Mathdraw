import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Network,
  Plus,
  FoldVertical,
} from "lucide-react";
import type { NoteFormat, VaultEntry } from "./types";
const parent = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const title = (entry: VaultEntry) =>
  entry.kind === "folder"
    ? entry.name
    : entry.name.replace(/\.mindmap\.json$|\.md$/i, "");
export type InlineEdit =
  | { kind: "create"; dir: string; format: NoteFormat | "folder" }
  | { kind: "rename"; entry: VaultEntry };
interface Props {
  entries: VaultEntry[];
  activePath?: string;
  selection: { path: string } | null;
  folder: string | null;
  enabled: boolean;
  collapsed: Set<string>;
  setCollapsed: (next: Set<string>) => void;
  inline: InlineEdit | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  onOpen: (entry: VaultEntry) => void;
  onFolder: (path: string) => void;
  onCreate: (dir: string, format: NoteFormat | "folder") => void;
  onRename: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
  onMenu: (event: MouseEvent, entry?: VaultEntry) => void;
  onMove: (entry: VaultEntry, dir: string) => void;
}
export default function FileExplorer(props: Props) {
  const { entries, collapsed, setCollapsed, inline } = props;
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [dragged, setDragged] = useState<VaultEntry | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const inlineDir = inline
    ? inline.kind === "create"
      ? inline.dir
      : parent(inline.entry.path)
    : null;
  useEffect(() => {
    if (props.folder !== null) setSelected(props.folder);
  }, [props.folder]);
  useEffect(() => {
    if (props.activePath) setSelected(props.activePath);
  }, [props.activePath]);
  useEffect(() => {
    if (props.selection) setSelected(props.selection.path);
  }, [props.selection]);
  useEffect(() => {
    if (selected && !entries.some((entry) => entry.path === selected))
      setSelected(props.activePath ?? props.folder ?? "");
  }, [entries, selected, props.activePath, props.folder]);
  useEffect(() => {
    if (document.activeElement === tree.current)
      document
        .getElementById(
          selected ? `tree-${encodeURIComponent(selected)}` : "tree-root",
        )
        ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    if (!inline) return;
    setName(
      inline.kind === "rename"
        ? title(inline.entry)
        : inline.format === "folder"
          ? "未命名文件夹"
          : "未命名笔记",
    );
    const next = new Set(collapsed);
    for (const path of next)
      if (inlineDir === path || inlineDir?.startsWith(path + "/"))
        next.delete(path);
    if (next.size !== collapsed.size) setCollapsed(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
      input.current?.scrollIntoView({ block: "nearest" });
    });
  }, [inline]);
  const rows = useMemo(() => {
    const children = new Map<string, VaultEntry[]>();
    for (const e of entries) {
      const list = children.get(parent(e.path)) ?? [];
      list.push(e);
      children.set(parent(e.path), list);
    }
    for (const list of children.values())
      list.sort(
        (a, b) =>
          Number(b.kind === "folder") - Number(a.kind === "folder") ||
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
      );
    const result: { entry: VaultEntry; depth: number }[] = [];
    const visit = (path: string, depth: number) => {
      for (const entry of children.get(path) ?? []) {
        result.push({ entry, depth });
        if (entry.kind === "folder" && !collapsed.has(entry.path))
          visit(entry.path, depth + 1);
      }
    };
    visit("", 1);
    return result;
  }, [entries, collapsed]);
  const toggle = (path: string, open?: boolean) => {
    const next = new Set(collapsed);
    if (open ?? next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };
  const currentDir =
    entries.find((e) => e.path === selected)?.kind === "folder"
      ? selected
      : selected
        ? parent(selected)
        : (props.folder ?? "");
  const editor = (depth: number) => (
    <form
      className="tree-inline"
      style={{ paddingLeft: 10 + depth * 15 }}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (!props.busy && name.trim()) props.onSubmit(name.trim());
      }}
    >
      <input
        ref={input}
        aria-label={
          inline?.kind === "rename"
            ? "重命名文件或文件夹"
            : "新建文件或文件夹名称"
        }
        value={name}
        disabled={props.busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !props.busy) {
            props.onCancel();
            tree.current?.focus();
          }
        }}
      />
      <button
        type="submit"
        disabled={props.busy || !name.trim()}
        title="确认名称"
      >
        ↵
      </button>
      <button
        type="button"
        disabled={props.busy}
        onClick={props.onCancel}
        title="取消"
      >
        ×
      </button>
      {props.error && <span role="alert">{props.error}</span>}
    </form>
  );
  const dropProps = (dir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (
        !dragged ||
        dragged.path === dir ||
        dir.startsWith(dragged.path + "/") ||
        parent(dragged.path) === dir
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDrop(dir);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        dragged &&
        dragged.path !== dir &&
        !dir.startsWith(dragged.path + "/") &&
        parent(dragged.path) !== dir
      ) {
        props.onMove(dragged, dir);
        toggle(dir, true);
      }
      setDragged(null);
      setDrop(null);
    },
  });
  return (
    <>
      <div className="section-label explorer-heading">
        <span>文件</span>
        <div>
          <button
            disabled={!props.enabled}
            title="新建 Markdown 笔记"
            aria-label="新建 Markdown 笔记"
            onClick={() => props.onCreate(currentDir, "markdown")}
          >
            <Plus size={15} />
          </button>
          <button
            disabled={!props.enabled}
            title="新建思维导图"
            aria-label="新建思维导图"
            onClick={() => props.onCreate(currentDir, "mindmap")}
          >
            <Network size={15} />
          </button>
          <button
            disabled={!props.enabled}
            title="新建文件夹"
            aria-label="新建文件夹"
            onClick={() => props.onCreate(currentDir, "folder")}
          >
            <FolderPlus size={15} />
          </button>
          <button
            title="折叠所有文件夹"
            aria-label="折叠所有文件夹"
            onClick={() =>
              setCollapsed(
                new Set(
                  entries.filter((e) => e.kind === "folder").map((e) => e.path),
                ),
              )
            }
          >
            <FoldVertical size={15} />
          </button>
        </div>
      </div>
      <div
        ref={tree}
        className="file-explorer"
        role="tree"
        aria-label="笔记库文件树"
        tabIndex={0}
        aria-activedescendant={
          selected ? `tree-${encodeURIComponent(selected)}` : "tree-root"
        }
        onContextMenu={(e) => {
          e.preventDefault();
          props.onMenu(e);
        }}
        onKeyDown={(e) => {
          if (inline || e.target instanceof HTMLInputElement) return;
          const entry = entries.find((n) => n.path === selected),
            index = rows.findIndex((n) => n.entry.path === selected);
          if (
            [
              "F2",
              "Delete",
              "Backspace",
              "Enter",
              "ArrowDown",
              "ArrowUp",
              "ArrowLeft",
              "ArrowRight",
            ].includes(e.key)
          )
            e.preventDefault();
          if (e.key === "F2" && entry) props.onRename(entry);
          else if (["Delete", "Backspace"].includes(e.key) && entry)
            props.onDelete(entry);
          else if (e.key === "Enter") {
            if (entry) {
              if (entry.kind === "folder") toggle(entry.path);
              props.onOpen(entry);
            }
          } else if (e.key === "ArrowDown")
            setSelected(
              rows[Math.min(rows.length - 1, index + 1)]?.entry.path ?? "",
            );
          else if (e.key === "ArrowUp")
            setSelected(index <= 0 ? "" : rows[index - 1].entry.path);
          else if (e.key === "ArrowRight" && entry?.kind === "folder")
            toggle(entry.path, true);
          else if (e.key === "ArrowLeft") {
            if (entry?.kind === "folder" && !collapsed.has(entry.path))
              toggle(entry.path, false);
            else setSelected(parent(selected));
          }
        }}
      >
        <div
          id="tree-root"
          role="treeitem"
          aria-level={1}
          aria-selected={selected === ""}
          className={`tree-row tree-root ${selected === "" ? "selected" : ""} ${drop === "" ? "drop-target" : ""}`}
          {...dropProps("")}
          onClick={() => {
            setSelected("");
            props.onFolder("");
            tree.current?.focus();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelected("");
            props.onMenu(e);
          }}
        >
          <HardDrive size={15} />
          <span>笔记库根目录</span>
        </div>
        {inline?.kind === "create" && inline.dir === "" && editor(1)}
        {rows.map(({ entry, depth }) =>
          inline?.kind === "rename" && inline.entry.path === entry.path ? (
            <div key={entry.path}>{editor(depth)}</div>
          ) : (
            <div key={entry.path}>
              <div
                id={`tree-${encodeURIComponent(entry.path)}`}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected === entry.path}
                aria-expanded={
                  entry.kind === "folder"
                    ? !collapsed.has(entry.path)
                    : undefined
                }
                className={`tree-row ${selected === entry.path ? "selected" : ""} ${props.activePath === entry.path ? "active-note" : ""} ${drop === entry.path ? "drop-target" : ""}`}
                style={{ paddingLeft: 10 + depth * 15 }}
                title={entry.path}
                draggable={!inline}
                onDragStart={(e) => {
                  setDragged(entry);
                  e.dataTransfer.setData(
                    "application/x-mindgrove-entry",
                    entry.path,
                  );
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setDrop(null);
                }}
                {...(entry.kind === "folder" ? dropProps(entry.path) : {})}
                onClick={() => {
                  setSelected(entry.path);
                  if (entry.kind === "folder") toggle(entry.path);
                  props.onOpen(entry);
                  tree.current?.focus();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(entry.path);
                  props.onMenu(e, entry);
                }}
              >
                {entry.kind === "folder" ? (
                  <>
                    <button
                      className="tree-chevron"
                      tabIndex={-1}
                      aria-label={
                        collapsed.has(entry.path) ? "展开文件夹" : "折叠文件夹"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(entry.path);
                      }}
                    >
                      {collapsed.has(entry.path) ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </button>
                    {collapsed.has(entry.path) ? (
                      <Folder size={15} />
                    ) : (
                      <FolderOpen size={15} />
                    )}
                  </>
                ) : (
                  <>
                    {entry.kind === "mindmap" ? (
                      <Network size={15} />
                    ) : (
                      <FileText size={15} />
                    )}
                  </>
                )}
                <span>{title(entry)}</span>
              </div>
              {inline?.kind === "create" &&
                inline.dir === entry.path &&
                editor(depth + 1)}
            </div>
          ),
        )}
        {!entries.length && !inline && (
          <p className="folder-empty">右键新建笔记或文件夹</p>
        )}
      </div>
    </>
  );
}
