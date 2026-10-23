# AGENTS.md — regras para qualquer agente (Claude Code, Antigravity, outros)

Este arquivo é a fonte única de regras do projeto. Claude Code e Antigravity trabalham no
mesmo repositório, às vezes ao mesmo tempo. Leia tudo antes de mudar código.

## O projeto

Ana é uma assistente que roda 24h, recebe as mensagens do WhatsApp do Thiago pelo
Evolution API e organiza cada uma por empresa, negócio, segmento e categoria.
Arquitetura completa: `docs/ARQUITETURA.md`.

## Pilha

- Node.js 22 + TypeScript (ESM), Fastify no webhook, BullMQ + Redis na fila
- PostgreSQL 16 com SQL puro (`pg`), migrações numeradas em `app/migrations/`
- Evolution API v2 (imagem `evoapicloud/evolution-api`, versão fixada no compose)
- IA: SDK oficial `@anthropic-ai/sdk` (fase 2)
- Testes: Vitest

## Comandos

```bash
cd app
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run dev         # webhook + worker em modo desenvolvimento
docker compose up -d   # na raiz: sobe tudo
```

## Trabalho em paralelo (Claude Code + Antigravity)

1. **TASKS.md é o quadro.** Antes de começar, escolha uma tarefa com dono `livre`, troque
   para o seu nome (`claude` ou `antigravity`) e faça commit disso primeiro.
2. **Uma branch por agente e tarefa:** `claude/<tarefa>` ou `antigravity/<tarefa>`.
   Nunca faça commit direto na `main`.
3. **Não mexa em tarefa de outro agente.** Se precisar de algo dela, anote em TASKS.md.
4. **PR pequeno e com testes.** `npm run typecheck` e `npm test` passando antes do PR.
5. **Antes de começar e antes do PR:** `git fetch origin && git rebase origin/main`.
6. **Migrações:** nunca edite uma migração já na `main`; crie a próxima número.
   Antes de criar, confira o maior número na `main` para não colidir.
7. **Ao parar no meio** (limite de uso, fim do dia): faça commit do que tem na sua
   branch, `git push`, e escreva em TASKS.md o ponto exato onde parou. O outro agente
   continua daí.

## Convenções

- Código e nomes de tabela em português sem acento (`mensagens`, `empresas`), como no doc.
- Segredos só em `.env` (nunca commitado). Novas variáveis vão também no `.env.example`.
- O webhook responde rápido: grava o evento bruto e enfileira. Nada de chamada à IA nele.
- Toda escrita de mensagem é idempotente (`whatsapp_msg_id` único).
- Comentários e mensagens de commit em português.
