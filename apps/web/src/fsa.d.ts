// Minimal File System Access API surface this host uses. `showDirectoryPicker` isn't in the standard
// DOM lib, and `values()` on a directory handle is only partially typed across TS versions — declare
// exactly what we call so the host typechecks without pulling an extra @types dependency.
export {};

declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
