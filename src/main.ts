import './ui/style.css';
import { Game, appViewport } from './Game';
import { PresetName, WORLD } from './config';

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
  const game = new Game(canvas, { seed: resolveSeed(), preset: defaultPreset() });
  (window as unknown as { game: Game }).game = game;
  game.start();
  document.addEventListener('fullscreenchange', () => game.resize());
  window.visualViewport?.addEventListener('resize', () => game.resize());
  text('The island awaits');
  const btn = document.getElementById('play-btn');
  const loading = document.getElementById('loading');
  let entered = false;
  const go = () => {
    if (entered) return;
    entered = true;
    enterFullscreen();
    game.audio.unlock();
    loading?.classList.add('hidden');
  };
  if (btn) {
    btn.classList.remove('hidden');
    btn.addEventListener('click', go, { once: true });
    // Tap anywhere on the splash too: in mobile browsers the Play button can end up under the
    // browser's own address and tab bars.
    loading?.addEventListener('click', go, { once: true });
  } else go();
}

setTimeout(() => void boot(), 50);
