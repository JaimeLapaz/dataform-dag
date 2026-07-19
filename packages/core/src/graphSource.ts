import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DataformGraph, DataformNode, NodeType } from "./types.js";
import type { FileSource } from "./fileSource.js";
import { buildGraph } from "./graph.js";
import { parseSqlx } from "./parser.js";

/**
 * A producer of a {@link DataformGraph}. The two implementations emit an INTERCHANGEABLE graph —
 * both key nodes by target name — so hosts and UI depend on this seam, never on how the graph was
 * derived. Add a third strategy later by adding one more `GraphSource`; nothing downstream changes.
 */
export interface GraphSource {
  build(): Promise<DataformGraph>;
}

/**
 * Default source: regex-parse every `.sqlx` a {@link FileSource} exposes. No `@dataform/core`, no
 * compile step — the only strategy that runs in the browser and on a project that doesn't compile.
 * Trade-off: it sees only what's literally in the files, so refs materialized at compile time
 * (inline `config.assertions`, JS-block refs) are absent. Use {@link CompiledGraphSource} when
 * exactness matters and the CLI is available.
 */
export class ParsedGraphSource implements GraphSource {
  constructor(private readonly source: FileSource) {}

  async build(): Promise<DataformGraph> {
    return buildGraphFromWorkspace(this.source);
  }
}

/** Convenience for the regex path: list → read → parse → build. */
export async function buildGraphFromWorkspace(source: FileSource): Promise<DataformGraph> {
  const paths = await source.listSqlx();
  const nodes = await Promise.all(
    paths.map(async (path) => parseSqlx(path, await source.read(path))),
  );
  return buildGraph(nodes);
}

/** The subset of `dataform compile --json` output this mapper reads. */
export interface CompileOutput {
  tables?: CompileAction[];
  operations?: CompileAction[];
  assertions?: CompileAction[];
  declarations?: CompileAction[];
}
interface CompileTarget {
  name: string;
  schema?: string;
  database?: string;
}
interface CompileAction {
  target: CompileTarget;
  type?: string;
  fileName?: string;
  tags?: string[] | null;
  dependencyTargets?: CompileTarget[] | null;
  actionDescriptor?: { description?: string } | null;
}

/**
 * Map a parsed `dataform compile --json` payload to a {@link DataformGraph}. Pure and CLI-free, so
 * it's unit-tested against a committed golden fixture and reused by {@link CompiledGraphSource}.
 * Declarations become `source` nodes; assertions (including the ones Dataform generates from inline
 * `config.assertions`) become `assertion` nodes; edges come straight from `dependencyTargets`.
 */
export function graphFromCompileOutput(output: CompileOutput): DataformGraph {
  const nodes: DataformNode[] = [];
  const collect = (actions: CompileAction[] | undefined, fallback: NodeType) => {
    for (const a of actions ?? []) nodes.push(toNode(a, fallback));
  };
  collect(output.tables, "table");
  collect(output.operations, "operations");
  collect(output.assertions, "assertion");
  collect(output.declarations, "source");
  return buildGraph(nodes);
}

function toNode(a: CompileAction, fallback: NodeType): DataformNode {
  return {
    id: a.target.name,
    filePath: a.fileName ?? a.target.name,
    type: mapCompileType(a.type, fallback),
    tags: a.tags ?? [],
    refs: (a.dependencyTargets ?? []).map((t) => t.name),
    description: a.actionDescriptor?.description,
  };
}

function mapCompileType(type: string | undefined, fallback: NodeType): NodeType {
  switch (type) {
    case "table":
    case "view":
    case "incremental":
    case "operations":
    case "assertion":
      return type;
    case "declaration":
      return "source";
    default:
      return fallback;
  }
}

const execFileAsync = promisify(execFile);

/**
 * High-fidelity source: shells out to `dataform compile --json` in a project root and maps the
 * result. Node-only (spawns a process); requires the CLI and a compiling project. The exact graph
 * Dataform itself resolves — the reference the regex parser is measured against.
 */
export class CompiledGraphSource implements GraphSource {
  constructor(
    private readonly root: string,
    private readonly command = "dataform",
  ) {}

  async build(): Promise<DataformGraph> {
    const { stdout } = await execFileAsync(this.command, ["compile", "--json"], {
      cwd: this.root,
      maxBuffer: 64 * 1024 * 1024,
    });
    return graphFromCompileOutput(JSON.parse(stdout) as CompileOutput);
  }
}
