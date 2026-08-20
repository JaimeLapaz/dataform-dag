import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractConfigBlock, extractRefs, parseSqlx } from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "definitions");
const read = (rel: string) => readFileSync(join(FIXTURES, rel), "utf8");

describe("extractConfigBlock", () => {
  it("captures a block with nested objects instead of stopping at the first inner brace", () => {
    const block = extractConfigBlock(read("intermediate/int_daily_fare_stats.sqlx"));
    expect(block).not.toBeNull();
    // bigquery: { ... } and assertions: { ... } are both nested — a naive \{[^}]*\} would truncate here.
    expect(block).toContain("partitionBy");
    expect(block).toContain("uniqueKey");
    expect(block).not.toContain("SELECT");
  });

  it("returns null when there is no config block", () => {
    expect(extractConfigBlock("SELECT 1 AS x")).toBeNull();
  });

  it("is not unbalanced by a brace inside a string literal", () => {
    const block = extractConfigBlock('config {\n  type: "table",\n  description: "a } brace"\n}\nSELECT 1');
    expect(block).toContain('description: "a } brace"');
    expect(block).not.toContain("SELECT");
  });
});

describe("parseSqlx identity + type mapping", () => {
  it("keys a declaration by config.name, not the filename", () => {
    const node = parseSqlx("sources/raw_fare_snapshots.sqlx", read("sources/raw_fare_snapshots.sqlx"));
    expect(node.id).toBe("fare_snapshots"); // downstream refs it as ref("fare_snapshots")
    expect(node.type).toBe("source"); // declaration -> source
  });

  it("falls back to the basename when no name is declared", () => {
    const node = parseSqlx("intermediate/int_trip_fares.sqlx", read("intermediate/int_trip_fares.sqlx"));
    expect(node.id).toBe("int_trip_fares");
  });

  it("maps incremental and assertion types through", () => {
    expect(parseSqlx("x.sqlx", read("intermediate/int_daily_fare_stats.sqlx")).type).toBe("incremental");
    expect(parseSqlx("x.sqlx", read("assertions/assert_snapshot_freshness.sqlx")).type).toBe("assertion");
  });
});

describe("parseSqlx description", () => {
  it("unescapes literal \\n inside a long quoted description", () => {
    const node = parseSqlx("reference/dim_events.sqlx", read("reference/dim_events.sqlx"));
    expect(node.description).toBeTruthy();
    expect(node.description).toContain("\n"); // dim_events embeds \n\n paragraph breaks
    expect(node.description).not.toContain("\\n"); // ...unescaped, not the literal backslash-n
  });
});

describe("extractRefs", () => {
  it("finds ref() calls and ignores self()/when()/projectConfig template calls", () => {
    const refs = extractRefs(read("intermediate/int_daily_fare_stats.sqlx"));
    expect(refs).toContain("int_trip_fares");
    expect(refs).not.toContain("self"); // ${self()} is not a ref
  });

  it("dedupes repeated refs, preserving first-seen order", () => {
    const refs = extractRefs('SELECT * FROM ${ref("a")} JOIN ${ref("b")} JOIN ${ref("a")}');
    expect(refs).toEqual(["a", "b"]);
  });

  it("supports the object form ref({ name: ... })", () => {
    expect(extractRefs('FROM ${ref({ schema: "s", name: "obj_model" })}')).toEqual(["obj_model"]);
  });

  // KNOWN regex-tier limitation: extractRefs scans the whole file, so a ref() inside a SQL comment
  // is still extracted, whereas `dataform compile` ignores commented SQL. This is a deliberate
  // fidelity tradeoff (like the inline-assertion gap) — a correct SQL comment stripper must handle
  // `--`, `/* */`, AND `--` sequences inside string literals, which isn't worth the risk for the
  // regex tier. Use CompiledGraphSource when this matters. This test pins the behavior so it's a
  // documented boundary, not a silent surprise.
  it("(known limitation) still extracts a ref that is commented out in the SQL body", () => {
    expect(extractRefs('SELECT 1 -- legacy join ${ref("legacy_table")}\nFROM ${ref("real")}')).toEqual([
      "legacy_table",
      "real",
    ]);
  });
});

describe("config dependencies", () => {
  it("reads explicit dependencies", () => {
    const node = parseSqlx(
      "definitions/process_data.sqlx",
      `
        config {
          type: "operations",
          dependencies: ["prepare_data"]
        }

        SELECT 1;
      `,
    );

    expect(node.refs).toEqual([
      "prepare_data",
    ]);
  });

  it("uses filename as node id when name is not declared", () => {
    const node = parseSqlx(
      "definitions/prepare_data.sqlx",
      `
        config {
          type: "operations"
        }

        SELECT 1;
      `,
    );

    expect(node.id).toBe(
      "prepare_data",
    );
  });

  it("uses config.name as node id when name is declared", () => {
    const node = parseSqlx(
      "definitions/prepare_data.sqlx",
      `
        config {
          type: "operations",
          name: "load_raw_data"
        }

        SELECT 1;
      `,
    );

    expect(node.id).toBe(
      "load_raw_data",
    );
  });

  it("keeps dependencies pointing to config.name", () => {
    const upstream = parseSqlx(
      "definitions/prepare_data.sqlx",
      `
        config {
          type: "operations",
          name: "load_raw_data"
        }

        SELECT 1;
      `,
    );

    const downstream = parseSqlx(
      "definitions/process_data.sqlx",
      `
        config {
          type: "operations",
          dependencies: ["load_raw_data"]
        }

        SELECT 2;
      `,
    );

    expect(upstream.id).toBe(
      "load_raw_data",
    );

    expect(downstream.refs).toEqual([
      "load_raw_data",
    ]);
  });

  it("combines ref dependencies and explicit dependencies", () => {
    const node = parseSqlx(
      "definitions/process_data.sqlx",
      `
        config {
          type: "operations",
          dependencies: ["prepare_data"]
        }

        SELECT *
        FROM \${ref("customers")}
      `,
    );

    expect(node.refs).toEqual([
      "customers",
      "prepare_data",
    ]);
  });

  it("does not duplicate dependencies", () => {
    const node = parseSqlx(
      "definitions/process_data.sqlx",
      `
        config {
          type: "operations",
          dependencies: [
            "prepare_data",
            "prepare_data"
          ]
        }

        SELECT 1;
      `,
    );

    expect(node.refs).toEqual([
      "prepare_data",
    ]);
  });
});