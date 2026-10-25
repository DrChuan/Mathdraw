import {describe,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ocrRegions,parseExtraction,compileRecognition} from './model';
import {replyText} from './adapter';
import {solveConstraints} from '../constraints/solver';
import {parseConditions,segmentsFrom} from '../constraints/input';
// Never calls a provider: validates responses from the explicitly run Rust test.
const directory=process.env.MATHDRAW_RECOGNITION_RESPONSES??fileURLToPath(new URL('../../../../数学绘图/examples/题干截图识别/云端记录/',import.meta.url));
describe('recorded live Bailian responses',()=>{
 for(const name of (process.env.MATHDRAW_RECOGNITION_CASES??'circle,parabola,ellipse,pyramid').split(','))it(name,()=>{
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')),fixture=manifest.cases.find((c:{name:string})=>c.name===name),png=fixture.image?Buffer.from(fixture.image.split(',')[1],'base64'):readFileSync(resolve(directory,fixture.imageFile)),image='data:image/png;base64,'+png.toString('base64'),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  const read=(suffix:string)=>JSON.parse(readFileSync(join(directory!,`${name}-${suffix}.json`),'utf8'));
  const q=parseExtraction(replyText(read('extract')),{image,width,height,regions:ocrRegions(read('ocr'),width,height)});
  if(name==='ellipse'||name==='pyramid2')for(const scope of q.scopes){const branch=compileRecognition({...q,activeScope:scope.id});expect(branch.recognition!.activeScope).toBe(scope.id);}
  const c=compileRecognition(q);if(process.env.MATHDRAW_WRITE_RECOGNITION_FIXTURES==='1')writeFileSync(resolve(directory,'..',`${name}.mathdraw-conditions.json`),JSON.stringify(c,null,2));const points=c.points.split(' '),problem={mode:c.mode,points,segments:segmentsFrom(c.segments,points),conditions:c.conditions.flatMap(row=>parseConditions(row.source,points,row.id,c.curves)),planar:c.planar,curves:c.curves};
  const r=solveConstraints({id:1,problem,budget:4000});expect(r.branches.length).toBeGreaterThan(0);
  if(name==='parabola'){expect(r.branches.some(b=>Math.abs(b.positions.A[0]-3)<1e-4)).toBe(true);expect(q.originalText).toMatch(/A[.．、]\s*1/);expect(q.originalText).toMatch(/D[.．、]\s*4/);}
  if(name==='ellipse'){const u=c.planar!.unknowns.find(u=>c.planar!.document.objects.some(o=>o.id===u.object&&o.symbol==='a'))!;expect(r.branches[0].values![u.id]**2).toBeCloseTo(8,4);expect(q.scopes.some(s=>s.parent!=='common'&&s.parent)).toBe(true);expect(q.items.some(i=>i.source.replace(/\s/g,'')==='a>0')).toBe(true);expect(r.branches.every(b=>b.values![u.id]>0)).toBe(true);}
  if(name==='pyramid')expect(problem.conditions.some(c=>c.kind==='rectangle')).toBe(false);
 });
});
