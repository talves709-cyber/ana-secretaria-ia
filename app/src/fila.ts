import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

export const FILA_EVENTOS = 'eventos';
export const FILA_CLASSIFICAR = 'classificar';

export interface JobEvento {
  eventoId: number;
}

export interface JobClassificar {
  conversaId: number;
}

/** Espera depois da primeira mensagem nova de uma conversa antes de classificar o bloco. */
export const JANELA_AGRUPAR_MS = 45_000;

/** BullMQ 6 em ESM exige um cliente ioredis já construído. */
function conexao(redisUrl: string) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function criarFila<T>(nome: string, redisUrl: string) {
  return new Queue<T>(nome, {
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

export function criarWorker<T>(nome: string, redisUrl: string, concorrencia: number, processar: Processor<T>) {
  return new Worker<T>(nome, processar, {
    connection: conexao(redisUrl),
    concurrency: concorrencia,
  });
}

/**
 * Agenda a classificação da conversa. Mensagens que chegam dentro da janela caem no
 * mesmo job (deduplicação por conversa), e o job classifica tudo o que estiver pendente.
 */
export async function agendarClassificacao(fila: Queue<JobClassificar>, conversaId: number) {
  await fila.add(
    'conversa',
    { conversaId },
    { delay: JANELA_AGRUPAR_MS, deduplication: { id: `conversa-${conversaId}`, ttl: JANELA_AGRUPAR_MS } },
  );
}
