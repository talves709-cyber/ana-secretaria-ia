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

## Subir na VPS

Requisitos: Docker e Docker Compose.

```bash
git clone <este repositório> ana && cd ana
cp .env.example .env
# edite o .env: troque todos os "troque-..." (openssl rand -hex 32 gera valores bons)
docker compose up -d --build
docker compose logs -f app      # deve mostrar "Migrações aplicadas" e o servidor ouvindo
```

## Conectar o WhatsApp (QR Code)

```bash
docker compose exec app node dist/scripts/criar-instancia.js   # só na primeira vez
docker compose exec app node dist/scripts/qrcode.js            # mostra o QR no terminal
```

No celular: WhatsApp > Aparelhos conectados > Conectar aparelho, e escaneie. Se o QR
expirar, rode `qrcode.js` de novo. Para conferir:

```bash
docker compose exec postgres psql -U ana -d ana -c "select * from estado_conexao"
# estado = open  → conectado
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
