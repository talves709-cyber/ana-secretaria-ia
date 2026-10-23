import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

export const NOME_FILA = 'eventos';

export interface JobEvento {
  eventoId: number;
}

/** BullMQ 6 em ESM exige um cliente ioredis já construído. */
function conexao(redisUrl: string) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function criarFila(redisUrl: string) {
  return new Queue<JobEvento>(NOME_FILA, {
    connection: conexao(redisUrl),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      // Falhas definitivas ficam guardadas para aparecer no painel.
      removeOnFail: false,
    },
  });
}

export function criarWorker(redisUrl: string, concorrencia: number, processar: Processor<JobEvento>) {
  return new Worker<JobEvento>(NOME_FILA, processar, {
    connection: conexao(redisUrl),
    concurrency: concorrencia,
  });
}
