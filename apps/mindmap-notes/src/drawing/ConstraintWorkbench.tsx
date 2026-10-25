import RecentChanges from './RecentChanges';
import {ConfigurationMenu,SolverStatus} from './ConstraintUI';
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DrawingChange, DrawingDocument, DrawingSolutionSet, Vec2, Vec3 } from "./types";
import { newDrawing } from "./types";
import { parseCondition, parseConditions, pointNames, segmentsFrom,validateProblem } from "./constraints/input";
import { type Condition, type ConstraintProblem, type ConstraintResult,type ConstraintCurve } from "./constraints/types";
import { constraintPoint, constraintLocusPoints, installSolutionSet, placeOnPlane, solutionSetObject, mirrorSolutionSet } from "./constraints/document";
import { add, mul, cross } from "./constraints/math";
import { project, resolveGeometry, rotate,fromPlane } from "./geometry";
import { sceneFor, pathData, labelPlainText, arrowData } from "./scene";
import { useLiveConstraints } from "./useLiveConstraints";
import ConstraintSetControls from "./ConstraintSetControls";
import { FormulaPreview } from "./FormulaPreview";
import { mathPreview } from "./mathPreview";
import { exactCoordinates } from "./exactNumber";
import ShapeDeclaration from "./ShapeDeclaration";
import { appendDeclaration, declarationLabel, type ShapeDeclaration as Declaration } from "./constraints/templates";
import { conditionStatement } from "./constraints/statement";
import ConditionInput from "./ConditionInput";
import ConstraintCurves from "./ConstraintCurves";
import { sampleCurve } from "./curves";
import { configurationFiles,decodeConfiguration,type ConstraintConfiguration } from "./constraints/configuration";
import "./constraints.css";
import RecognitionDialog from './recognition/RecognitionDialog';
import {alignRecognitionOrigin} from './recognition/model';
import type {RecognizedQuestion} from './recognition/types';
import {RecognitionOrigin} from './recognition/RecognitionOrigin';
import PlanarConstraintWorkbench from "./PlanarConstraintWorkbench";

const text=(e:unknown)=>e instanceof Error?e.message:String(e);
type WorkbenchProps={docRef:RefObject<DrawingDocument>;existing?:DrawingSolutionSet;change:DrawingChange;close:()=>void;highlight:(ids:string[])=>void;initial?:ConstraintConfiguration;openRecognition?:(q?:RecognizedQuestion)=>void;embedded?:boolean};
export default function ConstraintWorkbench(props:WorkbenchProps){
  const [imported,setImported]=useState<ConstraintConfiguration>(),[sequence,setSequence]=useState(0),[recognizing,setRecognizing]=useState(false),[record,setRecord]=useState<RecognizedQuestion>();
  const initial=imported??props.initial,mode=initial?.mode??props.existing?.problem.mode;
  const planar=mode?mode==='plane'||mode==='coordinate':props.docRef.current.dimension==='2d';
  const openRecognition=(q?:RecognizedQuestion)=>{setRecord(q);setRecognizing(true);};
  const previewDoc=useRef(newDrawing());
  const renderPreview=(c:ConstraintConfiguration)=>{const p={docRef:previewDoc,change:()=>false,close:()=>{},highlight:()=>{},initial:c,embedded:true};const key=JSON.stringify([c.mode,c.points,c.segments,c.conditions,c.planar]);return c.mode==='spatial'?<SpatialConstraintWorkbench key={key} {...p}/>:<PlanarConstraintWorkbench key={key} {...p}/>;};
  return <><div hidden={recognizing}>{planar?<PlanarConstraintWorkbench key={sequence} {...props} initial={initial} openRecognition={openRecognition}/>:<SpatialConstraintWorkbench key={sequence} {...props} initial={initial} openRecognition={openRecognition}/>}</div>
    {recognizing&&<RecognitionDialog initial={record} close={()=>setRecognizing(false)} preview={renderPreview} accept={c=>{setImported(alignRecognitionOrigin(c,props.docRef.current));setSequence(v=>v+1);setRecognizing(false);}}/>}</>;
}
function SpatialConstraintWorkbench({docRef,existing,change,close,highlight,initial,openRecognition,embedded}:WorkbenchProps) {
  const [points,setPoints]=useState(existing?.problem.points.join(" ")??""),
    [segments,setSegments]=useState(existing?.problem.segments.map(e=>e.join(" ")).join(", ")??""),
    [conditions,setConditions]=useState<Condition[]>(existing?.problem.conditions??[]),[rowDrafts,setRowDrafts]=useState<Record<string,string>>({}),
    [result,setResult]=useState<ConstraintResult|undefined>(existing?.result),[branch,setBranch]=useState(existing?.activeBranch??0),[problem,setProblem]=useState<ConstraintProblem|undefined>(existing?.problem),
    [error,setError]=useState(""),[planeNames,setPlaneNames]=useState<string[]>(existing?.problem.points.slice(0,3)??[]),[targetPlane,setTargetPlane]=useState(docRef.current.view.planeId),
    [keepPlacement,setKeepPlacement]=useState(!!existing),[side,setSide]=useState<1|-1>(1),[orientationPoint,setOrientationPoint]=useState(""),
    [yaw,setYaw]=useState(-22),[pitch,setPitch]=useState(0),[driver,setDriver]=useState<string|undefined>(existing?.driver),[declarationNotice,setDeclarationNotice]=useState("");
  const [recognition,setRecognition]=useState(initial?.recognition??existing?.problem.recognition);
  const [mirrored,setMirrored]=useState(false);
  const [curves,setCurves]=useState<ConstraintCurve[]>(existing?.problem.curves??[]);
  const rotation=useRef<{pointer:number;x:number;y:number;yaw:number;pitch:number}|null>(null);
  const editBaseline=useRef<string>('');
  const [editingCondition,setEditingCondition]=useState<string>(),[declareOpen,setDeclareOpen]=useState(false),[fileBusy,setFileBusy]=useState(false),[fileNotice,setFileNotice]=useState(""),[inputKey,setInputKey]=useState(0);
  const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{if(embedded)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[embedded]);
  useEffect(()=>{if(!embedded&&!declareOpen)dialog.current?.focus();},[declareOpen,embedded]);
  const revision=useRef(0),rootId=useRef(existing?.id??crypto.randomUUID()),baseline=useRef(JSON.stringify(docRef.current));
  const previewDocRef=useRef(docRef.current),previewDocId=useRef(crypto.randomUUID());
  const getProblem=():ConstraintProblem=>{
    const names=pointNames(points),edges=segmentsFrom(segments,names),list=conditions.flatMap(c=>{try{return parseConditions(rowDrafts[c.id]??c.source,names,c.id,curves).map(p=>({...p,enabled:c.enabled}));}catch(e){if(c.enabled)throw e;return [];}});
    if(list.length>200)throw new Error("最多支持 200 条条件");
    const p={mode:'spatial' as const,points:names,segments:edges,conditions:list,curves,recognition};validateProblem(p);return p;
  };
  const live=useLiveConstraints({documentId:docRef.current.id,inputKey:JSON.stringify([points,segments,conditions,rowDrafts,curves]),build:getProblem,accept:(p,r)=>{
    setProblem(p);setResult(r);setBranch(0);setPlaneNames(v=>v.length===3&&v.every(n=>p.points.includes(n))?v:p.points.slice(0,3));if(p.points.length<3)setKeepPlacement(true);
  }});
  const solver=live.solver;
  const undoInput=useRef<{points:string;segments:string;conditions:Condition[];rowDrafts:Record<string,string>;curves:ConstraintCurve[]}|undefined>(undefined);
  const invalidate=()=>{if(live.ready)undoInput.current=structuredClone({points,segments,conditions,rowDrafts,curves});revision.current++;live.invalidate();setError("");setFileNotice("");};
  const calculate=(deep=false)=>live.run(deep);
  const append=(sources:string[])=>{
    try {const names=pointNames(points),added=sources.flatMap(s=>parseConditions(s,names,undefined,curves));if(conditions.length+added.length>200)throw new Error("最多支持 200 条条件");invalidate();setConditions(c=>[...c,...added]);return true;}
    catch(e){setError(text(e));return false;}
  };
  const declareShape=(declaration:Declaration)=>{
    try {
      const p=appendDeclaration(points,segments,conditions,rowDrafts,declaration,curves);
      invalidate();setPoints(p.points.join(" "));setSegments(p.segments.map(e=>e.join(" ")).join(", "));setConditions(p.conditions);setCurves(p.curves??[]);setRowDrafts({});
      setPlaneNames(v=>v.length===3&&v.every(n=>p.points.includes(n))?v:declaration.base.slice(0,3));
      setDeclarationNotice(`已声明${declarationLabel(declaration)}；当前共 ${p.points.length} 个点、${p.segments.length} 条棱、${p.conditions.length} 条条件。`);
      setDeclareOpen(false);
    }catch(e){throw new Error(text(e));}
  };
  const previewModel=useMemo(()=>{
    if(!result?.branches.length||!problem)return undefined;
    let set:DrawingSolutionSet={...solutionSetObject(problem,result),...(existing?{name:existing.name,symbol:existing.symbol,style:existing.style,placement:existing.placement}:{}),id:rootId.current,activeBranch:branch,driver:driver&&problem.points.includes(driver)?driver:undefined};
    if(!keepPlacement&&planeNames.length===3)try{
      set=placeOnPlane(set,planeNames as [string,string,string],side,orientationPoint||undefined);
      const plane=docRef.current.planes.find(p=>p.id===targetPlane);
      if(plane) {
        const normal=cross(plane.u,plane.v),map=(p:typeof normal)=>add(mul(plane.u,p[0]),add(mul(plane.v,p[1]),mul(normal,p[2])));
        set={...set,placement:{origin:add(plane.origin,map(set.placement.origin)),x:map(set.placement.x),y:map(set.placement.y),z:map(set.placement.z)}};
      }
    }catch{/* The place action reports invalid plane selections. */}
    if(mirrored)set=mirrorSolutionSet(set,!keepPlacement?docRef.current.planes.find(p=>p.id===targetPlane)?.v:undefined);
    const d=installSolutionSet(newDrawing(),set);d.id=previewDocId.current;d.view.axes=false;d.objects=d.objects.filter(o=>o.kind!=="point"||o.construction.type!=="origin");
    return {set,doc:d};
  },[result,problem,branch,keepPlacement,planeNames,targetPlane,existing,docRef,side,orientationPoint,driver,mirrored]);
  const fit=useRef<{scale:number;center:Vec2}|undefined>(undefined),[fitRevision,setFitRevision]=useState(0);
  const preview=useMemo(()=>{
    if(!previewModel||!problem)return undefined;
    const {set}=previewModel,d={...previewModel.doc,view:{...previewModel.doc.view,angle:yaw,
      camera:{origin:[0,0,0] as Vec3,x:rotate([1,0,0],[pitch,0,0]),y:rotate([0,1,0],[pitch,0,0]),z:rotate([0,0,1],[pitch,0,0])}}};
    const resolved=resolveGeometry(d),bounds:Vec3[]=[...problem.points.map(n=>constraintPoint(set,n)),...constraintLocusPoints(d),...resolved.meshes.flatMap(m=>m.vertices)];
    for(const curve of resolved.curves.values()) {
      const plane=d.planes.find(p=>p.id===curve.planeId)!;
      for(const x of [curve.range[0],curve.range[1]])for(const y of [curve.range[2],curve.range[3]])bounds.push(fromPlane(plane,x,y));
    }
    const ps=bounds.map(p=>project(p,d)),xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);
    const lo=[Math.min(...xs),Math.min(...ys)],hi=[Math.max(...xs),Math.max(...ys)];
    const size:Vec2=[480,340];d.view.scale=Math.max(2,Math.min(90,380/Math.max(1,hi[0]-lo[0]),250/Math.max(1,hi[1]-lo[1])));d.view.center=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2];
    fit.current??={scale:d.view.scale,center:d.view.center};d.view={...d.view,...fit.current};
    const sampled=[...resolveGeometry(d).curves.values()].map(c=>sampleCurve(c,c.range,90,100));
    return {set,doc:d,scene:sceneFor(d,sampled,size),size};
  },[previewModel,problem,yaw,pitch,fitRevision]);
  previewDocRef.current=preview?.doc??docRef.current;
  const place=()=>{
    try {
      if(!live.ready)throw new Error("当前条件尚未满足，不能确认旧预览");
      if(JSON.stringify(docRef.current)!==baseline.current)throw new Error("画布在预览期间已变化，请重新打开条件作图");
      if(!preview||!problem)throw new Error("请先求得可行构型");
      if(!keepPlacement)placeOnPlane(preview.set,planeNames as [string,string,string],side,orientationPoint||undefined);
      const current=docRef.current;
      if(existing&&!current.objects.some(o=>o.id===existing.id&&o.kind==="solutionSet"))throw new Error("该解集已删除，请重新创建");
      const target=recognition&&current.dimension!=='3d'?{...current,dimension:'3d' as const,view:{...current.view,mode:'space' as const,angle:-22}}:current;const next=installSolutionSet(target,preview.set);
      // Preview orbit is temporary. Keep the drawing's camera/basis intact;
      // copying pitch here tilts z and changes the later z-rotation axis.
      // Fit the new configuration while preserving the rest of the document.
      const ps=[...resolveGeometry(next).points.values()].filter(p=>p.object?.kind==="point"&&p.object.construction.type!=="origin"&&!p.object.hidden).map(p=>project(p.p,next));
      ps.push(...constraintLocusPoints(next).map(p=>project(p,next)));
      const resolved=resolveGeometry(next);ps.push(...resolved.meshes.flatMap(m=>m.vertices.map(p=>project(p,next))));
      for(const curve of resolved.curves.values())if(curve.declaration) {
        const plane=next.planes.find(p=>p.id===curve.planeId)!;
        for(const x of [curve.range[0],curve.range[1]])for(const y of [curve.range[2],curve.range[3]])ps.push(project(fromPlane(plane,x,y),next));
      }
      if(ps.length){const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);next.view={...next.view,center:[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2],scale:Math.max(2,Math.min(72,650/Math.max(1,Math.max(...xs)-Math.min(...xs)),440/Math.max(1,Math.max(...ys)-Math.min(...ys))))};}
      if(change(next)){highlight([preview.set.id]);close();}
    }catch(e){setError(text(e));}
  };
  const currentBranch=result?.branches[branch];
  const configuration=():ConstraintConfiguration=>({format:"mathdraw-conditions",version:2,mode:'spatial',points,segments,curves,recognition,
    conditions:conditions.map(c=>({id:c.id,source:rowDrafts[c.id]??c.source,enabled:c.enabled})),
    placement:{planeNames,side,orientationPoint,keepPlacement,mirrored,driver,targetPlane}});
  const saveConfiguration=async()=>{
    setFileBusy(true);setError("");
    try{const path=await configurationFiles.save(decodeConfiguration(JSON.stringify(configuration())));if(path)setFileNotice(`已保存 ${path.split(/[\\/]/).at(-1)}`);}catch(e){setError(text(e));}finally{setFileBusy(false);}
  };
  const loadConfiguration=async()=>{
    setFileBusy(true);setError("");
    try{
      const file=await configurationFiles.open();if(!file)return;const c=decodeConfiguration(file.content);
      if(c.mode&&c.mode!=='spatial')throw new Error('这是平面条件配置，请在平面模式打开，不能作为立体条件加载');
      let names:string[]=[];try{names=pointNames(c.points);}catch{/* Incomplete declarations remain editable. */}
      const rows:Condition[]=c.conditions.map(row=>{try{return {...parseCondition(row.source,names,row.id,c.curves??[]),enabled:row.enabled};}catch{return {id:crypto.randomUUID(),kind:"distance",refs:[],source:row.source,enabled:row.enabled};}});
      invalidate();setRecognition(c.recognition);setPoints(c.points);setSegments(c.segments);setCurves(c.curves??[]);setConditions(rows);setRowDrafts({});setEditingCondition(undefined);setInputKey(v=>v+1);
      setPlaneNames(c.placement.planeNames);setSide(c.placement.side);setOrientationPoint(c.placement.orientationPoint);setKeepPlacement(c.placement.keepPlacement);
      setMirrored(c.placement.mirrored);setDriver(c.placement.driver);setTargetPlane(docRef.current.planes.some(p=>p.id===c.placement.targetPlane)?c.placement.targetPlane!:docRef.current.view.planeId);
      setFileNotice(`已加载 ${file.path.split(/[\\/]/).at(-1)} · 自动更新中`);
    }catch(e){setError(text(e));}finally{setFileBusy(false);}
  };
  const badge=result?.method==="construction"?"解析构造":result?.method==="hybrid"?"解析 + 近似求解":result?.method==="numerical"?"近似求解":"求解方式未记录";
  useEffect(()=>{if(!initial)return;const c=initial;setRecognition(c.recognition);setPoints(c.points);setSegments(c.segments);setCurves(c.curves??[]);setConditions(c.conditions.flatMap(v=>parseConditions(v.source,pointNames(c.points),v.id,c.curves??[]).map(p=>({...p,enabled:v.enabled}))));setKeepPlacement(true);},[]);
  const controls=preview&&<>
    <details><summary>视角微调</summary><div className="constraint-orbit-sliders"><label>水平<input type="range" aria-label="预览水平旋转" min={-180} max={180} step={1} value={yaw} onChange={e=>setYaw(Number(e.target.value))}/></label><label>俯仰<input type="range" aria-label="预览俯仰" min={-85} max={85} step={1} value={pitch} onChange={e=>setPitch(Number(e.target.value))}/></label></div></details>

    <ConstraintSetControls set={preview.set} docRef={previewDocRef} change={next=>{
      const set=next.objects.find(o=>o.id===rootId.current);if(set?.kind!=="solutionSet")return false;live.remember(set.result,set.activeBranch);setResult(set.result);setBranch(set.activeBranch);setDriver(set.driver);return true;
    }} mirror={()=>setMirrored(v=>!v)}/>
    <details className="constraint-solver-details"><summary>求解详情</summary>    <div className={`constraint-method ${result?.method==="construction"?"analytic":"numeric"}`}><strong>{badge}</strong>
      {result?.method==="construction"?<small>通过几何构造得到；坐标使用浮点数计算并回代校验。</small>:<p>{result?.approximationReason??(result?.method?"当前构造规则未能直接完成全部关联关系，使用数值逼近；这不表示没有解析解。":"该旧解集没有记录求解方式，可重新求解。")}</p>}
    </div>
<button disabled={solver.busy||fileBusy} onClick={()=>void calculate(true)}>深入搜索</button>{result?.diagnostics.map((item,i)=><p key={i}>{item}</p>)}</details>
    <details className="constraint-coordinates"><summary>点坐标</summary>{problem?.points.map(n=>{
      const value=exactCoordinates(constraintPoint(preview.set,n));return <div key={n}><FormulaPreview source={`${n}${value.approximate?"\\approx":"="}${mathPreview(value.source)}`}/></div>;
    })}</details>
    
  </>;
  const placement=<section className="constraint-placement"><strong>放置平面</strong>
    <label className="constraint-inline"><input type="checkbox" checked={keepPlacement} disabled={(problem?.points.length??0)<3} onChange={e=>setKeepPlacement(e.target.checked)}/>{existing?"保持当前放置位置":"保持原始位置"}</label>
    {!keepPlacement&&<><div className="constraint-plane-points">{[0,1,2].map(i=><label key={i}>平面点 {i+1}<select aria-label={`xOy 平面点 ${i+1}`} value={planeNames[i]??""} onChange={e=>setPlaneNames(v=>{const next=[...v];next[i]=e.target.value;return next;})}>{problem?.points.map(n=><option key={n} value={n}>{n}</option>)}</select></label>)}</div>
      <label>朝向参考点<select value={orientationPoint} onChange={e=>setOrientationPoint(e.target.value)}><option value="">自动选择</option>{problem?.points.filter(n=>!planeNames.includes(n)).map(n=><option key={n}>{n}</option>)}</select></label>
      <label>参考点所在一侧<select value={side} onChange={e=>setSide(Number(e.target.value) as 1|-1)}><option value={1}>平面上方</option><option value={-1}>平面下方</option></select></label>
      <label>目标工作平面<select value={targetPlane} onChange={e=>setTargetPlane(e.target.value)}>{docRef.current.planes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}
  </section>;
  const visual=<><div className="constraint-visual">
            {preview?<><div className="constraint-view-controls"><span>拖动旋转</span><button onClick={()=>{fit.current=undefined;setFitRevision(v=>v+1);}}>全图</button><button onClick={()=>{setYaw(-22);setPitch(0);}}>复位</button></div>
              <svg viewBox="0 0 480 340" aria-label="约束构型预览，拖动旋转" role="img"
                onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);rotation.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,yaw,pitch};}}
                onPointerMove={e=>{const r=rotation.current;if(!r||r.pointer!==e.pointerId)return;setYaw(((r.yaw+(e.clientX-r.x)*.5+540)%360)-180);setPitch(Math.max(-85,Math.min(85,r.pitch+(e.clientY-r.y)*.35)));}}
                onPointerUp={()=>{rotation.current=null;}} onPointerCancel={()=>{rotation.current=null;}} onLostPointerCapture={()=>{rotation.current=null;}}>
                {preview.scene.paths.map((p,i)=><g key={i}><path d={pathData(p.points)} fill="none" stroke={p.color??"#24314a"} strokeWidth={p.width} strokeDasharray={p.dashed?"5 4":undefined}/>{p.arrow&&<path d={arrowData(p.points)} fill={p.color??"#24314a"}/>}</g>)}
                {preview.scene.dots.map(p=><circle key={p.id} cx={p.p[0]} cy={p.p[1]} r={p.radius} fill="#24314a"/>)}
                {preview.scene.texts.map((t,i)=><text key={i} x={t.p[0]} y={t.p[1]} fontSize={t.fontSize} fontFamily="Times New Roman" fontStyle={t.italic?"italic":"normal"}>{labelPlainText(t.text)}</text>)}
              </svg>

            </>:<div className="constraint-preview-empty">添加点、线或声明图形后，将自动生成预览。</div>}
          </div><SolverStatus status={live.status} message={live.message} stale={!!preview&&!live.ready} badge={preview?badge:undefined} search={embedded?undefined:()=>void calculate(true)}/></>;
  if(embedded)return <div className="constraint-readonly-preview" aria-label="识别图形预览">{visual}</div>;
  return <div className="constraint-overlay" onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"&&!e.nativeEvent.isComposing){if(declareOpen)setDeclareOpen(false);else{revision.current++;solver.cancel();close();}}}}>
    <section ref={dialog} tabIndex={-1} className="constraint-dialog" role={embedded?undefined:"dialog"} aria-modal={embedded?undefined:true} aria-label="按条件作图">
      <header><strong>按条件作图</strong><div className="constraint-file-actions">{openRecognition&&<button onClick={()=>openRecognition(recognition)}>题干识别</button>}<ConfigurationMenu><button disabled={fileBusy||solver.busy} onClick={()=>void loadConfiguration()}>加载配置…</button><button disabled={fileBusy||solver.busy} onClick={()=>void saveConfiguration()}>保存配置…</button></ConfigurationMenu><button disabled={fileBusy} onClick={()=>{revision.current++;solver.cancel();close();}} aria-label="关闭条件作图">×</button></div></header>
      {fileNotice&&<div className="constraint-file-notice" role="status">{fileNotice}</div>}
      <div className="constraint-content live-workspace">
        <div className="constraint-editor">
          <section className="constraint-declared-objects"><div className="constraint-section-heading"><strong>点与线段</strong><button onClick={()=>setDeclareOpen(true)}>＋ 声明图形</button></div>
            <RecentChanges before={undoInput.current} current={{points,segments,conditions,curves,rowDrafts}} status={live.status} edit={(id,source)=>{editBaseline.current=source;setEditingCondition(id);setRowDrafts(v=>({...v,[id]:source}));}} toggle={(id,enabled)=>{invalidate();setConditions(v=>v.map(c=>c.id===id?{...c,enabled}:c));}} locate={id=>{const el=dialog.current?.querySelector<HTMLInputElement>(id==='points'?'[aria-label="声明点名"]':'[aria-label="声明线段"]');el?.scrollIntoView({block:'nearest'});el?.focus();}}/>
            <div className="constraint-declarations"><label>点名<input aria-label="声明点名" data-changed={!!undoInput.current&&undoInput.current.points!==points} value={points} placeholder="A B C P" onChange={e=>{invalidate();setPoints(e.target.value);}}/></label>
            <label>线段<input aria-label="声明线段" data-changed={!!undoInput.current&&undoInput.current.segments!==segments} value={segments} placeholder="AB, BC, CA, AP" onChange={e=>{invalidate();setSegments(e.target.value);}}/></label></div>
          </section>
          {declarationNotice&&<div className="constraint-declaration-notice" role="status">{declarationNotice}</div>}
          <ConstraintCurves points={points} curves={curves} conditions={conditions} change={value=>{invalidate();setCurves(value);}} onError={setError}/>
          <ConditionInput key={inputKey} points={points} segments={segments} curves={curves} conditions={conditions} append={append} onError={setError}/>
          <section className="constraint-condition-list"><div className="constraint-section-heading"><strong>条件 <small>{conditions.length}</small></strong><small>点击编辑</small></div><div className="constraint-condition-flow">
            {!conditions.length&&<p className="constraint-empty-list">添加图形或录入第一个条件。</p>}
            {conditions.map((c,i)=><div key={c.id} className={`constraint-condition-chip ${!c.enabled?"disabled":""} ${editingCondition===c.id?"editing":""} ${undoInput.current&&(!undoInput.current.conditions.some(o=>o.id===c.id&&o.source===(rowDrafts[c.id]??c.source)&&o.enabled===c.enabled))?"changed":""}`}>
              <input type="checkbox" aria-label={`启用条件 ${i+1}`} checked={c.enabled} onChange={e=>{invalidate();setConditions(v=>v.map(k=>k.id===c.id?{...k,enabled:e.target.checked}:k));}}/>
              <RecognitionOrigin question={recognition} id={c.id}/><div className="constraint-condition-value"><div className="constraint-statement" tabIndex={0} role="button" aria-label={`编辑条件 ${i+1}`} onClick={()=>{editBaseline.current=rowDrafts[c.id]??c.source;setEditingCondition(c.id);}} onKeyDown={e=>{if(e.key==="Enter"){editBaseline.current=rowDrafts[c.id]??c.source;setEditingCondition(c.id);}}}>{(()=>{try{return parseConditions(rowDrafts[c.id]??c.source,pointNames(points),c.id,curves).map((item,index)=><span className="constraint-statement-item" key={index}>{conditionStatement(item,curves).map((part,j)=>"text" in part?<span key={j}>{part.text}</span>:<FormulaPreview key={j} source={part.math}/>)}</span>);}catch(e){return <small className="constraint-field-error">{text(e)}</small>;}})()}</div>
              {editingCondition===c.id&&<input autoFocus aria-label={`条件 ${i+1}`} value={rowDrafts[c.id]??c.source} onFocus={()=>{if(existing)highlight(docRef.current.objects.filter(o=>o.kind==="point"&&(o.construction.type==="constraint"&&o.construction.set===existing.id&&c.refs.flat().includes(o.construction.point)||o.constraintSet===existing.id&&!!o.constraintPointName&&c.refs.flat().includes(o.constraintPointName))).map(o=>o.id));}} onChange={e=>{invalidate();setRowDrafts(v=>({...v,[c.id]:e.target.value}));}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==="Escape"){e.stopPropagation();invalidate();setRowDrafts(v=>{return {...v,[c.id]:editBaseline.current};});setEditingCondition(undefined);return;}if(e.key==="Enter"){try{parseConditions(rowDrafts[c.id]??c.source,pointNames(points),undefined,curves);setEditingCondition(undefined);setError("");}catch(err){setError(text(err));}}}}/>}</div>
              <button className="constraint-delete" title="删除条件" aria-label={`删除条件 ${i+1}`} onClick={()=>{invalidate();setConditions(v=>v.filter(k=>k.id!==c.id));}}>×</button>
            </div>)}
          </div></section>
          {live.status==='invalid'&&<small role="alert" className="constraint-field-error">{live.message}</small>}
        </div><div className="constraint-live-preview">
          {visual}
          <section className="constraint-live-options"><aside className="constraint-result-controls"><fieldset disabled={!live.ready}>{controls}</fieldset></aside></section>
          <details className="constraint-live-options"><summary>放置设置 · {keepPlacement?"保持原位":planeNames.length===3?`${planeNames.join('、')} → ${docRef.current.planes.find(p=>p.id===targetPlane)?.name??'工作平面'}`:'自动对齐工作平面'}</summary>{placement}</details>
        </div>
      </div>
      {(error||solver.error)&&<div role="alert" className="constraint-error">{error||solver.error}</div>}
      <footer><button disabled={!undoInput.current} onClick={()=>{const v=undoInput.current;if(!v)return;live.invalidate();setPoints(v.points);setSegments(v.segments);setConditions(v.conditions);setRowDrafts(v.rowDrafts);setCurves(v.curves);setEditingCondition(undefined);setError("");undoInput.current=undefined;}}>撤销本次变更</button><span>{live.ready&&currentBranch?`${result?.branches.length} 个构型 · ${currentBranch.dof} 个自由度`:live.status==='pending'?'更新中…':'待处理'}</span><button disabled={!live.ready||fileBusy||!!editingCondition} className="primary" onClick={place}>{existing?'更新图形':'放入绘图区'}</button></footer>
      {declareOpen&&<div className="constraint-shape-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)setDeclareOpen(false);}} onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"&&!e.nativeEvent.isComposing)setDeclareOpen(false);}}>
        <section className="constraint-shape-modal" role="dialog" aria-modal="true" aria-label="声明图形"><header><strong>声明图形</strong><button autoFocus aria-label="关闭图形声明" onClick={()=>setDeclareOpen(false)}>×</button></header><ShapeDeclaration add={declareShape}/></section>
      </div>}
    </section>
  </div>;
}
