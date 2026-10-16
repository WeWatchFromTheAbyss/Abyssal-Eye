// The stream the plugin sends to the view page. Every event carries seq (1, 2, 3, ...) and t (ms since epoch).
// The page folds events with t <= T to reconstruct any moment, so the stream is the whole history of the session.
// The map is built only from what Claude touches: a file enters the map the first time an act targets it.
// One stream per project: every Claude session in the project feeds it. The server assigns seq; actor ids are
// "<session>:main" for a session's Claude (a top-level actor, no parent) and "<session>:<agentId>" for its subagents.

export type NodeKind =
  | 'class' | 'behaviour' | 'interface' | 'struct' | 'enum' | 'static' | 'record' | 'script' | 'shader' | 'function'

export type ActKind = 'read' | 'search' | 'edit' | 'write' | 'bash' | 'agent' | 'web' | 'todo' | 'tool'

export type Member = { name: string; start: number; end: number; cb?: boolean } // cb: Unity message such as Update

export type Ev = { seq: number; t: number } & (
  // first event of a stream; root is the project folder
  | { type: 'hello'; root: string }
  // a type (class, struct, module of functions...) appeared or changed. Upsert by id. folder = its directory, relative.
  | { type: 'node'; id: string; name: string; file: string; folder: string; kind: NodeKind; members: Member[]; lines: number }
  | { type: 'node-gone'; id: string }
  // a binding between two types (from references to). state: pending = an edit awaiting the human's approval would
  // create it; live = it exists (new when born after hello); gone = removed. cross = the two types live in different folders.
  | { type: 'edge'; from: string; to: string; state: 'pending' | 'live' | 'gone'; cross: boolean; baseline?: boolean } // baseline: existed before Claude touched it (not "new")
  // an actor: 'main' is Claude, others are subagents ("thralls") tethered to parent
  // task: what it was asked to do (a subagent's prompt excerpt); by: who gave it
  // role: 'inspector' for a subagent summoned to review, verify, inspect, audit or check (derived from its agent type,
  // description and the first line of its prompt); the view draws it as TheyEye, and as a pyramid when absent
  | { type: 'actor'; id: string; label: string; parent?: string; task?: string; by?: string; spawn?: string; role?: 'inspector' } // spawn: id of the agent act that summoned it
  // a tool call began. node/member: the exact type and method it targets, when known.
  // look: the act only looks (a read-only shell command, a lookup tool), so it is drawn as an eye stalk, never a tentacle.
  | { type: 'act'; id: string; actor: string; kind: ActKind; tool: string; node?: string; member?: string; detail?: string; look?: boolean }
  | { type: 'act-wait'; id: string } // the call is waiting on the human's permission
  | { type: 'act-end'; id: string; failed?: boolean; added?: number; removed?: number; node?: string; member?: string }
  // the model is thinking (between tool calls)
  | { type: 'think'; actor: string; on: boolean }
  // the session's turn ended: Claude is done and waits for the human (not emitted while a permission dialog is up)
  | { type: 'idle'; actor: string }
  // a request went to Claude's servers (one model call); messages = how many messages it carried
  | { type: 'transmit'; actor: string; messages: number }
  // the session's token budget: context tokens used of the window (left = window - used, drops back after compaction);
  // rate: highest percent used across the account's rate limits, when known
  | { type: 'budget'; actor: string; used: number; window: number; rate?: number }
  // a search turned up this type: a brief glance
  | { type: 'glance'; actor: string; node: string }
  // the human edited a known file outside Claude
  | { type: 'ext'; node: string; added: number; removed: number }
  | { type: 'prompt'; text: string; by?: string; actor?: string } // by: who asked, "you" when absent; actor: the session's top-level actor
)
