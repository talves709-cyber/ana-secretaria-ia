import { lerConfig } from './config.js';
import { criarDb } from './db.js';
import { Evolution } from './evolution.js';
import { criarFila, criarWorker } from './fila.js';
import { migrar } from './migrate.js';
import { registrarPainel } from './painel.js';
import { processarEvento } from './processar.js';
import { gravarEvento, resumoMensagens } from './repositorio.js';
import { criarServidor } from './webhook.js';

const config = lerConfig();
const db = criarDb(config.DATABASE_URL);

const novas = await migrar(db);
if (novas.length) console.log(`Migrações aplicadas: ${novas.join(', ')}`);

const fila = criarFila(config.REDIS_URL);
const worker = criarWorker(config.REDIS_URL, config.WORKER_CONCURRENCY, (job) =>
  processarEvento(db, job.data.eventoId),
);
worker.on('failed', (job, erro) =>
  console.error(`Evento ${job?.data.eventoId} falhou (tentativa ${job?.attemptsMade}): ${erro.message}`),
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
});

await servidor.listen({ host: '0.0.0.0', port: config.PORT });

// O Evolution pode demorar a subir; se falhar aqui, a página /conexao tenta de novo.
garantirInstancia()
  .then((estado) => console.log(`Instância ${config.EVOLUTION_INSTANCE}: ${estado}`))
  .catch((erro) => console.warn(`Evolution ainda indisponível: ${(erro as Error).message}`));

async function encerrar() {
  await servidor.close();
  await worker.close();
  await fila.close();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
