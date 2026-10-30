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
| 1.10 | Backup diário do Postgres para fora da VPS | claude | em revisão | serviço `backup` para o Google Drive; falta gerar o token do Drive |

## Decisões do Thiago (2026-10-23)

Empresas: Kas Agenciamentos (agenciamento de carga e despacho aduaneiro, dona das demais), Kamex Trading (importação/exportação, unidades ES e SC, marcas de produtos elétricos) e WTA Logistics (transporte, DTA, armazém geral e alfandegado), mais "Pessoal". WhatsApp principal dele.
Grupos entram. Mensagens enviadas por ele também são analisadas. Áudio desde o início,
com transcrição grátis (rodando na VPS). Histórico: importar os últimos 3 meses.
Retenção: 3 a 4 meses. Painel web com resumo diário. A Ana só responde depois do OK dele.

## Fase 2 — Classificação

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 2.1 | Seed: empresas, segmentos e categorias iniciais | claude | feito | PR #3 |
| 2.2 | Agrupar mensagens seguidas da mesma conversa (~45 s) | claude | feito | PR #4 |
| 2.3 | Classificador com Claude (saída estruturada, separa Pessoal x empresas) | claude | feito | PR #4 |
| 2.4 | Caixa de revisão (API) | livre | a fazer | |
| 2.5 | Transcrição de áudio grátis na VPS (whisper.cpp, modelo small) | livre | a fazer | KVM 2: 2 vCPU, 8 GB |
| 2.6 | Importar e classificar os últimos 3 meses | livre | a fazer | Evolution: histórico na sincronização |
| 2.7 | Rotina de retenção (apagar mensagens com mais de 4 meses) | livre | a fazer | confirmar 3 ou 4 meses |

## Fase 3 — Painel e respostas

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 3.1 | Painel web com filtros e resumo diário | claude | em andamento | `/painel`: resumo do dia + últimas classificações + caixa de revisão |
| 3.2 | Sugestão de resposta no estilo do Thiago, enviada só após o OK dele | livre | a fazer | regras de risco antes |

## Secretária executiva multiagente (especificação 2026-10-27)

| # | Tarefa | Dono | Status | Notas |
|---|---|---|---|---|
| 4.0 | Especificação + Bíblia | claude | em revisão | `docs/superpowers/specs/2026-10-27-secretaria-executiva-multiagente-design.md`, `docs/BIBLIA.md` |
| 4.1 | Parte 0: login do painel (`/entrar`, sessão assinada) | claude | em revisão | |
| 4.2 | Parte 1: demandas, CRM, especialista, custo de IA | claude | em revisão | migração `003` |
| 4.3 | Parte 1: comandos do Thiago, Executor de envio, pacotes e silêncio | claude | em revisão | |
| 4.4 | Parte 1: painel do pipeline, ficha do cliente, bases | claude | em revisão | `/painel/pipeline` |
| 4.5 | Primeira subida das Partes 0 e 1 e teste de fumaça com o Thiago | livre | a fazer | roteiro em `docs/DEPLOY-EASYPANEL.md`; checar notificação no celular |
| 4.6 | Firewall da VPS (Task 3) | livre | a fazer | aguarda o IP do Thiago |
| 4.7 | Token do Google Drive para o backup | livre | a fazer | `rclone authorize`, ver deploy |
| 4.8 | Parte 2: agenda e lembretes (inclui "Agendado com data passada") | livre | a fazer | depende de autorização Microsoft/Google |
| 4.9 | Parte 3: resumos 8h30 e 18h, cobranças, rotinas | livre | a fazer | |
| 4.10 | Parte 4: e-mail e mesclagem de clientes duplicados | livre | a fazer | depende de autorização Microsoft (TI) |
| 4.11 | Parte 5: reuniões; Parte 6: GEO/SEO | livre | a fazer | |
