# Aztlan Isle

A calm, tactile, browser-based god game inspired by the feel of Godus. Guide an Aztec tribe as they settle a lush tropical island: sculpt the stepped terrain, raise huts, homes and temples, farm maize, fish the turquoise shallows and work towards the Great Pyramid.

The whole thing is rendered as a tilt-shift miniature diorama at golden hour. Every model, texture and sound is generated in code; the only external asset is the splash art.

**Play:** https://ryanmullenuk.github.io/aztec/ (after GitHub Pages is enabled, see [Deploy](#deploy))

Everyone plays the same hand-designed island; share the link to invite friends.

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
- One hand-designed island, laid out like a tropical atoll: a multi-lobed main island with bays and peninsulas, wide sandy beaches, rocky headlands and knolls, large open grasslands between jungle, and 5–8 rocky wooded islets.
- A tall mountain massif with jagged peaks, green lower slopes, rocky crags and clouds drifting around the summits.
- Rivers spring high in the mountains; a waterfall drops off a cliff into a turquoise pool with mist, and there's a lagoon. Hills and mountains are smooth slopes, while the lowlands keep gentle flat terraces for building.
- A wide turquoise reef shelf around the island, with seagrass meadows, dark reef rock, seaweed beds and 18–26 coral reefs, dropping off into deep navy sea.
- Godus-style stepped contour terrain with rounded, curving terraces. Sculpt it one layer at a time, paying Belief.
- Paths wear into the grass where islanders walk often, and farms till the soil.

**Look**
- Tilt-shift golden-hour diorama:
  - Depth-based bokeh DOF focused on the centre of the screen, with the strongest blur in the foreground; the focus band narrows as you zoom in.
  - GTAO, subtle bloom, warm/teal colour grading, vignette and SMAA/FXAA.
- ACES tone mapping; a low golden sun with long soft shadows fitted to the view; a cool sky bounce light.
- Sunlight glows through fronds, with warm rim light on treetops and roofs, and contact shadows under objects.
- Ocean shader: long swells whose crests bend and drift in slowly moving wave groups, under gradient-noise wind ripples stretched along their crests (no grid or repeating pattern at any zoom). It adds Fresnel sky reflection with soft drifting clouds mirrored in it, and sun or moon glitter from a rough sea: waves too small to draw widen it into a soft path far off and break it into twinkling glints close up. There are whitecap flecks in storms, caustics on the seabed and shoreline and rock foam. Surf rolls in broken stretches rather than lines tracing the coast.
- The sea's colour follows its real depth: turquoise shallows with meandering reef edges, deepening gradually to navy far from land, with no ring round the islands. Toward the map's edge the sea floor falls away along a rounded line that follows the coasts (the outer islets drop off like a reef wall), and the ocean floor beyond is lit like the island's own deep seabed, so the map's square edge never shows.
- A 10-minute day/night cycle where golden hour lasts longest; the light hands over smoothly to a bright silvery moon with a glitter path on the sea, and village torches light up with real point lights.
- The sun and moon show in the sky wherever the view looks up far enough (free-roam, or a low tilt). The sun is a bright disc in a warm glow that turns orange, swells and sinks into the sea as it sets. At night a pale full moon rides high in a cool halo. Both fade behind storm cloud.
- On a clear night the sky fills with stars (brighter ones tinted blue-white or amber, twinkling) and the Milky Way arches across it, a soft band with a brighter core and dark dust lanes. They fade out at dawn and behind cloud.

**Vegetation**
- A tree catalogue: palms (straight, leaning, curved), eight broadleaf varieties (round, tall and narrow, spreading, jungle giants, vine-hung, pink blossom) and orange fruit trees, plus ferns, flowering bushes, apple bushes and banana trees, all with a wind-sway shader.
- Biome weighting and clustering noise: palms on beaches, mixed coast, open grassland with small groves, dense mixed jungle, hardy trees on hills and larger trees along rivers. Nothing grows on buildings, paths or steep slopes.
- Swaying grass clumps over the meadows, hidden automatically under buildings, fields and worn paths.
- Zoomed in, trees standing between the camera and what you're looking at turn semi-transparent; zoomed out they are fully solid.
- Chunked for frustum culling, with LOD for distant chunks. Only visible instances are drawn.
- Chopped trees leave stumps that regrow as saplings. Fruit grows back; rocks give stone.

**Islanders**
- Simple faceted low-poly islanders (white wrap cloth, red belt and front panel, red wristbands, brown boots, black bob or braided hair), articulated at the hips, back, shoulders, elbows and knees so they bend properly when building, hoeing or gathering:
  - Men: a white wrap over one shoulder with a coloured stripe, and a knee-length white skirt.
  - Women: a white top with a coloured trim, a longer white skirt with red and coloured hem bands, and a long braid.
  - Priests wear a feather fan headdress; warriors wear jaguar or eagle helms and carry an obsidian spear.
  - Per-person skin tones and trim colours.
- Procedural animations: walk, run, carry, chop, mine, farm, harvest, fish, build, pray, eat, idle and sleep.
- Needs (hunger, rest, happiness), a utility AI and automatic job assignment with player overrides.
- Islanders decide for themselves when their own job has nothing to do: they pick fruit, spear fish from the shore, cut wood or quarry stone, whichever the tribe needs most.
- Walking and running swing the hips and drop them on the stepping side, with the shoulders counter-rotating.
- A* pathfinding that climbs terraces and prefers worn paths.
- A couple in any hut or home may have one child (one per house); children play around the village and never work. Up to 100 adults live on the island. About one adult in five has the elder look (grey hair; white hair and beard on the men); nobody ages. Islanders have Nahuatl-style names.

**Buildings**
- Hut, Home, Temple (three tiers up to the Great Pyramid), Farm, Butcher, Wood Store, Grain Store, War Room and Jetty.
- Adobe houses in five levels: the Hut (level 1, 2 people) and the Home, upgraded in place from level 2 to 5 (4, 7, 12, then 16 people), growing from a small cube with a thatched awning to a many-storey compound with stairs, courtyards, striped awnings and a rooftop pergola.
- Ghost preview, then foundation, scaffolding and finished building.
- Stores fill visibly and crops grow.
- Healing Centre: a walled sandstone courtyard with four beds, a main hall behind a long striped awning and two small side rooms, reached by wide red-and-sandstone steps between flower planters.
- Watchtower: a tall timber lookout on a stone footing, with a wattle parapet, a ladder, a red and gold banner and a torch burning on top at night.

**Health**
- Now and then someone falls sick (adults and children alike), and jaguars and alligators maul people. The sick and the mauled stop working and walk to the nearest Healing Centre, where they lie on a bed (or are cared for indoors when the beds are full); with no Healing Centre they rest at home.
- Untreated, they die after an hour of game time, with a warning ten minutes before. The Healing Centre's card lists its patients, how long each has left and a Cure button: 50 food for sickness, 100 for a mauling. Cured islanders get up and go back to work. Tuning lives in `HEALTH` in `config.ts`.
- In god mode (the island named GODMODE) nobody dies and curing is free.

**Defence**
- Jaguars keep dens deep in the jungle and stalk the village now and then; alligators lie in wait in the swamps. Dogs and warriors drive jaguars off.
- A Watchtower keeps one villager on watch as an archer, day and night. The archer turns to face the nearest jaguar or alligator within range, draws and looses an arrow on a real arc, leading a moving target. Most arrows fly true: a wounded beast flees, and a few hits kill it. Misses stick quivering in the ground. The tower's card shows who is on watch, the arrows loosed and the predators brought down.
- The predators never die out: a new jaguar swims over from beyond the edge of the map to take a dead one's den, and a new alligator turns up in the swamps a few minutes later. Tuning lives in `DEFENCE` in `config.ts`.

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

**Whales, dolphins and jellyfish**
- Humpbacks are one skinned mesh on a 19-joint skeleton: a flexible spine, flukes whose lobes flex, and shoulder-elbow-wrist flippers.
  - The body is lofted with grooved throat pleats, a flat knobbly rostrum, a barnacled chin, an eye and lip line, a hump with its dorsal fin and knuckles along the tail stock.
  - The flippers are long and tapered with a knobbly leading edge; the flukes are swept, notched and scalloped, black above and patterned white below.
- They glide underwater with a travelling body wave and never touch the seabed. Turns curve the whole body, head first with the tail following, and the flippers steer. They come up to blow, and dive with the flukes lifting and streaming water.
- Every so often in deep water (or when tapped) one comes right up for air, never leaving the water entirely:
  - An underwater glow as it rises, then its head bursts through, heaving up a mound of water that pours off it. It blows a tall, bushy plume of mist with the head and the front of its back clear.
  - The back and dorsal fin roll up through the surface with water sheeting off, then it dives with the flukes lifting and streaming, leaving a smooth footprint.
  - The sea moves all round it: a white collar and bow wave where it meets the water, and rings of waves spreading out across the surface (quiet breaths stir the water too).
- Smooth, flexible dolphins (beak, swept dorsal fin, dark cape and white belly) swim in pods of six that leap together in a rippling line, arching through the air, with the odd high spinning jump, splashes and ripples.
- Swarms of pink moon jellies drift in the shallows off the beaches. Their bells pulse (rising on each squeeze), with four gonads showing through, and frilly arms and fine tentacles ripple and trail behind them. They scatter from the pointer, pulsing hard and diving away, then drift back, and they glow pink at night.

**Boats**
- The Jetty builds canoes and fishing boats, crewed by fishers.
- Boats sail a water A* route around rocks, reefs, piers, rope bridges and anything built in the water, then fish for five minutes, casting the net again and again as they follow the school, before carrying the catch home. Each boat picks a school no other boat is working when one is near enough; boats sharing a school hold stations spread round it.
- All boats ride the swell (bobbing, pitching and rolling with the water), leave a soft wake that grows with speed, and spread ripple rings while they lie still fishing. They keep clear of each other, giving way and slowing when close, and moor side by side, turning round off the pier and backing in.
- Trade Dock boats sail out over the horizon with goods and return with others. Now and then (every 20 to 40 minutes) foreign traders in blue-and-gold sailed boats call at a finished Trade Dock with one to three bargains, accepted from the dock's card, and sail home after a few minutes.

**Audio**
- Procedural Web Audio: waves, wind, insects, bird calls, and a positional waterfall roar.
- Generative drum-and-flute music and synthesised effects, with mute and volume controls.

**Everything else**
- Autosaves to localStorage every minute and when the tab is hidden. "Restart island" to start again.
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
- Saves are per browser (localStorage) and keep one island at a time.
- Tested in desktop Chromium. Safari, Firefox and real phones have not been tested on hardware.

## Ideas for phase 2

- Shared online world: multiplayer tribes on one island via WebSockets, with an authoritative server and delta sync of terrain edits and buildings.
- A rival AI tribe that expands, trades and raids, giving warriors a purpose.
- Weather events: tropical storms that damage buildings, droughts and floods on the rivers.
- A volcano on the highlands: rumbles, ash, lava flows that reshape the terrain, and fertile soil afterwards.
- Trade canoes between islets, more building upgrades, festivals and seasonal events.

### Share a saved island

In Settings, **Copy Island** creates a `.aztlan.json` snapshot of the current build,
terrain, islanders, resources and saved progress. It opens the device's share sheet
where file sharing is supported, otherwise downloads the file. Send that file to
another player; they can open Settings → **Load Island** and select it. Loading
asks before replacing their current island. Export the current island first to
keep a backup. Copies progress independently; this is not a live multiplayer link.
Files must come from a compatible version of the game and island layout.

Save-file checks: `npx tsx --test tests/island-file.test.ts`.
