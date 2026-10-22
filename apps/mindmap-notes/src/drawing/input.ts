/** Canonical coordinate calls before numeric parsing, including LaTeX and spaced input. */
export function coordinateSyntax(source:string):string {
  return source.replace(/\\(?:operatorname|mathrm)\s*\{\s*([xyz])\s*\}/g,"$1")
    .replace(/\b([xyz])\s*(?:\\left\s*)?\(\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\\right\s*)?\)/g,"$1($2)");
}
const escaped=(s:string,i:number)=>{let n=0;while(i>0&&s[--i]==="\\")n++;return n%2===1;};
/** Normalize mathematical punctuation without changing quoted annotation text. */
export function definitionInput(source:string):string {
  let result="",start=0,quote:string|null=null;
  for(let i=0;i<source.length;i++) if(!escaped(source,i) && (quote ? source[i]===quote : /["“”]/.test(source[i]))) {
    const chunk=source.slice(start,i);
    result+=quote?chunk:coordinateSyntax(chunk.replace(/（/g,"(").replace(/）/g,")").replace(/，/g,","));
    result+='"';quote=quote?null:source[i]==='"'?'"':'”';start=i+1;
  }
  const tail=source.slice(start);return result+(quote?tail:coordinateSyntax(tail.replace(/（/g,"(").replace(/）/g,")").replace(/，/g,",")));
}
/** Accept standard JSON strings and ordinary single-backslash LaTeX input. */
export function annotationArgument(source:string):string {
  const s=source.trim();
  if(!/^["“”]/.test(s)||!/["“”]$/.test(s))throw new Error('文字请用双引号包围；也可使用“文字”工具直接输入');
  const body=s.slice(1,-1);
  if(/(?<!\\)\\(?![\\"])/.test(body))return body.replace(/\\"/g,'"');
  try {return JSON.parse('"'+body+'"');}catch {return body.replace(/\\"/g,'"');}
}
