# dsh-plugin-claude-hooks

A local DeepSeek Harness bundle that runs Claude Code compatible `SessionStart` hooks when a DSH session starts.

- Mirrors `~/.claude/settings.json` `hooks.SessionStart`: same commands, JSON payload on stdin (`session_id`, `cwd`, `hook_event_name`, `source`), `CLAUDE_PROJECT_DIR`/`CLAUDE_CWD` environment.
- Captures a hook's `{"systemMessage": "..."}` stdout and exposes it to the model through a system-prompt section for that session.
- Root sessions only by default (`includeSubagents: false`).
- Logs every run to `~/.dsh/logs/claude-code-hooks.log`.

Ships with no hooks configured. Add your own commands in the profile layer (`~/.dsh/profiles/<profile>/cordis.patch.yml`, `id: claude-code-hooks`) so local paths stay out of the repository; see the repository root README.
