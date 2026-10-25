import type { Vec3 } from "../types";
import type { ConstraintProblem, Positions } from "./types";
import { evaluator,expandConditions,flatten,problemScale } from "./compile";
import { add,sub,mul,dot,cross,norm,unit,perpendicular } from "./math";
import { metricNetworks,distanceKey,type MetricNetwork } from "./metric";
import { intersectLoci,type PlaneEquation,type SphereEquation } from "./intersections";
import { affineVectorPoints,dotPointLocus } from "./vectors";
import { curveGeometry,circleThrough,sphereThrough,polygonArea } from "./measures";
import { incidenceFrame } from "./incidence";

interface Step { positions:Positions; finite:boolean; steps:string[] }
export interface ConstructionPlan { solutions:Positions[]; seeds:Positions[]; finite:boolean; steps:string[] }
const cap=16;

/** Try geometry before optimization for EVERY problem. Auxiliary lines, planes
 * and spheres are temporary mathematical objects, not visible document objects.
 * Unsupported couplings leave partial constructions as numerical starting poses.
 */
export function planConstructions(problem:ConstraintProblem,deadline:number,options?:{anchors:Positions;preferred?:Positions}):ConstructionPlan {
  const primitives=expandConditions(problem),scale=problemScale(problem),metrics=metricNetworks(problem,cap);
  let exhaustive=metrics.exhaustive;
  const solutions:Positions[]=[],seeds:Positions[]=[],traces:string[][]=[];
  const homotheties=primitives.filter(c=>c.kind==="homothety");
  const similarity=(refs:string[][],p:Positions,network:MetricNetwork)=>{
    const [base,top]=refs;if(!base.every(n=>p[n]))return;
    for(let i=0;i<base.length;i++)for(let j=i+1;j<base.length;j++) {
      const length=norm(sub(p[base[j]],p[base[i]]));if(length<1e-12)continue;
      const known=network.get(distanceKey(top[i],top[j]));if(known!==undefined)return known/length;
      if(p[top[i]]&&p[top[j]])return norm(sub(p[top[j]],p[top[i]]))/length;
    }
  };
  const partialChecks=new Map<string,ReturnType<typeof evaluator>>();
  const valid=(p:Positions)=>{
    const names=problem.points.filter(n=>p[n]),key=names.join("|");let check=partialChecks.get(key);
    if(!check){const curves=problem.curves?.filter(c=>[...c.points,...(c.plane??[]),...(c.normalAxis??[]),...(c.radiusSegment??[])].every(n=>p[n]));check=evaluator({...problem,points:names,curves,conditions:problem.conditions.filter(c=>c.refs.flat().every(n=>p[n])&&(!["onCurve","diameter"].includes(c.kind)||curves?.some(k=>k.id===c.curve)))});partialChecks.set(key,check);}
    return check.verify(flatten(names,p)).valid;
  };
  const loci=(point:string,p:Positions,network:MetricNetwork)=>{
    const spheres:SphereEquation[]=[],planes:PlaneEquation[][]=[[]];let used=false;
    const plane=(o:Vec3,n:Vec3)=>{if(norm(n)>1e-12){used=true;for(const list of planes)list.push({n:unit(n),d:dot(o,unit(n))});}};
    const alternatives=(equations:PlaneEquation[])=>{
      used=true;const old=planes.splice(0);for(const list of old)for(const equation of equations)planes.push([...list,equation]);
      if(planes.length>cap){planes.length=cap;exhaustive=false;}
    };
    const line=(o:Vec3,d:Vec3)=>{if(norm(d)<1e-12)return;const n=perpendicular(d);plane(o,n);plane(o,cross(d,n));};
    if(problem.mode==='plane'||problem.mode==='coordinate')plane([0,0,0],[0,0,1]);
    for(const anchor of problem.points.filter(n=>p[n])) {
      const radius=network.get(distanceKey(point,anchor));if(radius!==undefined){used=true;spheres.push({center:p[anchor],radius});}
    }
    // Eliminate a frustum's similar-face offsets. Each known lateral length
    // becomes a sphere for ONE translated top vertex; the other top vertices
    // follow by homothety instead of introducing unrelated unknown coordinates.
    for(const c of homotheties) {
      const [base,top]=c.refs,i=top.indexOf(point),ratio=similarity(c.refs,p,network);
      if(i<0||ratio===undefined)continue;
      for(let j=0;j<base.length;j++) {
        const radius=network.get(distanceKey(base[j],top[j]));if(radius===undefined)continue;
        used=true;spheres.push({center:sub(p[base[j]],mul(sub(p[base[j]],p[base[i]]),ratio)),radius});
      }
    }
    for(const c of primitives.filter(c=>c.kind==="similar"))for(let side=0;side<2;side++) {
      const moving=c.refs[side],base=c.refs[1-side],index=moving.indexOf(point);
      if(index<0||!base.every(n=>p[n]))continue;
      const ratio=similarity([base,moving],p,network);if(ratio===undefined)continue;
      moving.forEach((name,i)=>{if(i!==index&&p[name]){used=true;spheres.push({center:p[name],radius:ratio*norm(sub(p[base[i]],p[base[index]]))});}});
    }
    for(const c of primitives.filter(c=>c.refs.flat().includes(point)&&c.refs.flat().every(n=>n===point||p[n]))) {
      const refs=c.refs,edgeOrigin=(r:string[])=>p[r.find(n=>n!==point)!];
      if(c.kind==="onCurve"&&c.refs[0][0]===point) {
        const curve=problem.curves?.find(k=>k.id===c.curve);if(!curve||![...curve.points,...(curve.plane??[]),...(curve.normalAxis??[]),...(curve.radiusSegment??[])].every(n=>p[n]))continue;
        try{const geometry=curveGeometry(curve,p);if(curve.type==="circle"){used=true;spheres.push({center:geometry.center,radius:geometry.radius});plane(geometry.center,geometry.normal);}}catch{/* Source geometry is not yet constructible. */}
      } else if(c.kind==="concyclic"||c.kind==="cospherical") {
        const anchors=c.refs[0].filter(n=>n!==point).map(n=>p[n]);
        if(c.kind==="concyclic") {const circle=circleThrough(anchors);if(circle){used=true;spheres.push({center:circle.center,radius:circle.radius});plane(circle.center,circle.normal);}}
        else {const sphere=sphereThrough(anchors);if(sphere.rank===3){used=true;spheres.push({center:sphere.center,radius:sphere.radius});}}
      } else if(c.kind==="volume"&&c.solid==="pyramid"&&c.refs[0][0]===point) {
        const base=c.refs[0].slice(1).map(n=>p[n]),area=polygonArea(base),n=unit(cross(sub(base[1],base[0]),sub(base[2],base[0])));
        if(area>1e-12)alternatives([1,-1].map(sign=>({n,d:dot(base[0],n)+sign*3*c.value!/area})));
      } else if(c.kind==="vectorDot") {
        const locus=dotPointLocus(refs,c.value!,p,point);
        if(locus?.plane)plane(locus.plane.origin,locus.plane.normal);
        if(locus?.sphere){used=true;spheres.push(locus.sphere);}
      } else if(c.kind==="equal"||c.kind==="ratio") {
        const i=refs.findIndex(r=>r.includes(point));
        if(refs[1-i].includes(point)) {
          const a=edgeOrigin(refs[0]),b=edgeOrigin(refs[1]),ratio=c.kind==="equal"?1:c.value!,square=ratio*ratio;
          if(Math.abs(square-1)<1e-12)plane(mul(add(a,b),.5),sub(b,a));
          else {used=true;spheres.push({center:add(a,mul(sub(b,a),square/(square-1))),radius:ratio*norm(sub(b,a))/Math.abs(1-square)});}
          continue;
        }
        const edge=refs[1-i];used=true;spheres.push({center:edgeOrigin(refs[i]),radius:norm(sub(p[edge[1]],p[edge[0]]))*(c.kind==="equal"?1:i===0?c.value!:1/c.value!)});
      } else if(c.kind==="collinear") {
        const [a,b]=refs[0].filter(n=>n!==point).map(n=>p[n]);line(a,sub(b,a));
      } else if(c.kind==="onSegment") {const [a,b]=refs.flat().filter(n=>n!==point).map(n=>p[n]);line(a,sub(b,a));}
      else if(c.kind==="coplanar") {
        const [a,b,d]=refs[0].filter(n=>n!==point).map(n=>p[n]);plane(a,cross(sub(b,a),sub(d,a)));
      } else if(c.kind==="vertexAngle") {
        const [a,b,d]=refs.flat(),cosine=Math.cos(c.value!*Math.PI/180);
        if(b===point) {
          if(c.value===90){used=true;spheres.push({center:mul(add(p[a],p[d]),.5),radius:norm(sub(p[a],p[d]))/2});}
        } else {
          const other=a===point?d:a,axis=unit(sub(p[other],p[b])),radius=network.get(distanceKey(point,b));
          if(c.value===0||c.value===180)line(p[b],axis);
          else if(c.value===90)plane(p[b],axis);
          else if(radius!==undefined)plane(add(p[b],mul(axis,radius*cosine)),axis);
        }
      } else if(["parallel","perpendicular","lineAngle","linePlaneAngle"].includes(c.kind)) {
        const i=refs.findIndex(r=>r.includes(point)),moving=refs[i],other=refs[1-i];
        // A shared vertex is unknown in BOTH objects. Neither object can be
        // treated as a fixed reference direction until that vertex is placed.
        // SAS-derived distances already encode general shared line angles;
        // the zero/right-angle cases also have simple explicit loci.
        if(other.includes(point)) {
          if(moving.length===2&&other.length===2) {
            const a=edgeOrigin(moving),b=edgeOrigin(other),value=c.kind==="parallel"?0:c.kind==="perpendicular"?90:c.value!;
            if(value===0)line(a,sub(b,a));
            else if(value===90){used=true;spheres.push({center:mul(add(a,b),.5),radius:norm(sub(b,a))*.5});}
          }
          continue;
        }
        const a=p[other[0]],b=p[other[1]],
          direction=other.length===2?sub(b,a):cross(sub(b,a),sub(p[other[2]],a));
        if(norm(direction)<1e-12)continue;
        if(moving.length===2) {
          const origin=edgeOrigin(moving),anchor=moving.find(n=>n!==point)!,radius=network.get(distanceKey(point,anchor));
          const value=c.kind==="parallel"?0:c.kind==="perpendicular"?90:c.value!;
          const parallel=c.kind==="parallel"||c.kind==="lineAngle"&&value===0||c.kind==="linePlaneAngle"&&value===0;
          if(c.kind==="parallel"||c.kind==="perpendicular"||value===0||value===90) {
            if(parallel===(other.length===2))line(origin,direction);else plane(origin,direction);
          } else if(radius!==undefined) {
            const n=unit(direction),offset=radius*(other.length===2?Math.cos(value*Math.PI/180):Math.sin(value*Math.PI/180));
            alternatives([1,-1].map(sign=>({n,d:dot(origin,n)+sign*offset})));
          }
        } else if(c.kind==="parallel"||c.kind==="perpendicular") {
          const [u,v]=moving.filter(n=>n!==point).map(n=>p[n]),edge=sub(v,u);
          const normal=(c.kind==="parallel")===(other.length===3)?direction:cross(edge,direction);
          plane(u,normal);
        }
      } else if(c.kind==="dihedral"&&(refs[1][0]===point||refs[2][0]===point)) {
        const origin=p[refs[0][0]],axis=unit(sub(p[refs[0][1]],origin)),other=p[refs[refs[1][0]===point?2:1][0]],delta=sub(other,origin),
          side=sub(delta,mul(axis,dot(axis,delta))),angle=c.value!*Math.PI/180;
        if(norm(side)<1e-12)continue;
        alternatives([1,-1].map(sign=>{
          const n=unit(cross(axis,add(mul(side,Math.cos(angle)),mul(cross(axis,side),sign*Math.sin(angle)))));
          return {n,d:dot(origin,n)};
        }));
      }
    }
    if(!used)return;
    const results=planes.map(list=>intersectLoci(list,spheres,scale,options?.preferred?.[point]));
    return {points:results.flatMap(r=>r.points),dimension:Math.max(0,...results.map(r=>r.dimension)),
      label:`${spheres.length?`${spheres.length} 个球面`:""}${spheres.length&&planes.some(p=>p.length)?"与":""}${planes.some(p=>p.length)?"辅助平面 / 直线":""}求交`};
  };
  for(const network of metrics.networks) {
    if(Date.now()>deadline){exhaustive=false;break;}
    let start:Step|undefined=options?{positions:{...options.anchors},finite:true,steps:["保持已选参照结构与当前动点的目标位置"]}:undefined;
    const round=problem.conditions.find(c=>c.enabled&&["cylinder","cone","coneFrustum","sphere"].includes(c.kind));
    if(round&&!start) {
      const [o,t,a,b]=round.refs[0],radiusName=round.kind==="sphere"?t:a,r=network.get(distanceKey(o,radiusName)),h=round.kind==="sphere"?undefined:network.get(distanceKey(o,t)),s=round.kind==="coneFrustum"?network.get(distanceKey(t,b)):undefined;
      const positions:Positions={[o]:[0,0,0],[radiusName]:[r??scale,0,0]};
      if(round.kind!=="sphere")positions[t]=[0,0,h??scale];
      if(round.kind==="coneFrustum")positions[b]=[s??scale*.6,0,h??scale];
      start={positions,finite:!!r&&(round.kind==="sphere"||!!h)&&(round.kind!=="coneFrustum"||!!s),steps:["由圆面半径及轴线高度解析构造曲面几何体；缺少尺寸时保留自由度"]};
    }
    // A regular polygon is a construction, not n unrelated coordinate guesses.
    const regular=problem.conditions.find(c=>c.enabled&&(c.kind==="regularPolygon"||c.kind==="square"||c.kind==="cube"));
    if(regular&&!start) {
      const names=regular.refs[0],n=regular.kind==="cube"?4:names.length;
      const raw:Vec3[]=regular.kind==="cube"?[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]:
        names.map((_,i)=>[Math.cos(2*Math.PI*i/n),Math.sin(2*Math.PI*i/n),0]);
      let factor=scale,determined=false;
      for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++) {
        const length=network.get(distanceKey(names[i],names[j]));if(length!==undefined){factor=length/norm(sub(raw[i],raw[j]));determined=true;}
      }
      start={positions:Object.fromEntries(names.map((name,i)=>[name,mul(raw[i],factor)])),finite:determined,steps:[`按${regular.kind==="cube"?"正方体":"正多边形"}定义构造 ${names.join("、")}${determined?"":"（尺寸尚有自由度）"}`]};
    }
    if(!start) {
      const pairs=problem.points.flatMap((a,i)=>problem.points.slice(i+1).filter(b=>network.has(distanceKey(a,b))).map(b=>[a,b] as const));
      // Prefer an SSS/SAS triangle as the initial rigid reference.
      const score=([a,b]:readonly string[])=>problem.points.filter(c=>network.has(distanceKey(a,c))&&network.has(distanceKey(b,c))).length;
      pairs.sort((a,b)=>score(b)-score(a));const pair=pairs[0];
      start=pair?{positions:{[pair[0]]:[0,0,0],[pair[1]]:[network.get(distanceKey(...pair))!,0,0]},finite:true,steps:[`以 ${pair.join("、")} 为基准放置已知长度线段（仅消去整体平移和旋转）`]}:
        {positions:{[problem.points[0]]:[0,0,0]},finite:false,steps:[]};
    }
    let states=[start];
    if(!options) {
      const frame=incidenceFrame(problem,start.positions);
      if(frame)states=[{positions:frame.positions,finite:false,steps:[...start.steps,...frame.steps]}];
    }
    if(regular?.kind==="cube"&&!options)states.push({...start,positions:Object.fromEntries(Object.entries(start.positions).map(([name,p])=>[name,[p[0],p[1],-p[2]] as Vec3]))});
    for(let pass=0;pass<problem.points.length&&states.length;pass++) {
      if(Date.now()>deadline){exhaustive=false;break;}
      const next:Step[]=[];let progress=false;
      for(const state of states) {
        const p=state.positions,pending=problem.points.filter(n=>!p[n]);
        if(!pending.length){next.push(state);continue;}
        const affine=affineVectorPoints(primitives,p);
        if(Object.keys(affine).length) {
          const q={...p,...affine};if(valid(q))next.push({...state,positions:q,steps:[...state.steps,`${Object.keys(affine).join("、")}：解析消元向量及定比分点关系`]});
          progress=true;continue;
        }
        const division=primitives.find(c=>c.kind==="division"&&c.refs.flat().filter(n=>!p[n]).length===1);
        if(division) {
          const [m,a,b]=division.refs.flat(),t=division.value!/(1+division.value!),unknown=[m,a,b].find(n=>!p[n])!;
          const value=unknown===m?add(p[a],mul(sub(p[b],p[a]),t)):unknown===a?mul(sub(p[m],mul(p[b],t)),1/(1-t)):mul(sub(p[m],mul(p[a],1-t)),1/t);
          const q={...p,[unknown]:value};if(valid(q))next.push({...state,positions:q,steps:[...state.steps,`${unknown}：按定比分点的向量关系构造`]});progress=true;continue;
        }
        // Exact affine relations propagate whole prisms/parallelograms/cubes.
        const sum=primitives.find(c=>c.kind==="vectorSum"&&c.refs[0].filter(n=>!p[n]).length===1);
        if(sum) {
          const names=sum.refs[0],point=names.find(n=>!p[n])!,index=names.indexOf(point),sign=index<2?1:-1;
          const value=names.reduce((v,n,i)=>p[n]?add(v,mul(p[n],-(i<2?1:-1)*sign)):v,[0,0,0] as Vec3),q={...p,[point]:value};
          if(valid(q))next.push({...state,positions:q,steps:[...state.steps,`${point}：由平行四边形 / 棱柱的向量平移关系构造`]});
          progress=true;continue;
        }
        let similar:Step|undefined;
        for(const c of homotheties) {
          const [base,top]=c.refs,ratio=similarity(c.refs,p,network),i=top.findIndex(n=>p[n]),j=top.findIndex(n=>!p[n]);
          if(ratio===undefined||i<0||j<0)continue;
          const q={...p,[top[j]]:add(p[top[i]],mul(sub(p[base[j]],p[base[i]]),ratio))};
          if(valid(q))similar={...state,positions:q,steps:[...state.steps,`${top[j]}：按底面相似比 ${ratio} 构造对应顶点`]};
          break;
        }
        if(similar){next.push(similar);progress=true;continue;}
        const choices=pending.flatMap(point=>{const found=loci(point,p,network);return found?[{point,...found}]:[];});
        choices.sort((a,b)=>a.dimension-b.dimension);
        const choice=choices[0];
        if(!choice){exhaustive=false;seeds.push(p);continue;}
        progress=true;
        // With only two placed points, azimuth around their line is a gauge,
        // not a physical degree of freedom. Keep one circle position only.
        const gauge=!options&&Object.keys(p).length===2&&choice.dimension===1&&Object.keys(p).every(n=>network.has(distanceKey(choice.point,n)));
        const placements=gauge?choice.points.slice(0,1):choice.points;
        for(const q of placements) {
          const placed={...p,[choice.point]:q};if(!valid(placed))continue;
          next.push({positions:placed,finite:state.finite&&(choice.dimension===0||gauge),steps:[...state.steps,`${choice.point}：${choice.label}${choice.dimension&&!gauge?"，保留连续自由度":""}`]});
        }
      }
      if(!next.length){seeds.push(...states.map(s=>s.positions));states=[];break;}
      if(next.length>cap)exhaustive=false;
      states=next.slice(0,cap);
      if(!progress)break;
    }
    for(const state of states) {
      seeds.push(state.positions);
      if(problem.points.every(n=>state.positions[n])&&valid(state.positions)) {
        solutions.push(state.positions);traces.push(state.steps);if(!state.finite)exhaustive=false;
      } else exhaustive=false;
    }
  }
  seeds.sort((a,b)=>Object.keys(b).length-Object.keys(a).length);
  return {solutions:solutions.slice(0,cap),seeds:seeds.slice(0,cap),finite:exhaustive&&solutions.length<=cap,steps:traces[0]??[]};
}
