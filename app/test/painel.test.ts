import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { lerConfig } from '../src/config.js';
import type { ResumoDiario } from '../src/repositorio.js';
import { paginaPainel, registrarPainel } from '../src/painel.js';

const SENHA = 'senha-do-painel-123';
const auth = (senha: string) => `Basic ${Buffer.from(`thiago:${senha}`).toString('base64')}`;

const resumoDiarioFake = (): ResumoDiario => ({
  dia: '23/10',
  totalHoje: 4,
  porEmpresa: [
    { empresa: 'Kas Agenciamentos', total: 3 },
    { empresa: 'Sem empresa', total: 1 },
  ],
  porCategoria: [{ categoria: 'Cotação e comercial', total: 4 }],
  recentes: [
    {
      recebidaEm: new Date('2026-10-23T18:00:00Z'),
      conversa: 'Maria',
      empresa: 'Kas Agenciamentos',
      categoria: 'Cotação e comercial',
      prioridade: 'alta',
      acaoSugerida: 'cotar',
      resumo: 'Cliente pede cotação de frete',
      confianca: 0.92,
      texto: 'quanto fica um 40HC?',
      tipo: 'conversation',
    },
  ],
  revisao: [
    {
      recebidaEm: new Date('2026-10-23T17:00:00Z'),
      conversa: '<script>x</script>',
      empresa: null,
      categoria: null,
      prioridade: 'media',
      acaoSugerida: 'acompanhar',
      resumo: 'A IA ficou em dúvida',
      confianca: 0.2,
      texto: 'oi',
      tipo: 'conversation',
    },
  ],
  sugestoes: [{ nome: 'Transportadora XPTO', qtd: 2 }],
});

function montar(estado: string) {
  const app = Fastify();
  const qrCode = vi.fn(async () => ({ base64: 'data:image/png;base64,AAAA', code: 'x' }));
  const resumo = vi.fn(async () => ({
    total: 7,
    hoje: 3,
    ultimas: [
      { recebidaEm: new Date('2026-10-23T18:00:00Z'), conversa: 'Maria', deMim: false, tipo: 'conversation', texto: '<script>x</script> oi' },
    ],
  }));
  const resumoDiario = vi.fn(async () => resumoDiarioFake());
  const retencao = vi.fn(async () => ({ limiteMeses: 4, antigas: 5, podeApagar: 3, revisar: 1, semClassificacao: 1, maisAntiga: new Date('2026-05-01T12:00:00Z') }));
  const rotina = vi.fn(async () => [{ empresa: 'Kas Agenciamentos', total: 3, urgentes: 1, itens: [{ recebidaEm: new Date('2026-10-23T18:00:00Z'), conversa: 'Maria', prioridade: 'urgente', acaoSugerida: 'cotar', resumo: 'Cliente pede cotação urgente', texto: 'oi', tipo: 'conversation' }] }]);
  registrarPainel(app, { senha: SENHA, estado: async () => estado, qrCode, resumo, resumoDiario, retencao, rotina });
  return { app, qrCode, resumoDiario };
}

describe('GET /conexao', () => {
  it('pede senha', async () => {
    const { app } = montar('close');
    const r = await app.inject({ url: '/conexao', headers: { authorization: auth('errada') } });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toContain('Basic');
  });

  it('mostra o QR Code quando não está conectado', async () => {
    const { app } = montar('connecting');
    const r = await app.inject({ url: '/conexao', headers: { authorization: auth(SENHA) } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<img src="data:image/png;base64,AAAA"');
  });

  it('não pede QR Code quando já está conectado', async () => {
    const { app, qrCode } = montar('open');
    const r = await app.inject({ url: '/conexao', headers: { authorization: auth(SENHA) } });
    expect(r.body).toContain('WhatsApp conectado');
    expect(r.body).toContain('<strong>3</strong> mensagens hoje');
    expect(r.body).toContain('23/10, 15:00');
    expect(r.body).not.toContain('<script>');
    expect(qrCode).not.toHaveBeenCalled();
  });
});

describe('GET /painel', () => {
  it('pede senha', async () => {
    const { app, resumoDiario } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { authorization: auth('errada') } });
    expect(r.statusCode).toBe(401);
    expect(resumoDiario).not.toHaveBeenCalled();
  });

  it('mostra o resumo do dia, as classificações e a revisão', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { authorization: auth(SENHA) } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<strong>4</strong> mensagens classificadas hoje');
    expect(r.body).toContain('Kas Agenciamentos');
    expect(r.body).toContain('Cliente pede cotação de frete');
    expect(r.body).toContain('Precisa de revisão');
    expect(r.body).toContain('Transportadora XPTO');
  });

  it('escapa texto de terceiros', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { authorization: auth(SENHA) } });
    expect(r.body).not.toContain('<script>x</script>');
  });
});

describe('paginaPainel', () => {
  it('mostra aviso quando não há nada para revisar', () => {
    const html = paginaPainel({ ...resumoDiarioFake(), revisao: [], sugestoes: [] });
    expect(html).toContain('Nada pendente de revisão');
    expect(html).not.toContain('Empresas sugeridas');
  });
});

describe('lerConfig', () => {
  it('recusa segredos com o valor de exemplo', () => {
    expect(() =>
      lerConfig({
        DATABASE_URL: 'postgresql://x',
        REDIS_URL: 'redis://x',
        EVOLUTION_URL: 'http://evolution:8080',
        EVOLUTION_API_KEY: 'troque-chave-evolution',
        WEBHOOK_URL: 'http://app:3100/webhook/evolution',
        WEBHOOK_TOKEN: 'token-real-1234567890',
        PAINEL_SENHA: 'troque-senha-painel',
      }),
    ).toThrow(/EVOLUTION_API_KEY[\s\S]*PAINEL_SENHA/);
  });
});

describe('retenção: só mostra, nunca apaga', () => {
  it('informa quantas são antigas e não manda apagar', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { authorization: auth(SENHA) } });
    expect(r.body).toContain('Mensagens com mais de 4 meses');
    expect(r.body).toContain('Não apague nada ainda');
    expect(r.body).toContain('Já podem ser apagadas');
  });
});

describe('rotina do dia por empresa', () => {
  it('mostra cada empresa com a ação e a urgência', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { authorization: auth(SENHA) } });
    expect(r.body).toContain('Rotina de hoje, por empresa');
    expect(r.body).toContain('1 urgente');
    expect(r.body).toContain('<strong>Cotar:</strong> Cliente pede cotação urgente');
  });
});
