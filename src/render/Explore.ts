import type { CameraRig } from './CameraRig';
import type { World } from '../world/World';

/** Free-roaming observer: never moves an islander or issues a world action. */
export class Explore {
  active = false;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  /** How far above islander eye level the view floats (the height slider, Q/E), and the chosen pace. */
  private lift = 0;
  private pace = 1;
  private ground: number | null = null;
  private heightIn!: HTMLInputElement;
  private heightOut!: HTMLSpanElement;
  private paceBtn!: HTMLButtonElement;
  private keys = new Set<string>();
  private sticks = {
    move: { x: 0, y: 0, pointer: -1 },
    look: { x: 0, y: 0, pointer: -1 },
  };
  private overlay: HTMLDivElement;
  private previous?: { cur: CameraRig['cur']; fov: number; near: number };

  constructor(private rig: CameraRig, private world: World, private onExit: () => void) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'explore-ui hidden';
    this.overlay.innerHTML = `<div class="explore-heading"><span class="explore-title">FREE ROAM</span>
        <div class="explore-opts">
          <label class="explore-height" title="Height above the ground (keys Q and E)">HEIGHT
            <input type="range" min="0" max="${Explore.maxLift}" step="0.5" value="0" aria-label="Viewing height"><span class="explore-hval">Eye</span></label>
          <button class="btn small" data-pace title="Travel speed (hold Shift to go faster)">Run</button>
        </div>
        <button class="btn" data-exit>Exit explore</button></div>
      <div class="explore-stick explore-move" data-stick="move" aria-label="Move joystick: drag to move. Keyboard W A S D." role="group">
        <span class="explore-thumb"></span><span class="explore-label">MOVE</span>
      </div>
      <div class="explore-stick explore-look" data-stick="look" aria-label="Look joystick: drag to turn. Keyboard arrow keys." role="group">
        <span class="explore-thumb"></span><span class="explore-label">LOOK</span>
      </div>`;
    document.body.appendChild(this.overlay);
    this.overlay.querySelector('[data-exit]')!.addEventListener('click', onExit);
    this.heightIn = this.overlay.querySelector('.explore-height input')!;
    this.heightOut = this.overlay.querySelector('.explore-hval')!;
    this.heightIn.addEventListener('input', () => this.setLift(Number(this.heightIn.value)));
    // Keys still move and look after using the slider.
    this.heightIn.addEventListener('change', () => this.heightIn.blur());
    this.paceBtn = this.overlay.querySelector('[data-pace]')!;
    this.paceBtn.addEventListener('click', () => {
      this.pace = (this.pace + 1) % Explore.paces.length;
      this.paceBtn.textContent = Explore.paces[this.pace].name;
      this.paceBtn.blur();
    });
    this.overlay.querySelectorAll<HTMLDivElement>('[data-stick]').forEach(pad => {
      const stick = this.sticks[pad.dataset.stick as keyof typeof this.sticks];
      const move = (e: PointerEvent) => {
        if (stick.pointer !== e.pointerId) return;
        e.preventDefault();
        const rect = pad.getBoundingClientRect(), radius = rect.width * 0.3;
        const x = (e.clientX - rect.left - rect.width / 2) / radius;
        const y = (e.clientY - rect.top - rect.height / 2) / radius;
        const length = Math.hypot(x, y), scale = Math.max(1, length);
        stick.x = length < 0.12 ? 0 : x / scale;
        stick.y = length < 0.12 ? 0 : y / scale;
        pad.style.setProperty('--stick-x', `${stick.x * radius}px`);
        pad.style.setProperty('--stick-y', `${stick.y * radius}px`);
      };
      pad.onpointerdown = e => {
        if (!this.active || stick.pointer !== -1 || e.button !== 0) return;
        stick.pointer = e.pointerId;
        pad.setPointerCapture(e.pointerId);
        move(e);
      };
      pad.onpointermove = move;
      const release = (e: PointerEvent) => {
        if (stick.pointer !== e.pointerId) return;
        stick.x = stick.y = 0; stick.pointer = -1;
        pad.style.setProperty('--stick-x', '0px'); pad.style.setProperty('--stick-y', '0px');
      };
      pad.onpointerup = release; pad.onpointercancel = release; pad.onlostpointercapture = release;
      pad.oncontextmenu = e => e.preventDefault();
    });
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return; }
      if (e.target instanceof HTMLInputElement && e.key.startsWith('Arrow')) return;
      const key = this.key(e.key);
      if (key) { e.preventDefault(); this.keys.add(key); }
    });
    window.addEventListener('keyup', e => this.keys.delete(this.key(e.key)));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  /** Travel speeds (world units a second at eye level) for the pace button. */
  private static paces = [{ name: 'Walk', speed: 3 }, { name: 'Run', speed: 7 }, { name: 'Fast', speed: 14 }];
  private static maxLift = 40;

  private setLift(v: number): void {
    this.lift = Math.max(0, Math.min(Explore.maxLift, v));
    this.heightIn.value = String(this.lift);
    this.heightOut.textContent = this.lift < 0.25 ? 'Eye' : `${Math.round(this.lift + 1.55)} m`;
  }

  private key(key: string): string {
    if (key === 'Shift') return 'sprint';
    return ({ w: 'up', s: 'down', a: 'strafe-left', d: 'strafe-right', q: 'rise', e: 'sink',
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'look-up', ArrowDown: 'look-down',
      r: 'look-up', f: 'look-down' } as Record<string, string>)[key.length === 1 ? key.toLowerCase() : key] ?? '';
  }
  private clear(): void {
    this.keys.clear();
    for (const stick of Object.values(this.sticks)) { stick.x = stick.y = 0; stick.pointer = -1; }
    this.overlay.querySelectorAll<HTMLElement>('[data-stick]').forEach(pad => {
      pad.style.setProperty('--stick-x', '0px'); pad.style.setProperty('--stick-y', '0px');
    });
  }

  enter(x: number, z: number): void {
    this.previous = { cur: { ...this.rig.cur }, fov: this.rig.camera.fov, near: this.rig.camera.near };
    this.x = x; this.z = z;
    this.yaw = this.rig.cur.yaw; this.pitch = 0; this.clear(); this.ground = null;
    this.active = true;
    this.rig.camera.fov = 65; this.rig.camera.near = 0.05; this.rig.camera.updateProjectionMatrix();
    document.body.classList.add('exploring'); this.overlay.classList.remove('hidden');
    this.update(0);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false; this.clear();
    if (this.previous) {
      this.rig.cur = { ...this.previous.cur };
      this.rig.camera.fov = this.previous.fov; this.rig.camera.near = this.previous.near;
      this.rig.camera.updateProjectionMatrix();
    }
    this.overlay.classList.add('hidden'); document.body.classList.remove('exploring');
    this.rig.update(0);
  }

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const axis = (a: string, b: string) => Number(this.keys.has(a)) - Number(this.keys.has(b));
    this.yaw += (axis('left', 'right') - this.sticks.look.x) * dt * 1.6;
    const rise = axis('rise', 'sink');
    if (rise) this.setLift(this.lift + rise * dt * (4 + this.lift * 0.6));
    const high = Math.min(1, this.lift / 15);
    // Higher up, look further down over the island.
    this.pitch = Math.max(-0.65 - 0.6 * high, Math.min(0.65,
      this.pitch + (axis('look-up', 'look-down') - this.sticks.look.y) * dt));
    const forward = axis('up', 'down') - this.sticks.move.y;
    const strafe = axis('strafe-right', 'strafe-left') + this.sticks.move.x;
    // Faster the higher the view (the ground passes slower below), and with Shift held.
    const speed = Explore.paces[this.pace].speed * (1 + this.lift / 10) * (this.keys.has('sprint') ? 2.2 : 1);
    const step = dt * speed / Math.max(1, Math.hypot(forward, strafe));
    // Deliberately ignore occupancy, vegetation, shorelines and steep terrain (kept near the map).
    const W = this.world, pad = 60;
    this.x = Math.max(W.centerX(0) - pad, Math.min(W.centerX(W.N - 1) + pad, this.x + (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) * step));
    this.z = Math.max(W.centerZ(0) - pad, Math.min(W.centerZ(W.N - 1) + pad, this.z + (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) * step));
    // The ground eased under the view, so floating over rocks and roofs doesn't jolt.
    const ground = Math.max(0, this.world.heightAt(this.x, this.z));
    this.ground = this.ground == null ? ground : this.ground + (ground - this.ground) * Math.min(1, dt * (this.lift > 1 ? 3 : 12));
    const eye = this.ground + 1.55 + this.lift;
    this.rig.cur.x = this.x; this.rig.cur.z = this.z; this.rig.cur.dist = 40;
    this.rig.camera.position.set(this.x, eye, this.z);
    this.rig.target.set(this.x - Math.sin(this.yaw) * 8, eye + Math.tan(this.pitch) * 8, this.z - Math.cos(this.yaw) * 8);
    this.rig.camera.lookAt(this.rig.target); this.rig.camera.updateMatrixWorld();
  }
}
