import { describe, expect, it, vi } from 'vitest';
import { criarServidor } from '../src/webhook.js';

const TOKEN = 'token-de-teste-1234567890';

function montar() {
  const gravarEvento = vi.fn(async () => 42);
  const enfileirar = vi.fn(async () => {});
  return { app: criarServidor({ token: TOKEN, gravarEvento, enfileirar }), gravarEvento, enfileirar };
}

describe('POST /webhook/evolution', () => {
  it('recusa token errado sem gravar nada', async () => {
    const { app, gravarEvento } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-ana-token': 'errado' },
      payload: { event: 'messages.upsert' },
    });
    expect(r.statusCode).toBe(401);
    expect(gravarEvento).not.toHaveBeenCalled();
  });

  it('grava o evento sem a apikey e enfileira', async () => {
    const { app, gravarEvento, enfileirar } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-ana-token': TOKEN },
      payload: { event: 'MESSAGES_UPSERT', instance: 'ana', apikey: 'segredo', data: { a: 1 } },
    });
    expect(r.statusCode).toBe(200);
    expect(gravarEvento).toHaveBeenCalledWith('ana', 'messages.upsert', {
      event: 'MESSAGES_UPSERT',
      instance: 'ana',
      data: { a: 1 },
    });
    expect(enfileirar).toHaveBeenCalledWith(42);
  });
});
