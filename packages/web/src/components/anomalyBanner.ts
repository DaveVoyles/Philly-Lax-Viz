// Wave H4 Lane 1 (Han) — anomaly banner shown when a game's per-player goal
// sum exceeds the recorded team score (the "174 goals in one game" class of
// data-quality anomaly). A reconciled variant is provided for once the issue
// has been corrected upstream.

export type AnomalyKind = 'team-score-exceeded' | 'reconciled';

export interface AnomalyBannerOpts {
  kind: AnomalyKind;
  gameId: number;
  teamName?: string;
  playerSum?: number;
  teamScore?: number;
  sourceUrl?: string;
}

export function renderAnomalyBanner(opts: AnomalyBannerOpts): HTMLElement {
  const div = document.createElement('div');
  div.className =
    opts.kind === 'reconciled' ? 'anomaly-banner reconciled' : 'anomaly-banner';
  div.setAttribute('role', opts.kind === 'reconciled' ? 'status' : 'alert');
  div.dataset['gameId'] = String(opts.gameId);
  div.dataset['kind'] = opts.kind;

  const icon = document.createElement('span');
  icon.className = 'anomaly-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = opts.kind === 'reconciled' ? '✅' : '⚠️';
  div.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'anomaly-banner-text';
  text.textContent = buildMessage(opts);
  div.appendChild(text);

  if (opts.sourceUrl) {
    const link = document.createElement('a');
    link.className = 'anomaly-banner-source';
    link.href = opts.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'source';
    div.appendChild(document.createTextNode(' '));
    div.appendChild(link);
  }

  return div;
}

function buildMessage(opts: AnomalyBannerOpts): string {
  const team = opts.teamName ? ` for ${opts.teamName}` : '';
  if (opts.kind === 'reconciled') {
    return `Stats reconciled${team}: per-player goals now match the recorded team score.`;
  }
  const sum = opts.playerSum;
  const score = opts.teamScore;
  if (typeof sum === 'number' && typeof score === 'number') {
    return `Heads up: per-player goals${team} sum to ${sum}, but the recorded team score is ${score}. The box score may be over-counted.`;
  }
  return `Heads up: per-player goals${team} exceed the recorded team score for this game.`;
}
