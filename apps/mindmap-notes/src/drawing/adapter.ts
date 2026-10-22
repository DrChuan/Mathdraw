import { invoke } from "@tauri-apps/api/core";
import type { DrawingAdapter, DrawingFile } from "./types";
export const drawingAdapter: DrawingAdapter = {
  recover: () => invoke("drawing_recover"),
  open: () => invoke("drawing_open"),
  save: (content, path, hash, saveAs = false) =>
    invoke("drawing_save", { content, path, hash, saveAs }),
  recoverSave: (file: DrawingFile) => invoke("drawing_recover_save", { file }),
  export: (svg, format, width) =>
    invoke("drawing_export", { svg, format, width }),
};
