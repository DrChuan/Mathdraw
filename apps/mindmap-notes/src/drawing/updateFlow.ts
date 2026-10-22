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
