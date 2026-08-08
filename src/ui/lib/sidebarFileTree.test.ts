import { describe, expect, test } from "bun:test";
import { buildSidebarFileTree } from "./sidebarFileTree";

function file(id: string, path: string) {
  return {
    id,
    path,
    stats: { additions: 1, deletions: 0 },
    changeType: "change" as const,
  };
}

describe("buildSidebarFileTree", () => {
  test("folds single-child directories and preserves first-seen file order", () => {
    const tree = buildSidebarFileTree([
      file("deep", "src/ui/components/App.tsx"),
      file("sibling", "src/ui/theme.ts"),
      file("root", "README.md"),
    ]);

    expect(
      tree.entries.map((entry) => [
        entry.kind,
        entry.kind === "group" ? entry.label : entry.name,
        entry.depth,
      ]),
    ).toEqual([
      ["group", "src/ui/", 0],
      ["group", "components/", 1],
      ["file", "App.tsx", 2],
      ["file", "theme.ts", 1],
      ["file", "README.md", 0],
    ]);
    expect(tree.ancestorsByFileId.get("deep")).toEqual(["src", "src/ui", "src/ui/components"]);
  });

  test("collapses one folded directory without disturbing sibling rows", () => {
    const tree = buildSidebarFileTree(
      [file("deep", "src/ui/App.tsx"), file("test", "test/App.test.ts"), file("root", "README.md")],
      new Set(["src/ui"]),
    );

    expect(
      tree.entries.map((entry) => [entry.kind, entry.kind === "group" ? entry.label : entry.name]),
    ).toEqual([
      ["group", "src/ui/"],
      ["group", "test/"],
      ["file", "App.test.ts"],
      ["file", "README.md"],
    ]);
    expect(tree.entries[0]).toMatchObject({ path: "src/ui", collapsed: true });
  });

  test("keeps root files name-first without a redundant dot group", () => {
    const tree = buildSidebarFileTree([file("a", "a.ts"), file("b", "b.ts")]);
    expect(tree.entries.map((entry) => entry.kind === "file" && entry.name)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});
