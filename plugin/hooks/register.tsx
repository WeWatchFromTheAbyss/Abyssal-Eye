import type { PromptSubmitArgs, PromptSubmitResult, Register } from 'claude-code'

import { isTracked } from './analyzer'
import { isHumanPrompt, parseTranscript, projectSlug } from './backfill'
import type { Moment } from './backfill'
import type { ActKind } from './protocol'
import { looksOnly, LOOK_TOOL } from './classify'
import { Tracker } from './tracker'
import { isNewer, versionFromManifest } from './update'

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
let unsupported = false // no perl on this machine: the local server cannot run
let perlExe = 'perl' // the perl that runs the server (Git for Windows' on Windows, the system one elsewhere)
let platform: 'win32' | 'darwin' | 'linux' = 'win32' // where this runs: the server script and the browser opener follow it
/** The system browser on this platform, with the address given. */
function openExternal($: { process: { run: (argv: readonly string[]) => Promise<unknown> } }, u: string): Promise<unknown> {
  const argv = platform === 'win32' ? ['cmd', '/c', 'start', '', u] : platform === 'darwin' ? ['open', u] : ['xdg-open', u]
  return $.process.run(argv).catch(() => undefined)
}
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

let PANE = 'mcp__Claude_Browser__' // the browser pane's tool prefix, found from the session's tool list
const OPEN_TEXT = '⛧ Open the Abyssal Eye' // the one line the chat shows for an open; the map's filter hides it
let pendingOpen = '' // the instructions the next open prompt carries as hidden context
let openWatch = 0 // when the open turn started; the plugin falls back to the system browser if no view shows up
let reconnect: (() => Promise<void>) | null = null // the session's connect(), for an open that finds the server gone
type SeenState = { alive: number; visible: number; current: number; latest: number }
type Http = { fetch: (url: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; text: string }> }
/** What the server knows of the view's pages for this project: which are alive (a heartbeat within 10 s), shown, current. */
async function seenState($: { http: Http }): Promise<SeenState> {
  const none = { alive: 0, visible: 0, current: 0, latest: 0 }
  if (!port) return none
  const r = await $.http.fetch('http://127.0.0.1:' + port + '/seen?p=' + encodeURIComponent(project.key)).catch(() => undefined)
  if (!r?.ok) return none
  try { const j = JSON.parse(r.text) as Partial<SeenState>; return { alive: j.alive ?? 0, visible: j.visible ?? 0, current: j.current ?? 0, latest: j.latest ?? 0 } } catch { return none }
}
/** The steps for the model, as few as the view's state allows. AE tabs are the pane's tabs on this machine's view ports. */
/** The steps for the model: the call that shows the view comes first, cleanup only when an old tab may exist. Short, and no reasoning asked for. */
function openSteps(st: SeenState, deferred: boolean): string {
  const u = url + '?pane=1'
  const first = deferred
    ? 'Call ToolSearch with query select:' + PANE + 'preview_start,' + PANE + 'tabs_context,' + PANE + 'tabs_close and, in your very next step with no commentary, ' + PANE + 'preview_start with url ' + u + '. '
    : 'Call ' + PANE + 'preview_start with url ' + u + '. '
  const cleanup = st.alive >= 1
    ? 'Then call ' + PANE + 'tabs_context and ' + PANE + 'tabs_close on every other tab whose origin is http://localhost or http://127.0.0.1 on a port from 7311 to 7340, keeping only the tabId preview_start returned; never touch a tab of any other origin. '
    : ''
  const fail = 'If preview_start fails, call it once more; if it fails again reply with the one line "The pane did not open." and nothing else. '
  return 'Act immediately: do not think, plan or explain. ' + first + cleanup + fail + 'Make no other tool calls. Reply with exactly the single character ⛧ and no other text.'
}

let opening = false // the button is working: from the press until a displayed view reports in
let openWarned = false // the minimized-pane warning was shown for this open
// the update check: once a day the published manifest is fetched (a plain GET, nothing about the person in it) and
// compared with the installed version; a newer one shows a status and an Update button; nothing updates unclicked
const UPDATE_URL = 'https://raw.githubusercontent.com/WeWatchFromTheAbyss/Abyssal-Eye/main/plugin/.claude-plugin/plugin.json'
let updateAvail = '' // a newer published version, when known
let updating = false // the update commands are running
let claudeExe = 'claude' // the claude executable the update commands run through
let turnBusy = false // Claude is mid-turn on the main loop: an open prompt would queue behind it
let setOpening: (b: boolean) => void = b => { opening = b }
/**
 * Opens the view in the desktop app's browser pane with at most one user-visible step. What needs no model turn is
 * done without one: a live, current, displayed view is left alone (a status says so); a displayed page that is stale
 * or frozen is told to reload through its next heartbeat answer. Otherwise the press (or /abyssal-eye) submits a
 * single prompt in the person's own words that asks the model to call the pane's tools, so in every permission
 * mode the calls are the user's own request (no permission hook, no setting touched). The chat shows only the short
 * line; the steps ride along as context the person never sees (attached by this plugin's own prompt.submit hook),
 * with the call that shows the view first, and the model is asked to answer with one glyph. The server is checked
 * first (and found again if it moved). Resolves '' when handled, else why not (no pane here, no server, a refusal),
 * so the caller falls back to the system browser.
 */
async function openInPane($: { http: Http; ui: { status: (s: string) => void; toast: (s: string, o?: { timeoutMs?: number }) => void }; tool: { list: () => Promise<{ name: string }[]> }; prompt: { submit: (a: PromptSubmitArgs) => Promise<PromptSubmitResult> } }): Promise<string> {
  // a repeated press while an open is pending adds nothing (no second prompt): the status says so
  if (opening) { $.ui.status('⛧ still summoning the Eye…'); return '' }
  setOpening(true)
  $.ui.status('⛧ The abyss awaits…'); $.ui.toast('⛧ The abyss awaits…', { timeoutMs: 2500 })
  // the server first: a lost or moved server is found again before the address is built
  const ok = port ? await $.http.fetch('http://127.0.0.1:' + port + '/hello').then(r => r.ok, () => false) : false
  if (!ok) { port = 0; if (reconnect) await reconnect() }
  if (!port || !url) { setOpening(false); return 'the local server is not running' }
  const st = await seenState($)
  // nothing to do: the view is up, current and displayed
  if (st.alive === 1 && st.visible >= 1 && st.current >= 1) { setOpening(false); $.ui.status('⛧ Abyssal Eye is open'); return '' }
  // a displayed page that is stale reloads itself when told through its next heartbeat: no model needed
  if (st.alive === 1 && st.visible >= 1) {
    await $.http.fetch('http://127.0.0.1:' + port + '/seen?p=' + encodeURIComponent(project.key) + '&reload=1').catch(() => undefined)
    openWatch = Date.now()
    $.ui.status('⛧ Abyssal Eye is refreshing')
    return ''
  }
  const names = await $.tool.list().then(l => l.map(t => t.name)).catch(() => [] as string[])
  const start = names.find(n => /Browser__preview_start$/.test(n))
  if (start) PANE = start.slice(0, start.length - 'preview_start'.length)
  // in a fresh session the pane's tools are deferred behind ToolSearch; without either there is no pane
  if (!start && !names.includes('ToolSearch')) { setOpening(false); return 'no browser pane in this session' }
  pendingOpen = 'The user pressed the Abyssal Eye button. ' + openSteps(st, !start)
  if (turnBusy) $.ui.status('⛧ the Eye waits for Claude to finish (↗ Open in browser is instant)')
  const r = await $.prompt.submit({ text: OPEN_TEXT, asUser: true }).catch(err => ({ drop: String(err) }) as PromptSubmitResult)
  if (r && 'drop' in r && r.drop) { pendingOpen = ''; setOpening(false); return 'prompt refused: ' + String(r.drop) }
  return ''
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
    // the platform decides where perl is and how the browser opens; the server is the same perl script everywhere
    const nodePlatform = (globalThis as { process?: { platform?: string } }).process?.platform
    const osEnv = (await $.env.get('OS').catch(() => undefined)) || ''
    const win = nodePlatform ? nodePlatform === 'win32' : (/^Windows/i.test(osEnv) || !!(await $.env.get('SYSTEMROOT').catch(() => undefined)))
    if (win) platform = 'win32'
    else if (nodePlatform === 'darwin' || nodePlatform === 'linux') platform = nodePlatform
    else { const u = await $.process.run(['/bin/sh', '-c', 'uname -s']).catch(() => undefined); platform = u && /darwin/i.test(u.stdout) ? 'darwin' : 'linux' }
    // perl: on Windows the one Git for Windows ships (Claude Code needs Git for Windows), found from
    // CLAUDE_CODE_GIT_BASH_PATH or the usual install folders, else on the PATH; elsewhere the system perl
    const exists = async (p: string) => !!(await $.fs.stat(p).catch(() => undefined))
    let found = ''
    if (platform === 'win32') {
      const bash = (await $.env.get('CLAUDE_CODE_GIT_BASH_PATH').catch(() => undefined)) || ''
      const candidates: string[] = []
      const m = /^(.*?)[\\/](?:usr[\\/])?bin[\\/]bash\.exe$/i.exec(bash)
      if (m) candidates.push(m[1] + '\\usr\\bin\\perl.exe')
      const local = (await $.env.get('LOCALAPPDATA').catch(() => undefined)) || ''
      candidates.push('C:\\Program Files\\Git\\usr\\bin\\perl.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\perl.exe', ...(local ? [local + '\\Programs\\Git\\usr\\bin\\perl.exe'] : []))
      for (const c of candidates) { if (await exists(c)) { found = c; break } }
      if (!found && await $.process.run(['perl', '-e', '1']).then(r => r.exitCode === 0, () => false)) found = 'perl'
    } else if (await $.process.run(['/bin/sh', '-c', 'command -v perl']).then(r => r.exitCode === 0, () => false)) found = 'perl'
    if (!found) {
      unsupported = true
      $.ui.status(platform === 'win32' ? '⛧ Abyssal Eye needs perl (Git for Windows provides it)' : '⛧ Abyssal Eye needs perl 5 (the system perl on macOS, the perl package on Linux)')
      return next(e)
    }
    perlExe = found
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
    const web = $.plugin.root.replace(/[\\/]+$/, '') + (platform === 'win32' ? '\\web' : '/web')
    const find = async (): Promise<number> => {
      for (let p = BASE_PORT; p < BASE_PORT + 30; p++) {
        const r = await $.http.fetch('http://127.0.0.1:' + p + '/hello').catch(() => undefined)
        if (r?.ok && r.text.startsWith('abyssal-eye-server 5')) return p
      }
      return 0
    }
    const connect = async () => {
      if (connecting) return
      connecting = true
      try {
        let p = await find()
        if (!p) {
          // the perl server, started as a daemon: the call returns at once and the server outlives this session
          const sep = platform === 'win32' ? '\\' : '/'
          await $.process.run([perlExe, web + sep + 'server.pl', '--root', web, '--port', String(BASE_PORT), '--daemon']).catch(() => undefined)
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
    reconnect = connect
    void connect()

    // the daily update check, off the critical path and silent when anything fails; ABYSSAL_EYE_NO_UPDATE_CHECK=1
    // (or Claude Code's own non-essential traffic switch) turns it off
    const checkUpdate = async () => {
      if ((await $.env.get('ABYSSAL_EYE_NO_UPDATE_CHECK').catch(() => undefined)) === '1') return
      if (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC').catch(() => undefined)) return
      const envExe = await $.env.get('CLAUDE_CODE_EXECUTABLE').catch(() => undefined)
      const execPath = (globalThis as { process?: { execPath?: string } }).process?.execPath
      claudeExe = envExe || (execPath && /claude/i.test(execPath) ? execPath : 'claude')
      const installed = versionFromManifest(await $.fs.read($.plugin.root.replace(/[\\/]+$/, '') + '/.claude-plugin/plugin.json').catch(() => '')) || ''
      if (!installed) return
      const cacheFile = config + '/abyssal-eye-update.json'
      let cache: { checkedAt?: number; latest?: string } = {}
      try { cache = JSON.parse(await $.fs.read(cacheFile).catch(() => '{}')) as typeof cache } catch { cache = {} }
      let latest = typeof cache.latest === 'string' ? cache.latest : ''
      if (typeof cache.checkedAt !== 'number' || Date.now() - cache.checkedAt > 86_400_000) {
        const r = await Promise.race([$.http.fetch(UPDATE_URL).catch(() => undefined), $.clock.sleep(6000).then(() => undefined)])
        latest = r && r.ok ? versionFromManifest(r.text) || '' : ''
        await $.fs.write(cacheFile, JSON.stringify({ checkedAt: Date.now(), latest })).catch(() => undefined)
      }
      if (!latest || !isNewer(latest, installed)) return
      updateAvail = latest
      await $.clock.sleep(4000) // after the server's own status line
      $.ui.status('⛧ Abyssal Eye ' + latest + ' is available')
      $.ui.invalidate('ui.render')
    }
    void checkUpdate().catch(() => undefined)

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
    setOpening = b => { if (opening !== b) { opening = b; $.ui.invalidate('ui.render') } }
    $.clock.every(2000, () => {
      if (!openWatch) { openWarned = false; return }
      void seenState($).then(st => {
        if (!openWatch) return
        if (st.visible >= 1 && st.latest >= openWatch) { openWatch = 0; setOpening(false); $.ui.status('⛧ The Eye is open'); $.ui.toast('⛧ The Eye is open', { timeoutMs: 2500 }); return }
        // the page is alive but not shown: the pane is minimized or behind another tab; say so once, ask for nothing more
        if (st.alive >= 1 && st.latest >= openWatch && Date.now() - openWatch > 3000 && !openWarned) {
          openWarned = true
          const m = '⛧ The Eye is open, but the browser pane is minimized. Show the pane, or press ↗ Open in browser.'
          $.ui.status(m); $.ui.toast(m, { timeoutMs: 6000 })
        }
        if (Date.now() - openWatch > 30_000) {
          openWatch = 0; setOpening(false)
          if (st.alive >= 1) return
          $.ui.status('⛧ Abyssal Eye (system browser: the pane showed no view)')
          void openExternal($, url)
        }
      })
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
    if (unsupported) return { text: 'Abyssal Eye needs perl (Git for Windows provides it on Windows; macOS ships it).' }
    if (!url) return { text: 'Abyssal Eye is still waking; try again in a moment.' }
    const why = e.args.trim() === 'browser' ? 'asked for the system browser' : await openInPane($)
    if (openLog) void $.fs.write(openLog, new Date().toISOString() + ' /abyssal-eye: ' + (why || 'asked the model to open the browser pane') + '\n').catch(() => undefined)
    if (why) await openExternal($, url)
    return { text: 'Abyssal Eye: ' + url + (why ? ' (system browser: ' + why + ')' : ' (opening in the browser pane)') }
  })

  // two small buttons above the prompt: the view in the browser pane, or in the system browser
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!url || e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Button key="open-scope" label={opening ? '⛧ summoning…' : '⛧ Abyssal Eye'} plain dimColor onPress={() => {
          if (Date.now() - lastOpen < 2000) return
          lastOpen = Date.now()
          void openInPane($).then(why => {
            if (openLog) void $.fs.write(openLog, new Date().toISOString() + ' button: ' + (why || 'asked the model to open the browser pane') + '\n').catch(() => undefined)
            if (!why) return
            $.ui.status('⛧ Abyssal Eye (system browser: ' + why + ')')
            void openExternal($, url)
          })
        }} />
        <Button key="open-external" label="↗ Open in browser" plain dimColor onPress={() => {
          if (Date.now() - lastOpen < 2000) return
          lastOpen = Date.now()
          void openExternal($, url)
        }} />
        {updateAvail ? <Button key="update" label={updating ? '⛧ updating…' : '⬆ Update to ' + updateAvail} plain dimColor onPress={() => {
          // the only path that updates: the person's click runs the marketplace refresh, then the plugin update
          if (updating) return
          updating = true; $.ui.invalidate('ui.render')
          void (async () => {
            const fail = (e: unknown) => ({ exitCode: 1, stdout: '', stderr: String(e) })
            const a = await $.process.run([claudeExe, 'plugin', 'marketplace', 'update', 'abyssal-eye']).catch(fail)
            const b = a.exitCode === 0 ? await $.process.run([claudeExe, 'plugin', 'update', 'abyssal-eye-eye']).catch(fail) : a
            updating = false
            if (b.exitCode === 0) { $.ui.status('⛧ updated to ' + updateAvail + ', restart Claude Code to apply'); updateAvail = '' }
            else $.ui.status('⛧ update failed: ' + short(b.stderr || b.stdout || 'unknown error', 120))
            $.ui.invalidate('ui.render')
          })()
        }} /> : null}
      </Box>
    )
  })

  // the open prompt this plugin submitted carries its instructions as context the person never sees
  on('prompt.submit', async ($, e, next) => {
    if (openLog) void $.fs.write(openLog, new Date().toISOString() + ' prompt.submit: origin ' + JSON.stringify(e.origin) + ' text ' + JSON.stringify(e.text.slice(0, 60)) + ' pending ' + (pendingOpen ? 'yes' : 'no') + '\n').catch(() => undefined)
    if (!pendingOpen || e.text !== OPEN_TEXT || e.origin.kind !== 'plugin') return next(e)
    const c = pendingOpen; pendingOpen = ''
    return next({ ...e, context: [...(e.context ?? []), c] })
  }).catch(($, e, next) => next(e))

  // the standing note in the conversation's context: what the open line means, so any turn knows what to do with it
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    for (let i = 0; i < 30 && !url && !unsupported; i++) await $.clock.sleep(100)
    if (!url) return r
    return { ...r, blocks: [...r.blocks, { name: 'abyssalEye', text: 'The Abyssal Eye plugin adds a button that sends the message "' + OPEN_TEXT + '". When the user\'s message is exactly that line: ' + openSteps() }] }
  }).catch(($, e, next) => next(e))

  // the turn is over: Claude has nothing more to do until the human speaks again
  on('turn.complete', async ($, e, next) => { if (!e.agentId) turnBusy = false; tr.emit({ type: 'idle', actor: me.main }); return next(e) }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // the open turn began: if no displayed view reports in within 30 s, the system browser gets it instead
    if (!e.agentId) turnBusy = true
    if (e.text === OPEN_TEXT && !e.agentId) openWatch = Date.now()
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
