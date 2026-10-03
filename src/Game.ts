import { Volcano, VOLCANO_COST, VOLCANO_HAPPINESS } from './entities/Volcano';
import { Explore } from './render/Explore';
import * as THREE from 'three';
import type { Where } from './ui/where';
import { PATHS, BUILDINGS, BuildingKey, CAMERA, ISLANDER, MILESTONES, POWERS, PresetName, RENDER, SAVE, isFarm, SETTLERS } from './config';
import { World } from './world/World';
import { generateIsland } from './world/generator';
import { GameTime } from './world/Time';
import { RNG } from './world/rng';
import { Terrain } from './terrain/Terrain';
import { Sculptor, SculptMode } from './terrain/Sculpt';
import { Water } from './water/Water';
import { Lighting } from './render/Lighting';
import { SkyBodies } from './render/SkyBodies';
import { PostFX } from './render/PostFX';
import { CameraRig } from './render/CameraRig';
import { FX, setCanopyFade } from './render/materials';
import { Input } from './ui/Input';
import { UI } from './ui/UI';
import { GARDEN_TOOLS, PAINT_TOOLS, TOOLBAR, TOOLS, ToolId } from './ui/tools';
import { PlantState, Vegetation } from './vegetation/Vegetation';
import { GrassTufts } from './vegetation/GrassTufts';
import { Wildflowers } from './vegetation/Wildflowers';
import { GARDEN, Garden, GardenBrush } from './vegetation/Garden';
import { PeakClouds } from './render/PeakClouds';
import { DriftClouds } from './render/DriftClouds';
import { CoastRocks } from './render/CoastRocks';
import { SeaStacks } from './water/SeaStacks';
import { Breeze } from './render/Breeze';
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
import { finishSwamps, generateSwamps } from './world/swamp';
import { growIslets } from './world/islets';
import { softenMapEdge } from './world/mapEdge';
import { shapeWaterfall } from './world/waterfallSite';
import { Bridges } from './buildings/Bridges';
import { TradeFleet } from './entities/Trade';
import { GOD_NAME, randomIslandName } from './world/names';
import { FAUNA, GREAT_HALL, SPECIES, TIME } from './config';
import { MONKEY_BASE } from './entities/Monkeys';
import { DOG_BASE, Dogs } from './entities/Dogs';
import { JAG_BASE, Jaguar, Jaguars } from './entities/Jaguars';
import { View } from './render/View';
import { WaterBirds } from './entities/WaterBirds';
import { Butterflies } from './entities/Butterflies';
import { SeaTurtles } from './entities/SeaTurtles';
import { Jellyfish } from './entities/Jellyfish';
import { Alligators } from './entities/Alligators';
import { Defence } from './entities/Defence';
import { Voyages } from './entities/Voyage';
import { BeachPearls } from './entities/Pearls';
import { SwampView } from './water/Swamp';
import { SEA_SURFACE } from './water/Water';
import type { Islander } from './entities/Islander';
import { viewportSize } from './render/AppViewport';

const _pathP = new THREE.Vector3();

/** Give the renderer and overlays the same edge-to-edge app dimensions. */
export function appViewport(): [number, number] {
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const [w, h] = viewportSize(window.innerWidth, window.innerHeight, window.visualViewport?.width, window.visualViewport?.height);
  document.documentElement.classList.toggle('standalone-app', standalone);
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  return [w, h];
}

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
  /** God mode only: buildings and upgrades finish the moment they are placed. */
  instantBuild: boolean;
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
  bridges: Bridges;
  trade!: TradeFleet;
  /** The voyage ship (built at a Trade Dock) and pearl oysters on the beaches. */
  voyage!: Voyages;
  pearls!: BeachPearls;
  veg: Vegetation;
  tufts: GrassTufts;
  /** Wildflowers, little ferns and small plants scattered in clumps. */
  flowers: Wildflowers;
  /** The player's planted flowers, bushes and shrubs. */
  garden: Garden;
  clouds: PeakClouds;
  /** High clouds passing below the camera when zoomed out. */
  driftClouds: DriftClouds;
  /** Rock clusters along the rocky coasts, with waves breaking on them. */
  coastRocks: CoastRocks;
  seaStacks: SeaStacks;
  breeze: Breeze;
  buildings: BuildingSystem;
  pathfinder: Pathfinder;
  colony: Colony;
  rig3d: IslanderRig;
  sculptor: Sculptor;
  lighting: Lighting;
  skyBodies: SkyBodies;
  post: PostFX;
  input: Input;
  ui: UI;
  audio: AudioEngine;
  wildlife: Wildlife;
  dogs!: Dogs;
  waterBirds!: WaterBirds;
  butterflies!: Butterflies;
  turtles!: SeaTurtles;
  jellies!: Jellyfish;
  gators!: Alligators;
  swampView!: SwampView;
  jaguars!: Jaguars;
  defence!: Defence;
  private lastDanger = -999;
  /** The Great Hall bell has called the village to sanctuary; seconds the coast has been clear. */
  private hallAlert = false;
  private hallClear = 0;
  /** Game seconds to the next call back to shelter while a storm rages. */
  private stormRecall = 0;
  boats: Boats;
  marine: Marine;
  powers: Powers;
  volcano!: Volcano;
  rng: RNG;
  settings: Settings;

  tool: ToolId = 'select';
  placing: BuildingKey | null = null;
  private placeRot = 0;
  explorer?: Explore;
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
    // Swamps come from the seed and the untouched island too; their pools are dug afterwards,
    // so the trees standing there end up half-drowned in dark water.
    generateSwamps(this.world, opts.seed);
    // Then the outer islets grow into their current shape, with plants of their own.
    this.veg.growIslets(growIslets(this.world));
    this.veg.build();
    const save = readSave(opts.seed);
    if (save) applyWorld(this.world, save);
    // The waterfall's cliff, basin and rim (after the save, so old saves get them too).
    shapeWaterfall(this.world);
    finishSwamps(this.world);
    // The sea deepens toward the map's edge along a rounded line, so no reef runs into it (old saves too).
    softenMapEdge(this.world, this.veg.plants.filter((p) => p.kind === 'searock' && p.state === PlantState.Alive).map((p) => p.cell));
    this.veg.refreshHeights(0, 0, this.world.N - 1, this.world.N - 1);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight, this.world);
    this.rig.boundRadius = this.world.half * 0.95;
    this.scene.fog = new THREE.Fog(RENDER.fogColor, RENDER.fogNear, RENDER.fogFar);
    this.scene.background = new THREE.Color(RENDER.fogColor);

    this.terrain = new Terrain(this.world, cfg.terrainSubdiv);
    this.scene.add(this.terrain.mesh);
    this.scene.add(this.veg.group);
    this.tufts = new GrassTufts(this.world, cfg.vegDensity);
    this.scene.add(this.tufts.group);
    this.flowers = new Wildflowers(this.world, cfg.vegDensity);
    this.scene.add(this.flowers.group);
    this.garden = new Garden(this.world);
    this.garden.sfx = (n, x, z) => this.audio?.sfx(n, x, z);
    this.garden.veg = this.veg;
    this.garden.pay = (belief) => this.eco.spend({ wood: 0, stone: 0, belief });
    this.scene.add(this.garden.group);
    this.clouds = new PeakClouds(this.world);
    this.scene.add(this.clouds.group);
    this.driftClouds = new DriftClouds(opts.seed);
    this.scene.add(this.driftClouds.group);
    this.breeze = new Breeze(this.world, opts.seed);
    this.scene.add(this.breeze.group);
    // Rocky coasts first: they stamp foam into the sea the water is built from.
    this.coastRocks = new CoastRocks(this.world, opts.seed, this.veg.plants.filter((p) => p.kind === 'searock' && p.state === PlantState.Alive).map((p) => ({ x: p.x, z: p.z })));
    this.scene.add(this.coastRocks.group);
    this.water = new Water(this.world);
    this.bridges = new Bridges(this.world);
    this.scene.add(this.bridges.mesh);
    this.scene.add(this.water.group);

    this.buildings = new BuildingSystem(this.world, this.veg, this.eco, this.terrain, this.scene);
    this.scene.add(this.buildings.group);
    this.pathfinder = new Pathfinder(this.world);
    this.colony = new Colony(this.world, this.veg, this.eco, this.buildings, this.pathfinder, this.time, () => this.rng.next());
    this.colony.hooks.notify = (t, at, kind) => this.ui?.toast(t, kind ?? 'info', at);
    this.colony.hooks.sfx = (n, x, z) => this.audio?.sfx(n, x, z);
    this.colony.hooks.viewer = () => {
      const c = this.rig.camera.position, t = this.rig.target;
      return { x: c.x, y: c.y, z: c.z, tx: t.x, tz: t.z, r: this.rig.viewRadius };
    };
    this.rig3d = new IslanderRig();
    this.scene.add(this.rig3d.group);
    this.sculptor = new Sculptor(this.world, this.terrain, this.water, this.veg, this.eco);
    this.buildings.onComplete = (b) => this.onBuildingComplete(b);
    this.buildings.instantBuild = () => this.eco.godMode && this.settings.instantBuild;

    this.lighting = new Lighting(this.scene, cfg.shadowSize);
    this.skyBodies = new SkyBodies();
    this.scene.add(this.skyBodies.group);
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
    this.trade = new TradeFleet(this.world, this.water, this.buildings, this.eco, this.boats);
    this.scene.add(this.trade.group);
    this.voyage = new Voyages(this.world, this.buildings, this.eco, this.boats, this.colony);
    this.scene.add(this.voyage.group);
    this.pearls = new BeachPearls(this.world);
    this.scene.add(this.pearls.group);
    this.dogs = new Dogs(this.world, this.buildings, this.eco);
    this.jaguars = new Jaguars(this.world);
    this.dogs.jaguars = this.jaguars;
    this.jaguars.dogs = this.dogs;
    this.scene.add(this.dogs.meshes.group, this.jaguars.meshes.group);
    this.boats.blockCells(this.wildlife.coral.cells());
    // A few great sea stacks off the exposed coasts (clear of the reefs); boats steer round them.
    const reefs = [...this.wildlife.coral.patches.map((p) => ({ x: p.x, z: p.z, r: p.r + 1 })), ...this.veg.plants.filter((p) => p.kind === 'reef' || p.kind === 'searock').map((p) => ({ x: p.x, z: p.z, r: 1.2 }))];
    this.seaStacks = new SeaStacks(this.world, opts.seed, reefs);
    this.seaStacks.refreshWater(this.water);
    this.scene.add(this.seaStacks.group);
    this.boats.blockCells(this.seaStacks.cells());
    this.marine = new Marine(this.world, this.water);
    this.scene.add(this.marine.group);
    this.waterBirds = new WaterBirds(this.world, this.veg.plants.filter((p) => p.kind === 'searock').map((p) => ({ x: p.x, z: p.z })));
    this.scene.add(this.waterBirds.meshes.group);
    this.butterflies = new Butterflies(this.world, this.veg.plants.filter((p) => p.kind === 'flowerbush' || p.kind === 'bush'), Math.round(110 * cfg.vegDensity), this.flowers.blooms());
    this.scene.add(this.butterflies.mesh);
    this.turtles = new SeaTurtles(this.world, SEA_SURFACE);
    this.scene.add(this.turtles.meshes.group);
    this.jellies = new Jellyfish(this.world, this.water);
    this.scene.add(this.jellies.mesh);
    this.swampView = new SwampView(this.world, this.water.shared);
    this.scene.add(this.swampView.group);
    this.gators = new Alligators(this.world);
    this.scene.add(this.gators.meshes.group);
    this.defence = new Defence(this.world, this.buildings);
    this.scene.add(this.defence.mesh);
    this.powers = new Powers(this.eco, this.buildings, this.lighting, this.water, this.time, () => this.rng.next());
    this.scene.add(this.powers.group);
    this.audio = new AudioEngine();
    if (this.world.waterfall) this.audio.waterfall = { x: this.world.waterfall.x, y: this.world.waterfall.bottomY, z: this.world.waterfall.z };
    this.connectSystems();

    if (save) this.loadFrom(save);
    this.volcano = new Volcano(this.world, save?.volcano);
    this.scene.add(this.volcano.group);
    this.sculptor.protectedAt = (x, z) => this.volcano.group.visible &&
      Math.hypot(x - this.volcano.x, z - this.volcano.z) < this.volcano.radius + 0.8;
    if (this.volcano.group.visible) {
      const [cx, cz] = this.world.cellOf(this.volcano.x, this.volcano.z);
      // Clear only the steep core; preserve the forest against the planted foothills.
      for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dz * dz < 26) this.veg.clearArea(cx + dx, cz + dz, 1, 1);
      }
    }

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
      wantsToolDrag: () => this.tool === 'raise' || this.tool === 'lower' || this.tool === 'flatten' || this.tool === 'harvest' || PAINT_TOOLS.includes(this.tool),
      onToolDragStart: (x, y) => this.toolDrag(x, y, true),
      onToolDrag: (x, y) => this.toolDrag(x, y, false),
      onToolDragEnd: () => this.toolDragEnd(),
      onHover: (x, y) => this.onHover(x, y),
      onKey: (e) => this.onKey(e),
      onInteract: () => this.interactHandler?.(),
      pick: (x, y) => this.pickGround(x, y),
    });

    this.ui = new UI(this);
    this.volcano.notify = message => this.ui.toast(message, 'warn', () => ({ x: this.volcano.x, z: this.volcano.z }));
    // A new game (or a save from before anyone landed) starts with the arrival canoe.
    if (this.colony.list.length === 0) this.beginSettlement();
    else if (!this.buildings.hasCampfire) this.awaitingFire = true;
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
    const MK = this.wildlife.monkeys;
    this.colony.hooks.animalInfo = (id) => {
      if (id >= MONKEY_BASE) return MK.get(id) ? { name: 'Spider monkey', food: true, needsPen: false, mode: 'hunt', meat: FAUNA.monkeyMeat } : null;
      const a = A.get(id);
      if (!a || !a.alive) return null;
      const d = SPECIES[a.sp];
      return { name: d.name, food: true, needsPen: d.needsPen, mode: d.capture, meat: d.meat };
    };
    this.colony.hooks.animalPos = (id) => {
      if (id >= MONKEY_BASE) {
        const m = MK.get(id);
        return m ? { x: m.x, z: m.z, free: true } : null;
      }
      const a = A.get(id);
      return a && a.alive ? { x: a.x, z: a.z, free: a.pen < 0 && !a.heldBy } : null;
    };
    this.colony.hooks.canCapture = (id) => {
      if (id >= MONKEY_BASE) return MK.canHunt(id);
      const a = A.get(id);
      return !!a && A.capturable(a);
    };
    this.colony.hooks.beginChase = (id, isl) => (id >= MONKEY_BASE ? MK.beginChase(id, isl) : A.beginChase(id, isl));
    this.colony.hooks.catchable = (id, isl) => (id >= MONKEY_BASE ? MK.catchable(id, isl) : A.catchable(id, isl));
    this.colony.hooks.grab = (id, isl) => {
      if (id < MONKEY_BASE) return A.grab(id, isl);
      MK.kill(id);
      return 'hunt';
    };
    this.colony.hooks.releaseAnimal = (id) => (id >= MONKEY_BASE ? MK.release(id) : A.release(id));
    this.colony.hooks.putInPen = (id, b) => A.putInPen(id, b);
    this.colony.hooks.consumeAnimal = (id) => (id >= MONKEY_BASE ? MK.kill(id) : A.consume(id));
    // Monkeys raid the food stores in daylight.
    MK.hooks = {
      targets: () => this.buildings.list.filter((b) => b.complete && (b.key === 'grainstore' || b.key === 'smokehouse' || b.key === 'campfire')).map((b) => ({ id: b.id, x: b.door.x, z: b.door.z })),
      steal: (n) => {
        if (this.eco.godMode) return null;
        // They go for fruit and grain first, then whatever else is lying about.
        const order = (['fruit', 'grain', 'fish', 'meat'] as const).filter((k) => this.eco.res[k] >= 1);
        const k = order.find((r) => this.eco.res[r] >= n) ?? order[0];
        if (!k) return null;
        const got = Math.min(n, Math.floor(this.eco.res[k]));
        this.eco.res[k] -= got;
        return { res: k, n: got };
      },
      day: () => !this.time.isNight,
      notify: (msg, at) => this.ui?.toast(msg, 'warn', at),
      guards: () => this.colony.list.filter((i) => i.warrior && !i.hidden).map((i) => ({ x: i.x, z: i.z })),
    };
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
    this.powers.onThunder = (near) => this.audio.sfx(near ? 'thunderclap' : 'thunder');
    this.powers.camera = this.rig.camera;
    this.powers.isOpenSea = (x, z) => this.isOpenSea(x, z);
    this.powers.onStormStart = () => this.stormShelter(true);
    this.powers.onStormEnd = (calmed) => this.stormPassed(calmed);
    this.buildings.onRemove = (b) => {
      this.wildlife.releasePen(b.id);
      if (b.key === 'tradedock') {
        this.trade.removeDock(b);
        this.voyage.removeDock(b);
      }
      if (b.key === 'kennel') this.dogs.onKennelRemoved(b);
    };
    this.trade.notify = (t, at) => this.ui?.toast(t, 'info', at);
    this.voyage.hooks = {
      notify: (m, kind, at) => this.ui?.toast(m, kind ?? 'info', at),
      sfx: (n, x, z) => this.audio?.sfx(n, x, z),
      addChicken: (x, z) => this.wildlife.animals.addChicken(x, z),
      visitorOrbs: () => this.trade.visitors.filter((v) => v.state === 'moored' && v.deals.some((d) => !d.taken)).map((v) => ({ x: v.x, z: v.z, dock: v.dock })),
    };
    // Pearls: found on the beaches, or in an oyster in a fishing catch.
    this.pearls.onFound = (who, x, z) => {
      this.eco.goods.pearls += 1;
      this.audio?.sfx('mark', x, z);
      this.ui?.toast(who ? `${who.name} found a pearl in an oyster on the beach!` : 'You found a pearl in an oyster on the beach!', 'info', { x, z });
    };
    this.boats.onPearl = (fisher, x, z) => {
      this.eco.goods.pearls += 1;
      this.ui?.toast(`${fisher ? fisher.name : 'A fisher'} found a pearl in an oyster in the catch!`, 'info', { x, z });
    };
    // Dogs and jaguars.
    const alarm = (x: number, z: number, r: number) => void this.colony.alarm(x, z, r);
    const danger = (j: Jaguar, by: 'dogs' | 'villagers') => {
      // With a Great Hall, its bell rings and the whole village makes for sanctuary.
      const halls = this.buildings.list.filter((b) => b.key === 'greathall' && b.complete);
      if (halls.length) {
        this.colony.sanctuary(j.x, j.z);
        this.hallClear = 0;
        if (!this.hallAlert) {
          this.hallAlert = true;
          this.lastDanger = this.time.elapsed;
          for (const h of halls) this.buildings.ringBell(h);
          this.audio?.sfx('bell');
          this.ui?.toast('The Great Hall bell is ringing: a jaguar! Everyone is running to the hall or home for sanctuary.', 'warn', () => ({ x: j.x, z: j.z }));
          return;
        }
      }
      if (this.time.elapsed - this.lastDanger < 50) return;
      this.lastDanger = this.time.elapsed;
      this.ui?.toast(by === 'dogs' ? 'The dogs are barking: a jaguar is prowling near the village!' : 'A jaguar! Villagers are running for shelter.', 'warn', () => ({ x: j.x, z: j.z }));
      void j;
    };
    const sfx = (n: string, x: number, z: number) => this.audio?.sfx(n, x, z);
    this.dogs.hooks = {
      villagers: () => this.colony.list,
      byId: (id) => this.colony.byId(id),
      animals: () => this.wildlife.animals.list.filter((a) => a.alive && a.pen < 0 && !a.heldBy).map((a) => ({ x: a.x, z: a.z })),
      alarm, danger, sfx,
      notify: (m, k, at) => this.ui?.toast(m, k ?? 'info', at),
      godMode: () => this.eco.godMode,
      path: (x, z, tx, tz) => this.pathfinder.find(x, z, tx, tz, { goalRadius: 1 }),
      birdNear: (x, z, r) => this.waterBirds.groundedNear(x, z, r),
    };
    // A jaguar alert, a jaguar still prowling, or a storm raging: those in shelter stay in.
    this.colony.hooks.threat = () => this.hallAlert || this.powers.state === 'storm' || this.jaguarThreat();
    this.jaguars.hooks = {
      villagers: () => this.colony.list,
      byId: (id) => this.colony.byId(id),
      alarm, danger, sfx,
      maul: (isl, killed) => this.colony.maul(isl, killed),
      godMode: () => this.eco.godMode,
      arrived: (j) => this.ui?.toast('A jaguar has swum over from the mainland and come ashore to take the empty den.', 'warn', () => ({ x: j.x, z: j.z })),
    };
    const W = this.wildlife;
    this.waterBirds.hooks = {
      people: this.colony.grid,
      dogs: () => this.dogs.list.filter((d) => d.state !== 'dead').map((d) => ({ x: d.x, z: d.z, speed: d.speed })),
      schools: () => W.schools,
      fishNear: (x, z, r) => W.fishNear(x, z, r),
      takeFish: (i) => W.takeFish(i),
      scatterDeep: (x, z, r) => W.scatter(x, z, r),
      reefNear: (x, z, r) => W.reef.nearest(x, z, r),
      reefSchools: () => W.reef.schoolSpots(),
      reefFish: () => W.reef.fish,
      takeReef: (f) => W.reef.take(f),
      scatterReef: (x, z, r) => W.reef.scatter(x, z, r),
      canoes: () => this.boats.fishing(),
      buildings: () => this.buildings.list.map((b) => ({ x: b.x, z: b.z, key: b.key })),
      splash: (x, z, n, sp, r) => this.marine.splash(x, z, n, sp, r),
      sfx,
      seaLevel: SEA_SURFACE,
    };
    this.gators.hooks = {
      people: this.colony.grid,
      dogs: () => this.dogs.list.map((d) => ({ id: d.id, x: d.x, z: d.z, puppy: d.puppy, dead: d.state === 'dead' })),
      bite: (isl, killed) => this.colony.maul(isl, killed, 'an alligator'),
      biteDog: (id, x, z) => {
        const d = this.dogs.byId(id);
        if (d) this.dogs.lungedAt(d, { x, z }, false, 'an alligator');
      },
      splash: (x, z, n, sp, r, y) => this.marine.splash(x, z, n, sp, r, y),
      sfx,
      godMode: () => this.eco.godMode,
    };
    // Watchtowers shoot at jaguars and alligators that come within range.
    type GatorRef = Parameters<Alligators['hitByArrow']>[0];
    this.defence.hooks = {
      quarry: () => [
        ...this.jaguars.targets.map((j) => ({ kind: 'jaguar' as const, ref: j, aimY: j.y + 0.3 * j.scale })),
        ...this.gators.targets.map((g) => ({ kind: 'alligator' as const, ref: g, aimY: g.y + 0.03 })),
      ],
      hit: (kind, ref) => (kind === 'jaguar' ? this.jaguars.hitByArrow(ref as Jaguar) : this.gators.hitByArrow(ref as GatorRef)),
      sfx,
      killed: (kind, at) =>
        this.ui?.toast(
          kind === 'jaguar' ? 'The watchtower has brought down a jaguar! Another will swim over from the mainland in time.' : 'The watchtower has killed an alligator. Another will come down the rivers to the swamp in time.',
          'info',
          () => at,
        ),
    };
    this.colony.onRemoved = (isl) => {
      this.dogs.onVillagerGone(isl.id);
      if (this.selectedIslander === isl.id) this.select(null);
      if (this.followId === isl.id) this.followId = -1;
    };
    this.buildings.onMoved = (b) => {
      this.wildlife.animals.movePen(b);
      this.tufts.refresh();
      this.flowers.refresh();
    };
    this.completeHandler = (b) => {
      if (b.key === 'farm' || b.key === 'butcher' || b.key === 'pigpen' || b.key === 'chickenpen') this.wildlife.registerPen(b);
      if (b.key === 'kennel') this.dogs.onKennelBuilt(b);
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
      else if (tool === 'calm') {
        const v = this.volcano;
        if (v?.group.visible && v.state.active &&
          (Math.hypot(p.x - v.x, p.z - v.z) < 15 || this.powers.state !== 'storm')) {
          if (v.state.calm(cost => this.eco.spend({ wood: 0, stone: 0, belief: cost }))) {
            for (const isl of this.colony.list) isl.happy = Math.min(1, isl.happy + VOLCANO_HAPPINESS);
            this.ui.toast('The volcano is calmed. Your islanders feel safer and happier.');
            this.saveHandler?.();
          } else this.ui.toast(`You need ${VOLCANO_COST} Belief to calm the volcano.`, 'warn');
        } else this.powers.calm();
      }
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
      this.trade.update(dt, this.time.elapsed);
      this.voyage.update(dt, this.time.elapsed);
      this.pearls.update(dt, this.time.elapsed, this.colony.grid);
      this.marine.update(dt, this.rig.target);
      this.powers.update(dt, realDt, this.rig.target);
      // Add the gentle gust after weather sets its base wind, without accumulating it.
      FX.uWind.value += this.breeze.strength;
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

  /** The player's name for their island (saved with the game). */
  islandName = randomIslandName();

  /** Rename the island. (The secret test name unlocks unlimited resources.) */
  setIslandName(name: string): { god: boolean; changed: boolean } {
    const n = name.trim().slice(0, 32) || this.islandName;
    const god = n.toUpperCase() === GOD_NAME;
    const was = this.eco.godMode;
    this.islandName = n;
    this.eco.godMode = god;
    if (was && !god) {
      // Back to normal: stores return to their real size and anything over it is lost.
      this.buildings.recomputeCaps();
      const e = this.eco;
      e.res.wood = Math.min(e.res.wood, e.woodCap);
      e.res.stone = Math.min(e.res.stone, e.woodCap);
      e.res.belief = Math.min(e.res.belief, e.beliefCap);
      const food = e.food;
      if (food > e.foodCap) for (const k of ['grain', 'fruit', 'meat', 'fish'] as const) e.res[k] = Math.floor((e.res[k] / food) * e.foodCap);
    }
    try {
      document.title = god ? 'Aztlan Isle' : `${n} · Aztlan Isle`;
    } catch {
      /* no document */
    }
    return { god, changed: god !== was };
  }

  /** Waiting for the player to choose the village site (no campfire yet). */
  awaitingFire = false;
  private settlerTimer = 200;
  /** The camera rides along with the first canoe until it lands (or the player takes over). */
  private introFollow = false;

  /**
   * A new game: the first two villagers paddle in from the open sea and land on the main
   * island's beach; then the player chooses where to light the campfire and found the village.
   */
  beginSettlement(): void {
    const m = this.world.meadow;
    this.awaitingFire = true;
    const land = this.boats.sendSettlers(['m', 'f'], m, (people) => {
      this.ui.toast('Your first villagers have landed. Choose a spot for the campfire to found your village.');
      // They walk a little way up the beach and wait.
      for (const p of people) this.colony.walkTo(p, p.x + (m.x - p.x) * 0.15, p.z + (m.z - p.z) * 0.15);
      this.promptCampfire();
    });
    if (land) {
      const start = this.boats.arrivalPos ?? land;
      this.rig.jumpTo(start.x, start.z, 30, this.rig.goal.yaw);
      this.introFollow = true;
    }
    this.ui.setHint('A canoe carrying your first two villagers approaches the island…');
  }

  /** Placement mode for the founding campfire. */
  promptCampfire(): void {
    if (this.buildings.hasCampfire) return;
    this.awaitingFire = true;
    this.startPlacing('campfire');
    this.ui.setHint('Choose where to light the <b>campfire</b>: this is where your village begins. Pick open, flat land with room to grow.');
  }

  /** Canoes of new settlers come when there are free beds and spare food. */
  private updateSettlers(dt: number): void {
    if (!this.buildings.hasCampfire) return;
    this.settlerTimer -= dt;
    if (this.settlerTimer > 0) return;
    this.settlerTimer = SETTLERS.interval[0] + this.rng.next() * (SETTLERS.interval[1] - SETTLERS.interval[0]);
    // Up to 100 adults (children don't count), however many houses there are.
    const adults = this.colony.list.filter((i) => !i.child).length + this.boats.arriving;
    if (adults >= ISLANDER.maxAdults || this.colony.list.length + this.boats.arriving >= ISLANDER.max) return;
    if (this.buildings.freeBeds - this.boats.arriving < SETTLERS.minFreeBeds || this.eco.food < SETTLERS.minFood) return;
    const fire = this.buildings.of('campfire')[0];
    const genders: ('m' | 'f')[] = this.rng.next() < 0.6 ? ['m', 'f'] : this.rng.next() < 0.5 ? ['m', 'm'] : ['f', 'f'];
    const land = this.boats.sendSettlers(genders, fire, (people) => {
      for (const p of people) this.colony.walkTo(p, fire.x + (this.rng.next() - 0.5) * 4, fire.z + (this.rng.next() - 0.5) * 4);
      this.ui.toast(`${people.map((p) => p.name).join(' and ')} have arrived by canoe to join the village.`, 'info', () => (people[0] ? { x: people[0].x, z: people[0].z } : null));
    });
    if (land) this.ui.toast('A canoe of new settlers has been spotted out at sea.', 'info', () => this.boats.arrivalPos ?? land);
  }

  private loadSettings(preset: PresetName): Settings {
    const def: Settings = { preset, dof: true, dofStrength: RENDER.dof.strength, volume: 0.7, music: 0.5, muted: false, fps: false, autoQuality: true, shadows: true, dayNight: true, weather: true, pixel: false, instantBuild: false };
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
    const ultra = this.preset === 'ultra';
    this.veg.ultra = ultra;
    this.tufts.setUltra(ultra);
    this.terrain.uniforms.uUltra.value = Number(ultra);
    this.water.shared.uUltra.value = Number(ultra);
    this.lighting.ultra = ultra;
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
    if (!s.weather && was.weather) this.powers.clearWeather();
    this.applied = { ...s };
    this.post.dofEnabled = s.dof && !this.explorer?.active;
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
    const [w, h] = appViewport();
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

  toggleExplore(): void {
    this.explorer ??= new Explore(this.rig, this.world, () => this.toggleExplore());
    if (this.explorer.active) {
      this.explorer.exit(); this.input.clear(); this.input.enabled = true;
      this.post.dofEnabled = this.settings.dof;
      return;
    }
    const person = this.colony.byId(this.selectedIslander) ?? this.colony.list.find(i => !i.child && !i.hidden);
    this.explorer.enter(person?.x ?? this.rig.cur.x, person?.z ?? this.rig.cur.z);
    this.setTool('select'); this.select(null); this.followId = -1; this.introFollow = false; this.rotateHold = 0;
    this.input.clear(); this.input.enabled = false; this.cursorActive = false;
    this.post.dofEnabled = false;
  }

  // ---------------- Tools & selection ----------------

  setTool(id: ToolId): void {
    this.audio?.sfx('click');
    if (this.tool === id && id !== 'select' && !this.placing) id = 'select';
    this.tool = id;
    this.placing = null;
    this.moving = null;
    this.buildings.showGhost(null);
    this.brush.visible = false;
    const hints: Partial<Record<ToolId, string>> = {
      raise: 'Hold and drag to <b>raise</b> the land one layer',
      lower: 'Hold and drag to <b>lower</b> the land one layer',
      flatten: 'Hold and drag to <b>level</b> land to the layer you start on',
      harvest: 'Tap or drag over trees, rocks and fruit to mark them · tap a pig, goat, chicken or tapir to hunt it',
      bless: 'Tap near your farms to bless their crops',
      rain: 'Tap anywhere to summon rain',
      calm: 'Tap the active volcano or a storm to calm it · 50 Belief',
      path: `Hold and drag to lay a <b>stone path</b> · ${PATHS.stonePerCell} stone per cell · Esc to finish`,
      dirtpath: 'Hold and drag to tread a <b>dirt path</b> · free · Esc to finish',
      unpath: 'Hold and drag over a path or bridge to <b>remove</b> it · Esc to finish',
      regrass: 'Hold and drag over bare earth to <b>restore the grass</b> · free · Esc to finish',
      flowers: 'Hold and drag to <b>plant flowers</b> · each stroke picks its own colours · free · Esc to finish',
      bushes: 'Hold and drag to <b>plant bushes</b>: hibiscus, bougainvillea and more · free · Esc to finish',
      shrubs: 'Hold and drag to <b>plant shrubs</b>: ferns, crotons, agaves and grasses · free · Esc to finish',
      trees: `Hold and drag to <b>plant trees</b>: palms, jungle and meadow trees, orange and banana trees · ${GARDEN.treeCost} Belief each · Esc to finish`,
      unplant: 'Hold and drag over garden plants to <b>dig them up</b> · Esc to finish',
      canal: `Hold and drag outward from water to dig a <b>canal</b> into the village · ${PATHS.canalWood} wood per section · Esc to finish`,
      bridge: `Hold and drag from the shore across shallow water to build a <b>rope bridge</b> · ${PATHS.bridgeWood} wood per section · Esc to finish`,
    };
    this.ui.setHint(hints[id] ?? null);
  }

  /** A building picked up to be moved (placement mode, with its own cells counting as free). */
  moving: Building | null = null;

  startMove(b: Building): void {
    if (!this.buildings.canRelocate(b)) {
      this.ui.toast('Docks are tied to their shore and cannot be moved.', 'warn');
      return;
    }
    this.audio?.sfx('click');
    this.select(null);
    this.tool = 'build';
    this.placing = b.key;
    this.moving = b;
    this.placeRot = b.rot;
    this.ui.setHint(`Tap to move the <b>${b.label}</b> · <b>R</b> rotates · right-click or Esc cancels`);
    if (this.hoverPoint) this.updateGhost(this.hoverPoint);
  }

  private endMove(): void {
    this.moving = null;
    this.placing = null;
    this.buildings.showGhost(null);
    this.tool = 'select';
    this.ui.setHint(null);
  }

  rotateBuilding(b: Building): void {
    const r = this.buildings.rotate(b);
    if (!r.ok) {
      this.ui.toast(r.reason === 'Something is already built here' ? 'No room to turn it here.' : r.reason, 'warn');
      this.audio?.sfx('deny');
      return;
    }
    this.audio?.sfx('place', b.x, b.z);
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
    // The founding fire can't be cancelled; there is nowhere else to go.
    if (this.placing === 'campfire' && this.awaitingFire) return;
    if (this.moving) {
      const b = this.moving;
      this.endMove();
      this.select({ building: b.id });
      return;
    }
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
    if (key === 'jetty' || key === 'tradedock') rot = this.buildings.jettyRot(cx, cz);
    return [cx, cz, rot];
  }

  private updateGhost(p: THREE.Vector3): void {
    if (!this.placing) return;
    const [cx, cz, rot] = this.footprintAt(p, this.placing);
    const res = this.buildings.showGhost(this.placing, cx, cz, rot, this.moving ?? undefined);
    if (!res.ok && res.reason) this.ui.setHint(`<b>${res.reason}</b> · R rotates · Esc cancels`);
    else if (this.moving) this.ui.setHint(`Tap to move the <b>${this.moving.label}</b> here · <b>R</b> rotates · right-click or Esc cancels`);
    else if (this.placing === 'campfire') this.ui.setHint('Tap to light the <b>campfire</b> here: your village will grow around it');
    else this.ui.setHint(`Tap to place a <b>${BUILDINGS[this.placing].name}</b> · keep tapping to place more · <b>R</b> rotates · right-click or Esc to finish`);
  }

  private onHover(x: number, y: number): void {
    const p = this.pickGround(x, y);
    this.hoverPoint = p;
    this.cursorActive = !!p;
    if (!p) return;
    this.cursorWorld.copy(p);
    if (this.placing) this.updateGhost(p);
    const sculpt = this.tool === 'raise' || this.tool === 'lower' || this.tool === 'flatten';
    const area = this.tool === 'harvest' || this.tool === 'bless' || PAINT_TOOLS.includes(this.tool);
    this.brush.visible = sculpt || area;
    if (this.brush.visible) {
      const r = this.tool === 'bless' ? POWERS.bless.radius : this.tool === 'harvest' ? 2 : this.tool === 'regrass' ? PATHS.regrassRadius + 0.3 : GARDEN_TOOLS.includes(this.tool) ? GARDEN.radius[this.tool as GardenBrush] + 0.15 : PAINT_TOOLS.includes(this.tool) ? PATHS.radius + 0.4 : POWERS.sculptRadius;
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
      if (this.placing === 'campfire') {
        // Found the village: the fire is lit at once and everyone gathers round.
        const fire = this.buildings.place('campfire', cx, cz, rot, true);
        this.buildings.completeNow(fire);
        this.awaitingFire = false;
        this.placing = null;
        this.buildings.showGhost(null);
        this.setTool('select');
        for (const isl of this.colony.list) this.colony.walkTo(isl, fire.x + (this.rng.next() - 0.5) * 3, fire.z + (this.rng.next() - 0.5) * 3);
        this.audio?.sfx('complete', fire.x, fire.z);
        this.ui.toast('The campfire is lit and your village is founded! Now build homes, farms and stores around it.');
        this.ui.setHint(null);
        return;
      }
      if (this.moving) {
        // Moving an existing building: drop it at the new spot.
        const mb = this.moving;
        const r = this.buildings.relocate(mb, cx, cz, rot);
        if (!r.ok) {
          this.ui.toast(r.reason, 'warn');
          this.audio?.sfx('deny');
          return;
        }
        this.audio?.sfx('place', mb.x, mb.z);
        this.endMove();
        this.select({ building: mb.id });
        return;
      }
      const b = this.buildings.place(this.placing, cx, cz, rot);
      this.audio?.sfx('place', b.x, b.z);
      // Stay in placement so rows of huts, farms or torches can go down one after another.
      if (this.eco.canAfford(b.def.cost)) {
        if (this.hoverPoint) this.updateGhost(this.hoverPoint);
      } else {
        this.ui.toast(`${b.def.name} site placed. Not enough resources for another.`);
        this.placing = null;
        this.buildings.showGhost(null);
        this.setTool('select');
        this.select({ building: b.id });
      }
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
        const mk = this.wildlife.monkeys.pick(this.rig.camera, x, y, rect, 16);
        if (mk) {
          this.captureAnimal(MONKEY_BASE + mk.id);
          return;
        }
        if (p) this.markAt(p, true);
        return;
      }
      case 'raise':
      case 'lower':
      case 'flatten':
        return;
      case 'path':
      case 'dirtpath':
      case 'unpath':
        if (p) this.paintPath(p, this.tool !== 'unpath', this.tool === 'dirtpath');
        return;
      case 'regrass':
        if (p) this.paintGrass(p);
        return;
      case 'flowers':
      case 'bushes':
      case 'shrubs':
      case 'unplant':
        if (p) this.paintGarden(p, true);
        return;
      case 'bridge':
        if (p) this.paintBridge(p);
        return;
      case 'canal':
        if (p) this.paintCanal(p);
        return;
      default:
        if (p) this.powerHandler?.(this.tool, p);
    }
  }

  private selectAt(x: number, y: number, p: THREE.Vector3 | null): void {
    const rect = this.canvas.getBoundingClientRect();
    // A pearl oyster on the beach: tapping it finds the pearl.
    if (this.pearls.tap(this.rig.camera, x, y, rect)) return;
    // The voyage ship (or a green orb over goods or bargains waiting): its Trade Dock's card.
    const vdock = this.voyage.pick(this.rig.camera, x, y, rect);
    if (vdock) {
      this.select({ building: vdock.id });
      this.audio?.sfx('select', vdock.x, vdock.z);
      return;
    }
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
    const dog = this.dogs.pick(this.rig.camera, x, y, rect, 16);
    if (dog) {
      this.select({ animal: DOG_BASE + dog.id });
      this.audio?.sfx('select', dog.x, dog.z);
      return;
    }
    const jag = this.jaguars.pick(this.rig.camera, x, y, rect, 20);
    if (jag) {
      this.select({ animal: JAG_BASE + jag.id });
      this.audio?.sfx('select', jag.x, jag.z);
      return;
    }
    const monkey = this.wildlife.monkeys.pick(this.rig.camera, x, y, rect, 14);
    if (monkey) {
      if (current && !current.child) {
        this.captureAnimal(MONKEY_BASE + monkey.id, current);
        return;
      }
      this.select({ animal: MONKEY_BASE + monkey.id });
      this.audio?.sfx('select', monkey.x, monkey.z);
      return;
    }
    // Tap a whale to make it come up for air.
    if (p && p.y <= 0.05) {
      const w = this.marine.whaleNear(p.x, p.z, 4);
      if (w) {
        this.marine.rise(w);
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
  roundUpAnimals(pen: Building): void {
    if (!pen.complete || (pen.key !== 'pigpen' && pen.key !== 'chickenpen')) return;
    const species = pen.key === 'pigpen' ? 'pig' : 'chicken';
    const animals = this.wildlife.animals.list.filter(a => a.sp === species && this.wildlife.animals.capturable(a));
    const n = this.colony.roundUp(pen, animals);
    this.ui.toast(n ? `${n} idle islander${n === 1 ? '' : 's'} rounding up ${species === 'pig' ? 'pigs' : 'chickens'} for this pen.` :
      animals.length ? 'No idle adults are available to round up animals.' : `No wild ${species === 'pig' ? 'pigs' : 'chickens'} are available.`, n ? 'info' : 'warn');
  }

  captureAnimal(id: number, who: Islander | null = null): boolean {
    const r = this.colony.orderCapture(who, id);
    this.ui.toast(r.msg, r.ok ? 'info' : 'warn');
    this.audio?.sfx(r.ok ? 'click' : 'deny');
    return r.ok;
  }

  private jettyAt(p: THREE.Vector3 | null): Building | undefined {
    if (!p) return undefined;
    return this.buildings.list.filter((b) => b.key === 'jetty' || b.key === 'tradedock').find((j) => {
      // Anywhere along the deck counts.
      for (let t = 0; t <= 1; t += 0.2) {
        if (Math.hypot(j.x + (j.dockX - j.x) * t - p.x, j.z + (j.dockZ - j.z) * t - p.z) < 1.3) return true;
      }
      return false;
    });
  }

  /** Lay (or lift) stone or dirt paths on the cells under the brush (path = 1 stone, 2 dirt). */
  private paintPath(p: THREE.Vector3, add: boolean, dirt = false): void {
    const w = this.world;
    const ccx = Math.floor(p.x + w.half), ccz = Math.floor(p.z + w.half);
    let changed = 0, short = false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (!w.inBounds(cx, cz)) continue;
        if (Math.hypot(w.centerX(cx) - p.x, w.centerZ(cz) - p.z) > PATHS.radius) continue;
        const i = w.idx(cx, cz);
        if (add) {
          // A stone path can be laid over dirt (upgrading it), not the other way round.
          if (w.path[i] === 1 || (dirt && w.path[i]) || !w.isLandCell(i) || w.occ[i] !== 0) continue;
          const cost = { wood: 0, stone: dirt ? PATHS.dirtCost : PATHS.stonePerCell, belief: 0 };
          if (!this.eco.canAfford(cost)) {
            short = true;
            continue;
          }
          this.eco.spend(cost);
          w.path[i] = dirt ? 2 : 1;
          changed++;
        } else if (w.canal[i]) {
          // Fill the canal back in.
          w.canal[i] = 0;
          w.layer[i] += 1;
          w.riverY[i] = NaN;
          this.markCanal(cx, cz);
          changed++;
        } else if (w.path[i] || w.bridge[i]) {
          if (w.bridge[i]) this.bridgeDirty = true;
          w.path[i] = 0;
          w.bridge[i] = 0;
          changed++;
        }
      }
    }
    if (short) this.ui.setHint('<b>Not enough stone</b> for more path');
    if (changed) {
      this.pathDirty = true;
      this.audio?.sfx(add ? 'place' : 'click', p.x, p.z);
    }
  }
  /** Plant (or dig up) the garden under the brush. */
  private paintGarden(p: THREE.Vector3, start: boolean): void {
    this.garden.paint(p.x, p.z, this.tool as GardenBrush, start);
    if (this.tool === 'trees' && this.garden.short) this.ui.setHint(`<b>Not enough Belief</b> to plant more trees (${GARDEN.treeCost} each)`);
    else if (this.garden.full && this.tool !== 'unplant') this.ui.setHint(`<b>The garden is full</b> (${GARDEN.max} plants): dig some up to plant more`);
  }

  /**
   * Restore grass under the brush: trodden wear, dirt tracks and any stray bare soil grow back to
   * grass (the tufts and flowers return too). Stone paths are left alone.
   */
  private paintGrass(p: THREE.Vector3): void {
    const w = this.world;
    const R = PATHS.regrassRadius;
    const ccx = Math.floor(p.x + w.half), ccz = Math.floor(p.z + w.half);
    const n = Math.ceil(R);
    let changed = 0;
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (!w.inBounds(cx, cz)) continue;
        if (Math.hypot(w.centerX(cx) - p.x, w.centerZ(cz) - p.z) > R) continue;
        const i = w.idx(cx, cz);
        if (!w.isLandCell(i)) continue;
        if (w.wear[i] > 0) {
          w.wear[i] = 0;
          changed++;
        }
        if (w.path[i] === 2) {
          w.path[i] = 0;
          changed++;
        }
        if (w.soil[i] > 0 && w.occ[i] === 0) {
          w.soil[i] = 0;
          changed++;
        }
      }
    }
    if (changed) {
      this.pathDirty = true;
      this.audio?.sfx('harvest', p.x, p.z);
    }
  }
  private pathDirty = false;
  private bridgeDirty = false;
  private canalDirty: [number, number, number, number] | null = null;

  private markCanal(cx: number, cz: number): void {
    const d = this.canalDirty;
    this.canalDirty = d ? [Math.min(d[0], cx), Math.min(d[1], cz), Math.max(d[2], cx), Math.max(d[3], cz)] : [cx, cz, cx, cz];
  }

  /**
   * Dig a canal: each new section must touch existing water (sea, river, pool or canal), so
   * channels grow out from the water into the land. The ground is dug down a terrace and filled.
   */
  private paintCanal(p: THREE.Vector3): void {
    const w = this.world;
    const ccx = Math.floor(p.x + w.half), ccz = Math.floor(p.z + w.half);
    const cost = { wood: PATHS.canalWood, stone: 0, belief: 0 };
    const cells: [number, number, number][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!w.inBounds(cx, cz)) continue;
      const d = Math.hypot(w.centerX(cx) - p.x, w.centerZ(cz) - p.z);
      if (d <= 0.72) cells.push([cx, cz, d]);
    }
    cells.sort((a, b) => a[2] - b[2]);
    let n = 0, short = false;
    const isWater = (i: number) => w.layer[i] <= 0 || !Number.isNaN(w.riverY[i]);
    for (const [cx, cz] of cells) {
      const i = w.idx(cx, cz);
      if (w.layer[i] < 1 || !Number.isNaN(w.riverY[i]) || w.occ[i] || w.bridge[i]) continue;
      let wet = false;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.inBounds(cx + ox, cz + oz) && isWater(w.idx(cx + ox, cz + oz))) wet = true;
      if (!wet) continue;
      if (!this.eco.canAfford(cost)) {
        short = true;
        break;
      }
      this.eco.spend(cost);
      this.eco.add('wood', this.veg.clearArea(cx, cz, 1, 1));
      w.layer[i] -= 1;
      // Dug down to sea level on the shore, it simply floods as part of the sea; inland it holds
      // its own channel water (levelled against its banks when the water surface is rebuilt).
      w.riverY[i] = w.layer[i] <= 0 ? NaN : w.layerY(w.layer[i]) + 0.7 * w.H;
      w.canal[i] = 1;
      w.path[i] = 0;
      w.forest[i] = 0;
      this.markCanal(cx, cz);
      n++;
    }
    if (short) this.ui.setHint('<b>Not enough wood</b> to dig further');
    if (n) this.audio?.sfx('sculpt', p.x, p.z);
  }

  /** Lay rope bridge decks over shallow water under the brush, growing out from the shore. */
  private paintBridge(p: THREE.Vector3): void {
    const w = this.world;
    const ccx = Math.floor(p.x + w.half), ccz = Math.floor(p.z + w.half);
    const cost = { wood: PATHS.bridgeWood, stone: 0, belief: 0 };
    let n = 0, short = false;
    // Nearest cells first so a drag grows the bridge continuously.
    const cells: [number, number][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (!w.inBounds(cx, cz)) continue;
      const d = Math.hypot(w.centerX(cx) - p.x, w.centerZ(cz) - p.z);
      if (d <= 0.75) cells.push([w.idx(cx, cz), d]);
    }
    cells.sort((a, b) => a[1] - b[1]);
    for (const [i] of cells) {
      if (!this.bridges.canBridge(i)) continue;
      if (!this.eco.canAfford(cost)) {
        short = true;
        break;
      }
      this.eco.spend(cost);
      w.bridge[i] = 1;
      n++;
    }
    if (short) this.ui.setHint('<b>Not enough wood</b> for more bridge');
    if (n) {
      this.bridgeDirty = true;
      this.audio?.sfx('build', p.x, p.z);
    }
  }
  private pathLast: { x: number; z: number } | null = null;

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
    if (PAINT_TOOLS.includes(this.tool)) {
      // Fill in between pointer samples so a quick drag still lays a continuous path.
      const last = start ? null : this.pathLast;
      const n = last ? Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.z - last.z) / 0.4)) : 1;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        _pathP.set(last ? last.x + (p.x - last.x) * t : p.x, p.y, last ? last.z + (p.z - last.z) * t : p.z);
        if (this.tool === 'bridge') this.paintBridge(_pathP);
        else if (this.tool === 'canal') this.paintCanal(_pathP);
        else if (this.tool === 'regrass') this.paintGrass(_pathP);
        else if (GARDEN_TOOLS.includes(this.tool)) this.paintGarden(_pathP, start && k === 1);
        else this.paintPath(_pathP, this.tool !== 'unpath', this.tool === 'dirtpath');
      }
      this.pathLast = { x: p.x, z: p.z };
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
      const t = TOOLBAR[parseInt(k, 10) - 1];
      if (t?.id === 'terrain') this.ui.toggleTerrain();
      else if (t?.id === 'flora') this.ui.toggleFlora();
      else if (t) {
        this.ui.closePopups();
        this.setTool(t.id);
      }
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
    else if (k === 'o') this.rig.toggleOverview();
    else if (k === 'v') this.ui.toggleZen();
    else if (k === 'f' && this.selectedIslander >= 0) this.followId = this.followId === this.selectedIslander ? -1 : this.selectedIslander;
  }

  private onBuildingComplete(b: Building): void {
    this.audio?.sfx('complete', b.x, b.z);
    if (b.key !== 'campfire') this.ui?.toast(`The ${b.label} is complete.`, 'info', { x: b.x, z: b.z });
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

  importIsland(save: SaveData): void {
    // Write first: if storage is full, keep playing the current island unchanged.
    try { localStorage.setItem(SAVE.key, JSON.stringify(save)); }
    catch { throw new Error('Not enough browser storage to load this island. Your current island is unchanged.'); }
    // Prevent visibility/unload autosaves from replacing the imported snapshot.
    this.noSave = true;
    location.reload();
  }

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
  /** Take the camera to a notification's place (zooming in a little if far out). */
  focusAt(where: Where): void {
    const p = typeof where === 'function' ? where() : where;
    if (!p) return;
    this.followId = -1;
    this.rig.goal.x = p.x;
    this.rig.goal.z = p.z;
    this.rig.goal.dist = Math.min(this.rig.goal.dist, 26);
  }

  /** The player rings a Great Hall's bell: a sanctuary drill (everyone goes in for a little while). */
  ringHallBell(b: Building): void {
    if (b.key !== 'greathall' || !b.complete) return;
    this.buildings.ringBell(b);
    this.audio?.sfx('bell');
    const n = this.colony.sanctuary(b.x, b.z, true);
    this.ui?.toast(n ? `The bell rings: ${n} villager${n === 1 ? '' : 's'} hurry to sanctuary (a drill).` : 'The bell rings, but nobody is near enough to answer it.');
  }

  /**
   * A storm: the village takes shelter. With a Great Hall its bell calls everyone in (as a drill, so
   * the warriors stay at their posts); anyone else close to home runs indoors. They stay in while
   * the storm lasts (the colony's threat hook). Returns true when the village was told.
   */
  private stormShelter(announce: boolean): boolean {
    this.stormRecall = POWERS.stormRecall;
    const halls = this.buildings.list.filter((b) => b.key === 'greathall' && b.complete);
    if (halls.length) this.colony.sanctuary(halls[0].x, halls[0].z, true);
    // Those the bell can't reach (or with no hall at all) run home when it's near.
    for (const isl of this.colony.list) {
      if (isl.hidden || isl.sleeping || isl.warrior || isl.safe) continue;
      const t = isl.task;
      if (t && (t.kind === 'flee' || t.kind === 'hall' || t.kind === 'sleep' || t.kind === 'capture' || (t.kind === 'fish' && t.stage >= 2))) continue;
      const home = isl.home >= 0 ? this.buildings.byId(isl.home) : undefined;
      if (!home || !home.complete || Math.hypot(home.door.x - isl.x, home.door.z - isl.z) > 28) continue;
      this.colony.alarm(isl.x, isl.z, 0.01);
    }
    if (!announce) return false;
    const hall = halls[0];
    if (hall) {
      // Already in sanctuary from a jaguar: no need to ring again.
      if (!this.hallAlert) {
        for (const h of halls) this.buildings.ringBell(h);
        this.audio?.sfx('bell');
      }
      this.ui?.toast('A storm is coming: the bell calls everyone to shelter. Use Calm (7) to settle it.', 'warn', () => ({ x: hall.x, z: hall.z }));
    } else this.ui?.toast('A storm is coming: the villagers hurry home to shelter. Use Calm (7) to settle it.', 'warn');
    return true;
  }

  /** The storm is over: out of shelter (unless a jaguar still prowls). Calming it cheers everyone. */
  private stormPassed(calmed: boolean): void {
    this.stormRecall = 0;
    if (calmed) {
      // (Powers has already announced that the people rejoice.)
      for (const isl of this.colony.list) isl.happy = Math.min(1, isl.happy + POWERS.calmHappy);
      return;
    }
    this.ui?.toast(this.hallAlert ? 'The storm has passed, but a jaguar keeps the village in sanctuary.' : 'The storm has passed. Villagers are coming out of shelter.');
  }

  /** Open, deep sea well away from any coast (where lightning may strike). */
  private isOpenSea(x: number, z: number): boolean {
    const w = this.world;
    if (Math.abs(x) > 600 || Math.abs(z) > 600) return false;
    if (w.heightAt(x, z) > -1.8) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      if (w.heightAt(x + Math.cos(a) * 6, z + Math.sin(a) * 6) > -0.6) return false;
    }
    return true;
  }

  /** A jaguar is hunting near the village (its fire, or any villager out in the open). */
  private jaguarThreat(): boolean {
    const fire = this.buildings.list.find((b) => b.key === 'campfire');
    const R = GREAT_HALL.threatRadius;
    return this.jaguars.hunting.some(
      (j) => (fire && Math.hypot(j.x - fire.x, j.z - fire.z) < R) || this.colony.list.some((v) => !v.hidden && !v.safe && Math.hypot(v.x - j.x, v.z - j.z) < 18)
    );
  }

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
    const target = this.preset === 'ultra' ? 50 : this.preset === 'high' ? 45 : 28;
    this.slowSeconds = this.fps.value < target ? this.slowSeconds + 1 : 0;
    if (this.slowSeconds >= 4 && this.preset !== 'low') {
      this.slowSeconds = 0;
      this.qualityChecks = 0;
      this.settings.preset = this.preset === 'ultra' ? 'high' : this.preset === 'high' ? 'medium' : 'low';
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
    if (this.explorer?.active) this.explorer.update(realDt);
    else this.rig.update(realDt);
    // What the camera sees this frame: off-screen entities skip posing and drawing.
    View.update(this.rig.camera);
    this.breeze.update(realDt, this.rig.target, this.rig.viewRadius);
    // Volcano warnings use unpaused real play time, even at increased game speed.
    this.volcano.update(dt > 0 ? realDt : 0);
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
    // The sun and moon in the sky (seen when the view looks up: free-roam, or tilted low).
    this.skyBodies.update(this.rig.camera, ls, this.lighting.overcast, this.settings.dayNight ? this.time.t : RENDER.fixedTimeOfDay, t);

    const ws = this.water.shared;
    ws.uSunDir.value.copy(ls.sunDir);
    ws.uSunCol.value.copy(ls.sunColor);
    ws.uSunI.value = ls.sunIntensity;
    ws.uDay.value = 0.25 + 0.75 * ls.day;
    ws.uSkyCol.value.copy(this.lighting.hemi.color);
    this.water.update(realDt, t);
    this.coastRocks.update(realDt, t, this.water);
    this.seaStacks.update(realDt, t, this.water);
    this.terrain.update(t);

    FX.uTime.value = t;
    FX.uSunView.value.copy(ls.sunDir).transformDirection(this.rig.camera.matrixWorldInverse);
    FX.uSunCol.value.copy(ls.sunColor);
    FX.uSunI.value = ls.sunIntensity;
    FX.uNight.value = ls.night;
    FX.uCamPos.value.copy(this.rig.camera.position);
    FX.uFocus.value.copy(this.rig.target);
    FX.uCut.value = 1 - THREE.MathUtils.smoothstep(this.rig.cur.dist, 14, 30);
    setCanopyFade(FX.uCut.value);

    const growth = [1.2, 1.0, 0.85, 0.5][this.time.seasonIndex] * (this.raining ? 1.6 : 1);
    this.veg.update(dt, this.rig.camera.position, this.rig.target, RENDER.presets[this.preset].lodDist, growth, t);
    this.colony.update(dt);
    const fire = this.buildings.list.find((b) => b.key === 'campfire');
    this.jaguars.update(dt, this.time.isNight, fire ? { x: fire.x, z: fire.z } : null);
    // Sanctuary: once no jaguar has prowled near for a few seconds, sound the all clear.
    if (this.hallAlert) {
      this.hallClear = this.jaguarThreat() ? 0 : this.hallClear + dt;
      if (this.hallClear > 4) {
        this.hallAlert = false;
        this.ui?.toast(this.powers.state === 'storm' ? 'The jaguar has gone, but the storm keeps everyone in shelter.' : 'All clear: the jaguar has gone. Villagers are coming out of sanctuary.');
      }
    }
    // While a storm rages, anyone who has wandered back out is called in again.
    if (this.powers.state === 'storm') {
      this.stormRecall -= dt;
      if (this.stormRecall <= 0) this.stormShelter(false);
    }
    this.dogs.update(dt, this.time.isNight);
    this.waterBirds.update(dt, this.time.hour);
    this.butterflies.update(dt, realDt, ls.day, this.raining, this.input.hover.active && !this.input.navigating && this.cursorActive ? this.cursorWorld : null);
    this.jellies.update(dt, this.input.hover.active && !this.input.navigating && this.cursorActive ? this.cursorWorld : null);
    this.turtles.people = this.colony.grid;
    this.turtles.update(dt);
    this.gators.update(dt);
    this.defence.update(dt);
    this.buildings.update(dt, t, ls.night, this.time.seasonIndex, this.raining, this.rig.target);
    this.updateSettlers(dt);
    if (this.introFollow) {
      const a = this.boats.arrivalPos;
      if (!a || this.input.navigating) this.introFollow = false;
      else {
        this.rig.goal.x += (a.x - this.rig.goal.x) * Math.min(1, realDt * 2);
        this.rig.goal.z += (a.z - this.rig.goal.z) * Math.min(1, realDt * 2);
      }
    }
    this.eco.update(dt);
    this.sculptor.update(realDt);
    this.tufts.update(realDt);
    this.flowers.update(realDt);
    this.garden.update(realDt);
    this.clouds.update(realDt, ls.day, this.rig.cur.dist);
    this.driftClouds.update(realDt, ls.day, this.rig.cur.dist, this.rig.camera.position);
    for (const s of this.systems) s(realDt, dt);
    this.rig3d.update(this.colony.list, this.selectedIslander, realDt);

    if (this.canalDirty) {
      const [x0, z0, x1, z1] = this.canalDirty;
      this.canalDirty = null;
      const w = this.world;
      w.countCanals();
      w.computeSmooth(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
      w.classifyGround(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
      this.terrain.rebuild(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
      this.water.updateHeight(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
      this.water.setCanals();
      this.veg.refreshHeights(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
      this.terrain.updateWear();
      this.tufts.refresh();
      this.flowers.refresh();
      w.version++;
    }
    if (this.bridgeDirty) {
      this.bridgeDirty = false;
      this.bridges.rebuild();
    }
    if (this.pathDirty) {
      this.pathDirty = false;
      this.terrain.updateWear();
      this.tufts.refresh();
      this.flowers.refresh();
    }
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
      firstFarm: this.buildings.list.some((b) => b.complete && isFarm(b.key)),
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
