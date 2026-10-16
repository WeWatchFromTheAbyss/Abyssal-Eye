// Abyssal Eye live view, part 2 of 4: tomes, edges, clustering, piles, wards, radial layout, limbs and actors.
'use strict'
function syncEdges(S, T) {
  for (const E of vis.edges.values()) E.seen = false
  for (const g of S.edges.values()) {
    if (g.firstT > T) continue
    const A = vis.nodes.get(g.from), B = vis.nodes.get(g.to)
    if (!A || !B) continue
    let E = vis.edges.get(g.key)
    if (!E) { E = { key: g.key, a: A, b: B, cross: g.cross, prog: 0, glow: 0, alpha: 0, dying: 0, pend: 0, seed: hash(g.key) % 997, fresh: false, baseline: g.baseline, port: ((hash(g.key) % 7) - 3) / 3, tProg: 0, tGlow: 0, tAlpha: 0, tDying: 0, tPend: 0 }; vis.edges.set(g.key, E); layout.awake = 40 }
    E.seen = true; E.a = A; E.b = B; E.cross = g.cross; E.baseline = g.baseline
    // a pending thread that becomes real draws itself on from the start
    if (g.state === 'live' && E.lastState === 'pending' && g.liveT > 0) E.prog = 0
    E.lastState = g.state
    const present = A.present && B.present
    E.fresh = g.liveT > 0
    if (!present) { E.tAlpha = 0; E.tPend = 0; E.tDying = 0; continue }
    if (g.state === 'pending') { E.tPend = 1; E.tAlpha = 1; E.tProg = 1; E.tGlow = 0; E.tDying = 0 }
    else if (g.state === 'gone') { E.tPend = 0; E.tDying = 1; E.tAlpha = T - g.goneT < 3500 ? 1 : 0; E.tGlow = 0 }
    else {
      E.tPend = 0; E.tDying = 0; E.tAlpha = 1
      if (g.liveT > 0) {
        E.tProg = c01((T - g.liveT) / 1300)
        E.tGlow = decay(T, g.liveT, g.cross ? 24000 : 10000)
      } else { E.tProg = 1; E.tGlow = 0 }
    }
  }
  for (const [k, E] of vis.edges) if (!E.seen) { E.tAlpha = 0; if (E.alpha < 0.01 && !S.edges.has(k)) vis.edges.delete(k) }
}

// ---------- the shortest unique names: shared words dropped, a minimal distinguishing form, stable ----------
const shorts = { sig: '', map: new Map() }
function splitWords(s) { return s.replace(/\.[A-Za-z0-9]+$/, '').split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean) }
function shortNames(S) {
  let sig = ''
  const names = []
  for (const n of S.nodes.values()) if (!n.goneT) { names.push([n.id, n.name]); sig += n.id + ',' }
  if (sig === shorts.sig) return
  shorts.sig = sig; shorts.map.clear()
  const freq = new Map(), words = new Map()
  for (const [id, nm] of names) { const ws = splitWords(nm); words.set(id, ws); for (const w of new Set(ws.map(x => x.toLowerCase()))) freq.set(w, (freq.get(w) || 0) + 1) }
  const N = names.length
  for (const [id, nm] of names) {
    const ws = words.get(id)
    if (ws.length <= 1) { shorts.map.set(id, nm); continue }
    // words carried by many names (Manager, Controller, a shared prefix) are dropped; at least one word stays
    let keep = ws.filter(w => { const f = freq.get(w.toLowerCase()) || 0; return !(f >= 4 && f >= N * 0.1) })
    if (!keep.length) keep = [ws[ws.length - 1]]
    shorts.map.set(id, keep.join(''))
  }
  // a short form two tomes would share goes back to the full names
  const count = new Map()
  for (const s of shorts.map.values()) count.set(s, (count.get(s) || 0) + 1)
  for (const [id, nm] of names) if ((count.get(shorts.map.get(id)) || 0) > 1) shorts.map.set(id, nm)
}
function shortOf(id, name) { return shorts.map.get(id) || name }
const editing = new Set()
function syncNodes(S, T) {
  let shown = 0
  shortNames(S)
  // the tomes under an open edit right now: their borders wobble and ooze
  editing.clear()
  for (const act of S.acts.values()) if (!act.endT && act.node && act.startT <= T && (act.kind === 'edit' || act.kind === 'write')) editing.add(act.node)
  let presentN = 0
  for (const V of vis.nodes.values()) if (V.present) { presentN++; if (!V.tPile) shown++ }
  vis.presentN = presentN
  vis.shown = shown
  for (const n of S.nodes.values()) {
    let V = vis.nodes.get(n.id)
    const gone = n.goneT > 0
    const present = n.bornT <= T && (!gone || T - n.goneT < 5000)
    if (!V) { if (!present) continue; V = spawnNode(S, n); vis.nodes.set(n.id, V); layout.awake = 60 }
    if (V.present !== present) layout.awake = 60
    V.present = present; V.alive = present && !gone
    // fading and folding by idle time: dims toward 0.25, folds to its header after 20 min, piles up after 40 min
    const idle = T - Math.max(n.readT, n.editT, n.glanceT, n.bornT)
    V.idleMs = idle
    const touch = Math.max(n.readT, n.editT)
    if (V.lastTouch !== undefined && touch > V.lastTouch && T - touch < 400) { rippleWeb(V.folder, performance.now()); if (n.editT === touch && motion() > 0.02) { V.shake = 1; V.spat = 1 } }
    V.shake = ease(V.shake || 0, 0, 5, 1 / 60)
    V.lastTouch = touch
    const hov = view.hover === V
    const tn = focus.taint.get(n.id)
    V.taint = tn ? tn.k : 0; if (tn) { V.taintCol = tn.col; V.taintRow = tn.member }
    // tainted: no fading, folding or piling while the taint lasts
    V.tDim = hov || V.taint > 0 ? 1 : 1 - 0.75 * smooth((idle - 600000) / 1200000)
    // a crowded map folds and piles its quiet tomes sooner: with hundreds of tomes present, a few idle minutes suffice
    const foldK = clamp(40 / Math.max(1, vis.presentN || 0), 0.1, 1)
    V.tFold = idle > 600000 * foldK && !V.taint ? 1 : 0
    V.tPile = !gone && idle > 900000 * foldK && !V.taint ? 1 : 0
    if (V.pin) { V.tPile = 0 }
    if (V.tPile) V.alive = false
    V.name = n.name; V.kind = n.kind; V.file = n.file; V.lines = n.lines
    V.short = shortOf(n.id, n.name)
    if (V.pin === undefined) V.pin = pins.map.get(n.id) || null
    const tWob = motion() > 0.02 ? (editing.has(n.id) ? 1 : T - n.editT < 1500 ? 0.6 : V.taint > 0 ? 0.25 * V.taint : 0) : 0
    const nowZ = performance.now()
    for (let zi = 0; zi < focus.zaps.length; zi++) {
      const zp = focus.zaps[zi]
      if (zp.node !== n.id) continue
      V.zapT = nowZ; V.zapCol = zp.col; V.zapRow = zp.member
      if (V.pileOf) { const P = vis.piles.get(V.pileOf); if (P) { P.zapT = nowZ; P.zapCol = zp.col } }
    }
    if (editing.has(n.id) && V.zapT) V.zapT = Math.max(V.zapT, nowZ - 600) // an open edit keeps it live
    V.zap = V.zapT && motion() > 0.02 ? clamp(1 - (nowZ - V.zapT) / 1400, 0, 1) : 0
    V.wob = ease(V.wob || 0, Math.max(tWob, V.zap), tWob || V.zap ? 6 : 2.5, 1 / 60)
    if (V.folder !== n.folder) { V.folder = n.folder; layout.awake = 60 }
    V.tRead = Math.max(decay(T, n.readT, 9000), decay(T, n.glanceT, 3500) * 0.6)
    V.tEdit = decay(T, n.editT, 14000)
    V.tExt = decay(T, n.extT, 14000)
    V.tFresh = decay(T, n.bornT, 7000)
    V.tGhost = gone ? 1 : 0
    syncRows(V, n, T)
    // attention: the decayed hit score, boosted while a limb is on the tome, and the session it belongs to
    attOut.sess = {}
    attention(n, T, attOut)
    V.attn = attOut[0] + (focus.rows.has(n.id) ? 1.5 : 0)
    V.attnSess = attOut[1]
    // a tome under an act is forced in: it leaves its pile or fold at once and joins the inner orbit
    const pulled = focus.pull.get(n.id)
    V.forced = !!pulled
    if (pulled) { V.attn = Math.max(V.attn, ATT_IN + 0.6); V.attnSess = pulled; V.tPile = 0; V.tFold = 0; V.alive = present && !gone }
    // mass: size plus the work accumulated on it; heavy tomes are affixed, light ones stay loose
    V.mass = clamp(0.6 + n.lines / 300 + n.members.length / 12 + (n.work || 0) * 0.12, 0.6, 3)
  }
  for (const V of vis.nodes.values()) if (!S.nodes.has(V.id)) { V.present = false; V.alive = false }
  focus.zaps.length = 0
  syncPiles()
}
const attOut = [0, '']

// whirlpools: one per active session, gathering the tomes with high attention into a slow orbit; the tomes the
// session touched but has let go of rest in a sleeping cloud nearby, watched by a dozing caretaker eye
const ATT_IN = 1.4, ATT_OUT = 0.5
const working = new Set()
function syncWhirls(S, T, now, dt) {
  for (const W of vis.whirls.values()) { W.n = 0; W.cx0 = 0; W.cy0 = 0; W.cn = 0; W.sx0 = 0; W.sy0 = 0; W.touched = false; W.x0 = 1e9; W.y0 = 1e9; W.x1 = -1e9; W.y1 = -1e9 }
  for (const V of vis.nodes.values()) {
    if (!V.present || !V.attnSess) { V.pull = ease(V.pull || 0, 0, 2, dt); continue }
    const A = vis.actors.get(V.attnSess)
    if (!A || !A.present) { V.pull = ease(V.pull || 0, 0, 2, dt); continue }
    let W = vis.whirls.get(V.attnSess)
    if (!W) { W = { sess: V.attnSess, x: A.x, y: A.y + 200, tx: A.x, ty: A.y + 200, cx: A.x + 420, cy: A.y + 200, alpha: 0, calpha: 0, rot: 0, eyeOpen: 0.15, n: 0, cn: 0, x0: 0, y0: 0, x1: 0, y1: 0, touched: false, blink: 0, ex: 0, ey: 0, ew: 0, eh: 0 }; vis.whirls.set(V.attnSess, W) }
    // soft membership with hysteresis: in above ATT_IN, out below ATT_OUT, gravity proportional in between
    const want = V.attn > ATT_IN ? 1 : V.attn < ATT_OUT ? 0 : (V.pull || 0) > 0.5 ? 1 : 0
    V.pull = ease(V.pull || 0, want, V.forced ? 3.5 : 1.2, dt)
    const cx = V.x + V.w / 2, cy = V.y + V.h / 2
    if (V.pull > 0.5) { W.n++; W.cx0 += cx; W.cy0 += cy }
    else if (V.attn > 0.03) {
      W.cn++; W.sx0 += cx; W.sy0 += cy
      W.x0 = Math.min(W.x0, V.x); W.y0 = Math.min(W.y0, V.y); W.x1 = Math.max(W.x1, V.x + V.w); W.y1 = Math.max(W.y1, V.y + V.h)
      const n = S.nodes.get(V.id)
      if (n && (T - n.readT < 1500 || T - n.editT < 1500 || T - n.glanceT < 1500)) W.touched = true
    }
  }
  // which sessions have a limb out right now: only those whirlpools keep turning
  working.clear()
  for (const L of vis.limbs.values()) { if (L.extT === 0 || L.activeT < 0.5) continue; let P = vis.actors.get(L.actor); for (let k = 0; k < 6 && P && P.parent; k++) P = vis.actors.get(P.parent); if (P) working.add(P.id) }
  for (const [sess, W] of vis.whirls) {
    const A = vis.actors.get(sess)
    const alive = A && A.present
    W.work = ease(W.work || 0, working.has(sess) ? 1 : 0, 1.5, dt)
    // the rings turn while the session is active and for 20 s after; the spin starts and stops smoothly
    const cur = focus.cur.get(sess)
    if (working.has(sess) || (cur && !cur.endT)) W.actAt = now
    W.spin = ease(W.spin || 0, now - (W.actAt || -1e9) < 20000 ? 1 : 0, 0.5, dt)
    if (W.work > 0.02 && W.n) layout.awake = Math.max(layout.awake, 30)
    // the centre is set where the members are when the membership changes, and holds still otherwise: a centre
    // chasing its own orbiting members would drift forever
    if (W.n && W.n !== W.lastN) { W.tx = W.cx0 / W.n; W.ty = W.cy0 / W.n; W.lastN = W.n }
    if (!W.n) W.lastN = 0
    if (!isFinite(W.tx) || !isFinite(W.ty)) { W.tx = isFinite(W.x) ? W.x : pack.cx; W.ty = isFinite(W.y) ? W.y : pack.cy }
    if (!isFinite(W.x) || !isFinite(W.y)) { W.x = W.tx; W.y = W.ty }
    W.x = ease(W.x, W.tx, 1.5, dt); W.y = ease(W.y, W.ty, 1.5, dt)
    W.alpha = ease(W.alpha, alive && W.n ? 1 : 0, 1.5, dt)
    // the sleeping cloud rests below the whirl (a fixed offset, so the layout has nothing to chase)
    // ... and it only re-anchors when the whirl has wandered far, so settled sleepers are not dragged about
    if (Math.hypot(W.x - W.cx, W.y + 320 - W.cy) > 90) { W.cx = ease(W.cx, W.x, 1.2, dt); W.cy = ease(W.cy, W.y + 320, 1.2, dt) }
    W.calpha = ease(W.calpha, alive && W.cn ? 1 : 0, 1.5, dt)
    // the sleepers' ring outline (the ellipse drawn is W.ew * 0.74 by W.eh * 0.78), centred on the vortex
    if (W.cn && W.cloudR) { const R = W.cloudR + 50; W.ex = ease(W.ex, W.x - R / 0.74, 3, dt); W.ey = ease(W.ey, W.y - R / 0.78, 3, dt); W.ew = ease(W.ew, 2 * R / 0.74, 3, dt); W.eh = ease(W.eh, 2 * R / 0.78, 3, dt) }
    W.rot += 0.12 * motion() * dt
    // the caretaker dozes, breathing; it opens briefly when a sleeper is touched
    if (W.touched) W.blink = 1
    W.blink = ease(W.blink, 0, 1.6, dt)
    W.eyeOpen = ease(W.eyeOpen, 0.14 + 0.05 * Math.sin(now * 0.0012) + 0.8 * W.blink, 6, dt)
    if (W.alpha < 0.01 && W.calpha < 0.01 && !alive) vis.whirls.delete(sess)
  }
}

function drawWhirls(now) {
  const z = view.cam.z, q = Q()
  for (const W of vis.whirls.values()) {
    let vx = W.x, vy = W.y
    if (W.sat === false && pack.init) { projectPolar(0, 0, prj); vx = prj[0]; vy = prj[1] }
    if (W.alpha > 0.02 && inView(vx - 160, vy - 160, 320, 320)) {
      g.save(); g.translate(vx, vy); g.scale(1, tilt.cos); g.globalAlpha = W.alpha
      // a little darkness at the core
      const gr = g.createRadialGradient(0, 0, 4, 0, 0, 90); gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 90, 0, Math.PI * 2); g.fill()
      // three faint spiral arms, slowly turning
      g.strokeStyle = rgba(BONE, 0.09); g.lineWidth = Math.max(1.2, 1.4 / z); g.lineCap = 'round'
      g.beginPath()
      for (let k = 0; k < 3; k++) {
        const a0 = W.rot + k * Math.PI * 2 / 3
        for (let i = 0; i <= 26; i++) { const th = i / 26 * Math.PI * 2.4, r = 6 + th * 14; const x = Math.cos(th + a0) * r, y = Math.sin(th + a0) * r * 0.78; if (i) g.lineTo(x, y); else g.moveTo(x, y) }
      }
      g.stroke()
      g.fillStyle = rgba(BONE, 0.25); g.beginPath(); g.arc(0, 0, 2.2, 0, Math.PI * 2); g.fill()
      g.restore()
    }
    if (W.calpha > 0.02 && W.ew > 10 && inView(W.ex - 20, W.ey - 40, W.ew + 40, W.eh + 60)) {
      // the sleeping cloud: a soft dotted outline around the sleepers
      g.save(); g.globalAlpha = W.calpha
      g.strokeStyle = rgba(BONE, 0.22); g.lineWidth = Math.max(1, 1.1 / z); g.setLineDash(DASH_CLOUD)
      g.beginPath(); g.ellipse(W.ex + W.ew / 2, W.ey + W.eh / 2, W.ew * 0.74, W.eh * 0.78, 0, 0, Math.PI * 2); g.stroke()
      g.setLineDash(EMPTY_DASH)
      // the caretaker eye, dozing at the top of the cloud
      const bx = W.ex + W.ew / 2, by = W.ey + W.eh / 2 - W.eh * 0.78, r = 7
      g.fillStyle = PYR; g.strokeStyle = FLESHLINE; g.lineWidth = Math.max(1, 1 / z)
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill(); g.stroke()
      const open = W.eyeOpen, ex = r * 0.74, up = by - r * 1.1 * open, dn = by + r * 0.85 * open
      if (open > 0.1) {
        g.save(); g.beginPath(); g.moveTo(bx - ex, by); g.quadraticCurveTo(bx, up, bx + ex, by); g.quadraticCurveTo(bx, dn, bx - ex, by); g.closePath()
        g.fillStyle = SCLERA; g.fill(); g.clip()
        g.fillStyle = CYAN; g.beginPath(); g.arc(bx, by, r * 0.34, 0, Math.PI * 2); g.fill()
        g.fillStyle = INK; g.beginPath(); g.ellipse(bx, by, r * 0.09, r * 0.26, 0, 0, Math.PI * 2); g.fill()
        g.restore()
      }
      g.strokeStyle = FLESHLINE; g.beginPath(); g.moveTo(bx - ex, by); g.quadraticCurveTo(bx, up, bx + ex, by); g.moveTo(bx - ex, by); g.quadraticCurveTo(bx, dn, bx + ex, by); g.stroke()
      // sleep motes drifting up
      if (motion() > 0 && q >= 1) {
        g.font = '600 9px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle'
        for (let k = 0; k < 2; k++) { const u = ((now * 0.00025) + k * 0.5) % 1; g.fillStyle = rgba(BONE, 0.5 * (1 - u) * (1 - open)); g.fillText('z', bx + r + 4 + u * 10, by - 6 - u * 26) }
      }
      g.restore()
    }
  }
}
const DASH_CLOUD = [2, 5]

// piles: tomes untouched for a long time collapse, per folder, into one small stack with a count; they expand
// back the moment one is touched (its idle time resets) or hovered
// ---------- cluster labels: what a pile holds, in a word or three ----------
// Names of the pile's tomes and their members are split into words; stopwords and generic suffixes are dropped
// (unless nearly every tome carries one); words are scored by their count in the pile against their rarity on
// the whole map (tf-idf); a common camel-case prefix of the tome names counts double; a dominant kind adds its
// word (Shaders, Interfaces, Enums, Behaviours). The label is recomputed only when the pile's membership changes,
// and a new label must beat the old one's score by 15% to replace it.
const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'with', 'by', 'at', 'is', 'get', 'set', 'has', 'do', 'new', 'old', 'my', 'it', 'as', 'be', 'if', 'use'])
const GENERIC = new Set(['manager', 'controller', 'base', 'util', 'utils', 'utility', 'helper', 'helpers', 'system', 'systems', 'data', 'impl', 'service', 'services', 'handler', 'handlers', 'provider', 'factory', 'default', 'main', 'core', 'common', 'misc', 'test', 'tests', 'temp', 'tmp', 'class', 'type', 'types', 'info', 'item', 'items', 'object', 'objects', 'mono', 'behaviour', 'behavior', 'component', 'entry', 'cs', 'shader', 'script', 'update', 'start', 'awake', 'init', 'run', 'go', 'value', 'values', 'id', 'index', 'count', 'list', 'array', 'string', 'int', 'float', 'bool', 'void', 'null', 'true', 'false', 'self', 'this'])
const KIND_WORD = { shader: 'Shaders', interface: 'Interfaces', enum: 'Enums', behaviour: 'Behaviours', struct: 'Structs', record: 'Records', static: 'Statics' }
const labels = { sig: '', df: new Map(), N: 0 }
function wordsOf(name) { return splitWords(String(name || '')).map(w => w.toLowerCase()).filter(w => w.length > 1 && !/^\d+$/.test(w)) }
function labelDf() {
  // document frequency of every word over the whole map (recomputed when the tome set changes)
  let sig = ''
  const S = H.state
  for (const n of S.nodes.values()) if (!n.goneT) sig += n.id + ';'
  if (sig === labels.sig) return
  labels.sig = sig; labels.df.clear(); labels.N = 0
  for (const n of S.nodes.values()) {
    if (n.goneT) continue
    labels.N++
    const seen = new Set(wordsOf(n.name))
    for (const m of n.members) for (const w of wordsOf(m.name)) seen.add(w)
    for (const w of seen) labels.df.set(w, (labels.df.get(w) || 0) + 1)
  }
}
function pileLabel(P, members) {
  labelDf()
  const tf = new Map(), inNames = new Map(), kinds = new Map(), pos = new Map()
  const names = []
  let hubWords = []
  for (const V of members) {
    const n = H.state.nodes.get(V.id)
    const nm = n ? n.name : V.name
    names.push(nm)
    kinds.set(V.kind, (kinds.get(V.kind) || 0) + 1)
    const nw = wordsOf(nm)
    const isHub = V.hub && clusterOf(V) === V.id
    if (isHub) hubWords = nw
    for (let i = 0; i < nw.length; i++) { const w = nw[i]; tf.set(w, (tf.get(w) || 0) + (isHub ? 6 : 2)); inNames.set(w, (inNames.get(w) || 0) + 1); pos.set(w, (pos.get(w) || 0) + i / Math.max(1, nw.length)) }
    if (n) for (const m of n.members.slice(0, 40)) for (const w of wordsOf(m.name)) tf.set(w, (tf.get(w) || 0) + 0.5)
  }
  const count = members.length || 1
  // a common camel-case prefix of the tome names is the strongest hint
  const parts = names.map(nm => splitWords(nm))
  const prefix = []
  for (let i = 0; i < 3 && parts.length > 1; i++) { const w = parts[0][i]; if (w === undefined || !parts.every(p => p[i] === w)) break; if (w.length > 1) prefix.push(w) }
  const scored = []
  for (const [w, f] of tf) {
    if (STOP.has(w)) continue
    const generic = GENERIC.has(w)
    if (generic && (inNames.get(w) || 0) < count * 0.8) continue
    const df = labels.df.get(w) || 1
    let s = f * Math.log(1 + labels.N / df)
    if (prefix.some(p => p.toLowerCase() === w)) s *= 2
    if (generic) s *= 0.5
    scored.push([w, s])
  }
  scored.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
  let words = []
  if (prefix.length) words = prefix.map(w => cap(w.toLowerCase())).slice(0, 2)
  for (const w of hubWords) { if (words.length >= 2) break; if (STOP.has(w) || GENERIC.has(w)) continue; if (!words.some(x => x.toLowerCase() === w)) words.push(cap(w)) }
  for (const [w] of scored) { if (words.length >= 2) break; if (!words.some(x => x.toLowerCase() === w)) words.push(cap(w)) }
  // the words read in the order they take in the names (Water Wake, not Wake Water)
  const at = w => { const k = w.toLowerCase(); return (pos.get(k) || 0) / Math.max(1, inNames.get(k) || 1) }
  words.sort((a, b) => at(a) - at(b))
  let kindWord = ''
  for (const [k, c] of kinds) if (c >= count * 0.7 && KIND_WORD[k]) kindWord = KIND_WORD[k]
  if (kindWord && words.length < 3) words.push(kindWord)
  if (!words.length) words.push(kindWord || 'Tomes')
  const score = scored.length ? scored[0][1] : 0
  const label = words.slice(0, 3).join(' ')
  // hysteresis: a label only changes when the new one is clearly better, or the old words are gone
  if (P.label && P.labelScore && score < P.labelScore * 1.15 && P.label.split(' ').every(w => tf.has(w.toLowerCase()) || w === kindWord)) return
  P.label = label; P.labelScore = score
}
function syncPiles() {
  for (const P of vis.piles.values()) { P.n = 0; P.sx = 0; P.sy = 0 }
  for (const V of vis.nodes.values()) {
    if (!V.present || !V.tPile) { V.pileOf = ''; continue }
    // a tome of a cluster piles with its cluster; a singleton goes to its ward's generic pile
    const root = clusterOf(V)
    const key = clusters.hubs.has(root) ? 'c:' + root : 'w:' + V.folder
    let P = vis.piles.get(key)
    if (!P) { P = { key, folder: V.folder, x: V.lx, y: V.ly, n: 0, sx: 0, sy: 0, alpha: 0, fresh: true, folders: new Map(), idle: 0 }; vis.piles.set(key, P) }
    if (!P.n) { P.folders.clear(); P.idle = 1e12 }
    P.n++; P.sx += V.lx; P.sy += V.ly; P.folders.set(V.folder, (P.folders.get(V.folder) || 0) + 1); P.idle = Math.min(P.idle, V.idleMs || 0)
    V.pileOf = key
  }
  for (const [k, P] of vis.piles) {
    if (P.n < 2) { for (const V of vis.nodes.values()) if (V.pileOf === k) { V.pileOf = ''; V.tPile = 0; V.alive = V.present } }
    else {
      let best = '', bn = 0; for (const [f, c] of P.folders) if (c > bn || (c === bn && f < best)) { bn = c; best = f }; P.folder = best; P.mixed = P.folders.size
      const members = []; for (const V of vis.nodes.values()) if (V.pileOf === k) members.push(V)
      members.sort((a, b) => a.id < b.id ? -1 : 1)
      const msig = members.map(V => V.id).join(',')
      if (msig !== P.msig) { P.msig = msig; pileLabel(P, members) }
    }
    if (P.fresh && P.n) { P.x = P.sx / P.n; P.y = P.sy / P.n; P.fresh = false }
    if (P.n) {
      // a pile sits in the cell its ward's packed slot reserves for it (the last cell of the grid)
      const slot = pack.slots.get(P.key)
      let px = P.x, py = P.y
      if (slot && slot.pileX !== undefined) { px = slot.pileX; py = slot.pileY }
      if (!isFinite(P.x) || !isFinite(P.y)) { P.x = px; P.y = py }
      P.x = ease(P.x, px, 3, 1 / 60); P.y = ease(P.y, py, 3, 1 / 60)
    }
    P.tAlpha = P.n >= 2 ? 1 : 0
    P.alpha = ease(P.alpha, P.tAlpha, 2, 1 / 60)
    if (!P.n && P.alpha < 0.01) vis.piles.delete(k)
  }
}

function drawPiles() {
  const z = view.cam.z
  for (const P of vis.piles.values()) {
    if (P.alpha < 0.02 || !inView(P.x - 10, P.y - 10, 90, 50)) continue
    g.save(); g.globalAlpha = P.alpha * 0.8
    for (let k = 2; k >= 0; k--) {
      g.fillStyle = k ? '#20262A' : '#262622'; g.strokeStyle = rgba(BRASS, 0.5); g.lineWidth = Math.max(1, 1 / z)
      g.beginPath(); roundRect(P.x + k * 3, P.y - k * 3, 64, 24, 3); g.fill(); g.stroke()
    }
    // a strap across the stack and a wax seal with the count
    g.fillStyle = rgba('#5A4A26', 0.9); g.fillRect(P.x + 6, P.y + 4, 52, 4)
    g.fillStyle = BLOOD; g.beginPath(); g.arc(P.x + 50, P.y + 12, 9, 0, Math.PI * 2); g.fill()
    g.strokeStyle = rgba('#5A1E1E', 0.9); g.lineWidth = 1; g.beginPath(); g.arc(P.x + 50, P.y + 12, 6.5, 0, Math.PI * 2); g.stroke()
    g.fillStyle = BONE; g.font = '600 ' + (P.n > 99 ? 8 : 9) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(String(P.n), P.x + 50, P.y + 12.5)
    const Wd = vis.wards.get(P.folder)
    if (P.label) {
      g.fillStyle = rgba(BONE, 0.92); g.font = '600 10.5px ' + FONT
      g.fillText(clipMid(P.label, 22), P.x + 32, P.y + 33)
    }
    if (!Wd || Wd.alpha < 0.5 || Wd.labW === undefined || P.label) {
      g.fillStyle = rgba(ASH, 0.75); g.font = '9px ' + FONT
      const ward = clipMid(Wd && Wd.short ? Wd.short : P.folder.split('/').pop(), 16) + ((P.mixed || 1) > 1 ? ' +' + (P.mixed - 1) : '')
      g.fillText(ward + ' \u00b7 ' + P.n + ' tomes', P.x + 32, P.y + (P.label ? 44 : 34))
    }
    g.textAlign = 'left'
    const pz = P.zapT && motion() > 0.02 ? clamp(1 - (performance.now() - P.zapT) / 1400, 0, 1) : 0
    if (pz > 0.02) { g.globalAlpha = 1; zapRect(P.x - 2, P.y - 8, 74, 34, performance.now(), 17, P.zapCol || EMBER, pz, z, 3) }
    g.restore()
  }
}

const activeFolders = new Set()
// wards are arcs on the orbits (see pack.arcs); here each keeps its visual state and a bounding box for culling
// and for the captions to keep clear of its label
function syncWards() {
  for (const W of vis.wards.values()) W.cnt = 0
  for (const V of vis.nodes.values()) {
    if (!V.present || V.alpha < 0.05 || V.pileOf || V.pile > 0.5) continue
    let W = vis.wards.get(V.folder)
    if (!W) { W = { name: V.folder, x: V.x, y: V.y, w: V.w, h: V.h, tx: 0, ty: 0, tw: 0, th: 0, alpha: 0, active: 0, cnt: 0, col: wardColor(V.folder), c: wardRgb(V.folder), fresh: true }; vis.wards.set(V.folder, W) }
    W.cnt++
  }
  for (const P of vis.piles.values()) if (P.n >= 2 && P.alpha > 0.05) { let W = vis.wards.get(P.folder); if (!W) { W = { name: P.folder, x: P.x, y: P.y, w: 70, h: 44, tx: 0, ty: 0, tw: 0, th: 0, alpha: 0, active: 0, cnt: 0, col: wardColor(P.folder), c: wardRgb(P.folder), fresh: true }; vis.wards.set(P.folder, W) }; W.cnt++ }
  // the wards each session is working in glow
  activeFolders.clear()
  for (const a of H.state.actors.values()) {
    if (a.parent || !vis.actors.has(a.id)) continue
    const act = focus.cur.get(a.id)
    let nid = act && act.node ? act.node : (a.wake.length ? a.wake[a.wake.length - 1].node : '')
    const N = nid ? vis.nodes.get(nid) : null
    if (N) activeFolders.add(N.folder)
  }
  // short ward names: the last path segment, with its parent added only when two wards would share it
  const seen = new Map()
  for (const W of vis.wards.values()) { const s = W.name.split('/').pop() || W.name; seen.set(s, (seen.get(s) || 0) + 1) }
  for (const W of vis.wards.values()) { const p = W.name.split('/'); const s = p.pop() || W.name; W.short = (seen.get(s) || 0) > 1 && p.length ? p.pop() + '/' + s : s; W.wob = 0 }
  for (const W of vis.wards.values()) W.zap = 0
  for (const V of vis.nodes.values()) if (V.present && V.wob > 0.02) { const W = vis.wards.get(V.folder); if (W) { W.wob = Math.max(W.wob, V.wob); if ((V.zap || 0) > W.zap) { W.zap = V.zap; W.zapCol = V.zapCol } } }
  for (const W of vis.wards.values()) {
    // the bounding box of the ward's arcs (chord box of the outer edge), for culling and framing
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false
    for (const arc of pack.arcs) {
      if (arc.folder !== W.name) continue
      const ph = pack.phase[arc.k] || 0, ro = arc.r + arc.h / 2 + 16, ri = arc.r - arc.h / 2 - 16
      for (let s = 0; s <= 4; s++) { const a = arc.a0 + ph + (arc.a1 - arc.a0) * s / 4; for (const r of [ri, ro]) { const x = pack.cx + Math.cos(a) * r, y = pack.cy + Math.sin(a) * r * tilt.cos; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); any = true } }
    }
    if (any) { W.tx = x0; W.ty = y0; W.tw = x1 - x0; W.th = y1 - y0; if (W.fresh) { W.x = W.tx; W.y = W.ty; W.w = W.tw; W.h = W.th; W.fresh = false } }
    W.tAlpha = W.cnt && any ? 1 : 0
    W.tActive = activeFolders.has(W.name) ? 1 : 0
  }
}

// ---------- the orbits: everything lives on rings around the vortex ----------
// From the hub outward: the vortex with the master creature in it; the inner orbit of the cards the session
// attends to; the ring of the involved-but-quiet sleepers with the caretaker eye; then the open cards of the
// wards, ring after ring (recently active wards first), each ward a contiguous arc of upright cards; then the
// folded cards; then the piles, furthest out. Rings grow outward when full. Slots are deterministic (ward
// recency in coarse steps, then folder name, then tome id) and only re-dealt when something changes status, so
// nothing shuffles. Every present, unfolded tome keeps its slot even while it orbits the vortex. The rings turn a
// little, Kepler-like (inner faster, outer nearly still), only while the session is active.
const pack = { slots: new Map(), items: new Map(), sig: '', cx: 0, cy: 0, init: false, owner: '', coreR: 200, midR: 330, baseR: 460, outerR: 460, rings: [], arcs: [], phase: [], spin: 0 }
const GAPC = 26, RING_GAP = 44
// ---------- the perspective: the orbital plane seen from a low angle, dipping into the throat ----------
// A constant tilt (adjustable with shift-drag or right-drag, kept in localStorage) foreshortens the plane; inside
// the core the sheet falls away into a gravity well. Cards and creatures stay upright billboards on the sheet.
const tilt = { deg: 58, cos: 0.53, sin: 0.85 }
function setTilt(deg) {
  tilt.deg = clamp(isFinite(deg) ? deg : 58, 45, 72)
  const a = tilt.deg * Math.PI / 180; tilt.cos = Math.cos(a); tilt.sin = Math.sin(a)
  try { localStorage.setItem('abyssal-eye.tilt', String(tilt.deg)) } catch (e) { /* ignore */ }
  pack.sig = ''
}
try { setTilt(parseFloat(localStorage.getItem('abyssal-eye.tilt'))) } catch (e) { setTilt(58) }
function funnelDepth(r) { const R = pack.coreR; return r < R ? R * 0.9 * Math.pow(1 - r / R, 2.2) : 0 }
const prj = [0, 0]
function projectPolar(a, r, out) { out[0] = pack.cx + Math.cos(a) * r; out[1] = pack.cy + Math.sin(a) * r * tilt.cos + funnelDepth(r) * tilt.sin; return out }
// the angular width an item needs on a ring at angle a, seen in projection (the ring runs horizontally at the top
// and bottom, where the card's width counts, and vertically at the sides, where its height does)
function ringSpan(it, a, r) {
  const tx = -Math.sin(a), ty = Math.cos(a) * tilt.cos, tl = Math.hypot(tx, ty) || 1
  const need = Math.abs(tx / tl) * it.w + Math.abs(ty / tl) * it.h + GAPC
  return need / (r * tl)
}
function idleBucket(ms) { return ms < 300000 ? 0 : ms < 1200000 ? 1 : ms < 3600000 ? 2 : 3 }
// ---------- clusters: tomes bound to one another belong together ----------
// A union-find over the binding pairs, strongest pairs first, clusters capped at twelve tomes; recomputed only
// when the set of present tomes or the set of bound pairs changes, so the grouping is stable and deterministic.
// The ring deal seats a cluster's tomes side by side (wards split across clusters keep an arc per run), and the
// idle tomes of a cluster collapse into one cluster pile, whatever their wards.
const clusters = { sig: '', of: new Map(), hubs: new Set(), prev: new Map(), sizes: [] }
const HUB_SCALE = 1.1 // a hub card is drawn a little larger than its satellites
// mass: how much a tome matters on the map (its bindings, size, members, and whether it was touched lately)
function massOf(V, deg) {
  const n = H.state.nodes.get(V.id)
  const lines = n ? n.lines || 0 : 0, mem = n ? n.members.length : 0
  const recent = (V.idleMs !== undefined && V.idleMs < 600000) ? 1 : 0
  return Math.log2(1 + deg) + 0.5 * Math.log2(1 + lines / 50) + 0.3 * Math.log2(1 + mem) + recent
}
function clusterStep() {
  const ids = [], byId = new Map()
  let sig = ''
  for (const V of vis.nodes.values()) if (V.present) { ids.push(V.id); byId.set(V.id, V); sig += V.id + ';' }
  const pairs = new Map()
  for (const E of vis.edges.values()) {
    if (!E.a.present || !E.b.present || E.tAlpha === 0 || E.a === E.b) continue
    const k = E.a.id < E.b.id ? E.a.id + '\x01' + E.b.id : E.b.id + '\x01' + E.a.id
    pairs.set(k, (pairs.get(k) || 0) + 1)
  }
  const keys = Array.from(pairs.keys()).sort()
  sig += '|' + keys.join(',')
  if (sig === clusters.sig) return
  clusters.sig = sig
  ids.sort()
  // the graph: neighbours with weights normalised by degree, so a tome bound to everything swallows nothing
  const adj = new Map()
  for (const id of ids) adj.set(id, new Map())
  for (const k of keys) { const cut = k.indexOf('\x01'), a = k.slice(0, cut), b = k.slice(cut + 1); if (!adj.has(a) || !adj.has(b)) continue; const w = pairs.get(k); adj.get(a).set(b, w); adj.get(b).set(a, w) }
  const deg = new Map(); for (const id of ids) deg.set(id, adj.get(id).size)
  const nw = (a, b) => { const w = adj.get(a).get(b) || 0; return w ? w / Math.sqrt(Math.max(1, deg.get(a)) * Math.max(1, deg.get(b))) : 0 }
  const mass = new Map(); for (const id of ids) mass.set(id, massOf(byId.get(id), deg.get(id)))
  // utility-like tomes: a degree above the 95th percentile (and more than 8) attract nobody
  const degs = ids.map(id => deg.get(id)).sort((a, b) => a - b)
  const p95 = degs.length ? degs[Math.floor((degs.length - 1) * 0.95)] : 0
  const utility = new Set(); for (const id of ids) if (deg.get(id) > 8 && deg.get(id) > p95) utility.add(id)
  // every lighter tome joins the hub it hangs from most strongly (one or two hops), the lightest first; a hub
  // joins a heavier hub only when very strongly bound; clusters are capped; the weakly attached stay alone
  const order = ids.slice().sort((a, b) => (mass.get(a) - mass.get(b)) || (a < b ? -1 : 1))
  const of = new Map(), size = new Map()
  for (const id of ids) { of.set(id, id); size.set(id, 1) }
  const root = id => { let r = id; let guard = 0; while (of.get(r) !== r && guard++ < 64) r = of.get(r); return r }
  const CAP = 14
  for (const b of order) {
    if (utility.has(b)) continue
    const mb = mass.get(b)
    // equal masses are ordered by id, so a ring of alike tomes still gathers round one of them
    const heavier = h => mass.get(h) > mb || (mass.get(h) === mb && h < b)
    const cand = new Map()
    for (const [h, w] of adj.get(b)) { if (utility.has(h) || !heavier(h)) continue; cand.set(h, Math.max(cand.get(h) || 0, nw(b, h) * mass.get(h))) }
    for (const [c] of adj.get(b)) for (const [h] of adj.get(c)) { if (h === b || utility.has(h) || !heavier(h)) continue; const s = nw(b, c) * nw(c, h) * mass.get(h) / 2; if (s > (cand.get(h) || 0)) cand.set(h, s) }
    const list = Array.from(cand.entries()).sort((p, q) => (q[1] - p[1]) || (p[0] < q[0] ? -1 : 1))
    // hysteresis: the hub it had last time keeps it unless another scores 20% better
    const prev = clusters.prev.get(b)
    if (prev && cand.has(prev.hub) && list.length && list[0][0] !== prev.hub && list[0][1] < cand.get(prev.hub) * 1.2) { list.unshift([prev.hub, cand.get(prev.hub)]) }
    for (const [h, s] of list) {
      if (s < 0.15) break
      if (mb >= 0.7 * mass.get(h) && nw(b, h) < 0.5) continue // two hubs: only a very strong bond joins them
      const r = root(h)
      if (r === b || size.get(r) + size.get(b) > CAP) continue
      of.set(b, r); size.set(r, size.get(r) + size.get(b))
      clusters.prev.set(b, { hub: h, score: s })
      break
    }
  }
  clusters.of.clear(); clusters.hubs.clear()
  const count = new Map()
  for (const id of ids) { const r = root(id); clusters.of.set(id, r); count.set(r, (count.get(r) || 0) + 1) }
  for (const [r, c] of count) if (c > 1) clusters.hubs.add(r)
  clusters.sizes = Array.from(count.values()).sort((a, b) => b - a)
  for (const V of vis.nodes.values()) V.hub = clusters.hubs.has(V.id)
}
function clusterOf(V) { return clusters.of.get(V.id) || V.id }

function packStep(dt) {
  clusterStep()
  // the tomes by status, grouped by cluster (the most recently touched clusters first), then ward, then id
  const cl = new Map()
  const groupOf = V => { const c = clusterOf(V); let g = cl.get(c); if (!g) { g = { id: c, open: [], folded: [], idle: 1e12 }; cl.set(c, g) }; return g }
  for (const V of vis.nodes.values()) {
    if (!V.present || V.tPile) continue
    const g = groupOf(V)
    if (V.tFold) g.folded.push(V); else g.open.push(V)
    if (V.idleMs !== undefined) g.idle = Math.min(g.idle, V.idleMs)
  }
  const groups = Array.from(cl.values())
  const byWard = (a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : a.id < b.id ? -1 : 1)
  const hubMid = list => { const i = list.findIndex(V => V.hub && clusterOf(V) === V.id); if (i < 0) return; const [hub] = list.splice(i, 1); list.splice(Math.floor(list.length / 2), 0, hub) }
  for (const g of groups) { g.open.sort(byWard); g.folded.sort(byWard); hubMid(g.open); hubMid(g.folded); g.bucket = idleBucket(g.idle) }
  groups.sort((a, b) => (a.bucket - b.bucket) || (a.id < b.id ? -1 : 1))
  const pilesList = Array.from(vis.piles.values()).filter(P => P.n >= 2).sort((a, b) => (idleBucket(a.idle || 0) - idleBucket(b.idle || 0)) || (a.key < b.key ? -1 : 1))
  // the sequence of items, tier by tier
  const seq = []
  // pinned cards keep the place the user gave them and take no ring slot; the rest flow round them
  const hubK = V => V.hub ? HUB_SCALE : 1
  for (const g of groups) for (const V of g.open) if (!V.pin) seq.push({ id: V.id, kind: 'card', folder: V.folder, w: V.tw * hubK(V), h: V.th * hubK(V), V, tier: 0 })
  for (const g of groups) for (const V of g.folded) if (!V.pin) seq.push({ id: V.id, kind: 'card', folder: V.folder, w: V.tw * hubK(V), h: V.th * hubK(V), V, tier: 1 })
  for (const P of pilesList) seq.push({ id: 'pile:' + P.key, kind: 'pile', folder: P.folder, w: 70, h: 44, P, tier: 2, key: P.key })
  for (const slot of pack.slots.values()) slot.seen = false
  for (const it of seq) {
    const sk = it.kind === 'pile' ? it.key : it.folder
    let slot = pack.slots.get(sk)
    if (!slot) { slot = { folder: it.folder, ang: 0, r: 0, h: 0 }; pack.slots.set(sk, slot) }
    slot.seen = true; slot.folder = it.folder
  }
  for (const [f, slot] of pack.slots) if (!slot.seen) pack.slots.delete(f)
  // the core: the session owning the centre is the most recently active one (sticky); its orbit sets the radius
  let owner = '', ownerT = -1
  for (const A of vis.actors.values()) if (!A.parent && A.present && (A.lastT || 0) > ownerT) { ownerT = A.lastT || 0; owner = A.id }
  const cur = pack.owner ? vis.actors.get(pack.owner) : null
  if (owner && (!cur || !cur.present || ownerT > (cur.lastT || 0) + 60000)) pack.owner = owner
  const OW = pack.owner ? vis.whirls.get(pack.owner) : null
  const coreR = Math.max(200, (OW && OW.n ? OW.ringR : 0) + 40)
  let sig = Math.round(coreR / 90) + '|'
  for (const it of seq) sig += it.id + ':' + it.tier + ':' + Math.round(it.w / 24) + ',' + Math.round(it.h / 24) + ';'
  if (sig !== pack.sig) { pack.sig = sig; pack.coreR = coreR; dealOrbits(seq); layout.awake = Math.max(layout.awake, 90) }
  // the rings turn while the session is active: Kepler-like, the inner ones faster, the outer ones nearly still
  pack.spin = OW ? (OW.spin || 0) : 0
  const w0 = Math.PI * 2 / 90 * pack.spin * motion() * dt
  for (let k = 0; k < pack.rings.length; k++) pack.phase[k] = (pack.phase[k] || 0) + w0 * 0.3 / Math.pow(k + 2, 1.5)
  // every item's slot this frame
  for (const it of pack.items.values()) {
    const rg = pack.rings[it.k]
    if (!rg) continue
    const a = it.ang + pack.phase[it.k]
    projectPolar(a, rg.r, prj)
    const x = prj[0], y = prj[1]
    if (it.kind === 'card') { const V = vis.nodes.get(it.id); if (V) { V.slotX = x - V.tw / 2; V.slotY = y - V.th / 2 } }
    else { const slot = pack.slots.get(it.key); if (slot) { slot.pileX = x - 35; slot.pileY = y - 16 } }
  }
  if (pack.spin > 0.01) layout.awake = Math.max(layout.awake, 10)
}
// deal the sequence onto rings: each ring takes as many items as fit round it (its radius grows with its tallest
// item), a new tier always starts a new ring; then the arcs of the wards and the web are rebuilt
function dealOrbits(seq) {
  if (!pack.init) {
    let sx = 0, sy = 0, n = 0
    for (const V of vis.nodes.values()) if (V.present && isFinite(V.lx) && isFinite(V.ly)) { sx += V.lx; sy += V.ly; n++ }
    pack.cx = n ? sx / n : 0; pack.cy = n ? sy / n : 0; pack.init = true
  }
  pack.midR = pack.coreR + 130
  pack.baseR = pack.midR + 90
  pack.rings = []; pack.arcs = []; pack.items.clear()
  let i = 0, Rin = pack.baseR
  while (i < seq.length) {
    const list = []
    let maxH = 0, used = 0
    const tier = seq[i].tier
    while (i < seq.length && seq[i].tier === tier) {
      const it = seq[i]
      const h2 = Math.max(maxH, it.h), r2 = Rin + h2 / 2
      const ue = Math.max(it.w, it.h / tilt.cos) + GAPC
      if (list.length && used + ue > Math.PI * 2 * r2) break
      list.push(it); used += ue; maxH = h2; i++
    }
    const r = Rin + maxH / 2, k = pack.rings.length
    let a = -Math.PI / 2 + (k % 2) * 0.17
    // spans in projection, then stretched evenly to fill the ring
    const spans = []
    let tot = 0, nb = 0
    for (let qi = 0; qi < list.length; qi++) { const it = list[qi]; const sp = ringSpan(it, a + tot, r); spans.push(sp); tot += sp; if (qi === 0 || list[qi - 1].folder !== it.folder) nb++ }
    // the slack of the ring goes mostly into gaps between the wards (so arcs stay snug round their cards), a
    // little into even spacing
    const slack = Math.max(0, Math.PI * 2 - tot)
    const gapB = Math.min(0.4, slack * 0.7 / Math.max(1, nb)), even = Math.max(0, slack - gapB * nb) / list.length
    let arc = null
    for (let qi = 0; qi < list.length; qi++) {
      const it = list[qi]
      if (qi > 0 && list[qi - 1].folder !== it.folder) a += gapB
      const span = spans[qi] + even
      it.k = k; it.ang = a + span / 2; it.r = r
      pack.items.set(it.id, it)
      // the ward's arc: contiguous items of one folder on this ring
      if (!arc || arc.folder !== it.folder) { arc = { folder: it.folder, k, r, a0: a, a1: a + span, h: maxH, n: 1 }; pack.arcs.push(arc) }
      else { arc.a1 = a + span; arc.n++ }
      a += span
    }
    pack.rings.push({ r, n: list.length, h: maxH, tier })
    if (pack.phase.length <= k) pack.phase.push(0)
    Rin = r + maxH / 2 + RING_GAP
  }
  pack.outerR = pack.rings.length ? Rin - RING_GAP : pack.baseR
  // each ward's first arc anchors its web thread
  for (const slot of pack.slots.values()) slot.r = 0
  for (const arc of pack.arcs) { const s = pack.slots.get(arc.folder); if (s && !s.r) { s.r = arc.r; s.h = arc.h; s.ang = (arc.a0 + arc.a1) / 2 } }
  buildWeb()
}

// ---------- the gravitational web: the entity's threads, precomputed, redrawn still ----------
// Radial anchor threads run from the hub out to every ward, bending into the vortex's swirl near the core; orbit
// threads run round each ring, sagging a little between the anchors like a web's spiral and bowing in toward the
// centre. Subtle, desaturated, behind everything. A touch sends a ripple along the ward's thread toward the hub.
const web = { radials: [], rings: [], ripples: [], ready: false }
const WEB_COL = '#6E6884'
function buildWeb() {
  web.radials.length = 0; web.rings.length = 0; web.ready = true
  const cx = pack.cx, cy = pack.cy, r0 = pack.coreR * 0.12
  const slots = Array.from(pack.slots.values()).filter(s => s.r > 0)
  const twist = 0.5 // the swirl near the hub (radians at the core, fading out by the middle ring)
  // the mesh's own meridians, every 15 degrees out to the rim, plus the anchor threads to the wards
  const Rrim = pack.outerR + 60
  for (let k = 0; k < 24; k++) slots.push({ folder: '', ang: -Math.PI + k * Math.PI / 12, r: Rrim, h: 0 })
  for (const s of slots) {
    const r1 = s.r - s.h / 2
    const pts = []
    const n = 26
    for (let i = 0; i <= n; i++) {
      const t = Math.pow(i / n, 1.6), r = r0 + (r1 - r0) * t
      const pull = Math.max(0, 1 - (r - r0) / Math.max(1, pack.midR - r0))
      const a = s.ang + twist * pull * pull
      projectPolar(a, r, prj); pts.push(prj[0], prj[1])
    }
    web.radials.push({ folder: s.folder, ang: s.ang, r0, r1, pts })
  }
  const anchors = slots.map(s => s.ang).sort((a, b) => a - b)
  // evenly spaced rings: down the throat (closer together as it steepens), then every 100 px out to the rim
  const radii = []
  for (const f of [0.12, 0.2, 0.29, 0.39, 0.5, 0.62, 0.75, 0.88]) radii.push(pack.coreR * f)
  for (let R = pack.coreR; R <= pack.outerR + 60; R += 100) radii.push(R)
  for (const R of radii) {
    const pts = []
    const steps = Math.max(48, Math.round(R / 9))
    const sag = Math.min(18, R * 0.035)
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI + i / steps * Math.PI * 2
      // the sag between the two nearest anchors (none: a plain circle)
      let dip = 0
      if (anchors.length > 1) {
        let lo = -1e9, hi = 1e9
        for (const an of anchors) { for (let k = -1; k <= 1; k++) { const v = an + k * Math.PI * 2; if (v <= a && v > lo) lo = v; if (v > a && v < hi) hi = v } }
        const u = (a - lo) / Math.max(1e-6, hi - lo)
        dip = sag * Math.sin(u * Math.PI)
      }
      // the lens: inner threads bow a little further in
      const lens = R < pack.midR + 1 ? 0.06 * R : 0
      const r = R - (R >= pack.midR ? dip : 0) - lens * Math.pow(Math.sin(a * 3 + 0.7) * 0.5 + 0.5, 2) * 0.3
      projectPolar(a, r, prj); pts.push(prj[0], prj[1])
    }
    web.rings.push({ R, pts })
  }
}
function rippleWeb(folder, now) {
  if (motion() <= 0.02 || !web.ready) return
  for (const r of web.radials) if (r.folder === folder) { if (web.ripples.length > 12) web.ripples.shift(); web.ripples.push({ r, t0: now }); return }
}
// ---------- dust: sparkle motes drawn down the well ----------
// A fixed pool (by quality) of motes spawned at the outer web, spiralling in along the funnel, faster and tighter
// as they fall, stretching into streaks near the throat and fading as they drop in. Their number and pace follow
// how busy Claude is (open acts, recent acts, thinking, thralls at work; eased), tinted by the dominant activity.
// Nothing moves once the session has gone quiet.
const dust = { cap: 0, n: 0, a: null, r: null, w: null, px: null, py: null, seed: null, act: 0, col: [122, 114, 144], tcol: [122, 114, 144], spawn: 0 }
const DUST_COL = { read: CYAN, search: CYAN, glance: CYAN, edit: EMBER, write: EMBER, bash: SULFUR, tool: SULFUR, todo: SULFUR, think: VIOLET, agent: THRALL }
function dustAlloc(cap) {
  dust.cap = cap; dust.n = 0
  dust.a = new Float32Array(cap); dust.r = new Float32Array(cap); dust.w = new Float32Array(cap)
  dust.px = new Float32Array(cap); dust.py = new Float32Array(cap); dust.seed = new Float32Array(cap)
}
function syncDust(S, T, dt) {
  const cap = Q() === 2 ? 300 : Q() === 1 ? 120 : 40
  if (dust.cap !== cap) dustAlloc(cap)
  // how busy: open acts, acts begun in the last ten seconds, thinking, thralls at work
  let open = 0, recent = 0, thinking = 0
  const kinds = {}
  for (const act of S.acts.values()) {
    if (act.startT > T) continue
    if (!act.endT) { open++; kinds[act.kind] = (kinds[act.kind] || 0) + 2 }
    if (T - act.startT < 10000) { recent++; kinds[act.kind] = (kinds[act.kind] || 0) + 1 }
  }
  for (const a of S.actors.values()) if (a.thinking && T - a.lastT < 60000) { thinking++; kinds.think = (kinds.think || 0) + 1 }
  let quiet = true
  for (const W of vis.whirls.values()) if ((W.spin || 0) > 0.02) quiet = false
  const want = quiet ? 0 : clamp(open * 0.35 + recent * 0.08 + thinking * 0.25, 0.06, 1)
  dust.act = ease(dust.act, want, 0.6, dt)
  let best = '', bn = 0
  for (const k in kinds) if (kinds[k] > bn) { bn = kinds[k]; best = k }
  const tc = rgb(DUST_COL[best] || WEB_COL)
  for (let i = 0; i < 3; i++) dust.col[i] = ease(dust.col[i], tc[i], 1.2, dt)
  const mo = motion()
  if (!pack.init || mo <= 0.02) { if (mo <= 0.02) dust.n = 0; return }
  // spawn at the rim
  dust.spawn += dust.act * cap * 0.35 * dt
  while (dust.spawn >= 1 && dust.n < cap) {
    dust.spawn -= 1
    const i = dust.n++
    dust.seed[i] = Math.random()
    dust.a[i] = Math.random() * Math.PI * 2
    dust.r[i] = pack.outerR * (0.78 + Math.random() * 0.3)
    dust.w[i] = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8)
    projectPolar(dust.a[i], dust.r[i], prj); dust.px[i] = prj[0]; dust.py[i] = prj[1]
  }
  if (dust.spawn > 1) dust.spawn = 1
  // fall: faster the deeper, swirling tighter (Kepler-like), gone at the throat
  const throat = pack.coreR * 0.12
  const pace = (0.5 + 1.5 * dust.act) * mo
  for (let i = 0; i < dust.n; i++) {
    const r = dust.r[i], f = 1 - r / pack.outerR
    const vr = (22 + 160 * f * f + (r < pack.coreR ? 260 * (1 - r / pack.coreR) : 0)) * pace
    dust.r[i] = r - vr * dt
    dust.a[i] += dust.w[i] * pace * dt * (60 / Math.max(40, r)) * 3
    if (dust.r[i] <= throat) { dust.n--; if (i < dust.n) { const j = dust.n; dust.a[i] = dust.a[j]; dust.r[i] = dust.r[j]; dust.w[i] = dust.w[j]; dust.px[i] = dust.px[j]; dust.py[i] = dust.py[j]; dust.seed[i] = dust.seed[j]; i-- } }
  }
}
function drawDust(now) {
  if (!dust.n || !pack.init) return
  const z = view.cam.z
  const c = dust.col
  g.save()
  g.lineCap = 'round'; g.lineWidth = Math.max(1.2, 1.4 / z)
  for (let i = 0; i < dust.n; i++) {
    const r = dust.r[i]
    projectPolar(dust.a[i], r, prj)
    const x = prj[0], y = prj[1]
    const deep = r < pack.coreR ? r / pack.coreR : 1
    const tw = 0.3 + 0.7 * dust.seed[i] * (0.6 + 0.4 * Math.sin(now * 0.006 + dust.seed[i] * 40))
    const al = 0.85 * tw * (0.35 + 0.65 * Math.min(1, (pack.outerR - r) / 160)) * Math.pow(deep, 1.5)
    g.strokeStyle = 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + al.toFixed(3) + ')'
    g.beginPath(); g.moveTo(dust.px[i], dust.py[i]); g.lineTo(x, y); g.stroke()
    dust.px[i] = x; dust.py[i] = y
  }
  g.restore()
}

function drawWeb(now) {
  if (!web.ready) return
  const z = view.cam.z, mo = motion()
  g.save()
  g.lineCap = 'round'; g.lineJoin = 'round'
  // the well: darkness pooling in the throat
  const tR = pack.coreR * 0.12
  projectPolar(0, 0, prj); const thx = prj[0], thy = prj[1]
  if (inView(thx - pack.coreR, thy - pack.coreR, pack.coreR * 2, pack.coreR * 2)) {
    g.save(); g.translate(thx, thy - pack.coreR * 0.2); g.scale(1, 0.78)
    const wr = pack.coreR * 0.95
    const gr = g.createRadialGradient(0, 0, tR * 0.3, 0, 0, wr)
    gr.addColorStop(0, 'rgba(4,5,9,0.85)'); gr.addColorStop(0.3, 'rgba(6,7,12,0.45)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, wr, 0, Math.PI * 2); g.fill()
    g.restore()
  }
  g.lineWidth = Math.max(0.7, 0.75 / z)
  g.strokeStyle = rgba(WEB_COL, 0.16)
  g.beginPath()
  for (const rg of web.rings) {
    if (!inView(pack.cx - rg.R, pack.cy - rg.R, rg.R * 2, rg.R * 2)) continue
    const p = rg.pts
    g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
  }
  g.stroke()
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = rgba(WEB_COL, pass ? 0.14 : 0.09)
    g.beginPath()
    for (const rd of web.radials) {
      if ((rd.folder !== '') !== (pass === 1)) continue
      const p = rd.pts
      g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
    }
    g.stroke()
  }
  // the luminous ring at the throat, with a faint bloom
  const tq = Q()
  g.beginPath(); g.ellipse(thx, thy, tR, tR * tilt.cos, 0, 0, Math.PI * 2)
  if (tq >= 1) { g.strokeStyle = rgba('#8E86C4', 0.12); g.lineWidth = Math.max(8, 9 / z); g.stroke() }
  g.strokeStyle = rgba('#B9B2E6', 0.55 + 0.4 * throatBoost); g.lineWidth = Math.max(1.4, 1.6 / z) * (1 + 0.5 * throatBoost)
  if (tq === 2) { g.shadowColor = rgba('#9FD6E8', 0.8); g.shadowBlur = 22 * z }
  g.stroke(); g.shadowBlur = 0
  // ripples: a bright tremor running in along the thread from the touched ward to the hub
  for (let k = web.ripples.length - 1; k >= 0; k--) {
    const rp = web.ripples[k], u = (now - rp.t0) / 1400
    if (u >= 1 || mo <= 0.02) { web.ripples.splice(k, 1); continue }
    const p = rp.r.pts, n = p.length / 2 - 1
    const f = (1 - u) * n, i0 = Math.max(0, Math.min(n - 1, Math.floor(f)))
    const x = p[i0 * 2] + (p[i0 * 2 + 2] - p[i0 * 2]) * (f - i0), y = p[i0 * 2 + 1] + (p[i0 * 2 + 3] - p[i0 * 2 + 1]) * (f - i0)
    const tx = p[i0 * 2 + 2] - p[i0 * 2], ty = p[i0 * 2 + 3] - p[i0 * 2 + 1], tl = Math.hypot(tx, ty) || 1
    const ux = tx / tl, uy = ty / tl, nx = -uy, ny = ux
    g.strokeStyle = rgba(BONE, 0.35 * (1 - u)); g.lineWidth = Math.max(1, 1 / z)
    g.beginPath()
    for (let s = -4; s <= 4; s++) { const d = s * 5, w = Math.sin(s * 0.9 + now * 0.03) * 3 * (1 - Math.abs(s) / 4.5); const px = x + ux * d + nx * w, py = y + uy * d + ny * w; if (s === -4) g.moveTo(px, py); else g.lineTo(px, py) }
    g.stroke()
  }
  g.restore()
}

// ---------- the whirlpool rings: the tomes a session attends to orbit its vortex ----------
// Members are arranged on one or two rings (the most attended on the inner one, the rest in arrival order, never
// reshuffled), upright, spaced so they cannot touch, and the rings turn slowly (one revolution in ~90 s, eased)
// while the session is working; the orbit pauses after ~20 s of quiet and resumes smoothly. The vortex sits
// clear of the packed wards. Orbiting cards are kinematic: outside the forces, immovable to other cards.
let orbitSeq = 0
const ringA = [], ringB = []
function ringRadius(list, rmin) {
  let per = 0, mh = 0
  for (const V of list) { per += Math.max(V.tw, V.th / tilt.cos) * 1.1 + 40; mh = Math.max(mh, Math.hypot(V.tw, V.th)) }
  return [Math.max(rmin, per / (2 * Math.PI)), mh]
}
// where a session's vortex sits: the owner of the centre in the hub, the other sessions as smaller satellites on
// the middle ring, spaced round it
function whirlPlace(W, sess) {
  if (!pack.init) return
  if (sess === pack.owner) { W.tx = pack.cx; W.ty = pack.cy; W.sat = false; return }
  const others = []
  for (const o of vis.whirls.values()) if (o.sess !== pack.owner) others.push(o.sess)
  others.sort()
  const i = others.indexOf(sess), k = Math.max(1, others.length)
  const OW = vis.whirls.get(pack.owner)
  const dist = Math.max(pack.outerR + (W.cloudR || W.ringR || 0) + 60, (OW && OW.ringR ? OW.ringR : 0) + (W.ringR || 0) + 80)
  const a = -Math.PI / 2 + 0.9 + i * Math.PI * 2 / k
  W.tx = pack.cx + Math.cos(a) * dist; W.ty = pack.cy + Math.sin(a) * dist * tilt.cos; W.sat = true
  if (!isFinite(W.tx) || !isFinite(W.ty)) { W.tx = pack.cx; W.ty = pack.cy }
  if (!isFinite(W.x) || !isFinite(W.y)) { W.x = W.tx; W.y = W.ty }
}
// the middle ring: the sleepers of a session sit still on a ring round its vortex, in the order they arrived
function cloudRing(sess, l) {
  const W = vis.whirls.get(sess)
  if (!W) return
  for (const V of l) if (V.orbitSeq === undefined) V.orbitSeq = ++orbitSeq
  l.sort((a, b) => a.orbitSeq - b.orbitSeq)
  let per = 0
  for (const V of l) per += Math.max(V.tw, V.th / tilt.cos) * 1.1 + 36
  const R = Math.max(sess === pack.owner ? pack.midR : (W.ringR || 120) + 90, per / (Math.PI * 2))
  W.cloudR = R
  W.cphase = (W.cphase || 0) + Math.PI * 2 / 90 * 0.5 * (W.spin || 0) * motion() * (1 / 60)
  for (let i = 0; i < l.length; i++) {
    const V = l[i], a = -Math.PI / 2 + 0.35 + W.cphase + Math.PI * 2 * i / l.length
    V.slotX = W.x + Math.cos(a) * R - V.tw / 2; V.slotY = W.y + Math.sin(a) * R * tilt.cos + (W.sat ? 0 : funnelDepth(R) * tilt.sin) - V.th / 2
  }
}
function orbitRing(sess, l, dt) {
  const W = vis.whirls.get(sess)
  if (!W) return
  const mo = motion()
  for (const V of l) if (V.orbitSeq === undefined) V.orbitSeq = ++orbitSeq
  l.sort((a, b) => a.orbitSeq - b.orbitSeq)
  let top = l[0]
  for (const V of l) if (V.attn > top.attn) top = V
  ringA.length = 0; ringB.length = 0
  ringA.push(top)
  for (const V of l) { if (V === top) continue; if (ringA.length < 6) ringA.push(V); else ringB.push(V) }
  ringA.sort((a, b) => a.orbitSeq - b.orbitSeq)
  const [r1, d1] = ringRadius(ringA, 130)
  W.r1 = r1; W.d1 = d1
  let r2 = 0, d2 = 0
  if (ringB.length) { const q = ringRadius(ringB, r1 + d1 / 2 + 60); r2 = q[0] + q[1] / 2 + 10; d2 = q[1] }
  W.ringR = ringB.length ? r2 + d2 / 2 : r1 + d1 / 2
  whirlPlace(W, sess)
  W.phase = (W.phase || 0) + (Math.PI * 2 / 90) * (W.spin || 0) * mo * dt
  let busy = (W.spin || 0) > 0.01
  for (let ring = 0; ring < 2; ring++) {
    const list = ring ? ringB : ringA, r = ring ? r2 : r1, ph = ring ? W.phase * 0.7 + 0.6 : W.phase
    for (let i = 0; i < list.length; i++) {
      const V = list[i], a = ph + Math.PI * 2 * i / list.length
      V.ringX = W.x + Math.cos(a) * r - V.tw / 2; V.ringY = W.y + Math.sin(a) * r * tilt.cos + (W.sat ? 0 : funnelDepth(r) * tilt.sin) - V.th / 2; V.ringSess = sess
      V.orbit = true; V.frozen = true; V.vx = 0; V.vy = 0
      if (V.drag) { busy = true; continue }
      const d = Math.hypot(V.ringX - V.lx, V.ringY - V.ly)
      if (!V.onRing) {
        // a newcomer is carried in by a tentacle when the creature can; otherwise it glides
        // (the creature may still be arriving: keep asking until it can, as long as the card is still far off)
        if (!V.ringAsked && requestDrag(V, sess, 'in')) { V.ringAsked = true; busy = true; continue }
        if (d < 60) V.ringAsked = true
        V.xfer = null
        if (d < 30) V.onRing = true; else busy = true
      }
      const k = 1 - Math.exp(-(V.onRing ? 14 : 2.5) * dt)
      V.lx += (V.ringX - V.lx) * k; V.ly += (V.ringY - V.ly) * k
      V.homeX = V.lx; V.homeY = V.ly
    }
  }
  if (busy) layout.awake = Math.max(layout.awake, 10)
}

// ---------- drags: the creature itself carries tomes between the ring and their static cells ----------
// A newly important tome is gripped in its ward cell and dragged along a gentle arc to its ring slot; one that
// drops out is taken off the ring and pushed back to its cell. The tip leads, the card trails on a soft spring.
// At most two drags per creature run at once; the rest queue. With motion off, cards simply glide.
const drags = new Map()
let dragSeq = 0
function requestDrag(V, sess, dir) {
  if (motion() <= 0.02 || !sess) return false
  const A = vis.actors.get(sess)
  if (!A || !A.present || A.alpha < 0.5 || !isFinite(A.x)) return false
  if (V.drag) return true
  const D = { id: 'drag~' + (++dragSeq), node: V.id, actor: sess, dir, phase: 'queued', at: 0, lid: '', grip: 0, sx: 0, sy: 0, dur: 1000 }
  drags.set(D.id, D); V.drag = D
  return true
}
function dragDest(V, D, out) {
  if (D.dir === 'in' && V.ringX !== undefined) { out[0] = V.ringX; out[1] = V.ringY }
  else { out[0] = V.slotX !== undefined ? V.slotX : V.lx; out[1] = V.slotY !== undefined ? V.slotY : V.ly }
}
function endDrag(D, V) {
  if (V && V.drag === D) V.drag = null
  const L = vis.limbs.get(D.lid)
  if (L) L.extT = 0
  drags.delete(D.id)
}
const dragRun = new Map()
function syncDrags(now, dt) {
  if (!drags.size) return
  const mo = motion()
  dragRun.clear()
  for (const D of drags.values()) if (D.phase !== 'queued') dragRun.set(D.actor, (dragRun.get(D.actor) || 0) + 1)
  for (const D of Array.from(drags.values())) {
    const V = vis.nodes.get(D.node), A = vis.actors.get(D.actor)
    const inWhirl = V && (V.gPull || 0) > 0.5
    if (!V || !A || !V.present || !A.present || mo <= 0.02 || (D.phase !== 'release' && (D.dir === 'in') !== inWhirl)) { endDrag(D, V); continue }
    if (D.phase === 'queued') {
      if ((dragRun.get(D.actor) || 0) >= 2) continue
      dragRun.set(D.actor, (dragRun.get(D.actor) || 0) + 1)
      D.phase = 'reach'; D.at = now
      const L = newLimb(D.id, { actor: D.actor, kind: 'drag', tool: '', node: '' }, A, false)
      L.prop = ''; vis.limbs.set(D.id, L); D.lid = D.id
    }
    const L = vis.limbs.get(D.lid)
    if (!L) { endDrag(D, V); continue }
    L.seen = true; L.node = ''; L.mode = 0; L.activeT = 1; L.waitT = 0; L.closedT = 0; L.extT = D.phase === 'release' ? 0 : 1
    limbRoot(A, L)
    const C = L.chain
    const tipx = C ? ROOT[0] + (C[0] - ROOT[0]) * L.ext : ROOT[0], tipy = C ? ROOT[1] + (C[1] - ROOT[1]) * L.ext : ROOT[1]
    const gpx = V.lx + V.tw / 2, gpy = V.ly + 4 // the grip point: the middle of the card's top edge
    if (D.phase === 'reach') {
      L.gx = gpx; L.gy = gpy
      if (Math.hypot(tipx - gpx, tipy - gpy) < 16 || now - D.at > 1800) {
        D.phase = 'drag'; D.at = now; D.sx = V.lx; D.sy = V.ly
        dragDest(V, D, ptmp)
        D.dur = clamp(Math.hypot(ptmp[0] - D.sx, ptmp[1] - D.sy) / 380, 0.8, 1.5) * 1000
      }
    }
    D.grip = ease(D.grip, D.phase === 'drag' ? 1 : 0, 10, dt); L.grip = D.grip
    if (D.phase === 'drag') {
      dragDest(V, D, ptmp)
      const u = c01((now - D.at) / D.dur), k = smooth(u)
      const dx = ptmp[0] - D.sx, dy = ptmp[1] - D.sy, dl = Math.hypot(dx, dy) || 1
      const bul = Math.min(60, dl * 0.15) * Math.sin(u * Math.PI) * (D.dir === 'in' ? 1 : -1)
      const px = D.sx + dx * k - dy / dl * bul, py = D.sy + dy * k + dx / dl * bul
      L.gx = px + V.tw / 2; L.gy = py + 4
      const kk = 1 - Math.exp(-9 * dt)
      V.lx += (tipx - V.tw / 2 - V.lx) * kk; V.ly += (tipy - 4 - V.ly) * kk
      if (u >= 1) { D.phase = 'release'; D.at = now; if (D.dir === 'in') V.onRing = true }
    } else if (D.phase === 'release') {
      L.gx = gpx; L.gy = gpy
      if (now - D.at > 300) { endDrag(D, V); continue }
    }
    if (L.side < 0 || L.ext < 0.1) L.side = sideOf(A, L.gx, L.gy, L)
    limbRoot(A, L)
    L.facing = ((L.gx - A.x) * ROOT[2] + (L.gy - A.y) * ROOT[3]) / (Math.hypot(L.gx - A.x, L.gy - A.y) || 1)
    L.sgx = L.gx; L.sgy = L.gy
    layout.awake = Math.max(layout.awake, 10)
  }
}

// ---------- force layout on layout coordinates (lx, ly); drawn positions ease toward them ----------
let liveNodes = []
const slotMap = new Map()

function layoutStep(dt) {
  if (layout.awake <= 0) return
  const nowMs = performance.now()
  liveNodes.length = 0
  for (const V of vis.nodes.values()) if (V.alive) liveNodes.push(V)
  const n = liveNodes.length
  if (!n) return
  const s = clamp(dt * 60, 0.2, 2)
  const mo = motion()
  // group membership: the whirlpool (while its session works), the sleeping cloud, or the home ward
  for (const g of slotMap.values()) g.length = 0
  for (let i = 0; i < n; i++) {
    const V = liveNodes[i]
    const W = V.attnSess ? vis.whirls.get(V.attnSess) : null
    const pull = W && W.alpha > 0.02 ? (V.pull || 0) : 0
    const sleepy = W && W.calpha > 0.02 && V.attn > 0.03 ? 1 - pull : 0
    V.gPull = pull; V.gSleepy = sleepy; V.gW = W
    const key = pull > 0.5 ? 'whirl:' + V.attnSess : sleepy > 0.5 ? 'cloud:' + V.attnSess : 'ward:' + V.folder
    V.group = key
    V.inWard = pull <= 0.5 && sleepy <= 0.5
    // leaving the ring: the creature pushes the card back to its cell (or it glides, with motion off)
    const onWhirl = pull > 0.5
    if (V.wasWhirl && !onWhirl) { V.onRing = false; V.ringAsked = false; if (!V.drag) requestDrag(V, V.ringSess, 'out') }
    V.wasWhirl = onWhirl; V.orbit = false
    if (sleepy > 0.5 || pull > 0.5) { let l = slotMap.get(key); if (!l) { l = []; slotMap.set(key, l) }; l.push(V) }
  }
  // the sleeping clouds grid their members around the cloud; the whirlpools turn their rings; ward residents
  // already hold their packed cells
  for (const [key, l] of slotMap) {
    if (!l.length) continue
    if (key.charCodeAt(0) === 119) orbitRing(key.slice(6), l, dt)
    else cloudRing(key.slice(6), l)
  }
  // forces, scaled by inverse mass: heavy tomes are affixed to their home and barely answer to the crowd
  for (let i = 0; i < n; i++) {
    const V = liveNodes[i]
    const cx = V.lx + V.tw / 2, cy = V.ly + V.th / 2
    const m = V.mass || 1, inv = 1 / m
    const heavy = clamp((m - 0.8) / 2.2, 0, 1)
    const W = V.gW, pull = V.gPull, sleepy = V.gSleepy
    // a card in a tentacle's grip, or on a ring, is carried: no forces act on it
    if ((V.drag || V.orbit) && !V.pin) { V.frozen = true; V.vx = 0; V.vy = 0; V.homeX = V.lx; V.homeY = V.ly; continue }
    // the home position: the packed cell in its ward, a grid slot in the cloud, or where it orbits
    let hx, hy
    if (pull > 0.5) { hx = V.lx; hy = V.ly }
    else { hx = V.slotX !== undefined ? V.slotX : V.lx; hy = V.slotY !== undefined ? V.slotY : V.ly }
    // the user's hand: a card being dragged or pinned sits where it was put; its ward-mates and the cards bound
    // to a dragged card follow softly (medium and weak springs), and settle back when it is released
    if (V.pin) { hx = V.pin[0]; hy = V.pin[1] }
    if (view.dragNode === V) { hx = V.pin ? V.pin[0] : hx; hy = V.pin ? V.pin[1] : hy }
    else if (view.dragNode && view.dragNode.present) {
      const D = view.dragNode, ox = D.lx - (D.dragFrom ? D.dragFrom[0] : D.lx), oy = D.ly - (D.dragFrom ? D.dragFrom[1] : D.ly)
      if (!V.pin && D.folder === V.folder) { hx += ox * 0.3; hy += oy * 0.3 }
      else if (!V.pin && bound(D, V)) { hx += ox * 0.12; hy += oy * 0.12 }
    }
    if (V.homeX === undefined || !isFinite(V.homeX)) { V.homeX = hx; V.homeY = hy }
    V.homeX = hx; V.homeY = hy
    // everything on an orbit is kinematic, outside the forces: it rides its slot (the rings turn slowly), and a
    // slot far away (a change of status) is reached by an orbital transfer: a spiral in or out with momentum,
    // a faint trail behind, then an overshoot that settles. Motion off: a plain glide.
    V.frozen = true
    V.vx = 0; V.vy = 0
    const dx = V.homeX - V.lx, dy = V.homeY - V.ly, dd = Math.hypot(dx, dy)
    if (V.xfer) {
      const X = V.xfer, u = c01((nowMs - X.t0) / X.dur)
      // the angle takes the short way round, the radius eases out with a little overshoot
      const hpx = V.homeX + V.tw / 2 - pack.cx, hpy = (V.homeY + V.th / 2 - pack.cy) / tilt.cos
      const r1 = Math.hypot(hpx, hpy), a1 = Math.atan2(hpy, hpx)
      let da = a1 - X.a0; da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2
      const eb = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2), es = smooth(u)
      const r = X.r0 + (r1 - X.r0) * eb, a = X.a0 + da * es
      projectPolar(a, r, prj); V.lx = prj[0] - V.tw / 2; V.ly = prj[1] - V.th / 2
      if (nowMs - X.trailAt > 50) { X.trailAt = nowMs; V.trail.push(V.lx + V.tw / 2, V.ly + V.th / 2); if (V.trail.length > 24) V.trail.splice(0, 2) }
      if (u >= 1) { V.xfer = null; V.lx = V.homeX; V.ly = V.homeY; V.trailEnd = nowMs }
      layout.awake = Math.max(layout.awake, 10)
      continue
    }
    if (dd > 90 && mo > 0.02 && pack.init && !V.pin && !view.dragNode) {
      const cpx = V.lx + V.tw / 2 - pack.cx, cpy = (V.ly + V.th / 2 - pack.cy) / tilt.cos
      const r0 = Math.hypot(cpx, cpy), a0 = Math.atan2(cpy, cpx)
      V.xfer = { t0: nowMs, dur: clamp(dd / 260, 0.9, 1.7) * 1000, r0, a0, trailAt: 0 }
      V.trail = []
      continue
    }
    if (dd > 0.05) { const k = 1 - Math.exp(-(mo > 0.02 ? 5 : 30) * dt); V.lx += dx * k; V.ly += dy * k; if (dd < 0.4) { V.lx = V.homeX; V.ly = V.homeY } }
    continue
    // a strong spring to the home: the packed structure holds
    const kHome = pull > 0.5 ? 0.004 : sleepy > 0.5 ? 0.012 : 0.035 + 0.03 * heavy
    const fx = (V.homeX - V.lx) * kHome, fy = (V.homeY - V.ly) * kHome
    V.vx += fx * s; V.vy += fy * s
  }
  // bindings pull, faintly: they tilt a card within its cell, never out of it
  for (const E of vis.edges.values()) {
    const A = E.a, B = E.b
    if (!A.alive || !B.alive || E.tAlpha === 0 || A.inWard && B.inWard || A.frozen || B.frozen) continue
    const ax = A.lx + A.tw / 2, ay = A.ly + A.th / 2, bx = B.lx + B.tw / 2, by = B.ly + B.th / 2
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1
    const d0 = A.folder === B.folder ? 190 : 330
    const k = (d - d0) * 0.0005 * s
    const ux = dx / d * k, uy = dy / d * k
    A.vx += ux / (A.mass || 1); A.vy += uy / (A.mass || 1); B.vx -= ux / (B.mass || 1); B.vy -= uy / (B.mass || 1)
  }
  // integrate: heavy damping (near critical for the home springs), capped speed
  let maxSp = 0
  for (let i = 0; i < n; i++) {
    const V = liveNodes[i]
    const heavy = clamp(((V.mass || 1) - 0.8) / 2.2, 0, 1)
    const damp = Math.pow(0.7 - 0.1 * heavy, s)
    V.vx *= damp; V.vy *= damp
    const sp = Math.hypot(V.vx, V.vy)
    const cap = 8 - 5 * heavy
    if (sp > cap) { V.vx *= cap / sp; V.vy *= cap / sp }
    V.lx += V.vx * s; V.ly += V.vy * s
    if (sp > maxSp) maxSp = sp
  }
  // rect collision: sweep on x, positional correction weighted by inverse mass (heavy pushes light)
  liveNodes.sort((a, b) => a.lx - b.lx)
  const PAD = 18
  let corr = 0
  for (let i = 0; i < n; i++) {
    const A = liveNodes[i]
    const ax1 = A.lx + A.tw + PAD
    for (let j = i + 1; j < n; j++) {
      const B = liveNodes[j]
      if (B.lx > ax1) break
      const ox = Math.min(A.lx + A.tw, B.lx + B.tw) - Math.max(A.lx, B.lx) + PAD
      const oy = Math.min(A.ly + A.th, B.ly + B.th) - Math.max(A.ly, B.ly) + PAD
      if (ox <= 0 || oy <= 0) continue
      if (A.frozen && B.frozen) continue
      const ma = A.mass || 1, mb = B.mass || 1
      const wa = A.frozen ? 0 : B.frozen ? 1 : mb / (ma + mb), wb = B.frozen ? 0 : A.frozen ? 1 : ma / (ma + mb)
      const push = Math.min(ox, oy) * 0.5
      if (ox < oy) { const d = A.lx + A.tw / 2 < B.lx + B.tw / 2 ? 1 : -1; A.lx -= d * push * wa; B.lx += d * push * wb }
      else { const d = A.ly + A.th / 2 < B.ly + B.th / 2 ? 1 : -1; A.ly -= d * push * wa; B.ly += d * push * wb }
      corr = Math.max(corr, push)
    }
  }
  // piles are immovable: a card drifting onto one (orbiting a whirlpool, say) is pushed off it
  for (const P of vis.piles.values()) {
    if (P.n < 2 || !isFinite(P.x)) continue
    const px0 = P.x - PAD, py0 = P.y - 6 - PAD, px1 = P.x + 70 + PAD, py1 = P.y + 44 + PAD
    for (let i = 0; i < n; i++) {
      const V = liveNodes[i]
      if (V.frozen || V.lx + V.tw < px0 || V.lx > px1 || V.ly + V.th < py0 || V.ly > py1) continue
      const dl = V.lx + V.tw - px0, dr = px1 - V.lx, du = V.ly + V.th - py0, dd = py1 - V.ly
      const m = Math.min(dl, dr, du, dd) * 0.5
      if (m === dl * 0.5) V.lx -= m; else if (m === dr * 0.5) V.lx += m; else if (m === du * 0.5) V.ly -= m; else V.ly += m
      corr = Math.max(corr, m)
    }
  }
  // net displacement over a short window decides sleep: a stuck jitter counts as rest
  layout.frames = (layout.frames || 0) + 1
  if (layout.frames % 30 === 0) {
    let moved = 0
    for (let i = 0; i < n; i++) { const V = liveNodes[i]; if (V.sx !== undefined) moved = Math.max(moved, Math.hypot(V.lx - V.sx, V.ly - V.sy)); V.sx = V.lx; V.sy = V.ly }
    layout.net = moved
    if (moved < 2.5) layout.awake -= 20
  }
  layout.energy = Math.max(maxSp, corr * 0.5)
  // settling: once nothing moves, the solver sleeps and the map holds still until something happens
  if (layout.energy < 0.06) layout.awake--; else layout.awake = Math.min(layout.awake + 1, 120)
  if (layout.awake <= 0) for (let i = 0; i < n; i++) { liveNodes[i].vx = 0; liveNodes[i].vy = 0 }
}

// ---------- per-frame animation of eased properties ----------

function animate(dt, now) {
  const r6 = 6, r10 = 10
  for (const V of vis.nodes.values()) {
    if (V.pileOf) { const P = vis.piles.get(V.pileOf); if (P) { V.lx = ease(V.lx, P.x, 2, dt); V.ly = ease(V.ly, P.y, 2, dt) } }
    V.dim = ease(V.dim === undefined ? 1 : V.dim, V.tDim === undefined ? 1 : V.tDim, 1.5, dt); V.pile = ease(V.pile || 0, V.tPile || 0, 2, dt)
    if (!isFinite(V.lx) || !isFinite(V.ly)) { V.lx = isFinite(V.homeX) ? V.homeX : 0; V.ly = isFinite(V.homeY) ? V.homeY : 0; V.vx = 0; V.vy = 0; V.homeX = V.lx; V.homeY = V.ly }
    if (!isFinite(V.x) || !isFinite(V.y)) { V.x = V.lx; V.y = V.ly }
    V.x = ease(V.x, V.lx, 5, dt); V.y = ease(V.y, V.ly, 5, dt)
    V.w = ease(V.w, V.tw, r6, dt); V.h = ease(V.h, V.th, r6, dt)
    V.alpha = ease(V.alpha, V.present ? (V.alive ? 1 : 0.5) : 0, V.present ? 4 : 2.5, dt)
    V.scale = ease(V.scale, V.present ? 1 : 0.8, 4.5, dt)
    V.hRead = ease(V.hRead, V.tRead, r6, dt); V.hEdit = ease(V.hEdit, V.tEdit, r6, dt); V.hExt = ease(V.hExt, V.tExt, r6, dt)
    V.hFresh = ease(V.hFresh, V.tFresh, r6, dt); V.hGhost = ease(V.hGhost, V.tGhost, 3, dt)
    V.gaze = ease(V.gaze || 0, V.gazeT || 0, 8, dt); V.gazeT = 0
    for (let i = 0; i < V.rows.length; i++) { const r = V.rows[i]; r.r = ease(r.r, r.tr, r10, dt); r.e = ease(r.e, r.te, r10, dt); r.f = ease(r.f, r.tf, r10, dt) }
  }
  for (const E of vis.edges.values()) {
    E.prog = ease(E.prog, E.tProg, 7, dt); E.glow = ease(E.glow, E.tGlow, 4, dt); E.alpha = ease(E.alpha, E.tAlpha, 4, dt)
    E.dying = ease(E.dying, E.tDying, 6, dt); E.pend = ease(E.pend, E.tPend, 8, dt)
  }
  for (const W of vis.wards.values()) {
    W.x = ease(W.x, W.tx, 6, dt); W.y = ease(W.y, W.ty, 6, dt); W.w = ease(W.w, W.tw, 6, dt); W.h = ease(W.h, W.th, 6, dt)
    W.alpha = ease(W.alpha, W.tAlpha, W.tAlpha > W.alpha ? 1.1 : 3, dt); W.active = ease(W.active, W.tActive, 3, dt)
  }
  const sdt = Math.min(dt, 1 / 30)
  for (const [id, A] of vis.actors) {
    swimStep(A, now, sdt)
    tendrilStep(A, sdt, now)
    A.alpha = ease(A.alpha, A.present ? 1 : 0, A.present ? 3 : 1.5, dt)
    A.born = ease(A.born, 0, 0.9, dt)
    const mc = rgb(MOODCOL[A.mood] || IRIS)
    for (let i = 0; i < 3; i++) A.col[i] = ease(A.col[i], mc[i], 5, dt)
    // the body's fill carries a hint of the mood; limbs use exactly the same fill and outline
    const pb = rgb(PYR)
    A.fill = 'rgb(' + Math.round(pb[0] * 0.92 + A.col[0] * 0.08) + ',' + Math.round(pb[1] * 0.92 + A.col[1] * 0.08) + ',' + Math.round(pb[2] * 0.92 + A.col[2] * 0.08) + ')'
    A.tone = A.parent ? THRALL : A.hue
    A.open = ease(A.open, A.mood === 'thinking' ? 0.3 : 1, 6, dt)
    A.aura = ease(A.aura, A.mood === 'idle' ? 0.5 : 1, 3, dt)
    // the pupil follows the thrall it oversees, else the gaze point of its eye stalk (saccading over rows), else the limb target
    let lx = 0, ly = 0, found = false, rate = 6, eyeKey = ''
    for (const L of vis.limbs.values()) if (L.actor === id && L.extT > 0) {
      const px = L.eye ? L.lx : L.gx, py = L.eye ? L.ly : L.gy
      const dx = px - A.x, dy = py - A.y, d = Math.hypot(dx, dy) || 1; lx = dx / d; ly = dy / d; found = true
      // reading: the pupil sweeps the line left to right with the stalk, snapping back at the line's end
      if (L.eye && L.scanU !== undefined) { lx = lx * 0.55 + (L.scanU * 2 - 1) * 0.5; ly = ly * 0.55 + 0.12; rate = 30 }
      if (L.eye) rate = 16
      eyeKey = L.lookId || L.wanderNode || L.node || L.kind
      break
    }
    const Th = !found && A.thrall ? vis.actors.get(A.thrall) : null
    if (Th) { const dx = Th.x - A.x, dy = Th.y - A.y, d = Math.hypot(dx, dy) || 1; lx = dx / d; ly = dy / d; found = true; eyeKey = Th.id }
    blinkStep(A, eyeKey, now, A.seed)
    if (!found) { const dx = A.gx - A.x, dy = A.gy - A.y, d = Math.hypot(dx, dy); if (d > 30) { lx = dx / d * 0.5; ly = dy / d * 0.5 }; lx += Math.sin(now * 0.00037 + A.seed) * 0.18 * motion(); ly += Math.cos(now * 0.00029 + A.seed) * 0.08 * motion(); rate = 1.2 }
    A.look[0] = ease(A.look[0], lx, rate, dt); A.look[1] = ease(A.look[1], ly, rate, dt)
    A.pulse = ease(A.pulse || 0, 0, 2.2, dt)
    A.done = ease(A.done || 0, A.doneT || 0, A.doneT ? 1.6 : 7, dt)
    // the gape: close the eye, withdraw it, open the mouth over about 0.8 s; back the same way when the wait ends
    A.waitK = ease(A.waitK || 0, A.waitT || 0, 4.2, dt)
    A.bodyK = 1 + 0.3 * smooth(A.waitK)
    A.knot = ease(A.knot || 0, A.knotT || 0, 1.4, dt)
  }
  for (const L of vis.limbs.values()) {
    const A = vis.actors.get(L.actor)
    if (!A) { L.extT = 0; L.ext = 0; continue }
    L.ext = ease(L.ext, L.extT, L.extT ? 7 : 5, dt)
    L.closed = ease(L.closed, L.closedT, 8, dt)
    L.active = ease(L.active, L.activeT, 8, dt)
    L.wait = ease(L.wait, L.waitT, 8, dt)
    L.front = ease(L.front, L.frontT, 5, dt)
    // quick eased hops of the gaze between saccade targets
    L.lx = ease(L.lx, L.sgx, 18, dt); L.ly = ease(L.ly, L.sgy, 18, dt)
    // the tip appendage morphs between an eye and a club; the whole limb scales with its reach
    L.tipEye = ease(L.tipEye, L.eye ? 1 : 0, 6, dt); L.tipClub = ease(L.tipClub, L.eye ? 0 : 1, 6, dt)
    if (L.eye) blinkStep(L, L.lookId || L.wanderNode || L.node || L.kind, now, L.seed)
    limbRoot(A, L)
    const reach = Math.hypot(L.gx - ROOT[0], L.gy - ROOT[1])
    L.scale = ease(L.scale, clamp(reach / 240, 0.45, 1), 4, dt)
    chainStep(L, A, now, dt)
    // gulped blobs travel from the tip down to the root; arriving, they make the creature pulse once
    const mo = motion()
    for (let b = L.blobs.length - 1; b >= 0; b--) {
      const B = L.blobs[b]
      B.u += (0.28 + 0.1 * B.k) * Math.max(mo, 0.25) * dt
      if (B.u >= 1) { A.pulse = 1; A.pulseCol = B.col; L.blobs.splice(b, 1) }
    }
  }
  for (const [k, P] of vis.props) {
    P.alpha = ease(P.alpha, P.want || 0, P.want ? 5 : 2, dt); P.active = ease(P.active, P.activeT || 0, 6, dt)
    P.want = 0; P.activeT = 0
    if (P.alpha < 0.01 && !P.want) { vis.props.delete(k); continue }
    propStep(P, dt)
  }
  view.handle = ease(view.handle, view.live ? 1 : view.hf, 14, dt)
}

// ---------- snake tentacles: a follow-the-leader chain whose head hugs the card it works on ----------

const SNK_OFF = 10, SNK_RR = 14
const snkP = [0, 0]
function rectPerim(w, h) { return 2 * (w + h) - 8 * SNK_RR + 2 * Math.PI * SNK_RR }
// point at arclength u along a rounded rect, clockwise from the top-left corner's end
function rectPoint(x, y, w, h, u, out) {
  const rr = SNK_RR, P = rectPerim(w, h), ew = w - 2 * rr, eh = h - 2 * rr, qa = Math.PI * rr / 2
  u = ((u % P) + P) % P
  if (u < ew) { out[0] = x + rr + u; out[1] = y; return }
  u -= ew
  if (u < qa) { const a = -Math.PI / 2 + u / rr; out[0] = x + w - rr + Math.cos(a) * rr; out[1] = y + rr + Math.sin(a) * rr; return }
  u -= qa
  if (u < eh) { out[0] = x + w; out[1] = y + rr + u; return }
  u -= eh
  if (u < qa) { const a = u / rr; out[0] = x + w - rr + Math.cos(a) * rr; out[1] = y + h - rr + Math.sin(a) * rr; return }
  u -= qa
  if (u < ew) { out[0] = x + w - rr - u; out[1] = y + h; return }
  u -= ew
  if (u < qa) { const a = Math.PI / 2 + u / rr; out[0] = x + rr + Math.cos(a) * rr; out[1] = y + h - rr + Math.sin(a) * rr; return }
  u -= qa
  if (u < eh) { out[0] = x; out[1] = y + h - rr - u; return }
  u -= eh
  const a = Math.PI + u / rr; out[0] = x + rr + Math.cos(a) * rr; out[1] = y + rr + Math.sin(a) * rr
}
function nearestU(x, y, w, h, px, py) {
  const P = rectPerim(w, h)
  let best = 0, bd = 1e18
  for (let k = 0; k < 64; k++) {
    const u = P * k / 64
    rectPoint(x, y, w, h, u, snkP)
    const d = (snkP[0] - px) * (snkP[0] - px) + (snkP[1] - py) * (snkP[1] - py)
    if (d < bd) { bd = d; best = u }
  }
  return best
}

// where a limb streams to while its creature swims: behind the body, fanned out by its index
const trailP = [0, 0]
function trailGoal(L, A) {
  const R = A.r, n = Math.max(1, L.cnt || 1), k = (L.idx || 0) - (n - 1) / 2
  const px = -A.swimDy, py = A.swimDx
  const len = R * 1.6 + R * 3.6 * A.swimLen * (0.75 + 0.25 * ((L.idx || 0) % 2))
  const spread = k * R * 0.75 * A.swimSpread
  trailP[0] = A.x + A.swimDx * len + px * spread; trailP[1] = A.y + A.swimDy * len + py * spread
}

// the head of a working tentacle: hugs the card outline (slither, retreat, approach), sits on the row while editing
function steerHead(L, A, now, dt) {
  const N = L.snake && L.node ? vis.nodes.get(L.node) : null
  if (!N || !N.present) { L.u = -1; L.sm = 'work'; return [L.gx, L.gy] }
  const mo = motion()
  const rx = N.x - SNK_OFF, ry = N.y - SNK_OFF, rw = N.w + 2 * SNK_OFF, rh = N.h + 2 * SNK_OFF
  const P = rectPerim(rw, rh)
  // the outline point nearest the row being worked on (recomputed only when the target moves)
  if (L.u < 0 || Math.abs(L.wgx - L.gx) > 2 || Math.abs(L.wgy - L.gy) > 2 || L.wrw !== rw || L.wrh !== rh) { L.wu = nearestU(rx, ry, rw, rh, L.gx, L.gy); L.wgx = L.gx; L.wgy = L.gy; L.wrw = rw; L.wrh = rh; if (L.u < 0) L.u = L.wu }
  if (L.activeT > 0.5 || L.extT === 0 || A.swimK > 0.5) {
    // working: the head sits on the row and worries at it
    L.sm = 'work'
    // worrying at the row: fast, wide, with a sharp stamp onto it now and then
    const stamp = Math.max(0, Math.sin(now * 0.0052 + L.seed * 0.3)) ** 14
    let du = L.wu + (Math.sin(now * 0.0081 + L.seed) * 16 + Math.sin(now * 0.0137 + L.seed * 2) * 6) * mo - L.u
    L.stamp = stamp * mo
    du -= Math.round(du / P) * P
    L.u += du * (1 - Math.exp(-5 * dt))
    L.smAt = now + 1200
  } else if (mo > 0.02) {
    // idle in a burst: slither along the outline, retreat, twirl around, approach from elsewhere
    if (now > L.smAt) {
      const r = rnd(L.id, Math.floor(now / 20))
      if (L.sm === 'slither') { L.sm = 'retreat'; L.smAt = now + 900 + r * 700 }
      else if (L.sm === 'retreat') { L.sm = 'approach'; L.u += P * (0.25 + r * 0.5); L.uv = r < 0.5 ? -1 : 1; L.smAt = now + 2600 }
      else { L.sm = 'slither'; L.smAt = now + 2200 + r * 2400 }
    }
    if (L.sm === 'slither') L.u += L.uv * 55 * mo * dt
  }
  rectPoint(rx, ry, rw, rh, L.u, snkP)
  let gx = snkP[0], gy = snkP[1]
  if (L.sm === 'retreat') { const dx = A.x - gx, dy = A.y - gy, d = Math.hypot(dx, dy) || 1; gx += dx / d * Math.min(48, d * 0.5); gy += dy / d * Math.min(48, d * 0.5) }
  if (L.sm === 'approach' && Math.hypot(L.hx - gx, L.hy - gy) < 6) { L.sm = 'slither'; L.smAt = now + 2200 + rnd(L.id, Math.floor(now / 20)) * 2400 }
  return [gx, gy]
}

// every tentacle is a segment chain: the head is steered (reach/drag IK), the body follows the leader for path
// memory, Verlet inertia gives follow-through, and Jakobsen distance constraints keep the spacing; the tail is
// pinned on the root and leaves along the edge normal
