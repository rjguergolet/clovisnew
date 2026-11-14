import { compararFrequenciaAluno, temDadosReaisNoMapao } from './attendanceComparisonHelper';
import { limparNomeDisciplina } from './boletimPdfParser';
import {
  isAlunoAtivo,
  isRegularTeachingClass,
  isSameProfessor,
  isTeacherAtSchool,
  normalizarDia,
  normalizeTeacherName
} from '../utils';

export type DashboardInteligenciaTab =
  | 'dash-evasao'
  | 'dash-academico'
  | 'dash-pontualidade'
  | 'dash-convivencia'
  | 'dash-pei'
  | 'dash-docente'
  | 'dash-governanca';

export interface GlobalDashboardFilters {
  segmento: string;
  turma: string;
  tutor: string;
  statusAluno: 'ativo' | 'transferido' | 'todos';
  busca: string;
}

export interface AlunoNormalizado {
  raw: any;
  ra: string;
  nome: string;
  turma: string;
  serie: string;
  segmento: string;
  tutor: string;
  clube: string;
  eletiva: string;
  projetoVida: string;
  ultimaTutoria: string;
  diasSemTutoria: number | null;
  ativo: boolean;
  recomposicao: boolean;
  aee: boolean;
  dataAtualizacaoSed: string;
  // Frequência SED
  sedFreq: number | null;
  sedAnterior: number | null;
  sedEvolucao: number | null;
  // Frequência Mapão
  mapaoFreq: number | null;
  mapaoFaltas: number | null;
  mapaoBimestre: string | null;
  ausenciaCompensadaTotal: number;
  // Frequência Diária
  diariaFreq: number | null;
  diariaPresentes: number;
  diariaFaltas: number;
  diariaJustificadas: number;
  diariaTotalDias: number;
  faltasConsecutivas: number;
  // Risco & Busca Ativa
  statusBuscaAtiva: string;
  temCompensacaoEntregue: boolean;
  alertaPrecoceDiaria: boolean;
  criticoGeral: boolean;
  ajusteManualSed: boolean;
  // Acadêmico
  mediaGeralAtual: number | null;
  qtdAbaixoBasicoAtual: number;
  notasPorBimestre: Record<'1B' | '2B' | '3B' | '4B', {
    mediaGeral: number | null;
    frequencia: number | null;
    qtdAbaixoBasico: number;
    disciplinas: Record<string, { nota: number | null; abaixoBasico: boolean; faltas: number; ausenciaCompensada: number }>;
  }>;
}

/**
 * Remove obrigatoriamente campos id e _id antes de gravar payloads no MongoDB Atlas (AGENTS.md).
 */
export function sanitizarPayloadMongo<T extends Record<string, any>>(payload: T): Omit<T, 'id' | '_id'> {
  if (!payload || typeof payload !== 'object') return payload as any;
  const clone: Record<string, any> = {};
  Object.entries(payload).forEach(([k, v]) => {
    if (k === 'id' || k === '_id' || v === undefined) return;
    if (Array.isArray(v)) {
      clone[k] = v.map((item) =>
        item && typeof item === 'object' && !(item instanceof Date) ? sanitizarPayloadMongo(item) : item
      );
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      clone[k] = sanitizarPayloadMongo(v);
    } else {
      clone[k] = v;
    }
  });
  return clone as Omit<T, 'id' | '_id'>;
}

export function normalizarRa(ra: unknown): string {
  return String(ra ?? '').replace(/\D/g, '').replace(/^0+/, '') || String(ra ?? '').trim();
}

/**
 * Converte com segurança qualquer campo dinâmico vindo do MongoDB (string, número, array ou objeto)
 * em uma string legível, evitando o erro React "Objects are not valid as a React child".
 */
export function formatarTextoSeguro(val: unknown, fallback = ''): string {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map((item) => formatarTextoSeguro(item)).filter(Boolean).join(', ') || fallback;
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, any>;
    if (obj.colecao && obj.docId) {
      return `${obj.colecao} (${obj.docId})`;
    }
    if (obj.nome) return String(obj.nome);
    if (obj.titulo) return String(obj.titulo);
    if (obj.descricao) return String(obj.descricao);
    if (obj.label) return String(obj.label);
    try {
      const json = JSON.stringify(obj);
      return json.length > 140 ? `${json.slice(0, 140)}…` : json;
    } catch {
      return fallback;
    }
  }
  return String(val);
}

export function parsePercentualSeguro(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    const normalized = val > 0 && val <= 1 ? val * 100 : val;
    return Math.round(Math.min(100, Math.max(0, normalized)) * 10) / 10;
  }
  const s = String(val).trim();
  if (!s || s === '-' || s === '—' || s.toUpperCase() === 'N/D' || s.toUpperCase() === 'S/D') return null;
  const limpo = s.replace('%', '').replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  if (isNaN(n)) return null;
  const normalized = n > 0 && n <= 1 && !s.includes('%') ? n * 100 : n;
  return Math.round(Math.min(100, Math.max(0, normalized)) * 10) / 10;
}

export function parseVariacaoSeguro(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : Math.round(val * 10) / 10;
  const s = String(val).trim();
  if (!s || s === '-' || s === '—') return null;
  const limpo = s.replace('%', '').replace('p.p.', '').replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isNaN(n) ? null : Math.round(n * 10) / 10;
}

export function parseNumeroSeguro(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const s = String(val).trim();
  if (!s || s === '-' || s === '—' || s.toUpperCase() === 'N/D') return null;
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? null : n;
}

export function inferirSegmento(aluno: any): string {
  const rawSeg = String(aluno?.segmento || aluno?.nivel_ensino || aluno?.etapa || '').trim();
  if (rawSeg) {
    const up = rawSeg.toUpperCase();
    if (up.includes('FUND') || up.includes('EF') || up.includes('ANOS FINAIS')) return 'Ensino Fundamental';
    if (up.includes('MÉD') || up.includes('MED') || up.includes('EM')) return 'Ensino Médio';
    return rawSeg;
  }
  const turma = String(aluno?.turma || '').toUpperCase().trim();
  if (/^[6789]/.test(turma)) return 'Ensino Fundamental';
  if (/^[123]/.test(turma) || turma.includes('EM') || turma.includes('E.M')) return 'Ensino Médio';
  return 'Não informado';
}

export function inferirSerie(turma: string): string {
  const t = String(turma || '').toUpperCase().trim();
  const match = t.match(/^(\d{1,2})\s*(º|°|ª)?/);
  if (!match) return turma || 'Outros';
  const num = parseInt(match[1], 10);
  if (num >= 6 && num <= 9) return `${num}º Ano EF`;
  if (num >= 1 && num <= 3) return `${num}ª Série EM`;
  return turma || 'Outros';
}

export function toIsoDate(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

export function calcularDiasDesde(rawDate: unknown): number | null {
  const iso = toIsoDate(rawDate);
  if (!iso) return null;
  const dt = new Date(`${iso}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((hoje.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Normaliza status de chamada diária para 'P' | 'F' | 'J'.
 */
export function normalizarStatusChamada(statusRaw: unknown): 'P' | 'F' | 'J' | null {
  if (!statusRaw) return null;
  const s = String(statusRaw).trim().toUpperCase();
  if (s === 'P' || s === 'PRESENTE' || s === 'ATRASADO' || s === 'A') return 'P';
  if (s === 'F' || s === 'FALTA' || s === 'AUSENTE') return 'F';
  if (s === 'J' || s === 'JUSTIFICADA' || s === 'LICENCA' || s === 'LICENÇA' || s === 'DISPENSA' || s === 'ATESTADO') {
    return 'J';
  }
  return null;
}

export interface DailyAttendanceMetrics {
  presentes: number;
  faltas: number;
  justificadas: number;
  totalDias: number;
  percentual: number | null;
  faltasConsecutivas: number;
}

export function construirIndiceFrequenciaDiaria(
  frequenciaDiariaDocs: any[]
): Map<string, DailyAttendanceMetrics> {
  // Mapeia raNormalizado -> Map<dataIso, 'P'|'F'|'J'>
  const porAlunoData = new Map<string, Map<string, 'P' | 'F' | 'J'>>();

  const registrar = (raRaw: unknown, dataIso: string, statusNorm: 'P' | 'F' | 'J' | null) => {
    if (!dataIso || !statusNorm) return;
    const raKey = normalizarRa(raRaw);
    if (!raKey) return;
    let mapDatas = porAlunoData.get(raKey);
    if (!mapDatas) {
      mapDatas = new Map();
      porAlunoData.set(raKey, mapDatas);
    }
    mapDatas.set(dataIso, statusNorm);
  };

  (frequenciaDiariaDocs || []).forEach((docItem) => {
    if (!docItem || typeof docItem !== 'object') return;
    const docDataIso = toIsoDate(docItem.data || docItem.dataChamada || docItem.id);

    // Formato 1: documento por dia com campo `registros: { [ra]: { status } }`
    if (docItem.registros && typeof docItem.registros === 'object' && !Array.isArray(docItem.registros)) {
      Object.entries(docItem.registros).forEach(([raKey, reg]: [string, any]) => {
        const statusVal = typeof reg === 'string' ? reg : reg?.status;
        registrar(raKey, docDataIso, normalizarStatusChamada(statusVal));
      });
    }

    // Formato 2: subestrutura por data `datas: { 'YYYY-MM-DD': { [ra]: 'P'|'F'|'J' } }`
    if (docItem.datas && typeof docItem.datas === 'object') {
      Object.entries(docItem.datas).forEach(([dtKey, mapa]: [string, any]) => {
        const iso = toIsoDate(dtKey);
        if (iso && mapa && typeof mapa === 'object') {
          Object.entries(mapa).forEach(([raKey, val]: [string, any]) => {
            const statusVal = typeof val === 'string' ? val : val?.status;
            registrar(raKey, iso, normalizarStatusChamada(statusVal));
          });
        }
      });
    }

    // Formato 3: registro individual por aluno/data `{ ra, data, status }`
    if (docItem.ra && docDataIso && docItem.status) {
      registrar(docItem.ra, docDataIso, normalizarStatusChamada(docItem.status));
    }
  });

  const out = new Map<string, DailyAttendanceMetrics>();
  porAlunoData.forEach((datasMap, raKey) => {
    const datasOrdenadas = Array.from(datasMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let presentes = 0;
    let faltas = 0;
    let justificadas = 0;

    datasOrdenadas.forEach(([, st]) => {
      if (st === 'P') presentes++;
      else if (st === 'F') faltas++;
      else if (st === 'J') justificadas++;
    });

    const totalDias = presentes + faltas + justificadas;
    const percentual =
      totalDias > 0 ? Math.round(((presentes + justificadas) / totalDias) * 1000) / 10 : null;

    let faltasConsecutivas = 0;
    for (let i = datasOrdenadas.length - 1; i >= 0; i--) {
      if (datasOrdenadas[i][1] === 'F') {
        faltasConsecutivas++;
      } else {
        break;
      }
    }

    out.set(raKey, {
      presentes,
      faltas,
      justificadas,
      totalDias,
      percentual,
      faltasConsecutivas
    });
  });

  return out;
}

function extrairBimestreFn(fn: any, bimKey: '1B' | '2B' | '3B' | '4B'): any {
  if (!fn || typeof fn !== 'object') return null;
  if (fn[bimKey]) return fn[bimKey];
  const aliasesMap: Record<string, string[]> = {
    '1B': ['1B', '1BIM', '1ºB', '1º B', '1', '1º', 'B1'],
    '2B': ['2B', '2BIM', '2ºB', '2º B', '2', '2º', 'B2'],
    '3B': ['3B', '3BIM', '3ºB', '3º B', '3', '3º', 'B3'],
    '4B': ['4B', '4BIM', '4ºB', '4º B', '4', '4º', 'B4']
  };
  for (const alias of aliasesMap[bimKey]) {
    if (fn[alias]) return fn[alias];
  }
  const num = bimKey[0];
  for (const [k, v] of Object.entries(fn)) {
    const up = k.toUpperCase().trim();
    if (up.startsWith(`${num}B`) || up.includes(`${num}º`) || up.includes(`${num} BIM`)) {
      return v;
    }
  }
  return null;
}

function extrairDisciplinasBimestre(bData: any) {
  const result: Record<string, { nota: number | null; abaixoBasico: boolean; faltas: number; ausenciaCompensada: number }> = {};
  if (!bData || typeof bData !== 'object' || !bData.disciplinas) return result;

  const processar = (rawNome: string, item: any) => {
    if (item === null || item === undefined) return;
    const nomeLimpo = limparNomeDisciplina(
      typeof item === 'object' ? (item.nome || item.disciplina || item.componente || rawNome) : rawNome
    );
    if (!nomeLimpo || nomeLimpo === '[OBJECT OBJECT]') return;

    if (typeof item === 'number' || typeof item === 'string') {
      const n = parseNumeroSeguro(item);
      const mencao = String(item).trim().toUpperCase();
      const abaixo = n !== null ? n < 5 : ['I', 'INSUFICIENTE', 'EP'].includes(mencao);
      result[nomeLimpo] = { nota: n, abaixoBasico: abaixo, faltas: 0, ausenciaCompensada: 0 };
      return;
    }

    const n = parseNumeroSeguro(item.notaNum ?? item.nota ?? item.media ?? item.valor ?? item.mencaoNota);
    const mencao = String(item.mencaoNota || item.mencao || '').trim().toUpperCase();
    const abaixo = item.abaixoBasico === true || (n !== null && n < 5) || ['I', 'INSUFICIENTE', 'EP'].includes(mencao);
    const faltas = Math.max(0, Number(item.faltas || 0) || 0);
    const aus = Math.max(0, Number(item.ausenciaCompensada || 0) || 0);
    result[nomeLimpo] = { nota: n, abaixoBasico: abaixo, faltas, ausenciaCompensada: aus };
  };

  if (Array.isArray(bData.disciplinas)) {
    bData.disciplinas.forEach((it: any, idx: number) => processar(it?.nome || it?.disciplina || `Disc ${idx + 1}`, it));
  } else if (typeof bData.disciplinas === 'object') {
    Object.entries(bData.disciplinas).forEach(([k, v]) => processar(k, v));
  }
  return result;
}

export function normalizarAlunos(
  alunosRaw: any[],
  buscaAtivaDocs: any[],
  frequenciaDiariaDocs: any[],
  ocorrenciasUnificadas: any[]
): AlunoNormalizado[] {
  const diariaIndex = construirIndiceFrequenciaDiaria(frequenciaDiariaDocs);

  // Índice de Busca Ativa por RA
  const baPorRa = new Map<string, any[]>();
  (buscaAtivaDocs || []).forEach((ba) => {
    const rk = normalizarRa(ba.ra || ba.raAluno);
    if (!rk) return;
    const arr = baPorRa.get(rk) || [];
    arr.push(ba);
    baPorRa.set(rk, arr);
  });

  // Última tutoria a partir de ocorrências (Tutoria e Acolhimento)
  const ultimaTutoriaPorRa = new Map<string, string>();
  (ocorrenciasUnificadas || []).forEach((oc) => {
    const tipoStr = String(oc?.tipo || oc?.categoria || '').toLowerCase();
    if (!tipoStr.includes('tutoria')) return;
    const rk = normalizarRa(oc.ra || oc.raAluno);
    if (!rk) return;
    const iso = toIsoDate(oc.data || oc.dataRegistro || oc.criadoEm);
    if (!iso) return;
    const prev = ultimaTutoriaPorRa.get(rk);
    if (!prev || iso > prev) {
      ultimaTutoriaPorRa.set(rk, iso);
    }
  });

  return (alunosRaw || []).map((aluno) => {
    const raRaw = String(aluno?.ra || aluno?.docId || aluno?.id || '').trim();
    const raKey = normalizarRa(raRaw);
    const nome = String(aluno?.nome || 'Estudante Sem Nome').trim();
    const turma = String(aluno?.turma || 'Sem Turma').trim().toUpperCase();
    const segmento = inferirSegmento(aluno);
    const serie = inferirSerie(turma);
    const tutor = String(aluno?.tutor_2026 || aluno?.tutor || '').trim();
    const clube = String(aluno?.clube || aluno?.clube_2026 || '').trim();
    const eletiva = String(aluno?.eletivas || aluno?.eletiva || aluno?.eletiva_2026 || '').trim();
    const projetoVida = String(aluno?.projeto_vida_2026 || aluno?.projetoDeVida || aluno?.pv || '').trim();
    const ativo = isAlunoAtivo(aluno);

    // Frequência SED & Evolução
    const comp = compararFrequenciaAluno(aluno);
    const sedAtual =
      comp.sedFreq ??
      parsePercentualSeguro(
        aluno?.presenca_anual ??
          aluno?.frequencia_atual?.presenca_percentual ??
          aluno?.frequencia_atual ??
          aluno?.presenca_26_06 ??
          aluno?.presenca_15_06
      );
    const sedAnterior = parsePercentualSeguro(
      aluno?.frequencia_anterior?.presenca_percentual ??
        aluno?.frequencia_anterior ??
        aluno?.presenca_15_06
    );
    let sedEvolucao = parseVariacaoSeguro(aluno?.evolucao ?? aluno?.frequencia_atual?.evolucao);
    if (sedEvolucao === null && sedAtual !== null && sedAnterior !== null) {
      sedEvolucao = Math.round((sedAtual - sedAnterior) * 10) / 10;
    }

    // Fechamento de notas (1B a 4B)
    let fn = aluno?.fechamento_notas || aluno?.fechamentos || aluno?.notas || {};
    if (typeof fn === 'string') {
      try {
        fn = JSON.parse(fn);
      } catch {
        fn = {};
      }
    }

    const notasPorBimestre: AlunoNormalizado['notasPorBimestre'] = {
      '1B': { mediaGeral: null, frequencia: null, qtdAbaixoBasico: 0, disciplinas: {} },
      '2B': { mediaGeral: null, frequencia: null, qtdAbaixoBasico: 0, disciplinas: {} },
      '3B': { mediaGeral: null, frequencia: null, qtdAbaixoBasico: 0, disciplinas: {} },
      '4B': { mediaGeral: null, frequencia: null, qtdAbaixoBasico: 0, disciplinas: {} }
    };

    let ausenciaCompensadaTotal = 0;
    let mediaGeralMaisRecente: number | null = parseNumeroSeguro(aluno?.media_geral);
    let qtdAbaixoMaisRecente = 0;

    (['1B', '2B', '3B', '4B'] as const).forEach((bKey) => {
      const bObj = extrairBimestreFn(fn, bKey);
      if (bObj && typeof bObj === 'object' && temDadosReaisNoMapao(bObj)) {
        const discs = extrairDisciplinasBimestre(bObj);
        const valoresNotas = Object.values(discs)
          .map((d) => d.nota)
          .filter((n): n is number => n !== null);

        const mediaB =
          parseNumeroSeguro(bObj.mediaGeral) ??
          (valoresNotas.length > 0
            ? Math.round((valoresNotas.reduce((a, b) => a + b, 0) / valoresNotas.length) * 10) / 10
            : null);

        const freqB = parsePercentualSeguro(
          bObj.frequenciaBimestre ?? bObj.frequenciaTotalAno ?? bObj.frequencia
        );
        const qtdAbaixo =
          typeof bObj.qtdAbaixoBasico === 'number'
            ? bObj.qtdAbaixoBasico
            : Object.values(discs).filter((d) => d.abaixoBasico).length;

        const ausCompB =
          Number(bObj.ausenciaCompensada || 0) +
          Object.values(discs).reduce((acc, d) => acc + d.ausenciaCompensada, 0);
        ausenciaCompensadaTotal += ausCompB;

        notasPorBimestre[bKey] = {
          mediaGeral: mediaB,
          frequencia: freqB,
          qtdAbaixoBasico: qtdAbaixo,
          disciplinas: discs
        };

        if (mediaB !== null) mediaGeralMaisRecente = mediaB;
        qtdAbaixoMaisRecente = qtdAbaixo;
      }
    });

    // Diária
    const diaria = diariaIndex.get(raKey) || {
      presentes: 0,
      faltas: 0,
      justificadas: 0,
      totalDias: 0,
      percentual: null,
      faltasConsecutivas: 0
    };

    // Busca Ativa status
    const registrosBa = (baPorRa.get(raKey) || []).slice().sort((a, b) =>
      String(b.data || b.dataRegistro || '').localeCompare(String(a.data || a.dataRegistro || ''))
    );
    const slaRaw = String(aluno?.sla_busca_ativa || '').toUpperCase();
    let statusBuscaAtiva = 'Sem Registro';
    if (slaRaw === 'ENCAMINHADO_CONSELHO' || registrosBa.some((r) => String(r.tipoContato || r.houveResposta || '').toLowerCase().includes('conselho'))) {
      statusBuscaAtiva = 'Conselho Tutelar';
    } else if (registrosBa.length > 0) {
      const ultimo = registrosBa[0];
      const resp = String(ultimo.houveResposta || '').toLowerCase();
      if (resp.includes('aguard') || resp.includes('não') || resp.includes('nao') || slaRaw === 'AGUARDANDO_RETORNO') {
        statusBuscaAtiva = 'Aguardando Retorno';
      } else {
        statusBuscaAtiva = 'Contato Realizado';
      }
    } else if (slaRaw === 'CONTATO_REALIZADO') {
      statusBuscaAtiva = 'Contato Realizado';
    } else if (slaRaw === 'MONITORANDO') {
      statusBuscaAtiva = 'Monitorando';
    }

    const temCompensacaoEntregue =
      ausenciaCompensadaTotal > 0 ||
      Boolean(aluno?.compensacao_ausencias_entregue || aluno?.ausenciaCompensada);

    const alertaPrecoceDiaria =
      diaria.percentual !== null &&
      diaria.percentual < 75 &&
      (sedAtual === null || sedAtual >= 75);

    const criticoGeral =
      (sedAtual !== null && sedAtual < 75) ||
      (comp.mapaoFreq !== null && comp.mapaoFreq < 75) ||
      (diaria.percentual !== null && diaria.percentual < 75) ||
      diaria.faltasConsecutivas >= 3;

    // Última tutoria
    const ultTutDireta = toIsoDate(aluno?.ultima_tutoria || aluno?.ultimaTutoria);
    const ultTutOc = ultimaTutoriaPorRa.get(raKey) || '';
    const ultimaTutoria = ultTutDireta && ultTutOc
      ? (ultTutDireta > ultTutOc ? ultTutDireta : ultTutOc)
      : (ultTutDireta || ultTutOc);
    const diasSemTutoria = ultimaTutoria ? calcularDiasDesde(ultimaTutoria) : null;

    return {
      raw: aluno,
      ra: raRaw,
      nome,
      turma,
      serie,
      segmento,
      tutor,
      clube,
      eletiva,
      projetoVida,
      ultimaTutoria,
      diasSemTutoria,
      ativo,
      recomposicao: Boolean(aluno?.recomposicao || aluno?.em_recomposicao),
      aee: Boolean(aluno?.aee || aluno?.publico_aee || aluno?.deficiencia),
      dataAtualizacaoSed: toIsoDate(aluno?.data_atualizacao_sed || aluno?.ultima_atualizacao_sed || aluno?.atualizadoEm),
      sedFreq: sedAtual,
      sedAnterior,
      sedEvolucao,
      mapaoFreq: comp.mapaoFreq,
      mapaoFaltas: comp.mapaoFaltas,
      mapaoBimestre: comp.mapaoBimestre,
      ausenciaCompensadaTotal,
      diariaFreq: diaria.percentual,
      diariaPresentes: diaria.presentes,
      diariaFaltas: diaria.faltas,
      diariaJustificadas: diaria.justificadas,
      diariaTotalDias: diaria.totalDias,
      faltasConsecutivas: diaria.faltasConsecutivas,
      statusBuscaAtiva,
      temCompensacaoEntregue,
      alertaPrecoceDiaria,
      criticoGeral,
      ajusteManualSed: comp.ajusteManual,
      mediaGeralAtual: mediaGeralMaisRecente,
      qtdAbaixoBasicoAtual: qtdAbaixoMaisRecente,
      notasPorBimestre
    };
  });
}

/**
 * Unifica ocorrências da coleção top-level `ocorrencias` e dos arrays aninhados nos documentos de `alunos`,
 * removendo duplicatas por id/assinatura.
 */
export function unificarOcorrencias(ocorrenciasTop: any[], alunosRaw: any[]): any[] {
  const mapa = new Map<string, any>();

  const adicionar = (oc: any, alunoFallback?: any) => {
    if (!oc || typeof oc !== 'object') return;
    const ra = normalizarRa(oc.ra || oc.raAluno || alunoFallback?.ra || alunoFallback?.id);
    const dataStr = String(oc.data || oc.dataRegistro || oc.criadoEm || '').slice(0, 19);
    const tipoStr = String(oc.tipo || oc.categoria || '').trim();
    const descStr = String(oc.descricao || oc.observacao || '').trim().slice(0, 60);
    const chave = oc.id ? `id:${oc.id}` : `sig:${ra}|${dataStr}|${tipoStr}|${descStr}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        ...oc,
        ra: oc.ra || alunoFallback?.ra || '',
        nomeAluno: oc.nomeAluno || oc.alunoNome || alunoFallback?.nome || '',
        turma: String(oc.turma || alunoFallback?.turma || '').toUpperCase().trim()
      });
    }
  };

  (ocorrenciasTop || []).forEach((oc) => adicionar(oc));
  (alunosRaw || []).forEach((al) => {
    const listas = [al?.ocorrencias, al?.historico_ocorrencias, al?.registros];
    listas.forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((oc) => adicionar(oc, al));
      }
    });
  });

  return Array.from(mapa.values()).sort((a, b) =>
    String(b.data || b.dataRegistro || b.criadoEm || '').localeCompare(
      String(a.data || a.dataRegistro || a.criadoEm || '')
    )
  );
}

export function extrairHoraMinutoAtraso(oc: any): { hhmm: string; minutosDesdeMeiaNoite: number } | null {
  const candidatos = [oc?.horaRealAtraso, oc?.horarioAtraso, oc?.horaAtraso];
  for (const c of candidatos) {
    if (c && /^\d{1,2}:\d{2}/.test(String(c).trim())) {
      const [h, m] = String(c).trim().slice(0, 5).split(':').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutosDesdeMeiaNoite: h * 60 + m };
      }
    }
  }
  const desc = String(oc?.descricao || '');
  const mDesc = desc.match(/(\d{1,2}):(\d{2})/);
  if (mDesc) {
    const h = Number(mDesc[1]);
    const m = Number(mDesc[2]);
    if (h >= 6 && h <= 22 && m >= 0 && m <= 59) {
      return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutosDesdeMeiaNoite: h * 60 + m };
    }
  }
  const dtStr = String(oc?.data || oc?.dataRegistro || '');
  if (dtStr.includes('T')) {
    const dt = new Date(dtStr);
    if (!isNaN(dt.getTime())) {
      const h = dt.getHours();
      const m = dt.getMinutes();
      return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutosDesdeMeiaNoite: h * 60 + m };
    }
  }
  return null;
}

export const SLOTS_GRADE_PEI: { code: string; periodoId: number; label: string; horario: string; turno: 'Manhã' | 'Tarde' }[] = [
  { code: '1M', periodoId: 1, label: '1M · 1ª Aula', horario: '07:00 - 07:50', turno: 'Manhã' },
  { code: '2M', periodoId: 2, label: '2M · 2ª Aula', horario: '07:50 - 08:40', turno: 'Manhã' },
  { code: '3M', periodoId: 3, label: '3M · 3ª Aula', horario: '08:50 - 09:40', turno: 'Manhã' },
  { code: '4M', periodoId: 4, label: '4M · 4ª Aula', horario: '09:40 - 10:30', turno: 'Manhã' },
  { code: '5M', periodoId: 5, label: '5M · 5ª Aula', horario: '10:30 - 11:20', turno: 'Manhã' },
  { code: '6M', periodoId: 6, label: '6M · 6ª Aula', horario: '12:20 - 13:10', turno: 'Tarde' },
  { code: '7T', periodoId: 7, label: '7T · 7ª Aula', horario: '13:10 - 14:00', turno: 'Tarde' },
  { code: '8T', periodoId: 8, label: '8T · 8ª Aula', horario: '14:20 - 15:10', turno: 'Tarde' },
  { code: '9T', periodoId: 9, label: '9T · 9ª Aula', horario: '15:10 - 16:00', turno: 'Tarde' }
];

export function analisarJanelasDocentes(
  dia: string,
  slotCode: string,
  horarios: any[],
  professores: any[],
  indisponibilidade: Record<string, any>
) {
  const slot = SLOTS_GRADE_PEI.find((s) => s.code === slotCode) || SLOTS_GRADE_PEI[0];
  const diaNorm = normalizarDia(dia);

  // Coletar todos os docentes únicos (da coleção professores + horários)
  const docentesMap = new Map<string, { nome: string; disciplina: string; area: string; turno: string }>();
  (professores || []).forEach((p) => {
    const nome = String(p?.nome || p?.professor || '').trim();
    if (!nome) return;
    const key = normalizeTeacherName(nome);
    if (!docentesMap.has(key)) {
      docentesMap.set(key, {
        nome,
        disciplina: String(p?.disciplina || p?.componente || 'Polivalente / PEI'),
        area: String(p?.area || ''),
        turno: String(p?.turno || 'INTEGRAL')
      });
    }
  });
  (horarios || []).forEach((h) => {
    const nome = String(h?.professor || '').trim();
    if (!nome || nome.toLowerCase().includes('vago') || nome === '-') return;
    const key = normalizeTeacherName(nome);
    if (!docentesMap.has(key)) {
      docentesMap.set(key, {
        nome,
        disciplina: String(h?.disciplina || 'Componente Curricular'),
        area: String(h?.area || ''),
        turno: 'INTEGRAL'
      });
    }
  });

  const aulasNoSlot = (horarios || []).filter((h) => {
    if (!isRegularTeachingClass(h)) return false;
    const hDia = normalizarDia(h?.dia);
    const pNum = Number(String(h?.periodoId ?? '').replace(/\D/g, ''));
    return hDia === diaNorm && pNum === slot.periodoId;
  });

  const disponiveis: { nome: string; disciplina: string; area: string; status: string }[] = [];
  const emAula: { nome: string; turma: string; disciplina: string }[] = [];
  const indisponiveis: { nome: string; motivo: string }[] = [];

  docentesMap.forEach((docente) => {
    const aulaAtual = aulasNoSlot.find((a) => isSameProfessor(a?.professor, docente.nome));
    if (aulaAtual) {
      emAula.push({
        nome: docente.nome,
        turma: String(aulaAtual.turma || '-'),
        disciplina: String(aulaAtual.disciplina || docente.disciplina)
      });
      return;
    }

    const schoolCheck = isTeacherAtSchool(
      docente.nome,
      diaNorm,
      slot.periodoId,
      indisponibilidade,
      horarios,
      professores
    );

    if (!schoolCheck.atSchool) {
      indisponiveis.push({
        nome: docente.nome,
        motivo: schoolCheck.reason || 'Janela / Fora de Expediente'
      });
    } else {
      disponiveis.push({
        nome: docente.nome,
        disciplina: docente.disciplina,
        area: docente.area,
        status: 'Em Janela (Livre na Escola)'
      });
    }
  });

  return {
    slot,
    disponiveis: disponiveis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    emAula: emAula.sort((a, b) => a.turma.localeCompare(b.turma, 'pt-BR')),
    indisponiveis: indisponiveis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  };
}
