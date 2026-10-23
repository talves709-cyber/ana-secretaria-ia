import { describe, expect, it } from 'vitest';
import type { ClassificacaoParaGravar, ConversaParaIA, Taxonomia } from '../src/classificacao-dados.js';
import { classificarConversa, montarPedido, montarSistema, validar, type RespostaIA, type ResultadoIA } from '../src/classificador.js';

const taxonomia: Taxonomia = {
  empresas: [
    { id: 1, nome: 'Kas Agenciamentos', segmentoId: 10, apelidos: ['Kas'], descricao: 'Agenciamento de carga.', palavras: ['BL'] },
    { id: 2, nome: 'Pessoal', segmentoId: 11, apelidos: [], descricao: null, palavras: [] },
  ],
  negocios: [{ id: 5, empresaId: 1, nome: 'Frete marítimo', descricao: null }],
  categorias: [{ id: 7, nome: 'Cotação e comercial', descricao: null }],
};

const resposta: RespostaIA = {
  empresa_id: 1,
  empresa_nova: null,
  negocio_id: 5,
  categoria_id: 7,
  prioridade: 'alta',
  resumo: 'Cliente pede cotação de frete',
  acao_sugerida: 'cotar',
  confianca: 0.9,
};

const conversa: ConversaParaIA = {
  id: 3,
  tipo: 'grupo',
  nome: 'Clientes Kas',
  empresaDoContato: null,
  contexto: [{ id: 1, recebidaEm: new Date('2026-10-23T12:00:00Z'), deMim: false, autor: 'João', tipo: 'texto', texto: 'Bom dia' }],
  pendentes: [
    { id: 2, recebidaEm: new Date('2026-10-23T12:05:00Z'), deMim: false, autor: 'João', tipo: 'texto', texto: 'Cotação de um 40HC?' },
    { id: 4, recebidaEm: new Date('2026-10-23T12:06:00Z'), deMim: true, autor: '', tipo: 'texto', texto: 'Já te mando' },
  ],
};

describe('montarSistema e montarPedido', () => {
  it('lista empresas, negócios e categorias com ids', () => {
    const s = montarSistema(taxonomia);
    expect(s).toContain('empresa_id 1: Kas Agenciamentos');
    expect(s).toContain('negocio_id 5: Frete marítimo');
    expect(s).toContain('categoria_id 7: Cotação e comercial');
  });

  it('separa contexto de pendentes e marca o Thiago', () => {
    const p = montarPedido(conversa);
    expect(p).toContain('Conversa em grupo: Clientes Kas');
    expect(p.indexOf('Bom dia')).toBeLessThan(p.indexOf('<mensagens>'));
    expect(p).toContain('Thiago: Já te mando');
    expect(p).toContain('João: Cotação de um 40HC?');
  });
});

describe('validar', () => {
  it('aceita ids válidos e completa o segmento', () => {
    const { classificacao, empresaSugerida } = validar(resposta, taxonomia, 'm');
    expect(classificacao).toMatchObject({ empresaId: 1, negocioId: 5, segmentoId: 10, categoriaId: 7, confianca: 0.9 });
    expect(empresaSugerida).toBeNull();
  });

  it('derruba a confiança quando a IA inventa um id', () => {
    const { classificacao } = validar({ ...resposta, categoria_id: 99 }, taxonomia, 'm');
    expect(classificacao.categoriaId).toBeNull();
    expect(classificacao.confianca).toBe(0.3);
  });

  it('descarta negócio de outra empresa', () => {
    const { classificacao } = validar({ ...resposta, empresa_id: 2 }, taxonomia, 'm');
    expect(classificacao.negocioId).toBeNull();
    expect(classificacao.confianca).toBe(0.3);
  });

  it('sugere empresa nova quando não está no cadastro', () => {
    const { classificacao, empresaSugerida } = validar(
      { ...resposta, empresa_id: null, negocio_id: null, empresa_nova: ' Cliente XPTO ', confianca: 1.5 },
      taxonomia,
      'm',
    );
    expect(classificacao.empresaId).toBeNull();
    expect(classificacao.confianca).toBe(1);
    expect(empresaSugerida).toBe('Cliente XPTO');
  });
});

describe('classificarConversa', () => {
  function deps(resultado: ResultadoIA, c: ConversaParaIA | null = conversa) {
    const gravados: { ids: number[]; c: ClassificacaoParaGravar; sugerida: string | null }[] = [];
    return {
      gravados,
      d: {
        carregarTaxonomia: async () => taxonomia,
        carregarConversa: async () => c,
        gravar: async (ids: number[], cl: ClassificacaoParaGravar, sugerida: string | null) => {
          gravados.push({ ids, c: cl, sugerida });
        },
        perguntar: async () => resultado,
        modelo: 'claude-opus-5-5',
      },
    };
  }

  it('grava a classificação para todas as pendentes', async () => {
    const { d, gravados } = deps({ tipo: 'ok', resposta, modelo: 'claude-opus-5-5' });
    expect(await classificarConversa(d, 3)).toBe(2);
    expect(gravados[0]?.ids).toEqual([2, 4]);
    expect(gravados[0]?.c.categoriaId).toBe(7);
  });

  it('manda recusa para revisão com confiança zero', async () => {
    const { d, gravados } = deps({ tipo: 'recusa', motivo: 'cyber' });
    expect(await classificarConversa(d, 3)).toBe(2);
    expect(gravados[0]?.c.confianca).toBe(0);
    expect(gravados[0]?.c.resumo).toContain('cyber');
  });

  it('não chama a IA sem pendentes', async () => {
    const { d, gravados } = deps({ tipo: 'recusa', motivo: 'x' }, { ...conversa, pendentes: [] });
    expect(await classificarConversa(d, 3)).toBe(0);
    expect(gravados).toHaveLength(0);
  });
});
