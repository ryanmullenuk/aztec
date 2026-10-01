import { BuildingKey, POWERS } from '../config';

export type ToolId = 'select' | 'build' | 'raise' | 'lower' | 'flatten' | 'harvest' | 'bless' | 'rain' | 'calm' | 'path' | 'dirtpath' | 'unpath' | 'bridge' | 'canal' | 'regrass' | 'flowers' | 'bushes' | 'shrubs' | 'trees' | 'unplant';

/** The drag-to-paint Build tools (paths, bridges, canals, and planting the garden). */
export const PAINT_TOOLS: ToolId[] = ['path', 'dirtpath', 'unpath', 'bridge', 'canal', 'regrass', 'flowers', 'bushes', 'shrubs', 'trees', 'unplant'];
/** The garden planting brushes among them (offered together in the Flora slot's popup). */
export const GARDEN_TOOLS: ToolId[] = ['flowers', 'bushes', 'shrubs', 'trees', 'unplant'];

export interface ToolDef {
  id: ToolId;
  name: string;
  icon: string;
  hint: string;
  /** Belief cost label, if any. */
  cost?: number;
}

/** Every tool (the sculpt tools sit together under the Terrain slot). */
export const TOOLS: ToolDef[] = [
  { id: 'select', name: 'Select', icon: 'select', hint: 'Select islanders and buildings. With an islander selected, click a building or resource to assign them.' },
  { id: 'build', name: 'Build', icon: 'build', hint: 'Open the building menu, then place on flat land.' },
  { id: 'raise', name: 'Raise', icon: 'raise', hint: 'Hold and drag to raise the land one layer.', cost: POWERS.sculptCostPerCell },
  { id: 'lower', name: 'Lower', icon: 'lower', hint: 'Hold and drag to lower the land one layer.', cost: POWERS.sculptCostPerCell },
  { id: 'flatten', name: 'Flatten', icon: 'flatten', hint: 'Hold and drag to level land to the layer you started on.', cost: POWERS.sculptCostPerCell },
  { id: 'harvest', name: 'Harvest', icon: 'harvest', hint: 'Mark trees, rocks and fruit for priority harvesting, or tap an animal to send a hunter after it.' },
  { id: 'bless', name: 'Bless', icon: 'bless', hint: 'Bless farms in an area: crops grow much faster for a while.', cost: POWERS.bless.cost },
  { id: 'rain', name: 'Rain', icon: 'rain', hint: 'Summon rain: crops and forests grow faster.', cost: POWERS.rain.cost },
  { id: 'calm', name: 'Calm', icon: 'calm', hint: 'Calm a storm and bring back the sun.', cost: POWERS.calm.cost },
];

export const BUILD_MENU: BuildingKey[] = ['hut', 'home', 'farm', 'maizefarm', 'chinampa', 'woodstore', 'grainstore', 'smokehouse', 'firepit', 'well', 'bonfire', 'torch', 'temple', 'greathall', 'healer', 'butcher', 'pigpen', 'chickenpen', 'kennel', 'jetty', 'tradedock', 'warroom', 'watchtower'];

/** The land-shaping tools, offered together in the Terrain slot's popup. */
export const TERRAIN_TOOLS: ToolId[] = ['raise', 'lower', 'flatten'];

/** A toolbar slot: a tool, the Terrain slot that opens Raise / Lower / Flatten, or the Flora slot of planting brushes. */
export type SlotId = ToolId | 'terrain' | 'flora';

/** The toolbar (number keys 1–7). */
export const TOOLBAR: { id: SlotId; name: string; icon: string; hint: string; cost?: number }[] = [
  ...TOOLS.filter((t) => t.id === 'select' || t.id === 'build'),
  { id: 'terrain', name: 'Terrain', icon: 'terrain', hint: 'Shape the land: raise, lower or flatten it. Hold and drag to sculpt.', cost: POWERS.sculptCostPerCell },
  { id: 'flora', name: 'Flora', icon: 'flora', hint: 'Plant flowers, bushes, shrubs and trees: hold and drag over open ground, like laying a path. Trees cost Belief; the rest are free.' },
  // (Harvesting is left to the islanders: they fell, mine and pick by themselves.)
  ...TOOLS.filter((t) => !['select', 'build', 'raise', 'lower', 'flatten', 'harvest'].includes(t.id)),
];
