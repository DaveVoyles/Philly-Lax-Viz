/**
 * Share or copy the current page URL.
 * - On mobile (or browsers that support Web Share API): uses navigator.share()
 * - Fallback: copies to clipboard via navigator.clipboard.writeText()
 * - Final fallback: selects text in a temporary input for manual copy
 */
export async function shareOrCopy(title: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // User cancelled or share failed - fall through to clipboard
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      showCopiedFeedback();
      return;
    } catch {
      // Clipboard denied - fall through to legacy
    }
  }
  const inp = document.createElement('input');
  inp.value = url;
  inp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(inp);
  inp.select();
  document.execCommand('copy');
  document.body.removeChild(inp);
  showCopiedFeedback();
}

function showCopiedFeedback(): void {
  const toast = document.createElement('div');
  toast.textContent = 'Link copied!';
  toast.style.cssText = [
    'position:fixed',
    'top:1rem',
    'right:1rem',
    'z-index:9999',
    'background:var(--accent)',
    'color:var(--accent-fg)',
    'padding:0.4rem 0.9rem',
    'border-radius:6px',
    'font-size:0.875rem',
    'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
    'animation:fadeout 2s forwards',
  ].join(';');
  if (!document.getElementById('share-toast-style')) {
    const style = document.createElement('style');
    style.id = 'share-toast-style';
    style.textContent = '@keyframes fadeout{0%{opacity:1}70%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(style);
  }
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2100);
}

/** Build the current full URL (hash-based SPA). */
export function currentPageUrl(): string {
  return window.location.href;
}
