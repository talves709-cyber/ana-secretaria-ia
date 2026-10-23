import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { lerConfig } from '../src/config.js';
import { registrarPainel } from '../src/painel.js';

const SENHA = 'senha-do-painel-123';
const auth = (senha: string) => `Basic ${Buffer.from(`thiago:${senha}`).toString('base64')}`;

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
  registrarPainel(app, { senha: SENHA, estado: async () => estado, qrCode, resumo });
  return { app, qrCode };
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
