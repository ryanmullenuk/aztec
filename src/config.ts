/**
 * Every tuning value in the game lives here.
 * Distances are in world units (1 unit = 1 terrain cell), times in game seconds
 * (1x speed = real seconds) unless noted.
 */

export type PresetName = 'high' | 'medium' | 'low';

export const WORLD = {
  /** Grid cells along each side of the square map. */
  size: 200,
  /** Height of one sculpted contour layer. */
  layerHeight: 0.55,
  minLayer: -9,
  maxLayer: 18,
  /** Terrain mesh vertices per cell side (2 = smooth rounded terraces). */
  meshSubdiv: 3,
  isletCount: [5, 8] as [number, number],
  riverCount: [1, 3] as [number, number],
  /** Radius (cells) of the open starting meadow. */
  meadowRadius: 24,
  /** Size of the ocean plane that reaches the horizon. */
  oceanSize: 2400,
  /** Everyone plays the same hand-designed island (this seed sets its trees, rocks and wildlife). */
  islandSeed: 20260926,
};

export const COLORS = {
  // Open ocean: deep navy-teal like a real sea seen from above; tropical turquoise only in the shallows.
  deepOcean: 0x08253f,
  deepOcean2: 0x0c3558,
  midWater: 0x15668a,
  shallow: 0x2cc6d2,
  shallowBright: 0x7ee9de,
  reef1: 0x1c6e7a,
  reef2: 0x2a5f6e,
  foam: 0xf5fbff,
  sand: 0xf2ddb0,
  sandGold: 0xe8c98e,
  wetSand: 0xc9a86e,
  // Natural, slightly muted greens (sage-olive meadows, deep jungle canopy) rather than lime.
  grass: 0x7b9b44,
  grassBright: 0x96ae52,
  grassOlive: 0x5b7532,
  jungleDark: 0x264d24,
  jungleBright: 0x4d7a33,
  frondTip: 0x98a94c,
  flowerRed: 0xe4572e,
  flowerOrange: 0xf28c28,
  rock: 0x7d6f73,
  rockLight: 0x9a8c8a,
  rockShadow: 0x8a7f9a,
  moss: 0x64803a,
  dirt: 0xc08a55,
  dirtDark: 0xa8744a,
  soil: 0x7a4f30,
  thatch: 0xd9a95b,
  timber: 0x8b5a34,
  terracotta: 0xb8452f,
  stone: 0xbfb2a0,
  gold: 0xd4a017,
  jade: 0x3fa27a,
  sky: 0x9fd4ff,
  hemiGround: 0xc9a46a,
  sunWarm: 0xffd9a0,
  sunGold: 0xffc680,
};

export const RENDER = {
  /** Pixel style renders at about this many pixels tall, scaled up with hard edges. */
  pixelStyleHeight: 380,
  /** Day fraction the light holds at when the day/night cycle is switched off (warm mid-afternoon). */
  fixedTimeOfDay: 0.5,
  fov: 32,
  exposure: 1.1,
  near: 0.5,
  far: 1800,
  /** Warm distance haze. */
  fogColor: 0xf3d6b0,
  fogNear: 140,
  fogFar: 700,
  presets: {
    high: { pixelRatio: 1.75, shadowSize: 2048, ssao: true, dofSamples: 36, smaa: true, bloom: true, vegDensity: 1.0, lodDist: 80, terrainSubdiv: 3 },
    medium: { pixelRatio: 1.35, shadowSize: 2048, ssao: false, dofSamples: 24, smaa: false, bloom: true, vegDensity: 0.8, lodDist: 62, terrainSubdiv: 2 },
    low: { pixelRatio: 1, shadowSize: 1024, ssao: false, dofSamples: 12, smaa: false, bloom: false, vegDensity: 0.55, lodDist: 48, terrainSubdiv: 2 },
  } as Record<PresetName, { pixelRatio: number; shadowSize: number; ssao: boolean; dofSamples: number; smaa: boolean; bloom: boolean; vegDensity: number; lodDist: number; terrainSubdiv: number }>,
  dof: {
    /** Default strength (0 = off). */
    strength: 1.0,
    /** Max blur radius in pixels (at 1080p, scaled by resolution). */
    maxBlur: 12,
    /** Base aperture; scaled by (refDistance / focusDistance)^0.6 so the band narrows when zoomed in. */
    aperture: 1.25,
    refDistance: 70,
    /** Foreground (closer than focus) blur multiplier. */
    foregroundBoost: 1.7,
    /** Extra screen-space tilt: blur grows towards top/bottom edges. */
    tilt: 0.32,
  },
  bloom: { strength: 0.32, radius: 0.5, threshold: 0.86 },
  grade: { saturation: 0.97, warmth: 0.09, teal: 0.04, contrast: 1.03, vignette: 0.3 },
  ssao: { radius: 1.2, thickness: 1.2, scale: 1.0, blend: 0.85 },
};

export const CAMERA = {
  /** Degrees from horizontal. */
  pitch: 53,
  pitchClose: 38,
  minDistance: 6,
  /** Normal furthest zoom; beyond it the view keeps pulling back to fit the whole map. */
  maxDistance: 230,
  /** Near top-down angle for the whole-map overview. */
  overviewPitch: 80,
  startDistance: 62,
  startYaw: -0.62,
  panSpeed: 1.0,
  keyPanSpeed: 0.9,
  rotateSpeed: 1.6,
  /** Radians per pixel when rotating by dragging (middle mouse, Alt/Shift-drag, compass). */
  dragRotateSpeed: 0.008,
  /** Degrees of tilt per pixel of two-finger (or right-button) vertical drag. */
  tiltSpeed: 0.18,
  zoomSpeed: 0.0015,
  damping: 8,
};

export const TIME = {
  /** Real seconds per game day at 1x. */
  dayLength: 600,
  daysPerSeason: 3,
  seasons: ['Spring', 'Summer', 'Autumn', 'Winter'],
  /** Day fraction the game starts at (golden hour). */
  startTime: 0.52,
  speeds: [1, 2, 3],
  autosaveSeconds: 60,
};

/** Keyframes of the day cycle. `t` = real fraction of the day. Golden hour gets the widest span. */
export const DAY_KEYS = [
  // Night: bright silvery moonlight, blue sky bounce.
  { t: 0.0, elev: -30, sun: 0xc4d6ff, sunI: 1.55, hemiSky: 0x44639f, hemiGround: 0x263150, hemiI: 1.05, amb: 0.22, fog: 0x1b2c50, exposure: 1.1, night: 1 },
  { t: 0.14, elev: -8, sun: 0xc0d2ff, sunI: 1.45, hemiSky: 0x4a66a6, hemiGround: 0x283050, hemiI: 1.0, amb: 0.21, fog: 0x24385e, exposure: 1.08, night: 1 },
  { t: 0.2, elev: 4, sun: 0xffa36a, sunI: 1.6, hemiSky: 0xd3a5a8, hemiGround: 0x8a6b55, hemiI: 0.8, amb: 0.14, fog: 0xf0b890, exposure: 1.05, night: 0.1 },
  { t: 0.27, elev: 22, sun: 0xffe2b8, sunI: 2.6, hemiSky: 0x9fd4ff, hemiGround: 0xc9a46a, hemiI: 1.0, amb: 0.18, fog: 0xdde6ea, exposure: 1.05, night: 0 },
  { t: 0.4, elev: 48, sun: 0xfff0d8, sunI: 3.0, hemiSky: 0x9fd4ff, hemiGround: 0xc9a46a, hemiI: 1.05, amb: 0.2, fog: 0xe6ecee, exposure: 1.0, night: 0 },
  { t: 0.48, elev: 40, sun: 0xffe0a8, sunI: 3.1, hemiSky: 0x9fd4ff, hemiGround: 0xc9a46a, hemiI: 1.0, amb: 0.18, fog: 0xf0dcc0, exposure: 1.08, night: 0 },
  // Golden hour: long, low, warm.
  { t: 0.56, elev: 31, sun: 0xffd9a0, sunI: 3.4, hemiSky: 0x9fd4ff, hemiGround: 0xc9a46a, hemiI: 0.95, amb: 0.16, fog: 0xf3d6b0, exposure: 1.1, night: 0 },
  { t: 0.74, elev: 19, sun: 0xffc680, sunI: 3.2, hemiSky: 0x9ccfff, hemiGround: 0xc99c62, hemiI: 0.9, amb: 0.15, fog: 0xf5c99a, exposure: 1.12, night: 0 },
  { t: 0.8, elev: 5, sun: 0xff9a5c, sunI: 1.9, hemiSky: 0x9b8fb8, hemiGround: 0x8a6048, hemiI: 0.75, amb: 0.13, fog: 0xe89c78, exposure: 1.08, night: 0.35 },
  { t: 0.86, elev: -10, sun: 0xc0d2ff, sunI: 1.45, hemiSky: 0x4a66a6, hemiGround: 0x2a3050, hemiI: 1.0, amb: 0.21, fog: 0x2a3c64, exposure: 1.08, night: 1 },
  { t: 1.0, elev: -30, sun: 0xc4d6ff, sunI: 1.55, hemiSky: 0x44639f, hemiGround: 0x263150, hemiI: 1.05, amb: 0.22, fog: 0x1b2c50, exposure: 1.1, night: 1 },
];
/** Sun azimuth (radians, world space) at golden hour; sun sits upper-right of the default view so shadows fall lower-left. */
export const SUN_AZIMUTH_EVENING = -1.55;
export const SUN_AZIMUTH_MORNING = 1.55;

export const VEG = {
  /** Fraction of the LOD distance within which trees and bushes show every leaf, root and vine. */
  fineDetail: 0.4,
  /** Most plants of one type drawn at full detail at once (the nearest ones). */
  fineCap: 36,
  /** Base spawn chance per cell by zone for each plant type. */
  palmBeach: 0.07,
  palmMeadow: 0.018,
  palmJungle: 0.16,
  broadleafJungle: 0.34,
  fernPerJungleCell: 1.1,
  bushJungle: 0.16,
  bushMeadow: 0.06,
  flowerBushChance: 0.35,
  bananaJungle: 0.035,
  appleJungle: 0.03,
  appleMeadow: 0.012,
  rockHighland: 0.12,
  rockHill: 0.02,
  rockShore: 0.08,
  woodPerBroadleaf: 6,
  woodPerPalm: 3,
  stonePerRock: 14,
  fruitPerBush: 4,
  fruitPerBanana: 6,
  fruitRegrowSeconds: 240,
  saplingGrowSeconds: 900,
  stumpToSaplingSeconds: 200,
  windStrength: 1.0,
  chunks: 4,
  /** Decorative swaying grass clumps per open grass cell (scaled by the preset's vegetation density). */
  tuftsPerCell: 4,
};

export const ISLANDER = {
  startMale: 1,
  startFemale: 1,
  max: 160,
  walkSpeed: 1.25,
  /** Walking speed multiplier on stone paths. */
  pathSpeed: 1.3,
  runSpeed: 2.3,
  childScale: 0.62,
  childGrowDays: 4,
  /** Needs drain per game second (0..1 scale). */
  hungerDrain: 1 / 420,
  restDrain: 1 / 700,
  eatThreshold: 0.35,
  sleepThreshold: 0.2,
  carryAmount: 4,
  chopSeconds: 6,
  mineSeconds: 7,
  harvestSeconds: 4,
  praySeconds: 12,
  birthChancePerDay: 0.7,
  birthFoodMin: 30,
  beliefPerHappyPerSecond: 0.035,
  happyThreshold: 0.6,
  aiThinkInterval: 0.6,
  pathRequestsPerFrame: 5,
  wearPerStep: 0.016,
  wearDecayPerSecond: 0.0004,
};

export const NAMES = {
  male: ['Cuauhtemoc', 'Itzcoatl', 'Tenoch', 'Yaotl', 'Ollin', 'Tochtli', 'Mixcoatl', 'Ehecatl', 'Tezcatl', 'Nezahual', 'Acatl', 'Huitzil', 'Ocelotl', 'Tonatiuh', 'Chimalli', 'Cuetlachtli', 'Xiuhcoatl', 'Tlacael', 'Matlal', 'Coaxoch', 'Etzli', 'Tecuani', 'Mazatl', 'Quauhtli', 'Axolotl', 'Tlalli', 'Ilhuicamina', 'Cipactli'],
  female: ['Citlali', 'Xochitl', 'Itzel', 'Nenetl', 'Metztli', 'Yaretzi', 'Tonalli', 'Quetzalli', 'Atzin', 'Izel', 'Miyahuatl', 'Nochtli', 'Tlanextli', 'Ameyali', 'Citlalmina', 'Xoco', 'Yolotl', 'Papan', 'Centehua', 'Eztli', 'Huitzilin', 'Necahual', 'Teicuih', 'Tlalli', 'Xiuhtonal', 'Yoloxochitl', 'Zyanya', 'Malinalli'],
};

export type ResourceKey = 'wood' | 'stone' | 'grain' | 'fruit' | 'meat' | 'fish' | 'belief';
export const FOOD_KEYS: ResourceKey[] = ['grain', 'fruit', 'meat', 'fish'];

export const ECONOMY = {
  start: { wood: 40, stone: 12, grain: 24, fruit: 12, meat: 0, fish: 0, belief: 60 } as Record<ResourceKey, number>,
  /** Storage of the starting campfire. */
  baseWoodCap: 100,
  baseFoodCap: 90,
  beliefBaseCap: 200,
  beliefCapPerTempleTier: 250,
  foodPerMeal: 1,
  mealRestore: 0.7,
  varietyHappiness: 0.05,
};

export type BuildingKey = 'campfire' | 'hut' | 'home' | 'temple' | 'farm' | 'maizefarm' | 'chinampa' | 'butcher' | 'smokehouse' | 'woodstore' | 'grainstore' | 'warroom' | 'jetty' | 'torch' | 'bonfire' | 'firepit' | 'well' | 'tradedock' | 'kennel' | 'greathall';

export interface BuildingDef {
  key: BuildingKey;
  name: string;
  description: string;
  /** Footprint in cells (width x depth). */
  size: [number, number];
  cost: { wood: number; stone: number; belief: number };
  /** Worker-seconds of construction. */
  buildTime: number;
  /** Max builders at once. */
  builders: number;
  /** Max job workers once complete. */
  workers: number;
  housing?: number;
  woodCap?: number;
  foodCap?: number;
  upgradeTo?: BuildingKey;
  maxTier?: number;
  placeable: boolean;
}

export const BUILDINGS: Record<BuildingKey, BuildingDef> = {
  campfire: { key: 'campfire', name: 'Tribal Fire', description: 'The heart of the tribe. Stores a little of everything.', size: [2, 2], cost: { wood: 0, stone: 0, belief: 0 }, buildTime: 1, builders: 1, workers: 0, placeable: false },
  hut: { key: 'hut', name: 'Hut', description: 'Level 1 house: a small adobe home for 2 islanders.', size: [2, 2], cost: { wood: 12, stone: 0, belief: 0 }, buildTime: 22, builders: 2, workers: 0, housing: 2, upgradeTo: 'home', placeable: true },
  home: { key: 'home', name: 'Home', description: 'Adobe family house (level 2, 4 people). Upgrade it up to level 5 for 16. Couples living here have children.', size: [3, 3], cost: { wood: 26, stone: 14, belief: 0 }, buildTime: 45, builders: 3, workers: 0, housing: 4, maxTier: 4, placeable: true },
  temple: { key: 'temple', name: 'Temple', description: 'Stepped pyramid that generates Belief. Upgrade twice to raise the Great Pyramid.', size: [4, 4], cost: { wood: 20, stone: 36, belief: 20 }, buildTime: 70, builders: 4, workers: 2, maxTier: 3, placeable: true },
  farm: { key: 'farm', name: 'Vegetable Farm', description: 'Beans climbing poles, squash and chillies. Quick to grow; farmers also catch wild chickens for the pen.', size: [4, 4], cost: { wood: 16, stone: 0, belief: 0 }, buildTime: 25, builders: 2, workers: 2, placeable: true },
  maizefarm: { key: 'maizefarm', name: 'Maize Farm', description: 'A big field of tall maize with a granary crib. Slower to ripen but the richest grain harvest.', size: [5, 5], cost: { wood: 26, stone: 4, belief: 0 }, buildTime: 35, builders: 2, workers: 3, placeable: true },
  chinampa: { key: 'chinampa', name: 'Chinampa', description: 'Raised garden beds between water channels, built beside a river, pool or shore. Rich, wet soil grows crops fast in every season.', size: [4, 4], cost: { wood: 20, stone: 8, belief: 0 }, buildTime: 40, builders: 2, workers: 2, placeable: true },
  tradedock: { key: 'tradedock', name: 'Trade Dock', description: 'A long pier and trading house on the shore, facing open water. Build trade boats here and send them to trade your spare goods for what you need.', size: [2, 2], cost: { wood: 40, stone: 20, belief: 0 }, buildTime: 45, builders: 3, workers: 0, placeable: true },
  torch: { key: 'torch', name: 'Torch', description: 'A tall torch on a post. Place it along paths or anywhere to light the village at night. Villagers can walk past it.', size: [1, 1], cost: { wood: 3, stone: 0, belief: 0 }, buildTime: 4, builders: 1, workers: 0, placeable: true },
  bonfire: { key: 'bonfire', name: 'Bonfire', description: 'A great fire ringed with log benches. In the evenings villagers gather here to sing and tell stories: they grow happier and the tribe gains Belief.', size: [3, 3], cost: { wood: 20, stone: 6, belief: 0 }, buildTime: 20, builders: 2, workers: 0, placeable: true },
  firepit: { key: 'firepit', name: 'Firepit', description: 'A roasting pit with a pig turning on a spit. Meat meals become more filling and put villagers in a good mood.', size: [2, 2], cost: { wood: 12, stone: 8, belief: 0 }, buildTime: 18, builders: 1, workers: 0, placeable: true },
  well: { key: 'well', name: 'Well', description: 'A stone well of fresh, cool water with a little tiled roof. Villagers living nearby are happier.', size: [2, 2], cost: { wood: 6, stone: 20, belief: 0 }, buildTime: 25, builders: 2, workers: 0, placeable: true },
  greathall: { key: 'greathall', name: 'Great Hall', description: 'A raised stone hall under a striped canopy, with fire braziers and a bronze bell. Idle villagers come to rest on its benches; when a jaguar is spotted the bell rings and everyone runs to the hall or home for sanctuary.', size: [7, 7], cost: { wood: 70, stone: 60, belief: 20 }, buildTime: 110, builders: 5, workers: 0, placeable: true },
  kennel: { key: 'kennel', name: 'Kennel', description: 'A timber-and-adobe dog house with a shaded run. Village dogs sleep here, raise puppies and bark the alarm when a jaguar comes near. Each kennel holds up to 3 dogs.', size: [2, 2], cost: { wood: 18, stone: 6, belief: 0 }, buildTime: 20, builders: 2, workers: 0, placeable: true },
  smokehouse: { key: 'smokehouse', name: 'Smokehouse', description: 'Smokes raw fish and meat over a slow fire: 4 raw become 7 preserved (burns a little wood). Also stores food.', size: [3, 3], cost: { wood: 20, stone: 10, belief: 0 }, buildTime: 30, builders: 2, workers: 1, foodCap: 40, placeable: true },
  butcher: { key: 'butcher', name: 'Butcher', description: 'The butcher tracks down wild pigs and goats, leads them back on a leash to the pen, and turns them into meat.', size: [4, 3], cost: { wood: 22, stone: 6, belief: 0 }, buildTime: 35, builders: 2, workers: 1, placeable: true },
  woodstore: { key: 'woodstore', name: 'Wood Store', description: 'Stores wood and stone. Logs stack up as it fills.', size: [3, 2], cost: { wood: 16, stone: 0, belief: 0 }, buildTime: 20, builders: 2, workers: 0, woodCap: 120, placeable: true },
  grainstore: { key: 'grainstore', name: 'Grain Store', description: 'Stores grain, fruit, meat and fish. Baskets fill visibly.', size: [2, 2], cost: { wood: 18, stone: 4, belief: 0 }, buildTime: 24, builders: 2, workers: 0, foodCap: 140, placeable: true },
  warroom: { key: 'warroom', name: 'War Room', description: 'Trains Jaguar and Eagle warriors who patrol the island.', size: [3, 3], cost: { wood: 30, stone: 30, belief: 15 }, buildTime: 55, builders: 3, workers: 0, placeable: true },
  jetty: { key: 'jetty', name: 'Jetty', description: 'Wooden pier into the shallows. Builds canoes and fishing boats.', size: [2, 2], cost: { wood: 24, stone: 0, belief: 0 }, buildTime: 30, builders: 2, workers: 3, placeable: true },
};

/** New settlers arriving by canoe once the village has room and food to spare. */
export const SETTLERS = {
  /** Seconds (game time) between possible arrivals. */
  interval: [150, 260] as [number, number],
  /** Free beds and food needed before a canoe comes. */
  minFreeBeds: 2,
  minFood: 15,
};

/** Stone paths laid with the Build menu's path tool. */
export const PATHS = {
  /** Stone per paved cell. */
  stonePerCell: 1,
  /** Dirt paths are free: villagers just clear and tread the ground. */
  dirtCost: 0,
  /** Walking speed bonus on a dirt path, as a share of the stone path bonus. */
  dirtSpeedShare: 0.6,
  /** Brush radius in cells (about two cells wide). */
  radius: 0.85,
  /** Wood per rope bridge deck cell. */
  bridgeWood: 2,
  /** Wood per cell of water canal (the channel is lined with posts and wattle). */
  canalWood: 1,
};

/** Adobe homes grow in place: tier 1–4 are house levels 2–5. */
export const HOMES = {
  housing: [4, 7, 12, 16],
  /** Cost to reach each tier (index = target tier). */
  upgradeCost: [
    { wood: 0, stone: 0, belief: 0 },
    { wood: 0, stone: 0, belief: 0 },
    { wood: 30, stone: 26, belief: 0 },
    { wood: 45, stone: 45, belief: 10 },
    { wood: 60, stone: 70, belief: 25 },
  ],
  upgradeTime: [0, 0, 40, 55, 70],
};

export const TEMPLE = {
  beliefPerTier: [0, 0.25, 0.55, 1.1],
  upgradeCost: [
    { wood: 0, stone: 0, belief: 0 },
    { wood: 0, stone: 0, belief: 0 },
    { wood: 40, stone: 90, belief: 60 },
    { wood: 70, stone: 180, belief: 150 },
  ],
  upgradeTime: [0, 0, 90, 140],
  prayBelief: 0.06,
};

/** Per farm type: growth speed multiplier, grain per harvest, lowest seasonal growth, crop label. */
export const FARM_TYPES: Partial<Record<BuildingKey, { grow: number; yield: number; seasonFloor: number; crop: 'veg' | 'maize' | 'chinampa'; label: string }>> = {
  farm: { grow: 1.35, yield: 12, seasonFloor: 0, crop: 'veg', label: 'Beans and squash' },
  maizefarm: { grow: 0.85, yield: 28, seasonFloor: 0, crop: 'maize', label: 'Maize' },
  chinampa: { grow: 1.6, yield: 18, seasonFloor: 0.85, crop: 'chinampa', label: 'Chinampa crops' },
};
export const isFarm = (k: BuildingKey): boolean => k in FARM_TYPES;

/** A trade: goods loaded at the dock, and what the boat brings back. */
export interface TradeOffer {
  id: string;
  give: Partial<Record<ResourceKey, number>>;
  get: Partial<Record<ResourceKey, number>>;
}

/** Trade Dock boats and the bargains on offer (more goods and materials will join this list). */
export const TRADE = {
  boatCost: { wood: 40, stone: 10, belief: 0 },
  boatBuildSeconds: 40,
  maxBoats: 2,
  /** Seconds a boat is away over the horizon trading (plus the sail out and back). */
  voyageSeconds: 55,
  offers: [
    { id: 'wood-stone', give: { wood: 20 }, get: { stone: 12 } },
    { id: 'stone-wood', give: { stone: 20 }, get: { wood: 26 } },
    { id: 'grain-fish', give: { grain: 20 }, get: { fish: 16 } },
    { id: 'fish-grain', give: { fish: 16 }, get: { grain: 20 } },
    { id: 'fruit-meat', give: { fruit: 20 }, get: { meat: 10 } },
    { id: 'wood-fruit', give: { wood: 24 }, get: { fruit: 18 } },
    { id: 'meat-belief', give: { meat: 10 }, get: { belief: 25 } },
    { id: 'stone-belief', give: { stone: 30 }, get: { belief: 20 } },
  ] as TradeOffer[],
  /** Goods traders talk about but that aren't on the market yet. */
  comingSoon: ['Obsidian', 'Cacao', 'Cotton', 'Quetzal feathers', 'Jade', 'Copper'],
};

/** Village comforts: evening gatherings at bonfires, wells and roasted meat. */
/**
 * Pelicans and herons. Numbers follow the habitat (beach and rock resting places for pelicans,
 * wading shallows for herons) but are capped so wildlife stays an occasional sight.
 * Performance: one small instanced mesh per body part for all birds; off-screen birds skip
 * posing; reactions to people/dogs run ~3 times a second, spot searches only when a bird
 * decides to move (sampling ~10 candidates).
 */
export const WATERBIRDS = {
  pelicans: [3, 9] as [number, number],
  herons: [2, 5] as [number, number],
  /** Herons keep this far apart (two may share a wetland, never crowd it). */
  heronSpacing: 12,
  /** Deepest water a heron wades into (below the sea surface). */
  wadeDepth: 0.22,
  pelicanSpeed: 3.0,
  heronSpeed: 2.2,
  /** Seconds for a bird to go from full to starving; hunts begin below 'hungry'. */
  hungerSeconds: 260,
  hungry: 0.5,
  /** Catch odds for a pelican dive and a heron strike; how far a heron can reach. */
  pelicanCatch: 0.45,
  heronCatch: 0.4,
  strikeReach: 0.62,
  /** Chance a hungry pelican goes after a canoe that's netting rather than a school. */
  followCanoe: 0.35,
  /** Villagers: noticed at alertRange, flee at fleeRange; relocate up to this far. */
  alertRange: 5,
  fleeRange: 3,
  relocate: 25,
  /** Active hours (they settle down at dusk and stay quiet until morning). */
  wake: 5.8,
  settle: 18.4,
};

/** Sea turtles: a handful per island (more with more beach), slow on land, graceful in water. */
export const TURTLES = {
  count: [5, 9] as [number, number],
  crawlSpeed: 0.09,
  swimSpeed: 0.45,
  restSeconds: [60, 200] as [number, number],
  /** Seconds between breaths (they rise to the surface). */
  breathEvery: [35, 80] as [number, number],
  /** Chance, at each wander point, that a swimming turtle heads for a beach to haul out. */
  comeAshore: 0.08,
};

/** Swampland: low jungle basins far from the village, with pools of dark water. */
export const SWAMP = {
  count: 2,
  radius: [7, 11] as [number, number],
  awayFromVillage: 32,
  /** How deep pools are dug below the ground, and how much the wet mud sinks. */
  poolDepth: 0.6,
  mudDepth: 0.06,
};

/** Alligators: uncommon ambush predators that never leave the swamp. */
export const ALLIGATORS = {
  perSwamp: [1, 2] as [number, number],
  max: 4,
  /** Lunges at a villager or dog this close to the water's edge where it lies in wait. */
  lungeRange: 2.2,
  lungeSpeed: 5,
  /** Seconds before it can strike again. */
  cooldown: 70,
  /** Odds a lunge connects, and that a villager it catches is killed (else injured). */
  hitChance: 0.45,
  killChance: 0.2,
};

/** Village dogs: companions, and the first line of defence against jaguars. */
export const DOGS = {
  perKennel: 3,
  /** Hard ceiling on the whole village's dogs, however many kennels. */
  maxTotal: 12,
  /** Two stray dogs adopt the village when its first kennel is finished. */
  foundingDogs: 2,
  /** Breeding: food spent, time until the puppy is born, then a rest before the next litter. */
  breedFood: 12,
  gestation: 45,
  breedCooldown: 150,
  /** Seconds for a puppy to grow up. */
  puppyGrow: 300,
  /** Food each adult eats per minute (puppies half). A long hungry spell and a dog wanders off for good. */
  foodPerMinute: 0.35,
  starveLeave: 240,
  /** Dogs smell a jaguar from much farther away than villagers can see one. */
  detect: 17,
  /** Barking rallies other dogs within this range. */
  rally: 20,
  /** How far dogs stray from the village: guards stay close, free-roamers explore and follow hunters. */
  guardRange: 14,
  roamRange: 30,
  followRange: 45,
  walkSpeed: 0.9,
  runSpeed: 3.0,
  /** An injured dog limps for this long. */
  injuredTime: 120,
  /** Chance an adult dog attaches itself to a household. */
  attachChance: 0.65,
};

/** Jaguars: rare jungle predators that sometimes stalk the village. */
export const JAGUARS = {
  count: 2,
  /** Seconds between hunts (a jaguar grows hungry, then heads for the village); halved at night. */
  huntEvery: [260, 480] as [number, number],
  prowlSpeed: 0.7,
  stalkSpeed: 1.05,
  chargeSpeed: 3.3,
  retreatSpeed: 3.0,
  /** Villagers only notice a jaguar this close (dogs sense it much farther). */
  villagerNotice: 5.5,
  chargeRange: 7,
  pounceRange: 0.8,
  /** Gives up the stalk after this long. */
  stalkTime: 70,
  /** A caught villager is killed this often (otherwise injured); halved with a dog or warrior close by. */
  killChance: 0.3,
  /** Retreat odds against n dogs: base + perDog * n (capped); warriors count as several dogs. */
  retreatBase: 0.3,
  retreatPerDog: 0.2,
  retreatMax: 0.93,
  warriorAsDogs: 3,
  /** Of the encounters that are not an immediate retreat, the share that become a scuffle (the rest press on). */
  fightShare: 0.6,
  /** A dog lunged at: it escapes, is injured, or is killed. */
  dogEscape: 0.6,
  dogInjured: 0.28,
  /** A dog close to a pouncing jaguar can throw itself in the way this often. */
  interceptChance: 0.4,
};

export const COMFORTS = {
  /** Evening hours when villagers gather round a bonfire (before bed). */
  bonfireHours: [18.6, 22.5] as [number, number],
  bonfireSeconds: [30, 55] as [number, number],
  bonfireBelief: 0.035,
  bonfireHappy: 0.006,
  /** Distance (from home or where they are) within which a well cheers villagers up. */
  wellRadius: 16,
  wellHappy: 0.07,
  /** Extra hunger restored and happiness from a meat meal when the village has a firepit. */
  firepitMeal: 0.25,
  firepitHappy: 0.04,
  /** Villagers answering a call to help build: how many and from how far. */
  helpersMax: 6,
  helpersRadius: 45,
};

/** The Great Hall: resting place for idle villagers and sanctuary when danger comes. */
export const GREAT_HALL = {
  /** Idle villagers within this distance may come to rest here (chance per idle decision). */
  restRadius: 45,
  restChance: 0.45,
  restSeconds: [20, 45] as [number, number],
  /** Rest and happiness regained per second sitting in the hall. */
  restGain: 0.012,
  happyGain: 0.004,
  /** Sanctuary: the bell calls everyone within this distance; they stay at least this long. */
  callRadius: 80,
  shelterMin: 18,
  /** A jaguar still counts as a threat while hunting within this distance of the village. */
  threatRadius: 45,
};

/** Smokehouse batches: raw fish or meat in, more (preserved) food out. */
export const SMOKE = { batchSeconds: 20, input: 4, output: 7, wood: 1 };

export const FARM = {
  growSeconds: 260,
  grainYield: 16,
  harvestSeconds: 10,
  tendBoost: 1.6,
  seasonGrowth: [1.25, 1.0, 0.8, 0.35],
  blessMultiplier: 2.5,
};

export const WARRIOR = {
  trainSeconds: 30,
  cost: { wood: 5, stone: 5, belief: 10 },
  patrolRadius: 30,
  scareRadius: 5,
};

export const JETTY = {
  length: 6,
  boatCost: { wood: 15, stone: 0, belief: 0 },
  boatBuildSeconds: 25,
  maxBoats: 3,
  boatSpeed: 2.6,
  /** Seconds per net cast; boats cast again and again during a trip. */
  netSeconds: 16,
  /** A fishing trip lasts this long out at sea (5 minutes) before heading home. */
  fishingSeconds: 300,
  catchPerCast: 2,
  /** Most fish a boat can bring home from one trip. */
  catchPerTrip: 45,
};

export const POWERS = {
  sculptCostPerCell: 1,
  sculptRadius: 1.6,
  bless: { cost: 30, radius: 12, duration: 180 },
  rain: { cost: 40, duration: 120 },
  calm: { cost: 50 },
  stormChancePerDay: 0.25,
  stormDuration: [70, 130] as [number, number],
  rainChancePerDay: [0.4, 0.2, 0.45, 0.35],
};

export const WILDLIFE = {
  chickens: 22,
  pigs: 12,
  goats: 12,
  parrots: 28,
  gulls: 26,
  reefFish: 140,
  schools: 4,
  /** Big open-water schools that boats track down. */
  fishPerSchool: 110,
  /** Radius around the cursor/touch point that scares birds. */
  birdFleeRadius: 6,
  fishFleeRadius: 5,
  chickenFleeRadius: 3,
  birdFleeSpeed: 10,
  birdSettleSeconds: 3.5,
  schoolRegrowPerSecond: 0.02,
  animalRegrowSeconds: 240,
  boids: { separation: 1.6, alignment: 0.8, cohesion: 0.6, sepRadius: 1.4, neighbourRadius: 5 },
};

export type SpeciesKey = 'chicken' | 'pig' | 'goat' | 'tapir';

export interface SpeciesDef {
  name: string;
  /** Population on a medium island. */
  count: [number, number];
  group: [number, number];
  habitat: 'settlement' | 'jungleEdge' | 'hills' | 'jungle';
  wanderSpeed: number;
  fleeSpeed: number;
  /** Distances to islanders: notice (look), step away, run. */
  alertRadius: number;
  avoidRadius: number;
  fleeRadius: number;
  /** Stamina seconds of flight before tiring, and seconds of close pursuit to catch. */
  stamina: number;
  captureTime: number;
  meat: number;
  /** Must be led to a Butcher's pen (otherwise delivered straight to the food store). */
  needsPen: boolean;
  /** How the captured animal is brought home. */
  capture: 'carry' | 'lead' | 'hunt';
  /** Seconds before a consumed animal is replaced in the wild. */
  regrow: number;
  maxSlope: number;
}

/** Land animal species (data-driven: add new livestock here). */
export const SPECIES: Record<SpeciesKey, SpeciesDef> = {
  chicken: { name: 'Chicken', count: [12, 16], group: [2, 5], habitat: 'settlement', wanderSpeed: 0.5, fleeSpeed: 1.9, alertRadius: 1.4, avoidRadius: 0.9, fleeRadius: 0.5, stamina: 2.5, captureTime: 1.2, meat: 3, needsPen: false, capture: 'carry', regrow: 200, maxSlope: 0.4 },
  pig: { name: 'Pig', count: [9, 13], group: [2, 5], habitat: 'jungleEdge', wanderSpeed: 0.45, fleeSpeed: 2.3, alertRadius: 5.5, avoidRadius: 3.6, fleeRadius: 1.8, stamina: 6, captureTime: 2.6, meat: 10, needsPen: true, capture: 'lead', regrow: 300, maxSlope: 0.45 },
  goat: { name: 'Goat', count: [5, 8], group: [2, 4], habitat: 'hills', wanderSpeed: 0.45, fleeSpeed: 1.8, alertRadius: 1.8, avoidRadius: 0.9, fleeRadius: 0.5, stamina: 4, captureTime: 1.4, meat: 8, needsPen: true, capture: 'lead', regrow: 280, maxSlope: 0.75 },
  tapir: { name: 'Tapir', count: [3, 5], group: [1, 2], habitat: 'jungle', wanderSpeed: 0.4, fleeSpeed: 2.5, alertRadius: 9, avoidRadius: 6.5, fleeRadius: 3.5, stamina: 11, captureTime: 5, meat: 18, needsPen: false, capture: 'hunt', regrow: 480, maxSlope: 0.45 },
};

export const FAUNA = {
  monkeys: [6, 10] as [number, number],
  monkeyGroup: [2, 5] as [number, number],
  /** Longest believable leap between tree canopies. */
  monkeyJump: 4.6,
  /** Village raids: seconds between raids, how far troops roam for food, raiders per raid. */
  monkeyRaidEvery: [75, 150] as [number, number],
  monkeyRaidRange: 70,
  monkeyRaiders: [1, 3] as [number, number],
  /** Food one monkey makes off with, and how long it rummages first. */
  monkeySteal: [3, 6] as [number, number],
  monkeyStealTime: 3.5,
  /** Raiders bolt from the pointer (and warriors) within this range. */
  monkeyFear: 3.6,
  monkeyRunSpeed: 1.5,
  monkeyFleeSpeed: 2.1,
  monkeyMeat: 5,
  /** A lost monkey is replaced by a newcomer after this long. */
  monkeyRespawn: 300,
  toucans: [6, 9] as [number, number],
  gullFlocks: 3,
  gullsPerFlock: [4, 7] as [number, number],
  /** Graduated pointer disturbance for gulls: notice → bank away → scatter. */
  gullNotice: 11,
  gullBank: 6.5,
  gullScatter: 3,
  reefSchools: [11, 15] as [number, number],
  reefSchoolSize: [5, 20] as [number, number],
  /** Beyond this distance from the camera target, animals think less often. */
  lodDistance: 70,
};

export const CRITTERS = {
  crabs: 40,
  crabSize: 1,
  crabFleeRadius: 2.2,
  rays: 14,
  rayFleeRadius: 3,
};

export const MARINE = {
  whales: 1,
  /** Whale length in world units (islanders are ~0.62 tall). */
  whaleLength: 5.2,
  whaleSpeed: 1.5,
  /** Cruising depth of the whale's body centre below the surface. */
  swimDepth: 1.7,
  /** Seconds until the first breach, then a random gap between breaches per whale. */
  firstBreach: 12,
  breachEvery: [45, 95] as [number, number],
  pods: 2,
  dolphinsPerPod: 6,
  dolphinLength: 1.15,
  dolphinSpeed: 3.2,
  /** Seconds per porpoising cycle (half leaping, half gliding under). */
  leapPeriod: 2.1,
  leapHeight: 0.85,
};

export const AUDIO = {
  masterVolume: 0.7,
  musicVolume: 0.35,
  ambientVolume: 0.7,
  sfxVolume: 0.8,
  hearingRadius: 45,
};

export const MILESTONES = [
  { id: 'firstHut', text: 'Build your first Hut' },
  { id: 'firstTemple', text: 'Build your first Temple' },
  { id: 'firstFarm', text: 'Plant your first Farm' },
  { id: 'pop10', text: 'Reach 10 islanders' },
  { id: 'pop20', text: 'Reach 20 islanders' },
  { id: 'firstBoat', text: 'Launch a fishing boat' },
  { id: 'firstWarrior', text: 'Train a warrior' },
  { id: 'greatPyramid', text: 'Complete the Great Pyramid' },
];

export const SAVE = {
  key: 'aztlan-isle-save-v7',
  settingsKey: 'aztec-isle-settings-v1',
  tutorialKey: 'aztec-isle-tutorial-v1',
};
