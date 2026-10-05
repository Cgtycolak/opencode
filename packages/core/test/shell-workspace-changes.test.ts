import { describe, expect, test } from "bun:test"
import { ShellWorkspaceChanges } from "@opencode/core/shell/workspace-changes"

const header = (file: string) => [
  `diff --git a/${file} b/${file}`,
  "index 1111111..2222222 100644",
  `--- a/${file}`,
  `+++ b/${file}`,
]

const diff = (
  file: string,
  status: "added" | "deleted" | "modified",
  additions: number,
  deletions: number,
  patch = [...header(file), "@@ -1 +1 @@", "-old", "+new"].join("\n"),
) => ({ file, status, additions, deletions, patch })

const render = (paths: string[], diffs: ReturnType<typeof diff>[]) =>
  ShellWorkspaceChanges.render(ShellWorkspaceChanges.summarize(paths, diffs))

describe("ShellWorkspaceChanges.render", () => {
  test("renders nothing when no files changed", () => {
    expect(render([], [])).toBeUndefined()
  })

  test("lists status and line counts, then a zero-context diff without git file headers", () => {
    const text = render(
      ["a.py", "b.txt"],
      [
        diff(
          "a.py",
          "modified",
          1,
          2,
          [...header("a.py"), "@@ -3,2 +3 @@ def run():", "-    one", "-    two", "+    three"].join("\n"),
        ),
        diff(
          "b.txt",
          "added",
          1,
          0,
          [
            "diff --git a/b.txt b/b.txt",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/b.txt",
            "@@ -0,0 +1 @@",
            "+hello",
            "\\ No newline at end of file",
          ].join("\n"),
        ),
      ],
    )
    expect(text).toBe(
      [
        "<workspace_changes>",
        "Files changed in the workspace while this command was running (git snapshot comparison; can include changes made by other processes):",
        "M a.py (+1 -2)",
        "A b.txt (+1 -0)",
        "Diff (no context lines; truncated to 40 lines):",
        "a.py",
        "@@ -3,2 +3 @@ def run():",
        "-    one",
        "-    two",
        "+    three",
        "b.txt",
        "@@ -0,0 +1 @@",
        "+hello",
        "</workspace_changes>",
      ].join("\n"),
    )
  })

  test("marks binary files and shows no diff for them", () => {
    const text = render(["logo.png"], [diff("logo.png", "modified", 0, 0, "")])!
    expect(text).toContain("M logo.png (binary)")
    expect(text).not.toContain("Diff (")
  })

  test("keeps empty text files as line counts", () => {
    const text = render(["empty.txt"], [diff("empty.txt", "added", 0, 0, "diff --git a/empty.txt b/empty.txt")])!
    expect(text).toContain("A empty.txt (+0 -0)")
    expect(text).not.toContain("Diff (")
  })

  test("caps the diff at MAX_DIFF_LINES across files and counts the rest", () => {
    const big = [...header("big.py"), "@@ -1,50 +0,0 @@", ...Array.from({ length: 50 }, (_, i) => `-line ${i}`)].join(
      "\n",
    )
    const text = render(
      ["big.py", "small.py"],
      [diff("big.py", "modified", 0, 50, big), diff("small.py", "modified", 1, 1)],
    )!
    const body = text.slice(text.indexOf("Diff ("))
    const shown = body
      .split("\n")
      .filter((line) => line.startsWith("@@") || line.startsWith("-") || line.startsWith("+"))
    expect(shown).toHaveLength(ShellWorkspaceChanges.MAX_DIFF_LINES)
    // 51 lines of big.py minus 40 shown, plus all 3 lines of small.py.
    expect(text).toContain("[diff truncated: 14 more lines]")
    expect(body).not.toContain("small.py")
  })

  test("caps the diff at MAX_DIFF_CHARS", () => {
    const long = [
      ...header("wide.txt"),
      "@@ -1,30 +0,0 @@",
      ...Array.from({ length: 30 }, () => `-${"x".repeat(190)}`),
    ].join("\n")
    const summary = ShellWorkspaceChanges.summarize(["wide.txt"], [diff("wide.txt", "modified", 0, 30, long)])
    expect(summary.diff.join("\n").length).toBeLessThanOrEqual(ShellWorkspaceChanges.MAX_DIFF_CHARS)
    expect(summary.omitted).toBeGreaterThan(0)
    expect(summary.diff.length - 1 + summary.omitted).toBe(31)
  })

  test("truncates very long diff lines", () => {
    const patch = [...header("min.js"), "@@ -1 +1 @@", `+${"y".repeat(500)}`].join("\n")
    const summary = ShellWorkspaceChanges.summarize(["min.js"], [diff("min.js", "modified", 1, 0, patch)])
    expect(summary.diff[2]).toBe(`+${"y".repeat(ShellWorkspaceChanges.MAX_LINE_CHARS - 1)}…`)
  })

  test("caps the file list and counts the remainder", () => {
    const paths = Array.from({ length: 30 }, (_, index) => `f${String(index).padStart(2, "0")}.txt`)
    const summary = ShellWorkspaceChanges.summarize(
      paths,
      paths.slice(0, ShellWorkspaceChanges.MAX_FILES).map((file) => diff(file, "added", 1, 0)),
    )
    expect(summary.files).toHaveLength(ShellWorkspaceChanges.MAX_FILES)
    expect(summary.more).toBe(10)
    const text = ShellWorkspaceChanges.render(summary)!
    expect(text).toContain("A f19.txt (+1 -0)")
    expect(text).not.toContain("f20.txt")
    expect(text).toContain("... and 10 more files")
  })

  test("replaces withheld files' diff with a marker but keeps their summary line", () => {
    const text = ShellWorkspaceChanges.render(
      ShellWorkspaceChanges.summarize(
        [".env", "a.py", "empty.env", "logo.env"],
        [
          diff(".env", "added", 1, 0, [...header(".env"), "@@ -0,0 +1 @@", "+API_KEY=secret"].join("\n")),
          diff("a.py", "modified", 1, 1),
          diff("empty.env", "added", 0, 0, "diff --git a/empty.env b/empty.env"),
          diff("logo.env", "modified", 0, 0, ""),
        ],
        new Set([".env", "empty.env", "logo.env"]),
      ),
    )!
    expect(text).toContain("A .env (+1 -0)")
    expect(text).toContain(`.env\n${ShellWorkspaceChanges.WITHHELD}`)
    expect(text).not.toContain("secret")
    expect(text).toContain("a.py\n@@ -1 +1 @@\n-old\n+new")
    // No content means nothing to withhold; binary files never carry content.
    expect(text.match(/\[diff withheld/g)).toHaveLength(1)
    expect(text).toContain("M logo.env (binary)")
  })

  test("quotes paths that contain spaces or quotes", () => {
    expect(render(["my file.txt"], [diff("my file.txt", "added", 1, 0)])).toContain('A "my file.txt" (+1 -0)')
  })
})
