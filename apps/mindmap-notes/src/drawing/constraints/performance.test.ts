import { it,expect } from "vitest";
import { newDrawing } from "../types";
import { normalizeDrawing } from "../model";
import { sceneFor } from "../scene";
import { parseCondition, entity } from "./input";
import { solveConstraints } from "./solver";
import { installSolutionSet, solutionSetObject } from "./document";
import type { ConstraintProblem } from "./types";

it("keeps 50 points / 200 redundant and independent conditions bounded and surface paths compact",()=>{
  const names=["A","B","C",...Array.from({length:47},(_,i)=>`P${i}`)];
  const sources=["AB=3","AC=4","BC=5",...names.slice(3).map(n=>`distance(A,${n},2)`)];
  while(sources.length<200)sources.push(["AB=3","AC=4","BC=5"][sources.length%3]);
  const problem:ConstraintProblem={points:names,segments:[],conditions:sources.map(s=>parseCondition(s,names))};
  const result=solveConstraints({id:1,problem,budget:1200,seed:11});
  expect(result.branches.length).toBeGreaterThan(0);expect(result.elapsed).toBeLessThan(4500);
  const doc=normalizeDrawing(installSolutionSet(newDrawing(),solutionSetObject(problem,result)));
  const start=performance.now(),scene=sceneFor(doc,[],[1000,700]),elapsed=performance.now()-start;
  expect(scene.paths.length).toBeLessThan(500);expect(elapsed).toBeLessThan(500);
  console.info(JSON.stringify({points:50,conditions:200,solveMs:result.elapsed,sceneMs:Number(elapsed.toFixed(2)),paths:scene.paths.length}));
},10000);
it("bounds ambiguous or invalid concatenated point references",()=>{
  const names=["A","AA","AAA","AAAA","AAAAA"];
  const start=performance.now();expect(()=>entity("A".repeat(200)+"Z",names)).toThrow();
  expect(performance.now()-start).toBeLessThan(100);
});
