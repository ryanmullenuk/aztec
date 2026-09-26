import * as THREE from 'three';
import { BUILDINGS, BuildingKey, CAMERA, ISLANDER, MILESTONES, POWERS, PresetName, RENDER, SAVE } from './config';
import { World } from './world/World';
import { generateIsland } from './world/generator';
import { GameTime } from './world/Time';
import { RNG } from './world/rng';
import { Terrain } from './terrain/Terrain';
import { Sculptor, SculptMode } from './terrain/Sculpt';
import { Water } from './water/Water';
import { Lighting } from './render/Lighting';
import { PostFX } from './render/PostFX';
import { CameraRig } from './render/CameraRig';
import { FX } from './render/materials';
import { Input } from './ui/Input';
import { UI } from './ui/UI';
import { TOOLS, ToolId } from './ui/tools';
import { Vegetation } from './vegetation/Vegetation';
import { GrassTufts } from './vegetation/GrassTufts';
import { PeakClouds } from './render/PeakClouds';
import { Economy } from './economy/Economy';
import { BuildingSystem, Building } from './buildings/Buildings';
import { Pathfinder } from './ai/Pathfinder';
import { Colony } from './ai/Colony';
import { IslanderRig } from './entities/IslanderRig';
import { Wildlife } from './entities/Wildlife';
import { Boats } from './entities/Boats';
import { Marine } from './entities/Marine';
import { Powers } from './economy/Powers';
import { AudioEngine } from './audio/Audio';
import { SaveData, applyRest, applyWorld, readSave, writeSave } from './world/Save';
import { SPECIES, TIME } from './config';
import type { Islander } from './entities/Islander';

export interface GameOptions {
  seed: number;
  preset: PresetName;
  /** Textured islander models (null = procedural figures). */
}

export interface Settings {
  preset: PresetName;
  dof: boolean;
  dofStrength: number;
  volume: number;
  music: number;
  muted: boolean;
  fps: boolean;
  /** Drop the graphics preset automatically if the frame rate is too low. */
  autoQuality: boolean;
  shadows: boolean;
  /** Day/night cycle; when off the island stays in warm afternoon light. */
  dayNight: boolean;
  /** Random rain and storms. */
  weather: boolean;
  /** Chunky pixel-art rendering. */
  pixel: boolean;
}

/** Minimal interface the UI and colony use for sound (implemented by the audio engine). */
export interface AudioLike {
  sfx(name: string, x?: number, z?: number): void;
}

/** Owns the renderer, scene and every system; runs the main loop and routes input to tools. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world = new World();
  readonly time = new GameTime();
  readonly rig: CameraRig;
  readonly eco = new Economy();
  terrain: Terrain;
  water: Water;
  veg: Vegetation;
  tufts: GrassTufts;
  clouds: PeakClouds;
  buildings: BuildingSystem;
  pathfinder: Pathfinder;
  colony: Colony;
  rig3d: IslanderRig;
  sculptor: Sculptor;
  lighting: Lighting;
  post: PostFX;
  input: Input;
  ui: UI;
  audio: AudioEngine;
  wildlife: Wildlife;
  boats: Boats;
  marine: Marine;
  powers: Powers;
  rng: RNG;
  settings: Settings;

  tool: ToolId = 'select';
  placing: BuildingKey | null = null;
  private placeRot = 0;
  selectedIslander = -1;
  selectedBuilding = -1;
  /** Selected land animal (index into wildlife.animals.list), or -1. */
  selectedAnimal = -1;
  followId = -1;
  stats = { sculpted: 0, marked: 0, boats: 0 };
  milestones = new Set<string>();
  /** -1, 0 or 1 while a rotate button is held. */
  rotateHold = 0;
  private defaultYaw = 0;
  /** True while it rains (set by the weather system). */
  raining = false;

  private clock = new THREE.Timer();
  private fps = { frames: 0, acc: 0, value: 60 };
  private wearTimer = 0;
  private milestoneTimer = 0;
  private hoverPoint: THREE.Vector3 | null = null;
  private brush: THREE.Mesh;
  private harvestDrag = false;
  private preset: PresetName;

  /** Extra per-frame systems registered by later modules (wildlife, boats, powers, audio...). */
  readonly systems: ((realDt: number, dt: number) => void)[] = [];
  onSettingsChanged: ((s: Settings) => void) | null = null;
  powerHandler: ((tool: ToolId, p: THREE.Vector3) => void) | null = null;
  interactHandler: (() => void) | null = null;
  completeHandler: ((b: Building) => void) | null = null;
  boatHandler: ((b: Building) => void) | null = null;
  boatListHandler: (() => { x: number; z: number }[]) | null = null;
  saveHandler: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, opts: GameOptions) {
    this.settings = this.loadSettings(opts.preset);
    this.preset = this.settings.preset;
    this.rng = new RNG(opts.seed * 13 + 7);
    const cfg = RENDER.presets[this.preset];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    // PCF with the soft kernel (PCFSoftShadowMap was folded into PCFShadowMap in recent three.js).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    generateIsland(this.world, opts.seed);
    // Plants are generated from the untouched island so saved plant states line up.
    this.veg = new Vegetation(this.world, this.preset);
    const save = readSave(opts.seed);
    if (save) applyWorld(this.world, save);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight, this.world);
    this.rig.boundRadius = this.world.half * 0.95;
    this.scene.fog = new THREE.Fog(RENDER.fogColor, RENDER.fogNear, RENDER.fogFar);
    this.scene.background = new THREE.Color(RENDER.fogColor);

    this.terrain = new Terrain(this.world, cfg.terrainSubdiv);
    this.scene.add(this.terrain.mesh);
    this.scene.add(this.veg.group);
    this.tufts = new GrassTufts(this.world, cfg.vegDensity);
    this.scene.add(this.tufts.group);
    this.clouds = new PeakClouds(this.world);
    this.scene.add(this.clouds.group);
    this.water = new Water(this.world);
    this.scene.add(this.water.group);

    this.buildings = new BuildingSystem(this.world, this.veg, this.eco, this.terrain, this.scene);
    this.scene.add(this.buildings.group);
    this.pathfinder = new Pathfinder(this.world);
    this.colony = new Colony(this.world, this.veg, this.eco, this.buildings, this.pathfinder, this.time, () => this.rng.next());
    this.colony.hooks.notify = (t) => this.ui?.toast(t);
    this.colony.hooks.sfx = (n, x, z) => this.audio?.sfx(n, x, z);
    this.rig3d = new IslanderRig();
    this.scene.add(this.rig3d.group);
    this.sculptor = new Sculptor(this.world, this.terrain, this.water, this.veg, this.eco);
    this.buildings.onComplete = (b) => this.onBuildingComplete(b);

    this.lighting = new Lighting(this.scene, cfg.shadowSize);
    const seaAngle = Math.atan2(this.world.seaDir.z, this.world.seaDir.x);
    this.lighting.eveningAzimuth = seaAngle + Math.PI;

    // Compose the default view: sea lower-left, highlands upper-right, sun behind the scene at upper-right.
    const m = this.world.meadow;
    const yaw = (3 * Math.PI) / 4 - seaAngle;
    this.rig.jumpTo(m.x + this.world.seaDir.x * 7, m.z + this.world.seaDir.z * 7, CAMERA.startDistance, yaw);
    this.defaultYaw = yaw;

    this.wildlife = new Wildlife(this.world, this.veg);
    this.scene.add(this.wildlife.group);
    this.boats = new Boats(this.world, this.water, this.buildings, this.colony, this.eco, this.wildlife, this.veg);
    this.scene.add(this.boats.group);
    this.boats.blockCells(this.wildlife.coral.cells());
    this.marine = new Marine(this.world, this.water);
    this.scene.add(this.marine.group);
    this.powers = new Powers(this.eco, this.buildings, this.lighting, this.water, this.time, () => this.rng.next());
    this.scene.add(this.powers.group);
    this.audio = new AudioEngine();
    if (this.world.waterfall) this.audio.waterfall = { x: this.world.waterfall.x, y: this.world.waterfall.bottomY, z: this.world.waterfall.z };
    this.connectSystems();

    if (save) this.loadFrom(save);
    else this.foundTribe();

    this.brush = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false })
    );
    this.brush.renderOrder = 30;
    this.brush.visible = false;
    this.scene.add(this.brush);

    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.post.applyPreset(this.preset);
    this.post.setSize(window.innerWidth, window.innerHeight);

    this.input = new Input(canvas, this.rig, {
      onTap: (x, y) => this.onTap(x, y),
      onCancel: () => this.cancel(),
      wantsToolDrag: () => this.tool === 'raise' || this.tool === 'lower' || this.tool === 'flatten' || this.tool === 'harvest',
      onToolDragStart: (x, y) => this.toolDrag(x, y, true),
      onToolDrag: (x, y) => this.toolDrag(x, y, false),
      onToolDragEnd: () => this.toolDragEnd(),
      onHover: (x, y) => this.onHover(x, y),
      onKey: (e) => this.onKey(e),
      onInteract: () => this.interactHandler?.(),
      pick: (x, y) => this.pickGround(x, y),
    });

    this.ui = new UI(this);
    this.applySettings();
    if (save) this.ui.toast('Welcome back. Your island was restored.');
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------- Setup ----------------

  /** Wire the later systems (wildlife, boats, powers, audio, saving) into the colony, buildings and UI. */
  private connectSystems(): void {
    this.colony.hooks.takePenAnimal = (b) => this.wildlife.takeFromPen(b);
    this.colony.hooks.penCount = (b) => this.wildlife.penCount(b);
    const A = this.wildlife.animals;
    this.colony.hooks.animalInfo = (id) => {
      const a = A.get(id);
      if (!a || !a.alive) return null;
      const d = SPECIES[a.sp];
      return { name: d.name, food: true, needsPen: d.needsPen, mode: d.capture, meat: d.meat };
    };
    this.colony.hooks.animalPos = (id) => {
      const a = A.get(id);
      return a && a.alive ? { x: a.x, z: a.z, free: a.pen < 0 && !a.heldBy } : null;
    };
    this.colony.hooks.canCapture = (id) => {
      const a = A.get(id);
      return !!a && A.capturable(a);
    };
    this.colony.hooks.beginChase = (id, isl) => A.beginChase(id, isl);
    this.colony.hooks.catchable = (id, isl) => A.catchable(id, isl);
    this.colony.hooks.grab = (id, isl) => A.grab(id, isl);
    this.colony.hooks.releaseAnimal = (id) => A.release(id);
    this.colony.hooks.putInPen = (id, b) => A.putInPen(id, b);
    this.colony.hooks.consumeAnimal = (id) => A.consume(id);
    // Chickens and goats hang around the settlement.
    A.settlement = () => this.buildings.list.filter((b) => b.complete && b.key !== 'jetty').map((b) => ({ x: b.x, z: b.z }));
    this.colony.hooks.boardBoat = (isl, j) => this.boats.board(isl, j);
    this.boats.onLaunch = () => {
      this.stats.boats++;
    };
    this.boats.sfx = (n, x, z) => this.audio.sfx(n, x, z);
    this.marine.sfx = (n, x, z) => {
      this.audio.sfx(n, x, z);
      if (n === 'splash' && Math.random() < 0.3) this.audio.sfx('whale', x, z);
    };
    this.powers.notify = (t, k) => this.ui?.toast(t, k ?? 'info');
    this.powers.onThunder = () => this.audio.sfx('thunder');
    this.buildings.onRemove = (b) => this.wildlife.releasePen(b.id);
    this.completeHandler = (b) => {
      if (b.key === 'farm' || b.key === 'butcher') this.wildlife.registerPen(b);
      // The first boat at each jetty is free.
      if (b.key === 'jetty' && b.boats.length === 0) b.boatBuild = 0.001;
    };
    this.boatHandler = (b) => {
      if (this.boats.order(b)) this.ui.toast('A new boat is being built at the jetty.');
      else this.ui.toast('Cannot build a boat right now.', 'warn');
    };
    this.boatListHandler = () => this.boats.positions();
    this.powerHandler = (tool, p) => {
      if (tool === 'bless') this.powers.bless(p.x, p.z);
      else if (tool === 'rain') this.powers.summonRain();
      else if (tool === 'calm') this.powers.calm();
    };
    this.interactHandler = () => this.audio.unlock();
    this.onSettingsChanged = (s) => {
      this.audio.volume = s.volume;
      this.audio.music = s.music;
      this.audio.muted = s.muted;
      this.audio.applyVolumes();
    };
    this.saveHandler = () => {
      writeSave(this);
    };
    // Autosave, and save when the page is hidden or closed.
    let acc = 0;
    this.systems.push((realDt) => {
      acc += realDt;
      if (acc >= TIME.autosaveSeconds) {
        acc = 0;
        if (!this.noSave) writeSave(this);
      }
    });
    const flush = () => !this.noSave && writeSave(this);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    window.addEventListener('pagehide', flush);

    const ray = new THREE.Ray();
    const ndc = new THREE.Vector2();
    this.systems.push((realDt, dt) => {
      // Cursor / touch point: birds scatter from the ray, fish and chickens from the ground point.
      const h = this.input.hover;
      let cursorRay: THREE.Ray | null = null;
      if (h.active) {
        const rect = this.canvas.getBoundingClientRect();
        ndc.set(((h.x - rect.left) / rect.width) * 2 - 1, -((h.y - rect.top) / rect.height) * 2 + 1);
        this.ray.setFromCamera(ndc, this.rig.camera);
        ray.copy(this.ray.ray);
        cursorRay = ray;
      }
      // Panning / rotating / pinching the camera must not panic wildlife under the finger.
      const calm = this.input.navigating;
      this.wildlife.update(dt, { ray: calm ? null : cursorRay, ground: h.active && !calm && this.cursorActive ? this.cursorWorld : null, camTarget: this.rig.target }, this.colony.grid);
      void realDt;
      this.boats.update(dt, this.time.elapsed);
      this.marine.update(dt, this.rig.target);
      this.powers.update(dt, realDt, this.rig.target);
      this.raining = this.powers.raining;
      const L = this.audio.listener;
      const tg = this.rig.target;
      const ci = this.world.cellIndexAt(tg.x, tg.z);
      L.x = tg.x;
      L.y = tg.y;
      L.z = tg.z;
      L.zoom = this.rig.cur.dist;
      L.coast = ci >= 0 ? Math.max(0, 1 - this.world.distWater[ci] / 14) : 1;
      L.forest = this.world.sampleField(this.world.forest, tg.x, tg.z);
      L.wind = FX.uWind.value;
      L.night = this.lighting.state.night;
      L.rain = this.powers.rainAmt;
      this.audio.update(realDt);
    });
  }

  /** Restore a saved island (terrain changes were applied before the meshes were built). */
  private loadFrom(save: SaveData): void {
    applyRest(this, save);
    this.terrain.updateWear();
  }

  /** Start a new tribe: the tribal fire in the meadow and the first six islanders. */
  foundTribe(): void {
    const m = this.world.meadow;
    const [cx, cz] = this.world.cellOf(m.x, m.z);
    // Level a small plaza under the fire.
    for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) this.world.layer[this.world.idx(x, z)] = m.layer;
    this.world.computeSmooth(cx - 3, cz - 3, cx + 3, cz + 3);
    this.terrain.rebuild(cx - 3, cz - 3, cx + 3, cz + 3);
    this.buildings.place('campfire', cx - 1, cz - 1, 0, true);
    const genders: ('m' | 'f')[] = [];
    for (let i = 0; i < ISLANDER.startMale; i++) genders.push('m');
    for (let i = 0; i < ISLANDER.startFemale; i++) genders.push('f');
    genders.forEach((gd, i) => {
      const a = (i / genders.length) * Math.PI * 2;
      this.colony.spawn(gd, m.x + Math.cos(a) * 2.6, m.z + Math.sin(a) * 2.6);
    });
  }

  private loadSettings(preset: PresetName): Settings {
    const def: Settings = { preset, dof: true, dofStrength: RENDER.dof.strength, volume: 0.7, music: 0.5, muted: false, fps: false, autoQuality: true, shadows: true, dayNight: true, weather: true, pixel: false };
    try {
      const s = JSON.parse(localStorage.getItem(SAVE.settingsKey) ?? 'null');
      if (s) return { ...def, ...s };
    } catch {
      /* storage unavailable */
    }
    return def;
  }

  /** Render resolution: device pixels capped by the preset, or ~380 px tall in pixel style. */
  private pixelRatio(): number {
    if (this.settings.pixel) return Math.min(1, Math.max(0.18, RENDER.pixelStyleHeight / Math.max(1, window.innerHeight)));
    return Math.min(window.devicePixelRatio, RENDER.presets[this.preset ?? this.settings.preset].pixelRatio);
  }

  private applied: Partial<Settings> = {};

  applySettings(): void {
    const s = this.settings;
    if (this.preset !== s.preset) this.setPreset(s.preset);
    const was = this.applied;
    if (was.shadows !== s.shadows) {
      this.renderer.shadowMap.enabled = s.shadows;
      this.lighting.sun.castShadow = s.shadows;
      // Shadow support is compiled into shaders: rebuild them.
      if (was.shadows !== undefined) this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    if (was.pixel !== s.pixel) {
      this.canvas.classList.toggle('pixel', s.pixel);
      this.post.setPixelStyle(s.pixel);
      this.renderer.setPixelRatio(this.pixelRatio());
      this.resize();
    }
    this.powers.randomWeather = s.weather;
    if (!s.weather && was.weather && this.powers.state !== 'clear') this.powers.state = 'clear';
    this.applied = { ...s };
    this.post.dofEnabled = s.dof;
    this.post.dofStrength = s.dofStrength;
    this.onSettingsChanged?.(s);
    try {
      localStorage.setItem(SAVE.settingsKey, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }

  setPreset(p: PresetName): void {
    this.preset = p;
    const cfg = RENDER.presets[p];
    this.renderer.setPixelRatio(this.pixelRatio());
    this.lighting.setShadowSize(cfg.shadowSize);
    this.post.applyPreset(p);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    // Hidden or collapsed views report zero size; keep the last good size.
    if (w < 2 || h < 2) return;
    if (this.settings.pixel) this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  start(): void {
    this.clock.connect(document);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- Time controls ----------------

  togglePause(): void {
    this.time.paused = !this.time.paused;
  }
  setSpeed(s: number): void {
    this.time.speed = s;
    this.time.paused = false;
  }
  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.applySettings();
  }

  // ---------------- Tools & selection ----------------

  setTool(id: ToolId): void {
    this.audio?.sfx('click');
    if (this.tool === id && id !== 'select' && !this.placing) id = 'select';
    this.tool = id;
    this.placing = null;
    this.buildings.showGhost(null);
    this.brush.visible = false;
    const hints: Partial<Record<ToolId, string>> = {
      raise: 'Hold and drag to <b>raise</b> the land one layer',
      lower: 'Hold and drag to <b>lower</b> the land one layer',
      flatten: 'Hold and drag to <b>level</b> land to the layer you start on',
      harvest: 'Tap or drag over trees, rocks and fruit to mark them · tap a pig, goat, chicken or tapir to hunt it',
      bless: 'Tap near your farms to bless their crops',
      rain: 'Tap anywhere to summon rain',
      calm: 'Tap anywhere to calm a storm',
    };
    this.ui.setHint(hints[id] ?? null);
  }

  startPlacing(key: BuildingKey): void {
    this.audio?.sfx('click');
    this.tool = 'build';
    this.placing = key;
    this.ui.setHint(`Place the <b>${BUILDINGS[key].name}</b> on flat land · <b>R</b> rotates · right-click or Esc cancels`);
    if (this.hoverPoint) this.updateGhost(this.hoverPoint);
  }

  select(s: { islander?: number; building?: number; animal?: number } | null): void {
    this.selectedIslander = s?.islander ?? -1;
    this.selectedBuilding = s?.building ?? -1;
    this.selectedAnimal = s?.animal ?? -1;
    if (!s) this.followId = -1;
  }

  private cancel(): void {
    if (this.placing) {
      this.placing = null;
      this.buildings.showGhost(null);
      this.setTool('build');
      return;
    }
    if (this.tool !== 'select') this.setTool('select');
    else this.select(null);
  }

  /** Footprint origin cell and rotation for a building centred on a ground point. */
  private footprintAt(p: THREE.Vector3, key: BuildingKey): [number, number, number] {
    const [sw, sd] = BUILDINGS[key].size;
    let rot = this.placeRot;
    const w0 = rot % 2 ? sd : sw, d0 = rot % 2 ? sw : sd;
    const cx = Math.round(p.x + this.world.half - w0 / 2);
    const cz = Math.round(p.z + this.world.half - d0 / 2);
    if (key === 'jetty') rot = this.buildings.jettyRot(cx, cz);
    return [cx, cz, rot];
  }

  private updateGhost(p: THREE.Vector3): void {
    if (!this.placing) return;
    const [cx, cz, rot] = this.footprintAt(p, this.placing);
    const res = this.buildings.showGhost(this.placing, cx, cz, rot);
    if (!res.ok && res.reason) this.ui.setHint(`<b>${res.reason}</b> · R rotates · Esc cancels`);
    else this.ui.setHint(`Tap to place the <b>${BUILDINGS[this.placing].name}</b> · <b>R</b> rotates · right-click or Esc cancels`);
  }

  private onHover(x: number, y: number): void {
    const p = this.pickGround(x, y);
    this.hoverPoint = p;
    this.cursorActive = !!p;
    if (!p) return;
    this.cursorWorld.copy(p);
    if (this.placing) this.updateGhost(p);
    const sculpt = this.tool === 'raise' || this.tool === 'lower' || this.tool === 'flatten';
    const area = this.tool === 'harvest' || this.tool === 'bless';
    this.brush.visible = sculpt || area;
    if (this.brush.visible) {
      const r = this.tool === 'bless' ? POWERS.bless.radius : this.tool === 'harvest' ? 2 : POWERS.sculptRadius;
      this.brush.scale.setScalar(r);
      this.brush.position.set(p.x, Math.max(0, p.y) + 0.08, p.z);
    }
  }

  private onTap(x: number, y: number): void {
    const p = this.pickGround(x, y);
    if (p) {
      this.cursorWorld.copy(p);
      this.cursorActive = true;
    }
    if (this.placing) {
      if (!p) return;
      const [cx, cz, rot] = this.footprintAt(p, this.placing);
      const ok = this.buildings.canPlace(this.placing, cx, cz, rot);
      if (!ok.ok) {
        this.ui.toast(ok.reason, 'warn');
        this.audio?.sfx('deny');
        return;
      }
      const b = this.buildings.place(this.placing, cx, cz, rot);
      this.audio?.sfx('place', b.x, b.z);
      this.ui.toast(`${b.def.name} site placed. Builders are on their way.`);
      this.placing = null;
      this.buildings.showGhost(null);
      this.setTool('select');
      this.select({ building: b.id });
      return;
    }
    switch (this.tool) {
      case 'select':
      case 'build':
        return this.selectAt(x, y, p);
      case 'harvest': {
        const rect = this.canvas.getBoundingClientRect();
        const an = this.wildlife.animals.pick(this.rig.camera, x, y, rect, 18);
        if (an && an.pen < 0 && !an.heldBy) {
          this.captureAnimal(an.id);
          return;
        }
        if (p) this.markAt(p, true);
        return;
      }
      case 'raise':
      case 'lower':
      case 'flatten':
        return;
      default:
        if (p) this.powerHandler?.(this.tool, p);
    }
  }

  private selectAt(x: number, y: number, p: THREE.Vector3 | null): void {
    const rect = this.canvas.getBoundingClientRect();
    const isl = this.colony.pick(this.rig.camera, x, y, rect);
    const current = this.selectedIslander >= 0 ? this.colony.byId(this.selectedIslander) : undefined;
    if (isl && isl !== current) {
      this.select({ islander: isl.id });
      this.audio?.sfx('select', isl.x, isl.z);
      return;
    }
    // Animals: with an islander selected, send them after it; otherwise select it.
    const animal = this.wildlife.animals.pick(this.rig.camera, x, y, rect);
    if (animal && animal.pen < 0 && !animal.heldBy) {
      if (current && !current.child) {
        this.captureAnimal(animal.id, current);
        return;
      }
      this.select({ animal: animal.id });
      this.audio?.sfx('select', animal.x, animal.z);
      return;
    }
    // Tap a whale to make it breach.
    if (p && p.y <= 0.05) {
      const w = this.marine.whaleNear(p.x, p.z, 4);
      if (w) {
        this.marine.breach(w);
        return;
      }
    }
    const cell = p ? this.world.cellIndexAt(p.x, p.z) : -1;
    const b = (cell >= 0 ? this.buildings.at(cell) : undefined) ?? this.jettyAt(p);
    // With an islander selected, clicking a building or resource assigns them to it.
    if (current && !current.child) {
      if (b) {
        this.ui.toast(this.colony.assign(current, b, null));
        this.audio?.sfx('click');
        return;
      }
      if (p) {
        const plant = this.veg.findNearest(p.x, p.z, 2, (q) => this.veg.isChoppable(q) || this.veg.isMineable(q) || this.veg.hasFruit(q));
        if (plant && Math.hypot(plant.x - p.x, plant.z - p.z) < 1.5) {
          this.ui.toast(this.colony.assign(current, null, plant));
          this.audio?.sfx('click');
          return;
        }
      }
    }
    if (b) {
      this.select({ building: b.id });
      this.audio?.sfx('select', b.x, b.z);
      return;
    }
    this.select(null);
  }

  /** Player order: capture / hunt an animal (optionally with a chosen islander). */
  captureAnimal(id: number, who: Islander | null = null): boolean {
    const r = this.colony.orderCapture(who, id);
    this.ui.toast(r.msg, r.ok ? 'info' : 'warn');
    this.audio?.sfx(r.ok ? 'click' : 'deny');
    return r.ok;
  }

  private jettyAt(p: THREE.Vector3 | null): Building | undefined {
    if (!p) return undefined;
    return this.buildings.of('jetty', false).find((j) => {
      // Anywhere along the deck counts.
      for (let t = 0; t <= 1; t += 0.2) {
        if (Math.hypot(j.x + (j.dockX - j.x) * t - p.x, j.z + (j.dockZ - j.z) * t - p.z) < 1.3) return true;
      }
      return false;
    });
  }

  private markAt(p: THREE.Vector3, tap: boolean): void {
    let n = this.veg.markArea(p.x, p.z, 2, true);
    if (tap && n === 0) n = this.veg.markArea(p.x, p.z, 1.5, false);
    if (n) this.audio?.sfx('mark', p.x, p.z);
    this.stats.marked = this.veg.markedCount;
  }

  private toolDrag(x: number, y: number, start: boolean): void {
    this.onHover(x, y);
    const p = this.pickGround(x, y, false);
    if (!p) return;
    if (this.tool === 'harvest') {
      this.harvestDrag = true;
      this.markAt(p, false);
      return;
    }
    const mode = this.tool as SculptMode;
    if (start) this.sculptor.begin(mode, p.x, p.z);
    else this.sculptor.apply(p.x, p.z);
    if (this.sculptor.starved) this.ui.setHint('<b>Not enough Belief</b> to keep sculpting');
    this.audio?.sfx('sculpt', p.x, p.z);
  }

  private toolDragEnd(): void {
    if (this.harvestDrag) {
      this.harvestDrag = false;
      this.stats.marked = this.veg.markedCount;
      return;
    }
    if (this.sculptor.active) {
      this.sculptor.end();
      this.stats.sculpted = this.sculptor.total;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '9') {
      const t = TOOLS[parseInt(k, 10) - 1];
      if (t) this.setTool(t.id);
    } else if (k === ' ') {
      e.preventDefault();
      this.togglePause();
    } else if (k === 'escape') {
      if (!this.ui.closeModals()) this.cancel();
    } else if (k === 'r' && this.placing) {
      this.placeRot = (this.placeRot + 1) % 4;
      if (this.hoverPoint) this.updateGhost(this.hoverPoint);
    } else if (k === 'h' || k === '?') this.ui.toggleHelp();
    else if (k === 'm') this.toggleMute();
    else if (k === 'f' && this.selectedIslander >= 0) this.followId = this.followId === this.selectedIslander ? -1 : this.selectedIslander;
  }

  private onBuildingComplete(b: Building): void {
    this.audio?.sfx('complete', b.x, b.z);
    if (b.key !== 'campfire') this.ui?.toast(`The ${b.label} is complete.`);
    this.completeHandler?.(b);
  }

  // ---------------- Hooks for later systems ----------------

  buildBoat(b: Building): void {
    this.boatHandler?.(b);
  }
  boatList(): { x: number; z: number }[] {
    return this.boatListHandler?.() ?? [];
  }
  save(): void {
    this.saveHandler?.();
  }

  /** Set when leaving for a new island so the old one isn't saved on unload. */
  private noSave = false;

  newIsland(): void {
    this.noSave = true;
    try {
      localStorage.removeItem(SAVE.key);
    } catch {
      /* storage unavailable */
    }
    location.href = location.pathname;
  }

  // ---------------- Picking ----------------

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  /** Cursor / touch point on the ground (wildlife flees from it). */
  readonly cursorWorld = new THREE.Vector3();
  cursorActive = false;

  /** Screen point to the ground (terrain, or sea surface where lower). Ray-marched against the height field. */
  pickGround(sx: number, sy: number, includeWater = true): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const surf = (x: number, z: number) => {
      const h = this.world.heightAt(x, z);
      return includeWater ? Math.max(h, 0) : h;
    };
    let t = 0, prevT = 0;
    const step = Math.max(0.25, this.rig.cur.dist / 160);
    while (t < 1500) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= surf(x, z)) {
        let a = prevT, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m <= surf(o.x + d.x * m, o.z + d.z * m)) b = m;
          else a = m;
        }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prevT = t;
      t += step * (1 + t / 120);
    }
    return null;
  }

  // ---------------- Loop ----------------

  private frame(): void {
    this.clock.update();
    if (this.canvas.clientWidth < 2 || this.canvas.clientHeight < 2) return;
    const realDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = this.time.advance(realDt);
    this.update(realDt, dt);
    this.render(realDt);
    this.fps.frames++;
    this.fps.acc += realDt;
    if (this.fps.acc > 1) {
      this.fps.value = this.fps.frames / this.fps.acc;
      this.fps.frames = 0;
      this.fps.acc = 0;
      this.autoQuality();
    }
  }

  private slowSeconds = 0;
  private qualityChecks = 0;
  /** Step the preset down (high → medium → low) after a few seconds of low frame rate. */
  private autoQuality(): void {
    if (!this.settings.autoQuality || document.hidden || this.qualityChecks++ < 4) return;
    const target = this.preset === 'high' ? 45 : 28;
    this.slowSeconds = this.fps.value < target ? this.slowSeconds + 1 : 0;
    if (this.slowSeconds >= 4 && this.preset !== 'low') {
      this.slowSeconds = 0;
      this.qualityChecks = 0;
      this.settings.preset = this.preset === 'high' ? 'medium' : 'low';
      this.applySettings();
      this.ui.toast(`Graphics set to ${this.settings.preset} for a smoother frame rate (change it in Settings).`);
    }
  }

  /** Advance the simulation without rendering (debugging and tests). */
  simulate(seconds: number, step = 0.1): void {
    for (let t = 0; t < seconds; t += step) this.update(step, this.time.advance(step));
  }

  get fpsValue(): number {
    return this.fps.value;
  }

  /** Turn back to the default composed view direction (shortest way round). */
  resetRotation(): void {
    const r = this.rig;
    let d = this.defaultYaw - r.goal.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    r.goal.yaw += d;
  }

  private update(realDt: number, dt: number): void {
    this.input.update(realDt);
    if (this.rotateHold) this.rig.rotate(this.rotateHold * CAMERA.rotateSpeed * realDt);
    if (this.followId >= 0) {
      const f = this.colony.byId(this.followId);
      if (f && !f.hidden) {
        this.rig.goal.x = f.x;
        this.rig.goal.z = f.z;
      } else if (!f) this.followId = -1;
    }
    this.rig.update(realDt);
    const t = this.time.elapsed;
    // With the day/night cycle off, the light stays at warm mid-afternoon (the clock still runs for the islanders).
    this.lighting.update(this.settings.dayNight ? this.time.t : RENDER.fixedTimeOfDay, this.rig.target, this.rig.viewRadius);
    const ls = this.lighting.state;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(ls.fog);
    (this.scene.background as THREE.Color).copy(ls.fog);
    fog.near = Math.max(RENDER.fogNear, this.rig.cur.dist * 1.6);
    fog.far = fog.near + RENDER.fogFar;
    this.renderer.toneMappingExposure = ls.exposure;

    const ws = this.water.shared;
    ws.uSunDir.value.copy(ls.sunDir);
    ws.uSunCol.value.copy(ls.sunColor);
    ws.uSunI.value = ls.sunIntensity;
    ws.uDay.value = 0.25 + 0.75 * ls.day;
    ws.uSkyCol.value.copy(this.lighting.hemi.color);
    this.water.update(realDt, t);
    this.terrain.update(t);

    FX.uTime.value = t;
    FX.uSunView.value.copy(ls.sunDir).transformDirection(this.rig.camera.matrixWorldInverse);
    FX.uSunCol.value.copy(ls.sunColor);
    FX.uSunI.value = ls.sunIntensity;
    FX.uNight.value = ls.night;
    FX.uCamPos.value.copy(this.rig.camera.position);
    FX.uFocus.value.copy(this.rig.target);
    FX.uCut.value = 1 - THREE.MathUtils.smoothstep(this.rig.cur.dist, 14, 30);

    const growth = [1.2, 1.0, 0.85, 0.5][this.time.seasonIndex] * (this.raining ? 1.6 : 1);
    this.veg.update(dt, this.rig.camera.position, this.rig.target, RENDER.presets[this.preset].lodDist, growth, t);
    this.colony.update(dt);
    this.buildings.update(dt, t, ls.night, this.time.seasonIndex, this.raining, this.rig.target);
    this.eco.update(dt);
    this.sculptor.update(realDt);
    this.tufts.update(realDt);
    this.clouds.update(realDt, ls.day, this.rig.cur.dist);
    for (const s of this.systems) s(realDt, dt);
    this.rig3d.update(this.colony.list, this.selectedIslander, realDt);

    this.wearTimer -= dt;
    if (this.wearTimer <= 0 && this.colony.wearDirty) {
      this.wearTimer = 2;
      this.colony.wearDirty = false;
      const decay = ISLANDER.wearDecayPerSecond * 2;
      for (let i = 0; i < this.world.wear.length; i++) if (this.world.wear[i] > 0) this.world.wear[i] = Math.max(0, this.world.wear[i] - decay);
      this.terrain.updateWear();
    }
    this.milestoneTimer -= realDt;
    if (this.milestoneTimer <= 0) {
      this.milestoneTimer = 1;
      this.checkMilestones();
    }
    this.ui.update(realDt);
  }

  private checkMilestones(): void {
    const has = (k: BuildingKey) => this.buildings.list.some((b) => b.key === k && b.complete);
    const pop = this.colony.list.length;
    const checks: Record<string, boolean> = {
      firstHut: has('hut') || has('home'),
      firstTemple: has('temple'),
      firstFarm: has('farm'),
      pop10: pop >= 10,
      pop20: pop >= 20,
      firstBoat: this.stats.boats > 0,
      firstWarrior: this.colony.list.some((i) => !!i.warrior),
      greatPyramid: this.buildings.list.some((b) => b.key === 'temple' && b.tier >= 3 && b.complete && !b.upgrading),
    };
    for (const m of MILESTONES) {
      if (!this.milestones.has(m.id) && checks[m.id]) {
        this.milestones.add(m.id);
        this.ui.milestone(m.id);
        this.audio?.sfx('milestone');
      }
    }
  }

  private render(realDt: number): void {
    const focus = this.rig.camera.position.distanceTo(this.rig.target);
    this.post.render(realDt, focus, this.lighting.state.night);
  }
}
