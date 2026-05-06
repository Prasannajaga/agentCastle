# Reuse existing worktree by default

## Context

When the **branch** strategy is used, the caller supplies a named branch and Sandcastle creates a worktree at `.sandcastle/worktrees/<name>/`. If a worktree for that branch already exists on disk (e.g. because the user re-ran the same command), the previous behaviour was to throw, with an opt-out via `throwOnDuplicateWorktree: false` that silently returned the existing worktree.

Throw-by-default made the common "re-run the same command" case fail loudly, and the opt-out was unsafe — it silently handed the agent whatever arbitrary state happened to be in the worktree, including uncommitted work from a prior run that could be clobbered.

## Decision

Remove `throwOnDuplicateWorktree` from `run()`, `createSandbox()`, `SandboxFactory`, and `WorktreeManager.create`. Replace with a single built-in behaviour:

- **Clean worktree** (no staged, unstaged, or untracked changes) → reuse it, and emit one `console.log` line so the user knows the starting state wasn't fresh.
- **Dirty worktree** → reuse it, and emit a warning so the user knows the worktree has uncommitted changes. The agent starts with whatever state is there.

"Dirty" is defined narrowly as uncommitted changes. Unpushed commits and branch drift against origin do not count — those are normal for a long-lived named branch, which is the whole point of the **branch** strategy.

The rejected alternatives:

- Keep the boolean and flip the default. The name then reads backwards from the default, and the unsafe "reuse even when dirty" path remains reachable.
- Replace with an enum (`onDuplicateWorktree: "reuse" | "throw"`). Adds a knob with no concrete use case for `"throw"` once the dirty-guard exists.

## Consequences

- Breaking change to the public API on `run()`, `createSandbox()`, and `SandboxFactory`. Pre-1.0, shipped as a `patch` changeset.
- Re-running the same command is now the happy path — no stale-worktree errors when the prior run left the tree clean.
- Dirty worktrees are reused with a warning — no manual cleanup required to re-run. This trades safety (possible clobbering of in-progress work) for convenience. Worktree locking (#401) is a future mitigation for the concurrent-access risk this opens up.
- Only the **branch** strategy is affected in practice. The **merge-to-head** strategy uses fresh timestamped branches per run, so collisions were already impossible there.
