import { lerConfig } from './config.js';
import { criarDb } from './db.js';
import { Evolution } from './evolution.js';
import { aplicarComando } from './acoes.js';
import { confirmacoesDoBanco, criarInterpretarLivre, demandasParaInterprete, entradaDeComandos, jidsDoDono, tratarMensagemDoDono } from './conversa-dono.js';
import { enviarAprovado, type CanalWhatsApp } from './executor.js';
import Anthropic from '@anthropic-ai/sdk';
import { carregarConversa, carregarTaxonomia, gravarClassificacoes, type Taxonomia } from './classificacao-dados.js';
import { classificarConversa, perguntarIA } from './classificador.js';
import { registrarUsoSeguro, gastoDoMes, situacaoLimite } from './uso-ia.js';
import { analisarConversa, perguntarEspecialista } from './especialista.js';
import { baseDaEmpresa, carregarBloco, exemplosDaEmpresa, nomeDaEmpresa, transacaoDoEspecialista } from './especialista-dados.js';
import { avisarUrgente, cicloAna, type DepsAna } from './ana.js';
import { demandasAbertasDaConversa } from './demandas.js';
import {
  agendarClassificacao,
  agendarCicloAna,
  criarFila,
  criarWorker,
  FILA_ANA,
  FILA_CLASSIFICAR,
  FILA_COMANDOS,
  FILA_ESPECIALISTA,
  FILA_EVENTOS,
  removerCicloAna,
  type JobClassificar,
  type JobComando,
  type JobEspecialista,
  type JobEvento,
} from './fila.js';
import { migrar } from './migrate.js';
import { registrarPainel } from './painel.js';
import { registrarPainelCrm } from './painel-crm.js';
import { processarEvento } from './processar.js';
import { gravarEvento, marcarConversasDeComando, resumoDiario, resumoMensagens, textoDaMensagem } from './repositorio.js';
import { criarServidor } from './webhook.js';

const config = lerConfig();
const db = criarDb(config.DATABASE_URL);

const novas = await migrar(db);
if (novas.length) console.log(`Migrações aplicadas: ${novas.join(', ')}`);

const evolution = new Evolution(config.EVOLUTION_URL, config.EVOLUTION_API_KEY);

// Comandos pelo WhatsApp: ligados só com DONO_WHATSAPP. A conversa do dono é marcada antes de qualquer worker.
const donoJids = jidsDoDono(config);
const comandosLigados = donoJids.length > 0;
if (comandosLigados) {
  await marcarConversasDeComando(db, donoJids);
  console.log('Comandos pelo WhatsApp ligados');
}
const filaComandos = comandosLigados ? criarFila<JobComando>(FILA_COMANDOS, config.REDIS_URL) : null;

// Mensagem para o próprio Thiago: não passa pelo Executor (ele é só para terceiros).
const responderAoDono = async (texto: string) => {
  await evolution.enviarTexto(config.EVOLUTION_INSTANCE, donoJids[0]!, texto);
};
const depsAna: DepsAna = {
  db,
  enviar: responderAoDono,
  limiteMensalUsd: config.IA_LIMITE_MENSAL_USD,
  silencioInicio: config.SILENCIO_INICIO,
  silencioFim: config.SILENCIO_FIM,
};

const filaClassificar = criarFila<JobClassificar>(FILA_CLASSIFICAR, config.REDIS_URL);
const filaEspecialista = criarFila<JobEspecialista>(FILA_ESPECIALISTA, config.REDIS_URL);
const classificacaoLigada = Boolean(config.ANTHROPIC_API_KEY);
console.log(
  classificacaoLigada
    ? `Classificação ligada: ${config.CLAUDE_MODELO}, esforço ${config.CLAUDE_ESFORCO}`
    : 'Classificação desligada: defina ANTHROPIC_API_KEY para ligar',
);

const fila = criarFila<JobEvento>(FILA_EVENTOS, config.REDIS_URL);
const worker = criarWorker<JobEvento>(FILA_EVENTOS, config.REDIS_URL, config.WORKER_CONCURRENCY, (job) =>
  processarEvento(
    db,
    job.data.eventoId,
    classificacaoLigada ? (conversaId) => agendarClassificacao(filaClassificar, conversaId) : undefined,
    entradaDeComandos(donoJids, filaComandos),
  ),
);
worker.on('failed', (job, erro) =>
  console.error(`Evento ${job?.data.eventoId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
);

// O cadastro muda pouco: recarrega a cada 5 minutos.
let taxonomia: { valor: Taxonomia; lidaEm: number } | null = null;
async function taxonomiaAtual() {
  if (!taxonomia || Date.now() - taxonomia.lidaEm > 5 * 60_000) {
    taxonomia = { valor: await carregarTaxonomia(db), lidaEm: Date.now() };
  }
  return taxonomia.valor;
}

const anthropic = classificacaoLigada ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;
const workerClassificar = anthropic
  ? criarWorker<JobClassificar>(FILA_CLASSIFICAR, config.REDIS_URL, config.CLASSIFICADOR_CONCORRENCIA, async (job) => {
      const n = await classificarConversa(
        {
          carregarTaxonomia: taxonomiaAtual,
          carregarConversa: (id) => carregarConversa(db, id),
          gravar: (ids, c, sugerida) => gravarClassificacoes(db, ids, c, sugerida),
          perguntar: async (sistema, pedido) => {
            const resultado = await perguntarIA(
              { client: anthropic, modelo: config.CLAUDE_MODELO, esforco: config.CLAUDE_ESFORCO },
              sistema,
              pedido,
            );
            if (resultado.tipo === 'ok') await registrarUsoSeguro(db, 'triagem', resultado.modelo, resultado.uso);
            return resultado;
          },
          modelo: config.CLAUDE_MODELO,
        },
        job.data.conversaId,
      );
      if (n) {
        console.log(`Conversa ${job.data.conversaId}: ${n} mensagens classificadas`);
        const conversaId = job.data.conversaId;
        await filaEspecialista.add('conversa', { conversaId }, { jobId: `esp-${conversaId}-${Date.now()}` });
      }
    })
  : null;
workerClassificar?.on('failed', (job, erro) =>
  console.error(`Classificação da conversa ${job?.data.conversaId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
);

const workerEspecialista = anthropic
  ? criarWorker<JobEspecialista>(FILA_ESPECIALISTA, config.REDIS_URL, 1, async (job) => {
      const r = await analisarConversa(
        {
          carregarBloco: (id) => carregarBloco(db, id),
          demandasAbertas: (id) => demandasAbertasDaConversa(db, id),
          baseDaEmpresa: (id) => baseDaEmpresa(db, id),
          nomeDaEmpresa: (id) => nomeDaEmpresa(db, id),
          exemplosDaEmpresa: (id) => exemplosDaEmpresa(db, id),
          transacao: (fn) => transacaoDoEspecialista(db, fn),
          perguntar: (sistema, pedido) =>
            perguntarEspecialista(
              { client: anthropic, modelo: config.CLAUDE_MODELO_ESPECIALISTA, esforco: config.CLAUDE_ESFORCO_ESPECIALISTA },
              sistema,
              pedido,
            ),
          registrarUso: (modelo, uso) => registrarUsoSeguro(db, 'especialista', modelo, uso),
          podeGastar: async () => situacaoLimite(await gastoDoMes(db), config.IA_LIMITE_MENSAL_USD) !== 'estourado',
          avisarUrgente: async (demandaId) => {
            if (comandosLigados) await avisarUrgente(depsAna, demandaId);
          },
        },
        job.data.conversaId,
      );
      if (r.decisao !== 'pulada') console.log(`Conversa ${job.data.conversaId}: especialista ${r.decisao}, demanda ${r.demandaId ?? '-'}`);
    })
  : null;
workerEspecialista?.on('failed', (job, erro) =>
  console.error(`Especialista na conversa ${job?.data.conversaId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
);

// Adaptador do Executor: ErroEnvioIncerto sobe sem embrulho (o Executor o trata como "pode ter saído").
const canalWhatsApp: CanalWhatsApp = {
  enviarTexto: (jid, texto) => evolution.enviarTexto(config.EVOLUTION_INSTANCE, jid, texto),
};

const workerComandos = comandosLigados
  ? criarWorker<JobComando>(FILA_COMANDOS, config.REDIS_URL, 1, async (job) => {
      const msg = await textoDaMensagem(db, job.data.mensagemId);
      if (!msg) return;
      const acoes = { db, enviarAprovado: (id: number) => enviarAprovado(db, canalWhatsApp, id), agora: () => new Date() };
      await tratarMensagemDoDono(
        {
          aplicar: (c) => aplicarComando(acoes, c, 'whatsapp'),
          demandasAbertas: () => demandasParaInterprete(db),
          interpretarLivre: anthropic
            ? criarInterpretarLivre({
                client: anthropic,
                modelo: config.CLAUDE_MODELO,
                esforco: config.CLAUDE_ESFORCO,
                demandas: () => demandasParaInterprete(db),
                registrarUso: (modelo, uso) => registrarUsoSeguro(db, 'interprete', modelo, uso),
                podeGastar: async () => situacaoLimite(await gastoDoMes(db), config.IA_LIMITE_MENSAL_USD) !== 'estourado',
              })
            : async () => null,
          ...confirmacoesDoBanco(db),
          responder: responderAoDono,
        },
        msg.texto,
        msg.recebidaEm,
      );
    })
  : null;
workerComandos?.on('failed', (job, erro) =>
  console.error(`Comando da mensagem ${job?.data.mensagemId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
);
// Ciclo da Ana: a cada 5 minutos junta os pedidos novos e avisa o Thiago (só com DONO_WHATSAPP).
const filaAna = comandosLigados ? criarFila(FILA_ANA, config.REDIS_URL) : null;
if (filaAna) {
  await agendarCicloAna(filaAna);
} else {
  // Desligado: remove o agendador de uma subida anterior, senão os jobs se acumulam no Redis sem worker.
  const filaAntiga = criarFila(FILA_ANA, config.REDIS_URL);
  await removerCicloAna(filaAntiga);
  await filaAntiga.close();
}
const workerAna = comandosLigados
  ? criarWorker(FILA_ANA, config.REDIS_URL, 1, async () => {
      const n = await cicloAna(depsAna);
      if (n) console.log(`Ana avisou ${n} pedidos`);
    })
  : null;
workerAna?.on('failed', (job, erro) => console.error(`Ciclo da Ana falhou (tentativa ${job?.attemptsMade}): ${erro.message}`));

const servidor = criarServidor({
  token: config.WEBHOOK_TOKEN,
  gravarEvento: (instancia, evento, payload) => gravarEvento(db, instancia, evento, payload),
  enfileirar: async (eventoId) => {
    await fila.add('evento', { eventoId }, { jobId: `evento-${eventoId}` });
  },
});

const garantirInstancia = () =>
  evolution.garantirInstancia(config.EVOLUTION_INSTANCE, config.WEBHOOK_URL, config.WEBHOOK_TOKEN);

registrarPainel(servidor, {
  senha: config.PAINEL_SENHA,
  sessaoSegredo: config.SESSAO_SEGREDO,
  estado: garantirInstancia,
  qrCode: () => evolution.conectar(config.EVOLUTION_INSTANCE),
  resumo: () => resumoMensagens(db),
  resumoDiario: () => resumoDiario(db),
});

registrarPainelCrm(servidor, {
  sessaoSegredo: config.SESSAO_SEGREDO,
  acoes: { db, enviarAprovado: (id) => enviarAprovado(db, canalWhatsApp, id), agora: () => new Date() },
});

await servidor.listen({ host: '0.0.0.0', port: config.PORT });

// O Evolution pode demorar a subir; se falhar aqui, a página /conexao tenta de novo.
garantirInstancia()
  .then((estado) => console.log(`Instância ${config.EVOLUTION_INSTANCE}: ${estado}`))
  .catch((erro) => console.warn(`Evolution ainda indisponível: ${(erro as Error).message}`));

async function encerrar() {
  await servidor.close();
  await worker.close();
  await workerClassificar?.close();
  await workerEspecialista?.close();
  await workerComandos?.close();
  await workerAna?.close();
  await fila.close();
  await filaClassificar.close();
  await filaEspecialista.close();
  await filaComandos?.close();
  await filaAna?.close();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
