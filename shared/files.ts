/**
 * Catalog of protected files.
 *
 * This is the ONLY source of truth for which files exist. It's imported both
 * by the Astro pages (to generate /d/<slug>) and by the download Pages
 * Function.
 *
 * `r2Key` is the object name inside the private R2 bucket. It never reaches
 * the client — the browser only knows the `slug`.
 */

export interface FileEntry {
  /** Appears in the URL: /d/<slug> */
  slug: string;
  /** Title shown on the access page */
  title: string;
  /** One line of context below the title */
  description: string;
  /** Minimum level a code needs to open this file */
  level: number;
  /** Object path inside the R2 bucket */
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
 */
export const ACCESS_LEVELS = [0, 10, 20, 30, 40] as const;
export const LEVEL_BLOCKED = 0;

export const FILES: FileEntry[] = [
  {
    slug: 'one-pager',
    title: 'Hybris — One-Pager',
    description: 'The series at a glance.',
    level: 10,
    r2Key: 'hybris/01-one-pager.pdf',
    downloadName: 'Hybris-One-Pager.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'pitch-deck',
    title: 'Hybris — Pitch Deck',
    description: 'Positioning, tone and market.',
    level: 20,
    r2Key: 'hybris/02-pitch-deck.pdf',
    downloadName: 'Hybris-Pitch-Deck.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'series-bible',
    title: 'Hybris — Series Bible',
    description: 'Characters, world and season arc.',
    level: 30,
    r2Key: 'hybris/03-series-bible.pdf',
    downloadName: 'Hybris-Series-Bible.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'season-one-script',
    title: 'Hybris — Season One Full Script',
    description: 'Complete scripts for season one.',
    level: 40,
    r2Key: 'hybris/04-season-one-full-script.pdf',
    downloadName: 'Hybris-Season-One-Full-Script.pdf',
    contentType: 'application/pdf',
  },
];

export const FILE_BY_SLUG: Record<string, FileEntry> = Object.fromEntries(
  FILES.map((f) => [f.slug, f])
);

/** The title without the leading "Hybris —", for tables and lists. */
export function shortTitle(file: FileEntry): string {
  return file.title.replace(/^Hybris\s*—\s*/, '');
}

/** Files a code at this level opens, from most open to most restricted. */
export function filesForLevel(level: number): FileEntry[] {
  return FILES.filter((f) => f.level <= level).sort((a, b) => a.level - b.level);
}

/** The system's single authorization rule. Lives here so it isn't rewritten
 *  from memory everywhere it's needed. */
export function canAccess(level: number, file: FileEntry): boolean {
  return level >= file.level && level > LEVEL_BLOCKED;
}

/** "One-Pager, Pitch Deck" — what the level opens, in one line. */
export function levelSummary(level: number): string {
  const open = filesForLevel(level);
  return open.length === 0 ? 'opens nothing' : open.map(shortTitle).join(', ');
}
