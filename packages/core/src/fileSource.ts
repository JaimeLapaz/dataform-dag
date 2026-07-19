import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The one place file *reading* differs by host. `buildGraphFromWorkspace` depends only on this, so
 * it stays host-neutral: Node hosts back it with the filesystem, the browser backs it with the File
 * System Access API. Paths are opaque handles from the source's own point of view — `read` only ever
 * receives a value that `listSqlx` produced.
 */
export interface FileSource {
  listSqlx(): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** Node `FileSource` — walks `definitions/**` (any depth) under a project root for `.sqlx` files. */
export class NodeFileSource implements FileSource {
  constructor(private readonly root: string) {}

  async listSqlx(): Promise<string[]> {
    return walkSqlx(join(this.root, "definitions"));
  }

  read(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}

async function walkSqlx(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSqlx(full)));
    } else if (entry.isFile() && entry.name.endsWith(".sqlx")) {
      out.push(full);
    }
  }
  return out.sort();
}
