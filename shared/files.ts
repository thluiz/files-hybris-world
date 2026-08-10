/**
 * Catálogo dos arquivos protegidos.
 *
 * Esta é a ÚNICA fonte de verdade sobre quais arquivos existem. É importada
 * tanto pelas páginas Astro (para gerar /d/<slug>) quanto pela Pages Function
 * de download.
 *
 * `r2Key` é o nome do objeto dentro do bucket R2 privado. Ele nunca chega ao
 * cliente — o browser só conhece o `slug`.
 */

export interface FileEntry {
  /** Aparece na URL: /d/<slug> */
  slug: string;
  /** Título mostrado na página de acesso */
  title: string;
  /** Uma linha de contexto abaixo do título */
  description: string;
  /** Caminho do objeto dentro do bucket R2 */
  r2Key: string;
  /** Nome com que o arquivo chega no disco de quem baixa */
  downloadName: string;
  contentType: string;
}

export const FILES: FileEntry[] = [
  {
    slug: 'one-pager',
    title: 'Hybris — One-Pager',
    description: 'The series at a glance.',
    r2Key: 'hybris/01-one-pager.pdf',
    downloadName: 'Hybris-One-Pager.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'pitch-deck',
    title: 'Hybris — Pitch Deck',
    description: 'Positioning, tone and market.',
    r2Key: 'hybris/02-pitch-deck.pdf',
    downloadName: 'Hybris-Pitch-Deck.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'series-bible',
    title: 'Hybris — Series Bible',
    description: 'Characters, world and season arc.',
    r2Key: 'hybris/03-series-bible.pdf',
    downloadName: 'Hybris-Series-Bible.pdf',
    contentType: 'application/pdf',
  },
  {
    slug: 'season-one-script',
    title: 'Hybris — Season One Full Script',
    description: 'Complete scripts for season one.',
    r2Key: 'hybris/04-season-one-full-script.pdf',
    downloadName: 'Hybris-Season-One-Full-Script.pdf',
    contentType: 'application/pdf',
  },
];

export const FILE_BY_SLUG: Record<string, FileEntry> = Object.fromEntries(
  FILES.map((f) => [f.slug, f])
);
