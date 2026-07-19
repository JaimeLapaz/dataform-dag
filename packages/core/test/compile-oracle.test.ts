import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  NodeFileSource,
  ParsedGraphSource,
  graphFromCompileOutput,
  type CompileOutput,
  type DataformGraph,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(HERE, "fixtures", "compile.golden.json"), "utf8"),
) as CompileOutput;

let parsed: DataformGraph;
let compiled: DataformGraph;
beforeAll(async () => {
  parsed = await new ParsedGraphSource(new NodeFileSource(join(HERE, "fixtures"))).build();
  compiled = graphFromCompileOutput(golden);
});

const isInlineAssertion = (id: string) => id.includes("_assertions_");

describe("regex parser vs. dataform compile --json (fidelity oracle)", () => {
  it("every parsed node exists in the compiled ground truth (no phantoms)", () => {
    const compiledIds = new Set(compiled.nodes.keys());
    const phantom = [...parsed.nodes.keys()].filter((id) => !compiledIds.has(id));
    expect(phantom).toEqual([]);
  });

  it("the ONLY nodes the regex parser misses are inline config.assertions", () => {
    const parsedIds = new Set(parsed.nodes.keys());
    const missed = [...compiled.nodes.keys()].filter((id) => !parsedIds.has(id));
    expect(missed.length).toBeGreaterThan(0); // the gap is real and worth documenting
    expect(missed.every(isInlineAssertion)).toBe(true); // ...and it is exactly this and nothing else
  });

  it("quantifies the gap: parser sees one node per file, compile adds the generated assertions", () => {
    expect(parsed.nodes.size).toBe(16); // one action per .sqlx file
    expect(compiled.nodes.size).toBe(24); // + 8 inline-assertion actions
  });

  it("agrees with compile on every file-based node's type, tags, and dependency edges", () => {
    for (const [id, node] of parsed.nodes) {
      const truth = compiled.nodes.get(id);
      expect(truth, `compiled graph missing ${id}`).toBeDefined();
      // Type must match — a config comment carrying an apostrophe must not derail type detection.
      expect(node.type, `type mismatch for ${id}`).toBe(truth!.type);
      // Tags must match (compile emits null for none; the parser emits []).
      expect(new Set(node.tags), `tags mismatch for ${id}`).toEqual(new Set(truth!.tags));
      // Compare edge SETS: parser and compile both key deps by target name.
      expect(new Set(node.refs), `refs mismatch for ${id}`).toEqual(new Set(truth!.refs));
    }
  });
});
