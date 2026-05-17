/**
 * Share the current page. On mobile/supported browsers, uses the Web Share API.
 * On desktop, copies the URL to clipboard with a brief success flash.
 */
export async function shareOrCopy(title: string, url?: string): Promise<void> {
  const shareUrl = url ?? window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url: shareUrl });
      return;
    } catch {
      // User cancelled or API failed - fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    flashShareSuccess();
  } catch {
    // Clipboard API not available - silently ignore
  }
}

let flashTimeout: ReturnType<typeof setTimeout> | null = null;

function flashShareSuccess(): void {
  const existing = document.getElementById('share-flash');
  if (existing) {
    if (flashTimeout) clearTimeout(flashTimeout);
    existing.remove();
  }
  const el = document.createElement('div');
  el.id = 'share-flash';
  el.textContent = 'Link copied!';
  el.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:#1f2937',
    'color:#fff',
    'padding:8px 16px',
    'border-radius:6px',
    'font-size:13px',
    'z-index:9999',
    'pointer-events:none',
    'animation:shareFlashIn 0.15s ease',
  ].join(';');
  document.body.appendChild(el);
  flashTimeout = setTimeout(() => el.remove(), 2000);
}

export function getShareButtonHtml(title: string): string {
  const escaped = title.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<button class="share-btn" data-share-title="${escaped}" aria-label="Share this page" title="Share or copy link">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
    </svg>
  </button>`;
}

export function initShareButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.share-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.shareTitle ?? document.title;
      void shareOrCopy(title);
    });
  });
}

let shareCssInjected = false;
export function ensureShareCss(): void {
  if (shareCssInjected) return;
  shareCssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .share-btn {
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid #d1d5db; border-radius: 6px;
      padding: 4px 8px; cursor: pointer; color: #6b7280;
      font-size: 12px; line-height: 1; transition: background 0.15s, color 0.15s;
      vertical-align: middle; margin-left: 8px;
    }
    .share-btn:hover { background: #f3f4f6; color: #374151; }
    @keyframes shareFlashIn {
      from { opacity: 0; transform: translateX(-50%) translateY(6px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);
}
