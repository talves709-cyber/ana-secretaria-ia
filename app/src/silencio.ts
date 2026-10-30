// Quando a Ana não incomoda o Thiago: noite, sábado, domingo e feriados nacionais (fuso America/Sao_Paulo).

const FUSO = 'America/Sao_Paulo';

const formatoSP = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  weekday: 'short',
});

function parteSP(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of formatoSP.formatToParts(d)) p[type] = value;
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour), diaSemana: p.weekday! };
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');
const chaveData = (ano: number, mes: number, dia: number) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

/** Feriados nacionais do ano, 'AAAA-MM-DD' (inclui a Sexta-feira Santa, dois dias antes da Páscoa). */
export function feriadosNacionais(ano: number): string[] {
  const p = pascoa(ano);
  const sexta = new Date(Date.UTC(ano, p.mes - 1, p.dia - 2));
  return [
    chaveData(ano, 1, 1),
    chaveData(sexta.getUTCFullYear(), sexta.getUTCMonth() + 1, sexta.getUTCDate()),
    chaveData(ano, 4, 21),
    chaveData(ano, 5, 1),
    chaveData(ano, 9, 7),
    chaveData(ano, 10, 12),
    chaveData(ano, 11, 2),
    chaveData(ano, 11, 15),
    chaveData(ano, 11, 20),
    chaveData(ano, 12, 25),
  ];
}

/**
 * Fim de semana, feriado nacional, ou hora local dentro da janela [inicio, fim): a janela pode virar a
 * meia-noite (19 → 8) ou não (0 → 6). inicio igual a fim é recusado na configuração.
 */
export function emSilencio(agora: Date, inicio = 19, fim = 8): boolean {
  const { ano, mes, dia, hora, diaSemana } = parteSP(agora);
  if (diaSemana === 'Sat' || diaSemana === 'Sun') return true;
  if (feriadosNacionais(ano).includes(chaveData(ano, mes, dia))) return true;
  return inicio < fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}
