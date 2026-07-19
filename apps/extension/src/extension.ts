import * as vscode from "vscode";
import {
  NodeFileSource,
  buildGraphFromWorkspace,
  serializeGraph,
  type SerializedGraph,
} from "@dataform-dag/core";
// The wire protocol is defined once in the UI package; the host imports it as types only, so no
// React reaches the Node bundle.
import type { InboundMsg, OutboundMsg } from "@dataform-dag/ui";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new GraphController(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("dataformDag.showGraph", () => controller.show()),
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
  /** filePath → node id, refreshed on each build so an active-editor change can focus its node. */
  private idByPath = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    const rebuild = (): void => void this.buildAndPost();
    watcher.onDidChange(rebuild, undefined, this.panelDisposables);
    watcher.onDidCreate(rebuild, undefined, this.panelDisposables);
    watcher.onDidDelete(rebuild, undefined, this.panelDisposables);
    this.panelDisposables.push(watcher);

    // focusOnActive: reflect the active editor into the graph when it maps to a node.
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.focusActive(editor),
      undefined,
      this.panelDisposables,
    );

    panel.onDidDispose(() => this.closePanel(), undefined, this.panelDisposables);
  }

  private onMessage(msg: OutboundMsg): void {
    switch (msg.type) {
      case "ready":
      case "requestRefresh":
        void this.buildAndPost();
        return;
      case "openFile":
        void vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), {
          viewColumn: vscode.ViewColumn.One,
          preview: false,
        });
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

  private closePanel(): void {
    this.panel = undefined;
    for (const d of this.panelDisposables.splice(0)) d.dispose();
  }

  dispose(): void {
    this.closePanel();
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
