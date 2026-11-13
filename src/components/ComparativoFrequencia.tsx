import React, { useState, useEffect, useMemo } from 'react';
import { 
  compararFrequenciaAluno, 
  AttendanceComparisonResult,
  BIMESTRES_MAPAO_CONFIG,
  AnaliseMapaoTransferidoResult,
  analisarBimestresAluno,
  temDadosReaisNoMapao
} from '../modules/attendanceComparisonHelper';
import ModalImportarBoletimPDF from './ModalImportarBoletimPDF';

export interface AlunoComparativoItem {
  aluno: any;
  ra: string;
  nome: string;
  turma: string;
  tutor: string;
  comparison: AttendanceComparisonResult;
  analiseMapao: AnaliseMapaoTransferidoResult;
}

export default function ComparativoFrequencia() {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroTurma, setFiltroTurma] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [termoBusca, setTermoBusca] = useState<string>('');
  const [ordenacao, setOrdenacao] = useState<'maior_divergencia' | 'menor_sed' | 'menor_mapao' | 'nome'>('maior_divergencia');

  // Estado do Modal de Alunos com Mapão / Bimestre Não Exportado (Transferidos)
  const [modalTransferidosAberto, setModalTransferidosAberto] = useState(false);
  const [termoBuscaModal, setTermoBuscaModal] = useState<string>('');
  const [filtroTurmaModal, setFiltroTurmaModal] = useState<string>('');
  const [filtroTipoModal, setFiltroTipoModal] = useState<'TODOS' | 'SEM_NENHUM' | 'FALTA_1B' | 'FALTA_2B' | 'FALTA_3B' | 'FALTA_4B'>('TODOS');

  // Estado do Modal de Importação de Boletim Escolar em PDF (Leitura Automática)
  const [alunoParaImportarBoletim, setAlunoParaImportarBoletim] = useState<any | null>(null);
  const [modalBoletimPDFAberto, setModalBoletimPDFAberto] = useState(false);

  const abrirModalBoletimPDFParaAluno = (ra: string) => {
    const raLimpo = String(ra || '').replace(/\D/g, '');
    let al = alunos.find(a => String(a.ra).replace(/\D/g, '') === raLimpo);
    if (!al && (window as any).allStudentsData) {
      al = (window as any).allStudentsData.find((a: any) => String(a.ra).replace(/\D/g, '') === raLimpo);
    }
    if (al) {
      setAlunoParaImportarBoletim(al);
      setModalBoletimPDFAberto(true);
    } else if (typeof (window as any).showToast === 'function') {
      (window as any).showToast('Estudante não localizado na base ativa.', 'warning');
    }
  };

  useEffect(() => {
    (window as any).abrirModalImportarBoletimPDF = abrirModalBoletimPDFParaAluno;
    return () => {
      delete (window as any).abrirModalImportarBoletimPDF;
    };
  }, [alunos]);

  // Fechar modal ao pressionar tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalTransferidosAberto) {
        setModalTransferidosAberto(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalTransferidosAberto]);

  // Carregar dados de alunos
  useEffect(() => {
    const carregar = () => {
      const data = (window as any).allStudentsData;
      if (Array.isArray(data) && data.length > 0) {
        setAlunos([...data]);
        setCarregando(false);
      } else if (typeof (window as any).carregarDadosReais === 'function') {
        (window as any).carregarDadosReais();
      }
    };

    carregar();
    const interval = setInterval(carregar, 1500);

    const handleUpdate = () => {
      const data = (window as any).allStudentsData;
      if (Array.isArray(data)) {
        setAlunos([...data]);
      }
    };
    window.addEventListener('student-data-updated', handleUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('student-data-updated', handleUpdate);
    };
  }, []);

  // Verificar se o usuário possui perfil de Direção ou Vice-Direção
  const isDiretor = useMemo(() => {
    const role = (typeof (window as any).obterRoleAtual === 'function' 
      ? (window as any).obterRoleAtual() 
      : (window as any).currentUserRole) || 'PROFESSOR';
    const roleNorm = String(role).toUpperCase().replace(/-/g, '_').trim();
    return roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('DIRETOR') || roleNorm.includes('VICE');
  }, []);

  // Lista de turmas disponíveis
  const turmasDisponiveis = useMemo(() => {
    const setT = new Set<string>();
    alunos.forEach(a => {
      const t = String(a.turma || '').trim().toUpperCase();
      if (t) setT.add(t);
    });
    return Array.from(setT).sort();
  }, [alunos]);

  // Mapear os bimestres já exportados e esperados por turma e em âmbito escolar
  const bimestresEsperadosPorTurma = useMemo(() => {
    const mapTurmas = new Map<string, Set<string>>();
    const bimsGlobais = new Set<string>();

    alunos.forEach(a => {
      const t = String(a.turma || '').trim().toUpperCase();
      const fn = a.fechamento_notas || a.fechamentos || a.notas || a.boletim;
      if (fn && typeof fn === 'object') {
        BIMESTRES_MAPAO_CONFIG.forEach(cfg => {
          let bData = null;
          for (const alias of cfg.aliases) {
            if (fn[alias]) {
              bData = fn[alias];
              break;
            }
          }
          if (bData && temDadosReaisNoMapao(bData)) {
            bimsGlobais.add(cfg.key);
            if (t) {
              if (!mapTurmas.has(t)) mapTurmas.set(t, new Set<string>());
              mapTurmas.get(t)!.add(cfg.key);
            }
          }
        });
      }
    });

    if (bimsGlobais.size === 0) {
      bimsGlobais.add('1B');
    }

    return { mapTurmas, bimsGlobais: Array.from(bimsGlobais).sort() };
  }, [alunos]);

  // Processar comparação para todos os estudantes ativos
  const dadosComparados: AlunoComparativoItem[] = useMemo(() => {
    return alunos
      .filter(a => {
        const st = String(a.status || 'ATIVO').toUpperCase().trim();
        return st === 'ATIVO';
      })
      .map(aluno => {
        const comp = compararFrequenciaAluno(aluno);
        const ra = String(aluno.ra || aluno.docId || aluno.id || '-');
        const nome = String(aluno.nome || 'Aluno Sem Nome');
        const turma = String(aluno.turma || '-').toUpperCase();
        const tutor = String(aluno.tutor_2026 || aluno.tutor || 'Não atribuído');

        const bimsDaTurma = bimestresEsperadosPorTurma.mapTurmas.get(turma);
        const bimsEsperadosKeys = (bimsDaTurma && bimsDaTurma.size > 0 
          ? Array.from(bimsDaTurma) 
          : bimestresEsperadosPorTurma.bimsGlobais).sort();

        const analiseMapao = analisarBimestresAluno(aluno, bimsEsperadosKeys, comp);

        return {
          aluno,
          ra,
          nome,
          turma,
          tutor,
          comparison: comp,
          analiseMapao
        };
      });
  }, [alunos, bimestresEsperadosPorTurma]);

  // Alunos que possuem algum mapão ou bimestre não exportado (prováveis transferidos)
  const alunosComMapaoPendente = useMemo(() => {
    return dadosComparados.filter(item => item.analiseMapao.temPendencia);
  }, [dadosComparados]);

  // Alunos filtrados dentro do modal
  const alunosModalFiltrados = useMemo(() => {
    return alunosComMapaoPendente.filter(item => {
      if (filtroTurmaModal && item.turma !== filtroTurmaModal) return false;

      if (filtroTipoModal === 'SEM_NENHUM' && item.analiseMapao.bimestresExportados.length > 0) return false;
      if (filtroTipoModal === 'FALTA_1B' && !item.analiseMapao.bimestresFaltando.includes('1ºB')) return false;
      if (filtroTipoModal === 'FALTA_2B' && !item.analiseMapao.bimestresFaltando.includes('2ºB')) return false;
      if (filtroTipoModal === 'FALTA_3B' && !item.analiseMapao.bimestresFaltando.includes('3ºB')) return false;
      if (filtroTipoModal === 'FALTA_4B' && !item.analiseMapao.bimestresFaltando.includes('4ºB')) return false;

      if (termoBuscaModal) {
        const t = termoBuscaModal.toLowerCase().trim();
        const n = item.nome.toLowerCase();
        const r = item.ra.toLowerCase();
        const tm = item.turma.toLowerCase();
        const tt = item.tutor.toLowerCase();
        if (!n.includes(t) && !r.includes(t) && !tm.includes(t) && !tt.includes(t)) {
          return false;
        }
      }

      return true;
    });
  }, [alunosComMapaoPendente, filtroTurmaModal, filtroTipoModal, termoBuscaModal]);

  // Estatísticas gerais dos cards
  const metricas = useMemo(() => {
    const total = dadosComparados.length;
    let divergentesCriticos = 0; // >= 15% dif
    let divergentesAlerta = 0;   // >= 5% e < 15%
    let alinhados = 0;
    let semMapao = 0;
    let semSed = 0;

    dadosComparados.forEach(d => {
      if (d.comparison.status === 'divergente_critico') divergentesCriticos++;
      else if (d.comparison.status === 'divergente_alerta') divergentesAlerta++;
      else if (d.comparison.status === 'alinhado') alinhados++;
      else if (d.comparison.status === 'sem_mapao') semMapao++;
      else if (d.comparison.status === 'sem_sed') semSed++;
    });

    return {
      total,
      divergentesCriticos,
      divergentesAlerta,
      alinhados,
      semMapao,
      semSed
    };
  }, [dadosComparados]);

  // Filtragem e Ordenação
  const listaFiltrada = useMemo(() => {
    let res = dadosComparados.filter(item => {
      if (filtroTurma && item.turma !== filtroTurma) return false;

      if (filtroStatus === 'DIVERGENCIA_CRITICA' && item.comparison.status !== 'divergente_critico') return false;
      if (filtroStatus === 'DIVERGENCIA_ALERTA' && item.comparison.status !== 'divergente_alerta') return false;
      if (filtroStatus === 'TODAS_DIVERGENCIAS' && item.comparison.status !== 'divergente_critico' && item.comparison.status !== 'divergente_alerta') return false;
      if (filtroStatus === 'ALINHADO' && item.comparison.status !== 'alinhado') return false;
      if (filtroStatus === 'SEM_MAPAO' && item.comparison.status !== 'sem_mapao') return false;
      if (filtroStatus === 'MAPAO_PENDENTE' && !item.analiseMapao.temPendencia) return false;
      if (filtroStatus === 'AJUSTADO_DIRECAO' && !item.comparison.ajusteManual) return false;

      if (termoBusca) {
        const t = termoBusca.toLowerCase().trim();
        const n = item.nome.toLowerCase();
        const r = item.ra.toLowerCase();
        const tm = item.turma.toLowerCase();
        const tt = item.tutor.toLowerCase();
        if (!n.includes(t) && !r.includes(t) && !tm.includes(t) && !tt.includes(t)) {
          return false;
        }
      }

      return true;
    });

    // Ordenação
    res.sort((a, b) => {
      if (ordenacao === 'maior_divergencia') {
        const diffA = Math.abs(a.comparison.diff ?? 0);
        const diffB = Math.abs(b.comparison.diff ?? 0);
        return diffB - diffA;
      }
      if (ordenacao === 'menor_sed') {
        const sA = a.comparison.sedFreq ?? 100;
        const sB = b.comparison.sedFreq ?? 100;
        return sA - sB;
      }
      if (ordenacao === 'menor_mapao') {
        const mA = a.comparison.mapaoFreq ?? 100;
        const mB = b.comparison.mapaoFreq ?? 100;
        return mA - mB;
      }
      return a.nome.localeCompare(b.nome);
    });

    return res;
  }, [dadosComparados, filtroTurma, filtroStatus, termoBusca, ordenacao]);

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirModalFichaAluno === 'function') {
      (window as any).abrirModalFichaAluno(ra);
    } else if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  const exportarCSV = () => {
    try {
      const colunas = [
        'RA',
        'Nome',
        'Turma',
        'Tutor',
        'Presenca_SED',
        'Faltas_SED',
        'Presenca_Mapao',
        'Faltas_Mapao',
        'Bimestre_Mapao',
        'Diferenca_Percentual',
        'Status_Auditoria',
        'Diagnostico'
      ];

      let csv = '\uFEFF' + colunas.join(';') + '\n';
      listaFiltrada.forEach(item => {
        const c = item.comparison;
        const linha = [
          `"${item.ra}"`,
          `"${item.nome.replace(/"/g, '""')}"`,
          `"${item.turma}"`,
          `"${item.tutor.replace(/"/g, '""')}"`,
          c.sedFreq !== null ? `"${c.sedFreq}%"` : '"N/D"',
          c.sedFaltas !== null ? c.sedFaltas : '0',
          c.mapaoFreq !== null ? `"${c.mapaoFreq}%"` : '"N/D"',
          c.mapaoFaltas !== null ? c.mapaoFaltas : '0',
          `"${c.mapaoBimestre || 'N/D'}"`,
          c.diff !== null ? `"${c.diff > 0 ? '+' : ''}${c.diff}%"` : '"0%"',
          `"${c.status}"`,
          `"${c.mensagem.replace(/"/g, '""')}"`
        ];
        csv += linha.join(';') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dataIso = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `auditoria_presencas_sed_vs_mapao_${dataIso}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Erro ao exportar CSV:', e);
    }
  };

  const exportarCSVPendentes = () => {
    try {
      const colunas = [
        'RA',
        'Nome',
        'Turma',
        'Tutor',
        'Presenca_SED',
        'Faltas_SED',
        'Bimestres_Exportados',
        'Bimestres_Nao_Exportados',
        'Bimestres_Esperados_Turma',
        'Diagnostico_Provavel_Transferido'
      ];

      let csv = '\uFEFF' + colunas.join(';') + '\n';
      alunosModalFiltrados.forEach(item => {
        const a = item.analiseMapao;
        const c = item.comparison;
        const linha = [
          `"${item.ra}"`,
          `"${item.nome.replace(/"/g, '""')}"`,
          `"${item.turma}"`,
          `"${item.tutor.replace(/"/g, '""')}"`,
          c.sedFreq !== null ? `"${c.sedFreq}%"` : '"N/D"',
          c.sedFaltas !== null ? c.sedFaltas : '0',
          `"${a.bimestresExportados.join(', ') || 'Nenhum'}"`,
          `"${a.bimestresFaltando.join(', ') || 'Nenhum'}"`,
          `"${a.bimestresEsperados.join(', ')}"`,
          `"${a.motivoDiagnostico.replace(/"/g, '""')}"`
        ];
        csv += linha.join(';') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dataIso = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `alunos_mapao_pendente_transferidos_${dataIso}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Erro ao exportar CSV de transferidos/pendentes:', e);
    }
  };

  const abrirDigitarParaAluno = (ra: string, bimSugerido: string) => {
    if (typeof (window as any).abrirModalDigitarBoletim === 'function') {
      (window as any).abrirModalDigitarBoletim(ra, bimSugerido || '1B');
    } else {
      abrirFicha(ra);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 pb-12">
      <div className="p-3 sm:p-6 space-y-5 max-w-7xl mx-auto">
        {/* Cabeçalho Glassmorphic do Módulo */}
        <header className="bg-white/90 backdrop-blur-md md:sticky md:top-2 z-20 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xl shrink-0 border border-indigo-200/50">
              <i className="fa-solid fa-scale-balanced"></i>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900">
                  Auditoria de Frequência: SED vs. Mapão
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                  Equipe Gestora
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">
                Cruza automaticamente divergências entre a frequência importada da <strong className="text-slate-700">SED</strong> e os dados consolidados no <strong className="text-slate-700">Mapão de Fechamento</strong> pelos docentes.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              id="btn-abrir-mapao-pendente"
              onClick={() => {
                setTermoBuscaModal('');
                setFiltroTurmaModal('');
                setFiltroTipoModal('TODOS');
                setModalTransferidosAberto(true);
              }}
              className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs rounded-xl transition flex items-center gap-2 cursor-pointer border border-amber-200/80 border-l-4 border-l-amber-500 active:scale-95"
              title="Listar alunos que têm algum mapão/bimestre não exportado (provavelmente vieram transferidos de outro lugar)"
            >
              <i className="fa-solid fa-user-clock text-amber-600"></i>
              <span>Bimestres Não Exportados</span>
              <span className="px-2 py-0.5 bg-amber-600 text-white rounded-full text-[11px] font-semibold tabular-nums">
                {alunosComMapaoPendente.length}
              </span>
            </button>

            <button
              type="button"
              onClick={exportarCSV}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <i className="fa-solid fa-file-csv text-emerald-400"></i>
              <span>Exportar Relatório</span>
            </button>
          </div>
        </header>

        {/* Bento Grid KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">Estudantes Ativos</p>
              <div className="w-9 h-9 rounded-xl bg-slate-500/10 text-slate-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-users"></i>
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{metricas.total}</span>
              <p className="text-[11px] text-slate-400 mt-0.5">Base escolar monitorada</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">Divergência Crítica</p>
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-rose-700 tabular-nums">{metricas.divergentesCriticos}</span>
              <p className="text-[11px] text-rose-600/80 mt-0.5">Diferença ≥ 15%</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">Alerta Moderado</p>
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-circle-exclamation"></i>
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-amber-700 tabular-nums">{metricas.divergentesAlerta}</span>
              <p className="text-[11px] text-amber-600/80 mt-0.5">Diferença de 5% a 14%</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">Alinhados</p>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-circle-check"></i>
              </div>
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-emerald-700 tabular-nums">{metricas.alinhados}</span>
              <p className="text-[11px] text-emerald-600/80 mt-0.5">Diferença inferior a 5%</p>
            </div>
          </div>

          <div
            onClick={() => {
              setTermoBuscaModal('');
              setFiltroTurmaModal('');
              setFiltroTipoModal('TODOS');
              setModalTransferidosAberto(true);
            }}
            className="col-span-2 md:col-span-1 bg-white hover:bg-amber-50/40 p-4 rounded-2xl border border-slate-200/80 hover:border-amber-300/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] cursor-pointer transition group flex flex-col justify-between"
            title="Clique para ver a lista de estudantes com bimestres do Mapão não exportados (prováveis transferidos)"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-amber-800">Mapão Pendente</p>
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-user-clock"></i>
              </div>
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <span className="text-2xl font-bold tracking-tight text-amber-800 tabular-nums">{alunosComMapaoPendente.length}</span>
                <p className="text-[11px] text-amber-700/80 mt-0.5">Transferidos / pendentes</p>
              </div>
              <span className="text-xs text-amber-700 font-semibold group-hover:translate-x-0.5 transition flex items-center gap-1">
                Lista <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </span>
            </div>
          </div>
        </section>

        {/* Command Bar de Filtros e Busca */}
        <section className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Buscar por nome, RA, turma ou tutor..."
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:bg-white transition"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filtroTurma}
                onChange={(e) => setFiltroTurma(e.target.value)}
                className="text-xs font-medium border border-slate-200/80 rounded-xl px-3 py-2 bg-slate-50/90 text-slate-700 focus:outline-hidden focus:bg-white cursor-pointer"
              >
                <option value="">Todas as Turmas</option>
                {turmasDisponiveis.map(t => (
                  <option key={t} value={t}>Turma {t}</option>
                ))}
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="text-xs font-medium border border-slate-200/80 rounded-xl px-3 py-2 bg-slate-50/90 text-slate-700 focus:outline-hidden focus:bg-white cursor-pointer"
              >
                <option value="TODOS">Todos os Alunos</option>
                <option value="MAPAO_PENDENTE">Mapão/Bimestre Não Exportado ({alunosComMapaoPendente.length})</option>
                <option value="TODAS_DIVERGENCIAS">Todas as Divergências (≥ 5%)</option>
                <option value="DIVERGENCIA_CRITICA">Divergência Crítica (≥ 15%)</option>
                <option value="DIVERGENCIA_ALERTA">Alerta Moderado (5% a 14%)</option>
                <option value="ALINHADO">Alinhados (Consistentes)</option>
                <option value="SEM_MAPAO">Apenas SED (Sem Mapão)</option>
                <option value="AJUSTADO_DIRECAO">Casos Especiais (Ajustados pela Direção)</option>
              </select>

              <select
                value={ordenacao}
                onChange={(e) => setOrdenacao(e.target.value as any)}
                className="text-xs font-medium border border-slate-200/80 rounded-xl px-3 py-2 bg-slate-50/90 text-slate-700 focus:outline-hidden focus:bg-white cursor-pointer"
              >
                <option value="maior_divergencia">Maior Divergência</option>
                <option value="menor_sed">Menor Frequência SED</option>
                <option value="menor_mapao">Menor Frequência Mapão</option>
                <option value="nome">Nome (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Filter Pills rápidas deslizáveis no mobile e desktop */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-slate-100">
            {[
              { id: 'TODOS', label: 'Todos' },
              { id: 'DIVERGENCIA_CRITICA', label: `Críticos (${metricas.divergentesCriticos})` },
              { id: 'DIVERGENCIA_ALERTA', label: `Alertas (${metricas.divergentesAlerta})` },
              { id: 'ALINHADO', label: `Alinhados (${metricas.alinhados})` },
              { id: 'MAPAO_PENDENTE', label: `Pendentes (${alunosComMapaoPendente.length})` },
              { id: 'AJUSTADO_DIRECAO', label: 'Ajustados Direção' }
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setFiltroStatus(pill.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap cursor-pointer ${
                  filtroStatus === pill.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tabela / Cards de Comparação */}
        <section className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-xs text-slate-700 tabular-nums">
              Estudantes Encontrados ({listaFiltrada.length})
            </span>
            <span className="text-xs text-slate-400">
              Clique no nome do aluno para acessar o Dossiê completo
            </span>
          </div>

          {carregando ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              <i className="fa-solid fa-spinner fa-spin text-xl text-indigo-600 mb-2 block"></i>
              Carregando base de estudantes e cruzando dados de frequência...
            </div>
          ) : listaFiltrada.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              <i className="fa-solid fa-check-double text-2xl text-emerald-500 mb-2 block"></i>
              Nenhuma divergência encontrada para os filtros selecionados!
            </div>
          ) : (
            <>
              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-100">
                {listaFiltrada.map(item => {
                  const c = item.comparison;
                  const diffVal = c.diff;
                  const absDiff = Math.abs(diffVal ?? 0);

                  const borderSide =
                    c.status === 'divergente_critico'
                      ? 'border-l-4 border-l-rose-500'
                      : c.status === 'divergente_alerta'
                      ? 'border-l-4 border-l-amber-500'
                      : c.status === 'alinhado'
                      ? 'border-l-4 border-l-emerald-500'
                      : 'border-l-4 border-l-slate-300';

                  return (
                    <div key={item.ra} className={`p-4 space-y-3 ${borderSide}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <button
                            type="button"
                            onClick={() => abrirFicha(item.ra)}
                            className="font-semibold text-slate-900 hover:text-indigo-600 text-sm text-left cursor-pointer"
                          >
                            {item.nome}
                          </button>
                          <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                            Turma {item.turma} • RA: {item.ra}
                          </p>
                        </div>
                        {diffVal !== null && (
                          <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold tabular-nums border ${
                            c.status === 'divergente_critico'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : c.status === 'divergente_alerta'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}>
                            {diffVal > 0 ? `+${diffVal.toFixed(1)}%` : `${diffVal.toFixed(1)}%`}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                        <div className="bg-slate-50/90 p-2.5 rounded-xl border border-slate-200/60">
                          <span className="text-[11px] text-slate-400 block">Frequência SED</span>
                          <strong className="text-slate-900 font-semibold">
                            {c.sedFreq !== null ? `${c.sedFreq.toFixed(1)}%` : 'Não informado'}
                          </strong>
                          {c.sedFaltas !== null && <span className="text-[11px] text-slate-500 block">{c.sedFaltas} falta(s)</span>}
                        </div>
                        <div className="bg-slate-50/90 p-2.5 rounded-xl border border-slate-200/60">
                          <span className="text-[11px] text-slate-400 block">Frequência Mapão</span>
                          <strong className="text-slate-900 font-semibold">
                            {c.mapaoFreq !== null ? `${c.mapaoFreq.toFixed(1)}%` : 'Sem Mapão'}
                          </strong>
                          {c.mapaoBimestre && <span className="text-[11px] text-indigo-600 block">{c.mapaoBimestre}</span>}
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 leading-snug">{c.mensagem}</p>
                      {absDiff >= 15 && (
                        <span className="inline-block px-2 py-0.5 bg-rose-50 text-rose-800 border border-rose-200/60 border-l-4 border-l-rose-500 font-semibold text-[11px] rounded-lg">
                          Ação Gestora Recomendada
                        </span>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => abrirFicha(item.ra)}
                          className="px-3 py-1.5 bg-slate-900 text-white font-medium rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-address-card text-[11px]"></i>
                          <span>Dossiê</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-medium rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-file-pdf text-[11px]"></i>
                          <span>{item.analiseMapao.temPendencia ? 'Ler PDF Faltante' : 'PDF Boletim'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => (window as any).abrirModalDigitarBoletim?.(item.ra, item.analiseMapao.bimestreSugeridoParaDigitacao)}
                          className="px-3 py-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200/80 font-medium rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-file-pen text-[11px]"></i>
                          <span>Boletim</span>
                        </button>
                        {isDiretor && (
                          <button
                            type="button"
                            onClick={() => (window as any).abrirModalAjusteFreqSED?.(item.ra)}
                            className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200/80 font-medium rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
                          >
                            <i className="fa-solid fa-pen-to-square text-[11px]"></i>
                            <span>Ajustar SED</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                      <th className="p-3.5">Aluno e RA</th>
                      <th className="p-3.5">Turma</th>
                      <th className="p-3.5 text-center">Frequência SED</th>
                      <th className="p-3.5 text-center">Frequência Mapão</th>
                      <th className="p-3.5 text-center">Diferença (SED - Mapão)</th>
                      <th className="p-3.5">Diagnóstico e Situação</th>
                      <th className="p-3.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {listaFiltrada.map(item => {
                      const c = item.comparison;
                      const diffVal = c.diff;
                      const absDiff = Math.abs(diffVal ?? 0);

                      let diffBadgeClass = 'bg-slate-50 text-slate-700 border-slate-200/80 border-l-slate-400';
                      if (c.status === 'divergente_critico') {
                        diffBadgeClass = 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500 font-semibold';
                      } else if (c.status === 'divergente_alerta') {
                        diffBadgeClass = 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-amber-500 font-semibold';
                      } else if (c.status === 'alinhado') {
                        diffBadgeClass = 'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500 font-semibold';
                      }

                      return (
                        <tr key={item.ra} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3.5">
                            <button
                              type="button"
                              onClick={() => abrirFicha(item.ra)}
                              className="font-semibold text-slate-900 hover:text-indigo-600 text-xs text-left cursor-pointer transition block"
                            >
                              {item.nome}
                            </button>
                            <span className="text-[11px] text-slate-400 font-mono tabular-nums">RA: {item.ra}</span>
                          </td>

                          <td className="p-3.5 font-medium text-slate-700">
                            <span>{item.turma}</span>
                            <p className="text-[11px] text-slate-400 truncate max-w-[130px]">{item.tutor}</p>
                          </td>

                          <td className="p-3.5 text-center whitespace-nowrap tabular-nums">
                            {c.sedFreq !== null ? (
                              <div className="flex flex-col items-center">
                                <span className={`px-2.5 py-0.5 rounded-lg font-semibold text-xs border border-l-4 ${
                                  c.sedFreq < 75 ? 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500' :
                                  c.sedFreq <= 80 ? 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-amber-500' :
                                  'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
                                }`}>
                                  {c.sedFreq.toFixed(1)}%
                                </span>
                                {c.sedFaltas !== null && (
                                  <span className="text-[11px] text-slate-400 mt-0.5">
                                    {c.sedFaltas} falta(s)
                                  </span>
                                )}
                                {c.ajusteManual && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200/60 mt-1 cursor-help max-w-[120px] truncate"
                                    title={`Ajuste Manual pela Direção: ${c.motivoAjuste || 'Caso Especial'}${c.justificativaAjuste ? ' — ' + c.justificativaAjuste : ''}`}
                                  >
                                    <i className="fa-solid fa-scale-balanced text-[9px] text-amber-600 shrink-0"></i>
                                    <span className="truncate">Caso Especial</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">Não informado</span>
                            )}
                          </td>

                          <td className="p-3.5 text-center whitespace-nowrap tabular-nums">
                            {c.mapaoFreq !== null ? (
                              <div className="flex flex-col items-center">
                                <span className={`px-2.5 py-0.5 rounded-lg font-semibold text-xs border border-l-4 ${
                                  c.mapaoFreq < 75 ? 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500' :
                                  c.mapaoFreq <= 80 ? 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-amber-500' :
                                  'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
                                }`}>
                                  {c.mapaoFreq.toFixed(1)}%
                                </span>
                                <span className="text-[11px] text-indigo-600 font-medium mt-0.5">
                                  {c.mapaoBimestre || 'Mapão'} {c.mapaoFaltas !== null ? `(${c.mapaoFaltas} f)` : ''}
                                </span>
                              </div>
                            ) : (
                              <span
                                className="inline-block px-2 py-0.5 rounded-md text-[11px] bg-slate-100 text-slate-500 font-medium"
                                title="Não consta no Mapão da nossa escola (transferido após o fechamento ou sem notas registradas)"
                              >
                                Sem Mapão
                              </span>
                            )}
                            {item.analiseMapao.temPendencia && (
                              <div className="flex flex-col items-center gap-1 mt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTermoBuscaModal(item.ra);
                                    setModalTransferidosAberto(true);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200/80 hover:bg-amber-100 transition cursor-pointer"
                                  title={`Ver detalhes: ${item.analiseMapao.motivoDiagnostico}`}
                                >
                                  <i className="fa-solid fa-user-clock text-[9px] text-amber-600"></i>
                                  <span>{item.analiseMapao.bimestresFaltando.length > 0 ? `Pendente: ${item.analiseMapao.bimestresFaltando.join(', ')}` : 'Sem Mapão'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer shadow-2xs"
                                  title="Ler PDF do Boletim SED e atualizar bimestres faltantes automaticamente"
                                >
                                  <i className="fa-solid fa-file-pdf text-[9px]"></i>
                                  <span>Ler PDF Faltante</span>
                                </button>
                              </div>
                            )}
                          </td>

                          <td className="p-3.5 text-center whitespace-nowrap tabular-nums">
                            {diffVal !== null ? (
                              <div className="flex flex-col items-center">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs border border-l-4 ${diffBadgeClass}`}>
                                  <i className={`fa-solid ${diffVal > 0 ? 'fa-arrow-trend-up' : diffVal < 0 ? 'fa-arrow-trend-down' : 'fa-check'} text-[10px]`}></i>
                                  <span>{diffVal > 0 ? `+${diffVal.toFixed(1)}%` : `${diffVal.toFixed(1)}%`}</span>
                                </span>
                                <span className="text-[10px] text-slate-400 mt-0.5">
                                  {absDiff === 0 ? 'Exato' : diffVal > 0 ? 'SED Maior' : 'Mapão Maior'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>

                          <td className="p-3.5">
                            <p className="text-xs text-slate-700 font-medium leading-snug">{c.mensagem}</p>
                            {absDiff >= 15 && (
                              <span className="inline-block px-2 py-0.5 bg-rose-50 text-rose-800 border border-rose-200/60 border-l-4 border-l-rose-500 font-semibold text-[10px] rounded-md mt-1">
                                Ação Gestora Recomendada
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => abrirFicha(item.ra)}
                                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                                title="Ver dossiê do estudante"
                              >
                                <i className="fa-solid fa-address-card text-[11px]"></i>
                                <span>Dossiê</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                                className={`px-2.5 py-1.5 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                  item.analiseMapao.temPendencia
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80'
                                }`}
                                title="Atualizar pendências do boletim dos bimestres faltantes lendo automaticamente o PDF do Boletim Escolar SED"
                              >
                                <i className="fa-solid fa-file-pdf text-[11px]"></i>
                                <span>{item.analiseMapao.temPendencia ? 'Ler PDF Faltante' : 'PDF Boletim'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => (window as any).abrirModalDigitarBoletim?.(item.ra, item.analiseMapao.bimestreSugeridoParaDigitacao)}
                                className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                                title="Digitar ou ajustar boletim e frequências bimestrais"
                              >
                                <i className="fa-solid fa-file-pen text-[11px] text-indigo-600"></i>
                                <span>Boletim</span>
                              </button>
                              {isDiretor && (
                                <button
                                  type="button"
                                  onClick={() => (window as any).abrirModalAjusteFreqSED?.(item.ra)}
                                  className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                                  title="Ajustar frequência na SED manualmente para casos especiais (Exclusivo Direção)"
                                >
                                  <i className="fa-solid fa-pen-to-square text-[11px] text-amber-600"></i>
                                  <span className="hidden xl:inline">Ajustar SED</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Modal Bottom-Sheet de Alunos com Mapão / Bimestre Não Exportado (Prováveis Transferidos) */}
      {modalTransferidosAberto && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-slate-900/55 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-transferidos-titulo"
          onClick={() => setModalTransferidosAberto(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-300"></div>
            </div>

            {/* Cabeçalho do Modal */}
            <div className="bg-white px-5 py-4 sm:px-6 flex items-start justify-between gap-4 border-b border-slate-200/80 shrink-0">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                  <i className="fa-solid fa-user-clock text-lg"></i>
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="modal-transferidos-titulo" className="text-base sm:text-xl font-bold tracking-tight text-slate-900">
                      Alunos com Mapão / Bimestres Não Exportados
                    </h2>
                    <span className="px-2.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200/60 rounded-full text-xs font-semibold tabular-nums">
                      Prováveis Transferidos ({alunosModalFiltrados.length})
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
                    Estudantes com ausência de fechamento no Mapão oficial em um ou mais bimestres consolidados (transferência externa ou pendência de histórico).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalTransferidosAberto(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer shrink-0"
                title="Fechar (Esc)"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            {/* Métricas Rápidas no Topo do Modal */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 bg-slate-50/80 border-b border-slate-200/80 shrink-0 tabular-nums">
              <div className="bg-white p-3 rounded-2xl border border-slate-200/80">
                <p className="text-[11px] font-medium text-slate-500">Total com Pendência</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">{alunosComMapaoPendente.length}</p>
                <p className="text-[10px] text-slate-400">Estudantes ativos</p>
              </div>

              <div className="bg-white p-3 rounded-2xl border border-slate-200/80">
                <p className="text-[11px] font-medium text-rose-600">Sem Nenhum Mapão</p>
                <p className="text-xl font-bold text-rose-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresExportados.length === 0).length}
                </p>
                <p className="text-[10px] text-rose-500">Ano letivo em aberto</p>
              </div>

              <div className="bg-white p-3 rounded-2xl border border-slate-200/80">
                <p className="text-[11px] font-medium text-amber-700">Faltando 1º Bimestre</p>
                <p className="text-xl font-bold text-amber-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresFaltando.includes('1ºB')).length}
                </p>
                <p className="text-[10px] text-amber-600">Entrada tardia na escola</p>
              </div>

              <div className="bg-white p-3 rounded-2xl border border-slate-200/80">
                <p className="text-[11px] font-medium text-indigo-700">Faltando 2º Bimestre / Outros</p>
                <p className="text-xl font-bold text-indigo-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresFaltando.some(b => b !== '1ºB')).length}
                </p>
                <p className="text-[10px] text-indigo-600">Pendente de consolidação</p>
              </div>
            </div>

            {/* Barra de Filtros e Busca no Modal */}
            <div className="p-4 border-b border-slate-200/80 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={termoBuscaModal}
                    onChange={(e) => setTermoBuscaModal(e.target.value)}
                    placeholder="Buscar aluno, RA, turma ou tutor..."
                    className="w-full text-xs pl-8 pr-7 py-2 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 text-slate-800"
                  />
                  {termoBuscaModal && (
                    <button
                      type="button"
                      onClick={() => setTermoBuscaModal('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      <i className="fa-solid fa-circle-xmark"></i>
                    </button>
                  )}
                </div>

                <select
                  value={filtroTurmaModal}
                  onChange={(e) => setFiltroTurmaModal(e.target.value)}
                  className="text-xs font-medium border border-slate-200/80 rounded-xl px-3 py-2 bg-slate-50/90 text-slate-700 focus:outline-hidden"
                >
                  <option value="">Todas as Turmas ({turmasDisponiveis.length})</option>
                  {turmasDisponiveis.map(t => (
                    <option key={t} value={t}>Turma {t}</option>
                  ))}
                </select>

                <select
                  value={filtroTipoModal}
                  onChange={(e) => setFiltroTipoModal(e.target.value as any)}
                  className="text-xs font-medium border border-slate-200/80 rounded-xl px-3 py-2 bg-slate-50/90 text-slate-700 focus:outline-hidden"
                >
                  <option value="TODOS">Todas as Pendências ({alunosComMapaoPendente.length})</option>
                  <option value="SEM_NENHUM">Sem Nenhum Mapão no Ano</option>
                  <option value="FALTA_1B">Faltando 1º Bimestre</option>
                  <option value="FALTA_2B">Faltando 2º Bimestre</option>
                  <option value="FALTA_3B">Faltando 3º Bimestre</option>
                  <option value="FALTA_4B">Faltando 4º Bimestre</option>
                </select>
              </div>

              <button
                type="button"
                onClick={exportarCSVPendentes}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer shrink-0"
                title="Exportar esta lista de alunos com Mapão pendente para CSV"
              >
                <i className="fa-solid fa-file-csv text-emerald-400"></i>
                <span>Exportar CSV</span>
              </button>
            </div>

            {/* Lista / Tabela de Alunos com Pendência */}
            <div className="flex-1 overflow-y-auto">
              {alunosModalFiltrados.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500 text-2xl mb-3">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Nenhum Aluno Encontrado com os Filtros Aplicados
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    {alunosComMapaoPendente.length === 0
                      ? 'Parabéns! Todos os estudantes ativos possuem fechamento completo do Mapão correspondente às suas turmas.'
                      : 'Nenhum estudante corresponde aos critérios de pesquisa ou turma selecionados.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50/90 text-xs font-semibold text-slate-500 sticky top-0 z-10 border-b border-slate-200/80">
                    <tr>
                      <th className="p-3.5">Estudante e RA</th>
                      <th className="p-3.5">Turma e Tutor</th>
                      <th className="p-3.5 text-center">Frequência SED</th>
                      <th className="p-3.5">Situação dos Bimestres no Mapão</th>
                      <th className="p-3.5">Diagnóstico Pedagógico</th>
                      <th className="p-3.5 text-right">Ações Rápidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {alunosModalFiltrados.map(item => {
                      const a = item.analiseMapao;
                      const c = item.comparison;
                      return (
                        <tr key={item.ra} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3.5">
                            <span
                              onClick={() => abrirFicha(item.ra)}
                              className="font-semibold text-slate-900 hover:text-indigo-600 cursor-pointer block"
                            >
                              {item.nome}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[11px] text-slate-500 tabular-nums">RA: {item.ra}</span>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard?.writeText(item.ra)}
                                className="text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                                title="Copiar RA"
                              >
                                <i className="fa-solid fa-copy"></i>
                              </button>
                            </div>
                          </td>

                          <td className="p-3.5">
                            <span className="font-semibold text-slate-800 block">{item.turma}</span>
                            <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <i className="fa-solid fa-user-tie text-[10px] text-slate-400"></i>
                              <span className="truncate max-w-[130px]">{item.tutor}</span>
                            </span>
                          </td>

                          <td className="p-3.5 text-center whitespace-nowrap tabular-nums">
                            {c.sedFreq !== null ? (
                              <div className="flex flex-col items-center">
                                <span className={`px-2 py-0.5 rounded-lg font-semibold text-xs border border-l-4 ${
                                  c.sedFreq < 75 ? 'bg-rose-50 text-rose-800 border-rose-200/60 border-l-rose-500' :
                                  c.sedFreq <= 80 ? 'bg-amber-50 text-amber-800 border-amber-200/60 border-l-amber-500' :
                                  'bg-emerald-50 text-emerald-800 border-emerald-200/60 border-l-emerald-500'
                                }`}>
                                  {c.sedFreq.toFixed(1)}%
                                </span>
                                <span className="text-[11px] text-slate-500 mt-0.5">
                                  {c.sedFaltas !== null ? `${c.sedFaltas} faltas` : 'SED ativa'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">Não informado</span>
                            )}
                          </td>

                          <td className="p-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {a.bimestresStatus.map(b => (
                                <div
                                  key={b.bimestreKey}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-l-4 ${
                                    b.exportado
                                      ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
                                      : 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500'
                                  }`}
                                  title={b.exportado
                                    ? `${b.nome}: Exportado • Média: ${b.mediaGeral !== null && b.mediaGeral !== undefined ? b.mediaGeral.toFixed(1) : 'N/D'} • Freq: ${b.frequencia !== null ? `${b.frequencia}%` : 'N/D'}`
                                    : `${b.nome}: Não Exportado (${b.motivo || 'Sem dados'})`}
                                >
                                  <i className={`fa-solid ${b.exportado ? 'fa-check text-emerald-600' : 'fa-xmark text-rose-600'}`}></i>
                                  <span>{b.label}: {b.exportado ? 'Exportado' : 'Pendente'}</span>
                                </div>
                              ))}
                            </div>
                            {a.bimestresExportados.length === 0 && (
                              <span className="text-[11px] text-rose-600 font-medium block mt-1">
                                Não consta em nenhuma planilha do Mapão no ano
                              </span>
                            )}
                          </td>

                          <td className="p-3.5 max-w-[260px]">
                            <p className="text-xs text-slate-700 leading-snug font-medium">
                              {a.motivoDiagnostico}
                            </p>
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-md mt-1">
                              <i className="fa-solid fa-graduation-cap text-[9px]"></i>
                              <span>Provável Transferência</span>
                            </span>
                          </td>

                          <td className="p-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                                title="Atualizar pendências dos bimestres faltantes lendo automaticamente o PDF do Boletim Escolar SED"
                              >
                                <i className="fa-solid fa-file-pdf text-[11px]"></i>
                                <span>Ler PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirDigitarParaAluno(item.ra, a.bimestreSugeridoParaDigitacao)}
                                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                                title={`Lançar notas e presenças de transferência no boletim (${a.bimestreSugeridoParaDigitacao})`}
                              >
                                <i className="fa-solid fa-file-pen text-[11px]"></i>
                                <span>Digitar Boletim</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirFicha(item.ra)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1"
                                title="Abrir dossiê do estudante"
                              >
                                <i className="fa-solid fa-address-card text-[11px]"></i>
                                <span className="hidden sm:inline">Dossiê</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-4 bg-slate-50/80 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
              <div className="text-slate-500 flex items-center gap-2">
                <i className="fa-solid fa-circle-info text-indigo-600 text-sm"></i>
                <span>
                  <strong>Dica de Gestão:</strong> Ao clicar em <em>"Ler PDF"</em>, o sistema lê automaticamente o boletim da escola de origem e preenche as menções e faltas dos bimestres faltantes.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalTransferidosAberto(false)}
                className="w-full sm:w-auto px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition cursor-pointer shrink-0"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Importação e Leitura Automática de Boletim SED (PDF) */}
      <ModalImportarBoletimPDF
        aluno={alunoParaImportarBoletim}
        aberto={modalBoletimPDFAberto}
        aoFechar={() => {
          setModalBoletimPDFAberto(false);
          setAlunoParaImportarBoletim(null);
        }}
        aoAtualizarSucesso={(alunoAtualizado, bimestres) => {
          setAlunos(prev => {
            const idx = prev.findIndex(a => String(a.ra).replace(/\D/g, '') === String(alunoAtualizado.ra).replace(/\D/g, ''));
            if (idx !== -1) {
              const novo = [...prev];
              novo[idx] = alunoAtualizado;
              return novo;
            }
            return prev;
          });
        }}
      />
    </div>
  );
}
