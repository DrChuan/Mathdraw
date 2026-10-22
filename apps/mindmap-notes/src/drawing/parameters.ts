import { coordinateSyntax } from "./input";
import { evaluate, parseExpression } from "./expression";
import { numericFunctions, numericSource } from "./symbols";
import type { DrawingDocument, GeometryObject, Vec3 } from "./types";

export function expressionNames(source: string): string[] {
  return [...new Set([...source.matchAll(/(?<![A-Za-z_\\])[A-Za-z][A-Za-z0-9_]*/g)].map(m => m[0]))];
}
export function substituteNames(source: string, replacements: Record<string, string>): string {
  return source.replace(/(?<![A-Za-z_\\])[A-Za-z][A-Za-z0-9_]*/g, name => replacements[name] ?? name);
}
export function renderReferences(doc: DrawingDocument, source: string, refs: Record<string, string>): string {
  const replacements = Object.fromEntries(Object.entries(refs).map(([name,id]) => [name,doc.objects.find(o => o.id === id)?.symbol ?? name]));
  return source.replace(/(?<![A-Za-z_\\])[A-Za-z][A-Za-z0-9_]*/g,(name,offset:number) => {
    if (replacements[name]) return replacements[name];
    if (name.includes("_") || numericFunctions.has(name.toLowerCase()) || /^\s*\(/.test(source.slice(offset+name.length))) return name;
    return /^[A-Za-z]+$/.test(name) ? [...name].map(c=>replacements[c] ?? c).join("") : name;
  });
}
export function numericReferences(doc: DrawingDocument, source: string): Record<string, string> {
  source=coordinateSyntax(source);
  const names = new Set(expressionNames(numericSource(source,doc.objects.filter(o=>o.kind === "number").map(o=>o.symbol!))));
  const points = new Set([...source.matchAll(/\b[xyz]\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g)].map(m => m[1]));
  return Object.fromEntries(doc.objects.filter(o => o.symbol && ((o.kind === "number" && names.has(o.symbol)) || (o.kind === "point" && points.has(o.symbol))))
    .map(o => [o.symbol!, o.id]));
}
export function finiteScalar(source: string, scope: Record<string, number> = {}): number {
  const n = evaluate(parseExpression(source, Object.keys(scope)), scope);
  if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error("数值必须有限且绝对值不超过 10⁹");
  return n;
}
const scalarFields = /^(?:circle\.radius|construction\.(?:value|parameter|t)|(?:origin|rotation)\.[012]|width|depth|height|radius|topRadius|sides)$/;
const vectorFields = new Set(["construction.position", "construction.direction", "position", "construction.seed"]);
export function parameterFieldAllowed(path: string, vector: boolean): boolean {
  return vector ? vectorFields.has(path) : ["equation","parametric.x","parametric.y"].includes(path) || scalarFields.test(path) || /^parametric\.t(Min|Max)$/.test(path);
}
export function replaceCoordinates(doc: DrawingDocument, source: string, refs: Record<string,string>, point: (id:string)=>Vec3): string {
  return coordinateSyntax(source).replace(/\b([xyz])\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g, (_all,axis,name) => {
    const id=refs[name] ?? doc.objects.find(o=>o.symbol===name)?.id;
    if (!id) throw new Error(`坐标引用的点 ${name} 不存在`);
    const p=point(id), f=doc.coordinateFrame;
    let value=p[axis === "x" ? 0 : axis === "y" ? 1 : 2];
    if (f && doc.dimension === "3d") {
      const z=[f.x[1]*f.y[2]-f.x[2]*f.y[1],f.x[2]*f.y[0]-f.x[0]*f.y[2],f.x[0]*f.y[1]-f.x[1]*f.y[0]].map(v=>v*f.zSign);
      const direction=axis === "x" ? f.x : axis === "y" ? f.y : z;
      value=p.reduce((s,v,i)=>s+(v-f.origin[i])*direction[i],0);
    }
    if (!Number.isFinite(value)) throw new Error("点坐标暂时失效");
    return `(${value})`;
  });
}
/** Resolve numeric and geometric dependencies lazily through the same graph. */
export function materializeNumbers(doc: DrawingDocument, point: (id:string)=>Vec3) {
  const originals = new Map(doc.objects.map(o => [o.id, o]));
  const objects = new Map(originals), numbers = new Map<string, number>(), errors = new Map<string, string>();
  const done=new Set<string>(), active=new Set<string>();
  const get=(id:string): GeometryObject|undefined => {
    if (done.has(id)) return objects.get(id);
    if (active.has(id) || active.size>128) throw new Error("数值与点的依赖存在循环或层级过深");
    const original=originals.get(id);
    if (!original) return objects.get(id);
    if (errors.has(id)) throw new Error(errors.get(id));
    active.add(id);
    try {
      const refs=original.kind === "number" ? original.references : original.parameters?.references ?? {};
      const scope: Record<string,number>={};
      for (const [name,ref] of Object.entries(refs)) if (originals.get(ref)?.kind === "number") {
        get(ref); const n=numbers.get(ref); if(n===undefined) throw new Error("数值引用暂时失效"); scope[name]=n;
      }
      const prepare=(s:string)=>replaceCoordinates(doc,s,refs,point);
      if (original.kind === "number") {
        const value=finiteScalar(prepare(original.expression),scope);
        const obj={...original,value}; numbers.set(id,value);objects.set(id,obj);done.add(id);return obj;
      }
      if (!original.parameters) { done.add(id); return original; }
      const obj=structuredClone(original);
      for (const [path, source] of Object.entries(original.parameters.fields)) {
        if (!parameterFieldAllowed(path,typeof source !== "string")) throw new Error("数值参数字段无效");
        let value:unknown;
        if (typeof source === "string") value=["equation","parametric.x","parametric.y"].includes(path)
          ? substituteNames(numericSource(prepare(source),Object.keys(scope)),Object.fromEntries(Object.entries(scope).map(([name,n])=>[name,`(${n})`])))
          : finiteScalar(prepare(source),scope);
        else {
          const coordinates=source.coordinates.map(s=>finiteScalar(prepare(s),scope));
          if (source.planeId) {
            const p=doc.planes.find(p=>p.id===source.planeId);
            if(!p) throw new Error("坐标工作平面不存在");
            value=p.origin.map((v,i)=>(source.direction?0:v)+p.u[i]*coordinates[0]+p.v[i]*coordinates[1]);
          } else value=coordinates;
        }
        if(typeof value === "number" && ["width","depth","height","radius"].includes(path) && value<=0) throw new Error("几何体尺寸必须大于零");
        if(typeof value === "number" && path === "topRadius" && value<0) throw new Error("上底半径不能为负");
        if(typeof value === "number" && path === "sides" && (!Number.isInteger(value)||value<3||value>64)) throw new Error("边数需要 3～64 的整数");
        if(typeof value === "number" && path === "construction.t" && (value<=0||value>=1)) throw new Error("等分比例必须在 0 和 1 之间");
        const keys=path.split(".");let target:any=obj;
        for(const key of keys.slice(0,-1)) { if(!target||typeof target!=="object"||!(key in target)) throw new Error("参数目标不存在");target=target[key]; }
        target[keys.at(-1)!]=value;
      }
      objects.set(id,obj);done.add(id);return obj;
    } catch(e) { errors.set(id,(e as Error).message);throw e; } finally { active.delete(id); }
  };
  return {objects,numbers,errors,get};
}
