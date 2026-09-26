import { ResourceKey } from '../config';

export type Gender = 'm' | 'f';

export type Role = 'idle' | 'builder' | 'woodcutter' | 'miner' | 'gatherer' | 'farmer' | 'priest' | 'fisher' | 'butcher' | 'warrior';

export const ROLE_LABEL: Record<Role, string> = {
  idle: 'Resting',
  builder: 'Builder',
  woodcutter: 'Woodcutter',
  miner: 'Stonecutter',
  gatherer: 'Fruit gatherer',
  farmer: 'Farmer',
  priest: 'Priest',
  fisher: 'Fisher',
  butcher: 'Butcher',
  warrior: 'Warrior',
};

export type Anim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'carry'
  | 'chop'
  | 'mine'
  | 'farm'
  | 'harvest'
  | 'fish'
  | 'build'
  | 'pray'
  | 'sleep'
  | 'eat';

export type Tool = 'none' | 'axe' | 'pick' | 'hoe' | 'spear' | 'hammer';

export type CarryKind = ResourceKey | 'log' | 'chicken';

/** A task is a small state machine the AI steps through. */
export interface Task {
  kind: 'chop' | 'mine' | 'gather' | 'deliver' | 'build' | 'farm' | 'pray' | 'eat' | 'sleep' | 'wander' | 'patrol' | 'butcher' | 'fish' | 'train' | 'goto' | 'follow' | 'capture' | 'spearfish';
  stage: number;
  /** Plant id, building id or islander id depending on kind. */
  target: number;
  timer: number;
  x: number;
  z: number;
  /** Extra data (e.g. resource type). */
  res?: ResourceKey;
  /** Sub-phase for multi-step tasks (capture: 0 chase, 1 bring home). */
  phase?: number;
  /** Building the task delivers to (capture: the pen's building). */
  building?: number;
}

export interface Islander {
  id: number;
  name: string;
  gender: Gender;
  child: boolean;
  /** Game seconds alive (children grow up after a while). */
  age: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  path: { x: number; z: number }[] | null;
  pathIdx: number;
  /** Waiting on the path queue. */
  pathPending: boolean;
  hunger: number;
  rest: number;
  happy: number;
  role: Role;
  manualRole: boolean;
  /** Building the islander works at (farm, temple, jetty...). -1 = none. */
  workplace: number;
  home: number;
  carry: { kind: CarryKind; res: ResourceKey; n: number } | null;
  task: Task | null;
  anim: Anim;
  animT: number;
  tool: Tool;
  skin: number;
  cloth: number;
  cloth2: number;
  headdress: number;
  jewel: boolean;
  warrior: 'jaguar' | 'eagle' | null;
  hidden: boolean;
  think: number;
  lastMeal?: ResourceKey;
  /** For stuck detection. */
  stuck: number;
  lastCell: number;
  /** Assigned by the player (plant id to work first). */
  focusPlant: number;
  sleeping: boolean;
}

export function makeIslander(id: number, name: string, gender: Gender, x: number, z: number, rnd: () => number, child = false): Islander {
  // Warm browns like the reference art.
  const skins = [0xc98450, 0xb87444, 0xd49060, 0xa8683c, 0xc47a48, 0xba7a52, 0x9c6038];
  const clothsM = [0xf1e6cf, 0xe9dcc0, 0xd8c9a8, 0xf4ecd8];
  const clothsF = [0xf6efe0, 0xefe5d2, 0xf2e4d6, 0xe6efe4];
  // Accent cloth colour (teal in the reference; a few families wear blue, green or purple).
  const cloaks = [0x1f8f86, 0x1f8f86, 0x23877e, 0x2a9d8f, 0x2a6fb0, 0x3a8a3a, 0x6a4a8a];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  return {
    id,
    name,
    gender,
    child,
    age: child ? 0 : 1e6,
    x,
    y: 0,
    z,
    heading: rnd() * Math.PI * 2,
    speed: 0,
    path: null,
    pathIdx: 0,
    pathPending: false,
    hunger: 0.7 + rnd() * 0.3,
    rest: 0.7 + rnd() * 0.3,
    happy: 0.6,
    role: 'idle',
    manualRole: false,
    workplace: -1,
    home: -1,
    carry: null,
    task: null,
    anim: 'idle',
    animT: rnd() * 10,
    tool: 'none',
    skin: pick(skins),
    cloth: gender === 'm' ? pick(clothsM) : pick(clothsF),
    cloth2: pick(cloaks),
    // 0 none, 1 feather band, 2 grand feather fan, 3 tall plume (fans are the most common).
    headdress: [0, 1, 1, 2, 2, 2, 3][Math.floor(rnd() * 7)],
    jewel: rnd() < 0.4,
    warrior: null,
    hidden: false,
    think: rnd(),
    stuck: 0,
    lastCell: -1,
    focusPlant: -1,
    sleeping: false,
  };
}
