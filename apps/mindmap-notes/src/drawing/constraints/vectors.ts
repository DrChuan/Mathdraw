import { parseExpression,evaluate,scalar } from "../expression";
import { numericFunctions } from "../symbols";
import { mathPreview,symbolLatex } from "../mathPreview";
import type { Condition,Positions } from "./types";
import type { Vec3 } from "../types";
import { add,mul,sub,norm,dot } from "./math";

type Resolve=(source:string)=>string[];
type Term={ref:string[];coefficient:number;source:string};
type Linear={scalar:number;terms:Term[]};
type Ast=ReturnType<typeof parseExpression>;

/** Parse vector arithmetic through the same restricted AST as numeric input.
 * Vector*vector and nonlinear powers are explicitly rejected, never evaluated
 * as lengths. Zero may stand for the zero vector on either side of an equality.
 */
function vectorTokens(source:string,resolve:Resolve) {
  const refs=new Map<string,string[]>();let index=0;
  const token=(source:string)=>{
    if(source.trim()==="0")return " 0 ";
    const ref=resolve(source);if(ref.length!==2)throw new Error("向量需要两个不同的端点，如 AB");
    const name=`VEC_${index++}`;refs.set(name,ref);return ` ${name} `;
  };
  let text=(source.trim().match(/^vectorRelation\s*\(([\s\S]*)\)$/i)?.[1]??source).trim().replace(/^\$\$?([\s\S]*?)\$\$?$/,"$1").replace(/＝/g,"=")
    .replace(/_\{([A-Za-z0-9]+)\}/g,"_$1");
  text=text.replace(/\\(?:overrightarrow|vec)\s*\{([^{}]+)\}/g,(_,ref:string)=>token(ref))
    .replace(/\b(?:vec|vector)\s*\(([^()]+)\)/gi,(_,ref:string)=>token(ref));
  text=text.replace(/(?<![\\A-Za-z_])[A-Za-z][A-Za-z0-9_]*/g,word=>{
    if(refs.has(word)||numericFunctions.has(word.toLowerCase()))return word;
    try{const ref=resolve(word);if(ref.length===2)return token(word);}catch{/* Leave numeric function names for the numeric parser. */}
    return word;
  });
  return {text,refs};
}

/** Preserve the written fractional/radical coefficients in the condition chip;
 * numeric coefficient recognition must never become a symbolic display guess. */
export function vectorRelationFormula(source:string,resolve:Resolve) {
  const {text,refs}=vectorTokens(source,resolve);
  let formula=text.split("=").map(s=>mathPreview(s.trim())).join("=");
  for(const [token,ref] of refs) {
    const vector=`\\overrightarrow{${ref.map(symbolLatex).join("")}}`;
    formula=formula.split(symbolLatex(token)).join(vector).split(token).join(vector);
  }
  return formula.replace(/\*/g,"\\cdot ");
}

export function parseVectorRelation(source:string,resolve:Resolve):Pick<Condition,"kind"|"refs"|"coefficients"|"coefficientSources"> {
  const {text,refs}=vectorTokens(source,resolve);
  const parts=text.split("=");if(parts.length!==2||parts.some(p=>!p.trim()))throw new Error("向量关系需要左右两侧，例如 AB = 2*AC - AD");
  const astSource=(a:Ast):string=>a.type==='number'?a.constant??a.literal??String(a.value):a.type==='variable'?a.name:a.type==='unary'?`(${a.sign})*(${astSource(a.value)})`:a.type==='call'?`${a.name}(${a.args.map(astSource).join(',')})`:`(${astSource(a.left)})${a.op}(${astSource(a.right)})`;
  const scale=(a:Linear,k:number,text=String(k)):Linear=>({scalar:a.scalar*k,terms:a.terms.map(t=>({...t,coefficient:t.coefficient*k,source:`(${t.source})*(${text})`}))});
  const walk=(ast:Ast):Linear=>{
    if(ast.type==="number")return {scalar:ast.value,terms:[]};
    if(ast.type==="variable")return {scalar:0,terms:[{ref:refs.get(ast.name)!,coefficient:1,source:'1'}]};
    if(ast.type==="unary")return scale(walk(ast.value),ast.sign);
    if(ast.type==="call") {
      if(ast.args.some(a=>walk(a).terms.length))throw new Error("向量不能作为数值函数的参数");
      return {scalar:evaluate(ast),terms:[]};
    }
    const a=walk(ast.left),b=walk(ast.right);
    if(ast.op==="+"||ast.op==="-") {
      const right=scale(b,ast.op==="+"?1:-1);
      const result={scalar:a.scalar+right.scalar,terms:[...a.terms,...right.terms]};
      if(result.terms.length&&Math.abs(result.scalar)>1e-12)throw new Error("向量不能与非零数值相加");
      return result;
    }
    if(ast.op==="*"&&(!a.terms.length||!b.terms.length))return a.terms.length?scale(a,b.scalar,astSource(ast.right)):scale(b,a.scalar,astSource(ast.left));
    if(ast.op==="/"&&!b.terms.length){if(b.scalar===0)throw new Error("系数不能除以零");return scale(a,1/b.scalar,`1/(${astSource(ast.right)})`);}
    if(!a.terms.length&&!b.terms.length)return {scalar:evaluate(ast),terms:[]};
    throw new Error("仅支持向量的线性运算；数量积请使用 dot(AB,CD)=数值");
  };
  const left=walk(parseExpression(parts[0],[...refs.keys()])),right=walk(parseExpression(parts[1],[...refs.keys()]));
  if(!left.terms.length&&!right.terms.length)throw new Error("请至少填写一个向量");
  if(Math.abs(left.scalar)>1e-12||Math.abs(right.scalar)>1e-12)throw new Error("向量等式右侧可使用 0，不能使用其他数值");
  const terms=[...left.terms,...scale(right,-1).terms];
  if(terms.length>64||terms.some(t=>!Number.isFinite(t.coefficient)||Math.abs(t.coefficient)>1e6))throw new Error("向量项过多或系数超出范围");
  return {kind:"vectorRelation",refs:terms.map(t=>t.ref),coefficients:terms.map(t=>t.coefficient),coefficientSources:terms.map(t=>t.source)};
}

export function vectorDotSource(source:string,resolve:Resolve):Pick<Condition,"kind"|"refs"|"value">|undefined {
  let text=source.trim().replace(/^\$\$?([\s\S]*?)\$\$?$/,"$1").replace(/＝/g,"=")
    .replace(/_\{([A-Za-z0-9]+)\}/g,"_$1").replace(/\\(?:left|right)\b/g,"");
  text=text.replace(/\\(?:overrightarrow|vec)\s*\{([^{}]+)\}/g,"$1").replace(/\b(?:vec|vector)\s*\(([^()]+)\)/gi,"$1");
  const call=text.match(/^(?:dot|vectorDot|scalarProduct)\s*\(\s*([^,;]+)[,;]\s*([^,)]+)\s*\)\s*=\s*([\s\S]+)$/i);
  const command=text.match(/^(?:dot|vectorDot|scalarProduct)\s*\(\s*([^,;]+)[,;]\s*([^,;)]+)[,;]\s*([\s\S]+)\)\s*$/i);
  const marked=/\\(?:overrightarrow|vec)\b|\b(?:vec|vector)\s*\(/i.test(source);
  const product=marked?text.match(/^(.+?)\s*(?:\\cdot\b|·|⋅)\s*(.+?)\s*=\s*([\s\S]+)$/):undefined;
  const m=call??command??product;if(!m)return;
  return {kind:"vectorDot",refs:[resolve(m[1]),resolve(m[2])],value:scalar(m[3])};
}

export function vectorWeights(refs:string[][],coefficients:number[]):Map<string,number> {
  const result=new Map<string,number>();
  refs.forEach(([a,b],i)=>{result.set(a,(result.get(a)??0)-coefficients[i]);result.set(b,(result.get(b)??0)+coefficients[i]);});
  return result;
}

/** A dot product with one unknown point is a plane or a sphere, including
 * the case where the same point occurs in both vectors. */
export function dotPointLocus(refs:string[][],value:number,p:Positions,point:string) {
  if(!refs.flat().every(n=>n===point||p[n]))return;
  const parts=refs.map(([a,b])=>({k:(b===point?1:0)-(a===point?1:0),
    offset:sub(b===point?[0,0,0]:p[b],a===point?[0,0,0]:p[a])}));
  const [a,b]=parts,q=a.k*b.k,linear=add(mul(b.offset,a.k),mul(a.offset,b.k)),constant=dot(a.offset,b.offset)-value;
  if(q===0) {
    const length=dot(linear,linear);if(length<1e-24)return;
    return {plane:{origin:mul(linear,-constant/length),normal:linear}};
  }
  const center=mul(linear,-1/(2*q)),radius2=dot(center,center)-constant/q;
  if(radius2<0)return;
  return {sphere:{center,radius:Math.sqrt(radius2)}};
}

/** Gaussian elimination of coupled affine vector equations, one shared scalar
 * coefficient matrix with three coordinate right-hand sides. Only uniquely
 * determined points are returned; free variables remain free. */
export function affineVectorPoints(conditions:{kind:string;refs:string[][];coefficients?:number[];value?:number}[],positions:Positions):Positions {
  const rows=conditions.flatMap(c=>{
    if(c.kind==="vectorRelation")return [vectorWeights(c.refs,c.coefficients!)];
    if(c.kind==="vectorSum")return [new Map(c.refs[0].map((n,i)=>[n,i<2?1:-1]))];
    if(c.kind==="division") {
      const [m,a,b]=c.refs.flat(),t=c.value!/(1+c.value!);
      return [new Map([[m,1],[a,t-1],[b,-t]])];
    }
    return [];
  });
  const names=[...new Set(rows.flatMap(r=>[...r].filter(([n,k])=>Math.abs(k)>1e-12&&!positions[n]).map(([n])=>n)))];
  if(!names.length)return {};
  const matrix=rows.map(row=>{
    const rhs=[...row].reduce((sum,[name,k])=>positions[name]?sub(sum,mul(positions[name],k)):sum,[0,0,0] as Vec3);
    const a=[...names.map(n=>row.get(n)??0),...rhs],max=Math.max(1e-30,...a.slice(0,names.length).map(Math.abs));
    return a.map(v=>v/max);
  });
  let rank=0;const pivots:number[]=[];
  for(let col=0;col<names.length&&rank<matrix.length;col++) {
    let best=rank;for(let i=rank+1;i<matrix.length;i++)if(Math.abs(matrix[i][col])>Math.abs(matrix[best][col]))best=i;
    if(Math.abs(matrix[best][col])<1e-10)continue;
    [matrix[rank],matrix[best]]=[matrix[best],matrix[rank]];
    const pivot=matrix[rank][col];matrix[rank]=matrix[rank].map(v=>v/pivot);
    for(let i=0;i<matrix.length;i++)if(i!==rank){const factor=matrix[i][col];matrix[i]=matrix[i].map((v,j)=>v-factor*matrix[rank][j]);}
    pivots.push(col);rank++;
  }
  const result:Positions={};
  pivots.forEach((col,i)=>{if(matrix[i].slice(0,names.length).every((v,j)=>j===col||Math.abs(v)<1e-9)){
    const p=matrix[i].slice(names.length) as Vec3;if(p.every(Number.isFinite)&&norm(p)<=1e9)result[names[col]]=p;
  }});
  return result;
}
