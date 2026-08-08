import { z } from "zod";
import type { CliInput } from "./types";

/** Strict runtime schema for the complete serializable review option set. */
const commonOptionsSchema = z
  .strictObject({
    mode: z.enum(["auto", "split", "stack"]),
    cursorLine: z.enum(["row", "number", "off"]),
    vcs: z.string(),
    theme: z.string(),
    agentContext: z.string(),
    pager: z.boolean(),
    watch: z.boolean(),
    experimental: z.boolean(),
    excludeUntracked: z.boolean(),
    lineNumbers: z.boolean(),
    tabWidth: z.int().positive(),
    wrapLines: z.boolean(),
    hunkHeaders: z.boolean(),
    menuBar: z.boolean(),
    agentNotes: z.boolean(),
    copyDecorations: z.boolean(),
    promptSaveViewPreferences: z.boolean(),
    transparentBackground: z.boolean(),
    colorMoved: z.boolean(),
    extensions: z.boolean(),
    extensionPaths: z.array(z.string()),
  })
  .partial();

/** Strict runtime schema for every review input that can create or reload one tab. */
export const cliInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("vcs"),
    range: z.string().optional(),
    staged: z.boolean(),
    pathspecs: z.array(z.string()).optional(),
    options: commonOptionsSchema,
  }),
  z.strictObject({
    kind: z.literal("show"),
    ref: z.string().optional(),
    pathspecs: z.array(z.string()).optional(),
    options: commonOptionsSchema,
  }),
  z.strictObject({
    kind: z.literal("stash-show"),
    ref: z.string().optional(),
    options: commonOptionsSchema,
  }),
  z.strictObject({
    kind: z.literal("diff"),
    left: z.string(),
    right: z.string(),
    options: commonOptionsSchema,
  }),
  z.strictObject({
    kind: z.literal("patch"),
    file: z.string().optional(),
    text: z.string().optional(),
    options: commonOptionsSchema,
  }),
  z.strictObject({
    kind: z.literal("difftool"),
    left: z.string(),
    right: z.string(),
    path: z.string().optional(),
    options: commonOptionsSchema,
  }),
]) satisfies z.ZodType<CliInput>;

/** Parse one exact reloadable review input without throwing at a wire boundary. */
export function parseCliInput(value: unknown): CliInput | null {
  const result = cliInputSchema.safeParse(value);
  return result.success ? result.data : null;
}
