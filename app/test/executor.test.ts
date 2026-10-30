import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { createHash } from 'node:crypto';
import { criarDemanda, hashRascunho, garantirClienteDaConversa, salvarRascunho } from '../src/demandas.js';
import { enviarAprovado, type CanalWhatsApp } from '../src/executor.js';
import { ErroEnvioIncerto, Evolution } from '../src/evolution.js';
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
afterEach(() => {
  vi.unstubAllGlobals();
});

const JID = 'conversa-a@s.whatsapp.net';

function canalFalso(falha?: Error, id: string | null = 'MSG-1') {
  const chamadas: Array<[string, string]> = [];
  const canal: CanalWhatsApp = {
    async enviarTexto(jid, texto) {
      chamadas.push([jid, texto]);
      if (falha) throw falha;
      return { id };
    },
  };
  return { canal, chamadas };
}

async function cenario(texto = 'Olá, tudo certo.') {
  const c = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ($1, 'individual', 'A') RETURNING id`, [JID]);
  const conversaId = Number(c.rows[0].id);
  const clienteId = await garantirClienteDaConversa(db, conversaId);
  const d = await criarDemanda(db, {
    clienteId,
    conversaId,
    empresaId: null,
    categoriaId: null,
    titulo: 'Pedido',
    plano: null,
    prazo: null,
    prazoTemHora: false,
    etapaSugerida: null,
    prioridade: 'media',
  });
  const r = await salvarRascunho(db, d.id, texto, JID);
  const aprovar = async (rascunhoId = r.id, hash = r.hash) => {
    const a = await db.query(`INSERT INTO aprovacoes (rascunho_id, hash, origem) VALUES ($1, $2, 'whatsapp') RETURNING id`, [
      rascunhoId,
      hash,
    ]);
    return Number(a.rows[0].id);
  };
  return { conversaId, demandaId: d.id, rascunho: r, aprovar };
}

async function envios() {
  return (await db.query(`SELECT * FROM envios ORDER BY id`)).rows;
}

describe('hashRascunho', () => {
  it('fixa a fórmula sha256 de destino, quebra de linha e texto', () => {
    expect(hashRascunho('destino-a', 'Olá')).toBe(createHash('sha256').update('destino-a\nOlá').digest('hex'));
  });
});

describe('enviarAprovado', () => {
  it('envia o texto aprovado para o JID da conversa e registra', async () => {
    const { aprovar } = await cenario();
    const { canal, chamadas } = canalFalso();
    const res = await enviarAprovado(db, canal, await aprovar());
    expect(res).toEqual({ tipo: 'enviado' });
    expect(chamadas).toEqual([[JID, 'Olá, tudo certo.']]);
    const [e] = await envios();
    expect(e.estado).toBe('enviado');
    expect(e.whatsapp_msg_id).toBe('MSG-1');
    expect(e.enviado_em).not.toBeNull();
    expect(e.chave).toMatch(/^rascunho-\d+-v1$/);
  });

  it('bloqueia aprovação com mais de 24 h', async () => {
    const { aprovar } = await cenario();
    const id = await aprovar();
    const { canal, chamadas } = canalFalso();
    const depois = new Date(Date.now() + 25 * 3600 * 1000);
    expect(await enviarAprovado(db, canal, id, depois)).toEqual({ tipo: 'bloqueado', motivo: 'aprovação vencida' });
    expect(chamadas).toHaveLength(0);
    expect(await envios()).toHaveLength(0);
  });

  it('bloqueia aprovação inexistente', async () => {
    const { canal } = canalFalso();
    expect(await enviarAprovado(db, canal, 999)).toEqual({ tipo: 'bloqueado', motivo: 'aprovação vencida' });
  });

  it('bloqueia quando o rascunho mudou depois da aprovação', async () => {
    const { aprovar, demandaId } = await cenario();
    const id = await aprovar();
    await salvarRascunho(db, demandaId, 'Outro texto', JID);
    const { canal, chamadas } = canalFalso();
    expect(await enviarAprovado(db, canal, id)).toEqual({ tipo: 'bloqueado', motivo: 'a resposta mudou depois da aprovação' });
    expect(chamadas).toHaveLength(0);
    expect(await envios()).toHaveLength(0);
  });

  it('bloqueia quando o hash da aprovação não confere', async () => {
    const { aprovar } = await cenario();
    const id = await aprovar(undefined, 'hash-errado');
    const { canal } = canalFalso();
    expect(await enviarAprovado(db, canal, id)).toEqual({ tipo: 'bloqueado', motivo: 'a resposta mudou depois da aprovação' });
  });

  it('bloqueia quando o cliente escreveu depois do rascunho', async () => {
    const { aprovar, conversaId, rascunho } = await cenario();
    const id = await aprovar();
    await db.query(
      `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, de_mim, tipo, texto, recebida_em)
       VALUES ('m1', $1, false, 'texto', 'oi de novo', $2::timestamptz + interval '1 minute')`,
      [conversaId, rascunho.criadoEm],
    );
    const { canal, chamadas } = canalFalso();
    expect(await enviarAprovado(db, canal, id)).toEqual({
      tipo: 'bloqueado',
      motivo: 'o cliente escreveu depois da resposta pronta',
    });
    expect(chamadas).toHaveLength(0);
  });

  it('bloqueia mensagem do cliente com hora anterior mas que chegou ao sistema depois do rascunho', async () => {
    const { aprovar, conversaId, rascunho } = await cenario();
    const id = await aprovar();
    await db.query(
      `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, de_mim, tipo, texto, recebida_em, criado_em)
       VALUES ('m1', $1, false, 'texto', 'atrasada', $2::timestamptz - interval '1 minute', $2::timestamptz + interval '1 minute')`,
      [conversaId, rascunho.criadoEm],
    );
    const { canal, chamadas } = canalFalso();
    expect(await enviarAprovado(db, canal, id)).toEqual({
      tipo: 'bloqueado',
      motivo: 'o cliente escreveu depois da resposta pronta',
    });
    expect(chamadas).toHaveLength(0);
  });

  it('mensagem minha ou anterior ao rascunho não bloqueia', async () => {
    const { aprovar, conversaId, rascunho } = await cenario();
    const id = await aprovar();
    await db.query(
      `INSERT INTO mensagens (whatsapp_msg_id, conversa_id, de_mim, tipo, texto, recebida_em, criado_em) VALUES
       ('m1', $1, false, 'texto', 'antes', $2::timestamptz - interval '1 minute', $2::timestamptz - interval '1 minute'),
       ('m2', $1, true, 'texto', 'minha', $2::timestamptz + interval '1 minute', $2::timestamptz + interval '1 minute')`,
      [conversaId, rascunho.criadoEm],
    );
    const { canal } = canalFalso();
    expect((await enviarAprovado(db, canal, id)).tipo).toBe('enviado');
  });

  it('bloqueia destino diferente da conversa de origem', async () => {
    const { aprovar, demandaId } = await cenario();
    const r2 = await salvarRascunho(db, demandaId, 'Texto', 'outro@s.whatsapp.net');
    const id = await aprovar(r2.id, r2.hash);
    const { canal, chamadas } = canalFalso();
    expect(await enviarAprovado(db, canal, id)).toEqual({
      tipo: 'bloqueado',
      motivo: 'destino diferente da conversa de origem',
    });
    expect(chamadas).toHaveLength(0);
  });

  it('não envia duas vezes o mesmo rascunho', async () => {
    const { aprovar } = await cenario();
    const a1 = await aprovar();
    const a2 = await aprovar();
    const { canal, chamadas } = canalFalso();
    expect((await enviarAprovado(db, canal, a1)).tipo).toBe('enviado');
    expect(await enviarAprovado(db, canal, a2)).toEqual({ tipo: 'bloqueado', motivo: 'esta resposta já foi enviada' });
    expect(chamadas).toHaveLength(1);
    expect(await envios()).toHaveLength(1);
  });

  it('duas chamadas concorrentes enviam uma vez só', async () => {
    const { aprovar } = await cenario();
    const a1 = await aprovar();
    const a2 = await aprovar();
    const { canal, chamadas } = canalFalso();
    const res = await Promise.all([enviarAprovado(db, canal, a1), enviarAprovado(db, canal, a2)]);
    expect(res.filter((x) => x.tipo === 'enviado')).toHaveLength(1);
    expect(chamadas).toHaveLength(1);
  });

  it('canal incerto (sem resposta) deixa o envio em enviando e avisa para conferir', async () => {
    const { aprovar } = await cenario();
    const { canal } = canalFalso(new ErroEnvioIncerto('timeout'));
    const res = await enviarAprovado(db, canal, await aprovar());
    expect(res.tipo).toBe('falhou');
    expect(res.tipo === 'falhou' && res.erro).toMatch(/^incerto: timeout/);
    const [e] = await envios();
    expect(e.estado).toBe('enviando');
  });

  it('enviado sem id do canal continua enviado', async () => {
    const { aprovar } = await cenario();
    const { canal } = canalFalso(undefined, null);
    expect(await enviarAprovado(db, canal, await aprovar())).toEqual({ tipo: 'enviado' });
    const [e] = await envios();
    expect(e.estado).toBe('enviado');
    expect(e.whatsapp_msg_id).toBeNull();
  });

  it('se gravar o sucesso falhar, não marca falhou (mensagem já saiu)', async () => {
    const { aprovar } = await cenario();
    const id = await aprovar();
    const quebrado = {
      connect: db.connect.bind(db),
      query: (sql: string, params?: unknown[]) =>
        sql.includes("estado = 'enviado'") ? Promise.reject(new Error('banco caiu')) : db.query(sql, params),
    } as unknown as Db;
    const { canal, chamadas } = canalFalso();
    await expect(enviarAprovado(quebrado, canal, id)).rejects.toThrow('banco caiu');
    expect(chamadas).toHaveLength(1);
    const [e] = await envios();
    expect(e.estado).toBe('enviando');
  });

  it('registra falha do canal sem mudar nada além de envios', async () => {
    const { aprovar, demandaId } = await cenario();
    const antes = (await db.query(`SELECT etapa FROM demandas WHERE id = $1`, [demandaId])).rows[0].etapa;
    const { canal } = canalFalso(new Error('rede caiu'));
    expect(await enviarAprovado(db, canal, await aprovar())).toEqual({ tipo: 'falhou', erro: 'rede caiu' });
    const [e] = await envios();
    expect(e.estado).toBe('falhou');
    expect(e.erro).toBe('rede caiu');
    expect(e.whatsapp_msg_id).toBeNull();
    expect((await db.query(`SELECT etapa FROM demandas WHERE id = $1`, [demandaId])).rows[0].etapa).toBe(antes);
  });
});

describe('Evolution.enviarTexto', () => {
  it('chama sendText com number e text e devolve key.id', async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ key: { id: 'ABC' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await new Evolution('http://evo', 'k').enviarTexto('inst 1', 'grupo@g.us', 'oi');
    expect(r).toEqual({ id: 'ABC' });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://evo/message/sendText/inst%201');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ number: 'grupo@g.us', text: 'oi' });
  });

  it('2xx sem key.id ou com corpo inválido conta como enviado, com id nulo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    expect(await new Evolution('http://evo', 'k').enviarTexto('i', 'n', 't')).toEqual({ id: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await new Evolution('http://evo', 'k').enviarTexto('i', 'n', 't')).toEqual({ id: null });
  });

  it('erro HTTP é falha certa e erro de rede é envio incerto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ruim', { status: 500 })));
    await expect(new Evolution('http://evo', 'k').enviarTexto('i', 'n', 't')).rejects.toMatchObject({ status: 500 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(new Evolution('http://evo', 'k').enviarTexto('i', 'n', 't')).rejects.toBeInstanceOf(ErroEnvioIncerto);
  });
});
