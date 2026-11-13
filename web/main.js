// Abyssal Eye live view, part 5 of 5: drawing the creatures and the rest of the scene, input, the frame loop.
'use strict'
function drawSouls(now) {
  if (!vis.souls.size) return
  const z = view.cam.z, q = Q(), mo = motion()
  g.save()
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (const so of vis.souls.values()) {
    for (const s of so.list) {
      // a frightened soul shivers
      const fear = s.fear || 0, x = s.x + Math.sin(now * 0.09 + s.ph * 7) * 0.9 * fear * mo, y = s.y
      if (!inView(x - 14, y - 14, 28, 28)) continue
      const sc = s.sc * (q === 0 ? 0.8 : 1), hr = 4.2 * sc
      const al = (s.state === 'eaten' ? 0.75 : 0.62) * (s.state === 'arriving' ? 0.7 : 1)
      // two tiny wings, each soul flapping to its own phase (faster while being drawn to the cap)
      const flap = fear * Math.sin(now * 0.06 + s.ph * 5) + (1 - fear) * Math.sin(now * (s.state === 'carried' ? 0.045 : s.state === 'eaten' ? 0.026 : 0.011) * mo + s.ph * 3)
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
      const hw = s.state === 'carried' ? Math.sin(now * 0.03 + s.ph) * hr * 0.5 * (1 + fear) : Math.sin(now * 0.05 + s.ph) * hr * 0.6 * fear
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
// (fanPass: the second call of a frame, which draws only the cards of an opened pile, as the top layer)
function drawTomes(now, fanPass) {
  const z = view.cam.z, q = Q(), mo = motion()
  const bucket = bucketOf(z)
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.008 * mo)
  tomeOrder.length = 0
  for (const V of vis.nodes.values()) if (V.alpha >= 0.01 && fanHas(V) === !!fanPass && inView(V.x - 20, V.y - 20, V.w + 40, V.h + 40)) tomeOrder.push(V)
  tomeOrder.sort((a, b) => (a.y + a.h) - (b.y + b.h))
  if (fanPass) drawFan(now)
  const depthSpan = Math.max(500, pack.outerR * 1.1)
  for (const V of tomeOrder) {
    const shk = (V.shake || 0) > 0.02 ? V.shake : 0
    // (in the fan a card is folded to its title, whatever it holds)
    const x = V.x + Math.sin(now * 0.11) * 3 * shk, y = V.y + Math.cos(now * 0.13) * 2 * shk, w = V.w, h = fanPass ? HEAD_H + 4 : V.h
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
    // far out (rows under a couple of pixels), or while its bitmap waits its turn, a card is a plain slab
    const c = h * z < 13 ? null : cardFor(V, bucket)
    const sc = fanPass ? 1 : V.scale * V.depthK * (V.hub ? HUB_SCALE : 1)
    // a contact shadow where the card hangs on the sheet
    if (V.pile < 0.5 && q >= 1) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(x + w / 2, y + h + 3, w * 0.42 * sc, 4.5, 0, 0, Math.PI * 2); g.fill() }
    if (Math.abs(sc - 1) > 0.001) { g.save(); g.translate(x + w / 2, y + h / 2); g.scale(sc, sc); g.translate(-x - w / 2, -y - h / 2) }
    // the frame: a soft blobby rim round the card, slowly undulating (left out when too small to see, or on a crowded map)
    V.blobK = q >= 1 && V.pile < 0.5 && z > 0.22 && tomeOrder.length <= (q === 2 ? 600 : 300) ? 1 : 0
    if (V.blobK) {
      if (V.bseed === undefined) V.bseed = (V.seed % 628) / 100
      blobRect(x, y, w, h, CARD_RR, BLOB_BASE, BLOB_AMP, blobT, V.bseed)
      g.fillStyle = LEATHER[V.kind] || LEATHER.class; g.fill(); g.strokeStyle = rgba(BRASS, 0.85); g.lineWidth = 1.2; g.stroke()
    }
    // the bitmap is drawn 1:1 (uniform scale only); while the card's drawn size still eases toward the bitmap's,
    // the bitmap is revealed through the card rect instead of being stretched into it
    if (c) {
      const easing = Math.abs(w - c.w) > 0.5 || Math.abs(h - c.h) > 0.5
      // (in the fan: cut to the title exactly, with the card's own round corners)
      if (easing) { g.save(); g.beginPath(); if (fanPass) roundRect(x, y, w, h, CARD_RR); else roundRect(x - 2, y - 2, w + 8, h + 9, 4); g.clip() }
      g.drawImage(c.canvas, x - c.m, y - c.m, c.w + c.m * 2, c.h + c.m * 2)
      if (easing) g.restore()
    } else {
      g.fillStyle = LEATHER[V.kind] || LEATHER.class; g.fillRect(x, y, w, h)
      if (h > HEAD_H + 4) { g.fillStyle = PAGE; g.fillRect(x + 10, y + HEAD_H - 2, w - 14, h - HEAD_H - 2) }
    }
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
    // the working agent's aura round the card (its own tint; violet for your own edit), and the arcs of an edit:
    // strong as it lands, a sparse dim crackle while the taint lasts (life.js)
    {
      const ak = Math.max(V.wob || 0, V.hEdit, 0.7 * (V.taint || 0))
      if (ak > 0.03) cardAura(x, y, w, h, V.zapCol || V.taintCol || EMBER, ak, now, V.bseed || 0, z, q, mo)
      if (V.hExt > 0.03) cardAura(x, y, w, h, VIOLET, V.hExt, now, (V.bseed || 0) + 3, z, q, mo)
      if (mo > 0.02 && V.zap > 0.02) {
        const ea = focus.nodeEdit.get(V.id), EL = ea ? vis.limbs.get(ea.id) : null
        cardArcs(V, x, y, w, h, now, V.zapCol || EMBER, V.zap, z, q, EL && EL.ext > 0.6 ? EL.tx : NaN, EL ? EL.ty : NaN)
        // the flash as the edit lands
        if (V.zap > 0.8) { g.fillStyle = 'rgba(255,250,235,' + ((V.zap - 0.8) * 1.1).toFixed(3) + ')'; g.beginPath(); roundRect(x, y, w, h, CARD_RR); g.fill() }
      } else if (mo > 0.02 && V.taint > 0.02 && q >= 1 && nh(V.seed, Math.floor(now / 140)) < 0.3 + 0.25 * V.taint) cardArcs(V, x, y, w, h, now, V.taintCol || EMBER, 0.3 * V.taint, z, q, NaN, NaN)
    }
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
  // a Fable pyramid's working tentacles grow from the fringe on its lower edge (unless the target lies above it)
  if (A.fable && L && !L.eye && L.kind !== 'feed' && dy > -A.r * 0.5) return 1
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
  const inward = R * 0.45 * (1 - smooth(L.front)) - (A.fable ? fableOff(A, i, L.rootT, frameNow) : 0)
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
// (a small body has slimmer limbs in proportion, so a subagent's arms never look as wide as it is)
function limbBase(R) { return R >= 18 ? Math.max(3, R * 0.42) : Math.max(2.2, R * 0.3) }
function baseWidth(L, A) { return limbBase(A.r) * (0.45 + 0.55 * L.ext) * L.scale }

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
let limbW0 = 6, limbClub = 1, limbBlobs = null, limbBlobW = 0, limbRootB = 0
function limbWidth(t) {
  let w = limbW0 * (1 - 0.78 * t)
  if (limbClub > 0.01) { const z = (t - 0.84) / 0.065; w += limbW0 * 1.25 * Math.exp(-z * z) * limbClub; if (t > 0.9) w *= 1 - limbClub * (1 - (1 - t) / 0.1) }
  if (limbBlobs) for (let b = 0; b < limbBlobs.length; b++) { const z = (t - (1 - limbBlobs[b].u)) / 0.05; w += limbBlobW * Math.exp(-z * z) }
  // the root swells while the limb pushes out of the body
  if (limbRootB > 0.01) { const z = (t - 0.08) / 0.06; w += limbW0 * 0.45 * Math.exp(-z * z) * limbRootB }
  return Math.max(0, w)
}

function drawLimb(L, A, now) {
  const z = view.cam.z, mo = motion(), q = Q()
  const st = L.ext
  if (st < 0.01 || !L.chain) return
  limbRoot(A, L)
  const R = A.r
  const reachNow = Math.hypot(L.hx - ROOT[0], L.hy - ROOT[1])
  // reeling in, the limb keeps its thickness and its ink until the coil is swallowed at the root
  const reelK = (L.curl || 0) * Math.min(1, mo * 2), stW = st + (1 - smooth(c01((0.3 - st) / 0.3)) - st) * reelK
  limbW0 = limbBase(R) * (0.45 + 0.55 * stW) * L.scale * (1 + 0.45 * L.tipEye) * (1 - 0.15 * clamp((reachNow - 260) / 420, 0, 1))
  // the club squeezes a little while it grips a card, and stays slim on a card's rows so it hides less of them
  limbClub = L.tipClub * (1 - 0.22 * (L.grip || 0)) * (L.mode === 1 ? 0.6 : 1)
  limbBlobs = L.blobs.length ? L.blobs : null
  limbBlobW = limbW0 * 0.9
  limbRootB = L.extT > L.ext ? 4 * L.ext * (1 - L.ext) : reelK * smooth(c01((0.45 - st) / 0.3)) * 1.3
  const N = snakeSpine(L, st, now)
  let tx = SP[N * 2], ty = SP[N * 2 + 1]
  if (!isFinite(tx) || !isFinite(ty)) { g.globalAlpha = 1; return } // a chain not yet settled draws nothing rather than garbage
  if (L.wait > 0.02 && mo > 0) { tx += Math.sin(now * 0.07 + L.seed) * 1.3 * L.wait; ty += Math.cos(now * 0.09 + L.seed) * 1.1 * L.wait }
  g.globalAlpha = (0.35 + 0.65 * stW) * A.alpha
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
      // each sucker lies along the limb and turns with its curve
      const i0 = Math.max(0, i - 1), i1 = Math.min(N, i + 1)
      const an = Math.atan2(-SN[i * 2], SN[i * 2 + 1]) + (SN[i0 * 2] * SN[i1 * 2 + 1] - SN[i0 * 2 + 1] * SN[i1 * 2]) * 2.5
      g.moveTo(cx + Math.cos(an) * r * 1.15, cy + Math.sin(an) * r * 1.15); g.ellipse(cx, cy, r * 1.15, r * 0.78, an, 0, Math.PI * 2)
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
    const r = (R >= 18 ? Math.max(5, R * 0.62) : Math.max(3.6, R * 0.48)) * L.scale * L.tipEye * (1 - 0.55 * reelK * smooth(c01((1 - st) * 1.6))) // rolled up in the coil, it shrinks
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
    const open = (1 - L.closed * 0.94) * (1 - (L.blink || 0) * 0.95) * (1 - 0.95 * smooth(A.sleep || 0) * (1 - (A.peek || 0)))
    const ex = r * 0.74, up = by - r * 1.25 * open, dn = by + r * 0.95 * open
    const lx = bx - ex, rx = bx + ex
    if (open > 0.1) {
      g.save()
      g.beginPath(); g.moveTo(lx, by); g.quadraticCurveTo(bx, up, rx, by); g.quadraticCurveTo(bx, dn, lx, by); g.closePath()
      g.fillStyle = '#241B12'; g.fill(); g.clip()
      // the eyeball turns to the exact row it reads (its gaze is stepped in animate)
      eyeGlobe(bx, by, r * 0.9, r * 0.4, r * 0.28, L.gzx || 0, L.gzy || 0, A.col, true, smooth(A.hyp || 0), now, q)
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
    // letting go: the tether's tip leaves the prop's neck and draws back to the body as the prop fades
    const rel = P.fade && mo > 0.02 ? smooth(c01((1 - P.alpha) * 1.4)) : 0
    const nx = lerp(p[0] - Math.sin(tilt) * sz * 0.42, piv[0], rel), ny = lerp(p[1] - Math.cos(tilt) * sz * 0.42, piv[1], rel)
    const mx = (piv[0] + nx) / 2, my = (piv[1] + ny) / 2 + Math.hypot(nx - piv[0], ny - piv[1]) * 0.18
    g.lineCap = 'round'
    // the belly of the tether lags behind both its ends (a damped follow), so it swings and settles
    if (P.mx === undefined || mo <= 0.02 || !isFinite(P.mx) || !isFinite(P.my)) { P.mx = mx; P.my = my; P.mvx = 0; P.mvy = 0 }
    else {
      const h = Math.min(frameDt, 1 / 30)
      P.mvx += ((mx - P.mx) * 196 - 22 * P.mvx) * h; P.mvy += ((my - P.my) * 196 - 22 * P.mvy) * h
      P.mx += P.mvx * h; P.my += P.mvy * h
    }
    g.strokeStyle = A.tone; g.lineWidth = Math.max(2.4, 3.2 / z); g.beginPath(); g.moveTo(piv[0], piv[1]); g.quadraticCurveTo(P.mx, P.my, nx, ny); g.stroke()
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
    g.fillStyle = gr; blobCircle(20, 18, 11, 0.7 * mo, now, 0.7 + (A.seed % 9)); g.fill(); g.stroke()
    g.save(); g.translate(20, 18); g.rotate(now * 0.0012 * mo); g.strokeStyle = rgba(SCRY, 0.8); g.lineWidth = 1
    g.beginPath(); g.moveTo(-7, 0); g.bezierCurveTo(-4, -5, 4, -5, 7, 0); g.moveTo(-8, 2); g.bezierCurveTo(-4, 6, 4, 6, 8, 2); g.stroke(); g.restore()
  } else if (P.kind === 'pentagram') {
    g.strokeStyle = BLOOD
    g.beginPath(); g.arc(20, 20, 16, 0, Math.PI * 2); g.stroke()
    g.save(); g.translate(20, 20); g.rotate(now * 0.0007 * mo); g.translate(-20, -20); g.stroke(def.line); g.restore()
    g.fillStyle = rgba(BLOOD, 0.5 + 0.5 * Math.sin(now * 0.005 * mo)); g.beginPath(); g.arc(20, 20, 3, 0, Math.PI * 2); g.fill()
  } else if (P.kind === 'flask') {
    // the liquid stays level, lagging the swing: it sloshes
    // a bulbous flask, its glass wall slowly wobbling; the liquid stays level, lagging the swing: it sloshes
    flaskPath(now, mo, A.seed % 9)
    g.save(); g.clip(); g.translate(20, 25); g.rotate(-(P.slosh || 0) * 0.8)
    g.fillStyle = rgba(GREEN, 0.35); g.fillRect(-22, 0.5, 44, 22)
    g.restore()
    g.fillStyle = 'rgba(200,230,210,0.05)'; g.fill()
    g.strokeStyle = BONE; g.stroke()
    g.beginPath(); g.moveTo(13.5, 4); g.lineTo(26.5, 4); g.stroke()
    if (q >= 1 && mo > 0) {
      g.fillStyle = GREEN
      for (let k = 0; k < 3; k++) { const u = ((now * 0.0008) + k * 0.37) % 1; g.globalAlpha = P.alpha * A.alpha * (1 - u) * (0.3 + 0.7 * P.active); g.beginPath(); g.arc(16 + k * 3, 31 - u * 10, 1.4 - k * 0.2, 0, Math.PI * 2); g.fill() }
    }
  } else {
    blobRect(9, 7, 22, 26, 3, 0, 0.8 * mo, now, 2.1)
    g.fillStyle = PAGE; g.fill(); g.strokeStyle = BONE; g.stroke()
    g.beginPath(); g.ellipse(20, 7, 12, 2.6, 0, 0, Math.PI * 2); g.moveTo(32, 33); g.ellipse(20, 33, 12, 2.6, 0, 0, Math.PI * 2); g.fill(); g.stroke()
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

const DASH_PULSE = [3, 23], VEIN = '#7A7290'
const DASH_GAZE = [3, 4]


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
    if (pass === 1) for (const A of vis.actors.values()) if (A.alpha > 0.01) { corrUnder(A, now); drawTendrils(A, now); drawActor(A, now) }
    for (const L of vis.limbs.values()) {
      if (attached(L) !== (pass === 1)) continue
      const A = vis.actors.get(L.actor)
      if (!A || A.alpha < 0.02) continue
      drawLimb(L, A, now)
    }
  }
  for (const A of vis.actors.values()) if (A.alpha > 0.01 && A.knot < 0.98) drawActorEye(A, now)
  for (const A of vis.actors.values()) if (A.alpha > 0.01) corrOver(A, now)
  drawSlime()
  drawGore()
  for (const A of vis.actors.values()) if (A.alpha > 0.01) drawSleep(A, now)
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
      // (the block's width is measured when its text changes, not every frame)
      const ck = (A.cap1 || '') + '|' + (A.cap2 || '')
      if (A.capWK !== ck) { A.capWK = ck; A.capW = Math.max(g.measureText(A.cap1 || '').width, g.measureText(A.cap2 || '').width * 0.92) + 12 }
      const cw = A.capW
      let lift = 0
      for (let tries = 0; tries < 14; tries++) {
        const x0 = sx - cw / 2, y0 = sy - lift - h, x1 = sx + cw / 2, y1 = sy - lift
        let hit = false
        for (const N of vis.nodes.values()) {
          if (!N.present || N.alpha < 0.3 || N.pile > 0.5) continue
          // (the card as drawn: a little larger than its box, with its rim)
          const nx0 = (N.x - 8 - view.cam.x) * z + view.w / 2, ny0 = (N.y - 8 - view.cam.y) * z + view.h / 2, nx1 = nx0 + (N.w + 16) * z, ny1 = ny0 + (N.h + 16) * z
          if (x0 < nx1 && x1 > nx0 && y0 < ny1 && y1 > ny0) { hit = true; break }
        }
        // nor a pile and its label
        if (!hit) for (const P of vis.piles.values()) {
          if (P.n < 2 || P.alpha < 0.3) continue
          const px0 = (P.x - 14 - view.cam.x) * z + view.w / 2, py0 = (P.y - 10 - view.cam.y) * z + view.h / 2, px1 = px0 + 92 * z, py1 = py0 + 60 * z
          if (x0 < px1 && x1 > px0 && y0 < py1 && y1 > py0) { hit = true; break }
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

// ----- hint, tooltip -----

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
  g.globalAlpha = 0.45 * alpha; g.fillText('press ? for the controls and the legend', cx, cy + R * 0.6 + 20)
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
  // the lettering with its glow is drawn once into a bitmap (again when the name, size or quality changes) and
  // breathes through its opacity
  const pad = Math.ceil(fs * 2.6), tcw = Math.ceil(tw + pad * 2), tch = Math.ceil(fs * 2.6)
  const tkey = name + '|' + fs + '|' + view.dpr + '|' + q
  if (titleCache.key !== tkey) {
    titleCache.key = tkey
    const tc = titleCache.canvas || (titleCache.canvas = document.createElement('canvas'))
    tc.width = Math.ceil(tcw * view.dpr); tc.height = Math.ceil(tch * view.dpr)
    const t = tc.getContext('2d')
    t.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    t.clearRect(0, 0, tcw, tch)
    t.font = '600 ' + fs + 'px ' + TITLE_FONT; t.textBaseline = 'alphabetic'; t.textAlign = 'left'
    const ty = fs * 1.55
    if (q >= 1) { t.shadowColor = 'rgba(110,80,150,0.6)'; t.shadowBlur = 18 }
    const grad = t.createLinearGradient(0, ty - fs, 0, ty)
    grad.addColorStop(0, BONE); grad.addColorStop(1, PARCH)
    let x = pad
    for (let i = 0; i < name.length; i++) {
      const jy = (rnd('title', i) - 0.5) * fs * 0.09, jr = (rnd('tilt', i) - 0.5) * 0.05
      t.save(); t.translate(x + widths[i] / 2, ty + jy); t.rotate(jr)
      t.lineWidth = Math.max(1, fs * 0.05); t.strokeStyle = rgba('#5A1414', 0.85); t.lineJoin = 'round'
      t.strokeText(name[i], -widths[i] / 2, 0)
      t.fillStyle = grad; t.fillText(name[i], -widths[i] / 2, 0)
      t.restore()
      x += widths[i] + sp
    }
    t.shadowBlur = 0
    // sigils either side: a ringed triangle with a dot, the entity's mark
    t.strokeStyle = rgba(PARCH, 0.7); t.lineWidth = 1; t.fillStyle = rgba('#5A1414', 0.9)
    for (const sx of [pad - fs * 1.1, pad + tw + fs * 1.1]) {
      const sy = ty - fs * 0.36, r = fs * 0.26
      t.beginPath(); t.arc(sx, sy, r, 0, Math.PI * 2); t.stroke()
      t.beginPath(); t.moveTo(sx, sy - r * 0.75); t.lineTo(sx + r * 0.68, sy + r * 0.5); t.lineTo(sx - r * 0.68, sy + r * 0.5); t.closePath(); t.stroke()
      t.beginPath(); t.arc(sx, sy + r * 0.08, r * 0.14, 0, Math.PI * 2); t.fill()
      t.beginPath(); t.moveTo(sx - r * 1.6, sy); t.lineTo(sx - r * 1.15, sy); t.moveTo(sx + r * 1.15, sy); t.lineTo(sx + r * 1.6, sy); t.stroke()
    }
  }
  g.save()
  g.globalAlpha = (0.9 - 0.5 * view.titleDim) * (0.82 + 0.18 * breathe)
  if (titleCache.canvas) g.drawImage(titleCache.canvas, x0 - pad, 0, tcw, tch)
  g.restore()
}
const titleCache = { key: '', canvas: null }
// a short notice at the bottom of the view (a setting changed, following again)
function drawHint(now) {
  if (view.hint.until <= now) return
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  const a = c01((view.hint.until - now) / 600)
  g.font = '12px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillStyle = rgba(BONE, 0.85 * a); g.fillText(view.hint.text, view.w / 2, view.h - 22); g.textAlign = 'left'
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
// while a card is dragged its pin follows the cursor; it is saved once, when the drag ends
function pinMove(V, x, y) { V.pin = [x, y]; pins.map.set(V.id, V.pin) }
function pinClear(V) { V.pin = null; pins.map.delete(V.id); pinsSave(); pack.sig = '' }
function hoverNode() {
  if (view.mx < 0 || view.my > view.h - BAR_H - 4) return null
  const p = toWorld(view.mx, view.my)
  for (const V of vis.nodes.values()) if (V.present && V.alpha > 0.5 && !(V.pile > 0.5) && p[0] >= V.x && p[0] <= V.x + V.w && p[1] >= V.y && p[1] <= V.y + V.h) return V
  return null
}

// what the cursor is over besides tomes and bindings: a creature, the tip of a limb, a pile
function hoverOther() {
  if (view.mx < 0 || view.my > view.h - BAR_H - 4) return null
  const p = toWorld(view.mx, view.my), z = view.cam.z
  for (const A of vis.actors.values()) {
    if (!A.present || A.alpha < 0.5 || A.knot > 0.9) continue
    const R = A.r * (A.bodyK || 1) * 1.5
    if (Math.abs(p[0] - A.x) < R && Math.abs(p[1] - A.y) < R) {
      const a = H.state.actors.get(A.id)
      const what = A.role === 'inspector' ? 'inspector (a reviewing subagent)' : A.parent ? 'subagent' : 'Claude session'
      return { key: 'a:' + A.id, text: (A.label || 'Claude') + '  (' + what + ')' + (a && a.task ? '\n' + a.task : '') + '\n' + (A.waitT ? 'waiting for you' : A.mood || 'idle') }
    }
  }
  for (const L of vis.limbs.values()) {
    if (!(L.ext > 0.5) || !isFinite(L.tx) || !isFinite(L.ty)) continue
    if (Math.hypot(p[0] - L.tx, p[1] - L.ty) > 12 / z + 6) continue
    const act = H.state.acts.get(L.id), A = vis.actors.get(L.actor)
    if (!act) continue
    return { key: 'l:' + L.id, text: (A && A.label ? A.label : 'Claude') + ': ' + (act.tool || act.kind) + (act.detail ? '\n' + act.detail : '') + (act.endT ? '' : '\n(running)') }
  }
  for (const P of vis.piles.values()) {
    if (P.n < 2 || P.alpha < 0.3) continue
    if (p[0] >= P.x && p[0] <= P.x + 70 && p[1] >= P.y - 6 && p[1] <= P.y + 46) return { key: 'p:' + P.key, text: (P.label || 'pile') + '\n' + P.n + ' quiet tomes of ' + (P.folder || 'the project') + '\n(click to ' + (fan.key === P.key ? 'close' : 'open') + ')' }
  }
  return null
}
function updateTooltip() {
  const V = view.drag ? null : hoverNode()
  const Mg = V || view.drag ? null : hoverEdge()
  const O = V || Mg || view.drag ? null : hoverOther()
  const tipKey = V ? 'n:' + V.id : Mg ? 'e:' + Mg.key + ':' + Mg.n : O ? O.key : ''
  if (V !== view.hover || Mg !== view.hoverEdge || tipKey !== view.tipKey) {
    view.hover = V; view.hoverEdge = Mg; view.tipKey = tipKey
    if (V) { tipEl.textContent = V.name + '  (' + V.kind + ')\n' + V.file + (V.lines ? '\n' + V.lines + ' lines' : ''); tipEl.style.display = 'block' }
    else if (Mg) { tipEl.textContent = edgeTip(Mg); tipEl.style.display = 'block' }
    else if (O) { tipEl.textContent = O.text; tipEl.style.display = 'block' }
    else tipEl.style.display = 'none'
    view.tipW = 0
  }
  if (V || Mg || O) {
    // placed by its real size, kept inside the view
    if (!view.tipW) { const r = tipEl.getBoundingClientRect(); view.tipW = r.width; view.tipH = r.height }
    tipEl.style.left = clamp(view.mx + 14, 4, Math.max(4, view.w - view.tipW - 8)) + 'px'
    tipEl.style.top = clamp(view.my + 14, 4, Math.max(4, view.h - BAR_H - view.tipH - 8)) + 'px'
  }
}

function showHint(text) { view.hint.text = text; view.hint.until = performance.now() + 1800 }

// ---------- input ----------

// a hand on the camera (wheel, pinch, pan, tilt) pauses the automatic framing until a double-click on empty
// space or F, or until the view has been left alone for five minutes: it never takes the zoom back while in use
const HOLD_MS = 300000, Z_MIN = 0.08, Z_MAX = 6
function userInput() { view.userUntil = performance.now() + HOLD_MS }
function followAgain() { view.userUntil = 0; showHint('following the work') }
// zoom about a point on the screen, by a factor; always answers (a broken camera value is repaired first)
function zoomAbout(sx, sy, factor) {
  const cam = view.cam
  if (!(view.w >= 2 && view.h >= 2) || !isFinite(factor) || factor <= 0) return
  if (!isFinite(cam.z) || cam.z <= 0) cam.z = 1
  if (!isFinite(cam.tz) || cam.tz <= 0) cam.tz = cam.z
  if (!isFinite(cam.x) || !isFinite(cam.y)) { cam.x = isFinite(cam.tx) ? cam.tx : 0; cam.y = isFinite(cam.ty) ? cam.ty : 0 }
  const before = toWorld(sx, sy)
  cam.tz = clamp(cam.tz * factor, Z_MIN, Z_MAX)
  // keep the world point under the cursor fixed at the target zoom
  cam.tx = before[0] - (sx - view.w / 2) / cam.tz
  cam.ty = before[1] - (sy - view.h / 2) / cam.tz
  userInput()
}

canvas.addEventListener('wheel', e => {
  e.preventDefault()
  // every kind of wheel answers alike: pixels as they come, lines and pages scaled up, a trackpad pinch (which
  // arrives as a wheel with ctrlKey and small deltas) amplified; one event never moves more than a notch and a half
  let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? Math.max(200, view.h) : 1)
  if (e.ctrlKey) dy *= 7
  if (!isFinite(dy) || dy === 0) return
  zoomAbout(e.clientX, e.clientY, Math.exp(-clamp(dy, -160, 160) * 0.0014))
}, { passive: false })

canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 && e.button !== 2) return
  view.mx = e.clientX; view.my = e.clientY

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

  const d = view.drag
  if (d) {
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true
    if (d.node) {
      if (d.moved && view.dragNode) { const p = toWorld(e.clientX, e.clientY); const N = view.dragNode; pinMove(N, p[0] + N.dragOff[0], p[1] + N.dragOff[1]); if (!N.pinnedByDrag) { N.pinnedByDrag = true; pack.sig = '' }; layout.awake = Math.max(layout.awake, 30); userInput(); canvas.style.cursor = 'grabbing' }
    }
    else if (d.moved && d.tilt) { setTilt(d.deg - dy * 0.12); userInput(); canvas.style.cursor = 'ns-resize' }
    else if (d.moved) { view.cam.tx = d.cx - dx / view.cam.tz; view.cam.ty = d.cy - dy / view.cam.tz; userInput(); canvas.style.cursor = 'grabbing' }
  }
})
window.addEventListener('mouseup', e => {
  // a press and release without a drag is a click: on a pile, a fanned card, a mini pile, or empty space
  const d0 = view.drag
  if (d0 && !d0.moved && !d0.tilt && e.button === 0 && e.clientY < view.h - BAR_H - 6) { const p = toWorld(e.clientX, e.clientY); fanClick(p[0], p[1], d0.node ? view.dragNode : null) }
  view.drag = null; if (view.dragNode) { if (view.dragNode.pinnedByDrag) pinsSave(); view.dragNode.pinnedByDrag = false; view.dragNode = null; layout.awake = Math.max(layout.awake, 60) } canvas.style.cursor = 'default' })
canvas.addEventListener('mouseleave', () => { view.mx = -1; view.my = -1 })
canvas.addEventListener('dblclick', e => { const N = hoverNode(); if (N) { if (N.pin) pinClear(N) } else followAgain() })
window.addEventListener('keydown', e => {
  if (e.key === 'q' || e.key === 'Q') { settings.q = (settings.q + 1) % 3; saveSettings(); resize(); showHint('quality: ' + QUAL[settings.q]) }
  else if (e.key === 'm' || e.key === 'M') { settings.m = (settings.m + 1) % 3; saveSettings(); showHint('motion: ' + ['off', 'calm', 'full'][settings.m]) }
  else if (e.key === '?') toggleHelp()
  else if (e.key === 'Escape') { toggleHelp(false); if (fan.key) fanClose() }
  else if (e.key === 'f' || e.key === 'F') followAgain()
  else if (e.key === 'h' || e.key === 'H') { setHistoryPref(!historyPref()); showHint('earlier sessions on the map: ' + (historyPref() ? 'on (the plugin seeds them within 10 s)' : 'off (from the next session)')) }
})
// earlier sessions on the map: off unless asked for; the choice is the viewer's, kept in this browser and told to
// the plugin through the server (same origin), which seeds the map when it sees it
function historyPref() { try { return localStorage.getItem('abyssal-eye.history') === '1' } catch (e) { return false } }
function setHistoryPref(on) { try { localStorage.setItem('abyssal-eye.history', on ? '1' : '0') } catch (e) { /* no storage */ } tellHistoryPref() }
function tellHistoryPref() { if (DEMO || !PAGE_KEY) return; fetch('/pref?p=' + encodeURIComponent(PAGE_KEY) + '&history=' + (historyPref() ? 1 : 0), { method: 'POST' }).catch(() => { /* the server may be gone */ }) }
setTimeout(tellHistoryPref, 300)
// the help: controls and legend, behind the "?" control and the ? key
function toggleHelp(on) {
  const el = document.getElementById('helpPanel')
  if (!el) return
  const show = on === undefined ? el.style.display !== 'block' : on
  el.style.display = show ? 'block' : 'none'
}
{
  const hb = document.getElementById('help'), hp = document.getElementById('helpPanel')
  if (hb) hb.addEventListener('click', () => toggleHelp())
  if (hp) hp.addEventListener('click', e => { if (e.target === hp || (e.target && e.target.id === 'helpClose')) toggleHelp(false) })
}
// touch: one finger pans, two pinch to zoom; mouse input keeps its own handlers. A gesture always ends cleanly:
// a cancel, a lost capture or a finger leaving the sheet drops it, so a pinch can never stay half held
const touches = new Map()
let pinch = null
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return
  e.preventDefault()
  touches.set(e.pointerId, [e.clientX, e.clientY])
  try { canvas.setPointerCapture(e.pointerId) } catch (err) { /* not capturable */ }
  if (touches.size > 2) { touches.clear(); touches.set(e.pointerId, [e.clientX, e.clientY]); pinch = null } // a stale finger: start over
  if (touches.size === 2) {
    const [a, b] = Array.from(touches.values())
    const z0 = isFinite(view.cam.tz) && view.cam.tz > 0 ? view.cam.tz : 1
    pinch = { d: Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1])), z: z0, world: toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }
  }
  userInput()
}, { passive: false })
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return
  e.preventDefault()
  const was = touches.get(e.pointerId)
  touches.set(e.pointerId, [e.clientX, e.clientY])
  view.mx = e.clientX; view.my = e.clientY // the creatures notice a finger as they do a cursor
  const cam = view.cam

  if (touches.size === 1) { cam.tx -= (e.clientX - was[0]) / cam.tz; cam.ty -= (e.clientY - was[1]) / cam.tz }
  else if (touches.size === 2 && pinch) {
    const [a, b] = Array.from(touches.values())
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    cam.tz = clamp(pinch.z * d / pinch.d, Z_MIN, Z_MAX)
    // the world point between the fingers stays between them
    cam.tx = pinch.world[0] - (mx - view.w / 2) / cam.tz
    cam.ty = pinch.world[1] - (my - view.h / 2) / cam.tz
  }
  userInput()
}, { passive: false })
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'pointerout']) canvas.addEventListener(ev, e => {
  if (e.pointerType !== 'touch') return
  touches.delete(e.pointerId)
  if (touches.size < 2) pinch = null
  if (!touches.size) { view.mx = -1; view.my = -1 }
})
// the window losing focus or the tab being hidden ends every gesture too (a drag, a pinch)
for (const ev of ['blur', 'visibilitychange']) window.addEventListener(ev, () => { if (ev === 'blur' || document.hidden) { touches.clear(); pinch = null; view.drag = null; if (view.dragNode) { view.dragNode.pinnedByDrag = false; view.dragNode = null } } })
window.addEventListener('resize', resize)
// any input keeps the view at full frame rate for the next 10 s
for (const ev of ['wheel', 'mousedown', 'mousemove', 'keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, () => { view.lastInput = performance.now() }, { passive: true })
// the pane may open collapsed or hidden and gain its size later: every change of size (and every return to view)
// resizes the canvas, and the first real size frames the map
if (typeof ResizeObserver === 'function') { try { new ResizeObserver(() => { if (window.innerWidth >= 2 && window.innerHeight >= 2) wake(); else resize() }).observe(document.documentElement) } catch (e) { /* no observer */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) resize() })

// ---------- main loop ----------

const NOPAUSE = DEBUG && /[?&]nopause/.test(location.search)
let last = 0, rafId = 0, pollAt = 0, packAcc = 0, packTurn = 0
// at rest (nothing working, the layout asleep, no input for 10 s) the view renders about 16 times a second
function schedule() {
  if (NOPAUSE) rafId = setTimeout(() => frame(performance.now()), 16)
  else if (view.resting) rafId = setTimeout(() => { rafId = requestAnimationFrame(frame) }, 45)
  else rafId = requestAnimationFrame(frame)
}
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
  view.framed = false; view.settledOnce = true
  for (const A of vis.actors.values()) { A.waitK = A.waitT || 0; A.bodyK = 1 + 0.3 * smooth(A.waitK) }
}
function frame(ts) {
  // a gap of more than 10 s between frames means the page was frozen (a discarded or throttled tab): the stream is
  // refetched from the start so nothing that happened meanwhile is missing
  if (lastFrameAt && performance.now() - lastFrameAt > 10000 && !DEMO) { resetAll(); src.seq = 0; src.epoch = null; src.retryAt = 0; loadReset() }
  lastFrameAt = performance.now()
  cardFrame++; cardRenders = 0
  view.resting = layout.awake <= 0 && focus.cur.size === 0 && !view.drag && load.reveal >= 1 && !load.active && lastFrameAt - (view.lastInput || 0) > 10000 && dust.act < 0.08
  schedule()
  const now = performance.now()
  // the simulation step is the frame time smoothed over a few frames, so one long or short frame no longer kicks
  // every spring; it stays within a factor of two of the real one, so the animation still keeps time
  const dtRaw = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
  dtSm = dtSm ? clamp(dtSm + (dtRaw - dtSm) * 0.25, dtRaw * 0.5, dtRaw * 2) : dtRaw
  const dt = dtSm
  last = now
  frameDt = dt
  if ((window.innerWidth !== view.w || window.innerHeight !== view.h) && window.innerWidth > 1 && window.innerHeight > 1) resize()
  const wall = Date.now()
  const T = wall
  foldTo(T)
  const S = H.state
  collectActs(S, T)
  pinsLoad()
  syncNodes(S, T)
  syncActors(S, T, now, dt)
  lifeSync(S, T, now, dt)
  syncEdges(S, T)
  syncLimbs(S, T, now, dt)
  syncDust(S, T, dt)
  syncSouls(S, T, now, dt)
  if (view.needSettle) { view.needSettle = false; settle(S, T, now) }
  // (on a large map the packing runs every third frame, with the time of all three)
  if ((vis.presentN || 0) > 300) { packAcc += dt; if (++packTurn % 3 === 0) { packStep(packAcc); packAcc = 0 } } else { packStep(dt + packAcc); packAcc = 0 }
  layoutStep(dt)
  fanSync(now)
  animate(dt, now)
  syncDrips(dt)
  syncSlime(dt, now)
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
  // an opened pile: one layer above everything on the map
  if (fan.key) { worldTransform(); drawTomes(now, true); g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0) }
  drawTitle(now)
  drawHint(now)
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
  if (window.__abyss && window.__abyss.self !== SELF) return
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
  if (window.__abyss && window.__abyss.self !== SELF) return
  if (document.hidden && !NOPAUSE) { hiddenAt = Date.now(); stop() } else wake()
})
window.addEventListener('focus', () => { if (!document.hidden) wake() })
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); else wake() })

resize()
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
// (150 ms while events have arrived in the last 5 s or the stream is still loading, 1 s otherwise, 3 s when hidden)
function pollLoop() {
  poll()
  const hidden = document.hidden || window.innerWidth < 2
  const busy = DEMO || load.active || performance.now() - (src.lastEventAt || 0) < 5000
  setTimeout(pollLoop, hidden && !DEMO ? 3000 : busy ? 150 : 1000)
}
pollLoop()
// (the page's version comes with each heartbeat answer, and with wake(); a changed one reloads the page)
// dev aid (?debug): the live state, and tick(ms) to step one frame of a given length
if (DEBUG) window.__abyss = { self: SELF, H, vis, view, settings, src, demo, poll, frame, start, stop, pack, merged, bundles, layout, drags, dust, web, tilt, setTilt, ingest, limbLog, clusters, skulls, digest, load, force, fan, cur, slime, gore, zoomAbout, correct: () => { const T = Date.now(); let n = 0; for (const a of H.state.actors.values()) if (a.parent && vis.actors.has(a.id)) { a.corrT = T; a.corrBy = a.parent; n++ } return n }, tick: ms => { const was = !!rafId; stop(); last = performance.now() - ms; frame(performance.now()); stop(); if (was) start() } }

