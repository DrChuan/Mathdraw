import { pasteImage, finishImagePastes, hasImagePastes } from "./pasteImage";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
  type NodeChange,
  Handle,
  Position,
} from "@xyflow/react";
import {
  Plus,
  CornerDownRight,
  Trash2,
  ArrowUp,
  ArrowDown,
  Expand,
  FoldVertical,
  Network,
  ListTree,
  Check,
  Undo2,
  Redo2,
  CornerUpLeft,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Copy,
  Scissors,
  ClipboardPaste,
  Pencil,
} from "lucide-react";
import type { MindmapDocument, MindmapNode } from "./types";
import { applyOutline, childrenOf, mapToMarkdown, rootOf } from "./outline";
import Markdown from "./Markdown";
import FormulaPreview from "./FormulaPreview";
import { formulaAtCursor, type CursorFormula } from "./formulaAtCursor";
import ContextMenu, { type MenuAction } from "./ContextMenu";
import {
  branchIds,
  extractBranch,
  insertBranch,
  moveBranch,
  translateBranch,
  findNodes,
  revealNode,
  validateDocument,
  removeBranch,
  type Placement,
} from "./branches";
import { copyBranch, readBranch } from "./branchClipboard";
import { rightLayout, type NodeSize } from "./mapLayout";
interface MapData extends Record<string, unknown> {
  text: string;
  editorText: string;
  color: string;
  side: number;
  root: boolean;
  collapsed: boolean;
  children: number;
  editing: boolean;
  match: boolean;
  drop: Placement | null;
  edit: () => void;
  draft: (text: string) => void;
  commit: (text: string) => void;
  cancel: () => void;
  cursor: (text: string, start: number, end: number) => void;
  toggle: () => void;
}
type FlowNode = Node<MapData, "topic">;
const isTextTarget = (target: EventTarget) =>
  target instanceof HTMLElement &&
  !!target.closest(
    "textarea,input,select,button,a,.formula-preview,.context-menu,[contenteditable=true]",
  );
const Topic = memo(
  function Topic({ data, selected, width, height }: NodeProps<FlowNode>) {
    const [draft, setDraft] = useState(data.editorText);
    const input = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
      if (data.editing) setDraft(data.editorText);
    }, [data.editing]);
    useEffect(() => {
      if (data.editing && width && height)
        requestAnimationFrame(() => {
          input.current?.focus();
          if (input.current?.value === "新节点") input.current.select();
        });
    }, [data.editing, width, height]);
    const cursor = (element: HTMLTextAreaElement) =>
      data.cursor(element.value, element.selectionStart, element.selectionEnd);
    return (
      <div
        className={`topic ${data.root ? "root-topic" : ""} ${selected ? "selected" : ""} ${data.editing ? "editing-topic" : ""} ${data.match ? "search-match" : ""} ${data.drop ? `drop-${data.drop}` : ""}`}
        style={{ "--branch-color": data.color } as React.CSSProperties}
        onDoubleClick={data.edit}
      >
        <Handle
          id="target"
          type="target"
          position={data.side < 0 ? Position.Right : Position.Left}
          isConnectable={false}
        />
        <Handle
          id="left"
          type="source"
          position={Position.Left}
          isConnectable={false}
        />
        <Handle
          id="right"
          type="source"
          position={Position.Right}
          isConnectable={false}
        />
        {data.editing ? (
          <textarea
            ref={input}
            autoFocus
            className="node-input nodrag nowheel"
            aria-label="节点内容，支持 LaTeX"
            spellCheck={false}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            style={{
              width: Math.min(
                556,
                draft
                  .split("\n")
                  .reduce((max, line) => Math.max(max, line.length * 7.2), 220),
              ),
            }}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              data.draft(e.target.value);
              cursor(e.currentTarget);
            }}
            onPaste={(e) =>
              pasteImage(
                e,
                (text) => {
                  setDraft(text);
                  data.draft(text);
                },
                (text) => window.alert(text),
              )
            }
            onSelect={(e) => cursor(e.currentTarget)}
            onClick={(e) => cursor(e.currentTarget)}
            onKeyUp={(e) => cursor(e.currentTarget)}
            onFocus={(e) => cursor(e.currentTarget)}
            onBlur={(e) => {
              if (
                !(
                  e.relatedTarget instanceof HTMLElement &&
                  e.relatedTarget.closest(".formula-preview")
                )
              )
                data.commit(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Escape") {
                e.preventDefault();
                data.cancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                data.commit(e.currentTarget.value);
              }
            }}
          />
        ) : (
          <Markdown compact text={data.text || "空节点"} />
        )}
        {data.children > 0 && (
          <button
            className="node-fold nodrag"
            title={data.collapsed ? "展开分支" : "折叠分支"}
            aria-label={data.collapsed ? "展开分支" : "折叠分支"}
            onClick={data.toggle}
          >
            {data.collapsed ? `+${data.children}` : "−"}
          </button>
        )}
      </div>
    );
  },
  (a, b) =>
    a.selected === b.selected &&
    a.width === b.width &&
    a.height === b.height &&
    [
      "text",
      "editorText",
      "color",
      "side",
      "root",
      "collapsed",
      "children",
      "editing",
      "match",
      "drop",
    ].every((key) => a.data[key] === b.data[key]),
);
const nodeTypes = { topic: Topic };
interface Props {
  doc: MindmapDocument;
  onChange: (doc: MindmapDocument, recordHistory?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}
function Editor({
  doc,
  onChange,
  onEditingChange,
  undo,
  redo,
  canUndo,
  canRedo,
}: Props) {
  const root = rootOf(doc);
  const [selectedId, setSelectedId] = useState(root.id);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    onEditingChange?.(editing !== null);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [mode, setMode] = useState<"map" | "outline">(
    doc.outlineDraft !== undefined ? "outline" : "map",
  );
  const [error, setError] = useState("");
  const [activeFormula, setActiveFormula] = useState<{
    id: string;
    formula: CursorFormula;
  } | null>(null);
  const updateCursor = useCallback(
    (id: string, text: string, start: number, end: number) => {
      const formula = formulaAtCursor(text, start, end);
      const next = formula ? { id, formula } : null;
      setActiveFormula((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    },
    [],
  );
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: string | null;
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const clipboardLock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [resultIndex, setResultIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placement: Placement;
  } | null>(null);
  const dropRef = useRef<typeof dropTarget>(null);
  const drag = useRef<{
    id: string;
    free: boolean;
    snapshot: MindmapDocument;
    start: { x: number; y: number };
    positions: Map<string, { x: number; y: number }>;
    ids: Set<string>;
  } | null>(null);
  const flow = useReactFlow<FlowNode>();
  const [sizes, setSizes] = useState<Map<string, NodeSize>>(new Map());
  const [layingOut, setLayingOut] = useState(false);
  const canvas = useRef<HTMLDivElement>(null),
    previousEditing = useRef<string | null>(null);
  useEffect(() => {
    if (!editing && previousEditing.current)
      requestAnimationFrame(() => canvas.current?.focus());
    previousEditing.current = editing;
  }, [editing]);
  const selected = doc.nodes.find((n) => n.id === selectedId) ?? root;
  useEffect(() => {
    if (!doc.nodes.some((n) => n.id === selectedId)) setSelectedId(root.id);
  }, [doc.nodes, root.id, selectedId]);
  const current = useRef({ doc, onChange });
  current.current = { doc, onChange };
  const session = useRef({
    id: "",
    original: "",
    active: false,
    changed: false,
  });
  const patch = useCallback(
    (id: string, change: Partial<MindmapNode>, recordHistory = true) => {
      const value = current.current;
      value.onChange(
        {
          ...value.doc,
          nodes: value.doc.nodes.map((n) =>
            n.id === id ? { ...n, ...change } : n,
          ),
        },
        recordHistory,
      );
    },
    [],
  );
  const beginEdit = useCallback((id: string) => {
    const n = current.current.doc.nodes.find((n) => n.id === id);
    if (!n) return;
    session.current = { id, original: n.text, active: true, changed: false };
    setSelectedId(id);
    setEditing(id);
  }, []);
  const changeDraft = useCallback(
    (id: string, text: string) => {
      const active = session.current;
      if (!active.active || active.id !== id) return;
      const record = !active.changed;
      active.changed = true;
      patch(id, { text }, record);
    },
    [patch],
  );
  const finishEdit = useCallback(
    async (id: string, text: string, cancel = false) => {
      const pending = !cancel && hasImagePastes();
      if (pending) await finishImagePastes();
      const active = session.current;
      if (!active.active || active.id !== id) return;
      active.active = false;
      const latest = pending
        ? (canvas.current?.querySelector<HTMLTextAreaElement>(".node-input")
            ?.value ?? text)
        : text;
      const value = cancel ? active.original : latest || "空节点";
      if (current.current.doc.nodes.find((n) => n.id === id)?.text !== value)
        patch(id, { text: value }, false);
      setEditing(null);
      setActiveFormula(null);
    },
    [patch],
  );
  useEffect(() => {
    if (!editing) {
      setActiveFormula(null);
      return;
    }
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".node-input,.formula-preview")
      )
        return;
      const input =
        canvas.current?.querySelector<HTMLTextAreaElement>(".node-input");
      finishEdit(
        editing,
        input?.value ??
          current.current.doc.nodes.find((n) => n.id === editing)?.text ??
          "",
      );
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [editing, finishEdit]);
  const byId = useMemo(
    () => new Map(doc.nodes.map((n) => [n.id, n])),
    [doc.nodes],
  );
  const children = useMemo(() => {
    const map = new Map<string, MindmapNode[]>();
    for (const n of doc.nodes)
      if (n.parentId) {
        const siblings = map.get(n.parentId) ?? [];
        siblings.push(n);
        map.set(n.parentId, siblings);
      }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [doc.nodes]);
  const displayDoc = useMemo(
    () =>
      editing && session.current.active
        ? {
            ...doc,
            nodes: doc.nodes.map((n) =>
              n.id === editing ? { ...n, text: session.current.original } : n,
            ),
          }
        : doc,
    [doc, editing],
  );
  const layout = useMemo(
    () => rightLayout(displayDoc, sizes),
    [displayDoc, sizes],
  );
  const results = useMemo(() => findNodes(doc, query), [doc, query]);
  const resultSet = useMemo(() => new Set(results), [results]);
  const rendered = useMemo<FlowNode[]>(
    () =>
      doc.nodes
        .filter((n) => layout.has(n.id))
        .map((n) => {
          const p = layout.get(n.id)!;
          return {
            id: n.id,
            type: "topic",
            position: n.position ?? { x: p.x, y: p.y },
            selected: n.id === selectedId,
            data: {
              text: n.id === editing ? session.current.original : n.text,
              editorText: n.text,
              side: 1,
              root: n.parentId === null,
              color: p.color,
              collapsed: n.collapsed,
              children: children.get(n.id)?.length ?? 0,
              editing: editing === n.id,
              match: resultSet.has(n.id),
              drop: dropTarget?.id === n.id ? dropTarget.placement : null,
              edit: () => beginEdit(n.id),
              draft: (text) => changeDraft(n.id, text),
              commit: (text) => finishEdit(n.id, text),
              cancel: () => finishEdit(n.id, "", true),
              cursor: (text, start, end) =>
                updateCursor(n.id, text, start, end),
              toggle: () => patch(n.id, { collapsed: !n.collapsed }),
            },
          };
        }),
    [
      doc,
      layout,
      selectedId,
      editing,
      patch,
      children,
      beginEdit,
      resultSet,
      dropTarget,
      changeDraft,
      finishEdit,
      updateCursor,
    ],
  );
  const [nodes, setNodes] = useState<FlowNode[]>(rendered);
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  useEffect(() => {
    if (!drag.current) setNodes(rendered);
    else
      setNodes((previous) =>
        previous.map((n) => ({
          ...n,
          data: rendered.find((r) => r.id === n.id)?.data ?? n.data,
        })),
      );
  }, [rendered]);
  const edges = useMemo<Edge[]>(
    () =>
      rendered
        .filter((n) => byId.get(n.id)?.parentId)
        .map((n) => {
          const parent = byId.get(n.id)!.parentId!;
          return {
            id: n.id,
            source: parent,
            sourceHandle: "right",
            target: n.id,
            targetHandle: "target",
            type: "default",
            style: { stroke: n.data.color, strokeWidth: 2, opacity: 0.65 },
            selectable: false,
            focusable: false,
          };
        }),
    [rendered, byId],
  );
  useEffect(() => {
    if (!layingOut) return;
    let canceled = false;
    const arrange = async () => {
      await document.fonts.ready;
      const measured = new Map<string, NodeSize>();
      let previous = "";
      // Offscreen nodes are mounted for this operation so tall formulas count too.
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (canceled) return;
        measured.clear();
        const all = flow.getNodes();
        for (const n of all)
          if (n.measured?.width && n.measured?.height)
            measured.set(n.id, {
              width: n.measured.width,
              height: n.measured.height,
            });
        const snapshot = JSON.stringify([...measured]);
        if (measured.size === all.length && snapshot === previous) break;
        previous = snapshot;
      }
      const latest = current.current;
      setSizes(measured);
      latest.onChange({
        ...latest.doc,
        nodes: latest.doc.nodes.map((n) => ({ ...n, position: undefined })),
      });
      setLayingOut(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(
          () =>
            void flow.fitView({
              padding: 0.15,
              minZoom: 0.15,
              maxZoom: 1,
              duration: 250,
            }),
        ),
      );
    };
    void arrange().catch((e) => {
      if (!canceled) {
        setError(String(e));
        setLayingOut(false);
      }
    });
    return () => {
      canceled = true;
    };
  }, [layingOut, flow]);
  const applyDocument = useCallback((next: MindmapDocument, record = true) => {
    try {
      current.current.onChange(validateDocument(next), record);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);
  const copySelection = async (id: string, cut = false) => {
    if (clipboardLock.current) return;
    const before = current.current.doc;
    if (cut && rootOf(before).id === id) return;
    clipboardLock.current = true;
    setClipboardBusy(true);
    try {
      const captured = extractBranch(before, id);
      await copyBranch(before, id);
      if (!mounted.current) return;
      if (cut) {
        const latest = current.current.doc;
        if (
          latest.id !== before.id ||
          !latest.nodes.some((n) => n.id === id) ||
          JSON.stringify(extractBranch(latest, id)) !== JSON.stringify(captured)
        ) {
          setError("分支在复制期间发生了变化，已复制但未剪切。");
          return;
        }
        const parentId = latest.nodes.find((n) => n.id === id)!.parentId!;
        if (applyDocument(removeBranch(latest, id))) setSelectedId(parentId);
      } else setError("");
    } catch (e) {
      if (mounted.current)
        setError(
          `剪贴板操作未完成：${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      clipboardLock.current = false;
      if (mounted.current) setClipboardBusy(false);
    }
  };
  const pasteSelection = async (parentId: string) => {
    if (clipboardLock.current) return;
    clipboardLock.current = true;
    setClipboardBusy(true);
    try {
      const branch = await readBranch();
      if (!mounted.current) return;
      const next = insertBranch(current.current.doc, parentId, branch);
      if (applyDocument(next.doc)) {
        setSelectedId(next.firstId);
        canvas.current?.focus();
      }
    } catch (e) {
      if (mounted.current)
        setError(`无法粘贴：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clipboardLock.current = false;
      if (mounted.current) setClipboardBusy(false);
    }
  };
  const locate = useCallback(
    (id: string) => {
      if (!current.current.doc.nodes.some((n) => n.id === id)) return;
      const revealed = revealNode(current.current.doc, id);
      if (revealed.nodes.some((n, i) => n !== current.current.doc.nodes[i]))
        applyDocument(revealed, false);
      setSelectedId(id);
      setTimeout(() => {
        if (!mounted.current) return;
        const n = flow.getNode(id);
        if (!n) return;
        void flow.setCenter(
          n.position.x + (n.measured?.width ?? 104) / 2,
          n.position.y + (n.measured?.height ?? 58) / 2,
          {
            zoom: Math.max(0.65, Math.min(flow.getZoom(), 1.25)),
            duration: 200,
          },
        );
      }, 80);
    },
    [applyDocument, flow],
  );
  const resultKey = results.join(",");
  useEffect(() => {
    setResultIndex(0);
    if (searchOpen && results[0]) locate(results[0]);
  }, [query, resultKey, searchOpen, locate]);
  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    canvas.current?.focus();
  };
  const nextResult = (direction: number) => {
    if (!results.length) return;
    const index = (resultIndex + direction + results.length) % results.length;
    setResultIndex(index);
    locate(results[index]);
  };
  const startDrag = (event: MouseEvent | TouchEvent, n: FlowNode) => {
    const snapshot = current.current.doc,
      positions = new Map(
        flow.getNodes().map((node) => [node.id, { ...node.position }]),
      );
    drag.current = {
      id: n.id,
      free: event.altKey,
      snapshot,
      start: { ...n.position },
      positions,
      ids: branchIds(snapshot, n.id),
    };
    dropRef.current = null;
    setDropTarget(null);
    setSelectedId(n.id);
    if (!event.altKey && n.id === rootOf(snapshot).id)
      setError("根主题不能调整层级，可按 Alt 自由移动。");
  };
  const updateDrag = (event: MouseEvent | TouchEvent, n: FlowNode) => {
    const state = drag.current;
    if (!state) return;
    if (state.free) {
      const dx = n.position.x - state.start.x,
        dy = n.position.y - state.start.y;
      setNodes((previous) =>
        previous.map((node) => {
          const p = state.positions.get(node.id);
          return state.ids.has(node.id) && p
            ? { ...node, position: { x: p.x + dx, y: p.y + dy } }
            : node;
        }),
      );
      return;
    }
    const pointer = "touches" in event ? event.touches[0] : event;
    if (!pointer) return;
    const zoom = flow.getZoom();
    let target: { id: string; placement: Placement } | null = null;
    for (const candidate of flow.getNodes()) {
      if (state.ids.has(candidate.id)) continue;
      const p = flow.flowToScreenPosition(candidate.position),
        w = (candidate.measured?.width ?? 104) * zoom,
        h = (candidate.measured?.height ?? 58) * zoom;
      if (
        pointer.clientX < p.x ||
        pointer.clientX > p.x + w ||
        pointer.clientY < p.y ||
        pointer.clientY > p.y + h
      )
        continue;
      const ratio = (pointer.clientY - p.y) / h;
      const placement: Placement =
        candidate.id === rootOf(state.snapshot).id
          ? "inside"
          : ratio < 0.25
            ? "before"
            : ratio > 0.75
              ? "after"
              : "inside";
      try {
        moveBranch(state.snapshot, state.id, candidate.id, placement);
        target = { id: candidate.id, placement };
      } catch {
        /* Invalid targets never receive a drop marker. */
      }
      break;
    }
    if (
      target?.id !== dropRef.current?.id ||
      target?.placement !== dropRef.current?.placement
    ) {
      dropRef.current = target;
      setDropTarget(target);
    }
  };
  const endDrag = (n: FlowNode) => {
    const state = drag.current,
      target = dropRef.current;
    drag.current = null;
    dropRef.current = null;
    setDropTarget(null);
    setNodes(renderedRef.current);
    if (!state) return;
    if (current.current.doc !== state.snapshot) {
      setError("导图在拖动期间发生变化，请重试。");
      return;
    }
    try {
      if (state.free) {
        const dx = n.position.x - state.start.x,
          dy = n.position.y - state.start.y;
        if (dx || dy)
          applyDocument(
            translateBranch(state.snapshot, state.id, dx, dy, state.positions),
          );
      } else if (target)
        applyDocument(
          moveBranch(state.snapshot, state.id, target.id, target.placement),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const add = (sibling = false) => {
    if (doc.nodes.length >= 5000) {
      setError("单篇导图最多支持 5000 个节点");
      return;
    }
    const parentId =
      sibling && selected.parentId ? selected.parentId : selected.id;
    let depth = 0,
      ancestor = byId.get(parentId);
    while (ancestor?.parentId) {
      depth++;
      ancestor = byId.get(ancestor.parentId);
    }
    if (depth >= 128) {
      setError("导图最多支持 128 层");
      return;
    }
    const siblings = childrenOf(doc.nodes, parentId);
    const index =
      sibling && selected.parentId
        ? siblings.findIndex((n) => n.id === selected.id) + 1
        : siblings.length;
    const newNode: MindmapNode = {
      id: crypto.randomUUID(),
      parentId,
      order: index,
      text: "新节点",
      collapsed: false,
    };
    const orderedIds = siblings.map((n) => n.id);
    orderedIds.splice(index, 0, newNode.id);
    const next: MindmapDocument = {
      ...doc,
      nodes: [
        ...doc.nodes.map((n) =>
          n.id === parentId
            ? { ...n, collapsed: false }
            : n.parentId === parentId
              ? { ...n, order: orderedIds.indexOf(n.id) }
              : n,
        ),
        newNode,
      ],
    };
    if (!applyDocument(next)) return;
    setSelectedId(newNode.id);
    session.current = {
      id: newNode.id,
      original: newNode.text,
      active: true,
      changed: false,
    };
    setEditing(newNode.id);
  };
  const remove = (id: string) => {
    const node = doc.nodes.find((n) => n.id === id)!;
    setSelectedId(node.parentId ?? root.id);
    applyDocument(removeBranch(current.current.doc, id));
    setPendingDelete(null);
  };
  const requestDelete = (id = selected.id) => {
    const n = current.current.doc.nodes.find((node) => node.id === id);
    if (!n?.parentId) return;
    if (childrenOf(current.current.doc.nodes, id).length) setPendingDelete(id);
    else remove(id);
  };
  const reorder = (direction: number) => {
    if (!selected.parentId) return;
    const siblings = childrenOf(doc.nodes, selected.parentId),
      index = siblings.findIndex((n) => n.id === selected.id),
      target = siblings[index + direction];
    if (!target) return;
    try {
      applyDocument(
        moveBranch(
          doc,
          selected.id,
          target.id,
          direction < 0 ? "before" : "after",
        ),
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const promote = () => {
    const parent = doc.nodes.find((n) => n.id === selected.parentId);
    if (!parent?.parentId) return;
    try {
      applyDocument(moveBranch(doc, selected.id, parent.id, "after"));
    } catch (e) {
      setError(String(e));
    }
  };
  const showMap = () => {
    try {
      const next = applyOutline(doc, doc.outlineDraft ?? mapToMarkdown(doc));
      if (!applyDocument(next)) return;
      setMode("map");
      setError("");
      setTimeout(() => {
        void flow.fitView({
          padding: 0.12,
          minZoom: 0.65,
          maxZoom: 1,
          duration: 250,
        });
        canvas.current?.focus();
      }, 80);
    } catch (e) {
      setError(String(e));
    }
  };
  const menuNode = menu?.id
    ? doc.nodes.find((n) => n.id === menu.id)
    : undefined;
  const menuActions: MenuAction[] = menuNode
    ? [
        {
          label: "编辑节点",
          icon: <Pencil size={14} />,
          shortcut: "F2",
          run: () => beginEdit(menuNode.id),
        },
        {
          label: "新建子节点",
          icon: <Plus size={14} />,
          shortcut: "Tab",
          run: () => add(),
        },
        {
          label: "新建同级节点",
          icon: <CornerDownRight size={14} />,
          shortcut: "Enter",
          disabled: !menuNode.parentId,
          run: () => add(true),
        },
        {
          label: "剪切分支",
          icon: <Scissors size={14} />,
          shortcut: "⌘ / Ctrl X",
          separator: true,
          disabled: !menuNode.parentId || clipboardBusy,
          run: () => void copySelection(menuNode.id, true),
        },
        {
          label: "复制分支",
          icon: <Copy size={14} />,
          shortcut: "⌘ / Ctrl C",
          disabled: clipboardBusy,
          run: () => void copySelection(menuNode.id),
        },
        {
          label: "粘贴为子分支",
          icon: <ClipboardPaste size={14} />,
          shortcut: "⌘ / Ctrl V",
          disabled: clipboardBusy,
          run: () => void pasteSelection(menuNode.id),
        },
        {
          label: menuNode.collapsed ? "展开分支" : "折叠分支",
          icon: <FoldVertical size={14} />,
          separator: true,
          disabled: !childrenOf(doc.nodes, menuNode.id).length,
          run: () => patch(menuNode.id, { collapsed: !menuNode.collapsed }),
        },
        {
          label: "删除分支",
          icon: <Trash2 size={14} />,
          shortcut: "Delete",
          danger: true,
          disabled: !menuNode.parentId,
          run: () => requestDelete(menuNode.id),
        },
      ]
    : [
        {
          label: "粘贴到根主题",
          icon: <ClipboardPaste size={14} />,
          disabled: clipboardBusy,
          run: () => void pasteSelection(root.id),
        },
        {
          label: "自动布局",
          icon: <Expand size={14} />,
          disabled: layingOut,
          run: () => setLayingOut(true),
        },
        {
          label: "查看全图",
          icon: <Search size={14} />,
          run: () => {
            void flow.fitView({ padding: 0.15, duration: 200 });
          },
        },
      ];
  return (
    <div
      className="mindmap-editor"
      onKeyDownCapture={(e) => {
        if (
          mode !== "map" ||
          (e.target instanceof HTMLElement &&
            e.target.closest(
              "textarea,input,button,select,a,.formula-preview,.context-menu,[contenteditable=true]",
            ))
        )
          return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          openSearch();
        } else if (
          (e.metaKey || e.ctrlKey) &&
          ["c", "x", "v"].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          if (e.key.toLowerCase() === "v") void pasteSelection(selected.id);
          else void copySelection(selected.id, e.key.toLowerCase() === "x");
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo?.();
          else undo?.();
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (e.shiftKey) promote();
          else add();
        } else if (e.key === "Enter") {
          e.preventDefault();
          add(true);
        } else if (e.key === "F2") {
          e.preventDefault();
          beginEdit(selected.id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          requestDelete();
        } else if (e.key === " ") {
          e.preventDefault();
          patch(selected.id, { collapsed: !selected.collapsed });
        } else if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          if (
            (e.metaKey || e.ctrlKey) &&
            ["ArrowUp", "ArrowDown"].includes(e.key)
          )
            reorder(e.key === "ArrowUp" ? -1 : 1);
          else {
            const siblings = selected.parentId
              ? childrenOf(doc.nodes, selected.parentId)
              : [root];
            const index = siblings.findIndex((n) => n.id === selected.id);
            const next =
              e.key === "ArrowLeft"
                ? doc.nodes.find((n) => n.id === selected.parentId)
                : e.key === "ArrowRight"
                  ? childrenOf(doc.nodes, selected.id)[0]
                  : siblings[index + (e.key === "ArrowUp" ? -1 : 1)];
            if (next) setSelectedId(next.id);
          }
        }
      }}
    >
      {error && (
        <div className="map-inline-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="map-topline">
        <div className="view-switch">
          <button
            className={mode === "map" ? "active" : ""}
            onClick={() => mode === "outline" && showMap()}
          >
            <Network size={15} />
            思维导图
          </button>
          <button
            className={mode === "outline" ? "active" : ""}
            onClick={() => {
              setMode("outline");
              session.current.active = false;
              setEditing(null);
            }}
          >
            <ListTree size={15} />
            文本大纲{doc.outlineDraft !== undefined && <i />}
          </button>
        </div>
        <span className="node-count">{doc.nodes.length} 个节点</span>
      </div>
      {mode === "outline" ? (
        <div className="outline-workspace">
          <div className="outline-help">
            <div>
              <strong>用文字梳理思路</strong>
              <p>
                用 # 标题或缩进列表组织层级，公式写在 $…$ 或 $$…$$
                中。文本草稿会自动保存。
              </p>
            </div>
            <button className="primary" onClick={showMap}>
              <Check size={15} />
              应用大纲并查看导图
            </button>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <textarea
            className="outline-source"
            aria-label="Markdown 文本大纲"
            spellCheck={false}
            value={doc.outlineDraft ?? mapToMarkdown(doc)}
            onChange={(e) => onChange({ ...doc, outlineDraft: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className="map-tools">
            <button onClick={() => add()}>
              <Plus size={15} />
              子节点
            </button>
            <button onClick={() => add(true)}>
              <CornerDownRight size={15} />
              同级
            </button>
            <span className="tool-divider" />
            <button
              title="上移节点"
              aria-label="上移节点"
              onClick={() => reorder(-1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              title="下移节点"
              aria-label="下移节点"
              onClick={() => reorder(1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              title="提升一级（Shift+Tab）"
              aria-label="提升一级"
              disabled={!selected.parentId || selected.parentId === root.id}
              onClick={promote}
            >
              <CornerUpLeft size={15} />
            </button>
            <button
              title="折叠/展开分支（空格）"
              aria-label="折叠或展开分支"
              onClick={() =>
                patch(selected.id, { collapsed: !selected.collapsed })
              }
            >
              <FoldVertical size={15} />
            </button>
            <button
              title="删除分支"
              aria-label="删除分支"
              disabled={selected.id === root.id}
              onClick={() => requestDelete()}
            >
              <Trash2 size={15} />
            </button>
            <span className="tool-divider" />
            <button
              title="撤销"
              aria-label="撤销"
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 size={15} />
            </button>
            <button
              title="重做"
              aria-label="重做"
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 size={15} />
            </button>
            <button title="导图内查找（⌘ / Ctrl + F）" onClick={openSearch}>
              <Search size={14} />
              查找
            </button>
            <button
              className="auto-layout"
              title="按节点实际高度向右排列，清除手动位置"
              disabled={layingOut}
              onClick={() => {
                setEditing(null);
                setLayingOut(true);
              }}
            >
              <Expand size={14} />
              {layingOut ? "布局中…" : "自动布局"}
            </button>
          </div>
          {searchOpen && (
            <div className="map-search" role="search">
              <Search size={14} />
              <input
                ref={searchInput}
                aria-label="搜索导图节点或公式源码"
                placeholder="搜索节点或公式源码"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeSearch();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    nextResult(e.shiftKey ? -1 : 1);
                  }
                }}
              />
              <span role="status">
                {results.length
                  ? `${Math.min(resultIndex + 1, results.length)} / ${results.length}`
                  : query
                    ? "未找到"
                    : "输入关键词"}
              </span>
              <button
                title="上一个结果"
                disabled={!results.length}
                onClick={() => nextResult(-1)}
              >
                <ChevronUp size={14} />
              </button>
              <button
                title="下一个结果"
                disabled={!results.length}
                onClick={() => nextResult(1)}
              >
                <ChevronDown size={14} />
              </button>
              <button
                title="关闭查找"
                aria-label="关闭查找"
                onClick={closeSearch}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div
            className="flow-canvas"
            ref={canvas}
            tabIndex={0}
            aria-label="思维导图画布，Tab 新增子节点，Enter 新增同级，双击编辑"
            onCopy={(e) => {
              if (!isTextTarget(e.target)) {
                e.preventDefault();
                void copySelection(selected.id);
              }
            }}
            onCut={(e) => {
              if (!isTextTarget(e.target)) {
                e.preventDefault();
                void copySelection(selected.id, true);
              }
            }}
            onPaste={(e) => {
              if (!isTextTarget(e.target)) {
                e.preventDefault();
                void pasteSelection(selected.id);
              }
            }}
          >
            <ReactFlow<FlowNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes: NodeChange<FlowNode>[]) => {
                setNodes((current) => applyNodeChanges(changes, current));
                const measured = changes.filter(
                  (change) =>
                    change.type === "dimensions" &&
                    change.dimensions &&
                    change.id !== editing,
                );
                if (measured.length)
                  setSizes((previous) => {
                    const next = new Map(previous);
                    let changed = false;
                    for (const change of measured)
                      if (change.type === "dimensions" && change.dimensions) {
                        const old = next.get(change.id),
                          size = change.dimensions;
                        if (
                          !old ||
                          Math.abs(old.height - size.height) > 1 ||
                          Math.abs(old.width - size.width) > 1
                        ) {
                          next.set(change.id, size);
                          changed = true;
                        }
                      }
                    return changed ? next : previous;
                  });
              }}
              onNodeClick={(_, n) => {
                setSelectedId(n.id);
                if (!editing) canvas.current?.focus();
              }}
              onNodeContextMenu={(e, n) => {
                e.preventDefault();
                setSelectedId(n.id);
                setMenu({ x: e.clientX, y: e.clientY, id: n.id });
              }}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: null });
              }}
              onNodeDragStart={(e, n) => startDrag(e, n)}
              onNodeDrag={(e, n) => updateDrag(e, n)}
              onNodeDragStop={(e, n) => {
                // A quick release can arrive before the last pointer-move frame.
                updateDrag(e, n);
                endDrag(n);
              }}
              onlyRenderVisibleElements={!layingOut}
              nodesConnectable={false}
              edgesFocusable={false}
              disableKeyboardA11y
              deleteKeyCode={null}
              minZoom={0.15}
              maxZoom={2}
              fitView
              fitViewOptions={{ padding: 0.12, minZoom: 0.65, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#c7cdc5" gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="map-footer">
            <span>
              <i className="green-dot" />
              {clipboardBusy
                ? "正在处理剪贴板…"
                : editing
                  ? "⌘ / Ctrl + Enter 完成编辑 · Esc 取消"
                  : "双击节点编辑，支持 LaTeX 公式"}
            </span>
            <span>
              <kbd>Tab</kbd> 子节点 <kbd>Enter</kbd> 同级 <kbd>空格</kbd> 折叠
            </span>
          </div>
        </>
      )}
      {editing && activeFormula?.id === editing && (
        <FormulaPreview
          key={`${editing}:${activeFormula.formula.start}`}
          formula={activeFormula.formula}
          anchor={
            canvas.current?.querySelector<HTMLElement>(".node-input") ?? null
          }
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={menuActions}
          close={closeMenu}
        />
      )}
      {pendingDelete && (
        <div className="confirm-popover">
          <strong>删除这条分支？</strong>
          <p>它的子节点也会删除。你可以通过撤销恢复。</p>
          <div>
            <button onClick={() => setPendingDelete(null)}>取消</button>
            <button className="danger" onClick={() => remove(pendingDelete)}>
              删除分支
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default function MindmapEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
