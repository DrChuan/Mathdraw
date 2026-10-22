/** Compact rational / quadratic-radical display for numerically solved geometry.
 * A match is only a display candidate: callers must not substitute it into the
 * solver or claim arbitrary numerical roots have a proven symbolic form. */
export function exactNumber(value:number):{source:string;approximate:boolean} {
  if(!Number.isFinite(value))return {source:String(value),approximate:true};
  const tolerance=Math.min(1e-7,2e-8*Math.max(1,Math.abs(value)));
  if(Math.abs(value)<1e-10)return {source:"0",approximate:false};
  const fraction=(v:number,limit=256):[number,number]|undefined=>{
    for(let d=1;d<=limit;d++){const n=Math.round(v*d);if(Math.abs(n/d-v)<=tolerance&&Math.abs(n)<=1e7)return [n,d];}
  };
  const rational=fraction(value);
  if(rational)return {source:rational[1]===1?String(rational[0]):`${rational[0]}/${rational[1]}`,approximate:false};
  // If v² is rational, sqrt(n/d)=sqrt(n*d)/d; extract square factors.
  const squared=value*value;
  if(squared<1e7)for(let d=1;d<=256;d++) {
    const n=Math.round(squared*d);if(n<=0||n*d>1e7||Math.abs(Math.sqrt(n/d)-Math.abs(value))>tolerance)continue;
    let rad=n*d,factor=1;
    for(let k=2;k*k<=rad;k++)while(rad%(k*k)===0){factor*=k;rad/=k*k;}
    const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,g=gcd(factor,d),num=factor/g,den=d/g;
    const source=`${value<0?"-":""}${num===1?"":`${num}*`}sqrt(${rad})${den===1?"":`/${den}`}`;
    return {source,approximate:false};
  }
  return {source:String(Number(value.toPrecision(9))),approximate:true};
}
export function exactCoordinates(values:number[]) {
  const parts=values.map(exactNumber);
  return {source:`(${parts.map(p=>p.source).join(", ")})`,approximate:parts.some(p=>p.approximate)};
}
