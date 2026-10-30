// Interpretação pura de comandos curtos do Thiago e de datas ("quinta 15h"). Sem banco, sem IA.

export type Comando =
  | { tipo: 'aprovar'; numero: number }
  | { tipo: 'aguardar' | 'comigo' | 'concluir'; numero: number }
  | { tipo: 'agendar'; numero: number; quando: string }
  | { tipo: 'mudar'; numero: number; texto: string }
  | { tipo: 'confirmar' }
  | { tipo: 'cancelar' };

/** Minúsculas e sem acentos, mantendo o comprimento (para fatiar o original pelos mesmos índices). */
function normalizar(s: string): string {
  return Array.from(s.toLowerCase())
    .map((ch) => ch.normalize('NFD')[0])
    .join('');
}

const APROVAR = /^(?:ok|sim|aprovo|aprovado)\s+#?(\d+)$/;
const ETAPA = /^#?(\d+)\s+(?:(aguardar|aguarda)|(comigo)|(concluir|concluido|concluida|feito))$/;
const AGENDAR = /^#?(\d+)\s+(?:agenda|agendar)\s+(.+)$/;
const MUDAR = /^#?(\d+)\s+mudar?(?::\s*|\s+|$)(.*)$/;

/** `null` = não é comando curto (a mensagem toda vai para a IA). */
export function interpretarComandos(texto: string): Comando[] | null {
  const linhas = texto.split(/\r?\n/);
  const comandos: Comando[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const original = linhas[i].trim();
    if (original === '') continue;
    const norm = normalizar(original);

    if (/^(?:sim|confirmo)$/.test(norm) || /^(?:nao|cancela)$/.test(norm)) {
      // Confirmar/cancelar só vale sozinho na mensagem.
      if (comandos.length > 0 || linhas.slice(i + 1).some((l) => l.trim() !== '')) return null;
      return [{ tipo: /^(?:sim|confirmo)$/.test(norm) ? 'confirmar' : 'cancelar' }];
    }

    let m = APROVAR.exec(norm);
    if (m) {
      comandos.push({ tipo: 'aprovar', numero: Number(m[1]) });
      continue;
    }
    m = ETAPA.exec(norm);
    if (m) {
      const tipo = m[2] ? 'aguardar' : m[3] ? 'comigo' : 'concluir';
      comandos.push({ tipo, numero: Number(m[1]) });
      continue;
    }
    m = AGENDAR.exec(norm);
    if (m) {
      const quando = original.slice(norm.length - m[2].length).trim();
      comandos.push({ tipo: 'agendar', numero: Number(m[1]), quando });
      continue;
    }
    m = MUDAR.exec(norm);
    if (m) {
      // O texto novo é o resto da mensagem, inclusive as linhas seguintes.
      const primeira = original.slice(norm.length - m[2].length);
      const texto = [primeira, ...linhas.slice(i + 1)].join('\n').trim();
      if (texto === '') return null;
      comandos.push({ tipo: 'mudar', numero: Number(m[1]), texto });
      return comandos;
    }
    return null;
  }
  return comandos.length > 0 ? comandos : null;
}

// --- Datas (fuso America/Sao_Paulo, calculado pelo Intl) ---

const FUSO = 'America/Sao_Paulo';
const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

const formatoLocal = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Data/hora de parede em São Paulo de um instante, como UTC "falso" (para comparar e subtrair). */
function paredeSP(ms: number): { ano: number; mes: number; dia: number; comoUtc: number } {
  const p: Record<string, number> = {};
  for (const { type, value } of formatoLocal.formatToParts(new Date(ms))) p[type] = Number(value);
  return { ano: p.year, mes: p.month, dia: p.day, comoUtc: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) };
}

/** Deslocamento (ms) de São Paulo em relação ao UTC naquele instante (negativo a oeste). */
function deslocamentoSP(ms: number): number {
  return paredeSP(ms).comoUtc - Math.floor(ms / 1000) * 1000;
}

interface DiaLocal {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

function diaLocal(d: Date): DiaLocal {
  const { ano, mes, dia } = paredeSP(d.getTime());
  return { ano, mes, dia };
}

/** Instante UTC de uma data/hora de parede em São Paulo (o JS normaliza dia fora do mês). */
function instanteSP(ano: number, mes: number, dia: number, hora: number, minuto: number): Date {
  const parede = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let ms = parede - deslocamentoSP(parede);
  ms = parede - deslocamentoSP(ms); // reconfere o deslocamento no instante achado
  return new Date(ms);
}

const HORA = /^(?:as\s+)?(\d{1,2})(?:h(\d{2})?|:(\d{2}))$/;

function lerHora(s: string | undefined): { h: number; m: number } | null | undefined {
  if (s === undefined) return undefined; // sem hora
  const m = HORA.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

export function interpretarQuando(texto: string, agora: Date): { data: Date; temHora: boolean } | null {
  const partes = normalizar(texto.trim()).replace(/-feira$/, '').split(/\s+/);
  const alvo = partes[0].replace(/-feira$/, '');
  const hora = lerHora(partes.length > 1 ? partes.slice(1).join(' ') : undefined);
  if (hora === null) return null;
  const temHora = hora !== undefined;
  const { h, m } = hora ?? { h: 9, m: 0 };
  const hoje = diaLocal(agora);

  if (alvo === 'hoje') {
    const data = instanteSP(hoje.ano, hoje.mes, hoje.dia, h, m);
    return temHora && data <= agora ? null : { data, temHora };
  }
  if (alvo === 'amanha') {
    return { data: instanteSP(hoje.ano, hoje.mes, hoje.dia + 1, h, m), temHora };
  }

  const dow = DIAS_SEMANA.indexOf(alvo);
  if (dow >= 0) {
    const hojeDow = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia)).getUTCDay();
    let dias = (dow - hojeDow + 7) % 7;
    let data = instanteSP(hoje.ano, hoje.mes, hoje.dia + dias, h, m);
    if (data <= agora) {
      dias += 7;
      data = instanteSP(hoje.ano, hoje.mes, hoje.dia + dias, h, m);
    }
    return { data, temHora };
  }

  const dm = /^(\d{1,2})\/(\d{1,2})$/.exec(alvo);
  if (dm) {
    const dia = Number(dm[1]);
    const mes = Number(dm[2]);
    const valida = (ano: number): boolean => {
      const t = new Date(Date.UTC(ano, mes - 1, dia));
      return mes >= 1 && mes <= 12 && t.getUTCMonth() === mes - 1 && t.getUTCDate() === dia;
    };
    let ano = hoje.ano;
    // Data já passada (dia anterior a hoje, ou hoje com a hora vencida) vale para o ano seguinte.
    const passou = (a: number): boolean => {
      const d = instanteSP(a, mes, dia, h, m);
      return temHora ? d <= agora : d < instanteSP(hoje.ano, hoje.mes, hoje.dia, 0, 0);
    };
    if (!valida(ano)) return null;
    if (passou(ano)) {
      ano += 1;
      if (!valida(ano)) return null;
    }
    return { data: instanteSP(ano, mes, dia, h, m), temHora };
  }
  return null;
}
