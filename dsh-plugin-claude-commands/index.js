import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'claude-code-commands'
export const inject = ['commands']

const REVIEW_PROMPT = [
  'Provide a code review for the current changes in this workspace.',
  '',
  'Review along two axes and report them side by side:',
  '1. Standards — does the change follow the documented coding standards of this repository (AGENTS.md/CLAUDE.md, style, tests, naming)?',
  '2. Spec — does the change match what the originating issue, task or user request asked for?',
  '',
  'Start from the diff of the working tree (and the branch against its merge base when one exists).',
  'Report concrete findings with file paths and line references, ordered by severity, and call out anything you could not verify.',
].join('\n')

const REVISE_PROMPT = [
  'Review this session for learnings about working in this codebase and update CLAUDE.md (or AGENTS.md when the repository uses that name) with context that would help future sessions.',
  '',
  'Steps:',
  '1. Reflect on what context was missing: commands discovered, code style patterns, testing approaches, environment quirks, gotchas.',
  '2. Find the instruction files (CLAUDE.md, AGENTS.md, .claude.local.md) in the repository.',
  '3. Draft concise one-line additions and show them as a diff before editing.',
  '4. Apply only the additions the user approves.',
].join('\n')

export function apply(ctx, config = {}) {
  const logFile = config.logFile
  const log = (text) => {
    const line = '[' + new Date().toISOString() + '] ' + text + '\n'
    try {
      if (typeof logFile === 'string' && logFile.length > 0) {
        mkdirSync(dirname(logFile), { recursive: true })
        appendFileSync(logFile, line)
      }
    } catch {}
    try { ctx.logger.info('claude-code-commands: ' + text) } catch {}
  }

  const register = (definition) => {
    try {
      ctx.commands.register(definition)
      log('registered /' + definition.name)
    } catch (error) {
      log('failed to register /' + definition.name + ': ' + error.message)
    }
  }

  const steer = (agent, text) => {
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
  }

  register({
    name: 'code-review',
    description: 'Review the current changes along Standards and Spec axes',
    input: { hint: '[target]' },
    handler: ({ agent, rawInput }) => {
      if (agent === undefined) return { kind: 'error', text: 'No active session.' }
      const target = (rawInput ?? '').trim()
      steer(agent, target === '' ? REVIEW_PROMPT : REVIEW_PROMPT + '\n\nTarget: ' + target)
      return { kind: 'success', text: 'Started a code review of ' + (target === '' ? 'the current changes.' : target + '.') }
    },
  })

  register({
    name: 'revise-claude-md',
    description: 'Update CLAUDE.md / AGENTS.md with learnings from this session',
    handler: ({ agent }) => {
      if (agent === undefined) return { kind: 'error', text: 'No active session.' }
      steer(agent, REVISE_PROMPT)
      return { kind: 'success', text: 'Asked the agent to revise the instruction file.' }
    },
  })

  log('loaded with 2 command(s)')
}
