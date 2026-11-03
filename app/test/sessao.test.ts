import { describe, expect, it } from 'vitest';
import { criarSessao, LimiteTentativas, sessaoValida } from '../src/sessao.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

describe('sessão', () => {
  it('aceita sessão recém-criada e recusa expirada', () => {
    const t = criarSessao(SEGREDO, new Date('2026-10-27T12:00:00Z'));
    expect(sessaoValida(t, SEGREDO, new Date('2026-10-27T23:59:00Z'))).toBe(true);
    expect(sessaoValida(t, SEGREDO, new Date('2026-10-28T00:01:00Z'))).toBe(false);
  });

  it('recusa token com assinatura alterada ou de outro segredo', () => {
    const t = criarSessao(SEGREDO);
    expect(sessaoValida(t.slice(0, -2) + 'xx', SEGREDO)).toBe(false);
    expect(sessaoValida(t, 'outro-segredo-com-mais-de-32-caracteres!!')).toBe(false);
  });

  it('recusa token ausente, malformado ou com expiração trocada', () => {
    const t = criarSessao(SEGREDO);
    expect(sessaoValida(undefined, SEGREDO)).toBe(false);
    expect(sessaoValida('lixo', SEGREDO)).toBe(false);
    expect(sessaoValida('.abc', SEGREDO)).toBe(false);
    expect(sessaoValida(`99999999999999.${t.split('.')[1]}`, SEGREDO)).toBe(false);
  });
});

describe('LimiteTentativas', () => {
  it('bloqueia o IP depois de 5 falhas em 15 minutos e libera depois', () => {
    const l = new LimiteTentativas();
    for (let i = 0; i < 5; i++) l.falhou('1.2.3.4', 0);
    expect(l.bloqueado('1.2.3.4', 1000)).toBe(true);
    expect(l.bloqueado('1.2.3.4', 15 * 60_000 + 1)).toBe(false);
  });

  it('não bloqueia com menos falhas, isola IPs e limpa', () => {
    const l = new LimiteTentativas();
    for (let i = 0; i < 4; i++) l.falhou('1.1.1.1', 0);
    expect(l.bloqueado('1.1.1.1', 1)).toBe(false);
    l.falhou('1.1.1.1', 2);
    expect(l.bloqueado('1.1.1.1', 3)).toBe(true);
    expect(l.bloqueado('2.2.2.2', 3)).toBe(false);
    l.limpar('1.1.1.1');
    expect(l.bloqueado('1.1.1.1', 4)).toBe(false);
  });

  it('descarta IPs vencidos ao registrar falhas, sem crescer sem limite', () => {
    const l = new LimiteTentativas();
    for (let i = 0; i < 10_000; i++) l.falhou(`ip-${i}`, 0);
    l.falhou('novo', 15 * 60_000 + 1);
    expect((l as unknown as { falhas: Map<string, number[]> }).falhas.size).toBe(1);
  });
});
