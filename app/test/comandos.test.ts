import { describe, expect, it } from 'vitest';
import { interpretarComandos, interpretarQuando } from '../src/comandos.js';

// terça 2026-10-27 10:00 em São Paulo
const AGORA = new Date('2026-10-27T13:00:00Z');

describe('interpretarComandos', () => {
  it.each([
    ['ok 14', [{ tipo: 'aprovar', numero: 14 }]],
    ['#14 Aguardar', [{ tipo: 'aguardar', numero: 14 }]],
    ['ok 14\n15 comigo', [{ tipo: 'aprovar', numero: 14 }, { tipo: 'comigo', numero: 15 }]],
    ['14 muda: Bom dia,\nsegue a proforma.', [{ tipo: 'mudar', numero: 14, texto: 'Bom dia,\nsegue a proforma.' }]],
    ['14 agenda quinta 15h', [{ tipo: 'agendar', numero: 14, quando: 'quinta 15h' }]],
    ['Sim', [{ tipo: 'confirmar' }]],
    ['NÃO', [{ tipo: 'cancelar' }]],
    ['cancela', [{ tipo: 'cancelar' }]],
    ['#7 concluída', [{ tipo: 'concluir', numero: 7 }]],
    ['8 feito', [{ tipo: 'concluir', numero: 8 }]],
    ['Aprovado #3', [{ tipo: 'aprovar', numero: 3 }]],
    ['14 agenda amanhã às 15h', [{ tipo: 'agendar', numero: 14, quando: 'amanhã às 15h' }]],
    ['manda a 14 amanhã cedo', null],
    ['ok 14\nbla bla', null],
    ['sim\nok 14', null],
    ['14 muda:', null],
    ['14 mudanças no pedido', null],
    ['3 mudamos o prazo', null],
    ['14 mudar Oi', [{ tipo: 'mudar', numero: 14, texto: 'Oi' }]],
    ['14 muda Oi\nfim', [{ tipo: 'mudar', numero: 14, texto: 'Oi\nfim' }]],
    ['', null],
  ])('interpretarComandos(%j)', (t, esperado) => expect(interpretarComandos(t)).toEqual(esperado));
});

describe('interpretarQuando', () => {
  it('formas aceitas', () => {
    expect(interpretarQuando('quinta 15h', AGORA)).toEqual({ data: new Date('2026-10-29T18:00:00Z'), temHora: true });
    expect(interpretarQuando('amanhã', AGORA)).toEqual({ data: new Date('2026-10-28T12:00:00Z'), temHora: false });
    expect(interpretarQuando('28/10 às 16:30', AGORA)).toEqual({ data: new Date('2026-10-28T19:30:00Z'), temHora: true });
    expect(interpretarQuando('terça 9h', AGORA)?.data).toEqual(new Date('2026-11-03T12:00:00Z'));
    expect(interpretarQuando('qualquer coisa', AGORA)).toBeNull();
  });

  it('hoje, hora com minutos e dia hoje ainda por vir', () => {
    expect(interpretarQuando('hoje 15h30', AGORA)).toEqual({ data: new Date('2026-10-27T18:30:00Z'), temHora: true });
    expect(interpretarQuando('hoje 9h', AGORA)).toBeNull();
    expect(interpretarQuando('terça 15h', AGORA)?.data).toEqual(new Date('2026-10-27T18:00:00Z'));
  });

  it('data já passada vai para o ano seguinte; data inválida é nula', () => {
    expect(interpretarQuando('26/10', AGORA)?.data).toEqual(new Date('2027-10-26T12:00:00Z'));
    expect(interpretarQuando('27/10', AGORA)?.data).toEqual(new Date('2026-10-27T12:00:00Z'));
    expect(interpretarQuando('31/02', AGORA)).toBeNull();
    expect(interpretarQuando('amanhã 25h', AGORA)).toBeNull();
  });
});
