import { setOgMeta } from './ogMeta.js';

export interface PageMeta {
  title: string;
  description?: string;
  image?: string;
}

const SITE_TITLE = 'Philly Lacrosse Stats';
const DEFAULT_DESCRIPTION =
  'Live stats, standings, and player leaders for Philadelphia-area high school boys lacrosse.';

export function setPageMeta(meta: PageMeta): void {
  const fullTitle = meta.title === 'Dashboard' ? SITE_TITLE : `${meta.title} | ${SITE_TITLE}`;

  setOgMeta({
    title: fullTitle,
    description: meta.description ?? DEFAULT_DESCRIPTION,
    image: meta.image,
    url: window.location.href,
  });
}
