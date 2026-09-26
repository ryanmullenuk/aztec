# Aztlan Isle

A calm, tactile, browser-based god game inspired by the feel of Godus. Guide an Aztec tribe as they settle a lush tropical island: sculpt the stepped terrain, raise huts, homes and temples, farm maize, fish the turquoise shallows and work towards the Great Pyramid.

The whole thing is rendered as a tilt-shift miniature diorama at golden hour. Every model, texture and sound is generated in code; the only external asset is the splash art.

**Play:** https://ryanmullenuk.github.io/aztec/ (after GitHub Pages is enabled, see [Deploy](#deploy))

Add `?seed=1234` to the URL to play or share a specific island.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build a static site into dist/
npm run preview    # serve the production build locally
```

Requires Node 20 or newer.

## Deploy

The build is a plain static site with relative paths, so `dist/` can be hosted anywhere, including a sub-path.

### GitHub Pages (included)

1. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.
2. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The game goes live at `https://<user>.github.io/<repo>/`.

### Netlify

Connect the repository in the Netlify dashboard. `netlify.toml` sets the build command (`npm run build`) and publish folder (`dist`). You can also deploy from your machine:

```bash
npm run build && npx netlify deploy --prod --dir=dist
```

### Vercel

Import the repository in Vercel. `vercel.json` sets the Vite build. From your machine:

```bash
npx vercel --prod
```

## Controls

| | Desktop | Touch |
|---|---|---|
| Pan | Left or right drag, WASD / arrow keys | One finger drag |
| Zoom | Mouse wheel (towards the cursor), + / − | Pinch |
| Rotate | Middle-drag, Alt/Shift + drag, Q / E, or drag the compass (bottom right) / hold its arrows | Two-finger twist, or drag the compass with one finger / hold its arrows |
| Select / place | Click | Tap |
| Sculpt | Hold and drag with Raise / Lower / Flatten | One finger drag with a sculpt tool |
| Toolbar | 1–9 | Tap the slots |
| Other | Double-click the compass to reset the view, R rotates a building, Space pauses, Esc cancels, H opens help, M mutes, F follows the selected islander | |

Select an islander, then click a building, tree, rock or fruit bush to give them that job. Tap an animal to see what it is doing and send a hunter after it (or, with an islander selected, tap the animal to send them).

## Features

**World**
- Procedural island from a seed, laid out like a tropical atoll: a multi-lobed main island with bays and peninsulas, wide sandy beaches, rocky headlands and knolls, large open grasslands between jungle, and 5–8 rocky wooded islets.
- A tall mountain massif with jagged peaks, green lower slopes, rocky crags and clouds drifting around the summits.
- 1–3 rivers springing high in the mountains; a waterfall drops off a mountain cliff into a turquoise pool with mist, and a lagoon.
- A wide turquoise reef shelf around the island, with seagrass meadows, dark reef rock, seaweed beds and 18–26 coral reefs, dropping off into deep navy sea.
- Godus-style stepped contour terrain with rounded, curving terraces. Sculpt it one layer at a time, paying Belief.
- Paths wear into the grass where islanders walk often, and farms till the soil.

**Look**
- Tilt-shift golden-hour diorama:
  - Depth-based bokeh DOF focused on the centre of the screen, with the strongest blur in the foreground; the focus band narrows as you zoom in.
  - GTAO, subtle bloom, warm/teal colour grading, vignette and SMAA/FXAA.
- ACES tone mapping; a low golden sun with long soft shadows fitted to the view; a cool sky bounce light.
- Sunlight glows through fronds, with warm rim light on treetops and roofs, and contact shadows under objects.
- Ocean shader: sixteen layered directional waves (swell to fine chop) with analytic normals that fade with distance, Fresnel sky reflection, a sun or moon glitter path with sparkling glints, whitecap flecks, turquoise shallows fading to deep navy, light absorbed with depth, caustics on the seabed, and shoreline and rock foam.
- A 10-minute day/night cycle where golden hour lasts longest; the light hands over smoothly to a bright silvery moon with a glitter path on the sea, and village torches light up with real point lights.

**Vegetation**
- A tree catalogue: palms (straight, leaning, curved), eight broadleaf varieties (round, tall and narrow, spreading, jungle giants, vine-hung, pink blossom) and orange fruit trees, plus ferns, flowering bushes, apple bushes and banana trees, all with a wind-sway shader.
- Biome weighting and clustering noise: palms on beaches, mixed coast, open grassland with small groves, dense mixed jungle, hardy trees on hills and larger trees along rivers. Nothing grows on buildings, paths or steep slopes.
- Swaying grass clumps over the meadows, hidden automatically under buildings, fields and worn paths.
- Zoomed in, trees standing between the camera and what you're looking at turn semi-transparent; zoomed out they are fully solid.
- Chunked for frustum culling, with LOD for distant chunks. Only visible instances are drawn.
- Chopped trees leave stumps that regrow as saplings. Fruit grows back; rocks give stone.

**Islanders**
- Faceted low-poly Aztec islanders, articulated with knees and elbows (pelvis, chest, head, upper arms, forearms, thighs and shins):
  - Men: gold collar with a jade pendant, armbands and cuffs, a red belt, a step-fret loincloth panel with layered teal/red/cream flaps, greaves and sandals.
  - Women: long hair, a crossed crop top and a layered skirt with a fret apron.
  - Feather headdresses from a simple band up to the grand teal/red/gold fan (priests always wear the fan). Warriors wear jaguar or eagle helms and carry an obsidian spear.
  - Per-person skin tones and accent colours.
- Procedural animations: walk, run, carry, chop, mine, farm, harvest, fish, build, pray, eat, idle and sleep.
- Needs (hunger, rest, happiness), a utility AI and automatic job assignment with player overrides.
- Islanders decide for themselves when their own job has nothing to do: they pick fruit, spear fish from the shore, cut wood or quarry stone, whichever the tribe needs most.
- Walking and running swing the hips and drop them on the stepping side, with the shoulders counter-rotating.
- A* pathfinding that climbs terraces and prefers worn paths.
- Couples in Homes have children, who grow up after a few days. Islanders have Nahuatl-style names.

**Buildings**
- Hut, Home, Temple (three tiers up to the Great Pyramid), Farm, Butcher, Wood Store, Grain Store, War Room and Jetty.
- Ghost preview, then foundation, scaffolding and finished building.
- Stores fill visibly and crops grow.

**Economy and powers**
- Resources: wood, stone, grain, fruit, meat, fish and Belief.
- God powers: sculpt, bless crops, summon rain and calm storms.
- Random rain and storms, seasons and years, and milestone notifications.

**Wildlife** (data-driven species configs in `config.ts`)
- Livestock and game, each with colour variants, groups, habitat and its own avoidance (comfortable → alert → move away → flee):
  - Chickens (hens, speckled hens, roosters) peck, scratch and make short runs around the settlement.
  - Pigs root about in groups of 2–5 at the jungle edge; goats graze calmly at the settlement edges and on hills; tapirs keep to the jungle alone or as a parent and young, and are wary and hard to catch.
- Animals are never taken automatically. The player chooses one: an islander chases it (it tires), catches it, then leads pigs and goats on a leash to a Butcher or Farm pen, carries chickens to a pen (or straight to the store), or brings a hunted tapir home as meat. Butchers only use penned animals.
- Spider monkeys live in the canopy in troops of 2–5: they sit, walk along branches, climb, hang and swing by their arms with their tails up, eat and watch passers-by, and leap only between trees within reach.
- Toucans perch, look about, hop and fly curved paths between trees. Gulls fly in boids flocks of 3–8 and land on rocks and beaches; the pointer makes them notice, bank away, then scatter with staggered reactions before regrouping. Panning or pinching the camera never disturbs wildlife.
- Crabs scuttle sideways on the beaches and burrow when startled; stingrays glide over the shallow seabed with soft shadows.
- Coral reefs in the shallows: branching staghorn, brain and table corals, swaying sea fans, tube sponges and soft corals in bright colours, with reef fish schooling over them (boats steer around the reefs).
- Decorative reef fish (six varieties) school around reefs, rocks and the lagoon. Big swirling schools in deep water are what the fishing boats track down, and over-fished stocks regrow slowly.
- Population limits per species, habitat-aware spawning and respawning, lower update rates far from the camera, and animals (including penned livestock) are saved with the island.

**Whales and dolphins**
- Smooth-shaded humpbacks (dark slate backs, white pleated throats and bellies, knobbly heads, long white flippers, serrated flukes) glide underwater with a travelling body wave, leaving faint fluke prints on the surface, and never touch the seabed. They breach every so often in deep water (or when tapped), following a reference clip:
  - An underwater glow as it rises, then a near-vertical lift out of the water while it spins, fins spread, with a foam ring at the waterline.
  - It topples onto its back into a huge splash: a crown of water tongues, fine spray and clumps, white-water mist drifting downwind, and lacy foam that spreads and fades. Then the fluke lifts, streaming water, as it dives.
- Dolphin pods porpoise through open water in staggered leaping arcs, with the odd spinning jump, splashes and ripples.
- Swimming whales flex along the whole body, with flippers swept back along the flanks and a supple fluke.

**Boats**
- The Jetty builds canoes and fishing boats, crewed by fishers.
- Boats sail a water A* route around rocks and reefs, then fish for five minutes, casting the net again and again as they follow the school, before carrying the catch home. They ride on the water, bobbing and rocking with the swell, and leave a wake.

**Audio**
- Procedural Web Audio: waves, wind, insects, bird calls, and a positional waterfall roar.
- Generative drum-and-flute music and synthesised effects, with mute and volume controls.

**Everything else**
- Autosaves to localStorage every minute and when the tab is hidden. "New Island" and shareable seed links.
- High, Medium and Low graphics presets, with an automatic step-down if the frame rate is low. Phones default to Low.
- Settings toggles for shadows, the day/night cycle (off keeps warm afternoon light), random weather, and a pixel-art style (low-resolution rendering with a dithered palette).
- Minimap, pause and 1×/2×/3× speed, settings, a help overlay and a 5-step tutorial.

## Project structure

```
src/
  config.ts          every tuning value (costs, speeds, colours, presets, lighting keyframes)
  main.ts            boot, seed from the URL
  Game.ts            owns the renderer and systems, main loop, tools and input routing
  world/             seeded RNG, simplex noise, world grid, island generator, spatial hash, time, save/load
  terrain/           stepped terrain mesh and shader, sculpting
  water/             ocean/river/pool shader, waterfall and mist
  vegetation/        plant models and the instanced vegetation system
  entities/          islander data and instanced rig, wildlife, boats
  ai/                A* pathfinder, colony AI (needs, jobs, housing, births)
  buildings/         building models and the building system
  economy/           resources, god powers and weather
  render/            lighting and day/night, post-processing, camera rig, shared materials, geometry builder
  ui/                HUD, toolbar, menus, minimap, tutorial, input, icons, styles
  audio/             procedural Web Audio engine
```

All tuning values live in `src/config.ts`.

## Credits

- [three.js](https://threejs.org) (MIT) for rendering and post-processing.
- Built with [Vite](https://vite.dev) and TypeScript.
- The splash art was supplied by the project owner. Every model, texture, piece of music and sound effect is generated procedurally at runtime.

## Known limitations

- Warriors patrol and scare animals, but there are no enemies to fight yet.
- Islanders walk through each other; there is no crowd avoidance.
- Boats path over sea cells, not rivers or the waterfall pool.
- The waterfall is placed on the largest drop of the first river, so some seeds get only a modest waterfall.
- Saves are per browser (localStorage) and keep one island at a time.
- Tested in desktop Chromium. Safari, Firefox and real phones have not been tested on hardware.

## Ideas for phase 2

- Shared online world: multiplayer tribes on one island via WebSockets, with an authoritative server and delta sync of terrain edits and buildings.
- A rival AI tribe that expands, trades and raids, giving warriors a purpose.
- Weather events: tropical storms that damage buildings, droughts and floods on the rivers.
- A volcano on the highlands: rumbles, ash, lava flows that reshape the terrain, and fertile soil afterwards.
- Trade canoes between islets, more building upgrades, festivals and seasonal events.
