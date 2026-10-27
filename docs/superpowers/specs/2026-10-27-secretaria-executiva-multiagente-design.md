# Ana — Secretária Executiva multiagente (especificação)

Data: 2026-10-27 · Status: em revisão pelo Thiago · Base: Ana Fase 1 + classificador (PRs #1–#6, no ar)

## 1. Objetivo

Otimizar o tempo do Thiago transformando **toda demanda que chega por WhatsApp ou e-mail** em uma
tarefa pronta para decidir: resumo, plano de execução, resposta para quem enviou e etapa sugerida.
Ele aprova, e o sistema executa: responde, agenda com lembrete ou deixa aguardando terceiro.
Tudo organizado num pipeline estilo CRM, separado por empresa (Kas, Kamex, WTA), categoria e
Pessoal, com resumo diário, rotinas e agenda consolidada.

Critério de sucesso: o Thiago decide o dia pelo WhatsApp (conversa consigo mesmo) e pelo painel,
sem abrir caixa por caixa, e nada é enviado sem o OK dele.

## 2. Decisões já tomadas (não reperguntar)

| Tema | Decisão |
|---|---|
| Empresas | Kas Agenciamentos/Brokers (principal, dona das demais), Kamex Trading, WTA Logistics + Pessoal. Grafia Kamex/Kas. |
| Interação | WhatsApp **no mesmo número dele** (conversa consigo mesmo) para avisos e aprovações + painel web para a visão completa. |
| CRM | Ficha do cliente com demandas dentro. Etapas da demanda: **Novo → Comigo → Aguardando terceiro → Agendado → Concluído**. |
| Fontes | WhatsApp principal do Thiago (grupos incluídos, mensagens dele também); e-mail e agenda: a caixa dele na Kas, na Kamex (diretoria) e na WTA (Microsoft 365) e o Gmail pessoal. Nenhuma outra caixa. Endereços e número ficam só na configuração (`contas_canal` / Environment), nunca no repositório, que é público. |
| Agentes | Um agente por conta de e-mail (4) + um agente de WhatsApp. Conhecimento **por empresa** (bases Kas, Kamex, WTA, Pessoal) compartilhado pelos canais. Ana = chefe de gabinete: recebe resumos, organiza, conversa. |
| Agenda | Cada compromisso aprovado vai para a agenda da sua separação; o Outlook do Thiago já mostra as 4 juntas. Até a TI liberar Kas e WTA, grava na agenda da Kamex marcando a empresa. Painel tem tela Agenda. Sem feed ICS. |
| Microsoft 365 | Mesma TI administra as 3 empresas. A Ana na VPS usa autorização própria (Entra), não o conector do Claude. |
| Construção | Caminho 1: agentes como workers no app atual (TypeScript, BullMQ, Postgres, VPS Hostinger/Easypanel). |
| Modelos | Mais barato (Haiku, `claude-haiku-5-5`) para triagem; modelo melhor só para resposta e plano. |
| Aprovação | Nada sai sem OK. Autonomia por nível de risco só em fase futura, decidida por ele. |
| Retenção | Nunca apagar automaticamente; o painel só informa itens com mais de 4 meses. |
| Expediente | Sugestões de horário entre 9h e 18h. |
| GEO/SEO | Parte 6, cobrindo presença das empresas e conteúdo a partir das dúvidas dos clientes. |
| Documentação | `docs/BIBLIA.md` atualizada a cada parte, para memória e replicação. |

## 3. Arquitetura

```
 WhatsApp (seu número)   E-mail Kas  E-mail Kamex  E-mail WTA  Gmail Pessoal
        │ webhook            │ Graph      │ Graph      │ Graph      │ Gmail API
        ▼                    ▼            ▼            ▼            ▼
  [Agente WhatsApp]     [Agente E-mail Kas] [… Kamex] [… WTA] [… Pessoal]
        └──────── usam a base de conhecimento da empresa detectada ────────┘
                                   │
                                   ▼
                       DEMANDA no pipeline (Postgres)
                                   │
                                   ▼
                       [ANA — chefe de gabinete]
             ciclo de 5 min · rotinas · agenda · conversa no WhatsApp
                                   │  aprovação do Thiago
                                   ▼
                          [EXECUTOR DE ENVIO]
             único que envia mensagem, e-mail ou cria evento
```

Tudo roda no serviço `app` existente, como filas BullMQ e jobs repetidos (fuso
`America/Sao_Paulo`). Unidades com uma responsabilidade cada:

| Unidade | Faz | Depende de |
|---|---|---|
| Conectores de canal | Ler e enviar: Evolution (já existe), Microsoft Graph (3 contas), Gmail API. Interface comum `CanalLeitura`/`CanalEnvio`. | credenciais |
| Leitor de e-mail | A cada 5 min, busca só o que mudou (delta do Graph / `historyId` do Gmail), grava `emails` de forma idempotente. | conectores |
| Triagem | Classifica empresa, categoria, prioridade (classificador atual, estendido a e-mail). Regras sem IA descartam newsletters e avisos automáticos. | Haiku |
| Agente especialista | Recebe item triado + base da empresa + demanda aberta candidata. Decide juntar ou abrir demanda; produz título, plano, resposta pronta, etapa sugerida, compromisso (data/hora) se houver. Saída estruturada (zod). | modelo melhor, base |
| Ana (orquestradora) | Ciclo de 5 min, rotinas, cobranças, lembretes, conversa com o Thiago, agrupamento de pedidos. Não escreve respostas a clientes. | pipeline, agenda |
| Agenda | Lê as 4 agendas (cópia local), detecta conflitos, sugere horários livres, grava eventos aprovados. | Graph, Google Calendar |
| Executor de envio | Único caminho de saída. Revalida aprovação e envia com chave de idempotência. | conectores |
| Painel | Quadro do pipeline, fichas de cliente, agenda, bases de conhecimento, rotinas, custos. | banco |

## 4. Modelo de dados (novas migrações a partir de `003`)

- `contas_canal` — uma linha por fonte (whatsapp, kas, kamex, wta, pessoal): tipo, endereço,
  empresa, estado, token criptografado, cursor de leitura (delta/historyId).
- `emails` — id externo único por conta, thread, remetente, destinatários, assunto, texto,
  recebido_em, de_mim.
- `clientes` — ficha: nome, empresas do grupo com quem se relaciona, observações.
- `cliente_contatos` — telefone/JID, e-mail, grupo; liga contatos e e-mails ao cliente.
  Mesclagem de duplicados só com confirmação do Thiago.
- `demandas` — cliente, empresa, categoria, título, plano, prazo, etapa, prioridade,
  criado_em, etapa_desde.
- `demanda_itens` — liga mensagens e e-mails à demanda.
- `demanda_etapas` — histórico: de, para, quem (thiago/ana/agente), motivo, quando.
- `rascunhos` — resposta proposta: demanda, canal, destinatário, texto, versão, hash.
- `aprovacoes` — rascunho + hash aprovado, origem (whatsapp/painel), validade.
- `envios` — chave de idempotência única, rascunho, estado, erro, enviado_em.
- `eventos_agenda` — cópia das 4 agendas + eventos criados pela Ana (id externo, conta, demanda).
- `bases_conhecimento` — texto por empresa, versionado.
- `exemplos_estilo` — respostas aprovadas/corrigidas pelo Thiago (antes → depois), por empresa.
- `rotinas` — regra de repetição, ação, ativa, criada pelo Thiago via WhatsApp ou painel.
- `pedidos_ana` — número curto (#14), demanda, estado, mensagem enviada, resposta interpretada.
- `uso_ia` — modelo, tokens, custo estimado, agente, dia.

## 5. Fluxo de uma demanda

1. Chega mensagem ou e-mail → gravado → triagem.
2. Agente especialista da empresa produz a demanda (nova ou junta a uma aberta) → etapa **Novo**.
3. Ana inclui no próximo pacote de pedidos (até ~5 por mensagem; urgente vai na hora, inclusive
   no silêncio).
4. Thiago responde no WhatsApp ou no painel:
   - "ok 14" → Executor envia a resposta → **Concluído**;
   - "14 agenda quinta 15h" → evento na agenda certa + lembrete → **Agendado**;
   - "14 aguardar" → **Aguardando terceiro**;
   - "14 muda: …" → novo rascunho (nova versão) e confirmação;
   - "14 comigo" → **Comigo**.
   Texto livre é interpretado pelo modelo barato e a Ana confirma o que entendeu antes de executar.
5. Aguardando terceiro + resposta nova do cliente → volta para **Comigo** com a novidade resumida.
6. Agendado com data passada → Ana pergunta: concluída ou volta para Comigo.

## 6. Conversa no WhatsApp

- Ana envia pela Evolution para o próprio JID do Thiago; mensagens começam com "Ana:".
- Só são comandos as mensagens **do Thiago na conversa consigo mesmo**. Essa conversa é excluída
  da triagem e dos exemplos de estilo (evita laço).
- Respostas aos clientes saem do número dele (WhatsApp) ou do e-mail da empresa, só após aprovação.

## 7. Agenda, lembretes e rotinas

- Leitura das 4 agendas a cada ciclo; conflito avisado ao sugerir horário (9h–18h).
- Evento aprovado leva resumo + link do cartão. Convites a terceiros só na Parte 5.
- Lembretes: 30 min antes (compromisso com hora); prazo sem hora entra no resumo da manhã e
  lembra às 9h.
- Rotinas fixas: resumo 8h30 e 18h por empresa e Pessoal; cobranças (Comigo > 1 dia útil →
  lembrete; Aguardando > 2 dias úteis → sugere cobrança para aprovar); silêncio 19h–8h, fins de
  semana e feriados nacionais, exceto urgente. Tudo ajustável no painel.
- Rotinas do Thiago ("toda segunda 9h me lembra de…") criadas por conversa, listadas no painel.
  Rotina que fala com terceiros gera demandas para aprovação; nunca envia sozinha.
- Falha ao gravar evento ou enviar: etapa não muda, Ana avisa e tenta de novo.

## 8. Segurança e aprovação

- Aprovação vale para um rascunho (hash), um canal e um destinatário. Mudou texto ou chegou
  mensagem nova do cliente → aprovação cai.
- Executor revalida antes de enviar: aprovação < 24 h, destinatário igual ao de origem, canal
  ativo, chave de idempotência inédita.
- Conteúdo de terceiros é dado, nunca instrução. Agentes só produzem campos estruturados; o
  Executor envia exatamente o texto aprovado.
- Microsoft: app da Ana no Entra com permissões de aplicação (ler e-mail, enviar, agenda)
  **restritas às 3 caixas do Thiago** por política de acesso do Exchange. Pedido à TI vai pronto.
- Gmail: OAuth do Thiago (leitura, envio, agenda); app do Google publicado para uso próprio para
  o token não expirar em 7 dias.
- Tokens criptografados no banco; chave mestra só no Environment do Easypanel. Nada de segredo
  no repositório.
- Painel: login com sessão e limite de tentativas.
- **Pré-requisitos antes do e-mail entrar:** firewall da VPS restrito (IP do Thiago) e backup
  diário do Postgres fora da VPS (tarefa 1.10).
- Mudanças na VPS só com autorização explícita do Thiago.

## 9. Custos

Regras sem IA para newsletters; Haiku na triagem; modelo melhor só com resposta/plano a escrever.
Limite mensal no painel com aviso no WhatsApp em 80%. Custo real medido na primeira semana e
exibido no painel (`uso_ia`).

## 10. Testes

- Agentes com mensagens e e-mails fictícios (sem dado real de cliente).
- Fluxo de aprovação ponta a ponta, incluindo bloqueios: aprovação vencida, texto alterado,
  envio duplicado, comando vindo de outra conversa, e-mail com instrução maliciosa.
- Conectores simulados (Evolution, Graph, Gmail, Google Calendar) nos testes.
- `npm run typecheck` e `npm test` passando em cada PR; code review antes de cada merge.

## 11. Ordem de entrega

| Parte | Entrega | Depende de |
|---|---|---|
| 0 | Pré-requisitos: backup diário, firewall, login do painel | IP do Thiago, autorização na VPS |
| 1 | Demandas e CRM a partir do WhatsApp: clientes, demandas, agente especialista, bases de conhecimento, quadro no painel, conversa "Ana:" com aprovação e Executor (só WhatsApp) | — |
| 2 | Agenda e lembretes: leitura/gravação na agenda Kamex, tela Agenda, lembretes | autorização Microsoft da Kamex |
| 3 | Resumo do dia, cobranças, silêncio e rotinas do Thiago | Partes 1–2 |
| 4 | E-mail das 4 contas no mesmo pipeline (Kamex primeiro; Kas, WTA e Gmail conforme autorizações) | TI (Kas, WTA), OAuth Gmail |
| 5 | Reuniões: horários livres, convite a terceiros após OK, pauta com histórico | Parte 4 |
| 6 | GEO/SEO: análise de presença das empresas e conteúdo a partir das dúvidas dos clientes, publicação só com OK | Partes 1–4 |

Cada parte tem seu próprio plano de implementação, PRs pequenos e atualização da Bíblia.
Tarefas do backlog antigo que continuam valendo: 1.6 monitor de conexão, 1.7 mídia, 2.5 áudio
(whisper.cpp), 2.6 histórico de 3 meses.

## 12. Fora do escopo agora

Autonomia sem aprovação; feed ICS; agentes hospedados fora da VPS; WhatsApp de número próprio
da Ana; contas de e-mail além das 4 listadas.
