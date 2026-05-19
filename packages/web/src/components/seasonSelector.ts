import { getSeasons } from '../api.js';
import { IS_STATIC } from '../staticLoader.js';
import {
  SEASON_STORAGE_KEY,
  currentSeason,
  defaultSeason,
  setKnownSeasons,
  setSeason,
} from './seasonPicker.js';

let latestSeason = String(defaultSeason());

function readStoredSeason(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SEASON_STORAGE_KEY);
  } catch {
    return null;
  }
}

function createOption(value: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  return option;
}

export function getSelectedSeason(): string {
  const stored = readStoredSeason();
  if (stored && /^\d{4}$/.test(stored)) return stored;
  const active = currentSeason();
  if (typeof active === 'number') return String(active);
  return latestSeason;
}

export function createSeasonSelector(
  container: HTMLElement,
  onChange: (season: string) => void,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'season-selector';
  wrap.style.cssText = 'display:flex; align-items:center; gap:.6rem; margin:0 0 1rem; flex-wrap:wrap;';

  const label = document.createElement('label');
  label.textContent = 'Season';
  label.style.cssText = 'font-size:.9rem; font-weight:600; color:var(--muted);';

  const select = document.createElement('select');
  select.style.cssText = 'padding:.45rem .7rem; border-radius:8px; border:1px solid var(--border); background:var(--bg-elev, var(--bg)); color:var(--fg); min-width:7rem;';
  select.disabled = true;
  label.appendChild(select);
  wrap.appendChild(label);
  container.replaceChildren(wrap);

  const applySelection = (seasons: number[]): void => {
    if (seasons.length > 0) {
      setKnownSeasons(seasons);
      latestSeason = String(seasons[0]);
    }

    const stored = readStoredSeason();
    const selected = stored && seasons.some((season) => String(season) === stored)
      ? stored
      : latestSeason;

    select.replaceChildren(...(seasons.length > 0 ? seasons : [Number(latestSeason)]).map((season) => createOption(String(season))));
    select.value = selected;
    select.disabled = IS_STATIC || select.options.length <= 1;

    setSeason(Number(selected));
    onChange(selected);
  };

  select.addEventListener('change', () => {
    const season = select.value;
    setSeason(Number(season));
    onChange(season);
  });

  void getSeasons()
    .then((response) => {
      const seasons = [...response.seasons].sort((a, b) => b - a);
      applySelection(seasons.length > 0 ? seasons : [response.default ?? Number(latestSeason)]);
    })
    .catch(() => {
      applySelection([Number(getSelectedSeason()) || Number(latestSeason)]);
    });
}
