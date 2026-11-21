# dsh-plugin-claude-commands

Local DSH bundle adding two Claude Code style slash commands:

- `/code-review [target]` — asks the agent to review current changes on the Standards and Spec axes.
- `/revise-claude-md` — asks the agent to update CLAUDE.md / AGENTS.md with session learnings.

Commands steer a normal user message into the active agent, so they cost the same tokens as typing the prompt.
