// Abyssal Eye live view, part 3 of 4: limb chains, props, souls, camera, connections, cards and the well.
'use strict'
function chainStep(L, A, now, dt) {
  const M = Q() === 0 ? 24 : 32
  if (!L.chain || L.M !== M) {
    L.M = M; L.chain = new Float64Array(M * 2); L.prev = new Float64Array(M * 2)
    limbRoot(A, L)
    for (let i = 0; i < M; i++) { L.chain[i * 2] = L.prev[i * 2] = ROOT[0]; L.chain[i * 2 + 1] = L.prev[i * 2 + 1] = ROOT[1] }
    L.hx = ROOT[0]; L.hy = ROOT[1]; L.u = -1; L.sm = 'work'; L.smAt = 0; L.uv = 1; L.sp = 8
  }
  const goal = steerHead(L, A, now, dt)
  let gx = goal[0], gy = goal[1]
  if (L.wait > 0.01) { const dx = gx - A.x, dy = gy - A.y, d = Math.hypot(dx, dy) || 1; const back = Math.min(26, d * 0.2) * L.wait; gx -= dx / d * back; gy -= dy / d * back }
  // an eye tip stops short so the bulb sits on the target instead of inside it
  if (L.tipEye > 0.01) { const dx = gx - A.x, dy = gy - A.y, d = Math.hypot(dx, dy) || 1; const back = Math.min(d * 0.4, A.r * 0.55 * L.scale * 1.4) * L.tipEye; gx -= dx / d * back; gy -= dy / d * back }
  if (A.swimK > 0.01) { trailGoal(L, A); gx = lerp(gx, trailP[0], A.swimK); gy = lerp(gy, trailP[1], A.swimK) }
  // the head has momentum: retargeting changes its goal, not its position; it accelerates toward the goal and
  // brakes into it under a speed and an acceleration cap (a gripped card's mass slows the arm); motion off snaps
  const sdt = Math.min(dt, 1 / 30)
  const mo0 = motion()
  if (mo0 < 0.02) { L.hx = gx; L.hy = gy; L.hvx = 0; L.hvy = 0 }
  else {
    const load = 1 / (1 + 0.6 * (L.load || 0))
    const vmax = (L.sm === 'approach' ? 520 : A.swimK > 0.5 ? 700 : 950) * load, amax = 2600 * load
    const dx = gx - L.hx, dy = gy - L.hy, d = Math.hypot(dx, dy) || 1e-6
    const want = Math.min(vmax, Math.sqrt(2 * amax * d) * 0.9)
    const tvx = dx / d * want, tvy = dy / d * want
    let ax = tvx - (L.hvx || 0), ay = tvy - (L.hvy || 0)
    const al = Math.hypot(ax, ay) || 1e-6, step = Math.min(al, amax * sdt)
    L.hvx = (L.hvx || 0) + ax / al * step; L.hvy = (L.hvy || 0) + ay / al * step
    L.hx += L.hvx * sdt; L.hy += L.hvy * sdt
    if (!isFinite(L.hx) || !isFinite(L.hy)) { L.hx = gx; L.hy = gy; L.hvx = 0; L.hvy = 0 }
  }
  L.tx = L.hx; L.ty = L.hy
  limbRoot(A, L)
  const C = L.chain, Pv = L.prev
  const rx = ROOT[0], ry = ROOT[1], nx = ROOT[2], ny = ROOT[3]
  // rest shape from the reach IK: a gentle curve that leaves the root along the edge normal and bends toward the
  // head; no gravity, the tentacle floats as in water. Sampled into SP (index 0 = head, M-1 = root).
  const hx = L.hx, hy = L.hy
  const dist = Math.hypot(hx - rx, hy - ry) || 1
  // the curve leaves along the normal, but not so far that it hooks back when the head sits beside the root
  const fdir = ((hx - rx) * nx + (hy - ry) * ny) / dist
  // a head beside or behind the root gets a long departure along the normal and an outward second control point,
  // so the rest curve itself sweeps round the side of the body instead of folding over it
  const nk = Math.max(dist * (0.12 + 0.28 * Math.max(0, fdir)), fdir < 0.6 ? A.r * (1.2 + 0.8 * (0.6 - fdir)) : 0)
  const nk2 = Math.max(0, 0.3 - fdir) * A.r * 1.6
  const c1x = rx + nx * nk, c1y = ry + ny * nk
  const c2x = hx + (c1x - hx) * 0.25 + nx * nk2, c2y = hy + (c1y - hy) * 0.25 + ny * nk2
  let plen = 0, px0 = rx, py0 = ry
  for (let i = M - 1; i >= 0; i--) {
    const t = 1 - i / (M - 1), u = 1 - t
    const x = rx * u * u * u + 3 * c1x * u * u * t + 3 * c2x * u * t * t + hx * t * t * t
    const y = ry * u * u * u + 3 * c1y * u * u * t + 3 * c2y * u * t * t + hy * t * t * t
    SP[i * 2] = x; SP[i * 2 + 1] = y
    if (i < M - 1) plen += Math.hypot(x - px0, y - py0)
    px0 = x; py0 = y
  }
  L.sp = ease(L.sp, Math.max(0.5, plen / (M - 1)), 6, dt) // no slack: the chain is exactly as long as its rest curve
  const s = L.sp
  // 1. every free point is a lightly underdamped spring toward its rest position (Pv holds velocities), plus a
  //    bend term toward the midpoint of its neighbours. Stiffness runs along the chain: high near the root (the
  //    first ~15%, so it leaves the edge cleanly along its normal) and at the tip quarter, about a third of that
  //    through the middle, which is also a little less damped: the middle sways and sags with motion and carries
  //    the follow-through while root and tip stay composed. No gravity.
  const mo = motion()
  const zeta0 = 0.72 + 0.2 * (1 - mo)
  const tipFrom = Math.floor((M - 1) * 0.25) // indices below this are the firm tip section
  for (let i = 1; i < M - 2; i++) {
    const r = i / (M - 1) // 1 at the root, 0 at the tip
    const end = Math.max(smooth((r - 0.7) / 0.16), smooth((0.4 - r) / 0.14))
    const kk = 0.3 + 0.7 * end
    const om = 16 * Math.sqrt(kk)
    const zeta = zeta0 * (0.85 + 0.15 * end)
    const bend = 55 * kk
    const mass = 0.7 + 0.65 * end // heavier toward the root, light in the loose middle: the middle lags and swings
    // the bend term compares the local curvature with the rest curve's, so it is zero at rest
    const bx = (C[i * 2 - 2] + C[i * 2 + 2]) * 0.5 - C[i * 2] - ((SP[i * 2 - 2] + SP[i * 2 + 2]) * 0.5 - SP[i * 2])
    const by = (C[i * 2 - 1] + C[i * 2 + 3]) * 0.5 - C[i * 2 + 1] - ((SP[i * 2 - 1] + SP[i * 2 + 3]) * 0.5 - SP[i * 2 + 1])
    const ax = ((SP[i * 2] - C[i * 2]) * om * om + bx * bend) / mass - 2 * zeta * om * Pv[i * 2]
    const ay = ((SP[i * 2 + 1] - C[i * 2 + 1]) * om * om + by * bend) / mass - 2 * zeta * om * Pv[i * 2 + 1]
    Pv[i * 2] += ax * sdt; Pv[i * 2 + 1] += ay * sdt
    C[i * 2] += Pv[i * 2] * sdt; C[i * 2 + 1] += Pv[i * 2 + 1] * sdt
  }
  // 2. the root pins: the chain stays attached and leaves along the edge normal
  C[M * 2 - 2] = rx; C[M * 2 - 1] = ry; C[M * 2 - 4] = rx + nx * s; C[M * 2 - 3] = ry + ny * s
  Pv[M * 2 - 2] = 0; Pv[M * 2 - 1] = 0; Pv[M * 2 - 4] = 0; Pv[M * 2 - 3] = 0
  // 3. bend limits, root outward (a hard constraint, not a spring): the base is rigidly along the edge normal for
  //    the first ~17% of the chain, then each segment may bend a little more than the last (3 to 18 degrees by
  //    mid-chain), so the tentacle can never fold back over the body; a corrected point carries the rest of the
  //    chain with it, which keeps the shape beyond intact
  let dirx = nx, diry = ny
  for (let i = M - 3; i >= tipFrom; i--) {
    const r = (M - 1 - i) / (M - 1)
    const maxA = r < 0.17 ? 0.02 : r < 0.55 ? lerp(0.052, 0.314, (r - 0.17) / 0.38) : 0
    let dx = C[i * 2] - C[i * 2 + 2], dy = C[i * 2 + 1] - C[i * 2 + 3]
    const dl = Math.hypot(dx, dy)
    if (dl < 1e-6) { dx = dirx; dy = diry } else { dx /= dl; dy /= dl }
    if (maxA > 0) {
      const ang = Math.atan2(dirx * dy - diry * dx, dirx * dx + diry * dy)
      if (Math.abs(ang) > maxA) {
        const a = Math.sign(ang) * maxA, ca = Math.cos(a), sa = Math.sin(a)
        const ndx = dirx * ca - diry * sa, ndy = dirx * sa + diry * ca
        const len = Math.max(dl, s * 0.5)
        const cx = C[i * 2 + 2] + ndx * len, cy = C[i * 2 + 3] + ndy * len
        // a soft correction: a fraction per frame, so a limit never snaps a joint
        const soft = 1 - Math.exp(-30 * sdt)
        const ddx = (cx - C[i * 2]) * soft, ddy = (cy - C[i * 2 + 1]) * soft
        for (let j = i; j >= 0; j--) { C[j * 2] += ddx; C[j * 2 + 1] += ddy }
        const mx2 = C[i * 2] - C[i * 2 + 2], my2 = C[i * 2 + 1] - C[i * 2 + 3], ml = Math.hypot(mx2, my2) || 1
        dx = mx2 / ml; dy = my2 / ml
      }
    }
    dirx = dx; diry = dy
  }
  // 4. nothing enters the body: a point inside the pyramid's triangle is pushed out through the nearest edge
  const R = A.r * 1.06
  for (let i = 0; i < M - 2; i++) {
    const px = C[i * 2] - A.x, py = C[i * 2 + 1] - A.y
    let inside = true, best = 1e9, bnx = 0, bny = 0
    for (let k = 0; k < 3 && inside; k++) {
      const x0 = PVX[k] * R, y0 = PVY[k] * R, ex = PVX[(k + 1) % 3] * R - x0, ey = PVY[(k + 1) % 3] * R - y0
      const el = Math.hypot(ex, ey) || 1
      let enx = ey / el, eny = -ex / el
      if (enx * (x0 + ex / 2) + eny * (y0 + ey / 2) < 0) { enx = -enx; eny = -eny }
      const dd = (px - x0) * enx + (py - y0) * eny
      if (dd > 0) inside = false
      else if (-dd < best) { best = -dd; bnx = enx; bny = eny }
    }
    if (inside) { const soft = 1 - Math.exp(-20 * sdt); C[i * 2] += bnx * (best + 1) * soft; C[i * 2 + 1] += bny * (best + 1) * soft; Pv[i * 2] *= 0.5; Pv[i * 2 + 1] *= 0.5 }
  }
  // 5. two passes of Laplacian smoothing over the interior, weighted down toward the pinned root and the rigid tip,
  //    so the constraints never leave a kink; the chain's state itself is smoothed, which also calms the springs
  for (let pass = 0; pass < 2; pass++) {
    let px = C[M * 2 - 4], py = C[M * 2 - 3]
    for (let i = M - 3; i > tipFrom; i--) {
      const w = 0.5 * Math.min(1, (M - 2 - i) / 3) * Math.min(1, (i - tipFrom) / 3)
      const cx = C[i * 2], cy = C[i * 2 + 1]
      const mx = (px + C[i * 2 - 2]) * 0.5, my = (py + C[i * 2 - 1]) * 0.5
      C[i * 2] = cx + (mx - cx) * w; C[i * 2 + 1] = cy + (my - cy) * w
      px = cx; py = cy
    }
  }
  // 6. the tip section is one firm body: it keeps the rest curve's shape, rides on its base point, and turns with
  //    its own angular momentum (an underdamped swing toward the rest orientation, near critical with motion low)
  const bx = C[tipFrom * 2], by = C[tipFrom * 2 + 1]
  const thR = Math.atan2(SP[1] - SP[tipFrom * 2 + 1], SP[0] - SP[tipFrom * 2])
  if (L.tipTh === undefined || mo < 0.02 || !isFinite(L.tipTh)) { L.tipTh = thR; L.tipW = 0 }
  let dth = thR - L.tipTh; dth -= Math.round(dth / (Math.PI * 2)) * Math.PI * 2
  const wt = 15, zt = 0.8 + 0.2 * (1 - mo)
  L.tipW += (dth * wt * wt - 2 * zt * wt * L.tipW) * sdt; L.tipTh += L.tipW * sdt
  let rot = L.tipTh - thR; rot -= Math.round(rot / (Math.PI * 2)) * Math.PI * 2
  rot = clamp(rot, -0.35, 0.35)
  const cr = Math.cos(rot), sr = Math.sin(rot)
  // the tip keeps the rest curve's bends but a fixed length (by the creature's size, not the reach), so the club
  // and its suckers never smear; the shaft takes all the stretch
  const tipLen = A.r * (L.eye ? 1.1 : 1.5), seg = tipLen / tipFrom
  let px = SP[tipFrom * 2], py = SP[tipFrom * 2 + 1], ox = 0, oy = 0
  const tipOff = TIPOFF
  for (let i = tipFrom - 1; i >= 0; i--) {
    let dx = SP[i * 2] - px, dy = SP[i * 2 + 1] - py
    const dl = Math.hypot(dx, dy)
    if (dl < 1e-6) { dx = SP[tipFrom * 2] - SP[tipFrom * 2 + 2]; dy = SP[tipFrom * 2 + 1] - SP[tipFrom * 2 + 3]; const l2 = Math.hypot(dx, dy) || 1; dx /= l2; dy /= l2 } else { dx /= dl; dy /= dl }
    ox += dx * seg; oy += dy * seg
    tipOff[i * 2] = ox; tipOff[i * 2 + 1] = oy
    px = SP[i * 2]; py = SP[i * 2 + 1]
  }
  for (let i = 0; i < tipFrom; i++) { const tx = tipOff[i * 2], ty = tipOff[i * 2 + 1]; C[i * 2] = bx + tx * cr - ty * sr; C[i * 2 + 1] = by + tx * sr + ty * cr }
  L.tipFrom = tipFrom
  Pv[0] = 0; Pv[1] = 0
  // a chain that went non-finite (a bad frame, a vanished target) heals at once: back onto the root, at rest
  for (let i = 0; i < M * 2; i++) {
    if (isFinite(C[i])) continue
    for (let j = 0; j < M; j++) { C[j * 2] = rx; C[j * 2 + 1] = ry; Pv[j * 2] = 0; Pv[j * 2 + 1] = 0 }
    if (L.flt) for (let j = 0; j < M; j++) { L.flt[j * 2] = rx; L.flt[j * 2 + 1] = ry }
    L.hx = rx; L.hy = ry; L.hvx = 0; L.hvy = 0; L.tipW = 0; L.tipTh = undefined
    break
  }
  // 7. the drawn spine is a temporally filtered copy (~70 ms), in root-relative coordinates so the root never lags
  //    the body: frame-to-frame differences cannot pop
  if (!L.flt || L.flt.length !== M * 2) { L.flt = new Float64Array(M * 2); for (let i = 0; i < M * 2; i++) L.flt[i] = C[i] }
  else {
    const F = L.flt, kf = 1 - Math.exp(-dt / 0.07), orx = F[M * 2 - 2], ory = F[M * 2 - 1]
    for (let i = 0; i < M; i++) {
      const tx = C[i * 2] - rx, ty = C[i * 2 + 1] - ry, fx = F[i * 2] - orx, fy = F[i * 2 + 1] - ory
      F[i * 2] = rx + fx + (tx - fx) * kf; F[i * 2 + 1] = ry + fy + (ty - fy) * kf
    }
    F[M * 2 - 2] = rx; F[M * 2 - 1] = ry
  }
}

// squid locomotion: a long trip is swum in pulses (contract, thrust, glide); otherwise a critically damped glide
// the wake's bubble pool: tiny, low alpha, rising, wobbling, growing a little and fading out within a second or two
const bubbles = { cap: 0, n: 0, x: null, y: null, r: null, t: null, life: null, ph: null }
function bubbleAlloc(cap) { bubbles.cap = cap; bubbles.n = 0; for (const k of ['x', 'y', 'r', 't', 'life', 'ph']) bubbles[k] = new Float32Array(Math.max(1, cap)) }
function syncBubbles(dt) {
  const cap = Q() === 2 ? 120 : Q() === 1 ? 60 : 0
  if (bubbles.cap !== cap) bubbleAlloc(cap)
  const mo = motion()
  if (!cap || mo <= 0.02) { bubbles.n = 0; return }
  for (let i = 0; i < bubbles.n; i++) {
    bubbles.t[i] += dt * mo
    bubbles.y[i] -= (22 + bubbles.r[i] * 6) * dt * mo
    bubbles.x[i] += Math.sin(bubbles.t[i] * 5 + bubbles.ph[i]) * 9 * dt * mo
    if (bubbles.t[i] >= bubbles.life[i]) { bubbles.n--; if (i < bubbles.n) { const j = bubbles.n; for (const k of ['x', 'y', 'r', 't', 'life', 'ph']) bubbles[k][i] = bubbles[k][j]; i-- } }
  }
}
function drawBubbles() {
  if (!bubbles.n) return
  const z = view.cam.z
  g.save(); g.lineWidth = Math.max(0.6, 0.7 / z)
  for (let i = 0; i < bubbles.n; i++) {
    const u = bubbles.t[i] / bubbles.life[i], x = bubbles.x[i], y = bubbles.y[i]
    if (!inView(x - 6, y - 6, 12, 12)) continue
    const r = bubbles.r[i] * (1 + 0.5 * u), al = 0.28 * (1 - u) * Math.min(1, u * 6)
    g.strokeStyle = rgba(BONE, al); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
    g.fillStyle = rgba('#F4F0D8', al * 0.7); g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, Math.max(0.3, r * 0.22), 0, Math.PI * 2); g.fill()
  }
  g.restore()
}
// ---------- skulls: the detritus of labour ----------
// A gulped soul is digested for two to four seconds (a bulge travels down the body), then the pyramid expels a
// tiny skull from its underside. It drifts out with a push, then floats in orbit round the wormhole, tumbling,
// sinking gently inward with the dust until it fades into the well. Pooled and capped; when many souls go down at
// once the gut queue is capped too, so one skull stands for several souls and the rate scales with token use.
const skulls = { cap: 0, n: 0, x: null, y: null, vx: null, vy: null, ang: null, r: null, w: null, rot: null, rv: null, born: null, ph: null, seed: null }
const SKULL_KEYS = ["x", "y", "vx", "vy", "ang", "r", "w", "rot", "rv", "born", "ph", "seed"]
function skullAlloc(cap) { skulls.cap = cap; skulls.n = 0; for (const k of SKULL_KEYS) skulls[k] = new Float32Array(Math.max(1, cap)) }
function skullDrop(i) { skulls.n--; if (i < skulls.n) { const j = skulls.n; for (const k of SKULL_KEYS) skulls[k][i] = skulls[k][j] } }
// a soul went down: queue its digestion (at most four pending per creature, the rest is absorbed into those)
function digest(A, now) {
  if (!A.gut) { A.gut = []; A.gutN = 0 }
  A.gutN++
  if (A.gut.length >= 4) return
  A.gut.push({ t0: now, dur: 2000 + rnd(A.id, A.gutN) * 2000 })
}
function skullSpawn(A, now, k) {
  const mo = motion()
  if (!isFinite(A.x) || !isFinite(A.y) || mo <= 0.02 || !skulls.cap) return
  if (skulls.n >= skulls.cap) { let o = 0; for (let i = 1; i < skulls.n; i++) if (skulls.born[i] < skulls.born[o]) o = i; skullDrop(o) }
  const i = skulls.n++, R = A.r * (A.bodyK || 1), ta = A.tiltA || 0
  // out of the underside, a little push down and to one side
  skulls.x[i] = A.x - Math.sin(ta) * R * 0.8 + (rnd(A.id, k + 7) - 0.5) * R * 0.6
  skulls.y[i] = A.y + Math.cos(ta) * R * 0.8
  skulls.vx[i] = (rnd(A.id, k + 3) - 0.5) * 36; skulls.vy[i] = 18 + rnd(A.id, k + 5) * 14
  skulls.rot[i] = rnd(A.id, k + 11) * 6.28; skulls.rv[i] = (rnd(A.id, k + 13) - 0.5) * 2.4
  skulls.born[i] = now; skulls.ph[i] = 0; skulls.seed[i] = rnd(A.id, k + 17)
  skulls.ang[i] = 0; skulls.r[i] = 0; skulls.w[i] = 0
}
function syncSkulls(dt, now) {
  const q = Q(), cap = q === 2 ? 40 : q === 1 ? 20 : 8
  if (skulls.cap !== cap) skullAlloc(cap)
  const mo = motion()
  if (mo <= 0.02) { skulls.n = 0; for (const A of vis.actors.values()) if (A.gut) A.gut.length = 0; return }
  // digestion: the bulge runs for its duration, then the skull is expelled
  for (const A of vis.actors.values()) {
    if (!A.gut || !A.gut.length) continue
    for (let i = 0; i < A.gut.length; i++) { const d = A.gut[i]; if (now - d.t0 >= d.dur) { A.gut.splice(i, 1); i--; if (A.present) skullSpawn(A, now, A.gutN * 31 + i) } }
  }
  const throat = pack.coreR * 0.12
  for (let i = 0; i < skulls.n; i++) {
    skulls.rot[i] += skulls.rv[i] * dt * mo
    if (skulls.ph[i] === 0) {
      // the push: drifting out, slowing, then handed to the orbit once the drift is spent
      skulls.x[i] += skulls.vx[i] * dt * mo; skulls.y[i] += skulls.vy[i] * dt * mo
      skulls.vx[i] *= Math.exp(-1.6 * dt); skulls.vy[i] *= Math.exp(-1.6 * dt)
      if (now - skulls.born[i] > 1400 && pack.init) {
        const dx = skulls.x[i] - pack.cx, dy = (skulls.y[i] - pack.cy) / Math.max(0.2, tilt.cos)
        skulls.ang[i] = Math.atan2(dy, dx); skulls.r[i] = Math.max(pack.coreR * 0.3, Math.hypot(dx, dy)); skulls.w[i] = skulls.seed[i] < 0.5 ? -0.5 : 0.5
        skulls.ph[i] = 1
      }
      if (!isFinite(skulls.x[i]) || !isFinite(skulls.y[i])) { skullDrop(i); i-- }
      continue
    }
    // in orbit: a slow Kepler-like fall, far gentler than the dust
    const r = skulls.r[i], f = clamp(1 - r / Math.max(1, pack.outerR), 0, 1)
    const vr = (2.5 + 14 * f * f + (r < pack.coreR ? 40 * (1 - r / pack.coreR) : 0)) * mo
    skulls.r[i] = r - vr * dt
    skulls.ang[i] += skulls.w[i] * mo * dt * (60 / Math.max(40, r)) * 2
    if (skulls.r[i] <= throat || !isFinite(skulls.r[i]) || !isFinite(skulls.ang[i])) { skullDrop(i); i-- }
  }
}
function drawSkulls(now) {
  if (!skulls.n) return
  const z = view.cam.z, q = Q()
  const s = Math.max(3.2, 2.6 / z)
  g.save()
  for (let i = 0; i < skulls.n; i++) {
    let x, y, al = 1
    if (skulls.ph[i] === 0) { x = skulls.x[i]; y = skulls.y[i]; al = Math.min(1, (now - skulls.born[i]) / 300) }
    else {
      projectPolar(skulls.ang[i], skulls.r[i], prj); x = prj[0]; y = prj[1]
      // sinking into the well: fading as it goes under
      const deep = skulls.r[i] < pack.coreR * 0.6 ? skulls.r[i] / (pack.coreR * 0.6) : 1
      al = Math.pow(deep, 1.4)
    }
    if (!isFinite(x) || !isFinite(y) || !inView(x - 8, y - 8, 16, 16)) continue
    g.save(); g.translate(x, y); g.rotate(skulls.rot[i])
    g.globalAlpha = 0.42 * al
    // cranium and jaw
    g.fillStyle = BONE
    g.beginPath(); g.arc(0, -s * 0.15, s * 0.78, 0, Math.PI * 2); g.fill()
    g.fillRect(-s * 0.45, s * 0.25, s * 0.9, s * 0.5)
    if (q >= 1) {
      // sockets and a hint of teeth
      g.fillStyle = VOID
      g.beginPath(); g.arc(-s * 0.3, -s * 0.2, s * 0.2, 0, Math.PI * 2); g.arc(s * 0.3, -s * 0.2, s * 0.2, 0, Math.PI * 2); g.fill()
      g.fillRect(-s * 0.3, s * 0.4, s * 0.12, s * 0.3); g.fillRect(-s * 0.06, s * 0.4, s * 0.12, s * 0.3); g.fillRect(s * 0.18, s * 0.4, s * 0.12, s * 0.3)
    }
    g.restore()
  }
  g.restore()
}

// ---------- tendrils: jellyfish-like trailing threads under a moving pyramid ----------
// Four to seven thin tapering lines rooted along the base edge (turning with the tilted body). Each is a
// follow-the-leader chain with inertia, so they trail the travel and swing on a turn, and a travelling wave runs
// root to tip as if pulsing the body along: amplitude and frequency grow with speed, a slow sway at rest. They
// shorten while the pyramid has been idle for a while and grow out again when it moves. One stroke each.
const TEND_M = 9
function tendrilStep(A, sdt, now) {
  const q = Q(), mo = motion()
  const count = q === 0 ? 0 : q === 1 ? 4 : 6
  if (!count || A.alpha < 0.05) { A.tend = null; return }
  const R = A.r * (A.bodyK || 1)
  if (!A.tend || A.tend.length !== count) {
    A.tend = []
    for (let k = 0; k < count; k++) A.tend.push({ p: new Float64Array(TEND_M * 2), o: new Float64Array(TEND_M * 2), init: false, ph: k * 1.7 })
  }
  const spd = Math.hypot(A.vx, A.vy)
  if (spd > 15) A.movedT = now
  const idle = now - (A.movedT || 0)
  // the reach: full while moving, shrinking to a stub after a while at rest
  const want = idle < 4000 ? 1 : idle < 12000 ? 1 - 0.7 * (idle - 4000) / 8000 : 0.3
  A.tendK = ease(A.tendK === undefined ? want : A.tendK, want, 1.2, sdt)
  const len = R * 1.7 * A.tendK, seg = len / (TEND_M - 1)
  const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
  const half = R * 1.1, base = R * 0.8
  const damp = mo > 0.02 ? Math.exp(-6 * sdt) : 0
  for (let k = 0; k < count; k++) {
    const T = A.tend[k], p = T.p, o = T.o
    // the root on the base edge, rotated with the body
    const lx = -half * 0.8 + (k + 0.5) / count * half * 1.6, ly = base
    const rx = A.x + lx * ca - ly * sa, ry = A.y + lx * sa + ly * ca
    const dnx = -sa, dny = ca // the body's down direction
    if (!T.init || mo <= 0.02 || !isFinite(p[0])) {
      for (let i = 0; i < TEND_M; i++) { p[i * 2] = rx + dnx * seg * i; p[i * 2 + 1] = ry + dny * seg * i; o[i * 2] = p[i * 2]; o[i * 2 + 1] = p[i * 2 + 1] }
      T.init = true
      if (mo <= 0.02) continue
    }
    p[0] = rx; p[1] = ry
    for (let i = 1; i < TEND_M; i++) {
      // inertia: keep most of last frame's motion, then hang at segment length from the point before
      const vx = (p[i * 2] - o[i * 2]) * damp, vy = (p[i * 2 + 1] - o[i * 2 + 1]) * damp
      o[i * 2] = p[i * 2]; o[i * 2 + 1] = p[i * 2 + 1]
      let x = p[i * 2] + vx, y = p[i * 2 + 1] + vy
      // a gentle pull toward hanging down from the body, so a resting thread settles straight
      x += (p[i * 2 - 2] + dnx * seg - x) * (0.12 * sdt * 60) * 0.5; y += (p[i * 2 - 1] + dny * seg - y) * (0.12 * sdt * 60) * 0.5
      let dx = x - p[i * 2 - 2], dy = y - p[i * 2 - 1]
      const d = Math.hypot(dx, dy) || 1e-6
      p[i * 2] = p[i * 2 - 2] + dx / d * seg; p[i * 2 + 1] = p[i * 2 - 1] + dy / d * seg
      if (!isFinite(p[i * 2]) || !isFinite(p[i * 2 + 1])) { T.init = false; break }
    }
  }
}
function drawTendrils(A, now) {
  if (!A.tend) return
  const z = view.cam.z, mo = motion()
  const spd = Math.hypot(A.vx, A.vy)
  const amp = (0.6 + Math.min(2.4, spd / 90)) * (A.tendK || 0), freq = 0.004 + Math.min(0.012, spd / 25000)
  g.save()
  g.strokeStyle = rgbaArr(rgb(A.tone), 0.3 * A.alpha); g.lineCap = 'round'; g.lineJoin = 'round'
  const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
  for (const T of A.tend) {
    const p = T.p
    if (!isFinite(p[0])) continue
    g.lineWidth = Math.max(0.6, 1.3 / Math.max(0.5, z))
    g.beginPath(); g.moveTo(p[0], p[1])
    for (let i = 1; i < TEND_M; i++) {
      // the travelling wave, across the thread's own direction, growing toward the tip
      const tx = p[i * 2] - p[i * 2 - 2], ty = p[i * 2 + 1] - p[i * 2 - 1], tl = Math.hypot(tx, ty) || 1
      const w = Math.sin(i * 0.9 - now * freq * mo + T.ph) * amp * (i / TEND_M) * mo
      g.lineTo(p[i * 2] - ty / tl * w, p[i * 2 + 1] + tx / tl * w)
    }
    g.stroke()
  }
  g.restore()
}

function swimStep(A, now, sdt) {
  const mo = motion()
  const insp = A.role === 'inspector'
  // an inspector darts about: a stiff, lightly damped spring (overshoot, quick turns) at a wandering goal
  const wob = insp ? 1 : 0
  const dx = A.gx + wob * Math.sin(now * 0.0023 + A.seed) * 22 - A.x, dy = A.gy + wob * Math.cos(now * 0.0031 + A.seed * 2) * 14 - A.y, d = Math.hypot(dx, dy) || 1
  const ux = dx / d, uy = dy / d
  if (!A.swim && !insp && d > 170 && mo > 0.02 && A.present) A.swim = { ph: 0, t: 0 }
  if (A.swim && (d < 70 || mo <= 0.02)) A.swim = null
  let k = insp ? 60 : 18, c = insp ? 2 * Math.sqrt(60) * 0.38 : 2 * Math.sqrt(18) * 1.05
  let tl = 0.8, ts = 1, tk = 0
  if (A.swim) {
    const S = A.swim, dur = S.ph === 0 ? 340 : S.ph === 1 ? 460 : 900
    S.t += sdt * 1000
    if (S.t > dur) {
      S.ph = (S.ph + 1) % 3; S.t = 0
      if (S.ph === 1) { const sp = Math.min(400, 110 + d * 0.55) * mo; A.vx += ux * sp; A.vy += uy * sp }
    }
    k = 1.5; c = S.ph === 2 ? 2.0 : S.ph === 1 ? 0.6 : 3
    tl = S.ph === 0 ? 0.45 : S.ph === 1 ? 1.05 : 0.85
    ts = S.ph === 0 ? 0.25 : S.ph === 1 ? 0.7 : 1
    tk = 1
  }
  A.swimK = ease(A.swimK, tk, tk ? 5 : 3, sdt)
  A.swimLen = ease(A.swimLen, tl, 6, sdt); A.swimSpread = ease(A.swimSpread, ts, 6, sdt)
  // the tentacles stream against the direction of travel
  const sp = Math.hypot(A.vx, A.vy)
  const bx = sp > 20 ? -A.vx / sp : -ux, by = sp > 20 ? -A.vy / sp : -uy
  A.swimDx = ease(A.swimDx, bx, 4, sdt); A.swimDy = ease(A.swimDy, by, 4, sdt)
  const dl = Math.hypot(A.swimDx, A.swimDy); if (dl > 1e-3) { A.swimDx /= dl; A.swimDy /= dl }
  const ax = dx * k - A.vx * c, ay = dy * k - A.vy * c
  const pvx = A.vx, pvy = A.vy
  A.vx += ax * sdt; A.vy += ay * sdt; A.x += A.vx * sdt; A.y += A.vy * sdt
  // the lean: forward into the travel (by the sideways speed and its change), overshooting a little and settling
  // upright when it stops; tiny velocities count as rest so nothing twitches
  const spd = Math.hypot(A.vx, A.vy), accx = (A.vx - pvx) / Math.max(1e-3, sdt)
  const want = spd < 12 ? 0 : clamp(A.vx / 520, -1, 1) * 0.32 + clamp(accx / 2600, -1, 1) * 0.12
  const wt = 6.5, zt = 0.55 + 0.25 * (1 - mo)
  A.tiltV = (A.tiltV || 0) + ((want - (A.tiltA || 0)) * wt * wt - 2 * zt * wt * (A.tiltV || 0)) * sdt
  A.tiltA = (A.tiltA || 0) + A.tiltV * sdt
  if (!isFinite(A.tiltA) || !isFinite(A.tiltV)) { A.tiltA = 0; A.tiltV = 0 }
  if (spd < 12 && Math.abs(A.tiltA) < 0.004 && Math.abs(A.tiltV) < 0.01) { A.tiltA = 0; A.tiltV = 0 }
  // the wake: a few small bubbles a second while it moves, from just behind the body
  if (spd > 20 && mo > 0.02 && bubbles.cap) {
    A.bubbleAcc = (A.bubbleAcc || 0) + Math.min(14, spd / 45) * sdt
    while (A.bubbleAcc >= 1 && bubbles.n < bubbles.cap) {
      A.bubbleAcc -= 1
      const i = bubbles.n++, bx = -A.vx / spd, by = -A.vy / spd
      bubbles.x[i] = A.x + bx * A.r * 0.9 + (Math.random() - 0.5) * A.r * 0.8; bubbles.y[i] = A.y + by * A.r * 0.9 + A.r * 0.4
      bubbles.r[i] = 1.2 + Math.random() * 1.6; bubbles.t[i] = 0; bubbles.life[i] = 1 + Math.random(); bubbles.ph[i] = Math.random() * 6.28
    }
  }
}

// the chain into the spine buffers, root first, scaled by extension, with a traveling wave (root to tip, growing
// toward the tip, nearly still across the rigid club)
function snakeSpine(L, st, now) {
  const C = L.flt || L.chain, M = L.M, N = M - 1
  const rx = C[M * 2 - 2], ry = C[M * 2 - 1]
  const wig = 3.2 * motion()
  const tf = L.tipFrom || 0, tk = Math.min(1, st * 2.5)
  const bxs = rx + (C[tf * 2] - rx) * st, bys = ry + (C[tf * 2 + 1] - ry) * st
  for (let i = 0; i <= N; i++) {
    const k = M - 1 - i
    if (k >= tf) { SP[i * 2] = rx + (C[k * 2] - rx) * st; SP[i * 2 + 1] = ry + (C[k * 2 + 1] - ry) * st }
    else { SP[i * 2] = bxs + (C[k * 2] - C[tf * 2]) * tk; SP[i * 2 + 1] = bys + (C[k * 2 + 1] - C[tf * 2 + 1]) * tk }
  }
  for (let i = 0; i <= N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N, i + 1)
    let tx = SP[b * 2] - SP[a * 2], ty = SP[b * 2 + 1] - SP[a * 2 + 1]
    const l = Math.hypot(tx, ty)
    if (l < 1e-6) { tx = 1; ty = 0 } else { tx /= l; ty /= l }
    SN[i * 2] = -ty; SN[i * 2 + 1] = tx
  }
  if (wig > 0) for (let i = 1; i < N; i++) {
    const t = i / N
    const club = 1 - 0.75 * smooth((t - 0.7) / 0.12)
    // the wave lives in the loose middle: nothing at the root, little across the composed tip
    const env = Math.pow(Math.sin(Math.PI * clamp((t - 0.12) / 0.8, 0, 1)), 1.3)
    const w = Math.sin(t * 7 - now * 0.0035 + L.seed) * wig * 1.3 * env * club
    SP[i * 2] += SN[i * 2] * w; SP[i * 2 + 1] += SN[i * 2 + 1] * w
  }
  // a smoothing pass over the spine so the taper never kinks, then fresh normals
  let px = SP[0], py = SP[1]
  for (let i = 1; i < N; i++) {
    const cx = SP[i * 2], cy = SP[i * 2 + 1]
    SP[i * 2] = px * 0.25 + cx * 0.5 + SP[i * 2 + 2] * 0.25; SP[i * 2 + 1] = py * 0.25 + cy * 0.5 + SP[i * 2 + 3] * 0.25
    px = cx; py = cy
  }
  for (let i = 0; i <= N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N, i + 1)
    let tx = SP[b * 2] - SP[a * 2], ty = SP[b * 2 + 1] - SP[a * 2 + 1]
    const l = Math.hypot(tx, ty)
    if (l < 1e-6) { tx = 1; ty = 0 } else { tx /= l; ty /= l }
    SN[i * 2] = -ty; SN[i * 2 + 1] = tx
  }
  return N
}

// ---------- camera ----------

function cameraFollow(dt, now) {
  const user = now < view.userUntil
  const cam = view.cam
  if (!user) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false
    const add = (x, y, m) => { if (!isFinite(x) || !isFinite(y)) return; x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m); any = true }
    // while limbs are working, follow the work; otherwise show the whole session so far
    let busy = false
    for (const L of vis.limbs.values()) if (L.ext > 0.05) { busy = true; add(L.tx, L.ty, 40) }
    for (const A of vis.actors.values()) if (A.present) {
      add(A.x, A.y, A.r * 3)
      const S = H.state.actors.get(A.id)
      if (busy && S) for (let i = Math.max(0, S.wake.length - 2); i < S.wake.length; i++) { const N = vis.nodes.get(S.wake[i].node); if (N && N.present) { add(N.x, N.y, 30); add(N.x + N.w, N.y + N.h, 30) } }
    }
    let nodes = 0
    for (const N of vis.nodes.values()) if (N.present) { nodes++; if (!busy) { add(N.x, N.y, 10); add(N.x + N.w, N.y + N.h, 10) } }
    if (!busy && pack.init && nodes) { add(pack.cx - pack.outerR, pack.cy - pack.outerR, 0); add(pack.cx + pack.outerR, pack.cy + pack.outerR, 0) }
    // the map going from empty to populated (a fresh tab, a server restart) frames immediately
    if (nodes > 0 && !view.hadNodes) view.framed = false
    view.hadNodes = nodes > 0
    if (any) {
      view.fbox = [x0, y0, x1, y1]
      const bw = Math.max(240, x1 - x0 + 160), bh = Math.max(200, y1 - y0 + 160 + BAR_H)
      const z = clamp(Math.min(view.w / bw, view.h / bh), busy ? 0.45 : 0.12, 1.15)
      cam.tx = (x0 + x1) / 2; cam.ty = (y0 + y1) / 2 + BAR_H / 2 / z; cam.tz = z
      // the first framing is immediate: open on the overview, not a pan in from nowhere
      if (!view.framed) { view.framed = true; cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz }
    }
  }
  if (!isFinite(cam.tx) || !isFinite(cam.ty) || !isFinite(cam.tz)) { cam.tx = 0; cam.ty = 0; cam.tz = 1; view.framed = false }
  if (!isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.z)) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz }
  const rate = user ? 12 : 1.6
  cam.x = ease(cam.x, cam.tx, rate, dt); cam.y = ease(cam.y, cam.ty, rate, dt)
  cam.z = Math.exp(ease(Math.log(cam.z), Math.log(cam.tz), user ? 12 : 1.2, dt))
}

function toWorld(sx, sy) { const c = view.cam; return [(sx - view.w / 2) / c.z + c.x, (sy - view.h / 2) / c.z + c.y] }

// ---------- drawing ----------

const canvas = document.getElementById('c')
const ctx = canvas.getContext('2d', { alpha: false })
const tipEl = document.getElementById('tip')
let g = ctx

function resize() {
  const dprCap = Q() === 0 ? 1 : Q() === 1 ? 1.5 : 2
  view.dpr = Math.min(window.devicePixelRatio || 1, dprCap)
  if (window.innerWidth < 2 || window.innerHeight < 2) return // collapsed or hidden: keep the last real size
  if (view.w < 2 || view.h < 2) view.framed = false // the first real size gets an immediate framing
  view.w = window.innerWidth; view.h = window.innerHeight
  canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr)
  cardCache.clear()
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r)
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r)
}

function drawIcon(gg, kind, x, y, size, col) {
  const p = ICONS[kind] || ICONS.class
  gg.save(); gg.translate(x, y); gg.scale(size / 20, size / 20)
  gg.strokeStyle = col || BONE; gg.lineWidth = 1.3; gg.lineJoin = 'round'; gg.lineCap = 'round'
  gg.stroke(p); gg.restore()
}

function drawSun(gg, x, y, r, col) {
  gg.strokeStyle = col; gg.fillStyle = col; gg.lineWidth = 0.9
  gg.beginPath(); gg.arc(x, y, r, 0, Math.PI * 2); gg.stroke()
  gg.beginPath(); gg.arc(x, y, r * 0.35, 0, Math.PI * 2); gg.fill()
  gg.beginPath()
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; gg.moveTo(x + Math.cos(a) * (r + 1.2), y + Math.sin(a) * (r + 1.2)); gg.lineTo(x + Math.cos(a) * (r + 2.4), y + Math.sin(a) * (r + 2.4)) }
  gg.stroke()
}

// ----- background -----

function drawBackground() {
  const c = view.cam
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  g.fillStyle = VOID; g.fillRect(0, 0, view.w, view.h)
  if (c.z < 0.3) return
  const step = 80, z = c.z
  const wx0 = c.x - view.w / 2 / z, wy0 = c.y - view.h / 2 / z
  const x0 = Math.floor(wx0 / step) * step, y0 = Math.floor(wy0 / step) * step
  g.strokeStyle = 'rgba(220,210,176,0.035)'; g.lineWidth = 1
  g.beginPath()
  for (let x = x0; x < wx0 + view.w / z + step; x += step) { const sx = Math.round((x - c.x) * z + view.w / 2) + 0.5; g.moveTo(sx, 0); g.lineTo(sx, view.h) }
  for (let y = y0; y < wy0 + view.h / z + step; y += step) { const sy = Math.round((y - c.y) * z + view.h / 2) + 0.5; g.moveTo(0, sy); g.lineTo(view.w, sy) }
  g.stroke()
}

function worldTransform() {
  const c = view.cam
  g.setTransform(view.dpr * c.z, 0, 0, view.dpr * c.z, view.dpr * (view.w / 2 - c.x * c.z), view.dpr * (view.h / 2 - c.y * c.z))
}

const cull = { x0: 0, y0: 0, x1: 0, y1: 0 }
function inView(x, y, w, h) { return x + w >= cull.x0 && x <= cull.x1 && y + h >= cull.y0 && y <= cull.y1 }

// ----- wards -----

function drawWards(now) {
  const z = view.cam.z, q = Q()
  for (const arc of pack.arcs) {
    const W = vis.wards.get(arc.folder)
    if (!W || W.alpha < 0.02 || !inView(W.x, W.y, W.w, W.h)) continue
    const act = W.active, a = W.alpha, c = W.c
    const ph = pack.phase[arc.k] || 0
    const a0 = arc.a0 + ph, a1 = arc.a1 + ph, ro = arc.r + arc.h / 2 + 16, ri = Math.max(10, arc.r - arc.h / 2 - 16)
    // a thin dotted arc along the ring just outside the ward's tomes, a little brighter while it is worked in
    g.setLineDash(DASH_WARD); g.lineWidth = Math.max(0.8, 0.9 / z)
    g.strokeStyle = rgbaArr(c, (0.28 + 0.4 * act) * a)
    g.beginPath(); g.ellipse(pack.cx, pack.cy, ro, ro * tilt.cos, 0, a0, a1); g.stroke()
    g.setLineDash(EMPTY_DASH)
    // a ward holding an edit: its outer edge wobbles, fleshy
    if (W.wob > 0.02 && motion() > 0.02) {
      const amp = 3.5 * W.wob, steps = Math.max(12, Math.round((a1 - a0) * ro / 14))
      g.strokeStyle = rgbaArr(c, 0.6 * W.wob * a); g.lineWidth = Math.max(1.4, 1.6 / z)
      g.beginPath()
      for (let s = 0; s <= steps; s++) { const t = a0 + (a1 - a0) * s / steps, d = ro * t; const off = amp * (Math.sin(d * 0.06 - now * 0.004) + 0.5 * Math.sin(d * 0.15 + now * 0.007)); const r = ro + off; const x = pack.cx + Math.cos(t) * r, y = pack.cy + Math.sin(t) * r * tilt.cos; if (s) g.lineTo(x, y); else g.moveTo(x, y) }
      g.stroke()
    }
    if ((W.zap || 0) > 0.02 && motion() > 0.02) {
      // electricity along the band's outer edge: short jagged arcs jumping about
      const tick = Math.floor(now / 70), span = a1 - a0
      for (let k = 0; k < 4; k++) {
        const s0 = a0 + rnd(arc.folder + k, tick) * span, len = Math.min(span, (18 + rnd(arc.folder + k, tick + 5) * 30) / ro)
        for (let pass = 0; pass < 2; pass++) {
          g.strokeStyle = pass ? rgba('#F6F2E4', 0.8 * W.zap) : rgba(W.zapCol || EMBER, 0.75 * W.zap); g.lineWidth = pass ? Math.max(0.7, 0.8 / z) : Math.max(1.5, 2 / z)
          g.beginPath()
          for (let s = 0; s <= 6; s++) { const t = s0 + len * s / 6, off = s === 0 || s === 6 ? 0 : (rnd(arc.folder + k * 9 + s, tick) - 0.5) * 8 * W.zap; const r = ro + off; const x = pack.cx + Math.cos(t) * r, y = pack.cy + Math.sin(t) * r * tilt.cos; if (s) g.lineTo(x, y); else g.moveTo(x, y) }
          g.stroke()
        }
      }
    }
    // the name, upright, just outside the band at the arc's middle
    const am = (a0 + a1) / 2
    const fs = clamp(11 / Math.sqrt(z), 11, 24)
    g.font = '600 ' + fs.toFixed(1) + 'px ' + FONT
    const name = clip(W.short || W.name.split('/').pop() || W.name, 26)
    const tw = g.measureText(name).width
    const outward = Math.sin(am) >= 0 ? 1 : -1 // below the hub the label hangs under the arc, above it sits on top
    // the name sits just outside the arc, stepping further out while it would cover a card
    let lr = ro + 12, tx = 0, ty = 0
    for (let step = 0; step < 4; step++) {
      const lx = pack.cx + Math.cos(am) * lr, ly = pack.cy + Math.sin(am) * lr * tilt.cos
      tx = lx - tw / 2; ty = ly + (outward > 0 ? fs * 0.2 : -fs * 1.2)
      let hit = false
      for (const N of vis.nodes.values()) { if (!N.present || N.alpha < 0.3 || N.pile > 0.5) continue; if (tx - 6 < N.x + N.w && tx + tw + 6 > N.x && ty < N.y + N.h && ty + fs * 1.4 > N.y) { hit = true; break } }
      if (!hit) break
      lr += fs * 1.8
    }
    g.fillStyle = VOID; g.fillRect(tx - 6, ty, tw + 12, fs * 1.4)
    W.labX = tx - 6; W.labY = ty; W.labW = tw + 12; W.labH = fs * 1.4
    g.fillStyle = rgbaArr(c, (0.75 + 0.25 * act) * a)
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(name, tx, ty + fs * 0.7)
  }
}
const DASH_WARD = [2, 6]


// ----- bindings -----

const rt = new Float64Array(8) // the spline of the connection being drawn: p0, c1, c2, p1
// Connections are drawn per visible endpoint pair: all bindings between the same two visible things (a card, or
// the pile a folded tome sits in) merge into one thicker connection with an arrowhead per direction. Every
// connection attaches on the border of what it joins, on the side facing its other end, and the attachments on
// one side are spread along it so they never stack.
// Highways: connections that start and end in the same neighbourhoods share a lane-spaced trunk; trunks heading
// the same way from the same region merge into a bigger highway (a second, coarser level) and split off near
// their ends. Trunks are nudged out of tome cards. Recomputed only while the layout moves, cached otherwise.
const bundles = new Map(), highways = new Map(), merged = new Map(), sides = new Map()
let bundleAt = -1e9
const ra = [0, 0, 0, 0], rb = [0, 0, 0, 0]
// the visible thing a tome's bindings attach to: its card, or its folder's pile while it is folded
function endRect(V, out) {
  const P = V.pileOf ? vis.piles.get(V.pileOf) : null
  if (P && P.n >= 2) { out[0] = P.x; out[1] = P.y - 6; out[2] = 70; out[3] = 30; return 'pile:' + V.pileOf }
  drawnRect(V, out); return V.id
}
// the frame of a card as this frame draws it: shaken by an edit, scaled about its centre by depth and hub size
// (the same formulas as drawTomes), so a connection lands on the border that is actually on the sheet
function drawnRect(V, out) {
  const now = endNow, shk = (V.shake || 0) > 0.02 ? V.shake : 0
  const x = V.x + Math.sin(now * 0.11) * 3 * shk, y = V.y + Math.cos(now * 0.13) * 2 * shk, w = V.w, h = V.h
  const depthSpan = Math.max(500, pack.outerR * 1.1)
  const dk = pack.init ? clamp(1 + (y + h / 2 - pack.cy) / depthSpan * 0.2, 0.78, 1.14) : 1
  const sc = V.scale * dk * (V.hub ? HUB_SCALE : 1)
  out[0] = x + w / 2 - w * sc / 2; out[1] = y + h / 2 - h * sc / 2; out[2] = w * sc; out[3] = h * sc
}
let endNow = 0
// the attachment point on a side: the o-th of k along it, spread from the middle
function endPoint(r, side, o, k) {
  const len = side & 1 ? r[2] : r[3]
  const sp = Math.min(16, len * 0.8 / Math.max(1, k)), off = (o - (k - 1) / 2) * sp
  if (side === 0) { ptmp[0] = r[0] + r[2]; ptmp[1] = r[1] + r[3] / 2 + off }
  else if (side === 2) { ptmp[0] = r[0]; ptmp[1] = r[1] + r[3] / 2 + off }
  else if (side === 1) { ptmp[0] = r[0] + r[2] / 2 + off; ptmp[1] = r[1] + r[3] }
  else { ptmp[0] = r[0] + r[2] / 2 + off; ptmp[1] = r[1] }
}
// every frame: the ends follow the frames as drawn right now (the sides and their order come from the last rebundle)
function placeEnds() {
  for (const Mg of merged.values()) {
    if (Mg.sa === undefined || !Mg.a || !Mg.b) continue
    endRect(Mg.a, Mg.ra); endRect(Mg.b, Mg.rb)
    endPoint(Mg.ra, Mg.sa, Mg.ia || 0, Mg.ka || 1); Mg.p0x = ptmp[0]; Mg.p0y = ptmp[1]
    endPoint(Mg.rb, Mg.sb, Mg.ib || 0, Mg.kb || 1); Mg.p1x = ptmp[0]; Mg.p1y = ptmp[1]
  }
}
function cellOfR(N, r, size) { return (N.pileOf ? 'ward:' + N.folder : (N.group || ('ward:' + N.folder))) + '|' + Math.round((r[0] + r[2] / 2) / size) + ',' + Math.round((r[1] + r[3] / 2) / size) }
function coarseR(r, size) { return Math.round((r[0] + r[2] / 2) / size) + ',' + Math.round((r[1] + r[3] / 2) / size) }
function clearOfTomes(x, y) {
  // push a trunk point out of any card it falls on (with a margin), along the shortest way out
  for (let it = 0; it < 3; it++) {
    let moved = false
    for (const N of vis.nodes.values()) {
      if (!N.present || N.alpha < 0.3 || N.pileOf || !isFinite(N.x) || !isFinite(N.y)) continue
      const m = 18
      if (x < N.x - m || x > N.x + N.w + m || y < N.y - m || y > N.y + N.h + m) continue
      const dl = x - (N.x - m), dr = (N.x + N.w + m) - x, du = y - (N.y - m), dd = (N.y + N.h + m) - y
      const mn = Math.min(dl, dr, du, dd)
      if (mn === dl) x -= mn + 1; else if (mn === dr) x += mn + 1; else if (mn === du) y -= mn + 1; else y += mn + 1
      moved = true
    }
    if (!moved) break
  }
  ptmp[0] = x; ptmp[1] = y
}
// which side of a rect faces a point: 0 right, 1 bottom, 2 left, 3 top
function sideFor(r, ox, oy) {
  const dx = ox - (r[0] + r[2] / 2), dy = oy - (r[1] + r[3] / 2)
  if (Math.abs(dx) * (r[3] / 2 + 16) > Math.abs(dy) * (r[2] / 2 + 16)) return dx > 0 ? 0 : 2
  return dy > 0 ? 1 : 3
}
const SIDE_NX = [1, 0, -1, 0], SIDE_NY = [0, 1, 0, -1]
function rebundle() {
  bundles.clear(); highways.clear(); sides.clear()
  for (const Mg of merged.values()) { Mg.n = 0; Mg.list.length = 0 }
  for (const E of vis.edges.values()) {
    if (E.alpha < 0.02) continue
    const A = E.a, B = E.b
    if (!isFinite(A.x) || !isFinite(B.x)) continue
    const ia = endRect(A, ra), ib = endRect(B, rb)
    if (ia === ib) continue
    const flip = ia > ib
    const key = flip ? ib + '\x01' + ia : ia + '\x01' + ib
    let Mg = merged.get(key)
    if (!Mg) { Mg = { key, list: [], ra: [0, 0, 0, 0], rb: [0, 0, 0, 0], n: 0, seed: hash(key) % 997, bundle: null, lane: 0 }; merged.set(key, Mg) }
    if (!Mg.n) {
      const sa = flip ? rb : ra, sb = flip ? ra : rb
      for (let k = 0; k < 4; k++) { Mg.ra[k] = sa[k]; Mg.rb[k] = sb[k] }
      Mg.a = flip ? B : A; Mg.b = flip ? A : B
      Mg.fwd = false; Mg.back = false; Mg.alpha = 0; Mg.glow = 0; Mg.prog = 0; Mg.pend = 0; Mg.dying = 1; Mg.cross = false; Mg.fresh = false
    }
    Mg.n++; Mg.list.push(E)
    if (flip) Mg.back = true; else Mg.fwd = true
    Mg.alpha = Math.max(Mg.alpha, E.alpha); Mg.glow = Math.max(Mg.glow, E.glow); Mg.prog = Math.max(Mg.prog, E.prog)
    Mg.pend = Math.max(Mg.pend, E.pend); Mg.dying = Math.min(Mg.dying, E.dying)
    if (E.cross) Mg.cross = true
    if (E.fresh && E.pend < 0.5 && E.dying < 0.5) Mg.fresh = true
  }
  for (const [k, Mg] of merged) {
    if (!Mg.n) { merged.delete(k); continue }
    Mg.fade = Math.min(visOf(Mg.a), visOf(Mg.b))
    // between two collapsed things (piles, folded tomes) a connection is always faint
    const qa = Mg.a.pileOf || Mg.a.tFold, qb = Mg.b.pileOf || Mg.b.tFold
    if (qa && qb) Mg.fade = Math.min(Mg.fade, 0.25)
  }
  // bundles: connections running the same way are gathered greedily into shared trunks by compatibility (angle,
  // overlapping span along the direction, midpoints near one another), the longest first so trunks follow the
  // big cables; deterministic (sorted by key), so the same map always bundles the same way
  const list = []
  for (const Mg of merged.values()) {
    const ax = Mg.ra[0] + Mg.ra[2] / 2, ay = Mg.ra[1] + Mg.ra[3] / 2, bx = Mg.rb[0] + Mg.rb[2] / 2, by = Mg.rb[1] + Mg.rb[3] / 2
    let dx = bx - ax, dy = by - ay
    // a canonical direction (pointing right, or down when vertical), so opposite strands share a trunk
    Mg.flipDir = dx < 0 || (dx === 0 && dy < 0)
    if (Mg.flipDir) { dx = -dx; dy = -dy }
    const len = Math.hypot(dx, dy) || 1
    Mg.ux = dx / len; Mg.uy = dy / len; Mg.len = len; Mg.mx = (ax + bx) / 2; Mg.my = (ay + by) / 2
    Mg.bundle = null
    list.push(Mg)
  }
  list.sort((p, q) => (q.len - p.len) || (p.key < q.key ? -1 : 1))
  const bl = []
  for (const Mg of list) {
    let best = null, bs = 0.45
    for (const b of bl) {
      const cosA = Mg.ux * b.ux + Mg.uy * b.uy
      if (cosA < 0.8) continue // within about 37 degrees
      // overlap of the spans along the trunk direction, and the distance between midpoints
      const pm = (Mg.mx - b.mx) * b.ux + (Mg.my - b.my) * b.uy, half = Math.min(Mg.len, b.len) / 2
      const ov = Math.max(0, Math.min(Mg.len, b.len) - Math.abs(pm)) / Math.max(1, Math.min(Mg.len, b.len))
      const side = Math.abs((Mg.mx - b.mx) * -b.uy + (Mg.my - b.my) * b.ux)
      const sc = Math.min(Mg.len, b.len) / Math.max(Mg.len, b.len)
      const score = cosA * ov * (1 - Math.min(1, side / Math.max(140, half * 0.9))) * (0.5 + 0.5 * sc)
      if (score > bs) { bs = score; best = b }
    }
    if (!best) { best = { n: 0, ux: Mg.ux, uy: Mg.uy, mx: Mg.mx, my: Mg.my, len: Mg.len, members: [], lanes: 0, sx: 0, sy: 0, ex: 0, ey: 0 }; bl.push(best) }
    best.members.push(Mg); best.n++; Mg.bundle = best; Mg.lane = best.lanes++
    // the trunk follows the running mean of its members (weighted toward the long ones)
    const w = Mg.len / (best.len * best.n + Mg.len)
    best.ux += (Mg.ux - best.ux) * w; best.uy += (Mg.uy - best.uy) * w
    const ul = Math.hypot(best.ux, best.uy) || 1; best.ux /= ul; best.uy /= ul
    best.mx += (Mg.mx - best.mx) * w; best.my += (Mg.my - best.my) * w
    best.len = Math.max(best.len, Mg.len)
  }
  bundles.clear()
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i]
    bundles.set(String(i), b)
    // the trunk's span: from the earliest member start to the latest end along its direction
    let lo = 1e9, hi = -1e9, fadeMax = 0
    for (const Mg of b.members) {
      const p = (Mg.mx - b.mx) * b.ux + (Mg.my - b.my) * b.uy
      lo = Math.min(lo, p - Mg.len / 2); hi = Math.max(hi, p + Mg.len / 2)
      fadeMax = Math.max(fadeMax, Mg.fade || 0)
    }
    b.fadeMax = fadeMax
    b.sx = b.mx + b.ux * lo; b.sy = b.my + b.uy * lo; b.ex = b.mx + b.ux * hi; b.ey = b.my + b.uy * hi
    // the trunk's two knots (where the strands are cinched), kept out of the cards
    clearOfTomes(b.sx + (b.ex - b.sx) * 0.32, b.sy + (b.ey - b.sy) * 0.32); b.m1x = ptmp[0]; b.m1y = ptmp[1]
    clearOfTomes(b.sx + (b.ex - b.sx) * 0.68, b.sy + (b.ey - b.sy) * 0.68); b.m2x = ptmp[0]; b.m2y = ptmp[1]
    const tx = b.m2x - b.m1x, ty = b.m2y - b.m1y, tl = Math.hypot(tx, ty) || 1
    b.nx = -ty / tl; b.ny = tx / tl
    // lanes: as wide as the strands they carry, 1.2 px apart, centred on the trunk
    let tot = 0
    for (const Mg of b.members) tot += widthOf(Mg) + 1.2
    let at = -tot / 2
    for (const Mg of b.members) { const w = widthOf(Mg) + 1.2; Mg.laneOff = at + w / 2; at += w }
    b.width = tot
  }
  // attachments: each end picks the side facing the way the connection leaves (the trunk when bundled, else the
  // other end), then the attachments sharing a side are spread along it in the order of where they go
  for (const Mg of merged.values()) {
    const b = Mg.bundle, bund = b && b.n > 1
    // each end leaves toward the knot nearer to it (the trunk's direction is canonical, so either may be nearer)
    const acx = Mg.ra[0] + Mg.ra[2] / 2, acy = Mg.ra[1] + Mg.ra[3] / 2, bcx = Mg.rb[0] + Mg.rb[2] / 2, bcy = Mg.rb[1] + Mg.rb[3] / 2
    const aNear1 = !bund || Math.hypot(acx - b.m1x, acy - b.m1y) <= Math.hypot(acx - b.m2x, acy - b.m2y)
    const ax = bund ? (aNear1 ? b.m1x : b.m2x) : bcx, ay = bund ? (aNear1 ? b.m1y : b.m2y) : bcy
    const bx = bund ? (aNear1 ? b.m2x : b.m1x) : acx, by = bund ? (aNear1 ? b.m2y : b.m1y) : acy
    Mg.sa = sideFor(Mg.ra, ax, ay); Mg.sb = sideFor(Mg.rb, bx, by)
    Mg.oa = Mg.sa & 1 ? ax : ay; Mg.ob = Mg.sb & 1 ? bx : by
    const cut = Mg.key.indexOf('\x01')
    const ka = Mg.key.slice(0, cut) + ':' + Mg.sa, kb = Mg.key.slice(cut + 1) + ':' + Mg.sb
    let la = sides.get(ka); if (!la) { la = []; sides.set(ka, la) }; la.push(Mg, 0)
    let lb = sides.get(kb); if (!lb) { lb = []; sides.set(kb, lb) }; lb.push(Mg, 1)
  }
  for (const l of sides.values()) {
    const k = l.length / 2
    if (k > 1) {
      // sort pairs by where the connection heads, so the attachments do not cross
      const idx = []; for (let i = 0; i < k; i++) idx.push(i)
      idx.sort((i, j) => (l[i * 2 + 1] ? l[i * 2].ob : l[i * 2].oa) - (l[j * 2 + 1] ? l[j * 2].ob : l[j * 2].oa))
      for (let o = 0; o < k; o++) { const i = idx[o], Mg = l[i * 2]; if (l[i * 2 + 1]) Mg.ib = o; else Mg.ia = o }
    } else { const Mg = l[0]; if (l[1]) Mg.ib = 0; else Mg.ia = 0 }
    for (let i = 0; i < k; i++) {
      const Mg = l[i * 2], end = l[i * 2 + 1]
      if (end) Mg.kb = k; else Mg.ka = k
    }
  }
  placeEnds()
}
function routeEdge(Mg) {
  const p0x = Mg.p0x, p0y = Mg.p0y, p1x = Mg.p1x, p1y = Mg.p1y
  const L = Math.hypot(p1x - p0x, p1y - p0y) || 1
  // the curve leaves and arrives square to the borders
  const k = clamp(L * 0.35, 14, 110)
  let c1x = p0x + SIDE_NX[Mg.sa] * k, c1y = p0y + SIDE_NY[Mg.sa] * k
  let c2x = p1x + SIDE_NX[Mg.sb] * k, c2y = p1y + SIDE_NY[Mg.sb] * k
  // bundled: the middle runs along the trunk in its own lane between the two knots, cinched tightly; a live,
  // new or pending strand peels out a little so it stays readable; the pull eases in time so a strand that
  // changes bundle glides over rather than jumps
  const b = Mg.bundle
  if (b && b.n > 1) {
    const lane = Mg.laneOff || 0
    let m1x = b.m1x + b.nx * lane, m1y = b.m1y + b.ny * lane, m2x = b.m2x + b.nx * lane, m2y = b.m2y + b.ny * lane
    // the knot nearer this strand's start comes first
    if (Math.hypot(p0x - m1x, p0y - m1y) > Math.hypot(p0x - m2x, p0y - m2y)) { const tx = m1x, ty = m1y; m1x = m2x; m1y = m2y; m2x = tx; m2y = ty }
    const kk = Mg.hot ? 0.78 : 0.96
    c1x += (m1x - c1x) * kk; c1y += (m1y - c1y) * kk; c2x += (m2x - c2x) * kk; c2y += (m2y - c2y) * kk
  }
  if (Mg.c1x === undefined || !isFinite(Mg.c1x) || Math.hypot(Mg.c1x - c1x, Mg.c1y - c1y) > 400) { Mg.c1x = c1x; Mg.c1y = c1y; Mg.c2x = c2x; Mg.c2y = c2y }
  else { const ke = 1 - Math.exp(-7 * frameDt); Mg.c1x += (c1x - Mg.c1x) * ke; Mg.c1y += (c1y - Mg.c1y) * ke; Mg.c2x += (c2x - Mg.c2x) * ke; Mg.c2y += (c2y - Mg.c2y) * ke }
  c1x = Mg.c1x; c1y = Mg.c1y; c2x = Mg.c2x; c2y = Mg.c2y
  rt[0] = p0x; rt[1] = p0y; rt[2] = c1x; rt[3] = c1y; rt[4] = c2x; rt[5] = c2y; rt[6] = p1x; rt[7] = p1y
  return (L + Math.hypot(c1x - p0x, c1y - p0y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(p1x - c2x, p1y - c2y)) / 2
}

function tracePath() { g.moveTo(rt[0], rt[1]); g.bezierCurveTo(rt[2], rt[3], rt[4], rt[5], rt[6], rt[7]) }

// point at fraction u along the spline
function routePoint(u, len, out) {
  const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u
  out[0] = rt[0] * a + rt[2] * b + rt[4] * c + rt[6] * d
  out[1] = rt[1] * a + rt[3] * b + rt[5] * c + rt[7] * d
}

// a small arrowhead with its point on the border at (x, y), coming from (fx, fy)
function arrowAt(x, y, fx, fy, col, a, s) {
  const dx = x - fx, dy = y - fy, d = Math.hypot(dx, dy) || 1
  const ux = dx / d, uy = dy / d
  g.fillStyle = rgba(col, a)
  g.beginPath(); g.moveTo(x, y); g.lineTo(x - ux * s * 1.8 - uy * s, y - uy * s * 1.8 + ux * s); g.lineTo(x - ux * s * 1.8 + uy * s, y - uy * s * 1.8 - ux * s); g.fill()
}
function arrows(Mg, col, a) {
  const s = 4 + Math.min(2.5, Mg.n * 0.4)
  if (Mg.fwd) arrowAt(rt[6], rt[7], rt[4], rt[5], col, a, s)
  if (Mg.back) arrowAt(rt[0], rt[1], rt[2], rt[3], col, a, s)
}
// a connection's width grows slowly with the bindings it carries, to a low ceiling
function widthOf(Mg) { return Math.min(3, 1 + 0.9 * Math.log2(Mg.n)) }
// how visible a connection's end is: a piled tome's pile is dim, a folded or faded card dims too
function visOf(V) { return V.pileOf ? 0.4 : (V.dim === undefined ? 1 : V.dim) * (V.tFold ? 0.7 : 1) }
const FADE_LV = [1, 0.5, 0.28], EDGE_DIM = '#9A917A', EDGEX_DIM = '#A8976E'
function fadeInk(fb, cross) { return fb ? (cross ? EDGEX_DIM : EDGE_DIM) : (cross ? EDGEX : EDGE) }
// a connection whose ends sit on one spot (or whose attachments are unset) is skipped rather than drawn wrongly
function degenerate(Mg) { return !(Mg.p0x !== undefined && isFinite(Mg.p0x) && isFinite(Mg.p1x) && Math.hypot(Mg.p1x - Mg.p0x, Mg.p1y - Mg.p0y) > 2) }
function edgeInView(Mg) {
  const x0 = Math.min(Mg.ra[0], Mg.rb[0]), y0 = Math.min(Mg.ra[1], Mg.rb[1])
  return inView(x0, y0, Math.max(Mg.ra[0] + Mg.ra[2], Mg.rb[0] + Mg.rb[2]) - x0, Math.max(Mg.ra[1] + Mg.ra[3], Mg.rb[1] + Mg.rb[3]) - y0)
}

const DASH_PEND = [4, 6], DASH_GONE = [4, 4], dashDraw = [0, 0], ptmp = [0, 0], cold = []
let frameDt = 1 / 60
function drawEdges(now) {
  endNow = now
  if (layout.awake > 0 || now - bundleAt > 400 || !merged.size) { rebundle(); bundleAt = now }
  else placeEnds()
  const z = view.cam.z, q = Q(), mo = motion()
  const base = Math.max(1.2, 1.1 / z)
  g.lineCap = 'round'; g.lineJoin = 'round'
  // cold connections in batches (same folder or cross, by thickness)
  for (let pass = 0; pass < 24; pass++) {
    g.beginPath()
    cold.length = 0
    const cross = (pass & 4) !== 0, wb = pass & 3, fb = pass >> 3
    for (const Mg of merged.values()) {
      if (Mg.alpha < 0.02 || Mg.pend > 0.02 || Mg.dying > 0.02 || Mg.glow > 0.03 || Mg.prog < 0.995 || Mg.fresh || Mg === view.hoverEdge) continue
      if (cross !== Mg.cross || Math.min(3, Mg.n - 1) !== wb) continue
      if ((Mg.fade > 0.8 ? 0 : Mg.fade > 0.45 ? 1 : 2) !== fb) continue
      if (!edgeInView(Mg) || degenerate(Mg)) continue
      routeEdge(Mg); tracePath(); cold.push(Mg)
    }
    if (cold.length) {
      // the batch is as faded as its ends (three levels), and thinner when faded
      g.strokeStyle = rgba(fadeInk(fb, cross), FADE_LV[fb]); g.lineWidth = base * (cross ? 1.25 : 1) * widthOf({ n: wb + 1 }) * (0.6 + 0.4 * FADE_LV[fb]); g.stroke()
      for (const Mg of cold) { routeEdge(Mg); arrows(Mg, fadeInk(fb, cross), 0.9 * FADE_LV[fb]) }
    }
  }
  for (const Mg of merged.values()) {
    if (Mg.alpha < 0.02) continue
    const hov = Mg === view.hoverEdge
    const settledNew = Mg.fresh && Mg.pend < 0.02 && Mg.dying < 0.02 && Mg.glow < 0.03 && Mg.prog >= 0.995
    const hot = Mg.pend > 0.02 || Mg.dying > 0.02 || Mg.glow > 0.03 || Mg.prog < 0.995
    Mg.hot = hot
    if (!hot && !settledNew && !hov) continue
    if (!edgeInView(Mg) || degenerate(Mg)) continue
    const len = routeEdge(Mg)
    const col = Mg.cross ? CROSSC : NEWC
    // live, new and pending connections keep their emphasis; a settled one on quiet ends fades with them
    const a = Mg.alpha * (hot ? 1 : 0.4 + 0.6 * Mg.fade), wm = widthOf(Mg)
    if (hov) {
      g.beginPath(); tracePath()
      g.strokeStyle = rgba(BONE, 0.35 * a); g.lineWidth = base * wm * 2.6; g.stroke()
    }
    if (!hot) {
      const c = settledNew ? (Mg.cross ? '#B98B45' : '#5FA896') : (Mg.cross ? EDGEX : EDGE)
      // Claude's own bindings stay distinguishable forever
      g.beginPath(); tracePath()
      g.strokeStyle = settledNew ? rgba(c, 0.85 * a) : c; g.lineWidth = base * (Mg.cross ? 1.6 : 1.2) * wm; g.stroke()
      arrows(Mg, c, 0.85 * a)
      continue
    }
    const dying = Mg.dying
    if (dying > 0.02) {
      g.beginPath(); tracePath()
      g.setLineDash(DASH_GONE); g.lineDashOffset = -(now * 0.008 * mo) % 8
      g.strokeStyle = rgba(BLOOD, 0.85 * a * dying); g.lineWidth = base * 1.3 * wm; g.stroke()
      g.setLineDash(EMPTY_DASH)
      if (dying > 0.98) continue
    }
    if (Mg.pend > 0.02) {
      // a possibility, not yet real: dashed, ghostly, flickering
      const fl = 0.38 + 0.2 * Math.sin(now * 0.011 + Mg.seed) + 0.12 * Math.sin(now * 0.037 + Mg.seed * 2)
      g.beginPath(); tracePath()
      g.setLineDash(DASH_PEND); g.lineDashOffset = -(now * 0.02 * mo + Mg.seed) % 10
      g.strokeStyle = rgba(col, fl * a * Mg.pend); g.lineWidth = base * (Mg.cross ? 1.7 : 1.2) * wm; g.stroke()
      g.setLineDash(EMPTY_DASH)
      if (Mg.pend > 0.98) continue
    }
    const vis01 = 1 - Math.max(Mg.pend, dying)
    if (Mg.prog < 0.995 || Mg.glow > 0.03) {
      const prog = c01(Mg.prog)
      const drawOn = prog < 0.995
      if (drawOn) { dashDraw[0] = len + 2; dashDraw[1] = len + 2; g.setLineDash(dashDraw); g.lineDashOffset = (len + 2) * (1 - prog) }
      const glow = Mg.glow
      // soft halo, then the bright core
      if (q >= 1 && glow > 0.03) {
        g.beginPath(); tracePath()
        g.strokeStyle = rgba(col, (0.1 + 0.25 * glow) * a * vis01); g.lineWidth = base * (Mg.cross ? 8 : 5) * (0.5 + 0.5 * glow) * (0.6 + 0.4 * wm); g.stroke()
      }
      g.beginPath(); tracePath()
      g.save()
      if (q === 2 && glow > 0.05) { g.shadowColor = rgba(col, 0.9 * glow); g.shadowBlur = 14 * z }
      g.strokeStyle = rgba(col, (0.55 + 0.45 * glow) * a * vis01); g.lineWidth = base * (Mg.cross ? 2.4 : 1.7) * wm; g.stroke()
      g.restore()
      if (drawOn) g.setLineDash(EMPTY_DASH)
      else arrows(Mg, col, (0.6 + 0.4 * glow) * a * vis01)
      if (glow > 0.05) {
        // the connection points flare, and a spark runs the thread
        const fr = base * (2 + 1.5 * Math.sin(now * 0.004 * mo + Mg.seed)) * glow + base
        g.fillStyle = rgba(col, 0.7 * glow * a)
        g.beginPath(); g.arc(rt[0], rt[1], fr, 0, Math.PI * 2); g.fill()
        if (!drawOn) { g.beginPath(); g.arc(rt[6], rt[7], fr, 0, Math.PI * 2); g.fill() }
        if (q === 2 && mo > 0 && !drawOn) {
          const u = ((now * 0.00045 * mo) + Mg.seed * 0.001) % 1
          routePoint(u, len, ptmp)
          g.fillStyle = rgba(BONE, 0.9 * glow * a)
          g.beginPath(); g.arc(ptmp[0], ptmp[1], base * 1.6, 0, Math.PI * 2); g.fill()
        }
      }
    } else if (hov) {
      g.beginPath(); tracePath()
      g.strokeStyle = Mg.cross ? EDGEX : EDGE; g.lineWidth = base * (Mg.cross ? 1.5 : 1) * wm; g.stroke()
      arrows(Mg, Mg.cross ? EDGEX : EDGE, 0.9)
    }
  }
}

// the merged connection under the cursor, if any (within a few pixels of its spline)
function hoverEdge() {
  if (view.mx < 0 || view.my > view.h - BAR_H - 4 || !merged.size) return null
  const p = toWorld(view.mx, view.my), tol = 5 / view.cam.z + 2
  let best = null, bd = tol
  for (const Mg of merged.values()) {
    if (Mg.alpha < 0.3 || Mg.p0x === undefined) continue
    const x0 = Math.min(Mg.ra[0], Mg.rb[0]) - 60, y0 = Math.min(Mg.ra[1], Mg.rb[1]) - 60
    const x1 = Math.max(Mg.ra[0] + Mg.ra[2], Mg.rb[0] + Mg.rb[2]) + 60, y1 = Math.max(Mg.ra[1] + Mg.ra[3], Mg.rb[1] + Mg.rb[3]) + 60
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue
    const len = routeEdge(Mg)
    const steps = clamp(Math.round(len / 10), 6, 40)
    for (let i = 0; i <= steps; i++) {
      routePoint(i / steps, len, ptmp)
      const d = Math.hypot(ptmp[0] - p[0], ptmp[1] - p[1])
      if (d < bd) { bd = d; best = Mg }
    }
  }
  return best
}
function edgeTip(Mg) {
  const lines = [Mg.n + (Mg.n === 1 ? ' binding' : ' bindings')]
  const l = Mg.list
  for (let i = 0; i < Math.min(5, l.length); i++) lines.push(l[i].a.name + ' → ' + l[i].b.name)
  if (l.length > 5) lines.push('+' + (l.length - 5) + ' more')
  return lines.join('\n')
}

// ----- tomes -----

const cardCache = new Map()
function bucketOf(z) { return clamp(Math.round(Math.log2(z) * 2), -4, 3) }

function renderCard(V, bucket) {
  const s = Math.pow(2, bucket / 2) * view.dpr
  const w = V.tw, h = V.th, m = 8
  const c = document.createElement('canvas')
  c.width = Math.ceil((w + m * 2) * s); c.height = Math.ceil((h + m * 2) * s)
  const gg = c.getContext('2d')
  gg.scale(s, s); gg.translate(m, m)
  gg.fillStyle = 'rgba(0,0,0,0.4)'; gg.fillRect(4, 5, w, h)
  const leather = LEATHER[V.kind] || LEATHER.class
  gg.beginPath(); gg.roundRect(0, 0, w, h, 3); gg.fillStyle = leather; gg.fill()
  gg.fillStyle = PAGE; gg.fillRect(10, HEAD_H - 2, w - 14, h - HEAD_H - 2)
  gg.fillStyle = '#5A4A26'; gg.fillRect(0, 0, 6, h)
  gg.strokeStyle = BRASS; gg.lineWidth = 1.2; gg.beginPath(); gg.roundRect(0, 0, w, h, 3); gg.stroke()
  gg.fillStyle = BRASS; gg.fillRect(w - 5, 0, 5, 5); gg.fillRect(w - 5, h - 5, 5, 5)
  if (V.kind === 'interface' && h - HEAD_H > 40) {
    gg.strokeStyle = 'rgba(220,210,176,0.07)'; gg.lineWidth = 1
    gg.stroke(new Path2D(pentaPath(10 + (w - 14) / 2, HEAD_H - 2 + (h - HEAD_H - 2) / 2, Math.min(w - 14, h - HEAD_H) * 0.42, 0)))
  }
  drawIcon(gg, V.kind, 11, 5, 16, BONE)
  gg.textBaseline = 'middle'
  const ts = V.titleScale || 1
  gg.font = '600 ' + (12 * ts).toFixed(1) + 'px ' + FONT; gg.fillStyle = BONE
  // the title is truncated by measurement in the very font it is drawn with, and clipped to the card as a guard
  const full = V.short || V.name
  let title = full, tch = full.length
  while (tch > 5 && gg.measureText(title).width > w - 38) { tch--; title = clipMid(full, tch) }
  gg.save(); gg.beginPath(); gg.rect(0, 0, w, h); gg.clip()
  gg.fillText(title, 31, HEAD_H / 2)
  gg.restore()
  gg.font = '10.5px ' + MONO
  const maxCh = Math.max(3, Math.floor((w - 30) / 6.3))
  for (let i = 0; i < V.rows.length; i++) {
    const r = V.rows[i], y = HEAD_H + i * ROW_H + ROW_H / 2
    if (r.cb) { drawSun(gg, 18, y, 2.2, SULFUR); gg.fillStyle = SULFUR }
    else { gg.fillStyle = PARCH; gg.fillRect(17, y - 1, 2, 2) }
    gg.fillText(clip(r.name, maxCh), 25, y + 0.5)
  }
  if (V.more > 0) { gg.font = 'italic 10px ' + FONT; gg.fillStyle = ASH; gg.fillText('+' + V.more + ' more', 17, h - 8) }
  return { canvas: c, w, h, m, key: V.key, bucket, ts }
}

function cardFor(V, bucket) {
  let c = cardCache.get(V.id)
  // the bitmap must have been rendered at exactly this card size and title scale: it is never stretched to fit
  if (!c || c.key !== V.key || c.bucket !== bucket || c.w !== V.tw || c.h !== V.th || c.ts !== (V.titleScale || 1)) {
    if (cardCache.size > 900) cardCache.clear()
    c = renderCard(V, bucket); cardCache.set(V.id, c)
  }
  return c
}

function glowRect(x, y, w, h, col, a, z) {
  if (a < 0.02) return
  const q = Q()
  if (q === 2) {
    g.save(); g.shadowColor = rgba(col, Math.min(1, a * 1.6)); g.shadowBlur = 34 * z
    g.fillStyle = rgba(col, a * 0.55); g.beginPath(); roundRect(x - 2, y - 2, w + 4, h + 4, 5); g.fill(); g.restore()
  } else {
    g.fillStyle = rgba(col, a * 0.35); g.beginPath(); roundRect(x - 10, y - 10, w + 20, h + 20, 14); g.fill()
    g.fillStyle = rgba(col, a * 0.25); g.beginPath(); roundRect(x - 4, y - 4, w + 8, h + 8, 7); g.fill()
  }
}

const ICHOR = '#A8B23A'
function zapRect(x, y, w, h, now, seed, col, k, z, amp) {
  const per = 2 * (w + h), n = k > 0.5 ? 6 : 4
  const tick = Math.floor(now / 70)
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (let a = 0; a < n; a++) {
    const s0 = rnd(seed + a, tick) * per, len = 18 + rnd(seed + a, tick + 11) * 34
    const steps = 6
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? rgba('#F6F2E4', 0.85 * k) : rgba(col, 0.75 * k); g.lineWidth = pass ? Math.max(0.7, 0.8 / z) : Math.max(1.6, 2.2 / z)
      g.beginPath()
      for (let s = 0; s <= steps; s++) {
        let d = (s0 + len * s / steps) % per
        let px, py, nx, ny
        if (d < w) { px = x + d; py = y; nx = 0; ny = -1 }
        else if (d < w + h) { px = x + w; py = y + d - w; nx = 1; ny = 0 }
        else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h; nx = 0; ny = 1 }
        else { px = x; py = y + h - (d - 2 * w - h); nx = -1; ny = 0 }
        const off = (s === 0 || s === steps) ? 0 : (rnd(seed + a * 7 + s, tick) - 0.5) * 2 * amp * k
        if (s) g.lineTo(px + nx * off, py + ny * off); else g.moveTo(px, py)
      }
      g.stroke()
    }
  }
  // sparks
  g.fillStyle = rgba(col, 0.8 * k)
  for (let a = 0; a < 3; a++) { const d = rnd(seed + 40 + a, tick) * per; let px, py; if (d < w) { px = x + d; py = y } else if (d < w + h) { px = x + w; py = y + d - w } else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h } else { px = x; py = y + h - (d - 2 * w - h) }; const r = 1 + rnd(seed + 50 + a, tick) * 1.5; g.beginPath(); g.arc(px + (rnd(seed + 60 + a, tick) - 0.5) * 10, py + (rnd(seed + 70 + a, tick) - 0.5) * 10, r, 0, Math.PI * 2); g.fill() }
}
// an undulating rounded rectangle: low waves travelling round the perimeter, bulging outward a few px at most
function wobblePath(x, y, w, h, amp, now, seed) {
  const per = 2 * (w + h), n = Math.max(16, Math.round(per / 9))
  g.beginPath()
  for (let i = 0; i <= n; i++) {
    const d = per * i / n
    let px, py, nx, ny
    if (d < w) { px = x + d; py = y; nx = 0; ny = -1 }
    else if (d < w + h) { px = x + w; py = y + d - w; nx = 1; ny = 0 }
    else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h; nx = 0; ny = 1 }
    else { px = x; py = y + h - (d - 2 * w - h); nx = -1; ny = 0 }
    const off = amp * (0.55 + 0.45 * Math.sin(d * 0.07 - now * 0.0045 + seed) * Math.sin(d * 0.023 + now * 0.0021))
    if (i) g.lineTo(px + nx * off, py + ny * off); else g.moveTo(px + nx * off, py + ny * off)
  }
  g.closePath()
}
// ---------- drips: ichor oozing from edited tomes ----------
// A fixed pool. A droplet swells on the card's edge, stretches, lets go, falls with a little gravity and squash,
// then splats faintly and fades. Rate follows editing intensity; nothing with motion off.
const drips = { cap: 0, n: 0, x: null, y: null, vx: null, vy: null, r: null, t: null, ph: null, ex: null, ey: null, spawn: 0 }
function dripAlloc(cap) { drips.cap = cap; drips.n = 0; for (const k of ['x', 'y', 'vx', 'vy', 'r', 't', 'ph', 'ex', 'ey']) drips[k] = new Float32Array(Math.max(1, cap)) }
function syncDrips(dt) {
  const cap = Q() === 2 ? 60 : Q() === 1 ? 25 : 0
  if (drips.cap !== cap) dripAlloc(cap)
  const mo = motion()
  if (!cap || mo <= 0.02) { drips.n = 0; return }
  // a spatter burst from the tentacle's tip on each edit
  for (const V of vis.nodes.values()) {
    if (!V.spat || !V.present) continue
    V.spat = 0
    const act = focus.nodeEdit.get(V.id), L = act ? vis.limbs.get(act.id) : null
    const tx = L && L.flt ? L.flt[0] : V.x + V.w / 2, ty = L && L.flt ? L.flt[1] : V.y + V.h / 2
    for (let k = 0; k < 5 && drips.n < cap; k++) {
      const i = drips.n++, an = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 90
      drips.x[i] = tx; drips.y[i] = ty; drips.vx[i] = Math.cos(an) * sp; drips.vy[i] = Math.sin(an) * sp - 60; drips.r[i] = 1.4 + Math.random() * 1.6; drips.t[i] = 0; drips.ph[i] = 1; drips.ex[i] = 0; drips.ey[i] = 1
    }
  }
  for (const V of vis.nodes.values()) {
    if (!V.present || V.wob < 0.3 || V.alpha < 0.5 || V.pile > 0.5) continue
    if (Math.random() > V.wob * 1.6 * dt || drips.n >= cap) continue
    const i = drips.n++
    const side = Math.random()
    // from the bottom edge mostly, sometimes a side
    if (side < 0.7) { drips.x[i] = V.x + 8 + Math.random() * (V.w - 16); drips.y[i] = V.y + V.h; drips.ex[i] = 0; drips.ey[i] = 1 }
    else if (side < 0.85) { drips.x[i] = V.x + V.w; drips.y[i] = V.y + 10 + Math.random() * (V.h - 20); drips.ex[i] = 1; drips.ey[i] = 0 }
    else { drips.x[i] = V.x; drips.y[i] = V.y + 10 + Math.random() * (V.h - 20); drips.ex[i] = -1; drips.ey[i] = 0 }
    drips.r[i] = 2.2 + Math.random() * 2.6; drips.t[i] = 0; drips.ph[i] = 0; drips.vx[i] = 0; drips.vy[i] = 0
  }
  for (let i = 0; i < drips.n; i++) {
    drips.t[i] += dt * mo
    const t = drips.t[i]
    if (drips.ph[i] === 0) {
      // swelling on the edge, then letting go
      if (t > 0.7 + drips.r[i] * 0.1) { drips.ph[i] = 1; drips.t[i] = 0; drips.vx[i] = drips.ex[i] * 14; drips.vy[i] = 6 }
    } else if (drips.ph[i] === 1) {
      drips.vy[i] += 420 * dt * mo; drips.x[i] += drips.vx[i] * dt * mo; drips.y[i] += drips.vy[i] * dt * mo
      if (t > 0.5 + Math.random() * 0.05) { drips.ph[i] = 2; drips.t[i] = 0 }
    } else if (t > 0.5) {
      drips.n--; if (i < drips.n) { const j = drips.n; for (const k of ['x', 'y', 'vx', 'vy', 'r', 't', 'ph', 'ex', 'ey']) drips[k][i] = drips[k][j]; i-- }
    }
  }
}
function drawDrips() {
  if (!drips.n) return
  const z = view.cam.z
  g.save()
  for (let i = 0; i < drips.n; i++) {
    const x = drips.x[i], y = drips.y[i], r = drips.r[i], t = drips.t[i], ph = drips.ph[i]
    if (!inView(x - 12, y - 12, 24, 40)) continue
    let rx = r, ry = r, al = 0.85, cx = x, cy = y
    if (ph === 0) { const s = smooth(t / 0.7); rx = r * s; ry = r * s * (1 + 0.6 * s); cx = x + drips.ex[i] * rx * 0.5; cy = y + drips.ey[i] * ry * 0.6 }
    else if (ph === 1) { const sp = clamp(drips.vy[i] / 120, -0.6, 1); rx = r * (1 - 0.3 * sp); ry = r * (1 + 0.8 * sp) }
    else { const s = smooth(t / 0.5); rx = r * (1 + 1.6 * s); ry = r * (0.5 - 0.4 * s) + 0.3; al = 0.85 * (1 - s) }
    rx = Math.max(0.2, rx); ry = Math.max(0.2, ry)
    g.fillStyle = rgba(ICHOR, 0.55 * al); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = rgba(EMBER, 0.35 * al); g.beginPath(); g.ellipse(cx, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2); g.fill()
    if (ph !== 2) { g.fillStyle = rgba('#F4F0D8', 0.6 * al); g.beginPath(); g.arc(cx - rx * 0.3, cy - ry * 0.35, Math.max(0.6, rx * 0.25), 0, Math.PI * 2); g.fill() }
  }
  g.restore()
}
// ---------- transmits: rings sent down the well ----------
// Each request to Claude's servers emits a short train of faint elliptical rings beneath the pyramid that follow
// a curve down the funnel into the throat, shrinking, tilting with the sheet, fading, and brightening the throat
// ring a little on arrival. Thralls' own requests make a smaller, fainter train. Driven by event times.
const TX_MS = 1500, TX_GAP = 120
let throatBoost = 0
function drawTransmits(T, now) {
  let boost = 0
  const mo = motion(), q = Q()
  if (mo <= 0.02 || q === 0 || !pack.init) { throatBoost = 0; return }
  projectPolar(0, 0, prj); const tx = prj[0], ty = prj[1]
  const tR = pack.coreR * 0.12
  for (const a of H.state.actors.values()) {
    if (!a.tx || !a.tx.length) continue
    const A = vis.actors.get(a.id)
    if (!A || A.alpha < 0.05) continue
    const small = !!a.parent
    for (let k = a.tx.length - 1; k >= 0; k--) {
      const ev = a.tx[k], age = T - ev.t
      const rings = 3 + Math.min(2, Math.floor(Math.log2(ev.n + 1)))
      if (age < 0 || age > TX_MS + rings * TX_GAP) { if (age > 0) break; else continue }
      const bright = (small ? 0.35 : 0.6) * (1 + 0.15 * Math.min(3, Math.log2(ev.n + 1)))
      const sx = A.x, sy = A.y + A.r * 0.95, r0 = A.r * (small ? 1.1 : 1.5)
      for (let j = 0; j < rings; j++) {
        const u = (age - j * TX_GAP) / TX_MS
        if (u <= 0 || u >= 1) continue
        const e = u * u * (2 - u) // easing in, settling
        // a curve: down from the pyramid, bending toward the throat, with the funnel's dip
        const dx = tx - sx, dy = ty - sy
        const px = sx + dx * e, py = sy + dy * e + Math.sin(u * Math.PI) * 18
        const r = r0 * (1 - 0.72 * e) + tR * 0.25 * e
        const al = bright * (1 - u) * (0.5 + 0.5 * (1 - j / rings))
        g.strokeStyle = rgba('#B9B2E6', al); g.lineWidth = Math.max(1, 1.2 / view.cam.z) * (1 + 0.6 * (1 - u))
        g.beginPath(); g.ellipse(px, py, r, r * (0.45 + 0.55 * tilt.cos * e), 0, 0, Math.PI * 2); g.stroke()
        if (u > 0.8) boost = Math.max(boost, (u - 0.8) / 0.2 * (small ? 0.4 : 1))
      }
    }
  }
  throatBoost = boost
}
// ---------- souls: the tokens left, as lost souls circling the throat ----------
// Each session's budget (used of window) becomes a loose ring of small tadpole-like souls just outside the
// throat: a full ring is a full budget, the count tracks (window - used) / window, eased. When tokens are used,
// the matching souls leave the ring and fly up to the master pyramid, which eats them: its cap lifts, tiny
// anemone tentacles sprout from the cap's lower line and the body's top line and draw them into the gap; then
// the cap settles. After compaction new souls drift back in from the outer web. Driven by state at T.
const SOUL_COL = '#C9D4E8'
function soulsFull() { return Q() === 2 ? 48 : Q() === 1 ? 24 : 12 }
function syncSouls(S, T, now, dt) {
  const mo = motion(), full = soulsFull()
  for (const a of S.actors.values()) {
    if (a.parent || !a.budget) continue
    const A = vis.actors.get(a.id)
    if (!A || !A.present) continue
    let so = vis.souls.get(a.id)
    if (!so) { so = { actor: a.id, list: [], seq: 0, spawnAt: 0 }; vis.souls.set(a.id, so) }
    so.seen = true
    const want = Math.round(full * clamp((a.budget.window - a.budget.used) / Math.max(1, a.budget.window), 0, 1))
    // the ring: round the hub's throat for the owner, round its own vortex for a satellite
    const W = vis.whirls.get(a.id)
    const owner = a.id === pack.owner && pack.init
    so.cx = owner ? pack.cx : (W ? W.x : A.x); so.cy = owner ? pack.cy : (W ? W.y : A.y + 40)
    // the orbit sits in the free space between the throat and the inner card ring
    const inner = W && W.n && W.r1 ? W.r1 - W.d1 / 2 - 36 : pack.coreR * 0.34
    so.r = owner ? clamp(inner, pack.coreR * 0.2, pack.coreR * 0.34) : 70; so.owner = owner
    let alive = 0
    for (const s of so.list) if (s.state !== 'eaten' && s.state !== 'carried') alive++
    // every budget rise is a visible feeding: at least one soul, more for big jumps (log scale, at most six);
    // the ring then drifts back toward the true count
    if (a.feeds && a.feeds.length) {
      if (so.feedT === undefined || so.feedT > T) so.feedT = T - 4500 // (a rewind starts afresh from here)
      for (const f of a.feeds) {
        if (f.t <= so.feedT || f.t > T) continue
        so.feedT = f.t
        if (T - f.t > 4000) continue // too old to show (a jump far back in time)
        const perSoul = a.budget.window / full
        let k = Math.min(6, 1 + Math.floor(Math.log2(1 + f.jump / perSoul)))
        for (const s of so.list) {
          if (!k) break
          if (s.state !== 'ring') continue
          s.t0 = now; s.fx = s.x; s.fy = s.y; k--; alive--
          let carrying = 0
          for (const o of so.list) if (o.state === 'carried') carrying++
          if (carrying < 3 && mo > 0.02) {
            // a feeding tentacle sprouts, reaches the soul, grips it and carries it up to the cap
            s.state = 'carried'; s.phase = 'reach'; s.lid = 'feed~' + a.id + ':' + s.id
            const L = newLimb(s.lid, { actor: a.id, kind: 'feed', tool: '', node: '' }, A, false); L.prop = ''; L.scale = 0.5; vis.limbs.set(s.lid, L)
          } else { s.state = 'eaten'; A.feedT = now }
        }
      }
    }
    if (alive < want && now > so.spawnAt) {
      // a new soul drifts in from the outer web
      so.spawnAt = now + (mo > 0.02 ? 90 : 0)
      const ang = Math.random() * Math.PI * 2
      so.list.push({ id: so.seq++, ang, state: mo > 0.02 ? 'arriving' : 'ring', t0: now, r0: pack.init ? pack.outerR * 0.95 : so.r * 4, ph: Math.random() * 6.28, wob: 0.6 + Math.random() * 0.8, x: 0, y: 0, sc: 1 })
    } else if (alive > want) {
      // the souls beyond the budget are eaten: several at once when many tokens went at once
      let extra = alive - want
      for (const s of so.list) { if (!extra) break; if (s.state === 'eaten' || s.state === 'carried') continue; s.state = 'eaten'; s.t0 = now; s.fx = s.x; s.fy = s.y; extra--; A.feedT = now }
    }
    // motion
    const spin = (Math.PI * 2 / 40) * mo
    for (let i = so.list.length - 1; i >= 0; i--) {
      const s = so.list[i]
      s.ang += spin * dt * s.wob
      const rr = so.r * (1 + 0.08 * Math.sin(now * 0.0011 * mo + s.ph))
      let r = rr
      if (s.state === 'arriving') { const u = c01((now - s.t0) / 2500); r = s.r0 + (rr - s.r0) * smooth(u); if (u >= 1) s.state = 'ring' }
      if (s.state === 'carried') {
        const L = vis.limbs.get(s.lid)
        if (!L || !A.present) { s.state = 'eaten'; s.t0 = now; s.fx = s.x; s.fy = s.y; A.feedT = now; if (L) L.extT = 0; continue }
        L.seen = true; L.node = ''; L.mode = 0; L.activeT = 1; L.waitT = 0; L.closedT = 0; L.extT = 1
        limbRoot(A, L)
        const C = L.chain
        const tipx = C ? ROOT[0] + (C[0] - ROOT[0]) * L.ext : ROOT[0], tipy = C ? ROOT[1] + (C[1] - ROOT[1]) * L.ext : ROOT[1]
        const gx = A.x, gy = A.y - A.r * 0.63
        if (s.phase === 'reach') {
          L.gx = s.x; L.gy = s.y
          if (Math.hypot(tipx - s.x, tipy - s.y) < 14 || now - s.t0 > 2200) { s.phase = 'carry'; s.t0 = now }
        } else {
          // gripped: the soul rides the tip up to the gap, then the cap gulps and the tentacle withdraws
          L.gx = gx; L.gy = gy
          s.x = tipx; s.y = tipy; s.sc = 1 - 0.5 * c01((now - s.t0) / 1200)
          if (Math.hypot(tipx - gx, tipy - gy) < 12 || now - s.t0 > 1800) { A.feedT = now; L.extT = 0; so.list.splice(i, 1); continue }
        }
        if (L.side < 0 || L.ext < 0.1) L.side = sideOf(A, L.gx, L.gy, L)
        limbRoot(A, L)
        L.facing = ((L.gx - A.x) * ROOT[2] + (L.gy - A.y) * ROOT[3]) / (Math.hypot(L.gx - A.x, L.gy - A.y) || 1)
        L.sgx = L.gx; L.sgy = L.gy
        continue
      }
      if (s.state === 'eaten') {
        // pulled off its orbit: an accelerating spiral up into the gap, stretching as it speeds
        const u = c01((now - s.t0) / 1400), e = Math.pow(u, 1.9)
        const R = A.r, gx = A.x, gy = A.y - R * 0.63
        const dx0 = s.fx - gx, dy0 = s.fy - gy, r0 = Math.hypot(dx0, dy0), a0 = Math.atan2(dy0, dx0)
        const r = r0 * (1 - e), an = a0 + 2.6 * e * e
        s.x = gx + Math.cos(an) * r; s.y = gy + Math.sin(an) * r
        s.sc = 1 - 0.7 * e; s.stretch = 1 + 2.5 * e
        if (u >= 1 || mo <= 0.02) { so.list.splice(i, 1); if (u >= 1) digest(A, now) }
        continue
      }
      if (so.owner) { projectPolar(s.ang, r, prj); s.x = prj[0]; s.y = prj[1] }
      else { s.x = so.cx + Math.cos(s.ang) * r; s.y = so.cy + Math.sin(s.ang) * r * tilt.cos }
      s.sc = 1
    }
  }
  for (const [k, so] of vis.souls) { if (!so.seen) vis.souls.delete(k); else so.seen = false }
  for (const L of vis.limbs.values()) if (L.kind === 'feed' && !L.seen) L.extT = 0
  for (const A of vis.actors.values()) A.feed = ease(A.feed || 0, now - (A.feedT || -1e9) < 1300 && motion() > 0.02 ? 1 : 0, 7, dt)
}
