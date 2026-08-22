import * as vscode from "vscode";
import * as path from "node:path";
import {
  NodeFileSource,
  buildGraphFromWorkspace,
  serializeGraph,

  compileDataformProject,
  findCompiledActionByFile,

  type SerializedGraph,
  type CompileAction,
  type CompileOutput,
} from "@dataform-dag/core";
// The wire protocol is defined once in the UI package; the host imports it as types only, so no
// React reaches the Node bundle.
import type { InboundMsg, OutboundMsg } from "@dataform-dag/ui";

const COMPILATION_WARMUP_DELAY_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const controller = new GraphController(context);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dataformDag.showGraph",
      () => controller.show(),
    ),

    vscode.commands.registerCommand(
      "dataformDag.showCompiledSql",
      () => controller.showCompiledSql(),
    ),

    controller,
  );
}

export function deactivate(): void {
  /* GraphController disposes via context.subscriptions. */
}

/**
 * Owns the single DAG webview panel and everything host-specific behind the {@link HostBridge}
 * contract: builds the graph from the workspace, opens files on request, watches `.sqlx` for live
 * updates, and mirrors the active editor as a focus request.
 */
class GraphController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private selectedTags: string[] = [];
  /** filePath → node id, refreshed on each build so an active-editor change can focus its node. */
  private idByPath = new Map<string, string>();

  private compiledOutputCache:
    | {
      root: string;
      output: CompileOutput;
    }
    | undefined;

  /**
   * Compilation currently running.
   *
   * We keep the root together with the Promise so we never
   * accidentally reuse a compilation from another workspace.
   */
  private compileInProgress:
    | {
      root: string;
      generation: number;
      promise: Promise<CompileOutput>;
    }
    | undefined;

  /**
   * Incremented whenever a source/config file changes.
   *
   * This prevents an old compilation that finishes late from
   * being written back into the cache after it was invalidated.
   */
  private compilationGeneration = 0;

  private compilationWarmupTimer:
    | ReturnType<typeof setTimeout>
    | undefined;

  private readSavedTagFilter():
    string[] {
    const saved =
      this.context.workspaceState.get<
        unknown
      >(
        "dataformDag.selectedTags",
      );

    if (!Array.isArray(saved)) {
      return [];
    }

    return saved.filter(
      (value): value is string =>
        typeof value === "string",
    );
  }

  private saveTagFilter(
    selectedTags: string[],
  ): void {
    this.selectedTags = [
      ...selectedTags,
    ];

    void this.context.workspaceState.update(
      "dataformDag.selectedTags",
      this.selectedTags,
    );
  }

  constructor(
    private readonly context:
      vscode.ExtensionContext,
  ) {
    this.selectedTags =
      this.readSavedTagFilter();
  }

  async showCompiledSql(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage(
        "Dataform DAG: open a .sqlx file first.",
      );
      return;
    }

    await this.showCompiledSqlForFile(
      editor.document.uri.fsPath,
    );
  }

  private async showCompiledSqlForFile(
    sourceFile: string,
  ): Promise<void> {
    if (!sourceFile.toLowerCase().endsWith(".sqlx")) {
      vscode.window.showWarningMessage(
        "Dataform DAG: the selected file is not a .sqlx file.",
      );
      return;
    }

    const sourceUri = vscode.Uri.file(sourceFile);

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(sourceUri);

    const root =
      workspaceFolder?.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!root) {
      vscode.window.showWarningMessage(
        "Dataform DAG: open a Dataform project first.",
      );
      return;
    }

    const relativeFile = path
      .relative(root, sourceFile)
      .replaceAll("\\", "/");

    try {
      const output =
        await this.getCompiledOutput(root);

      const action =
        findCompiledActionByFile(
          output,
          relativeFile,
        );

      if (!action) {
        vscode.window.showWarningMessage(
          `Dataform DAG: no compiled action found for ${relativeFile}.`,
        );
        return;
      }

      const sql =
        buildCompiledSqlPreview(action);

      if (!sql) {
        vscode.window.showWarningMessage(
          `Dataform DAG: no compiled SQL found for ${relativeFile}.`,
        );
        return;
      }

      const document =
        await vscode.workspace.openTextDocument({
          language: "sql",
          content: sql,
        });

      await vscode.window.showTextDocument(
        document,
        {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        },
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Dataform DAG: could not generate SQL — ${formatError(error)}`,
      );
    }
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "dataformDag",
      "Dataform DAG",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
      },
    );
    this.panel = panel;
    panel.webview.html = this.render(panel.webview);

    panel.webview.onDidReceiveMessage(
      (msg: OutboundMsg) => this.onMessage(msg),
      undefined,
      this.panelDisposables,
    );

    // liveWatch: any .sqlx change rebuilds and repushes the graph.
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.sqlx");
    const rebuild = (): void => {
      this.invalidateCompilationCache();

      void this.buildAndPost();
    };
    watcher.onDidChange(rebuild, undefined, this.panelDisposables);
    watcher.onDidCreate(rebuild, undefined, this.panelDisposables);
    watcher.onDidDelete(rebuild, undefined, this.panelDisposables);
    this.panelDisposables.push(watcher);
    /*
    * Compilation-only watchers:
    *
    * These files can change the generated SQL without
    * necessarily changing the graph structure.
    */
    const compilationWatchers = [
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/workflow_settings.yaml",
      "**/workflow_settings.yml",
      "**/dataform.json",
    ];

    for (const pattern of compilationWatchers) {
      const compilationWatcher =
        vscode.workspace.createFileSystemWatcher(
          pattern,
        );

      const invalidate = (): void => {
        this.invalidateCompilationCache();

        const root =
          vscode.workspace
            .workspaceFolders?.[0]
            ?.uri.fsPath;

        if (root) {
          this.warmCompilationCache(root);
        }
      };

      compilationWatcher.onDidChange(
        invalidate,
        undefined,
        this.panelDisposables,
      );

      compilationWatcher.onDidCreate(
        invalidate,
        undefined,
        this.panelDisposables,
      );

      compilationWatcher.onDidDelete(
        invalidate,
        undefined,
        this.panelDisposables,
      );

      this.panelDisposables.push(
        compilationWatcher,
      );
    }

    // focusOnActive: reflect the active editor into the graph when it maps to a node.
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.focusActive(editor),
      undefined,
      this.panelDisposables,
    );

    panel.onDidDispose(() => this.closePanel(), undefined, this.panelDisposables);
  }

  private async getCompiledOutput(
    root: string,
  ): Promise<CompileOutput> {
    /*
     * Fast path: this workspace is already compiled
     * for the current generation.
     */
    if (
      this.compiledOutputCache &&
      this.compiledOutputCache.root === root
    ) {
      this.post({
        type: "compilationStatus",
        status: "ready",
      });

      return this.compiledOutputCache.output;
    }

    /*
     * Never run two Dataform compilations at once.
     *
     * If the running compilation belongs to the current
     * generation, reuse it.
     *
     * If it belongs to an older generation, wait for it
     * to finish and then compile the latest project state.
     */
    if (this.compileInProgress) {
      const running =
        this.compileInProgress;

      this.post({
        type: "compilationStatus",
        status: "compiling",
      });

      if (
        running.root === root &&
        running.generation ===
        this.compilationGeneration
      ) {
        return running.promise;
      }

      try {
        await running.promise;
      } catch {
        /*
         * This compilation is stale, so its error is not
         * relevant to the new generation.
         */
      }

      return this.getCompiledOutput(root);
    }

    const generation =
      this.compilationGeneration;

    this.post({
      type: "compilationStatus",
      status: "compiling",
    });

    const promise =
      compileDataformProject(root);

    const currentCompilation = {
      root,
      generation,
      promise,
    };

    this.compileInProgress =
      currentCompilation;

    try {
      const output = await promise;

      /*
       * Cache the result only if nothing changed while
       * Dataform was compiling.
       */
      if (
        this.compilationGeneration ===
        generation
      ) {
        this.compiledOutputCache = {
          root,
          output,
        };

        this.post({
          type: "compilationStatus",
          status: "ready",
        });
      }

      return output;
    } catch (error) {
      /*
       * Only expose the error when it still belongs to
       * the current generation.
       */
      if (
        this.compilationGeneration ===
        generation
      ) {
        this.post({
          type: "compilationStatus",
          status: "error",
        });
      }

      throw error;
    } finally {
      if (
        this.compileInProgress ===
        currentCompilation
      ) {
        this.compileInProgress =
          undefined;
      }
    }
  }

  private invalidateCompilationCache(): void {
    this.compilationGeneration += 1;

    this.compiledOutputCache = undefined;

    this.post({
      type: "compilationStatus",
      status: "idle",
    });
  }

  private warmCompilationCache(
    root: string,
  ): void {
    /*
     * Several file-system events can arrive very close
     * together when saving or changing Dataform files.
     *
     * Reset the timer so those events become a single
     * compilation.
     */
    if (this.compilationWarmupTimer) {
      clearTimeout(
        this.compilationWarmupTimer,
      );
    }

    this.compilationWarmupTimer =
      setTimeout(() => {
        this.compilationWarmupTimer =
          undefined;

        /*
         * Warm-up is deliberately best-effort.
         *
         * Opening the DAG must continue working even when:
         * - Dataform isn't installed
         * - the project currently doesn't compile
         * - a JS/include file has an error
         */
        void this.getCompiledOutput(
          root,
        ).catch(() => {
          // Intentionally ignored.
        });
      }, COMPILATION_WARMUP_DELAY_MS);
  }

  private async postCompiledSqlForFile(
    nodeId: string,
    sourceFile: string,
  ): Promise<void> {
    if (
      !sourceFile
        .toLowerCase()
        .endsWith(".sqlx")
    ) {
      this.post({
        type: "compiledSqlError",
        nodeId,
        message:
          "The selected file is not a .sqlx file.",
      });

      return;
    }

    const sourceUri =
      vscode.Uri.file(sourceFile);

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(
        sourceUri,
      );

    const root =
      workspaceFolder?.uri.fsPath ??
      vscode.workspace
        .workspaceFolders?.[0]
        ?.uri.fsPath;

    if (!root) {
      this.post({
        type: "compiledSqlError",
        nodeId,
        message:
          "Open a Dataform project first.",
      });

      return;
    }

    const relativeFile = path
      .relative(root, sourceFile)
      .replaceAll("\\", "/");

    try {
      const output =
        await this.getCompiledOutput(root);

      const action =
        findCompiledActionByFile(
          output,
          relativeFile,
        );

      if (!action) {
        this.post({
          type: "compiledSqlError",
          nodeId,
          message:
            `No compiled action found for ${relativeFile}.`,
        });

        return;
      }

      const sql =
        buildCompiledSqlPreview(action);

      if (!sql) {
        this.post({
          type: "compiledSqlError",
          nodeId,
          message:
            `No compiled SQL found for ${relativeFile}.`,
        });

        return;
      }

      this.post({
        type: "compiledSqlResult",
        nodeId,
        sql,
      });
    } catch (error) {
      this.post({
        type: "compiledSqlError",
        nodeId,
        message: formatError(error),
      });
    }
  }

  private onMessage(msg: OutboundMsg): void {
    switch (msg.type) {
      case "ready":
        this.post({
          type: "tagFilterState",
          selectedTags:
            this.selectedTags,
        });

        void this.buildAndPost();
        return;

      case "setTagFilter":
        this.saveTagFilter(
          msg.selectedTags,
        );
        return;

      case "requestRefresh":
        this.invalidateCompilationCache();
        void this.buildAndPost();
        return;

      case "openFile":
        void vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), {
          viewColumn: vscode.ViewColumn.One,
          preview: false,
        });
        return;

      case "showCompiledSql":
        void this.postCompiledSqlForFile(
          msg.nodeId,
          msg.filePath,
        );

        return;
    }
  }

  private async buildAndPost(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showWarningMessage("Dataform DAG: open a folder to view its .sqlx graph.");
      return;
    }
    try {
      const graph = await buildGraphFromWorkspace(new NodeFileSource(root));
      const serialized = serializeGraph(graph);
      this.idByPath = new Map(serialized.nodes.map((n) => [n.filePath, n.id]));
      this.post({ type: "graphUpdate", graph: serialized });
      /*
      * Start Dataform compilation in the background.
      *
      * Do NOT await this: rendering the DAG should remain fast.
      */
      this.warmCompilationCache(root);
    } catch (err) {
      vscode.window.showErrorMessage(`Dataform DAG: could not build the graph — ${String(err)}`);
    }
  }

  private focusActive(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const nodeId = this.idByPath.get(editor.document.uri.fsPath);
    if (nodeId) this.post({ type: "focusNode", nodeId });
  }

  private post(msg: InboundMsg): void {
    void this.panel?.webview.postMessage(msg);
  }

  private render(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    // React Flow positions nodes with inline `style` attributes, so style-src needs 'unsafe-inline';
    // scripts are locked to the single nonce'd bundle (elk is inlined into it — see build.mjs).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="${csp}" />
          <link href="${styleUri}" rel="stylesheet" />
          <title>Dataform DAG</title>
        </head>
        <body>
          <div id="root"></div>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
  }

  private clearCompilationWarmupTimer():
    void {
    if (!this.compilationWarmupTimer) {
      return;
    }

    clearTimeout(
      this.compilationWarmupTimer,
    );

    this.compilationWarmupTimer =
      undefined;
  }

  private closePanel(): void {
    this.clearCompilationWarmupTimer();

    this.panel = undefined;

    for (
      const d of
      this.panelDisposables.splice(0)
    ) {
      d.dispose();
    }
  }

  dispose(): void {
    this.closePanel();
  }
}

function buildCompiledSqlPreview(
  action: CompileAction,
): string | undefined {
  /*
   * Operations pueden tener varias sentencias SQL.
   */
  if (action.queries?.length) {
    return action.queries
      .map(
        (query, index) =>
          `-- Operation ${index + 1}\n\n${query}`,
      )
      .join("\n\n\n");
  }

  /*
   * Para una incremental Dataform genera dos posibilidades:
   *
   * 1. query             -> carga inicial/full
   * 2. incrementalQuery  -> ejecución incremental
   *
   * Sin consultar BigQuery no sabemos si la tabla ya existe,
   * así que mostramos las dos.
   */
  if (
    action.incrementalQuery &&
    action.incrementalQuery !== action.query
  ) {
    const fullQuery = [
      "-- ========================================",
      "-- FULL / INITIAL QUERY",
      "-- ========================================",
      "",
      action.query ?? "",
    ].join("\n");

    const incrementalQuery = [
      "-- ========================================",
      "-- INCREMENTAL QUERY",
      "-- ========================================",
      "",
      action.incrementalQuery,
    ].join("\n");

    return [
      fullQuery,
      "",
      "",
      incrementalQuery,
    ].join("\n");
  }

  /*
   * Tables, views y assertions.
   *
   * Esto es justo lo que buscamos:
   * la SQL resultante de la compilación Dataform.
   */
  if (action.query) {
    return action.query;
  }

  return undefined;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
