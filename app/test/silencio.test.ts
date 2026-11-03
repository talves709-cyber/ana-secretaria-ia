import { describe, expect, it } from 'vitest';
import { emSilencio, feriadosNacionais } from '../src/silencio.js';

describe('feriadosNacionais', () => {
  it('2026 inclui a Sexta-feira Santa em 03/04', () => expect(feriadosNacionais(2026)).toContain('2026-04-03'));
  it('2027 e 2024 têm a Sexta-feira Santa certa', () => {
    expect(feriadosNacionais(2027)).toContain('2027-03-26');
    expect(feriadosNacionais(2024)).toContain('2024-03-29');
  });
  it('tem os dez feriados', () => {
    const f = feriadosNacionais(2026);
    expect(f).toHaveLength(10);
    for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25'])
      expect(f).toContain(d);
  });
});

describe('emSilencio', () => {
  it.each([
    ['2026-10-27T21:59:00Z', false], // terça 18:59 SP
    ['2026-10-27T22:00:00Z', true], // terça 19:00 SP
    ['2026-10-28T10:59:00Z', true], // quarta 07:59 SP
    ['2026-10-28T11:00:00Z', false], // quarta 08:00 SP
    ['2026-10-31T15:00:00Z', true], // sábado
    ['2026-11-01T15:00:00Z', true], // domingo
    ['2026-11-02T15:00:00Z', true], // Finados
    ['2026-04-03T15:00:00Z', true], // Sexta-feira Santa
  ])('emSilencio(%s) = %s', (iso, esperado) => expect(emSilencio(new Date(iso))).toBe(esperado));

  it('usa o fuso de São Paulo, não o UTC', () => {
    // sexta 22:30 SP (sábado 01:30 UTC): silêncio pela noite
    expect(emSilencio(new Date('2026-10-31T01:30:00Z'))).toBe(true);
    // sexta 12:00 SP: dia útil
    expect(emSilencio(new Date('2026-10-30T15:00:00Z'))).toBe(false);
    // segunda 09:00 SP (12:00 UTC): dia útil
    expect(emSilencio(new Date('2026-11-09T12:00:00Z'))).toBe(false);
    // segunda 21:00 SP já é terça em UTC: silêncio pela noite
    expect(emSilencio(new Date('2026-11-03T00:00:00Z'))).toBe(true);
  });

  it('respeita início e fim configurados', () => {
    const terca16h = new Date('2026-10-27T19:00:00Z');
    expect(emSilencio(terca16h, 19, 8)).toBe(false);
    expect(emSilencio(terca16h, 16, 8)).toBe(true);
    expect(emSilencio(new Date('2026-10-27T11:00:00Z'), 19, 9)).toBe(true); // 08:00 SP, fim 9
  });

  it('janela que não vira a meia-noite (0 às 6) silencia só a madrugada', () => {
    // terça, horas de São Paulo
    expect(emSilencio(new Date('2026-10-27T03:00:00Z'), 0, 6)).toBe(true); // 00:00
    expect(emSilencio(new Date('2026-10-27T08:59:00Z'), 0, 6)).toBe(true); // 05:59
    expect(emSilencio(new Date('2026-10-27T09:00:00Z'), 0, 6)).toBe(false); // 06:00
    expect(emSilencio(new Date('2026-10-27T23:00:00Z'), 0, 6)).toBe(false); // 20:00
  });
});
