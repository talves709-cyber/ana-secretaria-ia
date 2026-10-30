import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db.js';
import { aplicarComando } from '../src/acoes.js';
import { registrarPainel } from '../src/painel.js';
import { paginaBases, paginaFicha, paginaQuadro, registrarPainelCrm, type CartaoQuadro } from '../src/painel-crm.js';
import { criarSessao } from '../src/sessao.js';

vi.mock('../src/acoes.js', () => ({ aplicarComando: vi.fn(async () => 'Ana: #7 enviada.') }));

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const comSessao = { cookie: `ana_sessao=${criarSessao(SEGREDO)}` };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const AGORA = new Date('2026-10-27T15:00:00Z');
const OPCOES = { empresas: [{ id: 1, nome: 'Empresa A' }], categorias: [{ id: 2, nome: 'Cotação' }] };

function cartao(extra: Partial<CartaoQuadro> = {}): CartaoQuadro {
  return {
    id: 7,
    etapa: 'novo',
    titulo: 'Pedido de cotação',
    cliente: 'Maria',
    clienteId: 3,
    empresa: 'Empresa A',
    categoria: 'Cotação',
    prioridade: 'alta',
    prazo: null,
    etapaDesde: new Date('2026-10-27T10:00:00Z'),
    resposta: null,
    etapaSugerida: null,
    ...extra,
  };
}

describe('paginaQuadro', () => {
  it('tem as 5 colunas e escapa o título', () => {
    const html = paginaQuadro([cartao({ titulo: '<script>alert(1)</script>' })], {}, OPCOES, AGORA);
    for (const t of ['Novo', 'Comigo', 'Aguardando terceiro', 'Agendado', 'Concluído']) expect(html).toContain(t);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&#60;script&#62;');
  });

  it('mostra "parado há 3 dias"', () => {
    const html = paginaQuadro([cartao({ etapaDesde: new Date('2026-10-24T14:00:00Z') })], {}, OPCOES, AGORA);
    expect(html).toContain('parado há 3 dias');
  });

  it('põe cada cartão na coluna da etapa e não oferece ações em concluídas', () => {
    const html = paginaQuadro([cartao({ id: 8, etapa: 'concluido' })], {}, OPCOES, AGORA);
    expect(html).toContain('#8');
    expect(html).not.toContain('/painel/demandas/8/acao');
  });

  it('escapa mensagem, resposta, empresa e cliente; vira lista no celular', () => {
    const html = paginaQuadro(
      [cartao({ resposta: '<img src=x>', cliente: '"><b>', empresa: '<i>e</i>' })],
      {},
      OPCOES,
      AGORA,
      '<u>msg</u>',
    );
    expect(html).not.toMatch(/<(img|b|i|u)[ >]/);
    expect(html).toContain('@media (max-width:900px){.quadro{grid-template-columns:1fr}');
  });

  it('guarda os filtros na volta e marca a opção escolhida', () => {
    const html = paginaQuadro([cartao()], { empresaId: 1, categoriaId: 2 }, OPCOES, AGORA);
    expect(html).toContain('name="volta" value="/painel/pipeline?empresa=1&#38;categoria=2"');
    expect(html).toContain('<option value="1" selected>');
  });
});

describe('paginaFicha e paginaBases', () => {
  it('ficha mostra contatos e demandas escapados', () => {
    const html = paginaFicha({ id: 3, nome: '<b>Maria</b>', contatos: ['a@b.c'], demandas: [cartao()] }, AGORA);
    expect(html).toContain('a@b.c');
    expect(html).toContain('#7');
    expect(html).not.toContain('<b>Maria');
  });

  it('bases traz um formulário por empresa com o texto escapado', () => {
    const html = paginaBases([{ empresaId: 1, empresa: 'Empresa A', versao: 2, texto: '</textarea><script>' }]);
    expect(html).toContain('action="/painel/bases/1"');
    expect(html).toContain('versão 2');
    expect(html).not.toContain('<script>');
  });
});

describe('rotas', () => {
  const enviarAprovado = vi.fn();
  function montar() {
    const app = Fastify();
    const acoes = { db: {} as Db, enviarAprovado, agora: () => AGORA };
    registrarPainel(app, {
      senha: 'x',
      sessaoSegredo: SEGREDO,
      estado: async () => 'open',
      qrCode: async () => ({ base64: '', code: '' }),
      resumo: async () => ({ total: 0, hoje: 0, ultimas: [] }),
      resumoDiario: async () => ({ dia: '', totalHoje: 0, porEmpresa: [], porCategoria: [], recentes: [], revisao: [], sugestoes: [] }),
    });
    registrarPainelCrm(app, { sessaoSegredo: SEGREDO, acoes });
    return { app, acoes };
  }
  beforeEach(() => vi.mocked(aplicarComando).mockClear());

  it('POST de ação sem sessão redireciona para /entrar', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/painel/demandas/7/acao', headers: FORM, payload: 'acao=aprovar' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toMatch(/^\/entrar/);
    expect(aplicarComando).not.toHaveBeenCalled();
  });

  it('GETs e POST de bases sem sessão também redirecionam', async () => {
    const { app } = montar();
    for (const url of ['/painel/pipeline', '/painel/clientes/3', '/painel/bases']) {
      const r = await app.inject({ url });
      expect(r.headers.location).toMatch(/^\/entrar/);
    }
    const r = await app.inject({ method: 'POST', url: '/painel/bases/1', headers: FORM, payload: 'texto=x' });
    expect(r.headers.location).toMatch(/^\/entrar/);
  });

  it('POST aprovar chama aplicarComando com origem painel e volta com a mensagem', async () => {
    const { app, acoes } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/painel/demandas/7/acao',
      headers: { ...FORM, ...comSessao },
      payload: 'acao=aprovar&volta=%2Fpainel%2Fpipeline%3Fempresa%3D1',
    });
    expect(aplicarComando).toHaveBeenCalledWith(acoes, { tipo: 'aprovar', numero: 7 }, 'painel');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/painel/pipeline?empresa=1&msg=${encodeURIComponent('Ana: #7 enviada.')}`);
  });

  it('agendar e mudar levam quando/texto; sem eles não chamam o comando', async () => {
    const { app } = montar();
    const h = { ...FORM, ...comSessao };
    await app.inject({ method: 'POST', url: '/painel/demandas/7/acao', headers: h, payload: 'acao=agendar&quando=quinta+15h' });
    expect(aplicarComando).toHaveBeenLastCalledWith(expect.anything(), { tipo: 'agendar', numero: 7, quando: 'quinta 15h' }, 'painel');
    await app.inject({ method: 'POST', url: '/painel/demandas/7/acao', headers: h, payload: 'acao=mudar&texto=Oi+tudo+bem' });
    expect(aplicarComando).toHaveBeenLastCalledWith(expect.anything(), { tipo: 'mudar', numero: 7, texto: 'Oi tudo bem' }, 'painel');
    vi.mocked(aplicarComando).mockClear();
    const r = await app.inject({ method: 'POST', url: '/painel/demandas/7/acao', headers: h, payload: 'acao=agendar&quando=' });
    expect(aplicarComando).not.toHaveBeenCalled();
    expect(r.headers.location).toContain('msg=');
  });

  it('ação desconhecida ou volta externa não chama o comando nem redireciona para fora', async () => {
    const { app } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/painel/demandas/7/acao',
      headers: { ...FORM, ...comSessao },
      payload: 'acao=apagar&volta=https%3A%2F%2Fmau.example',
    });
    expect(aplicarComando).not.toHaveBeenCalled();
    expect(r.headers.location).toMatch(/^\/painel\/pipeline\?msg=/);
  });

  it('erro na ação vira mensagem, não 500', async () => {
    vi.mocked(aplicarComando).mockRejectedValueOnce(new Error('segredo interno'));
    const { app } = montar();
    const r = await app.inject({ method: 'POST', url: '/painel/demandas/7/acao', headers: { ...FORM, ...comSessao }, payload: 'acao=concluir' });
    expect(r.statusCode).toBe(302);
    expect(decodeURIComponent(r.headers.location as string)).not.toContain('segredo interno');
  });
});
