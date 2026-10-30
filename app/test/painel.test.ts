import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { lerConfig } from '../src/config.js';
import type { ResumoDiario } from '../src/repositorio.js';
import { paginaPainel, registrarPainel } from '../src/painel.js';
import { criarServidor } from '../src/webhook.js';
import { criarSessao } from '../src/sessao.js';

const SENHA = 'senha-do-painel-123';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const comSessao = { cookie: `ana_sessao=${criarSessao(SEGREDO)}` };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

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
  registrarPainel(app, { senha: SENHA, sessaoSegredo: SEGREDO, estado: async () => estado, qrCode, resumo, resumoDiario });
  return { app, qrCode, resumoDiario };
}

describe('GET /conexao', () => {
  it('sem sessão redireciona para /entrar', async () => {
    const { app } = montar('close');
    const r = await app.inject({ url: '/conexao' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/entrar?volta=%2Fconexao');
  });

  it('mostra o QR Code quando não está conectado', async () => {
    const { app } = montar('connecting');
    const r = await app.inject({ url: '/conexao', headers: comSessao });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<img src="data:image/png;base64,AAAA"');
  });

  it('não pede QR Code quando já está conectado', async () => {
    const { app, qrCode } = montar('open');
    const r = await app.inject({ url: '/conexao', headers: comSessao });
    expect(r.body).toContain('WhatsApp conectado');
    expect(r.body).toContain('<strong>3</strong> mensagens hoje');
    expect(r.body).toContain('23/10, 15:00');
    expect(r.body).not.toContain('<script>');
    expect(qrCode).not.toHaveBeenCalled();
  });
});

describe('GET /painel', () => {
  it('sem sessão redireciona para /entrar', async () => {
    const { app, resumoDiario } = montar('open');
    const r = await app.inject({ url: '/painel' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/entrar?volta=%2Fpainel');
    expect(resumoDiario).not.toHaveBeenCalled();
  });

  it('recusa cookie com assinatura inválida', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: { cookie: 'ana_sessao=9999999999999.xxxx' } });
    expect(r.statusCode).toBe(302);
  });

  it('mostra o resumo do dia, as classificações e a revisão', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: comSessao });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<strong>4</strong> mensagens classificadas hoje');
    expect(r.body).toContain('Kas Agenciamentos');
    expect(r.body).toContain('Cliente pede cotação de frete');
    expect(r.body).toContain('Precisa de revisão');
    expect(r.body).toContain('Transportadora XPTO');
  });

  it('escapa texto de terceiros', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/painel', headers: comSessao });
    expect(r.body).not.toContain('<script>x</script>');
  });
});

describe('login', () => {
  const entrar = (app: ReturnType<typeof montar>['app'], senha: string, volta = '') =>
    app.inject({
      method: 'POST',
      url: '/entrar',
      headers: FORM,
      payload: `senha=${encodeURIComponent(senha)}&volta=${encodeURIComponent(volta)}`,
    });

  it('GET /entrar mostra o formulário', async () => {
    const { app } = montar('open');
    const r = await app.inject({ url: '/entrar?volta=%2Fconexao' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('type="password"');
    expect(r.body).toContain('value="/conexao"');
  });

  it('POST /entrar com senha certa grava cookie e redireciona', async () => {
    const { app } = montar('open');
    const r = await entrar(app, SENHA, '/conexao');
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/conexao');
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toContain('ana_sessao=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('o cookie emitido dá acesso ao painel', async () => {
    const { app } = montar('open');
    const r = await entrar(app, SENHA);
    const par = String(r.headers['set-cookie']).split(';')[0]!;
    const p = await app.inject({ url: '/painel', headers: { cookie: par } });
    expect(p.statusCode).toBe(200);
  });

  it('não redireciona para fora do site', async () => {
    const { app } = montar('open');
    for (const volta of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const r = await entrar(app, SENHA, volta);
      expect(r.headers.location).toBe('/painel');
    }
  });

  it('senha errada devolve 401 sem cookie', async () => {
    const { app } = montar('open');
    const r = await entrar(app, 'errada');
    expect(r.statusCode).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('POST /entrar com senha errada 5 vezes devolve 429, mesmo com a senha certa', async () => {
    const { app } = montar('open');
    for (let i = 0; i < 5; i++) expect((await entrar(app, 'errada')).statusCode).toBe(401);
    expect((await entrar(app, 'errada')).statusCode).toBe(429);
    expect((await entrar(app, SENHA)).statusCode).toBe(429);
  });

  it('POST /sair apaga o cookie', async () => {
    const { app } = montar('open');
    const r = await app.inject({ method: 'POST', url: '/sair', headers: comSessao });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/entrar');
    expect(String(r.headers['set-cookie'])).toMatch(/ana_sessao=;/);
  });
});

describe('limite por IP atrás do proxy', () => {
  function montarComProxy() {
    const app = criarServidor({ token: 'token-de-teste-123456', gravarEvento: async () => 1, enfileirar: async () => {} });
    registrarPainel(app, {
      senha: SENHA,
      sessaoSegredo: SEGREDO,
      estado: async () => 'open',
      qrCode: async () => ({ base64: '', code: 'x' }),
      resumo: async () => ({ total: 0, hoje: 0, ultimas: [] }),
      resumoDiario: async () => resumoDiarioFake(),
    });
    return app;
  }
  const tentar = (app: ReturnType<typeof montarComProxy>, xff: string, senha: string) =>
    app.inject({
      method: 'POST',
      url: '/entrar',
      headers: { ...FORM, 'x-forwarded-for': xff },
      payload: `senha=${senha}`,
    });

  it('origens diferentes têm contadores separados', async () => {
    const app = montarComProxy();
    for (let i = 0; i < 5; i++) await tentar(app, '10.0.0.1', 'errada');
    expect((await tentar(app, '10.0.0.1', 'errada')).statusCode).toBe(429);
    expect((await tentar(app, '10.0.0.2', 'errada')).statusCode).toBe(401);
    expect((await tentar(app, '10.0.0.2', SENHA)).statusCode).toBe(302);
    expect((await tentar(app, '10.0.0.1', SENHA)).statusCode).toBe(429);
  });

  it('com dois IPs no X-Forwarded-For usa o último (o do proxy)', async () => {
    const app = montarComProxy();
    for (let i = 0; i < 5; i++) await tentar(app, `9.9.9.${i}, 10.0.0.1`, 'errada');
    // mudar o primeiro IP (forjável) não escapa do bloqueio
    expect((await tentar(app, '8.8.8.8, 10.0.0.1', 'errada')).statusCode).toBe(429);
    expect((await tentar(app, '9.9.9.0, 10.0.0.3', 'errada')).statusCode).toBe(401);
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
        SESSAO_SEGREDO: 'troque-segredo-sessao',
      }),
    ).toThrow(/EVOLUTION_API_KEY[\s\S]*PAINEL_SENHA[\s\S]*SESSAO_SEGREDO/);
  });
});
