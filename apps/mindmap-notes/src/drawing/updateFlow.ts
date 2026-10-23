import type { DownloadEvent } from "@tauri-apps/plugin-updater";
export interface UpdatePackage {
  download(progress:(event:DownloadEvent)=>void,options:{timeout:number}):Promise<void>;
  install():Promise<void>;
}
/** Preserve the latest draft only after a successful, signature-verified download. */
export async function runUpdate(update:UpdatePackage,saveDraft:()=>Promise<void>,restart:()=>Promise<unknown>,progress:(event:DownloadEvent)=>void,installing:()=>void){
  await update.download(progress,{timeout:180000});
  await saveDraft();
  installing();
  await update.install();
  await restart();
}

/** A healthy mirror wins; absence and errors both allow the fallback. */
export async function checkUpdateSources<T>(check:(source:'gitee'|'github')=>Promise<T|null>):Promise<T|null>{
  let responded=false,lastError:unknown;
  for(const source of ['gitee','github'] as const){
    try{const update=await check(source);responded=true;if(update)return update;}
    catch(error){lastError=error;}
  }
  if(!responded)throw lastError??Error('暂时无法检查更新');
  return null;
}
