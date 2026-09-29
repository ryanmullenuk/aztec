import { CAMERA } from '../config';
import { CameraRig } from '../render/CameraRig';

export interface InputHandlers {
  /** A short click/tap without drag. */
  onTap(sx: number, sy: number): void;
  /** Right click / long-press (cancel). */
  onCancel(): void;
  /** Whether a left-drag should go to the active tool (sculpting) instead of panning. */
  wantsToolDrag(): boolean;
  onToolDragStart(sx: number, sy: number): void;
  onToolDrag(sx: number, sy: number): void;
  onToolDragEnd(): void;
  onHover(sx: number, sy: number): void;
  onKey(e: KeyboardEvent): void;
  /** Called on any pointer interaction (first gesture unlocks audio). */
  onInteract(): void;
  /** Screen point to world point on terrain (for zoom-to-cursor). */
  pick(sx: number, sy: number): { x: number; y: number; z: number } | null;
}

interface PointerInfo {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  button: number;
  type: string;
}

/**
 * Desktop: left click select/place, left or right drag pan, wheel zoom, Q/E rotate, WASD pan.
 * Mobile: one finger pan (or sculpt with a sculpt tool), pinch zoom, two-finger twist rotate, tap.
 */
export class Input {
  enabled = true;
  clear(): void { this.keys.clear(); this.pointers.clear(); this.gesture = null; this.dragging = 'none'; this.hover.active = false; }
  private pointers = new Map<number, PointerInfo>();
  private keys = new Set<string>();
  private dragging: 'none' | 'pan' | 'tool' | 'rotate' | 'orbit' = 'none';
  private gesture: { dist: number; angle: number; mx: number; my: number } | null = null;
  private moved = false;
  /** Latest pointer screen position (for cursor-reactive wildlife). */
  hover: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };
  /** True while the camera is being panned, rotated or pinched (wildlife ignores the pointer then). */
  get navigating(): boolean {
    return (this.moved && (this.dragging === 'pan' || this.dragging === 'rotate' || this.dragging === 'orbit')) || !!this.gesture;
  }

  constructor(private el: HTMLElement, private rig: CameraRig, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Stop the browser's middle-click autoscroll so middle-drag can rotate.
    el.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
    el.addEventListener('pointerleave', () => (this.hover.active = false));
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      this.h.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.h.onInteract();
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is optional */
    }
    if (e.button === 1) e.preventDefault();
    const p: PointerInfo = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, type: e.pointerType };
    this.pointers.set(e.pointerId, p);
    this.moved = false;
    if (this.pointers.size === 2) {
      if (this.dragging === 'tool') this.h.onToolDragEnd();
      this.dragging = 'none';
      this.gesture = this.gestureState();
    } else if (this.pointers.size === 1) {
      // Middle-drag, or Alt/Shift + left-drag, rotates the view; right-drag rotates and tilts.
      if (e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey))) this.dragging = 'rotate';
      else if (e.button === 2) this.dragging = 'orbit';
      else if (this.h.wantsToolDrag()) {
        this.dragging = 'tool';
        this.h.onToolDragStart(e.clientX, e.clientY);
      } else this.dragging = 'pan';
    }
  };

  private gestureState() {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  }

  private move = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' || this.pointers.size === 0) {
      this.hover = { x: e.clientX, y: e.clientY, active: true };
      this.h.onHover(e.clientX, e.clientY);
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) this.moved = true;
    if (e.pointerType !== 'mouse') this.hover = { x: e.clientX, y: e.clientY, active: true };

    if (this.pointers.size >= 2 && this.gesture) {
      const g = this.gestureState();
      if (g.dist > 10 && this.gesture.dist > 10) this.rig.zoom(this.gesture.dist / g.dist);
      let da = g.angle - this.gesture.angle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.rig.rotate(-da);
      // Two-finger drag: up/down tilts the view, sideways pans.
      const dmx = g.mx - this.gesture.mx, dmy = g.my - this.gesture.my;
      this.rig.tilt(-dmy * CAMERA.tiltSpeed);
      this.rig.panPixels(dmx, 0, this.el.clientHeight);
      this.gesture = g;
      return;
    }
    if (this.dragging === 'pan' && this.moved) this.rig.panPixels(dx, dy, this.el.clientHeight);
    else if (this.dragging === 'rotate' && this.moved) this.rig.rotate(-dx * CAMERA.dragRotateSpeed);
    else if (this.dragging === 'orbit' && this.moved) {
      this.rig.rotate(-dx * CAMERA.dragRotateSpeed);
      this.rig.tilt(-dy * CAMERA.tiltSpeed);
    }
    else if (this.dragging === 'tool') this.h.onToolDrag(e.clientX, e.clientY);
  };

  private up = (e: PointerEvent) => {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const quick = performance.now() - p.t < 450;
    if (this.pointers.size === 0) {
      if (this.dragging === 'tool') this.h.onToolDragEnd();
      if (!this.moved && !this.gesture) {
        if (p.button === 2) this.h.onCancel();
        else if (quick || p.type === 'mouse') this.h.onTap(p.x, p.y);
      }
      this.dragging = 'none';
      this.gesture = null;
      if (p.type !== 'mouse') this.hover.active = false;
    } else if (this.pointers.size === 1) {
      this.gesture = null;
      this.dragging = 'pan';
      this.moved = true;
    }
  };

  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.h.onInteract();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const toward = this.h.pick(e.clientX, e.clientY);
    this.rig.zoom(Math.exp(delta * CAMERA.zoomSpeed), toward ?? undefined);
  };

  /** Continuous keyboard input (WASD / arrows / Q E). */
  update(dt: number): void {
    if (!this.enabled) return;
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('d') || k.has('arrowright')) r += 1;
    if (k.has('a') || k.has('arrowleft')) r -= 1;
    if (f || r) this.rig.panKeys(f, r, dt);
    if (k.has('q')) this.rig.rotate(CAMERA.rotateSpeed * dt);
    if (k.has('e')) this.rig.rotate(-CAMERA.rotateSpeed * dt);
    if (k.has('+') || k.has('=')) this.rig.zoom(Math.exp(-1.2 * dt));
    if (k.has('-') || k.has('_')) this.rig.zoom(Math.exp(1.2 * dt));
    if (k.has('pageup')) this.rig.tilt(40 * dt);
    if (k.has('pagedown')) this.rig.tilt(-40 * dt);
  }
}
