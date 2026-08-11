/**
 * Gera os códigos de acesso.
 *
 *   node scripts/gen-codes.mjs                  → 100 códigos de nível 10
 *   node scripts/gen-codes.mjs 40               → 40 códigos de nível 10
 *   node scripts/gen-codes.mjs 40 --level=30    → 40 códigos de nível 30
 *
 * Se existir `db/labels.txt` (um rótulo por linha), cada linha vira um código
 * nominal e a quantidade passa a ser o número de linhas. A linha pode trazer o
 * nível depois de uma vírgula, e aí ele vale só para aquele código:
 *
 *   Ana Souza, 40
 *   Produtora X, 20
 *   Contato de festival          ← usa o nível do --level
 *
 * O default é o nível mais baixo de propósito: subir um código depois é um
 * UPDATE; recolher material que já foi baixado não é.
 *
 * Escreve dois arquivos, ambos fora do git:
 *   db/seed-codes.sql → para `npm run db:seed`
 *   db/codes.csv      → a lista legível, para você distribuir
 */
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABELS_FILE = join(root, 'db', 'labels.txt');

// Sem I, O, 0 e 1: quem digita a partir de um papel ou de um email não erra.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

// Espelha ACCESS_LEVELS e os `level` de shared/files.ts. Este script é .mjs e
// não importa TypeScript; mudou lá, mude aqui.
const LEVELS = [0, 10, 20, 30, 40];
const LEVEL_NAMES = {
  0: 'bloqueado',
  10: 'One-Pager',
  20: '+ Pitch Deck',
  30: '+ Series Bible',
  40: '+ Season One Full Script',
};
const DEFAULT_LEVEL = 10;

function makeCode() {
  let out = '';
  // randomInt do node:crypto, não Math.random: estes códigos são a única
  // barreira de acesso ao material.
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseLevel(raw, origem) {
  const level = Number(raw);
  if (!LEVELS.includes(level)) {
    console.error(`Nível inválido em ${origem}: ${raw}. Use ${LEVELS.join(', ')}.`);
    process.exit(1);
  }
  return level;
}

const args = process.argv.slice(2);
const levelFlag = args.find((a) => a.startsWith('--level='));
const countArg = args.find((a) => !a.startsWith('--'));
const defaultLevel = levelFlag
  ? parseLevel(levelFlag.slice('--level='.length), '--level')
  : DEFAULT_LEVEL;

// "Ana Souza, 40" → rótulo e nível próprio. Sem vírgula seguida de número, a
// linha inteira é o rótulo (e rótulo com vírgula no meio continua funcionando).
const labels = existsSync(LABELS_FILE)
  ? readFileSync(LABELS_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.*?)\s*[,;]\s*(\d{1,3})$/);
        return m
          ? { label: m[1].trim(), level: parseLevel(m[2], `db/labels.txt: "${line}"`) }
          : { label: line, level: defaultLevel };
      })
  : null;

const total = labels ? labels.length : Number(countArg ?? 100);
if (!Number.isInteger(total) || total < 1 || total > 5000) {
  console.error('Quantidade inválida.');
  process.exit(1);
}

const seen = new Set();
const rows = [];
const createdAt = new Date().toISOString();

while (rows.length < total) {
  const code = makeCode();
  if (seen.has(code)) continue;
  seen.add(code);
  const entry = labels
    ? labels[rows.length]
    : { label: `Convidado ${String(rows.length + 1).padStart(3, '0')}`, level: defaultLevel };
  rows.push({ code, label: entry.label, level: entry.level });
}

const sql = [
  '-- Gerado por scripts/gen-codes.mjs. NÃO COMITAR.',
  `-- ${total} códigos, ${createdAt}`,
  '',
  ...rows.map(
    (r) =>
      `INSERT OR IGNORE INTO codes (code, label, level, created_at) VALUES (${sqlQuote(
        r.code
      )}, ${sqlQuote(r.label)}, ${r.level}, ${sqlQuote(createdAt)});`
  ),
  '',
].join('\n');

// Hífen só na apresentação; o que vai para o banco e o que a Function compara
// é sempre a forma sem separador.
const csv = [
  'label,code,code_formatado,nivel,abre_ate',
  ...rows.map(
    (r) =>
      `${sqlQuote(r.label).slice(1, -1).replace(/,/g, ' ')},${r.code},${r.code.slice(
        0,
        4
      )}-${r.code.slice(4)},${r.level},${LEVEL_NAMES[r.level]}`
  ),
  '',
].join('\n');

writeFileSync(join(root, 'db', 'seed-codes.sql'), sql, 'utf8');
writeFileSync(join(root, 'db', 'codes.csv'), csv, 'utf8');

const porNivel = LEVELS.map((l) => [l, rows.filter((r) => r.level === l).length]).filter(
  ([, n]) => n > 0
);

console.log(`${total} códigos gerados.`);
for (const [level, n] of porNivel) {
  console.log(`  nível ${String(level).padStart(2)} → ${String(n).padStart(4)} códigos  (${LEVEL_NAMES[level]})`);
}
console.log('  db/seed-codes.sql  → npm run db:seed');
console.log('  db/codes.csv       → lista para distribuir');
console.log(
  labels
    ? 'Rótulos lidos de db/labels.txt (use "Nome, 30" para nível por linha)'
    : 'Rótulos genéricos (crie db/labels.txt para nominais)'
);
