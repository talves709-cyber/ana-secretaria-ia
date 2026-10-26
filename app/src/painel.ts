import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { QrCode } from './evolution.js';
import type { LinhaClassificada, ResumoDiario, ResumoMensagens, RetencaoResumo, RotinaEmpresa } from './repositorio.js';

export interface DepsPainel {
  senha: string;
  /** Garante que a instância existe e devolve o estado ("open", "connecting", "close"...). */
  estado: () => Promise<string>;
  qrCode: () => Promise<QrCode>;
  resumo: () => Promise<ResumoMensagens>;
  resumoDiario: () => Promise<ResumoDiario>;
  retencao: () => Promise<RetencaoResumo>;
  rotina: () => Promise<RotinaEmpresa[]>;
}

/** Texto de mensagem vem de terceiros: sempre escapar antes de pôr no HTML. */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const hora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function tabelaResumo(r: ResumoMensagens): string {
  const linhas = r.ultimas
    .map((m) => {
      const texto = m.texto ? escapar(m.texto.slice(0, 80)) : `<em>${escapar(m.tipo)}</em>`;
      const quem = m.deMim ? 'você → ' : '';
      return `<tr><td>${hora.format(m.recebidaEm)}</td><td>${quem}${escapar(m.conversa)}</td><td>${texto}</td></tr>`;
    })
    .join('');
  return `<p><strong>${r.hoje}</strong> mensagens hoje · <strong>${r.total}</strong> no total</p>
<table><thead><tr><th>Quando</th><th>Conversa</th><th>Mensagem</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

const PRIORIDADE_COR: Record<string, string> = {
  urgente: '#c5221f',
  alta: '#e8710a',
  media: '#1a73e8',
  baixa: '#5f6368',
};

function etiquetaPrioridade(p: string | null): string {
  if (!p) return '';
  return `<span class="tag" style="background:${PRIORIDADE_COR[p] ?? '#5f6368'}">${escapar(p)}</span>`;
}

function confiancaPct(c: number | null): string {
  return c === null ? '—' : `${Math.round(c * 100)}%`;
}

function linhaClassificada(m: LinhaClassificada): string {
  const assunto = m.resumo ? escapar(m.resumo) : m.texto ? escapar(m.texto.slice(0, 90)) : `<em>${escapar(m.tipo)}</em>`;
  const empresa = m.empresa ? escapar(m.empresa) : '<em>—</em>';
  const categoria = m.categoria ? escapar(m.categoria) : '<em>—</em>';
  return `<tr><td>${hora.format(m.recebidaEm)}</td><td>${escapar(m.conversa)}</td>
<td><strong>${empresa}</strong><br><span class="dica">${categoria}</span></td>
<td>${etiquetaPrioridade(m.prioridade)} ${assunto}</td><td class="num">${confiancaPct(m.confianca)}</td></tr>`;
}

function listaContagem(itens: { nome: string; total: number }[]): string {
  if (!itens.length) return '<p class="dica">Nada ainda hoje.</p>';
  return `<ul class="chips">${itens
    .map((i) => `<li>${escapar(i.nome)} <strong>${i.total}</strong></li>`)
    .join('')}</ul>`;
}

function tabela(titulo: string, linhas: LinhaClassificada[], vazio: string): string {
  if (!linhas.length) return `<h2>${titulo}</h2><p class="dica">${vazio}</p>`;
  const corpo = linhas.map(linhaClassificada).join('');
  return `<h2>${titulo}</h2><table><thead><tr><th>Quando</th><th>Conversa</th><th>Empresa / categoria</th><th>Assunto</th><th class="num">Conf.</th></tr></thead><tbody>${corpo}</tbody></table>`;
}

/** Monta a página /painel a partir do resumo do dia. Função pura, para testar o HTML. */
function blocoRetencao(t: RetencaoResumo): string {
  const data = t.maisAntiga ? hora.format(t.maisAntiga) : '—';
  const veredito =
    t.antigas === 0
      ? `<p class="ok"><strong>Nada com mais de ${t.limiteMeses} meses.</strong></p>`
      : `<p><strong>Não apague nada ainda.</strong> Por enquanto a Ana só mostra o que existe; a exclusão automática não está ligada.</p>`;
  return `<h2>Retenção (mais de ${t.limiteMeses} meses)</h2>${veredito}
<table><tbody>
<tr><td>Mensagens com mais de ${t.limiteMeses} meses</td><td class="num"><strong>${t.antigas}</strong></td></tr>
<tr><td>Já podem ser apagadas (classificadas com confiança)</td><td class="num">${t.podeApagar}</td></tr>
<tr><td>Manter: aguardam revisão</td><td class="num">${t.revisar}</td></tr>
<tr><td>Manter: ainda sem classificação</td><td class="num">${t.semClassificacao}</td></tr>
<tr><td>Mensagem mais antiga</td><td class="num">${data}</td></tr>
</tbody></table>`;
}

const VERBO: Record<string, string> = {
  responder: 'Responder',
  cotar: 'Cotar',
  pagar: 'Pagar',
  cobrar: 'Cobrar',
  agendar: 'Agendar',
  acompanhar: 'Acompanhar',
};

/** Um cartão por empresa, com a rotina de hoje ordenada por urgência. */
function blocoRotina(grupos: RotinaEmpresa[]): string {
  if (!grupos.length) return '<h2>Rotina de hoje</h2><p class="dica">Nenhuma ação pendente hoje.</p>';
  const cartoes = grupos
    .map((g) => {
      const cabeca = `<div class="cartao"><div class="cabeca"><strong>${escapar(g.empresa)}</strong>
<span class="dica">${g.total} ${g.total === 1 ? 'ação' : 'ações'} hoje</span>${
        g.urgentes ? ` <span class="tag" style="background:#c5221f">${g.urgentes} urgente${g.urgentes > 1 ? 's' : ''}</span>` : ''
      }</div>`;
      const itens = g.itens
        .map((i) => {
          const verbo = VERBO[i.acaoSugerida ?? ''] ?? 'Acompanhar';
          const assunto = i.resumo ? escapar(i.resumo) : i.texto ? escapar(i.texto.slice(0, 90)) : `<em>${escapar(i.tipo)}</em>`;
          return `<li>${etiquetaPrioridade(i.prioridade)} <strong>${verbo}:</strong> ${assunto} <span class="dica">· ${escapar(i.conversa)} · ${hora.format(i.recebidaEm)}</span></li>`;
        })
        .join('');
      return `${cabeca}<ol class="rotina">${itens}</ol></div>`;
    })
    .join('');
  return `<h2>Rotina de hoje, por empresa</h2><div class="grade">${cartoes}</div>`;
}

export interface BlocoAgenda {
  inicio: string;
  fim: string;
  titulo: string;
  itens: { empresa: string; acao: string | null; prioridade: string | null; assunto: string }[];
  fixo?: string;
}

/** Monta a agenda sugerida do dia (09h às 18h) a partir da rotina. Função pura. */
export function montarAgenda(grupos: RotinaEmpresa[]): BlocoAgenda[] {
  const blocos: BlocoAgenda[] = [
    { inicio: '09:00', fim: '10:00', titulo: 'Urgentes e prazos de hoje', itens: [] },
    { inicio: '10:00', fim: '12:00', titulo: 'Cotações e comercial', itens: [] },
    { inicio: '12:00', fim: '13:00', titulo: 'Almoço', itens: [], fixo: 'Pausa sugerida' },
    { inicio: '13:00', fim: '15:00', titulo: 'Cobranças e pagamentos', itens: [] },
    { inicio: '15:00', fim: '16:30', titulo: 'Agendar e acompanhar', itens: [] },
    { inicio: '16:30', fim: '17:30', titulo: 'Revisar a caixa e as empresas sugeridas', itens: [], fixo: 'Revisão' },
    { inicio: '17:30', fim: '18:00', titulo: 'Planejar o dia de amanhã', itens: [], fixo: 'Planejamento' },
  ];
  const [manha, comercial, , cobrancas, acompanhar] = blocos as BlocoAgenda[];
  for (const g of grupos) {
    for (const i of g.itens) {
      const item = { empresa: g.empresa, acao: i.acaoSugerida, prioridade: i.prioridade, assunto: i.resumo ?? i.texto ?? i.tipo };
      if (i.prioridade === 'urgente' || i.prioridade === 'alta') manha!.itens.push(item);
      else if (i.acaoSugerida === 'cotar' || i.acaoSugerida === 'responder') comercial!.itens.push(item);
      else if (i.acaoSugerida === 'cobrar' || i.acaoSugerida === 'pagar') cobrancas!.itens.push(item);
      else acompanhar!.itens.push(item);
    }
  }
  return blocos;
}

function blocoAgenda(grupos: RotinaEmpresa[]): string {
  const linhas = montarAgenda(grupos)
    .map((b) => {
      const lista = b.itens
        .slice(0, 10)
        .map((i) => `<li>${etiquetaPrioridade(i.prioridade)} <strong>${escapar(i.empresa)}</strong> · ${i.acao ? escapar(VERBO[i.acao] ?? i.acao) : 'Acompanhar'}: ${escapar(i.assunto.slice(0, 80))}</li>`)
        .join('');
      const mais = b.itens.length > 10 ? `<li class="dica">+${b.itens.length - 10} outras</li>` : '';
      const conteudo = b.fixo
        ? `<span class="dica">${escapar(b.fixo)}</span>`
        : b.itens.length
          ? `<ul class="agenda">${lista}${mais}</ul>`
          : '<span class="dica">Livre</span>';
      return `<tr><td class="hora">${b.inicio}–${b.fim}</td><td><strong>${escapar(b.titulo)}</strong>${conteudo ? `<br>${conteudo}` : ''}</td></tr>`;
    })
    .join('');
  return `<h2>Agenda sugerida de hoje</h2>
<p class="dica">Sugestão, ainda não está na sua agenda. Você decide o que entra.</p>
<table class="agenda-tab"><tbody>${linhas}</tbody></table>`;
}

export function paginaPainel(r: ResumoDiario, retencao?: RetencaoResumo, rotina: RotinaEmpresa[] = []): string {
  const empresas = listaContagem(r.porEmpresa.map((e) => ({ nome: e.empresa, total: e.total })));
  const categorias = listaContagem(r.porCategoria.map((c) => ({ nome: c.categoria, total: c.total })));
  const sugestoes = r.sugestoes.length
    ? `<h2>Empresas sugeridas</h2><p class="dica">A Ana viu contatos que podem ser novas empresas:</p>${listaContagem(
        r.sugestoes.map((s) => ({ nome: s.nome, total: s.qtd })),
      )}`
    : '';
  const corpo = `<p><strong>${r.totalHoje}</strong> mensagens classificadas hoje (${escapar(r.dia)})</p>
${blocoAgenda(rotina)}
${blocoRotina(rotina)}
<h2>Por empresa</h2>${empresas}
<h2>Por categoria</h2>${categorias}
${tabela('Precisa de revisão', r.revisao, 'Nada pendente de revisão. 👍')}
${tabela('Últimas classificações', r.recentes, 'Nenhuma mensagem classificada ainda.')}
${sugestoes}
${retencao ? blocoRetencao(retencao) : ''}
<p class="dica"><a href="/conexao">Ver estado da conexão</a> · atualiza a cada 2 min.</p>`;
  return pagina(corpo, 120);
}

function senhaConfere(cabecalho: string | undefined, senha: string): boolean {
  if (!cabecalho?.startsWith('Basic ')) return false;
  const decodificado = Buffer.from(cabecalho.slice(6), 'base64').toString('utf8');
  const recebida = Buffer.from(decodificado.slice(decodificado.indexOf(':') + 1));
  const esperada = Buffer.from(senha);
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

function pagina(corpo: string, recarregarEm?: number): string {
  const meta = recarregarEm ? `<meta http-equiv="refresh" content="${recarregarEm}">` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${meta}<title>Ana · Conexão</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;text-align:center;color:#222}
img{width:100%;max-width:320px;border:1px solid #ddd;border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}td,th{padding:6px 4px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-word}.ok{color:#137333}.dica{color:#666;font-size:14px}
h2{font-size:16px;margin:24px 0 8px;text-align:left}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;text-align:left}
.cartao{border:1px solid #e0e0e0;border-radius:10px;padding:12px}.cabeca{margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
ol.rotina{margin:0;padding-left:18px;font-size:13px}ol.rotina li{margin-bottom:6px}
.hora{white-space:nowrap;width:110px;font-variant-numeric:tabular-nums}ul.agenda{margin:4px 0 0;padding-left:18px;font-size:13px}ul.agenda li{margin-bottom:4px}
@media (max-width:480px){.hora{width:auto;white-space:normal}}.num{text-align:right;white-space:nowrap}
.tag{color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase}
ul.chips{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px;text-align:left}
ul.chips li{background:#f1f3f4;border-radius:14px;padding:4px 10px;font-size:13px}</style>
</head><body><h1>Ana</h1>${corpo}</body></html>`;
}

/** Página protegida por senha para ver o estado da conexão e ler o QR Code no navegador. */
export function registrarPainel(app: FastifyInstance, deps: DepsPainel) {
  app.get('/conexao', async (req, reply) => {
    if (!senhaConfere(req.headers.authorization, deps.senha)) {
      return reply.code(401).header('www-authenticate', 'Basic realm="Ana", charset="UTF-8"').send('Senha necessária');
    }
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');

    const estado = await deps.estado();
    if (estado === 'open') {
      const resumo = await deps.resumo();
      return pagina(`<p class="ok"><strong>WhatsApp conectado.</strong></p>${tabelaResumo(resumo)}`, 60);
    }
    const qr = await deps.qrCode();
    if (!qr.base64) {
      return pagina(`<p>Estado: ${estado}. Gerando o QR Code...</p>`, 5);
    }
    const pareamento = qr.pairingCode ? `<p class="dica">Ou use o código: <strong>${qr.pairingCode}</strong></p>` : '';
    return pagina(
      `<p>No celular: WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.</p>
<img src="${qr.base64}" alt="QR Code do WhatsApp">${pareamento}
<p class="dica">A página atualiza sozinha a cada 20 segundos.</p>`,
      20,
    );
  });

  app.get('/painel', async (req, reply) => {
    if (!senhaConfere(req.headers.authorization, deps.senha)) {
      return reply.code(401).header('www-authenticate', 'Basic realm="Ana", charset="UTF-8"').send('Senha necessária');
    }
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    const [resumo, retencao, rotina] = await Promise.all([deps.resumoDiario(), deps.retencao(), deps.rotina()]);
    return paginaPainel(resumo, retencao, rotina);
  });
}
