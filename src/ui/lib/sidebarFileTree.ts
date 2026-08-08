import { normalizeDiffPath } from "../../core/diffPaths";
import { formatTerminalPath } from "../../lib/terminalText";
import { buildSidebarFileEntry, type SidebarEntry, type SidebarFileSource } from "./files";

interface DirectoryNode {
  path: string;
  segment: string;
  items: Array<
    { kind: "directory"; node: DirectoryNode } | { kind: "file"; file: SidebarFileSource }
  >;
  directories: Map<string, DirectoryNode>;
}

function createDirectory(path: string, segment: string): DirectoryNode {
  return { path, segment, items: [], directories: new Map() };
}

/** Build one first-seen-order path trie and each file's directory ancestry. */
function buildTree(files: readonly SidebarFileSource[]) {
  const root = createDirectory(".", ".");
  const ancestorsByFileId = new Map<string, string[]>();

  for (const file of files) {
    const normalized = formatTerminalPath(normalizeDiffPath(file.path) ?? file.path);
    const parts = normalized.split("/").filter(Boolean);
    const directories = parts.slice(0, -1);
    const ancestors: string[] = [];
    let node = root;

    for (const segment of directories) {
      let child = node.directories.get(segment);
      if (!child) {
        const path = node.path === "." ? segment : `${node.path}/${segment}`;
        child = createDirectory(path, segment);
        node.directories.set(segment, child);
        node.items.push({ kind: "directory", node: child });
      }
      node = child;
      ancestors.push(node.path);
    }

    node.items.push({ kind: "file", file });
    ancestorsByFileId.set(file.id, ancestors);
  }

  return { root, ancestorsByFileId };
}

/** Fold directory chains that contain no direct files or sibling directories. */
function foldedDirectory(node: DirectoryNode) {
  const segments = [node.segment];
  let leaf = node;
  while (leaf.items.length === 1 && leaf.items[0]?.kind === "directory") {
    leaf = leaf.items[0].node;
    segments.push(leaf.segment);
  }
  return { leaf, label: `${segments.join("/")}/` };
}

function flattenDirectory(
  node: DirectoryNode,
  depth: number,
  collapsedPaths: ReadonlySet<string>,
  entries: SidebarEntry[],
) {
  const folded = foldedDirectory(node);
  const collapsed = collapsedPaths.has(folded.leaf.path);
  entries.push({
    kind: "group",
    id: `tree:${folded.leaf.path}`,
    path: folded.leaf.path,
    label: folded.label,
    depth,
    collapsed,
  });
  if (collapsed) return;

  for (const item of folded.leaf.items) {
    if (item.kind === "directory") {
      flattenDirectory(item.node, depth + 1, collapsedPaths, entries);
    } else {
      entries.push(buildSidebarFileEntry(item.file, depth + 1));
    }
  }
}

/** Build collapsible, folded file-tree rows while preserving first-seen order. */
export function buildSidebarFileTree(
  files: readonly SidebarFileSource[],
  collapsedPaths: ReadonlySet<string> = new Set(),
) {
  const { root, ancestorsByFileId } = buildTree(files);
  const entries: SidebarEntry[] = [];

  for (const item of root.items) {
    if (item.kind === "directory") {
      flattenDirectory(item.node, 0, collapsedPaths, entries);
    } else {
      entries.push(buildSidebarFileEntry(item.file, 0));
    }
  }

  return { entries, ancestorsByFileId };
}
