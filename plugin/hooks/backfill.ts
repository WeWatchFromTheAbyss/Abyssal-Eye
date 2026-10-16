// Reads a session transcript (JSON lines) back into the moments the Abyssal Eye cares about,
// so a view opened mid-session starts with an overview of the session so far.

export type Moment =
  | { t: number; type: 'prompt'; text: string }
  | { t: number; type: 'use'; id: string; tool: string; input: Record<string, unknown> }
  | { t: number; type: 'result'; id: string; failed: boolean }

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean }

// prompts the human did not type: harness notices, command echoes, messages from agents and plugins
const NOT_HUMAN = /^\s*(<|Caveat:|Another Claude session sent a message|The \S+ plugin sent a message|(Open|Show) the Abyssal Eye live view|\[Request interrupted)/

export function parseTranscript(text: string): Moment[] {
  const out: Moment[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let o: { type?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown } }
    try { o = JSON.parse(line) } catch { continue }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isMeta) continue
    const t = Date.parse(o.timestamp ?? '')
    if (!Number.isFinite(t)) continue
    const content = o.message?.content
    if (o.type === 'user') {
      if (typeof content === 'string') {
        if (!NOT_HUMAN.test(content)) out.push({ t, type: 'prompt', text: content })
        continue
      }
      if (!Array.isArray(content)) continue
      let said = ''
      for (const b of content as Block[]) {
        if (b.type === 'tool_result' && b.tool_use_id) out.push({ t, type: 'result', id: b.tool_use_id, failed: b.is_error === true })
        else if (b.type === 'text' && b.text) said += (said ? '\n' : '') + b.text
      }
      if (said && !NOT_HUMAN.test(said)) out.push({ t, type: 'prompt', text: said })
    } else if (Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b.type === 'tool_use' && b.id && b.name) {
          out.push({ t, type: 'use', id: b.id, tool: b.name, input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown> })
        }
      }
    }
  }
  return out
}

/** The folder name Claude Code keeps a project's transcripts under. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** Whether a prompt is the human's own words rather than a notice, an echo or another agent's message. */
export function isHumanPrompt(text: string): boolean {
  return !NOT_HUMAN.test(text)
}
