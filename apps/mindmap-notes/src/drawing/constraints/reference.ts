import type { SolutionBranch } from "./types";
export const referenceKey=(names:string[])=>JSON.stringify([...names].sort());
export function referenceChoices(branch:SolutionBranch):string[][] {
  const seen=new Set<string>();
  return [branch.reference,...branch.rigid].filter(g=>{const key=referenceKey(g);if(seen.has(key))return false;seen.add(key);return true;});
}
export function driverChoices(branch:SolutionBranch,names:string[]):string[] {
  if(branch.dof===0)return [];
  const groups=referenceChoices(branch);
  return names.filter(n=>groups.some(g=>!g.includes(n)));
}
