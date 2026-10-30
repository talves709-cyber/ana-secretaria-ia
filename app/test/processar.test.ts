import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { processarEvento } from '../src/processar.js';
import { gravarEvento, marcarConversasDeComando } from '../src/repositorio.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

let db: Db;
let parar: () => Promise<void>;
beforeAll(async () => {
  ({ db, parar } = await iniciarBanco());
});
afterAll(async () => {
  await parar();
});
beforeEach(async () => {
  await limparBanco(db);
});

const DONO = '5500000000000@s.whatsapp.net';

async function evento(jid: string, id: string, texto: string, fromMe: boolean) {
  const payload = { data: { key: { remoteJid: jid, id, fromMe }, message: { conversation: texto }, messageTimestamp: 1_790_000_000 } };
  return gravarEvento(db, 'ana', 'messages.upsert', payload);
}

describe('processarEvento e a conversa do dono', () => {
  it('mensagem do dono não agenda classificação e vai para a fila de comandos', async () => {
    await marcarConversasDeComando(db, [DONO]);
    const agendar = vi.fn(async (_c: number) => {});
    const enfileirar = vi.fn(async (_id: number) => {});
    await processarEvento(db, await evento(DONO, 'a1', 'ok 12', true), agendar, { jids: [DONO], enfileirar });
    expect(agendar).not.toHaveBeenCalled();
    expect(enfileirar).toHaveBeenCalledTimes(1);
    const gravada = await db.query(`SELECT id, texto FROM mensagens WHERE whatsapp_msg_id = 'a1'`);
    expect(gravada.rows[0].texto).toBe('ok 12');
    expect(enfileirar).toHaveBeenCalledWith(Number(gravada.rows[0].id));
  });

  it('eco "Ana: ..." só é gravado', async () => {
    await marcarConversasDeComando(db, [DONO]);
    const agendar = vi.fn(async (_c: number) => {});
    const enfileirar = vi.fn(async (_id: number) => {});
    await processarEvento(db, await evento(DONO, 'a2', 'Ana: #12 enviada.', true), agendar, { jids: [DONO], enfileirar });
    expect(agendar).not.toHaveBeenCalled();
    expect(enfileirar).not.toHaveBeenCalled();
    expect((await db.query(`SELECT 1 FROM mensagens WHERE whatsapp_msg_id = 'a2'`)).rows).toHaveLength(1);
  });

  it('mensagem de cliente continua indo para a classificação', async () => {
    await marcarConversasDeComando(db, [DONO]);
    const agendar = vi.fn(async (_c: number) => {});
    const enfileirar = vi.fn(async (_id: number) => {});
    await processarEvento(db, await evento('cli@s.whatsapp.net', 'c1', 'oi', false), agendar, { jids: [DONO], enfileirar });
    expect(agendar).toHaveBeenCalledTimes(1);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('marcarConversasDeComando cria ou converte a conversa e é repetível', async () => {
    await db.query(`INSERT INTO conversas (jid, tipo) VALUES ($1, 'individual')`, [DONO]);
    await marcarConversasDeComando(db, [DONO, '999@lid']);
    await marcarConversasDeComando(db, [DONO, '999@lid']);
    const r = await db.query(`SELECT jid, modo FROM conversas ORDER BY jid`);
    expect(r.rows.map((x) => x.modo)).toEqual(['comando', 'comando']);
  });
});
