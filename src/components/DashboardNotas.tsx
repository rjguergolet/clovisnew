import React, { useState, useEffect, useMemo } from 'react';
import { copiarTabelaParaClipboard } from '../utils';
import { limparNomeDisciplina } from '../modules/boletimPdfParser';

/**
 * Dashboard Fixo de Rendimento Escolar & Fechamento de Notas dos Alunos
 * Acesso universal para todos os perfis pedagógicos e administrativos
 */

interface DisciplinaNota {
  disciplina?: string;
  nota?: number | string;
  faltas?: number;
  mencao?: string;
  aulas?: number;
  recuperacao?: number;
  abaixoBasico?: boolean;
}

interface FechamentoBimestre {
  bimestre?: number | string;
  bimestreKey?: string;
  anoLetivo?: number | string;
  turmaOriginal?: string;
  tipoFechamento?: string;
  totalAulasDadas?: number;
  totalFaltas?: number;
  frequenciaBimestre?: number;
  faltasTotalAno?: number;
  frequenciaTotalAno?: number;
  mediaGeral?: number;
  qtdAbaixoBasico?: number;
  disciplinas?: Record<string, DisciplinaNota> | DisciplinaNota[];
  atualizadoEm?: string;
  situacao?: string;
}

interface Aluno {
  id?: string;
  ra?: string;
  digito?: string;
  nome?: string;
  turma?: string;
  numero?: number | string;
  status?: string;
  frequencia?: number | string;
  media_geral?: number | string;
  tutor?: string;
  deficiencia?: string;
  aee?: boolean;
  fechamento_notas?: Record<string, FechamentoBimestre>;
  situacao_final_ano?: string;
  ultima_atualizacao_notas?: string;
}

export interface ResumoNotasPeriodo {
  mediaGeral?: number;
  totalFaltas?: number;
  frequenciaBimestre?: number;
  qtdAbaixoBasico?: number;
  disciplinas?: Record<string, DisciplinaNota>;
  detalheBimestres?: string;
  bimestresContados?: number;
}

/**
 * Helper para localizar os dados do bimestre no objeto com tolerância a múltiplos formatos
 */
function localizarBimestreObjeto(fn: Record<string, any>, periodo: string): FechamentoBimestre | null {
  if (!fn || typeof fn !== 'object') return null;
  if (fn[periodo]) return fn[periodo];

  const pNorm = periodo.toUpperCase().trim();
  for (const [k, v] of Object.entries(fn)) {
    if (!v) continue;
    const kNorm = k.toUpperCase().trim();
    if (kNorm === pNorm) return v as FechamentoBimestre;
    if (pNorm === '1B' && (kNorm === '1' || kNorm === '1º' || kNorm === '1B' || kNorm.startsWith('1B') || kNorm.startsWith('1_B') || kNorm.includes('1º') || kNorm.includes('1 BIM') || kNorm.includes('1º BIM') || kNorm === 'B1')) return v as FechamentoBimestre;
    if (pNorm === '2B' && (kNorm === '2' || kNorm === '2º' || kNorm === '2B' || kNorm.startsWith('2B') || kNorm.startsWith('2_B') || kNorm.includes('2º') || kNorm.includes('2 BIM') || kNorm.includes('2º BIM') || kNorm === 'B2')) return v as FechamentoBimestre;
    if (pNorm === '3B' && (kNorm === '3' || kNorm === '3º' || kNorm === '3B' || kNorm.startsWith('3B') || kNorm.startsWith('3_B') || kNorm.includes('3º') || kNorm.includes('3 BIM') || kNorm.includes('3º BIM') || kNorm === 'B3')) return v as FechamentoBimestre;
    if (pNorm === '4B' && (kNorm === '4' || kNorm === '4º' || kNorm === '4B' || kNorm.startsWith('4B') || kNorm.startsWith('4_B') || kNorm.includes('4º') || kNorm.includes('4 BIM') || kNorm.includes('4º BIM') || kNorm === 'B4')) return v as FechamentoBimestre;
    if (pNorm === 'FINAL' && (kNorm.includes('FINAL') || kNorm.includes('CONSELHO') || kNorm === 'ANUAL' || kNorm.includes('RECUPER') || kNorm === 'CF')) return v as FechamentoBimestre;
  }
  return null;
}

/**
 * Normaliza as disciplinas do bimestre suportando valores numéricos diretos, objetos e arrays.
 * Compatível com notaNum, mencaoNota, nota, media, valor e flag abaixoBasico.
 */
function normalizarDisciplinasBimestre(disciplinasRaw: any): Record<string, DisciplinaNota> {
  if (!disciplinasRaw) return {};
  const out: Record<string, DisciplinaNota> = {};

  const processarItem = (rawKey: string, val: any) => {
    if (val === null || val === undefined) return;

    if (typeof val === 'number' || typeof val === 'string') {
      const cleanName = limparNomeDisciplina(rawKey);
      if (!cleanName) return;
      const strVal = String(val).trim();
      const parsed = typeof val === 'number' ? val : parseFloat(strVal.replace(',', '.'));
      const isNum = !isNaN(parsed);
      const isAbaixo = isNum ? parsed < 5.0 : ['I', 'INSUFICIENTE', 'EP'].includes(strVal.toUpperCase());
      out[cleanName] = {
        disciplina: cleanName,
        nota: isNum ? parsed : strVal,
        mencao: !isNum ? strVal : undefined,
        abaixoBasico: isAbaixo
      };
      return;
    }

    if (typeof val === 'object') {
      const valObj = val as any;
      const rawName = (valObj.nome || valObj.disciplina || valObj.componente || valObj.materia || rawKey || '').trim();
      const cleanName = limparNomeDisciplina(rawName);
      if (!cleanName || cleanName === '[OBJECT OBJECT]') return;

      // Buscar nota numérica em todas as propriedades possíveis do fechamento
      const rawNotaCandidate = valObj.nota ?? valObj.notaNum ?? valObj.valor ?? valObj.media ?? valObj.notaFinal ?? valObj.resultado;
      let notaNum: number | undefined = undefined;

      if (typeof rawNotaCandidate === 'number' && !isNaN(rawNotaCandidate)) {
        notaNum = rawNotaCandidate;
      } else if (rawNotaCandidate !== undefined && rawNotaCandidate !== null && rawNotaCandidate !== '') {
        const parsed = parseFloat(String(rawNotaCandidate).replace(',', '.'));
        if (!isNaN(parsed)) notaNum = parsed;
      }

      // Se ainda não encontrou número, verificar se mencaoNota é valor numérico (ex: "4.5" ou "8,0")
      if (notaNum === undefined && valObj.mencaoNota) {
        const parsedMencao = parseFloat(String(valObj.mencaoNota).replace(',', '.'));
        if (!isNaN(parsedMencao)) {
          notaNum = parsedMencao;
        }
      }

      const mencaoStr = valObj.mencao || valObj.mencaoNota || valObj.conceito;
      const abaixoBasicoFlag = valObj.abaixoBasico === true ||
        (notaNum !== undefined && notaNum < 5.0) ||
        (mencaoStr && ['I', 'INSUFICIENTE', 'EP'].includes(String(mencaoStr).toUpperCase().trim()));

      out[cleanName] = {
        disciplina: cleanName,
        nota: notaNum !== undefined ? notaNum : (mencaoStr ? String(mencaoStr) : undefined),
        faltas: valObj.faltas !== undefined ? Number(valObj.faltas) : undefined,
        aulas: valObj.aulas !== undefined ? Number(valObj.aulas) : undefined,
        mencao: mencaoStr ? String(mencaoStr) : undefined,
        abaixoBasico: abaixoBasicoFlag
      };
    }
  };

  if (Array.isArray(disciplinasRaw)) {
    disciplinasRaw.forEach((item, idx) => {
      const defaultKey = item?.nome || item?.disciplina || item?.componente || `Disciplina ${idx + 1}`;
      processarItem(defaultKey, item);
    });
  } else if (typeof disciplinasRaw === 'object') {
    for (const [k, v] of Object.entries(disciplinasRaw)) {
      processarItem(k, v);
    }
  }

  return out;
}

/**
 * Retorna o resumo consolidado de notas do estudante para o período solicitado.
 * Suporta formatos flexíveis, tolerância a vírgulas e cálculo automático de médias.
 */
export function obterDadosPeriodoAluno(
  aluno: Aluno,
  periodo: '1B' | '2B' | '3B' | '4B' | 'FINAL' | 'COMPARATIVO'
): ResumoNotasPeriodo | null {
  if (!aluno) return null;
  const fn = aluno.fechamento_notas || (aluno as any).fechamentos || (aluno as any).notas || {};

  if (periodo !== 'COMPARATIVO') {
    const b = localizarBimestreObjeto(fn, periodo);

    if (b) {
      const disciplinasNorm = normalizarDisciplinasBimestre(b.disciplinas);
      let media = b.mediaGeral !== undefined && b.mediaGeral !== null && !isNaN(Number(b.mediaGeral)) ? Number(b.mediaGeral) : undefined;
      
      // Se a média não foi gravada previamente, calcula a partir das disciplinas
      if (media === undefined && Object.keys(disciplinasNorm).length > 0) {
        const notasValidas = Object.values(disciplinasNorm)
          .map(d => {
            if (typeof d.nota === 'number') return d.nota;
            if (d.nota !== undefined && d.nota !== null && d.nota !== '') {
              const p = parseFloat(String(d.nota).replace(',', '.'));
              if (!isNaN(p)) return p;
            }
            return NaN;
          })
          .filter(n => !isNaN(n) && n >= 0 && n <= 10);
        if (notasValidas.length > 0) {
          media = Number((notasValidas.reduce((acc, curr) => acc + curr, 0) / notasValidas.length).toFixed(1));
        }
      }

      // Calcula notas abaixo do básico caso não venha no fechamento
      let qtdAbaixo = b.qtdAbaixoBasico !== undefined ? Number(b.qtdAbaixoBasico) : 0;
      if (b.qtdAbaixoBasico === undefined && Object.keys(disciplinasNorm).length > 0) {
        qtdAbaixo = Object.values(disciplinasNorm).filter(d => {
          if (d.abaixoBasico === true) return true;
          if (d.nota !== undefined && !isNaN(Number(d.nota))) return Number(d.nota) < 5.0;
          return d.mencao === 'I' || d.mencao === 'Insuficiente' || d.mencao === 'EP';
        }).length;
      }

      return {
        mediaGeral: media,
        totalFaltas: b.totalFaltas !== undefined ? Number(b.totalFaltas) : undefined,
        frequenciaBimestre: b.frequenciaBimestre !== undefined ? Number(b.frequenciaBimestre) : undefined,
        qtdAbaixoBasico: qtdAbaixo,
        disciplinas: disciplinasNorm,
        detalheBimestres: periodo,
        bimestresContados: media !== undefined ? 1 : 0
      };
    }

    // Se o bimestre específico ainda não foi enviado mas o aluno tem média geral direta
    if (aluno.media_geral !== undefined && aluno.media_geral !== null && aluno.media_geral !== '' && aluno.media_geral !== '—') {
      const num = parseFloat(String(aluno.media_geral).replace(',', '.'));
      if (!isNaN(num)) {
        return {
          mediaGeral: Number(num.toFixed(1)),
          totalFaltas: undefined,
          frequenciaBimestre: aluno.frequencia ? Number(aluno.frequencia) : undefined,
          qtdAbaixoBasico: 0,
          disciplinas: {},
          detalheBimestres: 'Média Geral',
          bimestresContados: 1
        };
      }
    }

    return null;
  }

  // Modo COMPARATIVO / EVOLUÇÃO ANUAL: agrega todos os bimestres já subidos
  const bimKeys = ['1B', '2B', '3B', '4B'];
  let somaMedias = 0;
  let countBim = 0;
  let totalFaltas = 0;
  let somaFreq = 0;
  let countFreq = 0;
  let maxQtdAbaixo = 0;
  const bimPresentes: string[] = [];
  const consolidadoDisciplinas: Record<string, DisciplinaNota> = {};

  bimKeys.forEach(bk => {
    const b = localizarBimestreObjeto(fn, bk);
    if (b) {
      const disciplinasNorm = normalizarDisciplinasBimestre(b.disciplinas);
      let mediaBim = b.mediaGeral !== undefined && b.mediaGeral !== null && !isNaN(Number(b.mediaGeral)) ? Number(b.mediaGeral) : undefined;
      
      if (mediaBim === undefined && Object.keys(disciplinasNorm).length > 0) {
        const notas = Object.values(disciplinasNorm)
          .map(d => {
            if (typeof d.nota === 'number') return d.nota;
            if (d.nota !== undefined && d.nota !== null && d.nota !== '') {
              const p = parseFloat(String(d.nota).replace(',', '.'));
              if (!isNaN(p)) return p;
            }
            return NaN;
          })
          .filter(n => !isNaN(n) && n >= 0 && n <= 10);
        if (notas.length > 0) {
          mediaBim = notas.reduce((acc, curr) => acc + curr, 0) / notas.length;
        }
      }

      if (mediaBim !== undefined) {
        somaMedias += mediaBim;
        countBim++;
        bimPresentes.push(bk);
      }

      if (b.totalFaltas !== undefined && !isNaN(Number(b.totalFaltas))) {
        totalFaltas += Number(b.totalFaltas);
      }

      if (b.frequenciaBimestre !== undefined && !isNaN(Number(b.frequenciaBimestre))) {
        somaFreq += Number(b.frequenciaBimestre);
        countFreq++;
      }

      let qtdAbaixoBim = b.qtdAbaixoBasico !== undefined ? Number(b.qtdAbaixoBasico) : 0;
      if (b.qtdAbaixoBasico === undefined && Object.keys(disciplinasNorm).length > 0) {
        qtdAbaixoBim = Object.values(disciplinasNorm).filter(d => {
          if (d.abaixoBasico === true) return true;
          if (d.nota !== undefined && !isNaN(Number(d.nota))) return Number(d.nota) < 5.0;
          return d.mencao === 'I' || d.mencao === 'Insuficiente' || d.mencao === 'EP';
        }).length;
      }

      if (qtdAbaixoBim > maxQtdAbaixo) {
        maxQtdAbaixo = qtdAbaixoBim;
      }

      Object.entries(disciplinasNorm).forEach(([dNome, dInfo]) => {
        if (!consolidadoDisciplinas[dNome] || (dInfo.nota !== undefined && !isNaN(Number(dInfo.nota)))) {
          consolidadoDisciplinas[dNome] = { ...dInfo };
        }
      });
    }
  });

  // Se não tiver notas em 1B-4B mas tiver FINAL
  const bFinal = localizarBimestreObjeto(fn, 'FINAL');
  if (countBim === 0 && bFinal) {
    const disciplinasNorm = normalizarDisciplinasBimestre(bFinal.disciplinas);
    let mediaFinal = bFinal.mediaGeral !== undefined && !isNaN(Number(bFinal.mediaGeral)) ? Number(bFinal.mediaGeral) : undefined;
    if (mediaFinal === undefined && Object.keys(disciplinasNorm).length > 0) {
      const notas = Object.values(disciplinasNorm)
        .map(d => {
          if (typeof d.nota === 'number') return d.nota;
          if (d.nota !== undefined && d.nota !== null && d.nota !== '') {
            const p = parseFloat(String(d.nota).replace(',', '.'));
            if (!isNaN(p)) return p;
          }
          return NaN;
        })
        .filter(n => !isNaN(n) && n >= 0 && n <= 10);
      if (notas.length > 0) {
        mediaFinal = Number((notas.reduce((acc, curr) => acc + curr, 0) / notas.length).toFixed(1));
      }
    }

    return {
      mediaGeral: mediaFinal,
      totalFaltas: bFinal.totalFaltas,
      frequenciaBimestre: bFinal.frequenciaBimestre,
      qtdAbaixoBasico: bFinal.qtdAbaixoBasico || 0,
      disciplinas: disciplinasNorm,
      detalheBimestres: 'Conselho Final',
      bimestresContados: 1
    };
  }

  // Se não estiver no fechamento_notas, verificar se existe aluno.media_geral
  if (countBim === 0 && aluno.media_geral !== undefined && aluno.media_geral !== null && aluno.media_geral !== '' && aluno.media_geral !== '—') {
    const num = parseFloat(String(aluno.media_geral).replace(',', '.'));
    if (!isNaN(num)) {
      return {
        mediaGeral: Number(num.toFixed(1)),
        totalFaltas: undefined,
        frequenciaBimestre: aluno.frequencia ? Number(aluno.frequencia) : undefined,
        qtdAbaixoBasico: 0,
        disciplinas: {},
        detalheBimestres: 'Média Base',
        bimestresContados: 1
      };
    }
  }

  if (countBim === 0) return null;

  return {
    mediaGeral: Number((somaMedias / countBim).toFixed(1)),
    totalFaltas,
    frequenciaBimestre: countFreq > 0 ? Math.round(somaFreq / countFreq) : undefined,
    qtdAbaixoBasico: maxQtdAbaixo,
    disciplinas: consolidadoDisciplinas,
    detalheBimestres: bimPresentes.join(', '),
    bimestresContados: countBim
  };
}

export default function DashboardNotas() {
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [loading, setLoading] = useState(true);
  const [bimestreAtivo, setBimestreAtivo] = useState<'1B' | '2B' | '3B' | '4B' | 'FINAL' | 'COMPARATIVO'>('1B');
  const [turmaFiltro, setTurmaFiltro] = useState<string>('TODAS');
  const [disciplinaFiltro, setDisciplinaFiltro] = useState<string>('TODAS');
  const [statusFiltro, setStatusFiltro] = useState<'TODOS' | 'CRITICO' | 'ALERTA' | 'SATISFATORIO' | 'FREQ_BAIXA'>('TODOS');
  const [buscaTexto, setBuscaTexto] = useState<string>('');
  const [debouncedBuscaTexto, setDebouncedBuscaTexto] = useState<string>('');
  const [copiadoClipboard, setCopiadoClipboard] = useState<boolean>(false);
  const [ordenacao, setOrdenacao] = useState<'nome' | 'media_asc' | 'media_desc' | 'faltas_desc' | 'vermelhas_desc'>('nome');

  // Debounce de busca para eliminar atrasos na digitação
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedBuscaTexto(buscaTexto);
    }, 180);
    return () => clearTimeout(timer);
  }, [buscaTexto]);

  // Sincronização dos dados com window.allStudentsData ou evento global
  const carregarAlunos = () => {
    if (typeof window !== 'undefined' && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0) {
      setAlunos([...window.allStudentsData]);
      setLoading(false);
    } else {
      // Se ainda não estiver populado, tenta chamar o carregamento do Firestore
      if (typeof window !== 'undefined' && typeof (window as any).carregarAlunosDoFirestore === 'function') {
        (window as any).carregarAlunosDoFirestore().then(() => {
          if (Array.isArray(window.allStudentsData)) {
            setAlunos([...window.allStudentsData]);
          }
          setLoading(false);
        }).catch(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    carregarAlunos();

    const handleUpdate = () => {
      if (typeof window !== 'undefined' && Array.isArray(window.allStudentsData)) {
        setAlunos([...window.allStudentsData]);
      }
    };

    window.addEventListener('studentsdataupdated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('studentsdataupdated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  // Auto-selecionar o bimestre que possui dados se o atual estiver sem registros
  useEffect(() => {
    if (alunos.length > 0) {
      const periodoTemDados = (p: string) => {
        return alunos.some(a => {
          const fn = a.fechamento_notas || (a as any).fechamentos || (a as any).notas;
          return fn && localizarBimestreObjeto(fn, p);
        });
      };

      if (!periodoTemDados(bimestreAtivo)) {
        const periodosCandidatos: Array<'1B' | '2B' | '3B' | '4B' | 'FINAL'> = ['1B', '4B', '3B', '2B', 'FINAL'];
        for (const p of periodosCandidatos) {
          if (periodoTemDados(p)) {
            setBimestreAtivo(p);
            break;
          }
        }
      }
    }
  }, [alunos]);

  // Extrair lista única de turmas
  const turmasDisponiveis = useMemo(() => {
    const setT = new Set<string>();
    alunos.forEach(a => {
      if (a.turma && a.turma.trim()) {
        setT.add(a.turma.trim());
      }
    });
    return Array.from(setT).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [alunos]);

  // Extrair lista de todas as disciplinas encontradas nas notas
  const disciplinasDisponiveis = useMemo(() => {
    const setD = new Set<string>();
    alunos.forEach(a => {
      const fn = a.fechamento_notas || (a as any).fechamentos || (a as any).notas;
      if (fn && typeof fn === 'object') {
        const bimKeys = ['1B', '2B', '3B', '4B', 'FINAL', ...Object.keys(fn)];
        bimKeys.forEach(bk => {
          const bData = (fn as any)[bk];
          if (bData && bData.disciplinas) {
            const norm = normalizarDisciplinasBimestre(bData.disciplinas);
            Object.keys(norm).forEach(d => {
              if (d && d.trim() && d !== '[object Object]') setD.add(d.trim());
            });
          }
        });
      }
    });
    return Array.from(setD).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [alunos]);

  // Alunos filtrados por Turma, Busca e Status
  const alunosFiltrados = useMemo(() => {
    return alunos.filter(aluno => {
      // 1. Filtro de Turma
      if (turmaFiltro !== 'TODAS') {
        const tAluno = (aluno.turma || '').toUpperCase().trim();
        const tFiltro = turmaFiltro.toUpperCase().trim();
        if (tAluno !== tFiltro && !tAluno.includes(tFiltro)) return false;
      }

      // 2. Filtro de Busca (Nome ou RA) com Debounce veloz
      if (debouncedBuscaTexto.trim()) {
        const termo = debouncedBuscaTexto.toLowerCase().trim();
        const nomeMatch = (aluno.nome || '').toLowerCase().includes(termo);
        const raMatch = String(aluno.ra || '').toLowerCase().includes(termo);
        if (!nomeMatch && !raMatch) return false;
      }

      // Dados do fechamento ativo (usando obterDadosPeriodoAluno)
      const bData = obterDadosPeriodoAluno(aluno, bimestreAtivo);
      const media = bData?.mediaGeral !== undefined ? Number(bData.mediaGeral) : null;
      const qtdAbaixo = bData?.qtdAbaixoBasico !== undefined ? Number(bData.qtdAbaixoBasico) : 0;
      const freq = bData?.frequenciaBimestre !== undefined ? Number(bData.frequenciaBimestre) : (aluno.frequencia ? Number(aluno.frequencia) : null);

      // 3. Filtro de Status / Risco
      if (statusFiltro === 'CRITICO') {
        return qtdAbaixo >= 3;
      }
      if (statusFiltro === 'ALERTA') {
        return qtdAbaixo >= 1 && qtdAbaixo <= 2;
      }
      if (statusFiltro === 'SATISFATORIO') {
        return bData !== null && qtdAbaixo === 0 && media !== null && media >= 5.0;
      }
      if (statusFiltro === 'FREQ_BAIXA') {
        return freq !== null && freq < 75;
      }

      // 4. Filtro por Disciplina específica
      if (disciplinaFiltro !== 'TODAS' && bData && bData.disciplinas) {
        if (!bData.disciplinas[disciplinaFiltro]) return false;
      }

      return true;
    }).sort((a, b) => {
      const fnA = obterDadosPeriodoAluno(a, bimestreAtivo);
      const fnB = obterDadosPeriodoAluno(b, bimestreAtivo);

      if (ordenacao === 'nome') {
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
      }
      if (ordenacao === 'media_asc') {
        const mA = fnA?.mediaGeral ?? 999;
        const mB = fnB?.mediaGeral ?? 999;
        return Number(mA) - Number(mB);
      }
      if (ordenacao === 'media_desc') {
        const mA = fnA?.mediaGeral ?? -1;
        const mB = fnB?.mediaGeral ?? -1;
        return Number(mB) - Number(mA);
      }
      if (ordenacao === 'faltas_desc') {
        const fA = fnA?.totalFaltas ?? -1;
        const fB = fnB?.totalFaltas ?? -1;
        return Number(fB) - Number(fA);
      }
      if (ordenacao === 'vermelhas_desc') {
        const vA = fnA?.qtdAbaixoBasico ?? -1;
        const vB = fnB?.qtdAbaixoBasico ?? -1;
        return Number(vB) - Number(vA);
      }
      return 0;
    });
  }, [alunos, turmaFiltro, debouncedBuscaTexto, statusFiltro, disciplinaFiltro, ordenacao, bimestreAtivo]);

  // Cálculos Estatísticos Globais para os KPIs
  const estatisticas = useMemo(() => {
    const totalEstudantes = alunosFiltrados.length;
    let avaliados = 0;
    let somaMedias = 0;
    let totalMediasValidas = 0;
    let alunosCriticos = 0; // 3+ notas vermelhas
    let alunosAlerta = 0; // 1-2 vermelhas
    let alunosSatisfatorios = 0; // 0 vermelhas
    let somaFreq = 0;
    let totalFreqValidas = 0;
    let alunosFreqBaixa = 0;

    alunosFiltrados.forEach(a => {
      const bData = obterDadosPeriodoAluno(a, bimestreAtivo);
      if (bData && (bData.disciplinas && Object.keys(bData.disciplinas).length > 0 || bData.mediaGeral !== undefined)) {
        avaliados++;
        if (bData.mediaGeral !== undefined && !isNaN(Number(bData.mediaGeral))) {
          somaMedias += Number(bData.mediaGeral);
          totalMediasValidas++;
        }
        const qtdAbaixo = Number(bData.qtdAbaixoBasico || 0);
        if (qtdAbaixo >= 3) alunosCriticos++;
        else if (qtdAbaixo >= 1) alunosAlerta++;
        else alunosSatisfatorios++;

        const freq = bData.frequenciaBimestre !== undefined ? Number(bData.frequenciaBimestre) : null;
        if (freq !== null && !isNaN(freq)) {
          somaFreq += freq;
          totalFreqValidas++;
          if (freq < 75) alunosFreqBaixa++;
        }
      }
    });

    const mediaGeralEscola = totalMediasValidas > 0 ? (somaMedias / totalMediasValidas).toFixed(1) : '-';
    const freqMediaEscola = totalFreqValidas > 0 ? Math.round(somaFreq / totalFreqValidas) : '-';
    const taxaAprovacao = avaliados > 0 ? Math.round((alunosSatisfatorios / avaliados) * 100) : 0;
    const taxaCobertura = totalEstudantes > 0 ? Math.round((avaliados / totalEstudantes) * 100) : 0;

    return {
      totalEstudantes,
      avaliados,
      taxaCobertura,
      mediaGeralEscola,
      freqMediaEscola,
      taxaAprovacao,
      alunosCriticos,
      alunosAlerta,
      alunosSatisfatorios,
      alunosFreqBaixa
    };
  }, [alunosFiltrados, bimestreAtivo]);

  // Ranking de Dificuldade por Disciplina (Quais matérias têm mais notas abaixo do básico)
  const rankingDisciplinas = useMemo(() => {
    const mapaDisc: Record<string, { total: number; avaliadosComNota: number; abaixoBasico: number; somaNotas: number }> = {};

    // Utiliza alunos da turma selecionada (ou todos os alunos da escola se turma for 'TODAS')
    const baseAlunos = turmaFiltro === 'TODAS'
      ? alunos
      : alunos.filter(a => {
          const tAluno = (a.turma || '').toUpperCase().trim();
          const tFiltro = turmaFiltro.toUpperCase().trim();
          return tAluno === tFiltro || tAluno.includes(tFiltro);
        });

    baseAlunos.forEach(a => {
      const bData = obterDadosPeriodoAluno(a, bimestreAtivo);
      if (bData?.disciplinas && Object.keys(bData.disciplinas).length > 0) {
        Object.entries(bData.disciplinas).forEach(([disc, dados]) => {
          if (!disc || !disc.trim() || disc === '[object Object]') return;
          const cleanDisc = disc.trim();
          if (!mapaDisc[cleanDisc]) {
            mapaDisc[cleanDisc] = { total: 0, avaliadosComNota: 0, abaixoBasico: 0, somaNotas: 0 };
          }
          mapaDisc[cleanDisc].total++;

          let notaNum: number | null = null;
          if (typeof dados.nota === 'number' && !isNaN(dados.nota)) {
            notaNum = dados.nota;
          } else if (dados.nota !== undefined && dados.nota !== null && dados.nota !== '') {
            const parsed = parseFloat(String(dados.nota).replace(',', '.'));
            if (!isNaN(parsed)) notaNum = parsed;
          }

          if (notaNum !== null) {
            mapaDisc[cleanDisc].avaliadosComNota++;
            mapaDisc[cleanDisc].somaNotas += notaNum;
            if (notaNum < 5.0 || dados.abaixoBasico === true) {
              mapaDisc[cleanDisc].abaixoBasico++;
            }
          } else if (
            dados.abaixoBasico === true ||
            (dados.mencao && ['I', 'INSUFICIENTE', 'EP', 'ABAIXO'].includes(String(dados.mencao).toUpperCase().trim()))
          ) {
            mapaDisc[cleanDisc].abaixoBasico++;
          }
        });
      }
    });

    return Object.entries(mapaDisc)
      .map(([disciplina, dados]) => ({
        disciplina,
        totalAvaliados: dados.total,
        avaliadosComNota: dados.avaliadosComNota,
        qtdAbaixo: dados.abaixoBasico,
        percentualAbaixo: dados.total > 0 ? Math.round((dados.abaixoBasico / dados.total) * 100) : 0,
        mediaDisciplina: dados.avaliadosComNota > 0 ? (dados.somaNotas / dados.avaliadosComNota).toFixed(1) : '-'
      }))
      .sort((a, b) => {
        if (b.qtdAbaixo !== a.qtdAbaixo) return b.qtdAbaixo - a.qtdAbaixo;
        if (b.percentualAbaixo !== a.percentualAbaixo) return b.percentualAbaixo - a.percentualAbaixo;
        const mA = a.mediaDisciplina !== '-' ? parseFloat(a.mediaDisciplina) : 10;
        const mB = b.mediaDisciplina !== '-' ? parseFloat(b.mediaDisciplina) : 10;
        return mA - mB;
      })
      .slice(0, 10);
  }, [alunos, turmaFiltro, bimestreAtivo]);

  // Comparativo de Médias por Turma
  const comparativoTurmas = useMemo(() => {
    const mapaT: Record<string, { total: number; avaliados: number; somaMedias: number; criticos: number }> = {};

    alunos.forEach(a => {
      const turma = a.turma || 'Sem Turma';
      if (!mapaT[turma]) {
        mapaT[turma] = { total: 0, avaliados: 0, somaMedias: 0, criticos: 0 };
      }
      mapaT[turma].total++;

      const bData = obterDadosPeriodoAluno(a, bimestreAtivo);
      if (bData?.mediaGeral !== undefined && !isNaN(Number(bData.mediaGeral))) {
        mapaT[turma].avaliados++;
        mapaT[turma].somaMedias += Number(bData.mediaGeral);
        if (Number(bData.qtdAbaixoBasico || 0) >= 3) {
          mapaT[turma].criticos++;
        }
      }
    });

    return Object.entries(mapaT)
      .map(([turma, dados]) => ({
        turma,
        total: dados.total,
        avaliados: dados.avaliados,
        media: dados.avaliados > 0 ? (dados.somaMedias / dados.avaliados).toFixed(1) : '-',
        criticos: dados.criticos,
        taxaCriticos: dados.avaliados > 0 ? Math.round((dados.criticos / dados.avaliados) * 100) : 0
      }))
      .sort((a, b) => a.turma.localeCompare(b.turma, 'pt-BR', { numeric: true }));
  }, [alunos, bimestreAtivo]);

  // Formatação de cor para a nota/mencao
  const getCorNota = (notaVal?: number | string, mencao?: string) => {
    if (mencao === 'I' || mencao === 'Insuficiente') return 'bg-rose-100 text-rose-800 border-rose-200 font-bold';
    if (mencao === 'R' || mencao === 'Regular') return 'bg-amber-100 text-amber-900 border-amber-200 font-bold';
    if (mencao === 'B' || mencao === 'Bom' || mencao === 'MB' || mencao === 'Ótimo') return 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold';

    const num = Number(notaVal);
    if (isNaN(num)) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (num < 5.0) return 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
    if (num < 7.0) return 'bg-amber-100 text-amber-900 border-amber-300 font-bold';
    return 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
  };

  // Abrir Dossiê / Ficha do Aluno
  const handleAbrirFicha = (ra?: string) => {
    if (!ra) return;
    if (typeof window !== 'undefined' && typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    } else if (typeof window !== 'undefined' && typeof (window as any).navegarEAbrirFichaAluno === 'function') {
      (window as any).navegarEAbrirFichaAluno(ra);
    }
  };

  // Exportar Relatório em CSV / Excel
  const exportarRelatorioCSV = () => {
    if (alunosFiltrados.length === 0) {
      if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
        (window as any).showToast('Nenhum aluno encontrado para exportação.', 'info');
      }
      return;
    }

    const headers = [
      'Nº',
      'Nome do Aluno',
      'RA',
      'Turma',
      'Bimestre',
      ...disciplinasDisponiveis,
      'Média Geral',
      'Total Faltas',
      'Freq %',
      'Notas Vermelhas',
      'Situação'
    ];

    const rows = alunosFiltrados.map((a, idx) => {
      const bData = obterDadosPeriodoAluno(a, bimestreAtivo);
      const discNotas = disciplinasDisponiveis.map(d => {
        const item = bData?.disciplinas?.[d];
        if (!item) return '-';
        return item.nota !== undefined ? String(item.nota) : (item.mencao || '-');
      });

      const situacao = (bData?.qtdAbaixoBasico || 0) >= 3 ? 'Risco Crítico' : (bData?.qtdAbaixoBasico || 0) >= 1 ? 'Alerta' : 'Satisfatório';

      return [
        a.numero || idx + 1,
        `"${(a.nome || '').replace(/"/g, '""')}"`,
        `"${a.ra || ''}"`,
        `"${a.turma || ''}"`,
        bimestreAtivo === 'COMPARATIVO' ? 'Evolução Anual (Média Consolidada)' : bimestreAtivo,
        ...discNotas.map(n => `"${n}"`),
        bData?.mediaGeral !== undefined ? bData.mediaGeral.toFixed(1) : '-',
        bData?.totalFaltas !== undefined ? bData.totalFaltas : '-',
        bData?.frequenciaBimestre !== undefined ? `${bData.frequenciaBimestre}%` : '-',
        bData?.qtdAbaixoBasico || 0,
        `"${situacao}"`
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `relatorio_notas_${bimestreAtivo}_${turmaFiltro.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copiar dados tabulados para área de transferência (Ctrl+V direto no Google Planilhas ou Excel)
  const copiarPlanilhaClipboard = async () => {
    if (alunosFiltrados.length === 0) {
      if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
        (window as any).showToast('Nenhum aluno encontrado para copiar.', 'warning');
      }
      return;
    }

    const headers = [
      'Nº',
      'Nome do Aluno',
      'RA',
      'Turma',
      'Bimestre',
      ...disciplinasDisponiveis,
      'Média Geral',
      'Total Faltas',
      'Freq %',
      'Notas Vermelhas',
      'Situação'
    ];

    const rows = alunosFiltrados.map((a, idx) => {
      const bData = obterDadosPeriodoAluno(a, bimestreAtivo);
      const discNotas = disciplinasDisponiveis.map(d => {
        const item = bData?.disciplinas?.[d];
        if (!item) return '-';
        return item.nota !== undefined ? String(item.nota) : (item.mencao || '-');
      });

      const situacao = (bData?.qtdAbaixoBasico || 0) >= 3 ? 'Risco Crítico' : (bData?.qtdAbaixoBasico || 0) >= 1 ? 'Alerta' : 'Satisfatório';

      return [
        a.numero || idx + 1,
        a.nome || '',
        a.ra || '',
        a.turma || '',
        bimestreAtivo === 'COMPARATIVO' ? 'Evolução Anual' : bimestreAtivo,
        ...discNotas,
        bData?.mediaGeral !== undefined ? bData.mediaGeral.toFixed(1) : '-',
        bData?.totalFaltas !== undefined ? bData.totalFaltas : '-',
        bData?.frequenciaBimestre !== undefined ? `${bData.frequenciaBimestre}%` : '-',
        bData?.qtdAbaixoBasico || 0,
        situacao
      ];
    });

    const ok = await copiarTabelaParaClipboard(rows, headers);
    if (ok) {
      setCopiadoClipboard(true);
      setTimeout(() => setCopiadoClipboard(false), 2500);
      if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
        (window as any).showToast('Dados copiados! Cole (Ctrl+V) no Excel ou Google Planilhas.', 'success', 3500);
      }
    }
  };

  // Imprimir Relatório do Conselho de Classe
  const imprimirRelatorioConselho = () => {
    window.print();
  };

  return (
    <div className="w-full space-y-6 animate-fadeIn pb-12">
      {/* CABEÇALHO EXCLUSIVO DE IMPRESSÃO OFICIAL PARA ATA / CONSELHO DE CLASSE */}
      <div className="hidden print:block border-b-2 border-slate-900 pb-4 mb-4 text-black">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-700 block">
              Governo do Estado de São Paulo &bull; Secretaria da Educação
            </span>
            <h1 className="text-base font-black uppercase text-slate-900 tracking-tight">
              E.E. CLÓVIS DE LUCCA &bull; PROGRAMA DE ENSINO INTEGRAL (PEI)
            </h1>
            <h2 className="text-xs font-bold uppercase text-slate-800">
              Ata &amp; Relatório Consolidado de Rendimento Escolar e Fechamento de Notas
            </h2>
          </div>
          <div className="text-right border-l-2 border-slate-300 pl-4 space-y-0.5">
            <span className="inline-block px-2 py-0.5 bg-slate-900 text-white text-[10px] font-black uppercase rounded">
              {bimestreAtivo === 'FINAL' ? 'Fechamento Anual Final' : bimestreAtivo === 'COMPARATIVO' ? 'Quadro Geral Anual' : `${bimestreAtivo} Bimestre`}
            </span>
            <div className="text-[9px] font-mono text-slate-600">
              Turma: <strong className="text-slate-900 uppercase">{turmaFiltro}</strong>
            </div>
            <div className="text-[9px] font-mono text-slate-600">
              Emissão: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}
            </div>
          </div>
        </div>
      </div>

      {/* 1. CABEÇALHO DO DASHBOARD (GLASSMORPHISM) */}
      <div className="bg-white/90 backdrop-blur-md p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg shrink-0">
              <i className="fa-solid fa-chart-line"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Dashboard de Rendimento &amp; Notas
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                <span>Acesso Universal</span>
                <span aria-hidden="true">&middot;</span>
                <span>SED Clóvis</span>
                <span aria-hidden="true">&middot;</span>
                <span className="font-semibold text-slate-700 tabular-nums">{alunos.length} estudantes</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed hidden sm:block">
                Análise de rendimento escolar, notas por disciplina, identificação antecipada de estudantes em risco e apoio às decisões do Conselho de Classe.
              </p>
            </div>
          </div>

          {/* Botões de Ações Superiores */}
          <div className="flex items-center gap-2 flex-wrap no-print">
            <button
              type="button"
              onClick={exportarRelatorioCSV}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 shadow-2xs cursor-pointer whitespace-nowrap shrink-0"
              title="Exportar planilha de notas em formato CSV / Excel"
            >
              <i className="fa-solid fa-file-excel"></i>
              <span>Exportar Excel</span>
            </button>

            <button
              type="button"
              onClick={copiarPlanilhaClipboard}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/80 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              title="Copiar dados tabulados para colar direto no Google Planilhas ou Excel (Ctrl+V)"
            >
              <i className={`fa-solid ${copiadoClipboard ? 'fa-check text-emerald-600' : 'fa-copy text-slate-500'}`}></i>
              <span>{copiadoClipboard ? 'Copiado!' : 'Copiar Planilha'}</span>
            </button>

            <button
              type="button"
              onClick={imprimirRelatorioConselho}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Imprimir visualização formatada para Ata e Conselho de Classe"
            >
              <i className="fa-solid fa-print"></i>
              <span>Imprimir Conselho</span>
            </button>
          </div>
        </div>

        {/* Seletor de Bimestre Estilo Apple Segmented Control */}
        <div className="mt-5 pt-4 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-2xl border border-slate-200/60 overflow-x-auto no-scrollbar max-w-full">
            {[
              { id: '1B', label: '1º Bimestre', icon: 'fa-bookmark' },
              { id: '2B', label: '2º Bimestre', icon: 'fa-bookmark' },
              { id: '3B', label: '3º Bimestre', icon: 'fa-bookmark' },
              { id: '4B', label: '4º Bimestre', icon: 'fa-bookmark' },
              { id: 'FINAL', label: 'Conselho Final', icon: 'fa-award' },
              { id: 'COMPARATIVO', label: 'Evolução Anual', icon: 'fa-chart-simple' },
            ].map((tab) => {
              const active = bimestreAtivo === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBimestreAtivo(tab.id as any)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <i className={`fa-solid ${tab.icon} text-[11px] ${active ? 'text-indigo-600' : 'text-slate-400'}`}></i>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-500 font-medium hidden sm:flex items-center gap-2">
            <span>Período selecionado:</span>
            <span className="font-semibold text-slate-800">
              {bimestreAtivo === 'FINAL' ? 'Conselho Final' : bimestreAtivo === 'COMPARATIVO' ? 'Evolução Anual' : `${bimestreAtivo} Bimestre`}
            </span>
          </div>
        </div>
      </div>

      {/* 2. CARDS DE INDICADORES CHAVE (BENTO KPIS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Cobertura de Avaliações */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-medium text-slate-500">
              {bimestreAtivo === 'COMPARATIVO' ? 'Avaliados no Período' : 'Avaliados no Bimestre'}
            </p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">
              {estatisticas.avaliados} <span className="text-sm font-medium text-slate-400">/ {estatisticas.totalEstudantes}</span>
            </p>
            <div className="flex items-center gap-2">
              <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-600 h-1.5 rounded-full transition-all" style={{ width: `${estatisticas.taxaCobertura}%` }}></div>
              </div>
              <span className="text-xs font-semibold text-indigo-700 tabular-nums">{estatisticas.taxaCobertura}%</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-users"></i>
          </div>
        </div>

        {/* Card 2: Média Geral da Escola / Turma */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-medium text-slate-500">
              {bimestreAtivo === 'COMPARATIVO' ? 'Média Geral Consolidada' : 'Média Geral do Período'}
            </p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">
              {estatisticas.mediaGeralEscola}
            </p>
            <p className="text-xs font-medium">
              {Number(estatisticas.mediaGeralEscola) >= 7.0 ? (
                <span className="text-emerald-700"><i className="fa-solid fa-circle-check text-[11px] mr-1"></i>Rendimento excelente</span>
              ) : Number(estatisticas.mediaGeralEscola) >= 5.0 ? (
                <span className="text-amber-700"><i className="fa-solid fa-circle-info text-[11px] mr-1"></i>Rendimento regular</span>
              ) : (
                <span className="text-rose-700"><i className="fa-solid fa-triangle-exclamation text-[11px] mr-1"></i>Abaixo do esperado</span>
              )}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-gauge-high"></i>
          </div>
        </div>

        {/* Card 3: Alunos em Risco Crítico (3+ Notas Vermelhas) */}
        <button
          type="button"
          onClick={() => setStatusFiltro(statusFiltro === 'CRITICO' ? 'TODOS' : 'CRITICO')}
          className={`text-left p-5 rounded-2xl border transition-all cursor-pointer shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3 ${
            statusFiltro === 'CRITICO'
              ? 'bg-rose-50/90 border-rose-300 border-l-4 border-l-rose-500 ring-2 ring-rose-500/15'
              : 'bg-white border-slate-200/80 hover:border-rose-200 hover:bg-rose-50/30'
          }`}
          title="Clique para filtrar apenas os alunos em risco crítico"
        >
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-medium text-rose-700">Risco Crítico (3+ Vermelhas)</p>
            <p className="text-2xl font-bold text-rose-700 tabular-nums tracking-tight">
              {estatisticas.alunosCriticos} <span className="text-xs font-medium text-rose-600">alunos</span>
            </p>
            <p className="text-xs text-slate-500 truncate">
              {statusFiltro === 'CRITICO' ? 'Filtro ativo · Clique para limpar' : 'Prioridade para recuperação e tutoria'}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-triangle-exclamation"></i>
          </div>
        </button>

        {/* Card 4: Frequência Média Escolar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <p className="text-xs font-medium text-slate-500">Frequência Média</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">
              {estatisticas.freqMediaEscola !== '-' ? `${estatisticas.freqMediaEscola}%` : '-'}
            </p>
            <p className="text-xs font-medium">
              {estatisticas.alunosFreqBaixa > 0 ? (
                <span className="text-amber-700 tabular-nums">{estatisticas.alunosFreqBaixa} com freq &lt; 75%</span>
              ) : (
                <span className="text-emerald-700">Presença regular</span>
              )}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-calendar-check"></i>
          </div>
        </div>
      </div>

      {/* 3. COMMAND BAR DE FILTROS INTERATIVOS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3 no-print">
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
          {/* Swipeable Quick Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {[
              { id: 'TODOS', label: 'Todos', activeClass: 'bg-slate-900 text-white border-slate-900' },
              { id: 'CRITICO', label: 'Risco Crítico', activeClass: 'bg-rose-50 text-rose-900 border-rose-300' },
              { id: 'ALERTA', label: 'Em Alerta (1-2)', activeClass: 'bg-amber-50 text-amber-900 border-amber-300' },
              { id: 'SATISFATORIO', label: 'Satisfatório', activeClass: 'bg-emerald-50 text-emerald-900 border-emerald-300' },
              { id: 'FREQ_BAIXA', label: 'Freq < 75%', activeClass: 'bg-purple-50 text-purple-900 border-purple-300' },
            ].map((pill) => {
              const active = statusFiltro === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStatusFiltro(pill.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? pill.activeClass : 'bg-slate-50/80 text-slate-600 border-slate-200/80 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {/* Busca por Texto, Selects de Turma, Disciplina e Ordenação */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] sm:w-56">
              <i className="fa-solid fa-magnifying-glass text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 text-xs"></i>
              <input
                type="text"
                placeholder="Pesquisar nome ou RA..."
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs text-slate-800 font-medium outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder:text-slate-400"
              />
            </div>

            <select
              id="select-turma-dash"
              value={turmaFiltro}
              onChange={(e) => setTurmaFiltro(e.target.value)}
              className="bg-slate-50/80 border border-slate-200/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              aria-label="Filtrar por Turma"
            >
              <option value="TODAS">Todas as Turmas ({alunos.length})</option>
              {turmasDisponiveis.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              id="select-disc-dash"
              value={disciplinaFiltro}
              onChange={(e) => setDisciplinaFiltro(e.target.value)}
              className="bg-slate-50/80 border border-slate-200/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer max-w-[200px]"
              aria-label="Filtrar por Disciplina"
            >
              <option value="TODAS">Todas as Disciplinas ({disciplinasDisponiveis.length})</option>
              {disciplinasDisponiveis.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              id="select-status-dash"
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value as any)}
              className="sr-only"
              aria-label="Filtro de Situação"
            >
              <option value="TODOS">Todos os Alunos</option>
              <option value="CRITICO">Risco Crítico (3+ Vermelhas)</option>
              <option value="ALERTA">Em Alerta (1 a 2 Vermelhas)</option>
              <option value="SATISFATORIO">Rendimento Satisfatório</option>
              <option value="FREQ_BAIXA">Frequência Baixa (&lt; 75%)</option>
            </select>

            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as any)}
              className="bg-slate-50/80 border border-slate-200/80 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer shrink-0"
              title="Critério de Ordenação"
            >
              <option value="nome">Ordem Alfabética (A-Z)</option>
              <option value="vermelhas_desc">Mais Notas Vermelhas</option>
              <option value="media_asc">Menor Média Primeiro</option>
              <option value="media_desc">Maior Média Primeiro</option>
              <option value="faltas_desc">Mais Faltas Primeiro</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. VISÕES GRÁFICAS & ANÁLISE COMPARATIVA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
        {/* Coluna 1 e 2: Comparativo entre Turmas */}
        <div className="lg:col-span-2 bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-chart-column"></i>
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                  Comparativo de Desempenho por Turma
                </h3>
                <p className="text-xs text-slate-500">Média geral e incidência de alunos em risco crítico</p>
              </div>
            </div>
            <span className="text-xs font-medium text-slate-500 tabular-nums whitespace-nowrap">
              {comparativoTurmas.length} turmas
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {comparativoTurmas.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Nenhuma turma com notas cadastradas para este período.</p>
            ) : (
              comparativoTurmas.map(t => {
                const mediaNum = Number(t.media);
                const pctMedia = !isNaN(mediaNum) ? Math.min(100, Math.round((mediaNum / 10) * 100)) : 0;

                return (
                  <div key={t.turma} className="p-3 bg-slate-50/70 hover:bg-slate-50 rounded-2xl border border-slate-200/60 transition-colors space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{t.turma}</span>
                        <span className="text-slate-400">&middot;</span>
                        <span className="text-slate-500 tabular-nums">{t.avaliados} de {t.total} avaliados</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {t.criticos > 0 && (
                          <span className="px-2 py-0.5 bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500 rounded-md text-[11px] font-semibold tabular-nums">
                            {t.criticos} em risco ({t.taxaCriticos}%)
                          </span>
                        )}
                        <span className="font-mono font-semibold text-sm text-slate-900 tabular-nums">
                          {t.media !== '-' ? `Média ${t.media}` : 'Sem notas'}
                        </span>
                      </div>
                    </div>

                    <div className="w-full bg-slate-200/70 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          mediaNum >= 7.0 ? 'bg-emerald-500' : mediaNum >= 5.0 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${pctMedia}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Coluna 3: Ranking de Dificuldade por Disciplina */}
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-fire"></i>
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                  Disciplinas Críticas
                </h3>
                <p className="text-xs text-slate-500">Mais alunos com nota &lt; 5.0</p>
              </div>
            </div>
            {rankingDisciplinas.length > 0 && (
              <span className={`text-[11px] font-semibold tabular-nums ${
                rankingDisciplinas.some(d => d.qtdAbaixo > 0) ? 'text-rose-700' : 'text-emerald-700'
              }`}>
                {rankingDisciplinas.filter(d => d.qtdAbaixo > 0).length} críticas / {rankingDisciplinas.length}
              </span>
            )}
          </div>

          <div className="space-y-2 pt-1">
            {rankingDisciplinas.length === 0 ? (
              <div className="text-center py-8 px-3 bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl">
                <i className="fa-solid fa-chart-column text-slate-300 text-2xl mb-2 block"></i>
                <p className="text-xs font-semibold text-slate-600">Nenhum dado no {bimestreAtivo}</p>
                <p className="text-[11px] text-slate-400 mt-1">Selecione outro bimestre ou importe o fechamento.</p>
              </div>
            ) : (
              rankingDisciplinas.map((rd, index) => {
                const isCritica = rd.qtdAbaixo > 0;
                const mediaNum = rd.mediaDisciplina !== '-' ? parseFloat(rd.mediaDisciplina) : null;
                return (
                  <div
                    key={rd.disciplina}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-colors ${
                      isCritica
                        ? 'bg-rose-50/50 border-rose-200/60 border-l-4 border-l-rose-500'
                        : 'bg-slate-50/70 border-slate-200/60 border-l-4 border-l-emerald-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-400 tabular-nums shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="font-semibold text-slate-800 truncate" title={`${rd.disciplina} (${rd.totalAvaliados} avaliados)`}>
                        {rd.disciplina}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                      <span className={`text-[11px] font-semibold ${isCritica ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {rd.qtdAbaixo} {rd.qtdAbaixo === 1 ? 'aluno' : 'alunos'} ({rd.percentualAbaixo}%)
                      </span>
                      <span className={`font-mono text-[11px] font-semibold ${
                        mediaNum !== null
                          ? mediaNum < 5.0 ? 'text-rose-700' : mediaNum < 7.0 ? 'text-amber-700' : 'text-emerald-700'
                          : 'text-slate-400'
                      }`}>
                        {rd.mediaDisciplina !== '-' ? rd.mediaDisciplina : '-'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 5. PAINEL DE INTERVENÇÃO PEDAGÓGICA (ALUNOS EM RISCO CRÍTICO) */}
      {estatisticas.alunosCriticos > 0 && statusFiltro !== 'SATISFATORIO' && (
        <div className="bg-rose-50/70 border border-rose-200/70 border-l-4 border-l-rose-500 p-5 sm:p-6 rounded-3xl space-y-4 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 text-rose-950 font-semibold text-sm sm:text-base">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <span>Atenção Pedagógica: {estatisticas.alunosCriticos} Alunos em Risco Crítico (3+ Notas Vermelhas)</span>
            </div>
            <span className="text-xs text-rose-700 font-medium">Prioridade para Busca Ativa e Tutoria</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {alunosFiltrados
              .filter(a => Number(obterDadosPeriodoAluno(a, bimestreAtivo)?.qtdAbaixoBasico || 0) >= 3)
              .slice(0, 9)
              .map(aluno => {
                const bData = obterDadosPeriodoAluno(aluno, bimestreAtivo);
                const vermelhas = Object.entries(bData?.disciplinas || {}).filter(([_, d]) => {
                  return Number(d.nota) < 5.0 || d.mencao === 'I' || d.mencao === 'Insuficiente';
                });

                return (
                  <div key={aluno.ra} className="bg-white p-3.5 rounded-2xl border border-rose-200/80 shadow-2xs space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs sm:text-sm text-slate-900 truncate" title={aluno.nome}>{aluno.nome}</h4>
                        <p className="text-[11px] text-slate-500 tabular-nums">{aluno.turma} &middot; RA {aluno.ra}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAbrirFicha(aluno.ra)}
                        className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                        title="Ver ficha completa"
                      >
                        Ficha
                      </button>
                    </div>

                    {/* Matérias com nota vermelha */}
                    <div className="flex flex-wrap gap-1.5">
                      {vermelhas.slice(0, 4).map(([disc, d]) => (
                        <span key={disc} className="px-2 py-0.5 bg-rose-50/90 text-rose-900 border border-rose-200/70 rounded-md text-[10px] font-medium tabular-nums">
                          {disc}: <strong className="font-semibold">{d.nota ?? d.mencao}</strong>
                        </span>
                      ))}
                      {vermelhas.length > 4 && (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-900 rounded-md text-[10px] font-semibold tabular-nums">
                          +{vermelhas.length - 4} matérias
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 tabular-nums">
                      <span>Média <strong className="text-rose-700 font-semibold">{bData?.mediaGeral !== undefined ? bData.mediaGeral.toFixed(1) : '-'}</strong></span>
                      <span>Faltas <strong className="text-slate-800 font-semibold">{bData?.totalFaltas ?? 0}</strong></span>
                      <span>Freq <strong className="text-slate-800 font-semibold">{bData?.frequenciaBimestre !== undefined ? `${bData.frequenciaBimestre}%` : '-'}</strong></span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 6. MATRIZ CURRICULAR DE NOTAS (MOBILE CARDS + TABELA DESKTOP/IMPRESSÃO) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
              <i className="fa-solid fa-table-list"></i>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                Matriz Curricular de Notas &middot; {bimestreAtivo === 'FINAL' ? 'Conselho Final' : bimestreAtivo === 'COMPARATIVO' ? 'Evolução Anual' : `${bimestreAtivo} Bimestre`}
              </h3>
              <p className="text-xs text-slate-500 tabular-nums">
                {alunosFiltrados.length} estudantes &middot; Turma: <strong className="font-semibold text-slate-700">{turmaFiltro}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span> &ge; 7.0 Adequado</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block"></span> 5.0–6.9 Regular</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block"></span> &lt; 5.0 Abaixo</span>
          </div>
        </div>

        {/* Visão Mobile (< md, oculta na impressão) */}
        <div className="md:hidden print:hidden divide-y divide-slate-100">
          {alunosFiltrados.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <i className="fa-solid fa-inbox text-3xl text-slate-300 mb-2 block"></i>
              <p className="text-sm font-semibold text-slate-600">Nenhum estudante encontrado.</p>
              <p className="text-xs text-slate-400 mt-1">Tente selecionar outro bimestre ou limpar a busca.</p>
            </div>
          ) : (
            alunosFiltrados.map((aluno, index) => {
              const bData = obterDadosPeriodoAluno(aluno, bimestreAtivo);
              const qtdAbaixo = Number(bData?.qtdAbaixoBasico || 0);
              const media = bData?.mediaGeral;
              const faltas = bData?.totalFaltas !== undefined ? bData.totalFaltas : '-';
              const freq = bData?.frequenciaBimestre !== undefined ? `${bData.frequenciaBimestre}%` : '-';

              return (
                <div
                  key={aluno.ra || index}
                  className={`p-4 space-y-3 ${
                    qtdAbaixo >= 3
                      ? 'bg-rose-50/30 border-l-4 border-l-rose-500'
                      : qtdAbaixo >= 1
                        ? 'border-l-4 border-l-amber-400'
                        : 'border-l-4 border-l-emerald-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-slate-400 tabular-nums">#{aluno.numero || index + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleAbrirFicha(aluno.ra)}
                          className="font-semibold text-sm text-slate-900 hover:text-indigo-700 text-left truncate cursor-pointer"
                        >
                          {aluno.nome}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {aluno.turma || '-'} &middot; RA {aluno.ra}{aluno.digito ? `-${aluno.digito}` : ''}
                        {aluno.aee ? ' · AEE' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAbrirFicha(aluno.ra)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0"
                    >
                      Ficha
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60 text-center tabular-nums">
                    <div>
                      <span className="block text-[11px] text-slate-500">Média</span>
                      <span className={`font-mono text-sm font-bold ${
                        media === undefined ? 'text-slate-400' : Number(media) < 5.0 ? 'text-rose-700' : Number(media) < 7.0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        {media !== undefined ? Number(media).toFixed(1) : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-slate-500">Faltas</span>
                      <span className="font-mono text-sm font-semibold text-slate-800">{faltas}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-slate-500">Frequência</span>
                      <span className={`font-mono text-sm font-semibold ${Number(bData?.frequenciaBimestre) < 75 ? 'text-rose-700' : 'text-slate-800'}`}>
                        {freq}
                      </span>
                    </div>
                  </div>

                  {disciplinasDisponiveis.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {disciplinasDisponiveis.map(disc => {
                        const item = bData?.disciplinas?.[disc];
                        if (!item) return null;
                        const valorExibido = item.nota !== undefined ? Number(item.nota).toFixed(1) : (item.mencao || '-');
                        const classeCor = getCorNota(item.nota, item.mencao);
                        return (
                          <span key={disc} className={`px-2 py-0.5 rounded-md text-[11px] font-mono border tabular-nums ${classeCor}`}>
                            {disc.slice(0, 10)}: <strong>{valorExibido}</strong>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Tabela Desktop & Impressão Oficial (>= md ou print) */}
        <div className="hidden md:block print:block overflow-x-auto custom-table-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="dossie-header-repeat">
              <tr className="bg-slate-50/90 text-slate-600 font-semibold border-b border-slate-200 text-xs">
                <th className="p-3 w-10 text-center">Nº</th>
                <th className="p-3 min-w-[200px]">Nome do Estudante</th>
                <th className="p-3 w-28">RA</th>
                <th className="p-3 w-24">Turma</th>

                {/* Colunas Dinâmicas de Cada Disciplina */}
                {disciplinasDisponiveis.map(d => (
                  <th key={d} className="p-2.5 text-center min-w-[88px] max-w-[130px] border-l border-slate-200/70" title={d}>
                    <div className="truncate">{d}</div>
                  </th>
                ))}

                <th className="p-3 text-center w-20 border-l border-slate-200 bg-slate-100/70">Média</th>
                <th className="p-3 text-center w-16">Faltas</th>
                <th className="p-3 text-center w-16">Freq %</th>
                <th className="p-3 text-center w-28">Situação</th>
                <th className="p-3 text-center w-16 no-print">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alunosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={disciplinasDisponiveis.length + 9} className="p-10 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <i className="fa-solid fa-inbox text-3xl text-slate-300"></i>
                      <p className="text-sm font-semibold text-slate-600">Nenhum estudante encontrado com os filtros selecionados.</p>
                      <p className="text-xs text-slate-400">Tente selecionar outro bimestre ou limpar o campo de busca.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                alunosFiltrados.map((aluno, index) => {
                  const bData = obterDadosPeriodoAluno(aluno, bimestreAtivo);
                  const qtdAbaixo = Number(bData?.qtdAbaixoBasico || 0);
                  const media = bData?.mediaGeral;
                  const faltas = bData?.totalFaltas !== undefined ? bData.totalFaltas : '-';
                  const freq = bData?.frequenciaBimestre !== undefined ? `${bData.frequenciaBimestre}%` : '-';

                  return (
                    <tr
                      key={aluno.ra || index}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        qtdAbaixo >= 3 ? 'bg-rose-50/25' : ''
                      }`}
                    >
                      <td className="p-3 text-center font-mono text-slate-500 tabular-nums">
                        {aluno.numero || index + 1}
                      </td>

                      <td className="p-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAbrirFicha(aluno.ra)}
                            className="hover:underline text-left cursor-pointer hover:text-indigo-700"
                          >
                            {aluno.nome}
                          </button>
                          {aluno.aee && (
                            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-800 border border-purple-200/70 rounded text-[10px] font-semibold" title="Aluno AEE">
                              AEE
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                        {aluno.ra}{aluno.digito ? `-${aluno.digito}` : ''}
                      </td>

                      <td className="p-3 font-medium text-slate-700">
                        {aluno.turma || '-'}
                      </td>

                      {/* Células de Notas de Cada Disciplina */}
                      {disciplinasDisponiveis.map(disc => {
                        const item = bData?.disciplinas?.[disc];
                        if (!item) {
                          return (
                            <td key={disc} className="p-2 text-center font-mono text-slate-300 border-l border-slate-100">
                              -
                            </td>
                          );
                        }

                        const valorExibido = item.nota !== undefined ? Number(item.nota).toFixed(1) : (item.mencao || '-');
                        const classeCor = getCorNota(item.nota, item.mencao);

                        return (
                          <td key={disc} className="p-1.5 text-center border-l border-slate-100 tabular-nums">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono border ${classeCor}`}
                              title={`${disc}: Nota ${valorExibido}${item.faltas ? ` (${item.faltas} faltas)` : ''}`}
                            >
                              {valorExibido}
                            </span>
                          </td>
                        );
                      })}

                      {/* Média Geral */}
                      <td className="p-3 text-center border-l border-slate-200/70 bg-slate-50/50 font-mono font-bold text-xs tabular-nums">
                        {media !== undefined ? (
                          <div>
                            <span className={Number(media) < 5.0 ? 'text-rose-700' : Number(media) < 7.0 ? 'text-amber-700' : 'text-emerald-700'}>
                              {Number(media).toFixed(1)}
                            </span>
                            {bimestreAtivo === 'COMPARATIVO' && bData?.detalheBimestres && (
                              <span className="text-[10px] text-slate-400 block font-normal tracking-tight">
                                ({bData.detalheBimestres})
                              </span>
                            )}
                          </div>
                        ) : '-'}
                      </td>

                      {/* Faltas */}
                      <td className="p-3 text-center font-mono text-slate-700 tabular-nums">
                        {faltas}
                      </td>

                      {/* Frequência */}
                      <td className="p-3 text-center font-mono font-semibold tabular-nums">
                        <span className={Number(bData?.frequenciaBimestre) < 75 ? 'text-rose-600' : 'text-slate-700'}>
                          {freq}
                        </span>
                      </td>

                      {/* Situação */}
                      <td className="p-3 text-center">
                        {qtdAbaixo >= 3 ? (
                          <span className="inline-block px-2 py-0.5 bg-rose-50/90 text-rose-900 border border-rose-200/70 border-l-4 border-l-rose-500 rounded-md text-[11px] font-semibold whitespace-nowrap">
                            Risco Crítico
                          </span>
                        ) : qtdAbaixo >= 1 ? (
                          <span className="inline-block px-2 py-0.5 bg-amber-50/90 text-amber-900 border border-amber-200/70 border-l-4 border-l-amber-500 rounded-md text-[11px] font-semibold whitespace-nowrap tabular-nums">
                            Alerta ({qtdAbaixo})
                          </span>
                        ) : media !== undefined ? (
                          <span className="inline-block px-2 py-0.5 bg-emerald-50/90 text-emerald-900 border border-emerald-200/70 border-l-4 border-l-emerald-500 rounded-md text-[11px] font-semibold whitespace-nowrap">
                            Adequado
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>

                      {/* Ação */}
                      <td className="p-3 text-center no-print">
                        <button
                          type="button"
                          onClick={() => handleAbrirFicha(aluno.ra)}
                          className="p-2 bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 rounded-xl transition-colors cursor-pointer"
                          title="Abrir ficha e boletim completo do aluno"
                        >
                          <i className="fa-solid fa-folder-open text-xs"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BLOCO DE ASSINATURAS OFICIAIS PARA ATA / CONSELHO DE CLASSE */}
      <div className="hidden print:grid grid-cols-3 gap-8 pt-10 mt-8 border-t border-slate-400 text-center text-[10px] text-slate-800 uppercase dossie-signature-block">
        <div>
          <div className="border-t border-slate-700 pt-1 font-bold">Coordenação Geral Pedagógica (CGPG/CGPAC)</div>
          <div className="text-[9px] text-slate-500">Gestão Pedagógica PEI</div>
        </div>
        <div>
          <div className="border-t border-slate-700 pt-1 font-bold">Professor(a) Conselheiro(a) da Turma</div>
          <div className="text-[9px] text-slate-500">Docente Responsável</div>
        </div>
        <div>
          <div className="border-t border-slate-700 pt-1 font-bold">Direção Escolar / Vice-Direção</div>
          <div className="text-[9px] text-slate-500">E.E. Clóvis de Lucca</div>
        </div>
      </div>
    </div>
  );
}
