# Quadro de tarefas

Regras em `AGENTS.md`. Dono: `livre`, `claude` ou `antigravity`.
Status: `a fazer`, `em andamento`, `em revisão`, `feito`.

## Fase 1 — Conexão e captura

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 1.1 | Docker Compose: Evolution, Postgres, Redis, app | claude | feito | |
| 1.2 | Migração inicial (tabelas do modelo de dados) | claude | feito | `001_inicial.sql` |
| 1.3 | Webhook grava evento bruto e enfileira | claude | feito | |
| 1.4 | Worker grava contatos, conversas e mensagens | claude | feito | texto, legenda, tipo de mídia |
| 1.5 | Scripts: criar instância e mostrar QR Code | claude | feito | `npm run instancia:criar`, `npm run qrcode` |
| 1.6 | Monitor de conexão a cada 5 min + alerta | livre | a fazer | alerta por e-mail ou Telegram (a decidir) |
| 1.7 | Baixar mídia (imagem, PDF, áudio) para disco/objeto | livre | a fazer | Evolution: `getBase64FromMediaMessage` |
| 1.8 | Caddy com HTTPS na frente do webhook | livre | a fazer | depende do domínio |
| 1.9 | Deploy na VPS + backup diário do Postgres | livre | a fazer | depende da VPS escolhida |

## Fase 2 — Classificação (aguarda respostas do Thiago)

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 2.1 | Cadastro inicial de segmentos, empresas, negócios, categorias | livre | a fazer | precisa da lista do Thiago |
| 2.2 | Agrupar mensagens seguidas da mesma conversa (~45 s) | livre | a fazer | |
| 2.3 | Classificador com Claude (saída estruturada) | livre | a fazer | |
| 2.4 | Caixa de revisão (API) | livre | a fazer | |
