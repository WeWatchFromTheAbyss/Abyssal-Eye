// Abyssal Eye live view, part 4 of 4: drawing the creatures and the rest of the scene, input, the frame loop.
'use strict'
function drawSouls(now) {
  if (!vis.souls.size) return
  const z = view.cam.z, q = Q(), mo = motion()
  g.save()
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (const so of vis.souls.values()) {
    for (const s of so.list) {
      const x = s.x, y = s.y
      if (!inView(x - 14, y - 14, 28, 28)) continue
      const sc = s.sc * (q === 0 ? 0.8 : 1), hr = 4.2 * sc
      const al = (s.state === 'eaten' ? 0.75 : 0.62) * (s.state === 'arriving' ? 0.7 : 1)
      // two tiny wings, each soul flapping to its own phase (faster while being drawn to the cap)
      const flap = Math.sin(now * (s.state === 'carried' ? 0.045 : s.state === 'eaten' ? 0.026 : 0.011) * mo + s.ph * 3)
      const wl = hr * 2.2, wy = hr * 0.2, lift = (0.35 + 0.65 * (flap * 0.5 + 0.5)) * hr * 1.6
      g.fillStyle = rgba(SOUL_COL, al * 0.55); g.strokeStyle = rgba(SOUL_COL, al * 0.9); g.lineWidth = Math.max(0.6, 0.8 / Math.max(0.6, z))
      for (const d of [-1, 1]) {
        g.beginPath(); g.moveTo(x + d * hr * 0.6, y - wy)
        g.quadraticCurveTo(x + d * wl * 0.9, y - wy - lift * 1.3, x + d * wl, y - wy - lift * 0.2)
        g.quadraticCurveTo(x + d * wl * 0.55, y - wy + hr * 0.5, x + d * hr * 0.6, y + hr * 0.3)
        g.closePath(); g.fill(); g.stroke()
      }
      // the halo, a thin glowing ring floating above
      g.strokeStyle = rgba('#EEE6B8', al * 1.1); g.lineWidth = Math.max(0.7, 1 / Math.max(0.6, z))
      const hw = s.state === 'carried' ? Math.sin(now * 0.03 + s.ph) * hr * 0.5 : 0
      g.beginPath(); g.ellipse(x + hw, y - hr * 1.55, hr * 0.85, hr * 0.3, hw * 0.1, 0, Math.PI * 2); g.stroke()
      // the head, pale and translucent, with a soft glow
      if (q >= 1) { g.fillStyle = rgba(SOUL_COL, al * 0.22); g.beginPath(); g.arc(x, y, hr * 2.4, 0, Math.PI * 2); g.fill() }
      const st = s.state === 'eaten' ? (s.stretch || 1) : 1
      g.fillStyle = rgba(SOUL_COL, al); g.beginPath(); g.ellipse(x, y, hr * (0.7 + 0.3 / st), hr * 0.85 * (0.7 + 0.3 / st), 0, 0, Math.PI * 2); g.fill()
      // tiny sad eyes: two dots under drooping lids
      if (q >= 1 && sc > 0.6) {
        g.fillStyle = rgba(INK, al * 1.6)
        g.beginPath(); g.arc(x - hr * 0.35, y - hr * 0.05, 0.55, 0, Math.PI * 2); g.arc(x + hr * 0.35, y - hr * 0.05, 0.55, 0, Math.PI * 2); g.fill()
        g.strokeStyle = rgba(INK, al * 1.2); g.lineWidth = 0.6
        g.beginPath(); g.moveTo(x - hr * 0.65, y - hr * 0.55); g.lineTo(x - hr * 0.15, y - hr * 0.3); g.moveTo(x + hr * 0.65, y - hr * 0.55); g.lineTo(x + hr * 0.15, y - hr * 0.3); g.stroke()
      }
    }
  }
  g.restore()
}
const tomeOrder = []
function drawTomes(now) {
  const z = view.cam.z, q = Q(), mo = motion()
  const bucket = bucketOf(z)
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.008 * mo)
  tomeOrder.length = 0
  for (const V of vis.nodes.values()) if (V.alpha >= 0.01 && inView(V.x - 20, V.y - 20, V.w + 40, V.h + 40)) tomeOrder.push(V)
  tomeOrder.sort((a, b) => (a.y + a.h) - (b.y + b.h))
  const depthSpan = Math.max(500, pack.outerR * 1.1)
  for (const V of tomeOrder) {
    const shk = (V.shake || 0) > 0.02 ? V.shake : 0
    const x = V.x + Math.sin(now * 0.11) * 3 * shk, y = V.y + Math.cos(now * 0.13) * 2 * shk, w = V.w, h = V.h
    // depth: the near side a little larger, the far side a little smaller, never beyond readable
    V.depthK = pack.init ? clamp(1 + (y + h / 2 - pack.cy) / depthSpan * 0.2, 0.78, 1.14) : 1
    const ghost = V.hGhost
    if (V.pile > 0.98) continue
    if (V.trail && V.trail.length >= 4) {
      const ta = V.xfer ? 1 : 1 - (now - (V.trailEnd || 0)) / 700
      if (ta <= 0) V.trail.length = 0
      else {
        const t = V.trail, n = t.length / 2
        g.lineCap = 'round'; g.lineJoin = 'round'
        for (let i = 1; i < n; i++) { g.strokeStyle = rgba(BONE, 0.22 * ta * i / n * V.alpha); g.lineWidth = Math.max(1, 1.2 / z) * (0.5 + i / n); g.beginPath(); g.moveTo(t[i * 2 - 2], t[i * 2 - 1]); g.lineTo(t[i * 2], t[i * 2 + 1]); g.stroke() }
      }
    }
    g.globalAlpha = V.alpha * (1 - ghost * 0.6) * V.dim * (1 - V.pile)
    // heat halos behind the card
    glowRect(x, y, w, h, CYAN, Math.max(V.hRead * 0.32, (V.gaze || 0) * 0.5), z)
    glowRect(x, y, w, h, EMBER, V.hEdit * (0.3 + 0.1 * pulse), z)
    glowRect(x, y, w, h, VIOLET, V.hExt * 0.34, z)
    glowRect(x, y, w, h, GREEN, V.hFresh * 0.32, z)
    // a dormant rune wakes behind a hovered tome
    if (view.hover === V && q >= 1) { g.save(); g.globalAlpha *= 0.5; g.strokeStyle = rgba(VIOLET, 0.6); g.lineWidth = Math.max(1, 1 / z); g.stroke(new Path2D(pentaPath(x + w / 2, y + h / 2, Math.max(w, h) * 0.62, now * 0.0004))); g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.max(w, h) * 0.62, 0, Math.PI * 2); g.stroke(); g.restore() }
    const c = cardFor(V, bucket)
    const sc = V.scale * V.depthK * (V.hub ? HUB_SCALE : 1)
    // a contact shadow where the card hangs on the sheet
    if (V.pile < 0.5 && q >= 1) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(x + w / 2, y + h + 3, w * 0.42 * sc, 4.5, 0, 0, Math.PI * 2); g.fill() }
    if (Math.abs(sc - 1) > 0.001) { g.save(); g.translate(x + w / 2, y + h / 2); g.scale(sc, sc); g.translate(-x - w / 2, -y - h / 2) }
    // the bitmap is drawn 1:1 (uniform scale only); while the card's drawn size still eases toward the bitmap's,
    // the bitmap is revealed through the card rect instead of being stretched into it
    const easing = Math.abs(w - c.w) > 0.5 || Math.abs(h - c.h) > 0.5
    if (easing) { g.save(); g.beginPath(); roundRect(x - 2, y - 2, w + 8, h + 9, 4); g.clip() }
    g.drawImage(c.canvas, x - c.m, y - c.m, c.w + c.m * 2, c.h + c.m * 2)
    if (easing) g.restore()
    // live row bars
    for (let i = 0; i < V.rows.length; i++) {
      const r = V.rows[i]
      const ry = y + HEAD_H + i * ROW_H
      if (ry + ROW_H > y + h) break
      if (r.f > 0.02) { g.fillStyle = rgba(r.e >= r.r && r.e > 0.02 ? EMBER : CYAN, Math.min(1, r.f * (0.28 + 0.3 * pulse) + 0.5 * shk * r.e)); g.fillRect(x + 10, ry, w - 14, ROW_H) }
      if (r.e > 0.02 && V.wob > 0.02) { g.strokeStyle = rgba(ICHOR, 0.5 * V.wob * r.e); g.lineWidth = 1.2; wobblePath(x + 10, ry, w - 14, ROW_H, 1.6 * V.wob, now, V.seed || 0); g.stroke() }
      if (V.taint > 0.02 && V.zap < 0.3 && V.taintRow === r.name) { g.fillStyle = rgba(V.taintCol || EMBER, 0.1 * V.taint); g.fillRect(x + 10, ry, w - 14, ROW_H) }
      if (V.zap > 0.02 && V.zapRow === r.name) { g.fillStyle = rgba(V.zapCol || EMBER, 0.22 * V.zap); g.fillRect(x + 10, ry, w - 14, ROW_H); zapRect(x + 10, ry, w - 14, ROW_H, now, (V.seed || 0) + 3, V.zapCol || EMBER, V.zap, z, 2) }
      else if (r.e > 0.02) { g.fillStyle = rgba(EMBER, r.e * 0.3); g.fillRect(x + 10, ry, w - 14, ROW_H) }
      else if (r.r > 0.02) { g.fillStyle = rgba(CYAN, r.r * 0.22); g.fillRect(x + 10, ry, w - 14, ROW_H) }
    }
    // rims
    if (V.wob > 0.02) {
      // the edited tome's border undulates, a fleshy membrane bulging round the crisp card
      g.fillStyle = rgba(ICHOR, 0.16 * V.wob); g.strokeStyle = rgba(EMBER, (0.3 + 0.6 * V.hEdit) * V.wob + 0.2 * (1 - V.wob) * V.hEdit); g.lineWidth = 2
      wobblePath(x - 3, y - 3, w + 6, h + 6, 4 * V.wob, now, V.seed || 0); g.fill(); g.stroke()
      if (V.zap > 0.02) zapRect(x - 3, y - 3, w + 6, h + 6, now, V.seed || 0, V.zapCol || EMBER, V.zap, z, 4)
      // the taint: a recent edit keeps the frame crackling, sparse and dim, dying out over the last seconds
      else if (V.taint > 0.02 && q >= 1 && mo > 0.02 && rnd(V.id, Math.floor(now / 140)) < 0.3 + 0.25 * V.taint) zapRect(x - 3, y - 3, w + 6, h + 6, now, (V.seed || 0) + 5, V.taintCol || EMBER, 0.32 * V.taint, z, 2.5)
    } else if (V.hEdit > 0.02) { g.strokeStyle = rgba(EMBER, 0.2 + 0.8 * V.hEdit); g.lineWidth = 2; g.beginPath(); roundRect(x - 3, y - 3, w + 6, h + 6, 5); g.stroke() }
    if (V.hExt > 0.02) { g.strokeStyle = rgba(VIOLET, 0.2 + 0.8 * V.hExt); g.lineWidth = 2; g.beginPath(); roundRect(x - 5, y - 5, w + 10, h + 10, 6); g.stroke() }
    if (V.hFresh > 0.02) { g.strokeStyle = rgba(GREEN, V.hFresh * (0.5 + 0.5 * pulse)); g.lineWidth = 2.4; g.beginPath(); roundRect(x - 7, y - 7, w + 14, h + 14, 8); g.stroke() }
    if (ghost > 0.02) {
      g.fillStyle = rgba('#2A2C2A', ghost * 0.75); g.beginPath(); roundRect(x, y, w, h, 3); g.fill()
      g.strokeStyle = rgba('#8A8A80', ghost); g.lineWidth = 1.2
      g.beginPath(); g.moveTo(x + w * 0.3, y); g.lineTo(x + w * 0.3 + 6, y + 12); g.lineTo(x + w * 0.3 - 2, y + 22); g.lineTo(x + w * 0.3 + 7, y + 36); g.lineTo(x + w * 0.3 + 3, y + h)
      g.moveTo(x + w * 0.7, y + h); g.lineTo(x + w * 0.7 - 5, y + h - 11); g.lineTo(x + w * 0.7 + 2, y + h - 20); g.stroke()
    }
    // flourishes: a clasp on a folded tome, cobwebs on one long untouched, a closed eye on a sleeper
    if (V.pin && V.pile < 0.5) { g.fillStyle = rgba(BRASS, 0.9); g.beginPath(); g.arc(x + 4, y + 4, 2.6, 0, Math.PI * 2); g.fill(); g.strokeStyle = rgba(INK, 0.8); g.lineWidth = 1; g.beginPath(); g.moveTo(x + 4, y + 6); g.lineTo(x + 4, y + 12); g.stroke() }
    if (V.tFold && V.pile < 0.5) { g.fillStyle = BRASS; g.fillRect(x + w - 9, y + h / 2 - 5, 5, 10); g.fillStyle = INK; g.beginPath(); g.arc(x + w - 6.5, y + h / 2, 1.3, 0, Math.PI * 2); g.fill() }
    if (V.dim < 0.5 && q >= 1) {
      const k = (0.5 - V.dim) * 2
      g.strokeStyle = rgba(ASH, 0.35 * k); g.lineWidth = Math.max(0.6, 0.6 / z); g.beginPath()
      for (let i = 0; i < 4; i++) { const an = i * 0.42 + 0.1; g.moveTo(x + 1, y + 1); g.lineTo(x + 1 + Math.cos(an) * 26, y + 1 + Math.sin(an) * 26) }
      for (let rr = 8; rr <= 24; rr += 8) g.moveTo(x + 1 + rr, y + 1), g.arc(x + 1, y + 1, rr, 0, 1.4)
      g.stroke()
    }
    if (V.gSleepy > 0.5 && V.alive) { g.strokeStyle = rgba(BONE, 0.55); g.lineWidth = 1.3; g.beginPath(); g.moveTo(x + w - 20, y + 9); g.quadraticCurveTo(x + w - 14, y + 14, x + w - 8, y + 9); g.stroke() }
    if (Math.abs(sc - 1) > 0.001) g.restore()
    // the full name, dim, above a hovered tome whose title is a short form
    if (view.hover === V && V.short && V.short !== V.name) { g.font = '11px ' + FONT; g.fillStyle = rgba(ASH, 0.85); g.textBaseline = 'bottom'; g.textAlign = 'left'; g.fillText(V.name, x, y - 5) }
    if (V.alpha < 0.999 && q >= 0) { /* fading handled by globalAlpha */ }
  }
  g.globalAlpha = 1
}

// ----- the wake: a fading trail through recent targets -----

function drawTrails(T, now) {
  const z = view.cam.z, wmax = Math.max(1.6, 1.4 / z)
  for (const A of vis.actors.values()) {
    if (A.alpha < 0.05) continue
    const S = H.state.actors.get(A.id)
    if (!S || S.wake.length < 2) continue
    const col = A.parent ? THRALL : '#4F8F74'
    const w = S.wake
    const n = w.length
    g.lineCap = 'round'; g.lineJoin = 'round'
    let prevX = 0, prevY = 0, has = false
    for (let i = 0; i < n; i++) {
      const N = vis.nodes.get(w[i].node)
      if (!N || !N.present) continue
      const cx = N.x + N.w / 2, cy = N.y + N.h / 2
      if (has) {
        const age = c01((T - w[i].t) / 25000)
        if (age < 1) {
          g.strokeStyle = rgba(col, 0.2 * (1 - age * 0.85) * A.alpha)
          g.lineWidth = wmax * (1 - age * 0.7)
          g.beginPath(); g.moveTo(prevX, prevY)
          const mx = (prevX + cx) / 2, my = (prevY + cy) / 2
          const nx = -(cy - prevY), ny = cx - prevX
          g.quadraticCurveTo(mx + nx * 0.12, my + ny * 0.12, cx, cy); g.stroke()
          if (w[i].edit) { g.fillStyle = rgba(EMBER, 0.3 + 0.6 * (1 - age)); g.beginPath(); g.arc(cx, cy, Math.max(2.5, 2.2 / z), 0, Math.PI * 2); g.fill() }
        }
      }
      prevX = cx; prevY = cy; has = true
    }
  }
}

// ----- creatures: limbs, props, pyramids -----

const SP = new Float64Array(80), SN = new Float64Array(80), ROOT = new Float64Array(8), TIPOFF = new Float64Array(80)
// pyramid outline in local units of R: apex, bottom right, bottom left; sides 0 = right, 1 = base, 2 = left
const PVX = [0, 1.1, -1.1], PVY = [-1.2, 0.8, 0.8]
// the side facing the target; a side that already has a front arm yields to the next facing side, so the arms
// spread over the pyramid instead of piling on one edge
function sideOf(A, tx, ty, L) {
  const dx = tx - A.x, dy = ty - A.y
  const d = Math.hypot(dx, dy) || 1
  const dots = []
  for (let i = 0; i < 3; i++) {
    const ex = PVX[(i + 1) % 3] - PVX[i], ey = PVY[(i + 1) % 3] - PVY[i]
    const mx = (PVX[i] + PVX[(i + 1) % 3]) / 2, my = (PVY[i] + PVY[(i + 1) % 3]) / 2
    let nx = ey, ny = -ex
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny }
    dots.push([(dx * nx + dy * ny) / Math.hypot(nx, ny) / d, i])
  }
  dots.sort((p, q) => q[0] - p[0])
  for (let k = 0; k < 3; k++) { const h = holders.get(A.id + ':' + dots[k][1]); if ((!h || h === L) && dots[k][0] > -0.05) return dots[k][1] }
  return dots[0][1]
}
// a limb's root: a fixed point on its side; arms that are not the front arm of their side sit behind the body.
// ROOT = [x, y, nx, ny, tx, ty, edgeLen]: position, outward normal, edge tangent (vertex i toward i+1), edge length
function limbRoot(A, L) {
  if (L.side < 0) L.side = 1
  const R = A.r * (A.bodyK || 1), i = L.side
  const px = PVX[i] * R, py = PVY[i] * R, ex = PVX[(i + 1) % 3] * R - px, ey = PVY[(i + 1) % 3] * R - py
  const el = Math.hypot(ex, ey) || 1
  let nx = ey / el, ny = -ex / el
  const rx = px + ex * L.rootT, ry = py + ey * L.rootT
  if (nx * rx + ny * ry < 0) { nx = -nx; ny = -ny }
  const inward = R * 0.45 * (1 - smooth(L.front))
  // the body may be leaning: everything turns with it
  const ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
  const lx = rx - nx * inward, ly = ry - ny * inward
  ROOT[0] = A.x + lx * ca - ly * sa; ROOT[1] = A.y + lx * sa + ly * ca
  ROOT[2] = nx * ca - ny * sa; ROOT[3] = nx * sa + ny * ca
  const tx = ex / el, ty = ey / el
  ROOT[4] = tx * ca - ty * sa; ROOT[5] = tx * sa + ty * ca; ROOT[6] = el
}
// a front arm is attached once its root has fully surfaced on the edge
function attached(L) { return L.front >= 0.98 }
// base width of a limb at its root: one body for every limb, scaled by its reach
function baseWidth(L, A) { return Math.max(3, A.r * 0.42) * (0.45 + 0.55 * L.ext) * L.scale }

function spine(ax, ay, bx, by, bend, wiggle, phase, seed, N, n0x, n0y) {
  const dx = bx - ax, dy = by - ay
  const L = Math.max(0.001, Math.hypot(dx, dy))
  const nx = -dy / L, ny = dx / L
  // the first control point leaves along the pyramid edge's normal so the stalk grows out of the outline
  const c1x = n0x !== undefined ? ax + n0x * L * 0.3 + nx * L * bend * 0.5 : ax + dx * 0.33 + nx * L * bend
  const c1y = n0y !== undefined ? ay + n0y * L * 0.3 + ny * L * bend * 0.5 : ay + dy * 0.33 + ny * L * bend
  const c2x = ax + dx * 0.72 - nx * L * bend * 0.7, c2y = ay + dy * 0.72 - ny * L * bend * 0.7
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
    const px = ax * w0 + c1x * w1 + c2x * w2 + bx * w3, py = ay * w0 + c1y * w1 + c2y * w2 + by * w3
    const w = Math.sin(t * 11 - phase + seed) * wiggle * t * (1 - t) * 4
    SP[i * 2] = px + nx * w; SP[i * 2 + 1] = py + ny * w
  }
  for (let i = 0; i <= N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N, i + 1)
    let tx = SP[b * 2] - SP[a * 2], ty = SP[b * 2 + 1] - SP[a * 2 + 1]
    const l = Math.hypot(tx, ty)
    if (l < 1e-6) { tx = 1; ty = 0 } else { tx /= l; ty /= l }
    SN[i * 2] = -ty; SN[i * 2 + 1] = tx
  }
}

// two outline lines, out along one side and back along the other, meeting at the tip; open at the root
// (no cap line). Plain base: used for arms that emerge from behind the body.
// one side of the outline from spine index i0 to i1, drawn as a smooth curve through the midpoints (no facets)
const HX = new Float64Array(80), HY = new Float64Array(80)
function sideCurve(i0, i1, sign, wf, N, start) {
  const step = i1 >= i0 ? 1 : -1
  let n = 0
  for (let i = i0; step > 0 ? i <= i1 : i >= i1; i += step) { const h = wf(i / N) * 0.5 * sign; HX[n] = SP[i * 2] + SN[i * 2] * h; HY[n] = SP[i * 2 + 1] + SN[i * 2 + 1] * h; n++ }
  if (start) g.moveTo(HX[0], HY[0]); else g.lineTo(HX[0], HY[0])
  for (let k = 1; k < n - 1; k++) g.quadraticCurveTo(HX[k], HY[k], (HX[k] + HX[k + 1]) / 2, (HY[k] + HY[k + 1]) / 2)
  g.lineTo(HX[n - 1], HY[n - 1])
}
function hull(N, wf) {
  g.beginPath()
  sideCurve(0, N, 1, wf, N, true)
  sideCurve(N, 0, -1, wf, N, false)
}
// attached base: the outlines start on the pyramid edge at P1 and P2, tangent to the edge, and fillet into the spine
// sides like a stem growing out of a surface (G1 at both ends). Uses ROOT from limbRoot.
function hullAttached(N, wf, A) {
  const W = wf(0), hw = W / 2
  const tgx = ROOT[4], tgy = ROOT[5]
  const rx = ROOT[0], ry = ROOT[1]
  const f = Math.min(A.r * 0.35, ROOT[6] / 6)
  // spine direction and spacing near the root
  const sx = SP[2] - SP[0], sy = SP[3] - SP[1], sl = Math.hypot(sx, sy) || 1
  const dx = sx / sl, dy = sy / sl
  const j0 = clamp(Math.round(1.4 * f / sl), 1, N - 2)
  // which hull side (+SN) faces along +tangent
  const plus = SN[0] * tgx + SN[1] * tgy > 0 ? 1 : -1
  const hj = wf(j0 / N) * 0.5
  const Hax = SP[j0 * 2] + SN[j0 * 2] * hj * plus, Hay = SP[j0 * 2 + 1] + SN[j0 * 2 + 1] * hj * plus // the +tangent side
  const Hbx = SP[j0 * 2] - SN[j0 * 2] * hj * plus, Hby = SP[j0 * 2 + 1] - SN[j0 * 2 + 1] * hj * plus
  const Pax = rx + tgx * hw, Pay = ry + tgy * hw, Pbx = rx - tgx * hw, Pby = ry - tgy * hw
  g.beginPath()
  g.moveTo(Pax, Pay)
  g.bezierCurveTo(Pax + tgx * f, Pay + tgy * f, Hax - dx * f * 0.8, Hay - dy * f * 0.8, Hax, Hay)
  sideCurve(j0, N, plus, wf, N, false)
  sideCurve(N, j0, -plus, wf, N, false)
  g.bezierCurveTo(Hbx - dx * f * 0.8, Hby - dy * f * 0.8, Pbx - tgx * f, Pby - tgy * f, Pbx, Pby)
}

function limbStyle(A, z, q) {
  g.fillStyle = A.fill; g.strokeStyle = A.tone; g.lineWidth = Math.max(1.2, 0.9 / z); g.lineJoin = 'round'; g.lineCap = 'round'
  if (q === 2) { g.shadowColor = rgbaArr(A.col, 0.55); g.shadowBlur = 16 * z }
}


// one limb: a single tapering body along the chain, the same fill and outline as the pyramid, with the tip
// appendage living at its end: an eye (looking) or a club with suckers (acting), morphing between the two.
// Gulped blobs travel down it as bulges.
let limbW0 = 6, limbClub = 1, limbBlobs = null, limbBlobW = 0
function limbWidth(t) {
  let w = limbW0 * (1 - 0.78 * t)
  if (limbClub > 0.01) { const z = (t - 0.84) / 0.065; w += limbW0 * 1.25 * Math.exp(-z * z) * limbClub; if (t > 0.9) w *= 1 - limbClub * (1 - (1 - t) / 0.1) }
  if (limbBlobs) for (let b = 0; b < limbBlobs.length; b++) { const z = (t - (1 - limbBlobs[b].u)) / 0.05; w += limbBlobW * Math.exp(-z * z) }
  return Math.max(0, w)
}

function drawLimb(L, A, now) {
  const z = view.cam.z, mo = motion(), q = Q()
  const st = L.ext
  if (st < 0.01 || !L.chain) return
  limbRoot(A, L)
  const R = A.r
  const reachNow = Math.hypot(L.hx - ROOT[0], L.hy - ROOT[1])
  limbW0 = Math.max(3, R * 0.42) * (0.45 + 0.55 * st) * L.scale * (1 + 0.45 * L.tipEye) * (1 - 0.15 * clamp((reachNow - 260) / 420, 0, 1))
  limbClub = L.tipClub * (1 - 0.22 * (L.grip || 0)) // the club squeezes a little while it grips a card
  limbBlobs = L.blobs.length ? L.blobs : null
  limbBlobW = limbW0 * 0.9
  const N = snakeSpine(L, st, now)
  let tx = SP[N * 2], ty = SP[N * 2 + 1]
  if (!isFinite(tx) || !isFinite(ty)) { g.globalAlpha = 1; return } // a chain not yet settled draws nothing rather than garbage
  if (L.wait > 0.02 && mo > 0) { tx += Math.sin(now * 0.07 + L.seed) * 1.3 * L.wait; ty += Math.cos(now * 0.09 + L.seed) * 1.1 * L.wait }
  g.globalAlpha = (0.35 + 0.65 * st) * A.alpha
  if (attached(L)) hullAttached(N, limbWidth, A); else hull(N, limbWidth)
  limbStyle(A, z, q)
  g.fill(); g.stroke()
  g.shadowBlur = 0
  const sw = g.lineWidth
  // the club's suckers (fewer on a small limb), evenly spaced along the swelling
  if (L.tipClub > 0.05) {
    const count = L.scale < 0.62 ? 3 : 5
    g.fillStyle = rgba(FLESHLINE, 0.35 * L.tipClub); g.strokeStyle = rgbaArr(rgb(A.tone), L.tipClub); g.lineWidth = Math.max(0.7, 0.6 / z)
    g.beginPath()
    for (let s = 0; s < count; s++) {
      const t = 0.76 + s * (count === 3 ? 0.05 : 0.032), i = Math.round(t * N)
      const w = limbWidth(t), side = (s % 2 ? -1 : 1) * w * 0.2, r = w * 0.15 * L.tipClub
      if (r < 0.4) continue
      const cx = SP[i * 2] + SN[i * 2] * side, cy = SP[i * 2 + 1] + SN[i * 2 + 1] * side
      g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2)
    }
    g.stroke()
    // the tip scribbles on its target while the act runs
    if (L.active > 0.05 && st > 0.95 && L.wait < 0.5) {
      // energetic scribbling: fast, wide strokes, a slap when the club stamps the row, spatter flying off
      const k0 = L.active * (1 - L.wait) * L.tipClub, stp = L.stamp || 0
      const jx = Math.sin(now * 0.071 + L.seed) * 6 * mo, jy = Math.cos(now * 0.053 + L.seed) * 3.5 * mo
      g.strokeStyle = rgba(EMBER, k0); g.lineWidth = 1.6 + 1.2 * stp; g.lineCap = 'round'
      g.beginPath(); g.moveTo(tx - 12 + jx, ty + 1 + jy)
      for (let s = 1; s <= 6; s++) { const px = tx - 12 + s * 4 + jx, py = ty + jy + Math.sin(now * 0.09 + s * 1.9 + L.seed) * 5 * mo; g.lineTo(px, py) }
      g.stroke()
      if (stp > 0.3) { g.strokeStyle = rgba(ICHOR, 0.7 * stp * k0); g.lineWidth = 1; g.beginPath(); g.ellipse(tx, ty + 2, 9 + 6 * stp, 3 + 2 * stp, 0, 0, Math.PI * 2); g.stroke() }
      if (q >= 1 && mo > 0) {
        g.fillStyle = rgba(EMBER, L.active * 0.9)
        for (let k = 0; k < 6; k++) { const u = ((now * 0.0036) + k * 0.17 + L.seed * 0.01) % 1; g.globalAlpha = (1 - u) * A.alpha * k0; const an = k * 1.05 + L.seed; g.beginPath(); g.arc(tx + Math.cos(an) * (4 + u * 18), ty - 2 + Math.sin(an) * (3 + u * 12) - u * 6, 1.1 + 0.6 * (1 - u), 0, Math.PI * 2); g.fill() }
        g.globalAlpha = (0.35 + 0.65 * st) * A.alpha
      }
    }
  }
  // the eye: a bulb at the tip with lids and a pupil that follows the gaze point
  if (L.tipEye > 0.05) {
    const r = Math.max(5, R * 0.62) * L.scale * L.tipEye
    const bx = tx, by = ty
    // a soft glow round the eye, and a faint gaze cone onto the row it reads
    if (q >= 1 && L.active > 0.05 && isFinite(bx) && isFinite(by) && isFinite(r) && r > 0) {
      const gl = g.createRadialGradient(bx, by, r * 0.6, bx, by, r * 2.6); gl.addColorStop(0, rgba(CYAN, 0.28 * L.tipEye * L.active)); gl.addColorStop(1, rgba(CYAN, 0))
      g.fillStyle = gl; g.beginPath(); g.arc(bx, by, r * 2.6, 0, Math.PI * 2); g.fill()
      if (L.lookId) {
        const gx = L.lx - bx, gy = L.ly - by, gd = Math.hypot(gx, gy) || 1, nx = -gy / gd, ny = gx / gd, hw = Math.max(6, ROW_H * 0.6)
        g.fillStyle = rgba(CYAN, 0.07 * L.tipEye * L.active)
        g.beginPath(); g.moveTo(bx, by); g.lineTo(L.lx + nx * hw, L.ly + ny * hw); g.lineTo(L.lx - nx * hw, L.ly - ny * hw); g.closePath(); g.fill()
      }
    }
    g.fillStyle = A.fill; g.strokeStyle = A.tone; g.lineWidth = sw * 1.3
    g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill(); g.stroke()
    const open = (1 - L.closed * 0.94) * (1 - (L.blink || 0) * 0.95)
    const ex = r * 0.74, up = by - r * 1.25 * open, dn = by + r * 0.95 * open
    const lx = bx - ex, rx = bx + ex
    if (open > 0.1) {
      g.save()
      g.beginPath(); g.moveTo(lx, by); g.quadraticCurveTo(bx, up, rx, by); g.quadraticCurveTo(bx, dn, lx, by); g.closePath()
      g.fillStyle = SCLERA; g.fill(); g.clip()
      let gx = L.lx - bx, gy = L.ly - by
      const gd = Math.hypot(gx, gy)
      if (gd > 1) { const k = Math.min(1, gd / 60) * r * 0.34; gx = gx / gd * k; gy = gy / gd * k } else { gx = 0; gy = 0 }
      const px = bx + gx, py = by + gy
      g.fillStyle = rgbaArr(A.col, 0.95 * open); g.beginPath(); g.arc(px, py, r * 0.36, 0, Math.PI * 2); g.fill()
      g.fillStyle = INK; g.beginPath(); g.ellipse(px, py, r * 0.09, r * 0.28, 0, 0, Math.PI * 2); g.fill()
      g.restore()
    }
    g.strokeStyle = A.tone; g.lineWidth = sw; g.lineCap = 'round'
    g.beginPath(); g.moveTo(lx, by); g.quadraticCurveTo(bx, up, rx, by); g.moveTo(lx, by); g.quadraticCurveTo(bx, dn, rx, by); g.stroke()
    // the gaze is unmistakable: a faint sightline from the eye to the exact row it reads, or a soft ring around the
    // thrall it oversees
    if (L.kind === 'oversee') {
      const Th = A.thrall ? vis.actors.get(A.thrall) : null
      if (Th) { g.strokeStyle = rgba(CYAN, 0.35 * L.tipEye); g.lineWidth = Math.max(1, 1 / z); g.beginPath(); g.arc(Th.x, Th.y, Th.r * 2.1 + Math.sin(now * 0.003) * 2 * mo, 0, Math.PI * 2); g.stroke() }
    } else if (L.lookId && L.active > 0.05) {
      g.strokeStyle = rgba(CYAN, 0.28 * L.tipEye * L.active); g.lineWidth = Math.max(0.8, 0.8 / z); g.setLineDash(DASH_GAZE)
      g.beginPath(); g.moveTo(bx, by); g.lineTo(L.lx, L.ly); g.stroke(); g.setLineDash(EMPTY_DASH)
      g.fillStyle = rgba(CYAN, 0.6 * L.tipEye * L.active); g.beginPath(); g.arc(L.lx, L.ly, 2.2, 0, Math.PI * 2); g.fill()
    }
  }
  // the blobs glow through the body as they travel
  if (limbBlobs) for (let b = 0; b < limbBlobs.length; b++) {
    const B = limbBlobs[b], t = 1 - B.u, i = clamp(Math.round(t * N), 0, N)
    const x = SP[i * 2], y = SP[i * 2 + 1], r = limbBlobW * 0.45
    if (q >= 1) { g.save(); if (q === 2) { g.shadowColor = rgba(B.col, 0.9); g.shadowBlur = 12 * z } g.fillStyle = rgba(B.col, 0.75); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore() }
    else { g.fillStyle = rgba(B.col, 0.5); g.beginPath(); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.fill() }
  }
  if (L.wait > 0.05) {
    g.fillStyle = rgba(SULFUR, L.wait * (0.45 + 0.45 * Math.sin(now * 0.004)))
    g.font = '600 ' + (12 / Math.min(1, z)).toFixed(1) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('?', L.gx, L.gy - 14 / Math.min(1, z)); g.textAlign = 'left'
  }
  g.globalAlpha = 1
}

// a glance: a tiny eye that flicks open at the glanced tome
function drawGlances(T, now) {
  const z = view.cam.z
  for (const A of vis.actors.values()) {
    const S = H.state.actors.get(A.id)
    if (!S) continue
    for (let i = S.glances.length - 1; i >= 0; i--) {
      const gl = S.glances[i]
      const age = (T - gl.t) / 700
      if (age < 0) continue
      if (age > 1) break
      const N = vis.nodes.get(gl.node)
      if (!N || !N.present) continue
      const k = smooth(age < 0.3 ? age / 0.3 : (1 - age) / 0.7)
      const r = 5 * k / Math.min(1, z)
      const x = N.x + N.w - 14, y = N.y + HEAD_H / 2
      g.globalAlpha = k * A.alpha
      g.beginPath(); g.moveTo(x - r * 1.6, y); g.quadraticCurveTo(x, y - r * 1.3, x + r * 1.6, y); g.quadraticCurveTo(x, y + r * 1.3, x - r * 1.6, y); g.closePath()
      g.fillStyle = SCLERA; g.fill(); g.strokeStyle = FLESHLINE; g.lineWidth = 1; g.stroke()
      g.fillStyle = CYAN; g.beginPath(); g.arc(x + Math.sin(now * 0.02) * r * 0.3, y, r * 0.5, 0, Math.PI * 2); g.fill()
      g.fillStyle = INK; g.beginPath(); g.arc(x + Math.sin(now * 0.02) * r * 0.3, y, r * 0.2, 0, Math.PI * 2); g.fill()
    }
  }
  g.globalAlpha = 1
}

// a prop (flask, orb, scroll) is a small body held on a soft tether by its own little tentacle: when the pyramid
// moves the prop lags, swings like a pendulum behind it and settles gently; it keeps clear of tomes. The
// pentagram is a drawn circle, not a body, and stays where it is. Motion off: everything sits at rest.
function propStep(P, dt) {
  const A = vis.actors.get(P.actor)
  if (!A) return
  const rest = propPos(A, P.kind)
  const mo = motion()
  if (P.kind === 'pentagram' || mo <= 0.02) { P.px = rest[0]; P.py = rest[1]; P.vx = 0; P.vy = 0; P.tilt = 0; P.slosh = 0; P.sloshV = 0; P.tiltV = 0; return }
  if (P.px === undefined || !isFinite(P.px) || !isFinite(P.py)) { P.px = rest[0]; P.py = rest[1]; P.vx = 0; P.vy = 0; P.tilt = 0; P.tiltV = 0; P.slosh = 0; P.sloshV = 0 }
  const sdt = Math.min(dt, 1 / 30)
  // the tether: a soft spring to the rest spot (the pivot on the pyramid's side moves with it), lightly damped
  const k = 34, c = 2 * 0.42 * Math.sqrt(k)
  P.vx += ((rest[0] - P.px) * k - c * P.vx) * sdt; P.vy += ((rest[1] - P.py) * k - c * P.vy) * sdt
  P.px += P.vx * sdt; P.py += P.vy * sdt
  // clear of the tomes, softly
  freeSpot(P.px, P.py, 22); P.px += (ptmp[0] - P.px) * 0.3; P.py += (ptmp[1] - P.py) * 0.3
  // the swing angle: how far it hangs off the vertical through its pivot
  const piv = propPivot(A, P.kind)
  const want = Math.atan2(P.px - piv[0], Math.max(8, P.py - piv[1])) - Math.atan2(rest[0] - piv[0], Math.max(8, rest[1] - piv[1]))
  P.tiltV = (P.tiltV || 0) + ((want - (P.tilt || 0)) * 70 - 2 * 0.7 * Math.sqrt(70) * (P.tiltV || 0)) * sdt
  P.tilt = clamp((P.tilt || 0) + P.tiltV * sdt, -0.6, 0.6)
  // the liquid lags the tilt and sloshes
  P.sloshV = (P.sloshV || 0) + (((P.tilt || 0) - (P.slosh || 0)) * 90 - 2 * 0.3 * Math.sqrt(90) * (P.sloshV || 0)) * sdt
  P.slosh = (P.slosh || 0) + P.sloshV * sdt
  if (Math.abs(P.vx) + Math.abs(P.vy) < 0.4 && Math.hypot(P.px - rest[0], P.py - rest[1]) < 0.4) { P.vx = 0; P.vy = 0; P.px = rest[0]; P.py = rest[1] }
  if (!isFinite(P.tilt) || !isFinite(P.slosh)) { P.tilt = 0; P.tiltV = 0; P.slosh = 0; P.sloshV = 0 }
}
// where the little tentacle holding a prop leaves the body: the side the prop hangs on
function propPivot(A, kind) {
  const R = A.r, ca = Math.cos(A.tiltA || 0), sa = Math.sin(A.tiltA || 0)
  const lx = kind === 'flask' ? -R * 0.95 : kind === 'orb' ? R * 0.95 : R * 0.7, ly = kind === 'scroll' ? -R * 0.2 : R * 0.45
  return [A.x + lx * ca - ly * sa, A.y + lx * sa + ly * ca]
}
function drawProp(P, A, now) {
  const p = [P.px === undefined ? propPos(A, P.kind)[0] : P.px, P.py === undefined ? propPos(A, P.kind)[1] : P.py]
  const z = view.cam.z, q = Q(), mo = motion()
  const sz = 30 / Math.min(1, Math.sqrt(z))
  const def = PROPS[P.kind]
  g.save()
  g.globalAlpha = P.alpha * A.alpha * (0.55 + 0.45 * P.active)
  if (P.kind !== 'pentagram') {
    // the little tentacle: from the pyramid's side to the prop's neck, sagging, with a tiny club on the neck
    const piv = propPivot(A, P.kind), tilt = P.tilt || 0
    const nx = p[0] - Math.sin(tilt) * sz * 0.42, ny = p[1] - Math.cos(tilt) * sz * 0.42
    const mx = (piv[0] + nx) / 2, my = (piv[1] + ny) / 2 + Math.hypot(nx - piv[0], ny - piv[1]) * 0.18
    g.lineCap = 'round'
    g.strokeStyle = A.tone; g.lineWidth = Math.max(2.4, 3.2 / z); g.beginPath(); g.moveTo(piv[0], piv[1]); g.quadraticCurveTo(mx, my, nx, ny); g.stroke()
    g.strokeStyle = A.fill; g.lineWidth = Math.max(1.2, 1.8 / z); g.stroke()
    g.fillStyle = A.fill; g.strokeStyle = A.tone; g.lineWidth = Math.max(0.8, 0.8 / z); g.beginPath(); g.arc(nx, ny, Math.max(2, 2.6 / Math.min(1, z)), 0, Math.PI * 2); g.fill(); g.stroke()
    g.translate(p[0], p[1]); g.rotate(tilt); g.translate(-sz / 2, -sz / 2)
  } else g.translate(p[0] - sz / 2, p[1] - sz / 2)
  g.scale(sz / 40, sz / 40)
  if (q === 2 && P.active > 0.3) { g.shadowColor = rgba(def.col, 0.6 * P.active); g.shadowBlur = 18 }
  g.lineWidth = 1.5; g.lineJoin = 'round'; g.lineCap = 'round'
  if (P.kind === 'orb') {
    g.strokeStyle = BONE; g.fillStyle = FLESH; g.fill(def.line); g.stroke(def.line)
    const gr = g.createRadialGradient(16, 14, 2, 20, 18, 12); gr.addColorStop(0, '#9CC8F0'); gr.addColorStop(0.5, rgba(SCRY, 0.6)); gr.addColorStop(1, '#0B1A2A')
    g.fillStyle = gr; g.beginPath(); g.arc(20, 18, 11, 0, Math.PI * 2); g.fill(); g.stroke()
    g.save(); g.translate(20, 18); g.rotate(now * 0.0012 * mo); g.strokeStyle = rgba(SCRY, 0.8); g.lineWidth = 1
    g.beginPath(); g.moveTo(-7, 0); g.bezierCurveTo(-4, -5, 4, -5, 7, 0); g.moveTo(-8, 2); g.bezierCurveTo(-4, 6, 4, 6, 8, 2); g.stroke(); g.restore()
  } else if (P.kind === 'pentagram') {
    g.strokeStyle = BLOOD
    g.beginPath(); g.arc(20, 20, 16, 0, Math.PI * 2); g.stroke()
    g.save(); g.translate(20, 20); g.rotate(now * 0.0007 * mo); g.translate(-20, -20); g.stroke(def.line); g.restore()
    g.fillStyle = rgba(BLOOD, 0.5 + 0.5 * Math.sin(now * 0.005 * mo)); g.beginPath(); g.arc(20, 20, 3, 0, Math.PI * 2); g.fill()
  } else if (P.kind === 'flask') {
    // the liquid stays level, lagging the swing: it sloshes
    g.save(); g.translate(20, 28); g.rotate(-(P.slosh || 0) * 0.8); g.translate(-20, -28)
    g.fillStyle = rgba(GREEN, 0.35); g.fill(def.fill)
    g.restore()
    g.strokeStyle = BONE; g.stroke(def.line)
    if (q >= 1 && mo > 0) {
      g.fillStyle = GREEN
      for (let k = 0; k < 3; k++) { const u = ((now * 0.0008) + k * 0.37) % 1; g.globalAlpha = P.alpha * A.alpha * (1 - u) * (0.3 + 0.7 * P.active); g.beginPath(); g.arc(16 + k * 3, 31 - u * 10, 1.4 - k * 0.2, 0, Math.PI * 2); g.fill() }
    }
  } else {
    g.fillStyle = PAGE; g.fill(def.fill)
    g.strokeStyle = BONE; g.stroke(def.line)
    g.strokeStyle = PARCH; g.lineWidth = 1.1; g.beginPath(); g.moveTo(13, 14); g.lineTo(27, 14); g.moveTo(13, 19); g.lineTo(27, 19); g.moveTo(13, 24); g.lineTo(22, 24); g.stroke()
  }
  g.restore()
}

// the branch a thrall grew out of: a living vein from its parent, glowing and pulsing toward the tip while the
// thrall works, settling into a dim quiet vein once it is a knot. The network stays after the session fades.
function topAlpha(A) { let P = A; for (let k = 0; k < 6 && P && P.parent; k++) P = vis.actors.get(P.parent); return P ? P.alpha : 1 }

// knots that end on the same pile or spot merge into one knot with a count; veins from one parent toward the
// same area share a bundled trunk (same idea as the binding highways), fanning out only at the end
const veinBundles = new Map()
function syncVeins() {
  veinBundles.clear()
  for (const A of vis.actors.values()) {
    A.knotRep = null; A.knotCount = 1
    if (!A.parent || A.alpha < 0.02) continue
    const P = vis.actors.get(A.parent)
    if (!P) continue
    const ex = A.knot > 0.5 ? A.kx : A.x, ey = A.knot > 0.5 ? A.ky : A.y
    const key = A.parent + '|' + Math.round(ex / 160) + ',' + Math.round(ey / 160)
    let b = veinBundles.get(key)
    if (!b) { b = { n: 0, ex: 0, ey: 0, lanes: 0, knots: [] }; veinBundles.set(key, b) }
    b.n++; b.ex += ex; b.ey += ey
    A.vein = b; A.lane = b.lanes++
    if (A.knot > 0.98) b.knots.push(A)
  }
  for (const b of veinBundles.values()) {
    b.ex /= b.n; b.ey /= b.n
    // finished thralls that rest within a few pixels of each other collapse into one knot with a count
    for (let i = 0; i < b.knots.length; i++) {
      const A = b.knots[i]
      if (A.knotRep) continue
      A.knotRep = A; A.knotCount = 1
      for (let j = i + 1; j < b.knots.length; j++) {
        const B = b.knots[j]
        if (B.knotRep) continue
        if ((A.knotPile && A.knotPile === B.knotPile) || Math.hypot(A.kx - B.kx, A.ky - B.ky) < 26) { B.knotRep = A; A.knotCount++ }
      }
    }
  }
}

function drawBranch(A, P, now) {
  if (A.knotRep && A.knotRep !== A) return // merged into another knot: one vein for the group
  const ex = A.knot > 0.5 ? A.kx : A.x, ey = A.knot > 0.5 ? A.ky : A.y
  const dx = ex - P.x, dy = ey - P.y, L = Math.hypot(dx, dy)
  if (L < 2) return
  const z = view.cam.z, mo = motion()
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux
  const sx = P.x, sy = P.y + P.r * 0.6
  let c1x = sx + ux * L * 0.3 + nx * L * 0.12, c1y = sy + uy * L * 0.3 + ny * L * 0.12
  let c2x = ex - ux * L * 0.3 + nx * L * 0.06, c2y = ey - uy * L * 0.3 + ny * L * 0.06
  const b = A.vein
  if (b && b.n > 1) {
    const tx = b.ex - P.x, ty = b.ey - P.y, tl = Math.hypot(tx, ty) || 1, tnx = -ty / tl, tny = tx / tl
    const lane = ((A.lane || 0) - (b.lanes - 1) / 2) * 2.2
    const m1x = sx + tx * 0.35 + tnx * (tl * 0.1 + lane), m1y = sy + ty * 0.35 + tny * (tl * 0.1 + lane)
    const m2x = sx + tx * 0.7 + tnx * (tl * 0.05 + lane), m2y = sy + ty * 0.7 + tny * (tl * 0.05 + lane)
    c1x += (m1x - c1x) * 0.92; c1y += (m1y - c1y) * 0.92; c2x += (m2x - c2x) * 0.92; c2y += (m2y - c2y) * 0.92
  }
  const knot = A.knot, live = 1 - knot
  // veins are background: desaturated, hairline, faint, and fainter still when zoomed out
  const a = A.alpha * (0.4 + 0.6 * topAlpha(A)) * clamp(z / 0.5, 0.3, 1)
  g.lineCap = 'round'
  g.strokeStyle = rgba(VEIN, (0.12 * knot + 0.3 * live) * a); g.lineWidth = (A.vein && A.vein.n > 1 ? 1.5 : 1) / z
  g.beginPath(); g.moveTo(sx, sy); g.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey); g.stroke()
  if (live > 0.05 && mo > 0.02) {
    // a slow faint pulse runs toward the tip while the thrall works
    g.strokeStyle = rgba(VEIN, 0.25 * live * a); g.lineWidth = 1.5 / z
    g.setLineDash(DASH_PULSE); g.lineDashOffset = -(now * 0.012 * mo) % 26
    g.beginPath(); g.moveTo(sx, sy); g.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey); g.stroke()
    g.setLineDash(EMPTY_DASH)
  }
}
const DASH_PULSE = [3, 23], VEIN = '#7A7290'
const DASH_GAZE = [3, 4]


function drawActor(A, now) {
  const z = view.cam.z, q = Q(), mo = motion()
  const tone = A.tone
  const col = A.col
  const sw = Math.max(1.2, 0.9 / z)
  g.save()
  g.translate(A.x, A.y); g.rotate(A.tiltA || 0)
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
  const gapeK = smooth(Math.max(0, ((A.waitK || 0) - 0.45) / 0.55))
  // waiting: the body grows, and bulges out around the mouth
  g.scale((A.bodyK || 1) * (1 + 0.1 * gapeK), (A.bodyK || 1))
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
  g.beginPath(); g.moveTo(-slope * (capY + gap - apex), capY + gap); g.lineTo(slope * (capY + gap - apex), capY + gap); g.lineTo(half, base); g.lineTo(-half, base); g.closePath(); g.fill()
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
      for (let s = 1; s <= 3; s++) { const t = s / 3; g.lineTo(x0 + Math.sin(now * 0.012 * mo + k * 1.7 + s) * R * 0.05 * t, y0 + len * t) }
      x0 = u * 2 * wTop * 0.9; y0 = capY + gap
      g.moveTo(x0, y0)
      for (let s = 1; s <= 3; s++) { const t = s / 3; g.lineTo(x0 + Math.sin(now * 0.011 * mo + k * 2.3 + s) * R * 0.05 * t, y0 - len * t) }
    }
    g.stroke()
  }
  g.shadowBlur = 0
  g.beginPath()
  g.moveTo(-slope * (capY + gap - apex), capY + gap); g.lineTo(slope * (capY + gap - apex), capY + gap)
  edgeSegments(A, 0, tc, 1); edgeSegments(A, 1, 0, 1); edgeSegments(A, 2, 0, 1 - tc)
  g.stroke()
  // the summoning ring
  if (A.mood === 'summoning') {
    g.strokeStyle = rgba(BLOOD, 0.6 + 0.4 * Math.sin(now * 0.006 * mo)); g.lineWidth = sw * 0.9
    g.save(); g.rotate(now * 0.001 * mo); g.stroke(new Path2D(pentaPath(0, 0, R * 1.5, 0))); g.restore()
    g.beginPath(); g.arc(0, 0, R * 1.58, 0, Math.PI * 2); g.stroke()
  }
  g.restore()
}

// one pyramid side from edge parameter a to b, leaving out the root span of its front arm
function edgeSegments(A, i, a, b) {
  const R = A.r
  const px = PVX[i] * R, py = PVY[i] * R, ex = PVX[(i + 1) % 3] * R - px, ey = PVY[(i + 1) % 3] * R - py
  const gp = A.gaps[i]
  const seg = (s, e) => { if (e - s > 0.002) { g.moveTo(px + ex * s, py + ey * s); g.lineTo(px + ex * e, py + ey * e) } }
  if (!gp) { seg(a, b); return }
  seg(a, Math.min(b, gp[0])); seg(Math.max(a, gp[1]), b)
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
  g.fillStyle = SCLERA; g.strokeStyle = tone; g.lineWidth = sw * 0.7
  g.beginPath(); g.ellipse(0, 0, r, r * fore * open, 0, 0, Math.PI * 2); g.fill(); g.stroke()
  if (open > 0.15) {
    g.save(); g.clip()
    // the look, rotated back into the eye's frame
    const c = Math.cos(-rot), s = Math.sin(-rot)
    const px = (lx * c - ly * s) * r * 0.42, py = (lx * s + ly * c) * r * 0.42 * fore
    g.fillStyle = rgbaArr(col, 0.95); g.beginPath(); g.ellipse(px, py, r * 0.5, r * 0.5 * fore, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = INK; g.beginPath(); g.ellipse(px, py, r * 0.25, r * 0.25 * fore, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(-r * 0.3, -r * 0.3 * fore, r * 0.14, 0, Math.PI * 2); g.fill()
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
  const lookAt = (k, out) => {
    out[0] = Math.cos(now * 0.0009 + k * 2.3 + A.seed) * 0.6; out[1] = Math.sin(now * 0.0011 + k * 1.7) * 0.6
    if (!S || !S.wake.length) return
    const N = vis.nodes.get(S.wake[Math.max(0, S.wake.length - 1 - (k % Math.min(3, S.wake.length)))].node)
    if (!N || !N.present || !isFinite(N.x)) return
    const ddx = N.x + N.w / 2 - A.x, ddy = N.y + N.h / 2 - A.y
    const rx = ddx * Math.cos(-ta) - ddy * Math.sin(-ta), ry = ddx * Math.sin(-ta) + ddy * Math.cos(-ta), dd = Math.hypot(rx, ry) || 1
    out[0] = rx / dd; out[1] = ry / dd
  }
  // each eye blinks on its own: a brief closing now and then, deterministic in time and eye
  const blinkOf = k => { const b = (A.blink || 0) * 0.95; const own = Math.pow(Math.max(0, Math.sin(now * 0.0013 * mo + k * 7.31 + A.seed)), 60); return Math.max(b, own) }
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
    lookAt(k, prj)
    eyeball(tx, ty, Rs * (0.1 + 0.07 * rnd(A.id, k + 50)), 1, 0, prj[0], prj[1], blinkOf(k), col, tone, sw)
  }
  // the sphere
  if (q === 2) { g.shadowColor = rgbaArr(col, 0.55); g.shadowBlur = 16 * view.cam.z }
  const gr = g.createRadialGradient(-Rs * 0.35, -Rs * 0.4, Rs * 0.1, 0, 0, Rs)
  gr.addColorStop(0, '#2C3634'); gr.addColorStop(0.6, A.fill); gr.addColorStop(1, '#0B100F')
  g.fillStyle = gr; g.strokeStyle = tone; g.lineWidth = sw
  g.beginPath(); g.arc(0, 0, Rs, 0, Math.PI * 2); g.fill()
  g.shadowBlur = 0
  g.stroke()
  // the surface eyes: bulging eyeballs set into the sphere, foreshortened toward the rim and turned to face outward
  const ne = q === 2 ? SURF_EYES.length : q === 1 ? 8 : 4
  for (let k = 0; k < ne; k++) {
    const e = SURF_EYES[k], ux = e[0], uy = e[1]
    const uz = Math.sqrt(Math.max(0.05, 1 - ux * ux - uy * uy))
    const x = ux * Rs, y = uy * Rs, r = e[2] * Rs
    lookAt(k + 7, prj)
    eyeball(x, y, r, 0.4 + 0.6 * uz, Math.atan2(uy, ux) + Math.PI / 2, prj[0], prj[1], blinkOf(k + 20), col, tone, sw)
  }
}
function drawActorEye(A, now) {
  const R = A.r, z = view.cam.z, q = Q(), mo = motion()
  const tone = A.tone, col = A.col
  const sw = Math.max(1.2, 0.9 / z)
  const base = R * 0.8
  g.save()
  g.translate(A.x, A.y); g.rotate(A.tiltA || 0)
  g.globalAlpha = A.alpha
  const wk = A.waitK || 0
  g.scale((A.bodyK || 1) * (1 + 0.1 * smooth(Math.max(0, (wk - 0.45) / 0.55))), A.bodyK || 1)
  const insp = A.role === 'inspector'
  const ey = insp ? 0 : R * 0.22, ex = insp ? R * 0.6 : R * 0.52
  if (wk > 0.45) {
    // the mouth: a gaping slit lined with teeth, breathing slowly, a forked tongue flicking and writhing out of it
    const gape = smooth((wk - 0.45) / 0.55) * (0.86 + 0.14 * Math.sin(now * 0.0019 * mo))
    const mw = ex * 1.35, mh = R * 0.5 * gape
    g.beginPath(); g.moveTo(-mw, ey); g.quadraticCurveTo(0, ey - mh * 1.1, mw, ey); g.quadraticCurveTo(0, ey + mh * 1.3, -mw, ey); g.closePath()
    g.fillStyle = '#120608'; g.fill()
    g.save(); g.clip()
    const nt = 7
    g.fillStyle = '#E8E2CC'
    for (let k = 0; k < nt; k++) {
      const u = (k + 0.5) / nt, x = -mw + u * 2 * mw, edge = 1 - Math.pow(Math.abs(u * 2 - 1), 2)
      const tl = mh * 0.55 * edge
      g.beginPath(); g.moveTo(x - R * 0.06, ey - mh * 1.05 * edge); g.lineTo(x + R * 0.06, ey - mh * 1.05 * edge); g.lineTo(x, ey - mh * 1.05 * edge + tl); g.closePath(); g.fill()
      g.beginPath(); g.moveTo(x - R * 0.05 + R * 0.04, ey + mh * 1.25 * edge); g.lineTo(x + R * 0.05 + R * 0.04, ey + mh * 1.25 * edge); g.lineTo(x + R * 0.04, ey + mh * 1.25 * edge - tl * 0.8); g.closePath(); g.fill()
    }
    // the tongue
    const flick = Math.pow(Math.max(0, Math.sin(now * 0.0031 + A.seed)), 5), len = R * (0.5 + 1.1 * flick) * gape
    const dir = Math.sin(now * 0.0009 + A.seed) > 0 ? 1 : -1, wv = Math.sin(now * 0.012 * mo + A.seed)
    const tx = dir * len, ty = ey + R * 0.1 + wv * R * 0.12
    g.strokeStyle = '#B23A4A'; g.lineWidth = Math.max(1.6, R * 0.09); g.lineCap = 'round'
    g.beginPath(); g.moveTo(0, ey + mh * 0.3); g.quadraticCurveTo(dir * len * 0.5, ey + R * 0.25 - wv * R * 0.2, tx, ty); g.stroke()
    g.lineWidth = Math.max(1, R * 0.06)
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + dir * R * 0.18, ty - R * 0.12 + wv * R * 0.05); g.moveTo(tx, ty); g.lineTo(tx + dir * R * 0.18, ty + R * 0.12 + wv * R * 0.05); g.stroke()
    g.restore()
    g.strokeStyle = tone; g.lineWidth = sw * 1.2
    g.beginPath(); g.moveTo(-mw, ey); g.quadraticCurveTo(0, ey - mh * 1.1, mw, ey); g.moveTo(-mw, ey); g.quadraticCurveTo(0, ey + mh * 1.3, mw, ey); g.stroke()
    g.restore()
    return
  }
  const blink = A.blink || 0
  const open = A.open * (1 - blink * 0.95) * (1 - Math.min(1, wk / 0.45))
  const oy = R * 0.36 * open
  g.beginPath(); g.moveTo(-ex, ey); g.quadraticCurveTo(0, ey - oy, ex, ey); g.quadraticCurveTo(0, ey + oy, -ex, ey); g.closePath()
  g.fillStyle = SCLERA; g.fill()
  if (open > 0.12) {
    g.save(); g.clip()
    let lx = A.look[0] * R * 0.2, ly = A.look[1] * R * 0.1
    if (A.mood === 'scrying' && mo > 0) lx += Math.sin(now * 0.0026) * R * 0.15
    const ir = R * 0.26 * (A.mood === 'writing' ? 1 + 0.1 * Math.sin(now * 0.009 * mo) : 1)
    g.fillStyle = rgbaArr(col, 0.95); g.beginPath(); g.arc(lx, ey + ly, ir, 0, Math.PI * 2); g.fill()
    g.fillStyle = INK; g.beginPath(); g.ellipse(lx, ey + ly, R * 0.07, R * 0.25, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(lx - R * 0.08, ey + ly - R * 0.1, R * 0.05, 0, Math.PI * 2); g.fill()
    g.restore()
  }
  g.strokeStyle = tone; g.lineWidth = sw
  g.beginPath(); g.moveTo(-ex, ey); g.quadraticCurveTo(0, ey - oy, ex, ey); g.moveTo(-ex, ey); g.quadraticCurveTo(0, ey + oy, ex, ey); g.stroke()
  // rays of providence when awake and busy
  if (q >= 1 && !insp && A.mood !== 'thinking' && A.mood !== 'idle') {
    g.strokeStyle = rgbaArr(col, 0.35); g.lineWidth = sw * 0.7
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

function drawCreatures(T, now) {
  for (const P of vis.props.values()) { const A = vis.actors.get(P.actor); if (A && P.alpha > 0.02) drawProp(P, A, now) }
  for (const P of vis.portals.values()) { const A = vis.actors.get(P.actor); if (A && A.alpha > 0.02) drawPortal(P, A, now) }
  // root spans of the attached front arms, so the body outline can skip them
  for (const A of vis.actors.values()) A.gaps = [null, null, null]
  for (const L of vis.limbs.values()) {
    const A = vis.actors.get(L.actor)
    if (!A || !attached(L) || L.ext < 0.02 || L.side < 0) continue
    limbRoot(A, L)
    const hw = baseWidth(L, A) / 2 / ROOT[6]
    A.gaps[L.side] = [L.rootT - hw, L.rootT + hw]
  }
  // arms behind the body first, then the bodies, then each side's attached front arm, then the eyes
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) for (const A of vis.actors.values()) if (A.alpha > 0.01) { drawTendrils(A, now); drawActor(A, now) }
    for (const L of vis.limbs.values()) {
      if (attached(L) !== (pass === 1)) continue
      const A = vis.actors.get(L.actor)
      if (!A || A.alpha < 0.02) continue
      drawLimb(L, A, now)
    }
  }
  for (const A of vis.actors.values()) if (A.alpha > 0.01 && A.knot < 0.98) drawActorEye(A, now)
  drawGlances(T, now)
}

// ----- captions: what each actor is doing, floating above its working area -----

const CAP_MAX = 48
function excerpt(t, n) { return clip(String(t || '').replace(/\s+/g, ' ').trim(), n) }
function targetName(S, act) {
  const n = act.node ? S.nodes.get(act.node) : null
  if (!n) return ''
  return n.name + (act.member ? '.' + act.member : '')
}
function actLine(S, a, act, T) {
  const tgt = targetName(S, act)
  if (act.waitT > 0 && !act.endT) return excerpt('Waiting for your approval: ' + act.kind + (tgt ? ' ' + tgt : ''), CAP_MAX)
  const det = act.detail ? excerpt(act.detail, 28) : ''
  let s
  switch (act.kind) {
    case 'read': s = 'Reading ' + (tgt || det || 'a file'); break
    case 'search': s = 'Searching' + (det ? " '" + det + "'" : '') + (tgt ? ' in ' + tgt : ''); break
    case 'edit': s = 'Editing ' + (tgt || det || 'a file'); break
    case 'write': s = 'Writing ' + (tgt || det || 'a file'); break
    case 'bash': s = (act.look ? 'Looking: ' : 'Running: ') + (det || act.tool); break
    case 'agent': {
      let label = det || 'a thrall'
      for (const sub of S.actors.values()) if (sub.parent === a.id && sub.bornT >= act.startT && sub.bornT <= T) { label = sub.label; break }
      s = (T - act.startT < SUMMON_MS ? 'Summoning ' : 'Overseeing ') + label; break
    }
    case 'web': s = 'Browsing ' + (det || 'the web'); break
    case 'todo': s = 'Updating the plan'; break
    default: s = (act.look ? 'Looking up with ' : 'Using ') + (act.tool || 'a tool') + (det ? ': ' + det : '')
  }
  return excerpt(s, CAP_MAX)
}

const capRects = []
function syncCaptions(S, T, now, dt) {
  for (const A of vis.actors.values()) {
    const a = S.actors.get(A.id)
    if (!a) { A.cap1a = ease(A.cap1a || 0, 0, 4, dt); A.cap2a = ease(A.cap2a || 0, 0, 4, dt); continue }
    if (!A.capX) { A.capX = A.x; A.capY = A.y - 70; A.cap1a = 0; A.cap2a = 0; A.cap1 = ''; A.cap2 = ''; A.capNudge = 0 }
    const act = focus.cur.get(A.id)
    const open = act && !act.endT
    let line1 = ''
    if (open) line1 = actLine(S, a, act, T)
    else if (a.thinking) line1 = 'Thinking'
    else if (act && T - act.endT < 4000) line1 = A.cap1 || actLine(S, a, act, T)
    if (line1) A.cap1 = line1
    const want1 = line1 && !A.knotT ? 1 : 0
    A.cap1a = ease(A.cap1a, want1 * (A.present ? 1 : 0), want1 ? 5 : 2.5, dt)
    // line 2: the task and who gave it
    let line2 = ''
    const pr = a.parent ? null : promptFor(S, a.id)
    if (a.parent) line2 = excerpt(a.task || a.label, 34) + ' · from ' + (a.by || 'Claude')
    else if (pr && pr.t <= T) line2 = excerpt(pr.text, 34) + ' · from ' + (pr.by || 'you')
    if (line2) A.cap2 = line2
    A.cap2a = ease(A.cap2a, line2 && A.present && !A.knotT ? 1 : 0, 3, dt)
    // anchor: above the target tome when there is one, else above the creature; never over the target
    let ax = A.x, ay = A.y - A.r * 1.7
    const N = open && act.node ? vis.nodes.get(act.node) : null
    if (N && N.present) { ax = N.x + N.w / 2; ay = N.y - 34 }
    else if (A.thrall) { const Th = vis.actors.get(A.thrall); if (Th) { ax = Th.x; ay = Th.y - Th.r * 2.2 } }
    A.capX = ease(A.capX, ax, 6, dt); A.capY = ease(A.capY, ay, 6, dt)
  }
}

function drawCaptions(now) {
  const z = view.cam.z
  const list = []
  for (const A of vis.actors.values()) if (A.capX !== undefined && (A.cap1a > 0.02 || A.cap2a > 0.02)) list.push(A)
  if (!list.length) return
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  // captions near each other form a stack (most recently active at the bottom); a crowded spot shows at most 3
  for (const A of list) { A.csx = (A.capX - view.cam.x) * z + view.w / 2; A.csy = (A.capY - view.cam.y) * z + view.h / 2; A.cluster = -1 }
  const clusters = []
  for (const A of list) {
    for (let c = 0; c < clusters.length; c++) { const h = clusters[c][0]; if (Math.abs(h.csx - A.csx) < 260 && Math.abs(h.csy - A.csy) < 110) { A.cluster = c; clusters[c].push(A); break } }
    if (A.cluster < 0) { A.cluster = clusters.length; clusters.push([A]) }
  }
  for (const cl of clusters) {
    cl.sort((p, q) => (q.lastT || 0) - (p.lastT || 0))
    let ax = 0, ay = 1e9
    for (const A of cl) { ax += A.csx / cl.length; ay = Math.min(ay, A.csy) }
    for (let i = 0; i < cl.length; i++) {
      const A = cl[i]
      A.capHide = ease(A.capHide || 0, i >= 3 ? 1 : 0, 6, 1 / 60)
      const h = (A.cap1a > 0.02 ? 15 : 0) + (A.cap2a > 0.02 ? 13 : 0) + 8
      A.capNudge = ease(A.capNudge || 0, cl.length > 1 ? Math.min(i, 2) * h : 0, 8, 1 / 60)
      const sx = cl.length > 1 ? ax : A.csx
      let sy = (cl.length > 1 ? ay : A.csy) - A.capNudge
      const show = 1 - A.capHide
      if (show < 0.02) continue
      // free space: lift the block until it covers neither a card nor a ward label; a leader line marks the offset
      g.font = '12px ' + FONT
      const cw = Math.max(g.measureText(A.cap1 || '').width, g.measureText(A.cap2 || '').width * 0.92) + 12
      let lift = 0
      for (let tries = 0; tries < 8; tries++) {
        const x0 = sx - cw / 2, y0 = sy - lift - h, x1 = sx + cw / 2, y1 = sy - lift
        let hit = false
        for (const N of vis.nodes.values()) {
          if (!N.present || N.alpha < 0.3 || N.pile > 0.5) continue
          const nx0 = (N.x - view.cam.x) * z + view.w / 2, ny0 = (N.y - view.cam.y) * z + view.h / 2, nx1 = nx0 + N.w * z, ny1 = ny0 + N.h * z
          if (x0 < nx1 && x1 > nx0 && y0 < ny1 && y1 > ny0) { hit = true; break }
        }
        if (!hit) for (const W of vis.wards.values()) {
          if (W.alpha < 0.3 || W.labW === undefined) continue
          const wx0 = (W.labX - view.cam.x) * z + view.w / 2, wy0 = (W.labY - view.cam.y) * z + view.h / 2, wx1 = wx0 + W.labW * z, wy1 = wy0 + W.labH * z
          if (x0 < wx1 && x1 > wx0 && y0 < wy1 && y1 > wy0) { hit = true; break }
        }
        // nor a creature (its body with some room), nor a caption already placed this frame
        if (!hit) for (const O of vis.actors.values()) {
          if (O.alpha < 0.2) continue
          const m = O.r * 2.4 * z, ox = (O.x - view.cam.x) * z + view.w / 2, oy = (O.y - view.cam.y) * z + view.h / 2
          if (x0 < ox + m && x1 > ox - m && y0 < oy + m && y1 > oy - m) { hit = true; break }
        }
        if (!hit) for (const r of capRects) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) { hit = true; break }
        if (!hit) break
        lift += 18
      }
      capRects.push([sx - cw / 2, sy - lift - h, sx + cw / 2, sy - lift])
      A.capLift = ease(A.capLift || 0, lift, 8, 1 / 60)
      if (A.capLift > 14) { g.strokeStyle = rgba(ASH, 0.5 * show); g.lineWidth = 1; g.beginPath(); g.moveTo(sx, sy + 2); g.lineTo(sx, sy - A.capLift + 2); g.stroke() }
      sy -= A.capLift
      let y = sy - 4
      if (A.cap2a > 0.02) { g.font = '11px ' + FONT; g.fillStyle = rgba(ASH, 0.9 * A.cap2a * show); g.fillText(A.cap2, sx, y); y -= 14 }
      if (A.cap1a > 0.02) { g.font = '500 12px ' + FONT; g.fillStyle = rgba(BONE, 0.92 * A.cap1a * show); g.fillText(A.cap1, sx, y) }
    }
  }
  g.textAlign = 'left'
}

// ----- timeline bar, hint, tooltip -----

const tickCanvas = document.createElement('canvas')
function rebuildTicks(t0, t1) {
  const w = Math.max(1, Math.round(view.w * view.dpr)), h = Math.round(12 * view.dpr)
  if (tickCanvas.width !== w || tickCanvas.height !== h) { tickCanvas.width = w; tickCanvas.height = h }
  const tg = tickCanvas.getContext('2d')
  tg.clearRect(0, 0, w, h)
  const span = Math.max(1, t1 - t0)
  const bins = new Uint8Array(w)
  const evs = H.events
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    let lvl = 0
    if (e.type === 'act') lvl = e.kind === 'edit' || e.kind === 'write' ? 2 : 1
    else if (e.type === 'edge') lvl = (e.state === 'live' && !e.baseline) || e.state === 'gone' ? 2 : 0
    else if (e.type === 'ext') lvl = 2
    else if (e.type === 'node' || e.type === 'actor') lvl = 1
    if (!lvl) continue
    const x = Math.min(w - 1, Math.max(0, Math.floor((e.t - t0) / span * w)))
    if (bins[x] < lvl) bins[x] = lvl
  }
  tg.fillStyle = 'rgba(220,210,176,0.3)'
  for (let x = 0; x < w; x++) if (bins[x] === 1) tg.fillRect(x, h - 4 * view.dpr, 1, 4 * view.dpr)
  tg.fillStyle = rgba(EMBER, 0.75)
  for (let x = 0; x < w; x++) if (bins[x] === 2) tg.fillRect(x, h - 10 * view.dpr, 1, 10 * view.dpr)
}

// ---------- the project's name, in occult lettering, at the top of the screen ----------
// The one ornate face in the view: a serif in bone and parchment with a thin blood-red stroke, letters spaced
// and set on a slightly uneven baseline (fixed per letter), sigils either side, a faint smoky glow, and a very
// slow breathing shimmer. It steps back to 40% when the map's content sits underneath it.
const TITLE_FONT = 'Georgia, "Palatino Linotype", "Book Antiqua", serif'
// before the first event arrives (a fresh pane, a thumbnail taken right after load): the glyph, the name, and the
// well, so the first frame already looks like the view rather than a dark sheet
function drawAwaiting(now, alpha) {
  const q = Q(), mo = motion()
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  const cx = view.w / 2, cy = view.h * 0.56, R = Math.min(view.w, view.h) * 0.3
  g.save()
  g.globalAlpha = alpha
  if (alpha < 1) { g.fillStyle = VOID; g.fillRect(0, 0, view.w, view.h) }
  g.globalAlpha = alpha
  for (let k = 5; k >= 0; k--) {
    const u = k / 5, r = R * (0.18 + 0.82 * u)
    g.strokeStyle = rgba(VIOLET, 0.06 + 0.12 * (1 - u)); g.lineWidth = 1 + (1 - u) * 1.5
    g.beginPath(); g.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2); g.stroke()
  }
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5)
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, R * 0.5, R * 0.21, 0, 0, Math.PI * 2); g.fill()
  const fs = clamp(Math.round(view.w / 30), 20, 40)
  const breathe = 0.5 + 0.5 * Math.sin(now * 0.0006) * mo
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  if (q >= 1) { g.shadowColor = 'rgba(110,80,150,' + (0.45 + 0.25 * breathe).toFixed(2) + ')'; g.shadowBlur = 14 + 8 * breathe }
  g.font = '600 ' + fs + 'px ' + TITLE_FONT; g.fillStyle = BONE; g.globalAlpha = 0.85 + 0.15 * breathe
  g.fillText('ABYSSAL EYE', cx, fs * 1.55)
  g.shadowBlur = 0
  // the loader: a slow spiral of fading dots, brass at the heart turning violet outward, under the title; while
  // the stream is still arriving a thin arc round it fills with the share received
  const lx = cx, ly = fs * 1.55 + 46, turn = now * 0.0025 * Math.max(0.3, mo)
  for (let i = 0; i < 30; i++) {
    const t = i / 29, a = turn + i * 0.46, r = 2.5 + t * 16
    const c = rgb(BRASS), v = rgb(VIOLET)
    const col = [c[0] + (v[0] - c[0]) * t, c[1] + (v[1] - c[1]) * t, c[2] + (v[2] - c[2]) * t]
    g.fillStyle = rgbaArr(col, (1 - t * 0.85) * alpha); g.beginPath(); g.arc(lx + Math.cos(a) * r, ly + Math.sin(a) * r, 1.2 + (1 - t) * 1.1, 0, Math.PI * 2); g.fill()
  }
  if (load.active) {
    g.strokeStyle = rgba(VIOLET, 0.18 * alpha); g.lineWidth = 1; g.beginPath(); g.arc(lx, ly, 22, 0, Math.PI * 2); g.stroke()
    const frac = load.total > 0 ? clamp(load.got / load.total, 0, 1) : -1
    g.strokeStyle = rgba(BRASS, 0.8 * alpha); g.lineWidth = 1.6; g.lineCap = 'round'; g.beginPath()
    if (frac >= 0) g.arc(lx, ly, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
    else { const s = now * 0.003; g.arc(lx, ly, 22, s, s + 1.2) }
    g.stroke()
  }
  // a small pentagram either side of the name (drawn, so no font is needed for it)
  const half = g.measureText('ABYSSAL EYE').width / 2 + fs * 0.75
  g.strokeStyle = rgba(BONE, 0.7); g.lineWidth = 1.2
  for (const sx of [cx - half, cx + half]) { g.stroke(new Path2D(pentaPath(sx, fs * 1.2, fs * 0.32, now * 0.0003 * mo))); g.beginPath(); g.arc(sx, fs * 1.2, fs * 0.32, 0, Math.PI * 2); g.stroke() }
  g.shadowBlur = 0; g.globalAlpha = 0.6
  g.font = '12px ' + FONT; g.fillStyle = ASH
  g.fillText(load.active ? (load.total > 0 ? 'gathering ' + load.got + ' of ' + load.total : 'reaching for the stream') : DEMO ? 'the demo is stirring' : 'waiting for a session to stir', cx, cy + R * 0.6)
  g.restore()
}
function drawTitle(now) {
  const root = H.state.root || ''
  if (!root) return
  const parts = root.split(/[\\/]+/).filter(Boolean)
  const name = (parts.length ? parts[parts.length - 1] : root).toUpperCase()
  const mo = motion(), q = Q()
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  const fs = clamp(Math.round(view.w / 30), 20, 40), sp = fs * 0.26
  g.font = '600 ' + fs + 'px ' + TITLE_FONT
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  const widths = []
  let tw = 0
  for (let i = 0; i < name.length; i++) { const w = g.measureText(name[i]).width; widths.push(w); tw += w + sp }
  tw -= sp
  const x0 = view.w / 2 - tw / 2, y = fs * 1.55
  // content underneath (a card's screen rect crossing the title band) dims the title
  const c = view.cam
  let under = false
  for (const V of vis.nodes.values()) {
    if (!V.present || V.alpha < 0.3) continue
    const sx = (V.x - c.x) * c.z + view.w / 2, sy = (V.y - c.y) * c.z + view.h / 2, sw = V.w * c.z, sh = V.h * c.z
    if (sx < x0 + tw + fs * 2 && sx + sw > x0 - fs * 2 && sy < y + fs * 0.4 && sy + sh > y - fs * 1.2) { under = true; break }
  }
  view.titleDim = ease(view.titleDim === undefined ? 0 : view.titleDim, under ? 1 : 0, 3, 1 / 60)
  const breathe = 0.5 + 0.5 * Math.sin(now * 0.0006) * mo
  g.save()
  g.globalAlpha = (0.9 - 0.5 * view.titleDim) * (0.88 + 0.12 * breathe)
  if (q >= 1) { g.shadowColor = 'rgba(110,80,150,' + (0.45 + 0.25 * breathe).toFixed(2) + ')'; g.shadowBlur = 14 + 8 * breathe }
  const grad = g.createLinearGradient(0, y - fs, 0, y)
  grad.addColorStop(0, BONE); grad.addColorStop(1, PARCH)
  let x = x0
  for (let i = 0; i < name.length; i++) {
    const jy = (rnd('title', i) - 0.5) * fs * 0.09, jr = (rnd('tilt', i) - 0.5) * 0.05
    g.save(); g.translate(x + widths[i] / 2, y + jy); g.rotate(jr)
    g.lineWidth = Math.max(1, fs * 0.05); g.strokeStyle = rgba('#5A1414', 0.85); g.lineJoin = 'round'
    g.strokeText(name[i], -widths[i] / 2, 0)
    g.fillStyle = grad; g.fillText(name[i], -widths[i] / 2, 0)
    g.restore()
    x += widths[i] + sp
  }
  g.shadowBlur = 0
  // sigils either side: a ringed triangle with a dot, the entity's mark
  g.strokeStyle = rgba(PARCH, 0.7); g.lineWidth = 1; g.fillStyle = rgba('#5A1414', 0.9)
  for (const sx of [x0 - fs * 1.1, x0 + tw + fs * 1.1]) {
    const sy = y - fs * 0.36, r = fs * 0.26
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.stroke()
    g.beginPath(); g.moveTo(sx, sy - r * 0.75); g.lineTo(sx + r * 0.68, sy + r * 0.5); g.lineTo(sx - r * 0.68, sy + r * 0.5); g.closePath(); g.stroke()
    g.beginPath(); g.arc(sx, sy + r * 0.08, r * 0.14, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.moveTo(sx - r * 1.6, sy); g.lineTo(sx - r * 1.15, sy); g.moveTo(sx + r * 1.15, sy); g.lineTo(sx + r * 1.6, sy); g.stroke()
  }
  g.restore()
}
function drawTimeline(now, wall) {
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  const y = view.h - BAR_H
  g.fillStyle = 'rgba(12,16,15,0.75)'; g.fillRect(0, y, view.w, BAR_H)
  g.fillStyle = 'rgba(220,210,176,0.08)'; g.fillRect(0, y, view.w, 1)
  const t0 = H.t0 || wall, t1 = Math.max(wall, t0 + 1000)
  if (H.events.length !== view.tickCount || view.tickW !== view.w || now - view.tickAt > 400) { rebuildTicks(t0, t1); view.tickCount = H.events.length; view.tickW = view.w; view.tickAt = now }
  g.drawImage(tickCanvas, 0, y + 4, view.w, 12)
  const hx = view.handle * (view.w - 12) + 6
  g.fillStyle = view.live ? rgba(BRASS, 0.9) : rgba(EMBER, 0.95)
  g.beginPath(); g.arc(hx, y + BAR_H / 2, 5, 0, Math.PI * 2); g.fill()
  g.strokeStyle = rgba(BONE, 0.6); g.lineWidth = 1; g.stroke()
  if (!view.live) { g.fillStyle = rgba(EMBER, 0.35); g.fillRect(hx, y + BAR_H / 2 - 1, view.w - hx, 2) }
  if (view.hint.until > now) {
    const a = c01((view.hint.until - now) / 600)
    g.font = '12px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = rgba(BONE, 0.85 * a); g.fillText(view.hint.text, view.w / 2, y - 16); g.textAlign = 'left'
  }
}

// is there a binding between two tomes?
function bound(A, B) { return vis.edges.has(A.id + '>' + B.id) || vis.edges.has(B.id + '>' + A.id) }
// pins: user-placed homes, kept per project
const pins = { root: '', map: new Map() }
function pinsLoad() {
  const root = H.state.root || ''
  if (root === pins.root) return
  pins.root = root; pins.map.clear()
  try { const o = JSON.parse(localStorage.getItem('abyssal-eye.pins:' + root) || '{}'); for (const k in o) pins.map.set(k, o[k]) } catch (e) { /* ignore */ }
  for (const V of vis.nodes.values()) V.pin = pins.map.get(V.id) || null
}
function pinsSave() {
  const o = {}; for (const [k, v] of pins.map) o[k] = v
  try { localStorage.setItem('abyssal-eye.pins:' + pins.root, JSON.stringify(o)) } catch (e) { /* ignore */ }
}
function pinSet(V, x, y) { V.pin = [x, y]; pins.map.set(V.id, V.pin); pinsSave() }
function pinClear(V) { V.pin = null; pins.map.delete(V.id); pinsSave(); pack.sig = '' }
function hoverNode() {
  if (view.mx < 0 || view.my > view.h - BAR_H - 4) return null
  const p = toWorld(view.mx, view.my)
  for (const V of vis.nodes.values()) if (V.present && V.alpha > 0.5 && p[0] >= V.x && p[0] <= V.x + V.w && p[1] >= V.y && p[1] <= V.y + V.h) return V
  return null
}

function updateTooltip() {
  const V = view.drag ? null : hoverNode()
  const Mg = V || view.drag ? null : hoverEdge()
  const tipKey = V ? 'n:' + V.id : Mg ? 'e:' + Mg.key + ':' + Mg.n : ''
  if (V !== view.hover || Mg !== view.hoverEdge || tipKey !== view.tipKey) {
    view.hover = V; view.hoverEdge = Mg; view.tipKey = tipKey
    if (V) { tipEl.textContent = V.name + '  (' + V.kind + ')\n' + V.file + (V.lines ? '\n' + V.lines + ' lines' : ''); tipEl.style.display = 'block' }
    else if (Mg) { tipEl.textContent = edgeTip(Mg); tipEl.style.display = 'block' }
    else tipEl.style.display = 'none'
  }
  if (V || Mg) { tipEl.style.left = Math.min(view.w - 300, view.mx + 14) + 'px'; tipEl.style.top = Math.min(view.h - 110, view.my + 14) + 'px' }
}

function showHint(text) { view.hint.text = text; view.hint.until = performance.now() + 1800 }

// ---------- input ----------

function userInput() { view.userUntil = performance.now() + 10000 }

canvas.addEventListener('wheel', e => {
  e.preventDefault()
  const cam = view.cam
  const before = toWorld(e.clientX, e.clientY)
  cam.tz = clamp(cam.tz * Math.exp(-e.deltaY * 0.0014), 0.15, 4)
  // keep the world point under the cursor fixed at the target zoom
  cam.tx = before[0] - (e.clientX - view.w / 2) / cam.tz
  cam.ty = before[1] - (e.clientY - view.h / 2) / cam.tz
  userInput()
}, { passive: false })

function scrubAt(x) {
  const f = clamp((x - 6) / (view.w - 12), 0, 1)
  view.hf = f
  if (f >= 0.995) { view.live = true }
  else { view.live = false; const now = Date.now(); view.T = (H.t0 || now) + f * (Math.max(now, (H.t0 || now) + 1000) - (H.t0 || now)) }
}

canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 && e.button !== 2) return
  view.mx = e.clientX; view.my = e.clientY
  if (e.clientY >= view.h - BAR_H - 6) { if (e.button === 0) { view.scrub = true; scrubAt(e.clientX) }; return }
  // a card under the cursor is picked up instead of panning
  const N = e.button === 0 && !e.shiftKey ? hoverNode() : null
  if (N) {
    const p = toWorld(e.clientX, e.clientY)
    view.dragNode = N; N.dragFrom = [N.lx, N.ly]; N.dragOff = [N.lx - p[0], N.ly - p[1]]
    view.drag = { x: e.clientX, y: e.clientY, moved: false, node: true }
    layout.awake = Math.max(layout.awake, 60)
    return
  }
  view.drag = { x: e.clientX, y: e.clientY, cx: view.cam.tx, cy: view.cam.ty, moved: false, tilt: e.button === 2 || e.shiftKey, deg: tilt.deg }
})
window.addEventListener('mousemove', e => {
  view.mx = e.clientX; view.my = e.clientY
  if (view.scrub) { scrubAt(e.clientX); return }
  const d = view.drag
  if (d) {
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true
    if (d.node) {
      if (d.moved && view.dragNode) { const p = toWorld(e.clientX, e.clientY); const N = view.dragNode; pinSet(N, p[0] + N.dragOff[0], p[1] + N.dragOff[1]); if (!N.pinnedByDrag) { N.pinnedByDrag = true; pack.sig = '' }; layout.awake = Math.max(layout.awake, 30); userInput(); canvas.style.cursor = 'grabbing' }
    }
    else if (d.moved && d.tilt) { setTilt(d.deg - dy * 0.12); userInput(); canvas.style.cursor = 'ns-resize' }
    else if (d.moved) { view.cam.tx = d.cx - dx / view.cam.tz; view.cam.ty = d.cy - dy / view.cam.tz; userInput(); canvas.style.cursor = 'grabbing' }
  }
})
window.addEventListener('mouseup', () => { view.scrub = false; view.drag = null; if (view.dragNode) { view.dragNode.pinnedByDrag = false; view.dragNode = null; layout.awake = Math.max(layout.awake, 60) } canvas.style.cursor = 'default' })
canvas.addEventListener('mouseleave', () => { view.mx = -1; view.my = -1 })
canvas.addEventListener('dblclick', e => { const N = hoverNode(); if (N) { if (N.pin) pinClear(N) } else if (e.clientY < view.h - BAR_H - 6) view.userUntil = 0 })
window.addEventListener('keydown', e => {
  if (e.key === 'q' || e.key === 'Q') { settings.q = (settings.q + 1) % 3; saveSettings(); resize(); showHint('quality: ' + QUAL[settings.q]) }
  else if (e.key === 'm' || e.key === 'M') { settings.m = (settings.m + 1) % 3; saveSettings(); showHint('motion: ' + MOT[settings.m]) }
})
window.addEventListener('resize', resize)
// the pane may open collapsed or hidden and gain its size later: every change of size (and every return to view)
// resizes the canvas, and the first real size frames the map
if (typeof ResizeObserver === 'function') { try { new ResizeObserver(() => { if (window.innerWidth >= 2 && window.innerHeight >= 2) wake(); else resize() }).observe(document.documentElement) } catch (e) { /* no observer */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) resize() })

// ---------- main loop ----------

const NOPAUSE = DEBUG && /[?&]nopause/.test(location.search)
let last = 0, rafId = 0, pollAt = 0
function schedule() { rafId = NOPAUSE ? setTimeout(() => frame(performance.now()), 16) : requestAnimationFrame(frame) }
// a pane that is open but not shown gets no animation frames at all (and reports a 0 by 0 window, not hidden):
// a watchdog keeps the state current with one frame a second, so the first shown frame is already the live map
let lastFrameAt = 0
setInterval(() => { if (rafId && !NOPAUSE && performance.now() - lastFrameAt > 1500) { stop(); frame(performance.now()) } }, 1000)
// the eased state (layout, card sizes, creature bodies, limbs, camera) is run ahead to rest, so a replayed map
// appears at its settled size and place from its first frame rather than easing in from defaults
function settle(S, T, now) {
  // the run-ahead plays the last few seconds, so clock-driven motion (transfers, trails) is already past too
  const dt = 1 / 30, steps = 120
  const run = (n, from) => {
    for (let i = 0; i < n; i++) {
      const t = now - (from - i) * dt * 1000
      syncActors(S, T, t, dt)
      syncLimbs(S, T, t, dt)
      packStep(dt)
      layoutStep(dt)
      animate(dt, t)
      syncWhirls(S, T, t, dt)
    }
  }
  // creatures swim to their places at their own pace: after the run they are put there, then the limbs catch up
  const seat = () => { for (const A of vis.actors.values()) if (A.present && isFinite(A.gx) && isFinite(A.gy)) { A.x = A.gx; A.y = A.gy; A.vx = 0; A.vy = 0; A.swim = null } }
  run(steps, steps + 30); seat(); run(30, 30); seat()
  view.framed = false
  for (const A of vis.actors.values()) { A.waitK = A.waitT || 0; A.bodyK = 1 + 0.3 * smooth(A.waitK) }
}
function frame(ts) {
  // a gap of more than 10 s between frames means the page was frozen (a discarded or throttled tab): the stream is
  // refetched from the start so nothing that happened meanwhile is missing
  if (lastFrameAt && performance.now() - lastFrameAt > 10000 && !DEMO) { resetAll(); src.seq = 0; src.epoch = null; src.retryAt = 0; loadReset() }
  lastFrameAt = performance.now()
  schedule()
  const now = performance.now()
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
  last = now
  frameDt = dt
  if ((window.innerWidth !== view.w || window.innerHeight !== view.h) && window.innerWidth > 1 && window.innerHeight > 1) resize()
  const wall = Date.now()
  const T = view.live ? wall : view.T
  foldTo(T)
  const S = H.state
  collectActs(S, T)
  pinsLoad()
  syncNodes(S, T)
  syncActors(S, T, now, dt)
  syncEdges(S, T)
  syncLimbs(S, T, now, dt)
  syncDust(S, T, dt)
  syncSouls(S, T, now, dt)
  if (view.needSettle) { view.needSettle = false; settle(S, T, now) }
  packStep(dt)
  layoutStep(dt)
  animate(dt, now)
  syncDrips(dt)
  syncBubbles(dt)
  syncSkulls(dt, now)
  syncWards()
  syncWhirls(S, T, now, dt)
  syncCaptions(S, T, now, dt)
  syncVeins()
  cameraFollow(dt, now)
  // draw
  const c = view.cam
  cull.x0 = c.x - view.w / 2 / c.z - 60; cull.y0 = c.y - view.h / 2 / c.z - 60; cull.x1 = c.x + view.w / 2 / c.z + 60; cull.y1 = c.y + view.h / 2 / c.z + 60
  drawBackground()
  // loading: the scene is folded and settled off screen; only the plate shows until everything is here
  if (load.active) { drawAwaiting(now, 1); return }
  load.reveal = load.doneAt ? Math.min(1, (performance.now() - load.doneAt) / 900) : 1
  if (!H.state.root) drawAwaiting(now, 1)
  worldTransform()
  drawWeb(now)
  drawDust(now)
  drawSouls(now)
  drawSkulls(now)
  drawWards(now)
  drawWhirls(now)
  for (const A of vis.actors.values()) { const P = A.parent ? vis.actors.get(A.parent) : null; if (P && A.alpha > 0.02) drawBranch(A, P, now) }
  drawEdges(now)
  drawTrails(T, now)
  drawTomes(now)
  drawDrips()
  drawPiles()
  drawBubbles()
  drawCreatures(T, now)
  drawTransmits(T, now)
  drawCaptions(now)
  drawTitle(now)
  drawTimeline(now, wall)
  updateTooltip()
  // the reveal: the plate fades away over the finished map
  if (load.reveal < 1) drawAwaiting(now, 1 - smooth(load.reveal))
}

let pageVersion = null
// the heartbeat: every 3 s the page tells the server it is here (its instance id, the version it loaded, whether it
// is shown); the answer carries the current version, and a changed one reloads the page
const PAGE_ID = Math.random().toString(36).slice(2, 10)
const PAGE_KEY = (/\/p\/([^/]+)\//.exec(location.pathname) || [])[1] || ''
function heartbeat() {
  if (DEMO || !PAGE_KEY) return
  const vis = !document.hidden && window.innerWidth >= 2 && window.innerHeight >= 2 ? 1 : 0
  fetch('/seen?p=' + encodeURIComponent(PAGE_KEY) + '&i=' + PAGE_ID + '&v=' + encodeURIComponent(pageVersion || '') + '&vis=' + vis, { method: 'POST' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (!j) return; if (j.reload) { location.reload(); return } if (j.version) { const v = String(j.version); if (pageVersion === null) pageVersion = v; else if (v !== pageVersion) location.reload() } })
    .catch(() => { /* the server may be gone; the polls will find out */ })
}
setInterval(heartbeat, 3000)
setTimeout(heartbeat, 0)
// shown or hidden: the server hears it at once, so an open press sees the true state without a wait
document.addEventListener('visibilitychange', heartbeat)
window.addEventListener('focus', heartbeat)
function start() { if (!rafId) { last = 0; schedule() } }
function stop() { if (rafId) { cancelAnimationFrame(rafId); clearTimeout(rafId); rafId = 0 } }
// only the live instance restarts itself (a dev build injected over this one takes over the page)
const SELF = {}
// hidden: the loop stops to save work (nothing else pauses, and nothing needs a click); back in view it resumes by
// itself, resizes, and refreshes: a changed page version reloads, a long absence refetches the stream from the start
let hiddenAt = 0
function wake() {
  if (window.__scope && window.__scope.self !== SELF) return
  resize(); start()
  const away = hiddenAt ? Date.now() - hiddenAt : 0
  hiddenAt = 0
  fetch('version', { cache: 'no-store' }).then(r => r.ok ? r.text() : '').then(v => {
    v = String(v).trim()
    if (pageVersion !== null && v && v !== pageVersion) { location.reload(); return }
    if (away > 60000 && !DEMO) { resetAll(); src.seq = 0; src.epoch = null; src.retryAt = 0 }
  }).catch(() => { /* next poll */ })
}
document.addEventListener('visibilitychange', () => {
  if (window.__scope && window.__scope.self !== SELF) return
  if (document.hidden && !NOPAUSE) { hiddenAt = Date.now(); stop() } else wake()
})
window.addEventListener('focus', () => { if (!document.hidden) wake() })
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); else wake() })

resize()
view.hf = 1
start()
// inside the desktop app's browser pane (the open steps add ?pane=1): a corner control hands the view to the system
// browser through the server, since a new window from here would only be another pane tab
if (/[?&]pane=1/.test(location.search)) {
  const ext = document.getElementById('ext')
  const key = (/\/p\/([^/]+)\//.exec(location.pathname) || [])[1] || ''
  if (ext && key) {
    ext.style.display = 'block'
    ext.addEventListener('click', () => { fetch('/open-external?p=' + encodeURIComponent(key), { method: 'POST' }).catch(() => { /* the status says nothing; the server may be gone */ }) })
  }
}
// events flow on their own clock, so data keeps arriving even when frames are throttled
setInterval(poll, 150)
// auto-reload: the server's version token changes whenever the page's files change
setInterval(() => {
  fetch('version', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('http'); return r.text() }).then(v => {
    v = String(v).trim()
    if (pageVersion === null) pageVersion = v
    else if (v && v !== pageVersion) location.reload()
  }).catch(() => { /* retry on the next tick */ })
}, 5000)
// dev aid (?debug): the live state, and tick(ms) to step one frame of a given length
if (DEBUG) window.__scope = { self: SELF, H, vis, view, settings, src, demo, poll, frame, start, stop, pack, merged, bundles, layout, drags, dust, web, tilt, setTilt, ingest, limbLog, clusters, skulls, digest, load, tick: ms => { const was = !!rafId; stop(); last = performance.now() - ms; frame(performance.now()); stop(); if (was) start() } }

