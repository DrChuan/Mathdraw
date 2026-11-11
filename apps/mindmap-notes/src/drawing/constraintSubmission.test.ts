import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {newDrawing,type DrawingDocument} from './types';
import {normalizeDrawing} from './model';
import {resolveGeometry} from './geometry';
import {submitConstraintDrawing} from './constraintSubmission';
import {decodeConfiguration} from './constraints/configuration';
import {parseConditions,pointNames,segmentsFrom} from './constraints/input';
import {solveConstraints} from './constraints/solver';
import {solutionSetObject,placeOnPlane,installSolutionSet} from './constraints/document';
import {constraintObjectId} from './constraints/objectIdentity';
import type {ConstraintProblem,Positions} from './constraints/types';

it('commits the recognized spatial pyramid after placement, preserving condition IDs and stable object references',()=>{
 const c=decodeConfiguration(readFileSync(new URL('./constraints/fixtures/spatial-recognition-submit.json',import.meta.url),'utf8')),points=pointNames(c.points);
 const p:ConstraintProblem={mode:'spatial',points,segments:segmentsFrom(c.segments,points),curves:c.curves,conditions:c.conditions.flatMap(r=>parseConditions(r.source,points,r.id,c.curves).map(x=>({...x,enabled:r.enabled})))};
 const before=JSON.stringify(p),r=solveConstraints({id:1,problem:p,budget:1500});expect(r.method).toBe('construction');expect(r.branches).toHaveLength(2);expect(r.branches.every(b=>b.dof===0)).toBe(true);
 const set=placeOnPlane(solutionSetObject(p,r),c.placement.planeNames as [string,string,string],1),base=newDrawing();base.dimension='3d';base.view.mode='space';
 const next=installSolutionSet(base,set),commit=vi.fn((_doc:DrawingDocument)=>true);submitConstraintDrawing(next,commit);expect(commit).toHaveBeenCalledOnce();expect(JSON.stringify(p)).toBe(before);
 const accepted=commit.mock.calls[0][0] as DrawingDocument;expect(accepted.objects.every(o=>!o.id.includes(':'))).toBe(true);expect(resolveGeometry(accepted).errors.size).toBe(0);
 const body=accepted.objects.find(o=>o.kind==='solid')!;expect(body.id).toBe(constraintObjectId(set.id,'body','i1:0'));
 const reopened=normalizeDrawing(JSON.parse(JSON.stringify(accepted)));expect(reopened.objects.map(o=>o.id)).toEqual(accepted.objects.map(o=>o.id));
 const updated=normalizeDrawing(installSolutionSet(reopened,{...set,activeBranch:1}));expect(updated.objects.find(o=>o.id===body.id)?.style).toEqual(body.style);expect(updated.objects.map(o=>o.id).sort()).toEqual(accepted.objects.map(o=>o.id).sort());
});

it('encodes generated IDs without aliasing colon and literal escape sequences or changing legacy UUIDs',()=>{
 const sources=['i1:0','i1%3A0','i1%253A0','plain-id','a:b:c'];
 const ids=sources.map(s=>constraintObjectId('set','round',s));expect(new Set(ids).size).toBe(sources.length);expect(ids.every(id=>!id.includes(':'))).toBe(true);expect(constraintObjectId('set','curve','plain-id')).toBe('set-curve-plain-id');
});

it.each(['spatial','plane'] as const)('installs %s declared curves and round solids using opaque source IDs and removes disabled solids',mode=>{
 const points=['O','D','A','B'],positions:Positions={O:[0,0,0],D:mode==='spatial'?[0,0,2]:[0,2,0],A:[1,0,0],B:[0,1,0]};
 const p:ConstraintProblem={mode,points,segments:[],conditions:mode==='spatial'?parseConditions('cone(O,D,A)',points,'cone:0'):[],curves:[{id:'curve:0',name:'C',type:'circle',method:'centerRadius',points:['O'],value:1,valueSource:'1',...(mode==='spatial'?{plane:['O','A','B']}:{} )}]};
 const set=solutionSetObject(p,{status:'solved',branches:[{positions,rigid:[points],reference:points,dof:0,residual:0,loci:[]}],complete:true,attempts:1,elapsed:0,diagnostics:[]});
 const base=newDrawing();base.dimension=mode==='spatial'?'3d':'2d';const doc=normalizeDrawing(installSolutionSet(base,set));expect(doc.objects.every(o=>!o.id.includes(':'))).toBe(true);expect(resolveGeometry(doc).errors.size).toBe(0);
 const curve=doc.objects.find(o=>o.kind==='curve')!;expect(curve.id).toBe(constraintObjectId(set.id,'curve','curve:0'));
 const updated=normalizeDrawing(installSolutionSet(doc,{...set,problem:{...p,conditions:p.conditions.map(c=>({...c,enabled:false}))}}));expect(updated.objects.find(o=>o.id===curve.id)).toBeTruthy();expect(updated.objects.some(o=>o.kind==='solid'&&o.construction?.type==='roundPoints')).toBe(false);
});

it('reports validation and rejected commit failures inside the workspace without mutating the input',()=>{
 const doc=newDrawing(),before=JSON.stringify(doc),reject=vi.fn(()=>false);
 expect(()=>submitConstraintDrawing(doc,reject)).toThrow('未能放入绘图区');expect(JSON.stringify(doc)).toBe(before);
 const invalid={...doc,objects:doc.objects.map(o=>({...o,id:'bad:id'}))},commit=vi.fn(()=>true);expect(()=>submitConstraintDrawing(invalid,commit)).toThrow('对象身份');expect(commit).not.toHaveBeenCalled();
});
