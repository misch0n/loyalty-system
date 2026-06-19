# Subagent definitions

Concrete, runnable definitions for the roles described in [`../../CLAUDE.md`](../../CLAUDE.md)
§ "Subagent workflow". Each `*.md` here is a Claude Code subagent (YAML
frontmatter + system prompt). Keep these and the CLAUDE.md summary in sync.

| Agent | Role | Edits code? |
|---|---|---|
| `orchestrator` | Plans, sequences, integrates; closes the doc loop via the scribe. | No |
| `explorer` | Read-only recon: where is X / how does Y work / current state. | No |
| `implementer` | Builds one scoped change + tests, within the architecture rules. | Yes |
| `reviewer` | Checks a change against SPEC + invariants (incl. docs) before integration. | No |
| `scribe` | Keeps README / STATUS / CLAUDE / agent docs accurate from a change summary. | Docs only |

**The documentation rule:** any change that affects features, architecture, a
seam, conventions, or acceptance-criteria status ends with a **scribe** pass.
Hand the scribe a plain summary of what changed — it finds where and what to
update. The scribe never edits the authoritative spec (`docs/SPEC.md`); it
records divergences in `docs/STATUS.md` instead.

Loop: `plan → explore → build → review → scribe → integrate → next`.
