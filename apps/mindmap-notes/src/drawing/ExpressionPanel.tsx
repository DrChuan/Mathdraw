import { useEffect, useRef, useState, type RefObject } from "react";
import Markdown from "../Markdown";
import type { DrawingDocument, GeometryObject, DrawingNumber, DrawingChange } from "./types";
import { applyDefinition, definition, commandCatalog } from "./model";
import { resolveGeometry } from "./geometry";
import { NumberField } from "./controls";
import { mathPreview, locusFormula } from "./mathPreview";
import ConstraintSetControls from "./ConstraintSetControls";
import { exactCoordinates } from "./exactNumber";
import { FormulaPreview } from "./FormulaPreview";
import { visibleInObjectList } from "./polyhedra";
import { vectorCoordinates } from "./vectorCoordinates";
export interface ExpressionEditor {
  insert: (text: string) => void;
  flush: () => void;
}
export const kindName: Record<GeometryObject["kind"], string> = {
  solutionSet: "约束解集",
  spatialLocus: "空间轨迹",
  number: "数值",
  point: "点",
  segment: "线段",
  line: "直线",
  vector: "向量",
  triangle: "三角形",
  polygon: "多边形",
  curve: "曲线",
  solid: "几何体",
  label: "文字",
};
export function ExpressionPanel({
  doc,
  selected,
  select,
  change,
  drafts,
  previewProblem,
  onDraft,
  editor,
  onContext,
  onConstraintEdit,
}: {
  doc: DrawingDocument;
  selected: string[];
  select: (id: string, add?: boolean) => void;
  change: DrawingChange;
  drafts: Record<string, string>;
  previewProblem: string;
  onDraft: (id: string, value?: string) => void;
  editor: RefObject<ExpressionEditor | null>;
  onContext: (id: string, x: number, y: number) => void;
  onConstraintEdit?: (id:string)=>void;
}) {
  const [query, setQuery] = useState(""),
    [newProblem, setNewProblem] = useState(""),
    [help, setHelp] = useState(false),
    [completion, setCompletion] = useState(-1);
  const [focused,setFocused]=useState(false),[composing,setComposing]=useState(false),[atEnd,setAtEnd]=useState(true),[dismissed,setDismissed]=useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const input = useRef<HTMLTextAreaElement>(null),
    results = resolveGeometry(doc);
  const source = drafts.new ?? "",
    suggestions = commandCatalog
      .filter(
        (c) =>
          c
            .join(" ")
            .toLowerCase()
            .includes(
              source
                .replace(/^[^=]*=/, "")
                .trim()
                .toLowerCase(),
            ) || !source,
      )
      .slice(0, 8);
  const commandToken=source.match(/(?:^|=\s*)([A-Za-z]{2,})$/)?.[1];
  const automatic=focused&&!composing&&atEnd&&!dismissed&&!help&&commandToken
    ?commandCatalog.filter(([name])=>name.toLowerCase().startsWith(commandToken.toLowerCase())):[];
  const suffix=automatic.length===1?`${automatic[0][0].slice(commandToken!.length)}()`:"";
  const acceptCompletion=(command:string)=>focusNew(`${source.slice(0,source.length-(commandToken?.length??0))}${command}()`);
  const focusNew = (text: string) => {
    onDraft("new", text);
    setHelp(false);
    setNewProblem("");
    requestAnimationFrame(() => {
      input.current?.focus();
      const pos = text.indexOf("(") + 1;
      input.current?.setSelectionRange(pos, pos);
    });
  };
  const append = () => {
    try {
      const next = applyDefinition(docRef.current, drafts.new ?? "");
      if (change(next)) {
        onDraft("new");
        setNewProblem("");
        requestAnimationFrame(() => input.current?.focus());
      }
    } catch (e) {
      setNewProblem((e as Error).message);
    }
  };
  useEffect(() => {
    setNewProblem("");
    setQuery("");
  }, [doc.id]);
  return (
    <aside className="draw-expressions" aria-label="对象与表达式">
      <div className="expression-heading">
        <strong>对象与表达式</strong>
        <span>{doc.objects.filter(visibleInObjectList).length}</span>
        <button title="命令及参数提示" onClick={() => setHelp(!help)}>
          ?
        </button>
      </div>
      <input
        className="expression-search"
        aria-label="搜索绘图对象"
        placeholder="搜索对象、定义…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="expression-list">
        {doc.objects
          .filter(visibleInObjectList)
          .filter((o) =>
            `${o.symbol} ${o.name} ${definition(doc, o)}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((obj) => (
            <ExpressionRow
              key={obj.id}
              doc={doc}
              docRef={docRef}
              obj={obj}
              value={drafts[obj.id]}
              onDraft={(value) => onDraft(obj.id, value)}
              selected={
                selected.includes(obj.id) ||
                selected.some((id) => id.startsWith(obj.id + ":"))
              }
              select={(add) => select(obj.id, add)}
              change={change}
              editor={editor}
              error={results.errors.get(obj.id)}
              result={results.points.get(obj.id)?.p}
              numberValue={results.numbers.get(obj.id)}
              onContext={(x, y) => onContext(obj.id, x, y)}
              onConstraintEdit={onConstraintEdit}
            />
          ))}
        {doc.objects.every(o => o.kind === "point" && o.construction.type === "origin") && (
          <div className="expression-empty">
            从工具栏选择工具，在图上点击作图。
            <br />
            也可输入 m=1、A=(m,1) 或 LaTeX 方程。
          </div>
        )}
      </div>
      <div className="expression-new">
        <label htmlFor="new-definition">＋ 新增定义</label>
        <div className="command-input">
        {suffix&&<div className="command-ghost" aria-hidden="true"><span>{source}</span><i>{suffix}</i></div>}
        <textarea autoCorrect="off" autoCapitalize="off" spellCheck={false}
          id="new-definition"
          ref={input}
          aria-label="新增绘图表达式"
          placeholder={"y=kx+1（自动创建 k）\nB=(x(A)+1,y(A))\nParametric(cos(t),sin(t),0,2*pi)"}
          rows={3}
          value={source}
          aria-autocomplete="both" aria-expanded={automatic.length>1||help}
          aria-controls={automatic.length>1?"automatic-commands":undefined}
          onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
          onSelect={e=>setAtEnd(e.currentTarget.selectionStart===source.length&&e.currentTarget.selectionEnd===source.length)}
          onFocus={() => {
            setFocused(true);
            editor.current = {
              flush: () => {},
              insert: (text) => {
                const field = input.current!;
                const p = field.selectionStart;
                onDraft(
                  "new",
                  field.value.slice(0, p) +
                    text +
                    field.value.slice(field.selectionEnd),
                );
                requestAnimationFrame(() => {
                  field.focus();
                  field.setSelectionRange(p + text.length, p + text.length);
                });
              },
            };
          }}
          onBlur={() => {
            setFocused(false);
            editor.current = null;
          }}
          onChange={(e) => {
            onDraft("new", e.target.value);
            setNewProblem("");
            setCompletion(-1);
            setDismissed(false);setAtEnd(e.target.selectionStart===e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if(automatic.length && (e.key==="Tab" || (e.key==="Enter"&&automatic.length>1&&completion>=0))) {
              e.preventDefault();acceptCompletion(automatic[Math.max(0,completion)]![0]);return;
            }
            if(automatic.length>1 && (e.key==="ArrowDown"||e.key==="ArrowUp")) {
              e.preventDefault();setCompletion(i=>(Math.max(-1,i)+(e.key==="ArrowDown"?1:-1)+automatic.length)%automatic.length);return;
            }
            if(e.key==="Escape"&&automatic.length){e.preventDefault();setDismissed(true);return;}
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              append();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onDraft("new");
              setNewProblem("");
              e.currentTarget.blur();
            } else if (e.key === "ArrowDown" && help) {
              e.preventDefault();
              setCompletion((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "Tab" && help && suggestions.length) {
              e.preventDefault();
              focusNew(`${suggestions[Math.max(0, completion)][0]}()`);
            }
          }}
        />
        </div>
        {automatic.length>1&&<div id="automatic-commands" className="expression-completions automatic-commands" role="listbox" aria-label="命令补全">
          {automatic.map(([command,label,args],i)=><button key={command} role="option" aria-selected={completion===i}
            className={completion===i?"active":""} onMouseDown={e=>e.preventDefault()} onClick={()=>acceptCompletion(command)}>
            <strong>{command} · {label}</strong><small>{args}</small></button>)}
        </div>}
        {suffix&&<small className="command-accept-hint">Tab 采纳补全</small>}
        {source && (
          <div className="expression-preview">
            <Markdown
              compact
              text={`$${mathPreview(source).replace(/(?<![\\A-Za-z])([A-Za-z]+[0-9]*)(?=\()/g, "\\operatorname{$1}")}$`}
            />
          </div>
        )}
        {(newProblem || previewProblem) && (
          <small className="expression-problem" role="alert">
            {newProblem || previewProblem}
          </small>
        )}
        <div className="expression-new-actions">
          <button onClick={append}>添加</button>
          <button onClick={() => focusNew("Parametric(cos(t), sin(t), 0, 2*pi)")} title="直接插入参数曲线定义，修改后按 Enter 添加">参数曲线</button>
          <button onClick={() => setHelp(!help)}>构造命令 ▾</button>
        </div>
        {help && (
          <div className="expression-completions">
            {suggestions.map(([command, label, args], i) => (
              <button
                className={completion === i ? "active" : ""}
                key={command}
                onClick={() => focusNew(`${command}()`)}
              >
                <strong>
                  {label} · {command}
                </strong>
                <small>{args}</small>
              </button>
            ))}
          </div>
        )}
        <small className="expression-tip">
          {source ? "预览尚未添加 · " : ""}Enter 添加 · Shift+点击图形插入引用
        </small>
      </div>
    </aside>
  );
}
function ExpressionRow({
  doc,
  docRef,
  obj,
  value,
  onDraft,
  selected,
  select,
  change,
  editor,
  error,
  result,
  numberValue,
  onContext,
  onConstraintEdit,
}: {
  doc: DrawingDocument;
  docRef: RefObject<DrawingDocument>;
  obj: GeometryObject;
  value?: string;
  onDraft: (v?: string) => void;
  selected: boolean;
  select: (add?: boolean) => void;
  change: DrawingChange;
  editor: RefObject<ExpressionEditor | null>;
  error?: string;
  result?: number[];
  numberValue?: number;
  onContext: (x: number, y: number) => void;
  onConstraintEdit?: (id:string)=>void;
}) {
  const [editing, setEditing] = useState(false),
    [problem, setProblem] = useState("");
  const field = useRef<HTMLTextAreaElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    recorded = useRef(false),
    draftRef = useRef(value ?? definition(doc, obj));
  const source = value ?? definition(doc, obj);
  const constraintSet=obj.kind === "solutionSet"?obj.id:obj.kind === "spatialLocus"?obj.set:obj.kind === "point"&&obj.construction.type === "constraint"?obj.construction.set:undefined;
  draftRef.current = source;
  const apply = (text: string) => {
    try {
      const next = applyDefinition(docRef.current, text, obj.id);
      const changed = JSON.stringify(next) !== JSON.stringify(docRef.current);
      if (change(next, !recorded.current) && changed) recorded.current = true;
      setProblem("");
      return true;
    } catch (e) {
      setProblem((e as Error).message);
      return false;
    }
  };
  const flush = () => {
    clearTimeout(timer.current);
    if (editing) apply(field.current?.value ?? draftRef.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const resolved=resolveGeometry(doc).objects.get(obj.id);
  const displaySource=!editing && resolved?.kind === "label" && resolved.measurement ? `${obj.symbol} = ${resolved.text}` : source;
  const previewSource = displaySource.includes(":")
    ? displaySource.slice(displaySource.indexOf(":") + 1)
    : displaySource;
  const preview = mathPreview(previewSource).replace(/(?<![\\A-Za-z])([A-Za-z]+[0-9]*)(?=\()/g,"\\operatorname{$1}");
  const vectorResult=obj.kind==="vector"?vectorCoordinates(doc,obj):undefined;
  return (
    <div
      className={`expression-row ${selected ? "selected" : ""} ${obj.hidden ? "is-hidden" : ""}`}
      data-expression-id={obj.id}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("textarea,input,button"))
          select(e.shiftKey);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(e.clientX, e.clientY);
      }}
    >
      <button
        className="expression-visibility"
        aria-label={`${obj.hidden ? "显示" : "隐藏"} ${obj.symbol}`}
        title="显示或隐藏对象"
        onClick={() =>
          change({
            ...docRef.current,
            objects: docRef.current.objects.map((o) =>
              o.id === obj.id ? { ...o, hidden: !o.hidden } : o,
            ),
          })
        }
      >
        {obj.hidden ? "○" : "●"}
      </button>
      <div className="expression-content">
        <div className="expression-meta">
          <span>
            {kindName[obj.kind]} {obj.locked ? "· 锁定" : ""}
          </span>
          <span>{obj.name !== obj.symbol ? obj.name : ""}</span>
          <button
            aria-label={`编辑定义 ${obj.symbol}`}
            onClick={() => {
              if(constraintSet){onConstraintEdit?.(constraintSet);return;}
              setEditing(true);
              onDraft(source);
              requestAnimationFrame(() => field.current?.focus());
            }}
          >
            编辑
          </button>
        </div>
        {editing ? (
          <textarea autoCorrect="off" autoCapitalize="off" spellCheck={false}
            ref={field}
            aria-label={`定义 ${obj.symbol}`}
            value={source}
            rows={Math.min(5, Math.max(2, source.split("\n").length))}
            onFocus={() => {
              recorded.current = false;
              editor.current = {
                flush,
                insert: (text) => {
                  const input = field.current!,
                    start = input.selectionStart,
                    next =
                      input.value.slice(0, start) +
                      text +
                      input.value.slice(input.selectionEnd);
                  onDraft(next);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => apply(next), 180);
                  requestAnimationFrame(() => {
                    input.focus();
                    input.setSelectionRange(
                      start + text.length,
                      start + text.length,
                    );
                  });
                },
              };
            }}
            onChange={(e) => {
              const text = e.target.value;
              onDraft(text);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => apply(text), 180);
            }}
            onBlur={() => {
              clearTimeout(timer.current);
              if (apply(draftRef.current)) {
                setEditing(false);
                onDraft();
              }
              editor.current = null;
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                clearTimeout(timer.current);
                setEditing(false);
                onDraft();
                setProblem("");
                editor.current = null;
              }
            }}
          />
        ) : (
          <button
            className="expression-definition"
            title="双击编辑定义"
            onClick={(e) => select(e.shiftKey)}
            onDoubleClick={() => {
              if(constraintSet){onConstraintEdit?.(constraintSet);return;}
              onDraft(source);
              setEditing(true);
              requestAnimationFrame(() => field.current?.focus());
            }}
          >
            {obj.kind === "label" && !obj.measurement ? <Markdown compact text={obj.text}/> : <FormulaPreview source={obj.kind === "curve" && source.includes(":") ? `${obj.symbol}: ${preview}` : preview} />}
          </button>
        )}
        {editing && <FormulaPreview source={preview} />}
        {resolved?.kind === "curve" && resolved.derived?.type === "locus" && <details className="locus-equation"><summary>{resolved.parametric ? "已确定轨迹方程" : "数值轨迹"}</summary>{resolved.parametric ? <><FormulaPreview source={locusFormula(resolved)}/><small>扫描区间 [{resolved.parametric.tMin}, {resolved.parametric.tMax}]；仅包含该区间经过的部分</small></> : <small>通过有限采样绘制，尚未确定精确方程</small>}</details>}
        {result && !error && (
          <div className="expression-result">
            {exactCoordinates(doc.dimension === "2d" ? result.slice(0,2):result).approximate?"≈":"="}
            <FormulaPreview source={mathPreview(exactCoordinates(doc.dimension === "2d" ? result.slice(0,2):result).source)}/>
          </div>
        )}
        {vectorResult&&!error&&<div className="expression-result" aria-label="向量坐标">
          {vectorResult.approximate?"≈":"="}<FormulaPreview source={mathPreview(vectorResult.source)}/>
        </div>}
        {obj.kind === "number" && <NumberSlider obj={obj} value={numberValue ?? obj.value}
          docRef={docRef} change={change} error={error} editor={editor} />}
        {obj.kind === "solutionSet"&&<ConstraintSetControls set={obj} docRef={docRef} change={change} edit={()=>onConstraintEdit?.(obj.id)}/>}
        {obj.kind === "point"&&obj.construction.type === "constraint"&&<small>由条件解集联动；参照结构之外的点可拖动。</small>}
        {(problem || error) && (
          <small className="expression-problem" role="alert">
            {problem || error}
          </small>
        )}
        {!editing && value !== undefined && (
          <small className="expression-problem">
            有未完成的定义草稿，点击编辑继续
          </small>
        )}
      </div>
    </div>
  );
}
function NumberSlider({ obj, value, docRef, change, error, editor }: {
  obj: DrawingNumber; value: number; docRef: RefObject<DrawingDocument>;
  change: DrawingChange; error?: string; editor: RefObject<ExpressionEditor | null>;
}) {
  const recorded = useRef(false), active = useRef(false), [problem, setProblem] = useState("");
  const [live,setLive] = useState<number | null>(null);
  const pending = useRef<number | null>(null), frame = useRef(0), finishRef = useRef<() => void>(() => {});
  const editorFlush = useRef(() => finishRef.current());
  const derived = Object.keys(obj.references).length > 0;
  const flushValue = () => {
    frame.current = 0;
    const value = pending.current; pending.current = null;
    if(value === null) return;
    const current = docRef.current, original = current.objects.find(o => o.id === obj.id);
    if(original?.kind !== "number" || Object.keys(original.references).length || original.locked) return;
    if(original.value === value && original.expression === String(value)) return;
    const next = {...current, objects:current.objects.map(o => o.id === obj.id ? {...original,value,expression:String(value)} : o)};
    if (change(next,!recorded.current,"continuous")) { docRef.current = next; recorded.current = true; setProblem(""); }
  };
  const finish = () => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    flushValue();
    if(active.current && recorded.current) change(docRef.current,false,"complete");
    active.current = false; recorded.current = false; setLive(null);
    if(editor.current?.flush === editorFlush.current) editor.current = null;
  };
  finishRef.current = finish;
  const begin = () => {
    if(!active.current) { active.current = true; recorded.current = false; }
    editor.current = {flush:editorFlush.current,insert:()=>{}};
  };
  const setValue = (value: number) => {
    begin(); setLive(value); pending.current = value;
    if(!frame.current) frame.current = requestAnimationFrame(flushValue);
  };
  useEffect(() => {
    const finishOutside = () => { if(active.current) finishRef.current(); };
    window.addEventListener("pointerup",finishOutside);
    window.addEventListener("pointercancel",finishOutside);
    window.addEventListener("blur",finishOutside);
    return () => { cancelAnimationFrame(frame.current); window.removeEventListener("pointerup",finishOutside); window.removeEventListener("pointercancel",finishOutside); window.removeEventListener("blur",finishOutside); };
  }, []);
  const config = (key: keyof DrawingNumber["slider"], value: number) => {
    if (change({ ...docRef.current, objects: docRef.current.objects.map(o => o.id === obj.id
      ? { ...obj, slider: { ...obj.slider, [key]: value } } : o) })) setProblem("");
  };
  return <div className="number-slider" onPointerDown={e => e.stopPropagation()}>
    <div className="number-value">= {Number((live ?? value).toPrecision(10))}{derived && <small> · 关联计算</small>}</div>
    {!derived && <>
      <input type="range" aria-label={`调整数值 ${obj.symbol}`} min={obj.slider.min} max={obj.slider.max}
        step={obj.slider.step} value={live ?? value} disabled={!!error || obj.locked}
        onFocus={begin}
        onPointerDown={begin}
        onPointerUp={finish} onPointerCancel={finish}
        onKeyUp={finish} onBlur={finish}
        onChange={e => setValue(Number(e.target.value))} />
      <details><summary>滑块范围</summary><div className="number-slider-settings">
        {(["min","max","step"] as const).map((key,i) => <NumberField key={key}
          label={["最小值","最大值","步长"][i]} value={obj.slider[key]} change={value => config(key,value)} error={setProblem} />)}
      </div></details>
    </>}
    {problem && <small className="expression-problem">{problem}</small>}
  </div>;
}
