# .github/docs/

Active wave plans and session artifacts go here. Date-prefixed files are moved to `docs/archive/` once the session completes.

For the docs entrypoint, see `docs/README.md`.

---

## Modular Copilot Instructions v6.0

The copilot instructions have been refactored into a modular architecture for token efficiency.

### Load Strategy

**Always load:**
- `.github/copilot-instructions.md` (primary instructions, ~5.5K tokens)

**Load on-demand based on task:**
- Error handling/debugging → `.github/specialist-guides/error-handling.md`
- Code review/refactoring → `.github/specialist-guides/code-quality.md`
- Architecture decisions → `.github/specialist-guides/architecture-decisions.md`
- Domain-specific work → `.github/specialist-guides/checklists.md`
- User questions → `.github/specialist-guides/user-engagement-model.md`

See `.github/specialist-guides-index.md` for quick decision tree and token cost breakdown.
