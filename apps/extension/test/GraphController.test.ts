import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { activate } from "../src/extension.js";
import {
  Uri,
  ViewColumn,
  commands,
  lastActiveEditorHandler,
  lastPanel,
  records,
  resetMock,
  window,
  workspace,
} from "./mocks/vscode.js";

// The controller's build path goes through core; mock it so these tests exercise the controller's
// orchestration (routing / watcher wiring / focus mapping / error handling), not core itself.
vi.mock("@dataform-dag/core", () => ({
  NodeFileSource: class {
    constructor(public readonly root: string) { }
  },

  buildGraphFromWorkspace: vi.fn(),
  serializeGraph: vi.fn(),

  compileDataformProject: vi.fn(),
  findCompiledActionByFile: vi.fn(),
}));
import {
  buildGraphFromWorkspace,
  serializeGraph,
  compileDataformProject,
  findCompiledActionByFile,
} from "@dataform-dag/core";

const buildMock = buildGraphFromWorkspace as unknown as Mock;
const serializeMock = serializeGraph as unknown as Mock;
const compileMock =
  compileDataformProject as unknown as Mock;

const findCompiledActionMock =
  findCompiledActionByFile as unknown as Mock;

/** A serialized graph with two nodes, so focus mapping (filePath → id) has something to resolve. */
const SERIALIZED = {
  nodes: [
    { id: "a", filePath: "/proj/a.sqlx" },
    { id: "b", filePath: "/proj/b.sqlx" },
  ],
  edges: [],
};

function fakeContext() {
  return { subscriptions: [] as Array<{ dispose: () => void }>, extensionUri: Uri.file("/ext") };
}

/** Register the command via activate() and invoke it to open the panel. */
function activateAndShow() {
  const context = fakeContext();
  activate(context as never);
  const showGraph = records.commands.get("dataformDag.showGraph")!;
  showGraph();
  return context;
}

function watcherFor(glob: string) {
  const watcher = records.watchers.find(
    (candidate) => candidate.glob === glob,
  );

  if (!watcher) {
    throw new Error(
      `Watcher not found for glob: ${glob}`,
    );
  }

  return watcher;
}

beforeEach(() => {
  resetMock();

  buildMock.mockReset();
  serializeMock.mockReset();
  compileMock.mockReset();

  buildMock.mockResolvedValue({
    nodes: new Map(),
    edges: [],
  });

  serializeMock.mockReturnValue(
    SERIALIZED,
  );

  compileMock.mockResolvedValue({
    tables: [],
    operations: [],
    assertions: [],
    declarations: [],
  });

  findCompiledActionMock.mockReset();

  workspace.workspaceFolders = [
    {
      uri: {
        fsPath: "/proj",
      },
    },
  ];
});

describe("activate", () => {
  it("registers the commands and pushes disposables", () => {
    const context = activateAndShow();

    expect(commands.registerCommand).toHaveBeenCalledWith(
      "dataformDag.showGraph",
      expect.any(Function),
    );

    expect(commands.registerCommand).toHaveBeenCalledWith(
      "dataformDag.showCompiledSql",
      expect.any(Function),
    );

    // showGraph + showCompiledSql + controller
    expect(context.subscriptions).toHaveLength(3);
  });
});

describe("show", () => {
  it("creates exactly one webview panel (single mock-instance smoke check)", () => {
    activateAndShow();
    expect(records.panels).toHaveLength(1);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("reveals the existing panel instead of creating a second one", () => {
    const context = fakeContext();
    activate(context as never);
    const showGraph = records.commands.get("dataformDag.showGraph")!;
    showGraph();
    showGraph();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(lastPanel().reveal).toHaveBeenCalledTimes(1);
  });

  it("renders a CSP that nonces the script and forbids eval (invariant #1)", () => {
    activateAndShow();
    const { html } = lastPanel().webview;
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}'/);
    expect(html).not.toContain("unsafe-eval");
    expect(html).toContain("/ext/dist/webview.js");
  });
});

describe("message routing", () => {
  it("builds and posts the graph on 'ready'", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith({
        type: "graphUpdate",
        graph: SERIALIZED,
      }),
    );
  });

  it("rebuilds on 'requestRefresh'", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "requestRefresh" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(lastPanel().webview.postMessage).toHaveBeenCalledWith({
      type: "graphUpdate",
      graph: SERIALIZED,
    });
  });

  it("opens the file in column one on 'openFile'", () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "openFile", filePath: "/proj/a.sqlx" });
    expect(window.showTextDocument).toHaveBeenCalledTimes(1);
    const { uri, opts } = records.shownDocs[0];
    expect(uri.fsPath).toBe("/proj/a.sqlx");
    expect(opts).toEqual({ viewColumn: ViewColumn.One, preview: false });
  });

  it(
    "posts compiled SQL back to the webview",
    async () => {
      findCompiledActionMock.mockReturnValue({
        target: {
          name: "customers",
        },
        fileName:
          "definitions/customers.sqlx",
        query:
          "SELECT * FROM `project.demo.customers`",
      });

      activateAndShow();

      lastPanel().webview.emitMessage({
        type: "showCompiledSql",
        nodeId: "customers",
        filePath:
          "/proj/definitions/customers.sqlx",
      });

      await vi.waitFor(() =>
        expect(
          lastPanel().webview.postMessage,
        ).toHaveBeenCalledWith({
          type: "compiledSqlResult",
          nodeId: "customers",
          sql:
            "SELECT * FROM `project.demo.customers`",
        }),
      );
    },
  );
});

describe("buildAndPost", () => {
  it("warns and does not post when no folder is open", async () => {
    workspace.workspaceFolders = undefined;
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(records.warnings).toHaveLength(1));
    expect(records.warnings[0]).toMatch(/open a folder/i);
    expect(buildMock).not.toHaveBeenCalled();
    expect(lastPanel().webview.postMessage).not.toHaveBeenCalled();
  });

  it("surfaces a build failure as an error message without crashing", async () => {
    buildMock.mockRejectedValueOnce(new Error("boom"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(records.errors).toHaveLength(1));
    expect(records.errors[0]).toMatch(/boom/);
    expect(lastPanel().webview.postMessage).not.toHaveBeenCalled();
  });

  it("builds from the first workspace folder's path", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(buildMock.mock.calls[0][0]).toMatchObject({ root: "/proj" });
  });
});

describe("watcher wiring", () => {
  it("watches **/*.sqlx and rebuilds on change, create, and delete", async () => {
    activateAndShow();

    const sqlxWatcher =
      watcherFor("**/*.sqlx");

    expect(sqlxWatcher.glob).toBe(
      "**/*.sqlx",
    );

    sqlxWatcher.emitChange();
    sqlxWatcher.emitCreate();
    sqlxWatcher.emitDelete();

    await vi.waitFor(() =>
      expect(buildMock).toHaveBeenCalledTimes(3),
    );
  });

  it("watches files that can affect compiled SQL", () => {
    activateAndShow();

    expect(
      watcherFor("**/*.js"),
    ).toBeDefined();

    expect(
      watcherFor("**/*.mjs"),
    ).toBeDefined();

    expect(
      watcherFor("**/*.cjs"),
    ).toBeDefined();

    expect(
      watcherFor("**/workflow_settings.yaml"),
    ).toBeDefined();

    expect(
      watcherFor("**/workflow_settings.yml"),
    ).toBeDefined();

    expect(
      watcherFor("**/dataform.json"),
    ).toBeDefined();
  });
});

describe("focusActive", () => {
  it("posts focusNode for an editor whose file maps to a node", async () => {
    activateAndShow();
    // Build first so idByPath is populated from the serialized graph.
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalled());
    const posted = lastPanel().webview.postMessage as Mock;
    posted.mockClear();

    lastActiveEditorHandler()({ document: { uri: { fsPath: "/proj/b.sqlx" } } });
    expect(posted).toHaveBeenCalledWith({ type: "focusNode", nodeId: "b" });
  });

  it("does nothing for an unknown file or no active editor", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalled());
    const posted = lastPanel().webview.postMessage as Mock;
    posted.mockClear();

    lastActiveEditorHandler()({ document: { uri: { fsPath: "/proj/unknown.sqlx" } } });
    lastActiveEditorHandler()(undefined);
    expect(posted).not.toHaveBeenCalled();
  });
});

describe("dispose", () => {
  it("tears down the panel and all watchers so a later show() opens a fresh one", () => {
    activateAndShow();

    const watchers = [
      ...records.watchers,
    ];

    expect(watchers.length).toBeGreaterThan(1);

    lastPanel().emitDispose();

    for (const watcher of watchers) {
      expect(
        watcher.dispose,
      ).toHaveBeenCalledTimes(1);
    }

    records.commands
      .get("dataformDag.showGraph")!();

    expect(
      window.createWebviewPanel,
    ).toHaveBeenCalledTimes(2);
  });
});
