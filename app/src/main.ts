import { lerConfig } from './config.js';
import { criarDb } from './db.js';
import { Evolution } from './evolution.js';
import Anthropic from '@anthropic-ai/sdk';
import { carregarConversa, carregarTaxonomia, gravarClassificacoes, type Taxonomia } from './classificacao-dados.js';
import { classificarConversa, perguntarIA } from './classificador.js';
import {
  agendarClassificacao,
  criarFila,
  criarWorker,
  FILA_CLASSIFICAR,
  FILA_EVENTOS,
  type JobClassificar,
  type JobEvento,
} from './fila.js';
import { migrar } from './migrate.js';
import { registrarPainel } from './painel.js';
import { processarEvento } from './processar.js';
import { gravarEvento, resumoDiario, resumoMensagens } from './repositorio.js';
import { criarServidor } from './webhook.js';

const config = lerConfig();
const db = criarDb(config.DATABASE_URL);

const novas = await migrar(db);
if (novas.length) console.log(`Migrações aplicadas: ${novas.join(', ')}`);

const filaClassificar = criarFila<JobClassificar>(FILA_CLASSIFICAR, config.REDIS_URL);
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
          perguntar: (sistema, pedido) =>
            perguntarIA({ client: anthropic, modelo: config.CLAUDE_MODELO, esforco: config.CLAUDE_ESFORCO }, sistema, pedido),
          modelo: config.CLAUDE_MODELO,
        },
        job.data.conversaId,
      );
      if (n) console.log(`Conversa ${job.data.conversaId}: ${n} mensagens classificadas`);
    })
  : null;
workerClassificar?.on('failed', (job, erro) =>
  console.error(`Classificação da conversa ${job?.data.conversaId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
);

const servidor = criarServidor({
  token: config.WEBHOOK_TOKEN,
  gravarEvento: (instancia, evento, payload) => gravarEvento(db, instancia, evento, payload),
  enfileirar: async (eventoId) => {
    await fila.add('evento', { eventoId }, { jobId: `evento-${eventoId}` });
  },
});

const evolution = new Evolution(config.EVOLUTION_URL, config.EVOLUTION_API_KEY);
const garantirInstancia = () =>
  evolution.garantirInstancia(config.EVOLUTION_INSTANCE, config.WEBHOOK_URL, config.WEBHOOK_TOKEN);

registrarPainel(servidor, {
  senha: config.PAINEL_SENHA,
  estado: garantirInstancia,
  qrCode: () => evolution.conectar(config.EVOLUTION_INSTANCE),
  resumo: () => resumoMensagens(db),
  resumoDiario: () => resumoDiario(db),
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
  await fila.close();
  await filaClassificar.close();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
