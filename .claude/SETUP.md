# Tooling carried in this repo

## graphify
- Skill: `.claude/skills/graphify/` (project-scoped, picked up automatically by Claude Code).
- Graph output: `graphify-out/` (committed). Refresh with `graphify update .`.
- CLI install on a new machine: `pipx install graphifyy` (or `pip install graphifyy`), then `graphify --help`.

## ponytail (v4.8.4)
- Plugin source snapshot: `.claude/plugins/ponytail/`.
- Install on a new machine the normal way:
  ```
  claude plugin marketplace add DietrichGebert/ponytail
  claude plugin install ponytail@ponytail
  ```
- Or install from this snapshot: `claude plugin install .claude/plugins/ponytail`.
- Session mode is stored in `~/.claude/.ponytail-active` (this machine: `full`).
