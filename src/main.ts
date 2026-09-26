import './ui/style.css';
import { Game } from './Game';
import { randomSeed } from './world/rng';
import { PresetName } from './config';
import { savedSeed } from './world/Save';

/** Read ?seed= from the URL, or create one and put it in the URL so the island can be shared. */
function resolveSeed(): number {
  const params = new URLSearchParams(location.search);
  const s = parseInt(params.get('seed') ?? '', 10);
  if (Number.isFinite(s) && s > 0) return s;
  // No seed in the link: continue the saved island if there is one.
  const seed = savedSeed() ?? randomSeed();
  params.set('seed', String(seed));
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  return seed;
}

function defaultPreset(): PresetName {
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch ? 'low' : 'high';
}

const text = (t: string) => {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = t;
};

async function boot(): Promise<void> {
  // Relative URL so the splash works when hosted under a sub-path (GitHub Pages).
  const bg = document.querySelector<HTMLElement>('.splash-bg');
  if (bg) bg.style.backgroundImage = "url('./splash.webp')";
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
  } else go();
}

setTimeout(() => void boot(), 50);
