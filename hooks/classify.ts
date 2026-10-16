// Whether an act only looks (drawn as an eye stalk) or changes something (drawn as a tentacle).

// shell commands that only look: every segment of the pipeline starts with one of these, and nothing is redirected into a file
const LOOK_CMDS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'find', 'tree', 'wc', 'pwd', 'which', 'where',
  'whereis', 'echo', 'printf', 'stat', 'file', 'du', 'df', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'jq', 'awk', 'sed', 'curl',
  'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-item', 'test-path', 'resolve-path', 'get-location',
  'measure-object', 'select-object', 'where-object', 'format-table', 'format-list', 'out-string', 'get-process', 'get-ciminstance',
])
const LOOK_GIT = /^git\s+(status|log|diff|show|branch|remote|rev-parse|ls-files|blame|describe|tag\s*$|config\s+--get)/
export const LOOK_TOOL = /(^|__|_)(get|list|read|search|find|fetch|query|view|describe|show|status|grep|glob|screenshot|inspect|context|logs?|tabs)(_|$)|^(ToolSearch|TaskOutput|TaskList|TaskGet|ReadNotifications|ListAgents)$/i

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

