import { clipboard } from "./adapters";
import type { ClipboardAdapter, MindmapDocument } from "./types";
import {
  branchMarkdown,
  extractBranch,
  outlineToForest,
  type BranchSnapshot,
} from "./branches";
let cached: { text: string; branch: BranchSnapshot } | undefined;
export async function copyBranch(
  doc: MindmapDocument,
  id: string,
  adapter: ClipboardAdapter = clipboard,
) {
  const branch = extractBranch(doc, id),
    text = branchMarkdown(branch);
  await adapter.writeText(text);
  cached = { text, branch };
}
export async function readBranch(adapter: ClipboardAdapter = clipboard) {
  const text = await adapter.readText();
  return cached?.text === text ? cached.branch : outlineToForest(text);
}
