import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardAdapter } from "./types";
export const clipboard: ClipboardAdapter = { readText, writeText };
import type { VaultAdapter, SyncAdapter, TrashEntry } from "./types";
export const vault: VaultAdapter = {
  bootstrap: () => invoke("bootstrap"),
  choose: () => invoke("choose_vault"),
  open: (path) => invoke("open_vault", { path }),
  list: (query) => invoke("list_entries", { query }),
  read: (path) => invoke("read_note", { path }),
  write: (note, content) =>
    invoke("write_note", { path: note.path, content, expectedHash: note.hash }),
  create: (dir, name, format, content) =>
    invoke("create_entry", { dir, name, format, content }),
  relocate: (path, destination) =>
    invoke("relocate_entry", { path, destination }),
  trash: (path) => invoke("trash_entry", { path }),
};
export const sync: SyncAdapter = {
  save: (connection, secret) =>
    invoke("save_connection", { connection, secret }),
  test: () => invoke("test_connection"),
  run: () => invoke("sync_vault"),
  forget: () => invoke("forget_connection"),
};
export const listTrash = () => invoke<TrashEntry[]>("list_trash");
export const restoreTrash = (id: string) =>
  invoke<void>("restore_trash", { id });
export const revealVault = () => invoke<void>("reveal_vault");
export const closeVault = () => invoke<void>("close_vault");
export const frontendReady = () => invoke<void>("frontend_ready");
export const quitApp = () => invoke<void>("confirm_exit");
export const openExternal = (url: string) =>
  invoke<void>("open_external", { url });
