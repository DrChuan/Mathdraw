import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import UpdateNotice from "./UpdateNotice";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Download, X } from "lucide-react";
import {
  newDrawing,
  type DrawingDocument,
  type DrawingFile,
  type DrawingCurve,
  type GeometryObject,
  type Vec2,
  type DrawingChange,
} from "./types";
import {
  resolveGeometry,
  validateDrawing,
  project,
  fromPlane,
} from "./geometry";
import { applyDefinition, normalizeDrawing } from "./model";
import { useCurveSampler } from "./useCurveSampler";
import { isLineEquation } from "./expression";
import { sceneFor, exportSvg, labelPlainText } from "./scene";
import { drawingAdapter as adapter } from "./adapter";
import DrawingWorkbench from "./DrawingWorkbench";
import { constraintLocusPoints } from "./constraints/document";
import "./drawing.css";
import "./workbench.css";
type Intent = "close" | "quit" | "new" | "new2d" | "new3d" | "open";
const stringify = (d: DrawingDocument) => JSON.stringify(d, null, 2);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function DrawingApp() {
  const [doc, setDoc] = useState<DrawingDocument>(newDrawing),
    docRef = useRef(doc);
  docRef.current = doc;
  const [file, setFile] = useState<{
      path: string | null;
      hash: string | null;
    }>({ path: null, hash: null }),
    fileRef = useRef(file);
  fileRef.current = file;
  const savedText = useRef(stringify(doc)),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null),
    intentRef = useRef<Intent | null>(null),
    closeLock = useRef(false),
    readyRef = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    draftsRef = useRef(drafts);
  const [expressionPreview, setExpressionPreview] = useState<GeometryObject[]>([]),
    [expressionProblem, setExpressionProblem] = useState("");
  draftsRef.current = drafts;
  const flushEditor = useRef<(() => void) | null>(null);
  const [legacy, setLegacy] = useState(false);
  const sourceVersion = useRef<1 | 2 | 3>(3), saveLock = useRef(false);

  const [curveMoving, setCurveMoving] = useState(false);
  const [fontError, setFontError] = useState(""),
    [fontsReady, setFontsReady] = useState(false);
  const [size, setSize] = useState<Vec2>([1000, 700]),
    canvas = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const undoStack = useRef<string[]>([]),
    redoStack = useRef<string[]>([]),
    [historyTick, setHistoryTick] = useState(0),
    recoveryQueue = useRef<Promise<void>>(Promise.resolve());
  const [version,setVersion]=useState("");
  const updateLock=useRef(false);
  useEffect(()=>{void getVersion().then(setVersion).catch(()=>{});},[]);
  const dirty = stringify(doc) !== savedText.current;
  useEffect(()=>{
    if(!ready)return;
    const name=file.path?.split(/[\\/]/).at(-1)??doc.title;
    const state=busy?"处理中":dirty?"未保存":Object.keys(drafts).length?"未完成定义":"已保存";
    void getCurrentWindow().setTitle(`${name} · ${state}${legacy?" · 旧格式":""} — ${new URLSearchParams(location.search).has("standalone")?"Mathdraw":"Mindgrove"} ${version}`).catch(e=>setError(`窗口标题更新失败：${message(e)}`));
  },[ready,file.path,doc.title,dirty,busy,Object.keys(drafts).length,legacy,version]);
  useEffect(() => {
    const closeMenus = (e: PointerEvent) => document.querySelectorAll<HTMLDetailsElement>(".drawing-app details.view-options[open]")
      .forEach(menu => { if (!menu.contains(e.target as Node)) menu.open = false; });
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".drawing-app details.view-options[open]")
        .forEach(menu => { menu.open = false; });
    };
    document.addEventListener("pointerdown",closeMenus);
    document.addEventListener("keydown",escape);
    return () => { document.removeEventListener("pointerdown",closeMenus); document.removeEventListener("keydown",escape); };
  }, []);
  const currentDoc = useMemo(() => resolveGeometry(doc), [doc]);
  useEffect(() => {
    const source = drafts.new?.trim();
    if (!source) {
      setExpressionPreview(previous => previous.length ? [] : previous);
      setExpressionProblem("");
      return;
    }
    const timer = setTimeout(() => {
      try {
        const next = applyDefinition(docRef.current, source);
        setExpressionPreview(next.objects.filter(o => !docRef.current.objects.some(p => p.id === o.id)));
        setExpressionProblem("");
      } catch (e) {
        setExpressionProblem(message(e));
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [drafts.new, doc]);
  const previewCurves = useMemo(() => expressionPreview.length ? resolveGeometry({
    ...doc, objects: [...doc.objects, ...expressionPreview],
  }).curves : currentDoc.curves, [doc, expressionPreview, currentDoc]);
  const commit: DrawingChange = useCallback((next: DrawingDocument, history = true, phase?: "continuous" | "complete") => {
    try {
      if (phase) setCurveMoving(phase === "continuous");
      next = phase === "continuous" ? validateDrawing(next) : normalizeDrawing(next);
      if (stringify(next) === stringify(docRef.current)) return true;
      if (history) {
        undoStack.current.push(stringify(docRef.current));
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
      }
      docRef.current = next;
      setDoc(next);
      setHistoryTick((t) => t + 1);
      setError("");
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  }, []);
  const patchView = (patch: Partial<DrawingDocument["view"]>) =>
    commit(
      { ...docRef.current, view: { ...docRef.current.view, ...patch } },
      false,
    );
  const undo = () => {
    window.dispatchEvent(new Event("drawing-history"));
    const text = undoStack.current.pop();
    if (!text) return;
    redoStack.current.push(stringify(docRef.current));
    docRef.current = JSON.parse(text);
    setDoc(docRef.current);
    setHistoryTick((t) => t + 1);
  };
  const redo = () => {
    window.dispatchEvent(new Event("drawing-history"));
    const text = redoStack.current.pop();
    if (!text) return;
    undoStack.current.push(stringify(docRef.current));
    docRef.current = JSON.parse(text);
    setDoc(docRef.current);
    setHistoryTick((t) => t + 1);
  };
  const recoverSave = useCallback((discard = false) => {
    const content = discard
      ? savedText.current || stringify(newDrawing())
      : stringify(docRef.current);
    const snapshot: DrawingFile = {
      content,
      ...fileRef.current,
      savedContent: savedText.current,
      uiDraft: discard ? {} : draftsRef.current,
      sourceVersion: sourceVersion.current,
    };
    if (discard && !savedText.current) {
      snapshot.path = null;
      snapshot.hash = null;
      snapshot.savedContent = content;
      snapshot.sourceVersion = 3;
    }
    const next = recoveryQueue.current
      .catch(() => {})
      .then(() => adapter.recoverSave(snapshot));
    recoveryQueue.current = next;
    return next;
  }, []);
  const install = useCallback((loaded: DrawingFile, recovered = false) => {
    const raw = validateDrawing(JSON.parse(loaded.content));
    sourceVersion.current = loaded.sourceVersion ?? raw.schemaVersion;
    setLegacy(sourceVersion.current < 3);
    const parsed = normalizeDrawing(raw);
    draftsRef.current = Object.fromEntries(
      Object.entries(loaded.uiDraft ?? {}).filter(
        ([id]) => id === "new" || raw.objects.some((o) => o.id === id),
      ),
    );
    setDrafts(draftsRef.current);
    setExpressionPreview([]);
    setExpressionProblem("");
    docRef.current = parsed;
    setDoc(parsed);
    setFile({ path: loaded.path, hash: loaded.hash });
    fileRef.current = { path: loaded.path, hash: loaded.hash };
    savedText.current = recovered
      ? loaded.savedContent
        ? stringify(normalizeDrawing(JSON.parse(loaded.savedContent)))
        : ""
      : stringify(parsed);
    undoStack.current = [];
    redoStack.current = [];
    setHistoryTick((t) => t + 1);
    setError("");
  }, []);
  useEffect(() => {
    let cancelled = false;
    adapter
      .recover()
      .then((file) => {
        if (!cancelled && file) install(file, true);
      })
      .catch((e) => setError(`草稿恢复失败：${message(e)}`))
      .finally(() => {
        if (!cancelled) {
          readyRef.current = true;
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [install]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () =>
        void recoverSave().catch((e) =>
          setError(`恢复草稿保存失败：${message(e)}`),
        ),
      500,
    );
    return () => clearTimeout(timer);
  }, [doc, file, ready, recoverSave, drafts]);
  const loadFonts = useCallback(async () => {
    setFontsReady(false);
    try {
      const fonts =
        await invoke<{ italic: boolean; data: number[] }[]>("drawing_fonts");
      for (const f of fonts) {
        const face = new FontFace(
          "Mindgrove Times",
          new Uint8Array(f.data).buffer,
          { style: f.italic ? "italic" : "normal" },
        );
        await face.load();
        document.fonts.add(face);
      }
      setFontsReady(true);
      setFontError("");
    } catch (e) {
      setFontError(message(e));
    }
  }, []);
  useEffect(() => {
    void loadFonts();
  }, [loadFonts]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize([r.width, r.height]);
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [doc.id]);
  const curves = useMemo(
    () =>
      [...previewCurves.values()]
        .filter((o): o is DrawingCurve => !o.hidden)
        .map((c) => {
          if (
            c.followView !== false &&
            doc.view.mode === "plane" &&
            c.planeId === doc.view.planeId
          ) {
            const [cx, cy] = doc.view.center,
              s = doc.view.scale;
            return {
              ...c,
              range: [
                cx - size[0] / s / 2,
                cx + size[0] / s / 2,
                -cy - size[1] / s / 2,
                -cy + size[1] / s / 2,
              ] as DrawingCurve["range"],
            };
          }
          return c;
        }),
    [previewCurves, doc.view, size],
  );
  const {results:curveResults, pending:curvePending} = useCurveSampler(curves,curveMoving,doc.id);
  const scene = useMemo(
    () => sceneFor(doc, curveResults, size),
    [doc, curveResults, size],
  );
  const sceneText = scene.texts.map((t) => labelPlainText(t.text)).join("");
  useEffect(() => {
    if (!fontsReady) return;
    let active = true;
    const timer = setTimeout(() => {
      void invoke<string>("drawing_check_text", { text: sceneText })
        .then((e) => {
          if (active) setFontError(e);
        })
        .catch((e) => {
          if (active) setFontError(message(e));
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fontsReady, sceneText]);
  const save = useCallback(
    async (saveAs = false) => {
      if(updateLock.current)return false;
      flushEditor.current?.();
      if (saveLock.current) return false;
      saveLock.current = true;
      setBusy(true);
      try {
        if (legacy) saveAs = true;
        const content = stringify(docRef.current);
        const result = await adapter.save(
          content,
          fileRef.current.path,
          fileRef.current.hash,
          saveAs,
        );
        if (!result) return false;
        fileRef.current = { path: result.path, hash: result.hash };
        setFile(fileRef.current);
        savedText.current = content;
        setLegacy(false);
        sourceVersion.current = 3;
        setHistoryTick((t) => t + 1);
        await recoverSave();
        setStatus("已保存绘图文件");
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      } finally {
        saveLock.current = false;
        setBusy(false);
      }
    },
    [recoverSave, legacy],
  );
  const performIntent = useCallback(
    async (action: Intent, discard = false) => {
      if (action === "close" || action === "quit") {
        try {
          await recoverSave(discard);
          await invoke("drawing_finish_close", {
            exit: action === "quit",
            approved: true,
          });
        } catch (e) {
          closeLock.current = false;
          setError(message(e));
          if (action === "quit")
            await invoke("drawing_finish_close", {
              exit: true,
              approved: false,
            });
        }
        return;
      }
      if (action === "new" || action === "new2d" || action === "new3d") {
        const next = newDrawing();
        next.dimension =
          action === "new2d"
            ? "2d"
            : action === "new3d"
              ? "3d"
              : docRef.current.dimension;
        if (next.dimension === "3d") next.view.axes = false;
        install({ content: stringify(next), path: null, hash: null });
      } else {
        try {
          const opened = await adapter.open();
          if (opened) install(opened);
        } catch (e) {
          setError(message(e));
        }
      }
    },
    [recoverSave, install],
  );
  const requestIntent = useCallback(
    (action: Intent) => {
      if(updateLock.current)return;
      flushEditor.current?.();
      if (!readyRef.current) {
        setError("恢复草稿正在加载，请稍候");
        if (action === "quit")
          void invoke("drawing_finish_close", { exit: true, approved: false });
        return;
      }
      if (closeLock.current) {
        if (action === "quit" && intentRef.current) {
          intentRef.current = "quit";
          setIntent("quit");
        } else if (action === "quit")
          void invoke("drawing_finish_close", { exit: true, approved: false });
        return;
      }
      if (action === "close" || action === "quit") closeLock.current = true;
      if (
        stringify(docRef.current) !== savedText.current ||
        Object.keys(draftsRef.current).length
      ) {
        intentRef.current = action;
        setIntent(action);
      } else void performIntent(action);
    },
    [performIntent],
  );
  useEffect(() => {
    let cancelled = false;
    const stops: (() => void)[] = [];
    const setup = async () => {
      stops.push(
        await getCurrentWindow().onCloseRequested((event) => {
          event.preventDefault();
          if(!updateLock.current)requestIntent("close");
        }),
      );
      stops.push(
        await listen<boolean>("drawing-close-request", (e) =>
          {if(!updateLock.current)requestIntent(e.payload ? "quit" : "close");},
        ),
      );
      if (cancelled) stops.forEach((s) => s());
    };
    void setup();
    return () => {
      cancelled = true;
      stops.forEach((s) => s());
    };
  }, [requestIntent]);
  const keyRef = useRef({ save, requestIntent });
  keyRef.current = { save, requestIntent };
  useEffect(()=>{
    if(!ready)return;
    let stop:(()=>void)|undefined,cancelled=false;
    const act=(action:string)=>{if(action==="save"||action==="saveAs")void keyRef.current.save(action==="saveAs");else if(action==="new"||action==="open")keyRef.current.requestIntent(action);};
    void listen<string>("drawing-file-action",e=>act(e.payload)).then(async unlisten=>{
      if(cancelled){unlisten();return;}stop=unlisten;
      const pending=await invoke<string|null>("drawing_menu_ready");if(!cancelled&&pending)act(pending);
    }).catch(e=>setError(message(e)));
    return()=>{cancelled=true;stop?.();};
  },[ready]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        ["s", "o", "n"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        if (e.key.toLowerCase() === "s") void keyRef.current.save(e.shiftKey);
        else
          keyRef.current.requestIntent(
            e.key.toLowerCase() === "o" ? "open" : "new",
          );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const fit = () => {
    const points: Vec2[] = [];
    const objects = new Map(doc.objects.map(o => [o.id, o]));
    for (const p of currentDoc.points.values()) {
      const owner = p.object ?? objects.get(p.id.split(":")[0]);
      if (!owner || owner.hidden || currentDoc.errors.has(owner.id)) continue;
      if (owner.kind === "point" && owner.construction.type === "origin") continue;
      // Virtual anchors define an infinite line; they are not finite drawing extents.
      if (!p.object && owner.kind === "line") continue;
      points.push(project(p.p, doc));
    }
    for (const c of curveResults) {
      const o = doc.objects.find((o) => o.id === c.id);
      if (o?.kind === "curve" && !o.hidden && o.style.line !== "hidden" &&
        currentDoc.curves.has(o.id) && (!!o.parametric || !isLineEquation(currentDoc.curves.get(o.id)!.equation))) {
        const p = doc.planes.find((p) => p.id === o.planeId)!;
        for (const path of c.paths)
          for (const q of path) points.push(project(fromPlane(p, ...q), doc));
      }
    }
    points.push(...constraintLocusPoints(doc).map(p=>project(p,doc)));
    if (!points.length) {
      patchView({ scale: 48, center: [0, 0] });
      return;
    }
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      xmin = Math.min(...xs),
      xmax = Math.max(...xs),
      ymin = Math.min(...ys),
      ymax = Math.max(...ys);
    patchView({
      center: [(xmin + xmax) / 2, (ymin + ymax) / 2],
      scale: Math.max(
        2,
        Math.min(
          120,
          (size[0] - 100) / Math.max(2, xmax - xmin),
          (size[1] - 100) / Math.max(2, ymax - ymin),
        ),
      ),
    });
  };
  const exportDrawing = async (format: "svg" | "png" | "clipboard") => {
    flushEditor.current?.();
    if (docRef.current !== doc || curvePending) {
      setError("曲线正在计算，请稍候再导出");
      return;
    }
    if (fontError || !fontsReady) {
      setError(fontError || "字体正在加载");
      return;
    }
    if (curveResults.some((c) => c.error)) {
      setError("请先处理曲线计算错误");
      return;
    }
    setBusy(true);
    try {
      const measured = {
        ...scene,
        bounds: [...scene.bounds] as typeof scene.bounds,
      };
      svg.current
        ?.querySelectorAll<SVGTextElement>("[data-draw-text]")
        .forEach((text) => {
          const b = text.getBBox();
          measured.bounds = [
            Math.min(measured.bounds[0], b.x - 15),
            Math.max(measured.bounds[1], b.x + b.width + 15),
            Math.min(measured.bounds[2], b.y - 15),
            Math.max(measured.bounds[3], b.y + b.height + 15),
          ];
        });
      const result = await adapter.export(
        exportSvg(measured, doc, size),
        format,
        doc.output.width,
      );
      if (result)
        setStatus(
          format === "clipboard"
            ? "图片已复制，可粘贴到 Word 等软件"
            : `已导出到 ${result}`,
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const errors = [
    error,
    fontError,
    ...currentDoc.errors.values(),
    ...curveResults.flatMap((c) => (c.error ? [c.error] : [])),
  ].filter(Boolean);
  return (
    <div className="drawing-app">
      <UpdateNotice ready={ready} locked={value=>{updateLock.current=value;}} beforeInstall={async()=>{flushEditor.current?.();await recoverSave();}}/>

      <DrawingWorkbench
        key={doc.id}
        fileActions={<>
        <button
          onClick={() => void exportDrawing("clipboard")}
          disabled={busy || curvePending}
        >
          <Copy size={14} />
          复制图片
        </button>
        <details className="view-options drawing-export-menu">
          <summary><Download size={14} />导出 ▾</summary>
          <div onClick={e => { if ((e.target as HTMLElement).closest("button")) e.currentTarget.closest("details")?.removeAttribute("open"); }}>
            <button onClick={() => void exportDrawing("svg")} disabled={busy}>SVG 矢量图…</button>
            <button onClick={() => void exportDrawing("png")} disabled={busy}>PNG 图片…</button>
            <small>尺寸、背景与裁切在“属性 → 图面与导出”中调整</small>
          </div>
        </details>
        </>}
        doc={doc}
        scene={scene}
        curves={curveResults}
        size={size}
        ready={ready}
        fontsReady={fontsReady}
        pending={curvePending && !curveMoving}
        canvas={canvas}
        svg={svg}
        flush={flushEditor}
        change={commit}
        undo={undo}
        redo={redo}
        historyCount={historyTick >= 0 ? undoStack.current.length : 0}
        redoCount={redoStack.current.length}
        mode={(dimension) =>
          requestIntent(dimension === "2d" ? "new2d" : "new3d")
        }
        fit={fit}
        onError={setError}
        loadFonts={loadFonts}
        drafts={drafts}
        expressionPreview={expressionPreview}
        expressionProblem={expressionProblem}
        onDrafts={(next) => {
          draftsRef.current = next;
          setDrafts(next);
        }}
      />
      {errors.length > 0 && (
        <div className="draw-error" role="alert">
          <span>{[...new Set(errors)].slice(0, 3).join("；")}</span>
          <button onClick={() => setError("")} title="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      <footer className="draw-footer">
        <span>{status || "画布与表达式双向联动 · ⌘ / Ctrl + S 保存"}</span>
        <span>
          {Math.round((doc.view.scale / 48) * 100)}% · {doc.objects.length}{" "}
          个对象 · {dirty ? "草稿自动恢复" : "已保存"}
        </span>
      </footer>
      {intent && (
        <div className="draw-modal-shade">
          <div className="draw-modal" role="dialog" aria-label="保存绘图修改">
            <h2>保存绘图修改？</h2>
            <p>保存当前有效图形。未完成的表达式会单独保留在本机恢复草稿中。</p>
            <div className="draw-button-row">
              <button
                disabled={busy}
                onClick={() => {
                  setIntent(null);
                  intentRef.current = null;
                  closeLock.current = false;
                  void invoke("drawing_finish_close", {
                    exit: intent === "quit",
                    approved: false,
                  });
                }}
              >
                取消
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const action = intentRef.current!;
                  setIntent(null);
                  intentRef.current = null;
                  void performIntent(action, true);
                }}
              >
                放弃修改
              </button>
              <button
                className="draw-primary"
                disabled={busy}
                onClick={() => {
                  void save().then((ok) => {
                    if (ok) {
                      const action = intentRef.current!;
                      setIntent(null);
                      intentRef.current = null;
                      void performIntent(action);
                    } else {
                      closeLock.current = false;
                    }
                  });
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
