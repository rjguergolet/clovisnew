import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, db, doc, getDoc, getDocs } from '../../lib/database';
import { normalizarCargo } from '../../modules/authHelper';
import {
  AlunoNormalizado,
  DashboardInteligenciaTab,
  GlobalDashboardFilters,
  normalizarAlunos,
  unificarOcorrencias
} from '../../modules/inteligenciaDataEngine';
import MascoteSaraState from '../MascoteSaraState';
import BuscaAtivaRapidaModal from './BuscaAtivaRapidaModal';
import ChamadaDiariaConsolidacaoModal from './ChamadaDiariaConsolidacaoModal';
import Dashboard1Evasao from './Dashboard1Evasao';
import Dashboard2Academico from './Dashboard2Academico';
import Dashboard3Pontualidade from './Dashboard3Pontualidade';
import Dashboard4Convivencia from './Dashboard4Convivencia';
import Dashboard5PEI from './Dashboard5PEI';
import Dashboard6Docente from './Dashboard6Docente';
import Dashboard7Governanca from './Dashboard7Governanca';

interface CentralInteligenciaDashboardsProps {
  activeTab: string;
  userRole: string;
}

interface TabMeta {
  id: DashboardInteligenciaTab;
  numero: string;
  titulo: string;
  subtitulo: string;
  icon: string;
  rolesPermitidos: string[];
}

const DASHBOARD_TABS: TabMeta[] = [
  {
    id: 'dash-evasao',
    numero: '1',
    titulo: 'Evasão & Tripla Frequência',
    subtitulo: 'SED × Mapão × Diária + Busca Ativa',
    icon: 'fa-solid fa-heart-pulse',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR', 'SECRETARIA']
  },
  {
    id: 'dash-academico',
    numero: '2',
    titulo: 'Desempenho Acadêmico',
    subtitulo: 'Conselho, Heatmap & Dispersão',
    icon: 'fa-solid fa-graduation-cap',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR', 'SECRETARIA']
  },
  {
    id: 'dash-pontualidade',
    numero: '3',
    titulo: 'Pontualidade & Atrasos',
    subtitulo: 'Reincidência, Horários & Saídas',
    icon: 'fa-solid fa-clock',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR', 'SECRETARIA']
  },
  {
    id: 'dash-convivencia',
    numero: '4',
    titulo: 'Clima & Conviva SP',
    subtitulo: 'Ocorrências & Conformidade',
    icon: 'fa-solid fa-shield-halved',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR']
  },
  {
    id: 'dash-pei',
    numero: '5',
    titulo: 'Gestão Pedagógica PEI',
    subtitulo: 'Tutoria, Clubes, Eletivas & PV',
    icon: 'fa-solid fa-compass',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR']
  },
  {
    id: 'dash-docente',
    numero: '6',
    titulo: 'Operacional Docente',
    subtitulo: 'Janelas, Grade & Substituições',
    icon: 'fa-solid fa-chalkboard-user',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'SECRETARIA']
  },
  {
    id: 'dash-governanca',
    numero: '7',
    titulo: 'Governança & Auditoria',
    subtitulo: 'PDCA, Agenda & Saúde da Base',
    icon: 'fa-solid fa-list-check',
    rolesPermitidos: ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC']
  }
];

function mapLegacyToNewTab(tab: string): DashboardInteligenciaTab {
  switch (tab) {
    case 'dashboard':
    case 'dashboard-geral':
    case 'comparativo-frequencia':
    case 'dash-evasao':
      return 'dash-evasao';
    case 'dashboard-notas':
    case 'dash-academico':
      return 'dash-academico';
    case 'dashboard-atrasos':
    case 'dash-pontualidade':
      return 'dash-pontualidade';
    case 'dash-convivencia':
      return 'dash-convivencia';
    case 'dash-projetos-pei':
    case 'dash-pei':
      return 'dash-pei';
    case 'dash-docente':
      return 'dash-docente';
    case 'dash-governanca':
      return 'dash-governanca';
    default:
      return 'dash-evasao';
  }
}

export default function CentralInteligenciaDashboards({
  activeTab,
  userRole
}: CentralInteligenciaDashboardsProps) {
  const roleNorm = normalizarCargo(String(userRole || 'PROFESSOR').toUpperCase().trim());

  const abasPermitidas = useMemo(() => {
    return DASHBOARD_TABS.filter(
      (t) =>
        t.rolesPermitidos.includes(roleNorm) ||
        (roleNorm.includes('VICE') && t.rolesPermitidos.includes('VICE_DIRETOR'))
    );
  }, [roleNorm]);

  const tabAtualMapeada = mapLegacyToNewTab(activeTab);
  const tabAtivaValida: DashboardInteligenciaTab = useMemo(() => {
    if (abasPermitidas.some((t) => t.id === tabAtualMapeada)) {
      return tabAtualMapeada;
    }
    return abasPermitidas[0]?.id || 'dash-evasao';
  }, [abasPermitidas, tabAtualMapeada]);

  // Filtros globais persistentes no topo (padrão: ativo)
  const [filtros, setFiltros] = useState<GlobalDashboardFilters>({
    segmento: 'TODOS',
    turma: 'TODAS',
    tutor: 'TODOS',
    statusAluno: 'ativo',
    busca: ''
  });

  // Dados carregados do MongoDB Atlas + cache global
  const [carregando, setCarregando] = useState(true);
  const [alunosRaw, setAlunosRaw] = useState<any[]>([]);
  const [ocorrenciasTop, setOcorrenciasTop] = useState<any[]>([]);
  const [buscaAtivaDocs, setBuscaAtivaDocs] = useState<any[]>([]);
  const [frequenciaDiariaDocs, setFrequenciaDiariaDocs] = useState<any[]>([]);
  const [horarios, setHorarios] = useState<any[]>([]);
  const [professores, setProfessores] = useState<any[]>([]);
  const [substituicoes, setSubstituicoes] = useState<any[]>([]);
  const [rotinaPdca, setRotinaPdca] = useState<any[]>([]);
  const [tarefas, setTarefas] = useState<any[]>([]);
  const [eventosAgenda, setEventosAgenda] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [capacidadesPEI, setCapacidadesPEI] = useState<Record<string, any>>({});
  const [indisponibilidade, setIndisponibilidade] = useState<Record<string, any>>({});
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<string>('');

  // Modais de ação rápida
  const [alunoBuscaAtivaModal, setAlunoBuscaAtivaModal] = useState<AlunoNormalizado | null>(null);
  const [chamadaModalAberta, setChamadaModalAberta] = useState(false);

  const carregarDados = useCallback(async (forceRefresh = false) => {
    setCarregando(true);
    try {
      const safeGetDocs = async (colName: string): Promise<any[]> => {
        try {
          const snap = await getDocs(collection(db, colName));
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch {
          return [];
        }
      };

      const safeGetDoc = async (colName: string, docId: string): Promise<any> => {
        try {
          const snap = await getDoc(doc(db, colName, docId));
          return snap.exists() ? snap.data() : {};
        } catch {
          return {};
        }
      };

      const alunosCache = !forceRefresh && Array.isArray((window as any).allStudentsData) && (window as any).allStudentsData.length > 0
        ? (window as any).allStudentsData
        : null;

      const [
        alunosDb,
        ocDb,
        baDb,
        freqDiariaDb,
        horariosDb,
        profsDb,
        subsDiariasDb,
        subsPeiDb,
        pdcaDb,
        tarefasDb,
        eventosDb,
        auditDb,
        capDoc,
        indispDoc
      ] = await Promise.all([
        alunosCache ? Promise.resolve(alunosCache) : safeGetDocs('alunos'),
        safeGetDocs('ocorrencias'),
        safeGetDocs('busca_ativa'),
        safeGetDocs('frequencia_diaria'),
        safeGetDocs('horarios'),
        safeGetDocs('professores'),
        safeGetDocs('substituicoes_diarias'),
        safeGetDocs('substituicoes_pei'),
        safeGetDocs('rotina_pdca'),
        safeGetDocs('tarefas'),
        safeGetDocs('eventos'),
        safeGetDocs('audit_logs'),
        safeGetDoc('configuracoes', 'capacidadesPEI'),
        safeGetDoc('config_escola', 'indisponibilidade_professores')
      ]);

      if (!alunosCache && Array.isArray(alunosDb) && alunosDb.length > 0) {
        (window as any).allStudentsData = alunosDb;
      }

      // Fallback localStorage para capacidades PEI
      let capFinal = capDoc || {};
      if (Object.keys(capFinal).length === 0) {
        try {
          const localCap = localStorage.getItem('clovis_capacidades_pei_cache');
          if (localCap) capFinal = JSON.parse(localCap);
        } catch {
          // ignore
        }
      }

      setAlunosRaw(alunosDb);
      setOcorrenciasTop(ocDb);
      setBuscaAtivaDocs(baDb);
      setFrequenciaDiariaDocs(freqDiariaDb);
      setHorarios(horariosDb);
      setProfessores(profsDb);
      setSubstituicoes(subsDiariasDb.length > 0 ? subsDiariasDb : subsPeiDb);
      setRotinaPdca(pdcaDb);
      setTarefas(tarefasDb);
      setEventosAgenda(eventosDb);
      setAuditLogs(auditDb);
      setCapacidadesPEI(capFinal);
      setIndisponibilidade(indispDoc?.matriz || indispDoc || {});
      setUltimaSincronizacao(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('[CentralInteligenciaDashboards] Erro ao carregar coleções:', err);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarDados(false);
  }, [carregarDados]);

  const ocorrenciasUnificadas = useMemo(
    () => unificarOcorrencias(ocorrenciasTop, alunosRaw),
    [ocorrenciasTop, alunosRaw]
  );

  const alunosNormalizados = useMemo(
    () => normalizarAlunos(alunosRaw, buscaAtivaDocs, frequenciaDiariaDocs, ocorrenciasUnificadas),
    [alunosRaw, buscaAtivaDocs, frequenciaDiariaDocs, ocorrenciasUnificadas]
  );

  // Opções únicas para filtros globais
  const opcoesFiltros = useMemo(() => {
    const segmentos = new Set<string>();
    const turmas = new Set<string>();
    const tutores = new Set<string>();

    alunosNormalizados.forEach((a) => {
      if (a.segmento && a.segmento !== 'Não informado') segmentos.add(a.segmento);
      if (a.turma && a.turma !== 'SEM TURMA') turmas.add(a.turma);
      if (a.tutor) tutores.add(a.tutor);
    });

    return {
      segmentos: Array.from(segmentos).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      turmas: Array.from(turmas).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      tutores: Array.from(tutores).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    };
  }, [alunosNormalizados]);

  // Aplica filtros globais persistentes
  const alunosFiltrados = useMemo(() => {
    const q = filtros.busca.trim().toLowerCase();
    return alunosNormalizados.filter((a) => {
      if (filtros.statusAluno === 'ativo' && !a.ativo) return false;
      if (filtros.statusAluno === 'transferido' && a.ativo) return false;
      if (filtros.segmento !== 'TODOS' && a.segmento !== filtros.segmento) return false;
      if (filtros.turma !== 'TODAS' && a.turma !== filtros.turma) return false;
      if (filtros.tutor !== 'TODOS' && a.tutor !== filtros.tutor) return false;
      if (q && !a.nome.toLowerCase().includes(q) && !a.ra.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alunosNormalizados, filtros]);

  const navegarParaAba = (tabId: DashboardInteligenciaTab) => {
    if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab(tabId);
    }
  };

  const exportarCsv = () => {
    const headers = [
      'RA',
      'Nome',
      'Turma',
      'Segmento',
      'Tutor',
      'Status',
      '% SED',
      'Evolucao SED',
      '% Mapao',
      '% Diaria',
      'Faltas Consecutivas',
      'Status Busca Ativa',
      'Media Geral'
    ];
    const linhas = alunosFiltrados.map((a) => [
      a.ra,
      `"${a.nome.replace(/"/g, '""')}"`,
      a.turma,
      a.segmento,
      `"${(a.tutor || '').replace(/"/g, '""')}"`,
      a.ativo ? 'Ativo' : 'Transferido',
      a.sedFreq ?? '',
      a.sedEvolucao ?? '',
      a.mapaoFreq ?? '',
      a.diariaFreq ?? '',
      a.faltasConsecutivas,
      `"${a.statusBuscaAtiva}"`,
      a.mediaGeralAtual ?? ''
    ]);

    const csv = '\uFEFF' + [headers.join(';'), ...linhas.map((l) => l.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clovis_inteligencia_${tabAtivaValida}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const imprimirPainel = () => {
    window.print();
  };

  if (carregando && alunosRaw.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <MascoteSaraState
            titulo="Consolidando Inteligência de Dados"
            mensagem="Cruzando coleções ativas do MongoDB Atlas (alunos, ocorrências, busca ativa, chamada diária, horários e PDCA)..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Cabeçalho Institucional + Ações de Exportação */}
      <div className="bg-[#1d2b4f] text-white rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            EE Prof. Clóvis de Lucca · Inteligência Educacional
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">
            Central de Inteligência e Dashboards
          </h1>
          <p className="text-xs text-blue-200 mt-1 tabular-nums">
            Base ativa: <strong>{alunosFiltrados.length}</strong> de {alunosNormalizados.length} estudantes ·{' '}
            {ocorrenciasUnificadas.length} ocorrências unificadas · Atualizado às {ultimaSincronizacao || '—'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => carregarDados(true)}
            disabled={carregando}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>
            <span>Sincronizar MongoDB</span>
          </button>

          <button
            type="button"
            onClick={exportarCsv}
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#1d2b4f] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
          >
            <i className="fa-solid fa-file-csv"></i>
            <span>Exportar CSV</span>
          </button>

          <button
            type="button"
            onClick={imprimirPainel}
            className="px-3.5 py-2 rounded-xl bg-white text-[#1d2b4f] hover:bg-slate-100 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
          >
            <i className="fa-solid fa-print"></i>
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Navegação dos 7 Dashboards em Ordem de Prioridade */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 print:hidden">
        {abasPermitidas.map((tab) => {
          const ativo = tabAtivaValida === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navegarParaAba(tab.id)}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                ativo
                  ? 'bg-[#1d2b4f] text-white border-[#1d2b4f] shadow-md'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-cyan-400 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  className={`text-[10px] font-extrabold uppercase tracking-wider ${
                    ativo ? 'text-cyan-300' : 'text-slate-400'
                  }`}
                >
                  Painel {tab.numero}
                </span>
                <i className={`${tab.icon} text-xs ${ativo ? 'text-cyan-300' : 'text-slate-400'}`}></i>
              </div>
              <div className="text-xs font-extrabold leading-tight">{tab.titulo}</div>
              <div className={`text-[10px] mt-1 leading-tight ${ativo ? 'text-blue-200' : 'text-slate-500'}`}>
                {tab.subtitulo}
              </div>
            </button>
          );
        })}
      </div>

      {/* Barra de Filtros Globais Persistentes */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 print:hidden">
        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Segmento</label>
          <select
            value={filtros.segmento}
            onChange={(e) => setFiltros((p) => ({ ...p, segmento: e.target.value, turma: 'TODAS' }))}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
          >
            <option value="TODOS">Todos os Segmentos</option>
            {opcoesFiltros.segmentos.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Turma</label>
          <select
            value={filtros.turma}
            onChange={(e) => setFiltros((p) => ({ ...p, turma: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
          >
            <option value="TODAS">Todas as Turmas</option>
            {opcoesFiltros.turmas.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tutor</label>
          <select
            value={filtros.tutor}
            onChange={(e) => setFiltros((p) => ({ ...p, tutor: e.target.value }))}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
          >
            <option value="TODOS">Todos os Tutores</option>
            {opcoesFiltros.tutores.map((tu) => (
              <option key={tu} value={tu}>{tu}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Status do Aluno</label>
          <select
            value={filtros.statusAluno}
            onChange={(e) => setFiltros((p) => ({ ...p, statusAluno: e.target.value as any }))}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
          >
            <option value="ativo">Somente Ativos (Padrão)</option>
            <option value="transferido">Somente Transferidos / Inativos</option>
            <option value="todos">Todos os Status</option>
          </select>
        </div>

        <div className="lg:col-span-2 flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Buscar Estudante</label>
            <input
              type="text"
              value={filtros.busca}
              onChange={(e) => setFiltros((p) => ({ ...p, busca: e.target.value }))}
              placeholder="Nome ou RA..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800"
            />
          </div>
          {(filtros.segmento !== 'TODOS' ||
            filtros.turma !== 'TODAS' ||
            filtros.tutor !== 'TODOS' ||
            filtros.statusAluno !== 'ativo' ||
            filtros.busca !== '') && (
            <button
              type="button"
              onClick={() =>
                setFiltros({ segmento: 'TODOS', turma: 'TODAS', tutor: 'TODOS', statusAluno: 'ativo', busca: '' })
              }
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-600 cursor-pointer shrink-0"
              title="Limpar filtros"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Renderização do Dashboard Selecionado */}
      {tabAtivaValida === 'dash-evasao' && (
        <Dashboard1Evasao
          alunos={alunosFiltrados}
          buscaAtivaDocs={buscaAtivaDocs}
          userRoleNorm={roleNorm}
          onAbrirBuscaAtiva={(al) => setAlunoBuscaAtivaModal(al)}
          onAbrirChamadaDiaria={() => setChamadaModalAberta(true)}
        />
      )}

      {tabAtivaValida === 'dash-academico' && (
        <Dashboard2Academico alunos={alunosFiltrados} />
      )}

      {tabAtivaValida === 'dash-pontualidade' && (
        <Dashboard3Pontualidade
          alunos={alunosFiltrados}
          ocorrenciasUnificadas={ocorrenciasUnificadas}
          onDataUpdated={() => carregarDados(true)}
        />
      )}

      {tabAtivaValida === 'dash-convivencia' && (
        <Dashboard4Convivencia
          alunos={alunosFiltrados}
          ocorrenciasUnificadas={ocorrenciasUnificadas}
          onDataUpdated={() => carregarDados(true)}
        />
      )}

      {tabAtivaValida === 'dash-pei' && (
        <Dashboard5PEI
          alunos={alunosFiltrados}
          professores={professores}
          capacidadesPEI={capacidadesPEI}
        />
      )}

      {tabAtivaValida === 'dash-docente' && (
        <Dashboard6Docente
          horarios={horarios}
          professores={professores}
          substituicoes={substituicoes}
          indisponibilidade={indisponibilidade}
        />
      )}

      {tabAtivaValida === 'dash-governanca' && (
        <Dashboard7Governanca
          alunos={alunosFiltrados}
          ocorrenciasUnificadas={ocorrenciasUnificadas}
          rotinaPdca={rotinaPdca}
          tarefas={tarefas}
          eventosAgenda={eventosAgenda}
          auditLogs={auditLogs}
        />
      )}

      {/* Modais Ações Rápidas (Payloads higienizados sem id/_id) */}
      <BuscaAtivaRapidaModal
        aluno={alunoBuscaAtivaModal}
        onClose={() => setAlunoBuscaAtivaModal(null)}
        onSaved={() => carregarDados(true)}
      />

      <ChamadaDiariaConsolidacaoModal
        isOpen={chamadaModalAberta}
        onClose={() => setChamadaModalAberta(false)}
        alunos={alunosNormalizados}
        frequenciaDiariaDocs={frequenciaDiariaDocs}
        turmaInicial={filtros.turma !== 'TODAS' ? filtros.turma : ''}
        onSaved={() => carregarDados(true)}
      />
    </div>
  );
}
