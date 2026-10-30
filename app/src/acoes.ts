// Ações do Thiago sobre uma demanda. Caminho único: WhatsApp e painel chamam `aplicarComando`.
import type { Db } from './db.js';
import type { Comando } from './comandos.js';
import { interpretarQuando, type ComandoDeDemanda } from './comandos.js';
import type { ResultadoEnvio } from './executor.js';
import {
  atualizarDemanda,
  buscarDemanda,
  mudarEtapa,
  rascunhoAtual,
  salvarRascunho,
  type Demanda,
  type Etapa,
  type EtapaSugerida,
} from './demandas.js';

export interface DepsAcoes {
  db: Db;
  enviarAprovado(aprovacaoId: number): Promise<ResultadoEnvio>;
  agora(): Date;
}

const ETAPA_DE: Record<Exclude<EtapaSugerida, 'agendar'>, Etapa> = {
  concluir: 'concluido',
  aguardar: 'aguardando_terceiro',
  comigo: 'comigo',
};

const ROTULO_ETAPA: Record<Etapa, string> = {
  novo: 'nova',
  comigo: 'com você',
  aguardando_terceiro: 'aguardando terceiro',
  agendado: 'agendada',
  concluido: 'concluída',
};

function formatarPrazo(d: Date, temHora: boolean): string {
  const tz = 'America/Sao_Paulo';
  const dia = d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' });
  if (!temHora) return dia;
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `${dia} ${hora}`;
}

/** Aplica a etapa sugerida; devolve o texto do que aconteceu. */
async function aplicarSugestao(d: DepsAcoes, dem: Demanda): Promise<string> {
  const n = dem.id;
  const s = dem.etapaSugerida;
  if (s === null) return `#${n} fica na etapa atual (${ROTULO_ETAPA[dem.etapa]}).`;
  if (s === 'agendar') {
    if (!dem.prazo) return `#${n} precisa de data. Ex.: ${n} agenda quinta 15h`;
    await mudarEtapa(d.db, n, 'agendado', 'thiago', 'comando');
    return `#${n} agendada para ${formatarPrazo(dem.prazo, dem.prazoTemHora)}.`;
  }
  const etapa = ETAPA_DE[s];
  await mudarEtapa(d.db, n, etapa, 'thiago', 'comando');
  return `#${n} agora está ${ROTULO_ETAPA[etapa]}.`;
}

export async function aplicarComando(d: DepsAcoes, c: ComandoDeDemanda, origem: 'whatsapp' | 'painel'): Promise<string> {
  const n = c.numero;
  const dem = await buscarDemanda(d.db, n);
  if (!dem) return `#${n} não existe.`;
  if (dem.etapa === 'concluido') return `#${n} já está concluída.`;

  switch (c.tipo) {
    case 'aprovar':
      return aprovar(d, dem, origem);

    case 'mudar': {
      const atual = await rascunhoAtual(d.db, n);
      let destino = atual?.destino;
      if (!destino && dem.conversaId != null) {
        const conv = await d.db.query(`SELECT jid FROM conversas WHERE id = $1`, [dem.conversaId]);
        destino = conv.rows[0]?.jid;
      }
      if (!destino) return `#${n} não tem para quem enviar.`;
      if (atual) {
        await d.db.query(`INSERT INTO exemplos_estilo (empresa_id, antes, depois) VALUES ($1, $2, $3)`, [dem.empresaId, atual.texto, c.texto]);
      }
      await salvarRascunho(d.db, n, c.texto, destino);
      return `Ana: nova resposta para #${n}:\n${c.texto}\n\nResponda ok ${n} para enviar.`;
    }

    case 'agendar': {
      const q = interpretarQuando(c.quando, d.agora());
      if (!q) return `Não entendi a data de #${n}. Ex.: ${n} agenda quinta 15h`;
      await atualizarDemanda(d.db, n, { prazo: q.data, prazoTemHora: q.temHora });
      await mudarEtapa(d.db, n, 'agendado', 'thiago', 'comando');
      return `#${n} agendada para ${formatarPrazo(q.data, q.temHora)}.`;
    }

    case 'aguardar':
    case 'comigo':
    case 'concluir': {
      const etapa = ETAPA_DE[c.tipo];
      await mudarEtapa(d.db, n, etapa, 'thiago', 'comando');
      return `#${n} agora está ${ROTULO_ETAPA[etapa]}.`;
    }
  }
}

async function aprovar(d: DepsAcoes, dem: Demanda, origem: 'whatsapp' | 'painel'): Promise<string> {
  const n = dem.id;
  const rascunho = await rascunhoAtual(d.db, n);
  if (!rascunho) return aplicarSugestao(d, dem);

  const ap = await d.db.query(`INSERT INTO aprovacoes (rascunho_id, hash, origem) VALUES ($1, $2, $3) RETURNING id`, [
    rascunho.id,
    rascunho.hash,
    origem,
  ]);
  const r = await d.enviarAprovado(Number(ap.rows[0].id));
  if (r.tipo === 'bloqueado') return `#${n} não foi enviada: ${r.motivo}.`;
  if (r.tipo === 'falhou') {
    // Envio incerto pode ter saído: o texto do erro vai inteiro, sem dizer que não saiu.
    return r.erro.startsWith('incerto:') ? `#${n}: envio ${r.erro}` : `#${n} não foi enviada: ${r.erro}`;
  }

  await d.db.query(`INSERT INTO exemplos_estilo (empresa_id, antes, depois) VALUES ($1, $2, $2)`, [dem.empresaId, rascunho.texto]);
  return `#${n} enviada. ${await aplicarSugestao(d, dem)}`;
}
