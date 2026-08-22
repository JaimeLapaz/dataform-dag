import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (
    reason?: unknown,
  ) => void;

  const promise = new Promise<T>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
}

function fakeContext(
  initialState: Record<
    string,
    unknown
  > = {},
) {
  const state = new Map<
    string,
    unknown
  >(
    Object.entries(initialState),
  );

  return {
    subscriptions: [] as Array<{
      dispose: () => void;
    }>,

    extensionUri:
      Uri.file("/ext"),

    workspaceState: {
      get: vi.fn(
        (
          key: string,
          defaultValue?: unknown,
        ) =>
          state.has(key)
            ? state.get(key)
            : defaultValue,
      ),

      update: vi.fn(
        async (
          key: string,
          value: unknown,
        ): Promise<void> => {
          if (value === undefined) {
            state.delete(key);
            return;
          }

          state.set(key, value);
        },
      ),

      keys: vi.fn(
        () => [...state.keys()],
      ),
    },
  };
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

afterEach(() => {
  /*
   * Dispose every controller/panel created by the test.
   *
   * This is important because GraphController may have
   * a pending compilation warm-up timer.
   */
  for (const panel of records.panels) {
    panel.emitDispose();
  }
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
  it(
    "posts all compiled operation queries",
    async () => {
      findCompiledActionMock.mockReturnValue({
        target: {
          name: "publish_customers",
        },
        fileName:
          "definitions/publish_operation.sqlx",
        type: "operations",
        queries: [
          "DELETE FROM `project.demo.target` WHERE TRUE",
          "INSERT INTO `project.demo.target` SELECT * FROM `project.demo.source`",
        ],
      });

      activateAndShow();

      lastPanel().webview.emitMessage({
        type: "showCompiledSql",
        nodeId: "publish_customers",
        filePath:
          "/proj/definitions/publish_operation.sqlx",
      });

      const expectedSql = [
        "-- Operation 1",
        "",
        "DELETE FROM `project.demo.target` WHERE TRUE",
        "",
        "",
        "-- Operation 2",
        "",
        "INSERT INTO `project.demo.target` SELECT * FROM `project.demo.source`",
      ].join("\n");

      await vi.waitFor(() =>
        expect(
          lastPanel().webview.postMessage,
        ).toHaveBeenCalledWith({
          type: "compiledSqlResult",
          nodeId: "publish_customers",
          sql: expectedSql,
        }),
      );
    },
  );
  it(
    "posts both full and incremental queries for incremental actions",
    async () => {
      findCompiledActionMock.mockReturnValue({
        target: {
          name: "customers_incremental",
        },
        fileName:
          "definitions/customers_incremental.sqlx",
        type: "incremental",
        query:
          "SELECT * FROM `project.demo.customers`",
        incrementalQuery:
          "SELECT * FROM `project.demo.customers` WHERE customer_id > 100",
      });

      activateAndShow();

      lastPanel().webview.emitMessage({
        type: "showCompiledSql",
        nodeId: "customers_incremental",
        filePath:
          "/proj/definitions/customers_incremental.sqlx",
      });

      const expectedSql = [
        "-- ========================================",
        "-- FULL / INITIAL QUERY",
        "-- ========================================",
        "",
        "SELECT * FROM `project.demo.customers`",
        "",
        "",
        "-- ========================================",
        "-- INCREMENTAL QUERY",
        "-- ========================================",
        "",
        "SELECT * FROM `project.demo.customers` WHERE customer_id > 100",
      ].join("\n");

      await vi.waitFor(() =>
        expect(
          lastPanel().webview.postMessage,
        ).toHaveBeenCalledWith({
          type: "compiledSqlResult",
          nodeId: "customers_incremental",
          sql: expectedSql,
        }),
      );
    },
  );
  it(
    "does not duplicate identical incremental queries",
    async () => {
      findCompiledActionMock.mockReturnValue({
        target: {
          name: "customers_incremental",
        },
        fileName:
          "definitions/customers_incremental.sqlx",
        type: "incremental",
        query:
          "SELECT * FROM `project.demo.customers`",
        incrementalQuery:
          "SELECT * FROM `project.demo.customers`",
      });

      activateAndShow();

      lastPanel().webview.emitMessage({
        type: "showCompiledSql",
        nodeId: "customers_incremental",
        filePath:
          "/proj/definitions/customers_incremental.sqlx",
      });

      await vi.waitFor(() =>
        expect(
          lastPanel().webview.postMessage,
        ).toHaveBeenCalledWith({
          type: "compiledSqlResult",
          nodeId: "customers_incremental",
          sql:
            "SELECT * FROM `project.demo.customers`",
        }),
      );
    },
  );
  it(
    "restores the saved tag filter on ready",
    async () => {
      const context = fakeContext({
        "dataformDag.selectedTags": [
          "silver",
          "gold",
        ],
      });

      activate(context as never);

      const showGraph =
        records.commands.get(
          "dataformDag.showGraph",
        )!;

      showGraph();

      lastPanel().webview.emitMessage({
        type: "ready",
      });

      await vi.waitFor(() =>
        expect(
          lastPanel().webview.postMessage,
        ).toHaveBeenCalledWith({
          type: "tagFilterState",
          selectedTags: [
            "silver",
            "gold",
          ],
        }),
      );
    },
  );
  it(
    "persists tag filter changes",
    async () => {
      const context = fakeContext();

      activate(context as never);

      const showGraph =
        records.commands.get(
          "dataformDag.showGraph",
        )!;

      showGraph();

      lastPanel().webview.emitMessage({
        type: "setTagFilter",
        selectedTags: [
          "silver",
          "gold",
        ],
      });

      await vi.waitFor(() =>
        expect(
          context.workspaceState.update,
        ).toHaveBeenCalledWith(
          "dataformDag.selectedTags",
          ["silver", "gold"],
        ),
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
    expect(
      lastPanel().webview.postMessage,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "graphUpdate",
      }),
    );
  });

  it("surfaces a build failure as an error message without crashing", async () => {
    buildMock.mockRejectedValueOnce(new Error("boom"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(records.errors).toHaveLength(1));
    expect(records.errors[0]).toMatch(/boom/);
    expect(
      lastPanel().webview.postMessage,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "graphUpdate",
      }),
    );
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
  it(
    "debounces compilation warm-up after rapid changes",
    async () => {
      vi.useFakeTimers();

      try {
        activateAndShow();

        const watcher =
          watcherFor("**/*.js");

        watcher.emitChange();
        watcher.emitChange();
        watcher.emitChange();

        expect(
          compileMock,
        ).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(
          299,
        );

        expect(
          compileMock,
        ).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(
          1,
        );

        await Promise.resolve();

        expect(
          compileMock,
        ).toHaveBeenCalledTimes(1);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );
  it(
    "waits for a stale compilation before starting a new one",
    async () => {
      vi.useFakeTimers();

      try {
        const firstCompilation =
          deferred<{
            tables: [];
            operations: [];
            assertions: [];
            declarations: [];
          }>();

        compileMock.mockImplementationOnce(
          () =>
            firstCompilation.promise,
        );

        activateAndShow();

        /*
         * Compilation #1 starts immediately because
         * the user explicitly requests compiled SQL.
         */
        lastPanel().webview.emitMessage({
          type: "showCompiledSql",
          nodeId: "a",
          filePath: "/proj/a.sqlx",
        });

        expect(
          compileMock,
        ).toHaveBeenCalledTimes(1);

        /*
         * A Dataform-related file changes while
         * compilation #1 is still running.
         *
         * This invalidates the generation and schedules
         * a debounced warm-up, but fake timers ensure
         * that warm-up does not run during this test.
         */
        const watcher =
          watcherFor("**/*.js");

        watcher.emitChange();

        /*
         * The user requests SQL again before compilation
         * #1 has completed.
         */
        lastPanel().webview.emitMessage({
          type: "showCompiledSql",
          nodeId: "a",
          filePath: "/proj/a.sqlx",
        });

        /*
         * Compilation #2 must NOT start in parallel.
         */
        expect(
          compileMock,
        ).toHaveBeenCalledTimes(1);

        /*
         * Finish compilation #1.
         */
        firstCompilation.resolve({
          tables: [],
          operations: [],
          assertions: [],
          declarations: [],
        });

        /*
         * Flush the Promise chain.
         */
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        /*
         * Now compilation #2 may start for the new
         * generation.
         */
        expect(
          compileMock,
        ).toHaveBeenCalledTimes(2);
      } finally {
        /*
         * Discard the pending debounced warm-up.
         * Otherwise it would introduce a third request
         * unrelated to what this test is checking.
         */
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );
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
