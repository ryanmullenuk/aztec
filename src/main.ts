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

// Size the splash to the real screen straight away (iOS home-screen apps under-report 100vh).
appViewport();
addEventListener('resize', () => appViewport());

async function boot(): Promise<void> {
  // Relative URL so the splash works when hosted under a sub-path (GitHub Pages).
  const bg = document.querySelector<HTMLElement>('.splash-bg');
  if (bg) bg.style.backgroundImage = "url('./splash.webp?v=2')";
  text('Shaping the island…');
  // Let the text paint before the (synchronous) world generation.
  await new Promise((r) => setTimeout(r, 30));
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, { seed: resolveSeed(), preset: defaultPreset() });
  (window as unknown as { game: Game }).game = game;
  game.start();
  text('The island awaits');
  const btn = document.getElementById('play-btn');
  const loading = document.getElementById('loading');
  const go = () => {
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
