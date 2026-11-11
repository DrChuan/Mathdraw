import {parseExpression,evaluate} from '../expression';
type Ast=ReturnType<typeof parseExpression>;
export function expressionSource(a:Ast):string {
 if(a.type==='number')return a.constant??a.literal??String(a.value);
 if(a.type==='variable')return a.name;
 if(a.type==='unary')return `${a.sign===-1?'-':'+'}(${expressionSource(a.value)})`;
 if(a.type==='call')return `${a.name}(${a.args.map(expressionSource).join(',')})`;
 return `(${expressionSource(a.left)})${a.op}(${expressionSource(a.right)})`;
}
/** Squaring a nonnegative distance must not leave coordinate radicals inside
 * a nominal quadratic. Keep sums intact; they may genuinely be nonquadratic. */
export function squaredExpression(source:string,names:string[]){
 const square=(a:Ast):string=>{
  if(a.type==='unary'||a.type==='call'&&a.name==='abs'&&a.args.length===1)return square(a.type==='unary'?a.value:a.args[0]);
  if(a.type==='call'&&a.name==='sqrt'&&a.args.length===1)return expressionSource(a.args[0]);
  if(a.type==='binary'&&(a.op==='*'||a.op==='/'))return `(${square(a.left)})${a.op}(${square(a.right)})`;
  return `(${expressionSource(a)})^2`;
 };return square(parseExpression(source,names));
}
/** Domain projection for scalar definitions, without inventing an independent
 * variable for their output. Principal roots and every nested pole survive. */
export function algebraicDomains(source:string,names:string[]){
 const guards:string[]=[],walk=(a:Ast):void=>{
  if(a.type==='unary'){walk(a.value);return;}if(a.type==='number'||a.type==='variable')return;
  if(a.type==='call'){
   a.args.forEach(walk);if(['sin','cos','atan','floor','ceil','sign','min','max'].includes(a.name))return;
   if(a.args.length!==1||!['sqrt','abs'].includes(a.name))throw Error(`函数 ${a.name} 的全局定义域尚未代数化`);
   if(a.name==='sqrt')guards.push(`${expressionSource(a.args[0])}>=0`);return;
  }
  walk(a.left);walk(a.right);
  if(a.op==='/')guards.push(`${expressionSource(a.right)}!=0`);
  if(a.op==='^'){
   const power=evaluate(a.right);if(!Number.isFinite(power))throw Error('变化指数尚未代数化');
   if(!Number.isInteger(power))guards.push(`${expressionSource(a.left)}>=0`);if(power<0)guards.push(`${expressionSource(a.left)}!=0`);
  }
 };
 walk(parseExpression(source,names,{length:32768,nodes:8192,depth:128}));return guards;
}
/** Conservative sign proof for guards introduced by nonnegative lengths. */
export function nonnegativeExpression(source:string,names:string[]){
 const check=(a:Ast):boolean=>{
  try{const n=evaluate(a);if(Number.isFinite(n))return n>=0;}catch{/* Contains a coordinate. */}
  if(a.type==='call'&&a.args.length===1){if(a.name==='sqrt')return check(a.args[0]);if(a.name==='abs')return total(a.args[0]);}
  if(a.type==='unary')return a.sign===1&&check(a.value);
  if(a.type==='binary'){
   if(a.op==='+'||a.op==='*')return check(a.left)&&check(a.right);
   if(a.op==='^'&&a.right.type==='number')return a.right.value>0&&a.right.value%2===0&&total(a.left);
   if(a.op==='/')try{return check(a.left)&&evaluate(a.right)>0;}catch{return false;}
  }return false;
 };
 const total=(a:Ast):boolean=>{if(a.type==='number'||a.type==='variable')return true;if(a.type==='unary')return total(a.value);if(a.type==='call')return a.args.length===1&&(a.name==='sqrt'?check(a.args[0]):a.name==='abs'&&total(a.args[0]));if(['+','-','*'].includes(a.op))return total(a.left)&&total(a.right);if(a.op==='^')return a.right.type==='number'&&a.right.value>=0&&Number.isInteger(a.right.value)&&total(a.left);if(a.op==='/')try{const d=evaluate(a.right);return total(a.left)&&Number.isFinite(d)&&d!==0;}catch{return false;}return false;};
 try{return check(parseExpression(source,names));}catch{return false;}
}
