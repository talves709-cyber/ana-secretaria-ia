// Painel do CRM: quadro do pipeline, ficha do cliente e edição das bases de conhecimento.
// As páginas são funções puras (HTML a partir de dados); as rotas só ligam sessão, consultas e ações.
import type { FastifyInstance } from 'fastify';
import { aplicarComando, type DepsAcoes } from './acoes.js';
import type { Comando } from './comandos.js';
import {
  bases,
  fichaCliente,
  opcoesFiltro,
  quadro,
  salvarBase,
  type BaseEmpresa,
  type CartaoQuadro,
  type FichaCliente,
  type FiltrosQuadro,
} from './crm-dados.js';
import type { Etapa } from './demandas.js';
import { escapar, exigirSessao, pagina } from './painel.js';

export type { CartaoQuadro, FiltrosQuadro } from './crm-dados.js';

export interface DepsPainelCrm {
  sessaoSegredo: string;
  /** O mesmo conjunto de dependências do WhatsApp: db, enviarAprovado e relógio. */
  acoes: DepsAcoes;
}

export interface OpcoesQuadro {
  empresas: { id: number; nome: string }[];
  categorias: { id: number; nome: string }[];
}

const DIA_MS = 24 * 60 * 60 * 1000;

const COLUNAS: { etapa: Etapa; titulo: string }[] = [
  { etapa: 'novo', titulo: 'Novo' },
  { etapa: 'comigo', titulo: 'Comigo' },
  { etapa: 'aguardando_terceiro', titulo: 'Aguardando terceiro' },
  { etapa: 'agendado', titulo: 'Agendado' },
  { etapa: 'concluido', titulo: 'Concluído' },
];

const ESTILO = `body{max-width:1400px;text-align:left}
.quadro{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;align-items:start}
.col{background:#f8f9fa;border-radius:8px;padding:8px;min-width:0}
.col h2{margin:0 0 8px;font-size:14px}
.cartao{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px;word-break:break-word}
.cartao p{margin:4px 0}
.cartao .acoes{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.cartao button{padding:8px 10px;min-height:36px;font-size:13px}
.cartao details{margin-top:6px}
.cartao input[type=text],.cartao textarea{width:100%;box-sizing:border-box;margin:4px 0;padding:6px;font:inherit}
.resposta{background:#f1f3f4;border-radius:6px;padding:6px;white-space:pre-wrap}
.filtros{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
.filtros select,.filtros button{padding:8px;font-size:14px}
.aviso{background:#e8f0fe;border-radius:6px;padding:8px;white-space:pre-wrap}
textarea.base{width:100%;box-sizing:border-box;min-height:200px;padding:8px;font:inherit}
@media (max-width:900px){.quadro{grid-template-columns:1fr}body{margin:16px auto}}`;

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function textoParado(desde: Date, agora: Date): string {
  const dias = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / DIA_MS));
  if (dias === 0) return 'parado desde hoje';
  return `parado há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function blocoAviso(msg?: string): string {
  return msg ? `<p class="aviso">${escapar(msg)}</p>` : '';
}

function botao(acao: string, rotulo: string): string {
  return `<button type="submit" name="acao" value="${acao}">${rotulo}</button>`;
}

function cartaoHtml(c: CartaoQuadro, agora: Date, volta: string): string {
  const meta = [c.empresa, c.categoria].filter((x): x is string => Boolean(x)).map(escapar).join(' · ');
  const prazo = c.prazo ? `<p>Prazo: ${dataHora.format(c.prazo)}</p>` : '';
  const resposta = c.resposta ? `<p class="resposta">${escapar(c.resposta)}</p>` : '';
  const acoes =
    c.etapa === 'concluido'
      ? ''
      : `<form method="post" action="/painel/demandas/${c.id}/acao">
<input type="hidden" name="volta" value="${escapar(volta)}">
<div class="acoes">${botao('aprovar', 'Aprovar')}${botao('aguardar', 'Aguardar')}${botao('comigo', 'Comigo')}${botao('concluir', 'Concluir')}</div>
<details><summary>Agendar ou mudar a resposta</summary>
<input type="text" name="quando" placeholder="Quando? Ex.: quinta 15h" maxlength="80">
<div class="acoes">${botao('agendar', 'Agendar')}</div>
<textarea name="texto" rows="3" placeholder="Novo texto da resposta" maxlength="4000"></textarea>
<div class="acoes">${botao('mudar', 'Mudar resposta')}</div>
</details></form>`;
  return `<div class="cartao" id="d${c.id}">
<p><span class="tag" style="background:#5f6368">${escapar(c.prioridade)}</span> <strong>#${c.id}</strong> ${escapar(c.titulo)}</p>
<p><a href="/painel/clientes/${c.clienteId}">${escapar(c.cliente)}</a>${meta ? `<br><span class="dica">${meta}</span>` : ''}</p>
${prazo}<p class="dica">${textoParado(c.etapaDesde, agora)}</p>${resposta}${acoes}</div>`;
}

function queryDosFiltros(f: FiltrosQuadro): string {
  const p = new URLSearchParams();
  if (f.empresaId) p.set('empresa', String(f.empresaId));
  if (f.categoriaId) p.set('categoria', String(f.categoriaId));
  if (f.clienteId) p.set('cliente', String(f.clienteId));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function seletor(nome: string, rotulo: string, itens: { id: number; nome: string }[], atual?: number): string {
  const opcoes = itens
    .map((i) => `<option value="${i.id}"${i.id === atual ? ' selected' : ''}>${escapar(i.nome)}</option>`)
    .join('');
  return `<select name="${nome}" aria-label="${rotulo}"><option value="">${rotulo}: todas</option>${opcoes}</select>`;
}

export function paginaQuadro(cartoes: CartaoQuadro[], f: FiltrosQuadro, opcoes: OpcoesQuadro, agora: Date, msg?: string): string {
  const volta = `/painel/pipeline${queryDosFiltros(f)}`;
  const cliente = f.clienteId ? `<input type="hidden" name="cliente" value="${f.clienteId}">` : '';
  const colunas = COLUNAS.map(({ etapa, titulo }) => {
    const doGrupo = cartoes.filter((c) => c.etapa === etapa);
    const corpo = doGrupo.length ? doGrupo.map((c) => cartaoHtml(c, agora, volta)).join('') : '<p class="dica">Nada aqui.</p>';
    return `<section class="col"><h2>${titulo} (${doGrupo.length})</h2>${corpo}</section>`;
  }).join('');
  const corpo = `<h2 style="font-size:20px">Pipeline</h2>${blocoAviso(msg)}
<form class="filtros" method="get" action="/painel/pipeline">
${seletor('empresa', 'Empresa', opcoes.empresas, f.empresaId)}${seletor('categoria', 'Categoria', opcoes.categorias, f.categoriaId)}${cliente}
<button type="submit">Filtrar</button> <a href="/painel/pipeline">Limpar</a>
</form>
<div class="quadro">${colunas}</div>
<p class="dica"><a href="/painel">Painel</a> · <a href="/painel/bases">Bases de conhecimento</a></p>`;
  return pagina(corpo, undefined, ESTILO);
}

export function paginaFicha(ficha: FichaCliente, agora: Date, msg?: string): string {
  const volta = `/painel/clientes/${ficha.id}`;
  const contatos = ficha.contatos.length
    ? `<ul class="chips">${ficha.contatos.map((v) => `<li>${escapar(v)}</li>`).join('')}</ul>`
    : '<p class="dica">Sem contatos cadastrados.</p>';
  const demandas = ficha.demandas.length
    ? ficha.demandas.map((c) => cartaoHtml(c, agora, volta)).join('')
    : '<p class="dica">Nenhuma demanda.</p>';
  const corpo = `<h2 style="font-size:20px">${escapar(ficha.nome)}</h2>${blocoAviso(msg)}
<h2>Contatos</h2>${contatos}
<h2>Demandas</h2>${demandas}
<p class="dica"><a href="/painel/pipeline?cliente=${ficha.id}">Ver no quadro</a> · <a href="/painel/pipeline">Pipeline</a></p>`;
  return pagina(corpo, undefined, ESTILO);
}

export function paginaBases(lista: BaseEmpresa[], msg?: string): string {
  const blocos = lista
    .map(
      (b) => `<form method="post" action="/painel/bases/${b.empresaId}">
<h2>${escapar(b.empresa)} <span class="dica">versão ${b.versao}</span></h2>
<textarea class="base" name="texto" maxlength="20000">${escapar(b.texto)}</textarea>
<p><button type="submit" style="padding:8px 20px">Salvar nova versão</button></p></form>`,
    )
    .join('');
  const corpo = `<h2 style="font-size:20px">Bases de conhecimento</h2>${blocoAviso(msg)}
<p class="dica">O que a Ana sabe sobre cada empresa. Salvar cria uma nova versão.</p>${blocos}
<p class="dica"><a href="/painel">Painel</a> · <a href="/painel/pipeline">Pipeline</a></p>`;
  return pagina(corpo, undefined, ESTILO);
}

/** Id inteiro positivo de um parâmetro de rota ou de consulta; qualquer outra coisa vira undefined. */
function inteiro(v: unknown): number | undefined {
  if (typeof v !== 'string' || !/^\d{1,15}$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Só volta para páginas do próprio painel de CRM; o resto cai no quadro. */
const VOLTA_PERMITIDA = /^\/painel\/(?:pipeline(?:\?[\w=&]*)?|clientes\/\d{1,15})$/;

function comMsg(volta: unknown, msg: string): string {
  const base = typeof volta === 'string' && VOLTA_PERMITIDA.test(volta) ? volta : '/painel/pipeline';
  return `${base}${base.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg.slice(0, 500))}`;
}

type ComandoDeDemanda = Exclude<Comando, { tipo: 'confirmar' | 'cancelar' }>;

function comando(acao: string, numero: number, quando: string, textoNovo: string): ComandoDeDemanda | string {
  switch (acao) {
    case 'aprovar':
    case 'aguardar':
    case 'comigo':
    case 'concluir':
      return { tipo: acao, numero };
    case 'agendar':
      return quando ? { tipo: 'agendar', numero, quando } : 'Diga quando agendar. Ex.: quinta 15h';
    case 'mudar':
      return textoNovo ? { tipo: 'mudar', numero, texto: textoNovo } : 'Escreva o novo texto da resposta.';
    default:
      return 'Ação desconhecida.';
  }
}

function msgDe(q: unknown): string | undefined {
  const m = (q as { msg?: unknown } | undefined)?.msg;
  return typeof m === 'string' ? m.slice(0, 500) : undefined;
}

/** Rotas do painel do CRM. Precisam de `registrarPainel` já registrado (cookie e formulário). */
export function registrarPainelCrm(app: FastifyInstance, deps: DepsPainelCrm) {
  const db = deps.acoes.db;

  app.get('/painel/pipeline', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    const q = req.query as Record<string, unknown>;
    const filtros: FiltrosQuadro = { empresaId: inteiro(q.empresa), categoriaId: inteiro(q.categoria), clienteId: inteiro(q.cliente) };
    const agora = deps.acoes.agora();
    const [cartoes, opcoes] = await Promise.all([quadro(db, filtros, agora), opcoesFiltro(db)]);
    return paginaQuadro(cartoes, filtros, opcoes, agora, msgDe(q));
  });

  app.post('/painel/demandas/:id/acao', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const numero = inteiro((req.params as { id?: string }).id);
    if (!numero) return reply.redirect(comMsg(corpo.volta, 'Demanda inválida.'));
    const c = comando(texto(corpo.acao), numero, texto(corpo.quando), texto(corpo.texto));
    if (typeof c === 'string') return reply.redirect(comMsg(corpo.volta, c));
    let retorno: string;
    try {
      retorno = await aplicarComando(deps.acoes, c, 'painel');
    } catch (erro) {
      req.log.error({ err: erro }, 'ação do painel falhou');
      retorno = `#${numero}: a ação falhou. Veja os registros do servidor.`;
    }
    return reply.redirect(comMsg(corpo.volta, retorno));
  });

  app.get('/painel/clientes/:id', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    const id = inteiro((req.params as { id?: string }).id);
    const ficha = id ? await fichaCliente(db, id) : null;
    if (!ficha) return reply.code(404).send(pagina('<p>Cliente não encontrado.</p><p><a href="/painel/pipeline">Pipeline</a></p>'));
    return paginaFicha(ficha, deps.acoes.agora(), msgDe(req.query));
  });

  app.get('/painel/bases', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return paginaBases(await bases(db), msgDe(req.query));
  });

  app.post('/painel/bases/:empresaId', async (req, reply) => {
    if (!exigirSessao(req, reply, deps.sessaoSegredo)) return reply;
    const empresaId = inteiro((req.params as { empresaId?: string }).empresaId);
    const existente = empresaId ? (await bases(db)).find((b) => b.empresaId === empresaId) : undefined;
    const volta = (m: string) => `/painel/bases?msg=${encodeURIComponent(m)}`;
    if (!empresaId || !existente) return reply.redirect(volta('Empresa não encontrada.'));
    const novo = texto((req.body as Record<string, unknown> | undefined)?.texto);
    if (!novo) return reply.redirect(volta('Texto vazio: nada foi salvo.'));
    if (novo === existente.texto.trim()) return reply.redirect(volta(`${existente.empresa}: sem mudanças.`));
    await salvarBase(db, empresaId, novo);
    return reply.redirect(volta(`${existente.empresa}: base salva (versão ${existente.versao + 1}).`));
  });
}
