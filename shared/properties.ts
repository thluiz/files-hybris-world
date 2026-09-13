/**
 * Catalog of properties (IPs) served by this deployment.
 *
 * One site serves the whole slate. Which property a request belongs to is
 * decided from the request host, in one place only (`functions/_middleware.ts`),
 * and never appears in a public URL.
 *
 * `shared/files.ts` imports this module. Never the other way round.
 */

export interface Property {
  /** Internal path prefix and the value stored in `codes.property`. Never public. */
  slug: string;
  /** Exact, lowercase production hostnames. An array so an alias can be added later. */
  hosts: string[];
  /** Rights holder named in the footer notice. */
  brand: string;
  /** The h1 on the index page. */
  displayName: string;
  /** The line under the h1. */
  tagline: string;
  /** What `shortTitle()` strips from a file title. Empty when titles carry no prefix. */
  titlePrefix: string;
  /** Where the house icon points. */
  homeUrl: string;
  /** Every `r2Key` of this property must start with it — checked in shared/files.ts. */
  r2Prefix: string;
  /** `<meta name="theme-color">`. Must match this property's `--cream` in global.css. */
  themeColor: string;
}

export const PROPERTIES: Property[] = [
  {
    slug: 'hybris',
    hosts: ['files.hybris.world'],
    brand: 'Metron Showrunners',
    displayName: 'Hybris Project',
    tagline: 'An Ancient Conflict, Reimagined. Select a document to continue.',
    titlePrefix: 'Hybris',
    homeUrl: 'https://metronshowrunners.com',
    r2Prefix: 'hybris/',
    themeColor: '#cabf9d',
  },
  {
    slug: 'ned',
    hosts: ['files-ned.metronshowrunners.com'],
    brand: 'Metron Showrunners',
    displayName: 'Not Even Death',
    tagline: 'A Dark Comedy in One Minute. Select the screenplay to continue.',
    titlePrefix: '',
    homeUrl: 'https://metronshowrunners.com',
    r2Prefix: 'ned/',
    themeColor: '#11151a',
  },
];

/** Only used on hosts that have no custom domain — see `isDevHost`. */
export const DEFAULT_PROPERTY: Property = PROPERTIES[0];

export const PROPERTY_BY_SLUG: Record<string, Property> = Object.fromEntries(
  PROPERTIES.map((p) => [p.slug, p])
);

/**
 * Exact match, lowercased. No suffix matching and no wildcards, on purpose: a
 * host we don't know resolves to null and gets a 404, instead of quietly
 * falling through to whichever property happens to be first in the list.
 */
export function propertyForHost(host: string): Property | null {
  const needle = host.toLowerCase();
  return PROPERTIES.find((p) => p.hosts.includes(needle)) ?? null;
}

/** Local dev (`wrangler pages dev`) and Pages preview deployments. */
export function isDevHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.pages.dev');
}
