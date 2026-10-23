# Ana — Secretária Executiva IA

Assistente que roda 24h, recebe as mensagens do seu WhatsApp pelo Evolution API e as
organiza por empresa, negócio, segmento e categoria.

- Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Regras para agentes (Claude Code, Antigravity): [AGENTS.md](AGENTS.md)
- Quadro de tarefas: [TASKS.md](TASKS.md)

## Estado atual: Fase 1 (conexão e captura)

Pronto: Evolution conectado por QR Code, webhook gravando cada evento, fila com retries,
e o worker gravando contatos, conversas e mensagens no Postgres. A classificação com IA
é a Fase 2.

## Subir na VPS (Hostinger + Easypanel)

Passo a passo completo em [docs/DEPLOY-EASYPANEL.md](docs/DEPLOY-EASYPANEL.md). Resumo:
serviço Compose no Easypanel apontando para este repositório, variáveis do
`.env.example` preenchidas, domínio HTTPS no serviço `app` (porta 3100).

## Conectar o WhatsApp (QR Code)

Abra `https://SEU-DOMINIO/conexao`, entre com a `PAINEL_SENHA` e escaneie o QR Code em
WhatsApp > Aparelhos conectados > Conectar aparelho. O app cria a instância no Evolution
sozinho na primeira vez.

## Rodar local

```bash
cp .env.example .env   # e troque os valores "troque-..."
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
# página de conexão em http://localhost:3100/conexao
```

## Ver as mensagens chegando

```bash
docker compose exec postgres psql -U ana -d ana -c \
  "select recebida_em, tipo, left(texto, 60) from mensagens order by recebida_em desc limit 20"
```

## Ignorar ou só arquivar uma conversa

```sql
update conversas set modo = 'ignorar'  where jid = '5511...@s.whatsapp.net'; -- não grava nada
update conversas set modo = 'arquivar' where jid = '1203...@g.us';           -- grava, não classifica
```

## Desenvolvimento

```bash
cd app && npm install
npm run typecheck && npm test
```
