import { parseExpression } from "./expression";
type Ast = ReturnType<typeof parseExpression>;
const functions = new Set(["sin","cos","tan","asin","acos","atan","sqrt","abs","exp","ln","log","log10","floor","ceil","sign","min","max"]);
/** Concatenated endpoint names such as D_1A_1 must not become D_{1A}_1. */
export function symbolLatex(name:string):string {
  return name.replace(/_([0-9]+)([A-Za-z])(?=_)/g,"_{$1}$2")
    .replace(/([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9_]+)/g,(_all,base,sub)=>`${base}_{${sub.replace(/_/g,"\\,")}}`);
}
function latex(ast: Ast, parent = 0): string {
  if (ast.type === "number") return String(ast.value);
  if (ast.type === "variable") return ast.name === "pi" ? "\\pi" : symbolLatex(ast.name);
  if (ast.type === "call") {
    const args = ast.args.map(a => latex(a)).join(", ");
    if (ast.name === "sqrt") return `\\sqrt{${args}}`;
    if (ast.name === "abs") return `\\left|${args}\\right|`;
    const fn = ({asin:"arcsin",acos:"arccos",atan:"arctan"} as Record<string,string>)[ast.name] ?? ast.name;
    return `\\operatorname{${fn}}\\left(${args}\\right)`;
  }
  if (ast.type === "unary") {
    const s = `${ast.sign < 0 ? "-" : "+"}${latex(ast.value,25)}`;
    return parent > 25 ? `\\left(${s}\\right)` : s;
  }
  if (ast.op === "/") return `\\frac{${latex(ast.left)}}{${latex(ast.right)}}`;
  if (ast.op === "^" && ast.right.type === "binary" && ast.right.op === "/" &&
    ast.right.left.type === "number" && ast.right.left.value === 1 && ast.right.right.type === "number") {
    const n = ast.right.right.value;
    if (Number.isInteger(n) && n >= 2) return `\\sqrt${n === 2 ? "" : `[${n}]`}{${latex(ast.left)}}`;
  }
  const precedence = ast.op === "^" ? 30 : ast.op === "*" ? 20 : 10;
  const s = ast.op === "^" ? `${latex(ast.left,31)}^{${latex(ast.right)}}`
    : `${latex(ast.left,precedence)}${ast.op === "*" ? "\\cdot " : ast.op}${latex(ast.right,precedence+1)}`;
  return precedence < parent ? `\\left(${s}\\right)` : s;
}
/** Exact generated locus expressions always use the restricted numerical grammar. */
export function locusFormula(curve: {resolvedDefinition?:string;parametric?:{x:string;y:string}}):string {
  const render=(s:string)=>latex(parseExpression(s,["x","y","t"]));
  if(curve.resolvedDefinition && !curve.resolvedDefinition.includes("(t)=")) {
    try {return curve.resolvedDefinition.split("=").map(render).join("=");}catch{}
  }
  if(curve.parametric)try{return `\\begin{cases}x=${render(curve.parametric.x)}\\\\y=${render(curve.parametric.y)}\\end{cases}`;}catch{}
  return mathPreview(curve.resolvedDefinition??"");
}
/** Display only: leave the editable source and its calculation grammar unchanged. */
export function mathPreview(source: string, depth = 0): string {
  if (depth > 64 || source.length > 8192) return source;
  let level = 0, quoted = false, start = 0;
  const parts: string[] = [];
  for (let i=0; i<source.length; i++) {
    const c=source[i];
    if (c === '"' && source[i-1] !== "\\") quoted=!quoted;
    if (quoted) continue;
    if ("({[".includes(c)) level++;
    else if (")}]".includes(c)) level--;
    else if (level === 0 && "=,:".includes(c)) {
      parts.push(mathPreview(source.slice(start,i),depth+1),c); start=i+1;
    }
  }
  if (parts.length) return [...parts,mathPreview(source.slice(start),depth+1)].join("");
  if ((source.includes("/") || /\b(?:sqrt|abs)\s*\(/.test(source)) && !quoted) try {
    const coordinates: Record<string,string> = {};
    const numeric = source.replace(/\b([xyz])\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g, (_all,axis,name) => {
      const key = `coord${Object.keys(coordinates).length}`; coordinates[key] = `${axis}\\left(${symbolLatex(name)}\\right)`; return key;
    });
    const names = [...new Set(numeric.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])].filter(n => !functions.has(n.toLowerCase()));
    return latex(parseExpression(numeric,names)).replace(/coord\d+/g, key => coordinates[key] ?? key);
  } catch { /* Unfinished text and nonnumeric commands still render their original source. */ }
  let result="";
  for (let i=0;i<source.length;i++) {
    const c=source[i];
    if (c === '"') {
      const end=source.indexOf('"',i+1);
      if (end>=0) { result+=source.slice(i,end+1); i=end; continue; }
    }
    if (c === "(") {
      let end=i+1, n=1;
      for (;end<source.length;end++) {
        if (source[end] === "(") n++;
        if (source[end] === ")" && --n === 0) break;
      }
      if (end<source.length) { result+=`(${mathPreview(source.slice(i+1,end),depth+1)})`; i=end; continue; }
    }
    result+=c;
  }
  return result.replace(/(?<![A-Za-z\\])[A-Za-z][A-Za-z0-9_]*_[A-Za-z0-9_]+/g, symbolLatex)
    .replace(/(?<![A-Za-z\\])pi\b/g,"\\pi ")
    .replace(/(?<![A-Za-z\\])(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|ln|log|floor|ceil|sign|min|max)\s*\(/g,"\\operatorname{$1}(");
}
