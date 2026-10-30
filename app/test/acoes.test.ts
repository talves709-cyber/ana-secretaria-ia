import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { aplicarComando, type DepsAcoes } from '../src/acoes.js';
import type { ResultadoEnvio } from '../src/executor.js';
import { buscarDemanda, criarDemanda, garantirClienteDaConversa, rascunhoAtual, salvarRascunho, type EtapaSugerida } from '../src/demandas.js';
import { iniciarBanco, limparBanco } from './apoio/banco.js';

let db: Db;
let parar: () => Promise<void>;
const AGORA = new Date('2026-10-27T13:00:00Z');

beforeAll(async () => {
  ({ db, parar } = await iniciarBanco());
});
afterAll(async () => {
  await parar();
});
beforeEach(async () => {
  await limparBanco(db);
});

function deps(resultado: ResultadoEnvio = { tipo: 'enviado' }) {
  const enviarAprovado = vi.fn(async (_id: number) => resultado);
  const d: DepsAcoes = { db, enviarAprovado, agora: () => AGORA };
  return { d, enviarAprovado };
}

async function criar(sugerida: EtapaSugerida | null = null, comRascunho = true): Promise<number> {
  const conv = await db.query(`INSERT INTO conversas (jid, tipo, nome) VALUES ('c1@s.whatsapp.net', 'individual', 'C1') RETURNING id`);
  const conversaId = Number(conv.rows[0].id);
  const clienteId = await garantirClienteDaConversa(db, conversaId);
  const dem = await criarDemanda(db, {
    clienteId,
    conversaId,
    empresaId: null,
    categoriaId: null,
    titulo: 'Pedido',
    plano: null,
    prazo: null,
    prazoTemHora: false,
    etapaSugerida: sugerida,
    prioridade: 'media',
  });
  if (comRascunho) await salvarRascunho(db, dem.id, 'Bom dia, segue.', 'c1@s.whatsapp.net');
  return dem.id;
}

const contar = async (tabela: string) => Number((await db.query(`SELECT count(*) n FROM ${tabela}`)).rows[0].n);

describe('aplicarComando', () => {
  it('#99 não existe', async () => {
    const { d } = deps();
    expect(await aplicarComando(d, { tipo: 'comigo', numero: 99 }, 'whatsapp')).toBe('#99 não existe.');
  });

  it('demanda concluída não muda', async () => {
    const id = await criar('concluir');
    await db.query(`UPDATE demandas SET etapa = 'concluido' WHERE id = $1`, [id]);
    const { d, enviarAprovado } = deps();
    expect(await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'whatsapp')).toBe(`#${id} já está concluída.`);
    expect(enviarAprovado).not.toHaveBeenCalled();
    expect(await contar('aprovacoes')).toBe(0);
  });

  it('aprovar envia e aplica a etapa sugerida', async () => {
    const id = await criar('concluir');
    const { d, enviarAprovado } = deps();
    const msg = await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'painel');
    expect(enviarAprovado).toHaveBeenCalledTimes(1);
    expect((await buscarDemanda(db, id))?.etapa).toBe('concluido');
    const ap = await db.query(`SELECT a.hash, a.origem, r.hash rh FROM aprovacoes a JOIN rascunhos r ON r.id = a.rascunho_id`);
    expect(ap.rows).toHaveLength(1);
    expect(ap.rows[0].hash).toBe(ap.rows[0].rh);
    expect(ap.rows[0].origem).toBe('painel');
    const ex = await db.query(`SELECT antes, depois FROM exemplos_estilo`);
    expect(ex.rows).toEqual([{ antes: 'Bom dia, segue.', depois: 'Bom dia, segue.' }]);
    expect(msg).toContain('enviada');
  });

  it('aprovar sem rascunho só aplica a etapa sugerida', async () => {
    const id = await criar('aguardar', false);
    const { d, enviarAprovado } = deps();
    await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'whatsapp');
    expect(enviarAprovado).not.toHaveBeenCalled();
    expect((await buscarDemanda(db, id))?.etapa).toBe('aguardando_terceiro');
    expect(await contar('exemplos_estilo')).toBe(0);
  });

  it('aprovar com sugestão agendar sem prazo pede a data e não muda a etapa', async () => {
    const id = await criar('agendar');
    const { d } = deps();
    const msg = await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'whatsapp');
    expect(msg).toContain('agenda');
    expect((await buscarDemanda(db, id))?.etapa).toBe('novo');
  });

  it('aprovar bloqueado não muda a etapa e explica', async () => {
    const id = await criar('concluir');
    const { d } = deps({ tipo: 'bloqueado', motivo: 'o cliente escreveu depois do rascunho' });
    const msg = await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'whatsapp');
    expect(msg).toContain('o cliente escreveu depois do rascunho');
    expect((await buscarDemanda(db, id))?.etapa).toBe('novo');
    expect(await contar('exemplos_estilo')).toBe(0);
  });

  it('envio incerto repassa o erro sem mudar a etapa', async () => {
    const id = await criar('concluir');
    const erro = 'incerto: sem resposta — confira no WhatsApp antes de tentar de novo';
    const { d } = deps({ tipo: 'falhou', erro });
    const msg = await aplicarComando(d, { tipo: 'aprovar', numero: id }, 'whatsapp');
    expect(msg).toContain(erro);
    expect(msg).not.toContain('não foi enviada');
    expect((await buscarDemanda(db, id))?.etapa).toBe('novo');
  });

  it('mudar cria nova versão e guarda antes/depois', async () => {
    const id = await criar();
    const { d, enviarAprovado } = deps();
    const msg = await aplicarComando(d, { tipo: 'mudar', numero: id, texto: 'Olá!\nSegue a proforma.' }, 'whatsapp');
    const r = await rascunhoAtual(db, id);
    expect(r).toMatchObject({ versao: 2, texto: 'Olá!\nSegue a proforma.', destino: 'c1@s.whatsapp.net' });
    expect((await db.query(`SELECT antes, depois FROM exemplos_estilo`)).rows).toEqual([
      { antes: 'Bom dia, segue.', depois: 'Olá!\nSegue a proforma.' },
    ]);
    expect(msg).toContain('Olá!\nSegue a proforma.');
    expect(msg).toContain(`Responda ok ${id} para enviar.`);
    expect(enviarAprovado).not.toHaveBeenCalled();
  });

  it('agendar com data válida grava prazo e etapa', async () => {
    const id = await criar();
    const { d } = deps();
    await aplicarComando(d, { tipo: 'agendar', numero: id, quando: 'quinta 15h' }, 'whatsapp');
    const dem = await buscarDemanda(db, id);
    expect(dem?.etapa).toBe('agendado');
    expect(dem?.prazo).toEqual(new Date('2026-10-29T18:00:00Z'));
    expect(dem?.prazoTemHora).toBe(true);
  });

  it('agendar com data inválida responde com exemplo', async () => {
    const id = await criar();
    const { d } = deps();
    const msg = await aplicarComando(d, { tipo: 'agendar', numero: id, quando: 'sei lá' }, 'whatsapp');
    expect(msg).toBe(`Não entendi a data de #${id}. Ex.: ${id} agenda quinta 15h`);
    expect((await buscarDemanda(db, id))?.etapa).toBe('novo');
  });

  it.each([
    ['aguardar', 'aguardando_terceiro'],
    ['comigo', 'comigo'],
    ['concluir', 'concluido'],
  ] as const)('%s muda a etapa sem enviar', async (tipo, etapa) => {
    const id = await criar();
    const { d, enviarAprovado } = deps();
    await aplicarComando(d, { tipo, numero: id }, 'whatsapp');
    expect((await buscarDemanda(db, id))?.etapa).toBe(etapa);
    expect(enviarAprovado).not.toHaveBeenCalled();
    const h = await db.query(`SELECT autor, motivo FROM demanda_etapas WHERE demanda_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
    expect(h.rows[0]).toEqual({ autor: 'thiago', motivo: 'comando' });
  });
});
