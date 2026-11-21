import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const name = 'claude-code-hooks'
export const inject = ['systemPrompt']

export function apply(ctx, config = {}) {
  const hooks = config.hooks?.SessionStart ?? []
  const includeSubagents = config.includeSubagents === true
  const logFile = config.logFile
  const notices = new Map()

  const log = (text) => {
    const line = '[' + new Date().toISOString() + '] ' + text + '\n'
    try {
      if (typeof logFile === 'string' && logFile.length > 0) {
        mkdirSync(dirname(logFile), { recursive: true })
        appendFileSync(logFile, line)
      }
    } catch {}
    try { ctx.logger.info('claude-code-hooks: ' + text) } catch {}
  }

  log('loaded with ' + hooks.length + ' SessionStart hook(s)')

  const runHook = (hook, payload) => new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let settled = false
    let child
    try {
      child = spawn(hook.command, hook.args ?? [], {
        cwd: payload.cwd,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: payload.cwd,
          CLAUDE_CWD: payload.cwd,
          ...(hook.env ?? {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      log('spawn ' + hook.command + ' failed: ' + error.message)
      resolve({ ok: false })
      return
    }
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
    }, hook.timeoutMs ?? 30000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      log('hook ' + hook.command + ' error: ' + error.message)
      finish({ ok: false })
    })
    child.on('close', (code) => {
      const trimmed = stdout.trim()
      log('hook ' + hook.command + ' exited ' + code + ' in ' + (Date.now() - started) + 'ms; stdout=' +
        JSON.stringify(trimmed.slice(0, 400)) +
        (stderr.trim() ? '; stderr=' + JSON.stringify(stderr.trim().slice(0, 400)) : ''))
      finish({ ok: code === 0, stdout: trimmed })
    })
    try { child.stdin.end(JSON.stringify(payload)) } catch {}
  })

  ctx.on('session/created', (session) => {
    const header = session?.header
    if (header === undefined) return
    if (!includeSubagents && (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0)) return
    const cwd = typeof header.cwd === 'string' ? header.cwd : process.cwd()
    const payload = {
      session_id: header.id,
      cwd,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }
    for (const hook of hooks) {
      void runHook(hook, payload).then((result) => {
        if (!result.ok || !result.stdout) return
        try {
          const parsed = JSON.parse(result.stdout)
          if (parsed && typeof parsed.systemMessage === 'string' && parsed.systemMessage.trim() !== '') {
            notices.set(header.id, parsed.systemMessage.trim())
          }
        } catch {}
      })
    }
  })

  try {
    if (ctx.systemPrompt !== undefined) {
      ctx.systemPrompt.section({
        name: 'claude-code-hooks:session-start',
        order: 5,
        text: (context) => {
          const agent = context?.agent
          if (agent === undefined) return ''
          const notice = notices.get(agent.session.id)
          return typeof notice === 'string' ? notice : ''
        },
      })
      log('system prompt section registered')
    }
  } catch (error) {
    log('system prompt section unavailable: ' + error.message)
  }
}
