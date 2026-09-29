import './ui/style.css';
import { Game, appViewport } from './Game';
import { PresetName, SAVE, WORLD } from './config';
import { blockSaves } from './world/Save';

/** Everyone plays the same hand-designed island; old ?seed= links are tidied away. */
function resolveSeed(): number {
  if (location.search.includes('seed=')) history.replaceState(null, '', location.pathname + location.hash);
  return WORLD.islandSeed;
}

function defaultPreset(): PresetName {
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch ? 'low' : 'high';
}

const text = (t: string) => {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = t;
};

// Keep the splash and game sized to the available app viewport.
appViewport();
addEventListener('resize', () => appViewport());

/** Must run directly from the Play gesture; unsupported platforms keep standalone mode. */
function enterFullscreen(): void {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    // Fullscreen may be declined by the browser; the game must still start.
  });
}

async function boot(): Promise<void> {
  text('Shaping the island…');
  // Let the text paint before the (synchronous) world generation.
  await new Promise((r) => setTimeout(r, 30));
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  let game: Game;
  try {
    game = new Game(canvas, { seed: resolveSeed(), preset: defaultPreset() });
    game.start();
  } catch (e) {
    bootFailed(e);
    return;
  }
  (window as unknown as { game: Game }).game = game;
  booted();
  document.addEventListener('fullscreenchange', () => game.resize());
  window.visualViewport?.addEventListener('resize', () => game.resize());
  document.getElementById('loading-text')?.classList.add('hidden');
  const btn = document.getElementById('play-btn');
  const loading = document.getElementById('loading');
  let entered = false;
  const go = () => {
    if (entered) return;
    entered = true;
    enterFullscreen();
    game.audio.unlock();
    loading?.classList.add('hidden');
    document.documentElement.classList.remove('splash-open');
  };
  if (btn) {
    btn.classList.remove('hidden');
    btn.addEventListener('click', go, { once: true });
    // Tap anywhere on the splash too: in mobile browsers the Play button can end up under the
    // browser's own address and tab bars.
    loading?.addEventListener('click', go, { once: true });
  } else go();
}

/** Started: clear the one-time fresh-reload marker and its cache-busting ?r= from the address. */
function booted(): void {
  (window as unknown as { aztlanBooted: boolean }).aztlanBooted = true;
  try {
    sessionStorage.removeItem('aztlan-isle-reloaded');
  } catch {
    /* no session storage */
  }
  if (location.search.includes('r=')) {
    const u = new URL(location.href);
    u.searchParams.delete('r');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
}

/**
 * The game failed while starting (most often a saved island it can't read). Say so on the splash
 * instead of hanging, and offer to try again or start a new island; the old save is kept aside as
 * a backup rather than deleted.
 */
function bootFailed(e: unknown): void {
  blockSaves();
  console.error('Aztlan Isle failed to start', e);
  (window as unknown as { aztlanBootError: unknown }).aztlanBootError = e;
  text('Your island could not be loaded.');
  document.getElementById('loading-text')?.classList.remove('hidden');
  const ui = document.querySelector('.splash-ui');
  if (!ui || ui.querySelector('.boot-actions')) return;
  const row = document.createElement('div');
  row.className = 'boot-actions';
  const retry = document.createElement('button');
  retry.className = 'play small';
  retry.textContent = 'Try again';
  retry.onclick = () => location.reload();
  const fresh = document.createElement('button');
  fresh.className = 'play small';
  fresh.textContent = 'Start new island';
  fresh.onclick = () => {
    try {
      const raw = localStorage.getItem(SAVE.key);
      if (raw) {
        try {
          localStorage.setItem(SAVE.key + '-backup', raw);
        } catch {
          if (!confirm('There is no room to keep a backup of your saved island. Start a new island anyway? The old one will be lost.')) return;
        }
        localStorage.removeItem(SAVE.key);
      }
    } catch {
      /* storage unavailable */
    }
    location.href = location.pathname;
  };
  row.append(retry, fresh);
  const msg = document.createElement('p');
  msg.className = 'splash-hint';
  msg.textContent = e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140);
  ui.append(row, msg);
}

setTimeout(() => void boot(), 50);
