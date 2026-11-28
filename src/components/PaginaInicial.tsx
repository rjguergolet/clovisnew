import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, collection, getDocs, addDoc, updateDoc, doc } from '../lib/database';
import { obterUsuarioAtivoCompleto, normalizarCargo } from '../modules/authHelper';
import { normalizeTeacherName, isRegularTeachingClass, isAlunoAtivo } from '../utils';
import {
  parsePercentualSeguro,
  construirIndiceFrequenciaDiaria,
  normalizarRa,
  toIsoDate
} from '../modules/inteligenciaDataEngine';
import {
  verificarStatus,
  calcularStatusPrazoTarefa,
  getNormalizedFreqKey,
  getNivelKey,
  getCurrentUserEmail,
  getDefaultAntecedencia,
  NIVEIS_DEFINICOES,
  DIAS_SEMANA_OPCOES
} from './GestaoRotinaPDCA';
import CentralPendenciasPerfil from './CentralPendenciasPerfil';
import { obterAnoLetivoVigente, ehRegistroDoAnoVigente } from '../modules/anoLetivoHelper';

declare global {
  interface Window {
    obterIdentificacaoUsuarioCompleta?: () => any;
    ocorrenciasTopLevel?: any[];
    usuarioEAlvoDoRecado?: (recado: any, userOverride?: any) => boolean;
    darCienteRecado?: (recadoId: string) => Promise<any> | void;
    usuarioDeuCienteRecado?: (recado: any, userOverride?: any) => boolean;
    showToast?: (msg: string, type?: string, duration?: number) => void;
    realUserRole?: string;
    currentUserRole?: string;
    userRole?: string;
    cargoReal?: string;
    currentActiveTab?: string;
    currentUserEmail?: string;
    switchTab?: (tabName: string) => void;
    abrirFichaAluno?: (ra: string) => void;
    navegarEAbrirFichaAluno?: (ra: string) => void;
    allStudentsData?: any[];
    __clovisHomeCache?: any;
    usuariosCache?: any[];
    muralRecadosCache?: any[];
    rotinaEquipeCache?: any[];
    tasksCache?: any[];
    eventosCache?: any[];
    gradeCache?: any[];
    substituicoesCache?: any[];
    frequenciaDiariaCache?: any[];
    notificacoesTutorCache?: any[];
    verificarGatilhoAtrasosMes?: (alunoObj: any) => Promise<any>;
    emitirTermoCienciaFrequenciaGatilho?: (ra: string, totalMes?: number) => void;
  }
}

interface PaginaInicialProps {
  onNavigate?: (tabName: string) => void;
}

const DIAS_SEMANA_NOMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DIAS_SEMANA_LABELS: Record<string, string> = {
  segunda: 'Segunda-feira',
  terca: 'Terça-feira',
  quarta: 'Quarta-feira',
  quinta: 'Quinta-feira',
  sexta: 'Sexta-feira'
};

const PERIODOS_HORARIOS: Record<number, string> = {
  1: '07:00 - 07:50',
  2: '07:50 - 08:40',
  3: '08:50 - 09:40',
  4: '09:40 - 10:30',
  5: '10:30 - 11:20',
  6: '12:20 - 13:10',
  7: '13:10 - 14:00',
  8: '14:20 - 15:10',
  9: '15:10 - 16:00',
  10: '16:10 - 17:00',
  11: '17:00 - 17:50',
  12: '17:50 - 18:40',
  13: '19:40 - 20:30',
  14: '20:30 - 21:20'
};

const getInitialHomeCache = () => {
  if (typeof window === 'undefined') return null;
  if ((window as any).__clovisHomeCache) {
    return (window as any).__clovisHomeCache;
  }
  try {
    const raw = sessionStorage.getItem('clovis_home_cache');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        (window as any).__clovisHomeCache = parsed;
        return parsed;
      }
    }
  } catch (e) {}
  return null;
};

export default function PaginaInicial({ onNavigate }: PaginaInicialProps) {
  // Identificação do Usuário Logado
  const [currentUser, setCurrentUser] = useState(() => obterUsuarioAtivoCompleto());
  const [simulatedRole, setSimulatedRole] = useState<string>('');
  const [selectedTeacherName, setSelectedTeacherName] = useState<string>('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Modo de Visualização: 'foco' (rápido, operacional, urgente) vs 'completo' (Modo Analítico completo)
  const [modoVisualizacao, setModoVisualizacao] = useState<'foco' | 'completo'>(() => {
    try {
      const saved = localStorage.getItem('clovis_modo_visualizacao');
      if (saved === 'completo' || saved === 'analitico') return 'completo';
      return 'foco';
    } catch {
      return 'foco';
    }
  });
  const [modoCarregado, setModoCarregado] = useState<'nenhum' | 'foco' | 'completo'>(() => {
    const c = getInitialHomeCache();
    if (!c) return 'nenhum';
    return c.mode === 'analitico' || c.mode === 'completo' ? 'completo' : 'foco';
  });
  const [carregandoAnalitico, setCarregandoAnalitico] = useState(false);

  // Modais de Consulta e Detalhes (Tudo Clicável)
  const [modalAula, setModalAula] = useState<any | null>(null);
  const [modalEvento, setModalEvento] = useState<any | null>(null);
  const [modalOcorrencia, setModalOcorrencia] = useState<any | null>(null);
  const [modalAluno, setModalAluno] = useState<any | null>(null);
  const [modalDetalheKpi, setModalDetalheKpi] = useState<{ titulo: string; descricao: string; items?: any[] } | null>(null);

  // Estados dos Dados Globais com Hidratação Instantânea (Zero Latência)
  const initialCache = useMemo(() => getInitialHomeCache(), []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [revalidando, setRevalidando] = useState(false);
  const [usuarios, setUsuarios] = useState<any[]>(() => initialCache?.usuarios || (typeof window !== 'undefined' && Array.isArray((window as any).usuariosCache) ? (window as any).usuariosCache : []));
  const [recados, setRecados] = useState<any[]>(() => initialCache?.recados || (typeof window !== 'undefined' && Array.isArray((window as any).muralRecadosCache) ? (window as any).muralRecadosCache : []));
  const [tarefas, setTarefas] = useState<any[]>(() => {
    if (initialCache?.tarefas?.length) return initialCache.tarefas;
    if (typeof window !== 'undefined' && Array.isArray((window as any).rotinaEquipeCache) && (window as any).rotinaEquipeCache.length > 0) {
      return (window as any).rotinaEquipeCache;
    }
    if (typeof window !== 'undefined' && Array.isArray((window as any).tasksCache) && (window as any).tasksCache.length > 0) {
      return (window as any).tasksCache;
    }
    return [];
  });
  const [eventos, setEventos] = useState<any[]>(() => initialCache?.eventos || (typeof window !== 'undefined' && Array.isArray((window as any).eventosCache) ? (window as any).eventosCache : []));
  const [alunos, setAlunos] = useState<any[]>(() => {
    if (initialCache?.alunos?.length) return initialCache.alunos;
    if (typeof window !== 'undefined' && Array.isArray((window as any).allStudentsData) && (window as any).allStudentsData.length > 0) {
      return (window as any).allStudentsData;
    }
    try {
      const c = typeof window !== 'undefined' ? localStorage.getItem('alunos_cache') : null;
      if (c) {
        const parsed = JSON.parse(c);
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (typeof window !== 'undefined') (window as any).allStudentsData = parsed;
          return parsed;
        }
      }
    } catch (e) {}
    return [];
  });
  const [ocorrencias, setOcorrencias] = useState<any[]>(() => {
    if (initialCache?.ocorrencias?.length) return initialCache.ocorrencias;
    if (typeof window !== 'undefined' && Array.isArray((window as any).ocorrenciasTopLevel) && (window as any).ocorrenciasTopLevel.length > 0) {
      return (window as any).ocorrenciasTopLevel;
    }
    return [];
  });
  const [horarios, setHorarios] = useState<any[]>(() => initialCache?.horarios || (typeof window !== 'undefined' && Array.isArray((window as any).gradeCache) ? (window as any).gradeCache : []));
  const [substituicoes, setSubstituicoes] = useState<any[]>(() => {
    if (initialCache?.substituicoes?.length) return initialCache.substituicoes;
    if (typeof window !== 'undefined' && Array.isArray((window as any).substituicoesCache) && (window as any).substituicoesCache.length > 0) {
      return (window as any).substituicoesCache;
    }
    return [];
  });
  const [frequenciaDiaria, setFrequenciaDiaria] = useState<any[]>(() => {
    if (initialCache?.frequenciaDiaria?.length) return initialCache.frequenciaDiaria;
    if (typeof window !== 'undefined' && Array.isArray((window as any).frequenciaDiariaCache) && (window as any).frequenciaDiariaCache.length > 0) {
      return (window as any).frequenciaDiariaCache;
    }
    return [];
  });
  const [notificacoesTutor, setNotificacoesTutor] = useState<any[]>(() => {
    if (initialCache?.notificacoesTutor?.length) return initialCache.notificacoesTutor;
    if (typeof window !== 'undefined' && Array.isArray((window as any).notificacoesTutorCache) && (window as any).notificacoesTutorCache.length > 0) {
      return (window as any).notificacoesTutorCache;
    }
    return [];
  });
  const [obsAtendimentoNotif, setObsAtendimentoNotif] = useState<Record<string, string>>({});

  // Filtros do Painel Executivo PDCA na Página Inicial
  const [pdcaScopeView, setPdcaScopeView] = useState<'equipe' | 'minhas'>('equipe');
  const [pdcaStatusFilter, setPdcaStatusFilter] = useState<'pendentes' | 'urgentes' | 'todas' | 'concluidas'>('pendentes');
  const [pdcaTeamFilter, setPdcaTeamFilter] = useState<string>('TODOS');

  // Modais e Diálogos
  const [modalRecado, setModalRecado] = useState<any | null>(null);
  const [modalNovaTarefa, setModalNovaTarefa] = useState(false);
  const [novaTarefaTitulo, setNovaTarefaTitulo] = useState('');
  const [novaTarefaDesc, setNovaTarefaDesc] = useState('');
  const [novaTarefaFreq, setNovaTarefaFreq] = useState('Semanal');
  const [novaTarefaPrazo, setNovaTarefaPrazo] = useState('');
  const [novaTarefaAtribuir, setNovaTarefaAtribuir] = useState('');
  const [novaTarefaDiaSemana, setNovaTarefaDiaSemana] = useState<number>(5);
  const [novaTarefaDiaMes, setNovaTarefaDiaMes] = useState<number>(25);
  const [novaTarefaHorarioLimite, setNovaTarefaHorarioLimite] = useState('');
  const [novaTarefaAntecedencia, setNovaTarefaAntecedencia] = useState<number>(1);

  // Estados Específicos Secretaria - Registro de Atraso
  const [buscaAlunoAtraso, setBuscaAlunoAtraso] = useState('');
  const [alunoSelecionadoAtraso, setAlunoSelecionadoAtraso] = useState<any | null>(null);
  const [horarioAtraso, setHorarioAtraso] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [motivoAtraso, setMotivoAtraso] = useState('Transporte / Trânsito');
  const [justificadoAtraso, setJustificadoAtraso] = useState(false);
  const [obsAtraso, setObsAtraso] = useState('');
  const [salvandoAtraso, setSalvandoAtraso] = useState(false);
  const [comprovanteAtraso, setComprovanteAtraso] = useState<any | null>(null);

  // Estados Específicos Secretaria - Emissão de Documentos
  const [tipoDocumento, setTipoDocumento] = useState<'matricula' | 'frequencia' | 'transferencia' | 'comparecimento'>('matricula');
  const [buscaAlunoDoc, setBuscaAlunoDoc] = useState('');
  const [alunoSelecionadoDoc, setAlunoSelecionadoDoc] = useState<any | null>(null);
  const [nomeResponsavelDoc, setNomeResponsavelDoc] = useState('');
  const [periodoDoc, setPeriodoDoc] = useState('07:30 às 11:30');
  const [documentoPronto, setDocumentoPronto] = useState<any | null>(null);

  // Estados Específicos PAAC / CGPG / Direção - Ciência do Mural
  const [recadoSelecionadoMonitor, setRecadoSelecionadoMonitor] = useState<string>('');
  const [filtroProfPendentes, setFiltroProfPendentes] = useState('');

  // Filtro de Status de Matrícula para Busca Ativa (Regra: por padrão NUNCA exibe alunos inativos a menos que filtrado)
  const [filtroStatusBuscaAtiva, setFiltroStatusBuscaAtiva] = useState<'ATIVOS' | 'TODOS' | 'INATIVOS'>('ATIVOS');

  // Logotipo Oficial da Escola / Favicon Personalizado
  const [customLogoUrl, setCustomLogoUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('clovis_custom_logo') || '/logo-clovis.svg';
    }
    return '/logo-clovis.svg';
  });

  const [anoLetivo, setAnoLetivo] = useState<string>(() => String(obterAnoLetivoVigente()));

  // Sincronização do Usuário Ativo, Ano Letivo e Logotipo da Escola
  useEffect(() => {
    const syncUser = () => {
      const u = (typeof window.obterIdentificacaoUsuarioCompleta === 'function')
        ? window.obterIdentificacaoUsuarioCompleta()
        : obterUsuarioAtivoCompleto();
      setCurrentUser(u);
    };

    const handleLogoChanged = (e: any) => {
      const newLogo = e?.detail?.logoUrl || localStorage.getItem('clovis_custom_logo') || '/logo-clovis.svg';
      setCustomLogoUrl(newLogo);
    };

    const handleAnoChanged = (e: any) => {
      const novo = e?.detail ? String(e.detail) : String(obterAnoLetivoVigente());
      setAnoLetivo(novo);
    };

    syncUser();
    window.addEventListener('taborrolechange', syncUser);
    window.addEventListener('storage', syncUser);
    window.addEventListener('storage', handleLogoChanged);
    window.addEventListener('clovis_logo_changed', handleLogoChanged);
    window.addEventListener('clovis_ano_letivo_changed', handleAnoChanged);
    return () => {
      window.removeEventListener('taborrolechange', syncUser);
      window.removeEventListener('storage', syncUser);
      window.removeEventListener('storage', handleLogoChanged);
      window.removeEventListener('clovis_logo_changed', handleLogoChanged);
      window.removeEventListener('clovis_ano_letivo_changed', handleAnoChanged);
    };
  }, []);

  // Verificação estrita se o usuário real é Diretor
  const isRealDirector = useMemo(() => {
    const rawRole = currentUser?.cargo || (typeof window !== 'undefined' ? (window.realUserRole || window.currentUserRole) : '');
    const norm = normalizarCargo(rawRole);
    if (norm === 'DIRETOR' || norm === 'SENIOR_GOE') return true;
    const email = String(currentUser?.email || '').toLowerCase();
    const nome = String(currentUser?.nome || '').toUpperCase();
    if (email.includes('guergolet') || nome.includes('GUERGOLET') || nome.includes('DIRETOR')) return true;
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('usuarioLogado');
      if (saved && (saved.includes('DIRETOR') || saved.includes('SENIOR_GOE') || saved.includes('SÊNIOR') || saved.includes('EXTENDIDO') || saved.toLowerCase().includes('guergolet'))) return true;
      const cargoLs = localStorage.getItem('usuario_cargo')?.toUpperCase() || '';
      if (cargoLs.includes('DIRETOR') || cargoLs.includes('SENIOR') || cargoLs.includes('SÊNIOR') || /\bGOE\b/.test(cargoLs) || cargoLs.includes('EXTENDIDO')) return true;
    }
    return false;
  }, [currentUser]);

  // Helper inteligente para correspondência e unificação de funcionários (evita repetições como Claudia / Cláudia)
  const matchUsuarioComProfessor = useCallback((profNome: string, uList: any[]) => {
    const pNorm = normalizeTeacherName(profNome);
    if (!pNorm) return null;

    // 1. Busca exata por nome normalizado (já sem acentos)
    const exact = uList.find(u => normalizeTeacherName(u.nome) === pNorm);
    if (exact) return exact;

    // 2. Busca por correspondência completa de tokens
    const pTokens = pNorm.split(' ').filter(Boolean);
    const fullTokenMatch = uList.find(u => {
      const uNorm = normalizeTeacherName(u.nome);
      if (!uNorm) return false;
      const uTokens = uNorm.split(' ').filter(Boolean);
      return pTokens.every(pt => uTokens.includes(pt)) || uTokens.every(ut => pTokens.includes(ut));
    });
    if (fullTokenMatch) return fullTokenMatch;

    // 3. Busca por prefixo/início idêntico de nome
    const prefixMatch = uList.find(u => {
      const uNorm = normalizeTeacherName(u.nome);
      if (!uNorm) return false;
      return uNorm.startsWith(pNorm + ' ') || pNorm.startsWith(uNorm + ' ');
    });
    if (prefixMatch) return prefixMatch;

    // 4. Busca por primeiro nome idêntico (ex: "CLAUDIA", "CLÁUDIA", "CLAUDIA SILVA")
    if (pTokens[0] && pTokens[0].length >= 3) {
      const firstNameMatches = uList.filter(u => {
        const uNorm = normalizeTeacherName(u.nome);
        if (!uNorm) return false;
        const uTokens = uNorm.split(' ').filter(Boolean);
        return uTokens[0] === pTokens[0] && (uTokens.length === 1 || pTokens.length === 1 || uTokens[0] === 'claudia');
      });
      if (firstNameMatches.length >= 1) {
        return firstNameMatches.sort((a, b) => String(b.nome || '').length - String(a.nome || '').length)[0];
      }
    }

    return null;
  }, []);

  // Lista unificada e estritamente desduplicada de todos os funcionários da escola
  const listaFuncionariosCompleta = useMemo(() => {
    const seenNames = new Set<string>();
    const seenEmails = new Set<string>();
    const seenIds = new Set<string>();
    const list: any[] = [];

    usuarios.forEach(u => {
      if (!u || !u.nome) return;
      const nNorm = normalizeTeacherName(u.nome);
      const emailNorm = String(u.email || '').toLowerCase().trim();
      const idKey = String(u.id || u._id || '');

      if (idKey && seenIds.has(idKey)) return;
      if (emailNorm && seenEmails.has(emailNorm)) return;

      // Verifica se já existe funcionário equivalente por nome normalizado ou primeiro nome/prefixo (ex: "Claudia" e "Cláudia")
      const existing = (nNorm && seenNames.has(nNorm))
        ? list.find(item => normalizeTeacherName(item.nome) === nNorm)
        : matchUsuarioComProfessor(u.nome, list);

      if (existing) {
        const candNome = String(u.nome || '').trim();
        const existNome = String(existing.nome || '').trim();
        const candHasAccent = /[À-ú]/.test(candNome);
        const existHasAccent = /[À-ú]/.test(existNome);

        if (
          candNome.length > existNome.length ||
          (candNome.length === existNome.length && candHasAccent && !existHasAccent)
        ) {
          existing.nome = candNome;
        }
        if (!existing.email && u.email) existing.email = u.email;
        if (!existing.disciplina && u.disciplina) existing.disciplina = u.disciplina;
        if ((!existing.cargo || existing.cargo === 'PROFESSOR') && (u.cargo || u.nivel)) {
          existing.cargo = u.cargo || u.nivel;
        }
        if (idKey) seenIds.add(idKey);
        if (nNorm) seenNames.add(nNorm);
        if (emailNorm) seenEmails.add(emailNorm);
        return;
      }

      if (idKey) seenIds.add(idKey);
      if (nNorm) seenNames.add(nNorm);
      if (emailNorm) seenEmails.add(emailNorm);

      list.push({ ...u, nome: String(u.nome).trim() });
    });

    // 2. Mapeia professores da grade horária associando aos usuários existentes
    horarios.forEach(h => {
      const p = (h.professor || '').trim();
      if (!p) return;

      const matchedUser = matchUsuarioComProfessor(p, list);
      if (matchedUser) {
        if (!matchedUser.disciplina && h.disciplina) {
          matchedUser.disciplina = h.disciplina;
        }
      } else {
        const pNorm = normalizeTeacherName(p);
        if (pNorm && !seenNames.has(pNorm)) {
          seenNames.add(pNorm);
          list.push({
            id: `h-prof-${pNorm}`,
            nome: p,
            cargo: 'PROFESSOR',
            email: '',
            disciplina: h.disciplina || ''
          });
        }
      }
    });

    return list.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  }, [usuarios, horarios, matchUsuarioComProfessor]);

  // Funcionário efetivo em visualização (caso o Diretor selecione um funcionário individual)
  const effectiveUser = useMemo(() => {
    if (selectedEmployeeId) {
      const found = listaFuncionariosCompleta.find(u => u.id === selectedEmployeeId || u.email === selectedEmployeeId || u.nome === selectedEmployeeId);
      if (found) {
        return {
          nome: found.nome,
          email: found.email || '',
          cargo: found.cargo || found.nivel || 'PROFESSOR',
          disciplina: found.disciplina || ''
        };
      }
    }
    return currentUser;
  }, [selectedEmployeeId, listaFuncionariosCompleta, currentUser]);

  // Perfil Efetivo (Simulado ou Real)
  const activeRole = useMemo(() => {
    if (simulatedRole) return normalizarCargo(simulatedRole);
    return normalizarCargo(effectiveUser?.cargo || 'PROFESSOR');
  }, [simulatedRole, effectiveUser]);

  const roleNorm = activeRole.toUpperCase().replace(/-/g, '_');
  const isProfessor = roleNorm === 'PROFESSOR';
  const isPAAC = roleNorm === 'PAAC' || roleNorm === 'PROFESSOR_PAAC';
  const isCoord = roleNorm === 'CGPG' || roleNorm === 'CGPCG';
  const isDiretorRole = roleNorm === 'DIRETOR' || roleNorm === 'SENIOR_GOE';
  const isViceRole = roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE');
  const isDirecao = isDiretorRole || isViceRole;
  const isPdcaLeadership = isDirecao || isCoord;
  const isSecretaria = roleNorm === 'SECRETARIA';

  // Carregamento Ultra-Rápido em 1 Requisição via /api/home/bootstrap (Modo Foco vs Modo Analítico)
  const carregarDadosCompletos = useCallback(async (force = false, targetMode?: 'foco' | 'completo') => {
    const modoSolicitado: 'foco' | 'completo' = targetMode || modoVisualizacao;
    const apiMode = modoSolicitado === 'completo' ? 'analitico' : 'foco';
    const cached = typeof window !== 'undefined' ? (window as any).__clovisHomeCache : null;
    const now = Date.now();
    const cacheCobreModo = cached && (
      modoSolicitado === 'foco' ||
      cached.mode === 'analitico' ||
      cached.mode === 'completo'
    );
    const isFresh = Boolean(cached && cached.timestamp && (now - cached.timestamp < 120_000) && cacheCobreModo);

    if (isFresh && !force) {
      setLoading(false);
      setCarregandoAnalitico(false);
      return;
    }

    const temDadosExibicao = Boolean(usuarios.length > 0 || recados.length > 0 || cached);
    if (!temDadosExibicao) {
      setLoading(true);
    } else if (modoSolicitado === 'completo' && modoCarregado !== 'completo') {
      setCarregandoAnalitico(true);
    } else {
      setRevalidando(true);
    }

    try {
      const anoVig = obterAnoLetivoVigente();
      const resp = await fetch(`/api/home/bootstrap?mode=${apiMode}&ano=${anoVig}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} no bootstrap da tela inicial`);
      }
      const data = await resp.json();

      const listaU: any[] = Array.isArray(data.usuarios) ? data.usuarios : [];
      const listaR: any[] = Array.isArray(data.recados) ? data.recados : [];
      const listaT: any[] = Array.isArray(data.tarefas) ? data.tarefas : [];
      const listaE: any[] = Array.isArray(data.eventos) ? data.eventos : [];
      const listaH: any[] = Array.isArray(data.horarios) ? data.horarios : [];
      const listaSub: any[] = Array.isArray(data.substituicoes) ? data.substituicoes : [];
      const listaFreq: any[] = Array.isArray(data.frequenciaDiaria) ? data.frequenciaDiaria : [];
      const listaNT: any[] = Array.isArray(data.notificacoesTutor) ? data.notificacoesTutor : [];
      const listaA: any[] = Array.isArray(data.alunos) ? data.alunos : [];
      const listaO: any[] = Array.isArray(data.ocorrencias) ? data.ocorrencias : [];

      setUsuarios(listaU);
      setRecados(listaR);
      setTarefas(listaT);
      setEventos(listaE);
      setHorarios(listaH);
      setSubstituicoes(listaSub);
      setFrequenciaDiaria(listaFreq);
      setNotificacoesTutor(listaNT);
      setAlunos(listaA);
      setOcorrencias(listaO);
      setModoCarregado(modoSolicitado);

      if (typeof window !== 'undefined') {
        (window as any).usuariosCache = listaU;
        (window as any).muralRecadosCache = listaR;
        (window as any).rotinaEquipeCache = listaT;
        (window as any).tasksCache = listaT;
        (window as any).eventosCache = listaE;
        (window as any).gradeCache = listaH;
        (window as any).substituicoesCache = listaSub;
        (window as any).frequenciaDiariaCache = listaFreq;
        (window as any).notificacoesTutorCache = listaNT;

        // Só atualiza ocorrenciasTopLevel global se vier completo ou se ainda não existir em memória
        if (apiMode === 'analitico' || !Array.isArray((window as any).ocorrenciasTopLevel) || (window as any).ocorrenciasTopLevel.length === 0) {
          (window as any).ocorrenciasTopLevel = listaO;
        }
        // Só preenche allStudentsData se ainda estiver vazio (para não sobrescrever prontuários completos carregados em outras abas)
        if (!Array.isArray((window as any).allStudentsData) || (window as any).allStudentsData.length === 0) {
          (window as any).allStudentsData = listaA;
        }

        const newCache = {
          mode: apiMode,
          usuarios: listaU,
          recados: listaR,
          tarefas: listaT,
          eventos: listaE,
          ocorrencias: listaO,
          horarios: listaH,
          substituicoes: listaSub,
          frequenciaDiaria: listaFreq,
          notificacoesTutor: listaNT,
          alunos: listaA,
          timestamp: Date.now()
        };
        (window as any).__clovisHomeCache = newCache;
        try {
          sessionStorage.setItem('clovis_home_cache', JSON.stringify({
            mode: apiMode,
            usuarios: listaU,
            recados: listaR,
            tarefas: listaT,
            eventos: listaE,
            ocorrencias: apiMode === 'foco' ? listaO : listaO.slice(0, 300),
            horarios: listaH,
            substituicoes: listaSub,
            notificacoesTutor: listaNT,
            alunos: listaA,
            timestamp: Date.now()
          }));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[PaginaInicial] Fallback para consultas individuais:', err);
      try {
        const [uSnap, rSnap, tSnap, eSnap, hSnap, subSnap, ntSnap] = await Promise.all([
          getDocs(collection(db, 'usuarios')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'mural_recados')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'rotina_equipe')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'eventos')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'horarios')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'substituicoes_diarias')).catch(() => ({ docs: [], forEach: () => {} })),
          getDocs(collection(db, 'notificacoes_tutor')).catch(() => ({ docs: [], forEach: () => {} }))
        ]);
        const anoNumVig = obterAnoLetivoVigente();
        const toArr = (snap: any, filterYear = false) => {
          const out: any[] = [];
          snap.forEach((d: any) => {
            const it = { id: d.id, ...d.data() };
            if (!filterYear || ehRegistroDoAnoVigente(it, anoNumVig)) out.push(it);
          });
          return out;
        };
        setUsuarios(toArr(uSnap));
        setRecados(toArr(rSnap, true));
        setTarefas(toArr(tSnap, true));
        setEventos(toArr(eSnap, true));
        setHorarios(toArr(hSnap));
        setSubstituicoes(toArr(subSnap, true));
        setNotificacoesTutor(toArr(ntSnap, true));
      } catch {}
    } finally {
      setLoading(false);
      setRevalidando(false);
      setCarregandoAnalitico(false);
    }
  }, [modoVisualizacao, modoCarregado, usuarios.length, recados.length]);

  const toggleModoVisualizacao = useCallback((novoModo: 'foco' | 'completo') => {
    setModoVisualizacao(novoModo);
    try {
      localStorage.setItem('clovis_modo_visualizacao', novoModo);
    } catch {}
    if (novoModo === 'completo' && modoCarregado !== 'completo') {
      carregarDadosCompletos(true, 'completo');
    }
  }, [modoCarregado, carregarDadosCompletos]);

  useEffect(() => {
    carregarDadosCompletos(false, modoVisualizacao);
  }, [anoLetivo]);

  // Lista de Professores Cadastrados (estritamente desduplicada a partir da lista unificada)
  const listaDocentes = useMemo(() => {
    const seen = new Set<string>();
    const profs: any[] = [];
    listaFuncionariosCompleta.forEach(u => {
      const c = String(u.cargo || u.nivel || '').toUpperCase();
      if (c === 'PROFESSOR' || c === 'PAAC' || c === 'DOCENTE' || c.includes('PROF')) {
        const key = normalizeTeacherName(u.nome);
        const alreadyMatched = matchUsuarioComProfessor(u.nome, profs);
        if (key && !seen.has(key) && !alreadyMatched) {
          seen.add(key);
          profs.push(u);
        }
      }
    });
    if (profs.length > 0) return profs;
    return listaFuncionariosCompleta;
  }, [listaFuncionariosCompleta, matchUsuarioComProfessor]);

  // Definir Professor Selecionado Atual
  const effectiveTeacher = useMemo(() => {
    if (selectedTeacherName) {
      return listaDocentes.find(d => normalizeTeacherName(d.nome) === normalizeTeacherName(selectedTeacherName)) || { nome: selectedTeacherName };
    }
    // Tentar bater com o usuário efetivo em exibição
    const match = listaDocentes.find(d => {
      const nLogado = normalizeTeacherName(effectiveUser?.nome);
      const nDoc = normalizeTeacherName(d.nome);
      return nLogado.includes(nDoc) || nDoc.includes(nLogado);
    });
    return match || listaDocentes[0] || { nome: effectiveUser?.nome || 'Professor(a)' };
  }, [selectedTeacherName, listaDocentes, effectiveUser]);

  // Horários do Professor Selecionado
  const horariosDoProfessor = useMemo(() => {
    if (!effectiveTeacher?.nome) return [];
    const tNome = normalizeTeacherName(effectiveTeacher.nome);
    return horarios.filter(h => {
      const hProf = normalizeTeacherName(h.professor);
      return hProf && (tNome.includes(hProf) || hProf.includes(tNome));
    });
  }, [horarios, effectiveTeacher]);

  // Contagem de aulas do docente: conta APENAS as ativas (isRegularTeachingClass === true)
  const aulasSemanaisAtivas = useMemo(() => {
    return horariosDoProfessor.filter(h => isRegularTeachingClass(h));
  }, [horariosDoProfessor]);

  // Horários do Dia de Hoje do Professor (mostra ativas e inativas na agenda do dia)
  const diaSemanaHoje = useMemo(() => {
    const d = new Date().getDay();
    const map = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const dia = map[d];
    return ['segunda', 'terca', 'quarta', 'quinta', 'sexta'].includes(dia) ? dia : 'segunda';
  }, []);

  const aulasHoje = useMemo(() => {
    return horariosDoProfessor
      .filter(h => String(h.dia || '').toLowerCase() === diaSemanaHoje)
      .sort((a, b) => Number(a.periodoId || 0) - Number(b.periodoId || 0));
  }, [horariosDoProfessor, diaSemanaHoje]);

  const aulasHojeAtivas = useMemo(() => {
    return aulasHoje.filter(h => isRegularTeachingClass(h));
  }, [aulasHoje]);

  // Substituições PEI do Dia de Hoje
  const substituicoesHoje = useMemo(() => {
    const dt = new Date();
    const hojeStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return substituicoes.filter(s => {
      const d = toIsoDate(s.data);
      return !d || d === hojeStr;
    });
  }, [substituicoes]);

  // Substituições designadas especificamente para o docente em visualização hoje
  const substituicoesParaMimHoje = useMemo(() => {
    const alvoNome = normalizeTeacherName(effectiveTeacher?.nome || effectiveUser?.nome || '');
    if (!alvoNome) return [];
    return substituicoesHoje.filter(s => {
      const subNorm = normalizeTeacherName(s.professorSubstituto);
      return subNorm && (subNorm === alvoNome || subNorm.includes(alvoNome) || alvoNome.includes(subNorm));
    }).sort((a, b) => Number(a.periodoId || a.aulaNumero || 0) - Number(b.periodoId || b.aulaNumero || 0));
  }, [substituicoesHoje, effectiveTeacher, effectiveUser]);

  // Substituições ainda sem substituto definido hoje
  const substituicoesPendentesHoje = useMemo(() => {
    return substituicoesHoje.filter(s => {
      const sub = String(s.professorSubstituto || '').trim().toUpperCase();
      return !sub || sub === 'A DEFINIR' || sub === '-' || sub === 'SEM SUBSTITUTO' || sub === 'PENDENTE';
    });
  }, [substituicoesHoje]);

  // Índice real de frequência diária e cálculos sem dados mockados
  const indiceFrequenciaDiaria = useMemo(() => {
    return construirIndiceFrequenciaDiaria(frequenciaDiaria, alunos);
  }, [frequenciaDiaria, alunos]);

  const getRealStudentFreq = useCallback((aluno: any): number | null => {
    if (!aluno) return null;
    const direct = parsePercentualSeguro(
      aluno.presenca_anual ??
      aluno.presenca ??
      aluno.frequencia ??
      aluno.freq_sed ??
      aluno.sed_frequencia ??
      aluno.frequenciaAnual
    );
    if (direct !== null) return direct;

    const fn = aluno.fechamento_notas || aluno.fechamentos || aluno.notas;
    if (fn && typeof fn === 'object') {
      for (const bim of ['4B', '3B', '2B', '1B']) {
        const bFreq = parsePercentualSeguro(fn[bim]?.frequencia);
        if (bFreq !== null) return bFreq;
      }
    }

    if (typeof aluno._fechamentoFreq === 'number' && !isNaN(aluno._fechamentoFreq)) {
      return aluno._fechamentoFreq;
    }

    const daily = indiceFrequenciaDiaria.get(normalizarRa(aluno.ra));
    if (daily && daily.percentual !== null) return daily.percentual;

    return null;
  }, [indiceFrequenciaDiaria]);

  const getFaltasConsecutivas = useCallback((aluno: any): number => {
    if (!aluno) return 0;
    const daily = indiceFrequenciaDiaria.get(normalizarRa(aluno.ra));
    if (daily && ((daily.totalDiasAplicaveis ?? daily.totalDias) > 0)) {
      return daily.faltasConsecutivas || 0;
    }
    const fallbackVal = Number(aluno.faltasConsecutivas ?? aluno.dias_seguidos_faltando ?? aluno.faltas_consecutivas ?? 0) || 0;
    if (fallbackVal <= 0) return 0;
    const dataAuditIso = toIsoDate(
      aluno.ultima_auditoria_sed ||
      aluno.data_auditoria_sed ||
      aluno.dataAuditoriaFreq ||
      aluno.dataAtualizacaoFreq ||
      aluno.atualizado_em ||
      aluno.updatedAt
    );
    if (dataAuditIso) {
      const corte = new Date();
      corte.setHours(0, 0, 0, 0);
      corte.setDate(corte.getDate() - 30);
      const limite30dIso = `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, '0')}-${String(corte.getDate()).padStart(2, '0')}`;
      if (dataAuditIso < limite30dIso) return 0;
    }
    return fallbackVal;
  }, [indiceFrequenciaDiaria]);

  const alunosAtivos = useMemo(() => {
    return alunos.filter(isAlunoAtivo);
  }, [alunos]);

  const presencaGeralStats = useMemo(() => {
    let soma = 0;
    let totalAvaliados = 0;
    let emRisco = 0;
    alunosAtivos.forEach(a => {
      const f = getRealStudentFreq(a);
      const fc = getFaltasConsecutivas(a);
      if (f !== null) {
        soma += f;
        totalAvaliados++;
      }
      if ((f !== null && f < 75) || fc >= 3) {
        emRisco++;
      }
    });
    return {
      media: totalAvaliados > 0 ? Math.round((soma / totalAvaliados) * 10) / 10 : null,
      totalAvaliados,
      emRisco
    };
  }, [alunosAtivos, getRealStudentFreq, getFaltasConsecutivas]);

  const chamadaHojeStats = useMemo(() => {
    const dt = new Date();
    const hojeIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    let presentes = 0;
    let faltas = 0;
    let justificadas = 0;
    const turmasSet = new Set<string>();
    const raStatus = new Map<string, string>();

    const registrarItem = (raKey: string, stRaw: any, turma?: string) => {
      const s = String(typeof stRaw === 'string' ? stRaw : stRaw?.status || '').trim().toUpperCase();
      if (!s) return;
      if (turma) turmasSet.add(turma);
      raStatus.set(normalizarRa(raKey) || raKey, s);
    };

    frequenciaDiaria.forEach((docItem: any) => {
      if (!docItem || typeof docItem !== 'object') return;
      const docIso = toIsoDate(docItem.data || docItem.dataChamada || docItem.id);
      if (docIso === hojeIso && docItem.registros && typeof docItem.registros === 'object' && !Array.isArray(docItem.registros)) {
        Object.entries(docItem.registros).forEach(([raKey, reg]: [string, any]) => {
          registrarItem(raKey, reg, docItem.turma || reg?.turma);
        });
      }
      if (docItem.datas && typeof docItem.datas === 'object' && docItem.datas[hojeIso]) {
        Object.entries(docItem.datas[hojeIso]).forEach(([raKey, val]: [string, any]) => {
          registrarItem(raKey, val, docItem.turma);
        });
      }
      if (docItem.ra && docIso === hojeIso && docItem.status) {
        registrarItem(docItem.ra, docItem.status, docItem.turma);
      }
    });

    raStatus.forEach(s => {
      if (s === 'P' || s === 'PRESENTE' || s === 'ATRASADO' || s === 'A') presentes++;
      else if (s === 'F' || s === 'FALTA' || s === 'AUSENTE') faltas++;
      else if (s === 'J' || s === 'JUSTIFICADA' || s === 'LICENCA' || s === 'LICENÇA' || s === 'ATESTADO') justificadas++;
    });

    return {
      registrosHoje: raStatus.size,
      presentes,
      faltas,
      justificadas,
      turmasComChamada: turmasSet.size
    };
  }, [frequenciaDiaria]);

  // Alunos Tutorados do Professor (Apenas estudantes ativos por padrão, com métricas reais)
  const tutoradosDoProfessor = useMemo(() => {
    if (!effectiveTeacher?.nome) return [];
    const tNome = normalizeTeacherName(effectiveTeacher.nome);
    return alunos
      .filter(a => {
        if (!isAlunoAtivo(a)) return false;
        const tutorA = normalizeTeacherName(a.tutor || a.tutorNome || a.nomeTutor || a.tutor_2026);
        return tutorA && (tNome.includes(tutorA) || tutorA.includes(tNome));
      })
      .map(a => ({
        ...a,
        _freqNum: getRealStudentFreq(a),
        _faltasConsecutivas: getFaltasConsecutivas(a)
      }));
  }, [alunos, effectiveTeacher, getRealStudentFreq, getFaltasConsecutivas]);

  // Mensagens do Mural Direcionadas ao Usuário/Perfil
  const recadosDirecionados = useMemo(() => {
    return recados.filter(r => {
      if (r.arquivado) return false;
      if (typeof window.usuarioEAlvoDoRecado === 'function') {
        return window.usuarioEAlvoDoRecado(r, { ...effectiveUser, cargo: activeRole });
      }
      return true;
    });
  }, [recados, effectiveUser, activeRole]);

  const canAccessRotinaPDCA = isPdcaLeadership || isPAAC;

  // Motor PDCA Unificado (100% sincronizado com GestaoRotinaPDCA.jsx)
  const tarefasEnriquecidas = useMemo(() => {
    if (!canAccessRotinaPDCA) return [];

    const hierarquiaVisibilidade: Record<string, string[]> = {
      DIRETOR: ['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
      SENIOR_GOE: ['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
      VICE_DIRETOR: ['VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
      CGPG: ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
      CGPCG: ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
      PAAC: ['PAAC', 'TODA A EQUIPE'],
      PROFESSOR_PAAC: ['PAAC', 'TODA A EQUIPE']
    };

    const allowedTargets = hierarquiaVisibilidade[roleNorm] || [roleNorm, 'TODA A EQUIPE'];
    const nomeUpper = String(effectiveUser?.nome || '').toUpperCase().trim();
    const emailLower = String(effectiveUser?.email || '').toLowerCase().trim();

    const urgencyRank = (st: any) => {
      if (!st || st.concluida) return 99;
      if (st.atrasada) return 0;
      if (st.nivelUrgencia === 'VENCE_HOJE') return 1;
      if (st.emAlertaAmarelo) return 2;
      if (st.diasRestantes !== null && st.diasRestantes !== undefined) return 3;
      return 4;
    };

    return tarefas
      .filter(t => {
        if (!t) return false;
        const atribRaw = String(t.atribuidoA || t.atribuirA || t.responsavel || 'TODA A EQUIPE').trim();
        const atribUpper = atribRaw.toUpperCase();
        const atribLower = atribRaw.toLowerCase();

        const isAllTeam = atribUpper === 'TODA A EQUIPE' || atribUpper === 'TODOS' || atribUpper === 'GERAL';
        const isAllowedRole = allowedTargets.some(al => atribUpper.includes(al) || al.includes(atribUpper));
        const isDirectName = Boolean(nomeUpper && (atribUpper.includes(nomeUpper) || nomeUpper.includes(atribUpper)));
        const isDirectEmail = Boolean(emailLower && atribLower.includes(emailLower));

        return isAllTeam || isAllowedRole || isDirectName || isDirectEmail || isDiretorRole;
      })
      .map(t => {
        const statusInfo = calcularStatusPrazoTarefa(t);
        const freqKey = getNormalizedFreqKey(t);
        const nivelKey = getNivelKey(t, usuarios);
        const atribRaw = String(t.atribuidoA || t.atribuirA || t.responsavel || 'TODA A EQUIPE').trim();
        const atribUpper = atribRaw.toUpperCase();
        const atribLower = atribRaw.toLowerCase();

        const isMine =
          atribUpper === 'TODA A EQUIPE' ||
          atribUpper === 'TODOS' ||
          atribUpper === 'GERAL' ||
          atribUpper.includes(roleNorm) ||
          (roleNorm === 'CGPG' && atribUpper.includes('CGPCG')) ||
          (roleNorm === 'PAAC' && atribUpper.includes('PAAC')) ||
          (isViceRole && atribUpper.includes('VICE')) ||
          Boolean(nomeUpper && (atribUpper.includes(nomeUpper) || nomeUpper.includes(atribUpper))) ||
          Boolean(emailLower && atribLower.includes(emailLower));

        return {
          ...t,
          _statusInfo: statusInfo,
          _freqKey: freqKey,
          _nivelKey: nivelKey,
          _isMine: isMine
        };
      })
      .sort((a, b) => {
        const rA = urgencyRank(a._statusInfo);
        const rB = urgencyRank(b._statusInfo);
        if (rA !== rB) return rA - rB;
        const dA = a._statusInfo?.diasRestantes ?? 999;
        const dB = b._statusInfo?.diasRestantes ?? 999;
        if (dA !== dB) return dA - dB;
        return String(a.titulo || a.descricao || '').localeCompare(String(b.titulo || b.descricao || ''), 'pt-BR');
      });
  }, [tarefas, canAccessRotinaPDCA, roleNorm, isDiretorRole, isViceRole, effectiveUser, usuarios]);

  // Tarefas pendentes direcionadas ao perfil atual (com renovação cíclica real via verificarStatus)
  const tarefasFiltradas = useMemo(() => {
    return tarefasEnriquecidas.filter(t => t._isMine && !t._statusInfo.concluida);
  }, [tarefasEnriquecidas]);

  // Tarefas urgentes (Atrasadas + Prestes a vencer / Vencem hoje em alerta amarelo)
  const tarefasUrgentes = useMemo(() => {
    return tarefasFiltradas.filter(t => t._statusInfo.atrasada || t._statusInfo.emAlertaAmarelo);
  }, [tarefasFiltradas]);

  // Estatísticas PDCA para Painel Executivo (Direção, Vice-Direção e CGPG)
  const pdcaStats = useMemo(() => {
    const calcBucket = (list: any[]) => {
      const total = list.length;
      const concluidas = list.filter(t => t._statusInfo.concluida).length;
      const atrasadas = list.filter(t => !t._statusInfo.concluida && t._statusInfo.atrasada).length;
      const emAlerta = list.filter(t => !t._statusInfo.concluida && !t._statusInfo.atrasada && t._statusInfo.emAlertaAmarelo).length;
      const pendentes = total - concluidas;
      const taxaConclusao = total > 0 ? Math.round((concluidas / total) * 100) : 0;
      return { total, concluidas, pendentes, atrasadas, emAlerta, taxaConclusao };
    };

    const equipe = calcBucket(tarefasEnriquecidas);
    const minhas = calcBucket(tarefasEnriquecidas.filter(t => t._isMine));

    const porEquipe = NIVEIS_DEFINICOES.map((nivel: any) => {
      const bucketTasks = tarefasEnriquecidas.filter(t => t._nivelKey === nivel.key);
      return {
        ...nivel,
        ...calcBucket(bucketTasks)
      };
    }).filter((n: any) => n.total > 0);

    return { equipe, minhas, porEquipe };
  }, [tarefasEnriquecidas]);

  const tarefasPainelExecutivo = useMemo(() => {
    let base = pdcaScopeView === 'minhas'
      ? tarefasEnriquecidas.filter(t => t._isMine)
      : tarefasEnriquecidas;

    if (pdcaTeamFilter !== 'TODOS') {
      base = base.filter(t => t._nivelKey === pdcaTeamFilter);
    }

    if (pdcaStatusFilter === 'pendentes') {
      base = base.filter(t => !t._statusInfo.concluida);
    } else if (pdcaStatusFilter === 'urgentes') {
      base = base.filter(t => !t._statusInfo.concluida && (t._statusInfo.atrasada || t._statusInfo.emAlertaAmarelo));
    } else if (pdcaStatusFilter === 'concluidas') {
      base = base.filter(t => t._statusInfo.concluida);
    }

    return base;
  }, [tarefasEnriquecidas, pdcaScopeView, pdcaTeamFilter, pdcaStatusFilter]);

  // Agenda Escolar PEI: NÃO mostrar o que já passou em data
  const eventosFuturos = useMemo(() => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    const hojeStr = `${ano}-${mes}-${dia}`;

    return eventos
      .filter(e => {
        let dStr = String(e.dataFim || e.data || '').trim().slice(0, 10);
        if (!dStr) return true;
        if (dStr.includes('/')) {
          const parts = dStr.split('/');
          if (parts.length === 3) {
            dStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }
        return dStr >= hojeStr;
      })
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  }, [eventos]);

  // Atrasos e Estatísticas
  const ocorrenciasAtrasos = useMemo(() => {
    return ocorrencias.filter(o => {
      if (!o || o.isDispensa === true || String(o.origem || '').toUpperCase() === 'ATA_ESCOLAR') return false;
      const tipo = String(o.tipo || '').trim().toUpperCase();
      const cat = String(o.categoria || '').trim().toUpperCase();
      if (tipo || cat) {
        return tipo.includes('ATRASO') || cat.includes('ATRASO');
      }
      return o.isAtraso === true;
    });
  }, [ocorrencias]);

  const atrasosHoje = useMemo(() => {
    const dt = new Date();
    const hojeStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return ocorrenciasAtrasos.filter(o => {
      const dataStr = toIsoDate(o.data || o.criadoEm);
      return dataStr === hojeStr;
    });
  }, [ocorrenciasAtrasos]);

  const atrasosMes = useMemo(() => {
    const dt = new Date();
    const mesAtual = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    return ocorrenciasAtrasos.filter(o => {
      const dataStr = toIsoDate(o.data || o.criadoEm).slice(0, 7);
      return dataStr === mesAtual;
    });
  }, [ocorrenciasAtrasos]);

  // Ranking de Turmas com mais atrasos
  const turmasMaisAtrasos = useMemo(() => {
    const counts: Record<string, number> = {};
    atrasosMes.forEach(o => {
      const t = (o.turma || o.alunoTurma || 'Não Identificada').trim();
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [atrasosMes]);

  // Busca Ativa - Alunos Infrequentes (< 75%) OU com 3+ faltas consecutivas (lista completa sem truncar contagem)
  const alunosBuscaAtiva = useMemo(() => {
    return alunos
      .filter(a => {
        const ativo = isAlunoAtivo(a);
        if (filtroStatusBuscaAtiva === 'ATIVOS' && !ativo) return false;
        if (filtroStatusBuscaAtiva === 'INATIVOS' && ativo) return false;

        const freqNum = getRealStudentFreq(a);
        const faltasSeq = getFaltasConsecutivas(a);
        return (freqNum !== null && freqNum < 75) || faltasSeq >= 3;
      })
      .map(a => ({
        ...a,
        _freqNum: getRealStudentFreq(a),
        _faltasConsecutivas: getFaltasConsecutivas(a)
      }))
      .sort((a, b) => {
        if ((b._faltasConsecutivas || 0) !== (a._faltasConsecutivas || 0)) {
          return (b._faltasConsecutivas || 0) - (a._faltasConsecutivas || 0);
        }
        return (a._freqNum ?? 999) - (b._freqNum ?? 999);
      });
  }, [alunos, filtroStatusBuscaAtiva, getRealStudentFreq, getFaltasConsecutivas]);

  // Notificações Pedagógicas Urgentes dos Professores direcionadas à Gestão (Direção, Vice, PAAC e CGPG)
  const notificacoesPedagogicasDirecao = useMemo(() => {
    return ocorrencias.filter(o => {
      if (!o) return false;
      const isNotificar = o.notificarDirecao === true || o.notificar_direcao === true || o.notificarGestao === true;
      const isAtendida = o.notificacaoAtendida === true || o.atendida === true || o.resolvida === true;
      return isNotificar && !isAtendida;
    });
  }, [ocorrencias]);

  // Comunicados oficiais que o usuário ativo ainda NÃO deu ciência
  const recadosSemCienciaUsuario = useMemo(() => {
    return recadosDirecionados.filter(r => {
      if (r.arquivado) return false;
      if (typeof window.usuarioDeuCienteRecado === 'function') {
        return !window.usuarioDeuCienteRecado(r, { ...effectiveUser, cargo: activeRole });
      }
      const cientes = Array.isArray(r.cientes) ? r.cientes : [];
      const userEmail = (effectiveUser?.email || currentUser?.email || '').toLowerCase();
      const userNome = (effectiveUser?.nome || currentUser?.nome || '').toUpperCase();
      return !cientes.some((c: any) =>
        (c.email && c.email.toLowerCase() === userEmail) ||
        (c.nome && c.nome.toUpperCase() === userNome)
      );
    });
  }, [recadosDirecionados, effectiveUser, currentUser, activeRole]);

  // Tutorados do professor em alerta de frequência (< 75%) ou 3+ faltas consecutivas
  const tutoradosEmRisco = useMemo(() => {
    return tutoradosDoProfessor.filter(aluno => {
      if (!isAlunoAtivo(aluno)) return false;
      const f = aluno._freqNum;
      const fc = aluno._faltasConsecutivas || 0;
      return (f !== null && f < 75) || fc >= 3;
    });
  }, [tutoradosDoProfessor]);

  // Estudantes com pendência no Mapão de Fechamento (1B, 2B ou 3B ausentes) - Apenas alunos ativos
  const alunosMapaoPendentes = useMemo(() => {
    return alunos.filter(a => {
      if (!isAlunoAtivo(a)) return false;
      if (typeof a._mapaoPendente === 'boolean') return a._mapaoPendente;
      const fn = a.fechamento_notas || a.fechamentos || a.notas || {};
      const tem1B = !!(fn['1B'] && fn['1B'].disciplinas && Object.keys(fn['1B'].disciplinas).length > 0);
      const tem2B = !!(fn['2B'] && fn['2B'].disciplinas && Object.keys(fn['2B'].disciplinas).length > 0);
      const tem3B = !!(fn['3B'] && fn['3B'].disciplinas && Object.keys(fn['3B'].disciplinas).length > 0);
      return !tem1B || !tem2B || !tem3B;
    });
  }, [alunos]);

  // Notificações pendentes de Tutoria direcionadas ao Tutor ativo (3+ atrasos no mês)
  const notificacoesTutorPendentes = useMemo(() => {
    const tNome = normalizeTeacherName(effectiveTeacher?.nome || effectiveUser?.nome || '');
    const rasTutorados = new Set(
      tutoradosDoProfessor.map(a => String(a.ra || a.id || '').replace(/\D/g, '') || String(a.ra || a.id || '').trim())
    );
    return notificacoesTutor.filter(n => {
      if (!n) return false;
      const isAtendida = n.atendida === true || String(n.status || '').toUpperCase() === 'ATENDIDA';
      if (isAtendida) return false;

      const nRa = String(n.ra || '').replace(/\D/g, '') || String(n.ra || '').trim();
      if (nRa && rasTutorados.has(nRa)) return true;

      const nTutor = normalizeTeacherName(n.tutorResponsavel || '');
      if (!nTutor || nTutor === 'TUTORIA PEI' || !tNome) return false;
      if (nTutor === tNome) return true;
      const minLen = Math.min(nTutor.length, tNome.length);
      return minLen >= 3 && (tNome.includes(nTutor) || nTutor.includes(tNome));
    });
  }, [notificacoesTutor, effectiveTeacher, effectiveUser, tutoradosDoProfessor]);

  const handleAtenderNotificacaoPedagogica = async (ocorrenciaId: string) => {
    try {
      const ocRef = doc(db, 'ocorrencias', ocorrenciaId);
      await updateDoc(ocRef, {
        notificacaoAtendida: true,
        notificacaoAtendidaPor: currentUser.nome,
        notificacaoAtendidaEm: new Date().toISOString()
      });
      setOcorrencias(prev => prev.map(o => o.id === ocorrenciaId ? { ...o, notificacaoAtendida: true } : o));
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Notificação pedagógica atendida com sucesso!', 'success');
      }
    } catch (e: any) {
      console.error(e);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao atualizar notificação', 'error');
      }
    }
  };

  const handleAtenderNotificacaoTutor = async (notifId: string, observacaoManual?: string) => {
    try {
      const obsTexto = String(observacaoManual ?? obsAtendimentoNotif[notifId] ?? '').trim();
      const nowIso = new Date().toISOString();
      const ntRef = doc(db, 'notificacoes_tutor', notifId);
      await updateDoc(ntRef, {
        atendida: true,
        status: 'ATENDIDA',
        atendidaPor: currentUser.nome || effectiveTeacher?.nome || 'Tutor',
        atendidaEm: nowIso,
        atualizadoEm: nowIso,
        ...(obsTexto ? { observacaoAtendimento: obsTexto } : {})
      });

      const atualizarLista = (prev: any[]) =>
        prev.map(n =>
          n.id === notifId
            ? {
                ...n,
                atendida: true,
                status: 'ATENDIDA',
                atendidaPor: currentUser.nome || effectiveTeacher?.nome || 'Tutor',
                atendidaEm: nowIso,
                ...(obsTexto ? { observacaoAtendimento: obsTexto } : {})
              }
            : n
        );

      setNotificacoesTutor(atualizarLista);
      setObsAtendimentoNotif(prev => {
        const next = { ...prev };
        delete next[notifId];
        return next;
      });
      if (typeof window !== 'undefined') {
        if (Array.isArray((window as any).notificacoesTutorCache)) {
          (window as any).notificacoesTutorCache = atualizarLista((window as any).notificacoesTutorCache);
        }
        if ((window as any).__clovisHomeCache && Array.isArray((window as any).__clovisHomeCache.notificacoesTutor)) {
          (window as any).__clovisHomeCache.notificacoesTutor = atualizarLista((window as any).__clovisHomeCache.notificacoesTutor);
        }
      }
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Notificação de tutoria marcada como atendida!', 'success');
      }
    } catch (e: any) {
      console.error(e);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao atender notificação da tutoria', 'error');
      }
    }
  };

  // Recados estritamente ATIVOS no Mural (excluindo arquivados)
  const recadosAtivos = useMemo(() => {
    return recados.filter(r => !r.arquivado);
  }, [recados]);

  // Monitor de Ciência dos Professores no Mural (Apenas recados ATIVOS)
  const activeRecadoForMonitor = useMemo(() => {
    if (recadosAtivos.length === 0) return null;
    if (recadoSelecionadoMonitor) {
      const achado = recadosAtivos.find(r => r.id === recadoSelecionadoMonitor);
      if (achado) return achado;
    }
    return recadosAtivos[0];
  }, [recadosAtivos, recadoSelecionadoMonitor]);

  // Identifica com rigor o público-alvo esperado para leitura e ciência do comunicado
  const obterPublicoAlvoRecado = useCallback((recado: any): { publicoDescricao: string; profs: any[]; isRestrito: boolean } => {
    if (!recado) {
      return { publicoDescricao: 'Todos os Professores', profs: [], isRestrito: false };
    }

    // 1. Destinatários específicos cadastrados diretamente no recado
    const especificosBrutos: any[] = Array.isArray(recado.destinatarios_especificos) && recado.destinatarios_especificos.length > 0
      ? recado.destinatarios_especificos
      : (Array.isArray(recado.professoresSelecionados) && recado.professoresSelecionados.length > 0
          ? recado.professoresSelecionados
          : (Array.isArray(recado.docentesAlvo) && recado.docentesAlvo.length > 0 ? recado.docentesAlvo : []));

    // 2. Extrai menções com @ no texto do comunicado (ex: @Nome, @[Nome], @[Nome|Cargo])
    const mencoesTexto: string[] = [];
    const textoCompleto = `${recado.conteudo || ''} ${recado.texto || ''} ${recado.mensagem || ''} ${recado.descricao || ''}`;
    if (textoCompleto) {
      const regexAvancado = /@\[([^\|\]]+)\|([^\]]+)\]/g;
      let m;
      while ((m = regexAvancado.exec(textoCompleto)) !== null) {
        const n = m[1].trim();
        if (n && !['todos', 'equipe', 'geral', 'escola'].includes(n.toLowerCase())) {
          mencoesTexto.push(n);
        }
      }
      const regexColchete = /@\[([^\]]+)\]/g;
      while ((m = regexColchete.exec(textoCompleto)) !== null) {
        const n = m[1].trim();
        if (n && !['todos', 'equipe', 'geral', 'escola'].includes(n.toLowerCase())) {
          mencoesTexto.push(n);
        }
      }
      const regexSimples = /(?:^|[\s(])@([A-Za-zÀ-ÿ0-9_\.\-]+(?:\s+[A-Za-zÀ-ÿ0-9_\.\-]+){0,2})(?=[.,!?\s)]|$)/g;
      while ((m = regexSimples.exec(textoCompleto)) !== null) {
        const n = m[1].trim();
        const nLower = n.toLowerCase();
        if (n && !['todos', 'equipe', 'geral', 'professores', 'secretaria', 'direcao', 'coordenacao'].includes(nLower)) {
          mencoesTexto.push(n);
        }
      }
    }

    // Caso A: O comunicado tem lista de destinatários específicos configurados
    if (especificosBrutos.length > 0 || recado.destinatarios_tipo === 'especificos') {
      const marcados: any[] = [];
      const seen = new Set<string>();

      especificosBrutos.forEach((esp: any) => {
        const nomeEsp = typeof esp === 'string' ? esp : (esp.nome || esp.email || '');
        const emailEsp = typeof esp === 'string' ? '' : String(esp.email || '').toLowerCase().trim();
        const normEsp = normalizeTeacherName(nomeEsp);

        // Busca correspondente em listaFuncionariosCompleta ou listaDocentes
        const achado = listaFuncionariosCompleta.find(u => {
          const uNome = normalizeTeacherName(u.nome);
          const uEmail = String(u.email || '').toLowerCase().trim();
          if (emailEsp && uEmail && emailEsp === uEmail) return true;
          if (normEsp && uNome && (normEsp === uNome || normEsp.includes(uNome) || uNome.includes(normEsp))) return true;
          const uTokens = (uNome || '').split(' ').filter(Boolean);
          const eTokens = (normEsp || '').split(' ').filter(Boolean);
          if (uTokens[0] && eTokens[0] && uTokens[0] === eTokens[0]) {
            if (uTokens.length > 1 && eTokens.length > 1) {
              return uTokens.some(ut => eTokens.includes(ut));
            }
            return true;
          }
          return false;
        });

        const key = normEsp || emailEsp || String(esp);
        if (key && !seen.has(key)) {
          seen.add(key);
          if (achado) {
            marcados.push(achado);
          } else {
            marcados.push({
              id: esp.id || esp.email || nomeEsp,
              nome: nomeEsp,
              email: emailEsp,
              cargo: esp.cargo || 'Docente Selecionado',
              disciplina: esp.disciplina || ''
            });
          }
        }
      });

      if (marcados.length > 0) {
        return {
          publicoDescricao: `${marcados.length} ${marcados.length === 1 ? 'docente marcado' : 'docentes marcados'}`,
          profs: marcados,
          isRestrito: true
        };
      }
    }

    // Caso B: O comunicado marcou professores específicos com @ no texto
    if (mencoesTexto.length > 0 && recado.destinatarios_tipo !== 'cargos') {
      const marcados: any[] = [];
      const seen = new Set<string>();

      mencoesTexto.forEach(nomeMencao => {
        const normMencao = normalizeTeacherName(nomeMencao);
        if (!normMencao) return;

        const achado = listaFuncionariosCompleta.find(u => {
          const uNome = normalizeTeacherName(u.nome);
          if (!uNome) return false;
          if (uNome === normMencao || uNome.includes(normMencao) || normMencao.includes(uNome)) return true;
          const uTokens = uNome.split(' ').filter(Boolean);
          const mTokens = normMencao.split(' ').filter(Boolean);
          return uTokens[0] && mTokens[0] && uTokens[0] === mTokens[0];
        });

        const key = achado ? normalizeTeacherName(achado.nome) : normMencao;
        if (key && !seen.has(key)) {
          seen.add(key);
          if (achado) {
            marcados.push(achado);
          } else {
            marcados.push({
              id: `mencao-${normMencao}`,
              nome: nomeMencao,
              cargo: 'Docente Mencionado',
              disciplina: ''
            });
          }
        }
      });

      if (marcados.length > 0) {
        return {
          publicoDescricao: `${marcados.length} ${marcados.length === 1 ? 'docente marcado no comunicado' : 'docentes marcados no comunicado'}`,
          profs: marcados,
          isRestrito: true
        };
      }
    }

    // Caso C: Comunicado restrito por cargos
    const tipoAlvo = recado.destinatarios_tipo || '';
    const cargosAlvo: string[] = Array.isArray(recado.destinatarios_cargos) ? recado.destinatarios_cargos : [];

    if (tipoAlvo === 'cargos' && cargosAlvo.length > 0) {
      const filtrados = listaFuncionariosCompleta.filter(u => {
        const uCargo = String(u.cargo || u.nivelAcesso || u.nivel || '').toUpperCase().trim();
        return cargosAlvo.some(cg => {
          const cgNorm = String(cg || '').toUpperCase().trim();
          if (cgNorm === uCargo) return true;
          if ((cgNorm === 'PROFESSOR' || cgNorm === 'PROFESSORES') && (uCargo.includes('PROF') || uCargo === 'DOCENTE')) return true;
          if (cgNorm === 'PAAC' && uCargo.includes('PAAC')) return true;
          if ((cgNorm === 'CGPG' || cgNorm === 'COORDENACAO') && (uCargo.includes('CGPG') || uCargo.includes('COORD'))) return true;
          if ((cgNorm === 'DIRECAO' || cgNorm === 'DIRETOR') && (uCargo.includes('DIRETOR') || uCargo.includes('SENIOR') || uCargo.includes('SÊNIOR') || /\bGOE\b/.test(uCargo) || uCargo.includes('EXTENDIDO') || uCargo.includes('VICE'))) return true;
          if ((cgNorm === 'SENIOR_GOE' || cgNorm === 'EXTENDIDO') && (uCargo.includes('SENIOR') || uCargo.includes('SÊNIOR') || /\bGOE\b/.test(uCargo) || uCargo.includes('EXTENDIDO') || uCargo.includes('DIRETOR'))) return true;
          if (cgNorm === 'VICE_DIRETOR' && (uCargo.includes('VICE') || uCargo.includes('DIRETOR'))) return true;
          if (cgNorm === 'SECRETARIA' && (uCargo.includes('SECRETAR') || uCargo.includes('AOE'))) return true;
          return false;
        });
      });

      if (filtrados.length > 0) {
        return {
          publicoDescricao: `Cargos específicos (${cargosAlvo.join(', ')})`,
          profs: filtrados,
          isRestrito: true
        };
      }
    }

    // Caso D: Todos os professores da escola
    return {
      publicoDescricao: 'Todos os Professores da Escola',
      profs: listaDocentes,
      isRestrito: false
    };
  }, [listaDocentes, listaFuncionariosCompleta]);

  const analiseCienciaProfessores = useMemo(() => {
    if (!activeRecadoForMonitor) {
      return { totalProfs: 0, cientes: 0, pendentesCount: 0, taxa: 0, profsPendentes: [], publicoDescricao: '', isRestrito: false };
    }

    const { publicoDescricao, profs: profsAlvo, isRestrito } = obterPublicoAlvoRecado(activeRecadoForMonitor);
    const cientesList = Array.isArray(activeRecadoForMonitor.cientes) ? activeRecadoForMonitor.cientes : [];

    const pendentes = profsAlvo.filter(p => {
      const pNome = normalizeTeacherName(p.nome);
      const pEmail = String(p.email || '').toLowerCase().trim();
      const pTokens = pNome.split(' ').filter(Boolean);

      const deu = cientesList.some((c: any) => {
        const cNome = normalizeTeacherName(c.nome);
        const cEmail = String(c.email || '').toLowerCase().trim();
        if (pEmail && cEmail && cEmail === pEmail) return true;
        if (pNome && cNome && pNome === cNome) return true;
        const cTokens = cNome.split(' ').filter(Boolean);
        if (pTokens[0] && cTokens[0] && pTokens[0] === cTokens[0]) {
          if (pTokens.length > 1 && cTokens.length > 1) {
            return pTokens.some(pt => cTokens.includes(pt));
          }
          return true;
        }
        if (pNome && cNome && (pNome.startsWith(cNome + ' ') || cNome.startsWith(pNome + ' '))) return true;
        return false;
      });
      return !deu;
    });

    const cientesCount = profsAlvo.length - pendentes.length;
    const taxa = profsAlvo.length > 0 ? Math.round((cientesCount / profsAlvo.length) * 100) : 0;

    return {
      publicoDescricao,
      isRestrito,
      totalProfs: profsAlvo.length,
      cientes: cientesCount,
      pendentesCount: pendentes.length,
      taxa,
      profsPendentes: pendentes
    };
  }, [activeRecadoForMonitor, obterPublicoAlvoRecado]);

  // Handlers de Ações
  const handleConfirmarCiencia = async (recadoId: string) => {
    try {
      if (typeof window.darCienteRecado === 'function') {
        await window.darCienteRecado(recadoId);
      } else {
        const recRef = doc(db, 'mural_recados', recadoId);
        const rec = recados.find(r => r.id === recadoId);
        const cientes = Array.isArray(rec?.cientes) ? [...rec.cientes] : [];
        cientes.push({
          nome: currentUser.nome,
          email: currentUser.email,
          cargo: activeRole,
          data: new Date().toISOString()
        });
        await updateDoc(recRef, { cientes });
      }

      setRecados(prev => prev.map(r => {
        if (r.id === recadoId) {
          const c = Array.isArray(r.cientes) ? [...r.cientes] : [];
          return {
            ...r,
            cientes: [...c, { nome: currentUser.nome, cargo: activeRole, data: new Date().toISOString() }]
          };
        }
        return r;
      }));

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Ciência confirmada com sucesso!', 'success');
      }
    } catch (e: any) {
      console.error(e);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao confirmar ciência', 'error');
      }
    }
  };

  const handleToggleTarefa = async (tarefaId: string, statusAtual: boolean) => {
    const task = tarefas.find(t => t.id === tarefaId);
    const isCurrentlyDone = task ? verificarStatus(task) : statusAtual;
    const agora = new Date();
    const hojeStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    const nowIso = agora.toISOString();
    const userEmail = getCurrentUserEmail();
    const nomeUsuario = currentUser?.nome || effectiveUser?.nome || userEmail.split('@')[0];

    // REGRA CRÍTICA: Sem campos id ou _id no payload
    const patch = isCurrentlyDone
      ? {
          concluido: false,
          concluidaPor: [],
          concluidoPor: [],
          concluidoPorNome: null,
          ultimaDataConclusao: null,
          ultimaConclusao: null,
          atualizadoEm: nowIso,
          atualizadoPor: `${activeRole} (${userEmail})`
        }
      : {
          concluido: true,
          concluidaPor: [userEmail.toLowerCase().trim()],
          concluidoPor: [userEmail.toLowerCase().trim()],
          concluidoPorNome: nomeUsuario,
          ultimaDataConclusao: hojeStr,
          ultimaConclusao: nowIso,
          atualizadoEm: nowIso,
          atualizadoPor: `${activeRole} (${userEmail})`
        };

    const prevList = [...tarefas];
    const updatedList = prevList.map(t => (t.id === tarefaId ? { ...t, ...patch } : t));
    setTarefas(updatedList);
    if (typeof window !== 'undefined') {
      (window as any).rotinaEquipeCache = updatedList;
      (window as any).tasksCache = updatedList;
    }

    try {
      const tRef = doc(db, 'rotina_equipe', tarefaId);
      await updateDoc(tRef, patch);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(
          isCurrentlyDone ? 'Tarefa reaberta como pendente.' : 'Tarefa concluída no ciclo vigente!',
          isCurrentlyDone ? 'info' : 'success'
        );
      }
    } catch (e) {
      console.error(e);
      setTarefas(prevList);
      if (typeof window !== 'undefined') {
        (window as any).rotinaEquipeCache = prevList;
        (window as any).tasksCache = prevList;
      }
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao atualizar tarefa.', 'error');
      }
    }
  };

  const handleSalvarNovaTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    const tituloFinal = novaTarefaTitulo.trim() || novaTarefaDesc.trim();
    if (!tituloFinal) return;

    const freqNorm = getNormalizedFreqKey(novaTarefaFreq);
    const isPontual = freqNorm === 'Ação Pontual (Prazo Fixo)';
    const targetRole = novaTarefaAtribuir || activeRole;

    try {
      // REGRA CRÍTICA: Sem campos id ou _id no payload enviado ao banco
      const payload = {
        titulo: tituloFinal,
        descricao: novaTarefaDesc.trim() || tituloFinal,
        frequencia: freqNorm,
        regraRecorrencia: {
          diaSemana: Number(novaTarefaDiaSemana ?? 5),
          diaMes: Math.min(31, Math.max(1, Number(novaTarefaDiaMes ?? 25))),
          mesNoBimestre: 2,
          mesNoSemestre: 6,
          mesAno: 11,
          horarioLimite: novaTarefaHorarioLimite || '',
          apenasDiasUteis: true,
          diasAntecedencia: Math.max(0, Number(novaTarefaAntecedencia ?? getDefaultAntecedencia(freqNorm)))
        },
        atribuirA: targetRole,
        atribuidoA: targetRole,
        dataInicio: isPontual ? (novaTarefaPrazo || null) : null,
        dataFim: isPontual ? (novaTarefaPrazo || null) : null,
        dataLimite: isPontual ? (novaTarefaPrazo || null) : null,
        concluido: false,
        concluidaPor: [],
        concluidoPor: [],
        ultimaConclusao: null,
        ultimaDataConclusao: null,
        criadoPor: currentUser.nome || activeRole,
        criadoEm: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'rotina_equipe'), payload);
      const updatedList = [...tarefas, { id: docRef.id, ...payload }];
      setTarefas(updatedList);
      if (typeof window !== 'undefined') {
        (window as any).rotinaEquipeCache = updatedList;
        (window as any).tasksCache = updatedList;
      }
      setModalNovaTarefa(false);
      setNovaTarefaTitulo('');
      setNovaTarefaDesc('');
      setNovaTarefaFreq('Semanal');
      setNovaTarefaPrazo('');
      setNovaTarefaAtribuir('');
      setNovaTarefaHorarioLimite('');
      setNovaTarefaAntecedencia(1);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Tarefa PDCA criada e sincronizada com sucesso!', 'success');
      }
    } catch (err) {
      console.error(err);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao criar tarefa.', 'error');
      }
    }
  };

  // Registrar Entrada com Atraso (Secretaria)
  const handleRegistrarAtraso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alunoSelecionadoAtraso) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Selecione um estudante para registrar o atraso', 'warning');
      }
      return;
    }

    setSalvandoAtraso(true);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const descCompleta = `Entrada com atraso registrada pela Secretaria às ${horarioAtraso}. Motivo: ${motivoAtraso}. Justificado: ${justificadoAtraso ? 'Sim' : 'Não'}. ${obsAtraso ? 'Observações: ' + obsAtraso : ''}`;

      // REGRA CRÍTICA DE INTEGRAÇÃO: NUNCA CRIAR OU INCLUIR id OU _id
      const payloadOcorrencia = {
        ra: alunoSelecionadoAtraso.ra,
        nomeAluno: alunoSelecionadoAtraso.nome,
        turma: alunoSelecionadoAtraso.turma,
        tipo: 'ATRASO',
        categoria: 'Atraso de Entrada',
        descricao: descCompleta,
        isAtraso: true,
        justificado: justificadoAtraso,
        horarioAtraso: horarioAtraso,
        motivo: motivoAtraso,
        data: hoje,
        autor: `${currentUser.nome} (${currentUser.cargo})`,
        autor_nome: currentUser.nome,
        autor_cargo: currentUser.cargo,
        autor_email: currentUser.email,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      };

      const docRefAtraso = await addDoc(collection(db, 'ocorrencias'), payloadOcorrencia);
      if (typeof window !== 'undefined') {
        if (!Array.isArray((window as any).ocorrenciasTopLevel)) (window as any).ocorrenciasTopLevel = [];
        (window as any).ocorrenciasTopLevel.unshift({ ...payloadOcorrencia, id: docRefAtraso.id });
        if (typeof (window as any).verificarGatilhoAtrasosMes === 'function') {
          await (window as any).verificarGatilhoAtrasosMes(alunoSelecionadoAtraso);
        }
      }

      // Gerar comprovante para impressão imediata
      const comprovante = {
        protocolo: `ATR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
        alunoNome: alunoSelecionadoAtraso.nome,
        alunoRa: alunoSelecionadoAtraso.ra,
        turma: alunoSelecionadoAtraso.turma,
        horario: horarioAtraso,
        data: new Date().toLocaleDateString('pt-BR'),
        motivo: motivoAtraso,
        justificado: justificadoAtraso,
        atendente: currentUser.nome
      };
      setComprovanteAtraso(comprovante);

      // Limpar formulário
      setAlunoSelecionadoAtraso(null);
      setBuscaAlunoAtraso('');
      setObsAtraso('');
      carregarDadosCompletos(true);

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Atraso registrado com sucesso! Comprovante gerado.', 'success');
      }
    } catch (err: any) {
      console.error(err);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao registrar atraso: ' + err.message, 'error');
      }
    } finally {
      setSalvandoAtraso(false);
    }
  };

  // Gerar Documento de Secretaria
  const handleGerarDocumento = () => {
    if (!alunoSelecionadoDoc) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Selecione um aluno para gerar o documento', 'warning');
      }
      return;
    }

    const hoje = new Date();
    const dataExtenso = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const freqReal = getRealStudentFreq(alunoSelecionadoDoc);

    let titulo = '';
    let corpo = '';

    if (tipoDocumento === 'matricula') {
      titulo = 'ATESTADO DE MATRÍCULA E FREQUÊNCIA';
      corpo = `Atestamos, para os devidos fins a pedido da parte interessada, que o(a) estudante ${alunoSelecionadoDoc.nome}, portador(a) do R.A. nº ${alunoSelecionadoDoc.ra}, encontra-se regularmente matriculado(a) e com frequência ativa no ano letivo de ${anoLetivo}, cursando a turma ${alunoSelecionadoDoc.turma}, no Regime de Turno Único do Programa Ensino Integral (PEI), nesta Unidade Escolar sob jurisdição da Diretoria de Ensino da Região Leste 4.`;
    } else if (tipoDocumento === 'frequencia') {
      titulo = 'DECLARAÇÃO DE ASSIDUIDADE E FREQUÊNCIA ESCOLAR';
      const trechoFreq = freqReal !== null
        ? `apresenta frequência apurada de ${freqReal.toFixed(1).replace('.', ',')}% no corrente ano letivo`
        : 'mantém frequência escolar acompanhada nos registros oficiais de prontuário do corrente ano letivo';
      corpo = `Declaramos, para os devidos fins de comprovação perante órgãos públicos e benefícios sociais, que o(a) estudante ${alunoSelecionadoDoc.nome}, R.A. nº ${alunoSelecionadoDoc.ra}, devidamente matriculado(a) na turma ${alunoSelecionadoDoc.turma}, ${trechoFreq}, nos termos da Lei Federal nº 9.394/96 (LDB).`;
    } else if (tipoDocumento === 'transferencia') {
      titulo = 'DECLARAÇÃO DE TRANSFERÊNCIA EM PROCESSO';
      corpo = `Declaramos que o(a) estudante ${alunoSelecionadoDoc.nome}, R.A. nº ${alunoSelecionadoDoc.ra}, turma ${alunoSelecionadoDoc.turma}, solicitou transferência desta Unidade Escolar nesta data, estando desvinculado(a) e com seu prontuário em processo de conferência para emissão do Histórico Escolar definitivo no prazo regulamentar de até 30 (trinta) dias.`;
    } else {
      titulo = 'DECLARAÇÃO DE COMPARECIMENTO DO RESPONSÁVEL';
      corpo = `Declaramos para os devidos fins de justificativa de ausência laboral que o(a) Sr(a). ${nomeResponsavelDoc || 'Responsável Legal'}, responsável pelo(a) estudante ${alunoSelecionadoDoc.nome} (R.A. ${alunoSelecionadoDoc.ra}, turma ${alunoSelecionadoDoc.turma}), esteve presente nesta Unidade Escolar no dia ${hoje.toLocaleDateString('pt-BR')}, no período das ${periodoDoc}, para tratar de assuntos de interesse escolar e pedagógico.`;
    }

    setDocumentoPronto({
      titulo,
      corpo,
      aluno: alunoSelecionadoDoc,
      dataExtenso,
      emissor: currentUser.nome,
      cargoEmissor: currentUser.cargo || 'Secretaria Escolar'
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-3 sm:p-6 space-y-5 sm:space-y-6 max-w-7xl mx-auto text-slate-800 antialiased">

      {/* 1. TOPO: Identificação Executiva & Comutador de Cargo */}
      <header className="sticky top-2 z-20 bg-white/90 backdrop-blur-md rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 sm:gap-4">
          <div className="w-13 h-13 sm:w-15 sm:h-15 rounded-2xl bg-slate-50 border border-slate-200/80 p-1.5 flex items-center justify-center shrink-0">
            <img
              src={customLogoUrl}
              alt="Brasão Oficial EE Prof. Clóvis de Lucca"
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (!img.src.endsWith('/logo-clovis.svg')) {
                  img.src = '/logo-clovis.svg';
                }
              }}
              className="w-full h-full object-contain logo-escola-img"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
              <span className="font-medium capitalize">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-semibold text-slate-700 tabular-nums">
                Ano Letivo {anoLetivo}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              {revalidando || carregandoAnalitico ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-indigo-700">
                  <i className="fa-solid fa-arrows-rotate animate-spin text-[10px]"></i>
                  <span>{carregandoAnalitico ? 'Carregando dados analíticos...' : 'Sincronizando...'}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => carregarDadosCompletos(true, modoVisualizacao)}
                  className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-indigo-700 transition-colors cursor-pointer"
                  title="Atualizar dados em tempo real com o banco"
                >
                  <i className="fa-solid fa-arrows-rotate text-[10px] text-slate-400"></i>
                  <span>Atualizar dados</span>
                </button>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Olá, {effectiveUser.nome.split(' ')[0]}!
            </h1>
            <p className="text-sm text-slate-500">
              EE Clóvis de Lucca · Perfil:{' '}
              <span className="font-semibold text-slate-800">{activeRole}</span>
              {selectedEmployeeId ? (
                <>
                  <span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>
                  <span className="font-semibold text-indigo-700">Visualizando: {effectiveUser.nome}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/* Seletor Principal de Modo (Modo Foco vs Modo Analítico) */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 w-full lg:w-auto">
          <div
            role="tablist"
            aria-label="Modo de visualização da tela inicial"
            className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 self-start sm:self-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={modoVisualizacao === 'foco'}
              onClick={() => toggleModoVisualizacao('foco')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                modoVisualizacao === 'foco'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Carregamento ultrarrápido focado nas pendências prioritárias e ações do dia"
            >
              <i className={`fa-solid fa-bolt text-[11px] ${modoVisualizacao === 'foco' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
              <span>Modo Foco</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modoVisualizacao === 'completo'}
              onClick={() => toggleModoVisualizacao('completo')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                modoVisualizacao === 'completo'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Carrega todos os painéis gerenciais, PDCA, histórico de ocorrências, busca ativa e indicadores completos"
            >
              <i className={`fa-solid fa-chart-column text-[11px] ${modoVisualizacao === 'completo' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
              <span>Modo Analítico</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-500">
            {modoVisualizacao === 'foco'
              ? 'Modo Foco ativo · Carregamento leve e ações prioritárias de hoje'
              : 'Modo Analítico ativo · Painéis completos, gráficos e históricos'}
          </span>
        </div>

        {/* Comutador de Visão: EXCLUSIVO PARA O DIRETOR com seleção de cada funcionário individualmente */}
        {isRealDirector && (
          <div className="flex flex-col gap-2.5 w-full lg:w-auto bg-slate-50/90 p-3 rounded-2xl border border-slate-200/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <i className="fa-solid fa-user-shield text-indigo-600"></i>
                Comutador de Visão (Direção)
              </span>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">Funcionário:</span>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => {
                    const empId = e.target.value;
                    setSelectedEmployeeId(empId);
                    if (empId) {
                      const emp = listaFuncionariosCompleta.find(u => u.id === empId || u.email === empId || u.nome === empId);
                      if (emp) {
                        setSimulatedRole(emp.cargo || emp.nivel || 'PROFESSOR');
                        setSelectedTeacherName(emp.nome);
                      }
                    } else {
                      setSimulatedRole('');
                      setSelectedTeacherName('');
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200/90 rounded-xl text-slate-800 font-semibold outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer max-w-[220px] truncate"
                >
                  <option value="">Meu Perfil (Direção)</option>
                  <optgroup label="Equipe Escolar & Funcionários">
                    {listaFuncionariosCompleta
                      .map((u, idx) => (
                        <option key={`${u.id || u.email || u.nome}-${idx}`} value={u.id || u.email || u.nome}>
                          {u.nome} ({u.cargo || u.nivel || 'Docente'}{u.disciplina ? ` - ${u.disciplina}` : ''})
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1.5 border-t border-slate-200/70">
              {['PROFESSOR', 'SECRETARIA', 'PAAC', 'CGPG', 'VICE_DIRETOR', 'SENIOR_GOE', 'DIRETOR'].map(roleOption => {
                const isActive = activeRole === roleOption;
                const labels: Record<string, string> = {
                  PROFESSOR: 'Professor',
                  SECRETARIA: 'Secretaria',
                  PAAC: 'PAAC',
                  CGPG: 'CGPG',
                  VICE_DIRETOR: 'Vice-Direção',
                  SENIOR_GOE: 'Sênior/GOE',
                  DIRETOR: 'Direção'
                };
                return (
                  <button
                    key={roleOption}
                    type="button"
                    onClick={() => {
                      setSimulatedRole(roleOption);
                      setSelectedEmployeeId('');
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                    }`}
                  >
                    {labels[roleOption]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* Skeleton rápido apenas na primeira carga sem cache */}
      {loading && (
        <div className="space-y-4 animate-pulse" aria-label="Carregando dados essenciais">
          <div className="h-32 bg-white rounded-2xl border border-slate-200/80 p-5 flex flex-col justify-between">
            <div className="h-4 w-56 bg-slate-200 rounded"></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="h-10 bg-slate-100 rounded-xl"></div>
              <div className="h-10 bg-slate-100 rounded-xl"></div>
              <div className="h-10 bg-slate-100 rounded-xl"></div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-28 bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
                <div className="h-6 w-12 bg-slate-200 rounded"></div>
                <div className="h-3 w-24 bg-slate-100 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CENTRAL DE PENDÊNCIAS E ALERTAS RÁPIDOS POR CARGO */}
      <CentralPendenciasPerfil
        activeRole={activeRole}
        effectiveUser={effectiveUser}
        modoVisualizacao={modoVisualizacao}
        onToggleModo={toggleModoVisualizacao}
        recadosSemCiencia={recadosSemCienciaUsuario}
        tutoradosEmRisco={tutoradosEmRisco}
        tarefasUrgentes={tarefasUrgentes}
        notificacoesPedagogicas={notificacoesPedagogicasDirecao}
        alunosMapaoPendentesCount={alunosMapaoPendentes.length}
        alunosBuscaAtivaCount={alunosBuscaAtiva.length}
        atrasosHojeCount={atrasosHoje.length}
        aulasHoje={aulasHoje}
        substituicoesHoje={substituicoesHoje}
        onNavigate={onNavigate}
        onAbrirAluno={(ra) => {
          if (typeof window.abrirFichaAluno === 'function') window.abrirFichaAluno(ra);
          else if (typeof window.navegarEAbrirFichaAluno === 'function') window.navegarEAbrirFichaAluno(ra);
        }}
        onConfirmarCiencia={handleConfirmarCiencia}
        onAtenderNotificacao={handleAtenderNotificacaoPedagogica}
        notificacoesTutor={notificacoesTutorPendentes}
        onAtenderNotificacaoTutor={(id) => handleAtenderNotificacaoTutor(id)}
        onEmitirTermoTutor={(ra, qtd) => window.emitirTermoCienciaFrequenciaGatilho?.(ra, qtd)}
        onToggleTarefa={handleToggleTarefa}
        onNovaTarefa={() => setModalNovaTarefa(true)}
        onAbrirRecado={(rec) => setModalRecado(rec)}
      />

      {/* 2. BARRA DE INDICADORES RÁPIDOS (BENTO KPIs) POR CARGO */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Bloco 1 */}
        {isSecretaria ? (
          <div
            onClick={() => onNavigate ? onNavigate('dash-pontualidade') : window.switchTab?.('dash-pontualidade')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-amber-300 transition-all cursor-pointer group"
            title="Clique para abrir o Dashboard de Atrasos"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-clock-rotate-left"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-amber-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {atrasosHoje.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Atrasos Hoje</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Entradas tardias computadas</span>
          </div>
        ) : isProfessor || isPAAC ? (
          <div
            onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-indigo-300 transition-all cursor-pointer group"
            title="Clique para consultar a grade completa de horários"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-chalkboard-user"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-indigo-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {aulasSemanaisAtivas.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Aulas Ativas na Semana</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {aulasHojeAtivas.length} hoje{substituicoesParaMimHoje.length > 0 ? ` · +${substituicoesParaMimHoje.length} substituição(ões)` : ''}
            </span>
          </div>
        ) : (
          <div
            onClick={() => onNavigate ? onNavigate('dash-evasao') : window.switchTab?.('dash-evasao')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-emerald-300 transition-all cursor-pointer group"
            title="Clique para consultar métricas reais de frequência e evasão"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-chart-line"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-emerald-600 transition-colors"></i>
            </div>
            <div className={`text-2xl sm:text-3xl font-bold tabular-nums mt-3 ${
              presencaGeralStats.media === null ? 'text-slate-400' : presencaGeralStats.media < 75 ? 'text-rose-600' : 'text-emerald-600'
            }`}>
              {presencaGeralStats.media !== null ? `${presencaGeralStats.media.toFixed(1).replace('.', ',')}%` : '—'}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Presença Geral (Real)</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {presencaGeralStats.totalAvaliados > 0
                ? `${presencaGeralStats.totalAvaliados} ativos apurados`
                : 'Aguardando lançamento SED/diário'}
            </span>
          </div>
        )}

        {/* Bloco 2 */}
        {isSecretaria ? (
          <div
            onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-indigo-300 transition-all cursor-pointer group"
            title="Clique para acessar a lista de estudantes"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-user-graduate"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-indigo-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {alunosAtivos.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Estudantes Ativos</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">{alunos.length} cadastrados no prontuário</span>
          </div>
        ) : isProfessor || isPAAC ? (
          <div
            onClick={() => {
              const el = document.getElementById('secao-tutorados-professor');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else if (onNavigate) onNavigate('alunos');
            }}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-cyan-300 transition-all cursor-pointer group"
            title="Clique para ver os alunos sob sua tutoria"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-users"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-cyan-700 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {tutoradosDoProfessor.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Estudantes Tutorados</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {tutoradosEmRisco.length > 0 ? `${tutoradosEmRisco.length} em alerta de frequência` : 'Sob seu acompanhamento'}
            </span>
          </div>
        ) : (
          <div
            onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-rose-300 transition-all cursor-pointer group"
            title="Clique para abrir o painel de Busca Ativa"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-magnifying-glass-location"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-rose-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-rose-600 tabular-nums mt-3">
              {alunosBuscaAtiva.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Alunos em Busca Ativa</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Freq. &lt;75% ou 3+ faltas seguidas</span>
          </div>
        )}

        {/* Bloco 3: Alertas Pedagógicos (Gestão), Chamada Hoje (Secretaria) ou Recados (Professor) */}
        {isSecretaria ? (
          <div
            onClick={() => onNavigate ? onNavigate('presenca-diaria') : window.switchTab?.('presenca-diaria')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-cyan-300 transition-all cursor-pointer group"
            title="Clique para abrir a Chamada Diária"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-clipboard-user"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-cyan-700 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {chamadaHojeStats.registrosHoje}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Chamada Diária Hoje</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {chamadaHojeStats.registrosHoje > 0
                ? `${chamadaHojeStats.presentes}P · ${chamadaHojeStats.faltas}F · ${chamadaHojeStats.justificadas}J`
                : 'Nenhuma chamada lançada hoje'}
            </span>
          </div>
        ) : (
          <div
            onClick={() => {
              if (isPdcaLeadership || isPAAC) {
                const el = document.getElementById('painel-notificacoes-pedagogicas') || document.getElementById('painel-ciencia-mural');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
                else if (onNavigate) onNavigate('registros');
              } else {
                if (onNavigate) onNavigate('mural');
                else if (typeof window.switchTab === 'function') window.switchTab('mural');
              }
            }}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-purple-300 transition-all cursor-pointer group"
            title="Clique para consultar notificações e ciências"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-bell"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-purple-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {(isPdcaLeadership || isPAAC)
                ? notificacoesPedagogicasDirecao.length
                : recadosDirecionados.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">
              {(isPdcaLeadership || isPAAC)
                ? 'Alertas Pedagógicos'
                : 'Recados Direcionados'}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {(isPdcaLeadership || isPAAC)
                ? `${notificacoesPedagogicasDirecao.length} pendente(s) da equipe`
                : `${recadosSemCienciaUsuario.length} aguardando ciência`}
            </span>
          </div>
        )}

        {/* Bloco 4: Tarefas PDCA (ênfase para Direção/Vice/CGPG) ou Agenda Escolar */}
        {isPdcaLeadership ? (
          <div
            onClick={() => {
              const el = document.getElementById('painel-executivo-pdca');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else if (onNavigate) onNavigate('rotina-pdca');
            }}
            className={`p-4 sm:p-5 rounded-2xl border shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] transition-all cursor-pointer group ${
              pdcaStats.equipe.atrasadas > 0
                ? 'bg-rose-50/70 border-rose-200 hover:border-rose-300'
                : pdcaStats.equipe.emAlerta > 0
                ? 'bg-amber-50/70 border-amber-300 hover:border-amber-400'
                : 'bg-white border-slate-200/80 hover:border-amber-300'
            }`}
            title="Clique para ir ao Painel Executivo PDCA"
          >
            <div className="flex items-center justify-between gap-2">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                pdcaStats.equipe.atrasadas > 0
                  ? 'bg-rose-500/15 text-rose-700'
                  : 'bg-amber-500/15 text-amber-700'
              }`}>
                <i className="fa-solid fa-list-check"></i>
              </div>
              <span className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-white/80 text-slate-700 border border-slate-200/70">
                {pdcaStats.equipe.taxaConclusao}% ciclo
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {pdcaStats.equipe.pendentes}
            </div>
            <span className="text-xs font-semibold text-slate-800 block mt-0.5">Rotina PDCA Pendente</span>
            <span className="text-[11px] text-slate-600 mt-0.5 block tabular-nums">
              {pdcaStats.equipe.atrasadas} atrasada(s) · {pdcaStats.equipe.emAlerta} em alerta
            </span>
          </div>
        ) : canAccessRotinaPDCA ? (
          <div
            onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-amber-300 transition-all cursor-pointer group"
            title="Clique para abrir o módulo de Tarefas (PDCA)"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-list-check"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-amber-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {tarefasFiltradas.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Minhas Tarefas PDCA</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block tabular-nums">
              {tarefasUrgentes.length > 0 ? `${tarefasUrgentes.length} vencida(s)/em alerta` : 'Rotinas e prazos no ciclo'}
            </span>
          </div>
        ) : (
          <div
            onClick={() => onNavigate ? onNavigate('agenda') : window.switchTab?.('agenda')}
            className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-indigo-300 transition-all cursor-pointer group"
            title="Clique para abrir a Agenda Escolar PEI"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-calendar-days"></i>
              </div>
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px] text-slate-300 group-hover:text-indigo-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-3">
              {eventosFuturos.length}
            </div>
            <span className="text-xs font-semibold text-slate-700 block mt-0.5">Agenda Escolar</span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Próximos eventos PEI</span>
          </div>
        )}
      </section>

      {/* CENTRAL DE LINKS E AÇÕES RÁPIDAS DE RESOLUÇÃO */}
      <section className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
              <i className="fa-solid fa-compass"></i>
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Central de Acesso Rápido</span>
                <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">· 1 clique</span>
              </h2>
              <p className="text-xs text-slate-500">
                Links diretos para resolver pendências e acessar os módulos essenciais do seu perfil.
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-indigo-700 bg-indigo-50/80 px-2.5 py-1 rounded-full border border-indigo-200/60 self-start sm:self-auto">
            Perfil: {activeRole}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {/* 1. Ocorrências */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('registros') : window.switchTab?.('registros')}
            className="p-3 bg-slate-50/70 hover:bg-rose-50/70 border border-slate-200/70 hover:border-rose-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
            <div className="mt-2.5">
              <span className="text-xs font-semibold text-slate-900 group-hover:text-rose-900 block leading-tight">
                Lançar Ocorrência
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block truncate">
                Registros pedagógicos
              </span>
            </div>
          </button>

          {/* 2. Tarefas PDCA (apenas perfis autorizados da gestão) */}
          {canAccessRotinaPDCA && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
              className="p-3 bg-slate-50/70 hover:bg-amber-50/70 border border-slate-200/70 hover:border-amber-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-list-check"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-amber-900 block leading-tight">
                  Rotina PDCA
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                  {tarefasFiltradas.length} tarefa{tarefasFiltradas.length === 1 ? '' : 's'} ativa{tarefasFiltradas.length === 1 ? '' : 's'}
                </span>
              </div>
            </button>
          )}

          {/* 3. Mural */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('mural') : window.switchTab?.('mural')}
            className="p-3 bg-slate-50/70 hover:bg-purple-50/70 border border-slate-200/70 hover:border-purple-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-bullhorn"></i>
            </div>
            <div className="mt-2.5">
              <span className="text-xs font-semibold text-slate-900 group-hover:text-purple-900 block leading-tight">
                Mural de Recados
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                {recadosSemCienciaUsuario.length > 0 ? `${recadosSemCienciaUsuario.length} sem ciência` : 'Comunicados'}
              </span>
            </div>
          </button>

          {/* 4. Alunos / Prontuário */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
            className="p-3 bg-slate-50/70 hover:bg-cyan-50/70 border border-slate-200/70 hover:border-cyan-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-user-graduate"></i>
            </div>
            <div className="mt-2.5">
              <span className="text-xs font-semibold text-slate-900 group-hover:text-cyan-900 block leading-tight">
                Buscar Estudante
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block truncate">
                RA e prontuário PEI
              </span>
            </div>
          </button>

          {/* 5. Horários / Minha Grade */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
            className="p-3 bg-slate-50/70 hover:bg-indigo-50/70 border border-slate-200/70 hover:border-indigo-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-clock"></i>
            </div>
            <div className="mt-2.5">
              <span className="text-xs font-semibold text-slate-900 group-hover:text-indigo-900 block leading-tight">
                Grade de Horários
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                {aulasHojeAtivas.length} aula(s) hoje
              </span>
            </div>
          </button>

          {/* 6. Substituição PEI (oculto para Professor comum) */}
          {!isProfessor && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('substituicao-pei') : window.switchTab?.('substituicao-pei')}
              className="p-3 bg-slate-50/70 hover:bg-amber-50/70 border border-slate-200/70 hover:border-amber-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-shuffle"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-amber-900 block leading-tight">
                  Substituições PEI
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                  {substituicoesHoje.length} registrada(s)
                </span>
              </div>
            </button>
          )}

          {/* 7. Busca Ativa (Gestão) ou Atrasos (Secretaria) */}
          {(isDirecao || isCoord || isPAAC) ? (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
              className="p-3 bg-slate-50/70 hover:bg-rose-50/70 border border-slate-200/70 hover:border-rose-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-magnifying-glass-location"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-rose-900 block leading-tight">
                  Busca Ativa SEDUC
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                  {alunosBuscaAtiva.length} em risco crítico
                </span>
              </div>
            </button>
          ) : isSecretaria ? (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('dash-pontualidade') : window.switchTab?.('dash-pontualidade')}
              className="p-3 bg-slate-50/70 hover:bg-amber-50/70 border border-slate-200/70 hover:border-amber-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-clock-rotate-left"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-amber-900 block leading-tight">
                  Atrasos no Portão
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate tabular-nums">
                  {atrasosHoje.length} hoje
                </span>
              </div>
            </button>
          ) : null}

          {/* 8. SED vs Mapão (Gestão e Secretaria) */}
          {(isDirecao || isCoord || isSecretaria) && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('dash-evasao') : window.switchTab?.('dash-evasao')}
              className="p-3 bg-slate-50/70 hover:bg-cyan-50/70 border border-slate-200/70 hover:border-cyan-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-scale-balanced"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-cyan-900 block leading-tight">
                  SED vs Mapão
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate">
                  Auditoria de notas/freq
                </span>
              </div>
            </button>
          )}

          {/* 9. Secretaria Balcão (Secretaria e Direção) */}
          {(isSecretaria || isDirecao) && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('secretaria') : window.switchTab?.('secretaria')}
              className="p-3 bg-slate-50/70 hover:bg-purple-50/70 border border-slate-200/70 hover:border-purple-200 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-building-columns"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-purple-900 block leading-tight">
                  Secretaria Escolar
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate">
                  Balcão e documentos
                </span>
              </div>
            </button>
          )}

          {/* 10. Auditoria do Sistema (Direção) */}
          {isDirecao && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('auditoria') : window.switchTab?.('auditoria')}
              className="p-3 bg-slate-50/70 hover:bg-slate-100 border border-slate-200/70 hover:border-slate-300 rounded-2xl transition-all text-left group cursor-pointer flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-500/10 text-slate-700 flex items-center justify-center text-sm group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-shield-halved"></i>
              </div>
              <div className="mt-2.5">
                <span className="text-xs font-semibold text-slate-900 block leading-tight">
                  Auditoria Geral
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block truncate">
                  Logs e integridade
                </span>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* Indicador discreto ao expandir para Modo Analítico sob demanda */}
      {modoVisualizacao === 'completo' && carregandoAnalitico && (
        <div className="bg-white rounded-2xl px-4 py-3 border border-indigo-200/80 flex items-center justify-between gap-3 text-xs text-indigo-900">
          <div className="flex items-center gap-2.5">
            <i className="fa-solid fa-arrows-rotate animate-spin text-indigo-600"></i>
            <span className="font-medium">Carregando indicadores completos, histórico de ocorrências e auditorias para o Modo Analítico...</span>
          </div>
          <span className="text-[11px] text-indigo-600 font-semibold whitespace-nowrap shrink-0">Sincronizando</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2.5. PAINEL EXECUTIVO PDCA & ROTINA DA EQUIPE (DIRETOR, VICE, CGPG) */}
      {/* ======================================================== */}
      {modoVisualizacao === 'completo' && isPdcaLeadership && (
        <section id="painel-executivo-pdca" className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-amber-200/80 border-l-4 border-l-amber-500 shadow-[0_4px_20px_-4px_rgba(245,158,11,0.10)] space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-700 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-rotate"></i>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                    Painel Executivo PDCA · Rotina da Equipe
                  </h2>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 tabular-nums">
                    {pdcaStats.equipe.taxaConclusao}% concluído no ciclo
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Acompanhamento em tempo real das rotinas diárias, semanais, mensais e anuais da equipe gestora e apoios.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setModalNovaTarefa(true)}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-plus"></i>
                <span>Nova Tarefa PDCA</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>Abrir Rotina PDCA</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>
          </div>

          {/* Barra de Progresso do Ciclo + Contadores PDCA */}
          <div className="space-y-3">
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${pdcaStats.equipe.taxaConclusao}%` }}
              ></div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => setPdcaStatusFilter('urgentes')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                  pdcaStats.equipe.atrasadas > 0
                    ? 'bg-rose-50/80 border-rose-200 hover:border-rose-300'
                    : 'bg-slate-50/70 border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <span className="text-[11px] font-semibold text-rose-700 block">Atrasadas</span>
                <span className="text-xl font-bold text-rose-700 tabular-nums">{pdcaStats.equipe.atrasadas}</span>
              </button>

              <button
                type="button"
                onClick={() => setPdcaStatusFilter('urgentes')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                  pdcaStats.equipe.emAlerta > 0
                    ? 'bg-amber-50/90 border-amber-300 hover:border-amber-400'
                    : 'bg-slate-50/70 border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <span className="text-[11px] font-semibold text-amber-800 block">Prestes a Vencer / Hoje</span>
                <span className="text-xl font-bold text-amber-800 tabular-nums">{pdcaStats.equipe.emAlerta}</span>
              </button>

              <button
                type="button"
                onClick={() => setPdcaStatusFilter('pendentes')}
                className="p-3 rounded-2xl border bg-slate-50/70 border-slate-200/80 hover:border-indigo-300 text-left transition cursor-pointer"
              >
                <span className="text-[11px] font-semibold text-slate-600 block">Pendentes no Ciclo</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{pdcaStats.equipe.pendentes}</span>
              </button>

              <button
                type="button"
                onClick={() => setPdcaStatusFilter('concluidas')}
                className="p-3 rounded-2xl border bg-emerald-50/60 border-emerald-200/70 hover:border-emerald-300 text-left transition cursor-pointer"
              >
                <span className="text-[11px] font-semibold text-emerald-800 block">Concluídas no Ciclo</span>
                <span className="text-xl font-bold text-emerald-700 tabular-nums">{pdcaStats.equipe.concluidas}</span>
              </button>
            </div>
          </div>

          {/* Controles de Escopo, Status e Breakdown por Equipe */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setPdcaScopeView('equipe')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  pdcaScopeView === 'equipe' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Visão da Equipe ({pdcaStats.equipe.total})
              </button>
              <button
                type="button"
                onClick={() => setPdcaScopeView('minhas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  pdcaScopeView === 'minhas' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Minhas Atribuições ({pdcaStats.minhas.total})
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: 'pendentes', label: 'Pendentes' },
                { key: 'urgentes', label: 'Em Alerta / Atrasadas' },
                { key: 'concluidas', label: 'Concluídas' },
                { key: 'todas', label: 'Todas' }
              ] as const).map(stOpt => (
                <button
                  key={stOpt.key}
                  type="button"
                  onClick={() => setPdcaStatusFilter(stOpt.key)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition cursor-pointer ${
                    pdcaStatusFilter === stOpt.key
                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {stOpt.label}
                </button>
              ))}
            </div>
          </div>

          {pdcaScopeView === 'equipe' && pdcaStats.porEquipe.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              <button
                type="button"
                onClick={() => setPdcaTeamFilter('TODOS')}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border whitespace-nowrap shrink-0 cursor-pointer transition ${
                  pdcaTeamFilter === 'TODOS'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Todos os Núcleos
              </button>
              {pdcaStats.porEquipe.map((eq: any) => (
                <button
                  key={eq.key}
                  type="button"
                  onClick={() => setPdcaTeamFilter(eq.key === pdcaTeamFilter ? 'TODOS' : eq.key)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border whitespace-nowrap shrink-0 cursor-pointer transition flex items-center gap-1.5 ${
                    pdcaTeamFilter === eq.key
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{eq.label}</span>
                  <span className="tabular-nums opacity-80">{eq.concluidas}/{eq.total}</span>
                  {(eq.atrasadas > 0 || eq.emAlerta > 0) && (
                    <span className={`w-2 h-2 rounded-full ${eq.atrasadas > 0 ? 'bg-rose-500' : 'bg-amber-400'}`}></span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Lista Prioritária de Execução PDCA */}
          {tarefasPainelExecutivo.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50/80 rounded-2xl border border-slate-200/70">
              <i className="fa-solid fa-circle-check text-emerald-500 text-lg block mb-1.5"></i>
              Nenhuma tarefa PDCA encontrada para os filtros selecionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {tarefasPainelExecutivo.slice(0, 8).map(tarefa => {
                const st = tarefa._statusInfo || {};
                const isDone = Boolean(st.concluida);
                const isAtrasada = !isDone && Boolean(st.atrasada);
                const isAmarelo = !isDone && !isAtrasada && Boolean(st.emAlertaAmarelo);

                return (
                  <div
                    key={tarefa.id}
                    className={`p-3.5 rounded-2xl border border-l-4 flex items-start gap-3 transition-all ${
                      isDone
                        ? 'bg-emerald-50/40 border-emerald-200/70 border-l-emerald-500 opacity-85'
                        : isAtrasada
                        ? 'bg-rose-50/75 border-rose-200 border-l-rose-500'
                        : isAmarelo
                        ? 'bg-amber-50/85 border-amber-300 border-l-amber-500'
                        : 'bg-white border-slate-200/80 border-l-indigo-500 hover:border-indigo-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => handleToggleTarefa(tarefa.id, isDone)}
                      className="mt-1 rounded text-amber-600 focus:ring-amber-500 cursor-pointer shrink-0"
                      title={isDone ? 'Reabrir tarefa' : 'Concluir tarefa no ciclo'}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-bold leading-snug ${isDone ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                          {tarefa.titulo || tarefa.descricao}
                        </p>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/90 text-slate-700 border border-slate-200/80 shrink-0">
                          {tarefa._freqKey}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`font-semibold px-2 py-0.5 rounded-full border ${
                          isDone
                            ? 'bg-emerald-100/70 text-emerald-800 border-emerald-200'
                            : isAtrasada
                            ? 'bg-rose-100 text-rose-800 border-rose-200'
                            : isAmarelo
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {st.contagemLabel || 'No prazo'}
                        </span>
                        {st.dataVencimentoLabel && (
                          <span className="text-slate-600 tabular-nums">{st.dataVencimentoLabel}</span>
                        )}
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-indigo-700 truncate max-w-[140px]">
                          {tarefa.atribuidoA || tarefa.atribuirA || 'TODA A EQUIPE'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tarefasPainelExecutivo.length > 8 && (
            <div className="pt-1 text-right">
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
                className="text-xs font-semibold text-amber-800 hover:text-amber-950 cursor-pointer"
              >
                Ver todas as {tarefasPainelExecutivo.length} tarefas no Módulo PDCA →
              </button>
            </div>
          )}
        </section>
      )}

      {/* ======================================================== */}
      {/* 3. CONTEÚDO PRINCIPAL DIVIDIDO POR CARGO */}
      {/* ======================================================== */}

      {/* A. VISÃO PROFESSOR / PAAC (e CGPG apenas quando possui aulas, tutorados ou notificações de tutoria atribuídos) */}
      {(isProfessor || isPAAC || (isCoord && (aulasHoje.length > 0 || horariosDoProfessor.length > 0 || tutoradosDoProfessor.length > 0 || substituicoesParaMimHoje.length > 0 || notificacoesTutorPendentes.length > 0))) && (
        <div className="space-y-5 sm:space-y-6">

          {/* Substituições Designadas Hoje ao Docente (se houver) */}
          {substituicoesParaMimHoje.length > 0 && (
            <section className="bg-amber-50/70 rounded-2xl sm:rounded-3xl p-5 border border-amber-300/80 border-l-4 border-l-amber-500 shadow-[0_2px_15px_-3px_rgba(245,158,11,0.08)] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-800 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-shuffle"></i>
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                      Substituições Designadas a Você Hoje ({substituicoesParaMimHoje.length})
                    </h2>
                    <p className="text-xs text-slate-600">
                      Aulas eventuais atribuídas na grade de substituições de hoje.
                    </p>
                  </div>
                </div>
                {!isProfessor && (
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('substituicao-pei') : window.switchTab?.('substituicao-pei')}
                    className="text-xs font-semibold text-amber-900 hover:underline cursor-pointer shrink-0"
                  >
                    Ver Substituições →
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {substituicoesParaMimHoje.map((sub, idx) => {
                  const pId = Number(sub.periodoId || sub.aulaNumero || 0);
                  return (
                    <div key={sub.id || idx} className="p-3 bg-white rounded-2xl border border-amber-200/80 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-amber-900 tabular-nums">
                          {pId ? `${pId}ª Aula` : 'Substituição'}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {PERIODOS_HORARIOS[pId] || sub.horario || 'Horário PEI'}
                        </span>
                      </div>
                      <p className="font-bold text-slate-900">
                        {sub.turma || 'Turma PEI'} · {sub.disciplina || 'Componente'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        Em substituição a: {sub.professorAusente || 'Docente ausente'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Horários Individuais do Professor */}
          {(!isCoord || aulasHoje.length > 0 || horariosDoProfessor.length > 0) && (
            <section className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-clock"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                      Meus Horários Individuais de Aula
                    </h2>
                    <p className="text-xs text-slate-500">
                      Aulas programadas para hoje ({DIAS_SEMANA_LABELS[diaSemanaHoje] || 'Hoje'}) e grade semanal.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
                  className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                >
                  <span>Ver Grade Completa</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>

              {aulasHoje.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs bg-slate-50/80 rounded-2xl border border-slate-200/70">
                  Nenhuma aula atribuída para {effectiveTeacher.nome} neste dia ({diaSemanaHoje}).
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {aulasHoje.map(aula => {
                    const isAtiva = isRegularTeachingClass(aula);
                    return (
                      <div
                        key={`${aula.dia}-${aula.periodoId}-${aula.turma}-${aula.disciplina || ''}`}
                        onClick={() => setModalAula(aula)}
                        className={`p-3.5 rounded-2xl border border-l-4 transition-all space-y-1.5 cursor-pointer group ${
                          isAtiva
                            ? 'bg-white border-slate-200/80 border-l-indigo-600 hover:border-indigo-300 shadow-2xs'
                            : 'bg-slate-50/80 border-slate-200/80 border-l-slate-400 opacity-85 hover:opacity-100'
                        }`}
                        title="Clique para consultar os detalhes desta aula"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 tabular-nums">
                              {aula.periodoId}ª Aula
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                isAtiva
                                  ? 'bg-emerald-50/90 text-emerald-800 border-emerald-200/70'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {isAtiva ? 'Ativa' : 'Inativa / Intervalo'}
                            </span>
                          </div>
                          <span className="text-[11px] tabular-nums font-medium text-slate-500">
                            {PERIODOS_HORARIOS[Number(aula.periodoId)] || 'Horário Integral'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-900">
                            {aula.turma && aula.turma !== '-' ? aula.turma : 'Sem Turma'}
                          </span>
                          <span className="text-xs font-medium text-slate-600 truncate max-w-[140px]">
                            {aula.disciplina || 'Componente'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center justify-between pt-0.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <i className="fa-solid fa-location-dot text-slate-400 text-[10px]"></i>
                            <span>{aula.sala && aula.sala !== '-' ? aula.sala : 'Ambiente Escolar'}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            Detalhes →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Notificações da Tutoria (Alertas de Pontualidade para Atendimento) */}
          {notificacoesTutorPendentes.length > 0 && (
            <section id="secao-notificacoes-tutoria" className="bg-amber-50/60 rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-amber-300/80 border-l-4 border-l-amber-500 shadow-[0_2px_15px_-3px_rgba(245,158,11,0.08)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/70 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-800 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-bell"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight tabular-nums">
                      Notificações de Tutoria Pendentes ({notificacoesTutorPendentes.length})
                    </h2>
                    <p className="text-xs text-slate-600">
                      Estudantes sob sua tutoria que atingiram marco de atrasos no mês. Atenda na sessão semanal de Tutoria e clique em &ldquo;Atender Notificação&rdquo;.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {notificacoesTutorPendentes.map(notif => {
                  const dtFmt = String(notif.criadoEm || notif.data || '').slice(0, 10).split('-').reverse().join('/');
                  const qtd = Number(notif.qtdAtrasos || 3);
                  return (
                    <div
                      key={notif.id}
                      className="p-4 bg-white rounded-2xl border border-amber-200/80 border-l-4 border-l-amber-500 shadow-2xs flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-100/90 text-amber-900 border border-amber-200 tabular-nums">
                            {qtd} atrasos · {notif.mesReferencia || 'Mês vigente'}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {dtFmt || 'Recente'}
                          </span>
                        </div>

                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            {notif.nomeAluno || `Estudante RA ${notif.ra}`}
                          </h3>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            {notif.turma || 'Sem turma'} · RA: {notif.ra} · Tutor(a): {notif.tutorResponsavel || effectiveTeacher.nome}
                          </p>
                        </div>

                        <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 leading-relaxed">
                          {notif.mensagem || notif.titulo}
                        </p>

                        <input
                          type="text"
                          value={obsAtendimentoNotif[notif.id] || ''}
                          onChange={(e) => setObsAtendimentoNotif(prev => ({ ...prev, [notif.id]: e.target.value }))}
                          placeholder="Anotação rápida do atendimento na tutoria (opcional)..."
                          className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white"
                        />
                      </div>

                      <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof window.abrirFichaAluno === 'function') window.abrirFichaAluno(notif.ra);
                              else if (typeof window.navegarEAbrirFichaAluno === 'function') window.navegarEAbrirFichaAluno(notif.ra);
                            }}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:text-indigo-950 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors cursor-pointer"
                          >
                            Ver Ficha
                          </button>
                          {typeof window.emitirTermoCienciaFrequenciaGatilho === 'function' && (
                            <button
                              type="button"
                              onClick={() => window.emitirTermoCienciaFrequenciaGatilho?.(notif.ra, qtd)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1"
                              title="Gerar Termo de Ciência de Frequência para assinatura"
                            >
                              <i className="fa-solid fa-print text-[10px]"></i>
                              <span>Termo de Ciência</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAtenderNotificacaoTutor(notif.id)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <i className="fa-solid fa-check text-[11px]"></i>
                          <span>Atender Notificação</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Informações sobre seus Tutorados (Modo Analítico) */}
          {modoVisualizacao === 'completo' && (!isCoord || tutoradosDoProfessor.length > 0) && (
            <section id="secao-tutorados-professor" className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-user-graduate"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight tabular-nums">
                      Meus Estudantes Tutorados ({tutoradosDoProfessor.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      Acompanhamento individual de rendimento, frequência e Projeto de Vida.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
                  className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                >
                  <span>Módulo Alunos Completo</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>

              {tutoradosDoProfessor.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-slate-50/80 rounded-2xl border border-slate-200/70 space-y-2">
                  <i className="fa-solid fa-id-card-clip text-2xl text-slate-400 block"></i>
                  <p>Nenhum aluno vinculado ao tutor {effectiveTeacher.nome} no momento.</p>
                  <p className="text-[11px] text-slate-400">
                    Você pode vincular estudantes na aba Alunos ou selecionar outro docente acima.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {tutoradosDoProfessor.slice(0, 12).map(aluno => {
                    const freqNum: number | null = aluno._freqNum ?? null;
                    const faltasSeq: number = Number(aluno._faltasConsecutivas || 0);
                    const isAlerta = (freqNum !== null && freqNum < 75) || faltasSeq >= 3;

                    return (
                      <div
                        key={aluno.id || aluno.ra}
                        onClick={() => setModalAluno(aluno)}
                        className={`p-3.5 bg-white rounded-2xl border border-l-4 transition-all flex flex-col justify-between space-y-2 cursor-pointer group shadow-2xs ${
                          isAlerta ? 'border-slate-200/80 border-l-rose-500 hover:border-rose-300' : 'border-slate-200/80 border-l-cyan-500 hover:border-cyan-300'
                        }`}
                        title="Clique para consultar os dados deste tutorado"
                      >
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {aluno.nome}
                            </span>
                            <span className="text-[10px] tabular-nums font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 shrink-0">
                              {aluno.turma}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums flex items-center justify-between gap-2">
                            <span>RA: {aluno.ra}</span>
                            {faltasSeq >= 3 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                {faltasSeq} faltas seguidas
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600 line-clamp-1">
                            <span className="text-slate-400">Projeto de Vida:</span>{' '}
                            {aluno.projetoDeVida || aluno.sonhos || 'Não preenchido'}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className={`tabular-nums ${
                              freqNum === null ? 'text-slate-400' : isAlerta ? 'text-rose-600' : 'text-emerald-700'
                            }`}>
                              {freqNum !== null ? `${freqNum.toFixed(1).replace('.', ',')}%` : 'Sem registro'}
                            </span>
                            <span className="text-[11px] text-slate-400 font-normal">Frequência</span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (typeof window.abrirFichaAluno === 'function') {
                                window.abrirFichaAluno(aluno.ra);
                              } else if (typeof window.navegarEAbrirFichaAluno === 'function') {
                                window.navegarEAbrirFichaAluno(aluno.ra);
                              }
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-cyan-800 hover:text-cyan-950 bg-cyan-50/90 hover:bg-cyan-100 rounded-xl transition-colors cursor-pointer"
                          >
                            Ver Ficha
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* B. VISÃO SECRETARIA */}
      {activeRole === 'SECRETARIA' && (
        <div className="space-y-5 sm:space-y-6">

          {/* 1. Local para Registrar os Atrasos */}
          <section className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-clock-rotate-left"></i>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  Registro de Entrada com Atraso
                </h2>
                <p className="text-xs text-slate-500">
                  Lance a chegada tardia do estudante para cômputo imediato no sistema e emissão do comprovante.
                </p>
              </div>
            </div>

            <form onSubmit={handleRegistrarAtraso} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Busca e Seleção do Aluno */}
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Buscar Aluno (Nome ou RA):
                  </label>
                  <input
                    type="text"
                    value={buscaAlunoAtraso}
                    onChange={(e) => setBuscaAlunoAtraso(e.target.value)}
                    placeholder="Digite para filtrar..."
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                  {buscaAlunoAtraso.length >= 2 && (
                    <div className="max-h-36 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-md mt-1 divide-y divide-slate-100">
                      {alunos
                        .filter(a => {
                          const t = buscaAlunoAtraso.toLowerCase();
                          return String(a.nome || '').toLowerCase().includes(t) || String(a.ra || '').includes(t);
                        })
                        .slice(0, 5)
                        .map(a => (
                          <div
                            key={a.id || a.ra}
                            onClick={() => {
                              setAlunoSelecionadoAtraso(a);
                              setBuscaAlunoAtraso(`${a.nome} (${a.turma})`);
                            }}
                            className="p-2.5 text-xs hover:bg-amber-50/70 cursor-pointer flex justify-between items-center"
                          >
                            <span className="font-semibold text-slate-800 truncate">{a.nome}</span>
                            <span className="text-[11px] tabular-nums text-slate-500 shrink-0">{a.turma}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {alunoSelecionadoAtraso && (
                    <div className="text-[11px] text-emerald-800 bg-emerald-50/90 p-2.5 rounded-xl border border-emerald-200/70 border-l-4 border-l-emerald-500 mt-1">
                      <strong>Selecionado:</strong> {alunoSelecionadoAtraso.nome} · RA {alunoSelecionadoAtraso.ra} ({alunoSelecionadoAtraso.turma})
                    </div>
                  )}
                </div>

                {/* Horário de Entrada e Motivo */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Horário da Entrada:
                  </label>
                  <input
                    type="time"
                    value={horarioAtraso}
                    onChange={(e) => setHorarioAtraso(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 tabular-nums font-semibold"
                  />

                  <label className="text-xs font-semibold text-slate-700 block mt-2">
                    Motivo do Atraso:
                  </label>
                  <select
                    value={motivoAtraso}
                    onChange={(e) => setMotivoAtraso(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
                  >
                    <option value="Transporte / Trânsito">Transporte / Trânsito</option>
                    <option value="Consulta Médica / Odontológica">Consulta Médica / Odontológica</option>
                    <option value="Problemas Pessoais / Familiares">Problemas Pessoais / Familiares</option>
                    <option value="Acordou Tarde">Acordou Tarde</option>
                    <option value="Sem Justificativa">Sem Justificativa</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>

                {/* Justificativa e Ação */}
                <div className="space-y-1.5 flex flex-col justify-between">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Observações / Justificativa Adicional:
                    </label>
                    <textarea
                      rows={2}
                      value={obsAtraso}
                      onChange={(e) => setObsAtraso(e.target.value)}
                      placeholder="Ex: Apresentou atestado da UBS..."
                      className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer mt-1.5">
                      <input
                        type="checkbox"
                        checked={justificadoAtraso}
                        onChange={(e) => setJustificadoAtraso(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span>Atraso devidamente justificado com documento</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={salvandoAtraso}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa-solid fa-check"></i>
                    <span>{salvandoAtraso ? 'Registrando...' : 'Registrar Atraso & Emitir Comprovante'}</span>
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* 1.5. Resumo Real da Chamada Diária de Hoje */}
          {!isProfessor && (
            <section className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 border-l-4 border-l-cyan-500 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-lg shrink-0">
                    <i className="fa-solid fa-clipboard-user"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                      Chamada Diária &amp; Frequência em Tempo Real
                    </h2>
                    <p className="text-xs text-slate-500">
                      Resumo operacional dos registros lançados hoje ({new Date().toLocaleDateString('pt-BR')}) em todas as turmas.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate ? onNavigate('presenca-diaria') : window.switchTab?.('presenca-diaria')}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition shadow-2xs flex items-center gap-2 cursor-pointer shrink-0 self-start sm:self-auto"
                >
                  <i className="fa-solid fa-clipboard-check text-cyan-400"></i>
                  <span>Abrir Chamada Diária</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs">
                <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/70">
                  <span className="text-[11px] font-medium text-slate-500 block">Registros Hoje</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">{chamadaHojeStats.registrosHoje}</span>
                </div>
                <div className="p-3 bg-emerald-50/60 rounded-2xl border border-emerald-200/70">
                  <span className="text-[11px] font-medium text-emerald-700 block">Presentes</span>
                  <span className="text-lg font-bold text-emerald-700 tabular-nums">{chamadaHojeStats.presentes}</span>
                </div>
                <div className="p-3 bg-rose-50/60 rounded-2xl border border-rose-200/70">
                  <span className="text-[11px] font-medium text-rose-700 block">Faltas Hoje</span>
                  <span className="text-lg font-bold text-rose-700 tabular-nums">{chamadaHojeStats.faltas}</span>
                </div>
                <div className="p-3 bg-amber-50/60 rounded-2xl border border-amber-200/70">
                  <span className="text-[11px] font-medium text-amber-800 block">Justificadas / Licenças</span>
                  <span className="text-lg font-bold text-amber-800 tabular-nums">{chamadaHojeStats.justificadas}</span>
                </div>
              </div>
            </section>
          )}

          {/* 2. Dash dos Atrasos da Secretaria e Documentos (Modo Analítico) */}
          {modoVisualizacao === 'completo' && (
          <>
          <section className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                  <i className="fa-solid fa-chart-line"></i>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                    Dashboard de Atrasos &amp; Assiduidade
                  </h2>
                  <p className="text-xs text-slate-500">
                    Visão executiva das chegadas tardias hoje e no mês vigente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('dash-pontualidade') : window.switchTab?.('dash-pontualidade')}
                className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <span>Dashboard Completo de Atrasos</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 tabular-nums">
                  <i className="fa-solid fa-list-check text-slate-500"></i>
                  Últimos Atrasos Registrados Hoje ({atrasosHoje.length})
                </span>

                {atrasosHoje.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Nenhum atraso registrado hoje até o momento.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/70 max-h-48 overflow-y-auto">
                    {atrasosHoje.slice(0, 6).map(o => (
                      <div key={o.id} className="py-2.5 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-900 truncate">
                            {o.nomeAluno || o.alunoNome || `RA: ${o.ra}`}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {o.turma} · {o.motivo || o.descricao || 'Atraso'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="tabular-nums font-semibold text-slate-800">
                            {o.horarioAtraso || o.hora || '—'}
                          </span>
                          <span className={`block text-[11px] font-medium ${o.justificado ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {o.justificado ? 'Justificado' : 'Sem justificativa'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <i className="fa-solid fa-users text-slate-500"></i>
                  Turmas com Mais Atrasos no Mês
                </span>

                {turmasMaisAtrasos.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Sem dados suficientes no mês.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {turmasMaisAtrasos.map(([turma, count]) => (
                      <div key={turma} className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700">{turma}</span>
                        <span className="tabular-nums font-semibold text-slate-900 bg-white px-2.5 py-0.5 rounded-full border border-slate-200/80">
                          {count} registros
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 3. Geração de Documentos de Secretaria */}
          <section className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-file-contract"></i>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  Emissão Rápida de Documentos Oficiais
                </h2>
                <p className="text-xs text-slate-500">
                  Gere atestados, declarações e guias formatadas para impressão oficial com 1 clique.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Tipo de Documento:</label>
                <select
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value as any)}
                  className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                >
                  <option value="matricula">Atestado de Matrícula</option>
                  <option value="frequencia">Declaração de Frequência</option>
                  <option value="transferencia">Guia de Transferência</option>
                  <option value="comparecimento">Comparecimento do Responsável</option>
                </select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-slate-700">Aluno Solicitante:</label>
                <input
                  type="text"
                  value={buscaAlunoDoc}
                  onChange={(e) => setBuscaAlunoDoc(e.target.value)}
                  placeholder="Digite nome ou RA do aluno..."
                  className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                {buscaAlunoDoc.length >= 2 && (
                  <div className="max-h-36 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-md mt-1 divide-y divide-slate-100">
                    {alunos
                      .filter(a => {
                        const t = buscaAlunoDoc.toLowerCase();
                        return String(a.nome || '').toLowerCase().includes(t) || String(a.ra || '').includes(t);
                      })
                      .slice(0, 5)
                      .map(a => (
                        <div
                          key={a.id || a.ra}
                          onClick={() => {
                            setAlunoSelecionadoDoc(a);
                            setBuscaAlunoDoc(`${a.nome} (${a.turma})`);
                          }}
                          className="p-2.5 text-xs hover:bg-indigo-50/70 cursor-pointer flex justify-between items-center"
                        >
                          <span className="font-semibold text-slate-800 truncate">{a.nome}</span>
                          <span className="text-[11px] tabular-nums text-slate-500 shrink-0">{a.turma}</span>
                        </div>
                      ))}
                  </div>
                )}
                {alunoSelecionadoDoc && (
                  <div className="text-[11px] text-indigo-900 bg-indigo-50/80 p-2.5 rounded-xl border border-indigo-200/60 border-l-4 border-l-indigo-500 mt-1">
                    <strong>Selecionado:</strong> {alunoSelecionadoDoc.nome} · RA {alunoSelecionadoDoc.ra} ({alunoSelecionadoDoc.turma})
                  </div>
                )}
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleGerarDocumento}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-print"></i>
                  <span>Visualizar &amp; Imprimir</span>
                </button>
              </div>
            </div>

            {tipoDocumento === 'comparecimento' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Nome do Pai / Mãe / Responsável:</label>
                  <input
                    type="text"
                    value={nomeResponsavelDoc}
                    onChange={(e) => setNomeResponsavelDoc(e.target.value)}
                    placeholder="Nome completo do responsável..."
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Horário de Permanência na Escola:</label>
                  <input
                    type="text"
                    value={periodoDoc}
                    onChange={(e) => setPeriodoDoc(e.target.value)}
                    placeholder="Ex: 08:00 às 09:30"
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
              </div>
            )}
          </section>
          </>
          )}
        </div>
      )}

      {/* C. VISÃO GESTÃO: PAAC, CGPG, VICE-DIREÇÃO, SÊNIOR/GOE E DIREÇÃO (MODO ANALÍTICO) */}
      {modoVisualizacao === 'completo' && ['PAAC', 'CGPG', 'VICE_DIRETOR', 'SENIOR_GOE', 'DIRETOR'].includes(activeRole) && (
        <div className="space-y-5 sm:space-y-6">

          {/* MONITORAMENTO DE LEITURA & CIÊNCIA NO MURAL */}
          <section id="painel-ciencia-mural" className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-sm shrink-0">
                  <i className="fa-solid fa-eye"></i>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                    Monitoramento de Leitura &amp; Ciência no Mural
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Verifique quem ainda não deu ciência nos comunicados oficiais ativos.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-medium text-slate-500">Comunicado:</span>
                <select
                  value={activeRecadoForMonitor?.id || ''}
                  onChange={(e) => setRecadoSelecionadoMonitor(e.target.value)}
                  disabled={recadosAtivos.length === 0}
                  className="px-3 py-2 text-xs bg-purple-50/80 border border-purple-200/70 text-purple-900 font-semibold rounded-xl outline-none focus:ring-2 focus:ring-purple-500/30 cursor-pointer max-w-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {recadosAtivos.length === 0 ? (
                    <option value="">Nenhum comunicado ativo</option>
                  ) : (
                    recadosAtivos.map(r => {
                      const especCount = Array.isArray(r.destinatarios_especificos) ? r.destinatarios_especificos.length : 0;
                      return (
                        <option key={r.id} value={r.id}>
                          {r.titulo} {especCount > 0 ? `(${especCount} marcados)` : ''}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>
            </div>

            {recadosAtivos.length === 0 ? (
              <div className="p-6 text-center text-xs font-medium text-slate-500 bg-slate-50/80 rounded-2xl border border-slate-200/70 space-y-1">
                <i className="fa-solid fa-inbox text-2xl text-slate-400 mb-1 block"></i>
                <p className="text-slate-700 font-semibold">Nenhum comunicado ativo no Mural no momento.</p>
                <p className="text-[11px] text-slate-400">Apenas comunicados ativos da escola são exibidos para acompanhamento de ciência docente.</p>
              </div>
            ) : (
              <>
                <div className="bg-purple-50/60 p-4 rounded-2xl border border-purple-200/60 border-l-4 border-l-purple-600 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs font-semibold text-purple-950">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">
                        {analiseCienciaProfessores.cientes} de {analiseCienciaProfessores.totalProfs} {analiseCienciaProfessores.totalProfs === 1 ? 'docente ciente' : 'professores cientes'}
                      </span>
                      {analiseCienciaProfessores.publicoDescricao && (
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                          analiseCienciaProfessores.isRestrito
                            ? 'bg-amber-50/90 text-amber-900 border-amber-200/70'
                            : 'bg-purple-100/80 text-purple-900 border-purple-200/70'
                        }`}>
                          <i className={`fa-solid ${analiseCienciaProfessores.isRestrito ? 'fa-user-tag text-amber-700' : 'fa-users text-purple-700'} mr-1 text-[10px]`}></i>
                          {analiseCienciaProfessores.publicoDescricao}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-sm font-bold">{analiseCienciaProfessores.taxa}% de adesão</span>
                  </div>
                  <div className="w-full bg-purple-200/70 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${analiseCienciaProfessores.taxa}%` }}
                    ></div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 tabular-nums">
                      <i className="fa-solid fa-user-xmark text-rose-500"></i>
                      {analiseCienciaProfessores.isRestrito ? 'Docentes marcados' : 'Professores'} pendentes neste comunicado ({analiseCienciaProfessores.pendentesCount}):
                    </h3>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={filtroProfPendentes}
                        onChange={(e) => setFiltroProfPendentes(e.target.value)}
                        placeholder="Filtrar professor..."
                        className="py-1.5 px-3 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500/20"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nomes = analiseCienciaProfessores.profsPendentes.map(p => p.nome).join('\n');
                          navigator.clipboard.writeText(nomes);
                          if (typeof (window as any).showToast === 'function') {
                            (window as any).showToast('Lista de professores pendentes copiada para a área de transferência!', 'success');
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200/70 rounded-xl transition cursor-pointer shrink-0"
                      >
                        <i className="fa-solid fa-copy mr-1"></i>
                        Copiar Lista
                      </button>
                    </div>
                  </div>

                  {analiseCienciaProfessores.profsPendentes.length === 0 ? (
                    <div className="p-4 text-center text-xs font-semibold text-emerald-800 bg-emerald-50/90 rounded-2xl border border-emerald-200/70 border-l-4 border-l-emerald-500">
                      <i className="fa-solid fa-circle-check text-base mr-2 text-emerald-600"></i>
                      Todos os professores {analiseCienciaProfessores.isRestrito ? 'marcados para este comunicado' : 'da escola'} já deram ciência neste comunicado oficial.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                      {analiseCienciaProfessores.profsPendentes
                        .filter(p => !filtroProfPendentes || p.nome.toLowerCase().includes(filtroProfPendentes.toLowerCase()))
                        .map(p => (
                          <div
                            key={p.id || p.nome}
                            className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/80 border-l-4 border-l-rose-400 flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 pr-1">
                              <p className="font-semibold text-slate-800 truncate">{p.nome}</p>
                              <p className="text-[11px] text-slate-500 truncate">{p.disciplina || p.cargo || 'Docente'}</p>
                            </div>
                            <span className="text-[11px] font-semibold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/70 shrink-0">
                              Pendente
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {/* PAINEL PRIORITÁRIO: NOTIFICAÇÕES PEDAGÓGICAS DOS PROFESSORES */}
          {['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'PAAC', 'CGPG'].includes(activeRole) && (
            <section id="painel-notificacoes-pedagogicas" className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-base shrink-0">
                    <i className="fa-solid fa-bell"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2 flex-wrap">
                      <span>Notificações Pedagógicas (Direção, Vice, PAAC e CGPG)</span>
                      {notificacoesPedagogicasDirecao.length > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200/70 tabular-nums">
                          {notificacoesPedagogicasDirecao.length} pendente{notificacoesPedagogicasDirecao.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Alertas urgentes e ocorrências pedagógicas registradas pelos professores demandando ciência da gestão.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('registros');
                    else if (typeof window.switchTab === 'function') window.switchTab('registros');
                  }}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-900 flex items-center gap-1.5 cursor-pointer bg-rose-50/90 hover:bg-rose-100 px-3 py-1.5 rounded-xl border border-rose-200/70 transition self-start sm:self-auto"
                >
                  <span>Módulo de Registros</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>

              {notificacoesPedagogicasDirecao.length === 0 ? (
                <div className="p-5 text-center text-xs font-semibold text-emerald-800 bg-emerald-50/90 rounded-2xl border border-emerald-200/70 border-l-4 border-l-emerald-500 flex items-center justify-center gap-2">
                  <i className="fa-solid fa-circle-check text-base text-emerald-600"></i>
                  <span>Nenhuma notificação pedagógica pendente de atendimento da equipe docente no momento.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {notificacoesPedagogicasDirecao.map(notif => (
                    <div
                      key={notif.id}
                      className="p-4 bg-rose-50/40 rounded-2xl border border-rose-200/70 border-l-4 border-l-rose-500 hover:bg-white transition-all space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[11px] font-semibold text-rose-800 bg-rose-100/80 px-2 py-0.5 rounded-full border border-rose-200/60 inline-block mb-1">
                            {notif.tipo || 'Questão Pedagógica'}
                          </span>
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {notif.nomeAluno || (notif.ra ? `RA ${notif.ra}` : 'Estudante')}
                          </h3>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            Turma: <strong className="text-slate-700">{notif.turma || 'Não informada'}</strong> · RA: {notif.ra || '—'}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                          {(notif.notificadoEm || notif.data || notif.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded-xl border border-slate-200/70 line-clamp-3">
                        {notif.descricao || notif.conteudo || 'Sem descrição cadastrada'}
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-rose-100/80">
                        <span className="text-slate-500 truncate max-w-[180px]">
                          Por: <strong className="text-slate-800">{notif.autor_nome || notif.autor || 'Docente'}</strong>
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setModalOcorrencia(notif)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer"
                          >
                            Ver Detalhes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAtenderNotificacaoPedagogica(notif.id)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition cursor-pointer flex items-center gap-1"
                          >
                            <i className="fa-solid fa-check"></i>
                            <span>Atender</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* BUSCA ATIVA & OCORRÊNCIAS RECENTES (Direção, Vice-Direção e CGPG) */}
          {isPdcaLeadership && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">

              {/* Painel de Busca Ativa */}
              <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-xs shrink-0">
                        <i className="fa-solid fa-magnifying-glass-location"></i>
                      </div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        Casos Críticos de Busca Ativa
                      </h2>
                      <span className="text-xs tabular-nums font-semibold text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200/60">
                        {alunosBuscaAtiva.length} em alerta
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <label htmlFor="filtro-ba-home" className="text-[11px] font-medium text-slate-500">Filtro:</label>
                      <select
                        id="filtro-ba-home"
                        value={filtroStatusBuscaAtiva}
                        onChange={(e) => setFiltroStatusBuscaAtiva(e.target.value as any)}
                        className="text-xs font-semibold py-1 px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 outline-none focus:ring-2 focus:ring-rose-400/30 cursor-pointer"
                      >
                        <option value="ATIVOS">Apenas Alunos Ativos (Padrão)</option>
                        <option value="TODOS">Todos os Alunos (Inclui Inativos)</option>
                        <option value="INATIVOS">Apenas Inativos / Evadidos</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Estudantes com baixa frequência (&lt;75%) ou 3+ faltas consecutivas demandando intervenção imediata (Resolução SEDUC-SP).
                  </p>

                  <div className="divide-y divide-slate-100 mt-3 max-h-64 overflow-y-auto">
                    {alunosBuscaAtiva.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        <i className="fa-solid fa-circle-check text-emerald-500 mr-1.5 text-sm"></i>
                        Nenhum estudante em gatilho de Busca Ativa encontrado para este filtro.
                      </div>
                    ) : (
                      alunosBuscaAtiva.slice(0, 12).map(aluno => (
                        <div
                          key={aluno.id || aluno.ra}
                          onClick={() => setModalAluno(aluno)}
                          className="py-2.5 px-2.5 flex items-center justify-between text-xs hover:bg-rose-50/50 rounded-xl transition-colors cursor-pointer group"
                          title="Clique para consultar os detalhes deste estudante"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-semibold text-slate-900 group-hover:text-rose-900 truncate">{aluno.nome}</p>
                              {!isAlunoAtivo(aluno) && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/70 shrink-0">
                                  {aluno.status || aluno.situacao || 'INATIVO'}
                                </span>
                              )}
                              {aluno._faltasConsecutivas >= 3 && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 shrink-0 tabular-nums">
                                  {aluno._faltasConsecutivas} faltas seguidas
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 tabular-nums">
                              {aluno.turma} · RA {aluno.ra}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="tabular-nums font-bold text-rose-600">
                              {aluno._freqNum !== null && aluno._freqNum !== undefined
                                ? `${aluno._freqNum.toFixed(1).replace('.', ',')}%`
                                : 'Sem %'}
                            </span>
                            <span className="block text-[11px] font-semibold text-indigo-700 group-hover:underline mt-0.5">
                              Ver Ficha →
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
                    className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Módulo de Busca Ativa SEDUC ({alunosBuscaAtiva.length})</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </section>

              {/* Feed de Ocorrências Recentes */}
              <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xs shrink-0">
                        <i className="fa-solid fa-shield-halved"></i>
                      </div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        Ocorrências Recentes
                      </h2>
                    </div>
                    <span className="text-xs tabular-nums font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                      {ocorrencias.length} no total
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Últimos registros pedagógicos e disciplinares registrados pela equipe escolar.
                  </p>

                  <div className="divide-y divide-slate-100 mt-3 max-h-64 overflow-y-auto">
                    {ocorrencias.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">
                        Nenhuma ocorrência registrada até o momento.
                      </div>
                    ) : (
                      ocorrencias.slice(0, 6).map(oc => (
                        <div
                          key={oc.id}
                          onClick={() => setModalOcorrencia(oc)}
                          className="py-2.5 px-2.5 text-xs space-y-0.5 hover:bg-indigo-50/40 rounded-xl transition-colors cursor-pointer group"
                          title="Clique para consultar os detalhes desta ocorrência"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 group-hover:text-indigo-900 truncate">
                              {oc.nomeAluno || (oc.ra ? `RA: ${oc.ra}` : 'Geral')}
                            </span>
                            <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                              {(oc.criadoEm || oc.data || '').slice(0, 10)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 line-clamp-1">
                            <strong className="text-slate-700">{oc.tipo || 'Ocorrência'}:</strong>{' '}
                            {oc.descricao || 'Sem descrição'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('registros') : window.switchTab?.('registros')}
                    className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Ver Todos os Registros</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </section>

            </div>
          )}

          {/* COBERTURA DOCENTE / SUBSTITUIÇÕES PEI & PONTUALIDADE / MAPÃO (Dados Reais) */}
          {(isPdcaLeadership || isPAAC) && (
            <div className={`grid grid-cols-1 ${isPdcaLeadership ? 'lg:grid-cols-2' : ''} gap-5 sm:gap-6`}>

              {/* Cobertura Docente & Substituições PEI Hoje */}
              <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-xs shrink-0">
                        <i className="fa-solid fa-shuffle"></i>
                      </div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight">
                        Cobertura Docente &amp; Substituições Hoje
                      </h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {substituicoesPendentesHoje.length > 0 && (
                        <span className="text-[11px] tabular-nums font-bold text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
                          {substituicoesPendentesHoje.length} sem substituto
                        </span>
                      )}
                      <span className="text-xs tabular-nums font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200/60">
                        {substituicoesHoje.length} hoje
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Aulas em substituição eventual registradas para a jornada integral de hoje.
                  </p>

                  {substituicoesHoje.length === 0 ? (
                    <div className="py-6 text-center text-xs text-emerald-700 bg-emerald-50/60 rounded-2xl border border-emerald-200/60 mt-3">
                      <i className="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i>
                      Quadro docente completo — nenhuma substituição eventual registrada hoje.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 mt-3 max-h-56 overflow-y-auto">
                      {substituicoesHoje.slice(0, 8).map((sub, idx) => {
                        const subNome = String(sub.professorSubstituto || '').trim();
                        const semSub = !subNome || ['A DEFINIR', '-', 'SEM SUBSTITUTO', 'PENDENTE'].includes(subNome.toUpperCase());
                        const pId = Number(sub.periodoId || sub.aulaNumero || 0);
                        return (
                          <div key={sub.id || idx} className="py-2.5 px-2 flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 truncate">
                                {pId ? `${pId}ª Aula · ` : ''}{sub.turma || 'Turma'} · {sub.disciplina || 'Componente'}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                Ausente: {sub.professorAusente || 'Não informado'}
                              </p>
                            </div>
                            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${
                              semSub
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {semSub ? 'A definir' : subNome}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('substituicao-pei') : window.switchTab?.('substituicao-pei')}
                    className="text-xs font-semibold text-amber-700 hover:text-amber-900 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Motor de Substituição PEI</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </section>

              {/* Pontualidade & Fechamento Bimestral (Direção, Vice-Direção e CGPG) */}
              {isPdcaLeadership && (
                <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center text-xs shrink-0">
                          <i className="fa-solid fa-chart-column"></i>
                        </div>
                        <h2 className="text-base font-bold text-slate-900 tracking-tight">
                          Pontualidade &amp; Mapão Bimestral
                        </h2>
                      </div>
                      <span className="text-xs tabular-nums font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                        {alunosAtivos.length} ativos
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 mt-3 text-center">
                      <div className="p-3 rounded-2xl bg-amber-50/80 border border-amber-200/70">
                        <p className="text-lg font-extrabold text-amber-900 tabular-nums">{atrasosHoje.length}</p>
                        <p className="text-[11px] font-medium text-amber-700">Atrasos hoje</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                        <p className="text-lg font-extrabold text-slate-900 tabular-nums">{atrasosMes.length}</p>
                        <p className="text-[11px] font-medium text-slate-500">Atrasos no mês</p>
                      </div>
                      <div className="p-3 rounded-2xl bg-cyan-50/80 border border-cyan-200/70">
                        <p className="text-lg font-extrabold text-cyan-900 tabular-nums">{alunosMapaoPendentes.length}</p>
                        <p className="text-[11px] font-medium text-cyan-700">Pend. Mapão</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-600">
                        Turmas com mais atrasos no mês:
                      </p>
                      {turmasMaisAtrasos.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2">Sem ocorrências de atraso registradas no mês vigente.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {turmasMaisAtrasos.map(([turma, qtd]) => (
                            <span key={turma} className="text-[11px] font-semibold px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 tabular-nums">
                              {turma}: <strong>{qtd}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onNavigate ? onNavigate('dash-pontualidade') : window.switchTab?.('dash-pontualidade')}
                      className="text-xs font-semibold text-amber-700 hover:text-amber-900 flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Painel Pontualidade</span>
                      <i className="fa-solid fa-arrow-right text-[10px]"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate ? onNavigate('dash-evasao') : window.switchTab?.('dash-evasao')}
                      className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Auditoria SED vs Mapão</span>
                      <i className="fa-solid fa-arrow-right text-[10px]"></i>
                    </button>
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. SEÇÕES UNIVERSAIS RELEVANTES: MURAL, TAREFAS & AGENDA (MODO ANALÍTICO) */}
      {/* ======================================================== */}
      {modoVisualizacao === 'completo' ? (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">

        {/* COLUNA 1 & 2: Mensagens Direcionadas do Mural */}
        <section className="lg:col-span-2 bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-sm shrink-0">
                <i className="fa-solid fa-bullhorn"></i>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight tabular-nums">
                  Mensagens Direcionadas a Mim ({recadosDirecionados.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Avisos e orientações institucionais direcionados ao seu perfil.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('mural') : window.switchTab?.('mural')}
              className="text-xs font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <span>Mural Completo</span>
              <i className="fa-solid fa-arrow-right text-[10px]"></i>
            </button>
          </div>

          {recadosDirecionados.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50/80 rounded-2xl border border-slate-200/70">
              <i className="fa-regular fa-bell-slash text-2xl text-slate-400 block mb-2"></i>
              Nenhum aviso ativo direcionado especificamente a você no momento.
            </div>
          ) : (
            <div className="space-y-3">
              {recadosDirecionados.slice(0, 4).map(recado => {
                const deuCiencia = typeof window.usuarioDeuCienteRecado === 'function'
                  ? window.usuarioDeuCienteRecado(recado, { ...currentUser, cargo: activeRole })
                  : (recado.cientes || []).some((c: any) => c.email === currentUser.email || c.nome === currentUser.nome);

                return (
                  <div
                    key={recado.id}
                    className={`p-4 rounded-2xl border border-l-4 transition-all space-y-2.5 ${
                      deuCiencia
                        ? 'border-slate-200/80 border-l-emerald-500 bg-slate-50/40'
                        : 'border-purple-200/70 border-l-purple-600 bg-purple-50/30 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                          {recado.titulo}
                        </h3>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          <span>{recado.autor || 'Gestão Escolar'}</span>
                          <span>·</span>
                          <span>{new Date(recado.criadoEm || recado.data || Date.now()).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>

                      {deuCiencia ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-emerald-800 bg-emerald-50/90 border border-emerald-200/70 shrink-0">
                          <i className="fa-solid fa-check"></i>
                          Ciência Registrada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConfirmarCiencia(recado.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <i className="fa-solid fa-check"></i>
                          <span>Dar Ciência</span>
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed line-clamp-3">
                      {recado.conteudo || recado.mensagem || recado.descricao}
                    </p>

                    <div className="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        Público: <strong className="text-slate-700">{recado.destinatarios || 'Equipe Escolar'}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setModalRecado(recado)}
                        className="font-semibold text-purple-700 hover:underline cursor-pointer"
                      >
                        Ler Comunicado Completo
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* COLUNA 3: Tarefas & Agenda Integradas */}
        <div className="space-y-5 sm:space-y-6">

          {/* Painel compacto de Tarefas PDCA para PAAC (Direção, Vice e CGPG já possuem o Painel Executivo PDCA acima) */}
          {isPAAC && (
            <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-xs shrink-0">
                    <i className="fa-solid fa-list-check"></i>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 tracking-tight">
                      Minhas Tarefas PDCA
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      {pdcaStats.minhas.atrasadas > 0 || pdcaStats.minhas.emAlerta > 0
                        ? `${pdcaStats.minhas.atrasadas} atrasada(s) · ${pdcaStats.minhas.emAlerta} prestes a vencer`
                        : 'Prazos e rotinas atribuídas'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalNovaTarefa(true)}
                  className="w-8 h-8 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/70 flex items-center justify-center font-semibold text-xs cursor-pointer transition"
                  title="Adicionar Tarefa Rápida"
                >
                  <i className="fa-solid fa-plus"></i>
                </button>
              </div>

              {tarefasFiltradas.length === 0 ? (
                <p className="text-xs text-emerald-700 bg-emerald-50/70 rounded-2xl py-4 px-3 text-center font-medium">
                  Todas as suas tarefas do ciclo vigente foram concluídas.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {tarefasFiltradas.slice(0, 6).map(tarefa => {
                    const st = tarefa._statusInfo;
                    const cardStyle = st?.atrasada
                      ? 'bg-rose-50/60 border-rose-200 border-l-rose-500 text-slate-900'
                      : st?.emAlertaAmarelo
                        ? 'bg-amber-50/80 border-amber-300 border-l-amber-500 text-slate-900'
                        : 'bg-white border-slate-200/80 border-l-slate-400 text-slate-800 hover:border-amber-300';

                    return (
                      <div
                        key={tarefa.id}
                        className={`p-2.5 rounded-xl border border-l-4 text-xs flex items-start gap-2.5 transition-all ${cardStyle}`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(st?.concluida)}
                          onChange={() => handleToggleTarefa(tarefa.id, Boolean(st?.concluida))}
                          className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-semibold text-slate-900 leading-tight">
                            {tarefa.titulo || tarefa.descricao}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                              {tarefa._freqKey}
                            </span>
                            {st?.contagemLabel && (
                              <span className={`px-1.5 py-0.5 rounded-md font-bold tabular-nums ${
                                st.atrasada
                                  ? 'bg-rose-100 text-rose-800'
                                  : st.emAlertaAmarelo
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-slate-100 text-slate-600'
                              }`}>
                                {st.contagemLabel}
                              </span>
                            )}
                            {st?.dataVencimentoLabel && (
                              <span className="text-slate-500 tabular-nums">
                                Vence {st.dataVencimentoLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
                  className="w-full text-center text-xs font-semibold text-amber-700 hover:text-amber-900 cursor-pointer"
                >
                  Abrir Módulo de Tarefas (PDCA) →
                </button>
              </div>
            </section>
          )}

          {/* Painel da Agenda Escolar */}
          <section className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xs shrink-0">
                  <i className="fa-regular fa-calendar-days"></i>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 tracking-tight">
                    Agenda Escolar PEI
                  </h2>
                  <span className="text-[11px] text-slate-500">Próximos compromissos oficiais</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('agenda') : window.switchTab?.('agenda')}
                className="text-xs font-semibold text-indigo-700 hover:underline cursor-pointer"
              >
                Ver Agenda
              </button>
            </div>

            {eventosFuturos.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nenhum evento futuro ou pendente para os próximos dias.
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {eventosFuturos.slice(0, 5).map(evento => (
                  <div
                    key={evento.id}
                    onClick={() => setModalEvento(evento)}
                    className="p-2.5 rounded-xl border border-slate-200/80 border-l-4 border-l-indigo-500 bg-slate-50/60 hover:bg-white hover:border-indigo-300 text-xs space-y-1 transition-all cursor-pointer group"
                    title="Clique para consultar detalhes deste evento"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 group-hover:text-indigo-900 truncate">
                        {evento.titulo}
                      </span>
                      <span className="text-[11px] tabular-nums text-indigo-700 font-semibold shrink-0">
                        {evento.data ? new Date(evento.data).toLocaleDateString('pt-BR') : 'A definir'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{evento.categoria || 'Geral'}</span>
                      <div className="flex items-center gap-1.5">
                        {evento.horaInicio && (
                          <span className="tabular-nums text-[11px] text-slate-600">
                            {evento.horaInicio}
                          </span>
                        )}
                        <span className="text-[11px] font-semibold text-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity">
                          Ver →
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
      ) : (
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
              Visualização rápida em Modo Foco
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Os painéis pesados (PDCA da equipe, monitor de ciência do mural, auditorias SED vs Mapão, lista completa de tutorados e histórico de ocorrências) estão pausados para manter a tela inicial instantânea.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleModoVisualizacao('completo')}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <i className="fa-solid fa-chart-column text-[11px]"></i>
            <span>Abrir Modo Analítico</span>
          </button>
        </section>
      )}

      {/* ======================================================== */}
      {/* 5. MODAIS: RECADO, NOVA TAREFA, COMPROVANTE & DOCUMENTOS */}
      {/* ======================================================== */}

      {/* Modal Leitura Recado Completo */}
      {modalRecado && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">{modalRecado.titulo}</h3>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  Publicado por {modalRecado.autor || 'Gestão'} em {new Date(modalRecado.criadoEm || modalRecado.data || Date.now()).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalRecado(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {modalRecado.conteudo || modalRecado.mensagem || modalRecado.descricao}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <span className="text-xs text-slate-500 tabular-nums">
                Total de ciências registradas: <strong className="text-slate-800">{(modalRecado.cientes || []).length}</strong>
              </span>

              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setModalRecado(null)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleConfirmarCiencia(modalRecado.id);
                    setModalRecado(null);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-2xs cursor-pointer flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-check"></i>
                  <span>Confirmar Ciência Agora</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova Tarefa PDCA */}
      {modalNovaTarefa && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">Nova Tarefa PDCA</h3>
                <p className="text-[11px] text-slate-500">Crie rotinas recorrentes ou ações pontuais integradas ao ciclo PDCA.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalNovaTarefa(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvarNovaTarefa} className="flex flex-col overflow-hidden">
              <div className="p-5 sm:p-6 space-y-3.5 overflow-y-auto">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Título da Tarefa:</label>
                  <input
                    type="text"
                    required
                    value={novaTarefaTitulo}
                    onChange={(e) => setNovaTarefaTitulo(e.target.value)}
                    placeholder="Ex: Conferência de frequência e Busca Ativa"
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700">Periodicidade:</label>
                    <select
                      value={novaTarefaFreq}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNovaTarefaFreq(val);
                        setNovaTarefaAntecedencia(getDefaultAntecedencia(val));
                      }}
                      className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
                    >
                      <option value="Diária">Diária</option>
                      <option value="Semanal">Semanal</option>
                      <option value="Mensal">Mensal</option>
                      <option value="Bimestral">Bimestral</option>
                      <option value="Semestral">Semestral</option>
                      <option value="Anual">Anual</option>
                      <option value="Ação Pontual (Prazo Fixo)">Ação Pontual (Prazo Fixo)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700">Atribuir a:</label>
                    <select
                      value={novaTarefaAtribuir}
                      onChange={(e) => setNovaTarefaAtribuir(e.target.value)}
                      className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
                    >
                      <option value="">Meu Cargo ({activeRole})</option>
                      <option value="DIRETOR">Direção</option>
                      <option value="SENIOR_GOE">Sênior/GOE</option>
                      <option value="VICE_DIRETOR">Vice-Direção</option>
                      <option value="CGPG">CGPG</option>
                      <option value="PAAC">PAAC</option>
                      <option value="TODA A EQUIPE">Toda a Equipe Gestora</option>
                    </select>
                  </div>
                </div>

                {/* Regra de Vencimento Específica por Periodicidade */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl bg-amber-50/60 border border-amber-200/70">
                  {novaTarefaFreq === 'Semanal' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-amber-950">Dia da Semana (Vencimento):</label>
                      <select
                        value={novaTarefaDiaSemana}
                        onChange={(e) => setNovaTarefaDiaSemana(Number(e.target.value))}
                        className="w-full p-2 text-xs bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
                      >
                        {DIAS_SEMANA_OPCOES.map((op: any) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {['Mensal', 'Bimestral', 'Semestral', 'Anual'].includes(novaTarefaFreq) && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-amber-950">Dia do Mês (Vencimento):</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={novaTarefaDiaMes}
                        onChange={(e) => setNovaTarefaDiaMes(Number(e.target.value))}
                        className="w-full p-2 text-xs bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 tabular-nums"
                      />
                    </div>
                  )}

                  {novaTarefaFreq === 'Diária' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-amber-950">Horário Limite Diário:</label>
                      <input
                        type="time"
                        value={novaTarefaHorarioLimite}
                        onChange={(e) => setNovaTarefaHorarioLimite(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 tabular-nums"
                      />
                    </div>
                  )}

                  {novaTarefaFreq === 'Ação Pontual (Prazo Fixo)' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-amber-950">Data Limite (Prazo):</label>
                      <input
                        type="date"
                        required
                        value={novaTarefaPrazo}
                        onChange={(e) => setNovaTarefaPrazo(e.target.value)}
                        className="w-full p-2 text-xs bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-amber-950">Alerta Amarelo (dias antes):</label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={novaTarefaAntecedencia}
                      onChange={(e) => setNovaTarefaAntecedencia(Number(e.target.value))}
                      className="w-full p-2 text-xs bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30 tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Detalhamento / Critério de Entrega (Opcional):</label>
                  <textarea
                    rows={2}
                    value={novaTarefaDesc}
                    onChange={(e) => setNovaTarefaDesc(e.target.value)}
                    placeholder="Ex: Conferir assinaturas no livro de registros e validar na SED..."
                    className="w-full p-2.5 text-xs bg-slate-50/80 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>
              </div>

              <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalNovaTarefa(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs cursor-pointer"
                >
                  Criar Tarefa PDCA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Comprovante de Atraso (Slip de Entrada) */}
      {comprovanteAtraso && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="text-center border-b border-slate-200/80 pb-3">
                <span className="text-[11px] font-semibold tracking-wide text-slate-400">
                  Governo do Estado de São Paulo · SEDUC-SP
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  EE Clóvis de Lucca · PEI
                </h3>
                <p className="text-xs font-semibold text-amber-700 mt-1">
                  Comprovante de Entrada com Atraso
                </p>
              </div>

              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Protocolo:</span>
                  <span className="tabular-nums font-bold text-slate-900">{comprovanteAtraso.protocolo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estudante:</span>
                  <span className="font-semibold text-slate-900">{comprovanteAtraso.alunoNome}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">RA / Turma:</span>
                  <span className="tabular-nums text-slate-900">{comprovanteAtraso.alunoRa} · {comprovanteAtraso.turma}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Data / Horário:</span>
                  <span className="tabular-nums font-semibold text-slate-900">{comprovanteAtraso.data} às {comprovanteAtraso.horario}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Motivo:</span>
                  <span className="text-slate-900">{comprovanteAtraso.motivo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Situação:</span>
                  <span className={`font-semibold ${comprovanteAtraso.justificado ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {comprovanteAtraso.justificado ? 'Atraso Justificado' : 'Atraso Não Justificado'}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-center text-slate-500 border-t border-b border-dashed border-slate-200 py-2.5">
                Autorizada a entrada em sala de aula pelo docente da aula vigente.
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setComprovanteAtraso(null)}
                className="w-1/2 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Concluir
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <i className="fa-solid fa-print"></i>
                <span>Imprimir Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Documento Oficial Timbrado da Secretaria */}
      {documentoPronto && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200/80 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="p-6 sm:p-8 space-y-6 overflow-y-auto">
              {/* Cabeçalho Oficial do Documento */}
              <div className="text-center space-y-1 border-b-2 border-slate-900 pb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  GOVERNO DO ESTADO DE SÃO PAULO · SECRETARIA DA EDUCAÇÃO
                </p>
                <p className="text-xs font-semibold text-slate-700">
                  DIRETORIA DE ENSINO DA REGIÃO LESTE 4
                </p>
                <h2 className="text-lg font-bold text-slate-900">
                  ESCOLA ESTADUAL CLÓVIS DE LUCCA · PROGRAMA ENSINO INTEGRAL
                </h2>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  CIE: 004128 · CNPJ: 48.031.918/0001-20 · Rua do Oratório, São Paulo - SP
                </p>
              </div>

              {/* Título do Documento */}
              <div className="text-center py-2">
                <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide underline underline-offset-4">
                  {documentoPronto.titulo}
                </h3>
              </div>

              {/* Corpo Oficial do Documento */}
              <div className="text-sm text-slate-800 text-justify leading-relaxed p-4 bg-slate-50/70 rounded-2xl border border-slate-200/70">
                <p className="indent-8 whitespace-pre-wrap">{documentoPronto.corpo}</p>
              </div>

              {/* Data e Local */}
              <div className="text-right text-xs text-slate-600 pt-2 font-medium">
                São Paulo, {documentoPronto.dataExtenso}.
              </div>

              {/* Campos de Assinatura */}
              <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs">
                <div className="space-y-1">
                  <div className="w-48 h-0.5 bg-slate-400 mx-auto"></div>
                  <p className="font-semibold text-slate-800">{documentoPronto.emissor}</p>
                  <p className="text-[11px] text-slate-500">{documentoPronto.cargoEmissor}</p>
                </div>
                <div className="space-y-1">
                  <div className="w-48 h-0.5 bg-slate-400 mx-auto"></div>
                  <p className="font-semibold text-slate-800">Direção Escolar</p>
                  <p className="text-[11px] text-slate-500">EE Clóvis de Lucca</p>
                </div>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setDocumentoPronto(null)}
                className="px-5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center gap-2 cursor-pointer"
              >
                <i className="fa-solid fa-print"></i>
                <span>Imprimir Documento Oficial</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consulta de Aula (Grade / Horários) */}
      {modalAula && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-700 flex items-center justify-center font-bold text-sm tabular-nums">
                  {modalAula.periodoId}ª
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    {modalAula.turma} · {modalAula.disciplina || 'Aula Regular'}
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {PERIODOS_HORARIOS[Number(modalAula.periodoId)] || 'Horário Integral PEI'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalAula(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto">
              <div className="space-y-2.5 text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Docente Responsável:</span>
                  <span className="font-semibold text-slate-900">{modalAula.professor}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Dia da Semana:</span>
                  <span className="font-semibold text-slate-900">{DIAS_SEMANA_LABELS[String(modalAula.dia).toLowerCase()] || modalAula.dia}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Situação da Aula:</span>
                  <span className={`font-semibold px-2.5 py-0.5 rounded-full text-[11px] border ${
                    isRegularTeachingClass(modalAula)
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200/70'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}>
                    {isRegularTeachingClass(modalAula) ? 'Aula Ativa (Regular)' : 'Inativa / Intervalo / ATPC'}
                  </span>
                </div>
                {modalAula.sala && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Ambiente / Sala:</span>
                    <span className="font-semibold text-slate-900">{modalAula.sala}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setModalAula(null)}
                className="w-1/2 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalAula(null);
                  if (onNavigate) onNavigate('horarios');
                  else if (typeof window.switchTab === 'function') window.switchTab('horarios');
                }}
                className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Grade Completa</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consulta de Evento da Agenda Escolar PEI */}
      {modalEvento && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div>
                <span className="text-[11px] font-semibold text-indigo-800 bg-indigo-50/90 px-2.5 py-0.5 rounded-full border border-indigo-200/70">
                  {modalEvento.categoria || 'Compromisso Escolar PEI'}
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1.5 leading-snug tracking-tight">{modalEvento.titulo}</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalEvento(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-3 overflow-y-auto">
              <div className="space-y-2.5 text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Data do Evento:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {modalEvento.data ? modalEvento.data.split('-').reverse().join('/') : 'A definir'}
                    {modalEvento.dataFim && modalEvento.dataFim !== modalEvento.data ? ` até ${modalEvento.dataFim.split('-').reverse().join('/')}` : ''}
                  </span>
                </div>
                {(modalEvento.horaInicio || modalEvento.horario) && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Horário Programado:</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {modalEvento.horaInicio || modalEvento.horario} {modalEvento.horaFim ? `às ${modalEvento.horaFim}` : ''}
                    </span>
                  </div>
                )}
                {modalEvento.local && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Local / Espaço:</span>
                    <span className="font-semibold text-slate-900">{modalEvento.local}</span>
                  </div>
                )}
                {modalEvento.publicoAlvo && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Público Alvo / Participantes:</span>
                    <span className="font-semibold text-slate-900">{modalEvento.publicoAlvo}</span>
                  </div>
                )}
              </div>

              {modalEvento.descricao && (
                <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/50 p-3.5 rounded-2xl border border-slate-200/70 whitespace-pre-wrap">
                  {modalEvento.descricao}
                </div>
              )}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setModalEvento(null)}
                className="w-1/2 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalEvento(null);
                  if (onNavigate) onNavigate('agenda');
                  else if (typeof window.switchTab === 'function') window.switchTab('agenda');
                }}
                className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Abrir Agenda Completa</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consulta Rápida de Estudante (Tutorado / Busca Ativa / Secretaria) */}
      {modalAluno && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div>
                <span className="text-[11px] font-semibold text-cyan-800 bg-cyan-50/90 px-2.5 py-0.5 rounded-full border border-cyan-200/70">
                  Dossiê / Consulta de Estudante
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1.5 leading-snug tracking-tight">{modalAluno.nome}</h3>
                <p className="text-xs text-slate-500 tabular-nums mt-0.5">RA: {modalAluno.ra} · Turma: {modalAluno.turma}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalAluno(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto">
              <div className="space-y-2.5 text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Professor Tutor:</span>
                  <span className="font-semibold text-slate-900">{modalAluno.tutor || modalAluno.tutorNome || 'Não vinculado'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Presença Anual:</span>
                  {(() => {
                    const f = getRealStudentFreq(modalAluno);
                    return (
                      <span className={`tabular-nums font-bold ${f !== null && f < 75 ? 'text-rose-600' : f !== null ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {f !== null ? `${f.toFixed(1).replace('.', ',')}%` : 'Não informada'}
                      </span>
                    );
                  })()}
                </div>
                {getFaltasConsecutivas(modalAluno) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Faltas Consecutivas (Sequência):</span>
                    <span className={`tabular-nums font-bold ${getFaltasConsecutivas(modalAluno) >= 3 ? 'text-rose-600' : 'text-slate-800'}`}>
                      {getFaltasConsecutivas(modalAluno)} dia(s)
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Total de Faltas Computadas:</span>
                  <span className="tabular-nums font-semibold text-slate-800">{modalAluno.total_faltas || modalAluno.faltas || 0} aulas</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Status de Matrícula:</span>
                  <span className="font-semibold text-slate-800">{modalAluno.status || modalAluno.situacao || 'ATIVO'}</span>
                </div>
                {modalAluno.telefoneResponsavel && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Telefone Responsável:</span>
                    <span className="tabular-nums font-semibold text-slate-900">{modalAluno.telefoneResponsavel}</span>
                  </div>
                )}
                {modalAluno.projetoDeVida && (
                  <div className="pt-2 border-t border-slate-200/80">
                    <span className="text-slate-500 font-medium block mb-1">Projeto de Vida / Sonhos:</span>
                    <p className="text-slate-800 bg-white p-2.5 rounded-xl border border-slate-200/70">{modalAluno.projetoDeVida}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setModalAluno(null)}
                className="w-1/2 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  const ra = modalAluno.ra;
                  setModalAluno(null);
                  if (typeof window.abrirFichaAluno === 'function') {
                    window.abrirFichaAluno(ra);
                  } else if (onNavigate) {
                    onNavigate('alunos');
                  }
                }}
                className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Abrir Dossiê Completo</span>
                <i className="fa-solid fa-folder-open text-[11px]"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consulta de Registro de Ocorrência */}
      {modalOcorrencia && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 sm:px-6 py-4 shrink-0">
              <div>
                <span className="text-[11px] font-semibold text-rose-800 bg-rose-50/90 px-2.5 py-0.5 rounded-full border border-rose-200/70">
                  {modalOcorrencia.tipo || modalOcorrencia.categoria || 'Registro Pedagógico'}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1.5 leading-snug tracking-tight">
                  {modalOcorrencia.nomeAluno || (modalOcorrencia.ra ? `Estudante RA: ${modalOcorrencia.ra}` : 'Ocorrência Geral')}
                </h3>
                {modalOcorrencia.turma && (
                  <p className="text-xs text-slate-500 tabular-nums mt-0.5">Turma: {modalOcorrencia.turma}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModalOcorrencia(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-3 overflow-y-auto">
              <div className="space-y-2.5 text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Data do Fato:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {(modalOcorrencia.data || modalOcorrencia.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Registrado por:</span>
                  <span className="font-semibold text-slate-900">{modalOcorrencia.autor || modalOcorrencia.autor_nome || 'Equipe Escolar'}</span>
                </div>
                {modalOcorrencia.motivo && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Motivo Apontado:</span>
                    <span className="font-semibold text-slate-900">{modalOcorrencia.motivo}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">Relato do Fato:</span>
                <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/50 p-3.5 rounded-2xl border border-slate-200/70 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {modalOcorrencia.descricao || 'Sem descrição cadastrada'}
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setModalOcorrencia(null)}
                className="w-1/2 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalOcorrencia(null);
                  if (onNavigate) onNavigate('registros');
                  else if (typeof window.switchTab === 'function') window.switchTab('registros');
                }}
                className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Ver em Ocorrências</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
