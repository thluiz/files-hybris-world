# files.hybris.world

Entrega controlada dos materiais de **Hybris** (Metron Showrunners). Cada
arquivo tem uma página de acesso; quem tem um código válido baixa, e todo acesso
fica registrado para estatística.

Os PDFs ficam num bucket **R2 privado** — não existe URL pública para eles. O
arquivo só sai por `POST /api/download`, depois da validação do código.

## Como funciona

```
GET  /d/<slug>        página estática com o formulário de código
POST /api/download    Pages Function:
                        1. valida o código no D1
                        2. grava o evento em access_log
                        3. lê o objeto do R2 e devolve o stream
                      código inválido → 303 de volta para /d/<slug>?erro=1
```

Os 4 arquivos e seus slugs vivem em [`shared/files.ts`](shared/files.ts) — é a
única fonte de verdade, importada tanto pelas páginas quanto pela Function.

| Slug | Arquivo |
|---|---|
| `one-pager` | Hybris — One-Pager |
| `pitch-deck` | Hybris — Pitch Deck |
| `series-bible` | Hybris — Series Bible |
| `season-one-script` | Hybris — Season One Full Script |

## Stack

- Astro 4, output estático (nenhum SSR)
- Cloudflare Pages + Pages Functions
- R2 (arquivos) e D1 (códigos + log)

## A conta da Cloudflare

Tudo vive na conta `Watchyourhybris@gmail.com's Account`
(`e8a97d34c66d7538dddf6603cf0089ee`) — a mesma da zona `hybris.world` e dos dois
hotsites da Metron.

Config de Pages **não aceita** `account_id` no `wrangler.toml`, e a credencial
enxerga mais de uma conta. Então todo comando local precisa da variável:

```bash
export CLOUDFLARE_ACCOUNT_ID=e8a97d34c66d7538dddf6603cf0089ee   # bash
$env:CLOUDFLARE_ACCOUNT_ID = 'e8a97d34c66d7538dddf6603cf0089ee' # pwsh
```

Sem ela o wrangler para com *"More than one account available"*.

## Setup inicial

Já feito, registrado aqui para reconstrução. Requer `wrangler login`.

```bash
# 1. Banco — copie o database_id devolvido para o wrangler.toml
wrangler d1 create hybris-files
npm run db:init

# 2. Códigos de acesso
npm run gen:codes
npm run db:seed

# 3. Projeto Pages e segredo
wrangler pages project create files-hybris-world --production-branch=main
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" \
  | wrangler pages secret put IP_SALT --project-name=files-hybris-world

# 4. Bucket privado e upload dos PDFs — exige R2 ativado na conta
wrangler r2 bucket create hybris-files
wrangler r2 object put hybris-files/hybris/01-one-pager.pdf              --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/02-pitch-deck.pdf             --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/03-series-bible.pdf           --file="..." --content-type=application/pdf
wrangler r2 object put hybris-files/hybris/04-season-one-full-script.pdf --file="..." --content-type=application/pdf
```

Os bindings `DB` e `FILES` **não** são configurados no painel: eles vivem no
[`wrangler.toml`](wrangler.toml) e são aplicados pelo próprio deploy, graças ao
campo `pages_build_output_dir`. Mudou binding, é só publicar de novo.

O `IP_SALT` é a exceção — segredo não vai para arquivo versionado, vai por
`wrangler pages secret put` (uma vez para `production`, outra com `--env=preview`).

Falta ainda, no painel: o custom domain `files.hybris.world` (Pages project →
*Custom domains*), que o wrangler 3 não sabe criar. E, no GitHub,
os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

## Desenvolvimento

```bash
npm install
npm run dev      # só as páginas; /api/download não responde neste modo
npm run build
npm run preview  # dist/ + Functions + bindings locais — é aqui que se testa o download
```

Para o `preview` funcionar, crie um `.dev.vars` (fora do git) com:

```
IP_SALT=qualquer-coisa-para-teste
```

e popule o banco local com `npm run db:init:local` e `npm run db:seed:local`.

## Códigos de acesso

- 8 caracteres do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem `I`, `O`,
  `0`, `1`, que se confundem quando alguém digita a partir de um email).
- Gerados com `randomInt` do `node:crypto`.
- Um código dá acesso aos **4 arquivos**, quantas vezes quiser.
- Aceita digitação com hífen, espaço ou minúscula — a Function normaliza.

**`db/codes.csv` e `db/seed-codes.sql` estão no `.gitignore` e não podem ser
commitados — este repositório é público.** Guarde o CSV num lugar seguro; é a
sua única cópia da relação código ↔ pessoa.

Para revogar um código:

```bash
wrangler d1 execute hybris-files --remote \
  --command="UPDATE codes SET active = 0 WHERE code = 'XXXXXXXX'"
```

## Estatísticas

```bash
npm run stats
```

Roda as consultas de [`db/stats.sql`](db/stats.sql): downloads por arquivo, quem
baixou o quê, códigos entregues que nunca foram usados, e tentativas inválidas
por dia.

O log guarda `label` copiado no momento do acesso, então revogar ou renomear um
código depois não reescreve o histórico. Tentativas inválidas também são
registradas — é o que denuncia um código circulando fora da lista.

Não guardamos IP: o campo `ip_hash` é `SHA-256(IP_SALT + IP)`, o suficiente para
agrupar um mesmo visitante e sustentar o freio de força bruta (10 tentativas
inválidas por IP a cada 15 minutos).

## Deploy

Push na `main` dispara `.github/workflows/deploy.yml`, que builda o Astro e
publica no Cloudflare Pages.

Dois detalhes do workflow que parecem supérfluos e não são:

- O job de deploy faz `actions/checkout` **de propósito**: o wrangler compila
  `functions/` a partir do diretório corrente, e o artifact carrega apenas o
  `dist/`. Sem o checkout, o site subiria sem a Function e todo download
  quebraria com 405.
- O `pages deploy` roda **sem argumento de diretório**. O diretório vem do
  `pages_build_output_dir`; passar os dois é erro de validação.
