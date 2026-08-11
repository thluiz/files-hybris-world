# AGENTS.md — guia para agentes trabalhando neste repositório

Referência de trabalho para qualquer agente (Claude Code ou outro) que for mexer
aqui. Leia antes de editar.

## O que é este projeto

Entrega controlada dos materiais de **Hybris** (Metron Showrunners), em
`files.hybris.world`. Quatro PDFs num bucket R2 **privado**; quem tem um código
válido baixa, e todo acesso é registrado.

Astro 4 estático + **uma** Pages Function de download + **uma** de estatísticas.
Não há SSR, não há framework de UI, não há Tailwind. Se você está prestes a
adicionar uma dependência, releia esta frase.

```
GET  /d/<slug>        página estática com o formulário de código
POST /api/download    valida no D1 → confere o nível → grava em access_log
                      → streama do R2
GET  /stats/<token>   painel de acessos (o token é a credencial)
```

Cada arquivo tem um **nível** (10, 20, 30, 40, na ordem de exposição do
material) e cada código carrega o seu: ele abre todo arquivo de nível igual ou
menor. Nível 0 não abre nada — é assim que se bloqueia um código sem apagá-lo.
A regra mora em `canAccess()`, em `shared/files.ts`, e não deve ser reescrita
de memória em nenhum outro lugar.

Isto **não** é o hotsite. O hotsite (`metron-hotsite` / `metron-hotsite-beta`) é
outro repositório, com outro fluxo de promote. Não misture os dois.

## Regra de ouro: este repositório é público

Consequências que já quase deram errado:

- **Nenhum código de acesso entra no git.** `db/codes.csv`, `db/seed-codes.sql`
  e `db/labels.txt` estão no `.gitignore`. Se você gerar códigos, eles ficam
  fora do versionamento — sempre.
- **Nenhum token entra no código.** O `STATS_TOKEN` vive como secret do Pages
  justamente porque escrevê-lo no fonte entregaria os 100 códigos a quem abrisse
  o GitHub. Mesma regra para `IP_SALT`.
- **Nenhum PDF entra no git.** Eles vivem no R2. O `.gitignore` tem `*.pdf`.

Antes de commitar, rode a verificação da seção *Checklist*.

## O modelo de segurança (o que não pode quebrar)

Cada item abaixo existe por um motivo específico. Se for mexer, entenda o motivo
antes.

| Onde | O quê | Por quê |
|---|---|---|
| `functions/api/download.ts` | `Cache-Control: private, no-store` na resposta do arquivo | sem isso a borda da Cloudflare pode servir o PDF a quem não digitou código |
| idem | freio de 10 tentativas inválidas por IP a cada 15 min | 100 códigos válidos seriam varridos rápido sem isso |
| idem | tentativa inválida também vira linha em `access_log` (`ok = 0`) | é o sinal de que um código vazou e está circulando |
| idem | código barrado pelo nível é `ok = 2`, fora do freio | quem tem código da lista não pode ser trancado por bater numa porta que não é dele; e a estatística separa "pediu demais" de "código vazado" |
| idem | nível 0 devolve a mesma mensagem de código inválido | quem digita um código já bloqueado não precisa saber que ele existiu |
| `shared/files.ts` | `canAccess()` é a única regra de autorização | reescrever a comparação em outro arquivo é como o `>=` vira `>` sem ninguém notar |
| idem | `label` copiado para o log no momento do acesso | revogar ou renomear um código depois não reescreve a história |
| idem | IP guardado só como `SHA-256(IP_SALT + IP)` | agrupa visitante e sustenta o freio sem reter dado pessoal em claro |
| `functions/stats/[token].ts` | token errado devolve **404**, não 403 | quem chutar não descobre que a rota existe |
| idem | comparação sem atalho de tempo | o token não pode ser descoberto caractere a caractere |
| idem | `Referrer-Policy: no-referrer` | a URL **é** o segredo; sem isso ela vaza no `Referer` de qualquer link clicado a partir da página |
| `src/layouts/Layout.astro` | `noindex, nofollow` | material restrito não pode aparecer em buscador |

O caminho do objeto no R2 (`r2Key`) nunca deve chegar ao HTML. Há uma checagem
disso no checklist.

## Onde fica o quê

```
shared/files.ts          Catálogo dos 4 arquivos: slug, título, nível, r2Key,
                         nome de download, mais os níveis e o `canAccess()`.
                         FONTE ÚNICA DE VERDADE — importado tanto pelas páginas
                         quanto pelas Functions. Adicionar um arquivo é editar
                         só este array.
functions/
  api/download.ts        Validação, checagem de nível, log e streaming do R2.
  stats/[token].ts       Painel de acessos, agrupado por nível (HTML em TS).
src/
  pages/d/[slug].astro   As 4 páginas de código, via getStaticPaths.
  pages/index.astro      Página neutra; não lista nada.
  layouts/Layout.astro   <head>, noindex.
  styles/global.css      CSS puro, paleta herdada da key art da Metron.
db/
  schema.sql             Tabelas `codes` e `access_log`. Idempotente. Descreve
                         o banco como ele é hoje; serve para criar do zero.
  migrations/*.sql       Mudanças em banco que já existe. Cada uma roda UMA vez.
  stats.sql              Consultas de leitura (`npm run stats`).
scripts/gen-codes.mjs    Gerador dos códigos (`--level=N`, ou nível por linha
                         em db/labels.txt). Duplica a lista de níveis porque é
                         .mjs e não importa o .ts — mudou lá, mude aqui.
wrangler.toml            Bindings D1 + R2, aplicados no deploy.
```

## Armadilhas do Cloudflare Pages (as que já custaram tempo)

Não são preferências de estilo. Cada uma quebra o deploy ou o site.

1. **`wrangler pages deploy` roda SEM argumento de diretório.** O diretório vem
   do `pages_build_output_dir` no `wrangler.toml`. Passar os dois é erro de
   validação. É esse mesmo campo que faz os bindings (`DB`, `FILES`) serem
   aplicados pelo deploy em vez de configurados à mão no painel.

2. **Não coloque `account_id` no `wrangler.toml`.** Config de Pages não aceita o
   campo (só a de Workers). Como a credencial enxerga mais de uma conta, os
   comandos locais precisam da variável:
   ```
   CLOUDFLARE_ACCOUNT_ID=e8a97d34c66d7538dddf6603cf0089ee
   ```
   Sem ela, o wrangler para com *"More than one account available"*.

3. **O job `pages-deploy` faz `actions/checkout` de propósito.** O wrangler
   compila `functions/` a partir do diretório corrente, e o artifact carrega só
   o `dist/`. Sem o checkout, o site sobe sem as Functions e todo download
   quebra com 405.

4. **As páginas são estáticas — não há query string em tempo de build.** A
   mensagem de erro do formulário chega por `?erro=1` e é revelada por um script
   inline lendo `location.search`. O Astro serve `/d/<slug>/` com barra final e
   a Cloudflare redireciona com 308 preservando a query; isso está testado, mas
   se você mexer no roteamento, teste de novo.

5. **`npm run dev` não serve as Functions.** Para testar download ou estatística
   localmente é `npm run preview` (que é `wrangler pages dev dist`), com
   `.dev.vars` preenchido.

## Como rodar e verificar

```bash
npm install
npm run build     # SEMPRE antes de dar push
npm run preview   # dist/ + Functions + bindings locais
```

Verificação que vale mais que o build, porque o build passa mesmo com a Function
quebrada:

```bash
npx wrangler pages functions build --outfile=.wrangler/test-worker.js
```

E, depois de qualquer mudança em `download.ts` ou `shared/files.ts`, teste
**contra o deploy de verdade** — código válido, código inválido e o cabeçalho da
resposta:

```bash
BASE=https://files-hybris-world.pages.dev
curl -s -o /dev/null -D - -X POST "$BASE/api/download" -d "slug=one-pager" -d "code=INVALIDO" | grep -iE '^HTTP|^location'
# esperado: 303 -> /d/one-pager?erro=1
```

Um teste seu grava linha no `access_log` e aparece no painel. Limpe depois se
for antes de distribuir:

```bash
wrangler d1 execute hybris-files --remote --command="DELETE FROM access_log"
```

## Trocar ou acrescentar um arquivo

1. Suba o PDF: `wrangler r2 object put hybris-files/hybris/<key> --file="..." --content-type=application/pdf`
2. Edite **só** `shared/files.ts` — as páginas, a Function e o painel acompanham
   sozinhos. O `level` do arquivo novo decide quem já pode abri-lo: entrar com
   nível 10 libera o material para todos os códigos existentes de uma vez.
3. `npm run build` e deploy.

Trocando o conteúdo mantendo o mesmo `r2Key`, não há cache a furar: a resposta
já é `no-store`.

## Checklist antes de dar push

1. `npm run build` passou.
2. `npx wrangler pages functions build` compilou.
3. Nenhum código/segredo no diff:
   ```bash
   git ls-files | grep -E 'codes\.csv|seed-codes|labels\.txt|\.dev\.vars$|\.pdf'   # tem que vir vazio
   git grep -nE 'oauth_token|api_token|STATS_TOKEN *= *["'\'']'                    # idem
   ```
4. Nenhuma referência a arquivo ou bucket no HTML público:
   ```bash
   grep -rniE 'r2key|\.pdf|hybris/' dist/    # tem que vir vazio
   ```
5. Testou em viewport mobile — quem recebe esse link costuma abrir no celular.
6. Se mexeu no fluxo de download, testou código válido **e** inválido contra o
   deploy.
7. Mensagem de commit **sem** trailer de co-autoria.
