import {it,expect} from 'vitest';
import {newDrawing} from './types';
import {applyDefinition,normalizeDrawing} from './model';
import {resolveGeometry} from './geometry';
import {perpendicularConicTangents,conicCoefficients} from './conics';
import {sampleLocus,locusDomain} from './locus';
it('constructs horizontal and vertical tangents without slope singularities',()=>{for(const direction of [[1,0],[0,1]] as [number,number][]){const lines=perpendicularConicTangents('x^2/9+y^2/4=1',direction);expect(lines).toHaveLength(2);for(const l of lines){const q=conicCoefficients(l)!;expect(q[3]*direction[1]-q[4]*direction[0]).toBeCloseTo(0);}}});
it('rejects nonexistent finite tangents',()=>{expect(perpendicularConicTangents('y^2=4*x',[0,1])).toHaveLength(0);});
it('traces the director circle from tangent intersections, preserving reload and dependencies',()=>{let d=newDrawing();for(const s of ['C: x^2/9+y^2/4=1','M=On(C,(3,0))','t=Tangent(C,M,1)','s_1=PerpendicularTangent(C,t,1)','s_2=PerpendicularTangent(C,t,2)','P=Intersect(t,s_1,1)','Q=Intersect(t,s_2,1)','r=Locus(M,P)','r_2=Locus(M,Q)'])d=applyDefinition(d,s);d=normalizeDrawing(JSON.parse(JSON.stringify(d)));const g=resolveGeometry(d);expect(g.errors.size).toBe(0);const id=(name:string)=>d.objects.find(o=>o.symbol===name)!.id,range=locusDomain(d,id('M'));let count=0;const bins=new Set<number>();for(const name of ['P','Q']){const paths=sampleLocus(d,id('M'),id(name),'xy',...range,10000);for(const [x,y]of paths.flat()){expect(x*x+y*y).toBeCloseTo(13,5);bins.add(Math.floor((Math.atan2(y,x)+Math.PI)*36/(2*Math.PI))%36);count++;}}expect(count).toBeGreaterThan(100);expect(bins.size).toBeGreaterThanOrEqual(35);},20000);
