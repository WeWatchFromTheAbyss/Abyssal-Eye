import type { Register } from 'claude-code'

import { isTracked } from './analyzer'
import { isHumanPrompt, parseTranscript, projectSlug } from './backfill'
import type { Moment } from './backfill'
import type { ActKind } from './protocol'
import { looksOnly, LOOK_TOOL } from './classify'
import { Tracker } from './tracker'

const POLL_MS = 4000
const FLUSH_MS = 100
const BASE_PORT = 7311
const HISTORY_DAYS = 14 // earlier sessions within this many days seed the map
const HISTORY_FILES = 25 // newest transcripts read for that
const HISTORY_CLASSES = 600 // most recently touched files brought onto the map

const tr = new Tracker()
let port = 0
let url = ''
let pushing = false
let connecting = false
let lastOpen = 0 // when the button last opened the view
let lastBudget = -1 // context tokens used at the last budget event
let openLog = '' // set ABYSSAL_EYE_LOG to a file path to record how each attempt to open the view went
let unsupported = false // not Windows: the local server is a PowerShell script
const MAX_FILE = 1_500_000 // source files larger than this are not analysed
let passiveUntil = 0 // another copy of this plugin streams this session until then
const project = { key: '', name: '' }
const me = { session: '', main: 'main', instance: Math.random().toString(36).slice(2, 10) }
const touched = new Map<string, number>() // rel -> when Claude last wrote it, so the poller does not call it a human edit
const thralls: { label: string; task?: string; parent: string; spawn: string; role?: string }[] = [] // subagents asked for, waiting for their first call
/** A subagent summoned to review, verify, inspect, audit or check work is an inspector (drawn as TheyEye).
 *  Conservative: the agent type or description must say so, or the prompt must open with such a verb. */
const INSPECT = /\b(review(er|ing)?|verif(y|ier|ication)|inspect(or|ion)?|audit(or)?|check(er)?|qa|quality assurance|validat(e|or|ion))\b/i
function roleOf(input: unknown): 'inspector' | undefined {
  const type = str(input, 'subagent_type') ?? '', desc = str(input, 'description') ?? ''
  const prompt = (str(input, 'prompt') ?? '').trimStart().split(/\r?\n/)[0]?.slice(0, 160) ?? ''
  if (INSPECT.test(type) || INSPECT.test(desc)) return 'inspector'
  if (/^(please |now |then )?(review|verify|inspect|audit|check|validate)\b/i.test(prompt)) return 'inspector'
  return undefined
}
const actors = new Set<string>()
const openCalls: { id: string; tool: string }[] = [] // tool calls running now, newest last

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'project'
}

function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const arg = (e: unknown, k: string): unknown => (e as Record<string, unknown>)[k]
const str = (e: unknown, k: string): string | undefined => {
  const v = arg(e, k)
  return typeof v === 'string' ? v : undefined
}

function kindOf(tool: string): ActKind {
  switch (tool) {
    case 'Read': return 'read'
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit'
    case 'Write': return 'write'
    case 'Grep': case 'Glob': case 'LS': return 'search'
    case 'Bash': case 'PowerShell': case 'BashOutput': return 'bash'
    case 'Agent': case 'Task': return 'agent'
    case 'WebFetch': case 'WebSearch': return 'web'
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'todo'
    default: return 'tool'
  }
}

function lineOf(text: string, needle: string | undefined): number | undefined {
  if (!needle) return undefined
  const i = text.indexOf(needle)
  if (i < 0) return undefined
  let n = 1
  for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) n++
  return n
}

/** A short description of a call, and whether it only looks. */
function describe(kind: ActKind, tool: string, input: Record<string, unknown>, where: string | undefined): { detail?: string; look: boolean } {
  const command = str(input, 'command')
  const look = kind === 'bash' ? !!command && looksOnly(command) : kind === 'tool' ? LOOK_TOOL.test(tool) : false
  switch (kind) {
    case 'read': case 'edit': case 'write': return { detail: where, look }
    case 'search': return { detail: short((str(input, 'pattern') ?? '') + (where ? ' in ' + where : ''), 80), look }
    case 'bash': return { detail: short(str(input, 'description') ?? command ?? '', 80), look }
    case 'agent': return { detail: short(str(input, 'description') ?? str(input, 'subagent_type') ?? 'a thrall', 40), look }
    case 'web': return { detail: short(str(input, 'url') ?? str(input, 'query') ?? '', 80), look }
    default: return { look }
  }
}

type ToolRun = (input: Record<string, unknown>) => Promise<{ text?: unknown; isError?: boolean; deny?: string }>

let PANE = 'mcp__Claude_Browser__' // the browser pane's tool prefix, found from the session's tool list

// the person's own action that raised these calls, so the permission path (and auto mode) reads them as asked for
const CONSENT_BUTTON = 'The user pressed the "⛧ Abyssal Eye" button above the prompt to open the Abyssal Eye live view of this project in the built-in browser pane.'
const CONSENT_COMMAND = 'The user ran /abyssal-eye to open the Abyssal Eye live view of this project in the built-in browser pane.'

/**
 * Shows the view in the desktop app's browser pane by calling its tools directly (no turn, nothing in the chat):
 * closes any Abyssal Eye tabs, then opens one fresh tab on the current view.
 * Resolves '' when shown, else why not (so the caller can fall back and say so).
 */
async function showInPane(run: ToolRun, names: () => Promise<string[]>): Promise<string> {
  try {
    let all = await names().catch(() => [] as string[])
    // in a fresh session the pane's tools are deferred: load them the way the model does, through ToolSearch
    if (!all.some(n => /Browser__preview_start$/.test(n))) {
      const tools = ['preview_start', 'tabs_context', 'tabs_close'].map(t => PANE + t).join(',')
      await run({ tool: 'ToolSearch', query: 'select:' + tools, max_results: 5 }).catch(() => undefined)
      all = await names().catch(() => all)
    }
    const start = all.find(n => /Browser__preview_start$/.test(n))
    if (start) PANE = start.slice(0, start.length - 'preview_start'.length)
    const ctx = await run({ tool: PANE + 'tabs_context' })
    if (ctx.deny !== undefined) return 'tabs_context denied: ' + ctx.deny
    const text = typeof ctx.text === 'string' ? ctx.text : ''
    const m = /\{[\s\S]*"tabs"[\s\S]*?\]\s*\}/.exec(text)
    const tabs = ((m ? JSON.parse(m[0]) : {}).tabs ?? []) as { tabId: string; origin?: string }[]
    for (const t of tabs) {
      if (t.origin && (t.origin.includes('localhost:' + port) || t.origin.includes('127.0.0.1:' + port))) {
        await run({ tool: PANE + 'tabs_close', tabId: t.tabId }).catch(() => undefined)
      }
    }
    let opened = await run({ tool: PANE + 'preview_start', url })
    // auto mode may give no verdict the first time and asks for the call to be issued again once, as-is
    if (opened.deny !== undefined && /again once/i.test(opened.deny)) opened = await run({ tool: PANE + 'preview_start', url })
    if (opened.deny !== undefined) return 'preview_start denied: ' + opened.deny
    if (opened.isError) return 'preview_start failed: ' + short(String(opened.text ?? ''), 120)
    return ''
  } catch (err) {
    return 'browser pane call failed: ' + short(String(err), 120)
  }
}

/** Reads a source file for analysis, unless it is too large to be worth it (the stat comes first). */
async function readSource($: { fs: { stat: (p: string) => Promise<{ size?: number }>; read: (p: string) => Promise<string> } }, path: string): Promise<string | undefined> {
  const st = await $.fs.stat(path).catch(() => undefined)
  if (!st || (typeof st.size === 'number' && st.size > MAX_FILE)) return undefined
  return $.fs.read(path).catch(() => undefined)
}

function short(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Windows only: the local server is a PowerShell script; elsewhere the plugin says so once and does nothing
    const os = (await $.env.get('OS').catch(() => undefined)) || ''
    if (!/^Windows/i.test(os) && !(await $.env.get('SYSTEMROOT').catch(() => undefined))) {
      unsupported = true
      $.ui.status('⛧ Abyssal Eye needs Windows (PowerShell)')
      return next(e)
    }
    // one view per project: the repository's root, else the session's project root
    const repo = await $.session.repo().catch(() => null)
    tr.root = (repo?.root || (await $.session.root().catch(() => '')) || (await $.session.cwd().catch(() => ''))) || '.'
    const norm = tr.root.replace(/\\/g, '/').replace(/\/$/, '')
    project.name = norm.slice(norm.lastIndexOf('/') + 1) || 'project'
    project.key = slug(project.name) + '-' + (fnv(norm.toLowerCase()) % 46656).toString(36).padStart(3, '0')
    me.session = ((await $.session.id().catch(() => '')) || String(Date.now())).replace(/[^\w-]/g, '').slice(0, 8)
    me.main = me.session + ':main'

    const sessionId = await $.session.id().catch(() => '')
    const cwd = await $.session.cwd().catch(() => '')
    const home = (await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined)) || ''
    const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || home + '/.claude'
    openLog = (await $.env.get('ABYSSAL_EYE_LOG').catch(() => undefined)) || ''
    const dir = config + '/projects/' + projectSlug(cwd)
    // start with the session so far: replay its transcript (and its subagents') into the stream. It runs once the
    // session has started (below), and live events wait behind it so the stream stays in order.
    const replay = async () => {
    const readR = async (p: string) => { tr.replaying = false; try { return await readSource($, p) } finally { tr.replaying = true } }
    const history: { actor: string; moments: Moment[] }[] = []
    if (sessionId) {
      const main = await $.fs.read(dir + '/' + sessionId + '.jsonl').catch(() => undefined)
      if (main) history.push({ actor: me.main, moments: parseTranscript(main) })
      const subDir = dir + '/' + sessionId + '/subagents'
      for (const f of await $.fs.list(subDir).catch(() => [])) {
        const m = /^agent-(.+)\.jsonl$/.exec(f.name)
        if (!m) continue
        const text = await $.fs.read(subDir + '/' + f.name).catch(() => undefined)
        if (text) history.push({ actor: me.session + ':' + m[1], moments: parseTranscript(text) })
      }
    }
    const steps = history.flatMap(h => h.moments.map(m => ({ actor: h.actor, m }))).sort((a, b) => a.m.t - b.m.t).slice(-4000)
    const t0 = steps.length ? steps[0].m.t - 1 : Date.now()
    tr.emit({ type: 'hello', root: tr.root }, t0)
    tr.emit({ type: 'actor', id: me.main, label: 'Claude' }, t0)
    const open = new Map<string, number>()
    // which call summoned which subagent: the Agent call's prompt is the subagent's first prompt
    const summons = new Map<string, { actor: string; id: string; label?: string; role?: string }>()
    for (const { actor, m } of steps) {
      if (m.type === 'use' && kindOf(m.tool) === 'agent') {
        const p = str(m.input, 'prompt')
        if (p) summons.set(p.slice(0, 300), { actor, id: m.id, label: str(m.input, 'description'), role: roleOf(m.input) })
      }
    }
    for (const { actor, m } of steps) {
      if (actor !== me.main && !actors.has(actor)) {
        actors.add(actor)
        const first = history.find(h => h.actor === actor)?.moments.find(x => x.type === 'prompt')
        const task = first?.type === 'prompt' ? first.text : undefined
        const from = task ? summons.get(task.slice(0, 300)) : undefined
        const parent = from?.actor ?? me.main
        tr.emit({ type: 'actor', id: actor, label: short(from?.label ?? task ?? 'thrall', 40), parent, by: parent === me.main ? 'Claude' : 'a thrall',
          ...(task ? { task: short(task, 160) } : {}), ...(from ? { spawn: from.id } : {}), ...(from?.role ? { role: from.role } : {}) }, m.t)
      }
      if (m.type === 'prompt') {
        if (actor === me.main) tr.emit({ type: 'prompt', text: short(m.text, 200), by: 'you', actor: me.main }, m.t)
      } else if (m.type === 'use') {
        const kind = kindOf(m.tool)
        const path = str(m.input, 'file_path') ?? str(m.input, 'notebook_path') ?? str(m.input, 'path')
        const rel = tr.rel(path)
        let text: string | undefined
        if (tr.tracked(rel) && path && kind !== 'bash') {
          text = await readR(path)
          if (text !== undefined && !tr.known(rel)) tr.setFile(rel, text, true, m.t - 1)
        }
        const line = kind === 'read' ? Number(m.input.offset ?? 0) || undefined
          : kind === 'edit' && text !== undefined ? lineOf(text, str(m.input, 'new_string')) : undefined
        const at = kind === 'search' || kind === 'read' || kind === 'edit' || kind === 'write' ? tr.locate(rel, line) : {}
        const { detail, look } = describe(kind, m.tool, m.input, rel ?? path)
        tr.emit({ type: 'act', id: m.id, actor, kind, tool: m.tool, ...at, ...(detail ? { detail } : {}), ...(look ? { look } : {}) }, m.t)
        open.set(m.id, m.t)
      } else if (open.has(m.id)) {
        open.delete(m.id)
        tr.emit({ type: 'act-end', id: m.id, ...(m.failed ? { failed: true } : {}) }, m.t)
      }
    }
    for (const [id, t] of open) tr.emit({ type: 'act-end', id }, t + 1000)
    }

    // the project's structure from earlier sessions: every class touched in the last two weeks comes onto the map
    // (folded and dimmed by age in the view), so a new session does not start from an empty void
    const earlier = async () => {
      const base = projectSlug(tr.root).toLowerCase()
      const now = Date.now()
      const files: { path: string; mtime: number }[] = []
      for (const d of await $.fs.list(config + '/projects').catch(() => [])) {
        if (d.kind !== 'directory' || !d.name.toLowerCase().startsWith(base)) continue
        for (const f of await $.fs.list(config + '/projects/' + d.name).catch(() => [])) {
          if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.name === sessionId + '.jsonl') continue
          if (now - f.mtimeMs > HISTORY_DAYS * 86_400_000 || f.size > 40_000_000) continue
          files.push({ path: config + '/projects/' + d.name + '/' + f.name, mtime: f.mtimeMs })
        }
      }
      files.sort((a, b) => b.mtime - a.mtime)
      const touched = new Map<string, { path: string; first: number; last: number }>()
      for (const f of files.slice(0, HISTORY_FILES)) {
        const text = await $.fs.read(f.path).catch(() => undefined)
        if (!text) continue
        for (const m of parseTranscript(text)) {
          if (m.type !== 'use') continue
          const path = str(m.input, 'file_path') ?? str(m.input, 'notebook_path') ?? str(m.input, 'path')
          const rel = tr.rel(path)
          if (!tr.tracked(rel) || !path) continue
          const t = touched.get(rel)
          if (t) { t.first = Math.min(t.first, m.t); t.last = Math.max(t.last, m.t) } else touched.set(rel, { path, first: m.t, last: m.t })
        }
      }
      const picks = [...touched.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, HISTORY_CLASSES)
      if (!picks.length) return
      const first = Math.min(...picks.map(p => p[1].first))
      tr.emit({ type: 'actor', id: 'history:main', label: 'Earlier sessions' }, first - 2)
      for (const [rel, t] of picks.sort((a, b) => a[1].first - b[1].first)) {
        if (tr.known(rel)) continue
        const text = await readSource($, t.path)
        if (text === undefined) continue
        tr.setFile(rel, text, true, t.first - 1)
        const at = tr.locate(rel)
        if (at.node) tr.emit({ type: 'glance', actor: 'history:main', node: at.node }, t.last)
      }
    }
    tr.hold = true; tr.replaying = true
    void replay().catch(() => undefined).then(() => { tr.replaying = false; tr.release() }).then(() => earlier().catch(() => undefined))

    await $.command.register({ name: 'abyssal-eye', description: 'Open the Abyssal Eye live view in the browser pane (/abyssal-eye browser: system browser)' })

    // one server for every session on the machine: find it, or start it detached so it outlives this session
    const web = $.plugin.root.replace(/[\\/]+$/, '') + '\\web'
    const find = async (): Promise<number> => {
      for (let p = BASE_PORT; p < BASE_PORT + 30; p++) {
        const r = await $.http.fetch('http://127.0.0.1:' + p + '/hello').catch(() => undefined)
        if (r?.ok && r.text.startsWith('abyssal-eye-server 4')) return p
      }
      return 0
    }
    const connect = async () => {
      if (connecting) return
      connecting = true
      try {
        let p = await find()
        if (!p) {
          const ps1 = (web + '\\server.ps1').replace(/'/g, "''"), root = web.replace(/'/g, "''")
          await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
            `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','"${ps1}"','-Root','"${root}"','-Port','${BASE_PORT}'`])
            .catch(() => undefined)
          for (let i = 0; i < 20 && !p; i++) { await $.clock.sleep(500); p = await find() }
        }
        if (p) {
          // a server found after a loss may be a fresh one (even on the same port): replay everything; the server
          // skips the lines it already holds, so a surviving server gets no duplicates
          port = p
          url = 'http://localhost:' + port + '/p/' + project.key + '/'
          tr.sent = 0
          $.ui.status('⛧ Abyssal Eye ' + url)
          $.ui.invalidate('ui.render')
        } else $.ui.status('⛧ Abyssal Eye could not start its server')
      } finally { connecting = false }
    }
    void connect()

    // stream new events to the server
    const q = () => '?p=' + encodeURIComponent(project.key) + '&s=' + encodeURIComponent(me.session) + '&i=' + me.instance + '&name=' + encodeURIComponent(project.name)
    // refused: another copy of the plugin owns this session's stream; try again later in case it went away
    const refused = () => { passiveUntil = Date.now() + 30_000; tr.sent = 0 }
    // the server is gone (refused, timed out, or answering with anything but ok or 409): find or start one and replay
    const dead = () => { port = 0; tr.sent = 0; void connect() }
    $.clock.every(FLUSH_MS, () => {
      try {
        if (!port || pushing || Date.now() < passiveUntil) return
        const batch = tr.takeBatch()
        if (!batch) return
        pushing = true
        const n = batch.split('\n').length
        const from = tr.sent
        $.http.fetch('http://127.0.0.1:' + port + '/push' + q() + '&from=' + from, { method: 'POST', body: batch, headers: { 'content-type': 'text/plain' } })
          .then(r => {
            if (r.ok) { if (tr.sent === from) tr.sent += n }
            else if (r.status === 409) refused()
            else if (r.status === 410) tr.sent = 0 // the server holds less than we thought: replay from the start
            else dead()
          }, dead)
          .finally(() => { pushing = false })
      } catch { pushing = false; dead() }
    })
    $.clock.every(10_000, () => {
      try {
        if (!port) { void connect(); return }
        if (Date.now() < passiveUntil) return
        $.http.fetch('http://127.0.0.1:' + port + '/ping' + q(), { method: 'POST', body: '' })
          .then(r => { if (r.status === 409) refused(); else if (!r.ok) dead() }, dead)
      } catch { dead() }
    })

    // notice changes the human makes to files already on the map
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const now = Date.now()
        for (const rel of [...tr.files.keys()]) {
          const st = await $.fs.stat(tr.abs(rel)).catch(() => undefined)
          const old = tr.mtimes.get(rel)
          if (!st) { if (old !== undefined) { tr.mtimes.delete(rel); tr.setFile(rel, undefined, false) } continue }
          if (old === st.mtimeMs) continue
          tr.mtimes.set(rel, st.mtimeMs)
          if (old === undefined || now - (touched.get(rel) ?? 0) < 6000) continue
          const text = await readSource($, tr.abs(rel))
          if (text === undefined) continue
          const d = tr.setFile(rel, text, false)
          const at = tr.locate(rel)
          if (at.node) tr.emit({ type: 'ext', node: at.node, added: d.added, removed: d.removed })
        }
      })()
    })
    return next(e)
  })

  // open the view: in the desktop app's browser pane when this session has it, else the system browser
  on('command.run', { command: 'abyssal-eye' }, async ($, e) => {
    if (unsupported) return { text: 'Abyssal Eye needs Windows (PowerShell).' }
    if (!url) return { text: 'Abyssal Eye is still waking; try again in a moment.' }
    const why = e.args.trim() === 'browser' ? 'asked for the system browser'
      : await showInPane(input => $.tool.call({ ...input, consent: CONSENT_COMMAND } as never), () => $.tool.list().then(l => l.map(t => t.name)))
    if (openLog) void $.fs.write(openLog, new Date().toISOString() + ' /abyssal-eye: ' + (why || 'opened in the browser pane') + '\n').catch(() => undefined)
    if (why) await $.process.run(['cmd', '/c', 'start', '', url]).catch(() => undefined)
    return { text: 'Abyssal Eye: ' + url + (why ? ' (system browser: ' + why + ')' : '') }
  })

  // one small button above the prompt opens (or refreshes) the view
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!url || e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="open-scope" label="⛧ Abyssal Eye" plain dimColor onPress={() => {
          if (Date.now() - lastOpen < 2000) return
          lastOpen = Date.now()
          void showInPane(input => $.tool.call({ ...input, consent: CONSENT_BUTTON } as never), () => $.tool.list().then(l => l.map(t => t.name))).then(why => {
            if (openLog) void $.fs.write(openLog, new Date().toISOString() + ' button: ' + (why || 'opened in the browser pane') + '\n').catch(() => undefined)
            if (!why) return
            $.ui.status('⛧ Abyssal Eye (system browser: ' + why + ')')
            void $.process.run(['cmd', '/c', 'start', '', url]).catch(() => undefined)
          })
        }} />
      </Box>
    )
  })

  // the turn is over: Claude has nothing more to do until the human speaks again
  on('turn.complete', async ($, e, next) => { tr.emit({ type: 'idle', actor: me.main }); return next(e) }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // agents' messages and harness notices are not the human's task
    if (!isHumanPrompt(e.text)) return next(e)
    tr.emit({ type: 'prompt', text: short(e.text, 200), by: 'you', actor: me.main })
    return next(e)
  })

  // the permission dialog is up: the call it asks about now waits on the human
  on('classic.PermissionRequest', async ($, e, next) => {
    for (let i = openCalls.length - 1; i >= 0; i--) {
      if (openCalls[i].tool === e.tool_name) { tr.emit({ type: 'act-wait', id: openCalls[i].id }); break }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // the model is contemplating between tool calls
  on('turn.step', async function* ($, e, next) {
    // each step is one request to Claude's servers: the conversation so far goes up the wire
    tr.emit({ type: 'transmit', actor: me.main, messages: e.messageCount })
    tr.emit({ type: 'think', actor: me.main, on: true })
    try {
      return yield* next(e)
    } finally {
      tr.emit({ type: 'think', actor: me.main, on: false })
      // the budget the souls stand for: how much of the context window is left after this call
      const u = await $.session.usage().catch(() => undefined)
      if (u && u.context.window > 0) {
        const used = u.context.tokens ?? Math.round((u.context.percent ?? 0) / 100 * u.context.window)
        const rate = u.rateLimits.reduce((m, r) => Math.max(m, r.percentUsed), 0)
        if (used !== lastBudget) {
          lastBudget = used
          tr.emit({ type: 'budget', actor: me.main, used, window: u.context.window, ...(u.rateLimits.length ? { rate } : {}) })
        }
      }
    }
  })

  on('tool.call', async ($, e, next) => {
    const tool = e.tool
    const kind = kindOf(tool)
    const actor = e.agentId ? me.session + ':' + e.agentId : me.main
    if (actor !== me.main && !actors.has(actor)) {
      actors.add(actor)
      // a subagent grows from whoever summoned it, and from the very act that summoned it
      const th = thralls.shift()
      const parent = th?.parent ?? me.main
      tr.emit({ type: 'actor', id: actor, label: th?.label ?? 'thrall', parent, by: parent === me.main ? 'Claude' : 'a thrall',
        ...(th?.task ? { task: th.task } : {}), ...(th?.spawn ? { spawn: th.spawn } : {}), ...(th?.role ? { role: th.role } : {}) })
    }
    const path = str(e, 'file_path') ?? str(e, 'notebook_path') ?? str(e, 'path')
    const rel = tr.rel(path)
    const id = e.tool_use_id ?? tool + Date.now()

    // bring the touched file onto the map (a read or search of a file already on it needs no read)
    let before: string | undefined
    if (tr.tracked(rel) && path && (kind === 'edit' || kind === 'write' || ((kind === 'read' || kind === 'search') && !tr.known(rel)))) {
      before = await readSource($, path)
      if (!tr.known(rel) && before !== undefined) {
        tr.setFile(rel, before, true)
        const st = await $.fs.stat(path).catch(() => undefined)
        if (st) tr.mtimes.set(rel, st.mtimeMs)
      }
    }

    let at: { node?: string; member?: string } = {}
    let detail: string | undefined
    let pending: string[] = []
    if (kind === 'read') {
      at = tr.locate(rel, Number(arg(e, 'offset') ?? 0) || undefined)
      detail = rel ?? path
    } else if (kind === 'edit' || kind === 'write') {
      detail = rel ?? path
      if (tr.tracked(rel)) {
        let after: string | undefined
        if (kind === 'write') { after = str(e, 'content'); at = tr.locate(rel) }
        else if (before !== undefined) {
          const raw = arg(e, 'edits')
          const edits = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [{ old_string: arg(e, 'old_string'), new_string: arg(e, 'new_string'), replace_all: arg(e, 'replace_all') }]
          after = before
          for (const ed of edits) {
            const o = typeof ed.old_string === 'string' ? ed.old_string : ''
            const n = typeof ed.new_string === 'string' ? ed.new_string : ''
            if (o) after = ed.replace_all ? after.split(o).join(n) : after.replace(o, () => n)
          }
          const first = edits[0]?.old_string
          at = tr.locate(rel, lineOf(before, typeof first === 'string' ? first : undefined))
        }
        if (after !== undefined) pending = tr.propose(rel, after)
      }
    } else if (kind === 'search') {
      detail = short((str(e, 'pattern') ?? '') + (path ? ' in ' + (rel ?? path) : ''), 80)
      if (rel) at = tr.locate(rel)
    } else if (kind === 'bash') detail = short(str(e, 'description') ?? str(e, 'command') ?? '', 80)
    else if (kind === 'agent') {
      detail = short(str(e, 'description') ?? str(e, 'subagent_type') ?? 'a thrall', 40)
      const task = str(e, 'prompt')
      const role = roleOf(e)
      thralls.push({ label: detail, parent: actor, spawn: id, ...(task ? { task: short(task, 160) } : {}), ...(role ? { role } : {}) })
    } else if (kind === 'web') detail = short(str(e, 'url') ?? str(e, 'query') ?? '', 80)

    const command = str(e, 'command')
    const look = kind === 'bash' ? !!command && looksOnly(command) : kind === 'tool' ? LOOK_TOOL.test(tool) : false
    tr.emit({ type: 'act', id, actor, kind, tool, ...at, ...(detail ? { detail } : {}), ...(look ? { look } : {}) })
    openCalls.push({ id, tool })
    let ran
    try {
      ran = await next(e)
    } finally {
      const i = openCalls.findIndex(c => c.id === id)
      if (i >= 0) openCalls.splice(i, 1)
    }
    const failed = ran.deny !== undefined || ran.isError === true

    if ((kind === 'edit' || kind === 'write') && tr.tracked(rel) && path) {
      const text = failed ? undefined : await readSource($, path)
      if (text !== undefined) {
        touched.set(rel, Date.now())
        const d = tr.setFile(rel, text, false)
        tr.settle(pending)
        const st = await $.fs.stat(path).catch(() => undefined)
        if (st) tr.mtimes.set(rel, st.mtimeMs)
        const where = at.node ? at : tr.locate(rel)
        tr.emit({ type: 'act-end', id, added: d.added, removed: d.removed, ...where })
      } else {
        tr.settle(pending)
        tr.emit({ type: 'act-end', id, failed: true })
      }
    } else {
      tr.emit({ type: 'act-end', id, ...(failed ? { failed: true } : {}) })
      // glance at what a search turned up, bringing those files onto the map
      if (kind === 'search' && !failed && typeof ran.text === 'string') {
        let n = 0
        for (const ln of ran.text.split('\n')) {
          const m = /^([^:\n]+?\.[A-Za-z]{1,7})(?::|$)/.exec(ln.trim())
          const r = m ? tr.rel(m[1]) : undefined
          if (!r || !isTracked(r)) continue
          if (!tr.known(r)) {
            const text = await readSource($, tr.abs(r))
            if (text === undefined) continue
            tr.setFile(r, text, true)
          }
          const g = tr.locate(r)
          if (g.node) tr.emit({ type: 'glance', actor, node: g.node })
          if (++n >= 8) break
        }
      }
    }
    return ran
  }).catch(($, e, next) => next(e)) // a fault in the scope must never block the tool
}
