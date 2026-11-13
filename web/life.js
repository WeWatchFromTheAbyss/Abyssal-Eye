// Abyssal Eye live view, part 4 of 5: what makes the creatures alive. Living eyes (a 3D eyeball behind fixed lids,
// saccades, hypnosis), the waiting maw, the Fable pyramid's fringe, sleep, the pointer, slime, the tether tube,
// blobby frames, the tendril dance and the fanned pile. The bodies themselves (drawActor and the inspector) follow.
'use strict'

// dev aid, only with ?debug: force=hyp,slime,wait,sleep (comma separated) holds that state on every creature,
// and window.__abyss.force can be changed while the page runs
const force = { hyp: 0, slime: 0, wait: 0, sleep: 0 }
if (DEBUG) { const m = /[?&]force=([a-z,]+)/.exec(location.search); if (m) for (const k of m[1].split(',')) if (k in force) force[k] = 1 }

let frameT = 0, frameNow = 0
// the pointer in world space (mouse or touch); off when it is outside the sheet
const cur = { on: false, x: 0, y: 0 }
const prj2 = [0, 0], gz = [0, 0], BS = [1, 1]
// a cheap number hash in 0..1 (no strings), for things decided per eye or per tooth
function nh(a, b) {
  let h = Math.imul((a | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x7F4A7C15, 0xC2B2AE35)
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
function backOut(u) { const c = 1.9, v = u - 1; return u <= 0 ? 0 : u >= 1 ? 1 : 1 + (c + 1) * v * v * v + c * v * v }

// ---------- attention: who looks at whom, who listens, who works hard, who sleeps, where the pointer is ----------

const HYP_MS = 3200, HYP_MIN = 900, LOOK_MS = 2600, SLEEP_MS = 20000, WORK_MS = 9000, Z_MS = 3400
const workN = new Map()
function isFable(s, a) {
  for (let k = 0; k < 6 && a; k++) { if (a.model) return /fable/i.test(a.model); a = a.parent ? s.actors.get(a.parent) : null }
  return false
}
// once a frame, after syncActors: every creature's targets for this frame (eased later in lifeAnimate)
function lifeSync(S, T, now, dt) {
  frameT = T; frameNow = now
  if (motion() > 0.02) blobT = now // the blobby rims stand still with motion off
  cur.on = view.mx >= 0 && view.my >= 0 && view.my <= view.h - 4
  if (cur.on) { const c = view.cam; cur.x = (view.mx - view.w / 2) / c.z + c.x; cur.y = (view.my - view.h / 2) / c.z + c.y }
  workN.clear()
  for (const act of S.acts.values()) if (act.startT <= T && T - act.startT < WORK_MS) workN.set(act.actor, (workN.get(act.actor) || 0) + 1)
  const mo = motion()
  for (const V of vis.actors.values()) {
    const a = S.actors.get(V.id)
    V.lookActor = ''; V.lookT = 0; V.hypT = 0
    if (!a) { V.sleepT = 0; V.work = 0; V.curNear = false; V.reachT = 0; continue }
    V.fable = isFable(S, a)
    // listening: a thrall just summoned, or just spoken to, stares at its master until it starts to act
    if (a.parent) {
      const from = Math.max(a.bornT, a.toldT > 0 && a.toldT <= T ? a.toldT : 0), el = T - from
      if (el >= 0 && el < HYP_MS && (el < HYP_MIN || !(a.lastActT > from))) { V.hypT = 1; V.lookActor = a.parent; V.lookT = from }
      if (force.hyp) { V.hypT = 1; if (!V.lookActor) V.lookActor = a.parent }
    }
    if (force.wait) { V.waitT = 1; V.doneT = 0 }
    // hard at work: many acts in a short window, or a long busy streak
    const busy = V.mood !== 'idle'
    if (!busy) V.busyFrom = 0; else if (!V.busyFrom || V.busyFrom > T) V.busyFrom = T
    V.work = Math.max(clamp(((workN.get(a.id) || 0) - 4) / 6, 0, 1), busy && T - V.busyFrom > 20000 ? 0.5 : 0, force.slime)
    // asleep: nothing open, thinking or waiting for a while (a done session on its pentagram, a thrall left idle)
    const quiet = !busy && !a.thinking && !V.waitT && V.present
    V.sleepT = quiet && (force.sleep || T - Math.max(a.lastT || 0, a.bornT || 0) > SLEEP_MS) ? 1 : 0
    // the pointer: close enough to be noticed, and hovering long enough for the tendrils to reach for it
    const d = cur.on ? Math.hypot(cur.x - V.x, cur.y - V.y) : 1e9
    V.curNear = d < V.r * 2.5 + 24
    if (V.curNear) V.curAt = now
    const hov = d < Math.max(V.r * 8, 130)
    if (!hov) V.hovFrom = 0; else if (!V.hovFrom) V.hovFrom = now
    V.reachT = hov && now - V.hovFrom > 1500 && mo > 0.02 ? 1 : 0
  }
  // a parent's eye goes to the thrall it is dealing with: summoning it, speaking to it, hearing from it, its end
  for (const a of S.actors.values()) {
    if (!a.parent) continue
    const P = vis.actors.get(a.parent), V = vis.actors.get(a.id)
    if (!P || !V || V.alpha < 0.05 || P.hypT) continue
    let t = a.bornT
    if (a.toldT > t && a.toldT <= T) t = a.toldT
    if (a.saidT > t && a.saidT <= T) t = a.saidT
    if (a.doneT > t && a.doneT <= T) t = a.doneT
    if (a.idleT > t && a.idleT <= T) t = a.idleT
    if (T - t >= 0 && T - t < LOOK_MS && t > (P.lookT || 0)) { P.lookActor = a.id; P.lookT = t }
  }
  corrSync(S, T, now, dt)
}

// ---------- gaze: saccades ----------

// the look from an eye at (ex, ey) to a point, as a vector inside the unit disk: how far the ball has turned
function gazeTo(ex, ey, px, py, r) {
  const dx = px - ex, dy = py - ey, d = Math.hypot(dx, dy)
  if (d < 1e-3) { gz[0] = 0; gz[1] = 0; return }
  const m = Math.min(1, d / (r * 5)) * 0.92
  gz[0] = dx / d * m; gz[1] = dy / d * m
}
// an eye's gaze (o.gzx, o.gzy) follows its target in saccades: it holds a fixation until the target has moved
// off it, then jumps (a stiff, lightly damped spring: fast, a slight overshoot, then still), with tiny idle
// microsaccades in between. Motion off: it simply points.
function gazeStep(o, tx, ty, now, dt, seed) {
  if (o.gzx === undefined || !isFinite(o.gzx)) { o.gzx = tx; o.gzy = ty; o.gvx = 0; o.gvy = 0; o.ghx = tx; o.ghy = ty; o.ghAt = now; o.gmAt = 0; o.gmx = 0; o.gmy = 0 }
  const mo = motion()
  if (mo < 0.02) { o.gzx = tx; o.gzy = ty; o.gvx = 0; o.gvy = 0; o.ghx = tx; o.ghy = ty; return }
  const d = Math.hypot(tx - o.ghx, ty - o.ghy)
  if (d > 0.14 || (d > 0.025 && now > o.ghAt + 240)) { o.ghx = tx; o.ghy = ty; o.ghAt = now }
  if (now > o.gmAt) { const k = Math.floor(now / 40); o.gmx = (nh(seed, k) - 0.5) * 0.09; o.gmy = (nh(seed, k + 3) - 0.5) * 0.07; o.gmAt = now + 350 + nh(seed, k + 5) * 900 }
  const gx = o.ghx + o.gmx * mo, gy = o.ghy + o.gmy * mo
  const om = 44, ze = 0.5, h = Math.min(dt, 1 / 30) / 2
  for (let k = 0; k < 2; k++) {
    o.gvx += ((gx - o.gzx) * om * om - 2 * ze * om * o.gvx) * h; o.gvy += ((gy - o.gzy) * om * om - 2 * ze * om * o.gvy) * h
    o.gzx += o.gvx * h; o.gzy += o.gvy * h
  }
}
// a stateless saccade for the many small eyes: eye k holds a seeded look for a seeded dwell, then jumps to the next
function slotLook(seed, k, now, out) {
  if (motion() < 0.02) { out[0] = 0; out[1] = 0; return }
  const per = 900 + 137 * (k % 7), tt = now + k * 371, slot = Math.floor(tt / per), e = backOut((tt - slot * per) / 110)
  const a0 = nh(seed + k, slot - 1) * 6.283, m0 = 0.25 + 0.6 * nh(seed + k + 9, slot - 1)
  const a1 = nh(seed + k, slot) * 6.283, m1 = 0.25 + 0.6 * nh(seed + k + 9, slot)
  const x0 = Math.cos(a0) * m0, y0 = Math.sin(a0) * m0
  out[0] = x0 + (Math.cos(a1) * m1 - x0) * e; out[1] = y0 + (Math.sin(a1) * m1 - y0) * e
}
// what a creature must look at with every eye, if anything: the pointer when it is close (a stare when idle, quick
// glances while working), else whoever it is dealing with. (lx, ly): the eye in the body's frame. True when set.
function attn(A, lx, ly, now, k, out) {
  let tx = 0, ty = 0, ok = false
  if (A.curNear && (A.mood === 'idle' || ((now + (A.seed % 997) * 37 + k * 211) % 1500) < 300)) { tx = cur.x; ty = cur.y; ok = true }
  else { const W = A.lookActor ? vis.actors.get(A.lookActor) : null; if (W && W.alpha > 0.05) { tx = W.x; ty = W.y; ok = true } }
  if (!ok) return false
  const ta = A.tiltA || 0, c = Math.cos(-ta), s = Math.sin(-ta), dx = tx - A.x, dy = ty - A.y
  gazeTo(lx, ly, dx * c - dy * s, dx * s + dy * c, A.r * 0.4); out[0] = gz[0]; out[1] = gz[1]
  return true
}

// per creature, every frame (from animate): the main eye's gaze and the eased states of everything above
function lifeAnimate(A, id, now, dt) {
  const mo = motion()
  let lx = 0, ly = 0, found = false, eyeKey = ''
  const Who = A.lookActor ? vis.actors.get(A.lookActor) : null
  if (Who && Who.alpha > 0.05) { gazeTo(A.x, A.y, Who.x, Who.y, A.r); lx = gz[0]; ly = gz[1]; found = true; eyeKey = Who.id }
  if (!found) {
    // the item of its current act: the row its stalk reads, the row its tentacle works on
    const act = focus.cur.get(id)
    let L = act ? (vis.limbs.get(act.id) || vis.limbs.get(act.id + '~')) : null
    if (!L || !(L.extT > 0)) { L = null; for (const o of vis.limbs.values()) if (o.actor === id && o.extT > 0 && o.kind !== 'feed') { L = o; break } }
    if (L) {
      gazeTo(A.x, A.y, L.eye ? L.sgx : L.gx, L.eye ? L.sgy : L.gy, A.r); lx = gz[0]; ly = gz[1]; found = true
      // reading: the pupil sweeps the line with the stalk
      if (L.eye && L.scanU !== undefined) { lx = lx * 0.55 + (L.scanU * 2 - 1) * 0.5; ly = ly * 0.55 + 0.12 }
      eyeKey = L.lookId || L.wanderNode || L.node || L.kind
    }
  }
  const Th = !found && A.thrall ? vis.actors.get(A.thrall) : null
  if (Th) { gazeTo(A.x, A.y, Th.x, Th.y, A.r); lx = gz[0]; ly = gz[1]; found = true; eyeKey = Th.id }
  // the pointer: a stare when idle, a flick and back while working
  const working = A.mood !== 'idle'
  if (A.curNear && (!working || ((now + (A.seed % 997) * 37) % 1500) < 300)) { gazeTo(A.x, A.y, cur.x, cur.y, A.r * 0.4); lx = gz[0]; ly = gz[1]; found = true; if (!working) eyeKey = 'cursor' }
  blinkStep(A, eyeKey, now, A.seed)
  if (!found) { const dx = A.gx - A.x, dy = A.gy - A.y, d = Math.hypot(dx, dy); if (d > 30) { lx = dx / d * 0.5; ly = dy / d * 0.5 }; lx += Math.sin(now * 0.00037 + A.seed) * 0.18 * mo; ly += Math.cos(now * 0.00029 + A.seed) * 0.08 * mo }
  // waking with a start: the eye snaps open and darts
  const sleepT = A.sleepT || 0
  if (A.wasSleep && !sleepT && mo > 0.02) { A.gvx = (A.gvx || 0) + 8; A.gvy = (A.gvy || 0) - 5 }
  A.wasSleep = sleepT
  gazeStep(A, lx, ly, now, dt, A.seed)
  A.look[0] = A.gzx; A.look[1] = A.gzy
  A.hyp = ease(A.hyp || 0, A.hypT || 0, A.hypT ? 4.5 : 2.6, dt)
  A.sleep = ease(A.sleep || 0, sleepT, sleepT ? 0.7 : 9, dt)
  const peekT = A.curNear || now - (A.curAt || -1e9) < 3000 ? 1 : 0
  A.peek = ease(A.peek || 0, peekT, peekT ? 16 : 1.4, dt)
  A.reach = ease(A.reach || 0, A.reachT || 0, A.reachT ? 2 : 1.4, dt)
  A.dance = ease(A.dance || 0, sleepT && mo > 0.02 ? 1 : 0, sleepT ? 0.45 : 2.5, dt)
  // the wait: one linear clock over 1.2 s; every phase of the eye-to-mouth morph is an eased window on it
  A.waitK = clamp((A.waitK || 0) + (A.waitT ? 1 : -1) * dt / 1.2, 0, 1)
  A.bodyK = 1 + 0.3 * smooth(c01((A.waitK - 0.2) / 0.7))
  // the breath: slower and deeper asleep (a phase that only ever advances, so a change of pace never jumps)
  A.brPh = (A.brPh || 0) + dt * 1000 * (0.0019 - 0.0011 * A.sleep) * mo
  // squash and stretch along a fast move, in the body's own frame
  const v = Math.hypot(A.vx || 0, A.vy || 0)
  let sq = 0
  if (v > 40 && mo > 0.02) {
    const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0), ux = (A.vx * ca + A.vy * sa) / v, uy = (-A.vx * sa + A.vy * ca) / v
    sq = Math.min(0.14, v / 3500) * (ux * ux - uy * uy) * mo
  }
  A.sq = ease(A.sq || 0, sq, 9, dt)
  // the z's of sleep: one every 1.5 to 2.5 s
  if (!A.zs) A.zs = []
  if (sleepT && A.sleep > 0.6 && mo > 0.02 && now > (A.zAt || 0) && A.zs.length < 4) { A.zs.push({ t0: now, ph: Math.random() * 6.28 }); A.zAt = now + 1500 + Math.random() * 1000 }
  while (A.zs.length && now - A.zs[0].t0 > Z_MS) A.zs.shift()
}
// a stalk eye's gaze: the exact row or tome it reads; the pointer when it is close (a flick while its act runs)
function limbGaze(L, A, now, dt) {
  const ex = L.flt ? L.flt[0] : L.hx, ey = L.flt ? L.flt[1] : L.hy
  if (!isFinite(ex) || !isFinite(ey)) return
  let px = L.sgx, py = L.sgy
  if (A.curNear && (L.activeT < 0.5 || ((now + L.seed * 53) % 1500) < 300)) { px = cur.x; py = cur.y }
  gazeTo(ex, ey, px, py, 8)
  gazeStep(L, gz[0], gz[1], now, dt, L.seed)
}

// the body's own scale this frame: the swelling of a wait, the breath, squash and stretch
function bodyScale(A, now) {
  const w = A.waitK || 0, bk = A.bodyK || 1
  const bulge = 1 + 0.1 * smooth(c01((w - 0.3) / 0.6))
  const br = motion() > 0.02 ? (0.022 + 0.03 * (A.sleep || 0)) * Math.sin((A.brPh || 0) + (A.seed % 13)) : 0
  const sq = (A.sq || 0) + (A.corrSq || 0)
  BS[0] = bk * bulge * (1 + br + sq); BS[1] = bk * (1 - br * 0.7 - sq)
}

// ---------- the eyeball ----------
// A sphere turning behind fixed lids (the caller has clipped to the lids and filled the socket): the white shifts
// a little the way it looks, the iris further and flattens into an ellipse toward the rim, the pupil furthest; the
// glints stay where the light is. (gx, gy): the gaze inside the unit disk. slit: a vertical slit pupil.
// hyp: the iris turns into a spinning two-tone spiral and the pupil shrinks.
const hypC = [0, 0, 0]
function eyeGlobe(cx, cy, rb, ri, rp, gx, gy, col, slit, hyp, now, q) {
  let m = Math.hypot(gx, gy)
  if (m > 1) { gx /= m; gy /= m; m = 1 }
  const th = m * 0.95, sn = Math.sin(th), cs = Math.max(0.42, Math.cos(th * 1.05))
  const ux = m > 1e-4 ? gx / m : 1, uy = m > 1e-4 ? gy / m : 0, an = Math.atan2(uy, ux)
  const wx = cx + ux * sn * rb * 0.2, wy = cy + uy * sn * rb * 0.2
  g.fillStyle = SCLERA; g.beginPath(); g.arc(wx, wy, rb, 0, Math.PI * 2); g.fill()
  if (q >= 1) { g.strokeStyle = 'rgba(40,28,18,0.26)'; g.lineWidth = rb * 0.2; g.beginPath(); g.arc(wx, wy, rb * 0.92, 0, Math.PI * 2); g.stroke() }
  // the iris, foreshortened along the way it looks
  g.save(); g.translate(cx + ux * sn * rb * 0.62, cy + uy * sn * rb * 0.62); g.rotate(an); g.scale(cs, 1); g.rotate(-an)
  g.fillStyle = rgbaArr(col, 0.96); g.beginPath(); g.arc(0, 0, ri, 0, Math.PI * 2); g.fill()
  if (hyp > 0.02) {
    g.save(); g.clip()
    g.fillStyle = 'rgba(240,234,208,' + (0.92 * hyp).toFixed(3) + ')'; g.fillRect(-ri, -ri, ri * 2, ri * 2)
    hypC[0] = col[0] * 0.3; hypC[1] = col[1] * 0.3; hypC[2] = col[2] * 0.38
    g.strokeStyle = rgbaArr(hypC, hyp); g.lineWidth = ri * 0.27; g.lineCap = 'round'; g.lineJoin = 'round'
    const rot = now * 0.0062 * Math.max(0.3, motion())
    g.beginPath()
    for (let arm = 0; arm < 2; arm++) for (let s = 0; s <= 16; s++) {
      const t = s / 16, rr = ri * 1.12 * t, a = t * 7.2 + arm * Math.PI + rot
      if (s) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(0, 0)
    }
    g.stroke(); g.restore()
  }
  if (q >= 1) { g.strokeStyle = 'rgba(10,8,6,0.5)'; g.lineWidth = Math.max(0.5, ri * 0.14); g.beginPath(); g.arc(0, 0, ri * 0.93, 0, Math.PI * 2); g.stroke() }
  g.restore()
  // the pupil
  const pk = 1 - 0.6 * hyp
  g.save(); g.translate(cx + ux * sn * rb * 0.72, cy + uy * sn * rb * 0.72); g.rotate(an); g.scale(cs, 1); g.rotate(-an)
  g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, Math.max(0.3, rp * (slit ? 0.3 + 0.25 * hyp : pk)), Math.max(0.3, rp * pk), 0, 0, Math.PI * 2); g.fill()
  g.restore()
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(cx - rb * 0.3, cy - rb * 0.2, Math.max(0.5, rb * 0.13), 0, Math.PI * 2); g.fill()
  if (q === 2) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(cx + rb * 0.24, cy + rb * 0.16, Math.max(0.4, rb * 0.07), 0, Math.PI * 2); g.fill() }
}

// ---------- the waiting maw ----------
// One continuous morph on the wait clock w (0 to 1 over 1.2 s, and back the same way): the lid line becomes the
// lip line and widens (0.12 to 0.72), the lips part (0.3 to 0.9), the teeth grow from the gums (0.45 to 0.9), the
// tongue slides out last (0.68 to 1). Draw order: the dark interior, the tongue rooted in the throat (its inner
// part clipped to the opening, the rest out over the body), the teeth over the tongue where it crosses the lips,
// the gums, the lips.
const MAWX = new Float32Array(16), MAWY = new Float32Array(16), TN = 12
function mawPath(mw, cy, hu, hl) { g.beginPath(); g.moveTo(-mw, cy); g.quadraticCurveTo(0, cy - hu, mw, cy); g.quadraticCurveTo(0, cy + hl, -mw, cy); g.closePath() }
function drawMaw(A, R, ex, eyeY, mouthY, maxW, wk, now, sw, tone, mo, q) {
  const lipK = smooth(c01((wk - 0.12) / 0.6)), gapeK = smooth(c01((wk - 0.3) / 0.6)), toothK = smooth(c01((wk - 0.45) / 0.45)), tongueK = smooth(c01((wk - 0.68) / 0.32))
  if (lipK < 0.01) return
  const z = view.cam.z
  // (never wider than the body is at the mouth's height)
  const cy = eyeY + (mouthY - eyeY) * lipK, mw = Math.min(ex * (1 + 0.35 * lipK), maxW)
  const mh = R * (0.035 * lipK + 0.5 * gapeK * (0.88 + 0.12 * Math.sin(now * 0.0019 * mo)))
  const hu = mh * 1.1, hl = mh * 1.3
  const ga = g.globalAlpha
  mawPath(mw, cy, hu, hl); g.fillStyle = '#140709'; g.fill()
  if (q >= 1 && gapeK > 0.1) {
    g.save(); g.clip()
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.ellipse(0, cy + (hl - hu) * 0.12, mw * 0.5, Math.max(0.2, (hu + hl) * 0.16), 0, 0, Math.PI * 2); g.fill()
    g.restore()
  }
  g.lineCap = 'round'; g.lineJoin = 'round'
  if (tongueK > 0.02) {
    const flick = Math.pow(Math.max(0, Math.sin(now * 0.0031 + A.seed)), 5) * (mo > 0.02 ? 1 : 0)
    const len = R * (0.55 + 1.0 * flick) * tongueK
    const dirK = clamp(Math.sin(now * 0.0009 + A.seed) * 4, -1, 1), wv = Math.sin(now * 0.012 * mo + A.seed)
    const bx = 0, by = cy - hu * 0.1
    const tx = dirK * len * 0.8, ty = cy + hl * 0.5 + len * 0.55 + wv * R * 0.1
    const qx = dirK * len * 0.25, qy = cy + hl * 0.5 + len * 0.1 - wv * R * 0.12
    let out = TN + 1
    for (let i = 0; i <= TN; i++) {
      const t = i / TN, v = 1 - t, x = v * v * bx + 2 * v * t * qx + t * t * tx, y = v * v * by + 2 * v * t * qy + t * t * ty
      MAWX[i] = x; MAWY[i] = y
      if (out > TN) { const s = (x + mw) / (2 * mw), f = 2 * s * (1 - s); if (s <= 0 || s >= 1 || y < cy - hu * f || y > cy + hl * f) out = i }
    }
    const w0 = Math.max(1.6, R * 0.13)
    // inside the maw: clipped to the opening, darker, the root lost in the throat
    g.save(); mawPath(mw, cy, hu, hl); g.clip()
    g.strokeStyle = '#8E2A3A'; g.lineWidth = w0
    g.beginPath(); g.moveTo(MAWX[0], MAWY[0]); for (let i = 1; i <= Math.min(TN, out); i++) g.lineTo(MAWX[i], MAWY[i]); g.stroke()
    g.fillStyle = 'rgba(8,2,3,0.82)'; g.beginPath(); g.ellipse(bx, by, w0 * 1.2, w0, 0, 0, Math.PI * 2); g.fill()
    g.restore()
    // past the lips: out over the body, tapering to the fork
    if (out <= TN) {
      g.strokeStyle = '#C2414F'
      for (let i = Math.max(1, out); i <= TN; i++) { g.lineWidth = w0 * (1 - 0.45 * i / TN); g.beginPath(); g.moveTo(MAWX[i - 1], MAWY[i - 1]); g.lineTo(MAWX[i], MAWY[i]); g.stroke() }
      const fx = MAWX[TN] - MAWX[TN - 1], fy = MAWY[TN] - MAWY[TN - 1], fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl
      g.lineWidth = Math.max(1, w0 * 0.42); g.beginPath()
      for (let s = -1; s <= 1; s += 2) { g.moveTo(MAWX[TN], MAWY[TN]); g.lineTo(MAWX[TN] + (ux * 0.9 - uy * 0.5 * s) * R * 0.2, MAWY[TN] + (uy * 0.9 + ux * 0.5 * s) * R * 0.2) }
      g.stroke()
      if (q >= 1 && out < TN) { g.strokeStyle = 'rgba(90,20,30,0.6)'; g.lineWidth = Math.max(0.5, w0 * 0.15); g.beginPath(); g.moveTo(MAWX[out], MAWY[out]); for (let i = out + 1; i <= TN; i++) g.lineTo(MAWX[i], MAWY[i]); g.stroke() }
    }
  }
  // the teeth: two rows, uneven, sharp, curving a little toward the middle, a larger fang near each corner
  if (toothK > 0.02) {
    g.save(); mawPath(mw, cy, hu, hl); g.clip()
    const nu = R < 16 ? 7 : 9
    for (let row = 0; row < 2; row++) {
      const n = row ? nu - 1 : nu, sgn = row ? -1 : 1
      g.fillStyle = '#EDE6CC'; g.beginPath()
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) / n, x = -mw + s * 2 * mw, f = 2 * s * (1 - s)
        const yb = row ? cy + hl * f : cy - hu * f, gap = (hu + hl) * f
        const fang = k === 1 || k === n - 2 ? 1.55 : 1
        const tl = Math.min(gap * 0.66, (R * 0.2 * (0.62 + 0.38 * nh(A.seed + row * 7, k)) + gap * 0.16) * fang) * toothK
        const bw = mw / n * (0.82 + 0.3 * (fang - 1)), lean = (0.5 - s) * bw * 0.9
        g.moveTo(x - bw, yb - sgn)
        g.quadraticCurveTo(x - bw * 0.35 + lean * 0.3, yb + sgn * tl * 0.55, x + lean, yb + sgn * tl)
        g.quadraticCurveTo(x + bw * 0.55 + lean * 0.3, yb + sgn * tl * 0.45, x + bw, yb - sgn)
        g.closePath()
      }
      g.fill()
      if (q >= 1) { g.strokeStyle = 'rgba(70,48,34,0.55)'; g.lineWidth = Math.max(0.4, 0.5 / z); g.stroke() }
    }
    // the gums, a dark band over the teeth's bases
    g.strokeStyle = 'rgba(92,30,36,' + (0.9 * toothK).toFixed(3) + ')'; g.lineWidth = Math.max(1.2, R * 0.07)
    g.beginPath(); g.moveTo(-mw, cy); g.quadraticCurveTo(0, cy - hu, mw, cy); g.moveTo(-mw, cy); g.quadraticCurveTo(0, cy + hl, mw, cy); g.stroke()
    g.restore()
  }
  g.globalAlpha = ga * Math.min(1, lipK * 4)
  g.strokeStyle = tone; g.lineWidth = sw * (1 + 0.2 * lipK)
  g.beginPath(); g.moveTo(-mw, cy); g.quadraticCurveTo(0, cy - hu, mw, cy); g.moveTo(-mw, cy); g.quadraticCurveTo(0, cy + hl, mw, cy); g.stroke()
  g.globalAlpha = ga
}

// ---------- the pyramid's outline, and the Fable pyramid's flesh ----------
// A creature running on Fable keeps the pyramid and its eye, but its sides sag and undulate (never at the corners,
// so the silhouette stays a pyramid), faint ridges cross its face, small extra eyes open on it, and a fringe of
// face tentacles hangs writhing from its lower edge (an edit tentacle that roots there takes one's place).
function fableOff(A, i, t, now) {
  const env = Math.sin(Math.PI * t), mo = motion(), sd = A.seed % 31
  return A.r * env * ((i === 1 ? 0.1 : 0.045) + 0.028 * Math.sin(t * 9 + now * 0.0021 * mo + sd + i * 2.1) + 0.015 * Math.sin(t * 17 - now * 0.0033 * mo + i))
}
// the point at t along side i (0 right, 1 base, 2 left), in the body's frame
function sidePt(A, R, i, t, now, out) {
  const j = (i + 1) % 3, px = PVX[i] * R, py = PVY[i] * R, ex = PVX[j] * R - px, ey = PVY[j] * R - py
  let x = px + ex * t, y = py + ey * t
  if (A.fable) {
    const el = Math.hypot(ex, ey) || 1
    let nx = ey / el, ny = -ex / el
    if (nx * (px + ex / 2) + ny * (py + ey / 2) < 0) { nx = -nx; ny = -ny }
    const o = fableOff(A, i, t, now); x += nx * o; y += ny * o
  }
  out[0] = x; out[1] = y
}
function edgeRun(A, R, i, s, e, first) {
  if (e - s <= 0.002) return
  const n = A.fable ? Math.max(2, Math.ceil((e - s) * 10)) : 1
  for (let k = 0; k <= n; k++) { sidePt(A, R, i, s + (e - s) * k / n, frameNow, prj2); if (k || !first) g.lineTo(prj2[0], prj2[1]); else g.moveTo(prj2[0], prj2[1]) }
}
// one pyramid side from edge parameter a to b, leaving out the root span of its front arm
function edgeSegments(A, i, a, b) {
  const R = A.r, gp = A.gaps[i]
  if (!gp) { edgeRun(A, R, i, a, b, true); return }
  edgeRun(A, R, i, a, Math.min(b, gp[0]), true); edgeRun(A, R, i, Math.max(a, gp[1]), b, true)
}
// the trunk below the floating cap, as one closed path
function trunkPath(A, R, tc) {
  g.beginPath()
  sidePt(A, R, 2, 1 - tc, frameNow, prj2); g.moveTo(prj2[0], prj2[1])
  edgeRun(A, R, 0, tc, 1, false); edgeRun(A, R, 1, 0, 1, false); edgeRun(A, R, 2, 0, 1 - tc, false)
  g.closePath()
}
// a subtle rim light from the well on the sides that face it
const RIM = '#9FE8DC'
function rimDir(A, out) {
  let dx = pack.cx - A.x, dy = pack.cy - A.y
  const d = Math.hypot(dx, dy)
  if (!pack.init || d < A.r * 1.5) { dx = 0; dy = 1 } else { dx /= d; dy /= d }
  const ta = A.tiltA || 0, c = Math.cos(-ta), s = Math.sin(-ta)
  out[0] = dx * c - dy * s; out[1] = dx * s + dy * c
}
function rimLight(A, tc, sw) {
  rimDir(A, prj2)
  const lx = prj2[0], ly = prj2[1]
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, ex = PVX[j] - PVX[i], ey = PVY[j] - PVY[i], el = Math.hypot(ex, ey)
    let nx = ey / el, ny = -ex / el
    if (nx * (PVX[i] + ex / 2) + ny * (PVY[i] + ey / 2) < 0) { nx = -nx; ny = -ny }
    const f = nx * lx + ny * ly
    if (f < 0.15) continue
    g.strokeStyle = rgba(RIM, 0.26 * f); g.lineWidth = sw * 0.7
    g.beginPath(); edgeSegments(A, i, i === 0 ? tc : 0, i === 2 ? 1 - tc : 1); g.stroke()
  }
}
// one short face tentacle: six joints, a slow wave running root to tip, the tip curling; filled like the body and
// open at the root, so it grows out of the outline
const FLX = new Float32Array(8), FLY = new Float32Array(8), FRX = new Float32Array(8), FRY = new Float32Array(8)
function faceTentacle(x, y, ang, len, w0, ph, curl, now, mo) {
  const n = 6, seg = len / n
  let px = x, py = y, a = ang
  for (let j = 0; j <= n; j++) {
    const t = j / n, w = w0 * (1 - 0.82 * t) * 0.5, nx = -Math.sin(a), ny = Math.cos(a)
    FLX[j] = px + nx * w; FLY[j] = py + ny * w; FRX[j] = px - nx * w; FRY[j] = py - ny * w
    if (j < n) { a += Math.sin(now * 0.0031 * mo - j * 0.8 + ph) * 0.3 + curl * (t + 0.15); px += Math.cos(a) * seg; py += Math.sin(a) * seg }
  }
  g.beginPath(); g.moveTo(FLX[0], FLY[0])
  for (let j = 1; j < n; j++) g.quadraticCurveTo(FLX[j], FLY[j], (FLX[j] + FLX[j + 1]) / 2, (FLY[j] + FLY[j + 1]) / 2)
  g.lineTo(FLX[n], FLY[n]); g.lineTo(FRX[n], FRY[n])
  for (let j = n - 1; j >= 1; j--) g.quadraticCurveTo(FRX[j], FRY[j], (FRX[j] + FRX[j - 1]) / 2, (FRY[j] + FRY[j - 1]) / 2)
  g.lineTo(FRX[0], FRY[0])
  g.fill(); g.stroke()
}
// the fringe along the lower edge; the tentacles part and splay when the maw opens
function faceFringe(A, R, now, q, mo, sw) {
  const n = q === 0 ? 4 : A.parent ? 5 : 7, gape = smooth(c01(((A.waitK || 0) - 0.3) / 0.6)), gp = A.gaps[1]
  g.fillStyle = A.fill; g.strokeStyle = A.tone; g.lineWidth = sw * 0.8; g.lineJoin = 'round'; g.lineCap = 'round'
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, t = 0.1 + u * 0.8
    if (gp && t > gp[0] - 0.03 && t < gp[1] + 0.03) continue
    sidePt(A, R, 1, t, now, prj2)
    const c = (0.5 - u) * 2 // +1 at the right end of the base, -1 at the left
    const len = R * (0.55 + 0.4 * nh(A.seed, k)) * (1 - 0.5 * gape * (1 - Math.abs(c)))
    faceTentacle(prj2[0], prj2[1] - R * 0.03, Math.PI / 2 - c * (0.25 + 0.9 * gape), len, R * 0.2, k * 1.9 + (A.seed % 7), c * 0.14, now, mo)
  }
}
// the Fable inspector's hint of it: a few face tentacles under the sphere
function sphereFringe(A, Rs, now, q, mo, sw) {
  const n = q === 0 ? 3 : 5
  g.fillStyle = A.fill; g.strokeStyle = A.tone; g.lineWidth = sw * 0.8; g.lineJoin = 'round'; g.lineCap = 'round'
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) / n * 2 - 1, a = Math.PI / 2 - c * 0.75
    faceTentacle(Math.cos(a) * Rs * 0.95, Math.sin(a) * Rs * 0.95, a, Rs * (0.5 + 0.35 * nh(A.seed, k)), Rs * 0.17, k * 1.9 + (A.seed % 7), c * 0.14, now, mo)
  }
}
// faint ridges across the Fable pyramid's face
function fableRidges(A, R, apex, top, base, slope, sw) {
  g.strokeStyle = rgba(A.tone, 0.16); g.lineWidth = sw * 0.6
  g.beginPath()
  for (let k = 0; k < 3; k++) { const y = top + (base - top) * (0.34 + k * 0.24), hw = slope * (y - apex) * 0.84; g.moveTo(-hw, y - R * 0.02); g.quadraticCurveTo(0, y + R * 0.09, hw, y - R * 0.02) }
  g.stroke()
}
// the small extra eyes on a Fable pyramid's faces: (x, y, r) in units of R, clear of the main eye and the maw
const FABLE_EYES = [[-0.25, -0.3, 0.085], [0.25, -0.3, 0.085], [-0.68, 0.6, 0.1], [0.68, 0.6, 0.1]]
function fableEyes(A, R, now, q, mo, sw, asleep, wk) {
  if (q === 0 || R * view.cam.z < 6) return // (too small on the screen to read)
  for (let k = 0; k < FABLE_EYES.length; k++) {
    const e = FABLE_EYES[k], x = e[0] * R, y = e[1] * R, r = e[2] * R
    // each opens and closes on its own slow cycle; all open for the pointer, all shut in sleep, the lower pair in a gape
    const own = smooth(c01(Math.sin(now * 0.0004 * Math.max(mo, 0.2) + k * 2.4 + (A.seed % 17)) * 2 + 0.7))
    const open = Math.max(own, A.peek || 0) * (1 - 0.97 * asleep) * (k >= 2 ? 1 - smooth(c01((wk - 0.2) / 0.4)) : 1)
    const ew = r * 1.5, oh = r * 1.5 * open
    g.beginPath(); g.moveTo(x - ew, y); g.quadraticCurveTo(x, y - oh, x + ew, y); g.quadraticCurveTo(x, y + oh, x - ew, y); g.closePath()
    if (open > 0.12) {
      g.fillStyle = '#241B12'; g.fill()
      g.save(); g.clip()
      if (!attn(A, x, y, now, k + 1, prj2)) slotLook(A.seed, k + 31, now, prj2)
      eyeGlobe(x, y, r * 1.3, r * 0.7, r * 0.36, prj2[0], prj2[1] * 0.7, A.col, false, 0, now, 0)
      g.restore()
    }
    g.strokeStyle = A.tone; g.lineWidth = sw * 0.6
    g.beginPath(); g.moveTo(x - ew, y); g.quadraticCurveTo(x, y - oh, x + ew, y); g.moveTo(x - ew, y); g.quadraticCurveTo(x, y + oh, x + ew, y); g.stroke()
  }
}

// ---------- the main eye (and, when the creature waits on you, the maw it turns into) ----------
function drawActorEye(A, now) {
  const R = A.r, z = view.cam.z, q = Q(), mo = motion()
  const tone = A.tone, col = A.col
  const sw = Math.max(1.2, 0.9 / z)
  const base = R * 0.8
  g.save()
  g.translate(A.x + (A.hx || 0), A.y + (A.hy || 0)); g.rotate(A.tiltA || 0)
  g.globalAlpha = A.alpha
  bodyScale(A, now); g.scale(BS[0], BS[1])
  const insp = A.role === 'inspector'
  const ey = insp ? 0 : R * 0.22, ex = insp ? R * 0.6 : R * 0.52
  const wk = A.waitK || 0
  const eyeK = 1 - smooth(c01(wk / 0.55)), hyp = smooth(A.hyp || 0)
  const asleep = smooth(A.sleep || 0) * (1 - (A.peek || 0))
  const ta = A.tiltA || 0, ct = Math.cos(-ta), st = Math.sin(-ta)
  const lkx = A.look[0] * ct - A.look[1] * st, lky = A.look[0] * st + A.look[1] * ct
  if (A.fable && !insp) fableEyes(A, R, now, q, mo, sw, asleep, wk)
  if (eyeK > 0.02) {
    // the lids close and the eye sinks as the wait begins; heavy lids in sleep; parted wide when hypnotised
    const open = Math.max(A.open, hyp, A.peek || 0) * (1 - (A.blink || 0) * 0.95) * eyeK * (1 + 0.45 * hyp) * (1 - 0.96 * asleep) * (1 + 0.5 * (A.eyeWide || 0)) * (1 - 0.97 * (A.eyeShut || 0))
    const oy = R * 0.36 * open, cy = ey + R * 0.05 * (1 - eyeK)
    g.beginPath(); g.moveTo(-ex, cy); g.quadraticCurveTo(0, cy - oy, ex, cy); g.quadraticCurveTo(0, cy + oy, -ex, cy); g.closePath()
    g.fillStyle = '#241B12'; g.fill()
    if (open > 0.1) {
      g.save(); g.clip()
      const ir = R * 0.26 * (A.mood === 'writing' ? 1 + 0.1 * Math.sin(now * 0.009 * mo) : 1)
      eyeGlobe(0, cy, R * 0.5, ir, R * 0.25 * (1 - 0.5 * (A.eyeWide || 0)), lkx, lky * 0.6, col, true, hyp, now, q)
      if (eyeK < 0.98) { g.fillStyle = 'rgba(8,4,4,' + ((1 - eyeK) * 0.6).toFixed(3) + ')'; g.fillRect(-ex, cy - R, ex * 2, R * 2) }
      g.restore()
    }
    g.globalAlpha = A.alpha * Math.min(1, eyeK * 3)
    g.strokeStyle = tone; g.lineWidth = sw
    // asleep, the closed lids hang in a soft downward curve
    const droop = R * 0.07 * asleep
    g.beginPath(); g.moveTo(-ex, cy); g.quadraticCurveTo(0, cy - oy + droop, ex, cy); g.moveTo(-ex, cy); g.quadraticCurveTo(0, cy + oy + droop, ex, cy); g.stroke()
    g.globalAlpha = A.alpha
  }
  if (wk > 0.12) {
    // a Fable pyramid's maw opens lower, above its fringe; the lips stay inside the body's outline
    const my = A.fable && !insp ? R * 0.36 : ey
    drawMaw(A, R, ex, ey, my, insp ? R * 0.82 : 0.55 * (my + R * 1.2) * 0.8, wk, now, sw, tone, mo, q)
  }
  // rays of providence when awake and busy
  if (q >= 1 && !insp && wk < 0.2 && A.mood !== 'thinking' && A.mood !== 'idle') {
    g.strokeStyle = rgbaArr(col, 0.35 * (1 - wk * 5)); g.lineWidth = sw * 0.7
    g.beginPath()
    for (let k = 0; k < 9; k++) { const a = -Math.PI / 2 + (k - 4) * 0.19; const r0 = R * 1.35, r1 = R * (1.7 + 0.2 * Math.sin(now * 0.003 * mo + k)); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 - R * 0.1); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 - R * 0.1) }
    g.stroke()
  }
  if (A.mood === 'running' && mo > 0) {
    g.fillStyle = rgba(SULFUR, 0.8)
    for (let k = 0; k < 3; k++) { const u = ((now * 0.0008) + k * 0.33) % 1; g.globalAlpha = A.alpha * (1 - u); g.beginPath(); g.arc((k - 1) * R * 0.35, base - u * R * 1.6, R * 0.06, 0, Math.PI * 2); g.fill() }
  }
  g.restore()
}

// ---------- sleep: z's drifting up, and a few dream motes ----------
function drawSleep(A, now) {
  const k = A.sleep || 0
  if (k < 0.05 || A.alpha < 0.05) return
  const R = A.r, mo = motion(), z = view.cam.z
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = BONE
  if (mo <= 0.02) {
    g.globalAlpha = 0.45 * k * A.alpha; g.font = '600 ' + (11 / Math.min(1, Math.sqrt(z))).toFixed(1) + 'px ' + FONT
    g.fillText('z', A.x + R * 1.1, A.y - R * 1.7); g.restore(); return
  }
  if (A.zs) for (const Z of A.zs) {
    const u = (now - Z.t0) / Z_MS
    if (u < 0 || u > 1) continue
    g.globalAlpha = 0.5 * Math.sin(Math.PI * u) * k * A.alpha
    g.font = '600 ' + ((7 + 9 * u) / Math.min(1, Math.sqrt(z))).toFixed(1) + 'px ' + FONT
    g.save(); g.translate(A.x + R * (0.9 + 1.5 * u) + Math.sin(u * 5.5 + Z.ph) * R * 0.3, A.y - R * (1.4 + 3.2 * u)); g.rotate(Math.sin(u * 4 + Z.ph) * 0.25)
    g.fillText(u < 0.45 ? 'z' : 'Z', 0, 0); g.restore()
  }
  if (Q() === 2) {
    g.fillStyle = VIOLET
    for (let m = 0; m < 4; m++) {
      const u = (now * 0.00012 + m * 0.25 + (A.seed % 10) * 0.1) % 1
      g.globalAlpha = 0.3 * Math.sin(Math.PI * u) * k * A.alpha
      g.beginPath(); g.arc(A.x + Math.sin(u * 6 + m * 2.1) * R * 0.9, A.y - R * (1.5 + 1.6 * u), 1.2 + 0.5 * Math.sin(m * 1.7), 0, Math.PI * 2); g.fill()
    }
  }
  g.restore()
}

// ---------- slime: a creature hard at work oozes ----------
// A fixed pool. A drop beads on the body's lower edge or at a tentacle's root, swells, lets go, stretches and
// falls with gravity on a thin string that thins and snaps, splats faintly and fades. Tinted by the creature (a
// session's hue, violet for a subagent). It comes in bouts, never with motion off, and the pool scales by quality.
const SLIME_KEYS = ['x', 'y', 'vy', 'r', 't', 'ph', 'ox', 'oy', 'fall', 'y0', 'dur']
const slime = { cap: 0, n: 0, who: [] }
function slimeAlloc(cap) { slime.cap = cap; slime.n = 0; slime.who.length = 0; for (const k of SLIME_KEYS) slime[k] = new Float32Array(Math.max(1, cap)) }
function slimeDrop(i) { slime.n--; if (i < slime.n) { const j = slime.n; for (const k of SLIME_KEYS) slime[k][i] = slime[k][j]; slime.who[i] = slime.who[j] } slime.who.length = slime.n }
function syncSlime(dt, now) {
  const q = Q(), cap = q === 2 ? 56 : q === 1 ? 24 : 0
  if (slime.cap !== cap) slimeAlloc(cap)
  const mo = motion()
  if (!cap || mo <= 0.02) { slime.n = 0; slime.who.length = 0; return }
  for (const A of vis.actors.values()) {
    const k = A.work || 0
    if (k < 0.05 || A.alpha < 0.4 || slime.n >= cap) continue
    if (!force.slime && Math.sin(now * 0.0005 + (A.seed % 23)) < -0.2) continue // in bouts
    if (Math.random() > (0.5 + 2.2 * k) * (q === 2 ? 1 : 0.6) * mo * dt) continue
    const R = A.r * (A.bodyK || 1), i = slime.n++
    let ox, oy, picked = null
    if (Math.random() < 0.35) { let c = 0; for (const L of vis.limbs.values()) if (L.actor === A.id && L.ext > 0.5 && Math.random() < 1 / ++c) picked = L }
    if (picked) { limbRoot(A, picked); ox = ROOT[0] - A.x; oy = ROOT[1] - A.y }
    else {
      const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
      let lx, ly
      if (A.role === 'inspector') { const a = Math.PI / 2 + (Math.random() - 0.5) * 1.7; lx = Math.cos(a) * R * 1.05; ly = Math.sin(a) * R * 1.05 }
      else { lx = (Math.random() * 2 - 1) * R * 1.0; ly = R * 0.8 }
      ox = lx * ca - ly * sa; oy = lx * sa + ly * ca
    }
    slime.ox[i] = ox; slime.oy[i] = oy; slime.x[i] = A.x + ox; slime.y[i] = A.y + oy; slime.vy[i] = 0
    slime.r[i] = (1.6 + Math.random() * 2.2) * (A.parent ? 0.78 : 1); slime.t[i] = 0; slime.ph[i] = 0
    slime.fall[i] = 34 + Math.random() * 60; slime.dur[i] = 0.7 + Math.random() * 0.8; slime.y0[i] = 0
    slime.who[i] = A
  }
  for (let i = 0; i < slime.n; i++) {
    const A = slime.who[i]
    slime.t[i] += dt * mo
    if (slime.ph[i] === 0) {
      slime.x[i] = A.x + slime.ox[i]; slime.y[i] = A.y + slime.oy[i]
      if (slime.t[i] > slime.dur[i] || A.alpha < 0.2) { slime.ph[i] = 1; slime.t[i] = 0; slime.y0[i] = slime.y[i]; slime.vy[i] = 12 }
    } else if (slime.ph[i] === 1) {
      slime.vy[i] += 520 * dt * mo; slime.y[i] += slime.vy[i] * dt * mo
      if (slime.y[i] - slime.y0[i] >= slime.fall[i]) { slime.ph[i] = 2; slime.t[i] = 0 }
    } else if (slime.t[i] > 0.7) { slimeDrop(i); i-- }
  }
}
const slimeC = [0, 0, 0]
function drawSlime() {
  if (!slime.n) return
  g.save(); g.lineCap = 'round'
  for (let i = 0; i < slime.n; i++) {
    const x = slime.x[i], y = slime.y[i], r = slime.r[i], t = slime.t[i], ph = slime.ph[i], A = slime.who[i]
    if (!inView(x - 14, y - 80, 28, 110)) continue
    const c = rgb(A.parent ? VIOLET : (A.hue || FLESHLINE))
    slimeC[0] = c[0] * 0.5; slimeC[1] = c[1] * 0.5; slimeC[2] = c[2] * 0.5
    let rx = r, ry = r, cx = x, cy = y, al = 0.78 * A.alpha
    if (ph === 0) { const s = smooth(t / slime.dur[i]); rx = r * (0.45 + 0.55 * s); ry = r * (0.45 + 0.95 * s); cy = y + ry * 0.75 }
    else if (ph === 1) {
      const sp = Math.min(1, slime.vy[i] / 260); rx = r * (1 - 0.25 * sp); ry = r * (1 + 0.9 * sp)
      // the string back to where it hung, thinning and snapping before the drop lands
      const u = (y - slime.y0[i]) / (slime.fall[i] * 0.75)
      if (u < 1) { g.strokeStyle = rgbaArr(c, 0.5 * (1 - u) * A.alpha); g.lineWidth = Math.max(0.5, r * 0.5 * (1 - u)); g.beginPath(); g.moveTo(A.x + slime.ox[i], A.y + slime.oy[i]); g.quadraticCurveTo(x + (A.x + slime.ox[i] - x) * 0.3, (y + A.y + slime.oy[i]) / 2, x, y - ry * 0.8); g.stroke() }
    } else {
      const s = smooth(t / 0.7); rx = r * (1 + 1.8 * s); ry = Math.max(0.3, r * (0.45 - 0.3 * s)); al *= (1 - s) * 0.75
      g.fillStyle = rgbaArr(c, al * 0.8)
      g.beginPath(); g.arc(x - rx * 1.25, y - s * 3, 0.7, 0, Math.PI * 2); g.arc(x + rx * 1.2, y - s * 2, 0.6, 0, Math.PI * 2); g.fill()
    }
    g.fillStyle = rgbaArr(c, al * 0.8); g.strokeStyle = rgbaArr(slimeC, al * 0.7); g.lineWidth = 0.6
    g.beginPath(); g.ellipse(cx, cy, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2); g.fill(); g.stroke()
    // the neck of a hanging bead, and the gloss
    if (ph === 0) { g.beginPath(); g.moveTo(x - rx * 0.7, y); g.lineTo(x + rx * 0.7, y); g.lineTo(x, cy); g.closePath(); g.fill() }
    if (ph !== 2) { g.fillStyle = 'rgba(255,255,255,' + (0.6 * A.alpha).toFixed(3) + ')'; g.beginPath(); g.arc(cx - rx * 0.32, cy - ry * 0.35, Math.max(0.5, rx * 0.26), 0, Math.PI * 2); g.fill() }
  }
  g.restore()
}

// ---------- blobby frames ----------
// A soft outline: the shape pushed out by `base` plus two slow low waves travelling round it (whole numbers of
// waves per lap, so it closes without a seam). The same offset is used where a connection ends on a card.
const CARD_RR = 9, BLOB_BASE = 2.6, BLOB_AMP = 2
const BX = new Float32Array(64), BY = new Float32Array(64)
function blobOff(d, per, amp, t, seed) {
  const n1 = Math.max(2, Math.round(per / 190)), k = Math.PI * 2 / per
  return amp * (0.6 * Math.sin(d * k * n1 - t * 0.0011 + seed) + 0.4 * Math.sin(d * k * (n1 + 3) + t * 0.0017 + seed * 1.7))
}
function blobClose(n) {
  if (!blobKeep) g.beginPath() // (blobKeep: add this outline to the path already begun)
  g.moveTo((BX[n - 1] + BX[0]) / 2, (BY[n - 1] + BY[0]) / 2)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; g.quadraticCurveTo(BX[i], BY[i], (BX[i] + BX[j]) / 2, (BY[i] + BY[j]) / 2) }
  g.closePath()
}
function blobRect(x, y, w, h, rr, base, amp, t, seed) {
  rr = Math.min(rr, w / 2, h / 2)
  const ew = w - 2 * rr, eh = h - 2 * rr, qa = Math.PI * rr / 2, per = 2 * (ew + eh) + 4 * qa
  const n = clamp(Math.round(per / 16), 14, 60)
  for (let i = 0; i < n; i++) {
    const d = per * i / n
    let u = d, px, py, nx, ny
    if (u < ew) { px = x + rr + u; py = y; nx = 0; ny = -1 }
    else if ((u -= ew) < qa) { const a = -Math.PI / 2 + u / rr; nx = Math.cos(a); ny = Math.sin(a); px = x + w - rr + nx * rr; py = y + rr + ny * rr }
    else if ((u -= qa) < eh) { px = x + w; py = y + rr + u; nx = 1; ny = 0 }
    else if ((u -= eh) < qa) { const a = u / rr; nx = Math.cos(a); ny = Math.sin(a); px = x + w - rr + nx * rr; py = y + h - rr + ny * rr }
    else if ((u -= qa) < ew) { px = x + w - rr - u; py = y + h; nx = 0; ny = 1 }
    else if ((u -= ew) < qa) { const a = Math.PI / 2 + u / rr; nx = Math.cos(a); ny = Math.sin(a); px = x + rr + nx * rr; py = y + h - rr + ny * rr }
    else if ((u -= qa) < eh) { px = x; py = y + h - rr - u; nx = -1; ny = 0 }
    else { u -= eh; const a = Math.PI + u / rr; nx = Math.cos(a); ny = Math.sin(a); px = x + rr + nx * rr; py = y + rr + ny * rr }
    const o = base + blobOff(d, per, amp, t, seed)
    BX[i] = px + nx * o; BY[i] = py + ny * o
  }
  blobClose(n)
}
function blobCircle(cx, cy, r, amp, t, seed) {
  const n = 14
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, o = r + amp * (0.6 * Math.sin(a * 3 - t * 0.0013 + seed) + 0.4 * Math.sin(a * 5 + t * 0.0019 + seed * 1.7)); BX[i] = cx + Math.cos(a) * o; BY[i] = cy + Math.sin(a) * o }
  blobClose(n)
}
// where a connection lands on a blobby card: the point on the rect, pushed out to the outline as drawn
// (r: the drawn rect with r[4] its scale, r[5] whether the blob is drawn, r[6] its seed)
function blobEnd(r, side) {
  if (!(r[5] > 0)) return
  const sc = r[4] || 1, w = r[2] / sc, h = r[3] / sc, rr = Math.min(CARD_RR, w / 2, h / 2)
  const ew = w - 2 * rr, eh = h - 2 * rr, qa = Math.PI * rr / 2, per = 2 * (ew + eh) + 4 * qa
  const lx = (ptmp[0] - r[0]) / sc, ly = (ptmp[1] - r[1]) / sc
  let d, nx = 0, ny = 0
  if (side === 0) { d = ew + qa + (ly - rr); nx = 1 }
  else if (side === 2) { d = 2 * ew + 3 * qa + eh + (h - rr - ly); nx = -1 }
  else if (side === 1) { d = ew + 2 * qa + eh + (w - rr - lx); ny = 1 }
  else { d = lx - rr; ny = -1 }
  const o = (BLOB_BASE + blobOff(d, per, BLOB_AMP, blobT, r[6])) * sc
  ptmp[0] += nx * o; ptmp[1] += ny * o
}

// ---------- a card being worked on: its aura and its arcs ----------
// the point at d along a card's rounded outline and the outward normal there: out = [x, y, nx, ny]
const PP = [0, 0, 0, 0]
function perimPt(x, y, w, h, rr, d, out) {
  rr = Math.min(rr, w / 2, h / 2)
  const ew = w - 2 * rr, eh = h - 2 * rr, qa = Math.PI * rr / 2, per = 2 * (ew + eh) + 4 * qa
  let u = ((d % per) + per) % per, a
  if (u < ew) { out[0] = x + rr + u; out[1] = y; out[2] = 0; out[3] = -1; return per }
  if ((u -= ew) < qa) { a = -Math.PI / 2 + u / rr; out[2] = Math.cos(a); out[3] = Math.sin(a); out[0] = x + w - rr + out[2] * rr; out[1] = y + rr + out[3] * rr; return per }
  if ((u -= qa) < eh) { out[0] = x + w; out[1] = y + rr + u; out[2] = 1; out[3] = 0; return per }
  if ((u -= eh) < qa) { a = u / rr; out[2] = Math.cos(a); out[3] = Math.sin(a); out[0] = x + w - rr + out[2] * rr; out[1] = y + h - rr + out[3] * rr; return per }
  if ((u -= qa) < ew) { out[0] = x + w - rr - u; out[1] = y + h; out[2] = 0; out[3] = 1; return per }
  if ((u -= ew) < qa) { a = Math.PI / 2 + u / rr; out[2] = Math.cos(a); out[3] = Math.sin(a); out[0] = x + rr + out[2] * rr; out[1] = y + h - rr + out[3] * rr; return per }
  if ((u -= qa) < eh) { out[0] = x; out[1] = y + h - rr - u; out[2] = -1; out[3] = 0; return per }
  u -= eh; a = Math.PI + u / rr; out[2] = Math.cos(a); out[3] = Math.sin(a); out[0] = x + rr + out[2] * rr; out[1] = y + rr + out[3] * rr
  return per
}
// The aura: a band of the working agent's tint hugging the card's blobby outline. Its two edges undulate on
// their own slower, larger waves (out of step with the card's wobble and with each other), so the band swells
// and thins as it goes round; a soft glow outside it, and a few wisps licking off. k: how strongly (it breathes).
function cardAura(x, y, w, h, col, k, now, seed, z, q, mo) {
  if (k < 0.03) return
  const t = blobT * 0.55, br = k * (0.82 + 0.18 * Math.sin(now * 0.0042 * mo + seed))
  const c = rgb(col)
  g.save()
  if (q === 2) { g.shadowColor = rgbaArr(c, 0.7 * br); g.shadowBlur = 16 * z }
  // the band: between an outer and an inner outline, filled even-odd
  blobKeep = false; blobRect(x, y, w, h, CARD_RR + 5, 7.5, 3.6, t, seed + 2.1)
  blobKeep = true; blobRect(x, y, w, h, CARD_RR + 3, 4.2, 2.2, t * 1.3 + 900, seed + 4.4); blobKeep = false
  g.fillStyle = rgbaArr(c, 0.5 * br); g.fill('evenodd')
  g.shadowBlur = 0
  if (q >= 1) {
    // the soft outer glow, and the wisps: short curls leaving the outline, drifting slowly round it
    blobRect(x, y, w, h, CARD_RR + 8, 11, 4.5, t * 0.8 + 300, seed + 0.7)
    g.strokeStyle = rgbaArr(c, 0.13 * br); g.lineWidth = 6; g.stroke()
    g.strokeStyle = rgbaArr(c, 0.42 * br); g.lineWidth = Math.max(0.8, 1 / z); g.lineCap = 'round'
    g.beginPath()
    const n = q === 2 ? 6 : 4
    for (let j = 0; j < n; j++) {
      const per = perimPt(x, y, w, h, CARD_RR, 0, PP)
      const d = (nh(seed * 100, j) * per + blobT * 0.012 * (j % 2 ? 1 : -1)) % per
      perimPt(x, y, w, h, CARD_RR, d, PP)
      const len = (7 + 7 * nh(seed * 100, j + 9)) * (0.6 + 0.4 * Math.sin(blobT * 0.0021 + j * 1.9)) * br, sw = Math.sin(blobT * 0.0017 + j * 2.3) * 7
      const px = PP[0] + PP[2] * 7, py = PP[1] + PP[3] * 7
      g.moveTo(px, py); g.quadraticCurveTo(px + PP[2] * len * 0.6 - PP[3] * sw * 0.3, py + PP[3] * len * 0.6 + PP[2] * sw * 0.3, px + PP[2] * len - PP[3] * sw, py + PP[3] * len + PP[2] * sw)
    }
    g.stroke()
  }
  g.restore()
}
// The arcs: jagged, forking discharges that jump along the outline of a card being edited, some leaping to the
// editing tentacle's tip or across a corner of the card, shedding sparks. Each card keeps a small pool of points
// that is regenerated every 60 to 90 ms (never per frame) and drawn twice: a tinted glow, a white-hot core.
// k: strength (1 as an edit lands, about 0.3 for the sparse crackle of the 15 s taint).
const ARC_MAX = 220
function arcGen(V, x, y, w, h, k, tipx, tipy, q) {
  let A = V.arc
  if (!A) A = V.arc = { p: new Float32Array(ARC_MAX * 2), n: 0, at: 0, sp: new Float32Array(16), sn: 0, tick: 0 }
  const tick = ++A.tick, sd = V.seed % 9973, p = A.p
  let n = 0
  const put = (px, py) => { if (n < ARC_MAX) { p[n * 2] = px; p[n * 2 + 1] = py; n++ } }
  const brk = () => put(NaN, NaN)
  const per = perimPt(x, y, w, h, CARD_RR, 0, PP)
  const on = (d, j) => { perimPt(x, y, w, h, CARD_RR, d, PP); const o = BLOB_BASE + blobOff(((d % per) + per) % per, per, BLOB_AMP, blobT, V.bseed || 0) + j; put(PP[0] + PP[2] * o, PP[1] + PP[3] * o) }
  const arcs = k > 0.6 ? (q === 2 ? 6 : 4) : k > 0.34 ? 3 : 1 + (nh(sd, tick) < 0.4 ? 1 : 0)
  A.sn = 0
  for (let a = 0; a < arcs; a++) {
    const d0 = nh(sd + a, tick) * per, len = 26 + nh(sd + a, tick + 11) * 70, steps = 7, amp = (2.5 + 4 * k)
    for (let s = 0; s <= steps; s++) on(d0 + len * s / steps, s === 0 || s === steps ? 0 : (nh(sd + a * 7 + s, tick + 3) - 0.3) * 2 * amp)
    brk()
    // a fork off its middle, out into the air
    if (nh(sd + a, tick + 21) < 0.55) {
      perimPt(x, y, w, h, CARD_RR, d0 + len * 0.5, PP)
      let fx = PP[0] + PP[2] * 4, fy = PP[1] + PP[3] * 4
      const tx = -PP[3], ty = PP[2], nx = PP[2], ny = PP[3]
      put(fx, fy)
      for (let s = 1; s <= 3; s++) { fx += nx * (3 + 4 * k) + tx * (nh(sd + a + s, tick + 31) - 0.5) * 12; fy += ny * (3 + 4 * k) + ty * (nh(sd + a + s, tick + 31) - 0.5) * 12; put(fx, fy) }
      brk()
      if (A.sn < 8) { A.sp[A.sn * 2] = fx; A.sp[A.sn * 2 + 1] = fy; A.sn++ }
    }
    // a leap across a corner of the card
    if (k > 0.5 && nh(sd + a, tick + 41) < 0.3) {
      perimPt(x, y, w, h, CARD_RR, d0, PP); const ax = PP[0], ay = PP[1]
      perimPt(x, y, w, h, CARD_RR, d0 + per * (0.18 + 0.1 * nh(sd + a, tick + 43)), PP); const bx = PP[0], by = PP[1]
      for (let s = 0; s <= 5; s++) { const u = s / 5, j = s === 0 || s === 5 ? 0 : 7; put(ax + (bx - ax) * u + (nh(sd + s, tick + 47) - 0.5) * j, ay + (by - ay) * u + (nh(sd + s, tick + 49) - 0.5) * j) }
      brk()
    }
    if (A.sn < 8) { perimPt(x, y, w, h, CARD_RR, d0 + len, PP); A.sp[A.sn * 2] = PP[0] + PP[2] * (4 + 10 * nh(sd + a, tick + 51)); A.sp[A.sn * 2 + 1] = PP[1] + PP[3] * (4 + 10 * nh(sd + a, tick + 51)); A.sn++ }
  }
  // now and then one leaps from the frame to the tentacle that is editing
  if (k > 0.5 && isFinite(tipx) && nh(sd, tick + 61) < 0.45) {
    // from the outline point nearest the tip
    let best = 0, bd = 1e18
    for (let s = 0; s < 16; s++) { perimPt(x, y, w, h, CARD_RR, per * s / 16, PP); const dd = (PP[0] - tipx) * (PP[0] - tipx) + (PP[1] - tipy) * (PP[1] - tipy); if (dd < bd) { bd = dd; best = per * s / 16 } }
    if (bd < 160 * 160 && bd > 36) {
      perimPt(x, y, w, h, CARD_RR, best, PP); const ax = PP[0] + PP[2] * 3, ay = PP[1] + PP[3] * 3
      for (let s = 0; s <= 5; s++) { const u = s / 5, j = s === 0 || s === 5 ? 0 : 9; put(ax + (tipx - ax) * u + (nh(sd + s, tick + 67) - 0.5) * j, ay + (tipy - ay) * u + (nh(sd + s, tick + 69) - 0.5) * j) }
      brk()
    }
  }
  A.n = n
}
function cardArcs(V, x, y, w, h, now, col, k, z, q, tipx, tipy) {
  if (k < 0.03) return
  const A0 = V.arc
  if (!A0 || now - A0.at > 60 + 30 * nh(V.seed % 9973, A0.tick)) { arcGen(V, x, y, w, h, k, tipx, tipy, q); V.arc.at = now }
  const A = V.arc, p = A.p
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round'
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) { g.strokeStyle = rgba(col, 0.75 * k); g.lineWidth = Math.max(1.8, 2.4 / z); if (q === 2) { g.shadowColor = rgba(col, 0.9 * k); g.shadowBlur = 10 * z } }
    else { g.shadowBlur = 0; g.strokeStyle = 'rgba(250,247,236,' + (0.9 * k).toFixed(3) + ')'; g.lineWidth = Math.max(0.7, 0.9 / z) }
    g.beginPath()
    let pen = false
    for (let i = 0; i < A.n; i++) { const px = p[i * 2]; if (px !== px) { pen = false; continue } if (pen) g.lineTo(px, p[i * 2 + 1]); else { g.moveTo(px, p[i * 2 + 1]); pen = true } }
    g.stroke()
  }
  // the sparks shed where arcs end
  g.fillStyle = rgba(col, 0.85 * k)
  g.beginPath()
  for (let i = 0; i < A.sn; i++) { const r = 0.8 + 1.4 * nh(i, A.tick); g.moveTo(A.sp[i * 2] + r, A.sp[i * 2 + 1]); g.arc(A.sp[i * 2], A.sp[i * 2 + 1], r, 0, Math.PI * 2) }
  g.fill()
  g.restore()
}

// ---------- the tether: a soft tube from a parent to its subagent, data passing through it as boluses ----------
// One polygon per tube, sampled along a sagging, slowly undulating curve that ends on both bodies' outlines; a
// darker core; a handful of glowing spheres that push the wall out as they pass (orders outbound in the session's
// hue, reports inbound in violet), more of them the more the two exchange.
const TUBE_N = 18
const TBX = new Float32Array(TUBE_N + 1), TBY = new Float32Array(TUBE_N + 1), TNX = new Float32Array(TUBE_N + 1), TNY = new Float32Array(TUBE_N + 1), TBW = new Float32Array(TUBE_N + 1)
// where a ray from a creature's centre leaves its outline
function outlinePt(A, ux, uy, out) {
  const R = A.r * (A.bodyK || 1)
  if (A.role === 'inspector') { out[0] = A.x + ux * R * 1.05; out[1] = A.y + uy * R * 1.05; return }
  const ta = A.tiltA || 0, c = Math.cos(-ta), s = Math.sin(-ta), dx = ux * c - uy * s, dy = ux * s + uy * c
  let best = R
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, px = PVX[i] * R, py = PVY[i] * R, ex = PVX[j] * R - px, ey = PVY[j] * R - py
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-6) continue
    const t = (px * ey - py * ex) / den, u = (px * dy - py * dx) / den
    if (t > 0 && u >= 0 && u <= 1) best = t
  }
  out[0] = A.x + ux * best; out[1] = A.y + uy * best
}
function tetherFeed(A, n, dir) {
  if (!A.bol) A.bol = []
  for (let k = 0; k < n && A.bol.length < 7; k++) A.bol.push({ u: dir > 0 ? -0.1 * k : 1 + 0.1 * k, dir })
}
// what passed between the two since the last frame: the summoning and a word from the parent go out; the
// subagent's requests, its word back and its end come in
function tetherSync(A, a, T) {
  const last = A.bolT
  A.bolT = T
  if (last === undefined || T < last || T - last > 4000) { if (a.bornT <= T && T - a.bornT < 2500) tetherFeed(A, 3, 1); return }
  const hit = t => t > last && t <= T
  if (hit(a.bornT)) tetherFeed(A, 3, 1)
  if (hit(a.toldT)) tetherFeed(A, 3, 1)
  if (hit(a.saidT)) tetherFeed(A, 2, -1)
  if (hit(a.doneT) || hit(a.idleT)) tetherFeed(A, 4, -1)
  // every call the subagent starts draws on its orders; whatever else it does sends word back
  if (hit(a.lastActT)) tetherFeed(A, 1, 1); else if (hit(a.lastT)) tetherFeed(A, 1, -1)
  if (a.tx) for (let i = a.tx.length - 1; i >= 0 && a.tx[i].t > last; i--) if (a.tx[i].t <= T) tetherFeed(A, 1, i % 2 ? 1 : -1)
}
function drawBranch(A, P, now) {
  const dx = A.x - P.x, dy = A.y - P.y, L0 = Math.hypot(dx, dy)
  if (L0 < 2) return
  const z = view.cam.z, mo = motion(), q = Q()
  outlinePt(P, dx / L0, dy / L0, prj2); const sx = prj2[0], sy = prj2[1]
  outlinePt(A, -dx / L0, -dy / L0, prj2); const ex = prj2[0], ey = prj2[1]
  const L = Math.hypot(ex - sx, ey - sy)
  if (L < 4 || (ex - sx) * dx + (ey - sy) * dy <= 0) return
  const a = A.alpha * (0.4 + 0.6 * topAlpha(A)) * clamp(z / 0.4, 0.4, 1)
  if (a < 0.02) return
  // the curve: sagging a little under its own weight, a slow sine travelling along it
  const sag = Math.min(40, L * 0.12), lane = ((A.lane || 0) - ((A.vein ? A.vein.lanes : 1) - 1) / 2) * 5
  const ux = (ex - sx) / L, uy = (ey - sy) / L
  const c1x = sx + ux * L * 0.33 - uy * lane, c1y = sy + uy * L * 0.33 + ux * lane + sag
  const c2x = sx + ux * L * 0.67 - uy * lane, c2y = sy + uy * L * 0.67 + ux * lane + sag
  // data on the move
  const a0 = H.state.actors.get(A.id)
  if (a0 && mo > 0.02 && q >= 1) tetherSync(A, a0, frameT)
  const bol = A.bol
  if (bol) for (let i = bol.length - 1; i >= 0; i--) { const B = bol[i]; B.u += frameDt * 0.5 * Math.max(mo, 0.3) * B.dir; if (B.u > 1.02 || B.u < -0.9 || (B.dir < 0 && B.u < -0.02) || mo <= 0.02 || q === 0) bol.splice(i, 1) }
  const w0 = Math.max(2.4, 1.5 / z), amp = Math.min(3, L * 0.02) * mo
  for (let i = 0; i <= TUBE_N; i++) {
    const t = i / TUBE_N, v = 1 - t
    let x = v * v * v * sx + 3 * v * v * t * c1x + 3 * v * t * t * c2x + t * t * t * ex
    let y = v * v * v * sy + 3 * v * v * t * c1y + 3 * v * t * t * c2y + t * t * t * ey
    let tx = 3 * v * v * (c1x - sx) + 6 * v * t * (c2x - c1x) + 3 * t * t * (ex - c2x), ty = 3 * v * v * (c1y - sy) + 6 * v * t * (c2y - c1y) + 3 * t * t * (ey - c2y)
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
    const o = amp * Math.sin(t * 9 - now * 0.0016 + (A.seed % 11)) * Math.sin(Math.PI * t)
    x += -ty * o; y += tx * o
    let w = w0 * (1.15 - 0.4 * t)
    if (bol) for (let b = 0; b < bol.length; b++) { const dd = (t - bol[b].u) / 0.06; if (dd > -3 && dd < 3) w += Math.max(w0 * 1.4, 3 / z) * Math.exp(-dd * dd) }
    TBX[i] = x; TBY[i] = y; TNX[i] = -ty; TNY[i] = tx; TBW[i] = w
  }
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round'
  const hue = rgb(A.tone || THRALL)
  // the wall: translucent, with a soft edge
  g.beginPath(); g.moveTo(TBX[0] + TNX[0] * TBW[0], TBY[0] + TNY[0] * TBW[0])
  for (let i = 1; i <= TUBE_N; i++) g.lineTo(TBX[i] + TNX[i] * TBW[i], TBY[i] + TNY[i] * TBW[i])
  for (let i = TUBE_N; i >= 0; i--) g.lineTo(TBX[i] - TNX[i] * TBW[i], TBY[i] - TNY[i] * TBW[i])
  g.closePath()
  g.fillStyle = rgbaArr(hue, 0.28 * a); g.fill()
  g.strokeStyle = rgbaArr(hue, 0.58 * a); g.lineWidth = Math.max(0.7, 0.7 / z); g.stroke()
  // the darker core
  g.strokeStyle = 'rgba(18,12,26,' + (0.55 * a).toFixed(3) + ')'; g.lineWidth = w0 * 0.9
  g.beginPath(); g.moveTo(TBX[0], TBY[0]); for (let i = 1; i <= TUBE_N; i++) g.lineTo(TBX[i], TBY[i]); g.stroke()
  // the boluses
  if (bol && bol.length) {
    const Top = vis.actors.get(topOf(H.state, A.id)), outC = rgb(Top && Top.hue ? Top.hue : FLESHLINE), inC = rgb(VIOLET)
    for (let b = 0; b < bol.length; b++) {
      const B = bol[b]
      if (B.u < 0 || B.u > 1) continue
      const f = B.u * TUBE_N, i = Math.min(TUBE_N - 1, Math.floor(f)), k = f - i
      const x = TBX[i] + (TBX[i + 1] - TBX[i]) * k, y = TBY[i] + (TBY[i + 1] - TBY[i]) * k, c = B.dir > 0 ? outC : inC
      const fade = Math.min(1, B.u * 8, (1 - B.u) * 8)
      // (never smaller than a few pixels on the screen, so they show on a zoomed-out map too)
      const br = Math.max(w0 * 1.5, 3.2 / z), fa = Math.min(1, fade * (0.5 + 0.5 * a) * 1.2)
      g.fillStyle = rgbaArr(c, 0.3 * fa); g.beginPath(); g.arc(x, y, br * 2.2, 0, Math.PI * 2); g.fill()
      g.fillStyle = rgbaArr(c, 0.97 * fa); g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill()
      g.fillStyle = 'rgba(255,255,255,' + (0.65 * fa).toFixed(3) + ')'; g.beginPath(); g.arc(x - br * 0.32, y - br * 0.32, br * 0.3, 0, Math.PI * 2); g.fill()
    }
  }
  g.restore()
}

// ---------- the thin tendrils under a creature ----------
// Each tendril is a smooth curve through a few control points. Every control point is a damped spring (stepped
// in fixed 1/120 s substeps, whatever the frame time) toward its place in a target pose, and the pose is the sum
// of three things: the rest shape hanging from the body (the springs make it lag and swing behind a move), the
// tendril's own undulation, and the sleep dance or the reach for the pointer, blended in by eased weights. Every
// wave runs on a phase the tendril accumulates itself (phase += dt * frequency), so a change of pace bends the
// rhythm and never jumps it, however long the page has been open; the body's speed is low-passed before it feeds
// any amplitude or frequency. Asleep, the tendrils grow (to about 2.5 times) and curl up and round in slow
// mirrored waves; when the pointer has hovered near they lean to it and coil just short of it. Drawn from the
// curve only. Motion off: they hang still.
const TEND_M = 6, TEND_H = 1 / 120
function tendrilStep(A, dt, now) {
  const q = Q(), mo = motion()
  const count = q === 0 ? 0 : q === 1 ? 4 : 6
  if (!count || A.alpha < 0.05) { A.tend = null; return }
  const R = A.r * (A.bodyK || 1)
  if (!A.tend || A.tend.length !== count) {
    A.tend = []
    for (let k = 0; k < count; k++) {
      const u = nh(A.seed, k + 70), v = nh(A.seed, k + 90)
      A.tend.push({ p: new Float64Array(TEND_M * 2), v: new Float64Array(TEND_M * 2), t: new Float64Array(TEND_M * 2), d: new Float64Array(TEND_M * 2), init: false, ph: u * 6.283, ph2: v * 6.283, fr: 1.5 + 0.9 * u, am: 0.75 + 0.5 * v })
    }
    A.tendAcc = 0; A.spdLP = 0
  }
  const spd = Math.hypot(A.vx || 0, A.vy || 0)
  if (spd > 15) A.movedT = now
  A.spdLP = ease(A.spdLP || 0, spd, 2.5, dt)
  const sk = Math.min(1, A.spdLP / 160) // how much it is on the move, smoothed
  const idle = now - (A.movedT || 0)
  const rk = smooth(A.reach || 0), ds = smooth(A.dance || 0), D = Math.max(ds, rk)
  // the reach: full while moving, a stub after a while at rest; long again in the dance
  const want = Math.max(idle < 4000 ? 1 : idle < 12000 ? 1 - 0.7 * (idle - 4000) / 8000 : 0.3, D)
  A.tendWant = want
  A.tendK = ease(A.tendK === undefined ? want : A.tendK, want, 1.2, dt)
  const len = R * 1.7 * A.tendK * (1 + 1.5 * D), seg0 = len / (TEND_M - 1)
  const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
  const half = R * 1.1, base = R * 0.8, down = Math.atan2(ca, -sa)
  // how many fixed substeps this frame carries (a long frame is capped, never integrated in one leap)
  let steps = 0
  if (mo > 0.02) { A.tendAcc = Math.min((A.tendAcc || 0) + dt, 0.1); while (A.tendAcc >= TEND_H && steps < 12) { A.tendAcc -= TEND_H; steps++ } }
  for (let k = 0; k < count; k++) {
    const T = A.tend[k], p = T.p, v = T.v, t = T.t, d = T.d
    const lx = -half * 0.8 + (k + 0.5) / count * half * 1.6
    const rx = A.x + lx * ca - base * sa, ry = A.y + lx * sa + base * ca
    const c = (k + 0.5) / count * 2 - 1, side = c >= 0 ? 1 : -1
    // its own clocks: the undulation (quicker on the move and while it reaches), and a slow swell of its amplitude
    T.ph += dt * mo * T.fr * (1 + 1.6 * sk + 1.2 * rk - 0.45 * ds)
    T.ph2 += dt * mo * 0.23
    const amp = (0.1 + 0.2 * sk + 0.1 * rk + 0.26 * ds) * T.am * (0.8 + 0.2 * Math.sin(T.ph2))
    // toward the pointer: lean to it, and no longer than just short of it
    let lean = Math.atan2(cur.y - ry, cur.x - rx) - down
    lean -= Math.round(lean / (Math.PI * 2)) * Math.PI * 2
    const a0 = down + lean * rk * 0.85
    const seg = rk > 0.01 ? lerp(seg0, Math.min(seg0, Math.max(R * 0.25, Math.hypot(cur.x - rx, cur.y - ry) - 8) * 1.2 / (TEND_M - 1)), rk) : seg0
    // the target pose: one joint after another from the root
    let x = rx, y = ry
    t[0] = rx; t[1] = ry
    for (let i = 1; i < TEND_M; i++) {
      const s = i / (TEND_M - 1)
      const ang = a0 - side * 2.9 * s * s * ds * (1 - rk) + side * 2.4 * Math.pow(Math.max(0, (s - 0.6) / 0.4), 2) * rk + side * Math.sin(T.ph - s * 2.6) * amp * s
      x += Math.cos(ang) * seg; y += Math.sin(ang) * seg
      t[i * 2] = x; t[i * 2 + 1] = y
    }
    if (!T.init || mo <= 0.02 || !isFinite(p[2]) || !isFinite(p[TEND_M * 2 - 1])) {
      for (let i = 0; i < TEND_M * 2; i++) { p[i] = t[i]; v[i] = 0; d[i] = t[i] }
      T.init = true
      continue
    }
    // the springs: firm near the root, loose at the tip, a little under critical so a turn swings through once
    p[0] = rx; p[1] = ry
    for (let st = 0; st < steps; st++) for (let i = 1; i < TEND_M; i++) {
      const s = i / (TEND_M - 1), om = 15 - 9 * s, j = i * 2
      v[j] += ((t[j] - p[j]) * om * om - 1.7 * om * v[j]) * TEND_H; v[j + 1] += ((t[j + 1] - p[j + 1]) * om * om - 1.7 * om * v[j + 1]) * TEND_H
      p[j] += v[j] * TEND_H; p[j + 1] += v[j + 1] * TEND_H
    }
    // what is drawn: the state carried on by the part of a substep this frame left over, so the curve moves evenly
    // however the frame times fall across the fixed steps
    d[0] = rx; d[1] = ry
    for (let i = 2; i < TEND_M * 2; i++) d[i] = p[i] + v[i] * A.tendAcc
  }
}
function drawTendrils(A, now) {
  if (!A.tend) return
  const z = view.cam.z
  if (A.r * z < 2.5) return // too small on the screen to show
  const grow = clamp(((A.tendWant || 0) - (A.tendK || 0)) * 3, 0, 1)
  g.save()
  g.strokeStyle = rgbaArr(rgb(A.tone), (0.3 + 0.12 * Math.max(A.dance || 0, A.reach || 0)) * A.alpha); g.lineCap = 'round'; g.lineJoin = 'round'
  g.lineWidth = Math.max(0.6, 1.3 / Math.max(0.5, z))
  g.beginPath()
  for (const T of A.tend) {
    const p = T.d
    if (!T.init || !isFinite(p[0])) continue
    // a Catmull-Rom curve through the control points, as cubic segments
    g.moveTo(p[0], p[1])
    for (let i = 0; i < TEND_M - 1; i++) {
      const a = Math.max(0, i - 1) * 2, b = i * 2, c = (i + 1) * 2, d = Math.min(TEND_M - 1, i + 2) * 2
      g.bezierCurveTo(p[b] + (p[c] - p[a]) / 6, p[b + 1] + (p[c + 1] - p[a + 1]) / 6, p[c] - (p[d] - p[b]) / 6, p[c + 1] - (p[d + 1] - p[b + 1]) / 6, p[c], p[c + 1])
    }
  }
  g.stroke()
  // the roots swell while the threads grow out
  if (grow > 0.05) {
    g.fillStyle = rgbaArr(rgb(A.tone), 0.45 * grow * A.alpha); g.beginPath()
    for (const T of A.tend) if (T.init) { g.moveTo(T.d[0] + 3, T.d[1]); g.arc(T.d[0], T.d[1], (0.8 + 2 * grow) / Math.max(0.5, z), 0, Math.PI * 2) }
    g.fill()
  }
  g.restore()
}

// ---------- souls flee the pointer ----------
// A soul within about 90 px of the pointer is pushed away (an offset from its path on a spring, so it drifts back
// when the pointer has gone); its fear drives the frantic flapping, the shiver and the wobbling halo in drawSouls.
function soulFlee(s, dt, mo, near) {
  let ox = s.ox || 0, oy = s.oy || 0, vx = s.ovx || 0, vy = s.ovy || 0, fear = 0
  if (near && mo > 0.02) {
    const dx = s.x + ox - cur.x, dy = s.y + oy - cur.y, d = Math.hypot(dx, dy)
    if (d < 90) { fear = 1; const k = 2600 * (1 - d / 90) / (d || 1); vx += dx * k * dt; vy += dy * k * dt }
  }
  if (fear || ox || oy || vx || vy) {
    vx += (-ox * 9 - vx * 4.5) * dt; vy += (-oy * 9 - vy * 4.5) * dt
    ox += vx * dt; oy += vy * dt
    if (!fear && Math.abs(ox) + Math.abs(oy) < 0.05 && Math.abs(vx) + Math.abs(vy) < 0.5) { ox = 0; oy = 0; vx = 0; vy = 0 }
    s.ox = ox; s.oy = oy; s.ovx = vx; s.ovy = vy
  }
  s.fear = ease(s.fear || 0, fear, fear ? 14 : 2.5, dt)
  s.x += ox; s.y += oy
}

// ---------- an opened pile ----------
// A click on a pile fans out its first layer round the stack: folded cards (title only), and, when the pile holds
// tomes of several folders, each folder with two or more as a mini pile of its own (a click on one opens that
// layer in its place). A click on a fanned card opens it fully; a click on the stack or on empty space, or Escape,
// folds everything back. The tomes stay members of the pile throughout, so the rest of the layout is untouched.
// The fan is one layer of its own, drawn above every tome, pile, label, creature and caption, on a near-opaque
// backdrop, with the rest of the map dimmed a little. Its cards are folded to their title, laid in a tidy grid
// by their real sizes (alphabetical, no overlap), kept inside the view. A click on one of them opens it on the
// map (pinned where it was) and folds the fan back.
const FAN_MAX = 24, FAN_ROWS = 8, FAN_PITCH = HEAD_H + 16, FAN_GAP = 18
const fan = { key: '', path: '', at: 0, sig: '', slots: new Map(), minis: [], kept: new Set(), total: 0, box: [0, 0, 0, 0] }
function fanClose() { fan.key = ''; fan.path = ''; fan.slots.clear(); fan.minis.length = 0; fan.sig = ''; layout.awake = Math.max(layout.awake, 30) }
function fanOpen(key, path) { fan.key = key; fan.path = path || ''; fan.at = performance.now(); fan.sig = ''; fan.slots.clear(); fan.minis.length = 0; layout.awake = Math.max(layout.awake, 30) }
function fanSync(now) {
  if (!fan.key) return
  const P = vis.piles.get(fan.key)
  // gone, or left alone for five minutes: it folds back
  if (!P || P.n < 2 || now - Math.max(view.lastInput || 0, fan.at) > 300000) { fanClose(); return }
  const members = []
  for (const V of vis.nodes.values()) if (V.pileOf === fan.key && V.present) members.push(V)
  members.sort((a, b) => { const p = (a.short || a.name || '').toLowerCase(), q = (b.short || b.name || '').toLowerCase(); return p < q ? -1 : p > q ? 1 : a.id < b.id ? -1 : 1 })
  let sig = fan.path + '|'
  for (const V of members) sig += V.id + ':' + Math.round(V.tw) + ','
  if (sig !== fan.sig) {
    fan.sig = sig; fan.slots.clear(); fan.minis.length = 0
    const items = []
    if (!fan.path) {
      const by = new Map()
      for (const V of members) { let l = by.get(V.folder); if (!l) { l = []; by.set(V.folder, l) }; l.push(V) }
      if (by.size > 1) for (const [folder, l] of by) { if (l.length >= 2) items.push({ mini: folder, n: l.length, w: 150 }); else items.push({ V: l[0], w: l[0].tw }) }
      else for (const V of members) items.push({ V, w: V.tw })
    } else for (const V of members) if (V.folder === fan.path) items.push({ V, w: V.tw })
    fan.total = items.length
    // the grid: columns of FAN_ROWS, each as wide as its widest card
    const shown = Math.min(items.length, FAN_MAX), cols = Math.ceil(shown / FAN_ROWS), rows = Math.min(shown, FAN_ROWS)
    let x = 0
    for (let c = 0; c < cols; c++) {
      let cw = 0
      for (let r = 0; r < FAN_ROWS && c * FAN_ROWS + r < shown; r++) cw = Math.max(cw, items[c * FAN_ROWS + r].w)
      for (let r = 0; r < FAN_ROWS && c * FAN_ROWS + r < shown; r++) {
        const i = c * FAN_ROWS + r, it = items[i]
        if (it.mini) fan.minis.push({ folder: it.mini, n: it.n, i, dx: x, dy: r * FAN_PITCH, x: 0, y: 0, u: 0 })
        else fan.slots.set(it.V.id, { i, dx: x, dy: r * FAN_PITCH })
      }
      x += cw + FAN_GAP
    }
    const bw = x - FAN_GAP, bh = rows * FAN_PITCH - 16 + (fan.total > shown ? 22 : 0)
    // beside the pile, on the side where it fits the view; never off the top or the bottom
    const cam = view.cam, vx0 = cam.x - view.w / 2 / cam.z, vx1 = cam.x + view.w / 2 / cam.z, vy0 = cam.y - view.h / 2 / cam.z, vy1 = cam.y + view.h / 2 / cam.z
    let ox = P.x + 96
    if (ox + bw > vx1 - 24 && P.x - 30 - bw > vx0 + 24) ox = P.x - 30 - bw
    let oy = P.y + 12 - bh / 2
    if (bh < vy1 - vy0 - 100) oy = clamp(oy, vy0 + 70, vy1 - 30 - bh)
    fan.box[0] = ox; fan.box[1] = oy; fan.box[2] = bw; fan.box[3] = bh
  }
  for (const M of fan.minis) { const e = backOut((now - fan.at - M.i * 40) / 380); M.u = e; M.x = P.x + (fan.box[0] + M.dx - P.x) * e; M.y = P.y + (fan.box[1] + M.dy - P.y) * e }
}
// a pile member's place in the open fan, or null: its stagger, and where it is right now
const fanP = { x: 0, y: 0, u: 0 }
function fanSlot(V, now) {
  if (!fan.key || V.pileOf !== fan.key) return null
  const s = fan.slots.get(V.id), P = vis.piles.get(fan.key)
  if (!s || !P) return null
  const u = (now - fan.at - s.i * 40) / 380, e = backOut(u)
  fanP.u = u; fanP.x = P.x + (fan.box[0] + s.dx - P.x) * e; fanP.y = P.y + (fan.box[1] + s.dy - P.y) * e
  return fanP
}
function fanMiniAt(px, py) { for (const M of fan.minis) if (M.u > 0.5 && px >= M.x && px <= M.x + 150 && py >= M.y - 2 && py <= M.y + 26) return M; return null }
function pileAt(px, py) {
  for (const P of vis.piles.values()) if (P.n >= 2 && P.alpha >= 0.3 && px >= P.x && px <= P.x + 70 && py >= P.y - 6 && py <= P.y + 46) return P
  return null
}
function fanHas(V) { return !!fan.key && V.pileOf === fan.key && fan.slots.has(V.id) }
// a click (a press and release without a drag) at a world point, on a node or not: true when the fan took it
function fanClick(px, py, N) {
  if (N) {
    if (!fanHas(N)) { if (fan.key) { fanClose(); return true } return false }
    // a card of the fan: it opens on the map, pinned where it was, and the fan folds back
    fan.kept.add(N.id); if (fan.kept.size > 200) fan.kept.clear()
    pinSet(N, N.x, N.y); pack.sig = ''
    fanClose()
    return true
  }
  const M = fan.key ? fanMiniAt(px, py) : null
  if (M) { fanOpen(fan.key, M.folder); return true }
  const P = pileAt(px, py)
  // (a pile under the open fan's backdrop is hidden, so it cannot be clicked through it)
  const inBox = fan.key && px >= fan.box[0] - 16 && px <= fan.box[0] + fan.box[2] + 16 && py >= fan.box[1] - 16 && py <= fan.box[1] + fan.box[3] + 16
  if (P && !(inBox && P.key !== fan.key)) { if (fan.key === P.key && !fan.path) fanClose(); else fanOpen(P.key, ''); return true }
  if (fan.key && !inBox) { fanClose(); return true }
  return !!inBox
}
// the layer's ground: the map dimmed, the backdrop, the mini piles (the cards follow from drawTomes' fan pass)
function drawFan(now) {
  const P = vis.piles.get(fan.key)
  if (!P || !(fan.slots.size + fan.minis.length)) return
  const z = view.cam.z, k = c01((now - fan.at) / 260)
  g.save()
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  g.fillStyle = 'rgba(8,12,11,' + (0.4 * k).toFixed(3) + ')'; g.fillRect(0, 0, view.w, view.h)
  worldTransform()
  blobRect(fan.box[0] - 18, fan.box[1] - 18, fan.box[2] + 36, fan.box[3] + 36, 24, 0, 2.5, blobT, 1.3)
  g.fillStyle = 'rgba(13,18,17,' + (0.96 * k).toFixed(3) + ')'; g.fill()
  g.strokeStyle = rgba(BRASS, 0.45 * k); g.lineWidth = Math.max(1, 1 / z); g.stroke()
  // a thread from the pile to its fan
  g.strokeStyle = rgba(BRASS, 0.3 * k); g.beginPath(); g.moveTo(P.x + 35, P.y + 12); g.lineTo(fan.box[0] + (fan.box[0] > P.x ? -18 : fan.box[2] + 18), clamp(P.y + 12, fan.box[1], fan.box[1] + fan.box[3])); g.stroke()
  for (const M of fan.minis) {
    if (M.u <= 0) continue
    g.globalAlpha = Math.min(1, M.u * 2)
    for (let s = 1; s >= 0; s--) { g.fillStyle = s ? '#20262A' : '#262622'; g.strokeStyle = rgba(BRASS, 0.55); g.lineWidth = Math.max(1, 1 / z); g.beginPath(); roundRect(M.x + s * 3, M.y - s * 3 + 4, 150, 22, 4); g.fill(); g.stroke() }
    g.fillStyle = BLOOD; g.beginPath(); g.arc(M.x + 136, M.y + 15, 8, 0, Math.PI * 2); g.fill()
    g.fillStyle = BONE; g.font = '600 9px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(M.n), M.x + 136, M.y + 15.5)
    g.textAlign = 'left'; g.font = '600 10.5px ' + FONT; g.fillStyle = rgba(BONE, 0.92); g.fillText(clipMid(M.folder.split('/').pop() || M.folder, 18), M.x + 8, M.y + 15.5)
  }
  const more = fan.total - (fan.slots.size + fan.minis.length)
  if (more > 0) { g.globalAlpha = k; g.fillStyle = rgba(ASH, 0.9); g.font = '10.5px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('+' + more + ' more in the stack', fan.box[0] + 2, fan.box[1] + fan.box[3] - 6) }
  g.restore()
}

// ---------- a correction: the parent skewers the subagent it has to correct ----------
// The evidence is found in the event fold (see correctCheck): a follow-up message to a subagent that had already
// reported, or the parent editing a file that subagent had just edited (or failed on) right after its report; at
// most once a minute per subagent. It may arrive after the subagent is gone: the body is brought back for it.
// About 1.6 s from the moment the evidence arrives: a thick barbed tentacle shoots from the parent, strikes
// the subagent's side and bursts out of the far side (the shaft over the entry, the point under the exit), the
// body recoils and squashes, the eye goes wide then squeezes shut, droplets of the creature's own ichor spray out
// with gravity; the tentacle twists once and withdraws, the wound closes over a second, a shiver, and on it goes.
const CORR_MS = 1600, CORR_HEAL = 1000
// called from the fold when an actor with subagents starts an act; conservative on purpose
function correctCheck(s, a, act, t) {
  const hit = sub => { if (!(t - (sub.corrT || -1e12) < 60000)) { sub.corrT = t; sub.corrBy = a.id } }
  const reported = sub => Math.max(sub.doneT || 0, sub.idleT || 0)
  if (act.tool === 'SendMessage') {
    // a word to a subagent that had already reported: new instructions after the fact
    let to = null
    for (const sub of s.actors.values()) {
      if (sub.parent !== a.id) continue
      const named = act.detail && (sub.label === act.detail || String(sub.id).endsWith(':' + act.detail))
      if (named) { to = sub; break }
      if (!act.detail && (!to || sub.bornT > to.bornT)) to = sub
    }
    if (!to) return
    const rep = reported(to)
    if (rep > 0 && rep <= t && t - rep < 300000) hit(to); else if (!to.doneT) to.toldT = t
    return
  }
  if ((act.kind !== 'edit' && act.kind !== 'write') || !act.node) return
  // the parent takes up a file its subagent edited (or failed on) in the last three minutes, soon after the report
  for (const sub of s.actors.values()) {
    if (sub.parent !== a.id || !sub.work) continue
    const rep = reported(sub)
    if (!(rep > 0 && rep <= t && t - rep < 120000)) continue
    for (const w of sub.work) if (w.node === act.node && t - w.t < 180000 && w.t <= rep + 1000) { hit(sub); break }
  }
}
// the fold keeps what each subagent edited, and where its calls failed (a short list)
function correctNote(a, act, t) {
  if (!a.parent || !act.node || !(act.kind === 'edit' || act.kind === 'write' || act.failed)) return
  if (!a.work) a.work = []
  a.work.push({ node: act.node, t, failed: !!act.failed }); if (a.work.length > 12) a.work.shift()
}
const gore = [] // the droplets: { x, y, vx, vy, r, t, life, c }
const ichC = [0, 0, 0]
// a creature's own ichor: its hue, a little darker and more saturated
function ichorOf(A, out) {
  const c = rgb(A.parent ? VIOLET : (A.hue || FLESHLINE)), m = (c[0] + c[1] + c[2]) / 3
  for (let i = 0; i < 3; i++) out[i] = clamp((m + (c[i] - m) * 1.5) * 0.74, 0, 255)
  return out
}
// per frame, from lifeSync: where each correction stands, and what the struck body does about it
function corrSync(S, T, now, dt) {
  const mo = motion(), q = Q()
  for (const V of vis.actors.values()) {
    const a = S.actors.get(V.id)
    const el = a && a.corrT > 0 ? T - a.corrT : -1
    V.corrU = -1; V.hx = 0; V.hy = 0; V.corrSq = 0; V.eyeWide = 0; V.eyeShut = 0; V.wound = 0
    if (!(el >= 0 && el < CORR_MS + CORR_HEAL)) { if (el < 0) V.corrDone = 0; continue }
    const P = vis.actors.get(a.corrBy)
    if (!P) continue
    if (V.born > 0.3 && T - a.bornT > 5000) V.born = 0 // brought back for this: no summoning circle
    const u = el / CORR_MS
    let dx = V.x - P.x, dy = V.y - P.y
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d
    V.corrDx = dx; V.corrDy = dy; V.corrU = u
    V.wound = u < 0.22 ? 0 : u < 0.9 ? 1 : c01(1 - (el - CORR_MS * 0.9) / CORR_HEAL)
    if (mo <= 0.02) continue
    // the blow: a recoil along the strike that springs back, a squash, a shiver once the barb is out
    const imp = u >= 0.22 ? Math.exp(-(u - 0.22) * 9) : 0
    const shiver = u > 0.9 && u < 1.35 ? Math.sin((u - 0.9) / 0.45 * Math.PI) : 0
    V.hx = dx * V.r * 0.55 * imp + Math.sin(now * 0.09) * 1.3 * shiver * mo; V.hy = dy * V.r * 0.55 * imp
    V.corrSq = 0.2 * imp
    V.eyeWide = u >= 0.2 && u < 0.42 ? smooth(c01((u - 0.2) / 0.05)) * (1 - smooth(c01((u - 0.36) / 0.06))) : 0
    V.eyeShut = u >= 0.38 ? smooth(c01((u - 0.38) / 0.08)) * (1 - smooth(c01((u - 0.95) / 0.3))) : 0
    // the spray, once, as the point bursts out of the far side
    if (u >= 0.27 && u < 0.6 && V.corrDone !== a.corrT && q >= 0) {
      V.corrDone = a.corrT
      const n = q === 2 ? 22 : q === 1 ? 12 : 6, c = ichorOf(V, [0, 0, 0])
      const ex = V.x + dx * V.r * 1.1, ey = V.y + dy * V.r * 1.1
      for (let k = 0; k < n && gore.length < 60; k++) {
        const an = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.3, sp = 110 + Math.random() * 240
        gore.push({ x: ex, y: ey, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 70, r: 1.3 + Math.random() * 2.2, t: 0, life: 0.55 + Math.random() * 0.5, c })
      }
    }
  }
  for (let i = gore.length - 1; i >= 0; i--) {
    const G = gore[i]
    G.t += dt
    if (G.t < G.life) { G.vy += 520 * dt; G.x += G.vx * dt; G.y += G.vy * dt }
    else if (G.t > G.life + 0.6) gore.splice(i, 1)
  }
}
function drawGore() {
  if (!gore.length) return
  g.save()
  for (const G of gore) {
    if (!inView(G.x - 12, G.y - 12, 24, 24)) continue
    if (G.t < G.life) {
      g.fillStyle = rgbaArr(G.c, 0.9); g.beginPath(); g.arc(G.x, G.y, G.r, 0, Math.PI * 2); g.fill()
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(G.x - G.r * 0.3, G.y - G.r * 0.35, Math.max(0.4, G.r * 0.28), 0, Math.PI * 2); g.fill()
    } else {
      // a faint splat where it lands, fading
      const s = smooth((G.t - G.life) / 0.6)
      g.fillStyle = rgbaArr(G.c, 0.5 * (1 - s)); g.beginPath(); g.ellipse(G.x, G.y, G.r * (1 + 1.6 * s), Math.max(0.3, G.r * (0.5 - 0.3 * s)), 0, 0, Math.PI * 2); g.fill()
    }
  }
  g.restore()
}
// the skewer's geometry at u: where it roots on the parent, where it enters and leaves the body, where its point is
const SK = { sx: 0, sy: 0, ix: 0, iy: 0, ox: 0, oy: 0, tx: 0, ty: 0, k: 0, tw: 0 }
function skewer(A, P) {
  const u = A.corrU, dx = A.corrDx, dy = A.corrDy, R = A.r
  outlinePt(P, dx, dy, prj2); SK.sx = prj2[0]; SK.sy = prj2[1]
  const cx = A.x + (A.hx || 0), cy = A.y + (A.hy || 0)
  SK.ix = cx - dx * R * 0.85; SK.iy = cy - dy * R * 0.85; SK.ox = cx + dx * R * 0.95; SK.oy = cy + dy * R * 0.95
  const full = Math.hypot(SK.ox - SK.sx, SK.oy - SK.sy) + R * 1.5, hitAt = Math.hypot(SK.ix - SK.sx, SK.iy - SK.sy)
  // how far the point has gone: out to the body, through it, held, and back
  let k
  if (u < 0.22) k = hitAt * Math.pow(u / 0.22, 1.7)
  else if (u < 0.34) k = hitAt + (full - hitAt) * smooth((u - 0.22) / 0.12)
  else if (u < 0.62) k = full
  else if (u < 0.9) k = full - (full - hitAt * 0.6) * smooth((u - 0.62) / 0.28)
  else k = hitAt * 0.6 * (1 - smooth((u - 0.9) / 0.1))
  SK.k = k; SK.tx = SK.sx + dx * k; SK.ty = SK.sy + dy * k
  SK.tw = u > 0.34 && u < 0.62 ? smooth((u - 0.34) / 0.28) * Math.PI * 2 : 0 // one twist while it holds
  return k > 1
}
// a length of the shaft from a to b along the strike, tapering, in the parent's flesh; with the barbed point if asked
function shaft(P, a, b, dx, dy, w0, point, tw, z) {
  if (b - a < 0.5 && !point) return
  const nx = -dy, ny = dx, full = Math.max(1, SK.k)
  const wa = w0 * (1 - 0.35 * a / full), wb = w0 * (1 - 0.35 * b / full)
  const ax = SK.sx + dx * a, ay = SK.sy + dy * a, bx = SK.sx + dx * b, by = SK.sy + dy * b
  g.fillStyle = P.fill; g.strokeStyle = P.tone; g.lineWidth = Math.max(1.2, 0.9 / z); g.lineJoin = 'round'
  g.beginPath(); g.moveTo(ax + nx * wa, ay + ny * wa); g.lineTo(bx + nx * wb, by + ny * wb)
  if (point) {
    // the barbs flatten and flip as the shaft twists
    const f = Math.cos(tw), L = w0 * 3.2, bw = w0 * 2.3 * f
    g.lineTo(bx + nx * bw - dx * w0 * 1.1, by + ny * bw - dy * w0 * 1.1)
    g.quadraticCurveTo(bx + nx * bw * 0.6 + dx * L * 0.5, by + ny * bw * 0.6 + dy * L * 0.5, bx + dx * L + nx * w0 * 0.5 * f, by + dy * L + ny * w0 * 0.5 * f)
    g.quadraticCurveTo(bx - nx * bw * 0.6 + dx * L * 0.45, by - ny * bw * 0.6 + dy * L * 0.45, bx - nx * bw - dx * w0 * 1.1, by - ny * bw - dy * w0 * 1.1)
  }
  g.lineTo(bx - nx * wb, by - ny * wb); g.lineTo(ax - nx * wa, ay - ny * wa)
  g.fill(); g.stroke()
  // a turning stripe, so the twist reads along the shaft too
  if (tw > 0.01) {
    g.strokeStyle = rgba(P.tone, 0.5); g.lineWidth = Math.max(0.6, 0.6 / z); g.beginPath()
    for (let s = a + 6; s < b; s += 12) { const o = Math.sin(tw + s * 0.2) * wa * 0.8; g.moveTo(SK.sx + dx * s + nx * o, SK.sy + dy * s + ny * o); g.lineTo(SK.sx + dx * (s + 5) - nx * o, SK.sy + dy * (s + 5) - ny * o) }
    g.stroke()
  }
}
// under the body: the point and the shaft where they come out of the far side
function corrUnder(A, now) {
  if (!(A.corrU >= 0 && A.corrU < 1)) return
  const P = vis.actors.get(H.state.actors.get(A.id) ? H.state.actors.get(A.id).corrBy : '')
  if (!P || A.alpha < 0.05) return
  const z = view.cam.z, dx = A.corrDx, dy = A.corrDy
  g.save(); g.globalAlpha = Math.min(A.alpha, P.alpha)
  if (motion() <= 0.02) {
    // motion off: a small still barb standing out of the far side
    SK.sx = A.x; SK.sy = A.y; SK.k = A.r * 1.6
    shaft(P, A.r * 0.5, A.r * 1.5, dx, dy, Math.max(2.4, P.r * 0.14), true, 0, z)
    g.restore(); return
  }
  if (skewer(A, P)) {
    const through = Math.hypot(SK.ix - SK.sx, SK.iy - SK.sy) + A.r * 0.8
    if (SK.k > through) shaft(P, through, SK.k, dx, dy, Math.max(2.6, P.r * 0.16), true, SK.tw, z)
  }
  g.restore()
}
// over the body: the shaft from the parent down into the entry wound, the wounds themselves, and the flash
function corrOver(A, now) {
  if (!(A.wound > 0.01) && !(A.corrU >= 0 && A.corrU < 1)) return
  const a0 = H.state.actors.get(A.id), P = a0 ? vis.actors.get(a0.corrBy) : null
  if (!P || A.alpha < 0.05) return
  const z = view.cam.z, dx = A.corrDx, dy = A.corrDy, nx = -dy, ny = dx, R = A.r
  const c = ichorOf(A, ichC)
  g.save(); g.globalAlpha = Math.min(A.alpha, P.alpha); g.lineCap = 'round'
  if (motion() <= 0.02) {
    if (A.corrU < 0.5) { g.fillStyle = rgbaArr(c, 0.35 * (1 - A.corrU * 2)); g.beginPath(); g.arc(A.x, A.y, R * 1.5, 0, Math.PI * 2); g.fill() }
    g.restore(); return
  }
  if (A.corrU >= 0 && A.corrU < 1 && skewer(A, P)) {
    const hitAt = Math.hypot(SK.ix - SK.sx, SK.iy - SK.sy)
    // before the strike the point leads; once in, the shaft ends a little inside the entry wound
    if (SK.k <= hitAt + 1) shaft(P, 0, SK.k, dx, dy, Math.max(2.6, P.r * 0.16), true, 0, z)
    else shaft(P, 0, hitAt + R * 0.3, dx, dy, Math.max(2.6, P.r * 0.16), false, SK.tw, z)
  }
  // the wounds: a line of the creature's own ichor across the entry and the exit, closing as it heals
  const cx = A.x + (A.hx || 0), cy = A.y + (A.hy || 0), w = A.wound
  if (w > 0.01) {
    g.strokeStyle = rgbaArr(c, 0.95 * w); g.lineWidth = Math.max(1.4, R * 0.09)
    const gl = R * 0.34 * w
    g.beginPath()
    g.moveTo(cx - dx * R * 0.62 + nx * gl, cy - dy * R * 0.62 + ny * gl); g.lineTo(cx - dx * R * 0.62 - nx * gl, cy - dy * R * 0.62 - ny * gl)
    if (A.corrU > 0.27) { g.moveTo(cx + dx * R * 0.7 + nx * gl, cy + dy * R * 0.7 + ny * gl); g.lineTo(cx + dx * R * 0.7 - nx * gl, cy + dy * R * 0.7 - ny * gl) }
    g.stroke()
    // and a thin seam through the body between them, where the shaft passed
    g.strokeStyle = rgbaArr(c, 0.4 * w); g.lineWidth = Math.max(0.8, R * 0.04)
    g.beginPath(); g.moveTo(cx - dx * R * 0.62, cy - dy * R * 0.62); g.lineTo(cx + dx * R * 0.7, cy + dy * R * 0.7); g.stroke()
  }
  g.restore()
}

// ---------- small things used by the bodies and props ----------
let blobT = 0, dtSm = 0, blobKeep = false
// a bulbous flask in the props' 40 x 40 box: a short neck into a round bulb whose wall wobbles a little
function flaskPath(now, mo, seed) {
  const cx = 20, cy = 25.5, r = 11.5, a0 = 0.355, n = 16
  g.beginPath(); g.moveTo(16, 4); g.lineTo(16, cy - Math.cos(a0) * r)
  let qx = 0, qy = 0
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -Math.PI / 2 - a0 - t * (Math.PI * 2 - 2 * a0)
    const o = r + 0.9 * mo * Math.sin(Math.PI * t) * Math.sin(a * 3 + now * 0.002 + seed)
    const x = cx + Math.cos(a) * o, y = cy + Math.sin(a) * o
    if (i === 0) g.lineTo(x, y); else if (i > 1) g.quadraticCurveTo(qx, qy, (qx + x) / 2, (qy + y) / 2)
    qx = x; qy = y
  }
  g.lineTo(qx, qy); g.lineTo(24, 4)
}

// ---------- the bodies ----------

function drawActor(A, now) {
  const z = view.cam.z, q = Q(), mo = motion()
  const tone = A.tone
  const col = A.col
  const sw = Math.max(1.2, 0.9 / z)
  g.save()
  g.translate(A.x + (A.hx || 0), A.y + (A.hy || 0)); g.rotate(A.tiltA || 0)
  // a finished thrall is a knot on its branch: a small node where the pyramid was
  const knot = A.knot
  if (knot > 0.98) {
    if (A.knotRep && A.knotRep !== A) { g.restore(); return } // merged into a grouped knot
    g.globalAlpha = A.alpha * (0.35 + 0.65 * topAlpha(A)) * 0.8
    const kr = A.knotCount > 1 ? 4.5 : 3.2
    g.fillStyle = PYR; g.strokeStyle = rgba(THRALL, 0.7); g.lineWidth = Math.max(0.8, 0.8 / z)
    g.beginPath(); g.arc(0, 0, kr, 0, Math.PI * 2); g.fill(); g.stroke()
    g.fillStyle = rgba(THRALL, 0.45); g.beginPath(); g.arc(0, 0, 1.2, 0, Math.PI * 2); g.fill()
    if (A.knotCount > 1) { g.fillStyle = rgba(THRALL, 0.8); g.font = '600 9px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(String(A.knotCount), kr + 3, 0) }
    g.restore()
    return
  }
  const R = A.r * (1 - 0.75 * knot)
  // the body's own scale: it grows and bulges round the mouth while it waits, breathes, and squashes on a fast move
  bodyScale(A, now); g.scale(BS[0], BS[1])
  g.globalAlpha = A.alpha * (1 - knot * 0.3)
  // aura, pulsing once when a gulped blob arrives
  const breathe = A.mood === 'thinking' ? 0.75 + 0.25 * Math.sin(now * 0.0016 * mo) : 1
  const ar = R * 2.8 * breathe * (1 + 0.5 * (A.pulse || 0))
  const pc = A.pulse > 0.02 && A.pulseCol ? rgb(A.pulseCol) : col
  const gr = g.createRadialGradient(0, 0, R * 0.4, 0, 0, ar)
  gr.addColorStop(0, rgbaArr(pc, (0.32 + 0.4 * (A.pulse || 0)) * A.aura)); gr.addColorStop(0.55, rgbaArr(pc, 0.1 * A.aura)); gr.addColorStop(1, rgbaArr(pc, 0))
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, ar, 0, Math.PI * 2); g.fill()
  // the session's turn is done: a pentagram beneath the pyramid, slowly turning, glowing in its hue
  if ((A.done || 0) > 0.02) {
    const dn = A.done, pr = R * 2.1
    g.save(); g.rotate(-(A.tiltA || 0)); g.translate(0, R * 0.55); g.scale(1, 0.6)
    const hue = A.hue || FLESHLINE
    if (q === 2) { g.shadowColor = rgba(hue, 0.6 * dn); g.shadowBlur = 18 * z }
    g.strokeStyle = rgba(hue, 0.55 * dn); g.lineWidth = sw * 1.1
    g.beginPath(); g.arc(0, 0, pr * 1.08, 0, Math.PI * 2); g.stroke()
    g.rotate(now * 0.00035 * mo); g.stroke(new Path2D(pentaPath(0, 0, pr, 0)))
    g.shadowBlur = 0
    g.fillStyle = rgba(hue, 0.07 * dn); g.beginPath(); g.arc(0, 0, pr * 1.08, 0, Math.PI * 2); g.fill()
    g.restore()
  }
  // the summoning circle a thrall arrives in
  if (A.born > 0.01) {
    const pr = R * (1.6 + (1 - A.born) * 1.8)
    g.strokeStyle = rgba(BLOOD, A.born); g.lineWidth = sw * 1.5
    g.beginPath(); g.arc(0, 0, pr * 1.08, 0, Math.PI * 2); g.stroke()
    g.save(); g.rotate(now * 0.0009 * mo); g.stroke(new Path2D(pentaPath(0, 0, pr, 0))); g.restore()
    const bg = g.createRadialGradient(0, 0, 0, 0, 0, R * 4.5); bg.addColorStop(0, rgba(BLOOD, 0.45 * A.born)); bg.addColorStop(1, rgba(BLOOD, 0))
    g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R * 4.5, 0, Math.PI * 2); g.fill()
  }
  // the pyramid: a clean silhouette with a floating cap. The outline skips each front arm's root span so the
  // body's fill runs straight into the limb's identical fill.
  if (A.role === 'inspector') { drawInspector(A, R, now, q, mo, sw); g.restore(); return }
  const apex = -R * 1.2, base = R * 0.8, half = R * 1.1
  const capY = apex + R * 0.5, gap = R * 0.14
  const slope = half / (base - apex)
  const tc = (capY + gap - apex) / (base - apex)
  if (q === 2) { g.shadowColor = rgbaArr(col, 0.55); g.shadowBlur = 16 * z }
  g.fillStyle = A.fill; g.strokeStyle = tone; g.lineWidth = sw; g.lineJoin = 'round'; g.lineCap = 'round'
  trunkPath(A, R, tc); g.fill()
  if (A.fable && q >= 1) { g.save(); g.shadowBlur = 0; fableRidges(A, R, apex, capY + gap, base, slope, sw); g.restore() }
  // digestion: a bulge travels down the body for each soul in the gut
  if (A.gut && A.gut.length && q >= 1 && mo > 0.02) {
    g.save(); g.shadowBlur = 0
    for (const d of A.gut) {
      const u = c01((now - d.t0) / d.dur), yy = capY + gap + (base - capY - gap) * u, ww = slope * (yy - apex)
      g.fillStyle = rgba(BONE, 0.16 * Math.sin(u * Math.PI))
      g.beginPath(); g.ellipse(0, yy, Math.max(0.1, ww * 0.95), Math.max(0.1, R * 0.09), 0, 0, Math.PI * 2); g.fill()
    }
    g.restore()
  }
  const feed = A.feed || 0
  const hover = Math.sin(now * 0.0021 * mo + A.seed) * R * 0.08 - R * 0.34 * feed
  g.beginPath(); g.moveTo(0, apex + hover); g.lineTo(slope * (capY - apex), capY + hover); g.lineTo(-slope * (capY - apex), capY + hover); g.closePath(); g.fill(); g.stroke()
  if (feed > 0.03 && q >= 1) {
    // feeding: single-line tentacles wave from the cap's lower line and the body's top line into the gap
    g.strokeStyle = rgba(tone, 0.85 * feed); g.lineWidth = Math.max(0.7, 0.7 / z); g.lineCap = 'round'
    g.beginPath()
    const wCap = slope * (capY - apex), wTop = slope * (capY + gap - apex), len = R * 0.26 * feed
    for (let k = 0; k < 5; k++) {
      const u = (k + 0.5) / 5 - 0.5
      let x0 = u * 2 * wCap * 0.9, y0 = capY + hover
      g.moveTo(x0, y0)
      g.bezierCurveTo(x0 + Math.sin(now * 0.012 * mo + k * 1.7 + 1) * R * 0.04, y0 + len * 0.35, x0 + Math.sin(now * 0.012 * mo + k * 1.7 + 2) * R * 0.07, y0 + len * 0.7, x0 + Math.sin(now * 0.012 * mo + k * 1.7 + 3) * R * 0.06, y0 + len)
      x0 = u * 2 * wTop * 0.9; y0 = capY + gap
      g.moveTo(x0, y0)
      g.bezierCurveTo(x0 + Math.sin(now * 0.011 * mo + k * 2.3 + 1) * R * 0.04, y0 - len * 0.35, x0 + Math.sin(now * 0.011 * mo + k * 2.3 + 2) * R * 0.07, y0 - len * 0.7, x0 + Math.sin(now * 0.011 * mo + k * 2.3 + 3) * R * 0.06, y0 - len)
    }
    g.stroke()
  }
  g.shadowBlur = 0
  g.beginPath()
  sidePt(A, R, 2, 1 - tc, now, prj2); g.moveTo(prj2[0], prj2[1]); sidePt(A, R, 0, tc, now, prj2); g.lineTo(prj2[0], prj2[1])
  edgeSegments(A, 0, tc, 1); edgeSegments(A, 1, 0, 1); edgeSegments(A, 2, 0, 1 - tc)
  g.stroke()
  if (q >= 1) rimLight(A, tc, sw)
  if (A.fable) faceFringe(A, R, now, q, mo, sw)
  // the summoning ring
  if (A.mood === 'summoning') {
    g.strokeStyle = rgba(BLOOD, 0.6 + 0.4 * Math.sin(now * 0.006 * mo)); g.lineWidth = sw * 0.9
    g.save(); g.rotate(now * 0.001 * mo); g.stroke(new Path2D(pentaPath(0, 0, R * 1.5, 0))); g.restore()
    g.beginPath(); g.arc(0, 0, R * 1.58, 0, Math.PI * 2); g.stroke()
  }
  g.restore()
}

// ---------- the inspector: a sphere studded with eyes and ringed with eye stalks on leathery wings ----------
// Drawn inside drawActor's transform (translated to the body, leaned, scaled). The wings flap behind the sphere,
// faster the faster it darts. Twelve to eighteen stalks of varied length writhe gently round the top, each tipped
// with a round eyeball; several bulging eyeballs are set into the sphere's surface at fixed places and sizes,
// foreshortened by where they sit so they read as spheres on a sphere. Every eye has its own pupil that tracks a
// target (the tomes the inspector has been reading, newest first; the rest wander) and its own blink. Cheap: flat
// fills, one highlight dot per eye, counts scaled by quality. The central eye and mouth come from drawActorEye.
function stalkCount(A) { return 12 + (A.seed % 7) }
// surface eyes: (x, y) on the unit disk of the sphere's face, radius as a fraction of the sphere, clear of the central eye
const SURF_EYES = [[-0.7, -0.48, 0.2], [0.68, -0.52, 0.17], [-0.82, 0.22, 0.15], [0.8, 0.28, 0.19], [-0.46, 0.64, 0.16], [0.44, 0.66, 0.14], [0.04, -0.8, 0.15], [-0.36, -0.84, 0.11], [0.42, -0.82, 0.12], [0.0, 0.86, 0.12], [-0.86, -0.12, 0.1], [0.9, -0.08, 0.09]]
// an eyeball: a sphere facing the viewer, lid closing by blink, pupil pulled toward (lx, ly), one highlight
function eyeball(x, y, r, fore, rot, lx, ly, blink, col, tone, sw) {
  const open = Math.max(0.06, 1 - blink)
  g.save(); g.translate(x, y); g.rotate(rot)
  g.fillStyle = '#241B12'; g.strokeStyle = tone; g.lineWidth = sw * 0.7
  g.beginPath(); g.ellipse(0, 0, r, r * fore * open, 0, 0, Math.PI * 2); g.fill(); g.stroke()
  if (open > 0.15) {
    g.save(); g.clip()
    // the look, rotated back into the eye's frame
    const c = Math.cos(-rot), s = Math.sin(-rot)
    g.scale(1, fore)
    eyeGlobe(0, 0, r, r * 0.5, r * 0.25, lx * c - ly * s, lx * s + ly * c, col, false, 0, frameNow, 1)
    g.restore()
  }
  g.restore()
}
const stalkL = new Float32Array(14), stalkR = new Float32Array(14)
function drawInspector(A, R, now, q, mo, sw) {
  const Rs = R * 1.05, tone = A.tone, col = A.col
  const spd = Math.hypot(A.vx || 0, A.vy || 0)
  const flapRate = (0.009 + Math.min(0.012, spd / 30000)) * mo
  const flap = Math.sin(now * flapRate + A.seed)
  // wings: each pivots about its shoulder with the flap, and a travelling wave runs root to tip along the three
  // finger bones and the membrane between them, lagging the pivot by a quarter turn per segment, so the tips
  // trail the stroke: bent up on the downstroke, down on the upstroke. Mirrored left and right.
  const ph = now * flapRate + A.seed
  const pivot = Math.sin(ph) * 0.28 * mo, amp = Rs * 0.16 * mo
  const SEG = 4
  for (const side of [-1, 1]) {
    const sx = side * Rs * 0.55, sy = -Rs * 0.15
    g.save(); g.translate(sx, sy); g.rotate(-side * pivot)
    const span = Rs * 1.85
    // the finger bones: points along each, the wave bending them up and down with the lag
    const bones = []
    for (let f = 0; f < 3; f++) {
      const u = f / 2, a = -0.95 + u * 1.25, L = span * (1 - u * 0.22)
      const pts = []
      for (let s = 0; s <= SEG; s++) { const t = s / SEG; const dy = amp * Math.sin(ph - s * Math.PI / 4) * t * t; pts.push([side * Math.cos(a) * L * t, Math.sin(a) * L * 0.7 * t + dy]) }
      bones.push(pts)
    }
    // the membrane: down the first bone, scalloped between the tips, back up the last bone to the shoulder
    g.fillStyle = rgba("#2A1A24", 0.9); g.strokeStyle = rgba(tone, 0.8); g.lineWidth = sw * 0.5; g.lineJoin = "round"
    g.beginPath(); g.moveTo(0, Rs * 0.35)
    for (const p of bones[0]) g.lineTo(p[0], p[1])
    for (let f = 0; f < 2; f++) { const a = bones[f][SEG], b = bones[f + 1][SEG]; g.quadraticCurveTo((a[0] + b[0]) / 2 - side * Rs * 0.18, (a[1] + b[1]) / 2 + Rs * 0.28, b[0], b[1]) }
    for (let s = SEG - 1; s >= 0; s--) g.lineTo(bones[2][s][0], bones[2][s][1])
    g.quadraticCurveTo(side * Rs * 0.5, Rs * 0.55, 0, Rs * 0.35)
    g.closePath(); g.fill(); g.stroke()
    g.beginPath(); for (const pts of bones) { g.moveTo(0, 0); for (let s = 1; s <= SEG; s++) g.lineTo(pts[s][0], pts[s][1]) } g.stroke()
    g.restore()
  }
  // where the eyes look: the k-th most recent tome the inspector read, in the leaned body frame; else a wander
  const S = H.state.actors.get(A.id), ta = A.tiltA || 0
  // every eye looks from where it sits, in its own saccades: at the pointer, or at whoever the inspector is dealing
  // with; else at one of the tomes it read lately, hopping between them; else it wanders
  const cta = Math.cos(-ta), sta = Math.sin(-ta), still = motion() <= 0.02
  const lookAt = (k, ex, ey, out) => {
    if (attn(A, ex, ey, now, k, out)) return
    const per = 1100 + 173 * (k % 5), slot = Math.floor((now + k * 517) / per)
    if (S && S.wake.length && nh(A.seed + k, slot) < 0.72) {
      const N = vis.nodes.get(S.wake[S.wake.length - 1 - Math.floor(nh(A.seed + k + 3, slot) * Math.min(3, S.wake.length))].node)
      if (N && N.present && isFinite(N.x)) {
        const ddx = N.x + N.w / 2 - A.x, ddy = N.y + N.h / 2 - A.y
        gazeTo(ex, ey, ddx * cta - ddy * sta, ddx * sta + ddy * cta, R * 0.5)
        const e = still ? 1 : backOut((now + k * 517 - slot * per) / 110) // the jump onto it: fast, a slight overshoot
        out[0] = gz[0] * (0.2 + 0.8 * e); out[1] = gz[1] * (0.2 + 0.8 * e)
        return
      }
    }
    slotLook(A.seed, k, now, out)
  }
  const asl = smooth(A.sleep || 0) * (1 - (A.peek || 0)) * 0.97
  // each eye blinks on its own: a brief closing now and then, deterministic in time and eye
  const blinkOf = k => { const b = (A.blink || 0) * 0.95; const own = Math.pow(Math.max(0, Math.sin(now * 0.0013 * mo + k * 7.31 + A.seed)), 60); return Math.max(b, own, asl) }
  // the stalks, behind the sphere where they root, writhing gently, each tipped with a round eyeball
  const n = q === 0 ? 8 : stalkCount(A)
  for (let k = 0; k < n; k++) {
    const a = -Math.PI * 1.08 + (k + 0.5) / n * Math.PI * 1.16
    const len = Rs * (0.35 + 0.5 * rnd(A.id, k))
    const sway = (Math.sin(now * 0.0031 * mo + k * 1.9 + A.seed) * 0.2 + Math.sin(now * 0.0053 * mo + k * 0.7) * 0.08)
    const bx = Math.cos(a) * Rs * 0.92, by = Math.sin(a) * Rs * 0.92
    const tx = Math.cos(a + sway) * (Rs + len), ty = Math.sin(a + sway) * (Rs + len)
    const cx = Math.cos(a - sway * 0.6) * (Rs + len * 0.5), cy = Math.sin(a - sway * 0.6) * (Rs + len * 0.5)
    // the stalk as a tube: sampled along its curve, half-width tapering from the root to the eye, outlined like the body
    const hw0 = Rs * 0.075, hw1 = Rs * 0.055
    g.fillStyle = A.fill; g.strokeStyle = tone; g.lineWidth = sw; g.lineJoin = "round"
    g.beginPath()
    for (let s = 0; s <= 6; s++) {
      const t = s / 6, v = 1 - t
      const px = v * v * bx + 2 * v * t * cx + t * t * tx, py = v * v * by + 2 * v * t * cy + t * t * ty
      const dx = 2 * v * (cx - bx) + 2 * t * (tx - cx), dy = 2 * v * (cy - by) + 2 * t * (ty - cy), dl = Math.hypot(dx, dy) || 1
      const hw = hw0 + (hw1 - hw0) * t
      stalkL[s * 2] = px - dy / dl * hw; stalkL[s * 2 + 1] = py + dx / dl * hw
      stalkR[s * 2] = px + dy / dl * hw; stalkR[s * 2 + 1] = py - dx / dl * hw
    }
    g.moveTo(stalkL[0], stalkL[1]); for (let s = 1; s <= 6; s++) g.lineTo(stalkL[s * 2], stalkL[s * 2 + 1])
    for (let s = 6; s >= 0; s--) g.lineTo(stalkR[s * 2], stalkR[s * 2 + 1])
    g.closePath(); g.fill(); g.stroke()
    lookAt(k, tx, ty, prj)
    eyeball(tx, ty, Rs * (0.1 + 0.07 * rnd(A.id, k + 50)), 1, 0, prj[0], prj[1], blinkOf(k), col, tone, sw)
  }
  // an inspector running on Fable takes a hint of its fringe
  if (A.fable) sphereFringe(A, Rs, now, q, mo, sw)
  // the sphere
  if (q === 2) { g.shadowColor = rgbaArr(col, 0.55); g.shadowBlur = 16 * view.cam.z }
  const gr = g.createRadialGradient(-Rs * 0.35, -Rs * 0.4, Rs * 0.1, 0, 0, Rs)
  gr.addColorStop(0, '#2C3634'); gr.addColorStop(0.6, A.fill); gr.addColorStop(1, '#0B100F')
  g.fillStyle = gr; g.strokeStyle = tone; g.lineWidth = sw
  g.beginPath(); g.arc(0, 0, Rs, 0, Math.PI * 2); g.fill()
  g.shadowBlur = 0
  g.stroke()
  if (q >= 1) { rimDir(A, prj2); const ra = Math.atan2(prj2[1], prj2[0]); g.strokeStyle = rgba(RIM, 0.38); g.lineWidth = sw * 0.8; g.beginPath(); g.arc(0, 0, Rs - sw, ra - 0.8, ra + 0.8); g.stroke() }
  // the surface eyes: bulging eyeballs set into the sphere, foreshortened toward the rim and turned to face outward
  const ne = q === 2 ? SURF_EYES.length : q === 1 ? 8 : 4
  for (let k = 0; k < ne; k++) {
    const e = SURF_EYES[k], ux = e[0], uy = e[1]
    const uz = Math.sqrt(Math.max(0.05, 1 - ux * ux - uy * uy))
    const x = ux * Rs, y = uy * Rs, r = e[2] * Rs
    lookAt(k + 7, x, y, prj)
    eyeball(x, y, r, 0.4 + 0.6 * uz, Math.atan2(uy, ux) + Math.PI / 2, prj[0], prj[1], blinkOf(k + 20), col, tone, sw)
  }
}
