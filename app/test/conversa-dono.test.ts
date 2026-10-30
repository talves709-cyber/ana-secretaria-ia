import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import type { Comando } from '../src/comandos.js';
import {
  confirmacoesDoBanco,
  ehComandoDoDono,
  demandasParaInterprete,
  jidsDoDono,
  montarPedidoInterprete,
  tratarMensagemDoDono,
  type DepsConversaDono,
} from '../src/conversa-dono.js';
import type { MensagemNormalizada } from '../src/normalizar.js';
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

const JID = '5500000000000@s.whatsapp.net';

function msg(extra: Partial<MensagemNormalizada> = {}): MensagemNormalizada {
  return {
    whatsappMsgId: 'm1',
    conversaJid: JID,
    conversaTipo: 'individual',
    remetenteJid: null,
    remetenteNome: null,
    deMim: true,
    tipo: 'conversation',
    texto: 'ok 12',
    recebidaEm: new Date(),
    ...extra,
  };
}

describe('reconhecimento da mensagem do dono', () => {
  it('monta os JIDs a partir do número e dos extras; vazio = desligado', () => {
    expect(jidsDoDono({ DONO_WHATSAPP: '5500000000000', DONO_JIDS_EXTRA: ['999@lid'] })).toEqual([JID, '999@lid']);
    expect(jidsDoDono({ DONO_WHATSAPP: undefined, DONO_JIDS_EXTRA: ['999@lid'] })).toEqual([]);
  });

  it('aceita mensagem dele na própria conversa', () => {
    expect(ehComandoDoDono(msg(), [JID])).toBe(true);
  });

  it('ignora mensagem que começa com "Ana:"', () => {
    expect(ehComandoDoDono(msg({ texto: '  Ana: #12 enviada.' }), [JID])).toBe(false);
  });

  it('não trata mensagem de outra conversa como comando', () => {
    expect(ehComandoDoDono(msg({ conversaJid: 'outro@s.whatsapp.net' }), [JID])).toBe(false);
    expect(ehComandoDoDono(msg({ deMim: false }), [JID])).toBe(false);
    expect(ehComandoDoDono(msg({ texto: null }), [JID])).toBe(false);
  });

  it('aceita comando vindo de JID extra do dono', () => {
    expect(ehComandoDoDono(msg({ conversaJid: '999@lid' }), [JID, '999@lid'])).toBe(true);
  });
});

describe('tratarMensagemDoDono', () => {
  function criar(livre: Comando[] | null = null) {
    let pendente: { id: number; comandos: Comando[] } | null = null;
    const respostas: string[] = [];
    const d = {
      aplicar: vi.fn(async (c: Comando) => (c.tipo === 'aprovar' ? `#${c.numero} enviada.` : `#${(c as any).numero} ok.`)),
      interpretarLivre: vi.fn(async (_t: string) => livre),
      confirmacaoPendente: vi.fn(async () => pendente),
      salvarConfirmacao: vi.fn(async (comandos: Comando[], _texto: string) => {
        pendente = { id: 1, comandos };
      }),
      fecharConfirmacao: vi.fn(async (_id: number, _estado: 'confirmada' | 'cancelada') => {
        pendente = null;
      }),
      responder: vi.fn(async (t: string) => {
        respostas.push(t);
      }),
    } satisfies DepsConversaDono;
    return { d, respostas };
  }

  it('comando curto é aplicado na hora', async () => {
    const { d, respostas } = criar();
    await tratarMensagemDoDono(d, 'ok 12\n13 concluir');
    expect(d.aplicar).toHaveBeenCalledTimes(2);
    expect(d.interpretarLivre).not.toHaveBeenCalled();
    expect(respostas).toEqual(['Ana: #12 enviada.\n#13 ok.']);
  });

  it('texto livre pede confirmação e só aplica depois do sim', async () => {
    const { d, respostas } = criar([{ tipo: 'aprovar', numero: 7 }]);
    await tratarMensagemDoDono(d, 'manda a da proforma');
    expect(d.aplicar).not.toHaveBeenCalled();
    expect(respostas[0]).toMatch(/^Ana: Entendi: .*#7.*Confirma\? \(sim\/não\)$/);
    await tratarMensagemDoDono(d, 'sim');
    expect(d.aplicar).toHaveBeenCalledWith({ tipo: 'aprovar', numero: 7 });
    expect(d.fecharConfirmacao).toHaveBeenCalledWith(1, 'confirmada');
    expect(respostas[1]).toBe('Ana: #7 enviada.');
  });

  it('"não" cancela a confirmação pendente', async () => {
    const { d, respostas } = criar([{ tipo: 'concluir', numero: 3 }]);
    await tratarMensagemDoDono(d, 'acho que a 3 já acabou');
    await tratarMensagemDoDono(d, 'não');
    expect(d.fecharConfirmacao).toHaveBeenCalledWith(1, 'cancelada');
    expect(d.aplicar).not.toHaveBeenCalled();
    expect(respostas[1]).toMatch(/^Ana: Cancelado/);
  });

  it('sim sem nada pendente avisa', async () => {
    const { d, respostas } = criar();
    await tratarMensagemDoDono(d, 'sim');
    expect(respostas).toEqual(['Ana: Nada para confirmar.']);
  });

  it('IA sem comandos responde com as formas aceitas e não salva confirmação', async () => {
    for (const livre of [null, []] as (Comando[] | null)[]) {
      const { d, respostas } = criar(livre);
      await tratarMensagemDoDono(d, 'bom dia');
      expect(d.salvarConfirmacao).not.toHaveBeenCalled();
      expect(respostas[0]).toMatch(/^Ana: Não entendi\. Formas aceitas/);
    }
  });
});

describe('confirmações no banco', () => {
  it('confirmação com mais de 30 min não vale', async () => {
    const c = confirmacoesDoBanco(db);
    await c.salvarConfirmacao([{ tipo: 'concluir', numero: 5 }], 'texto');
    expect((await c.confirmacaoPendente())?.comandos).toEqual([{ tipo: 'concluir', numero: 5 }]);
    await db.query(`UPDATE confirmacoes SET criado_em = now() - interval '31 minutes'`);
    expect(await c.confirmacaoPendente()).toBeNull();
  });

  it('nova confirmação expira a pendente anterior e fechar tira da fila', async () => {
    const c = confirmacoesDoBanco(db);
    await c.salvarConfirmacao([{ tipo: 'concluir', numero: 1 }], 'a');
    await c.salvarConfirmacao([{ tipo: 'comigo', numero: 2 }], 'b');
    const p = await c.confirmacaoPendente();
    expect(p?.comandos).toEqual([{ tipo: 'comigo', numero: 2 }]);
    const estados = await db.query(`SELECT estado FROM confirmacoes ORDER BY id`);
    expect(estados.rows.map((r) => r.estado)).toEqual(['expirada', 'pendente']);
    await c.fecharConfirmacao(p!.id, 'confirmada');
    expect(await c.confirmacaoPendente()).toBeNull();
  });
});

describe('pedido ao interprete', () => {
  it('leva só demandas em novo/comigo com número, empresa e título', async () => {
    const conv = await db.query(`INSERT INTO conversas (jid, tipo) VALUES ('c@s.whatsapp.net', 'individual') RETURNING id`);
    const cli = await db.query(`INSERT INTO clientes (nome) VALUES ('C') RETURNING id`);
    const nova = (etapa: string, titulo: string) =>
      db.query(
        `INSERT INTO demandas (cliente_id, conversa_id, titulo, prioridade, etapa) VALUES ($1, $2, $3, 'media', $4)`,
        [cli.rows[0].id, conv.rows[0].id, titulo, etapa],
      );
    await nova('novo', 'Proforma');
    await nova('concluido', 'Velha');
    const lista = await demandasParaInterprete(db);
    expect(lista).toHaveLength(1);
    const pedido = montarPedidoInterprete('manda a da proforma', lista);
    expect(pedido).toContain('#1 | sem empresa | Proforma');
    expect(pedido).not.toContain('Velha');
    expect(pedido).toContain('manda a da proforma');
  });
});

