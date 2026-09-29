import type { CameraRig } from './CameraRig';
import type { World } from '../world/World';

/** Walking observer: never moves an islander or issues a world action. */
export class Explore {
  active = false;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private held = new Map<number, string>();
  private overlay: HTMLDivElement;
  private previous?: { cur: CameraRig['cur']; fov: number; near: number };

  constructor(private rig: CameraRig, private world: World, private onExit: () => void) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'explore-ui hidden';
    this.overlay.innerHTML = `<div class="explore-heading">ISLANDER VIEW <button class="btn" data-exit>Exit explore</button></div>
      <div class="explore-pad" aria-label="Exploration controls">
      <button data-dir="up" aria-label="Walk forward">▲</button>
      <button data-dir="left" aria-label="Turn left">↶</button>
      <button data-dir="down" aria-label="Walk backwards">▼</button>
      <button data-dir="right" aria-label="Turn right">↷</button></div>
      <div class="explore-look"><button data-dir="look-up" aria-label="Look up">Look up</button><button data-dir="look-down" aria-label="Look down">Look down</button></div>`;
    document.body.appendChild(this.overlay);
    this.overlay.querySelector('[data-exit]')!.addEventListener('click', onExit);
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(button => {
      button.onpointerdown = e => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        this.held.set(e.pointerId, button.dataset.dir!);
      };
      const release = (e: PointerEvent) => this.held.delete(e.pointerId);
      button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
    });
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return; }
      const key = this.key(e.key);
      if (key) { e.preventDefault(); this.keys.add(key); }
    });
    window.addEventListener('keyup', e => this.keys.delete(this.key(e.key)));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  private key(key: string): string {
    return ({ w: 'up', ArrowUp: 'up', s: 'down', ArrowDown: 'down', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right', r: 'look-up', f: 'look-down' } as Record<string, string>)[key] ?? '';
  }
  private clear(): void { this.keys.clear(); this.held.clear(); }

  canStand(x: number, z: number): boolean {
    return [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].every(([dx, dz]) => {
      const i = this.world.cellIndexAt(x + dx, z + dz);
      return i >= 0 && this.world.isLandCell(i) && !this.world.occ[i];
    });
  }

  enter(x: number, z: number): boolean {
    let spawn: [number, number] | undefined;
    // Start close to the selected islander without clipping into them or their building.
    for (let r = 1; r <= 12 && !spawn; r++) for (let n = 0; n < 16; n++) {
      const a = n * Math.PI / 8, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (this.canStand(nx, nz)) { spawn = [nx, nz]; break; }
    }
    if (!spawn) return false;
    this.previous = { cur: { ...this.rig.cur }, fov: this.rig.camera.fov, near: this.rig.camera.near };
    [this.x, this.z] = spawn;
    this.yaw = this.rig.cur.yaw; this.pitch = 0; this.clear();
    this.active = true;
    this.rig.camera.fov = 65; this.rig.camera.near = 0.05; this.rig.camera.updateProjectionMatrix();
    document.body.classList.add('exploring'); this.overlay.classList.remove('hidden');
    this.update(0);
    return true;
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
    const pressed = new Set([...this.keys, ...this.held.values()]);
    const axis = (a: string, b: string) => Number(pressed.has(a)) - Number(pressed.has(b));
    this.yaw += axis('left', 'right') * dt * 1.6;
    this.pitch = Math.max(-0.65, Math.min(0.65, this.pitch + axis('look-up', 'look-down') * dt));
    const step = axis('up', 'down') * dt * 2.4;
    const nx = this.x - Math.sin(this.yaw) * step, nz = this.z - Math.cos(this.yaw) * step;
    if (this.canStand(nx, nz) && Math.abs(this.world.heightAt(nx, nz) - this.world.heightAt(this.x, this.z)) <= 0.35) {
      this.x = nx; this.z = nz;
    }
    const eye = this.world.heightAt(this.x, this.z) + 1.55;
    this.rig.cur.x = this.x; this.rig.cur.z = this.z; this.rig.cur.dist = 40;
    this.rig.camera.position.set(this.x, eye, this.z);
    this.rig.target.set(this.x - Math.sin(this.yaw) * 8, eye + Math.tan(this.pitch) * 8, this.z - Math.cos(this.yaw) * 8);
    this.rig.camera.lookAt(this.rig.target); this.rig.camera.updateMatrixWorld();
  }
}
