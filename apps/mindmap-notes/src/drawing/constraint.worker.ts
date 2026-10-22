import { solveConstraints } from "./constraints/solver";
import type { SolveRequest, SolveResponse } from "./constraints/types";
self.onmessage=(event:MessageEvent<SolveRequest>)=>{
  const request=event.data;
  try{self.postMessage({id:request.id,result:solveConstraints(request)} satisfies SolveResponse);}
  catch(e){self.postMessage({id:request.id,error:e instanceof Error?e.message:String(e)} satisfies SolveResponse);}
};
