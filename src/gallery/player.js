// First-person movement, collision and fast travel between rooms.

const R = 0.38;          // body radius
const EYE = 1.66;
const WALK = 5.6, SPRINT = 10.5, DASH = 17;

const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Player {
  constructor(layout) {
    this.layout = layout;
    this.coll = layout.coll;
    this.rooms = layout.rooms;
    this.byId = Object.fromEntries(layout.rooms.map((r) => [r.id, r]));
    this.pos = [0, 0];
    this.vel = [0, 0];
    this.yaw = 0; this.pitch = 0;
    this.eye = EYE; this.bob = 0;
    this.lift = 0; this.liftNow = 0;      // inspecting a print raises the eye to its centre, so it is seen square-on
    this.room = 'atrium';
    this.travel = null;
    this.moved = true;
    // room graph
    this.links = {};
    for (const p of layout.portals) {
      const [a, b] = p.rooms;
      if (!a || !b) continue;
      (this.links[a] ||= []).push({ to: b, p, s: 1 });
      (this.links[b] ||= []).push({ to: a, p, s: -1 });
    }
  }

  spawn(id) {
    const r = this.byId[id] || this.byId.atrium;
    this.pos = [...r.spawn];
    this.yaw = yawTo(r.look[0] - r.spawn[0], r.look[1] - r.spawn[1]);
    this.pitch = 0.04;
    this.room = r.id;
    this.travel = null;
    this.vel = [0, 0];
    this.moved = true;
  }

  roomAt(x, z) {
    for (const r of this.rooms) if (inPoly(x, z, r.poly)) return r.id;
    return null;
  }

  // true if the straight line a->b crosses a wall (kind 0) or glass (kind 1 when glass=true)
  blocked(a, b, glass = true, props = false) {
    for (const s of this.coll) {
      if (s[4] === 1 && !glass) continue;
      if (s[4] === 2 && !props) continue;
      const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = s[2] - s[0], d2z = s[3] - s[1];
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s[0] - a[0]) * d2z - (s[1] - a[1]) * d2x) / den;
      const u = ((s[0] - a[0]) * d1z - (s[1] - a[1]) * d1x) / den;
      if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) return true;
    }
    return false;
  }

  // distance along a ray until anything solid
  rayDist(o, d, max) {
    let best = max;
    for (const s of this.coll) {
      if (s[4] === 2) continue;
      const d2x = s[2] - s[0], d2z = s[3] - s[1];
      const den = d[0] * d2z - d[1] * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s[0] - o[0]) * d2z - (s[1] - o[1]) * d2x) / den;
      const u = ((s[0] - o[0]) * d[1] - (s[1] - o[1]) * d[0]) / den;
      if (t > 0.02 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
  }

  collide(p) {
    for (let it = 0; it < 3; it++) {
      for (const s of this.coll) {
        const ax = s[0], az = s[1], bx = s[2], bz = s[3];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 ? ((p[0] - ax) * dx + (p[1] - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t, cz = az + dz * t;
        const ox = p[0] - cx, oz = p[1] - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 < R * R && d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (R - d) / d;
          p[0] += ox * k; p[1] += oz * k;
        }
      }
    }
  }

  // waypoints from where we stand to a point in (possibly) another room
  route(target, room) {
    const from = this.room;
    const pts = [];
    if (room && room !== from && this.links[from]) {
      const prev = { [from]: null };
      const q = [from];
      while (q.length) {
        const r = q.shift();
        if (r === room) break;
        for (const l of this.links[r] || []) {
          if (l.to in prev) continue;
          // the infield is a shortcut, but never a detour between neighbours
          prev[l.to] = { r, l };
          q.push(l.to);
        }
      }
      const chain = [];
      for (let r = room; prev[r]; r = prev[r].r) chain.unshift(prev[r].l);
      for (const l of chain) {
        const off = l.p.depth / 2 + 0.75;
        pts.push([l.p.p[0] - l.p.d[0] * l.s * off, l.p.p[1] - l.p.d[1] * l.s * off]);
        pts.push([l.p.p[0] + l.p.d[0] * l.s * off, l.p.p[1] + l.p.d[1] * l.s * off]);
      }
    }
    pts.push(target);
    return pts;
  }

  go(target, { room = null, yaw = null, pitch = null, speed = DASH, done = null } = {}) {
    room = room || this.roomAt(target[0], target[1]) || this.room;
    if (this.instant) {                       // prefers-reduced-motion: cut, don't fly
      this.pos = [...target]; this.room = room; this.travel = null; this.vel = [0, 0];
      if (yaw !== null) { this.yaw = yaw; this.pitch = pitch ?? 0; }
      this.jumped = true;
      if (done) done();
      return;
    }
    this.travel = { pts: this.route(target, room), i: 0, yaw, pitch, speed, done, v: Math.hypot(this.vel[0], this.vel[1]), stuck: 0 };
  }

  goRoom(id) {
    const r = this.byId[id];
    if (!r) return;
    this.go(r.spawn, { room: id, yaw: yawTo(r.look[0] - r.spawn[0], r.look[1] - r.spawn[1]), pitch: 0.03 });
  }

  update(dt, input) {
    const p = this.pos;
    const before = [p[0], p[1], this.yaw, this.pitch];
    // look
    if (input.lookX || input.lookY) {
      // while the camera is being brought to a framed view (a print, a room) it holds its line
      if (!(this.travel && this.travel.yaw !== null)) {
        this.yaw -= input.lookX; this.pitch -= input.lookY;
        this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));
      }
      input.lookX = input.lookY = 0;
    }
    if (input.turn) this.yaw += input.turn * dt * 1.9;
    const wishing = Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.01;
    if (wishing && this.travel) this.travel = null;

    if (this.travel) {
      const tr = this.travel;
      let remain = 0;
      for (let i = tr.i; i < tr.pts.length; i++) {
        const a = i === tr.i ? p : tr.pts[i - 1];
        remain += Math.hypot(tr.pts[i][0] - a[0], tr.pts[i][1] - a[1]);
      }
      const vmax = Math.min(tr.speed, 2.2 + remain * 3.2);
      tr.v += (vmax - tr.v) * (1 - Math.exp(-dt * 7));
      let step = tr.v * dt;
      const start = [p[0], p[1]];
      while (step > 0 && tr.i < tr.pts.length) {
        const t = tr.pts[tr.i];
        const dx = t[0] - p[0], dz = t[1] - p[1], d = Math.hypot(dx, dz);
        const last = tr.i === tr.pts.length - 1;
        if (d <= Math.max(step, last ? 0.03 : 0.5)) {
          if (last) { p[0] = t[0]; p[1] = t[1]; }
          tr.i++; step -= last ? d : 0;
          if (last) break;
          continue;
        }
        p[0] += (dx / d) * step; p[1] += (dz / d) * step;
        step = 0;
      }
      this.collide(p);
      const adv = Math.hypot(p[0] - start[0], p[1] - start[1]);
      tr.stuck = adv < tr.v * dt * 0.25 ? tr.stuck + dt : 0;
      if (tr.stuck > 0.3 && tr.i < tr.pts.length) {
        // something low is in the way: step past it, or call it arrived if this was the last leg
        if (tr.i === tr.pts.length - 1) tr.i++;
        else { p[0] = tr.pts[tr.i][0]; p[1] = tr.pts[tr.i][1]; tr.i++; }
        tr.stuck = 0;
      }
      this.vel = [(p[0] - start[0]) / dt, (p[1] - start[1]) / dt];
      // look where we're going, then settle on the final view
      const k = 1 - Math.exp(-dt * 6);
      if (tr.i < tr.pts.length) {
        const t = tr.pts[tr.i];
        const settle = tr.yaw !== null && remain < 4.5;
        if (settle) {
          this.yaw += angDiff(this.yaw, tr.yaw) * k;
        } else if (tr.yaw !== null || remain > 1.5) {
          this.yaw += angDiff(this.yaw, yawTo(t[0] - p[0], t[1] - p[1])) * k;
        }
        if (tr.pitch !== null) this.pitch += ((settle ? tr.pitch : 0) - this.pitch) * k;
      } else {
        if (tr.yaw !== null) {
          this.yaw += angDiff(this.yaw, tr.yaw) * k;
          this.pitch += (tr.pitch - this.pitch) * k;
        }
        if (tr.yaw === null || (Math.abs(angDiff(this.yaw, tr.yaw)) < 0.004 && Math.abs(tr.pitch - this.pitch) < 0.004)) {
          const done = tr.done;
          this.travel = null;
          this.vel = [0, 0];
          if (done) done();
        }
      }
    } else {
      const sp = input.sprint ? SPRINT : WALK;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      let wx = input.moveX * cy - input.moveZ * sy, wz = -input.moveX * sy - input.moveZ * cy;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      const k = 1 - Math.exp(-dt * (wishing ? 9 : 12));
      this.vel[0] += (wx * sp - this.vel[0]) * k;
      this.vel[1] += (wz * sp - this.vel[1]) * k;
      const dist = Math.hypot(this.vel[0], this.vel[1]) * dt;
      const n = Math.max(1, Math.ceil(dist / 0.2));
      for (let i = 0; i < n; i++) {
        p[0] += (this.vel[0] * dt) / n; p[1] += (this.vel[1] * dt) / n;
        this.collide(p);
      }
    }
    const speed = Math.hypot(this.vel[0], this.vel[1]);
    this.bob += speed * dt;
    const dl = this.lift - this.liftNow;
    this.liftNow += dl * (1 - Math.exp(-dt * 5));
    if (Math.abs(dl) < 0.002) this.liftNow = this.lift;
    this.eye = EYE + this.liftNow + Math.sin(this.bob * 1.9) * 0.028 * Math.min(1, speed / WALK) * (this.travel ? 0.3 : 1);
    this.speed = speed;
    const r = this.roomAt(p[0], p[1]);
    if (r) this.room = r;
    if (this.jumped) { this.jumped = false; before[0] = 1e9; }
    this.moved = Math.abs(p[0] - before[0]) + Math.abs(p[1] - before[1]) > 1e-5
      || Math.abs(this.yaw - before[2]) + Math.abs(this.pitch - before[3]) > 1e-6 || speed > 0.01 || Math.abs(dl) > 0.002;
    return this.moved;
  }
}

// ---------------------------------------------------------------------------
// Input: keyboard + mouse on desktop, thumbstick + drag on touch.
// ---------------------------------------------------------------------------
export class Input {
  constructor(el, { onTap, onKey, onActivity }) {
    this.el = el;
    this.moveX = 0; this.moveZ = 0; this.turn = 0; this.lookX = 0; this.lookY = 0; this.sprint = false;
    this.enabled = false;
    this.locked = false;
    this.stick = null;               // {id, ox, oy, x, y}
    const keys = this.keys = new Set();
    const sens = 0.0023;
    const isForm = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);

    addEventListener('keydown', (e) => {
      if (!this.enabled || isForm(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) onKey(e.code);
      keys.add(e.code);
      onActivity();
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());

    // mouse: drag to look, click to act; optional pointer lock
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') return this.touchStart(e);
      if (e.button !== 0) return;
      const locking = !this.locked && this.canLock;
      if (locking) this.lock();                                        // this click takes the pointer; it is not an action
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, locking };
      if (!this.locked) el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') return this.touchMove(e);
      if (this.locked) {
        const mx = Math.max(-120, Math.min(120, e.movementX)), my = Math.max(-120, Math.min(120, e.movementY));   // ignore the odd jump some browsers report
        this.lookX += mx * sens; this.lookY += my * sens; onActivity(); return;
      }
      if (down) {
        down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (down.moved > 4) { this.lookX -= e.movementX * sens * 1.35; this.lookY -= e.movementY * sens * 1.35; el.classList.add('dragging'); }
        onActivity();
      } else if (this.onHover) this.onHover(e.clientX, e.clientY);
    });
    const up = (e) => {
      if (e.pointerType === 'touch') return this.touchEnd(e);
      if (!down) return;
      el.classList.remove('dragging');
      if (this.locked) { if (!down.locking) onTap(null); }
      else if (down.moved <= 4 && performance.now() - down.t < 500 && !(down.locking && !this.noLock)) onTap([e.clientX, e.clientY]);
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { down = null; this.touchEnd(e); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (this.locked) { clearTimeout(this.lockTimer); this.lockFails = 0; }
      document.documentElement.classList.toggle('locked', this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wheel = (this.wheel || 0) - Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 60);
      onActivity();
    }, { passive: false });
    this.onTap = onTap; this.onActivity = onActivity;
    this.touches = new Map();
  }

  get canLock() { return !this.noLock && !!this.el.requestPointerLock && !matchMedia('(pointer: coarse)').matches; }

  lock() {
    if (this.locked || !this.canLock) return;
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => { if (!this.locked) this.lockFailed(); }, 900);
    try { const p = this.el.requestPointerLock(); p?.catch?.(() => {}); } catch { /* the browser said not now; the next click tries again */ }
  }

  // A browser that will not hand over the pointer still has to be usable: fall back to drag-to-look.
  lockFailed() {
    clearTimeout(this.lockTimer);
    this.lockFails = (this.lockFails || 0) + 1;
    if (this.lockFails >= 2) { this.noLock = true; document.documentElement.classList.add('nolock'); }
  }

  unlock() { if (this.locked) document.exitPointerLock(); }

  touchStart(e) {
    const r = this.el.getBoundingClientRect();
    const left = e.clientX < r.width * 0.42 && e.clientY > r.height * 0.4;
    const t = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, stick: left && !this.stick };
    this.touches.set(e.pointerId, t);
    if (t.stick) { this.stick = t; this.onStick?.(t.sx, t.sy, 0, 0, true); }
    this.el.setPointerCapture(e.pointerId);
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    t.moved += Math.abs(dx) + Math.abs(dy);
    if (t.stick) {
      let ox = t.x - t.sx, oy = t.y - t.sy;
      const l = Math.hypot(ox, oy), m = 56;
      if (l > m) { ox *= m / l; oy *= m / l; }
      this.stickX = ox / m; this.stickZ = -oy / m;
      this.onStick?.(t.sx, t.sy, ox, oy, true);
    } else if (t.moved > 6) {
      this.lookX += dx * 0.0052; this.lookY += dy * 0.0052;      // touch: the view turns the way the finger moves
    }
    this.onActivity();
  }

  touchEnd(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    if (t.stick) {
      this.stick = null; this.stickX = this.stickZ = 0; this.onStick?.(0, 0, 0, 0, false);
      if (t.moved > 8) return;
    }
    if (t.moved <= 8 && performance.now() - t.t < 450) this.onTap([e.clientX, e.clientY]);
  }

  poll() {
    const k = this.keys;
    const has = (...c) => c.some((x) => k.has(x));
    this.moveZ = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) + (this.stickZ || 0);
    this.moveX = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) + (this.stickX || 0);
    this.turn = (has('ArrowLeft', 'KeyQ') ? 1 : 0) - (has('ArrowRight') ? 1 : 0);
    this.sprint = has('ShiftLeft', 'ShiftRight') || Math.hypot(this.stickX || 0, this.stickZ || 0) > 0.92;
    if (this.wheel) { this.moveZ += Math.max(-1, Math.min(1, this.wheel)) * 1.6; this.wheel *= 0.82; if (Math.abs(this.wheel) < 0.02) this.wheel = 0; }
    return this;
  }

  get active() { return this.keys.size > 0 || this.touches.size > 0 || !!this.wheel || this.lookX !== 0 || this.lookY !== 0; }
}
