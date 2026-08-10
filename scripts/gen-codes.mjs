/**
 * Gera os códigos de acesso.
 *
 *   node scripts/gen-codes.mjs            → 100 códigos com rótulo genérico
 *   node scripts/gen-codes.mjs 40         → 40 códigos
 *
 * Se existir `db/labels.txt` (um rótulo por linha), cada linha vira um código
 * nominal e a quantidade passa a ser o número de linhas.
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

const labels = existsSync(LABELS_FILE)
  ? readFileSync(LABELS_FILE, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  : null;

const total = labels ? labels.length : Number(process.argv[2] ?? 100);
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
  const label = labels
    ? labels[rows.length]
    : `Convidado ${String(rows.length + 1).padStart(3, '0')}`;
  rows.push({ code, label });
}

const sql = [
  '-- Gerado por scripts/gen-codes.mjs. NÃO COMITAR.',
  `-- ${total} códigos, ${createdAt}`,
  '',
  ...rows.map(
    (r) =>
      `INSERT OR IGNORE INTO codes (code, label, active, created_at) VALUES (${sqlQuote(
        r.code
      )}, ${sqlQuote(r.label)}, 1, ${sqlQuote(createdAt)});`
  ),
  '',
].join('\n');

// Hífen só na apresentação; o que vai para o banco e o que a Function compara
// é sempre a forma sem separador.
const csv = [
  'label,code,code_formatado',
  ...rows.map(
    (r) =>
      `${sqlQuote(r.label).slice(1, -1).replace(/,/g, ' ')},${r.code},${r.code.slice(
        0,
        4
      )}-${r.code.slice(4)}`
  ),
  '',
].join('\n');

writeFileSync(join(root, 'db', 'seed-codes.sql'), sql, 'utf8');
writeFileSync(join(root, 'db', 'codes.csv'), csv, 'utf8');

console.log(`${total} códigos gerados.`);
console.log('  db/seed-codes.sql  → npm run db:seed');
console.log('  db/codes.csv       → lista para distribuir');
console.log(labels ? 'Rótulos lidos de db/labels.txt' : 'Rótulos genéricos (crie db/labels.txt para nominais)');
