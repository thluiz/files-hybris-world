/**
 * Catalog of protected files.
 *
 * This is the ONLY source of truth for which files exist. It's imported both
 * by the Astro pages (to generate /d/<slug>) and by the download Pages
 * Function.
 *
 * `r2Key` is the object name inside the private R2 bucket. It never reaches
 * the client — the browser only knows the `slug`.
 *
 * Every entry belongs to a property (see shared/properties.ts). A slug is
 * unique WITHIN a property, not across the slate: resolving one always takes
 * both, via `fileFor()`.
 */
import { PROPERTY_BY_SLUG } from './properties';

export interface FileEntry {
  /** Which property (IP) this file belongs to — a slug from shared/properties.ts */
  property: string;
  /** Appears in the URL: /d/<slug>. Unique within the property, not globally. */
  slug: string;
  /** Title shown on the access page */
  title: string;
  /** One line of context below the title */
  description: string;
  /** Minimum level a code needs to open this file */
  level: number;
  /** Object path inside the R2 bucket. Must start with the property's `r2Prefix`. */
  r2Key: string;
  /** Filename the downloader gets on disk */
  downloadName: string;
  contentType: string;
}

/**
 * Access levels.
 *
 * Each code carries a level and opens every file whose `level` is less than
 * or equal to its own — the ladder follows the order in which material gets
 * exposed: the one-pager is shown to any interested party, the full script
 * to almost no one.
 *
 * Level 0 opens nothing. That's how a code gets blocked without deleting it:
 * its history in `access_log` still makes sense.
 *
 * The jumps of 10 exist to fit an intermediate level in later without
 * renumbering what's already been distributed.
 *
 * The ladder is shared by every property. A property that only publishes two
 * documents simply has nothing at the upper levels.
 */
export const ACCESS_LEVELS = [0, 10, 20, 30, 40] as const;
export const LEVEL_BLOCKED = 0;

export const FILES: FileEntry[] = [
  {
    property: 'hybris',
    slug: 'one-pager',
    title: 'Hybris — One-Pager',
    description: 'The series at a glance.',
    level: 10,
    r2Key: 'hybris/01-one-pager.pdf',
    downloadName: 'Hybris-One-Pager.pdf',
    contentType: 'application/pdf',
  },
  {
    property: 'hybris',
    slug: 'pitch-deck',
    title: 'Hybris — Pitch Deck',
    description: 'Positioning, tone and market.',
    level: 20,
    r2Key: 'hybris/02-pitch-deck.pdf',
    downloadName: 'Hybris-Pitch-Deck.pdf',
    contentType: 'application/pdf',
  },
  {
    property: 'hybris',
    slug: 'series-bible',
    title: 'Hybris — Series Bible',
    description: 'Characters, world and season arc.',
    level: 30,
    r2Key: 'hybris/03-series-bible.pdf',
    downloadName: 'Hybris-Series-Bible.pdf',
    contentType: 'application/pdf',
  },
  {
    property: 'hybris',
    slug: 'season-one-script',
    title: 'Hybris — Season One Full Script',
    description: 'Complete scripts for season one.',
    level: 40,
    r2Key: 'hybris/04-season-one-full-script.pdf',
    downloadName: 'Hybris-Season-One-Full-Script.pdf',
    contentType: 'application/pdf',
  },
  // Os dois no nivel 10, de propósito: um código do NED abre ambos. Separar
  // por idioma numa escada de níveis seria dizer que uma das versões é mais
  // reservada que a outra, o que não é o caso.
  {
    property: 'ned',
    slug: 'full-script-en',
    title: 'Full Script — English Version',
    description: 'Complete screenplay for the one-minute film.',
    level: 10,
    r2Key: 'ned/01-full-script-en.pdf',
    downloadName: 'Not-Even-Death-Full-Script-EN.pdf',
    contentType: 'application/pdf',
  },
  {
    property: 'ned',
    slug: 'full-script-pt',
    title: 'Full Script — Portuguese Version',
    description: 'Complete screenplay for the one-minute film.',
    level: 10,
    r2Key: 'ned/02-full-script-pt.pdf',
    downloadName: 'Not-Even-Death-Full-Script-PT.pdf',
    contentType: 'application/pdf',
  },
];

const FILE_BY_KEY: Record<string, FileEntry> = Object.fromEntries(
  FILES.map((f) => [`${f.property}/${f.slug}`, f])
);

// Two checks that run at module load, which means at build time and at the
// Function's cold start — the two places where a broken catalog should stop
// everything instead of shipping.
if (Object.keys(FILE_BY_KEY).length !== FILES.length) {
  // A repeated (property, slug) pair silently shadows a file otherwise.
  throw new Error('shared/files.ts: duplicate (property, slug) in FILES');
}
for (const f of FILES) {
  const property = PROPERTY_BY_SLUG[f.property];
  if (!property) {
    throw new Error(`shared/files.ts: unknown property "${f.property}" on ${f.slug}`);
  }
  // Catches the one copy-paste that would actually hand one property's
  // material to another property's codes.
  if (!f.r2Key.startsWith(property.r2Prefix)) {
    throw new Error(
      `shared/files.ts: r2Key "${f.r2Key}" is outside "${property.r2Prefix}" (${f.property})`
    );
  }
}

/**
 * The only way to resolve a slug. There is deliberately no property-free
 * variant: slugs collide across properties, and a lookup that forgets the
 * property is how one IP's code opens another's file.
 */
export function fileFor(property: string, slug: string): FileEntry | undefined {
  return FILE_BY_KEY[`${property}/${slug}`];
}

/** The catalog of one property, in ladder order. */
export function filesOf(property: string): FileEntry[] {
  return FILES.filter((f) => f.property === property).sort((a, b) => a.level - b.level);
}

/** The title without the leading "Hybris —", for tables and lists. */
export function shortTitle(file: FileEntry): string {
  const prefix = PROPERTY_BY_SLUG[file.property]?.titlePrefix;
  if (!prefix) return file.title;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return file.title.replace(new RegExp(`^${escaped}\\s*[—–-]\\s*`), '');
}

/** Files a code at this level opens, from most open to most restricted. */
export function filesForLevel(property: string, level: number): FileEntry[] {
  return filesOf(property).filter((f) => f.level <= level);
}

/** The system's single authorization rule. Lives here so it isn't rewritten
 *  from memory everywhere it's needed. The property is a lookup concern,
 *  settled before this is called — don't add it here. */
export function canAccess(level: number, file: FileEntry): boolean {
  return level >= file.level && level > LEVEL_BLOCKED;
}

/** "One-Pager, Pitch Deck" — what the level opens, in one line. Per property:
 *  the same level number opens different things in different catalogs. */
export function levelSummary(property: string, level: number): string {
  const open = filesForLevel(property, level);
  return open.length === 0 ? 'opens nothing' : open.map(shortTitle).join(', ');
}
