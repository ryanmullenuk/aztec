import { DOGS, FAUNA, PATHS, BUILDINGS, BuildingKey, CAMERA, JETTY, MILESTONES, PresetName, SAVE, SPECIES, WARRIOR, FARM_TYPES, SMOKE, TRADE, TradeOffer, ResourceKey } from '../config';
import { MONKEY_BASE } from '../entities/Monkeys';
import { DOG_BASE } from '../entities/Dogs';
import { JAG_BASE } from '../entities/Jaguars';
import type { Game } from '../Game';
import { Building } from '../buildings/Buildings';
import { ROLE_LABEL } from '../entities/Islander';
import { randomIslandName } from '../world/names';
import { Ground } from '../world/World';
import { ICONS, icon } from './icons';
import { BUILD_MENU, PAINT_TOOLS, TOOLS, ToolId } from './tools';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);

const BUILD_ICON: Record<BuildingKey, string> = {
  campfire: 'belief', hut: 'b_hut', home: 'b_home', temple: 'b_temple', farm: 'b_farm', butcher: 'b_butcher',
  woodstore: 'b_woodstore', grainstore: 'b_grainstore', warroom: 'b_warroom', jetty: 'b_jetty',
  maizefarm: 'b_maize', chinampa: 'b_chinampa', smokehouse: 'b_smoke',
  tradedock: 'b_trade', torch: 'b_torch', bonfire: 'b_bonfire', firepit: 'b_firepit', well: 'b_well', kennel: 'b_kennel',
};

interface TutorialStep {
  title: string;
  text: string;
  done: (g: Game) => boolean;
}

/** The whole HTML overlay: HUD, toolbar, menus, info panels, minimap, modals, tutorial and toasts. */
export class UI {
  private root = document.getElementById('hud')!;
  private tl!: HTMLDivElement;
  private resEls: Record<string, HTMLSpanElement> = {};
  private timeEl!: HTMLDivElement;
  private dateEl!: HTMLDivElement;
  private sunIcon!: HTMLSpanElement;
  private beliefFill!: HTMLDivElement;
  private beliefText!: HTMLSpanElement;
  private toolbar!: HTMLDivElement;
  private slots: HTMLButtonElement[] = [];
  private buildMenu!: HTMLDivElement;
  private info!: HTMLDivElement;
  private toasts!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private tooltip!: HTMLDivElement;
  private speedBtns: HTMLButtonElement[] = [];
  private pauseBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private settings!: HTMLDivElement;
  private help!: HTMLDivElement;
  private tutorial!: HTMLDivElement;
  private minimap!: HTMLCanvasElement;
  private miniBase: ImageData | null = null;
  private miniVersion = -1;
  private timer = 0;
  private miniTimer = 0;
  private tutStep = 0;
  private tutStart = { x: 0, z: 0, dist: 0 };
  private infoKey = '';
  private buildItems = new Map<BuildingKey, HTMLButtonElement>();
  private tutSteps: TutorialStep[] = [
    { title: 'Found your village', text: 'Your first two villagers have come ashore. Choose open, flat land for the campfire: your village will grow around it. (Tap Place campfire if you closed the placement.)', done: (g) => g.buildings.hasCampfire },
    { title: 'Look around', text: 'Drag with the mouse (or one finger) to pan the island. WASD and arrow keys work too. Rotate with Q/E, middle-drag, or by dragging the compass at the bottom right.', done: (g) => Math.hypot(g.rig.cur.x - this.tutStart.x, g.rig.cur.z - this.tutStart.z) > 8 || Math.abs(g.rig.cur.yaw - g.rig.goal.yaw) > 0.3 },
    { title: 'Zoom in', text: 'Scroll (or pinch) to zoom in close to your islanders, and out to see the whole island.', done: (g) => Math.abs(g.rig.cur.dist - this.tutStart.dist) > 15 },
    { title: 'Meet your villagers', text: 'Tap an islander near the campfire to see their name, job and needs. More settlers arrive by canoe when you have spare beds and food.', done: (g) => g.selectedIslander >= 0 },
    { title: 'Build a Hut', text: 'Press Build (2), choose a Hut and place it on flat land. Your builders will do the rest.', done: (g) => g.buildings.list.some((b) => b.key === 'hut' || b.key === 'home') },
    { title: 'Shape the land', text: 'Use Raise (3) or Lower (4): hold and drag to sculpt terraces flat for bigger buildings. Sculpting costs Belief.', done: (g) => g.stats.sculpted > 0 },
  ];

  constructor(private game: Game) {
    this.buildTopLeft();
    this.buildTopRight();
    this.buildBottom();
    this.buildMenuPanel();
    this.info = el('div', 'panel info hidden');
    this.root.appendChild(this.info);
    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);
    this.tooltip = el('div', 'tooltip hidden');
    this.root.appendChild(this.tooltip);
    this.buildMinimap();
    this.buildRotate();
    this.buildSettings();
    this.buildHelp();
    this.buildTutorial();
    this.updateIslandName();
    this.refresh(true);
  }

  // ---------------- Construction ----------------

  private nameInput?: HTMLInputElement;
  private isleNameEl!: HTMLDivElement;

  /** Show the island's name on the HUD (and in the settings field). */
  updateIslandName(): void {
    const n = this.game.islandName;
    this.isleNameEl.textContent = n.toUpperCase() === 'GODMODE' ? '' : n;
    this.isleNameEl.classList.toggle('hidden', !this.isleNameEl.textContent);
    if (this.nameInput && document.activeElement !== this.nameInput) this.nameInput.value = n;
  }

  private buildTopLeft(): void {
    this.tl = el('div', 'panel tl');
    this.isleNameEl = el('div', 'islename') as HTMLDivElement;
    this.tl.appendChild(this.isleNameEl);
    const clock = el('div', 'clock');
    this.sunIcon = el('span', 'sunicon', ICONS.sun);
    this.timeEl = el('div', 'time');
    this.dateEl = el('div', 'date');
    const tx = el('div', 'clocktext');
    tx.append(this.timeEl, this.dateEl);
    clock.append(this.sunIcon, tx);
    this.tl.appendChild(clock);
    const grid = el('div', 'resgrid');
    for (const k of ['people', 'wood', 'stone', 'grain', 'fruit', 'meat', 'fish']) {
      const r = el('div', 'res', icon(k));
      r.title = k === 'people' ? 'Islanders (housed / total)' : k[0].toUpperCase() + k.slice(1);
      const v = el('span', 'v');
      r.appendChild(v);
      this.resEls[k] = v;
      grid.appendChild(r);
    }
    this.tl.appendChild(grid);
    this.root.appendChild(this.tl);
  }

  private buildTopRight(): void {
    const tr = el('div', 'panel tr');
    this.pauseBtn = el('button', 'ib', ICONS.pause);
    this.pauseBtn.title = 'Pause (Space)';
    this.pauseBtn.onclick = () => this.game.togglePause();
    tr.appendChild(this.pauseBtn);
    for (const s of [1, 2, 3]) {
      const b = el('button', 'ib sp', `${s}×`);
      b.title = `Speed ${s}×`;
      b.onclick = () => this.game.setSpeed(s);
      this.speedBtns.push(b);
      tr.appendChild(b);
    }
    this.muteBtn = el('button', 'ib', ICONS.sound);
    this.muteBtn.title = 'Mute (M)';
    this.muteBtn.onclick = () => this.game.toggleMute();
    const help = el('button', 'ib', ICONS.help);
    help.title = 'Help (H)';
    help.onclick = () => this.toggle(this.help);
    const gear = el('button', 'ib', ICONS.gear);
    gear.title = 'Settings';
    gear.onclick = () => this.toggle(this.settings);
    const over = el('button', 'ib', ICONS.island);
    over.title = 'See the whole map from above (O) · again to go back';
    over.onclick = () => this.game.rig.toggleOverview();
    tr.append(over, this.muteBtn, help, gear);
    this.root.appendChild(tr);
  }

  private buildBottom(): void {
    const bottom = el('div', 'bottom');
    this.hint = el('div', 'hint hidden');
    // Shown until the village is founded, in case the campfire placement is closed.
    this.foundBtn = el('button', 'btn found-btn hidden', `${ICONS.belief} Place campfire`) as HTMLButtonElement;
    this.foundBtn.onclick = () => this.game.promptCampfire();
    bottom.appendChild(this.foundBtn);
    const bb = el('div', 'beliefbar');
    bb.title = 'Belief: earned from happy islanders and temples, spent on god powers';
    bb.innerHTML = `<span class="bicon">${ICONS.belief}</span>`;
    const track = el('div', 'track');
    this.beliefFill = el('div', 'fill');
    track.appendChild(this.beliefFill);
    this.beliefText = el('span', 'btext');
    bb.append(track, this.beliefText);
    this.toolbar = el('div', 'toolbar');
    TOOLS.forEach((t, i) => {
      const b = el('button', 'slot', `<span class="key">${i + 1}</span>${icon(t.icon)}<span class="nm">${t.name}</span>${t.cost ? `<span class="cost">${icon('belief')}${t.cost}</span>` : '<span class="cost"></span>'}`);
      b.onclick = () => this.game.setTool(t.id);
      this.addTip(b, `<b>${t.name}</b> <span class="kbd">${i + 1}</span><br>${t.hint}${t.cost ? `<br><span class="c">${icon('belief')} ${t.cost}${t.id === 'raise' || t.id === 'lower' || t.id === 'flatten' ? ' per cell' : ''}</span>` : ''}`);
      this.slots.push(b);
      this.toolbar.appendChild(b);
    });
    bottom.append(this.hint, bb, this.toolbar);
    this.root.appendChild(bottom);
  }

  private buildMenuPanel(): void {
    this.buildMenu = el('div', 'panel buildmenu hidden');
    const head = el('div', 'bm-head', '<span>Build</span>');
    const x = el('button', 'ib small', ICONS.close);
    x.onclick = () => this.game.setTool('select');
    head.appendChild(x);
    this.buildMenu.appendChild(head);
    const grid = el('div', 'bm-grid');
    for (const key of BUILD_MENU) {
      const def = BUILDINGS[key];
      const cost = [def.cost.wood ? `${icon('wood')}${def.cost.wood}` : '', def.cost.stone ? `${icon('stone')}${def.cost.stone}` : '', def.cost.belief ? `${icon('belief')}${def.cost.belief}` : ''].join('');
      const b = el('button', 'bm-item', `<span class="bm-ic">${ICONS[BUILD_ICON[key]]}</span><span class="bm-nm">${def.name}</span><span class="bm-cost">${cost}</span>`);
      b.onclick = () => this.game.startPlacing(key);
      this.addTip(b, `<b>${def.name}</b><br>${def.description}<br><span class="c">${cost || 'Free'} · ${def.size[0]}×${def.size[1]}</span>`);
      grid.appendChild(b);
      this.buildItems.set(key, b);
    }
    // Paths: drag-to-paint tools rather than a building.
    const pathItem = (id: 'path' | 'dirtpath' | 'unpath' | 'bridge' | 'canal', name: string, iconKey: string, cost: string, tip: string) => {
      const b = el('button', 'bm-item', `<span class="bm-ic">${ICONS[iconKey]}</span><span class="bm-nm">${name}</span><span class="bm-cost">${cost}</span>`);
      b.onclick = () => this.game.setTool(id);
      this.addTip(b, tip);
      grid.appendChild(b);
    };
    pathItem('path', 'Stone path', 'b_path', `${icon('stone')}${PATHS.stonePerCell}`, `<b>Stone path</b><br>Hold and drag to lay a paved path. Islanders prefer paths and walk faster on them.<br><span class="c">${icon('stone')} ${PATHS.stonePerCell} per cell</span>`);
    pathItem('dirtpath', 'Dirt path', 'b_dirtpath', 'Free', '<b>Dirt path</b><br>Hold and drag to tread a simple earth track. Free, and islanders walk a little faster on it (a stone path is faster). Lay stone over it later to pave it.');
    pathItem('canal', 'Water canal', 'b_canal', `${icon('wood')}${PATHS.canalWood}`, `<b>Water canal</b><br>Hold and drag outward from a river, pool or the sea to dig a channel and bring water into the village. Chinampas can be built beside canals.<br><span class="c">${icon('wood')} ${PATHS.canalWood} per section</span>`);
    pathItem('bridge', 'Rope bridge', 'b_bridge', `${icon('wood')}${PATHS.bridgeWood}`, `<b>Rope bridge</b><br>Hold and drag from the shore across shallow water, like the strait to the wild island, to build a plank bridge islanders can cross.<br><span class="c">${icon('wood')} ${PATHS.bridgeWood} per section</span>`);
    pathItem('unpath', 'Remove path', 'b_unpath', '', '<b>Remove path, bridge or canal</b><br>Hold and drag over a path, bridge or canal to take it away (canals are filled back in).');
    this.buildMenu.appendChild(grid);
    this.root.appendChild(this.buildMenu);
  }

  private buildMinimap(): void {
    const wrap = el('div', 'panel minimap');
    this.minimap = el('canvas');
    this.minimap.width = this.minimap.height = 168;
    wrap.appendChild(this.minimap);
    const go = (e: PointerEvent) => {
      const r = this.minimap.getBoundingClientRect();
      const w = this.game.world;
      const x = ((e.clientX - r.left) / r.width) * w.N - w.half;
      const z = ((e.clientY - r.top) / r.height) * w.N - w.half;
      this.game.rig.goal.x = x;
      this.game.rig.goal.z = z;
      this.game.followId = -1;
    };
    this.minimap.addEventListener('pointerdown', (e) => {
      go(e);
      const mv = (ev: PointerEvent) => go(ev);
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
    this.root.appendChild(wrap);
  }

  private compassNeedle!: HTMLSpanElement;

  /** Rotate control: hold the arrows, or drag the compass left/right (mouse or finger). Double-tap resets. */
  private buildRotate(): void {
    const wrap = el('div', 'panel rotate');
    const left = el('button', 'ib rot', ICONS.rotL);
    const right = el('button', 'ib rot', ICONS.rotR);
    left.title = 'Rotate left (Q). Hold to keep turning';
    right.title = 'Rotate right (E). Hold to keep turning';
    const dial = el('button', 'ib dial');
    dial.title = 'Drag to rotate the view · double-click to reset';
    this.compassNeedle = el('span', 'needle', ICONS.compass);
    dial.appendChild(this.compassNeedle);
    wrap.append(left, dial, right);
    const hold = (btn: HTMLButtonElement, dir: number) => {
      const stop = () => {
        this.game.rotateHold = 0;
        btn.classList.remove('on');
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* optional */
        }
        this.game.rotateHold = dir;
        btn.classList.add('on');
      });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('lostpointercapture', stop);
    };
    hold(left, 1);
    hold(right, -1);
    let lastX = 0, dragging = false, lastTap = 0;
    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        dial.setPointerCapture(e.pointerId);
      } catch {
        /* optional */
      }
      dragging = true;
      lastX = e.clientX;
      const now = performance.now();
      if (now - lastTap < 320) this.game.resetRotation();
      lastTap = now;
    });
    dial.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.game.rig.rotate(-(e.clientX - lastX) * CAMERA.dragRotateSpeed * 1.4);
      lastX = e.clientX;
    });
    const end = () => (dragging = false);
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
    this.root.appendChild(wrap);
  }

  private buildSettings(): void {
    this.settings = el('div', 'modal hidden');
    const s = this.game.settings;
    const card = el('div', 'panel card');
    card.innerHTML = `
      <div class="card-head"><span>Settings</span></div>
      <div class="row namerow">Island name
        <span class="nameedit"><input type="text" maxlength="32" spellcheck="false" autocomplete="off" data-n="name" aria-label="Island name"><button class="btn small" data-a="rename" title="Pick a random name">${ICONS.seed} Random</button></span>
      </div>
      <label class="row">Graphics
        <select data-k="preset">
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low (phones)</option>
        </select>
      </label>
      <label class="row">Shadows <input type="checkbox" data-k="shadows"></label>
      <label class="row">Day and night cycle <input type="checkbox" data-k="dayNight"></label>
      <label class="row">Weather (rain and storms) <input type="checkbox" data-k="weather"></label>
      <label class="row">Pixel style <input type="checkbox" data-k="pixel"></label>
      <label class="row">Tilt-shift depth of field <input type="checkbox" data-k="dof"></label>
      <label class="row">Blur strength <input type="range" min="0" max="2" step="0.05" data-k="dofStrength"></label>
      <label class="row">Volume <input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
      <label class="row">Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
      <label class="row">Show FPS <input type="checkbox" data-k="fps"></label>
      <div class="row seedrow">Share the game
        <button class="btn small" data-a="copy">${ICONS.link} Copy link</button>
      </div>
      <div class="row btns">
        <button class="btn" data-a="new">${ICONS.island} Restart island</button>
        <button class="btn" data-a="save">Save now</button>
        <button class="btn" data-a="tutorial">Restart tutorial</button>
      </div>
      <p class="muted small">Progress autosaves every minute in this browser. Share the link to let friends play the same island.</p>`;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => this.toggle(this.settings, false);
    card.querySelector('.card-head')!.appendChild(close);
    const sel = card.querySelector('select') as HTMLSelectElement;
    sel.value = s.preset;
    sel.onchange = () => {
      s.preset = sel.value as PresetName;
      s.autoQuality = false;
      this.game.applySettings();
    };
    this.presetSelect = sel;
    // Island name: typed, or rolled from Nahuatl place-name roots.
    const nameIn = card.querySelector<HTMLInputElement>('[data-n="name"]')!;
    nameIn.value = this.game.islandName;
    const applyName = (v: string) => {
      const r = this.game.setIslandName(v);
      if (r.god && r.changed) this.toast('The gods smile upon this island.');
      this.updateIslandName();
    };
    nameIn.onchange = () => applyName(nameIn.value);
    nameIn.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') nameIn.blur();
    };
    card.querySelector<HTMLButtonElement>('[data-a="rename"]')!.onclick = () => {
      nameIn.value = randomIslandName();
      applyName(nameIn.value);
    };
    this.nameInput = nameIn;
    card.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      const k = inp.dataset.k as keyof typeof s;
      if (inp.type === 'checkbox') inp.checked = !!s[k];
      else inp.value = String(s[k]);
      inp.oninput = () => {
        (s as unknown as Record<string, unknown>)[k] = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
        this.game.applySettings();
      };
    });
    card.querySelector<HTMLButtonElement>('[data-a="new"]')!.onclick = () => {
      if (confirm('Start again from the beginning? Your progress on this island will be lost.')) this.game.newIsland();
    };
    card.querySelector<HTMLButtonElement>('[data-a="save"]')!.onclick = () => {
      this.game.save();
      this.toast('Island saved.');
    };
    card.querySelector<HTMLButtonElement>('[data-a="copy"]')!.onclick = async () => {
      const url = `${location.origin}${location.pathname}`;
      try {
        await navigator.clipboard.writeText(url);
        this.toast('Link copied. Share it to play this island.');
      } catch {
        prompt('Copy this link:', url);
      }
    };
    card.querySelector<HTMLButtonElement>('[data-a="tutorial"]')!.onclick = () => {
      this.toggle(this.settings, false);
      this.startTutorial(true);
    };
    this.settings.appendChild(card);
    this.settings.onclick = (e) => {
      if (e.target === this.settings) this.toggle(this.settings, false);
    };
    this.root.appendChild(this.settings);
  }

  private buildHelp(): void {
    this.help = el('div', 'modal hidden');
    const card = el('div', 'panel card help');
    card.innerHTML = `
      <div class="card-head"><span>How to play</span></div>
      <p>Guide your Aztec tribe as they settle the island. Keep them fed, housed and happy: happy islanders and temples create <b>Belief</b>, which pays for your god powers.</p>
      <div class="cols">
        <div><h4>Desktop</h4><ul>
          <li><b>Drag</b> (left or right) or <b>WASD</b>: pan</li>
          <li><b>Scroll</b>: zoom · <b>Q / E</b>, <b>middle-drag</b> or <b>Alt/Shift + drag</b>: rotate</li>
          <li>Or drag the <b>compass</b> (bottom right), or hold its arrows</li>
          <li><b>Click</b>: select or place · <b>R</b>: rotate a building</li>
          <li><b>Hold and drag</b> with Raise/Lower: sculpt</li>
          <li><b>1–9</b>: toolbar · <b>Space</b>: pause · <b>Esc</b>: cancel</li>
        </ul></div>
        <div><h4>Touch</h4><ul>
          <li><b>One finger</b>: pan (or sculpt with a sculpt tool)</li>
          <li><b>Pinch</b>: zoom · <b>Twist</b> with two fingers: rotate</li>
          <li>Drag the <b>compass</b> with one finger, or hold its arrows, to rotate</li>
          <li><b>Tap</b>: select or place</li>
        </ul></div>
      </div>
      <h4>Tips</h4><ul>
        <li>Buildings need flat land. Flatten terraces with the sculpt tools.</li>
        <li>Select an islander, then click a building, tree, rock or fruit bush to give them that job.</li>
        <li>Homes let couples raise children. Temples upgrade twice into the Great Pyramid.</li>
        <li>A Jetty builds fishing boats. Fish stocks regrow slowly, so spread your fishing.</li>
        <li>Across the strait to the east lies a wild island with thick jungle, more fruit and most of the game. Build a <b>Rope bridge</b> (Build menu) across the shallows to reach it.</li>
        <li>New settlers arrive by canoe when you have spare beds and food.</li>
        <li>Birds and fish scatter from your cursor.</li>
        <li>Humpback whales cruise the deep water and breach now and then. Tap one to make it jump.</li>
      </ul>`;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => this.toggle(this.help, false);
    card.querySelector('.card-head')!.appendChild(close);
    this.help.appendChild(card);
    this.help.onclick = (e) => {
      if (e.target === this.help) this.toggle(this.help, false);
    };
    this.root.appendChild(this.help);
  }

  private buildTutorial(): void {
    this.tutorial = el('div', 'panel tutorial hidden');
    this.root.appendChild(this.tutorial);
    let done = false;
    try {
      done = localStorage.getItem(SAVE.tutorialKey) === 'done';
    } catch {
      /* storage unavailable */
    }
    if (!done) setTimeout(() => this.startTutorial(false), 1800);
  }

  startTutorial(force: boolean): void {
    if (force) {
      try {
        localStorage.removeItem(SAVE.tutorialKey);
      } catch {
        /* ignore */
      }
    }
    this.tutStep = 0;
    this.tutStart = { x: this.game.rig.cur.x, z: this.game.rig.cur.z, dist: this.game.rig.cur.dist };
    this.renderTutorial();
    this.tutorial.classList.remove('hidden');
  }

  private renderTutorial(): void {
    const s = this.tutSteps[this.tutStep];
    if (!s) {
      this.tutorial.innerHTML = `<div class="tut-step">Tutorial complete</div><div class="tut-title">The island is yours</div><p>Keep your people fed and housed, build a Temple for Belief, and work towards the Great Pyramid.</p><div class="tut-actions"><button class="btn small" data-a="ok">Let's go</button></div>`;
      this.tutorial.querySelector<HTMLButtonElement>('[data-a="ok"]')!.onclick = () => this.endTutorial();
      return;
    }
    const dots = this.tutSteps.map((_, i) => `<span class="dot ${i < this.tutStep ? 'done' : i === this.tutStep ? 'cur' : ''}"></span>`).join('');
    this.tutorial.innerHTML = `<div class="tut-step">Step ${this.tutStep + 1} of ${this.tutSteps.length} <span class="dots">${dots}</span></div><div class="tut-title">${s.title}</div><p>${s.text}</p><div class="tut-actions"><button class="btn small ghost" data-a="skip">Skip tutorial</button></div>`;
    this.tutorial.querySelector<HTMLButtonElement>('[data-a="skip"]')!.onclick = () => this.endTutorial();
  }

  private endTutorial(): void {
    this.tutorial.classList.add('hidden');
    this.tutStep = 99;
    try {
      localStorage.setItem(SAVE.tutorialKey, 'done');
    } catch {
      /* ignore */
    }
  }

  private presetSelect: HTMLSelectElement | null = null;

  private toggle(m: HTMLElement, show?: boolean): void {
    const on = show ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !on);
    if (on && this.presetSelect) this.presetSelect.value = this.game.settings.preset;
  }

  toggleHelp(): void {
    this.toggle(this.help);
  }

  // ---------------- Trade menu ----------------

  private tradeModal?: HTMLDivElement;
  private tradeDock: Building | null = null;
  private tradeTimer = 0;

  /** The Trade Dock's market: pick a bargain and how many loads to send with a boat. */
  openTrade(dock: Building): void {
    if (!this.tradeModal) {
      this.tradeModal = el('div', 'modal hidden') as HTMLDivElement;
      this.tradeModal.onclick = (e) => {
        if (e.target === this.tradeModal) this.toggle(this.tradeModal!, false);
      };
      this.root.appendChild(this.tradeModal);
    }
    this.tradeDock = dock;
    this.renderTrade();
    this.toggle(this.tradeModal, true);
  }

  private renderTrade(): void {
    const m = this.tradeModal, dock = this.tradeDock;
    if (!m || !dock) return;
    const g = this.game;
    const goods = (r: Partial<Record<ResourceKey, number>>, k = 1) => (Object.entries(r) as [ResourceKey, number][]).map(([key, n]) => `<span class="tg">${icon(key)} ${n * k}</span>`).join(' ');
    const ships = g.trade.of(dock);
    const docked = ships.filter((s) => s.state === 'docked').length;
    const away = ships.filter((s) => s.state !== 'docked');
    const status = !ships.length ? 'No trade boats yet: build one at the dock first.' : `${docked} boat${docked === 1 ? '' : 's'} ready${away.length ? ` · ${away.length} at sea${away.map((s) => (s.state === 'away' ? ` (back in ~${Math.ceil(s.timer + 15)}s)` : s.state === 'back' ? ' (sailing home)' : ' (sailing out)')).join('')}` : ''}`;
    const rows = TRADE.offers.map((o: TradeOffer) => {
      const btn = (k: number) => {
        const ok = g.trade.canTrade(dock, o, k);
        return `<button class="btn small" data-o="${o.id}" data-k="${k}" ${ok.ok ? '' : 'disabled'} title="${ok.reason}">×${k}</button>`;
      };
      return `<div class="trow"><span class="tgive">${goods(o.give)}</span><span class="tarrow">→</span><span class="tget">${goods(o.get)}</span><span class="tbtns">${btn(1)}${btn(3)}</span></div>`;
    }).join('');
    m.innerHTML = `<div class="panel card trade">
      <div class="card-head"><span>${ICONS.boat} Trade Dock market</span></div>
      <p class="muted small">Load a boat with spare goods and send it to trade. It sails over the horizon and returns with what you bargained for.</p>
      <div class="kv"><span>Boats</span><b>${status}</b></div>
      <div class="trows">${rows}</div>
      <p class="muted small">Traders speak of new goods soon: ${TRADE.comingSoon.join(', ')}.</p>
    </div>`;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => this.toggle(m, false);
    m.querySelector('.card-head')!.appendChild(close);
    m.querySelectorAll<HTMLButtonElement>('button[data-o]').forEach((b) => {
      b.onclick = () => {
        const o = TRADE.offers.find((x) => x.id === b.dataset.o)!;
        const msg = g.trade.send(dock, o, parseInt(b.dataset.k ?? '1', 10));
        g.audio?.sfx('click');
        this.toast(msg);
        this.renderTrade();
      };
    });
  }

  closeModals(): boolean {
    let closed = false;
    for (const m of [this.settings, this.help, this.tradeModal].filter(Boolean) as HTMLElement[]) {
      if (!m.classList.contains('hidden')) {
        m.classList.add('hidden');
        closed = true;
      }
    }
    return closed;
  }

  private addTip(target: HTMLElement, html: string): void {
    target.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType !== 'mouse') return;
      this.tooltip.innerHTML = html;
      this.tooltip.classList.remove('hidden');
      const r = target.getBoundingClientRect();
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
      this.tooltip.style.top = `${Math.max(8, r.top - th - 10)}px`;
    });
    target.addEventListener('pointerleave', () => this.tooltip.classList.add('hidden'));
    target.addEventListener('pointerdown', () => this.tooltip.classList.add('hidden'));
  }

  // ---------------- Notifications ----------------

  toast(text: string, kind: 'info' | 'milestone' | 'warn' = 'info'): void {
    const t = el('div', `toast ${kind}`, kind === 'milestone' ? `<span class="tm">${ICONS.bless}</span><span><small>Milestone</small><br>${text}</span>` : text);
    this.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 500);
    }, kind === 'milestone' ? 5200 : 3400);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  setHint(text: string | null): void {
    this.hint.classList.toggle('hidden', !text);
    // Phones: lift the tutorial card clear of the hint above the toolbar.
    this.root.classList.toggle('has-hint', !!text);
    if (text) this.hint.innerHTML = text;
  }

  // ---------------- Per-frame ----------------

  private foundBtn!: HTMLButtonElement;

  update(dt: number): void {
    const g0 = this.game;
    // Keep the open trade menu's boat timers fresh.
    if (this.tradeModal && !this.tradeModal.classList.contains('hidden')) {
      this.tradeTimer -= dt;
      if (this.tradeTimer <= 0) {
        this.tradeTimer = 1;
        if (this.tradeDock && !g0.buildings.byId(this.tradeDock.id)) this.toggle(this.tradeModal, false);
        else this.renderTrade();
      }
    }
    this.foundBtn.classList.toggle('hidden', !(g0.awaitingFire && g0.colony.list.length > 0 && g0.placing !== 'campfire'));
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.refresh(false);
    }
    // Compass needle points to the island's north as the camera turns.
    this.compassNeedle.style.transform = `rotate(${(-this.game.rig.cur.yaw * 180) / Math.PI}deg)`;
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.5;
      this.drawMinimap();
    }
    if (this.tutStep < this.tutSteps.length && !this.tutorial.classList.contains('hidden')) {
      if (this.tutSteps[this.tutStep].done(this.game)) {
        this.tutStep++;
        this.tutStart = { x: this.game.rig.cur.x, z: this.game.rig.cur.z, dist: this.game.rig.cur.dist };
        this.renderTutorial();
      }
    }
  }

  private refresh(force: boolean): void {
    const g = this.game;
    const t = g.time;
    this.timeEl.textContent = g.settings.fps ? `${t.clock} · ${Math.round(g.fpsValue)} fps` : t.clock;
    this.dateEl.textContent = `${t.season} ${t.dayOfSeason} · Year ${t.year}`;
    const h = t.hour;
    const iconName = t.isNight ? 'moon' : h > 16 || h < 7.5 ? 'sunset' : 'sun';
    if (this.sunIcon.dataset.i !== iconName) {
      this.sunIcon.innerHTML = ICONS[iconName];
      this.sunIcon.dataset.i = iconName;
    }
    const e = g.eco;
    const housed = g.colony.list.filter((i) => i.home >= 0).length;
    this.resEls.people.textContent = `${housed}/${g.colony.list.length}`;
    this.resEls.wood.textContent = `${fmt(e.res.wood)}`;
    this.resEls.stone.textContent = `${fmt(e.res.stone)}`;
    for (const k of ['grain', 'fruit', 'meat', 'fish'] as const) this.resEls[k].textContent = fmt(e.res[k]);
    this.resEls.wood.parentElement!.title = `Wood ${Math.floor(e.res.wood)} / ${e.woodCap}`;
    this.resEls.stone.parentElement!.title = `Stone ${Math.floor(e.res.stone)} / ${e.woodCap}`;
    this.resEls.grain.parentElement!.title = `Food ${Math.floor(e.food)} / ${e.foodCap}`;
    this.beliefFill.style.width = `${Math.min(100, (e.res.belief / e.beliefCap) * 100)}%`;
    this.beliefText.textContent = `${Math.floor(e.res.belief)} / ${e.beliefCap}`;
    this.slots.forEach((b, i) => {
      const tool = TOOLS[i];
      b.classList.toggle('on', g.tool === tool.id || (tool.id === 'build' && PAINT_TOOLS.includes(g.tool)));
      b.classList.toggle('dim', !!tool.cost && e.res.belief < tool.cost);
      if (tool.id === 'harvest') b.querySelector('.cost')!.textContent = g.stats.marked ? `${g.stats.marked}` : '';
    });
    this.pauseBtn.innerHTML = t.paused ? ICONS.play : ICONS.pause;
    this.pauseBtn.classList.toggle('on', t.paused);
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', !t.paused && t.speed === i + 1));
    this.muteBtn.innerHTML = g.settings.muted ? ICONS.mute : ICONS.sound;
    this.buildMenu.classList.toggle('hidden', g.tool !== 'build' || !!g.placing);
    if (!this.buildMenu.classList.contains('hidden')) {
      for (const [key, b] of this.buildItems) b.classList.toggle('dim', !e.canAfford(BUILDINGS[key].cost));
    }
    this.renderInfo(force);
  }

  // ---------------- Info panel ----------------

  private bar(label: string, v: number, cls = ''): string {
    return `<div class="need"><span>${label}</span><div class="nb ${cls}"><div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></div></div></div>`;
  }

  private renderInfo(force: boolean): void {
    const g = this.game;
    const isl = g.selectedIslander >= 0 ? g.colony.byId(g.selectedIslander) : undefined;
    const b = g.selectedBuilding >= 0 ? g.buildings.byId(g.selectedBuilding) : undefined;
    const sa = g.selectedAnimal;
    const mk = sa >= MONKEY_BASE && sa < DOG_BASE ? g.wildlife.monkeys.get(sa) : undefined;
    const dog = sa >= DOG_BASE && sa < JAG_BASE ? g.dogs.byId(sa - DOG_BASE) : undefined;
    const jag = sa >= JAG_BASE ? g.jaguars.list.find((j) => j.id === sa - JAG_BASE) : undefined;
    if (sa >= MONKEY_BASE && !mk && !dog && !jag) g.select(null);
    const an = g.selectedAnimal >= 0 && g.selectedAnimal < MONKEY_BASE ? g.wildlife.animals.get(g.selectedAnimal) : undefined;
    if (an && !an.alive) g.select(null);
    if (!isl && !b && !(an && an.alive) && !mk && !dog && !jag) {
      this.info.classList.add('hidden');
      this.infoKey = '';
      return;
    }
    this.info.classList.remove('hidden');
    let html = '';
    let key = '';
    if (isl) {
      const home = isl.home >= 0 ? g.buildings.byId(isl.home) : undefined;
      const role = isl.child ? 'Child' : isl.warrior ? (isl.warrior === 'jaguar' ? 'Jaguar warrior' : 'Eagle warrior') : ROLE_LABEL[isl.role];
      const carry = isl.carry ? `${icon(isl.carry.res === 'wood' ? 'wood' : isl.carry.res)} ${isl.carry.n} ${isl.carry.res}` : 'Nothing';
      key = `i${isl.id}|${Math.ceil(isl.injured / 10)}|${role}|${g.colony.activity(isl)}|${carry}|${home?.id}|${Math.round(isl.hunger * 20)}|${Math.round(isl.rest * 20)}|${Math.round(isl.happy * 20)}|${g.followId === isl.id}`;
      html = `
        <div class="card-head"><span>${isl.name}</span><span class="tag ${isl.gender}">${isl.gender === 'm' ? 'Male' : 'Female'}${isl.child ? ' · child' : ''}</span></div>
        <div class="kv"><span>Job</span><b>${role}${isl.manualRole ? ' <em>(assigned)</em>' : ''}</b></div>
        <div class="kv"><span>Doing</span><b>${g.colony.activity(isl)}</b></div>
        <div class="kv"><span>Carrying</span><b>${carry}</b></div>
        <div class="kv"><span>Home</span><b>${home ? home.label : 'None, sleeps by the fire'}</b></div>
        ${isl.injured > 0 ? `<div class="kv"><span>Health</span><b>Injured by a jaguar, limping (${Math.ceil(isl.injured)}s)</b></div>` : ''}
        ${this.bar('Food', isl.hunger, isl.hunger < 0.3 ? 'low' : '')}
        ${this.bar('Rest', isl.rest, isl.rest < 0.25 ? 'low' : '')}
        ${this.bar('Happiness', isl.happy, isl.happy > 0.6 ? 'good' : '')}
        <div class="actions">
          <button class="btn small" data-a="follow">${ICONS.follow} ${g.followId === isl.id ? 'Stop following' : 'Follow'}</button>
          ${isl.manualRole ? '<button class="btn small" data-a="auto">Auto job</button>' : ''}
        </div>
        ${isl.child ? '' : '<p class="muted small">Tip: click a building, tree, rock or fruit bush to give them that job.</p>'}`;
    } else if (dog) {
      const D = g.dogs;
      const owner = dog.owner >= 0 ? g.colony.byId(dog.owner) : undefined;
      const k = g.buildings.byId(dog.kennel);
      const doing = D.describe(dog);
      const role = k?.dogRole === 'guard' ? 'Guarding the settlement' : 'Free to roam';
      key = `d${dog.id}|${doing}|${owner?.id}|${role}|${Math.round(dog.hunger * 10)}|${Math.ceil(dog.injured / 10)}|${dog.puppy}`;
      html = `
        <div class="card-head"><span>${ICONS.dog} ${dog.name}</span><span class="tag">${dog.puppy ? 'Puppy' : 'Village dog'}</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <div class="kv"><span>Belongs to</span><b>${owner ? `${owner.name}'s household` : k ? 'The kennel' : 'The whole village'}</b></div>
        <div class="kv"><span>Role</span><b>${role}</b></div>
        ${dog.injured > 0 ? `<div class="kv"><span>Health</span><b>Injured, limping (${Math.ceil(dog.injured)}s)</b></div>` : ''}
        ${this.bar('Fed', dog.hunger, dog.hunger < 0.3 ? 'low' : 'good')}
        <p class="muted small">Dogs smell jaguars long before villagers see them, bark the alarm and try to drive them off.</p>`;
    } else if (jag) {
      const doing = g.jaguars.describe(jag);
      key = `j${jag.id}|${doing}`;
      html = `
        <div class="card-head"><span>Jaguar</span><span class="tag">Predator</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">Jaguars live deep in the jungle and sometimes stalk the village, especially at night. Villagers only see one when it's close. Dogs (build a Kennel) and warriors drive them off.</p>`;
    } else if (mk) {
      const M = g.wildlife.monkeys;
      const doing = M.describe(mk);
      const free = M.canHunt(g.selectedAnimal);
      key = `m${mk.id}|${doing}|${free}`;
      html = `
        <div class="card-head"><span>Spider monkey</span><span class="tag">${mk.raid ? 'Pest' : 'Wild'}</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">Monkeys raid food stores by day. Wave the pointer at raiders to scare them back to the trees, keep warriors about, or hunt them for ${FAUNA.monkeyMeat} meat.</p>
        <div class="actions"><button class="btn small" data-a="capture" ${free ? '' : 'disabled'}>${ICONS.harvest} Hunt</button></div>
        <p class="muted small">Tip: select an islander first, then tap a monkey to send them after it.</p>`;
    } else if (an) {
      const d = SPECIES[an.sp];
      const A = g.wildlife.animals;
      const doing = A.describe(an);
      const free = A.capturable(an);
      const hasPen = g.buildings.list.some((x) => x.complete && (x.key === 'butcher' || x.key === 'farm'));
      key = `a${an.id}|${doing}|${free}|${hasPen}`;
      const how = d.capture === 'hunt' ? `Hunted for ${d.meat} meat. Hard to catch.` : d.needsPen ? `Caught and led on a leash to a Butcher or Farm pen${hasPen ? '' : ' (build one first)'}. Butchered for meat.` : 'Caught and carried to a Farm pen (or straight to the food store).';
      const label = d.capture === 'hunt' ? 'Hunt' : 'Capture';
      html = `
        <div class="card-head"><span>${d.name}</span><span class="tag">Wild</span></div>
        <div class="kv"><span>Doing</span><b>${doing}</b></div>
        <p class="muted small">${how}</p>
        <div class="actions"><button class="btn small" data-a="capture" ${free && (!d.needsPen || hasPen) ? '' : 'disabled'}>${ICONS.harvest} ${label}</button></div>
        <p class="muted small">Tip: select an islander first, then tap an animal to send them after it.</p>`;
    } else if (b) {
      key = `b${b.id}|${b.key === 'kennel' ? `${g.dogs.alive.length}|${g.dogs.alive.filter((d) => d.puppy).length}|${Math.ceil(b.breedT)}|${Math.ceil(b.breedCool / 5)}|${b.dogRole}|${Math.floor(g.eco.food / 4)}|` : ''}${b.complete}|${Math.round(b.progress * 50)}|${b.tier}|${b.residents.length}|${b.upgrading}|${Math.round(b.growth * 20)}|${b.boats.length}|${b.boatBuild > 0}|${b.training.length}|${Math.floor(g.eco.res.wood / 5)}|${Math.floor(g.eco.res.stone / 5)}|${Math.floor(g.eco.res.belief / 5)}`;
      html = this.buildingHtml(b);
    }
    if (!force && key === this.infoKey) return;
    this.infoKey = key;
    this.info.innerHTML = html;
    const close = el('button', 'ib small close', ICONS.close);
    close.onclick = () => g.select(null);
    this.info.querySelector('.card-head')?.appendChild(close);
    this.info.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((btn) => (btn.onclick = () => this.infoAction(btn.dataset.a!, isl?.id, b, an?.id ?? (mk ? g.selectedAnimal : undefined))));
  }

  private buildingHtml(b: Building): string {
    const g = this.game;
    let body = '';
    if (!b.complete) body += `${this.bar(`Building ${Math.round(b.progress * 100)}%`, b.progress, 'good')}<div class="kv"><span>Builders</span><b>${b.builders.size} / ${b.def.builders}</b></div>`;
    else if (b.upgrading) body += `${this.bar(`Upgrading ${Math.round(b.progress * 100)}%`, b.progress, 'good')}`;
    if (b.complete && b.def.housing) body += `<div class="kv"><span>Residents</span><b>${b.residents.map((id) => g.colony.byId(id)?.name).filter(Boolean).join(', ') || 'Empty'} (${b.residents.length}/${b.housing})</b></div>`;
    const workers = g.colony.list.filter((i) => i.workplace === b.id && b.complete);
    if (b.complete && b.def.workers) body += `<div class="kv"><span>Workers</span><b>${workers.map((w) => w.name).join(', ') || 'None yet'}</b></div>`;
    if (b.key === 'smokehouse' && b.complete) body += `<div class="kv"><span>Smoking</span><b>${b.tendTimer > 0 ? 'Fire lit, racks full' : g.eco.res.fish >= SMOKE.input || g.eco.res.meat >= SMOKE.input ? 'Waiting for a keeper' : 'Needs raw fish or meat'}</b></div><p class="muted small">${SMOKE.input} raw fish or meat + ${SMOKE.wood} wood → ${SMOKE.output} smoked.</p>`;
    if (FARM_TYPES[b.key] && b.complete) body += this.bar(b.growth >= 1 ? 'Ready to harvest' : `${FARM_TYPES[b.key]!.label} growing ${Math.round(b.growth * 100)}%`, b.growth, 'good') + (b.blessTimer > 0 ? '<div class="kv"><span>Blessed</span><b>Growing faster</b></div>' : '');
    if (b.key === 'temple' && b.complete) body += `<div class="kv"><span>Belief</span><b>+${(0.25 * b.tier * 60).toFixed(0)}/min and more from priests</b></div>`;
    if (b.key === 'woodstore' || b.key === 'campfire') body += `<div class="kv"><span>Wood / Stone</span><b>${Math.floor(g.eco.res.wood)} · ${Math.floor(g.eco.res.stone)} of ${g.eco.woodCap}</b></div>`;
    if (b.key === 'grainstore' || b.key === 'campfire') body += `<div class="kv"><span>Food</span><b>${Math.floor(g.eco.food)} of ${g.eco.foodCap}</b></div>`;
    if (b.key === 'jetty' && b.complete) body += `<div class="kv"><span>Boats</span><b>${b.boats.length} / ${JETTY.maxBoats}${b.boatBuild > 0 ? ` (building ${Math.round((b.boatBuild / JETTY.boatBuildSeconds) * 100)}%)` : ''}</b></div>`;
    if (b.key === 'tradedock' && b.complete) {
      const ships = g.trade.of(b);
      const docked = ships.filter((s) => s.state === 'docked').length;
      body += `<div class="kv"><span>Trade boats</span><b>${ships.length ? `${docked} moored · ${ships.length - docked} at sea` : 'None yet'}${b.boatBuild > 0 ? ` (building ${Math.round((b.boatBuild / TRADE.boatBuildSeconds) * 100)}%)` : ''}</b></div>`;
    }
    if (b.key === 'kennel' && b.complete) {
      const D = g.dogs;
      const all = D.alive;
      const adults = all.filter((d) => !d.puppy).length, pups = all.length - adults;
      body += `<div class="sec-h">${ICONS.dog} Dogs</div>
        <div class="kv"><span>Adult</span><b>${adults}</b></div>
        <div class="kv"><span>Puppies</span><b>${pups}${b.breedT > 0 ? ` (+1 on the way, ${Math.ceil(b.breedT)}s)` : ''}</b></div>
        <div class="kv"><span>Capacity</span><b>${all.length}/${D.capacity}</b></div>
        <div class="kv"><span>Food</span><b>~${(adults + pups * 0.5) * DOGS.foodPerMinute < 1 ? ((adults + pups * 0.5) * DOGS.foodPerMinute).toFixed(1) : Math.round((adults + pups * 0.5) * DOGS.foodPerMinute)} per minute</b></div>`;
    }
    if (b.key === 'warroom' && b.complete) body += `<div class="kv"><span>Warriors</span><b>${g.colony.list.filter((i) => i.warrior).length}${b.training.length ? ` (+${b.training.length} training)` : ''}</b></div>`;
    let actions = '';
    const up = g.buildings.canUpgrade(b);
    if (b.complete && !b.upgrading && (b.key === 'hut' || (b.key === 'home' && b.tier < (b.def.maxTier ?? 1)) || (b.key === 'temple' && b.tier < 3))) {
      const c = up.cost;
      const next = [4, 7, 12, 16][b.key === 'hut' ? 0 : b.tier];
      const label = b.key === 'hut' ? 'Upgrade to level 2 (4 people)' : b.key === 'home' ? `Upgrade to level ${b.tier + 2} (${next} people)` : b.tier === 2 ? 'Raise the Great Pyramid' : 'Upgrade temple';
      actions += `<button class="btn small" data-a="upgrade" ${up.ok ? '' : 'disabled'} title="${up.reason}">${ICONS.upgrade} ${label} <span class="c">${c.wood ? icon('wood') + c.wood : ''} ${c.stone ? icon('stone') + c.stone : ''} ${c.belief ? icon('belief') + c.belief : ''}</span></button>`;
    }
    if (b.key === 'jetty' && b.complete) {
      const c = JETTY.boatCost;
      actions += `<button class="btn small" data-a="boat" ${b.boats.length + (b.boatBuild > 0 ? 1 : 0) < JETTY.maxBoats && g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.boat} Build boat <span class="c">${icon('wood')}${c.wood}</span></button>`;
    }
    if (b.key === 'tradedock' && b.complete) {
      const c = TRADE.boatCost;
      const canBoat = g.trade.of(b).length + (b.boatBuild > 0 ? 1 : 0) < TRADE.maxBoats && g.eco.canAfford(c);
      actions += `<button class="btn small" data-a="trade">${ICONS.boat} Trade goods</button>`;
      actions += `<button class="btn small" data-a="tradeboat" ${canBoat ? '' : 'disabled'}>${ICONS.boat} Build trade boat <span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone}</span></button>`;
    }
    if (b.key === 'kennel' && b.complete) {
      const ok = g.dogs.canBreed(b);
      actions += `<button class="btn small" data-a="breed" ${ok.ok ? '' : 'disabled'} title="${ok.reason}">${ICONS.dog} Breed dog <span class="c">${DOGS.breedFood} food</span></button>`;
      if (!ok.ok) actions += `<p class="muted small">${ok.reason}.</p>`;
      actions += `<div class="sec-h">Role</div><div class="seg">
        <button class="btn small${b.dogRole === 'roam' ? ' on' : ''}" data-a="dogroam" title="Dogs wander farther and go out with hunters and explorers">Free roam</button>
        <button class="btn small${b.dogRole === 'guard' ? ' on' : ''}" data-a="dogguard" title="Dogs stay close to the houses and people">Guard settlement</button></div>`;
    }
    if (b.key === 'warroom' && b.complete) {
      const c = WARRIOR.cost;
      const cs = `<span class="c">${icon('wood')}${c.wood} ${icon('stone')}${c.stone} ${icon('belief')}${c.belief}</span>`;
      actions += `<button class="btn small" data-a="jaguar" ${g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.warrior} Jaguar ${cs}</button><button class="btn small" data-a="eagle" ${g.eco.canAfford(c) ? '' : 'disabled'}>${ICONS.eagle} Eagle ${cs}</button>`;
    }
    if (!b.complete || b.upgrading) actions += `<button class="btn small" data-a="helpers" title="Call the nearest free villagers to come and build">${ICONS.people} Call helpers</button>`;
    if (g.buildings.canRelocate(b)) actions += `<button class="btn small" data-a="rotate" title="Turn a quarter turn">${ICONS.rotate} Rotate</button><button class="btn small" data-a="move" title="Pick it up and place it somewhere else">${ICONS.move} Move</button>`;
    if (b.key !== 'campfire') actions += `<button class="btn small ghost" data-a="demolish">${ICONS.demolish} ${b.complete ? 'Demolish' : 'Cancel'}</button>`;
    return `<div class="card-head"><span><span class="bic">${ICONS[BUILD_ICON[b.key]]}</span> ${b.label}</span></div>
      <p class="muted small">${b.def.description}</p>${body}<div class="actions">${actions}</div>`;
  }

  private infoAction(a: string, islId: number | undefined, b: Building | undefined, animalId?: number): void {
    const g = this.game;
    g.audio?.sfx('click');
    if (animalId !== undefined && a === 'capture') g.captureAnimal(animalId);
    if (islId !== undefined) {
      const isl = g.colony.byId(islId);
      if (!isl) return;
      if (a === 'follow') g.followId = g.followId === isl.id ? -1 : isl.id;
      if (a === 'auto') {
        isl.manualRole = false;
        isl.workplace = -1;
        isl.role = 'idle';
        g.colony.cancelTask(isl);
      }
    }
    if (b) {
      if (a === 'helpers') {
        const came = g.colony.callHelpers(b);
        this.toast(came.length ? `${came.length === 1 ? came[0].name + ' is' : came.length + ' villagers are'} coming to help build the ${b.label}.` : 'Nobody is free nearby to help.', came.length ? 'info' : 'warn');
      }
      if (a === 'upgrade') {
        const nb = g.buildings.upgrade(b);
        if (nb) {
          this.toast(b.key === 'hut' ? 'The hut will be rebuilt as a level 2 Home.' : b.key === 'home' ? `The house is being extended to level ${b.tier + 2}.` : 'Temple upgrade started.');
          if (nb !== b) g.select({ building: nb.id });
        }
      }
      if (a === 'rotate') {
        g.rotateBuilding(b);
        return;
      }
      if (a === 'move') {
        g.startMove(b);
        return;
      }
      if (a === 'demolish') {
        g.buildings.remove(b, true);
        g.select(null);
      }
      if (a === 'boat') g.buildBoat(b);
      if (a === 'tradeboat') this.toast(g.trade.orderBoat(b));
      if (a === 'breed') this.toast(g.dogs.breed(b));
      if (a === 'dogroam' || a === 'dogguard') {
        b.dogRole = a === 'dogguard' ? 'guard' : 'roam';
        this.toast(b.dogRole === 'guard' ? 'The dogs will stay close and guard the settlement.' : 'The dogs are free to roam and go out with villagers.');
        this.renderInfo(true);
      }
      if (a === 'trade') this.openTrade(b);
      if (a === 'jaguar' || a === 'eagle') {
        if (g.colony.trainWarrior(b, a)) this.toast(`A ${a === 'jaguar' ? 'Jaguar' : 'Eagle'} warrior begins training.`);
        else this.toast('Nobody is free to train, or not enough resources.', 'warn');
      }
    }
    this.infoKey = '';
    this.refresh(true);
  }

  // ---------------- Minimap ----------------

  private drawMinimap(): void {
    const g = this.game;
    const w = g.world;
    const ctx = this.minimap.getContext('2d')!;
    const S = this.minimap.width;
    if (!this.miniBase || this.miniVersion !== w.version) {
      this.miniVersion = w.version;
      const img = ctx.createImageData(S, S);
      const cols: Record<number, [number, number, number]> = {
        [Ground.Sand]: [242, 221, 176], [Ground.Grass]: [156, 194, 58], [Ground.Jungle]: [47, 122, 51], [Ground.Rock]: [154, 140, 138], [Ground.River]: [63, 214, 224],
      };
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const cx = Math.floor((x / S) * w.N), cz = Math.floor((y / S) * w.N);
          const i = w.idx(cx, cz);
          const L = w.layer[i];
          let c: [number, number, number];
          if (w.ground[i] === Ground.Water) {
            const d = Math.min(1, -L / 6);
            c = [Math.round(63 - 52 * d), Math.round(214 - 135 * d), Math.round(224 - 68 * d)];
          } else {
            c = cols[w.ground[i]] ?? [156, 194, 58];
            const shade = 0.82 + Math.min(10, L) * 0.025;
            c = [c[0] * shade, c[1] * shade, c[2] * shade];
          }
          const k = (y * S + x) * 4;
          img.data[k] = c[0];
          img.data[k + 1] = c[1];
          img.data[k + 2] = c[2];
          img.data[k + 3] = 255;
        }
      }
      this.miniBase = img;
    }
    ctx.putImageData(this.miniBase, 0, 0);
    const k = S / w.N;
    const toPx = (x: number, z: number): [number, number] => [(x + w.half) * k, (z + w.half) * k];
    for (const b of g.buildings.list) {
      const [x, y] = toPx(b.cx - w.half, b.cz - w.half);
      ctx.fillStyle = b.complete ? (b.key === 'temple' ? '#ffd24a' : '#f5e6c4') : 'rgba(245,230,196,0.5)';
      ctx.fillRect(x, y, Math.max(2, b.w * k), Math.max(2, b.d * k));
    }
    ctx.fillStyle = '#ffffff';
    for (const i of g.colony.list) {
      if (i.hidden) continue;
      const [x, y] = toPx(i.x, i.z);
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    ctx.fillStyle = '#1b2a38';
    for (const wh of g.marine.positions()) {
      const [x, y] = toPx(wh.x, wh.z);
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bt of g.boatList()) {
      const [x, y] = toPx(bt.x, bt.z);
      ctx.fillStyle = '#8b5a34';
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
    // Camera view footprint.
    const r = g.rig;
    const [cx, cy] = toPx(r.cur.x, r.cur.z);
    const half = r.viewRadius * 0.55 * k;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-r.cur.yaw);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-half * g.rig.camera.aspect * 0.7, -half * 0.7, half * g.rig.camera.aspect * 1.4, half * 1.4);
    ctx.restore();
  }

  milestone(id: string): void {
    const m = MILESTONES.find((x) => x.id === id);
    if (m) this.toast(m.text, 'milestone');
  }

  setToolFromKey(id: ToolId): void {
    this.game.setTool(id);
  }
}
