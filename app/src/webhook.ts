import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { nomeDoEvento } from './normalizar.js';

export interface DepsWebhook {
  token: string;
  gravarEvento: (instancia: string, evento: string, payload: unknown) => Promise<number>;
  enfileirar: (eventoId: number) => Promise<void>;
}

function tokenValido(recebido: unknown, esperado: string): boolean {
  if (typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook rápido: valida o token, grava o evento bruto, enfileira e responde. */
export function criarServidor(deps: DepsWebhook) {
  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });

  app.get('/saude', async () => ({ ok: true }));

  app.post('/webhook/evolution', async (req, reply) => {
    if (!tokenValido(req.headers['x-ana-token'], deps.token)) {
      return reply.code(401).send({ erro: 'token inválido' });
    }
    const corpo = req.body as { event?: string; instance?: string } | undefined;
    if (!corpo || typeof corpo.event !== 'string') {
      return reply.code(400).send({ erro: 'evento sem nome' });
    }
    const evento = nomeDoEvento(corpo.event);
    // O Evolution manda a própria chave de API no corpo; não guardamos isso.
    const { apikey: _apikey, ...semChave } = corpo as Record<string, unknown>;
    const id = await deps.gravarEvento(corpo.instance ?? 'desconhecida', evento, semChave);
    await deps.enfileirar(id);
    return reply.code(200).send({ ok: true, id });
  });

  return app;
}
