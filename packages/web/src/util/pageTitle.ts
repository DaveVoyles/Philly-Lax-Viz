const BASE = 'PhillyLaxStats';

export function setPageTitle(subtitle?: string): void {
  document.title = subtitle ? `${subtitle} | ${BASE}` : BASE;
}
