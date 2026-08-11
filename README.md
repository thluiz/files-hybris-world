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
                        2. confere se o nível dele alcança o arquivo
                        3. grava o evento em access_log
                        4. lê o objeto do R2 e devolve o stream
                      código inválido → 303 para /d/<slug>?erro=1
                      nível insuficiente → 303 para /d/<slug>?erro=nivel
```

Os 4 arquivos, seus slugs e seus níveis vivem em
[`shared/files.ts`](shared/files.ts) — é a única fonte de verdade, importada
tanto pelas páginas quanto pelas Functions.

| Nível | Slug | Arquivo |
|---|---|---|
| 10 | `one-pager` | Hybris — One-Pager |
| 20 | `pitch-deck` | Hybris — Pitch Deck |
| 30 | `series-bible` | Hybris — Series Bible |
| 40 | `season-one-script` | Hybris — Season One Full Script |

## Níveis de acesso

Cada código carrega um nível e abre **todo arquivo de nível igual ou menor**.
A escada acompanha a ordem de exposição do material: o one-pager se mostra a
qualquer interessado, o roteiro completo a quase ninguém.

| Nível | Abre |
|---|---|
| 0 | nada — é assim que se bloqueia um código |
| 10 | One-Pager |
| 20 | One-Pager, Pitch Deck |
| 30 | One-Pager, Pitch Deck, Series Bible |
| 40 | os quatro |

O nível 0 substituiu a coluna `active`: bloquear é zerar o nível. O código
continua na tabela, e o histórico dele no `access_log` continua fazendo
sentido. Os saltos de 10 em 10 deixam espaço para um nível intermediário no
futuro sem renumerar o que já foi distribuído.

Um código legítimo barrado pelo nível é registrado com `ok = 2`, separado das
tentativas inválidas (`ok = 0`): não é código vazado, é alguém pedindo material
que não recebeu. Por isso também **não** conta no freio de força bruta — quem
tem código da lista não pode ser trancado por bater numa porta que não é dele.

Quem digita um código de nível 0 vê a mesma mensagem de código inválido: não há
por que informar que aquele código já existiu.

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

### Migrações

`db/schema.sql` descreve o banco como ele é hoje e serve para criar do zero.
Banco que já existe muda por arquivo em `db/migrations/`, cada um rodado **uma
vez só**:

A troca de `codes.active` por `codes.level` vem em três arquivos, e **a ordem
importa**: entre a migração e o deploy há uma versão do site no ar lendo a
coluna antiga.

```bash
# 1. ANTES do deploy — só acrescenta. Todo código ativo vira nível 40, que é
#    exatamente o acesso que ele já tinha. O site atual continua funcionando.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-access-levels.sql

# 2. Divide os 100 códigos genéricos em quatro faixas de 25 (10/20/30/40).
#    Códigos zerados de propósito continuam zerados.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-split-existing-levels.sql

# 3. DEPOIS do deploy, com o site novo testado: apaga a coluna antiga.
wrangler d1 execute hybris-files --remote --file=db/migrations/2026-08-11-drop-active.sql
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
- Um código abre os arquivos até o **nível** dele, quantas vezes quiser.
- Aceita digitação com hífen, espaço ou minúscula — a Function normaliza.

```bash
npm run gen:codes                    # 100 códigos de nível 10
node scripts/gen-codes.mjs 40 --level=30
```

Com `db/labels.txt` (um rótulo por linha) os códigos saem nominais, e o nível
pode vir por linha — o `--level` vale para as que não trouxerem o seu:

```
Ana Souza, 40
Produtora X, 20
Contato de festival
```

O default é o nível mais baixo de propósito: subir um código depois é um
`UPDATE`; recolher material que já foi baixado não é.

**`db/codes.csv`, `db/seed-codes.sql` e `db/labels.txt` estão no `.gitignore` e
não podem ser commitados — este repositório é público.** Guarde o CSV num lugar
seguro; é a sua única cópia da relação código ↔ pessoa ↔ nível.

Para bloquear um código, ou mudar o nível dele:

```bash
wrangler d1 execute hybris-files --remote \
  --command="UPDATE codes SET level = 0  WHERE code = 'XXXXXXXX'"   # bloqueia
wrangler d1 execute hybris-files --remote \
  --command="UPDATE codes SET level = 30 WHERE code = 'XXXXXXXX'"   # promove
```

A mudança vale no acesso seguinte: o nível é lido a cada `POST`, não há sessão
nem cache no meio.

## Estatísticas

### Painel no navegador

```
https://files.hybris.world/stats/<STATS_TOKEN>
```

Mostra os totais, os downloads por arquivo e os códigos **agrupados por nível
de acesso** — cada grupo diz quais arquivos aquele nível abre, e lista quantos
downloads, quantos daqueles arquivos e o último acesso de cada código. Códigos
nunca usados aparecem esmaecidos; o grupo do nível 0 (bloqueados) só aparece
quando há alguém nele.

Cada grupo dobra num accordion, com atalhos para expandir ou recolher todos. O
HTML sai do servidor com tudo aberto e quem recolhe é o script, no
carregamento: sem JavaScript a página continua inteira e legível, só não dobra.

**A URL é a credencial.** O token esperado vive no secret `STATS_TOKEN`, nunca
no código — este repositório é público. Token errado devolve `404`, não `403`,
para não confirmar que o caminho existe.

Como a página lista os códigos em claro, ela responde com `no-store`,
`noindex` e `Referrer-Policy: no-referrer` — sem essa última, a URL secreta
viajaria no `Referer` de qualquer link clicado a partir dela.

A entropia do token é a defesa principal, mas não a única: cada token errado é
gravado com `ok = 3` (o slug-sentinela `__stats__`) e, depois de 10 erros por
IP em 15 minutos, o IP é trancado. O bloqueio também responde `404`, para não
confirmar que a rota existe nem quando o freio está ativo.

Para trocar o token:

```bash
printf 'NOVO_TOKEN' | wrangler pages secret put STATS_TOKEN --project-name=files-hybris-world
```

### Pela linha de comando

```bash
npm run stats
```

Roda as consultas de [`db/stats.sql`](db/stats.sql): downloads por arquivo, quem
baixou o quê, códigos entregues que nunca foram usados, quantos códigos há em
cada nível, tentativas inválidas por dia e quem bateu num arquivo acima do
próprio nível.

O log guarda `label` copiado no momento do acesso, então revogar ou renomear um
código depois não reescreve o histórico. Tentativas inválidas também são
registradas — é o que denuncia um código circulando fora da lista.

Não guardamos IP: o campo `ip_hash` é `SHA-256(IP_SALT + IP)`, o suficiente para
agrupar um mesmo visitante e sustentar o freio de força bruta (10 tentativas
inválidas por IP a cada 15 minutos).

## Segurança

Análise do controle de acesso (2026-08-11). A pergunta: há como obter os
arquivos sem um código cadastrado?

Pela lógica da aplicação, não. O que segura:

- O objeto R2 nunca é exposto: sai como stream por `POST /api/download`, sem URL
  pública nem redirect assinado.
- **O bucket `hybris-files` é privado** (verificado). As `r2Key` são previsíveis
  (`hybris/01-one-pager.pdf` … `04-…`) e este repositório é público, então um
  bucket público entregaria tudo direto. Ele tem de continuar privado: antes de
  qualquer mudança no R2, reconfirmar que não há *Public access (r2.dev)* nem
  custom domain apontando para o bucket.
- SQL sempre parametrizado (sem injection). O `slug` vem de `FILE_BY_SLUG`, nunca
  direto na query.
- `Cache-Control: private, no-store` no download impede a borda da Cloudflare de
  servir o arquivo a quem não digitou código.
- Nível default 0 (fail-closed): um `INSERT` que esqueça a coluna não abre nada.
- Códigos com `crypto.randomInt`, ~40 bits de entropia (32⁸). É a entropia que
  segura o brute force, não o freio de 10 tentativas por IP a cada 15 min: esse
  freio usa o `ip_hash` como chave, e um atacante com rotação de IP o ignora.

### Endurecimento pendente

Por ordem de retorno:

1. **Preview compartilha produção.** `env.preview` no `wrangler.toml` aponta para
   o mesmo D1 e o mesmo R2. Preview deployments (`<hash>.files-hybris-world.pages.dev`)
   são públicos por padrão, então os arquivos reais ficam acessíveis por eles com
   os códigos reais. Ligar **Cloudflare Access** nos previews, ou apontar o
   preview para um bucket/DB descartável.
2. **A URL de `/stats` é chave-mestra.** Lista todos os códigos em claro e não
   expira. A adivinhação do token já tem freio (10 erros por IP em 15 min,
   `ok = 3`), mas o freio não protege contra vazamento da URL certa: se ela
   escapar, todos os códigos vão junto, sem alarme. Manter `STATS_TOKEN` com ≥32
   chars aleatórios e considerar mascarar os códigos no painel (só os últimos
   dígitos).
3. **Dois bugs no sistema de acesso** (não são brechas, mas quebram função):
   - `scripts/gen-codes.mjs` ainda faz `INSERT` com a coluna `active`, removida na
     migração `2026-08-11-access-levels.sql`, então o seed de códigos novos falha.
     Trocar por `level`.
   - `functions/stats/[token].ts` referencia `r.active` (inexistente), então toda
     linha do painel aparece como "revogado". Deveria ser `r.level <= 0`.
4. **`account_id` versionado.** Não é segredo, mas num repo público entrega
   conta, projeto e nomes exatos para um ataque direcionado.

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
