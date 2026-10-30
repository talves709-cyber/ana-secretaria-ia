import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import type { ComandoDeDemanda as Comando } from '../src/comandos.js';
import {
  confirmacoesDoBanco,
  criarInterpretarLivre,
  entradaDeComandos,
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
      aplicar: vi.fn(async (c: Comando) => {
        if (c.numero === 99) throw new Error('banco fora do ar');
        return c.tipo === 'aprovar' ? `#${c.numero} enviada.` : `#${c.numero} ok.`;
      }),
      demandasAbertas: vi.fn(async () => [{ numero: 7, empresa: 'Acme', titulo: 'Proforma de abril' }]),
      interpretarLivre: vi.fn(async (_t: string) => livre),
      confirmacaoPendente: vi.fn(async () => pendente),
      salvarConfirmacao: vi.fn(async (comandos: Comando[], _texto: string) => {
        pendente = { id: 1, comandos };
      }),
      fecharConfirmacao: vi.fn(async (_id: number, _estado: 'confirmada' | 'cancelada') => {
        pendente = null;
      }),
      mostrarResposta: vi.fn(async (n: number) => (n === 7 ? 'Bom dia, segue a proforma completa.' : null)),
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

  it('a confirmação de aprovar mostra o texto inteiro da resposta atual', async () => {
    const { d, respostas } = criar([{ tipo: 'aprovar', numero: 7 }, { tipo: 'aprovar', numero: 8 }]);
    await tratarMensagemDoDono(d, 'manda as duas');
    expect(d.mostrarResposta).toHaveBeenCalledWith(7);
    expect(respostas[0]).toContain('#7 (Acme - Proforma de abril): "Bom dia, segue a proforma completa."');
    expect(respostas[0]).toContain('aprovar e enviar a resposta de #8. Confirma?'); // sem resposta: só a descrição
  });

  it('a confirmação mostra empresa e título da demanda', async () => {
    const { d, respostas } = criar([{ tipo: 'aprovar', numero: 7 }, { tipo: 'concluir', numero: 8 }]);
    await tratarMensagemDoDono(d, 'manda a da proforma e fecha a outra');
    expect(respostas[0]).toContain('#7 (Acme - Proforma de abril)');
    expect(respostas[0]).toContain('concluir #8'); // demanda fora da lista: só o número
  });

  it('"sim" misturado com outros comandos pede o sim sozinho e não aplica nada', async () => {
    for (const texto of ['sim\nok 12', 'ok 12\nsim', 'não\n12 concluir']) {
      const { d, respostas } = criar([{ tipo: 'concluir', numero: 3 }]);
      await tratarMensagemDoDono(d, texto);
      expect(d.aplicar).not.toHaveBeenCalled();
      expect(d.interpretarLivre).not.toHaveBeenCalled();
      expect(respostas).toEqual(['Ana: Mande o "sim" ou o "não" sozinho, numa mensagem só.']);
    }
  });

  it('falha de um comando vira linha na resposta e os outros seguem', async () => {
    const { d, respostas } = criar();
    await expect(tratarMensagemDoDono(d, 'ok 99\n13 concluir')).resolves.toBeUndefined();
    expect(respostas).toEqual(['Ana: #99 falhou: banco fora do ar\n#13 ok.']);
  });

  it('falha ao aplicar texto livre confirmado também é respondida', async () => {
    const { d, respostas } = criar([{ tipo: 'concluir', numero: 99 }]);
    await tratarMensagemDoDono(d, 'fecha a grande');
    await tratarMensagemDoDono(d, 'sim');
    expect(respostas[1]).toBe('Ana: #99 falhou: banco fora do ar');
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
  it('mostrarResposta devolve o texto atual inteiro e o marca como mostrado; sem rascunho, null', async () => {
    const c = confirmacoesDoBanco(db);
    const cli = await db.query(`INSERT INTO clientes (nome) VALUES ('C') RETURNING id`);
    const dem = await db.query(`INSERT INTO demandas (cliente_id, titulo, prioridade) VALUES ($1,'t','media') RETURNING id`, [
      cli.rows[0].id,
    ]);
    const id = Number(dem.rows[0].id);
    expect(await c.mostrarResposta(id)).toBeNull();
    await db.query(
      `INSERT INTO rascunhos (demanda_id, versao, texto, destino, hash) VALUES ($1,1,'velho','d','h1'),($1,2,'atual','d','h2')`,
      [id],
    );
    expect(await c.mostrarResposta(id)).toBe('atual');
    const r = await db.query(`SELECT versao, mostrado_em FROM rascunhos ORDER BY versao`);
    expect(r.rows[0].mostrado_em).toBeNull();
    expect(r.rows[1].mostrado_em).not.toBeNull();
  });

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


describe('entrada de comandos no processarEvento', () => {
  it('sem JIDs ou sem fila o recurso fica desligado', () => {
    expect(entradaDeComandos([], { add: vi.fn() })).toBeUndefined();
    expect(entradaDeComandos([JID], null)).toBeUndefined();
  });

  it('enfileira a mensagem do dono com jobId estável', async () => {
    const add = vi.fn(async () => ({}));
    await entradaDeComandos([JID], { add })!.enfileirar(42);
    expect(add).toHaveBeenCalledWith('comando', { mensagemId: 42 }, { jobId: 'cmd-42' });
  });
});

describe('criarInterpretarLivre e o teto mensal', () => {
  function opcoes(podeGastar: boolean) {
    const parse = vi.fn(async () => ({
      stop_reason: 'end_turn',
      model: 'm',
      usage: { input_tokens: 1, output_tokens: 1 },
      parsed_output: { comandos: [{ tipo: 'concluir', numero: 1 }] },
    }));
    const registrarUso = vi.fn(async () => {});
    const fn = criarInterpretarLivre({
      client: { beta: { messages: { parse } } } as any,
      modelo: 'm',
      esforco: 'low',
      demandas: async () => [],
      registrarUso,
      podeGastar: async () => podeGastar,
    });
    return { fn, parse, registrarUso };
  }

  it('acima do teto devolve null sem chamar a IA', async () => {
    const { fn, parse, registrarUso } = opcoes(false);
    expect(await fn('fecha a 1')).toBeNull();
    expect(parse).not.toHaveBeenCalled();
    expect(registrarUso).not.toHaveBeenCalled();
  });

  it('dentro do teto chama a IA e registra o uso', async () => {
    const { fn, parse, registrarUso } = opcoes(true);
    expect(await fn('fecha a 1')).toEqual([{ tipo: 'concluir', numero: 1 }]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(registrarUso).toHaveBeenCalledTimes(1);
  });
});
