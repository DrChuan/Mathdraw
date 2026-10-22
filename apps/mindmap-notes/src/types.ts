export type NoteFormat = "markdown" | "mindmap";
export interface ClipboardAdapter {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}
export interface FolderRecord {
  path: string;
  name: string;
  kind: "folder";
  modified: number;
}
export interface VaultEntry {
  path: string;
  name: string;
  kind: NoteFormat | "folder";
  modified: number;
}
export interface NoteRecord {
  id: string;
  path: string;
  title: string;
  format: NoteFormat;
  content: string;
  hash: string;
  modified: number;
}
export interface MindmapNode {
  id: string;
  parentId: string | null;
  order: number;
  text: string;
  collapsed: boolean;
  position?: { x: number; y: number };
}
export interface MindmapDocument {
  schemaVersion: 1;
  id: string;
  nodes: MindmapNode[];
  outlineDraft?: string;
}
export interface CosConfig {
  accessKeyId: string;
  region: string;
  bucket: string;
  prefix: string;
  autoSync: boolean;
}
export interface Bootstrap {
  vaultPath: string | null;
  entries: VaultEntry[];
  connection: CosConfig | null;
  secretStored: boolean;
  device: string;
}
export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  deferred: number;
  lastSync: string;
}
export interface TrashEntry {
  id: string;
  path: string;
  deletedAt: string;
}
export interface VaultAdapter {
  bootstrap(): Promise<Bootstrap>;
  choose(): Promise<string | null>;
  open(path: string): Promise<VaultEntry[]>;
  list(query?: string): Promise<VaultEntry[]>;
  read(path: string): Promise<NoteRecord>;
  write(note: NoteRecord, content: string): Promise<NoteRecord>;
  create(
    dir: string,
    name: string,
    format: NoteFormat | "folder",
    content?: string,
  ): Promise<string>;
  relocate(path: string, destination: string): Promise<string>;
  trash(path: string): Promise<void>;
}
export interface SyncAdapter {
  save(config: CosConfig, secret?: string): Promise<void>;
  test(): Promise<number>;
  run(): Promise<SyncReport>;
  forget(): Promise<void>;
}
