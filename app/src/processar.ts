import type { Db } from './db.js';
import { normalizarMensagens } from './normalizar.js';
import { gravarEstadoConexao, gravarMensagem, lerEvento, marcarEvento } from './repositorio.js';

/** Processa um evento já gravado. Lança erro para o BullMQ tentar de novo. */
export async function processarEvento(db: Db, eventoId: number): Promise<void> {
  const evento = await lerEvento(db, eventoId);
  if (!evento) return;
  try {
    const data = evento.payload?.data;
    switch (evento.evento) {
      case 'messages.upsert':
        for (const m of normalizarMensagens(data)) {
          await gravarMensagem(db, m, eventoId);
          // Fase 2: enfileirar a mensagem nova para classificação.
        }
        break;
      case 'connection.update':
        if (typeof data?.state === 'string') await gravarEstadoConexao(db, evento.instancia, data.state);
        break;
      default:
        // Outros eventos ficam só guardados em eventos_webhook por enquanto.
        break;
    }
    await marcarEvento(db, eventoId, null);
  } catch (erro) {
    await marcarEvento(db, eventoId, (erro as Error).message);
    throw erro;
  }
}
