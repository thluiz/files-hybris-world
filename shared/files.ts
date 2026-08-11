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
  /** Nível mínimo que um código precisa ter para abrir este arquivo */
  level: number;
  /** Caminho do objeto dentro do bucket R2 */
  r2Key: string;
  /** Nome com que o arquivo chega no disco de quem baixa */
  downloadName: string;
  contentType: string;
}

/**
 * Níveis de acesso.
 *
 * Cada código carrega um nível e abre todo arquivo cujo `level` seja menor ou
 * igual ao dele — a escada acompanha a ordem de exposição do material: o
 * one-pager se mostra a qualquer interessado, o roteiro completo a quase
 * ninguém.
 *
 * O nível 0 não abre nada. É assim que se bloqueia um código sem apagá-lo:
 * o histórico dele no `access_log` continua fazendo sentido.
 *
 * Os saltos de 10 em 10 existem para caber um nível intermediário no futuro
 * sem renumerar o que já foi distribuído.
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

/** O título sem o "Hybris —" da frente, para tabelas e listas. */
export function shortTitle(file: FileEntry): string {
  return file.title.replace(/^Hybris\s*—\s*/, '');
}

/** Arquivos que um código deste nível abre, do mais aberto ao mais restrito. */
export function filesForLevel(level: number): FileEntry[] {
  return FILES.filter((f) => f.level <= level).sort((a, b) => a.level - b.level);
}

/** A única regra de autorização do sistema. Vive aqui para não ser reescrita
 *  de memória em cada lugar que precisa dela. */
export function canAccess(level: number, file: FileEntry): boolean {
  return level >= file.level && level > LEVEL_BLOCKED;
}

/** "One-Pager, Pitch Deck" — o que o nível abre, em uma linha. */
export function levelSummary(level: number): string {
  const open = filesForLevel(level);
  return open.length === 0 ? 'não abre nada' : open.map(shortTitle).join(', ');
}
