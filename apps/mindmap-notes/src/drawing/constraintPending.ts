/** Only motions on the committed document participate in save/close barriers.
 * Preview documents have their own IDs and are intentionally not committed. */
const pending=new Map<string,Set<Promise<void>>>();
export function trackConstraintMotion(document:string) {
  let finish!:()=>void;const job=new Promise<void>(resolve=>{finish=resolve;});
  const jobs=pending.get(document)??new Set<Promise<void>>();jobs.add(job);pending.set(document,jobs);
  return ()=>{jobs.delete(job);if(!jobs.size)pending.delete(document);finish();};
}
export function hasConstraintMotions(document:string){return !!pending.get(document)?.size;}
export async function settleConstraintMotions(document:string,timeout=2500) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const drain=async()=>{while(pending.get(document)?.size)await Promise.all([...pending.get(document)!]);};
  try{await Promise.race([drain(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('条件联动仍在计算，暂未保存或关闭；请停止拖动后重试')),timeout);})]);}
  finally{clearTimeout(timer);}
}
