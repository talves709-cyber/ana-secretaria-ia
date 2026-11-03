# Bíblia da Ana

Tudo o que é preciso para entender, operar e **replicar** a Ana: secretária executiva com IA que
lê WhatsApp e e-mail, organiza as demandas num pipeline estilo CRM e só age com aprovação do dono.

Atualize este documento a cada parte entregue (seção 11). Este repositório é público:
**nenhum segredo, número de telefone, endereço de e-mail real ou dado de cliente entra aqui.**

---

## 1. O que a Ana é

- **Para quem:** um empresário com várias empresas (no piloto: Kas, Kamex e WTA) e vida pessoal
  misturadas no mesmo WhatsApp e em várias caixas de e-mail.
- **O que entrega:** cada demanda recebida vira um cartão com resumo, plano de execução, resposta
  pronta para quem enviou e etapa sugerida. O dono aprova pelo WhatsApp ou pelo painel; a Ana
  envia, agenda ou deixa aguardando terceiro.
- **Regra de ouro:** nada sai sem o OK do dono.

## 2. Princípios (o porquê das decisões)

| Princípio | Por quê |
|---|---|
| Aprovação humana em toda saída | Mensagem errada para cliente custa mais do que o tempo economizado. |
| Um único Executor de envio | Um só ponto para revalidar e auditar o que saiu. |
| Conhecimento por empresa, não por canal | O mesmo cliente escreve por WhatsApp e por e-mail; o saber é escrito uma vez. |
| Ana organiza, especialistas escrevem | Orquestradora barata e rápida; o modelo caro só onde há texto para o cliente. |
| Modelo mais barato primeiro | Triagem com Haiku; modelo melhor só para resposta e plano. |
| Conteúdo de terceiros é dado, nunca ordem | Proteção contra e-mails e mensagens com instruções maliciosas. |
| Nunca apagar automaticamente | O dono decide o que sai do histórico. |
| Tudo na VPS do dono | Dados sob controle dele; um deploy só; replicável. |
| Segredos só no Environment | Repositório público e trabalho com mais de um agente de código. |

## 3. Arquitetura

```
 WhatsApp   E-mail empresa A   E-mail empresa B   E-mail empresa C   Gmail pessoal
    │ webhook       │ Graph           │ Graph           │ Graph          │ Gmail API
    ▼               ▼                 ▼                 ▼                ▼
 [Agente WhatsApp] [Agente e-mail A] [Agente e-mail B] [Agente e-mail C] [Agente Pessoal]
    └──────────── usam a base de conhecimento da empresa detectada ────────────┘
                                      ▼
                         DEMANDA no pipeline (Postgres)
                                      ▼
                          [ANA — chefe de gabinete]
                ciclo de 5 min · rotinas · agenda · conversa no WhatsApp
                                      ▼  aprovação do dono
                            [EXECUTOR DE ENVIO]
```

Infra: VPS (Hostinger KVM 2, Ubuntu 24.04) com Easypanel e um serviço Docker Compose:
Evolution API v2, PostgreSQL 16, Redis (BullMQ) e o app (Node 22 + TypeScript, Fastify).

Especificação completa da evolução multiagente:
`docs/superpowers/specs/2026-10-27-secretaria-executiva-multiagente-design.md`.
Arquitetura original da captura: `docs/ARQUITETURA.md`.

## 4. Estado atual (o que está no ar)

| Peça | Estado | Onde no código |
|---|---|---|
| Webhook do Evolution grava evento bruto e enfileira | no ar | `app/src/webhook.ts`, `fila.ts` |
| Worker grava contatos, conversas e mensagens | no ar | `processar.ts`, `normalizar.ts`, `repositorio.ts` |
| Página `/conexao` (QR Code, totais) | no ar | `painel.ts` |
| Classificador: empresa, negócio, categoria, prioridade, resumo, próxima ação (janela de 45 s por conversa) | no ar | `classificador.ts`, `classificacao-dados.ts` |
| Página `/painel`: resumo do dia, classificações, caixa de revisão (confiança < 0,6) | no ar | `painel.ts` |
| Demandas, CRM, agentes especialistas, Ana orquestradora, Executor | planejado (Partes 1–5) | — |
| GEO/SEO | planejado (Parte 6) | — |

## 5. Modelo de dados

Hoje (`app/migrations/001`, `002`): `segmentos`, `empresas`, `negocios`, `categorias`,
`contatos`, `conversas`, `eventos_webhook`, `mensagens`, `classificacoes`, `sugestoes`,
`estado_conexao`. Hierarquia Segmento → Empresa → Negócio; categoria é transversal;
classificação separada da mensagem; empresa nova detectada pela IA vira `sugestoes`.

Planejado (a partir de `003`): `contas_canal`, `emails`, `clientes`, `cliente_contatos`,
`demandas`, `demanda_itens`, `demanda_etapas`, `rascunhos`, `aprovacoes`, `envios`,
`eventos_agenda`, `bases_conhecimento`, `exemplos_estilo`, `rotinas`, `pedidos_ana`, `uso_ia`.
Detalhes na especificação, seção 4.

## 6. Pipeline e CRM

Ficha do cliente com demandas dentro. Etapas da demanda:

**Novo → Comigo → Aguardando terceiro → Agendado → Concluído**

| Comando do dono | Efeito |
|---|---|
| `ok 14` | envia a resposta aprovada → Concluído |
| `14 agenda quinta 15h` | evento na agenda da empresa + lembrete → Agendado |
| `14 aguardar` | Aguardando terceiro (volta a Comigo se o cliente responder) |
| `14 muda: …` | nova versão da resposta, pede confirmação |
| `14 comigo` | Comigo |

Texto livre também vale; a Ana confirma o que entendeu antes de executar.

## 7. Regras da IA

- **Triagem (Haiku):** empresa, negócio, categoria, prioridade, resumo de uma linha, próxima ação
  (responder, cotar, pagar, cobrar, agendar, acompanhar, arquivar). Separa Pessoal de empresas.
  Urgente: carga parada, prazo hoje, multa, canal vermelho, cliente cobrando.
- **Especialista (modelo melhor):** usa a base da empresa e os exemplos de estilo; devolve campos
  estruturados (validados com zod); nunca executa nada.
- **Ana:** organiza, agrupa pedidos (até ~5 por mensagem), respeita o silêncio (19h–8h, fins de
  semana, feriados), exceto urgente.
- **Aprendizado de estilo:** cada resposta aprovada ou corrigida vira exemplo por empresa. A
  conversa do dono consigo mesmo nunca entra (é o canal de comando).

## 8. Instalação e deploy

Passo a passo de deploy no Easypanel: `docs/DEPLOY-EASYPANEL.md`.

Variáveis de ambiente (valores só no Environment do Easypanel; lista em `.env.example`):
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `EVOLUTION_API_KEY`, `EVOLUTION_PUBLIC_URL`,
`EVOLUTION_INSTANCE`, `PORT`, `WEBHOOK_URL`, `WEBHOOK_TOKEN`, `PAINEL_SENHA`,
`WORKER_CONCURRENCY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODELO`, `CLAUDE_ESFORCO`,
`CLASSIFICADOR_CONCORRENCIA`. As partes novas acrescentam as suas aqui.

Desenvolvimento local:

```bash
cd app && npm install
npm run typecheck && npm test
docker compose -f docker-compose.local.yml up -d
```

## 9. Autorizações externas

| Fonte | Como autorizar | Quem faz |
|---|---|---|
| WhatsApp | QR Code na página `/conexao` | dono |
| Microsoft 365 (cada empresa) | App da Ana no Entra, permissões de aplicação (ler e-mail, enviar, agenda) restritas às caixas do dono por política de acesso do Exchange | TI da empresa (pedido pronto no plano da Parte 2/4) |
| Gmail e Google Agenda | OAuth do dono; app do Google publicado para uso próprio | dono |
| Anthropic | chave da API no Environment | dono |

Atenção: o conector Microsoft 365 do Claude (usado nas sessões de desenvolvimento) **não** serve
para a Ana na VPS.

## 10. Como replicar para outro empresário

1. Criar repositório a partir deste e um projeto no Easypanel com o Compose.
2. Preencher o Environment (seção 8) com segredos novos (`openssl rand -hex 32`).
3. Ajustar a migração de cadastro (`002`) com as empresas, apelidos, palavras-chave e categorias
   do novo cliente.
4. Escrever as bases de conhecimento de cada empresa (serviços, clientes típicos, regras, tom).
5. Conectar o WhatsApp pelo `/conexao`; pedir à TI os apps do Microsoft; autorizar o Gmail.
6. Definir horários (resumo, silêncio, expediente) no painel.
7. Rodar uma semana só lendo e classificando; revisar a caixa de revisão; só então ligar as
   respostas com aprovação.
8. Backup diário e firewall antes de ligar o e-mail.

## 11. Histórico

| Data | Mudança |
|---|---|
| 2026-10-23 | Fase 1 no ar (captura WhatsApp, `/conexao`); cadastro Kas/Kamex/WTA/Pessoal; classificador. |
| 2026-10-26 | `/painel` com resumo e caixa de revisão; modelo padrão Haiku. |
| 2026-10-27 | Especificação da secretária executiva multiagente (Partes 0–6) e esta Bíblia. |
