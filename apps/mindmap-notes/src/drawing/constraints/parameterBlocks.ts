import {solveExactSystem} from './exactSystem';
/** Solve point-independent parameter blocks first. Their finite solutions are
 * branch candidates, not extra user constraints; the full system must validate
 * every candidate again. Bounds-only families never freeze an arbitrary value. */
export function independentParameterBranches(sources:string[],tokens:string[],indices:number[],initial:number[],deadline:number){
 const allowed=new Set(indices.map(i=>tokens[i])),parents=new Map([...allowed].map(t=>[t,t]));
 const root=(s:string):string=>parents.get(s)===s?s:root(parents.get(s)!);
 const rows=sources.flatMap(source=>{if(/\b(?:sin|cos|tan|asin|acos|atan|exp|log|ln|floor|ceil)\s*\(/.test(source))return [];const used=tokens.filter(t=>new RegExp(`\\b${t}\\b`).test(source));return used.length&&used.every(t=>allowed.has(t))?[{source,used}]:[];});
 for(const row of rows)for(const t of row.used.slice(1))parents.set(root(t),root(row.used[0]));
 const groups=new Map<string,string[]>();for(const t of allowed){const r=root(t);groups.set(r,[...(groups.get(r)??[]),t]);}
 let branches:Map<number,number>[]=[new Map()];let solved=0;let expressions:Map<number,string>[]=[new Map()];
 for(const names of groups.values()){
  if(Date.now()>=deadline)break;const equations=rows.filter(row=>names.includes(row.used[0])).map(row=>row.source);
  if(!equations.some(s=>/(?<![<>!=])=(?!=)/.test(s)))continue;
  const result=solveExactSystem(equations,names,{deadline,initial:names.map(t=>initial[tokens.indexOf(t)])});
  if(!result.complete||result.kind!=='finite'||!result.candidates.length)continue;
  const previousExpressions=expressions;expressions=previousExpressions.flatMap(previous=>result.candidates.map(candidate=>new Map([...previous,...names.flatMap(t=>{const expression=candidate.certificate.assignments[t];return expression&&!/root_\d+/.test(expression)?[[tokens.indexOf(t),expression] as [number,string]]:[];})]))).slice(0,32);
  solved++;branches=branches.flatMap(previous=>result.candidates.map(candidate=>new Map([...previous,...names.map((t,i)=>[tokens.indexOf(t),candidate.values[i]] as [number,number])]))).slice(0,32);
 }
 return {branches:solved?branches:[],expressions:solved?expressions:[],solved};
}
