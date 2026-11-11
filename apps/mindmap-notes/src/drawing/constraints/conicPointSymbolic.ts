/** Exact feature coordinates for standard conics. Vertex order is the same as
 * conicVertices: major/transverse negative, positive, then minor negative, positive.
 * Never infer the major axis from a numerical starting guess. */
export function standardConicPoint(source:string,feature:'vertex'|'focus'|'curveCenter',index:number,assumptions:string[]):[string,string]|undefined {
 const text=source.replace(/\s/g,''),name='([A-Za-z][A-Za-z0-9_]*)';
 const central=text.match(new RegExp(`^([xy])\\^2/${name}\\^2([+-])([xy])\\^2/${name}\\^2=1$`));
 if(central){
  const [,axis,a,sign,other,b]=central;if(axis===other)return;
  if(feature==='curveCenter')return ['0','0'];
  const rows=assumptions.map(s=>s.replace(/\s/g,''));
  // The template's strict positive/order guards fix feature identity. Without
  // them a swapped/equal-axis case must remain on the existing fallback path.
  if(sign==='+'&&!(rows.includes(`${a}>${b}`)||rows.includes(`${b}<${a}`)))return;
  if(!rows.includes(`${a}>0`)||!rows.includes(`${b}>0`))return;
  if(index<0||index>(feature==='focus'||sign==='-'?1:3))return;
  const component=feature==='vertex'&&index>=2?other:axis;
  const radius=feature==='focus'?`sqrt(${a}^2${sign==='+'?'-':'+'}${b}^2)`:index>=2?b:a;
  const value=`${index%2===0?'-':''}(${radius})`;
  return component==='x'?[value,'0']:['0',value];
 }
 const parabola=text.match(new RegExp(`^([xy])\\^2=2\\*${name}\\*([xy])$`));
 if(parabola&&parabola[1]!==parabola[3]&&index===0){
  if(feature==='vertex')return ['0','0'];
  if(feature==='focus')return parabola[3]==='x'?[`(${parabola[2]})/2`,'0']:['0',`(${parabola[2]})/2`];
 }
}
