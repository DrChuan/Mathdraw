import type { SolutionBranch } from "./types";
export const referenceKey=(names:string[])=>JSON.stringify([...names].sort());
export function referenceChoices(branch:SolutionBranch):string[][] {
  const seen=new Set<string>();
  // A fixed-distance block is one possible frame, not a requirement to pin
  // every member. One fixed point removes translation and leaves rotation;
  // this allows any other point to be selected as a driver without changing
  // the geometric conditions. Fully rigid branches keep their existing frame.
  const anchors=(branch.motionDof??branch.dof)>0?Object.keys(branch.positions).map(n=>[n]):[];
  return [branch.reference,...branch.rigid,...anchors].filter(g=>{const key=referenceKey(g);if(seen.has(key))return false;seen.add(key);return true;});
}
export function driverChoices(branch:SolutionBranch,names:string[]):string[] {
  if((branch.motionDof??branch.dof)===0)return [];
  const groups=referenceChoices(branch);
  return names.filter(n=>groups.some(g=>!g.includes(n)));
}
