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
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Cabeçalho do Módulo */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="p-2.5 bg-cyan-400/20 text-cyan-300 rounded-xl border border-cyan-400/30">
              <i className="fa-solid fa-scale-balanced text-xl"></i>
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight">
                Auditoria de Frequência: SED vs. Mapão
              </h1>
              <p className="text-xs text-blue-200 mt-0.5">
                Módulo Exclusivo da Equipe Gestora (CGPG, Vice-Direção e Direção) • EE Clóvis de Lucca
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-300 max-w-3xl mt-2 leading-relaxed">
            Identifica e cruza automaticamente divergências entre a frequência importada da <strong>SED</strong> (Secretaria Escolar Digital) 
            e os dados de faltas e presenças consolidados no <strong>Mapão de Fechamento de Notas</strong> pelos docentes.
          </p>
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
            className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-blue-950 font-black text-xs uppercase tracking-wider rounded-xl transition shadow-sm flex items-center gap-2 cursor-pointer border border-amber-300 active:scale-95"
            title="Listar alunos que têm algum mapão/bimestre não exportado (provavelmente vieram transferidos de outro lugar)"
          >
            <i className="fa-solid fa-user-clock text-sm text-blue-950"></i>
            <span>Bimestres Não Exportados</span>
            <span className="px-1.5 py-0.5 bg-blue-950 text-amber-300 rounded-full text-[10px] font-mono font-black">
              {alunosComMapaoPendente.length}
            </span>
          </button>

          <button
            type="button"
            onClick={exportarCSV}
            className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-blue-950 font-black text-xs uppercase tracking-wider rounded-xl transition shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <i className="fa-solid fa-file-csv text-sm"></i>
            <span>Exportar Relatório</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Estudantes Ativos</p>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-slate-800">{metricas.total}</span>
            <span className="text-xs text-slate-400"><i className="fa-solid fa-users"></i></span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Base escolar monitorada</p>
        </div>

        <div className="bg-rose-50 p-4 rounded-xl border border-rose-200 shadow-2xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Divergência Crítica</p>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-rose-700">{metricas.divergentesCriticos}</span>
            <span className="text-xs text-rose-500"><i className="fa-solid fa-triangle-exclamation"></i></span>
          </div>
          <p className="text-[10px] text-rose-600 mt-1">Diferença ≥ 15% (Atenção Máxima)</p>
        </div>

        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 shadow-2xs">
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Alerta Moderado</p>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-amber-700">{metricas.divergentesAlerta}</span>
            <span className="text-xs text-amber-500"><i className="fa-solid fa-circle-exclamation"></i></span>
          </div>
          <p className="text-[10px] text-amber-600 mt-1">Diferença de 5% a 14%</p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Alinhados</p>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-emerald-700">{metricas.alinhados}</span>
            <span className="text-xs text-emerald-500"><i className="fa-solid fa-circle-check"></i></span>
          </div>
          <p className="text-[10px] text-emerald-600 mt-1">Diferença inferior a 5%</p>
        </div>

        <div 
          onClick={() => {
            setTermoBuscaModal('');
            setFiltroTurmaModal('');
            setFiltroTipoModal('TODOS');
            setModalTransferidosAberto(true);
          }}
          className="bg-amber-50/70 hover:bg-amber-100 p-4 rounded-xl border border-amber-200 shadow-2xs cursor-pointer transition group"
          title="Clique para ver a lista de estudantes com bimestres do Mapão não exportados (prováveis transferidos)"
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Mapão Não Exportado</p>
            <span className="text-[10px] text-amber-900 font-black group-hover:underline flex items-center gap-1">
              Ver Lista <i className="fa-solid fa-arrow-right text-[9px]"></i>
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-black text-amber-900">{alunosComMapaoPendente.length}</span>
            <span className="text-xs text-amber-600"><i className="fa-solid fa-user-clock"></i></span>
          </div>
          <p className="text-[10px] text-amber-700 mt-1 font-medium">Bimestres pendentes / transferidos</p>
        </div>
      </div>

      {/* Painel de Filtros e Busca */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative w-full max-w-md">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input
              type="text"
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar por nome, RA, turma ou tutor..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro por Turma */}
          <select
            value={filtroTurma}
            onChange={(e) => setFiltroTurma(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-hidden"
          >
            <option value="">Todas as Turmas</option>
            {turmasDisponiveis.map(t => (
              <option key={t} value={t}>Turma {t}</option>
            ))}
          </select>

          {/* Filtro por Status da Divergência */}
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-hidden"
          >
            <option value="TODOS">Todos os Alunos</option>
            <option value="MAPAO_PENDENTE">⚠️ Mapão/Bimestre Não Exportado (Transferidos) ({alunosComMapaoPendente.length})</option>
            <option value="TODAS_DIVERGENCIAS">Todas as Divergências (≥ 5%)</option>
            <option value="DIVERGENCIA_CRITICA">Divergência Crítica (≥ 15%)</option>
            <option value="DIVERGENCIA_ALERTA">Alerta Moderado (5% a 14%)</option>
            <option value="ALINHADO">Alinhados (Consistentes)</option>
            <option value="SEM_MAPAO">Apenas SED (Sem Mapão / Transferido)</option>
            <option value="AJUSTADO_DIRECAO">⚖️ Casos Especiais (Ajustados pela Direção)</option>
          </select>

          {/* Ordenação */}
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as any)}
            className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-hidden"
          >
            <option value="maior_divergencia">Maior Divergência Absoluta</option>
            <option value="menor_sed">Menor Frequência SED</option>
            <option value="menor_mapao">Menor Frequência Mapão</option>
            <option value="nome">Nome do Aluno (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Tabela de Comparação */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs uppercase text-slate-600 tracking-wider">
              Estudantes Encontrados ({listaFiltrada.length})
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Clique no nome do aluno para acessar o Dossiê completo
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider text-[11px]">
                <th className="p-3 font-bold">Aluno & RA</th>
                <th className="p-3 font-bold">Turma</th>
                <th className="p-3 font-bold text-center">Frequência SED</th>
                <th className="p-3 font-bold text-center">Frequência Mapão</th>
                <th className="p-3 font-bold text-center">Diferença (SED - Mapão)</th>
                <th className="p-3 font-bold">Diagnóstico & Situação</th>
                <th className="p-3 font-bold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {carregando && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    <i className="fa-solid fa-spinner fa-spin text-lg mr-2"></i>
                    Carregando base de estudantes e cruzando dados de frequência...
                  </td>
                </tr>
              )}

              {!carregando && listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    <i className="fa-solid fa-check-double text-2xl text-emerald-500 mb-2 block"></i>
                    Nenhuma divergência encontrada para os filtros selecionados!
                  </td>
                </tr>
              )}

              {!carregando && listaFiltrada.map(item => {
                const c = item.comparison;
                const diffVal = c.diff;
                const absDiff = Math.abs(diffVal ?? 0);

                let diffBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
                if (c.status === 'divergente_critico') {
                  diffBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300 font-black';
                } else if (c.status === 'divergente_alerta') {
                  diffBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
                } else if (c.status === 'alinhado') {
                  diffBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                }

                return (
                  <tr key={item.ra} className="hover:bg-slate-50 transition-colors">
                    {/* Aluno & RA */}
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => abrirFicha(item.ra)}
                        className="font-bold text-blue-900 hover:text-blue-700 uppercase text-xs text-left cursor-pointer transition block"
                      >
                        {item.nome}
                      </button>
                      <span className="text-[10px] text-slate-400 font-mono">RA: {item.ra}</span>
                    </td>

                    {/* Turma */}
                    <td className="p-3 font-semibold text-slate-700">
                      <span>{item.turma}</span>
                      <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{item.tutor}</p>
                    </td>

                    {/* Frequência SED */}
                    <td className="p-3 text-center whitespace-nowrap">
                      {c.sedFreq !== null ? (
                        <div className="flex flex-col items-center">
                          <span className={`px-2 py-0.5 rounded-md font-black text-xs border ${
                            c.sedFreq < 75 ? 'bg-rose-100 text-rose-800 border-rose-200' :
                            c.sedFreq <= 80 ? 'bg-amber-100 text-amber-800 border-amber-200' :
                            'bg-emerald-100 text-emerald-800 border-emerald-200'
                          }`}>
                            {c.sedFreq.toFixed(1)}%
                          </span>
                          {c.sedFaltas !== null && (
                            <span className="text-[9px] text-slate-400 mt-0.5">
                              {c.sedFaltas} falta(s)
                            </span>
                          )}
                          {c.ajusteManual && (
                            <span 
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300 mt-1 cursor-help max-w-[110px] truncate"
                              title={`Ajuste Manual pela Direção: ${c.motivoAjuste || 'Caso Especial'}${c.justificativaAjuste ? ' — ' + c.justificativaAjuste : ''}`}
                            >
                              <i className="fa-solid fa-scale-balanced text-[9px] text-amber-700 shrink-0"></i>
                              <span className="truncate">Caso Especial</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">Não informado</span>
                      )}
                    </td>

                    {/* Frequência Mapão */}
                    <td className="p-3 text-center whitespace-nowrap">
                      {c.mapaoFreq !== null ? (
                        <div className="flex flex-col items-center">
                          <span className={`px-2 py-0.5 rounded-md font-black text-xs border ${
                            c.mapaoFreq < 75 ? 'bg-rose-100 text-rose-800 border-rose-200' :
                            c.mapaoFreq <= 80 ? 'bg-amber-100 text-amber-800 border-amber-200' :
                            'bg-emerald-100 text-emerald-800 border-emerald-200'
                          }`}>
                            {c.mapaoFreq.toFixed(1)}%
                          </span>
                          <span className="text-[9px] text-indigo-600 font-bold mt-0.5">
                            {c.mapaoBimestre || 'Mapão'} {c.mapaoFaltas !== null ? `(${c.mapaoFaltas} f)` : ''}
                          </span>
                        </div>
                      ) : (
                        <span 
                          className="inline-block px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 font-medium"
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
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition cursor-pointer"
                            title={`Ver detalhes: ${item.analiseMapao.motivoDiagnostico}`}
                          >
                            <i className="fa-solid fa-user-clock text-[9px] text-amber-700"></i>
                            <span>{item.analiseMapao.bimestresFaltando.length > 0 ? `Pendente: ${item.analiseMapao.bimestresFaltando.join(', ')}` : 'Sem Mapão'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer shadow-2xs"
                            title="Ler PDF do Boletim SED e atualizar bimestres faltantes automaticamente"
                          >
                            <i className="fa-solid fa-file-pdf text-[9px]"></i>
                            <span>Ler PDF Faltante</span>
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Diferença */}
                    <td className="p-3 text-center whitespace-nowrap">
                      {diffVal !== null ? (
                        <div className="flex flex-col items-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs border ${diffBadgeClass}`}>
                            <i className={`fa-solid ${diffVal > 0 ? 'fa-arrow-trend-up' : diffVal < 0 ? 'fa-arrow-trend-down' : 'fa-check'} text-[10px]`}></i>
                            <span>{diffVal > 0 ? `+${diffVal.toFixed(1)}%` : `${diffVal.toFixed(1)}%`}</span>
                          </span>
                          <span className="text-[9px] text-slate-400 mt-0.5">
                            {absDiff === 0 ? 'Exato' : diffVal > 0 ? 'SED Maior' : 'Mapão Maior'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Diagnóstico */}
                    <td className="p-3">
                      <p className="text-xs text-slate-700 font-medium leading-tight">{c.mensagem}</p>
                      {absDiff >= 15 && (
                        <span className="inline-block px-1.5 py-0.5 bg-rose-600 text-white font-black text-[9px] rounded uppercase tracking-wider mt-1">
                          Ação Gestora Recomendada
                        </span>
                      )}
                    </td>

                    {/* Ação */}
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => abrirFicha(item.ra)}
                          className="px-2.5 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5"
                          title="Ver dossiê do estudante"
                        >
                          <i className="fa-solid fa-address-card text-[11px]"></i>
                          <span>Dossiê</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                          className={`px-2.5 py-1.5 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                            item.analiseMapao.temPendencia
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-300'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                          title="Atualizar pendências do boletim dos bimestres faltantes lendo automaticamente o PDF do Boletim Escolar SED"
                        >
                          <i className="fa-solid fa-file-pdf text-[11px]"></i>
                          <span>{item.analiseMapao.temPendencia ? 'Ler PDF Faltante' : 'PDF Boletim'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => (window as any).abrirModalDigitarBoletim?.(item.ra, item.analiseMapao.bimestreSugeridoParaDigitacao)}
                          className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          title="Digitar ou ajustar boletim e frequências bimestrais (disponível para todos os perfis, ex: alunos transferidos)"
                        >
                          <i className="fa-solid fa-file-pen text-[11px] text-indigo-600"></i>
                          <span>Boletim</span>
                        </button>
                        {isDiretor && (
                          <button
                            type="button"
                            onClick={() => (window as any).abrirModalAjusteFreqSED?.(item.ra)}
                            className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                            title="Ajustar frequência na SED manualmente para casos especiais (Exclusivo Direção)"
                          >
                            <i className="fa-solid fa-pen-to-square text-[11px]"></i>
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
      </div>

      {/* Modal de Alunos com Mapão / Bimestre Não Exportado (Prováveis Transferidos) */}
      {modalTransferidosAberto && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/75 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-transferidos-titulo"
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Cabeçalho do Modal */}
            <div className="bg-gradient-to-r from-blue-950 via-indigo-950 to-slate-900 text-white p-5 md:p-6 flex items-start justify-between gap-4 border-b border-white/10 shrink-0">
              <div className="flex items-start gap-3">
                <span className="p-3 bg-amber-400/20 text-amber-300 rounded-xl border border-amber-400/30 shrink-0 mt-0.5">
                  <i className="fa-solid fa-user-clock text-xl text-amber-300"></i>
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="modal-transferidos-titulo" className="text-lg md:text-xl font-black tracking-tight text-white">
                      Alunos com Mapão / Bimestres Não Exportados
                    </h2>
                    <span className="px-2.5 py-0.5 bg-amber-400 text-slate-950 rounded-full text-[10px] font-black uppercase tracking-wider">
                      Prováveis Transferidos ({alunosModalFiltrados.length})
                    </span>
                  </div>
                  <p className="text-xs text-blue-200 mt-1 max-w-3xl leading-relaxed">
                    Lista de estudantes que possuem ausência de fechamento no Mapão oficial em um ou mais bimestres consolidados pela escola. 
                    Geralmente decorre de <strong>matrícula por transferência externa</strong> após o fechamento do período ou pendência de lançamento do histórico escolar.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setModalTransferidosAberto(false)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition cursor-pointer shrink-0"
                title="Fechar (Esc)"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Métricas Rápidas no Topo do Modal */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 bg-slate-50 border-b border-slate-200 shrink-0">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total com Pendência</p>
                <p className="text-xl font-black text-slate-800 mt-0.5">{alunosComMapaoPendente.length}</p>
                <p className="text-[9px] text-slate-400">Estudantes ativos</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-rose-200 shadow-2xs">
                <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Sem Nenhum Mapão</p>
                <p className="text-xl font-black text-rose-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresExportados.length === 0).length}
                </p>
                <p className="text-[9px] text-rose-600">Ano letivo em aberto</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-amber-200 shadow-2xs">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Faltando 1º Bimestre</p>
                <p className="text-xl font-black text-amber-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresFaltando.includes('1ºB')).length}
                </p>
                <p className="text-[9px] text-amber-600">Entrada tardia na escola</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-indigo-200 shadow-2xs">
                <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Faltando 2º Bimestre / Outros</p>
                <p className="text-xl font-black text-indigo-700 mt-0.5">
                  {alunosComMapaoPendente.filter(a => a.analiseMapao.bimestresFaltando.some(b => b !== '1ºB')).length}
                </p>
                <p className="text-[9px] text-indigo-600">Pendente de consolidação</p>
              </div>
            </div>

            {/* Barra de Filtros e Busca no Modal */}
            <div className="p-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
                {/* Campo de Busca */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={termoBuscaModal}
                    onChange={(e) => setTermoBuscaModal(e.target.value)}
                    placeholder="Buscar aluno, RA, turma ou tutor..."
                    className="w-full text-xs pl-8 pr-7 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-hidden focus:border-indigo-500 text-slate-800"
                  />
                  {termoBuscaModal && (
                    <button
                      type="button"
                      onClick={() => setTermoBuscaModal('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      <i className="fa-solid fa-circle-xmark"></i>
                    </button>
                  )}
                </div>

                {/* Filtro de Turma */}
                <select
                  value={filtroTurmaModal}
                  onChange={(e) => setFiltroTurmaModal(e.target.value)}
                  className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-hidden"
                >
                  <option value="">Todas as Turmas ({turmasDisponiveis.length})</option>
                  {turmasDisponiveis.map(t => (
                    <option key={t} value={t}>Turma {t}</option>
                  ))}
                </select>

                {/* Filtro de Tipo de Pendência */}
                <select
                  value={filtroTipoModal}
                  onChange={(e) => setFiltroTipoModal(e.target.value as any)}
                  className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-hidden"
                >
                  <option value="TODOS">Todas as Pendências ({alunosComMapaoPendente.length})</option>
                  <option value="SEM_NENHUM">Sem Nenhum Mapão no Ano</option>
                  <option value="FALTA_1B">Faltando 1º Bimestre</option>
                  <option value="FALTA_2B">Faltando 2º Bimestre</option>
                  <option value="FALTA_3B">Faltando 3º Bimestre</option>
                  <option value="FALTA_4B">Faltando 4º Bimestre</option>
                </select>
              </div>

              {/* Botão Exportar CSV */}
              <button
                type="button"
                onClick={exportarCSVPendentes}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition shadow-2xs flex items-center gap-1.5 cursor-pointer shrink-0"
                title="Exportar esta lista de alunos com Mapão pendente para CSV"
              >
                <i className="fa-solid fa-file-csv text-sm"></i>
                <span>Exportar CSV</span>
              </button>
            </div>

            {/* Lista / Tabela de Alunos com Pendência */}
            <div className="flex-1 overflow-y-auto">
              {alunosModalFiltrados.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-2xl mb-3">
                    <i className="fa-solid fa-circle-check text-emerald-500"></i>
                  </div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
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
                  <thead className="bg-slate-100 text-[10px] uppercase font-black tracking-wider text-slate-600 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="p-3">Estudante & RA</th>
                      <th className="p-3">Turma & Tutor</th>
                      <th className="p-3 text-center">Frequência SED</th>
                      <th className="p-3">Situação dos Bimestres no Mapão</th>
                      <th className="p-3">Diagnóstico Pedagógico</th>
                      <th className="p-3 text-right">Ações Rápidas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {alunosModalFiltrados.map(item => {
                      const a = item.analiseMapao;
                      const c = item.comparison;
                      return (
                        <tr key={item.ra} className="hover:bg-amber-50/40 transition-colors">
                          {/* Aluno & RA */}
                          <td className="p-3">
                            <span 
                              onClick={() => abrirFicha(item.ra)}
                              className="font-extrabold text-blue-950 hover:text-indigo-600 cursor-pointer block uppercase"
                            >
                              {item.nome}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] text-slate-500 font-bold">RA: {item.ra}</span>
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

                          {/* Turma & Tutor */}
                          <td className="p-3">
                            <span className="font-bold text-slate-800 block">{item.turma}</span>
                            <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <i className="fa-solid fa-user-tie text-[9px] text-slate-400"></i>
                              <span className="truncate max-w-[130px]">{item.tutor}</span>
                            </span>
                          </td>

                          {/* Frequência SED */}
                          <td className="p-3 text-center whitespace-nowrap">
                            {c.sedFreq !== null ? (
                              <div className="flex flex-col items-center">
                                <span className={`px-2 py-0.5 rounded-md font-black text-xs border ${
                                  c.sedFreq < 75 ? 'bg-rose-100 text-rose-800 border-rose-200' :
                                  c.sedFreq <= 80 ? 'bg-amber-100 text-amber-800 border-amber-200' :
                                  'bg-emerald-100 text-emerald-800 border-emerald-200'
                                }`}>
                                  {c.sedFreq.toFixed(1)}%
                                </span>
                                <span className="text-[9px] text-slate-500 font-medium mt-0.5">
                                  {c.sedFaltas !== null ? `${c.sedFaltas} faltas` : 'SED ativa'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs italic">Não informado</span>
                            )}
                          </td>

                          {/* Situação dos Bimestres */}
                          <td className="p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {a.bimestresStatus.map(b => (
                                <div
                                  key={b.bimestreKey}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border ${
                                    b.exportado 
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                                      : 'bg-rose-50 text-rose-800 border-rose-300'
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
                              <span className="text-[10px] text-rose-600 font-bold block mt-1">
                                ⚠️ Não consta em nenhuma planilha do Mapão no ano
                              </span>
                            )}
                          </td>

                          {/* Diagnóstico */}
                          <td className="p-3 max-w-[260px]">
                            <p className="text-xs text-slate-700 leading-tight font-medium">
                              {a.motivoDiagnostico}
                            </p>
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded mt-1">
                              <i className="fa-solid fa-graduation-cap text-[8px]"></i>
                              <span>Provável Transferência</span>
                            </span>
                          </td>

                          {/* Ações Rápidas */}
                          <td className="p-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => abrirModalBoletimPDFParaAluno(item.ra)}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                title="Atualizar pendências dos bimestres faltantes lendo automaticamente o PDF do Boletim Escolar SED"
                              >
                                <i className="fa-solid fa-file-pdf text-[11px] text-emerald-200"></i>
                                <span>Ler PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirDigitarParaAluno(item.ra, a.bimestreSugeridoParaDigitacao)}
                                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                title={`Lançar notas e presenças de transferência no boletim (${a.bimestreSugeridoParaDigitacao})`}
                              >
                                <i className="fa-solid fa-file-pen text-[11px]"></i>
                                <span>Digitar Boletim</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirFicha(item.ra)}
                                className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1"
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
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shrink-0">
              <div className="text-slate-500 flex items-center gap-2">
                <i className="fa-solid fa-circle-info text-indigo-600 text-sm"></i>
                <span>
                  <strong>Dica de Gestão:</strong> Ao clicar em <em>"Ler PDF"</em>, o sistema lê automaticamente o boletim da escola de origem e preenche as menções e faltas dos bimestres faltantes.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalTransferidosAberto(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl transition cursor-pointer shrink-0"
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
          // Atualiza lista local de alunos
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
