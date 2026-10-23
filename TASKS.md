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
| 1.5 | Criar instância e mostrar QR Code | claude | feito | automático no start + página `/conexao` com senha |
| 1.6 | Monitor de conexão a cada 5 min + alerta | livre | a fazer | alerta por e-mail ou Telegram (a decidir) |
| 1.7 | Baixar mídia (imagem, PDF, áudio) para disco/objeto | livre | a fazer | Evolution: `getBase64FromMediaMessage` |
| 1.8 | HTTPS na frente do app | claude | feito | domínio do Easypanel (Traefik), ver docs/DEPLOY-EASYPANEL.md |
| 1.9 | Deploy na VPS Hostinger (Easypanel) | claude | feito | no ar em 2026-10-23, WhatsApp conectado |
| 1.11 | Página /conexao mostra total e últimas mensagens | claude | em revisão | |
| 1.10 | Backup diário do Postgres para fora da VPS | livre | a fazer | |

## Decisões do Thiago (2026-10-23)

Empresas: Kamex, WTA e Casa Agenciamentos, mais "Pessoal". WhatsApp principal dele.
Grupos entram. Mensagens enviadas por ele também são analisadas. Áudio desde o início,
com transcrição grátis (rodando na VPS). Histórico: importar os últimos 3 meses.
Retenção: 3 a 4 meses. Painel web com resumo diário. A Ana só responde depois do OK dele.

## Fase 2 — Classificação

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 2.1 | Seed: empresas, segmentos e categorias iniciais | livre | a fazer | lista sendo fechada com o Thiago |
| 2.2 | Agrupar mensagens seguidas da mesma conversa (~45 s) | livre | a fazer | |
| 2.3 | Classificador com Claude (saída estruturada, separa Pessoal x empresas) | livre | a fazer | |
| 2.4 | Caixa de revisão (API) | livre | a fazer | |
| 2.5 | Transcrição de áudio grátis na VPS (whisper.cpp, modelo small) | livre | a fazer | KVM 2: 2 vCPU, 8 GB |
| 2.6 | Importar e classificar os últimos 3 meses | livre | a fazer | Evolution: histórico na sincronização |
| 2.7 | Rotina de retenção (apagar mensagens com mais de 4 meses) | livre | a fazer | confirmar 3 ou 4 meses |

## Fase 3 — Painel e respostas

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 3.1 | Painel web com filtros e resumo diário | livre | a fazer | |
| 3.2 | Sugestão de resposta no estilo do Thiago, enviada só após o OK dele | livre | a fazer | regras de risco antes |
