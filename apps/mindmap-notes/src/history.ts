interface Snapshot {
  text: string;
  bytes: number;
  stamp: number;
}
interface Entry {
  head: Snapshot;
  undo: Snapshot[];
  redo: Snapshot[];
  used: number;
}
export class DocumentHistory {
  private entries = new Map<string, Entry>();
  private key: string | null = null;
  private clock = 0;
  constructor(private limit = 64 * 1024 * 1024) {}
  private snapshot(text: string): Snapshot {
    return {
      text,
      bytes: new TextEncoder().encode(text).length,
      stamp: ++this.clock,
    };
  }
  activate(key: string | null, text = "") {
    this.key = key;
    if (!key) return;
    const existing = this.entries.get(key);
    if (!existing || existing.head.text !== text)
      this.entries.set(key, {
        head: this.snapshot(text),
        undo: [],
        redo: [],
        used: ++this.clock,
      });
    else existing.used = ++this.clock;
    this.trim();
  }
  get canUndo() {
    return !!this.active?.undo.length;
  }
  get canRedo() {
    return !!this.active?.redo.length;
  }
  private get active() {
    return this.key ? this.entries.get(this.key) : undefined;
  }
  record(text: string, record = true) {
    const entry = this.active;
    if (!entry || entry.head.text === text) return;
    if (record) {
      entry.undo.push({ ...entry.head, stamp: ++this.clock });
      if (entry.undo.length > 100) entry.undo.shift();
    }
    entry.redo = [];
    entry.head = this.snapshot(text);
    entry.used = ++this.clock;
    this.trim();
  }
  undo() {
    const entry = this.active,
      next = entry?.undo.pop();
    if (!entry || !next) return undefined;
    entry.redo.push({ ...entry.head, stamp: ++this.clock });
    entry.head = next;
    entry.used = ++this.clock;
    this.trim();
    return next.text;
  }
  redo() {
    const entry = this.active,
      next = entry?.redo.pop();
    if (!entry || !next) return undefined;
    entry.undo.push({ ...entry.head, stamp: ++this.clock });
    entry.head = next;
    entry.used = ++this.clock;
    this.trim();
    return next.text;
  }
  clear() {
    this.entries.clear();
    this.key = null;
  }
  get bytes() {
    let total = 0;
    for (const e of this.entries.values())
      total +=
        e.head.bytes +
        [...e.undo, ...e.redo].reduce((sum, s) => sum + s.bytes, 0);
    return total;
  }
  private trim() {
    while (this.bytes > this.limit) {
      let oldest: { stack: Snapshot[]; snapshot: Snapshot } | undefined;
      for (const e of this.entries.values())
        for (const stack of [e.undo, e.redo])
          for (const snapshot of stack)
            if (!oldest || snapshot.stamp < oldest.snapshot.stamp)
              oldest = { stack, snapshot };
      if (oldest) {
        oldest.stack.splice(oldest.stack.indexOf(oldest.snapshot), 1);
        continue;
      }
      const inactive = [...this.entries]
        .filter(([key]) => key !== this.key)
        .sort((a, b) => a[1].used - b[1].used)[0];
      if (!inactive) break;
      this.entries.delete(inactive[0]);
    }
  }
}
