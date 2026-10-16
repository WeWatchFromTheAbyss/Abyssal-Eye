// Builds the map from what Claude touches and turns every change into protocol events.
// A file enters the map the first time an act targets it; bindings found then are baseline,
// bindings that appear after an edit are new.
import { analyze, computeEdges, isTracked, lineDelta, resolveKinds } from './analyzer'
import type { FileFacts } from './analyzer'
import type { Ev } from './protocol'

type Body = Ev extends infer E ? (E extends Ev ? Omit<E, 'seq' | 't'> : never) : never

export class Tracker {
  root = ''
  files = new Map<string, FileFacts>()
  mtimes = new Map<string, number>()
  log: Ev[] = []
  sent = 0 // log entries the server has
  private seq = 0
  private nodes = new Map<string, string>() // id -> signature last emitted
  private edges = new Map<string, 'pending' | 'live'>()

  hold = false // while a replay is being queued, live events wait so the stream stays in order
  replaying = false // the replay itself goes straight through
  private held: { body: Body; t: number }[] = []
  emit(body: Body, t = Date.now()): void {
    if (this.hold && !this.replaying) { this.held.push({ body, t }); return }
    this.log.push({ ...body, seq: ++this.seq, t } as Ev)
  }
  /** The replay is queued: the events that waited follow it, in the order they came. */
  release(): void {
    this.hold = false
    const h = this.held; this.held = []
    for (const x of h) this.emit(x.body, x.t)
  }

  rel(path: string | undefined): string | undefined {
    if (!path) return undefined
    const p = path.replace(/\\/g, '/')
    const r = this.root.replace(/\\/g, '/').replace(/\/$/, '')
    if (p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1)
    if (!/^([A-Za-z]:)?\//.test(p)) return p.replace(/^\.\//, '')
    return undefined
  }

  abs(rel: string): string {
    return this.root.replace(/[\\/]$/, '') + '/' + rel
  }

  known(rel: string): boolean {
    return this.files.has(rel)
  }

  tracked(rel: string | undefined): rel is string {
    return !!rel && isTracked(rel)
  }

  /** Put a file's current text into the map. Returns the line delta against what was known. */
  setFile(rel: string, text: string | undefined, baseline: boolean, t = Date.now()): { added: number; removed: number } {
    const old = this.files.get(rel)
    const facts = text === undefined ? undefined : analyze(rel, text)
    const delta = facts ? lineDelta(old?.lineHashes, facts.lineHashes) : { added: 0, removed: old?.lines ?? 0 }
    if (facts) this.files.set(rel, facts); else this.files.delete(rel)
    resolveKinds(this.files)

    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
    const ids = new Set<string>()
    for (const f of this.files.values()) {
      for (const tf of f.types) {
        if (f.rel === rel) ids.add(tf.id)
        const members = tf.members.map(m => (m.callback ? { name: m.name, start: m.start, end: m.end, cb: true } : { name: m.name, start: m.start, end: m.end }))
        const sig = tf.kind + '|' + (tf.end - tf.start) + '|' + members.map(m => m.name + ':' + m.start).join(',')
        if (this.nodes.get(tf.id) === sig) continue
        this.nodes.set(tf.id, sig)
        const fFolder = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '.'
        this.emit({ type: 'node', id: tf.id, name: tf.name, file: f.rel, folder: f.rel === rel ? folder : fFolder, kind: tf.kind, members, lines: tf.end - tf.start + 1 }, t)
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (id.startsWith(rel + '#') && !ids.has(id)) { this.nodes.delete(id); this.emit({ type: 'node-gone', id }, t) }
    }
    this.syncEdges(baseline, t)
    return delta
  }

  private folderOf(id: string): string {
    const file = id.slice(0, id.lastIndexOf('#'))
    return file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'
  }

  private syncEdges(baseline: boolean, t: number): void {
    const now = computeEdges(this.files)
    for (const k of now) {
      if (this.edges.get(k) === 'live') continue
      const [from, to] = k.split('\n')
      this.edges.set(k, 'live')
      this.emit({ type: 'edge', from, to, state: 'live', cross: this.folderOf(from) !== this.folderOf(to), ...(baseline ? { baseline: true } : {}) }, t)
    }
    for (const [k, s] of this.edges) {
      if (s !== 'live' || now.has(k)) continue
      const [from, to] = k.split('\n')
      this.edges.delete(k)
      this.emit({ type: 'edge', from, to, state: 'gone', cross: this.folderOf(from) !== this.folderOf(to) }, t)
    }
  }

  /** The bindings an edit would tie, shown as pending while the human decides. */
  propose(rel: string, after: string): string[] {
    const trial = new Map(this.files)
    trial.set(rel, analyze(rel, after))
    resolveKinds(trial)
    const out: string[] = []
    for (const k of computeEdges(trial)) {
      if (this.edges.has(k)) continue
      const [from, to] = k.split('\n')
      // only bindings between types already on the map, or the edited file's own
      this.edges.set(k, 'pending')
      out.push(k)
      this.emit({ type: 'edge', from, to, state: 'pending', cross: this.folderOf(from) !== this.folderOf(to) })
    }
    return out
  }

  /** Withdraw pending bindings the edit did not tie (denied, failed, or changed). */
  settle(pending: string[]): void {
    for (const k of pending) {
      if (this.edges.get(k) !== 'pending') continue
      this.edges.delete(k)
      const [from, to] = k.split('\n')
      this.emit({ type: 'edge', from, to, state: 'gone', cross: this.folderOf(from) !== this.folderOf(to) })
    }
  }

  /** The type and member at a 1-based line of a known file. */
  locate(rel: string | undefined, line?: number): { node?: string; member?: string } {
    const f = rel ? this.files.get(rel) : undefined
    if (!f || !f.types.length) return {}
    let best = f.types[0]
    if (!line) return { node: best.id }
    let span = Infinity
    for (const tf of f.types) if (tf.start <= line && line <= tf.end && tf.end - tf.start < span) { best = tf; span = tf.end - tf.start }
    const m = best.members.find(mm => mm.start <= line && line <= mm.end)
    return m ? { node: best.id, member: m.name } : { node: best.id }
  }

  /** JSON lines of everything the server does not have yet; the server numbers them. */
  takeBatch(): string | undefined {
    if (this.sent >= this.log.length) return undefined
    const part = this.log.slice(this.sent, this.sent + 2000)
    return part.map(e => JSON.stringify({ ...e, seq: undefined })).join('\n')
  }
}
