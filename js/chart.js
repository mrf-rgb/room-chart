// Seating chart drawing and touch handling. Tables are drawn at their rotation; the text on
// every card is drawn upright on its own layer, so a turned table never shows names upside down.

import { SEAT_W, SEAT_H, seatCenters } from './model.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD_X = 20, PAD_TOP = 70, PAD_BOTTOM = 70;
const LONG_MS = 550, MOVE_PX = 10;
const TAB_GAP = 12; // room kept clear beside the controls' tab, so a finger on a seat is not taken for the tab

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Chips for the day's marks, each with its letter or digit. A worksheet value carried over from an
// earlier day of the lesson is outlined and dotted until it is changed today.
export function chipsFor(e) {
  if (!e) return [];
  const out = [];
  if (e.absent) out.push({ cls: 'c-abs', text: 'A' });
  if (e.W !== null && e.W !== undefined) out.push({ cls: 'c-w' + e.W + (e.Wcarried ? ' carried' : ''), text: String(e.W), carried: !!e.Wcarried });
  if (e.Pos) out.push({ cls: 'c-pos', text: e.Pos > 1 ? '+' + e.Pos : '+' });
  if (e.Neg) out.push({ cls: 'c-neg', text: e.Neg > 1 ? '−' + e.Neg : '−' });
  if (e.Part) out.push({ cls: 'c-part', text: e.Part > 1 ? 'P' + e.Part : 'P' });
  return out;
}

export class ChartView {
  constructor(svg, h) {
    this.svg = svg;
    this.h = h;           // handlers
    this.z = { k: 1, tx: 0, ty: 0 };
    this.pointers = new Map();
    this.data = null;
    this.fitted = false;
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.cancel(e));
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => { this.fit(); }).observe(svg);
  }

  // data: {room, chart, view, names(code)->{name, code, hasName}, tally, editing, selSeat, selTable, picked}
  set(data) { this.data = data; this.render(); }

  extent() {
    const r = this.data.room;
    return { w: r.w + 2 * PAD_X, h: r.h + PAD_TOP + PAD_BOTTOM };
  }

  // Door-view room point -> drawing point.
  toView(x, y) {
    const r = this.data.room;
    return this.data.view === 'board' ? { x: PAD_X + r.w - x, y: PAD_TOP + r.h - y } : { x: PAD_X + x, y: PAD_TOP + y };
  }

  fromClient(cx, cy) {
    const b = this.svg.getBoundingClientRect();
    const vx = (cx - b.left - this.z.tx) / this.z.k, vy = (cy - b.top - this.z.ty) / this.z.k;
    const r = this.data.room;
    return this.data.view === 'board' ? { x: r.w - (vx - PAD_X), y: r.h - (vy - PAD_TOP) } : { x: vx - PAD_X, y: vy - PAD_TOP };
  }

  fit() {
    if (!this.data) return;
    const b = this.svg.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const ex = this.extent();
    let k = Math.min(b.width / ex.w, b.height / ex.h);
    let tx = (b.width - ex.w * k) / 2, ty = (b.height - ex.h * k) / 2;
    // The controls' tab sits on the chart's top or left edge: keep the room clear of it.
    const tab = this.h.avoid && this.h.avoid();
    const a = tab && tab.offsetParent ? tab.getBoundingClientRect() : null;
    if (a && a.width) {
      if (a.left <= b.left + 1 && a.right > b.left && tx < a.right - b.left + TAB_GAP) {
        const left = a.right - b.left + TAB_GAP, w = b.width - left;
        k = Math.min(w / ex.w, b.height / ex.h); tx = left + (w - ex.w * k) / 2; ty = (b.height - ex.h * k) / 2;
      } else if (a.top <= b.top + 1 && a.bottom > b.top && ty < a.bottom - b.top + TAB_GAP) {
        const top = a.bottom - b.top + TAB_GAP, hh = b.height - top;
        k = Math.min(b.width / ex.w, hh / ex.h); tx = (b.width - ex.w * k) / 2; ty = top + (hh - ex.h * k) / 2;
      }
    }
    this.z = { k, tx, ty };
    this.fitted = true;
    this.applyZoom();
  }

  applyZoom() {
    if (this.vp) this.vp.setAttribute('transform', `translate(${this.z.tx},${this.z.ty}) scale(${this.z.k})`);
  }

  render() {
    const d = this.data;
    const svg = this.svg;
    svg.textContent = '';
    this.vp = el('g', { class: 'vp' }, svg);
    const vp = this.vp;
    const r = d.room;
    const board = d.view === 'board';

    // Room outline, board and back wall.
    const o = this.toView(0, 0), o2 = this.toView(r.w, r.h);
    el('rect', { class: 'room', x: Math.min(o.x, o2.x), y: Math.min(o.y, o2.y), width: r.w, height: r.h, rx: 12 }, vp);
    const boardY = board ? PAD_TOP + r.h + 18 : 12;
    const backY = board ? 12 : PAD_TOP + r.h + 18;
    el('rect', { class: 'board', x: PAD_X + r.w * 0.2, y: boardY, width: r.w * 0.6, height: 40, rx: 6 }, vp);
    const bt = el('text', { class: 'wall-label board-label', x: PAD_X + r.w / 2, y: boardY + 28 }, vp);
    bt.textContent = 'BOARD';
    const kt = el('text', { class: 'wall-label', x: PAD_X + r.w / 2, y: backY + 28 }, vp);
    kt.textContent = 'BACK OF ROOM · DOOR';

    const text = el('g', { class: 'labels' });
    const tables = d.chart ? d.chart.tables : [];
    this.seatSpots = [];
    tables.forEach((t, ti) => {
      const n = t.seats.length;
      const c = this.toView(t.x, t.y);
      const rot = ((t.rot || 0) + (board ? 180 : 0)) % 360;
      const g = el('g', { class: 'table' + (d.selTable === ti ? ' tsel' : ''), transform: `translate(${c.x},${c.y}) rotate(${rot})` }, vp);
      el('rect', { class: 'desk', x: -n * SEAT_W / 2, y: -SEAT_H / 2, width: n * SEAT_W, height: SEAT_H, rx: 8 }, g);
      const centers = seatCenters(t);
      t.seats.forEach((code, i) => {
        const lx = (i - (n - 1) / 2) * SEAT_W;
        // Chair on the side the student sits: behind the desk, away from where the table faces.
        el('rect', { class: 'chair', x: lx - 28, y: SEAT_H / 2 + 3, width: 56, height: 10, rx: 5 }, g);
        const info = code ? d.names(code) : null;
        const e = code ? d.tally[code] : null;
        let cls = 'seat';
        if (!code) cls += ' empty';
        if (e && e.absent) cls += ' absent';
        if (d.selSeat && d.selSeat.t === ti && d.selSeat.i === i) cls += ' sel';
        if (d.picked && d.picked === code) cls += ' picked';
        if (d.dragFrom && d.dragFrom.t === ti && d.dragFrom.i === i) cls += ' dragging';
        const sg = el('g', { class: cls, 'data-t': ti, 'data-i': i }, g);
        el('rect', { class: 'card', x: lx - SEAT_W / 2 + 5, y: -SEAT_H / 2 + 5, width: SEAT_W - 10, height: SEAT_H - 10, rx: 10 }, sg);

        const v = this.toView(centers[i].x, centers[i].y);
        this.seatSpots.push({ t: ti, i, x: v.x, y: v.y, code });
        if (!code) {
          if (d.editing) { const et = el('text', { class: 'empty-label', x: v.x, y: v.y + 6 }, text); et.textContent = 'empty'; }
          return;
        }
        const chips = chipsFor(e);
        const nameY = chips.length ? v.y - 8 : v.y + 2;
        const label = info.hasName ? info.name : info.code;
        const size = Math.min(info.hasName ? 30 : 34, (SEAT_W - 22) / (Math.max(label.length, 3) * 0.6));
        const nt = el('text', { class: 'name' + (info.hasName ? '' : ' code-only'), x: v.x, y: nameY, 'font-size': size.toFixed(1) }, text);
        nt.textContent = label;
        if (info.hasName) {
          const ct = el('text', { class: 'code', x: v.x + SEAT_W / 2 - 14, y: v.y - SEAT_H / 2 + 22 }, text);
          ct.textContent = info.code;
        }
        if (chips.length) {
          // Chips shrink together when there are many, so they stay inside the card.
          const raw = chips.map((ch) => (ch.text.length > 1 ? 40 : 28));
          const rawTotal = raw.reduce((a, b) => a + b, 0) + 4 * (chips.length - 1);
          const f = Math.min(1, (SEAT_W - 16) / rawTotal);
          const widths = raw.map((w) => w * f), gap = 4 * f;
          let x = v.x - (rawTotal * f) / 2;
          chips.forEach((ch, k) => {
            el('rect', { class: 'chip ' + ch.cls, x, y: v.y + 12, width: widths[k], height: 26, rx: 6 }, text);
            const tt = el('text', { class: 'chip-t ' + ch.cls, x: x + widths[k] / 2, y: v.y + 32, 'font-size': (20 * Math.max(f, 0.8)).toFixed(1) }, text);
            tt.textContent = ch.text;
            if (ch.carried) el('circle', { class: 'chip-dot', cx: x + widths[k], cy: v.y + 12, r: 5 }, text);
            x += widths[k] + gap;
          });
        }
      });
      if (d.editing) {
        const hx = n * SEAT_W / 2 + 6;
        const hg = el('g', { class: 'handle', 'data-t': ti }, g);
        el('rect', { x: hx, y: -32, width: 26, height: 64, rx: 6 }, hg);
        for (const yy of [-12, 0, 12]) el('line', { x1: hx + 7, x2: hx + 19, y1: yy, y2: yy }, hg);
      }
    });
    vp.appendChild(text);
    if (this.ghost) {
      const gt = el('text', { class: 'ghost', x: this.ghost.x, y: this.ghost.y }, vp);
      gt.textContent = this.ghost.label;
    }
    this.applyZoom();
    if (!this.fitted) this.fit();
  }

  // ---------- touch ----------

  hit(e) {
    const s = e.target.closest && e.target.closest('.seat');
    if (s) return { kind: 'seat', t: +s.dataset.t, i: +s.dataset.i };
    const h = e.target.closest && e.target.closest('.handle');
    if (h) return { kind: 'handle', t: +h.dataset.t };
    return { kind: 'bg' };
  }

  down(e) {
    // A primary pointer starts a new gesture, so a pointer whose "up" was lost can't turn taps into a pinch.
    if (e.isPrimary) this.pointers.clear();
    try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      clearTimeout(this.longTimer);
      this.gesture = { kind: 'pinch', start: this.pinchState(), z: { ...this.z } };
      return;
    }
    if (this.pointers.size > 2) return;
    const hit = this.hit(e);
    this.gesture = { kind: 'press', hit, sx: e.clientX, sy: e.clientY, z: { ...this.z }, moved: false, long: false };
    const d = this.data;
    if (hit.kind === 'seat' && !d.editing) {
      this.longTimer = setTimeout(() => {
        if (this.gesture && !this.gesture.moved) { this.gesture.long = true; this.h.onSeatLong(hit.t, hit.i); }
      }, LONG_MS);
    }
    if (hit.kind === 'handle' && d.editing) {
      const t = d.chart.tables[hit.t];
      this.gesture.table = { x: t.x, y: t.y, p: this.fromClient(e.clientX, e.clientY) };
      this.h.onTableSelect(hit.t);
    }
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;
    const box = this.svg.getBoundingClientRect();
    if (g.kind === 'pinch' && this.pointers.size === 2) {
      const now = this.pinchState();
      const k = Math.max(0.3, Math.min(6, g.z.k * now.dist / g.start.dist));
      const cx = g.start.mx - box.left, cy = g.start.my - box.top;
      const wx = (cx - g.z.tx) / g.z.k, wy = (cy - g.z.ty) / g.z.k;
      this.z = { k, tx: now.mx - box.left - wx * k, ty: now.my - box.top - wy * k };
      this.applyZoom();
      return;
    }
    if (g.kind !== 'press') return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > MOVE_PX) { g.moved = true; clearTimeout(this.longTimer); }
    if (!g.moved) return;
    const d = this.data;
    if (d.editing && g.hit.kind === 'handle' && g.table) {
      const p = this.fromClient(e.clientX, e.clientY);
      this.h.onTableDrag(g.hit.t, g.table.x + p.x - g.table.p.x, g.table.y + p.y - g.table.p.y);
      return;
    }
    if (d.editing && g.hit.kind === 'seat' && d.chart.tables[g.hit.t].seats[g.hit.i]) {
      const code = d.chart.tables[g.hit.t].seats[g.hit.i];
      const info = d.names(code);
      const vx = (e.clientX - box.left - this.z.tx) / this.z.k, vy = (e.clientY - box.top - this.z.ty) / this.z.k;
      this.ghost = { x: vx, y: vy, label: info.hasName ? info.name : info.code };
      d.dragFrom = { t: g.hit.t, i: g.hit.i };
      this.render();
      return;
    }
    this.z = { ...this.z, tx: g.z.tx + dx, ty: g.z.ty + dy };
    this.applyZoom();
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') { if (this.pointers.size === 0) this.gesture = null; return; }
    this.gesture = null;
    const d = this.data;
    if (this.ghost) {
      const drop = this.nearestSeat(e.clientX, e.clientY);
      this.ghost = null; d.dragFrom = null;
      if (drop && !(drop.t === g.hit.t && drop.i === g.hit.i)) this.h.onSeatDrop({ t: g.hit.t, i: g.hit.i }, drop);
      else this.render();
      return;
    }
    if (g.moved) { if (g.hit.kind === 'handle') this.h.onTableDragEnd(g.hit.t); return; }
    if (g.long) return;
    if (g.hit.kind === 'seat') this.h.onSeatTap(g.hit.t, g.hit.i);
    else if (g.hit.kind === 'bg') this.h.onBgTap();
  }

  cancel(e) {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    this.gesture = null;
    if (this.ghost) { this.ghost = null; this.data.dragFrom = null; this.render(); }
  }

  nearestSeat(cx, cy) {
    const box = this.svg.getBoundingClientRect();
    const vx = (cx - box.left - this.z.tx) / this.z.k, vy = (cy - box.top - this.z.ty) / this.z.k;
    let best = null, bd = Infinity;
    for (const s of this.seatSpots) {
      const dd = Math.hypot(s.x - vx, s.y - vy);
      if (dd < bd) { bd = dd; best = s; }
    }
    return best && bd < SEAT_W * 0.6 ? { t: best.t, i: best.i } : null;
  }

  wheel(e) {
    e.preventDefault();
    const box = this.svg.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.max(0.3, Math.min(6, this.z.k * f));
    const cx = e.clientX - box.left, cy = e.clientY - box.top;
    const wx = (cx - this.z.tx) / this.z.k, wy = (cy - this.z.ty) / this.z.k;
    this.z = { k, tx: cx - wx * k, ty: cy - wy * k };
    this.applyZoom();
  }
}
