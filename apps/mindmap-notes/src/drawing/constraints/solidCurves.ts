import type {Condition,ConstraintCurve} from './types';
/** Object declarations supplied by round solids. No metric conditions are added here. */
export function solidCurves(conditions:Condition[],existing:ConstraintCurve[]=[]):ConstraintCurve[]{
 const result=[...existing];
 for(const c of conditions)if(c.enabled&&['cone','cylinder','coneFrustum'].includes(c.kind)){
  const [o,t,a,b]=c.refs[0];
  const add=(center:string,radius:string,index:number,radiusSegment?:[string,string])=>{
   const id=`${c.id}:circle:${index}`;if(result.some(x=>x.id===id))return;
   let name=center;for(let n=2;result.some(x=>x.name===name);n++)name=`${center}_${n}`;
   result.push({id,name,type:'circle',method:'centerPoint',points:[center,radius],normalAxis:[o,t],radiusSegment,solid:c.id});
  };
  add(o,a,0);if(c.kind!=='cone')add(t,b??a,1,c.kind==='cylinder'?[o,a]:undefined);
 }return result;
}
