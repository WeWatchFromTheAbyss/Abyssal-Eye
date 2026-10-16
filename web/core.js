// Abyssal Eye live view, part 1 of 4: settings, event sources (server poll and demo), history fold, visual state.
// The four parts are plain scripts loaded in order by index.html and share one scope: core, layout, draw, main.
'use strict'

// ---------- palette and constants ----------

const VOID = '#1C2321', BONE = '#DCD2B0', PARCH = '#B5AA86', ASH = '#7E7A68', DIM = '#4B4A3F'
const BRASS = '#A8843A', BLOOD = '#C1121F', EMBER = '#E0662A', CYAN = '#4FB3BF', GREEN = '#7CE37C', VIOLET = '#9B5DE5'
const SULFUR = '#E9C46A', SCRY = '#6FA8DC', THRALL = '#D08CFF', FLESH = '#101614', FLESHLINE = '#CFC6A2', PAGE = '#171611'
const SCLERA = '#E2DAB4', IRIS = '#2FBFA0', INK = '#050505', EDGE = '#4A4636', EDGEX = '#5E5640'
const NEWC = '#8CF2C8', CROSSC = '#F4B860'
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, Consolas, "Cascadia Mono", monospace'
const LEATHER = {
  class: '#3A1416', behaviour: '#14302A', interface: '#2A1A3D', struct: '#3A2E14', enum: '#1E2833',
  static: '#13292E', record: '#33231A', script: '#262622', shader: '#22301A', function: '#262622',
}
const MOODCOL = { idle: IRIS, reading: CYAN, writing: EMBER, thinking: VIOLET, running: SULFUR, summoning: BLOOD, overseeing: '#9FB8C9', scrying: SCRY }
const SUMMON_MS = 2500 // the summoning moment at the start of an agent act
const BURST_MS = 25000, BURST_CAP = 6 // edits this close together keep their tentacles out, one per file
const PYR = '#141C1A' // the one dark fill shared by the pyramid and its limbs, so they merge
const FOCUS_TOUCHES = 3
const ROW_H = 14, HEAD_H = 26, MAX_ROWS = 8, CHECK_EVERY = 300
const LINGER = 2600, EYE_KINDS = { read: 1, search: 1, web: 1 }
// a limb on a file stays out this long after its act ends (Claude is usually still using what it read or wrote)
const LIMB_LINGER = 10000
const PROP_OF = { bash: 'flask', web: 'orb', agent: 'pentagram', todo: 'scroll', tool: 'scroll' }
const EMPTY_DASH = []

// ---------- settings (keyboard only, persisted) ----------

const QUAL = ['low', 'medium', 'high'], MOT = [0, 0.5, 1]
let settings = { q: 1, m: 2 }
try { const s = JSON.parse(localStorage.getItem('abyssal-eye.settings') || 'null'); if (s && s.q >= 0 && s.q <= 2 && s.m >= 0 && s.m <= 2) settings = s } catch (e) { /* no storage */ }
function saveSettings() { try { localStorage.setItem('abyssal-eye.settings', JSON.stringify(settings)) } catch (e) { /* ignore */ } }
const Q = () => settings.q
const motion = () => MOT[settings.m]

// ---------- small helpers ----------

const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const c01 = v => v <= 0 ? 0 : v >= 1 ? 1 : v
const lerp = (a, b, t) => a + (b - a) * t
function ease(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)) }
function hash(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function rnd(seed, k) { const h = hash(seed + ':' + k); return (h % 10000) / 10000 }
function clip(t, n) { return t.length <= n ? t : n <= 1 ? '\u2026' : t.slice(0, Math.max(0, n - 1)) + '\u2026' }
function decay(T, t0, dur) { if (!(t0 > 0) || T < t0) return 0; const u = (T - t0) / dur; return u >= 1 ? 0 : (1 - u) * (1 - u) }
function smooth(u) { u = c01(u); return u * u * (3 - 2 * u) }
const rgbCache = new Map()
function rgb(hex) {
  let c = rgbCache.get(hex)
  if (!c) { c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgbCache.set(hex, c) }
  return c
}
function rgba(hex, a) { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a <= 0 ? 0 : a >= 1 ? 1 : Math.round(a * 1000) / 1000) + ')' }
function rgbaArr(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a <= 0 ? 0 : a >= 1 ? 1 : Math.round(a * 1000) / 1000) + ')' }
function pentaPath(cx, cy, r, rot) {
  let d = ''
  for (let k = 0; k < 5; k++) {
    const a = rot + ((k * 2) % 5) * Math.PI * 2 / 5 - Math.PI / 2
    d += (k ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ' ' + (cy + Math.sin(a) * r).toFixed(2)
  }
  return d + 'Z'
}
function wardColor(name) { return 'hsl(' + (hash(name) % 360) + ',40%,62%)' }
function hslHex(h, s, l) {
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  const c = [f(0), f(8), f(4)]
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}
function wardRgb(name) {
  const h = (hash(name) % 360) / 360, s = 0.4, l = 0.62
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  return [f(0), f(8), f(4)]
}

// ---------- vector icons (Path2D from SVG data, 20 x 20 boxes; props are 40 x 40) ----------

const parchment = 'M4 3h12v14H4zM4 3c-1.6 0-1.6 3 0 3M16 17c1.6 0 1.6-3 0-3M7 8h6M7 11h6M7 14h4'
const ICON_D = {
  class: 'M3.7 1.8h12.6v16.5H3.7zM6.4 1.8v16.5M8.5 7h6M8.5 10.8h6',
  behaviour: 'M4.3 13a5.7 5.7 0 1 0 11.4 0a5.7 5.7 0 1 0-11.4 0M8.2 .7v7.2M11.8 .7v7.2M7 .7h6M5.5 13.3h9',
  interface: pentaPath(10, 10, 7.8, 0) + 'M1.6 10a8.4 8.4 0 1 0 16.8 0a8.4 8.4 0 1 0-16.8 0',
  struct: 'M7.5 3.5a2.5 2.5 0 0 1 5 0v13a2.5 2.5 0 0 1-5 0zM7.5 11.5h5',
  enum: 'M8.8 1.8h2.4a4.5 4.5 0 0 1 4.5 4.5v7.5a4.5 4.5 0 0 1-4.5 4.5h-2.4a4.5 4.5 0 0 1-4.5-4.5v-7.5a4.5 4.5 0 0 1 4.5-4.5zM8.5 5.2v9.6M8.5 5.2l3.8 3.3-3.8 2.3 4 4',
  static: 'M10 1.8L2.5 16h15zM4.3 10.8h11.4',
  record: 'M5.2 3.3h9.6v13.5H5.2zM4 2.5a6 1.4 0 1 0 12 0a6 1.4 0 1 0-12 0M4 17.5a6 1.4 0 1 0 12 0a6 1.4 0 1 0-12 0',
  shader: 'M8.2 1v7.5L2.8 18.3h14.4L11.8 8.5V1M7 1h6M5.2 13.8h9.6',
  script: parchment, function: parchment,
}
const ICONS = {}
for (const k in ICON_D) ICONS[k] = new Path2D(ICON_D[k])
const PROPS = {
  flask: { line: new Path2D('M16 4v12L6 34h28L24 16V4M14 4h12'), fill: new Path2D('M10 27h20L24 18v-2H16v2z'), col: GREEN },
  orb: { line: new Path2D('M10 35h20M13 35l3-5h8l3 5'), fill: null, col: SCRY },
  pentagram: { line: new Path2D(pentaPath(20, 20, 14.5, 0)), fill: null, col: BLOOD },
  scroll: { line: new Path2D('M9 7h22v26H9zM8 7a12 2.6 0 1 0 24 0a12 2.6 0 1 0-24 0M8 33a12 2.6 0 1 0 24 0a12 2.6 0 1 0-24 0'), fill: new Path2D('M9 7h22v26H9z'), col: PARCH },
}

// ---------- event sources ----------

const DEMO = /[?&]demo/.test(location.search)
// dev aids, only with ?debug: skip=S (start the demo S seconds in), noloop (play the demo once), nopause (keep
// animating in a hidden tab), stress=N (a large pre-existing demo map), and window.__scope (the live state)
const DEBUG = /[?&]debug/.test(location.search)
const src = { epoch: null, seq: 0, inflight: false, retryAt: 0 }
// loading: until the stream held by the server has all arrived the scene stays off screen behind the waiting plate
// (folded and settled meanwhile), then it is revealed in one fade. total comes with each /events answer; got is
// how many of those lines are here. The demo plays straight away.
const load = { active: !/[?&]demo/.test(location.search), got: 0, total: -1, reveal: 0, doneAt: 0 }
function loadReset() { load.active = !DEMO; load.got = 0; load.total = -1; load.reveal = 0 }
function loadDone() { load.active = false; load.doneAt = performance.now(); view.needSettle = true; view.framed = false }

// A scripted session that loops forever: same shape as the server, so the page code path is identical.
function demoScript() {
  const ev = []
  let t = 0
  let txn = 0
  // every act in the demo is preceded by a request to the model (a transmit), as in a real session
  let used = 24000
  const at = (dt, e) => {
    t += dt * 1000
    if (e.type === 'act') {
      ev.push({ dt: t - 60, type: 'transmit', actor: e.actor, messages: 3 + (txn++ * 7) % 40 })
      used += 2500 + (txn * 1900) % 9000; if (used > 170000) used = 52000 // compaction
      ev.push({ dt: t - 40, type: 'budget', actor: e.actor.split(':')[0] + ':main', used, window: 200000 })
    }
    if (e.type === 'prompt') ev.push({ dt: t - 1800, type: 'idle', actor: e.actor || 's1:main' })
    ev.push(Object.assign({ dt: t }, e))
  }
  const P = 'Assets/Scripts/Player', S = 'Assets/Scripts/Systems', H = 'Assets/Shaders'
  const m = (names, cbs) => names.map((n, i) => ({ name: n, start: 10 + i * 12, end: 20 + i * 12, cb: cbs && cbs.indexOf(n) >= 0 }))
  const node = (name, folder, kind, members, cbs, lines) => ({ type: 'node', id: folder + '/' + name, name, file: folder + '/' + name + (kind === 'shader' ? '.shader' : '.cs'), folder, kind, members: m(members, cbs), lines: lines || 80 + members.length * 15 })
  const id = (folder, name) => folder + '/' + name
  const edge = (a, b, state, cross, baseline) => ({ type: 'edge', from: a, to: b, state, cross: !!cross, baseline: !!baseline })
  const act = (aid, actor, kind, tool, nodeId, member, detail, look) => { const e = { type: 'act', id: aid, actor, kind, tool }; if (nodeId) e.node = nodeId; if (member) e.member = member; if (detail) e.detail = detail; if (look) e.look = true; return e }
  const end = (aid, extra) => Object.assign({ type: 'act-end', id: aid }, extra || {})
  const think = (actor, on) => ({ type: 'think', actor, on })
  const PC = id(P, 'PlayerController'), PI = id(P, 'PlayerInput'), PS = id(P, 'PlayerState'), PST = id(P, 'PlayerStats'), IDM = id(P, 'IDamageable')
  const EB = id(S, 'EventBus'), DS = id(S, 'DashSystem'), TS = id(S, 'TimeScale'), SV = id(S, 'SaveSystem'), GE = id(S, 'GameEvent')
  const WS = id(H, 'WaterSurface'), DI = id(H, 'Dissolve'), SU = id(H, 'ShaderUtils')
  // two Claude sessions share this project's view: s1 (with a thrall) and s2
  const M1 = 's1:main', S1 = 's1:sub1', M2 = 's2:main'

  at(0, { type: 'hello', root: 'C:/Projects/Game' })
  at(0.1, { type: 'actor', id: M1, label: 'Claude' })
  // ?demo&stress=N: a large pre-existing map to check performance
  const stress = !DEBUG ? 0 : parseInt((/stress=(\d+)/.exec(location.search) || [])[1] || '0', 10)
  if (stress > 0) {
    const kinds = Object.keys(LEATHER), ids = []
    for (let i = 0; i < stress; i++) {
      const folder = 'Assets/Stress/Module' + (i % 12), name = 'Type' + i
      at(0.01, node(name, folder, kinds[i % kinds.length], ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].slice(0, 2 + (i % 5)), i % 3 ? null : ['Alpha'], 40 + i))
      ids.push(id(folder, name))
      if (i > 0) { const j = (i * 7 + 3) % i; at(0, edge(ids[i], ids[j], 'live', (i % 12) !== (j % 12), true)) }
      if (i > 1) { const j = (i * 13 + 5) % i; at(0, edge(ids[i], ids[j], 'live', (i % 12) !== (j % 12), true)) }
    }
  }
  at(0.1, { type: 'prompt', text: 'Add a dash ability to the player', actor: M1 })
  at(0.2, think(M1, true))
  at(2.2, think(M1, false))
  at(0.1, act('a1', M1, 'search', 'Grep', null, null, 'Dash'))
  at(0.3, node('PlayerController', P, 'behaviour', ['Awake', 'Update', 'HandleInput', 'Move', 'Jump', 'ApplyGravity', 'OnCollisionEnter', 'Respawn', 'TakeDamage', 'FixedUpdate'], ['Awake', 'Update', 'OnCollisionEnter', 'FixedUpdate'], 240))
  at(0.05, { type: 'glance', actor: M1, node: PC })
  at(0.5, node('PlayerInput', P, 'class', ['Poll', 'Axis', 'Pressed', 'Rebind'], null, 90))
  at(0.05, { type: 'glance', actor: M1, node: PI })
  at(0.5, node('PlayerState', P, 'enum', ['Idle', 'Running', 'Airborne', 'Dead'], null, 12))
  at(0.05, { type: 'glance', actor: M1, node: PS })
  at(0.6, end('a1'))
  at(0.2, think(M1, true))
  at(1.6, think(M1, false))
  at(0.1, act('a2', M1, 'read', 'Read', PC))
  at(2.6, end('a2'))
  at(0.2, think(M1, true))
  at(2.0, think(M1, false))
  at(0.1, act('a3', M1, 'read', 'Read', PC, 'HandleInput'))
  at(2.0, end('a3'))
  at(0.2, think(M1, true))
  at(1.4, think(M1, false))
  at(0.1, act('a4', M1, 'read', 'Read', PI))
  at(0.2, edge(PC, PI, 'live', false, true))
  at(2.0, end('a4'))
  at(0.3, think(M1, true))
  at(1.5, think(M1, false))
  at(0.1, node('EventBus', S, 'static', ['Publish', 'Subscribe', 'Unsubscribe', 'Clear'], null, 60))
  at(0.1, act('a5', M1, 'read', 'Read', EB))
  at(0.2, edge(PI, EB, 'live', true, true))
  at(2.2, end('a5'))
  at(0.3, think(M1, true))
  at(1.2, think(M1, false))
  at(0.1, act('a5b', M1, 'bash', 'Bash', null, null, 'git status', true))
  at(1.8, end('a5b'))
  at(0.2, think(M1, true))
  at(1.4, think(M1, false))
  at(0.1, act('a6', M1, 'edit', 'Edit', PC, 'HandleInput'))
  at(0.3, { type: 'act-wait', id: 'a6' })
  at(0.1, edge(PC, EB, 'pending', true))
  at(4.2, end('a6', { added: 9, removed: 2 }))
  at(0.05, edge(PC, EB, 'live', true))
  at(0.05, node('PlayerController', P, 'behaviour', ['Awake', 'Update', 'HandleInput', 'Dash', 'Move', 'Jump', 'ApplyGravity', 'OnCollisionEnter', 'Respawn', 'TakeDamage', 'FixedUpdate'], ['Awake', 'Update', 'OnCollisionEnter', 'FixedUpdate'], 252))
  // an editing burst across three files: tentacles stay on all of them
  at(0.3, think(M1, true))
  at(1.2, think(M1, false))
  at(0.1, act('a6b', M1, 'edit', 'Edit', PI, 'Poll'))
  at(1.8, end('a6b', { added: 3, removed: 1 }))
  at(0.3, think(M1, true))
  at(1.0, think(M1, false))
  at(0.1, act('a6c', M1, 'edit', 'Edit', PS))
  at(1.4, end('a6c', { added: 1 }))
  at(0.3, think(M1, true))
  at(1.0, think(M1, false))
  at(0.1, act('a6d', M1, 'edit', 'Edit', PC, 'Dash'))
  at(2.0, end('a6d', { added: 5, removed: 1 }))
  at(0.3, think(M1, true))
  at(2.0, think(M1, false))
  at(0.1, node('DashSystem', S, 'class', ['Begin', 'Tick', 'Cancel', 'Cooldown'], null, 70))
  at(0.1, act('a7', M1, 'write', 'Write', DS))
  at(2.6, end('a7', { added: 70 }))
  at(0.1, edge(DS, PC, 'live', true))
  at(0.3, edge(DS, EB, 'live', false))
  at(0.3, node('TimeScale', S, 'static', ['Set', 'Reset', 'Current'], null, 30))
  at(0.1, edge(DS, TS, 'live', false))
  at(0.4, think(M1, true))
  at(1.6, think(M1, false))
  at(0.1, act('a8', M1, 'bash', 'Bash', null, null, 'dotnet build'))
  at(3.6, end('a8'))
  at(0.4, think(M1, true))
  at(1.6, think(M1, false))
  at(0.1, act('a9', M1, 'agent', 'Agent', null, null, 'Explore shaders'))
  at(0.4, { type: 'actor', id: S1, label: 'Explorer', parent: M1, task: 'Survey the shader folder for dissolve effects', by: 'Claude' })
  at(0.6, node('WaterSurface', H, 'shader', ['vert', 'frag', 'Wave'], null, 140))
  at(0.1, act('b1', S1, 'read', 'Read', WS))
  at(2.4, end('b1'))
  at(0.3, think(S1, true))
  at(1.2, think(S1, false))
  at(0.4, node('Dissolve', H, 'shader', ['vert', 'frag', 'Noise', 'Burn'], null, 120))
  at(0.1, act('b2', S1, 'read', 'Read', DI))
  at(2.6, end('b2'))
  at(0.4, act('b3', S1, 'search', 'Grep', null, null, 'include'))
  at(0.3, node('ShaderUtils', H, 'script', ['Saturate', 'Remap', 'Fresnel', 'Hash'], null, 50))
  at(0.1, { type: 'glance', actor: S1, node: SU })
  at(0.4, { type: 'glance', actor: S1, node: WS })
  at(0.8, end('b3'))
  at(0.3, think(S1, true))
  at(1.0, think(S1, false))
  at(0.1, act('b4', S1, 'read', 'Read', DI, 'Burn'))
  at(2.6, end('b4'))
  at(0.3, act('b5', S1, 'bash', 'Bash', null, null, 'ls Assets/Shaders', true))
  at(1.4, end('b5'))
  at(0.3, act('b6', S1, 'read', 'Read', SU, 'Fresnel'))
  at(2.2, end('b6'))
  // nested summoning: the thrall summons a thrall of its own
  at(0.3, act('b7', S1, 'agent', 'Agent', null, null, 'Check shader includes'))
  at(0.4, { type: 'actor', id: 's1:sub2', label: 'Checker', parent: S1, spawn: 'b7', task: 'List every include used by the shaders', by: 'Explorer' })
  at(0.5, act('d1', 's1:sub2', 'read', 'Read', SU))
  at(2.0, end('d1'))
  at(0.3, act('d2', 's1:sub2', 'bash', 'Bash', null, null, 'grep include', true))
  at(1.4, end('d2'))
  at(0.5, end('b7'))
  at(0.8, end('a9'))
  at(0.3, think(M1, true))
  at(2.0, think(M1, false))
  at(0.1, node('PlayerStats', P, 'struct', ['Health', 'Stamina', 'Speed', 'DashCost'], null, 24))
  at(0.1, act('a10', M1, 'edit', 'Edit', PST, 'DashCost'))
  at(0.4, { type: 'act-wait', id: 'a10' })
  at(2.4, end('a10', { added: 2, removed: 1 }))
  at(0.1, edge(PC, PST, 'live', false, true))
  at(0.5, { type: 'ext', node: PI, added: 3, removed: 1 })
  at(0.4, think(M1, true))
  at(1.8, think(M1, false))
  at(0.1, act('a11', M1, 'web', 'WebFetch', null, null, 'docs.unity3d.com'))
  at(3.0, end('a11'))
  at(0.4, think(M1, true))
  at(1.0, think(M1, false))
  at(0.1, act('a12', M1, 'todo', 'TodoWrite'))
  at(1.0, end('a12'))
  at(0.3, think(M1, true))
  at(1.8, think(M1, false))
  at(0.1, node('IDamageable', P, 'interface', ['Damage', 'Heal'], null, 10))
  at(0.1, node('GameEvent', S, 'record', ['Name', 'Payload'], null, 8))
  at(0.1, act('a13', M1, 'read', 'Read', IDM))
  at(0.2, edge(PC, IDM, 'live', false, true))
  at(2.0, end('a13'))
  at(0.4, think(M1, true))
  at(1.6, think(M1, false))
  at(0.1, { type: 'prompt', text: 'Now persist the dash cooldown in saves', actor: M1 })
  at(0.2, think(M1, true))
  at(1.6, think(M1, false))
  at(0.1, node('SaveSystem', S, 'class', ['Save', 'Load', 'Serialize', 'Migrate', 'Wipe', 'Backup', 'Restore', 'Verify', 'Checksum', 'Compress'], null, 310))
  at(0.1, edge(SV, PST, 'live', true, true))
  at(0.1, edge(SV, GE, 'live', false, true))
  at(0.1, act('a14', M1, 'edit', 'Edit', SV, 'Compress'))
  at(0.3, { type: 'act-wait', id: 'a14' })
  at(0.1, edge(SV, DS, 'pending', false))
  at(3.0, end('a14', { added: 12, removed: 6 }))
  at(0.05, edge(SV, DS, 'live', false))
  at(0.1, edge(SV, PST, 'gone', true))
  at(0.4, think(M1, true))
  at(2.0, think(M1, false))
  at(0.1, act('a15', M1, 'bash', 'Bash', null, null, 'dotnet test'))
  at(4.0, end('a15', { failed: true }))
  at(0.4, think(M1, true))
  at(2.5, { type: 'node-gone', id: GE })
  at(0.1, edge(SV, GE, 'gone', false))
  at(1.2, think(M1, false))
  at(0.1, act('a16', M1, 'read', 'Read', DS, 'Tick'))
  at(2.2, end('a16'))
  at(0.3, think(M1, true))
  at(2.0, think(M1, false))
  at(0.1, act('a17', M1, 'edit', 'Edit', DS, 'Tick'))
  at(0.3, edge(DS, PS, 'pending', true))
  at(2.4, end('a17', { added: 4, removed: 1 }))
  at(0.05, edge(DS, PS, 'live', true))
  at(0.3, act('a18', M1, 'agent', 'Agent', null, null, 'Review the dash changes'))
  at(0.4, { type: 'actor', id: 's1:sub3', label: 'Reviewer', parent: M1, spawn: 'a18', task: 'Review the dash cooldown changes for correctness and edge cases', by: 'Claude', role: 'inspector' })
  at(0.5, act('r1', 's1:sub3', 'read', 'Read', DS, 'Tick'))
  at(1.6, end('r1'))
  at(0.2, act('r2', 's1:sub3', 'read', 'Read', SV, 'Compress'))
  at(1.5, end('r2'))
  at(0.2, act('r3', 's1:sub3', 'read', 'Read', PC, 'Update'))
  at(1.4, end('r3'))
  at(0.2, act('r4', 's1:sub3', 'search', 'Grep', null, null, 'cooldown'))
  at(1.2, end('r4'))
  at(0.2, act('r5', 's1:sub3', 'read', 'Read', PST, 'DashCost'))
  at(1.6, end('r5'))
  at(0.2, act('r6', 's1:sub3', 'read', 'Read', PI, 'Pressed'))
  at(1.4, end('r6'))
  at(0.6, end('a18'))
  at(0.4, think(M1, true))
  at(4.0, think(M1, false))
  // the second session works on the HUD at the same time (absolute times, merged below)
  const U = 'Assets/Scripts/UI', HC = id(U, 'HudController'), HB = id(U, 'HealthBar')
  const atT = (sec, e) => ev.push(Object.assign({ dt: sec * 1000 }, e))
  atT(6, { type: 'actor', id: M2, label: 'Claude' })
  atT(6.2, { type: 'prompt', text: 'Show stamina on the HUD', actor: M2 })
  atT(6.4, think(M2, true))
  atT(8.5, think(M2, false))
  atT(8.6, node('HudController', U, 'behaviour', ['Awake', 'Update', 'Bind', 'Refresh', 'Show', 'Hide'], ['Awake', 'Update'], 150))
  atT(8.7, act('c1', M2, 'read', 'Read', HC))
  atT(11.5, end('c1'))
  atT(11.8, think(M2, true))
  atT(13.6, think(M2, false))
  atT(13.7, node('HealthBar', U, 'class', ['SetValue', 'Flash', 'Tween'], null, 60))
  atT(13.8, act('c2', M2, 'read', 'Read', HB, 'SetValue'))
  atT(14.0, edge(HC, HB, 'live', false, true))
  atT(16.2, end('c2'))
  atT(16.5, think(M2, true))
  atT(18.8, think(M2, false))
  atT(18.9, act('c3', M2, 'edit', 'Edit', HC, 'Refresh'))
  atT(19.2, { type: 'act-wait', id: 'c3' })
  atT(19.3, edge(HC, PST, 'pending', true))
  atT(23.0, end('c3', { added: 7, removed: 1 }))
  atT(23.05, edge(HC, PST, 'live', true))
  atT(23.4, think(M2, true))
  atT(25.0, think(M2, false))
  atT(25.1, act('c4', M2, 'edit', 'Edit', HB, 'Tween'))
  atT(27.4, end('c4', { added: 4 }))
  atT(27.8, think(M2, true))
  atT(29.5, think(M2, false))
  atT(29.6, act('c5', M2, 'bash', 'Bash', null, null, 'git diff --stat', true))
  atT(31.2, end('c5'))
  atT(31.5, think(M2, true))
  atT(34.0, think(M2, false))
  atT(34.1, act('c6', M2, 'read', 'Read', PST, 'Stamina'))
  atT(36.5, end('c6'))
  atT(36.8, think(M2, true))
  atT(40.0, think(M2, false))
  atT(40.1, act('c7', M2, 'bash', 'Bash', null, null, 'dotnet build'))
  atT(44.0, end('c7'))
  atT(44.3, think(M2, true))
  atT(49.0, think(M2, false))
  atT(49.1, act('c7b', M2, 'web', 'WebFetch', null, null, 'docs.unity3d.com/ui-toolkit'))
  atT(53.5, end('c7b'))
  atT(53.8, think(M2, true))
  atT(60.0, think(M2, false))
  atT(60.1, act('c8', M2, 'edit', 'Edit', HC, 'Show'))
  atT(62.5, end('c8', { added: 2 }))
  atT(62.8, think(M2, true))
  atT(70.0, think(M2, false))
  ev.sort((a, b) => a.dt - b.dt)
  return ev
}

const demo = { script: null, start: 0, idx: 0, epoch: 0, seq: 0, buf: [] }
function demoPoll(since) {
  const now = Date.now()
  if (!demo.script) {
    const skip = !DEBUG ? 0 : parseFloat((/skip=([\d.]+)/.exec(location.search) || [])[1] || '0') * 1000
    demo.script = demoScript(); demo.start = now - skip; demo.epoch = now; demo.idx = 0; demo.seq = 0; demo.buf = []
  }
  const sc = demo.script
  if (demo.idx >= sc.length && now - (demo.start + sc[sc.length - 1].dt) > 7000 && !(DEBUG && /[?&]noloop/.test(location.search))) {
    demo.start = now; demo.epoch = now; demo.idx = 0; demo.seq = 0; demo.buf = []
  }
  while (demo.idx < sc.length && demo.start + sc[demo.idx].dt <= now) {
    const e = Object.assign({}, sc[demo.idx]); delete e.dt
    e.seq = ++demo.seq; e.t = demo.start + sc[demo.idx].dt
    demo.buf.push(e); demo.idx++
  }
  return { epoch: demo.epoch, events: demo.buf.filter(e => e.seq > since) }
}

function onBatch(res) {
  if (!res || typeof res.epoch !== 'number' || !Array.isArray(res.events)) return
  if (src.epoch !== null && res.epoch !== src.epoch) { resetAll(); src.seq = 0; src.epoch = res.epoch; loadReset(); return }
  src.epoch = res.epoch
  if (typeof res.total === 'number') load.total = res.total
  let got = 0
  for (let i = 0; i < res.events.length; i++) {
    const e = res.events[i]
    if (e.seq > src.seq) { src.seq = e.seq; ingest(e); got++ }
  }
  // a batch this large is a replay (a fresh page, a reconnect, a server restart), shown settled, not animated in
  if (got >= 40) view.needSettle = true
  load.got = src.seq
  // everything the server holds is here (or it holds nothing): the map can be shown
  if (load.active && load.total >= 0 && src.seq >= load.total) loadDone()
}

// polling recovers on its own: failures back off (1 s up to 10 s), success resets; a new epoch after a server
// restart is caught by onBatch, which resets the state and refetches from 0 on the next poll
function poll() {
  if (DEMO) { onBatch(demoPoll(src.seq)); return }
  if (src.inflight || performance.now() < src.retryAt) return
  src.inflight = true
  fetch('events?since=' + src.seq, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
    .then(res => { src.inflight = false; src.backoff = 0; onBatch(res) })
    .catch(() => { src.inflight = false; src.backoff = Math.min(10000, (src.backoff || 150) * 2); src.retryAt = performance.now() + src.backoff })
}

// ---------- history: every event kept, state at T is the fold of events with t <= T ----------

// sessions: one per top-level actor (a Claude session working in this project); each has its own prompt and focus
function newState() { return { root: '', nodes: new Map(), edges: new Map(), actors: new Map(), acts: new Map(), lastActor: '', sessions: new Map() } }
function topOf(s, id) { const a = s.actors.get(id); return a && a.parent ? a.parent : id }
function firstTop(s) { for (const a of s.actors.values()) if (!a.parent) return a.id; return '' }
function sessOf(s, top) {
  let se = s.sessions.get(top)
  if (!se) { se = { prompt: null, touches: new Map(), focusHist: [] }; s.sessions.set(top, se) }
  return se
}
// a session's prompt, falling back to the first session's when an actor has none of its own
function promptFor(s, top) {
  const se = s.sessions.get(top)
  if (se && se.prompt) return se.prompt
  for (const o of s.sessions.values()) if (o.prompt) return o.prompt
  return null
}

// the tomes the current prompt's work keeps returning to (several touches, or an edit)
function focusMembers(s, se) {
  const out = []
  for (const [id, t] of se.touches) if ((t.c >= FOCUS_TOUCHES || t.e) && s.nodes.has(id)) out.push(id)
  return out
}
function bumpTouch(s, actor, id, edit) {
  const se = sessOf(s, topOf(s, actor))
  let t = se.touches.get(id)
  if (!t) { t = { c: 0, e: false }; se.touches.set(id, t) }
  t.c++; if (edit) t.e = true
}
// attention: every touch of a tome leaves a weighted hit (edit 2, read 1, glance 0.5) tagged with its session;
// the score at T is the sum of hits decayed over a few minutes, so attention is derived from state at any T
const ATT_TAU = 150000
function hit(s, actor, n, w, t) {
  if (!n.hits) { n.hits = []; n.work = 0 }
  n.hits.push({ t, w, se: topOf(s, actor) })
  n.work += w
  if (n.hits.length > 24) n.hits.shift()
}
function attention(n, T, out) {
  let best = '', bestV = 0, total = 0
  if (!n.hits) { out[0] = 0; out[1] = ''; return }
  for (let i = 0; i < n.hits.length; i++) {
    const h = n.hits[i]
    if (h.t > T) continue
    const v = h.w * Math.exp(-(T - h.t) / ATT_TAU)
    total += v
    const cur = (out.sess[h.se] || 0) + v
    out.sess[h.se] = cur
    if (cur > bestV) { bestV = cur; best = h.se }
  }
  out[0] = total; out[1] = best
}
const H = { events: [], applied: 0, state: newState(), checks: [], t0: 0 }

function ingest(e) {
  if (!e || typeof e.t !== 'number') return
  e.at = Date.now() // when it reached this page: a late batch still gets its moment on the live view
  const evs = H.events
  if (evs.length && e.t < evs[evs.length - 1].t) {
    // replayed history can arrive with older timestamps: keep the log in time order and refold from before it
    let lo = 0, hi = evs.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (evs[mid].t <= e.t) lo = mid + 1; else hi = mid }
    evs.splice(lo, 0, e)
    H.checks = H.checks.filter(c => c.idx <= lo)
    if (H.applied > lo) { const cp = H.checks.length ? H.checks[H.checks.length - 1] : null; H.state = cp ? structuredClone(cp.state) : newState(); H.applied = cp ? cp.idx : 0 }
    if (e.t < H.t0) H.t0 = e.t
  } else { evs.push(e); if (!H.t0) H.t0 = e.t }
  layout.awake = Math.max(layout.awake, 90) // events wake the solver
}

function resetAll() {
  H.events.length = 0; H.applied = 0; H.state = newState(); H.checks.length = 0; H.t0 = 0
  vis.nodes.clear(); vis.edges.clear(); vis.actors.clear(); vis.limbs.clear(); vis.wards.clear(); vis.props.clear(); vis.portals.clear(); vis.whirls.clear(); vis.piles.clear()
  cardCache.clear()
}

function causeOf(s) {
  const a = s.actors.get(s.lastActor)
  const w = a && a.wake.length ? a.wake[a.wake.length - 1].node : ''
  return { node: w, actor: s.lastActor }
}

function apply(s, e) {
  switch (e.type) {
    case 'hello': s.root = e.root || ''; break
    case 'node': {
      let n = s.nodes.get(e.id)
      if (!n) {
        const c = causeOf(s)
        n = { id: e.id, bornT: e.t, goneT: 0, readT: 0, editT: 0, extT: 0, glanceT: 0, rows: new Map(), cause: c.node, causeActor: c.actor }
        s.nodes.set(e.id, n)
      }
      n.name = e.name || e.id; n.file = e.file || ''; n.folder = e.folder || ''; n.kind = e.kind || 'class'
      n.members = Array.isArray(e.members) ? e.members : []; n.lines = e.lines || 0; n.goneT = 0; n.changedT = e.t
      break
    }
    case 'node-gone': { const n = s.nodes.get(e.id); if (n) n.goneT = e.t; break }
    case 'edge': {
      const key = e.from + '>' + e.to
      let g = s.edges.get(key)
      if (!g) { g = { key, from: e.from, to: e.to, state: '', cross: !!e.cross, baseline: false, firstT: e.t, liveT: 0, pendingT: 0, goneT: 0, changedT: 0 }; s.edges.set(key, g) }
      g.cross = !!e.cross; g.changedT = e.t
      if (e.state === 'live') { if (g.state !== 'live') { g.baseline = !!e.baseline; g.liveT = e.baseline ? 0 : e.t }; g.goneT = 0 }
      else if (e.state === 'pending') { g.pendingT = e.t }
      else if (e.state === 'gone') { g.goneT = e.t }
      g.state = e.state
      break
    }
    case 'actor': {
      let a = s.actors.get(e.id)
      if (!a) { a = { id: e.id, bornT: e.t, doneT: 0, thinking: false, thinkT: 0, wake: [], glances: [], lastActT: 0, lastT: e.t, task: '', by: '', spawnAct: '' }; s.actors.set(e.id, a) }
      a.label = e.label || e.id; a.parent = e.parent || ''; a.task = e.task || ''; a.by = e.by || ''; a.role = e.role || ''
      // a thrall grows out of the parent's agent act that summoned it (given, or inferred from the open one)
      if (e.spawn) a.spawnAct = e.spawn
      if (a.parent && !a.spawnAct) for (const act of s.acts.values()) if (act.kind === 'agent' && act.actor === a.parent && !act.endT) a.spawnAct = act.id
      break
    }
    case 'prompt': {
      // a new task for that session: its old focus closes and is kept as history
      const top = e.actor || firstTop(s) || 'main'
      const ta = s.actors.get(top); if (ta) ta.lastT = e.t
      const se = sessOf(s, top)
      const mem = focusMembers(s, se)
      if (mem.length) se.focusHist.push({ t: se.prompt ? se.prompt.t : 0, closedT: e.t, nodes: mem, text: se.prompt ? se.prompt.text : '' })
      if (se.focusHist.length > 12) se.focusHist.shift()
      se.touches = new Map()
      se.prompt = { text: e.text || '', by: e.by || '', t: e.t }
      break
    }
    case 'act': {
      const a = ensureActor(s, e.actor, e.t)
      const act = { id: e.id, actor: e.actor, kind: e.kind || 'tool', tool: e.tool || '', node: e.node || '', member: e.member || '', detail: e.detail || '', look: !!e.look, startT: e.t, waitT: 0, endT: 0, failed: false, arrivedT: e.at || e.t }
      s.acts.set(e.id, act)
      s.lastActor = e.actor; a.thinking = false; a.lastActT = e.t; a.lastT = e.t; a.idleT = 0
      touch(s, a, act, e.t)
      break
    }
    case 'act-wait': { const act = s.acts.get(e.id); if (act) act.waitT = e.t; break }
    case 'act-end': {
      const act = s.acts.get(e.id)
      if (!act) break
      act.endT = e.t; act.failed = !!e.failed; act.arrivedT = e.at || e.t
      const a = ensureActor(s, act.actor, e.t)
      a.lastT = e.t
      if (e.node && e.node !== act.node) { act.node = e.node; act.member = e.member || ''; touch(s, a, act, e.t) }
      else if (e.member && e.member !== act.member) { act.member = e.member; touch(s, a, act, e.t) }
      if (act.kind === 'edit' || act.kind === 'write') markEdit(s, act, e.t)
      if (act.kind === 'agent') for (const sub of s.actors.values()) if (sub.parent === act.actor && sub.bornT >= act.startT && !sub.doneT) sub.doneT = e.t
      break
    }
    case 'budget': {
      const a = ensureActor(s, e.actor, e.t); const win = Math.max(1, e.window | 0), used = Math.max(0, e.used | 0)
      const prev = a.budget ? a.budget.used : -1
      if (prev >= 0 && used > prev) { if (!a.feeds) a.feeds = []; a.feeds.push({ t: e.t, jump: used - prev }); if (a.feeds.length > 32) a.feeds.shift() }
      a.budget = { used, window: win, t: e.t }; a.lastT = e.t; break
    }
    case 'transmit': { const a = ensureActor(s, e.actor, e.t); if (!a.tx) a.tx = []; a.tx.push({ t: e.t, n: Math.max(1, e.messages | 0) }); if (a.tx.length > 24) a.tx.shift(); a.lastT = e.t; break }
    case 'think': { const a = ensureActor(s, e.actor, e.t); a.thinking = !!e.on; a.thinkT = e.t; a.lastT = e.t; if (e.on) a.idleT = 0; break }
    case 'idle': { const a = ensureActor(s, e.actor, e.t); a.idleT = e.t; a.thinking = false; a.lastT = e.t; break }
    case 'glance': {
      const a = ensureActor(s, e.actor, e.t), n = s.nodes.get(e.node)
      a.lastT = e.t
      if (n) { n.glanceT = e.t; hit(s, e.actor, n, 0.5, e.t) }
      a.glances.push({ node: e.node, t: e.t }); if (a.glances.length > 24) a.glances.shift()
      break
    }
    case 'ext': { const n = s.nodes.get(e.node); if (n) n.extT = e.t; break }
    default: break
  }
}

function ensureActor(s, id, t) {
  let a = s.actors.get(id)
  if (!a) { a = { id, label: id, parent: '', task: '', by: '', bornT: t, doneT: 0, thinking: false, thinkT: 0, wake: [], glances: [], lastActT: 0, lastT: t, spawnAct: '' }; s.actors.set(id, a) }
  return a
}

// who is on the map at T: a session while it was active in the last 10 minutes; a thrall while its parent's
// agent act is open (plus a short linger), or within a minute of its own last activity when that act is unknown
const WAIT_STALE = 1800000 // a wait on the human older than this is replayed history, not a live dialog
const SESSION_MS = 600000, THRALL_LINGER = 6000, THRALL_ORPHAN_MS = 60000
function actorPresent(s, a, T) {
  if (a.bornT > T) return false
  if (!a.parent) return a.lastT > 0 && T - a.lastT < SESSION_MS
  return !thrallDone(s, a, T) // a finished thrall fades out; scrubbing back shows it live again
}
// a finished thrall: its summoning act ended (plus a short linger), or it went quiet for a minute
function thrallDone(s, a, T) {
  const act = a.spawnAct ? s.acts.get(a.spawnAct) : null
  if (act) return act.endT > 0 && T - act.endT > THRALL_LINGER && T - a.lastT > THRALL_LINGER
  return T - Math.max(a.lastT, a.bornT) > THRALL_ORPHAN_MS
}

function touch(s, a, act, t) {
  const n = act.node ? s.nodes.get(act.node) : null
  if (!n) return
  const edit = act.kind === 'edit' || act.kind === 'write'
  if (edit) n.editT = t; else n.readT = t
  if (act.member) { let r = n.rows.get(act.member); if (!r) { r = { readT: 0, editT: 0 }; n.rows.set(act.member, r) }; if (edit) r.editT = t; else r.readT = t }
  a.wake.push({ node: act.node, t, edit }); if (a.wake.length > 14) a.wake.shift()
  bumpTouch(s, act.actor, act.node, edit)
  hit(s, act.actor, n, edit ? 2 : 1, t)
}

function markEdit(s, act, t) {
  const n = act.node ? s.nodes.get(act.node) : null
  if (!n) return
  n.editT = t
  bumpTouch(s, act.actor, act.node, true)
  hit(s, act.actor, n, 1.5, t)
  if (act.member) { let r = n.rows.get(act.member); if (!r) { r = { readT: 0, editT: 0 }; n.rows.set(act.member, r) }; r.editT = t }
}

// fold forward incrementally; when going back, restore the nearest checkpoint and refold
function foldTo(T) {
  const evs = H.events
  if (H.applied > 0 && evs[H.applied - 1].t > T) {
    let cp = null
    for (let i = H.checks.length - 1; i >= 0; i--) if (evs[H.checks[i].idx - 1].t <= T) { cp = H.checks[i]; break }
    H.state = cp ? structuredClone(cp.state) : newState()
    H.applied = cp ? cp.idx : 0
  }
  while (H.applied < evs.length && evs[H.applied].t <= T) {
    apply(H.state, evs[H.applied]); H.applied++
    if (H.applied % CHECK_EVERY === 0 && (H.checks.length === 0 || H.checks[H.checks.length - 1].idx < H.applied)) H.checks.push({ idx: H.applied, state: structuredClone(H.state) })
  }
}

// ---------- visual state: persistent, eased objects ----------

const vis = { nodes: new Map(), edges: new Map(), actors: new Map(), limbs: new Map(), wards: new Map(), props: new Map(), portals: new Map(), whirls: new Map(), piles: new Map(), souls: new Map() }
const view = {
  w: 1, h: 1, dpr: 1, live: true, T: 0, now: 0, cam: { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 },
  userUntil: 0, drag: null, scrub: false, handle: 1, hover: null, hint: { text: '', until: 0 },
  mx: -1, my: -1, follow: { x: 0, y: 0, z: 1 }, tickCount: -1, tickW: 0, tickAt: 0,
}
const BAR_H = 18
const layout = { awake: 30, energy: 0 }

// the card fits its full title (up to about twice the usual width); beyond that the title shrinks to 70%
// before it is truncated in the middle as a last resort
const TITLE_MAX_W = 300
function clipMid(t, n) { if (t.length <= n) return t; const keep = Math.max(2, n - 1), head = Math.ceil(keep / 2), tail = Math.floor(keep / 2); return t.slice(0, head) + '…' + t.slice(t.length - tail) }
function nodeSize(n, rows, more) {
  const nm = shortOf(n.id, n.name)
  const natural = 48 + nm.length * 7.4
  let ts = 1, w = natural
  if (natural > TITLE_MAX_W) { ts = Math.max(0.7, (TITLE_MAX_W - 48) / (nm.length * 7.4)); w = TITLE_MAX_W }
  for (let i = 0; i < rows.length; i++) w = Math.max(w, 30 + rows[i].name.length * 6.4)
  w = clamp(Math.round(w), 112, TITLE_MAX_W)
  const h = HEAD_H + rows.length * ROW_H + (more > 0 ? 12 : 0) + 6
  return [w, h, ts]
}

function spawnNode(S, n) {
  const r1 = rnd(n.id, 1) - 0.5, r2 = rnd(n.id, 2) - 0.5
  let x = r1 * 80, y = r2 * 80
  let cx = 0, cy = 0, cnt = 0
  for (const V of vis.nodes.values()) if (V.alive && V.folder === n.folder) { cx += V.lx + V.w / 2; cy += V.ly + V.h / 2; cnt++ }
  const cause = n.cause ? vis.nodes.get(n.cause) : null
  let main = vis.actors.get(n.causeActor)
  if (!main) for (const a of vis.actors.values()) if (!a.parent) { main = a; break }
  if (cnt) { x = cx / cnt + r1 * 160; y = cy / cnt + r2 * 160 }
  else if (cause) { x = cause.lx + (r1 > 0 ? cause.w + 170 : -230) + r1 * 60; y = cause.ly + r2 * 260 }
  else if (main) { x = main.x + 120 + r1 * 80; y = main.y + r2 * 120 }
  return {
    id: n.id, name: n.name, kind: n.kind, file: n.file, folder: n.folder, lines: 0,
    lx: x, ly: y, vx: 0, vy: 0, x, y, w: 120, h: 60, tw: 120, th: 60, alpha: 0, scale: 0.55,
    hRead: 0, hEdit: 0, hExt: 0, hFresh: 0, hGhost: 0, tRead: 0, tEdit: 0, tExt: 0, tFresh: 0, tGhost: 0,
    rows: [], rowMap: new Map(), rowsKey: '', more: 0, present: false, alive: false, key: '', seed: hash(n.id),
  }
}

// which acts are current or lingering per actor, and which rows are being worked on
// the taint: an edited tome stays undulating, unfaded and crackling for TAINT_MS after the edit ends, dying out
// over the last TAINT_FADE; the window runs from the edit's end, or from its arrival when the batch came late
const TAINT_MS = 15000, TAINT_FADE = 4000
const focus = { taint: new Map(), rows: new Map(), cur: new Map(), burst: new Set(), nodeEdit: new Map(), lastEdit: new Map(), pull: new Map(), zaps: [], lastT: 0 }
const zapped = new Set()
function collectActs(S, T) {
  focus.rows.clear(); focus.cur.clear(); focus.burst.clear(); focus.nodeEdit.clear(); focus.lastEdit.clear(); focus.pull.clear(); focus.taint.clear()
  for (const act of S.acts.values()) {
    if (act.startT > T) continue
    const ended = act.endT > 0
    // the taint of a finished edit, strongest of the edits on a tome, tinted by who made it
    if (ended && act.node && (act.kind === 'edit' || act.kind === 'write') && !act.failed) {
      const s = since(act, T)
      if (s >= 0 && s < TAINT_MS) {
        const k = s < TAINT_MS - TAINT_FADE ? 1 : (TAINT_MS - s) / TAINT_FADE
        const prev = focus.taint.get(act.node)
        if (!prev || k > prev.k) { const top = topOf(S, act.actor), A = vis.actors.get(top); focus.taint.set(act.node, { k, member: act.member || '', col: top !== act.actor ? THRALL : (A && A.hue ? A.hue : EMBER) }) }
      }
    }
    // an editing burst: recent edits keep a tentacle on each file they touched
    if ((act.kind === 'edit' || act.kind === 'write') && act.node && T - Math.max(act.startT, act.endT) < BURST_MS) {
      const prev = focus.nodeEdit.get(act.node)
      if (!prev || act.startT >= prev.startT) focus.nodeEdit.set(act.node, act)
      focus.lastEdit.set(act.actor, Math.max(focus.lastEdit.get(act.actor) || 0, Math.max(act.startT, act.endT)))
    }
    // any act on a tome pulls it into the session's inner orbit for its duration and a while after, whatever its score
    if (act.node && act.kind !== 'agent' && (!ended || since(act, T) < LINGER + 12000) && !String(act.actor).startsWith('history:')) focus.pull.set(act.node, topOf(S, act.actor))
    if (ended && T - act.endT > LINGER + 800) continue
    if (act.node && act.member) {
      let set = focus.rows.get(act.node); if (!set) { set = new Set(); focus.rows.set(act.node, set) }
      set.add(act.member)
    }
    const prev = focus.cur.get(act.actor)
    if (!prev || act.startT >= prev.startT) focus.cur.set(act.actor, act)
  }
  // the burst set: newest edits first, capped per actor
  const perActor = new Map()
  for (const act of focus.nodeEdit.values()) { let l = perActor.get(act.actor); if (!l) { l = []; perActor.set(act.actor, l) }; l.push(act) }
  for (const l of perActor.values()) { l.sort((a, b) => b.startT - a.startT); for (let i = 0; i < l.length && i < BURST_CAP; i++) focus.burst.add(l[i].id) }
  // touches: an edit tentacle on a tome electrifies it once per act, at the act's start, or on arrival when the batch
  // came late (live only); a scrub backwards forgets, so the moment can be watched again
  if (T < focus.lastT - 800) zapped.clear()
  focus.lastT = T
  const wall = Date.now()
  for (const act of S.acts.values()) {
    if (!act.node || (act.kind !== 'edit' && act.kind !== 'write') || act.startT > T || zapped.has(act.id)) continue
    const fresh = T - act.startT < 2500 || (view.live && act.arrivedT && wall - act.arrivedT < 2500)
    if (!fresh) { if (T - act.startT > 2500) zapped.add(act.id); continue }
    zapped.add(act.id)
    const top = topOf(S, act.actor), sub = top !== act.actor
    const A = vis.actors.get(top)
    focus.zaps.push({ node: act.node, member: act.member || '', col: sub ? THRALL : (A && A.hue ? A.hue : EMBER) })
  }
}

function syncRows(V, n, T) {
  const active = focus.rows.get(n.id)
  const mem = n.members
  let key = mem.length + '|' + (V.tFold ? 'F' : '')
  for (let i = 0; i < mem.length; i++) key += mem[i].name + (mem[i].cb ? '*' : '') + ','
  if (active) for (const a of active) key += '!' + a
  // rows with heat count as active for visibility too, so they do not vanish while glowing
  for (const [name, r] of n.rows) if (decay(T, r.readT, 9000) > 0.02 || decay(T, r.editT, 14000) > 0.02) key += '~' + name
  if (key !== V.rowsKey) {
    V.rowsKey = key
    const seen = new Set()
    const rows = []
    for (let i = 0; i < mem.length; i++) {
      const m = mem[i]
      if (seen.has(m.name)) continue
      seen.add(m.name)
      let rv = V.rowMap.get(m.name)
      if (!rv) { rv = { name: m.name, cb: !!m.cb, r: 0, e: 0, f: 0, tr: 0, te: 0, tf: 0 }; V.rowMap.set(m.name, rv) }
      rv.cb = !!m.cb
      const hot = (active && active.has(m.name)) || key.indexOf('~' + m.name) >= 0
      rows.push({ rv, hot, i })
    }
    const pick = []
    for (let i = 0; i < rows.length; i++) if (rows[i].hot) pick.push(rows[i])
    const limit = V.tFold ? 0 : MAX_ROWS
    for (let i = 0; i < rows.length && pick.length < limit; i++) if (!rows[i].hot) pick.push(rows[i])
    pick.sort((a, b) => a.i - b.i)
    V.rows = pick.map(r => r.rv)
    V.more = rows.length - V.rows.length
    const sz = nodeSize(n, V.rows, V.more)
    if (V.tw !== sz[0] || V.th !== sz[1]) layout.awake = Math.max(layout.awake, 40)
    V.tw = sz[0]; V.th = sz[1]; V.titleScale = sz[2]
    if (!V.sized) { V.sized = true; V.w = V.tw; V.h = V.th }
    V.key = shortOf(n.id, n.name) + '|' + n.kind + '|' + V.rows.map(r => r.name + (r.cb ? '*' : '')).join(',') + '|' + V.more + '|' + V.tw + 'x' + V.th + '|' + sz[2].toFixed(2)
  }
  for (let i = 0; i < V.rows.length; i++) {
    const rv = V.rows[i], r = n.rows.get(rv.name)
    rv.tr = r ? decay(T, r.readT, 9000) : 0
    rv.te = r ? decay(T, r.editT, 14000) : 0
    rv.tf = active && active.has(rv.name) ? 1 : 0
  }
}

// does the session (its Claude or any of its thralls) have an act open at T?
function openActs(S, id, T) {
  for (const act of S.acts.values()) if (!act.endT && act.startT <= T && topOf(S, act.actor) === id) return true
  return false
}
function moodOf(S, a, T) {
  const act = focus.cur.get(a.id)
  if (act && (!act.endT || T - act.endT < 500)) {
    if (act.look && act.kind !== 'web' && act.kind !== 'agent') return 'reading'
    switch (act.kind) {
      case 'read': case 'search': return 'reading'
      case 'edit': case 'write': case 'todo': case 'tool': return 'writing'
      case 'bash': return 'running'
      case 'agent': return T - act.startT < SUMMON_MS ? 'summoning' : 'overseeing'
      case 'web': return 'scrying'
      default: return 'idle'
    }
  }
  return a.thinking ? 'thinking' : 'idle'
}

// where an actor wants to float: beside the tome it works on
function actorGoal(S, a, V, T) {
  const act = focus.cur.get(a.id)
  let nid = act && act.node ? act.node : (a.wake.length ? a.wake[a.wake.length - 1].node : '')
  const N = nid ? vis.nodes.get(nid) : null
  const k = (V.seed % 3) - 1
  const bob = Math.sin(performance.now() * 0.0011 + V.seed) * 4 * motion() // idle hovering
  // a session's creature sits in its vortex (the hub, for the session owning the centre) and swims out only for a
  // tome beyond its limbs' reach, returning afterwards
  if (!a.parent && pack.init) {
    const W = vis.whirls.get(a.id)
    let hx, hy
    if (W && W.n) { hx = W.x; hy = W.y }
    else if (a.id === pack.owner) { hx = pack.cx; hy = pack.cy }
    else if (W) { hx = W.x; hy = W.y }
    else { const an = (hash(a.id) % 360) * Math.PI / 180; hx = pack.cx + Math.cos(an) * pack.midR; hy = pack.cy + Math.sin(an) * pack.midR * tilt.cos }
    if (!(N && N.present) || Math.hypot(N.x + N.w / 2 - hx, N.y + N.h / 2 - hy) < 460) return [hx, hy + bob]
  }
  if (N && N.present) {
    const side = V.goalSide, m = V.r * 1.5
    // beside the tome on the chosen side; never over another tome: try the other side, above, below
    const cands = [
      [N.x + (side < 0 ? -110 - V.r : N.w + 110 + V.r), N.y - 40 + k * 26 + bob],
      [N.x + (side < 0 ? N.w + 110 + V.r : -110 - V.r), N.y - 40 + k * 26 + bob],
      [N.x + N.w / 2 + k * 40, N.y - 70 - V.r + bob],
      [N.x + N.w / 2 + k * 40, N.y + N.h + 70 + V.r + bob],
    ]
    for (let c = 0; c < cands.length; c++) {
      const gx = cands[c][0], gy = cands[c][1]
      let free = true
      for (const O of vis.nodes.values()) if (O.present && O !== N && gx + m > O.x && gx - m < O.x + O.w && gy + m > O.y && gy - m < O.y + O.h) { free = false; break }
      if (free) return cands[c]
    }
    return cands[2]
  }
  if (a.parent) { const P = vis.actors.get(a.parent); if (P) return [P.x + 90 + k * 30, P.y - 90] }
  let cx = 0, cy = 0, c = 0
  for (const n of vis.nodes.values()) if (n.present) { cx += n.x; cy += n.y; c++ }
  return c ? [cx / c - 140, cy / c - 60 + bob] : [V.x, V.y + bob]
}

// free space for a creature: pushed out of any card it would sit on, with a clearance margin
function freeSpot(x, y, m) {
  for (let k = 0; k < 3; k++) {
    let moved = false
    for (const N of vis.nodes.values()) {
      if (!N.present || N.pile > 0.5 || !isFinite(N.x) || !isFinite(N.y) || x < N.x - m || x > N.x + N.w + m || y < N.y - m || y > N.y + N.h + m) continue
      const dl = x - (N.x - m), dr = (N.x + N.w + m) - x, du = y - (N.y - m), dd = (N.y + N.h + m) - y
      const mn = Math.min(dl, dr, du, dd)
      if (mn === dl) x -= mn + 1; else if (mn === dr) x += mn + 1; else if (mn === du) y -= mn + 1; else y += mn + 1
      moved = true
    }
    if (!moved) break
  }
  ptmp[0] = x; ptmp[1] = y
}

function syncActors(S, T, now, dt) {
  for (const a of S.actors.values()) {
    if (String(a.id).startsWith('history:')) continue // earlier sessions' seed: no pyramid, no limbs, no caption
    let V = vis.actors.get(a.id)
    const present = actorPresent(S, a, T)
    if (!V) {
      if (!present) continue
      const P = a.parent ? vis.actors.get(a.parent) : null
      const r = a.parent ? 13 : 22
      // each session's pyramid gets its own subtle hue; the first keeps the bone tone
      let tops = 0
      for (const o of vis.actors.values()) if (!o.parent) tops++
      const hue = a.parent ? THRALL : tops === 0 ? FLESHLINE : hslHex((48 + tops * 95) % 360, 0.3, 0.74)
      // a thrall is born at the tip of the summoning limb, the pentagram
      const bp = P ? propPos(P, 'pentagram') : null
      V = { id: a.id, parent: a.parent, r, x: bp ? bp[0] : tops * 260, y: bp ? bp[1] : -200, vx: 0, vy: 0, alpha: 0, born: a.parent ? 1 : 0, mood: 'idle', col: rgb(IRIS).slice(), open: 1, look: [0, 0], seed: hash(a.id), goalSide: -1, aura: 0, label: a.label, gaps: [null, null, null], fill: PYR, tone: hue, hue, swim: null, swimK: 0, swimLen: 0.8, swimSpread: 1, swimDx: 0, swimDy: 1, knot: 0, knotT: 0, pulse: 0 }
      vis.actors.set(a.id, V)
    }
    V.present = present
    V.role = a.role || ''
    V.parent = a.parent
    V.lastT = a.lastT
    V.mood = moodOf(S, a, T)
    // done: the turn ended a moment ago and nothing is open, thinking or waiting on the human
    V.doneT = !a.parent && a.idleT > 0 && T - a.idleT > 1000 && !a.thinking && !openActs(S, a.id, T) ? 1 : 0
    // waiting on the human: its act sits on a permission dialog, or it asked a question and the answer is open
    V.waitT = 0
    for (const act of S.acts.values()) if (act.actor === a.id && !act.endT && act.startT <= T && T - act.startT < WAIT_STALE && (act.waitT > 0 || act.tool === 'AskUserQuestion')) { V.waitT = 1; break }
    if (V.waitT) V.doneT = 0
    // a finished thrall shrinks into a knot on its branch and rests where it worked
    const wasKnot = V.knotT === 1
    V.knotT = 0 // finished thralls leave the map instead of becoming knots
    if (V.knotT === 1 && !wasKnot) { V.kx = V.x; V.ky = V.y }
    if (V.knotT === 1) {
      // a knot rests where the thrall actually worked: the centroid of the tomes it touched most; on the edge of
      // the pile those tomes folded into; or, if it touched nothing on the map, tucked close to its parent
      let kx = 0, ky = 0, kc = 0, pile = null
      const counts = new Map()
      for (let i = 0; i < a.wake.length; i++) counts.set(a.wake[i].node, (counts.get(a.wake[i].node) || 0) + 1)
      for (const [nid, c] of counts) {
        const N = vis.nodes.get(nid)
        if (!N || !N.present) continue
        if (N.pileOf) { const P = vis.piles.get(N.pileOf); if (P) pile = P; continue }
        kx += (N.x + N.w / 2) * c; ky += (N.y - 14) * c; kc += c
      }
      if (kc) { kx /= kc; ky /= kc; V.knotPile = null }
      else if (pile) { kx = pile.x - 10; ky = pile.y + 12; V.knotPile = pile }
      else {
        const P = vis.actors.get(a.parent)
        const slot = (V.seed % 5) - 2
        kx = P ? P.x + 34 + slot * 11 : V.kx; ky = P ? P.y + 44 + Math.abs(slot) * 6 : V.ky
        V.knotPile = null
      }
      if (!kc && !pile) { /* tucked by the parent: no tome avoidance needed */ }
      else for (const N of vis.nodes.values()) {
        if (!N.present || N.pileOf || kx < N.x - 10 || kx > N.x + N.w + 10 || ky < N.y - 10 || ky > N.y + N.h + 10) continue
        const dl = kx - (N.x - 10), dr = (N.x + N.w + 10) - kx, du = ky - (N.y - 10), dd = (N.y + N.h + 10) - ky
        const m = Math.min(dl, dr, du, dd)
        if (m === dl) kx -= m; else if (m === dr) kx += m; else if (m === du) ky -= m; else ky += m
      }
      V.kx = ease(V.kx, kx, 2, dt); V.ky = ease(V.ky, ky, 2, dt)
      V.gx = V.kx; V.gy = V.ky
      V.thrall = ''
      continue
    }
    const g = actorGoal(S, a, V, T)
    // a living thrall never drifts free of its parent: it stays within reach of the branch
    if (a.parent) {
      const P = vis.actors.get(a.parent)
      if (P) { const dx = g[0] - P.x, dy = g[1] - P.y, d = Math.hypot(dx, dy); if (d > 340) { g[0] = P.x + dx / d * 340; g[1] = P.y + dy / d * 340 } }
    }
    // choose the side once per target so the creature does not flip around a tome
    const act = focus.cur.get(a.id)
    const nid = act && act.node ? act.node : ''
    if (nid !== V.lastTarget) {
      V.lastTarget = nid
      const N = nid ? vis.nodes.get(nid) : null
      if (N) V.goalSide = V.x < N.x + N.w / 2 ? -1 : 1
    }
    freeSpot(g[0], g[1], V.r * 1.6); V.gx = isFinite(ptmp[0]) ? ptmp[0] : V.x; V.gy = isFinite(ptmp[1]) ? ptmp[1] : V.y
    if (!isFinite(V.x) || !isFinite(V.y)) { V.x = isFinite(V.gx) ? V.gx : 0; V.y = isFinite(V.gy) ? V.gy : 0; V.vx = 0; V.vy = 0 }
    // the thrall this actor oversees during an open agent act
    V.thrall = ''
    if (act && act.kind === 'agent' && !act.endT) for (const sub of S.actors.values()) if (sub.parent === a.id && sub.bornT >= act.startT && sub.bornT <= T && !sub.doneT) { V.thrall = sub.id; break }
  }
  for (const V of vis.actors.values()) if (!S.actors.has(V.id)) V.present = false
  // sessions keep a comfortable distance from each other
  const tops = []
  for (const V of vis.actors.values()) if (!V.parent && V.present) tops.push(V)
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    const a = tops[i], b = tops[j]
    let dx = b.gx - a.gx, dy = b.gy - a.gy
    const d = Math.hypot(dx, dy)
    if (d >= 180) continue
    if (d < 1) { dx = 0; dy = -1 } else { dx /= d; dy /= d }
    const push = 180 - d
    b.gx += dx * push; b.gy += dy * push
  }
}

// saccades: the gaze hops between the rows jostling on the target tome, with a short dwell on each
function hotRow(r) { return r.r > 0.2 || r.e > 0.2 || r.f > 0.2 }
function saccade(o, N, now, fx, fy) {
  if (now < o.sacAt) return
  const tick = Math.floor(now / 50)
  o.sacAt = now + 320 + rnd(o.id, tick) * 520
  let count = 0
  if (N && N.present) for (let i = 0; i < N.rows.length; i++) if (hotRow(N.rows[i])) count++
  if (!count) { o.sgx = fx; o.sgy = fy; return }
  let pick = Math.floor(rnd(o.id, tick + 7) * count)
  if (count > 1 && pick === o.sacI) pick = (pick + 1) % count
  o.sacI = pick
  for (let i = 0, k = 0; i < N.rows.length; i++) {
    if (!hotRow(N.rows[i])) continue
    if (k++ === pick) { o.sgx = N.x + 28 + rnd(o.id, tick + i) * Math.max(10, N.w - 60); o.sgy = N.y + HEAD_H + i * ROW_H + ROW_H / 2; return }
  }
}

function limbTarget(S, act, V, out) {
  const N = act.node ? vis.nodes.get(act.node) : null
  if (N && N.present) {
    const left = V.x < N.x + N.w / 2
    let y = N.y + HEAD_H / 2
    if (act.member) { const i = N.rows.findIndex(r => r.name === act.member); if (i >= 0) y = N.y + HEAD_H + i * ROW_H + ROW_H / 2 }
    out[0] = left ? N.x + 2 : N.x + N.w - 2; out[1] = y; out[2] = 1
    return
  }
  const pk = PROP_OF[act.kind]
  if (pk) {
    const p = propPos(V, pk)
    out[0] = p[0]; out[1] = p[1] - 12; out[2] = 2
    return
  }
  // a search without a target: scan the air ahead of the creature
  out[0] = V.x + V.r * 3.2 * (V.goalSide < 0 ? 1 : -1); out[1] = V.y + V.r * 0.8; out[2] = 0
}

function propPos(V, kind) {
  const d = V.r * 2.9
  switch (kind) {
    case 'flask': return [V.x - d, V.y + d * 0.9]
    case 'orb': return [V.x + d, V.y + d * 0.9]
    case 'pentagram': return [V.x, V.y + d * 1.35]
    default: return [V.x + d * 1.1, V.y - d * 0.6]
  }
}

const tmpT = [0, 0, 0]
function newLimb(id, act, A, eye) {
  return { id, actor: act.actor, eye, kind: act.kind, ext: 0, extT: 1, tx: A.x, ty: A.y, tvx: 0, tvy: 0, closed: 0, closedT: 0, active: 0, wait: 0, seed: hash(id) % 1000, prop: PROP_OF[act.kind] || '', tool: act.tool, sacAt: 0, sacI: -1, sgx: A.x, sgy: A.y, lx: A.x, ly: A.y, wanderAt: 0, wanderNode: '',
    side: -1, rootT: 0.44 + rnd(id, 'root') * 0.12, front: 0, frontT: 0, born: performance.now(), fresh: true, node: '', snake: !eye && !!act.node && (act.kind === 'edit' || act.kind === 'write'),
    tipEye: eye ? 1 : 0, tipClub: eye ? 0 : 1, scale: 0.7, blobs: [], ended: false }
}
// what a limb gulps when its act finishes: a blob the colour of the act, sucked in at the tip
const BLOB_COL = { edit: EMBER, write: EMBER, bash: SULFUR, tool: SULFUR, todo: SULFUR, read: CYAN, search: CYAN, web: SCRY, agent: BLOOD }

// a looking stalk wanders: it flits to tomes touched or glanced recently, dwells briefly, and returns to its real target
function wander(L, S, actorIds, T, now, exclude) {
  if (now < L.wanderAt) return
  if (L.wanderNode) { L.wanderNode = ''; L.wanderAt = now + 1100 + rnd(L.id, Math.floor(now / 30)) * 1500; return }
  const cands = []
  for (let k = 0; k < actorIds.length; k++) {
    const a = S.actors.get(actorIds[k])
    if (!a) continue
    for (let i = a.wake.length - 1; i >= 0 && i >= a.wake.length - 6; i--) if (T - a.wake[i].t < 25000 && a.wake[i].node !== exclude) cands.push(a.wake[i].node)
    for (let i = a.glances.length - 1; i >= 0 && i >= a.glances.length - 6; i--) if (T - a.glances[i].t < 15000 && a.glances[i].node !== exclude) cands.push(a.glances[i].node)
  }
  if (cands.length && rnd(L.id, Math.floor(now / 40)) < 0.7) {
    const pick = cands[Math.floor(rnd(L.id, Math.floor(now / 25)) * cands.length)]
    const N = vis.nodes.get(pick)
    if (N && N.present) { L.wanderNode = pick; L.wanderAt = now + 450 + rnd(L.id, Math.floor(now / 60)) * 600; return }
  }
  L.wanderAt = now + 700 + rnd(L.id, Math.floor(now / 35)) * 900
}

function syncLimb(L, act, A, S, T, now, ended) {
  L.seen = true
  limbTarget(S, act, A, tmpT)
  L.gx = tmpT[0]; L.gy = tmpT[1]; L.mode = tmpT[2]
  L.node = act.node || ''
  // the root side is chosen once, while the limb is still retracted, and kept for its whole life
  if (L.side < 0 || L.ext < 0.1) L.side = sideOf(A, L.gx, L.gy, L)
  // does the target still lie in front of that side? an arm reaching round the body goes behind it
  limbRoot(A, L)
  const fdx = L.gx - A.x, fdy = L.gy - A.y, fd = Math.hypot(fdx, fdy) || 1
  L.facing = (fdx * ROOT[2] + fdy * ROOT[3]) / fd
  let lookNode = act.node ? vis.nodes.get(act.node) : null
  if (L.eye && !ended) {
    wander(L, S, L.watch || [act.actor], T, now, act.node)
    const W = L.wanderNode ? vis.nodes.get(L.wanderNode) : null
    if (W && W.present) { const left = A.x < W.x + W.w / 2; L.gx = left ? W.x + 2 : W.x + W.w - 2; L.gy = W.y + HEAD_H / 2; lookNode = W }
  } else L.wanderNode = ''
  if (L.eye) saccade(L, lookNode, now, L.gx, L.gy)
  // heavy reading (a read act open, or a tome read again and again) scans the lines like text; light glancing saccades
  const reading = act.kind === 'read' && (!ended || since(act, T) < LIMB_LINGER)
  if (L.eye && lookNode && (reading || (!ended && lookNode.tRead > 0.7)) && motion() > 0.02) readScan(L, lookNode, now); else L.scanU = undefined
  if (L.eye && lookNode && !ended) { lookNode.gazeT = 1; L.lookId = lookNode.id } else L.lookId = ''
}
function readScan(L, N, now) {
  let n = 0, first = -1
  for (let i = 0; i < N.rows.length; i++) if (hotRow(N.rows[i])) { if (first < 0) first = i; n++ }
  const period = 650
  if (L.scanT0 === undefined || now - L.scanAt > 1500 || L.scanNode !== N.id) { L.scanT0 = now; L.scanNode = N.id }
  L.scanAt = now
  const e = now - L.scanT0, line = Math.floor(e / period), u = (e % period) / period
  L.scanU = u
  // a blink every few lines, as a reader does
  if (line !== L.scanLine) { L.scanLine = line; if (line > 0 && line % 4 === 0) L.blinkAt = now }
  // left to right along the row, a quick return (the eased gaze snaps back), one hot row further each line
  let ri = -1
  if (n) { let k = line % n; for (let i = first; i < N.rows.length; i++) if (hotRow(N.rows[i])) { if (!k--) { ri = i; break } } }
  const x0 = N.x + 28, x1 = N.x + Math.max(40, N.w - 30)
  L.sgx = x0 + (x1 - x0) * u
  L.sgy = ri >= 0 && N.h > HEAD_H + (ri + 1) * ROW_H ? N.y + HEAD_H + ri * ROW_H + ROW_H / 2 : N.y + HEAD_H / 2
  L.sacAt = now + 60
}
// blinks: a quick one whenever an eye moves on to another tome, rare idle ones every 4 to 9 s (seeded per eye)
function blinkStep(o, key, now, seed) {
  const mo = motion() > 0.02
  if (o.eyeKey !== key) { if (o.eyeKey !== undefined && mo) o.blinkAt = now; o.eyeKey = key }
  if (o.nextBlink === undefined || now > o.nextBlink) { if (o.nextBlink !== undefined && mo) o.blinkAt = now; o.nextBlink = now + 4000 + rnd(seed, Math.floor(now / 100)) * 5000 }
  const t = now - (o.blinkAt || -1e9)
  o.blink = t >= 0 && t < 180 ? smooth(1 - Math.abs(t - 90) / 90) : 0
}

// how long ago an act ended, as the viewer experienced it: live, a batch that reached the page late still counts
// from its arrival, so quick acts delivered after the fact are not skipped
function since(act, T) { const a = T - act.endT; return view.live && act.arrivedT ? Math.min(a, Date.now() - act.arrivedT) : a }
function syncLimbs(S, T, now, dt) {
  for (const L of vis.limbs.values()) L.seen = false
  for (const act of S.acts.values()) {
    if (act.startT > T) continue
    const ended = act.endT > 0
    const A = vis.actors.get(act.actor)
    if (!A) { limbLog.noActor++; continue }
    // summoning is a moment: the tentacle reaches the pentagram, then retracts while the thrall works
    const summonOver = act.kind === 'agent' && T - act.startT > SUMMON_MS
    const inBurst = ended && !L_eye(act) && focus.burst.has(act.id) && T - focus.lastEdit.get(act.actor) < BURST_MS
    // overseeing: after the summoning the parent watches its thrall with an eye stalk that wanders over the thrall's work
    if (summonOver && !ended) {
      const oid = act.id + '~'
      let O = vis.limbs.get(oid)
      if (!O) { O = newLimb(oid, act, A, true); O.prop = ''; O.kind = 'oversee'; vis.limbs.set(oid, O) }
      O.watch = A.thrall ? [act.actor, A.thrall] : [act.actor]
      syncLimb(O, act, A, S, T, now, false)
      if (!O.wanderNode) {
        const Th = A.thrall ? vis.actors.get(A.thrall) : null
        if (Th) { O.gx = Th.x + (A.x < Th.x ? -Th.r * 1.6 : Th.r * 1.6); O.gy = Th.y - Th.r * 0.4; O.mode = 0; O.sgx = Th.x; O.sgy = Th.y }
      }
      O.waitT = 0; O.activeT = 1; O.closedT = 0; O.extT = 1
    }
    // web acts and target-less searches look through a portal instead of a plain stalk
    if (act.kind === 'web' || (act.kind === 'search' && !act.node) || (act.kind === 'read' && !act.node && act.detail)) continue
    if (superseded.has(act.id)) { if (!vis.limbs.has(act.id)) limbLog.superseded++; continue }
    let L = vis.limbs.get(act.id)
    if (!L) {
      if ((ended && since(act, T) > (act.node ? LIMB_LINGER : LINGER) && !inBurst) || summonOver) { if (!summonOver && !limbLog.late.has(act.id)) { limbLog.late.add(act.id); limbLog.lateN++ }; continue }
      limbLog.created++
      const eye = L_eye(act)
      // a file whose limb is still out is re-touched: that limb is refreshed (re-keyed to the new act) rather than
      // a duplicate spawned beside it; a new file gets a new limb while the old ones keep theirs for a while
      let R = null
      if (act.node) for (const o of vis.limbs.values()) if (o.actor === act.actor && o.node === act.node && o.eye === eye && o.kind !== 'oversee' && o.kind !== 'drag' && o.kind !== 'portal' && o.ext > 0.1) { R = o; break }
      if (R) {
        superseded.add(R.id); vis.limbs.delete(R.id)
        R.id = act.id; R.kind = act.kind; R.tool = act.tool; R.ended = false; R.snake = !eye && (act.kind === 'edit' || act.kind === 'write'); R.prop = PROP_OF[act.kind] || ''
        vis.limbs.set(act.id, R); L = R
      } else { L = newLimb(act.id, act, A, eye); vis.limbs.set(act.id, L) }
    }
    syncLimb(L, act, A, S, T, now, ended)
    // the moment the act finishes, the limb gulps its result
    if (ended && !L.ended && L.ext > 0.5 && motion() > 0.02 && !act.failed) L.blobs.push({ u: 0, col: BLOB_COL[act.kind] || BONE, k: rnd(act.id, 'blob') })
    L.ended = ended
    const waiting = !ended && act.waitT > 0
    L.waitT = waiting ? 1 : 0
    L.activeT = ended ? 0 : 1
    const actor = S.actors.get(act.actor)
    const thinking = actor && actor.thinking
    if (!ended) { L.closedT = 0; L.extT = summonOver ? 0 : 1 }
    else if (L.eye) { L.closedT = thinking && !act.node ? 1 : 0; L.extT = since(act, T) > (act.node ? LIMB_LINGER : thinking ? 1500 : 1200) ? 0 : 1 }
    else L.extT = inBurst || since(act, T) < (act.node ? LIMB_LINGER : LINGER) ? 1 : 0
    if (L.prop) { let P = vis.props.get(act.actor + ':' + L.prop); if (!P) { P = { actor: act.actor, kind: L.prop, alpha: 0, active: 0 }; vis.props.set(act.actor + ':' + L.prop, P) }; P.want = Math.max(P.want || 0, L.extT); P.activeT = Math.max(P.activeT || 0, L.activeT * L.extT) }
  }
  syncPortals(S, T, now, dt)
  syncDrags(now, dt)
  // one limb per file and creature: the newest act's limb keeps the file, older ones on it retract; and a
  // creature holds at most 8 eye stalks and 6 tentacles out at once, the oldest retracting first
  perFile.clear(); perActor.clear()
  for (const L of vis.limbs.values()) {
    if (L.extT === 0 || !L.node || L.kind === 'oversee' || L.kind === 'drag' || L.kind === 'feed') continue
    const key = L.actor + (L.eye ? '|e|' : '|t|') + L.node, h = perFile.get(key)
    // a retired limb's act is superseded for good, so it can neither respawn nor re-key the file's live limb
    if (!h || L.born > h.born) { if (h) { h.extT = 0; superseded.add(h.id) }; perFile.set(key, L) } else { L.extT = 0; superseded.add(L.id) }
  }
  for (const L of vis.limbs.values()) {
    if (L.extT === 0 || L.kind === 'oversee' || L.kind === 'drag' || L.kind === 'feed') continue
    const key = L.actor + (L.eye ? '|e' : '|t'); let l = perActor.get(key); if (!l) { l = []; perActor.set(key, l) }; l.push(L)
  }
  // over the cap, the idle ones (acts ended) retract first, oldest first; working limbs stay
  for (const [key, l] of perActor) { const cap = key.endsWith('|e') ? 8 : 6; if (l.length > cap) { l.sort((a, b) => (b.activeT - a.activeT) || (b.born - a.born)); for (let i = cap; i < l.length; i++) { l[i].extT = 0; superseded.add(l[i].id) } } }
  for (const [id, L] of vis.limbs) {
    if (!L.seen && L.kind !== 'feed') L.extT = 0
    if (L.extT === 0 && L.ext < 0.02) { vis.limbs.delete(id); if (L.node) superseded.add(id) }
  }
  if (superseded.size > 4000) superseded.clear()
  // one front arm per pyramid side: the longest-lived extended one; the rest emerge from behind the body
  holders.clear()
  for (const L of vis.limbs.values()) {
    if (L.extT === 0 || L.facing < 0.35) continue
    const key = L.actor + ':' + L.side, h = holders.get(key)
    if (!h || L.born < h.born) holders.set(key, L)
  }
  for (const L of vis.limbs.values()) {
    L.frontT = holders.get(L.actor + ':' + L.side) === L ? 1 : 0
    if (L.fresh) { L.front = L.frontT; L.fresh = false }
  }
  // stable fan indices per actor for the swimming posture
  fans.clear()
  for (const L of vis.limbs.values()) { if (L.extT === 0) continue; let l = fans.get(L.actor); if (!l) { l = []; fans.set(L.actor, l) }; l.push(L) }
  for (const l of fans.values()) { l.sort((a, b) => a.born - b.born); for (let i = 0; i < l.length; i++) { l[i].idx = i; l[i].cnt = l.length } }
}
const holders = new Map(), fans = new Map(), perFile = new Map(), perActor = new Map(), superseded = new Set()
const limbLog = { created: 0, superseded: 0, noActor: 0, lateN: 0, late: new Set() }

// ---------- portals: an eye stalk opens a rift into another universe and peers in ----------
// web acts, searches with no code target, and contemplation (thinking > 1.5 s with nothing open)

const PORTAL_COL = { web: SCRY, search: '#8CD36B', think: VIOLET, file: '#8FA3B8' }
const STARS = new Float32Array(300), MOTES = new Float32Array(24)
for (let i = 0; i < STARS.length; i++) STARS[i] = rnd('star', i)
for (let i = 0; i < MOTES.length; i++) MOTES[i] = rnd('mote', i)

// what a session is looking at beyond the map: a web page, a search with no code target, a file outside the
// project, or its own thoughts. Each has a source key: the same source reappears at the same place.
function portalWant(a, T) {
  const act = focus.cur.get(a.id)
  if (act && (!act.endT || since(act, T) < LIMB_LINGER)) {
    if (act.kind === 'web') { const m = /^[a-z]+:\/\/([^/\s]+)/i.exec(act.detail || ''); return { kind: 'web', src: 'web:' + (m ? m[1].toLowerCase() : 'web'), label: m ? m[1] : 'the web' } }
    if (act.kind === 'search' && !act.node) return { kind: 'search', src: 'search:' + (act.detail || '').slice(0, 48), label: (act.detail || 'search').slice(0, 30) }
    if (act.kind === 'read' && !act.node && act.detail) { const p = String(act.detail).split(String.fromCharCode(92)).join('/'); const dir = p.slice(0, p.lastIndexOf('/')); return { kind: 'file', src: 'file:' + dir.toLowerCase(), label: dir.split('/').slice(-2).join('/') } }
    if (!act.endT) return null
  }
  return a.thinking && T - a.thinkT > 1500 ? { kind: 'think', src: 'think:' + a.id, label: '' } : null
}
// a spot in empty space near the creature: the direction with the most room from the tomes
function pickPortalSpot(A, P) {
  const d = A.r * 5.5
  let best = 0, bs = -1e9
  for (let k = 0; k < 8; k++) {
    const an = k * Math.PI / 4 + 0.3, px = A.x + Math.cos(an) * d, py = A.y + Math.sin(an) * d
    let score = 400
    for (const N of vis.nodes.values()) {
      if (!N.present) continue
      const dx = Math.max(N.x - px, 0, px - N.x - N.w), dy = Math.max(N.y - py, 0, py - N.y - N.h)
      score = Math.min(score, Math.hypot(dx, dy))
    }
    if (Math.sin(an) < 0) score += 25
    if (score > bs) { bs = score; best = an }
  }
  P.ox = Math.cos(best) * d; P.oy = Math.sin(best) * d
}

// portals for outside sources sit on their own orbit beyond the outermost ring, in a slot hashed from the
// source (24 slots, the next free one if taken), turning slowly with the web; a thinking portal stays by its
// creature. Reading stalks reach out to them. They linger like limbs and fade, and a source read again reuses
// its portal and slot.
const PORTAL_SLOTS = 24
function portalRingPos(P, out) {
  const R = pack.outerR + 150
  const a = -Math.PI / 2 + (P.slot + 0.5) * Math.PI * 2 / PORTAL_SLOTS + (pack.phase[0] || 0) * 0.35
  return projectPolar(a, R, out)
}
function syncPortals(S, T, now, dt) {
  for (const P of vis.portals.values()) P.wanted = false
  for (const a of S.actors.values()) {
    const A = vis.actors.get(a.id)
    if (!A) continue
    const want = A.present && !A.knotT ? portalWant(a, T) : null
    if (!want) continue
    let P = vis.portals.get(want.src)
    if (!P) {
      P = { actor: a.id, src: want.src, kind: want.kind, label: want.label, open: 0, tOpen: 0, ox: 0, oy: 0, col: rgb(PORTAL_COL[want.kind]).slice(), seed: hash(want.src) % 1000, lid: 'portal~' + want.src, slot: -1, lastT: now }
      if (want.kind === 'think') pickPortalSpot(A, P)
      else {
        // a deterministic slot from the source, stepping past slots other live portals hold
        const taken = new Set(); for (const o of vis.portals.values()) if (o.slot >= 0) taken.add(o.slot)
        let s = hash(want.src) % PORTAL_SLOTS; for (let k = 0; k < PORTAL_SLOTS && taken.has(s); k++) s = (s + 1) % PORTAL_SLOTS
        P.slot = s
      }
      vis.portals.set(want.src, P)
    }
    P.actor = a.id; P.wanted = true; P.lastT = now; P.kind = want.kind; P.label = want.label
  }
  for (const [id, P] of vis.portals) {
    const A = vis.actors.get(P.actor)
    if (!A) { P.tOpen = 0; P.open = ease(P.open, 0, 2, dt); if (P.open < 0.01) vis.portals.delete(id); continue }
    const alive = P.wanted || now - P.lastT < LIMB_LINGER
    P.tOpen = alive ? 1 : 0
    const mc = rgb(PORTAL_COL[P.kind])
    for (let i = 0; i < 3; i++) P.col[i] = ease(P.col[i], mc[i], 4, dt)
    if (P.slot >= 0 && pack.init) { portalRingPos(P, prj); P.ox = prj[0] - A.x; P.oy = prj[1] - A.y }
    // the stalk: its bulb hovers at the near rim and peers inside
    let L = vis.limbs.get(P.lid)
    if (alive && !L) { L = newLimb(P.lid, { actor: P.actor, kind: 'portal', tool: '', node: '' }, A, true); L.prop = ''; vis.limbs.set(P.lid, L) }
    if (!L) { P.open = ease(P.open, P.tOpen, P.tOpen ? 3.2 : 1.5, dt); if (!P.tOpen && P.open < 0.01) vis.portals.delete(id); continue }
    L.actor = P.actor
    const cx = A.x + P.ox, cy = A.y + P.oy
    const dx = A.x - cx, dy = A.y - cy, dl = Math.hypot(dx, dy) || 1
    L.seen = true; L.node = ''; L.mode = 0
    L.gx = cx + dx / dl * 30; L.gy = cy + dy / dl * 30
    if (L.side < 0 || L.ext < 0.1) L.side = sideOf(A, L.gx, L.gy, L)
    limbRoot(A, L)
    L.facing = ((L.gx - A.x) * ROOT[2] + (L.gy - A.y) * ROOT[3]) / (Math.hypot(L.gx - A.x, L.gy - A.y) || 1)
    L.activeT = P.wanted ? 1 : 0; L.waitT = 0; L.closedT = 0
    L.extT = alive || P.open > 0.05 ? 1 : 0
    L.sacAt = now + 1e9
    L.sgx = cx + Math.sin(now * 0.0009 + P.seed) * 9; L.sgy = cy + Math.cos(now * 0.0012 + P.seed) * 6
    P.open = ease(P.open, P.tOpen, P.tOpen ? 3.2 : 1.5, dt)
    if (!P.tOpen && P.open < 0.01) vis.portals.delete(id)
  }
}

function drawPortal(P, A, now) {
  const o = smooth(P.open)
  if (o < 0.01) return
  const q = Q(), mo = motion(), z = view.cam.z
  const cx = A.x + P.ox, cy = A.y + P.oy
  const rx = 36 * (0.25 + 0.75 * o), ry = 23 * o * o
  const col = P.col
  g.save()
  g.translate(cx, cy); g.rotate(-0.3 + Math.sin(now * 0.0004 + P.seed) * 0.06 * mo)
  g.globalAlpha = A.alpha
  // the inside: another universe, clipped to the rift
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  g.save(); g.clip()
  g.fillStyle = '#04060B'; g.fillRect(-rx, -ry, rx * 2, ry * 2)
  if (q >= 1) {
    const gr = g.createRadialGradient(rx * 0.2, -ry * 0.2, 2, 0, 0, rx * 1.1)
    gr.addColorStop(0, rgbaArr(col, 0.4)); gr.addColorStop(0.55, rgbaArr(col, 0.12)); gr.addColorStop(1, rgbaArr(col, 0))
    g.fillStyle = gr; g.fillRect(-rx, -ry, rx * 2, ry * 2)
    g.save(); g.rotate(now * 0.00025 * mo + P.seed)
    g.fillStyle = rgbaArr(col, 0.09); g.beginPath(); g.ellipse(rx * 0.15, 0, rx * 0.9, ry * 0.35, 0.6, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.ellipse(-rx * 0.1, ry * 0.1, rx * 0.7, ry * 0.25, -0.9, 0, Math.PI * 2); g.fill()
    g.restore()
  }
  // stars in three parallax layers (precomputed positions, scrolling)
  for (let layer = 0; layer < 3; layer++) {
    const sp = (0.004 + layer * 0.006) * mo, sz = 0.6 + layer * 0.45
    g.fillStyle = rgba(BONE, 0.35 + layer * 0.25)
    for (let i = layer * 50; i < layer * 50 + 50; i++) {
      const u = (STARS[i * 2] + now * 0.00001 * sp * 60) % 1, v = STARS[i * 2 + 1]
      g.fillRect(u * rx * 2.4 - rx * 1.2, v * ry * 2.4 - ry * 1.2, sz, sz)
    }
  }
  // drifting motes
  g.fillStyle = rgbaArr(col, 0.8)
  for (let k = 0; k < 8; k++) {
    const ph = MOTES[k * 3] * 6.28, r = 0.3 + MOTES[k * 3 + 1] * 0.6, sp2 = 0.0004 + MOTES[k * 3 + 2] * 0.0005
    const a = ph + now * sp2 * mo
    g.beginPath(); g.arc(Math.cos(a) * rx * r, Math.sin(a * 1.3) * ry * r, 1.1, 0, Math.PI * 2); g.fill()
  }
  g.restore()
  // the rim
  g.lineWidth = Math.max(1.6, 1.4 / z)
  if (q === 2) { g.shadowColor = rgbaArr(col, 0.9); g.shadowBlur = 18 * z }
  g.strokeStyle = rgbaArr(col, 0.6 + 0.4 * o); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.stroke()
  g.shadowBlur = 0
  g.strokeStyle = rgbaArr(col, 0.3); g.lineWidth = Math.max(0.8, 0.7 / z); g.beginPath(); g.ellipse(0, 0, rx + 4, ry + 4, 0, 0, Math.PI * 2); g.stroke()
  g.restore()
}

// tentacles only for acts that change things; anything read-only (look) gets an eye stalk
function L_eye(act) { return !!EYE_KINDS[act.kind] || (act.look && act.kind !== 'agent') }

