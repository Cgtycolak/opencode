export * as ShellWorkspaceChanges from "./workspace-changes.js"

import type { FileDiff } from "@opencode/schema/file-diff"

/** Files listed individually; the remainder is summarized as a count. */
export const MAX_FILES = 20
/** Hunk and changed lines shown across all files (file labels are not counted). */
export const MAX_DIFF_LINES = 40
/** Characters shown across the whole diff section, labels included. */
export const MAX_DIFF_CHARS = 4_000
/** Characters kept per diff line. */
export const MAX_LINE_CHARS = 200
/** Replaces a file's diff when reading that file is not explicitly allowed. */
export const WITHHELD = "[diff withheld: reading this file is not allowed without permission]"

export interface Change {
  readonly file: string
  readonly status: FileDiff.Info["status"]
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

export interface Summary {
  readonly files: readonly Change[]
  /** Changed files beyond MAX_FILES, listed by count only. */
  readonly more: number
  /** Bounded zero-context diff of the listed files, in listing order. */
  readonly diff: readonly string[]
  /** Diff lines that did not fit into the bounds. */
  readonly omitted: number
}

/**
 * Combine the changed path list with per-file stats and patches for the paths that were diffed. Files in
 * `withheld` keep their summary line, but their patch content is replaced by WITHHELD.
 */
export function summarize(
  paths: readonly string[],
  diffs: readonly FileDiff.Info[],
  withheld: ReadonlySet<string> = new Set(),
): Summary {
  const stats = new Map(diffs.map((diff) => [diff.file, diff]))
  const listed = paths.slice(0, MAX_FILES).flatMap((file) => {
    const diff = stats.get(file)
    return diff ? [diff] : []
  })
  const files = listed.map((diff) => ({
    file: diff.file,
    status: diff.status,
    additions: diff.additions,
    deletions: diff.deletions,
    // Binary files report 0/0 with an empty patch; an empty text file still carries a patch header.
    binary: diff.patch === "",
  }))
  return { files, more: Math.max(0, paths.length - MAX_FILES), ...boundedDiff(listed, withheld) }
}

const STATUS = { added: "A", deleted: "D", modified: "M" } as const

/** Model-visible report, or undefined when nothing changed (the tool result then stays exactly as before). */
export function render(summary: Summary): string | undefined {
  if (summary.files.length === 0 && summary.more === 0) return undefined
  const lines = summary.files.map(
    (change) =>
      `${STATUS[change.status]} ${quote(change.file)} ${change.binary ? "(binary)" : `(+${change.additions} -${change.deletions})`}`,
  )
  if (summary.more > 0) lines.push(`... and ${summary.more} more file${summary.more === 1 ? "" : "s"}`)
  const diff =
    summary.diff.length > 0
      ? [
          `Diff (no context lines; truncated to ${MAX_DIFF_LINES} lines):`,
          ...summary.diff,
          ...(summary.omitted > 0 ? [`[diff truncated: ${summary.omitted} more lines]`] : []),
        ]
      : []
  return [
    "<workspace_changes>",
    // Wording deliberately avoids claiming causation: other processes or tools may write during the window.
    "Files changed in the workspace while this command was running (git snapshot comparison; can include changes made by other processes):",
    ...lines,
    ...diff,
    "</workspace_changes>",
  ].join("\n")
}

/** Hunk headers and changed lines per file (git file headers stripped), cut to the line and character bounds. */
function boundedDiff(listed: readonly FileDiff.Info[], withheld: ReadonlySet<string>) {
  const diff: string[] = []
  let used = 0
  let chars = 0
  let omitted = 0
  for (const file of listed) {
    const lines = hunkLines(file.patch)
    const hunks = lines.length > 0 && withheld.has(file.file) ? [WITHHELD] : lines
    if (hunks.length === 0) continue
    const label = quote(file.file)
    for (const [index, line] of hunks.entries()) {
      const text = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line
      const cost = text.length + 1 + (index === 0 ? label.length + 1 : 0)
      if (used >= MAX_DIFF_LINES || chars + cost > MAX_DIFF_CHARS) {
        omitted += hunks.length - index
        break
      }
      if (index === 0) diff.push(label)
      diff.push(text)
      used++
      chars += cost
    }
  }
  return { diff, omitted }
}

function hunkLines(patch: string) {
  const lines = patch.split("\n")
  const start = lines.findIndex((line) => line.startsWith("@@"))
  if (start === -1) return []
  // Keep hunk headers (git's function context is often diagnostic) and changed lines; drop "\ No newline" markers.
  return lines.slice(start).filter((line) => line.startsWith("@@") || line.startsWith("+") || line.startsWith("-"))
}

function quote(file: string) {
  return /[\s"'\\]/.test(file) ? JSON.stringify(file) : file
}
