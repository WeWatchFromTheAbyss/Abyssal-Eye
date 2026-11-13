// What kind of act a tool call is, a short description of it, and whether it only looks (drawn as an eye stalk)
// or changes something (drawn as a tentacle).
import type { ActKind } from './protocol'

// shell commands that only look: every segment of the pipeline starts with one of these, and nothing is redirected into a file
const LOOK_CMDS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'find', 'tree', 'wc', 'pwd', 'which', 'where',
  'whereis', 'echo', 'printf', 'stat', 'file', 'du', 'df', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'jq', 'awk', 'sed', 'curl',
  'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-item', 'test-path', 'resolve-path', 'get-location',
  'measure-object', 'select-object', 'where-object', 'format-table', 'format-list', 'out-string', 'get-process', 'get-ciminstance',
])
const LOOK_GIT = /^git\s+(status|log|diff|show|branch|remote|rev-parse|ls-files|blame|describe|tag\s*$|config\s+--get)/
// tools that only look: snake_case verbs anywhere in an MCP tool's name, CamelCase built-ins that begin with a looking
// verb, and the built-ins that wait, ask or watch
export const LOOK_TOOL = new RegExp(
  '(^|__|_)(get|list|read|search|find|fetch|query|view|describe|show|status|grep|glob|screenshot|inspect|context|logs?|tabs)(_|$)' +
  '|^(Get|List|Read|Search|Find|Fetch|Query|View|Describe|Show)[A-Z]' +
  '|^(ToolSearch|TaskOutput|TaskList|TaskGet|ReadNotifications|ListAgents|Poll|Monitor|LSP|AskUserQuestion|WaitForMcpServers)$',
)

// tools that drive a browser or the desktop: the desktop app's browser pane, Claude in Chrome, computer use
const PANE_TOOL = /^mcp__(?:[A-Za-z0-9-]+__)?Claude_Browser__(.+)$/
const CHROME_TOOL = /^mcp__claude-in-chrome__(.+)$/
const COMPUTER_TOOL = /^mcp__(?:remote-devices__computer_|computer-use__)(.+)$/
const WEB_LOOK = /^(read_page|find|get_page_text|tabs_context(_mcp)?|read_console_messages|read_network_requests|preview_list|preview_logs|list_connected_browsers|shortcuts_list|screenshot|zoom|scroll|hover|wait|cursor_position|list_granted_applications|read_clipboard)$/
const ACTION_LOOK = /^(screenshot|zoom|scroll|scroll_to|hover|wait)$/

/** A named field of a tool call's input, when it is text (every tool has its own input shape). */
export function field(input: unknown, key: string): string | undefined {
  const v = input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : undefined
}

function brief(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** The part of a browser or desktop tool's name after its server prefix, or undefined for any other tool. */
export function webTool(tool: string): string | undefined {
  const m = PANE_TOOL.exec(tool) ?? CHROME_TOOL.exec(tool) ?? COMPUTER_TOOL.exec(tool)
  return m ? m[1] : undefined
}

/** The kind of act a tool call is. Old tool names stay, so an old transcript still replays. */
export function kindOf(tool: string): ActKind {
  switch (tool) {
    case 'Read': case 'LSP': return 'read'
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit'
    case 'Write': return 'write'
    case 'Grep': case 'Glob': case 'LS': return 'search'
    case 'Bash': case 'PowerShell': case 'BashOutput': return 'bash'
    case 'Agent': case 'Task': case 'Workflow': return 'agent'
    case 'WebFetch': case 'WebSearch': return 'web'
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'todo'
  }
  if (/(^|__|_)memory_write$/i.test(tool)) return 'edit'
  if (webTool(tool) !== undefined) return 'web'
  return 'tool'
}

export function looksOnly(raw: string): boolean {
  const cmd = raw.replace(/\d?>\s*(\/dev\/null|\$null|nul)\b/gi, '').replace(/2>&1/g, '')
  if (/(^|[^>&0-9])>(?!&)|\btee\b|\s-i\b|Set-Content|Out-File|Add-Content/i.test(cmd)) return false
  return cmd.split(/&&|\|\||;|\|/).every(seg => {
    const s = seg.trim().replace(/^(\w+=\S*\s+)+/, '')
    if (!s) return true
    if (s.startsWith('git ')) return LOOK_GIT.test(s)
    if (s.startsWith('sed ')) return !/\s-i/.test(s)
    if (s.startsWith('curl ')) return !/\s(-X\s*(POST|PUT|DELETE|PATCH)|-d|--data)/i.test(s)
    const w = (s.split(/\s+/)[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '')
    return LOOK_CMDS.has(w)
  })
}

/** A short description of a call, and whether it only looks. `where` is the file it names, relative when known. */
export function describe(kind: ActKind, tool: string, input: unknown, where: string | undefined): { detail?: string; look: boolean } {
  const command = field(input, 'command')
  switch (kind) {
    case 'read': return { detail: where, look: false }
    case 'edit': case 'write': return { detail: where ?? field(input, 'key') ?? field(input, 'name'), look: false }
    case 'search': return { detail: brief((field(input, 'pattern') ?? '') + (where ? ' in ' + where : ''), 80), look: false }
    case 'bash': return { detail: brief(field(input, 'description') ?? command ?? '', 80), look: !!command && looksOnly(command) }
    case 'agent': return { detail: brief(field(input, 'description') ?? field(input, 'subagent_type') ?? field(input, 'name') ?? 'a thrall', 40), look: false }
    case 'web': {
      const part = webTool(tool)
      const action = field(input, 'action')
      const detail = field(input, 'url') ?? field(input, 'query') ?? (action ? action + (field(input, 'text') ? ' ' + field(input, 'text') : '') : part)
      const look = part === undefined ? false : part === 'computer' ? !!action && ACTION_LOOK.test(action) : WEB_LOOK.test(part)
      return { detail: detail ? brief(detail, 80) : undefined, look }
    }
    case 'tool': {
      // a message names who it goes to, so the view can turn the sender's eye to the listener
      const detail = (tool === 'SendMessage' ? field(input, 'to') : undefined) ?? field(input, 'skill') ?? field(input, 'query') ?? field(input, 'description') ?? field(input, 'url')
      return { detail: detail ? brief(detail, 80) : undefined, look: LOOK_TOOL.test(tool) }
    }
    default: return { look: false }
  }
}
