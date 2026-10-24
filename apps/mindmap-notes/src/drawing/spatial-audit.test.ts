import {it,expect} from 'vitest';
import fs from 'node:fs';
import {conditionFaces} from './constraints/faces';
import {parseCondition,pointNames,segmentsFrom} from './constraints/input';
import {type ConstraintProblem,type Positions} from './constraints/types';
const config=JSON.parse(fs.readFileSync('../数学绘图/examples/1023bug.mathdraw-conditions.mathdraw-conditions.json','utf8'));
const names=pointNames(config.points);
const problem:ConstraintProblem={points:names,segments:segmentsFrom(config.segments,names),conditions:config.conditions.map((c:{source:string})=>parseCondition(c.source,names))};
const r=Math.sqrt(3);
const positions:Positions={A:[0,0,0],B:[8,0,0],C:[12,4*r,0],D:[4,4*r,0],P:[4,0,4*r],E:[6,0,2*r],H:[3, r,2*r]};
it('covers every declared pyramid face when its edges have interior points and chords',()=>{
 expect(conditionFaces(problem,positions).length).toBeGreaterThan(4);
 const faces=conditionFaces(problem,{"A": [0, 0, 0], "B": [8.000000000078716, -6.661338147750939e-16, 4.440892098500626e-16], "C": [12.000000000131678, 6.928203230242183, 5.551115123125783e-16], "D": [4.000000000109191, 6.928203230241082, 1.1715295400449577e-11], "P": [4.0000000000008455, 4.6216808158305867e-11, 6.928203230384966], "E": [6.827868852514912, 1.3542569160802563e-11, 2.030190700707073], "H": [3.434426229541995, 1.9592050119264097, 3.989395712516428]});
 expect(faces,JSON.stringify(faces)).toEqual(expect.arrayContaining([expect.arrayContaining(['P','B','C'])]));
});

import {newDrawing,type DrawingDocument} from './types';
import {applyDefinition,normalizeDrawing} from './model';
import {resolveGeometry,sub,dot,cross,unit,add,mul} from './geometry';
import {solutionSetObject,installSolutionSet} from './constraints/document';
import {analyticLoci,displayableLocus} from './constraints/loci';
import {evaluator,flatten} from './constraints/compile';
import {sceneFor,splitVisibilityExact} from './scene';
import {objectTree,type ObjectTreeNode} from './objectTree';
import {type SolutionBranch} from './constraints/types';
import {initialTool,toolHits} from './interaction';
const start=()=>{const d=newDrawing();d.dimension='3d';d.view.mode='space';return d;};
const addDefinitions=(d:DrawingDocument,...sources:string[])=>sources.reduce((d,s)=>{try{return applyDefinition(d,s);}catch(e){throw Error(s+": "+(e as Error).message);}},d);
const id=(d:DrawingDocument,s:string)=>d.objects.find(o=>o.symbol===s)!.id;
const ends=(d:DrawingDocument,s:string)=>{const g=resolveGeometry(d),e=g.edges.find(e=>e.owner===id(d,s))!;return [g.points.get(e.a)!.p,g.points.get(e.b)!.p];};
function example(t=.5){
 const p:Positions={...positions,E:[8-4*t,0,4*r*t]};
 const n=unit(cross(sub(p.D,p.A),sub(p.P,p.A)));p.H=sub(p.E,mul(n,dot(sub(p.E,p.A),n)));
 expect(evaluator(problem).verify(flatten(names,p)).valid).toBe(true);
 const branch:SolutionBranch={positions:p,rigid:[['A','B','C','D','P']],reference:['A','B','C','D','P'],dof:1,residual:0,loci:analyticLoci(problem,p,['A','B','C','D','P'],8)};
 return installSolutionSet(start(),solutionSetObject(problem,{status:'solved',branches:[branch],complete:false,attempts:1,elapsed:0,diagnostics:[]}));
}
it('retains declared faces at edge coincidences, arbitrary subdivision and moving points',()=>{
 for(const t of [0,.00001,.25,.5,.9,.9999]){
   const d=example(t),g=resolveGeometry(d),body=d.objects.find(o=>o.kind==='solid'&&o.construction?.type==='faces')!;
   expect(body).toBeTruthy();expect(g.errors.size).toBe(0);
   const mesh=g.meshes.find(m=>m.id===body.id)!;expect(mesh.faces.length).toBe(6);
   const again=normalizeDrawing(JSON.parse(JSON.stringify(d)));expect(again.objects.length).toBe(d.objects.length);
   expect(d.objects.some(o=>o.constraintFace==='B|C|P')).toBe(true);
 }
});
it('uses PBC as an occluder and hides candidate planes from rendering and picking',()=>{
 const d=example(),g=resolveGeometry(d),set=d.objects.find(o=>o.kind==='solutionSet')!;
 if(set.kind!=='solutionSet')throw Error();
 expect(set.result.branches[0].loci.some(l=>!displayableLocus(l))).toBe(true);
 const paths=sceneFor(d,[]).paths;for(const o of d.objects.filter(o=>o.kind==='spatialLocus'))expect(paths.some(p=>p.owner===o.id)).toBe(false);
 const f=d.objects.find(o=>o.constraintFace==='B|C|P')!,mesh=g.meshes.find(m=>m.id===f.body)!;
 const branch=set.result.branches[0],a=branch.positions.B,b=branch.positions.D;
 expect([[1,-1,1],[1,1,1],[-1,-1,1]].some(ray=>splitVisibilityExact(a,b,unit(ray as [number,number,number]),[mesh]).some(s=>s.hidden))).toBe(true);
});
it('repairs legacy missing surfaces without replacing point IDs or styles',()=>{
 const d=example(),face=d.objects.find(o=>o.constraintFace==='B|C|P')!;
 const legacy={...d,objects:d.objects.filter(o=>o.id!==face.id&&o.id!==face.body).map(o=>{const q={...o};delete q.body;return q;})};
 const next=normalizeDrawing(legacy);expect(next.objects.some(o=>o.constraintFace==='B|C|P')).toBe(true);
 for(const point of d.objects.filter(o=>o.kind==='point'))expect(next.objects.find(o=>o.id===point.id)?.style).toEqual(point.style);
});
it('groups all condition objects and their dependent constructions without duplicating them',()=>{
 const d=example(),set=d.objects.find(o=>o.kind==='solutionSet')!,point=d.objects.find(o=>o.kind==='point'&&o.constraintPointName==='E')!;
 const next=applyDefinition(d,`X_999=Point(${point.symbol})`),shown=next.objects.filter(o=>!o.auxiliary),tree=objectTree(next,shown),root=tree.find(n=>n.id===set.id)!;
 expect(root.children.map(n=>n.label)).toEqual(['点','线','面','轨迹','其他']);expect(root.children.find(n=>n.label==='点')!.children.some(n=>n.id===id(next,'X_999'))).toBe(true);
 const rows=(ns:ObjectTreeNode[]):string[]=>ns.flatMap(n=>[...(n.object?[n.id]:[]),...rows(n.children)]);
 expect(rows(tree).length).toBe(new Set(rows(tree)).size);
 const searched=objectTree(next,[next.objects.find(o=>o.id===id(next,'X_999'))!]);expect(searched[0].id).toBe(set.id);
});
it('uses the actual 3D foot for a perpendicular, including an oblique reference line',()=>{
 let d=addDefinitions(start(),'A=(1,2,3)','B=(3,4,7)','Q=(5,-2,8)','l=Line(A,B)','p=Perpendicular(l,Q)','q=Parallel(l,Q)');
 let [a,b]=ends(d,'p'),[r0,r1]=ends(d,'l'),v=sub(r1,r0),direction=sub(b,a);
 expect(dot(v,direction)).toBeCloseTo(0,10);
 const foot=add(r0,mul(v,dot(sub(a,r0),v)/dot(v,v)));expect(Math.hypot(...cross(sub(foot,a),direction))).toBeLessThan(1e-9);
 const [,parallel]=ends(d,'q');expect(Math.hypot(...cross(sub(parallel,a),v))).toBeLessThan(1e-9);
 d=applyDefinition(d,'Q=(2,8,-1)',id(d,'Q'));[a,b]=ends(d,'p');expect(dot(v,sub(b,a))).toBeCloseTo(0,10);
 expect(()=>applyDefinition(d,'Perpendicular(l,A)')).toThrow(/不唯一/);
});
it('constructs dependent plane normals and parallel planes through arbitrary spatial points',()=>{
 const d=addDefinitions(start(),'m=2','A=(0,0,0)','B=(1,0,m)','C=(0,1,0)','f=Triangle(A,B,C)','Q=(2,3,5)','p=Perpendicular(f,Q)','g=Parallel(f,Q)');
 const check=(doc:DrawingDocument)=>{const g=resolveGeometry(doc),plane=g.plane({type:'polygon',polygon:id(doc,'f')}),n=unit(cross(plane.u,plane.v)),[a,b]=ends(doc,'p');expect(Math.hypot(...cross(n,sub(b,a)))).toBeLessThan(1e-9);
 const target=g.plane({type:'polygon',polygon:id(doc,'g')});expect(Math.hypot(...cross(n,cross(target.u,target.v)))).toBeLessThan(1e-8);expect(dot(sub(g.points.get(id(doc,'Q'))!.p,target.origin),n)).toBeCloseTo(0,10);};
 check(d);check(applyDefinition(d,'m=3',id(d,'m')));check(normalizeDrawing(JSON.parse(JSON.stringify(d))));
});
it('preserves face candidates and point-first selection in spatial relation tools',()=>{
 const hits=[{kind:'face' as const,id:'f',owner:'f',distance:0},{kind:'point' as const,id:'P',owner:'P',distance:0},{kind:'edge' as const,id:'e',owner:'e',distance:0}];
 for(const tool of ['parallel','perpendicular'] as const){const s=initialTool(tool);expect(toolHits(s,hits)).toContain(hits[0]);s.points=['P'];expect(toolHits(s,hits)).toContain(hits[0]);s.references=['f'];expect(toolHits(s,hits)).not.toContain(hits[0]);expect(toolHits(s,hits)).toContain(hits[1]);}
});
it('creates circles, centers, bisectors and measures in the true triangle plane and follows changes',()=>{
 const d=addDefinitions(start(),'m=2','A=(0,0,1)','B=(2,0,1)','C=(0,m,3)','tri=Triangle(A,B,C)','c=Circle3(A,B,C)','i=Incircle(tri)','O_1=Circumcenter(tri)','b=AngleBisector(A,B,C)','s=Area(tri)','M_999=Midpoint(A,B)');
 const check=(doc:DrawingDocument)=>{const g=resolveGeometry(doc),curve=g.curves.get(id(doc,'c'))!,frame=curve.frame!;expect(g.errors.size).toBe(0);expect(frame).toBeTruthy();for(const name of ['A','B','C'])expect(dot(sub(g.points.get(id(doc,name))!.p,frame.origin),unit(cross(frame.u,frame.v)))).toBeCloseTo(0,9);expect(g.points.get(id(doc,'M_999'))!.p).toEqual([1,0,1]);};
 check(d);check(applyDefinition(d,'m=3',id(d,'m')));check(normalizeDrawing(JSON.parse(JSON.stringify(d))));
});
it('keeps spatial tangent and reflection geometry on the actual source plane and rejects projected substitutes',()=>{
 const d=addDefinitions(start(),'A=(0,0,0)','B=(2,0,0)','C=(0,0,2)','c=Circle3(A,B,C)','Q=(4,0,1)','t=Tangent(c,Q)','l=Line(A,C)','rc=Reflect(c,l)','X_999=Reflect(B,l)');
 const g=resolveGeometry(d);expect(g.errors.size).toBe(0);expect(g.curves.get(id(d,'t'))!.frame!.origin[1]).toBeCloseTo(0,10);expect(g.curves.get(id(d,'rc'))!.frame).toBeTruthy();expect(g.points.get(id(d,'X_999'))!.p[0]).toBeCloseTo(-2,10);
 const next=applyDefinition(d,'R=(4,1,1)');expect(()=>applyDefinition(next,'Tangent(c,R)')).toThrow(/平面内/);
 expect(()=>applyDefinition(next,'Locus(B,X_999)')).toThrow(/空间轨迹/);
});
it('intersects spatial circles in distinct local bases without flattening skew lines',()=>{
 const d=addDefinitions(start(),'A=(0,0,0)','B=(2,0,0)','C=(0,0,2)','D=(1,0,0)','Q_8=(3,0,0)','R_8=(1,0,2)','c=Circle3(A,B,C)','k=Circle3(D,Q_8,R_8)','J=Intersect(c,k)');
 const g=resolveGeometry(d);expect(g.errors.size).toBe(0);
 const ps=d.objects.filter(o=>o.kind==='point'&&o.construction.type==='intersection');expect(ps).toHaveLength(2);
 for(const p of ps){const q=g.points.get(p.id)!.p;expect(q[1]).toBeCloseTo(0,10);expect((q[0]-1)**2+(q[2]-1)**2).toBeCloseTo(2,7);expect((q[0]-2)**2+(q[2]-1)**2).toBeCloseTo(2,7);}
 const next=addDefinitions(d,'L=(0,2,0)','M=(2,2,0)','s=Line(L,M)');expect(()=>applyDefinition(next,'Intersect(c,s)')).toThrow(/平面/);
});
