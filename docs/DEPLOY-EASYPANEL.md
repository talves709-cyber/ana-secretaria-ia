# Deploy na VPS Hostinger com Easypanel

A VPS usa o modelo "Ubuntu 24.04 with Easypanel". O deploy é um serviço **Compose** do
Easypanel apontando para este repositório. Leva uns 15 minutos na primeira vez.

## 1. Criar o serviço

1. Abra o Easypanel da VPS (pelo hPanel da Hostinger: VPS > Gerenciar > botão do
   Easypanel, ou `http://IP-DA-VPS:3000`).
2. **Create project** com o nome `ana`.
3. Dentro do projeto: **New Service > Compose**, nome `ana`.
4. Em **Source**, escolha **Git** e preencha:
   - Repository URL: `git@github.com:talves709-cyber/ana-secretaria-ia.git`
   - Branch: `main`
   - Build Path: `/`
   - Docker Compose File: `docker-compose.yml`
5. O repositório é privado: copie a **chave SSH** que o Easypanel mostra nessa tela e
   cadastre no GitHub em *Settings > Deploy keys > Add deploy key* (só leitura).

## 2. Variáveis de ambiente

Na aba **Environment** o Easypanel já traz o conteúdo do `.env.example`. Troque cada valor
que começa com `troque-` (o app recusa subir se esquecer algum) e marque
**Create .env file**.

Para gerar valores fortes, qualquer gerador de senha serve, ou no terminal:
`openssl rand -hex 32`.

| Variável | O que é |
| --- | --- |
| `POSTGRES_PASSWORD` | Senha do banco |
| `EVOLUTION_API_KEY` | Chave da API do Evolution (mín. 16 caracteres) |
| `WEBHOOK_TOKEN` | Token que o Evolution envia ao webhook (mín. 16) |
| `PAINEL_SENHA` | Senha de login do painel (mín. 12) |
| `SESSAO_SEGREDO` | Segredo que assina o cookie de sessão do painel (mín. 32; `openssl rand -hex 32`) |

Deixe `EVOLUTION_PUBLIC_URL` e `WEBHOOK_URL` como estão: eles usam a rede interna.

## 3. Deploy

Clique em **Deploy**. Na aba de logs, o app deve mostrar `Migrações aplicadas` e depois
`Instância ana: criada` (o app cria a instância no Evolution sozinho).

## 4. Domínio com HTTPS

Em **Domains > Add domain**: serviço `app`, porta `3100`, HTTPS ligado. Pode usar o
domínio gratuito que o Easypanel sugere ou um subdomínio seu (ex.: `ana.seudominio.com.br`,
com um registro A apontando para o IP da VPS).

A porta do app (`3100`) não pode ser publicada fora do Traefik: o app confia em um salto de
proxy (`X-Forwarded-For`) para descobrir o IP de quem tenta entrar no painel. Exposta direto,
o limite de tentativas poderia ser burlado.

Só o `app` recebe domínio. Evolution, Postgres e Redis ficam só na rede interna.

## 5. Conectar o WhatsApp

Abra `https://SEU-DOMINIO/conexao`. O navegador abre a página de login: digite a `PAINEL_SENHA`
(a sessão dura 12 horas). Escaneie o QR Code em
*WhatsApp > Aparelhos conectados > Conectar aparelho*. A página atualiza sozinha e mostra
"WhatsApp conectado" quando terminar.

## 6. Backup diário do banco (Google Drive)

O serviço `backup` roda todo dia às **03:00 (America/Sao_Paulo)**: faz `pg_dump | gzip` do
banco `ana`, grava `ana-AAAA-MM-DD-HHMM.sql.gz` na pasta do Google Drive e apaga os
arquivos com mais de 30 dias. Se algo falhar, o erro aparece nos logs do serviço `backup`.

### Gerar o token do Drive (uma vez, no seu PC)

1. Instale o [rclone](https://rclone.org/downloads/) no PC.
2. No terminal: `rclone authorize "drive" "" "" "" "drive.file"` (o escopo `drive.file` limita
   o acesso aos arquivos criados pelo próprio backup). Se a sua versão não aceitar os
   argumentos extras, use só `rclone authorize "drive"`.
3. O navegador abre; entre na conta do Google dono do Drive e autorize.
4. O terminal mostra um JSON entre `Paste the following into your remote machine --->` e
   `<---End paste`. Copie esse JSON em uma linha só.
5. No Easypanel, aba **Environment**, cole em `RCLONE_CONFIG_GDRIVE_TOKEN` (troque o
   `troque-token-rclone-drive`). Mantenha `BACKUP_DESTINO=gdrive:ana-backups`; a pasta
   `ana-backups` é criada no primeiro envio. Faça o **Deploy**.

O token se renova sozinho. Se um dia o acesso for revogado, gere outro e cole de novo.

### Testar na hora

No Easypanel, abra o console do serviço `backup` e rode `/backup.sh`. Deve terminar com
`[backup] ok: ana-....sql.gz` e o arquivo aparecer na pasta do Drive.

### Restaurar

1. Baixe o arquivo escolhido da pasta `ana-backups` do Drive (ou, no console do serviço
   `backup`: `rclone copy gdrive:ana-backups/ana-AAAA-MM-DD-HHMM.sql.gz /tmp/`).
2. Pare o `app` e o `evolution` para ninguém gravar durante a restauração.
3. Para restaurar sobre um banco limpo, no console do serviço `backup`:

   ```bash
   export PGHOST=postgres PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD"
   dropdb ana && createdb ana
   gunzip -c /tmp/ana-AAAA-MM-DD-HHMM.sql.gz | psql -v ON_ERROR_STOP=1 ana
   ```

4. Suba o `app` e o `evolution` de novo.

## Primeira subida das Partes 0 e 1

Roteiro para quem faz o merge e o deploy das Partes 0 e 1 (login, backup, demandas e CRM,
comandos pelo WhatsApp, pacotes de pedidos, painel do pipeline).

### Variáveis novas no Environment

Cole na aba **Environment** (só os nomes aqui; valores no Easypanel). Segredos: `openssl rand -hex 32`.

| Variável | O que faz | Valor |
| --- | --- | --- |
| `SESSAO_SEGREDO` | assina o cookie do painel | segredo novo (`openssl rand -hex 32`) |
| `DONO_WHATSAPP` | número do Thiago, só dígitos com DDI; vazio desliga comandos e avisos | o número do WhatsApp dele |
| `DONO_JIDS_EXTRA` | identificadores `...@lid` da conversa dele consigo mesmo, se o WhatsApp usar | vazio; preencher só se os comandos não forem reconhecidos |
| `CLAUDE_MODELO_ESPECIALISTA` | modelo do especialista | `claude-opus-5-5` |
| `CLAUDE_ESFORCO_ESPECIALISTA` | esforço do especialista | `medium` |
| `IA_LIMITE_MENSAL_USD` | teto mensal de IA, com aviso a 80% | a decidir (exemplo no `.env.example`) |
| `SILENCIO_INICIO`, `SILENCIO_FIM` | silêncio da Ana, hora cheia | `19` e `8` |
| `BACKUP_DESTINO` | pasta do backup | `gdrive:ana-backups` |
| `RCLONE_CONFIG_GDRIVE_TYPE` | tipo do remote | `drive` |
| `RCLONE_CONFIG_GDRIVE_SCOPE` | escopo | `drive.file` |
| `RCLONE_CONFIG_GDRIVE_TOKEN` | token do Drive | JSON do passo abaixo |
| `RCLONE_CONFIG_GDRIVE_CLIENT_ID`, `..._CLIENT_SECRET` | credenciais OAuth próprias (opcional) | vazio |

### Passo do token do Google Drive

Siga a seção 6 (`rclone authorize` no PC, colar o JSON em `RCLONE_CONFIG_GDRIVE_TOKEN`) e
rode `/backup.sh` no console do serviço `backup`. Deve terminar com `[backup] ok` e o
arquivo aparecer na pasta do Drive.

### Subida

1. Faça o merge na `main` e clique em **Deploy**. Nos logs do `app`: `Migrações aplicadas`
   (a `003` entra aqui).
2. Confira que o `backup` subiu sem erro.

### Teste de fumaça guiado (com o Thiago)

1. Abrir `/painel` no domínio do painel: deve cair em `/entrar`. Entrar com a senha.
2. Pedir a alguém de confiança que mande uma mensagem de teste em conversa individual.
3. Em até cerca de 1 minuto aparece o cartão em **Novo** em `/painel/pipeline`. Fora do
   silêncio (19h às 8h, fins de semana e feriados), em até 5 minutos chega o pacote "Ana:" na
   conversa do Thiago consigo mesmo.
   **Conferir no celular se essa mensagem notifica.** Mensagem enviada por aparelho conectado
   para a própria conversa pode não gerar notificação. Se não notificar, anotar na Bíblia
   (pendências) e discutir um número próprio para a Ana.
4. Responder `ok <N>`: a resposta sai na conversa de teste e o cartão vai para **Concluído**.
5. Testar `<N> muda: ...` (nova versão e pedido de confirmação) e um texto livre com "sim".
6. Se os comandos não forem reconhecidos, ver nos logs o identificador da conversa dele e
   colocar em `DONO_JIDS_EXTRA`.

## Atualizar depois

A cada merge na `main`, clique em **Deploy** no Easypanel (ou ligue o deploy automático
pelo webhook de deploy do Easypanel no GitHub).
