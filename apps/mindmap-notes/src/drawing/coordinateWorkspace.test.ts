import {describe,it,expect} from 'vitest';
import {newDrawing} from './types';
import {planarContext,objectSymbol} from './constraints/planarModel';
import {decodeConfiguration} from './constraints/configuration';
import {normalizeCoordinateDraft,proposeCoordinateObjects,proposeCoordinateShape,proposeCoordinateRelations,relatedRows,removeCoordinateObject,replaceCoordinateObject,updateLegacyCurves,type CoordinateDraft} from './coordinateWorkspace';
const blank=():CoordinateDraft=>({context:planarContext(newDrawing()),points:'O',segments:'',conditions:[],curves:[]});
const add=(d:CoordinateDraft,s:string)=>proposeCoordinateObjects(d,s).draft;
describe('coordinate object / relation workspace',()=>{
 it('imports legacy point and edge declarations once, keeping original objects',()=>{
  let d=add(blank(),'A=(1,2)');const a=d.context.document.objects.find(o=>objectSymbol(o)==='A')!;a.hidden=true;
  d=normalizeCoordinateDraft({...d,points:'O A B',segments:'AB, B A'});
  expect(d.context.document.objects.find(o=>objectSymbol(o)==='A')).toMatchObject({id:a.id,hidden:true});
  expect(d.context.document.objects.filter(o=>o.kind==='segment')).toHaveLength(1);
  expect(d.context.unknowns).toHaveLength(2);expect(d.segments).toBe('');
  expect(normalizeCoordinateDraft(d)).toEqual(d);
 });
 it('batch creates one polygon and one semantic rectangle relation, reusing points and edges',()=>{
  const initial=add(blank(),'A=(0,0)\nB=(2,0)\ns=Segment(A,B)');
  const p=proposeCoordinateShape(initial,'rectangle','A B C D');
  expect(p.reused).toEqual(['A','B']);expect(p.draft.conditions.map(c=>c.kind)).toEqual(['rectangle']);
  expect(p.draft.context.document.objects.filter(o=>o.kind==='polygon')).toHaveLength(1);
  expect(p.draft.context.document.objects.filter(o=>o.kind==='segment')).toHaveLength(4);
  const twice=proposeCoordinateShape(p.draft,'rectangle','A B C D');expect(twice.created).toHaveLength(0);expect(twice.relations).toHaveLength(0);
 });
 it('offers missing conventional points without drawing inferred segments or mutating the source',()=>{
  const d=blank(),snapshot=JSON.stringify(d),p=proposeCoordinateRelations(d,['AB\\perp CD']);
  expect(p.missing.sort()).toEqual(['A','B','C','D']);expect(p.created).toHaveLength(4);
  expect(p.draft.context.document.objects.some(o=>o.kind==='segment')).toBe(false);expect(JSON.stringify(d)).toBe(snapshot);
  expect(p.draft.conditions[0].kind).toBe('perpendicular');
 });
 it('reuses symmetric equivalent relationships',()=>{
  const p=proposeCoordinateRelations(blank(),['AB\\perp CD']);
  const q=proposeCoordinateRelations(p.draft,['perpendicular(DC,BA)']);
  expect(q.draft.conditions).toHaveLength(1);expect(q.relations).toHaveLength(0);
 });
 it('does not invent unknown curves or implicit scalar parameters',()=>{
  expect(()=>proposeCoordinateRelations(blank(),['onCurve(A,C)'])).toThrow('先定义');
  expect(()=>proposeCoordinateRelations(blank(),['AB=k'])).toThrow();
  const p=proposeCoordinateRelations(blank(),['k=?','k>0']);expect(p.created.some(o=>o.kind==='number'&&objectSymbol(o)==='k')).toBe(true);
 });
 it('keeps conic e as a derived definition when adding an eccentricity restriction',()=>{
  const p=add(blank(),'椭圆 C x 参数 a,b,c,e');const e=p.context.document.objects.find(o=>objectSymbol(o)==='e')!;
  const q=proposeCoordinateRelations(p,['e=sqrt(2)/2']);
  expect(q.draft.context.document.objects.find(o=>o.id===e.id)).toEqual(e);
  expect(q.relations.some(r=>r.source==='e=sqrt(2)/2')).toBe(true);expect(q.created).toHaveLength(0);
 });
 it('blocks deletion when a relation or object still references the source',()=>{
  const d=add(blank(),'A=(0,0)\nB=(2,0)\ns=Segment(A,B)');const a=d.context.document.objects.find(o=>objectSymbol(o)==='A')!;
  expect(()=>removeCoordinateObject(d,a.id)).toThrow('引用');
  const p=proposeCoordinateRelations(d,['AB=2']).draft;expect(relatedRows(p,a.id)).toHaveLength(1);
 });
 it('keeps IDs while editing known and unknown coordinate fields',()=>{
  const d=add(blank(),'A=(?,?)');const a=d.context.document.objects.find(o=>objectSymbol(o)==='A')!;
  const c=replaceCoordinateObject(d.context,a.id,'A=(2,?)');expect(c.document.objects.find(o=>objectSymbol(o)==='A')?.id).toBe(a.id);
  expect(c.unknowns.filter(u=>u.object===a.id).map(u=>u.field)).toEqual(['y']);
 });
 it('keeps legacy circles registered once, and edits their original declaration without divergence',()=>{
  const d=add(blank(),'A=(2,0)');d.curves=[{id:'legacy-circle',name:'c',type:'circle',method:'centerRadius',points:['O'],value:2,valueSource:'2'}];
  const p=normalizeCoordinateDraft(d),curve=p.context.document.objects.find(o=>objectSymbol(o)==='c')!;
  expect(p.context.document.objects.filter(o=>objectSymbol(o)==='c')).toHaveLength(1);
  expect(proposeCoordinateRelations(p,['onCurve(A,c)']).draft.conditions[0].curve).toBe('legacy-circle');
  const q=updateLegacyCurves(p,[{...p.curves[0],value:3,valueSource:'3'}]);
  const changed=q.context.document.objects.find(o=>o.id===curve.id);expect(changed?.kind==='curve'&&changed.circle?.radius).toBe(3);expect(q.curves[0].value).toBe(3);
 });
 it('uses the existing v2 configuration format after unifying objects',()=>{
  const d=proposeCoordinateShape(blank(),'rectangle','A B C D').draft;
  const c=decodeConfiguration(JSON.stringify({format:'mathdraw-conditions',version:2,mode:'coordinate',points:d.points,segments:d.segments,curves:d.curves,planar:d.context,conditions:d.conditions,placement:{planeNames:[],side:1,orientationPoint:'',keepPlacement:true,mirrored:false}}));
  expect(c.version).toBe(2);expect(c.planar?.document.objects.map(o=>o.id)).toEqual(d.context.document.objects.map(o=>o.id));
 });
});

it('creates a diameter circle with dependencies on both endpoints',()=>{
 const d=add(blank(),'A=(0,0)\nB=(4,0)'),p=proposeCoordinateObjects(d,'c=DiameterCircle(A,B)');
 const c=p.created.find(o=>objectSymbol(o)==='c');expect(c?.kind).toBe('curve');
 expect(c&&relatedRows(p.draft,c.id)).toEqual([]);
 expect(()=>removeCoordinateObject(p.draft,p.draft.context.document.objects.find(o=>objectSymbol(o)==='A')!.id)).toThrow();
});
