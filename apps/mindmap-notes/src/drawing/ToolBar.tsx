import { useEffect, useRef, useState, type ReactNode } from "react";
import { Circle, Shapes, Spline, Box, Compass, ChevronDown, Ruler } from "lucide-react";
import type { Tool } from "./interaction";
type Category = "basic" | "construct" | "measure" | "curve" | "space";
type Entry = [Tool, string, string];
const basics: Entry[] = [
  ["point", "点", "点击空白处创建；点击已有点复用"],
  ["segment", "线段", "依次点击两个端点"],
  ["line", "直线", "依次点击直线上的两个点"],
  ["vector", "向量", "依次点击起点、终点"],
  ["triangle", "三角形", "依次点击三个顶点"],
  ["polygon", "多边形", "连续点击顶点，再点击首点闭合"],
  ["text", "文字", "点击画布放置文字"],
];
const relations: Entry[] = [
  ["reflect", "轴对称", "先选择对称轴，再选择图形"],
  ["tangent", "切线", "选择曲线和一个点，包含曲线外的点"],
  ["locus", "轨迹", "先选择主动点，再选择依赖它的从动点"],
  ["angleBisector", "角平分射线", "依次选择点、顶点、点"],
  ["angleBisectorLine", "角平分直线", "依次选择点、顶点、点"],
  ["intersect", "交点", "点击交叉处，或依次选择两个图形"],
  ["midpoint", "中点", "点击一条边，或依次选择两个端点"],
  ["divide", "等分点", "点击一条边，再设置等分数量"],
  ["parallel", "平行线", "选择点和参考线，顺序不限；交点可直接点击"],
  ["perpendicular", "垂线", "选择点和参考线，顺序不限；交点可直接点击"],
  ["bisector", "垂直平分线", "点击一条边，或依次选择两个端点"],
];
const measures: Entry[] = [
  ["length", "长度", "选择线段或两个点"],
  ["angle", "角度", "依次选择边上的点、顶点、另一边上的点"],
  ["area", "面积", "选择三角形、多边形或圆"],
  ["perimeter", "周长", "选择三角形、多边形或圆"],
];
const spatial: Entry[] = [
  ["fold", "翻折", "选择多边形，再选择旋转轴；自动创建角度滑块"],
  ["normal", "法向量", "选择平面面，创建随来源更新的法向量"],
  ["section3", "截面 · 三点", "选择几何体，再选择三个不共线点"],
  ["sectionLines", "截面 · 两直线", "选择几何体，再选择两条共面直线或边"],
  ["sectionLinePoint", "截面 · 直线＋点", "选择几何体、直线及线外一点"],
  ["prism", "棱柱", "选择底面，再拖动高度或输入侧棱向量"],
  ["pyramid", "棱锥", "选择底面，再选择顶点"],
  ["axes", "空间坐标系", "原点 → x 方向 → xOy 面 → y 方向，选完直接创建"],
  ["plane3", "三点工作平面", "依次选择三个不共线点"],
  ["planeFace", "面作工作平面", "选择一个平面面"],
];
const circles: [Tool, string][] = [["circle", "圆心＋圆上一点"], ["circleRadius", "圆心＋半径"], ["circle3", "三点圆"]];
export const toolGroups: { label: string; items: [Tool, string][] }[] = [
  { label: "选择", items: [["select", "选择 / 框选"]] },
  { label: "基本图形", items: basics.map(([id,label]) => [id,label]) },
  { label: "圆", items: circles },
  { label: "关系构造", items: relations.map(([id,label]) => [id,label]) },
  { label: "度量", items: measures.map(([id,label]) => [id,label]) },
  { label: "立体工具", items: spatial.map(([id,label]) => [id,label]) },
];
const categories = [
  ["basic", "基本图形", Shapes], ["construct", "关系构造", Compass],
  ["measure", "度量", Ruler], ["curve", "方程曲线", Spline], ["space", "立体工具", Box],
] as const;
export function ToolBar({ tool, choose, dimension, preset, parametric }: {
  tool: Tool; choose: (t: Tool) => void; dimension: "2d" | "3d";
  parametric: () => void;
  preset: (type: "curve" | "solid", id: string) => void;
}) {
  const [category, setCategory] = useState<Category>("basic"), [open, setOpen] = useState("");
  const [bisectorMode,setBisectorMode]=useState<"angleBisector"|"angleBisectorLine">("angleBisector");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(""); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { setOpen(""); e.stopPropagation(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  useEffect(() => {
    if (spatial.some(([t]) => t === tool)) setCategory("space");
    else if (measures.some(([t]) => t === tool)) setCategory("measure");
    else if (relations.some(([t]) => t === tool)) setCategory("construct");
    else if (tool !== "select") setCategory("basic");
  }, [tool]);
  const activate = (t: Tool) => { choose(t); setOpen(""); };
  const buttons = (items: Entry[]) => items.map(([id,label,hint]) =>
    <button key={id} className={id === tool ? "active" : ""} aria-pressed={id === tool}
      title={hint} onClick={() => activate(id)}>{label}</button>);
  const dropdown = (id: string, label: string, children: ReactNode) => <div className="drawing-tool-group">
    <button className={id === "circle" && circles.some(([t]) => t === tool) ? "active" : ""}
      aria-expanded={open === id} onClick={() => setOpen(open === id ? "" : id)}>{label}<ChevronDown size={13} /></button>
    {open === id && <div className="drawing-tool-menu" role="menu" aria-label={label}>{children}</div>}
  </div>;
  return <section className="drawing-tool-shelf" ref={root} aria-label="作图工具">
    <div className="drawing-tool-categories" role="tablist" aria-label="工具分类">
      {categories.filter(([id]) => dimension === "3d" || id !== "space").map(([id,label,Icon]) =>
        <button key={id} role="tab" id={`tools-tab-${id}`} aria-controls={`tools-panel-${id}`} aria-selected={category === id}
          tabIndex={category === id ? 0 : -1}
          onKeyDown={e => {
            const visible = categories.filter(([id]) => dimension === "3d" || id !== "space");
            const i = visible.findIndex(([key]) => key === id);
            const next = e.key === "ArrowRight" ? (i+1)%visible.length : e.key === "ArrowLeft" ? (i+visible.length-1)%visible.length
              : e.key === "Home" ? 0 : e.key === "End" ? visible.length-1 : -1;
            if (next < 0) return;
            e.preventDefault(); choose("select"); setCategory(visible[next][0]); setOpen("");
            document.getElementById(`tools-tab-${visible[next][0]}`)?.focus();
          }}
          className={category === id ? "active" : ""} onClick={() => { choose("select"); setCategory(id); setOpen(""); }}>
          <Icon size={14}/>{label}</button>)}
      <small>先选工具，再跟随画布下方提示</small>
    </div>
    <div className="drawing-tool-actions" role="tabpanel" id={`tools-panel-${category}`} aria-labelledby={`tools-tab-${category}`}>
      {category === "basic" && <>{buttons(basics.slice(0,4))}
        {dropdown("circle", "圆", circles.map(([id,label]) => <button role="menuitem" key={id} onClick={() => activate(id)}><Circle size={13}/>{label}</button>))}
        {buttons(basics.slice(4))}</>}
      {category === "construct" && <>{buttons(relations.filter(([t])=>!["angleBisector","angleBisectorLine"].includes(t)))}
        <div className="drawing-tool-group angle-bisector-control">
          <button aria-label={`角平分线，${bisectorMode === "angleBisector" ? "射线" : "直线"}`} className={tool === "angleBisector" || tool === "angleBisectorLine" ? "active" : ""}
            aria-haspopup="menu" aria-expanded={open === "angleBisector"}
            onKeyDown={e=>{if(e.key === "ArrowDown"){e.preventDefault();setOpen("angleBisector");requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(".angle-bisector-control [role=menuitemradio]")?.focus());}}}
            onClick={e=>{if((e.target as Element).closest("[data-tool-options]"))setOpen(open === "angleBisector" ? "" : "angleBisector");else activate(bisectorMode);}}>
            角平分线 · {bisectorMode === "angleBisector" ? "射线" : "直线"}<span data-tool-options title="选择射线或直线"><ChevronDown size={13}/></span>
          </button>
          {open === "angleBisector" && <div className="drawing-tool-menu" role="menu" aria-label="角平分线方式">{([["angleBisector","射线（默认）"],["angleBisectorLine","直线"]] as const).map(([id,label])=><button key={id} role="menuitemradio" aria-checked={bisectorMode===id} onClick={()=>{setBisectorMode(id);activate(id);}}>{label}</button>)}</div>}
        </div><small>四心、内外接球：选中适用对象后出现在操作条中</small></>}
      {category === "measure" && <>{buttons(measures)}<small>按提示选择要度量的点或图形</small></>}
      {category === "curve" && <>
        {[["circle","圆"],["ellipse","椭圆"],["hyperbola","双曲线"],["parabola","抛物线"]].map(([id,label]) =>
          <button key={id} title={`创建默认${label}，再在属性中调整`} onClick={() => preset("curve",id)}>{label}</button>)}
        <button onClick={parametric}>参数曲线</button>
        <small>自定义：在左侧“新增定义”输入 LaTeX 方程，如 y=x^2</small>
      </>}
      {category === "space" && <>{buttons(spatial.filter(([id])=>!id.startsWith("section")))}
        {dropdown("section", "截面", spatial.filter(([id])=>id.startsWith("section")).map(([id,label,hint])=><button role="menuitem" key={id} title={hint} onClick={()=>activate(id)}>{label.replace("截面 · ","")}</button>))}
        {dropdown("solid", "几何体模板", [["cube","正方体"],["cuboid","长方体"],["prism","正棱柱"],["pyramid","正棱锥"],["frustum","正棱台"],["cylinder","圆柱"],["cone","圆锥"],["coneFrustum","圆台"],["sphere","球"]].map(([id,label]) =>
          <button role="menuitem" key={id} onClick={() => { preset("solid",id); setOpen(""); }}>{label}</button>))}</>}
    </div>
  </section>;
}
