import type { FileSource } from "@dataform-dag/core/browser";

/** Whether this browser exposes the File System Access API (Chromium-family today). */
export function isFsAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

/**
 * {@link FileSource} over the File System Access API. Prompts for a directory, then walks it for
 * `.sqlx` files — preferring a top-level `definitions/` subtree to match the Node walker, falling
 * back to the whole picked folder. `listSqlx` yields display paths; `read` resolves them against the
 * file handles captured during the walk (paths are opaque handles, per the FileSource contract).
 */
export class FileSystemAccessSource implements FileSource {
  private constructor(private readonly files: Map<string, FileSystemFileHandle>) {}

  /** Prompt for a project directory and index its `.sqlx` files. Throws `AbortError` if cancelled. */
  static async pick(): Promise<FileSystemAccessSource> {
    if (!window.showDirectoryPicker) {
      throw new Error("File System Access API is not available in this browser.");
    }
    const root = await window.showDirectoryPicker();
    let base: FileSystemDirectoryHandle = root;
    let prefix = root.name;
    try {
      base = await root.getDirectoryHandle("definitions");
      prefix = `${root.name}/definitions`;
    } catch {
      // No definitions/ dir — walk the whole picked folder instead.
    }
    const files = new Map<string, FileSystemFileHandle>();
    await walk(base, prefix, files);
    return new FileSystemAccessSource(files);
  }

  listSqlx(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].sort());
  }

  async read(path: string): Promise<string> {
    const handle = this.files.get(path);
    if (!handle) throw new Error(`unknown file: ${path}`);
    const file = await handle.getFile();
    return file.text();
  }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, FileSystemFileHandle>,
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === "directory") {
      await walk(entry, path, out);
    } else if (entry.kind === "file" && entry.name.endsWith(".sqlx")) {
      out.set(path, entry);
    }
  }
}
