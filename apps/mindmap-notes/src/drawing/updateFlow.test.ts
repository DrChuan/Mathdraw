import { expect,it,vi } from "vitest";
import { runUpdate } from "./updateFlow";
it("downloads, saves the recovery draft, installs and restarts in order",async()=>{
  const calls:string[]=[];
  await runUpdate({download:async()=>{calls.push("download");},install:async()=>{calls.push("install");}},async()=>{calls.push("draft");},async()=>{calls.push("restart");},()=>{},()=>{calls.push("installing");});
  expect(calls).toEqual(["download","draft","installing","install","restart"]);
});
it("does not install or restart when the recovery draft cannot be saved",async()=>{
  const install=vi.fn(),restart=vi.fn();
  await expect(runUpdate({download:async()=>{},install},async()=>{throw new Error("disk full");},restart,()=>{},()=>{})).rejects.toThrow("disk full");
  expect(install).not.toHaveBeenCalled();expect(restart).not.toHaveBeenCalled();
});
it("does not touch the document or install when download/signature verification fails",async()=>{
  const install=vi.fn(),save=vi.fn(),restart=vi.fn();
  await expect(runUpdate({download:async()=>{throw new Error("invalid signature");},install},save,restart,()=>{},()=>{})).rejects.toThrow("signature");
  expect(install).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(restart).not.toHaveBeenCalled();
});
