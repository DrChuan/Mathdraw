import { useEffect, useRef, useState } from "react";
import type { DrawingCurve } from "./types";
import type { CurveResult } from "./curves";
interface Job { id: number; key: string; curves: DrawingCurve[]; resolution: number }
/** One reusable worker, one running job, and one replaceable latest request. */
export function useCurveSampler(curves: DrawingCurve[], moving: boolean, documentId: string) {
  const [results, setResults] = useState<CurveResult[]>([]), [pending, setPending] = useState(false), [complete,setComplete] = useState("");
  const submit = useRef<((job: Job) => void) | null>(null), sequence = useRef(0);
  const key = JSON.stringify(curves), resolution = moving ? 72 : 180;
  useEffect(() => {
    let worker: Worker, running: Job | null = null, latest: Job | null = null, disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setResults([]);
    const pump = () => {
      if (disposed || running || !latest) return;
      running = latest;
      setPending(true);
      timeout = setTimeout(() => fail("曲线计算超时，请简化表达式或缩小范围"), 5000);
      worker.postMessage(running);
    };
    const fail = (message: string) => {
      if (disposed) return;
      clearTimeout(timeout);
      const failed = running;
      worker.terminate(); running = null;
      createWorker();
      if (latest && latest.key !== failed?.key) pump();
      else {
        if (failed?.resolution === 180) setResults(failed.curves.map(c => ({id:c.id, paths:[], error:message})));
        if(failed) setComplete(`${documentId}:${failed.key}`);
        latest = null; setPending(false);
      }
    };
    const createWorker = () => {
      worker = new Worker(new URL("./curve.worker.ts", import.meta.url), {type:"module"});
      worker.onmessage = (e: MessageEvent<{id:number; results:CurveResult[]}>) => {
        if (disposed || running?.id !== e.data.id) return;
        clearTimeout(timeout);
        const finished = running; running = null;
        if(!latest?.curves.length) {setResults([]);setPending(false);return;}
        // Show intermediate frames too: waiting for an idle slider would starve the display.
        setResults(previous => e.data.results.map(result => result.error && finished.resolution < 180
          ? previous.find(p => p.id === result.id) ?? result : result));
        if (latest?.key !== finished.key) pump(); else {setComplete(`${documentId}:${finished.key}`);setPending(false);}
      };
      worker.onerror = () => fail("曲线计算失败，请检查表达式");
    };
    createWorker();
    submit.current = job => {
      latest = job;
      if (!job.curves.length) { setResults([]); setPending(false); }
      else pump();
    };
    return () => { disposed = true; submit.current = null; clearTimeout(timeout); worker.terminate(); };
  }, [documentId]);
  useEffect(() => {
    submit.current?.({id:++sequence.current, key:`${resolution}:${key}`, curves:JSON.parse(key), resolution});
  }, [key, resolution, documentId]);
  return {results, pending:curves.length > 0 && (pending || complete !== `${documentId}:${resolution}:${key}`)};
}
