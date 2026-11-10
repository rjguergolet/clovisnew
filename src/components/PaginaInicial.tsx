import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, collection, getDocs, addDoc, updateDoc, doc, setDoc } from '../lib/database';
import { obterUsuarioAtivoCompleto, normalizarCargo } from '../modules/authHelper';
import { normalizeTeacherName, isRegularTeachingClass, isAlunoAtivo } from '../utils';
import CentralPendenciasPerfil from './CentralPendenciasPerfil';

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
    switchTab?: (tabName: string) => void;
    abrirFichaAluno?: (ra: string) => void;
    allStudentsData?: any[];
    __clovisHomeCache?: any;
    usuariosCache?: any[];
    muralRecadosCache?: any[];
    rotinaEquipeCache?: any[];
    eventosCache?: any[];
    gradeCache?: any[];
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
  9: '15:10 - 16:00'
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

  // Modo de Visualização: 'foco' (simples, urgente) vs 'completo' (analítico, todas as seções)
  const [modoVisualizacao, setModoVisualizacao] = useState<'foco' | 'completo'>(() => {
    try {
      return (localStorage.getItem('clovis_modo_visualizacao') as any) || 'foco';
    } catch {
      return 'foco';
    }
  });

  const toggleModoVisualizacao = (novoModo: 'foco' | 'completo') => {
    setModoVisualizacao(novoModo);
    try {
      localStorage.setItem('clovis_modo_visualizacao', novoModo);
    } catch {}
  };

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
  const [tarefas, setTarefas] = useState<any[]>(() => initialCache?.tarefas || (typeof window !== 'undefined' && Array.isArray((window as any).rotinaEquipeCache) ? (window as any).rotinaEquipeCache : []));
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

  // Modais e Diálogos
  const [modalRecado, setModalRecado] = useState<any | null>(null);
  const [modalNovaTarefa, setModalNovaTarefa] = useState(false);
  const [novaTarefaDesc, setNovaTarefaDesc] = useState('');
  const [novaTarefaPrazo, setNovaTarefaPrazo] = useState('');
  const [novaTarefaAtribuir, setNovaTarefaAtribuir] = useState('');

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

  // Sincronização do Usuário Ativo e Logotipo da Escola
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

    syncUser();
    window.addEventListener('taborrolechange', syncUser);
    window.addEventListener('storage', syncUser);
    window.addEventListener('storage', handleLogoChanged);
    window.addEventListener('clovis_logo_changed', handleLogoChanged);
    return () => {
      window.removeEventListener('taborrolechange', syncUser);
      window.removeEventListener('storage', syncUser);
      window.removeEventListener('storage', handleLogoChanged);
      window.removeEventListener('clovis_logo_changed', handleLogoChanged);
    };
  }, []);

  // Verificação estrita se o usuário real é Diretor
  const isRealDirector = useMemo(() => {
    const rawRole = currentUser?.cargo || (typeof window !== 'undefined' ? (window.realUserRole || window.currentUserRole) : '');
    const norm = normalizarCargo(rawRole);
    if (norm === 'DIRETOR') return true;
    const email = String(currentUser?.email || '').toLowerCase();
    const nome = String(currentUser?.nome || '').toUpperCase();
    if (email.includes('guergolet') || nome.includes('GUERGOLET') || nome.includes('DIRETOR')) return true;
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('usuarioLogado');
      if (saved && (saved.includes('DIRETOR') || saved.toLowerCase().includes('guergolet'))) return true;
      if (localStorage.getItem('usuario_cargo')?.toUpperCase().includes('DIRETOR')) return true;
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
            email: `${pNorm.replace(/\s+/g, '.')}@professor.educacao.sp.gov.br`,
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
  const isDirecao = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE');
  const isSecretaria = roleNorm === 'SECRETARIA';

  // Carregamento de Coleções com Cache Inteligente e Stale-While-Revalidate (SWR)
  const carregarDadosCompletos = useCallback(async (force = false) => {
    const cached = typeof window !== 'undefined' ? (window as any).__clovisHomeCache : null;
    const now = Date.now();
    const isFresh = cached && cached.timestamp && (now - cached.timestamp < 120_000); // 2 minutos de validade

    // Se temos cache recente em memória e a chamada não foi forçada, poupa leituras do Firebase
    if (isFresh && !force) {
      setLoading(false);
      return;
    }

    // Se a interface já tem dados para renderizar, faz revalidação suave em background (sem tela branca)
    const temDadosExibicao = Boolean(usuarios.length > 0 || recados.length > 0 || cached);
    if (!temDadosExibicao) {
      setLoading(true);
    } else {
      setRevalidando(true);
    }

    try {
      // 1. Consultas simultâneas protegidas
      const [uSnap, rSnap, tSnap, eSnap, oSnap, hSnap, subSnap] = await Promise.all([
        getDocs(collection(db, 'usuarios')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'mural_recados')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'rotina_equipe')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'eventos')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'ocorrencias')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'horarios')).catch(() => ({ docs: [], forEach: () => {} })),
        getDocs(collection(db, 'substituicoes_diarias')).catch(() => ({ docs: [], forEach: () => {} }))
      ]);

      const listaU: any[] = [];
      uSnap.forEach(d => listaU.push({ id: d.id, ...d.data() }));
      setUsuarios(listaU);
      if (typeof window !== 'undefined') (window as any).usuariosCache = listaU;

      const isBoasVindasRecado = (r: any) => {
        if (!r) return false;
        const tit = String(r.titulo || '').toLowerCase();
        const cont = String(r.conteudo || '').toLowerCase();
        const idStr = String(r.id || r._id || '').toLowerCase();
        return (
          tit.includes('boas-vinda') ||
          tit.includes('boas vinda') ||
          tit.includes('ano letivo & orientações iniciais') ||
          tit.includes('diretrizes e calendário do ano letivo') ||
          cont.includes('sejam bem-vindos ao novo período letivo') ||
          cont.includes('bem-vindos ao novo período letivo') ||
          cont.includes('o calendário letivo 2026 já está disponível na aba de planejamento') ||
          idStr.startsWith('recado-inst')
        );
      };

      const listaR: any[] = [];
      rSnap.forEach(d => {
        const item = { id: d.id, ...d.data() };
        if (!isBoasVindasRecado(item) && item.tipo !== 'ALERTA_PEDAGOGICO' && !(item.titulo && String(item.titulo).startsWith('ALERTA PEDAGÓGICO:'))) {
          listaR.push(item);
        }
      });
      listaR.sort((a, b) => new Date(b.criadoEm || b.data || 0).getTime() - new Date(a.criadoEm || a.data || 0).getTime());
      setRecados(listaR);
      if (typeof window !== 'undefined') (window as any).muralRecadosCache = listaR;

      const listaT: any[] = [];
      tSnap.forEach(d => listaT.push({ id: d.id, ...d.data() }));
      setTarefas(listaT);
      if (typeof window !== 'undefined') (window as any).rotinaEquipeCache = listaT;

      const listaE: any[] = [];
      eSnap.forEach(d => listaE.push({ id: d.id, ...d.data() }));
      listaE.sort((a, b) => new Date(a.data || 0).getTime() - new Date(b.data || 0).getTime());
      setEventos(listaE);
      if (typeof window !== 'undefined') (window as any).eventosCache = listaE;

      const listaO: any[] = [];
      oSnap.forEach(d => listaO.push({ id: d.id, ...d.data() }));
      listaO.sort((a, b) => new Date(b.criadoEm || b.data || 0).getTime() - new Date(a.criadoEm || a.data || 0).getTime());
      setOcorrencias(listaO);
      if (typeof window !== 'undefined') {
        (window as any).ocorrenciasTopLevel = listaO;
      }

      const listaH: any[] = [];
      hSnap.forEach(d => listaH.push({ id: d.id, ...d.data() }));
      setHorarios(listaH);
      if (typeof window !== 'undefined') (window as any).gradeCache = listaH;

      const listaSub: any[] = [];
      subSnap.forEach(d => listaSub.push({ id: d.id, ...d.data() }));
      setSubstituicoes(listaSub);
      if (typeof window !== 'undefined') (window as any).substituicoesCache = listaSub;

      // Alunos: prioriza memória e cache local antes de consultar Firestore
      let listaA: any[] = Array.isArray((window as any).allStudentsData) && (window as any).allStudentsData.length > 0
        ? (window as any).allStudentsData
        : [];

      if (listaA.length === 0) {
        try {
          const lcA = localStorage.getItem('alunos_cache');
          if (lcA) {
            const parsedA = JSON.parse(lcA);
            if (Array.isArray(parsedA) && parsedA.length > 0) {
              listaA = parsedA;
              (window as any).allStudentsData = parsedA;
            }
          }
        } catch (e) {}
      }

      if (listaA.length === 0) {
        const aSnap = await getDocs(collection(db, 'alunos')).catch(() => ({ docs: [], forEach: () => {} }));
        const fetchedA: any[] = [];
        aSnap.forEach(d => fetchedA.push({ id: d.id, ...d.data() }));
        listaA = fetchedA;
        if (typeof window !== 'undefined') {
          (window as any).allStudentsData = listaA;
        }
      }
      setAlunos(listaA);

      // Armazenamento em Cache Consolidado
      const newCache = {
        usuarios: listaU,
        recados: listaR,
        tarefas: listaT,
        eventos: listaE,
        ocorrencias: listaO,
        horarios: listaH,
        alunos: listaA,
        timestamp: Date.now()
      };
      if (typeof window !== 'undefined') {
        (window as any).__clovisHomeCache = newCache;
        try {
          sessionStorage.setItem('clovis_home_cache', JSON.stringify({
            usuarios: listaU,
            recados: listaR,
            tarefas: listaT,
            eventos: listaE,
            ocorrencias: listaO,
            horarios: listaH,
            timestamp: Date.now()
          }));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[PaginaInicial] Carregamento operando com fallbacks:', err);
    } finally {
      setLoading(false);
      setRevalidando(false);
    }
  }, [usuarios.length, recados.length]);

  useEffect(() => {
    carregarDadosCompletos(false);
  }, [carregarDadosCompletos]);

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
    const hojeStr = new Date().toISOString().slice(0, 10);
    return substituicoes.filter(s => {
      const d = String(s.data || '').slice(0, 10);
      return !d || d === hojeStr;
    });
  }, [substituicoes]);

  // Alunos Tutorados do Professor (Apenas estudantes ativos por padrão)
  const tutoradosDoProfessor = useMemo(() => {
    if (!effectiveTeacher?.nome) return [];
    const tNome = normalizeTeacherName(effectiveTeacher.nome);
    return alunos.filter(a => {
      if (!isAlunoAtivo(a)) return false;
      const tutorA = normalizeTeacherName(a.tutor || a.tutorNome || a.nomeTutor || a.tutor_2026);
      return tutorA && (tNome.includes(tutorA) || tutorA.includes(tNome));
    });
  }, [alunos, effectiveTeacher]);

  // Mensagens do Mural Direcionadas ao Usuário/Perfil
  const recadosDirecionados = useMemo(() => {
    return recados.filter(r => {
      if (r.arquivado) return false;
      // Usar a lógica robusta existente
      if (typeof window.usuarioEAlvoDoRecado === 'function') {
        return window.usuarioEAlvoDoRecado(r, { ...effectiveUser, cargo: activeRole });
      }
      return true;
    });
  }, [recados, effectiveUser, activeRole]);

  // Tarefas Atribuídas ao Usuário/Perfil (NÃO mostrar as concluídas!)
  const tarefasFiltradas = useMemo(() => {
    const roleClean = activeRole.toUpperCase();
    const nomeClean = (effectiveUser?.nome || '').toUpperCase();
    return tarefas.filter(t => {
      // REGRA: Em minhas tarefas não mostre as concluidas
      if (t.concluido) return false;

      const atrib = String(t.atribuirA || t.responsavel || 'TODA A EQUIPE').toUpperCase();
      if (atrib === 'TODA A EQUIPE' || atrib === 'TODOS' || atrib === 'GERAL') return true;
      if (atrib.includes(roleClean) || roleClean.includes(atrib)) return true;
      if (nomeClean && (atrib.includes(nomeClean) || nomeClean.includes(atrib))) return true;
      return false;
    });
  }, [tarefas, activeRole, effectiveUser]);

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
    return ocorrencias.filter(o => o.isAtraso === true || String(o.tipo || '').toUpperCase().includes('ATRASO'));
  }, [ocorrencias]);

  const atrasosHoje = useMemo(() => {
    const hojeStr = new Date().toISOString().slice(0, 10);
    return ocorrenciasAtrasos.filter(o => {
      const dataStr = (o.data || o.criadoEm || '').slice(0, 10);
      return dataStr === hojeStr;
    });
  }, [ocorrenciasAtrasos]);

  const atrasosMes = useMemo(() => {
    const mesAtual = new Date().toISOString().slice(0, 7);
    return ocorrenciasAtrasos.filter(o => {
      const dataStr = (o.data || o.criadoEm || '').slice(0, 7);
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

  // Função utilitária para extrair percentual de frequência com rigor (0 a 100)
  const extrairPercentualFrequencia = (aluno: any): number => {
    if (!aluno) return 100;
    const raw = aluno.presenca_anual ?? aluno.presenca ?? aluno.frequencia ?? aluno.frequencia_anual ?? aluno.frequenciaNum;
    if (raw === undefined || raw === null || String(raw).trim() === '' || String(raw).trim() === '-' || String(raw).trim() === 'N/D') {
      return 100;
    }
    let str = String(raw).trim().replace('%', '').replace(',', '.');
    let num = parseFloat(str);
    if (isNaN(num)) return 100;
    if (num > 0 && num <= 1) {
      num = num * 100;
    }
    return num;
  };

  // Busca Ativa - Alunos Infrequentes (< 75%)
  // REGRA CRÍTICA: Estudantes com presença >= 75% NUNCA devem aparecer como pendência de Busca Ativa / Infrequência!
  const alunosBuscaAtiva = useMemo(() => {
    return alunos.filter(a => {
      const ativo = isAlunoAtivo(a);
      if (filtroStatusBuscaAtiva === 'ATIVOS' && !ativo) return false;
      if (filtroStatusBuscaAtiva === 'INATIVOS' && ativo) return false;

      const p = extrairPercentualFrequencia(a);
      // Estritamente menor que 75%
      return p < 75;
    }).slice(0, 10);
  }, [alunos, filtroStatusBuscaAtiva]);

  // Notificações Pedagógicas Urgentes dos Professores direcionadas à Gestão (Direção, Vice, PAAC e CGPG)
  // Por padrão NÃO notifica, só se o professor marcou mesmo o botão
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

  // Tutorados do professor em alerta de frequência (< 75%)
  // REGRA CRÍTICA: Só é considerado em risco se a frequência for estritamente MENOR que 75%.
  // Estudantes com 75% ou mais NUNCA devem constar como pendência!
  const tutoradosEmRisco = useMemo(() => {
    return tutoradosDoProfessor.filter(aluno => {
      if (!isAlunoAtivo(aluno)) return false;
      const freqNum = extrairPercentualFrequencia(aluno);
      return freqNum < 75;
    });
  }, [tutoradosDoProfessor]);

  // Tarefas da rotina com prazo vencido ou vencendo hoje
  const tarefasUrgentes = useMemo(() => {
    const hojeStr = new Date().toISOString().slice(0, 10);
    return tarefasFiltradas.filter(t => {
      if (!t.dataLimite) return false;
      const dLim = String(t.dataLimite).slice(0, 10);
      return dLim <= hojeStr;
    });
  }, [tarefasFiltradas]);

  // Estudantes com pendência no Mapão de Fechamento (1B, 2B ou 3B ausentes) - Apenas alunos ativos
  const alunosMapaoPendentes = useMemo(() => {
    return alunos.filter(a => {
      if (!isAlunoAtivo(a)) return false;
      const fn = a.fechamento_notas || a.fechamentos || a.notas || {};
      const tem1B = !!(fn['1B'] && fn['1B'].disciplinas && Object.keys(fn['1B'].disciplinas).length > 0);
      const tem2B = !!(fn['2B'] && fn['2B'].disciplinas && Object.keys(fn['2B'].disciplinas).length > 0);
      const tem3B = !!(fn['3B'] && fn['3B'].disciplinas && Object.keys(fn['3B'].disciplinas).length > 0);
      return !tem1B || !tem2B || !tem3B;
    });
  }, [alunos]);

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
          if ((cgNorm === 'DIRECAO' || cgNorm === 'DIRETOR') && (uCargo.includes('DIRETOR') || uCargo.includes('VICE'))) return true;
          if (cgNorm === 'VICE_DIRETOR' && (uCargo.includes('VICE') || uCargo.includes('DIRETOR'))) return true;
          if (cgNorm === 'SECRETARIA' && (uCargo.includes('SECRETAR') || uCargo.includes('GOE') || uCargo.includes('AOE'))) return true;
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
    try {
      const tRef = doc(db, 'rotina_equipe', tarefaId);
      await updateDoc(tRef, { concluido: !statusAtual });
      setTarefas(prev => prev.map(t => t.id === tarefaId ? { ...t, concluido: !statusAtual } : t));
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(!statusAtual ? 'Tarefa marcada como concluída!' : 'Tarefa reaberta.', 'success');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSalvarNovaTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaTarefaDesc.trim()) return;

    try {
      const payload = {
        descricao: novaTarefaDesc.trim(),
        dataLimite: novaTarefaPrazo || null,
        atribuirA: novaTarefaAtribuir || activeRole,
        concluido: false,
        criadoPor: currentUser.nome,
        criadoEm: new Date().toISOString()
      };
      // REGRA: Sem campos id ou _id no payload enviado
      await addDoc(collection(db, 'rotina_equipe'), payload);
      setModalNovaTarefa(false);
      setNovaTarefaDesc('');
      setNovaTarefaPrazo('');
      setNovaTarefaAtribuir('');
      carregarDadosCompletos(true);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Tarefa criada com sucesso!', 'success');
      }
    } catch (err) {
      console.error(err);
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

      await addDoc(collection(db, 'ocorrencias'), payloadOcorrencia);

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

    let titulo = '';
    let corpo = '';

    if (tipoDocumento === 'matricula') {
      titulo = 'ATESTADO DE MATRÍCULA E FREQUÊNCIA';
      corpo = `Atestamos, para os devidos fins a pedido da parte interessada, que o(a) estudante ${alunoSelecionadoDoc.nome}, portador(a) do R.A. nº ${alunoSelecionadoDoc.ra}, encontra-se regularmente matriculado(a) e com frequência ativa no ano letivo de 2026, cursando a turma ${alunoSelecionadoDoc.turma}, no Regime de Turno Único do Programa Ensino Integral (PEI), nesta Unidade Escolar sob jurisdição da Diretoria de Ensino da Região Leste 4.`;
    } else if (tipoDocumento === 'frequencia') {
      titulo = 'DECLARAÇÃO DE ASSIDUIDADE E FREQUÊNCIA ESCOLAR';
      const freq = alunoSelecionadoDoc.presenca_anual || '95%';
      corpo = `Declaramos, para os devidos fins de comprovação perante órgãos públicos e benefícios sociais, que o(a) estudante ${alunoSelecionadoDoc.nome}, R.A. nº ${alunoSelecionadoDoc.ra}, devidamente matriculado(a) na turma ${alunoSelecionadoDoc.turma}, apresenta frequência regular apurada de ${freq} no corrente ano letivo, cumprindo satisfatoriamente os preceitos de assiduidade exigidos pela Lei Federal nº 9.394/96 (LDB).`;
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
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto text-slate-800">
      
      {/* 1. TOPO: Identificação Executiva & Comutador de Cargo */}
      <header className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3.5 sm:gap-4">
        <div className="flex items-center gap-3.5 sm:gap-4">
          <img 
            src={customLogoUrl} 
            alt="Brasão Oficial EE Prof. Clóvis de Lucca" 
            className="w-14 h-14 sm:w-16 sm:h-16 object-contain shrink-0 drop-shadow-sm logo-escola-img" 
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-xs font-bold text-sky-700 bg-sky-50 px-2.5 py-0.5 rounded-md border border-sky-200">
                Semana PEI 2026
              </span>
              {revalidando ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200 animate-pulse">
                  <i className="fa-solid fa-arrows-rotate animate-spin text-[10px]"></i>
                  <span>Sincronizando...</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => carregarDadosCompletos(true)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-blue-900 bg-slate-100 hover:bg-blue-50 px-2.5 py-0.5 rounded-full border border-slate-200 hover:border-blue-300 transition-all cursor-pointer shadow-2xs"
                  title="Clique para forçar atualização em tempo real com o banco"
                >
                  <i className="fa-solid fa-arrows-rotate text-[10px] text-slate-400 hover:text-blue-600"></i>
                  <span>Atualizar dados</span>
                </button>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Olá, {effectiveUser.nome.split(' ')[0]}!
            </h1>
            <p className="text-sm text-slate-600">
              Painel Executivo da EE Clóvis de Lucca. Perfil:{' '}
              <strong className="text-slate-900 font-bold">{activeRole}</strong>
              {selectedEmployeeId ? (
                <span className="ml-1.5 text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  Visualizando: {effectiveUser.nome}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Comutador de Visão: EXCLUSIVO PARA O DIRETOR com seleção de cada funcionário individualmente */}
        {isRealDirector && (
          <div className="flex flex-col gap-2 w-full lg:w-auto bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <i className="fa-solid fa-user-shield text-blue-900"></i>
                Comutador de Visão (Gestão Direção)
              </span>

              {/* Seletor Individual de Funcionário */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">Funcionário:</span>
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
                  className="p-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 font-bold outline-none focus:ring-2 focus:ring-blue-900 cursor-pointer max-w-[220px] truncate"
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

            {/* Alternar por Cargo Genérico */}
            <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-slate-200/80">
              {['PROFESSOR', 'SECRETARIA', 'PAAC', 'CGPG', 'VICE_DIRETOR', 'DIRETOR'].map(roleOption => {
                const isActive = activeRole === roleOption;
                const labels: Record<string, string> = {
                  PROFESSOR: 'Professor',
                  SECRETARIA: 'Secretaria',
                  PAAC: 'PAAC',
                  CGPG: 'CGPG',
                  VICE_DIRETOR: 'Vice-Direção',
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
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
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

      {/* CENTRAL DE PENDÊNCIAS E ALERTAS RÁPIDOS POR CARGO (Ação Imediata & Zero Perda) */}
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
        onToggleTarefa={handleToggleTarefa}
        onNovaTarefa={() => setModalNovaTarefa(true)}
        onAbrirRecado={(rec) => setModalRecado(rec)}
      />

      {/* 2. BARRA DE INDICADORES RÁPIDOS (KPIs) POR CARGO - TUDO CLICÁVEL */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Bloco 1 */}
        {activeRole === 'SECRETARIA' ? (
          <div
            onClick={() => onNavigate ? onNavigate('dashboard-atrasos') : window.switchTab?.('dashboard-atrasos')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para abrir o Dashboard de Atrasos"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-amber-800 transition-colors">Atrasos Registrados Hoje</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-amber-600 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-600 font-mono tabular-nums mt-1">
              {atrasosHoje.length}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Entradas tardias computadas</span>
          </div>
        ) : activeRole === 'PROFESSOR' || activeRole === 'PAAC' ? (
          <div
            onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para consultar a grade completa de horários"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-blue-900 transition-colors">Aulas Ativas na Semana</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-blue-800 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-blue-900 font-mono tabular-nums mt-1">
              {aulasSemanaisAtivas.length}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">{aulasHojeAtivas.length} ativas hoje ({aulasHoje.length} no total da agenda)</span>
          </div>
        ) : (
          <div
            onClick={() => onNavigate ? onNavigate('dashboard') : window.switchTab?.('dashboard')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para consultar métricas gerais de presença"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-emerald-900 transition-colors">Presença Geral da Escola</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-emerald-800 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono tabular-nums mt-1">
              92.4%
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Média anual acumulada</span>
          </div>
        )}

        {/* Bloco 2 */}
        {activeRole === 'SECRETARIA' ? (
          <div
            onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para acessar a lista de estudantes"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-blue-900 transition-colors">Estudantes Matriculados</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-blue-800 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tabular-nums mt-1">
              {alunos.filter(isAlunoAtivo).length || alunos.length || 746}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Ativos no sistema PEI</span>
          </div>
        ) : activeRole === 'PROFESSOR' || activeRole === 'PAAC' ? (
          <div
            onClick={() => {
              const el = document.getElementById('secao-tutorados-professor');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else if (onNavigate) onNavigate('alunos');
            }}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-cyan-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para ver os alunos sob sua tutoria"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-cyan-900 transition-colors">Estudantes Tutorados</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-cyan-800 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-cyan-700 font-mono tabular-nums mt-1">
              {tutoradosDoProfessor.length}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Sob seu acompanhamento</span>
          </div>
        ) : (
          <div
            onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-rose-400 hover:shadow-sm transition-all cursor-pointer group"
            title="Clique para abrir o painel de Busca Ativa"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 group-hover:text-rose-900 transition-colors">Alunos em Busca Ativa</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-rose-800 transition-colors"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-rose-600 font-mono tabular-nums mt-1">
              {alunosBuscaAtiva.length}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Casos de risco de infrequência</span>
          </div>
        )}

        {/* Bloco 3: Ciência no Mural / Notificações Pedagógicas para Direção */}
        <div
          onClick={() => {
            if (['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(activeRole)) {
              const el = document.getElementById('painel-notificacoes-pedagogicas') || document.getElementById('painel-ciencia-mural');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else if (onNavigate) onNavigate('registros');
            } else {
              if (onNavigate) onNavigate('mural');
              else if (typeof window.switchTab === 'function') window.switchTab('mural');
            }
          }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-purple-400 hover:shadow-sm transition-all cursor-pointer group"
          title="Clique para consultar notificações e ciências"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 group-hover:text-purple-900 transition-colors">
              {['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(activeRole)
                ? 'Alertas Pedagógicos'
                : 'Recados Direcionados'}
            </span>
            <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-purple-800 transition-colors"></i>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-purple-700 font-mono tabular-nums mt-1">
            {['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(activeRole)
              ? notificacoesPedagogicasDirecao.length
              : recadosDirecionados.length}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(activeRole)
              ? `${notificacoesPedagogicasDirecao.length} pendente(s) da equipe`
              : 'Comunicados para seu perfil'}
          </span>
        </div>

        {/* Bloco 4: Tarefas */}
        <div
          onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer group"
          title="Clique para abrir o módulo de Tarefas (PDCA)"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 group-hover:text-amber-900 transition-colors">Tarefas Pendentes</span>
            <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-300 group-hover:text-amber-800 transition-colors"></i>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 font-mono tabular-nums mt-1">
            {tarefasFiltradas.length}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Rotinas e prazos a realizar</span>
        </div>
      </section>

      {/* CENTRAL DE LINKS E AÇÕES RÁPIDAS DE RESOLUÇÃO */}
      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-900 flex items-center justify-center font-bold text-sm">
              <i className="fa-solid fa-compass"></i>
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Central de Acesso Rápido às Resoluções</span>
                <span className="text-[10px] font-bold text-slate-400 font-mono hidden sm:inline">1 clique</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Links diretos para resolver qualquer pendência ou acessar os módulos essenciais do seu perfil.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 self-start sm:self-auto">
            Perfil: {activeRole}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {/* 1. Ocorrências */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('registros') : window.switchTab?.('registros')}
            className="p-3 bg-slate-50 hover:bg-rose-50/80 border border-slate-200 hover:border-rose-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-rose-950 block leading-tight">
                Lançar Ocorrência
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                Registros pedagógicos
              </span>
            </div>
          </button>

          {/* 2. Tarefas PDCA */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
            className="p-3 bg-slate-50 hover:bg-amber-50/80 border border-slate-200 hover:border-amber-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-list-check"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-amber-950 block leading-tight">
                Rotina PDCA
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                {tarefasFiltradas.length} tarefa{tarefasFiltradas.length === 1 ? '' : 's'} ativa{tarefasFiltradas.length === 1 ? '' : 's'}
              </span>
            </div>
          </button>

          {/* 3. Mural */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('mural') : window.switchTab?.('mural')}
            className="p-3 bg-slate-50 hover:bg-purple-50/80 border border-slate-200 hover:border-purple-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-bullhorn"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-purple-950 block leading-tight">
                Mural de Recados
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                {recadosSemCienciaUsuario.length > 0 ? `${recadosSemCienciaUsuario.length} sem ciência` : 'Comunicados'}
              </span>
            </div>
          </button>

          {/* 4. Alunos / Prontuário */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
            className="p-3 bg-slate-50 hover:bg-cyan-50/80 border border-slate-200 hover:border-cyan-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-user-graduate"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-cyan-950 block leading-tight">
                Buscar Estudante
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                RA e prontuário PEI
              </span>
            </div>
          </button>

          {/* 5. Horários / Minha Grade */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
            className="p-3 bg-slate-50 hover:bg-blue-50/80 border border-slate-200 hover:border-blue-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-900 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-clock"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-blue-950 block leading-tight">
                Grade de Horários
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                {aulasHojeAtivas.length} aula(s) hoje
              </span>
            </div>
          </button>

          {/* 6. Substituição PEI */}
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate('substituicao-pei') : window.switchTab?.('substituicao-pei')}
            className="p-3 bg-slate-50 hover:bg-amber-50/80 border border-slate-200 hover:border-amber-400 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-shuffle"></i>
            </div>
            <div className="mt-2">
              <span className="text-xs font-black text-slate-900 group-hover:text-amber-950 block leading-tight">
                Substituições PEI
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                {substituicoesHoje.length} registrada(s)
              </span>
            </div>
          </button>

          {/* 7. Busca Ativa (Gestão) ou Atrasos (Secretaria) */}
          {(isDirecao || isCoord || isPAAC) ? (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
              className="p-3 bg-slate-50 hover:bg-rose-50/80 border border-slate-200 hover:border-rose-400 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-magnifying-glass-location"></i>
              </div>
              <div className="mt-2">
                <span className="text-xs font-black text-slate-900 group-hover:text-rose-950 block leading-tight">
                  Busca Ativa SEDUC
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                  {alunosBuscaAtiva.length} em risco crítico
                </span>
              </div>
            </button>
          ) : isSecretaria ? (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('dashboard-atrasos') : window.switchTab?.('dashboard-atrasos')}
              className="p-3 bg-slate-50 hover:bg-amber-50/80 border border-slate-200 hover:border-amber-400 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-clock-rotate-left"></i>
              </div>
              <div className="mt-2">
                <span className="text-xs font-black text-slate-900 group-hover:text-amber-950 block leading-tight">
                  Atrasos no Portão
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                  {atrasosHoje.length} hoje
                </span>
              </div>
            </button>
          ) : null}

          {/* 8. SED vs Mapão (Gestão e Secretaria) */}
          {(isDirecao || isCoord || isSecretaria) && (
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('comparativo-frequencia') : window.switchTab?.('comparativo-frequencia')}
              className="p-3 bg-slate-50 hover:bg-cyan-50/80 border border-slate-200 hover:border-cyan-400 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-900 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-scale-balanced"></i>
              </div>
              <div className="mt-2">
                <span className="text-xs font-black text-slate-900 group-hover:text-cyan-950 block leading-tight">
                  SED vs Mapão
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
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
              className="p-3 bg-slate-50 hover:bg-purple-50/80 border border-slate-200 hover:border-purple-300 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-building-columns"></i>
              </div>
              <div className="mt-2">
                <span className="text-xs font-black text-slate-900 group-hover:text-purple-950 block leading-tight">
                  Secretaria Escolar
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
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
              className="p-3 bg-slate-50 hover:bg-slate-200/80 border border-slate-200 hover:border-slate-400 rounded-xl transition-all text-left group cursor-pointer shadow-2xs flex flex-col justify-between"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-800 flex items-center justify-center text-sm font-bold group-hover:scale-105 transition-transform">
                <i className="fa-solid fa-shield-halved"></i>
              </div>
              <div className="mt-2">
                <span className="text-xs font-black text-slate-900 group-hover:text-slate-950 block leading-tight">
                  Auditoria Geral
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                  Logs e integridade
                </span>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* ======================================================== */}
      {/* 3. CONTEÚDO PRINCIPAL DIVIDIDO POR CARGO */}
      {/* ======================================================== */}

      {/* -------------------------------------------------------- */}
      {/* A. VISÃO PROFESSOR / PAAC (Horários + Tutorados) */}
      {/* -------------------------------------------------------- */}
      {(activeRole === 'PROFESSOR' || activeRole === 'PAAC' || activeRole === 'CGPG') && (
        <div className="space-y-6">

          {/* Horários Individuais do Professor */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-clock text-blue-800"></i>
                  Meus Horários Individuais de Aula
                </h2>
                <p className="text-xs text-slate-500">
                  Aulas programadas para hoje ({DIAS_SEMANA_LABELS[diaSemanaHoje] || 'Hoje'}) e grade semanal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('horarios') : window.switchTab?.('horarios')}
                className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer"
              >
                <span>Ver Grade Completa da Escola</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            {/* Aulas de Hoje (mostra ativas e inativas, tudo clicável) */}
            {aulasHoje.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs bg-slate-50 rounded-xl border border-slate-200">
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
                      className={`p-3.5 rounded-xl border transition-all space-y-1.5 cursor-pointer group shadow-2xs hover:shadow-xs ${
                        isAtiva
                          ? 'bg-slate-50/90 border-slate-200 hover:bg-white hover:border-cyan-400'
                          : 'bg-slate-100/70 border-slate-200/90 opacity-80 hover:opacity-100 hover:border-slate-400'
                      }`}
                      title="Clique para consultar os detalhes desta aula"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-blue-900">
                            {aula.periodoId}ª Aula
                          </span>
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded uppercase ${
                              isAtiva
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-slate-200 text-slate-700 border border-slate-300'
                            }`}
                          >
                            {isAtiva ? 'Ativa' : 'Inativa / Intervalo'}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono font-semibold text-slate-500">
                          {PERIODOS_HORARIOS[Number(aula.periodoId)] || 'Horário Integral'}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-black text-slate-900 group-hover:text-blue-950">
                          {aula.turma && aula.turma !== '-' ? aula.turma : 'Sem Turma'}
                        </span>
                        <span className="text-xs font-bold text-slate-700 truncate max-w-[130px]">
                          {aula.disciplina || 'Componente'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center justify-between pt-0.5">
                        <div className="flex items-center gap-1.5 truncate">
                          <i className="fa-solid fa-location-dot text-slate-400 text-[10px]"></i>
                          <span>{aula.sala && aula.sala !== '-' ? aula.sala : 'Ambiente Escolar'}</span>
                        </div>
                        <span className="text-[10px] font-bold text-cyan-800 opacity-0 group-hover:opacity-100 transition-opacity">
                          Ver detalhes →
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Informações sobre seus Tutorados */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-user-graduate text-cyan-700"></i>
                  Meus Estudantes Tutorados ({tutoradosDoProfessor.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Acompanhamento individual de rendimento, frequência e Projeto de Vida.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('alunos') : window.switchTab?.('alunos')}
                className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer"
              >
                <span>Módulo Alunos Completo</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            {tutoradosDoProfessor.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <i className="fa-solid fa-id-card-clip text-2xl text-slate-400 block"></i>
                <p>Nenhum aluno vinculado ao tutor {effectiveTeacher.nome} no momento.</p>
                <p className="text-[11px] text-slate-400">
                  Você pode vincular estudantes na aba Alunos ou selecionar outro docente acima.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {tutoradosDoProfessor.slice(0, 12).map(aluno => {
                  let freqNum = 100;
                  const rawF = aluno.presenca_anual || aluno.presenca;
                  if (rawF) freqNum = parseFloat(String(rawF).replace('%', '').replace(',', '.'));
                  const isAlerta = freqNum < 75;

                  return (
                    <div
                      key={aluno.id || aluno.ra}
                      onClick={() => setModalAluno(aluno)}
                      className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:bg-white hover:border-cyan-400 hover:shadow-xs transition-all flex flex-col justify-between space-y-2 cursor-pointer group"
                      title="Clique para consultar os dados deste tutorado"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {aluno.nome}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">
                            {aluno.turma}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          RA: {aluno.ra}
                        </div>
                        <div className="text-xs text-slate-600 line-clamp-1">
                          <span className="text-slate-400">Projeto de Vida:</span>{' '}
                          {aluno.projetoDeVida || aluno.sonhos || 'Em construção'}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <span className={isAlerta ? 'text-rose-600 font-mono' : 'text-emerald-700 font-mono'}>
                            {aluno.presenca_anual || '92%'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">Frequência</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (typeof window.abrirFichaAluno === 'function') {
                              window.abrirFichaAluno(aluno.ra);
                            } else if (typeof window.navegarEAbrirFichaAluno === 'function') {
                              window.navegarEAbrirFichaAluno(aluno.ra);
                            }
                          }}
                          className="px-2.5 py-1 text-[11px] font-bold text-cyan-800 hover:text-cyan-950 bg-cyan-50 hover:bg-cyan-100 rounded-md transition-colors cursor-pointer"
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
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* B. VISÃO SECRETARIA (Registro Atrasos, Dash Atrasos, Docs) */}
      {/* -------------------------------------------------------- */}
      {activeRole === 'SECRETARIA' && (
        <div className="space-y-6">

          {/* 1. Local para Registrar os Atrasos */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-clock-rotate-left text-amber-600"></i>
                Registro de Entrada com Atraso
              </h2>
              <p className="text-xs text-slate-500">
                Lance a chegada tardia do estudante para cômputo imediato no sistema e emissão do comprovante.
              </p>
            </div>

            <form onSubmit={handleRegistrarAtraso} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Busca e Seleção do Aluno */}
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-bold text-slate-700">
                    Buscar Aluno (Nome ou RA):
                  </label>
                  <input
                    type="text"
                    value={buscaAlunoAtraso}
                    onChange={(e) => setBuscaAlunoAtraso(e.target.value)}
                    placeholder="Digite para filtrar..."
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {buscaAlunoAtraso.length >= 2 && (
                    <div className="max-h-36 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-md mt-1 divide-y divide-slate-100">
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
                            className="p-2 text-xs hover:bg-amber-50 cursor-pointer flex justify-between items-center"
                          >
                            <span className="font-bold text-slate-800 truncate">{a.nome}</span>
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">{a.turma}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {alunoSelecionadoAtraso && (
                    <div className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded border border-emerald-200 mt-1">
                      <strong>Selecionado:</strong> {alunoSelecionadoAtraso.nome} · RA {alunoSelecionadoAtraso.ra} ({alunoSelecionadoAtraso.turma})
                    </div>
                  )}
                </div>

                {/* Horário de Entrada e Motivo */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Horário da Entrada:
                  </label>
                  <input
                    type="time"
                    value={horarioAtraso}
                    onChange={(e) => setHorarioAtraso(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
                  />

                  <label className="text-xs font-bold text-slate-700 block mt-2">
                    Motivo do Atraso:
                  </label>
                  <select
                    value={motivoAtraso}
                    onChange={(e) => setMotivoAtraso(e.target.value)}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
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
                    <label className="text-xs font-bold text-slate-700">
                      Observações / Justificativa Adicional:
                    </label>
                    <textarea
                      rows={2}
                      value={obsAtraso}
                      onChange={(e) => setObsAtraso(e.target.value)}
                      placeholder="Ex: Apresentou atestado da UBS..."
                      className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer mt-1">
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
                    className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa-solid fa-check"></i>
                    <span>{salvandoAtraso ? 'Registrando...' : 'Registrar Atraso & Emitir Comprovante'}</span>
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* 2. Dash dos Atrasos da Secretaria */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-chart-line text-blue-900"></i>
                  Dashboard de Atrasos & Assiduidade
                </h2>
                <p className="text-xs text-slate-500">
                  Visão executiva das chegadas tardias hoje e no mês vigente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('dashboard-atrasos') : window.switchTab?.('dashboard-atrasos')}
                className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer"
              >
                <span>Dashboard Completo de Atrasos</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Alunos com atraso Hoje */}
              <div className="md:col-span-2 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <i className="fa-solid fa-list-check text-slate-500"></i>
                  Últimos Atrasos Registrados Hoje ({atrasosHoje.length})
                </span>

                {atrasosHoje.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    Nenhum atraso registrado hoje até o momento.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 max-h-48 overflow-y-auto">
                    {atrasosHoje.slice(0, 6).map(o => (
                      <div key={o.id} className="py-2 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-2">
                          <p className="font-bold text-slate-900 truncate">
                            {o.nomeAluno || o.alunoNome || `RA: ${o.ra}`}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {o.turma} · {o.motivo || o.descricao || 'Atraso'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-slate-800">
                            {o.horarioAtraso || '07:30'}
                          </span>
                          <span className={`block text-[10px] font-bold ${o.justificado ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {o.justificado ? 'Justificado' : 'Sem justificativa'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Turmas Mais Reincidentes */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <i className="fa-solid fa-users text-slate-500"></i>
                  Turmas com Mais Atrasos no Mês
                </span>

                {turmasMaisAtrasos.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    Sem dados suficientes no mês.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {turmasMaisAtrasos.map(([turma, count]) => (
                      <div key={turma} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{turma}</span>
                        <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
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
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-file-contract text-blue-900"></i>
                Emissão Rápida de Documentos Oficiais
              </h2>
              <p className="text-xs text-slate-500">
                Gere atestados, declarações e guias formatadas para impressão oficial com 1 clique.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              {/* Tipo de Documento */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Tipo de Documento:</label>
                <select
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value as any)}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-800 cursor-pointer"
                >
                  <option value="matricula">Atestado de Matrícula</option>
                  <option value="frequencia">Declaração de Frequência</option>
                  <option value="transferencia">Guia de Transferência</option>
                  <option value="comparecimento">Comparecimento do Responsável</option>
                </select>
              </div>

              {/* Busca do Aluno */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700">Aluno Solicitante:</label>
                <input
                  type="text"
                  value={buscaAlunoDoc}
                  onChange={(e) => setBuscaAlunoDoc(e.target.value)}
                  placeholder="Digite nome ou RA do aluno..."
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-800"
                />
                {buscaAlunoDoc.length >= 2 && (
                  <div className="max-h-36 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-md mt-1 divide-y divide-slate-100">
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
                          className="p-2 text-xs hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                        >
                          <span className="font-bold text-slate-800 truncate">{a.nome}</span>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">{a.turma}</span>
                        </div>
                      ))}
                  </div>
                )}
                {alunoSelecionadoDoc && (
                  <div className="text-[11px] text-blue-900 bg-blue-50 p-2 rounded border border-blue-200 mt-1">
                    <strong>Selecionado:</strong> {alunoSelecionadoDoc.nome} · RA {alunoSelecionadoDoc.ra} ({alunoSelecionadoDoc.turma})
                  </div>
                )}
              </div>

              {/* Botão de Geração */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleGerarDocumento}
                  className="w-full py-2.5 px-4 bg-blue-900 hover:bg-blue-800 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-print"></i>
                  <span>Visualizar & Imprimir</span>
                </button>
              </div>
            </div>

            {tipoDocumento === 'comparecimento' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Nome do Pai / Mãe / Responsável:</label>
                  <input
                    type="text"
                    value={nomeResponsavelDoc}
                    onChange={(e) => setNomeResponsavelDoc(e.target.value)}
                    placeholder="Nome completo do responsável..."
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Horário de Permanência na Escola:</label>
                  <input
                    type="text"
                    value={periodoDoc}
                    onChange={(e) => setPeriodoDoc(e.target.value)}
                    placeholder="Ex: 08:00 às 09:30"
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* C. VISÃO GESTÃO: PAAC, CGPG, VICE-DIREÇÃO E DIREÇÃO */}
      {/* -------------------------------------------------------- */}
      {['PAAC', 'CGPG', 'VICE_DIRETOR', 'DIRETOR'].includes(activeRole) && (
        <div className="space-y-6">

          {/* PAINEL EXCLUSIVO: QUEM SÃO OS PROFESSORES QUE NÃO DERAM CIÊNCIA NO MURAL */}
          <section className="bg-white rounded-2xl p-5 sm:p-6 border border-purple-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600"></span>
                  <h2 className="text-lg font-black text-slate-900">
                    Monitoramento de Leitura & Ciência dos Professores no Mural
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Acompanhamento obrigatório da equipe pedagógica e gestora: verifique quem ainda não deu ciência nos comunicados oficiais.
                </p>
              </div>

              {/* Seletor de Recado Ativo */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-bold text-slate-600">Comunicado Ativo:</span>
                <select
                  value={activeRecadoForMonitor?.id || ''}
                  onChange={(e) => setRecadoSelecionadoMonitor(e.target.value)}
                  disabled={recadosAtivos.length === 0}
                  className="p-2 text-xs bg-purple-50 border border-purple-200 text-purple-950 font-bold rounded-lg outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer max-w-xs disabled:opacity-60 disabled:cursor-not-allowed"
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
              <div className="p-6 text-center text-xs font-bold text-slate-500 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <i className="fa-solid fa-inbox text-2xl text-slate-400 mb-1 block"></i>
                <p className="text-slate-700">Nenhum comunicado ativo no Mural no momento.</p>
                <p className="text-[11px] text-slate-400 font-normal">Apenas comunicados ativos da escola são exibidos para acompanhamento de ciência docente.</p>
              </div>
            ) : (
              <>
                {/* Barra de Progresso e Métricas */}
                <div className="bg-purple-50/70 p-4 rounded-xl border border-purple-100 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs font-bold text-purple-950">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {analiseCienciaProfessores.cientes} de {analiseCienciaProfessores.totalProfs} {analiseCienciaProfessores.totalProfs === 1 ? 'docente ciente' : 'professores cientes'}
                      </span>
                      {analiseCienciaProfessores.publicoDescricao && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          analiseCienciaProfessores.isRestrito
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-purple-100 text-purple-800 border-purple-200'
                        }`}>
                          <i className={`fa-solid ${analiseCienciaProfessores.isRestrito ? 'fa-user-tag text-amber-700' : 'fa-users text-purple-700'} mr-1 text-[9px]`}></i>
                          {analiseCienciaProfessores.publicoDescricao}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm">{analiseCienciaProfessores.taxa}% de adesão</span>
                  </div>
                  <div className="w-full bg-purple-200/80 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-purple-600 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${analiseCienciaProfessores.taxa}%` }}
                    ></div>
                  </div>
                </div>

                {/* Relação dos Professores Pendentes */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                      <i className="fa-solid fa-user-xmark text-rose-600"></i>
                      {analiseCienciaProfessores.isRestrito ? 'Docentes marcados' : 'Professores'} que NÃO deram ciência neste comunicado ({analiseCienciaProfessores.pendentesCount}):
                    </h3>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={filtroProfPendentes}
                        onChange={(e) => setFiltroProfPendentes(e.target.value)}
                        placeholder="Filtrar professor..."
                        className="p-1 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md outline-none"
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
                        className="px-2.5 py-1 text-[11px] font-bold bg-purple-100 hover:bg-purple-200 text-purple-900 rounded-md transition cursor-pointer"
                      >
                        <i className="fa-solid fa-copy mr-1"></i>
                        Copiar Lista
                      </button>
                    </div>
                  </div>

                  {analiseCienciaProfessores.profsPendentes.length === 0 ? (
                    <div className="p-4 text-center text-xs font-bold text-emerald-700 bg-emerald-50 rounded-xl border border-emerald-200">
                      <i className="fa-solid fa-circle-check text-lg mr-2"></i>
                      Parabéns! Todos os professores {analiseCienciaProfessores.isRestrito ? 'marcados para este comunicado' : 'da escola'} já deram ciência neste comunicado oficial.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                      {analiseCienciaProfessores.profsPendentes
                        .filter(p => !filtroProfPendentes || p.nome.toLowerCase().includes(filtroProfPendentes.toLowerCase()))
                        .map(p => (
                          <div
                            key={p.id || p.nome}
                            className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 pr-1">
                              <p className="font-bold text-slate-800 truncate">{p.nome}</p>
                              <p className="text-[10px] text-slate-500 truncate">{p.disciplina || p.cargo || 'Docente'}</p>
                            </div>
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 shrink-0">
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

          {/* PAINEL PRIORITÁRIO: NOTIFICAÇÕES PEDAGÓGICAS DOS PROFESSORES (Direção e Vice-Direção) */}
          {/* PAINEL PRIORITÁRIO: NOTIFICAÇÕES PEDAGÓGICAS DOS PROFESSORES (Direção, Vice, PAAC e CGPG) */}
          {['DIRETOR', 'VICE_DIRETOR', 'PAAC', 'CGPG'].includes(activeRole) && (
            <section id="painel-notificacoes-pedagogicas" className="bg-white rounded-2xl p-5 sm:p-6 border border-rose-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold text-lg shadow-xs shrink-0">
                    <i className="fa-solid fa-bell"></i>
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                      <span>Notificações Pedagógicas (Direção, Vice, PAAC e CGPG)</span>
                      {notificacoesPedagogicasDirecao.length > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
                          {notificacoesPedagogicasDirecao.length} pendente{notificacoesPedagogicasDirecao.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Alertas urgentes e ocorrências pedagógicas registradas pelos professores demandando ciência e acompanhamento da Direção, Vice, PAAC e CGPG.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigate) onNavigate('registros');
                      else if (typeof window.switchTab === 'function') window.switchTab('registros');
                    }}
                    className="text-xs font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 cursor-pointer bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg border border-rose-200 transition"
                  >
                    <span>Módulo de Registros</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </div>

              {notificacoesPedagogicasDirecao.length === 0 ? (
                <div className="p-5 text-center text-xs font-bold text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-center gap-2">
                  <i className="fa-solid fa-circle-check text-base text-emerald-600"></i>
                  <span>Nenhuma notificação pedagógica pendente de atendimento da equipe docente no momento.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {notificacoesPedagogicasDirecao.map(notif => (
                    <div
                      key={notif.id}
                      className="p-4 bg-rose-50/40 rounded-xl border border-rose-200 hover:border-rose-400 hover:bg-white transition-all space-y-2.5 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-wider text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-200 inline-block mb-1">
                            {notif.tipo || 'Questão Pedagógica'}
                          </span>
                          <h3 className="text-sm font-black text-slate-900 truncate">
                            {notif.nomeAluno || (notif.ra ? `RA ${notif.ra}` : 'Estudante')}
                          </h3>
                          <p className="text-[11px] text-slate-500 font-mono">
                            Turma: <strong className="text-slate-700">{notif.turma || 'Não informada'}</strong> · RA: {notif.ra || '—'}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          {(notif.notificadoEm || notif.data || notif.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 leading-relaxed bg-white p-2.5 rounded-lg border border-slate-200/80 line-clamp-3">
                        {notif.descricao || notif.conteudo || 'Sem descrição cadastrada'}
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-rose-100">
                        <span className="text-slate-500 truncate max-w-[180px]">
                          Por: <strong className="text-slate-800">{notif.autor_nome || notif.autor || 'Docente'}</strong>
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setModalOcorrencia(notif)}
                            className="px-2.5 py-1 text-[10px] font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-md transition cursor-pointer"
                            title="Consultar Detalhes da Ocorrência"
                          >
                            Ver Detalhes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAtenderNotificacaoPedagogica(notif.id)}
                            className="px-2.5 py-1 text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition shadow-2xs cursor-pointer flex items-center gap-1"
                            title="Marcar Notificação como Ciente / Atendida"
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

          {/* BUSCA ATIVA & OCORRÊNCIAS RECENTES (Vice-Direção e Direção) */}
          {(activeRole === 'VICE_DIRETOR' || activeRole === 'DIRETOR') && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Painel de Busca Ativa */}
              <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                        <i className="fa-solid fa-magnifying-glass-location text-rose-600"></i>
                        Casos Críticos de Busca Ativa
                      </h2>
                      <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                        {alunosBuscaAtiva.length} em alerta
                      </span>
                    </div>

                    {/* Filtro de Matrícula (Padrão: Apenas Ativos) */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <label htmlFor="filtro-ba-home" className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Filtro:</label>
                      <select
                        id="filtro-ba-home"
                        value={filtroStatusBuscaAtiva}
                        onChange={(e) => setFiltroStatusBuscaAtiva(e.target.value as any)}
                        className="text-[11px] font-bold py-1 px-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-700 outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer"
                        title="Filtrar estudantes por situação de matrícula (Padrão: Apenas Ativos)"
                      >
                        <option value="ATIVOS">Apenas Alunos Ativos (Padrão)</option>
                        <option value="TODOS">Todos os Alunos (Inclui Inativos)</option>
                        <option value="INATIVOS">Apenas Inativos / Evadidos</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Estudantes com baixa frequência (&lt;75%) demandando intervenção imediata da gestão escolar.
                  </p>

                  <div className="divide-y divide-slate-100 mt-3 max-h-60 overflow-y-auto">
                    {alunosBuscaAtiva.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500 italic">
                        <i className="fa-solid fa-circle-check text-emerald-500 mr-1.5 text-sm"></i>
                        Nenhum estudante infrequente encontrado para este filtro.
                      </div>
                    ) : (
                      alunosBuscaAtiva.map(aluno => (
                        <div
                          key={aluno.id || aluno.ra}
                          onClick={() => setModalAluno(aluno)}
                          className="py-2.5 px-2 flex items-center justify-between text-xs hover:bg-rose-50/60 rounded-lg transition-colors cursor-pointer group"
                          title="Clique para consultar os detalhes deste estudante"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-slate-900 group-hover:text-rose-950 truncate">{aluno.nome}</p>
                              {!isAlunoAtivo(aluno) && (
                                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                                  {aluno.status || aluno.situacao || 'INATIVO'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {aluno.turma} · RA {aluno.ra}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-mono font-bold text-rose-700">
                              {aluno.presenca_anual || '68%'}
                            </span>
                            <span className="block text-[10px] font-bold text-blue-800 group-hover:underline mt-0.5">
                              Ver Ficha →
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('busca-ativa') : window.switchTab?.('busca-ativa')}
                    className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Módulo de Busca Ativa SEDUC</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </section>

              {/* Feed de Ocorrências Recentes */}
              <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                      <i className="fa-solid fa-shield-halved text-blue-900"></i>
                      Ocorrências Recentes da Escola
                    </h2>
                    <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {ocorrencias.length} no total
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Últimos registros pedagógicos e disciplinares registrados pela equipe escolar.
                  </p>

                  <div className="divide-y divide-slate-100 mt-3 max-h-60 overflow-y-auto">
                    {ocorrencias.slice(0, 6).map(oc => (
                      <div
                        key={oc.id}
                        onClick={() => setModalOcorrencia(oc)}
                        className="py-2.5 px-2 text-xs space-y-0.5 hover:bg-blue-50/50 rounded-lg transition-colors cursor-pointer group"
                        title="Clique para consultar os detalhes desta ocorrência"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 group-hover:text-blue-950 truncate">
                            {oc.nomeAluno || (oc.ra ? `RA: ${oc.ra}` : 'Geral')}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {(oc.criadoEm || oc.data || '').slice(0, 10)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 line-clamp-1">
                          <strong className="text-slate-700">{oc.tipo || 'Ocorrência'}:</strong>{' '}
                          {oc.descricao || 'Sem descrição'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onNavigate ? onNavigate('registros') : window.switchTab?.('registros')}
                    className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Ver Todos os Registros</span>
                    <i className="fa-solid fa-arrow-right text-[10px]"></i>
                  </button>
                </div>
              </section>

            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. SEÇÕES UNIVERSAIS RELEVANTES: MURAL, TAREFAS & AGENDA */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* COLUNA 1 & 2: Mensagens Direcionadas do Mural */}
        <section className="lg:col-span-2 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-bullhorn text-purple-700"></i>
                Mensagens Direcionadas a Mim no Mural ({recadosDirecionados.length})
              </h2>
              <p className="text-xs text-slate-500">
                Avisos e orientações institucionais direcionados ao seu perfil e pessoa.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('mural') : window.switchTab?.('mural')}
              className="text-xs font-bold text-cyan-800 hover:text-cyan-900 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>Mural Completo</span>
              <i className="fa-solid fa-arrow-right text-[10px]"></i>
            </button>
          </div>

          {recadosDirecionados.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
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
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white hover:border-purple-300 transition-all space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-slate-900 tracking-tight">
                          {recado.titulo}
                        </h3>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span>{recado.autor || 'Gestão Escolar'}</span>
                          <span>·</span>
                          <span>{new Date(recado.criadoEm || recado.data || Date.now()).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>

                      {deuCiencia ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 shrink-0">
                          <i className="fa-solid fa-check"></i>
                          Ciência Registrada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConfirmarCiencia(recado.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
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
                        className="font-bold text-purple-700 hover:underline cursor-pointer"
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
        <div className="space-y-6">

          {/* Painel de Tarefas da Rotina */}
          <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-list-check text-amber-600"></i>
                  Minhas Tarefas
                </h2>
                <span className="text-[11px] text-slate-500">Prazos e rotinas atribuídas</span>
              </div>
              <button
                type="button"
                onClick={() => setModalNovaTarefa(true)}
                className="w-7 h-7 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center font-bold text-xs cursor-pointer"
                title="Adicionar Tarefa Rápida"
              >
                <i className="fa-solid fa-plus"></i>
              </button>
            </div>

            {tarefasFiltradas.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">
                Nenhuma tarefa pendente no momento.
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {tarefasFiltradas.slice(0, 5).map(tarefa => (
                  <div
                    key={tarefa.id}
                    className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 transition-all ${
                      tarefa.concluido
                        ? 'bg-slate-50 border-slate-200 text-slate-400 line-through'
                        : 'bg-white border-slate-200 text-slate-800 hover:border-amber-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(tarefa.concluido)}
                      onChange={() => handleToggleTarefa(tarefa.id, Boolean(tarefa.concluido))}
                      className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 leading-tight">
                        {tarefa.descricao}
                      </p>
                      {tarefa.dataLimite && (
                        <span className="text-[10px] text-amber-700 font-mono mt-0.5 block">
                          Prazo: {tarefa.dataLimite}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('rotina-pdca') : window.switchTab?.('rotina-pdca')}
                className="w-full text-center text-xs font-bold text-amber-800 hover:text-amber-950 cursor-pointer"
              >
                Abrir Módulo de Tarefas Completo (PDCA) →
              </button>
            </div>
          </section>

          {/* Painel da Agenda Escolar */}
          <section className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div>
                <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-regular fa-calendar-days text-blue-900"></i>
                  Agenda Escolar PEI
                </h2>
                <span className="text-[11px] text-slate-500">Próximos compromissos oficiais</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate('agenda') : window.switchTab?.('agenda')}
                className="text-xs font-bold text-blue-800 hover:underline cursor-pointer"
              >
                Ver Agenda
              </button>
            </div>

            {eventosFuturos.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">
                Nenhum evento futuro ou pendente para os próximos dias.
              </p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {eventosFuturos.slice(0, 5).map(evento => (
                  <div
                    key={evento.id}
                    onClick={() => setModalEvento(evento)}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white hover:border-blue-300 text-xs space-y-1 transition-all cursor-pointer group shadow-2xs"
                    title="Clique para consultar detalhes deste evento"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 group-hover:text-blue-950 truncate">
                        {evento.titulo}
                      </span>
                      <span className="text-[10px] font-mono text-blue-900 font-bold shrink-0">
                        {evento.data ? new Date(evento.data).toLocaleDateString('pt-BR') : 'A definir'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{evento.categoria || 'Geral'}</span>
                      <div className="flex items-center gap-1.5">
                        {evento.horaInicio && (
                          <span className="font-mono text-[10px] text-slate-600">
                            {evento.horaInicio}
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity">
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

      {/* ======================================================== */}
      {/* 5. MODAIS: RECADO, NOVA TAREFA, COMPROVANTE & DOCUMENTOS */}
      {/* ======================================================== */}

      {/* Modal Leitura Recado Completo */}
      {modalRecado && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xl font-black text-slate-900">{modalRecado.titulo}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Publicado por {modalRecado.autor || 'Gestão'} em {new Date(modalRecado.criadoEm || modalRecado.data || Date.now()).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalRecado(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {modalRecado.conteudo || modalRecado.mensagem || modalRecado.descricao}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Total de ciências registradas: <strong className="text-slate-800">{(modalRecado.cientes || []).length}</strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalRecado(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleConfirmarCiencia(modalRecado.id);
                    setModalRecado(null);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-check"></i>
                  <span>Confirmar Ciência Agora</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova Tarefa */}
      {modalNovaTarefa && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900">Nova Tarefa Rápida</h3>
              <button
                type="button"
                onClick={() => setModalNovaTarefa(false)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvarNovaTarefa} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Descrição da Tarefa:</label>
                <textarea
                  required
                  rows={3}
                  value={novaTarefaDesc}
                  onChange={(e) => setNovaTarefaDesc(e.target.value)}
                  placeholder="Ex: Entregar relatório de busca ativa no conselho..."
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Data Limite (Prazo):</label>
                  <input
                    type="date"
                    value={novaTarefaPrazo}
                    onChange={(e) => setNovaTarefaPrazo(e.target.value)}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Atribuir a:</label>
                  <select
                    value={novaTarefaAtribuir}
                    onChange={(e) => setNovaTarefaAtribuir(e.target.value)}
                    className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="">Meu Cargo ({activeRole})</option>
                    <option value="PROFESSOR">Professores</option>
                    <option value="SECRETARIA">Secretaria</option>
                    <option value="CGPG">CGPG</option>
                    <option value="PAAC">PAAC</option>
                    <option value="VICE_DIRETOR">Vice-Direção</option>
                    <option value="DIRETOR">Direção</option>
                    <option value="TODA A EQUIPE">Toda a Equipe</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNovaTarefa(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl shadow-xs cursor-pointer"
                >
                  Criar Tarefa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Comprovante de Atraso (Slip de Entrada) */}
      {comprovanteAtraso && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="text-center border-b border-slate-200 pb-3">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Governo do Estado de São Paulo · SEDUC-SP
              </span>
              <h3 className="text-base font-black text-slate-900 mt-0.5">
                EE CLÓVIS DE LUCCA · PEI
              </h3>
              <p className="text-xs font-bold text-amber-700 mt-1 uppercase">
                Comprovante de Entrada com Atraso
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Protocolo:</span>
                <span className="font-mono font-bold text-slate-900">{comprovanteAtraso.protocolo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estudante:</span>
                <span className="font-bold text-slate-900">{comprovanteAtraso.alunoNome}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RA / Turma:</span>
                <span className="font-mono text-slate-900">{comprovanteAtraso.alunoRa} · {comprovanteAtraso.turma}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Data / Horário:</span>
                <span className="font-bold text-slate-900">{comprovanteAtraso.data} às {comprovanteAtraso.horario}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Motivo:</span>
                <span className="text-slate-900">{comprovanteAtraso.motivo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Situação:</span>
                <span className={`font-bold ${comprovanteAtraso.justificado ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {comprovanteAtraso.justificado ? 'Atraso Justificado' : 'Atraso Não Justificado'}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-center text-slate-500 border-t border-b border-dashed border-slate-200 py-2">
              Autorizada a entrada em sala de aula pelo docente da aula vigente.
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setComprovanteAtraso(null)}
                className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
              >
                Concluir
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="w-1/2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-8 space-y-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
            
            {/* Cabeçalho Oficial do Documento */}
            <div className="text-center space-y-1 border-b-2 border-slate-900 pb-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                GOVERNO DO ESTADO DE SÃO PAULO · SECRETARIA DA EDUCAÇÃO
              </p>
              <p className="text-xs font-bold text-slate-700">
                DIRETORIA DE ENSINO DA REGIÃO LESTE 4
              </p>
              <h2 className="text-lg font-black text-slate-900">
                ESCOLA ESTADUAL CLÓVIS DE LUCCA · PROGRAMA ENSINO INTEGRAL
              </h2>
              <p className="text-[10px] text-slate-500 font-mono">
                CIE: 004128 · CNPJ: 48.031.918/0001-20 · Rua do Oratório, São Paulo - SP
              </p>
            </div>

            {/* Título do Documento */}
            <div className="text-center py-2">
              <h3 className="text-base font-black text-slate-900 uppercase tracking-wide underline underline-offset-4">
                {documentoPronto.titulo}
              </h3>
            </div>

            {/* Corpo Oficial do Documento */}
            <div className="text-sm text-slate-800 text-justify leading-relaxed p-4 bg-slate-50/50 rounded-xl border border-slate-100">
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
                <p className="font-bold text-slate-800">{documentoPronto.emissor}</p>
                <p className="text-[10px] text-slate-500 uppercase">{documentoPronto.cargoEmissor}</p>
              </div>
              <div className="space-y-1">
                <div className="w-48 h-0.5 bg-slate-400 mx-auto"></div>
                <p className="font-bold text-slate-800">Direção Escolar</p>
                <p className="text-[10px] text-slate-500 uppercase">EE Clóvis de Lucca</p>
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDocumentoPronto(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-blue-100 text-blue-900 flex items-center justify-center font-black text-sm">
                  {modalAula.periodoId}ª
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {modalAula.turma} · {modalAula.disciplina || 'Aula Regular'}
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    {PERIODOS_HORARIOS[Number(modalAula.periodoId)] || 'Horário Integral PEI'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalAula(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Docente Responsável:</span>
                <span className="font-bold text-slate-900">{modalAula.professor}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Dia da Semana:</span>
                <span className="font-bold text-slate-900">{DIAS_SEMANA_LABELS[String(modalAula.dia).toLowerCase()] || modalAula.dia}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Situação da Aula:</span>
                <span className={`font-extrabold px-2 py-0.5 rounded text-[10px] uppercase border ${
                  isRegularTeachingClass(modalAula)
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-slate-200 text-slate-700 border-slate-300'
                }`}>
                  {isRegularTeachingClass(modalAula) ? 'Aula Ativa (Regular)' : 'Inativa / Intervalo / ATPC'}
                </span>
              </div>
              {modalAula.sala && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Ambiente / Sala:</span>
                  <span className="font-bold text-slate-900">{modalAula.sala}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalAula(null)}
                className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
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
                className="w-1/2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {modalEvento.categoria || 'Compromisso Escolar PEI'}
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-1.5 leading-snug">{modalEvento.titulo}</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalEvento(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Data do Evento:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {modalEvento.data ? modalEvento.data.split('-').reverse().join('/') : 'A definir'}
                  {modalEvento.dataFim && modalEvento.dataFim !== modalEvento.data ? ` até ${modalEvento.dataFim.split('-').reverse().join('/')}` : ''}
                </span>
              </div>
              {(modalEvento.horaInicio || modalEvento.horario) && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Horário Programado:</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {modalEvento.horaInicio || modalEvento.horario} {modalEvento.horaFim ? `às ${modalEvento.horaFim}` : ''}
                  </span>
                </div>
              )}
              {modalEvento.local && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Local / Espaço:</span>
                  <span className="font-bold text-slate-900">{modalEvento.local}</span>
                </div>
              )}
              {modalEvento.publicoAlvo && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Público Alvo / Participantes:</span>
                  <span className="font-bold text-slate-900">{modalEvento.publicoAlvo}</span>
                </div>
              )}
            </div>

            {modalEvento.descricao && (
              <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/50 p-3 rounded-lg border border-slate-200 whitespace-pre-wrap max-h-36 overflow-y-auto">
                {modalEvento.descricao}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalEvento(null)}
                className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
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
                className="w-1/2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                  Dossiê / Consulta de Estudante
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-1 leading-snug">{modalAluno.nome}</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">RA: {modalAluno.ra} · Turma: {modalAluno.turma}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalAluno(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Professor Tutor:</span>
                <span className="font-bold text-slate-900">{modalAluno.tutor || modalAluno.tutorNome || 'Não vinculado'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Presença Anual:</span>
                <span className={`font-mono font-bold ${parseFloat(String(modalAluno.presenca_anual || modalAluno.presenca || '100').replace('%', '').replace(',', '.')) < 75 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {modalAluno.presenca_anual || modalAluno.presenca || '95%'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Total de Faltas Computadas:</span>
                <span className="font-mono font-bold text-slate-800">{modalAluno.total_faltas || modalAluno.faltas || 0} aulas</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Status de Matrícula:</span>
                <span className="font-bold text-slate-800 uppercase">{modalAluno.status || modalAluno.situacao || 'ATIVO'}</span>
              </div>
              {modalAluno.telefoneResponsavel && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Telefone Responsável:</span>
                  <span className="font-mono font-bold text-slate-900">{modalAluno.telefoneResponsavel}</span>
                </div>
              )}
              {modalAluno.projetoDeVida && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-medium block mb-1">Projeto de Vida / Sonhos:</span>
                  <p className="text-slate-800 italic bg-white p-2 rounded border border-slate-200">{modalAluno.projetoDeVida}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalAluno(null)}
                className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
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
                className="w-1/2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-800 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  {modalOcorrencia.tipo || modalOcorrencia.categoria || 'Registro Pedagógico'}
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1.5 leading-snug">
                  {modalOcorrencia.nomeAluno || (modalOcorrencia.ra ? `Estudante RA: ${modalOcorrencia.ra}` : 'Ocorrência Geral')}
                </h3>
                {modalOcorrencia.turma && (
                  <p className="text-xs text-slate-500 font-mono mt-0.5">Turma: {modalOcorrencia.turma}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModalOcorrencia(null)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer shrink-0 ml-2"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Data do Fato:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {(modalOcorrencia.data || modalOcorrencia.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Registrado por:</span>
                <span className="font-bold text-slate-900">{modalOcorrencia.autor || modalOcorrencia.autor_nome || 'Equipe Escolar'}</span>
              </div>
              {modalOcorrencia.motivo && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Motivo Apontado:</span>
                  <span className="font-bold text-slate-900">{modalOcorrencia.motivo}</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-700">Relato do Fato:</span>
              <div className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-200 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {modalOcorrencia.descricao || 'Sem descrição cadastrada'}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalOcorrencia(null)}
                className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
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
                className="w-1/2 py-2.5 bg-blue-900 hover:bg-blue-800 text-white text-xs font-black rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
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
