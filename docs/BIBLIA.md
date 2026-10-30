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
| Login do painel: `/entrar` com senha, cookie assinado (`SESSAO_SEGREDO`), 12 h, limite de tentativas por IP; `/sair` | no ar (Parte 0) | `sessao.ts`, `painel.ts` |
| Backup diário do Postgres (03:00) para o Google Drive, retenção de 30 dias | no código; token do Drive a gerar (ver pendências) | serviço `backup` do `docker-compose.yml` |
| Demandas e CRM: clientes, contatos, demandas com itens e histórico de etapas | no código (Parte 1) | `demandas.ts`, `crm-dados.ts`, migração `003` |
| Agente especialista (Opus): abre ou junta demandas, plano e resposta pronta; fila `especialista` | no código (Parte 1) | `especialista.ts`, `especialista-dados.ts` |
| Custo de IA: registro por chamada em `uso_ia`, teto mensal com aviso a 80% | no código (Parte 1) | `uso-ia.ts` |
| Comandos do Thiago pelo WhatsApp (conversa dele consigo mesmo); fila `comandos` | no código (Parte 1) | `comandos.ts`, `acoes.ts`, `conversa-dono.ts` |
| Executor de envio: único caminho de envio a terceiros, com aprovação válida (24 h, hash do rascunho, um destino) | no código (Parte 1) | `executor.ts` |
| Ana: pacotes de até 5 pedidos a cada 5 min (fila `ana`), urgentes na hora, silêncio 19h–8h, fins de semana e feriados | no código (Parte 1) | `ana.ts`, `silencio.ts` |
| Painel do pipeline: quadro por etapa, ficha do cliente, edição das bases de conhecimento | no código (Parte 1) | `painel-crm.ts` |
| Agenda e lembretes (hoje `agenda` só muda a etapa para Agendado, sem criar evento) | planejado (Parte 2) | — |
| Resumos 8h30 e 18h, cobranças automáticas, rotinas | planejado (Parte 3) | — |
| E-mail (Microsoft 365 e Gmail) | planejado (Parte 4) | — |
| Reuniões | planejado (Parte 5) | — |

Peças "no código" estão na branch das Partes 0 e 1 e entram no ar com a primeira subida (ver `docs/DEPLOY-EASYPANEL.md`).
| GEO/SEO | planejado (Parte 6) | — |

## 5. Modelo de dados

Hoje (`app/migrations/001`, `002`): `segmentos`, `empresas`, `negocios`, `categorias`,
`contatos`, `conversas`, `eventos_webhook`, `mensagens`, `classificacoes`, `sugestoes`,
`estado_conexao`. Hierarquia Segmento → Empresa → Negócio; categoria é transversal;
classificação separada da mensagem; empresa nova detectada pela IA vira `sugestoes`.

Migração `003_demandas.sql`: `clientes`, `cliente_contatos`, `demandas` (etapa e
prioridade), `demanda_itens`, `demanda_etapas` (histórico de mudanças e quem fez), `rascunhos`,
`aprovacoes`, `envios`, `bases_conhecimento` (uma por empresa), `exemplos_estilo`,
`confirmacoes` (comandos que esperam o "sim"), `uso_ia` (custo por chamada) e `avisos`
(pedidos já avisados ao Thiago, base do pacote e do silêncio). A tabela `conversas` ganhou um
novo valor de modo.

Planejado: `contas_canal`, `emails`, `eventos_agenda`, `rotinas`. Detalhes na especificação, seção 4.

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

Texto livre também vale; a Ana confirma o que entendeu e só executa depois de um "sim" sozinho
na mensagem ("não" ou "cancela" desfaz). Hoje `agenda` só move a etapa e guarda a data; o
evento na agenda da empresa e o lembrete chegam na Parte 2. Aprovação vale 24 h, para um
rascunho (hash) e um destino, e cai se o cliente escrever depois do rascunho.

**Painel** (todas as rotas pedem login): `/painel` (resumo e caixa de revisão),
`/painel/pipeline` (quadro por etapa, filtros, botões de ação em cada cartão),
`/painel/clientes/:id` (ficha com as demandas), `/painel/bases` (texto da base de
conhecimento de cada empresa), `/conexao` (QR Code e totais).

**Filas (BullMQ):** `eventos`, `classificar` (janela de 45 s por conversa), `especialista`,
`comandos` e `ana` (ciclo repetido a cada 5 minutos). As filas de comandos e da Ana só sobem
se `DONO_WHATSAPP` estiver preenchido.

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
`CLASSIFICADOR_CONCORRENCIA`.

Variáveis novas das Partes 0 e 1:

| Variável | Para que serve |
|---|---|
| `SESSAO_SEGREDO` | assina o cookie de sessão do painel (segredo, mín. 32) |
| `DONO_WHATSAPP` | número do Thiago (só dígitos, com DDI); vazio desliga comandos e avisos |
| `DONO_JIDS_EXTRA` | identificadores extras da conversa dele consigo mesmo (formato `...@lid`), separados por vírgula |
| `CLAUDE_MODELO_ESPECIALISTA` | modelo do agente especialista (padrão `claude-opus-5-5`) |
| `CLAUDE_ESFORCO_ESPECIALISTA` | esforço do especialista (padrão `medium`) |
| `IA_LIMITE_MENSAL_USD` | teto mensal de gasto com IA em US$; aviso a 80% |
| `SILENCIO_INICIO`, `SILENCIO_FIM` | hora cheia em que o silêncio começa (19) e termina (8), fuso America/Sao_Paulo |
| `BACKUP_DESTINO` | destino do backup no formato `remote:pasta` (`gdrive:ana-backups`) |
| `RCLONE_CONFIG_GDRIVE_*` | configuração do rclone para o Google Drive (`TYPE`, `SCOPE`, `TOKEN`; `CLIENT_ID` e `CLIENT_SECRET` opcionais) |

Primeira subida das Partes 0 e 1 e roteiro do teste de fumaça: `docs/DEPLOY-EASYPANEL.md`.

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

### Pendências abertas

- **Firewall da VPS** (Task 3): aguarda o IP do Thiago para liberar só o necessário. Fazer antes de ligar o e-mail.
- **Token do Google Drive** do backup: a gerar com `rclone authorize` (passo a passo no deploy); sem ele o serviço de backup falha.
- **Autorizações Microsoft** (Partes 2 e 4): pedido à TI de cada empresa, ainda sem resposta.
- **Notificação no celular**: mensagem que a Ana manda na conversa do Thiago consigo mesmo pode não gerar notificação (aparelho conectado enviando para a própria conversa). Verificar no teste guiado; se não notificar, avaliar um número próprio para a Ana.

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
| 2026-10-30 | Partes 0 e 1 no código: login do painel, backup no Drive, demandas e CRM, especialista, custo de IA, comandos pelo WhatsApp, Executor, pacotes e silêncio, painel do pipeline. Falta a primeira subida e o teste de fumaça. |
