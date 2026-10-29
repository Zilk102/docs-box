<!-- codemaps:start v1.1.66 -->
## CodeMaps

This project is connected to CodeMaps, an MCP server (`codemaps`) that keeps a dependency graph of the codebase. This section was written by the `setup_project` tool; run it again to refresh it.

### Workflow

1. At the start of a session call `setup_project` once, with `projectPath` set to your current working directory. It is idempotent and cheap, and reports `upToDate` when nothing changed.
2. Before coding call `prepare_task_context` with the user's request. It picks the target files, the blast radius and the risks, so do not guess files.
3. Before writing code that resembles existing code call `find_duplicates` and reuse or extract instead of copy-pasting.
4. After editing call `validate_architecture_changes` (it checks only the files you changed) and fix every problem it reports, then `check_documentation`.

### Tool names and projects

Some clients show the tools with a server prefix (for example `codemaps_` or `mcp__codemaps__` before the name); use the tool whose name ends with the one written here. If CodeMaps has not loaded the project, call `analyze_project` with the absolute project path. For a bug start from `prepare_task_context`; for duplicated code call `find_duplicates`; for a tangled file call `analyze_decomposition`. If your client does not validate edits for you, calling `validate_architecture_changes` after every edit is your job.

### Documentation

- Every new or changed file starts with a header comment.
- Every exported symbol, and every function of 10 or more lines, has a doc comment that states the purpose, the contract (inputs, result, failures) and why it exists.
- Never repeat the name ("Gets the user" above `getUser`), and never leave commented-out code behind.

### Legacy code

`.codemaps/baseline.json` freezes the findings the project already had. Only new or worsened findings are reported, so fix those and leave old debt alone unless the task is to pay it down. Never edit the baseline by hand.

### CI

Pull requests run `codemaps-guard` (see `.github/workflows/codemaps-guard.yml` or `.codemaps/ci/`), which applies the same rules headlessly: it fails on new or worsened findings and when the baseline grows. Passing `validate_architecture_changes` and `check_documentation` locally keeps CI green.

### Large changes and legacy refactoring

- Cross-cutting migrations: `prepare_change_campaign`, then work wave by wave.
- Oversized or tangled files: `analyze_decomposition` with `filePath` returns split plans to follow.

### Saving tokens

Read a file's structure with `get_semantic_skeleton` before opening it, use `search_signatures` to find a declaration, and raise `limit` only when a response says `_compaction`.
<!-- codemaps:end -->
