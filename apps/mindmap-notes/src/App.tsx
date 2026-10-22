import { pasteImage, finishImagePastes } from "./pasteImage";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Code2,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutPanelLeft,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sprout,
  Trash2,
  X,
  ArrowUpRight,
  CheckCircle2,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  RotateCcw,
  Pencil,
  FolderInput,
} from "lucide-react";
import {
  vault,
  sync,
  listTrash,
  restoreTrash,
  revealVault,
  closeVault,
  frontendReady,
  quitApp,
} from "./adapters";
import type {
  Bootstrap,
  CosConfig,
  MindmapDocument,
  NoteFormat,
  NoteRecord,
  TrashEntry,
  VaultEntry,
} from "./types";
import { mapToMarkdown, markdownToMap, parseMap } from "./outline";
import Markdown from "./Markdown";
import { DocumentHistory } from "./history";
import FileExplorer, { type InlineEdit } from "./FileExplorer";
import ContextMenu, { type MenuAction } from "./ContextMenu";
import Splitter from "./Splitter";
import MindmapEditor from "./MindmapEditor";

const modifier = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";
const parent = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
const displayName = (path: string) =>
  baseName(path).replace(/\.mindmap\.json$|\.md$/gi, "");
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const initial = ref.current?.querySelector<HTMLElement>(
      'input:not([type="checkbox"]),textarea,select',
    );
    (initial ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,[tabindex="0"]',
          ) ?? []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`dialog ${wide ? "wide-dialog" : ""}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <IconButton title="关闭" onClick={close}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
function SettingsDialog({
  connection,
  stored,
  close,
  saved,
}: {
  connection: CosConfig | null;
  stored: boolean;
  close: () => void;
  saved: (c: CosConfig | null) => void;
}) {
  const [form, setForm] = useState<CosConfig>(
    connection ?? {
      accessKeyId: "",
      bucket: "",
      region: "ap-guangzhou",
      prefix: "mindgrove/personal",
      autoSync: true,
    },
  );
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [success, setSuccess] = useState(false);
  const save = async (test: boolean) => {
    setBusy(true);
    setResult("");
    try {
      await sync.save(form, secret || undefined);
      saved(form);
      setSecret("");
      if (test) {
        const count = await sync.test();
        setResult(
          `连接成功，发现 ${count} 条云端版本记录。读写权限将在首次同步时确认。`,
        );
      } else setResult("同步设置已保存，密钥由系统凭据库保管。");
      setSuccess(true);
    } catch (e) {
      setResult(message(e));
      setSuccess(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="云同步设置" close={close}>
      <div className="dialog-body">
        <div className="settings-intro">
          <Cloud size={22} />
          <div>
            <strong>连接你自己的腾讯云 COS</strong>
            <p>笔记保存在本机，云端连接其他设备的同一个笔记库。</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <label>
            AccessKey ID
            <input
              autoComplete="off"
              spellCheck={false}
              value={form.accessKeyId}
              onChange={(e) =>
                setForm({ ...form, accessKeyId: e.target.value.trim() })
              }
              placeholder="腾讯云 SecretId / AccessKey ID"
            />
          </label>
          <label>
            SecretAccessKey
            <span className="field-aside">
              {stored
                ? "已存入系统凭据库，留空则保留"
                : "仅保存在这台电脑的系统凭据库"}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                stored ? "•••••••• 已保存" : "填写 SecretKey / SecretAccessKey"
              }
            />
          </label>
          <div className="form-grid">
            <label>
              地域
              <input
                spellCheck={false}
                value={form.region}
                onChange={(e) =>
                  setForm({ ...form, region: e.target.value.trim() })
                }
                placeholder="ap-guangzhou"
              />
            </label>
            <label>
              存储桶
              <input
                spellCheck={false}
                value={form.bucket}
                onChange={(e) =>
                  setForm({ ...form, bucket: e.target.value.trim() })
                }
                placeholder="my-notes-1250000000"
              />
            </label>
          </div>
          <label>
            同步前缀
            <input
              spellCheck={false}
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              placeholder="mindgrove/personal"
            />
          </label>
          <p className="field-note">
            其他电脑填写同一存储桶和前缀即可同步。请给此应用使用的密钥授予该前缀的列举、读取和写入权限，并保持存储桶私有。
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.autoSync}
              onChange={(e) => setForm({ ...form, autoSync: e.target.checked })}
            />
            自动同步<span>保存后与每 30 秒检查云端变化</span>
          </label>
          {result && (
            <div
              className={success ? "inline-success" : "inline-error"}
              role="status"
            >
              {result}
            </div>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="text-danger"
              disabled={busy || !connection}
              onClick={async () => {
                setBusy(true);
                try {
                  await sync.forget();
                  saved(null);
                  setResult("已断开连接。本地笔记和云端版本均已保留。");
                  setSuccess(true);
                } catch (e) {
                  setResult(message(e));
                  setSuccess(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              断开连接
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              保存并检查
            </button>
            <button className="primary" disabled={busy} type="submit">
              保存设置
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
type Dialog =
  | { kind: "create"; format: NoteFormat | "folder"; dir?: string }
  | { kind: "rename" | "move" | "trash" | "actions"; entry: VaultEntry }
  | { kind: "settings" | "trash-list" | "convert" | "export" | "vault" }
  | null;

function savedWidth(key: string, fallback: number) {
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [entries, setEntries] = useState<VaultEntry[]>([]),
    [note, setNote] = useState<NoteRecord | null>(null),
    [content, setContent] = useState("");
  const [query, setQuery] = useState(""),
    [found, setFound] = useState<Set<string> | null>(null),
    [folder, setFolder] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null),
    [dialogName, setDialogName] = useState(""),
    [dialogFolder, setDialogFolder] = useState(""),
    [dialogError, setDialogError] = useState(""),
    [dialogBusy, setDialogBusy] = useState(false),
    [trashItems, setTrashItems] = useState<TrashEntry[]>([]),
    [preview, setPreview] = useState<MindmapDocument | null>(null);
  const [saveState, setSaveState] = useState("已保存在本机"),
    [saveError, setSaveError] = useState(""),
    [externalWarning, setExternalWarning] = useState(false),
    [syncing, setSyncing] = useState(false),
    [syncState, setSyncState] = useState("尚未连接云端"),
    [syncError, setSyncError] = useState(false),
    [toast, setToast] = useState("");
  const [markdownView, setMarkdownView] = useState<
      "edit" | "split" | "preview"
    >("split"),
    [showList, setShowList] = useState(
      () => localStorage.getItem("mindgrove:showList") !== "false",
    ),
    [historyTick, setHistoryTick] = useState(0);
  const [showSidebar, setShowSidebar] = useState(
    () => localStorage.getItem("mindgrove:showSidebar") !== "false",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    savedWidth("mindgrove:sidebarWidth", 236),
  );
  const [listWidth, setListWidth] = useState(() =>
    savedWidth("mindgrove:listWidth", 220),
  );
  const [markdownRatio, setMarkdownRatio] = useState(() =>
    Math.max(20, Math.min(80, savedWidth("mindgrove:markdownRatio", 50))),
  );
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [treeSelection, setTreeSelection] = useState<{ path: string } | null>(
    null,
  );
  const [inlineBusy, setInlineBusy] = useState(false),
    [inlineError, setInlineError] = useState("");
  const [context, setContext] = useState<{
    x: number;
    y: number;
    entry?: VaultEntry;
    dir: string;
  } | null>(null);
  const closeContext = useCallback(() => setContext(null), []);
  const restoreWorkspace = useCallback(() => {
    setShowSidebar(true);
    setShowList(true);
    setSidebarWidth(236);
    setListWidth(220);
    setMarkdownRatio(50);
  }, []);
  useEffect(() => {
    let canceled = false;
    let stop: (() => void) | undefined;
    void listen<string>("workspace-action", ({ payload }) => {
      if (payload === "toggle-sidebar") setShowSidebar((visible) => !visible);
      else if (payload === "toggle-list") setShowList((visible) => !visible);
      else if (payload === "restore-layout") restoreWorkspace();
    }).then((unlisten) => {
      if (canceled) unlisten();
      else stop = unlisten;
    });
    return () => {
      canceled = true;
      stop?.();
    };
  }, [restoreWorkspace]);
  useEffect(() => {
    for (const [key, value] of Object.entries({
      showSidebar,
      showList,
      sidebarWidth,
      listWidth,
      markdownRatio,
    }))
      localStorage.setItem(`mindgrove:${key}`, String(value));
  }, [showSidebar, showList, sidebarWidth, listWidth, markdownRatio]);
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const paneSpace =
    windowWidth - 420 - (showSidebar ? 6 : 0) - (showList ? 6 : 0);
  const sidebarSize = Math.min(
    Math.max(180, sidebarWidth),
    Math.max(180, paneSpace - (showList ? 180 : 0)),
  );
  const listSize = Math.min(
    Math.max(180, listWidth),
    Math.max(180, paneSpace - (showSidebar ? sidebarSize : 0)),
  );
  const previewContent = useDeferredValue(content);
  const noteRef = useRef<NoteRecord | null>(null),
    contentRef = useRef(""),
    dirtyRef = useRef(false),
    nodeEditingRef = useRef(false),
    saveBlocked = useRef(false),
    writing = useRef(false),
    syncBusy = useRef(false),
    saveQueue = useRef<Promise<void>>(Promise.resolve()),
    queryRef = useRef("");
  const history = useRef(new DocumentHistory()),
    loadId = useRef(0),
    search = useRef<HTMLInputElement>(null),
    syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    runSyncRef = useRef<() => Promise<void>>(async () => {});
  const closeDialog = useCallback(() => setDialog(null), []);
  const onNodeEditingChange = useCallback((active: boolean) => {
    nodeEditingRef.current = active;
  }, []);
  const reportError = useCallback((e: unknown) => setToast(message(e)), []);
  const refresh = useCallback(async () => {
    const list = await vault.list();
    setEntries(list);
    if (queryRef.current.trim()) {
      const matching = await vault.list(queryRef.current);
      setFound(new Set(matching.map((e) => e.path)));
    }
  }, []);
  const installNote = useCallback((n: NoteRecord | null) => {
    noteRef.current = n;
    contentRef.current = n?.content ?? "";
    dirtyRef.current = false;
    saveBlocked.current = false;
    setNote(n);
    setContent(n?.content ?? "");
    setSaveError("");
    setExternalWarning(false);
    setSaveState("已保存在本机");
    history.current.activate(
      n?.format === "mindmap" ? n.path : null,
      n?.content ?? "",
    );
    setHistoryTick((t) => t + 1);
  }, []);
  const flush = useCallback((): Promise<void> => {
    const task = async () => {
      await finishImagePastes();
      const n = noteRef.current;
      if (!n || !dirtyRef.current) return;
      if (saveBlocked.current)
        throw new Error("请先处理文件冲突或将当前内容保存为副本");
      const text = contentRef.current;
      writing.current = true;
      setSaveState("正在保存…");
      try {
        const written = await vault.write(n, text);
        if (noteRef.current?.path === n.path) {
          noteRef.current = written;
          setNote(written);
          dirtyRef.current = contentRef.current !== text;
          setSaveState(dirtyRef.current ? "等待保存…" : "已保存在本机");
          setSaveError("");
          setExternalWarning(false);
        }
        clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => void runSyncRef.current(), 2000);
      } catch (e) {
        saveBlocked.current = true;
        setSaveState("保存未完成");
        setSaveError(message(e));
        throw e;
      } finally {
        writing.current = false;
      }
    };
    const operation = saveQueue.current.then(task);
    saveQueue.current = operation.catch(() => {});
    return operation;
  }, []);
  const openNote = useCallback(
    async (path: string) => {
      const id = ++loadId.current;
      try {
        await flush();
        const n = await vault.read(path);
        if (id !== loadId.current) return;
        installNote(n);
        localStorage.setItem("mindgrove:lastNote", path);
      } catch (e) {
        reportError(e);
      }
    },
    [flush, installNote, reportError],
  );
  const setDraft = useCallback((value: string, record = true) => {
    if (value === contentRef.current) return;
    if (noteRef.current?.format === "mindmap") {
      history.current.record(value, record);
      setHistoryTick((t) => t + 1);
    }
    contentRef.current = value;
    dirtyRef.current = value !== noteRef.current?.content;
    setContent(value);
    setSaveState(dirtyRef.current ? "等待保存…" : "已保存在本机");
  }, []);
  const undo = useCallback(() => {
    const value = history.current.undo();
    if (value !== undefined) {
      setDraft(value, false);
      setHistoryTick((t) => t + 1);
    }
  }, [setDraft]);
  const redo = useCallback(() => {
    const value = history.current.redo();
    if (value !== undefined) {
      setDraft(value, false);
      setHistoryTick((t) => t + 1);
    }
  }, [setDraft]);
  useEffect(() => {
    void vault
      .bootstrap()
      .then((data) => {
        setBoot(data);
        setEntries(data.entries);
        setSyncState(data.connection ? "云端已连接" : "尚未连接云端");
        const recent = localStorage.getItem("mindgrove:lastNote");
        const first =
          data.entries.find((e) => e.path === recent) ??
          data.entries.find((e) => e.kind !== "folder");
        if (first && first.kind !== "folder") void openNote(first.path);
      })
      .catch(reportError);
  }, [openNote, reportError]);
  useEffect(() => {
    if (!dirtyRef.current || saveBlocked.current) return;
    const timer = setTimeout(() => void flush().catch(() => {}), 650);
    return () => clearTimeout(timer);
  }, [content, flush]);
  useEffect(() => {
    queryRef.current = query;
    let canceled = false;
    if (!query.trim()) {
      setFound(null);
      return;
    }
    const t = setTimeout(
      () =>
        void vault
          .list(query)
          .then((result) => {
            if (!canceled) setFound(new Set(result.map((e) => e.path)));
          })
          .catch(reportError),
      250,
    );
    return () => {
      canceled = true;
      clearTimeout(t);
    };
  }, [query, reportError]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let canceled = false;
    const setup = async () => {
      const unlisten = await listen("vault-changed", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refresh().catch(reportError);
          const current = noteRef.current;
          if (current && !writing.current)
            void vault
              .read(current.path)
              .then((n) => {
                if (
                  noteRef.current?.path !== current.path ||
                  n.hash === noteRef.current.hash
                )
                  return;
                if (dirtyRef.current || nodeEditingRef.current)
                  setExternalWarning(true);
                else installNote(n);
              })
              .catch(() => {
                if (dirtyRef.current || nodeEditingRef.current)
                  setExternalWarning(true);
                else installNote(null);
              });
        }, 350);
      });
      const stopError = await listen<string>("vault-watch-error", (e) =>
        setToast(e.payload),
      );
      if (canceled) {
        unlisten();
        stopError();
      }
      return () => {
        unlisten();
        stopError();
      };
    };
    let stop: (() => void) | undefined;
    void setup()
      .then((fn) => {
        stop = fn;
      })
      .catch(() => {});
    return () => {
      canceled = true;
      stop?.();
      clearTimeout(timer);
    };
  }, [refresh, installNote, reportError]);
  useEffect(() => {
    let stops: (() => void)[] = [];
    let canceled = false;
    let closing = false;
    const requestQuit = async () => {
      if (closing) return;
      closing = true;
      try {
        // Let native paste/input events finish before taking the final snapshot.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        await finishImagePastes();
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        do {
          await flush();
        } while (dirtyRef.current);
        await quitApp();
      } catch {
        closing = false;
        setToast("当前编辑尚未保存，请先处理保存提示。");
      }
    };
    const setup = async () => {
      stops.push(
        await getCurrentWindow().onCloseRequested((event) => {
          event.preventDefault();
          void requestQuit();
        }),
      );
      stops.push(await listen("app-exit-requested", () => void requestQuit()));
      stops.push(
        await listen("app-exit-cancelled", () => {
          closing = false;
        }),
      );
      stops.push(
        await listen<string>("drawing-open-error", (e) => setToast(e.payload)),
      );
      if (canceled) stops.forEach((stop) => stop());
      else await frontendReady();
    };
    void setup().catch(() => setToast("退出保护未能初始化，请保存后再退出。"));
    return () => {
      canceled = true;
      stops.forEach((stop) => stop());
    };
  }, [flush]);
  const runSync = useCallback(
    async (manual = true) => {
      if (
        syncBusy.current ||
        !boot?.vaultPath ||
        !boot.connection ||
        (!manual && !boot.connection.autoSync)
      )
        return;
      syncBusy.current = true;
      setSyncing(true);
      setSyncError(false);
      setSyncState("正在同步…");
      try {
        await flush();
        const result = await sync.run();
        setSyncState(
          `已同步 · ${new Date(result.lastSync).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
        );
        if (result.conflicts)
          setToast(
            `已保留 ${result.conflicts} 份冲突副本，可在笔记列表中查看。`,
          );
        else if (result.deferred)
          setToast("有正在编辑的文件，将在下次同步中处理。");
        else if (manual)
          setToast(
            `同步完成：上传 ${result.uploaded} 个版本，更新 ${result.downloaded} 项。`,
          );
        await refresh();
        const current = noteRef.current;
        if (current && !dirtyRef.current && !nodeEditingRef.current) {
          try {
            const n = await vault.read(current.path);
            if (n.hash !== current.hash) installNote(n);
          } catch {
            installNote(null);
          }
        }
      } catch (e) {
        setSyncState(message(e));
        setSyncError(true);
        if (manual) reportError(e);
      } finally {
        syncBusy.current = false;
        setSyncing(false);
      }
    },
    [boot, flush, refresh, installNote, reportError],
  );
  useEffect(() => {
    runSyncRef.current = () => runSync(false);
  }, [runSync]);
  useEffect(() => {
    if (!boot?.connection?.autoSync || !boot.vaultPath) return;
    const first = setTimeout(() => void runSync(false), 1000);
    const interval = setInterval(() => void runSync(false), 30000);
    const online = () => void runSync(false);
    window.addEventListener("online", online);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      window.removeEventListener("online", online);
    };
  }, [boot?.connection, boot?.vaultPath, runSync]);
  const chooseVault = async () => {
    try {
      await flush();
      const path = await vault.choose();
      if (!path) return;
      const list = await vault.open(path);
      const fresh = await vault.bootstrap();
      setEntries(list);
      history.current.clear();
      setBoot(fresh);
      setSyncState(fresh.connection ? "云端已连接" : "尚未连接云端");
      setSyncError(false);
      installNote(null);
      setInline(null);
      setTreeSelection(null);
      setContext(null);
      setCollapsed(new Set());
      setFolder(null);
      setQuery("");
      const first = list.find((e) => e.kind !== "folder");
      if (first) void openNote(first.path);
    } catch (e) {
      reportError(e);
    }
  };
  const showDialog = useCallback(
    (value: NonNullable<Dialog>) => {
      if (value.kind === "create" || value.kind === "rename") {
        setDialog(null);
        setShowSidebar(true);
        setInlineError("");
        setInline(
          value.kind === "create"
            ? {
                kind: "create",
                dir:
                  value.dir ??
                  folder ??
                  (noteRef.current ? parent(noteRef.current.path) : ""),
                format: value.format,
              }
            : { kind: "rename", entry: value.entry },
        );
        return;
      }
      setDialogName("");
      setDialogFolder(
        folder ?? (noteRef.current ? parent(noteRef.current.path) : ""),
      );
      setDialogError("");
      if ("entry" in value) {
        setDialogName(
          value.entry.kind === "folder"
            ? value.entry.name
            : displayName(value.entry.path),
        );
        setDialogFolder(parent(value.entry.path));
      }
      if (value.kind === "trash-list")
        void listTrash().then(setTrashItems).catch(reportError);
      if (value.kind === "convert" && noteRef.current) {
        try {
          setPreview(markdownToMap(contentRef.current, noteRef.current.title));
          setDialogName(`${noteRef.current.title} · 导图`);
        } catch (e) {
          setDialogError(message(e));
        }
      }
      if (value.kind === "export" && noteRef.current)
        setDialogName(`${noteRef.current.title} · 大纲`);
      setDialog(value);
    },
    [folder, reportError],
  );
  const relocate = async (entry: VaultEntry, destination: string) => {
    await flush();
    if (entry.path === destination) return;
    const previous = noteRef.current;
    const path = await vault.relocate(entry.path, destination);
    await refresh();
    setTreeSelection({ path });
    if (
      previous &&
      (previous.path === entry.path ||
        previous.path.startsWith(entry.path + "/"))
    )
      await openNote(path + previous.path.slice(entry.path.length));
    if (
      folder !== null &&
      (folder === entry.path || folder.startsWith(entry.path + "/"))
    )
      setFolder(path + folder.slice(entry.path.length));
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSyncRef.current(), 1500);
  };
  const submitInline = async (name: string) => {
    if (!inline || inlineBusy) return;
    setInlineBusy(true);
    setInlineError("");
    try {
      const format =
        inline.kind === "create" ? inline.format : inline.entry.kind;
      const clean =
        format === "markdown"
          ? name.replace(/\.md$/i, "")
          : format === "mindmap"
            ? name.replace(/\.mindmap\.json$/i, "")
            : name;
      if (inline.kind === "create") {
        await flush();
        const path = await vault.create(inline.dir, clean, inline.format);
        await refresh();
        setTreeSelection({ path });
        setQuery("");
        setFolder(inline.dir);
        if (inline.format === "folder") setFolder(path);
        else {
          await openNote(path);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(
                ".main-panel .markdown-source, .main-panel .flow-canvas",
              )
              ?.focus(),
          );
        }
      } else {
        const ext =
          format === "folder"
            ? ""
            : format === "markdown"
              ? ".md"
              : ".mindmap.json";
        await relocate(
          inline.entry,
          `${parent(inline.entry.path) ? parent(inline.entry.path) + "/" : ""}${clean}${ext}`,
        );
      }
      setInline(null);
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void runSyncRef.current(), 1500);
    } catch (e) {
      setInlineError(message(e));
    } finally {
      setInlineBusy(false);
    }
  };
  const showEntryMenu = (event: MouseEvent, entry?: VaultEntry, dir = "") => {
    event.preventDefault();
    event.stopPropagation();
    setContext({
      x: event.clientX,
      y: event.clientY,
      entry,
      dir:
        entry?.kind === "folder"
          ? entry.path
          : entry
            ? parent(entry.path)
            : dir,
    });
  };
  const createOrChange = async () => {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      await flush();
      const previousNote = noteRef.current;
      let path: string | null = null;
      if (dialog.kind === "create")
        path = await vault.create(
          dialogFolder,
          dialogName.trim(),
          dialog.format,
        );
      if (dialog.kind === "rename") {
        const ext =
          dialog.entry.kind === "folder"
            ? ""
            : dialog.entry.kind === "markdown"
              ? ".md"
              : ".mindmap.json";
        const destination = `${parent(dialog.entry.path) ? parent(dialog.entry.path) + "/" : ""}${dialogName.trim()}${ext}`;
        if (destination !== dialog.entry.path)
          path = await vault.relocate(dialog.entry.path, destination);
        else path = destination;
      }
      if (dialog.kind === "move")
        path = await vault.relocate(
          dialog.entry.path,
          `${dialogFolder ? dialogFolder + "/" : ""}${baseName(dialog.entry.path)}`,
        );
      if (dialog.kind === "trash") {
        await vault.trash(dialog.entry.path);
        if (
          noteRef.current &&
          (noteRef.current.path === dialog.entry.path ||
            noteRef.current.path.startsWith(dialog.entry.path + "/"))
        )
          installNote(null);
        if (
          folder === dialog.entry.path ||
          folder?.startsWith(dialog.entry.path + "/")
        )
          setFolder(null);
      }
      if (dialog.kind === "convert") {
        if (!preview) throw new Error("无法转换这份 Markdown");
        const doc =
          preview.outlineDraft !== undefined
            ? markdownToMap(preview.outlineDraft, dialogName)
            : preview;
        path = await vault.create(
          dialogFolder,
          dialogName.trim(),
          "mindmap",
          JSON.stringify({ ...doc, id: crypto.randomUUID() }),
        );
      }
      if (dialog.kind === "export") {
        const doc = parseMap(contentRef.current);
        path = await vault.create(
          dialogFolder,
          dialogName.trim(),
          "markdown",
          doc.outlineDraft ?? mapToMarkdown(doc),
        );
      }
      await refresh();
      if (
        path &&
        !(
          (dialog.kind === "create" ||
            dialog.kind === "rename" ||
            dialog.kind === "move") &&
          ("format" in dialog ? dialog.format : dialog.entry.kind) === "folder"
        )
      )
        await openNote(path);
      else if (path) {
        setFolder(path);
        if (
          (dialog.kind === "rename" || dialog.kind === "move") &&
          previousNote?.path.startsWith(dialog.entry.path + "/")
        )
          await openNote(
            path + previousNote.path.slice(dialog.entry.path.length),
          );
      }
      closeDialog();
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void runSyncRef.current(), 1500);
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setDialogBusy(false);
    }
  };
  const saveCopy = async () => {
    const n = noteRef.current;
    if (!n) return;
    try {
      const copyName = `${n.title} (本地副本-${Date.now().toString().slice(-6)})`;
      const path = await vault.create(
        parent(n.path),
        copyName,
        n.format,
        contentRef.current,
      );
      installNote(await vault.read(path));
      await refresh();
      setToast("当前编辑已保存为独立副本。");
    } catch (e) {
      reportError(e);
    }
  };
  const starter = async () => {
    try {
      const dir = await vault.create("", "开始使用", "folder");
      await vault.create(
        dir,
        "欢迎来到枝间",
        "markdown",
        "# 欢迎来到枝间\n\n把零散的想法，慢慢连接成自己的知识。\n\n## 从这里开始\n\n- 在左侧建立文件夹，组织你的笔记。\n- 用 **Markdown** 安静书写，或选择思维导图梳理层级。\n- 文本大纲和导图可以随时切换。\n\n## 公式也有自己的位置\n\n节点支持 LaTeX，例如 $E=mc^2$，以及块级公式：\n\n$$\n\\int_a^b f(x)\\,dx = F(b)-F(a)\n$$\n\n所有内容先保存在你选择的本地文件夹里。配置 COS 后，就能在其他电脑继续思考。",
      );
      const doc = markdownToMap(
        "# 思考的枝叶\n## 捕捉灵感\n- 随手记录\n- 把问题写下来\n## 构建知识\n- 建立主题\n  - 串联概念\n  - 保留出处\n## 数学与推导\n- 欧拉恒等式 $e^{i\\pi}+1=0$\n- 迭代更新 $x_{n+1}=x_n-\\eta\\nabla f(x_n)$\n## 从文字到图景\n- 输入 Markdown 大纲\n- 一键切换导图\n- 让思路自然展开",
      );
      const path = await vault.create(
        dir,
        "思考的枝叶",
        "mindmap",
        JSON.stringify(doc),
      );
      await refresh();
      await openNote(path);
      setToast("示例笔记已加入本地文件夹。");
    } catch (e) {
      reportError(e);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush().catch(reportError);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSidebar(true);
        requestAnimationFrame(() => search.current?.focus());
      } else if (e.key.toLowerCase() === "b" && e.shiftKey) {
        e.preventDefault();
        setShowSidebar((visible) => !visible);
      } else if (e.key.toLowerCase() === "l" && e.shiftKey) {
        e.preventDefault();
        setShowList((visible) => !visible);
      } else if (e.code === "Digit0" && e.shiftKey) {
        e.preventDefault();
        restoreWorkspace();
      } else if (e.key.toLowerCase() === "n" && boot?.vaultPath) {
        e.preventDefault();
        showDialog({
          kind: "create",
          format: e.shiftKey ? "mindmap" : "markdown",
        });
      } else if (e.key === ",") {
        e.preventDefault();
        showDialog({ kind: "settings" });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [boot?.vaultPath, flush, reportError, showDialog, restoreWorkspace]);
  const folders = entries.filter((e) => e.kind === "folder");
  const notes = entries.filter((e) => e.kind !== "folder");
  const visible = notes
    .filter((e) =>
      found
        ? found.has(e.path)
        : folder === null ||
          (e.path.startsWith(folder ? folder + "/" : "") &&
            parent(e.path) === folder),
    )
    .sort((a, b) => b.modified - a.modified);
  const parsed = useMemo(() => {
    if (note?.format !== "mindmap") return { doc: null, error: "" };
    try {
      return { doc: parseMap(content), error: "" };
    } catch (e) {
      return { doc: null, error: message(e) };
    }
  }, [note?.format, content]);
  const folderOptions = (exclude?: string) => (
    <>
      <option value="">笔记库根目录</option>
      {folders
        .filter(
          (f) =>
            !exclude ||
            (f.path !== exclude && !f.path.startsWith(exclude + "/")),
        )
        .map((f) => (
          <option key={f.path} value={f.path}>
            {f.path}
          </option>
        ))}
    </>
  );
  const activeEntry = note ? entries.find((e) => e.path === note.path) : null;
  const menuActions: MenuAction[] = context
    ? [
        ...(context.entry && context.entry.kind !== "folder"
          ? [
              {
                label: "打开笔记",
                icon: <FileText size={15} />,
                run: () => void openNote(context.entry!.path),
              },
            ]
          : []),
        {
          label: "新建 Markdown 笔记",
          icon: <Plus size={15} />,
          shortcut: `${modifier} N`,
          run: () =>
            showDialog({
              kind: "create",
              format: "markdown",
              dir: context.dir,
            }),
        },
        {
          label: "新建思维导图",
          icon: <Network size={15} />,
          shortcut: `${modifier} ⇧ N`,
          run: () =>
            showDialog({ kind: "create", format: "mindmap", dir: context.dir }),
        },
        {
          label: "新建文件夹",
          icon: <FolderPlus size={15} />,
          run: () =>
            showDialog({ kind: "create", format: "folder", dir: context.dir }),
        },
        ...(context.entry
          ? [
              {
                label: "重命名",
                icon: <Pencil size={15} />,
                shortcut: "F2",
                separator: true,
                run: () =>
                  showDialog({ kind: "rename", entry: context.entry! }),
              },
              {
                label: "移动到…",
                icon: <FolderInput size={15} />,
                run: () => showDialog({ kind: "move", entry: context.entry! }),
              },
              {
                label: "移到回收站",
                icon: <Trash2 size={15} />,
                shortcut: "Delete",
                danger: true,
                separator: true,
                run: () => showDialog({ kind: "trash", entry: context.entry! }),
              },
            ]
          : [
              {
                label: "在系统文件夹中显示",
                icon: <FolderOpen size={15} />,
                separator: true,
                run: () => void revealVault().catch(reportError),
              },
            ]),
      ]
    : [];
  return (
    <div className="app-shell">
      {showSidebar && (
        <>
          <aside className="sidebar" style={{ width: sidebarSize }}>
            <div className="brand">
              <div className="brand-mark">
                <Sprout size={25} strokeWidth={1.65} />
              </div>
              <div>
                <strong>枝间</strong>
                <span>MINDGROVE</span>
              </div>
              <IconButton
                title="收起目录侧栏"
                onClick={() => setShowSidebar(false)}
              >
                <PanelLeftClose size={16} />
              </IconButton>
            </div>
            <button
              className="new-note-button"
              disabled={!boot?.vaultPath}
              onClick={() => showDialog({ kind: "create", format: "markdown" })}
            >
              <Plus size={18} />
              新建笔记<span>{modifier} N</span>
            </button>
            <div className="search-box">
              <Search size={15} />
              <input
                ref={search}
                placeholder="搜索笔记"
                aria-label="搜索笔记内容"
                disabled={!boot?.vaultPath}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span>{modifier} K</span>
              {query && (
                <button aria-label="清空搜索" onClick={() => setQuery("")}>
                  <X size={12} />
                </button>
              )}
            </div>
            <nav className="quick-nav">
              <button
                className={folder === null ? "active" : ""}
                onClick={() => {
                  setFolder(null);
                  setQuery("");
                }}
              >
                <BookOpen size={17} />
                所有笔记<span>{notes.length}</span>
              </button>
              <button
                onClick={() => showDialog({ kind: "trash-list" })}
                disabled={!boot?.vaultPath}
              >
                <Trash2 size={17} />
                回收站
              </button>
            </nav>
            <FileExplorer
              entries={entries}
              activePath={note?.path}
              selection={treeSelection}
              folder={folder}
              enabled={!!boot?.vaultPath}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              inline={inline}
              busy={inlineBusy}
              error={inlineError}
              onCancel={() => {
                if (!inlineBusy) setInline(null);
              }}
              onSubmit={(name) => void submitInline(name)}
              onOpen={(entry) => {
                if (entry.kind === "folder") {
                  setFolder(entry.path);
                  setQuery("");
                } else {
                  setFolder(parent(entry.path));
                  setQuery("");
                  void openNote(entry.path);
                }
              }}
              onFolder={(path) => {
                setFolder(path);
                setQuery("");
              }}
              onCreate={(dir, format) =>
                showDialog({ kind: "create", dir, format })
              }
              onRename={(entry) => showDialog({ kind: "rename", entry })}
              onDelete={(entry) => showDialog({ kind: "trash", entry })}
              onMenu={showEntryMenu}
              onMove={(entry, dir) =>
                void relocate(
                  entry,
                  `${dir ? dir + "/" : ""}${baseName(entry.path)}`,
                ).catch(reportError)
              }
            />
            <div className="sidebar-bottom">
              <div className="sync-card">
                <div className={`sync-symbol ${syncError ? "failed" : ""}`}>
                  {syncing ? (
                    <RefreshCw size={18} className="spin" />
                  ) : boot?.connection ? (
                    <Cloud size={20} />
                  ) : (
                    <CloudOff size={20} />
                  )}
                </div>
                <div>
                  <strong>
                    {syncing
                      ? "正在同步"
                      : syncError
                        ? "同步需要处理"
                        : boot?.connection
                          ? "腾讯云 COS"
                          : "本地笔记库"}
                  </strong>
                  <span title={syncState}>{syncState}</span>
                </div>
                <IconButton
                  title={boot?.connection ? "立即同步" : "设置云同步"}
                  disabled={syncing}
                  onClick={() =>
                    boot?.connection
                      ? void runSync()
                      : showDialog({ kind: "settings" })
                  }
                >
                  <RefreshCw size={15} />
                </IconButton>
              </div>
              <button
                className="vault-picker"
                onClick={() =>
                  boot?.vaultPath
                    ? showDialog({ kind: "vault" })
                    : void chooseVault()
                }
              >
                <span className="vault-avatar">
                  <Sprout size={16} />
                </span>
                <span>
                  <strong>
                    {boot?.vaultPath
                      ? baseName(boot.vaultPath)
                      : "选择本地笔记库"}
                  </strong>
                  <small>
                    {boot?.vaultPath ? "切换笔记库" : "你的想法，留在你的电脑"}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              <div className="sidebar-bottom-actions">
                <button onClick={() => showDialog({ kind: "settings" })}>
                  <Settings2 size={14} />
                  设置
                </button>
                <button
                  disabled={!boot?.vaultPath}
                  onClick={() => void revealVault().catch(reportError)}
                >
                  <FolderOpen size={14} />
                  打开文件夹
                  <ArrowUpRight size={12} />
                </button>
              </div>
            </div>
          </aside>
          <Splitter
            label="调整目录侧栏宽度"
            value={sidebarSize}
            min={180}
            max={Math.min(420, paneSpace - (showList ? listSize : 0))}
            reset={236}
            onChange={setSidebarWidth}
          />
        </>
      )}
      {showList && (
        <>
          <aside
            className="note-list"
            style={{ width: listSize }}
            onContextMenu={(e) =>
              showEntryMenu(
                e,
                undefined,
                folder ?? (note ? parent(note.path) : ""),
              )
            }
          >
            <header>
              <div>
                <h2>
                  {query
                    ? "搜索结果"
                    : folder === null
                      ? "所有笔记"
                      : folder
                        ? baseName(folder)
                        : "根目录"}
                </h2>
                <span>{visible.length} 篇笔记</span>
              </div>
              <IconButton
                title="刷新笔记库"
                disabled={!boot?.vaultPath}
                onClick={() => void refresh().catch(reportError)}
              >
                <RefreshCw size={15} />
              </IconButton>
            </header>
            <div className="list-sort">
              <span>{query ? `内容包含 “${query}”` : "最近修改"}</span>
              <ChevronDown size={12} />
            </div>
            <div className="note-cards">
              {visible.map((e) => (
                <div
                  className={`note-card ${note?.path === e.path ? "selected" : ""}`}
                  key={e.path}
                  onContextMenu={(event) => showEntryMenu(event, e)}
                >
                  <button
                    className="note-open"
                    onClick={() => void openNote(e.path)}
                  >
                    <span className={`note-type-icon ${e.kind}`}>
                      {e.kind === "mindmap" ? (
                        <Network size={17} />
                      ) : (
                        <FileText size={17} />
                      )}
                    </span>
                    <strong>{displayName(e.path)}</strong>
                    <span className="note-summary">
                      {e.kind === "mindmap" ? "思维导图" : "Markdown"}
                      <i />
                      {parent(e.path) ? baseName(parent(e.path)) : "根目录"}
                    </span>
                    <time>
                      {new Date(e.modified).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </button>
                  <button
                    className="card-more"
                    aria-label={`管理笔记 ${displayName(e.path)}`}
                    onClick={(event) => showEntryMenu(event, e)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              ))}
              {!visible.length && (
                <div className="list-empty">
                  <FileText size={26} strokeWidth={1} />
                  <p>{query ? "没有找到匹配的笔记" : "这里还没有笔记"}</p>
                </div>
              )}
            </div>
            <div className="list-foot">
              <HardDrive size={12} />
              内容自动保存在本机
            </div>
          </aside>
          <Splitter
            label="调整笔记列表宽度"
            value={listSize}
            min={180}
            max={Math.min(420, paneSpace - (showSidebar ? sidebarSize : 0))}
            reset={220}
            onChange={setListWidth}
          />
        </>
      )}
      <main className="main-panel">
        <div className="workspace-bar">
          <button
            className="workspace-toggle"
            title={showSidebar ? "收起目录侧栏" : "展开目录侧栏"}
            aria-label={showSidebar ? "收起目录侧栏" : "展开目录侧栏"}
            aria-expanded={showSidebar}
            onClick={() => setShowSidebar(!showSidebar)}
          >
            <PanelLeft size={16} />
            {!showSidebar && <span>展开目录</span>}
          </button>
          <button
            className="workspace-toggle"
            title={showList ? "收起笔记列表" : "展开笔记列表"}
            aria-label={showList ? "收起笔记列表" : "展开笔记列表"}
            aria-expanded={showList}
            onClick={() => setShowList(!showList)}
          >
            {showList ? (
              <PanelRightClose size={17} />
            ) : (
              <LayoutPanelLeft size={17} />
            )}
            {!showList && <span>展开笔记列表</span>}
          </button>
          {(!showSidebar || !showList) && (
            <button
              className="workspace-toggle restore-layout"
              title="恢复全部侧栏和默认宽度"
              onClick={restoreWorkspace}
            >
              <RotateCcw size={14} />
              <span>恢复布局</span>
            </button>
          )}
          <div className="breadcrumbs">
            <span>我的笔记库</span>
            <ChevronRight size={12} />
            <span>{note ? parent(note.path) || "根目录" : "开始"}</span>
            {note && (
              <>
                <ChevronRight size={12} />
                <strong>{note.title}</strong>
              </>
            )}
          </div>
          <div className="save-status">
            {saveState.includes("正在") ? (
              <LoaderCircle size={13} className="spin" />
            ) : saveError ? (
              <CloudOff size={13} />
            ) : (
              <CheckCircle2 size={13} />
            )}
            <span>{note ? saveState : "本地优先 · 安心书写"}</span>
          </div>
        </div>
        {note ? (
          <>
            <header className="document-header">
              <div className="document-title-row">
                <h1>{note.title}</h1>
                <div className="document-actions">
                  {note.format === "markdown" ? (
                    <button onClick={() => showDialog({ kind: "convert" })}>
                      <Network size={15} />
                      转为思维导图
                    </button>
                  ) : (
                    <button
                      disabled={!parsed.doc}
                      onClick={() => showDialog({ kind: "export" })}
                    >
                      <Download size={15} />
                      导出 Markdown
                    </button>
                  )}
                  {activeEntry && (
                    <IconButton
                      title="笔记选项"
                      onClick={() =>
                        setContext({
                          x: window.innerWidth - 245,
                          y: 80,
                          entry: activeEntry,
                          dir: parent(activeEntry.path),
                        })
                      }
                    >
                      <MoreHorizontal size={19} />
                    </IconButton>
                  )}
                </div>
              </div>
            </header>
            {(saveError || externalWarning) && (
              <div className="save-warning">
                <span>
                  {saveError ||
                    "文件在外部发生了变化。当前编辑仍保留在窗口中，保存前需要处理。"}
                </span>
                <button onClick={() => void saveCopy()}>保存为副本</button>
                <button
                  onClick={() => {
                    if (
                      !dirtyRef.current ||
                      window.confirm(
                        "重新读取将放弃当前尚未保存的编辑，是否继续？",
                      )
                    )
                      void vault
                        .read(note.path)
                        .then(installNote)
                        .catch(reportError);
                  }}
                >
                  重新读取
                </button>
              </div>
            )}
            {note.format === "mindmap" ? (
              parsed.doc ? (
                <MindmapEditor
                  key={note.path}
                  doc={parsed.doc}
                  onEditingChange={onNodeEditingChange}
                  onChange={(doc, record = true) =>
                    setDraft(JSON.stringify(doc, null, 2), record)
                  }
                  undo={undo}
                  redo={redo}
                  canUndo={historyTick >= 0 && history.current.canUndo}
                  canRedo={history.current.canRedo}
                />
              ) : (
                <div className="invalid-map">
                  <Network size={38} />
                  <h2>这份导图暂时无法打开</h2>
                  <p>{parsed.error}</p>
                  <textarea
                    aria-label="修复思维导图 JSON"
                    value={content}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </div>
              )
            ) : (
              <div className="markdown-editor">
                <div className="markdown-toolbar">
                  <div className="view-switch">
                    <button
                      className={markdownView === "edit" ? "active" : ""}
                      onClick={() => setMarkdownView("edit")}
                    >
                      <Code2 size={14} />
                      编辑
                    </button>
                    <button
                      className={markdownView === "split" ? "active" : ""}
                      onClick={() => setMarkdownView("split")}
                    >
                      <LayoutPanelLeft size={14} />
                      分栏
                    </button>
                    <button
                      className={markdownView === "preview" ? "active" : ""}
                      onClick={() => setMarkdownView("preview")}
                    >
                      <BookOpen size={14} />
                      预览
                    </button>
                  </div>
                  <span>
                    {content
                      .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, "")
                      .replace(/\s/g, "")
                      .length.toLocaleString()}{" "}
                    字
                  </span>
                </div>
                <div className={`markdown-panes ${markdownView}`}>
                  {markdownView !== "preview" && (
                    <textarea
                      className="markdown-source"
                      style={
                        markdownView === "split"
                          ? { flex: `${markdownRatio} 1 0`, width: 0 }
                          : undefined
                      }
                      aria-label="Markdown 笔记内容"
                      spellCheck={false}
                      value={content}
                      onPaste={(e) => pasteImage(e, setDraft, reportError)}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  )}
                  {markdownView === "split" && (
                    <Splitter
                      label="调整 Markdown 编辑与预览宽度"
                      value={markdownRatio}
                      min={20}
                      max={80}
                      reset={50}
                      onChange={setMarkdownRatio}
                      percent
                    />
                  )}
                  {markdownView !== "edit" && (
                    <div
                      className="markdown-preview"
                      style={
                        markdownView === "split"
                          ? { flex: `${100 - markdownRatio} 1 0`, width: 0 }
                          : undefined
                      }
                    >
                      <Markdown text={previewContent} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-eyebrow">
              <span />A PLACE FOR YOUR THOUGHTS
            </div>
            <div className="welcome-art">
              <svg viewBox="0 0 400 180" aria-hidden="true">
                <path
                  d="M200 90H280Q300 90 300 55H345M200 90H280Q300 90 300 128H345M200 90H115Q95 90 95 55H45M200 90H115Q95 90 95 130H45"
                  fill="none"
                  stroke="#b8c9bd"
                  strokeWidth="2"
                />
                <rect
                  x="135"
                  y="63"
                  width="130"
                  height="54"
                  rx="15"
                  fill="#365d4e"
                />
                <path
                  d="M185 94c0-15 10-21 24-21-1 17-10 25-24 21zm1-1 18-15"
                  fill="#d0e4bc"
                  stroke="#a9c694"
                  strokeWidth="1.5"
                />
                <rect
                  x="17"
                  y="37"
                  width="78"
                  height="35"
                  rx="10"
                  fill="#ebe7f2"
                />
                <rect
                  x="10"
                  y="113"
                  width="85"
                  height="35"
                  rx="10"
                  fill="#e5ece8"
                />
                <rect
                  x="305"
                  y="37"
                  width="78"
                  height="35"
                  rx="10"
                  fill="#f0e6d7"
                />
                <rect
                  x="305"
                  y="111"
                  width="85"
                  height="35"
                  rx="10"
                  fill="#e1ebef"
                />
              </svg>
            </div>
            <h1>
              {boot?.vaultPath
                ? notes.length
                  ? "选一篇笔记，继续思考"
                  : "让第一个想法生根"
                : "把想法，留在枝间"}
            </h1>
            <p>
              {boot?.vaultPath
                ? notes.length
                  ? "从左侧打开笔记，或让一个新想法开始。"
                  : "从一篇笔记开始，用文字记录，用导图连接。"
                : "一个安静的本地思考空间。笔记与思维导图，\n都在你自己的文件夹里。"}
            </p>
            {boot?.vaultPath ? (
              <>
                <div className="welcome-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      showDialog({ kind: "create", format: "mindmap" })
                    }
                  >
                    <Network size={17} />
                    新建思维导图
                  </button>
                  <button
                    onClick={() =>
                      showDialog({ kind: "create", format: "markdown" })
                    }
                  >
                    <FileText size={17} />
                    新建 Markdown
                  </button>
                </div>
                {notes.length === 0 && (
                  <button
                    className="sample-link"
                    onClick={() => void starter()}
                  >
                    先加入示例笔记，看看枝间如何工作
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="primary choose-vault"
                  onClick={() => void chooseVault()}
                >
                  <FolderOpen size={18} />
                  选择本地笔记文件夹
                </button>
                <small>
                  可以新建一个文件夹，也可以打开已有 Markdown 笔记目录。
                </small>
                <div className="welcome-features">
                  <span>
                    <HardDrive size={16} />
                    真实本地文件
                  </span>
                  <span>
                    <ListTree size={16} />
                    大纲 ↔ 导图
                  </span>
                  <span>
                    <Cloud size={16} />
                    自己的云同步
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </main>
      {context && boot?.vaultPath && (
        <ContextMenu
          x={context.x}
          y={context.y}
          actions={menuActions}
          close={closeContext}
        />
      )}
      {dialog?.kind === "vault" && (
        <Modal title="本地笔记库" close={closeDialog}>
          <div className="dialog-body">
            <p className="dialog-copy">{boot?.vaultPath}</p>
            <div className="action-menu">
              <button
                onClick={() => {
                  closeDialog();
                  void chooseVault();
                }}
              >
                <FolderOpen size={17} />
                打开其他笔记库
              </button>
              <button onClick={() => void revealVault().catch(reportError)}>
                <ArrowUpRight size={17} />
                在系统文件夹中显示
              </button>
              <button
                onClick={async () => {
                  try {
                    await flush();
                    await closeVault();
                    history.current.clear();
                    installNote(null);
                    setInline(null);
                    setTreeSelection(null);
                    setContext(null);
                    setCollapsed(new Set());
                    setEntries([]);
                    setFolder(null);
                    setQuery("");
                    setBoot((b) =>
                      b
                        ? {
                            ...b,
                            vaultPath: null,
                            connection: null,
                            secretStored: false,
                          }
                        : b,
                    );
                    setSyncState("尚未连接云端");
                    setSyncError(false);
                    closeDialog();
                  } catch (e) {
                    reportError(e);
                  }
                }}
              >
                <X size={17} />
                关闭当前笔记库
              </button>
            </div>
            <p className="field-note">
              关闭不会删除笔记或同步设置，重新打开此文件夹即可继续。
            </p>
          </div>
        </Modal>
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog
          connection={boot?.connection ?? null}
          stored={boot?.secretStored ?? false}
          close={closeDialog}
          saved={(connection) => {
            setBoot((b) =>
              b ? { ...b, connection, secretStored: !!connection } : b,
            );
            setSyncState(connection ? "云端已连接" : "尚未连接云端");
            setSyncError(false);
          }}
        />
      )}
      {dialog &&
        ["create", "rename", "move", "trash", "export", "convert"].includes(
          dialog.kind,
        ) && (
          <Modal
            title={
              dialog.kind === "create"
                ? dialog.format === "folder"
                  ? "新建文件夹"
                  : "新建笔记"
                : dialog.kind === "rename"
                  ? "重命名"
                  : dialog.kind === "move"
                    ? "移动到文件夹"
                    : dialog.kind === "trash"
                      ? "移到回收站"
                      : dialog.kind === "convert"
                        ? "从 Markdown 生成思维导图"
                        : "导出 Markdown 副本"
            }
            close={closeDialog}
            wide={dialog.kind === "convert"}
          >
            {dialog.kind === "convert" && preview && (
              <div className="conversion-preview">
                <MindmapEditor doc={preview} onChange={setPreview} />
              </div>
            )}
            <div className="dialog-body">
              {dialog.kind === "create" && dialog.format !== "folder" && (
                <div className="format-cards">
                  <button
                    className={dialog.format === "mindmap" ? "selected" : ""}
                    onClick={() =>
                      setDialog({ kind: "create", format: "mindmap" })
                    }
                  >
                    <Network size={24} />
                    <strong>思维导图</strong>
                    <span>展开思考的结构</span>
                  </button>
                  <button
                    className={dialog.format === "markdown" ? "selected" : ""}
                    onClick={() =>
                      setDialog({ kind: "create", format: "markdown" })
                    }
                  >
                    <FileText size={24} />
                    <strong>Markdown</strong>
                    <span>专注连续的书写</span>
                  </button>
                </div>
              )}
              {dialog.kind === "trash" ? (
                <p className="dialog-copy">
                  “
                  {dialog.entry.kind === "folder"
                    ? dialog.entry.name
                    : displayName(dialog.entry.path)}
                  ”
                  {dialog.entry.kind === "folder"
                    ? "及其全部内容将移到回收站。"
                    : "将移到回收站。"}
                  删除也会同步到其他电脑，之后可以恢复。
                </p>
              ) : (
                <>
                  {dialog.kind !== "move" && (
                    <label>
                      名称
                      <input
                        autoFocus
                        value={dialogName}
                        placeholder={
                          dialog.kind === "create" && dialog.format === "folder"
                            ? "例如：数学、阅读、生活"
                            : "给这份想法起个名字"
                        }
                        onChange={(e) => setDialogName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void createOrChange();
                        }}
                      />
                    </label>
                  )}
                  {dialog.kind !== "rename" && (
                    <label>
                      保存位置
                      <select
                        value={dialogFolder}
                        onChange={(e) => setDialogFolder(e.target.value)}
                      >
                        {folderOptions(
                          "entry" in dialog ? dialog.entry.path : undefined,
                        )}
                      </select>
                    </label>
                  )}
                  {dialog.kind === "convert" && (
                    <p className="field-note">
                      按标题与列表层级生成节点，原 Markdown
                      笔记会保留。你可以在预览中调整结果。
                    </p>
                  )}
                  {dialog.kind === "export" && (
                    <p className="field-note">
                      在笔记库中生成可读、可编辑的 Markdown
                      大纲副本，保留所有公式源码。
                    </p>
                  )}
                </>
              )}
              {dialogError && (
                <div className="inline-error" role="alert">
                  {dialogError}
                </div>
              )}
              <div className="dialog-actions">
                <button onClick={closeDialog}>取消</button>
                <button
                  disabled={
                    dialogBusy ||
                    (dialog.kind !== "trash" &&
                      dialog.kind !== "move" &&
                      !dialogName.trim())
                  }
                  className={dialog.kind === "trash" ? "danger" : "primary"}
                  onClick={() => void createOrChange()}
                >
                  {dialogBusy && <LoaderCircle size={15} className="spin" />}
                  {dialog.kind === "trash"
                    ? "移到回收站"
                    : dialog.kind === "move"
                      ? "移动"
                      : dialog.kind === "convert"
                        ? "创建思维导图"
                        : dialog.kind === "create"
                          ? "创建"
                          : "保存"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      {dialog?.kind === "actions" && (
        <Modal
          title={
            dialog.entry.kind === "folder"
              ? dialog.entry.name
              : displayName(dialog.entry.path)
          }
          close={closeDialog}
        >
          <div className="action-menu">
            <button
              onClick={() =>
                showDialog({ kind: "rename", entry: dialog.entry })
              }
            >
              <FileText size={17} />
              重命名
            </button>
            <button
              onClick={() => showDialog({ kind: "move", entry: dialog.entry })}
            >
              <FolderOpen size={17} />
              移动到文件夹
            </button>
            <button
              className="text-danger"
              onClick={() => showDialog({ kind: "trash", entry: dialog.entry })}
            >
              <Trash2 size={17} />
              移到回收站
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "trash-list" && (
        <Modal title="回收站" close={closeDialog}>
          <div className="dialog-body">
            <p className="dialog-copy">
              删除的本地内容会保留在这里，恢复后也会再次同步。
            </p>
            <div className="trash-list">
              {trashItems.map((item) => (
                <div key={item.id}>
                  <Trash2 size={16} />
                  <span>
                    <strong>{displayName(item.path)}</strong>
                    <small>
                      {item.path} ·{" "}
                      {new Date(item.deletedAt).toLocaleDateString("zh-CN")}
                    </small>
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await restoreTrash(item.id);
                        setTrashItems(await listTrash());
                        await refresh();
                        setToast("已恢复到原来的文件夹。");
                      } catch (e) {
                        reportError(e);
                      }
                    }}
                  >
                    恢复
                  </button>
                </div>
              ))}
              {!trashItems.length && (
                <div className="empty-trash">
                  <Check size={28} />
                  <p>回收站是空的</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton title="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
