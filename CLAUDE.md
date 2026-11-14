@AGENTS.md

## Claude Code specifics

- Project settings are in `.claude/settings.json` and are committed. Personal overrides go in
  `.claude/settings.local.json`, which is gitignored.
- The PostToolUse hook formats every file you `Edit`/`Write`. If it prints a prettier syntax
  error, the file you just wrote doesn't parse, so fix it. Don't reformat files by hand.
- Skills in `.agents/skills` show up as project skills through the `.claude/skills` symlink.
  Use `dev-stack` instead of the generic `run` skill to start this app.
- Long-running servers (`npm run dev`) should run in the background (`run_in_background`) or in
  the user's own terminal (see the Postgres.app gotcha above). Don't leave a foreground command
  blocking.
