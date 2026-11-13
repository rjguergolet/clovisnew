import React, { useState, useEffect, useMemo, useCallback } from 'react';
import MascoteSaraState from './MascoteSaraState';
import { db, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, setDoc, getDocs } from '../lib/database';
import { isTeacherAtSchool, isRegularTeachingClass, normalizeTeacherName, extrairEMigrarDocentesDoHorario, isSameProfessor, getPeriodoOrder, getPeriodoRotulo, normalizeSubstituicoesPeriodos, normalizarDia } from '../utils';
import { registrarLogAuditoria } from '../modules/auditLogger';
import { obterUsuarioAtivoCompleto } from '../modules/authHelper';

// Opções de Áreas de Conhecimento PEI Padronizadas
export const OPCOES_AREAS_PEI = [
  'Exatas (EXA)',
  'Humanas (HUM)',
  'Linguagens (LGG)',
  'Ciências da Natureza (NAT)',
  'Gestão/Outros (OUT)'
];

export const AREAS_CONHECIMENTO = {
  'Exatas (EXA)': ['Matemática', 'Física', 'Raciocínio Lógico'],
  'Ciências da Natureza (NAT)': ['Ciências', 'Biologia', 'Química'],
  'Humanas (HUM)': ['História', 'Geografia', 'Filosofia', 'Sociologia'],
  'Linguagens (LGG)': ['Língua Portuguesa', 'Inglês', 'Arte', 'Educação Física'],
  'Gestão/Outros (OUT)': ['Projeto de Vida', 'Orientação de Estudos', 'Inovação Tecnológica', 'Eletiva', 'Tutoria', 'Gestão PEI', 'Coordenador', 'Vice-Diretor']
};

export function normalizarArea(areaStr) {
  if (!areaStr) return 'Gestão/Outros (OUT)';
  const s = String(areaStr).trim();
  if (OPCOES_AREAS_PEI.includes(s)) return s;

  const upper = s.toUpperCase();
  if (upper.includes('EXA') || upper.includes('EXATAS')) return 'Exatas (EXA)';
  if (upper.includes('NAT') || upper.includes('NATUREZA') || upper.includes('BIOLOGIA') || upper.includes('QUÍMICA')) return 'Ciências da Natureza (NAT)';
  if (upper.includes('HUM') || upper.includes('HUMANAS') || upper.includes('HISTÓRIA') || upper.includes('GEOGRAFIA')) return 'Humanas (HUM)';
  if (upper.includes('LGG') || upper.includes('LINGUA') || upper.includes('PORTUGUÊS') || upper.includes('ARTE') || upper.includes('INGLÊS') || upper.includes('EDUCAÇÃO FÍSICA')) return 'Linguagens (LGG)';
  if (upper.includes('OUT') || upper.includes('GESTÃO') || upper.includes('DIVERSIFICADA') || upper.includes('PROJETO DE VIDA')) return 'Gestão/Outros (OUT)';

  if (upper.includes('MATEMÁTICA') || upper.includes('FÍSICA')) return 'Exatas (EXA)';
  if (upper.includes('CIÊNCIAS')) return 'Ciências da Natureza (NAT)';

  return 'Gestão/Outros (OUT)';
}

export function encontrarAreaDisciplina(disciplina) {
  if (!disciplina) return 'Gestão/Outros (OUT)';
  const discLower = disciplina.toLowerCase();
  if (discLower.includes('matemática') || discLower.includes('física') || discLower.includes('raciocínio')) {
    return 'Exatas (EXA)';
  }
  if (discLower.includes('ciências') || discLower.includes('biologia') || discLower.includes('química')) {
    return 'Ciências da Natureza (NAT)';
  }
  if (discLower.includes('história') || discLower.includes('geografia') || discLower.includes('filosofia') || discLower.includes('sociologia')) {
    return 'Humanas (HUM)';
  }
  if (discLower.includes('português') || discLower.includes('língua') || discLower.includes('inglês') || discLower.includes('arte') || discLower.includes('educação física')) {
    return 'Linguagens (LGG)';
  }
  return 'Gestão/Outros (OUT)';
}

const MOTIVOS_AUSENCIA = [
  'Atestado Médico / Licença Saúde',
  'Falta Justificada',
  'Afastamento / Reunião SEDUC',
  'Treinamento / Formação Pedagógica',
  'Acompanhamento de Alunos em Evento',
  'Outros Motivos'
];

const PERIODOS_AULA = [
  { id: 1, rotulo: '1ª Aula', horario: '07:00 - 07:50', tipo: 'aula' },
  { id: 2, rotulo: '2ª Aula', horario: '07:50 - 08:40', tipo: 'aula' },
  { id: 'int1', rotulo: 'Intervalo', horario: '08:40 - 08:50', tipo: 'intervalo' },
  { id: 3, rotulo: '3ª Aula', horario: '08:50 - 09:40', tipo: 'aula' },
  { id: 4, rotulo: '4ª Aula', horario: '09:40 - 10:30', tipo: 'aula' },
  { id: 5, rotulo: '5ª Aula', horario: '10:30 - 11:20', tipo: 'aula' },
  { id: 'almoco', rotulo: 'Almoço', horario: '11:20 - 12:20', tipo: 'intervalo' },
  { id: 6, rotulo: '6ª Aula', horario: '12:20 - 13:10', tipo: 'aula' },
  { id: 7, rotulo: '7ª Aula', horario: '13:10 - 14:00', tipo: 'aula' },
  { id: 8, rotulo: '8ª Aula', horario: '14:20 - 15:10', tipo: 'aula' },
  { id: 9, rotulo: '9ª Aula', horario: '15:10 - 16:00', tipo: 'aula' },
  { id: 'int2', rotulo: 'Intervalo Tarde', horario: '16:00 - 16:10', tipo: 'intervalo' },
  { id: 10, rotulo: '10ª Aula', horario: '16:10 - 17:00', tipo: 'aula' },
  { id: 11, rotulo: '11ª Aula', horario: '17:00 - 17:50', tipo: 'aula' },
  { id: 12, rotulo: '12ª Aula', horario: '17:50 - 18:40', tipo: 'aula' },
  { id: 'jantar', rotulo: 'Jantar', horario: '18:40 - 19:40', tipo: 'intervalo' },
  { id: 13, rotulo: '13ª Aula', horario: '19:40 - 20:30', tipo: 'aula' },
  { id: 14, rotulo: '14ª Aula', horario: '20:30 - 21:20', tipo: 'aula' }
];

const PROFESSORES_INICIAIS = [
  { nome: 'Profª Maria Silva', disciplina: 'Língua Portuguesa', area: 'Linguagens (LGG)', saldoAulas: 4, tipo: 'EFETIVO' },
  { nome: 'Prof. Carlos Eduardo', disciplina: 'Matemática', area: 'Exatas (EXA)', saldoAulas: 2, tipo: 'EFETIVO' },
  { nome: 'Profª Ana Paula', disciplina: 'Ciências', area: 'Ciências da Natureza (NAT)', saldoAulas: 5, tipo: 'EFETIVO' },
  { nome: 'Prof. Roberto Santos', disciplina: 'História', area: 'Humanas (HUM)', saldoAulas: 1, tipo: 'EFETIVO' },
  { nome: 'Prof. Fernando Lima', disciplina: 'Geografia', area: 'Humanas (HUM)', saldoAulas: 3, tipo: 'EFETIVO' },
  { nome: 'Profª Juliana Mendes', disciplina: 'Física', area: 'Exatas (EXA)', saldoAulas: 0, tipo: 'EFETIVO' },
  { nome: 'Prof. Lucas Costa', disciplina: 'Educação Física', area: 'Linguagens (LGG)', saldoAulas: 6, tipo: 'EFETIVO' },
  { nome: 'Profª Vanessa Rocha', disciplina: 'Inglês', area: 'Linguagens (LGG)', saldoAulas: 2, tipo: 'EFETIVO' },
  { nome: 'Prof. Marcos Souza', disciplina: 'Inovação Tecnológica', area: 'Gestão/Outros (OUT)', saldoAulas: 1, tipo: 'PAAC / EVENTUAL' },
  { nome: 'Profª Camila Santos', disciplina: 'Projeto de Vida', area: 'Gestão/Outros (OUT)', saldoAulas: 3, tipo: 'PAAC / EVENTUAL' }
];

const TURMAS_PEI = [
  '6º Ano A', '6º Ano B', '7º Ano A', '8º Ano A', '9º Ano A',
  '1º Ano A E.M.', '2º Ano A E.M.', '3º Ano A E.M.'
];

// Helpers para Formatação Brasileira de Datas e Determinação da Próxima Substituição
const getHojeLocalStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDataBR = (dataStr) => {
  if (!dataStr || typeof dataStr !== 'string') return '';
  const clean = dataStr.trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return clean;
};

const getDataBadgeInfo = (dataStr) => {
  if (!dataStr) return null;
  const clean = dataStr.trim().split('T')[0];
  const hojeStr = getHojeLocalStr();
  if (clean === hojeStr) {
    return { label: 'Hoje', className: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
  }
  const dAmanha = new Date();
  dAmanha.setDate(dAmanha.getDate() + 1);
  const amanhaStr = `${dAmanha.getFullYear()}-${String(dAmanha.getMonth() + 1).padStart(2, '0')}-${String(dAmanha.getDate()).padStart(2, '0')}`;
  if (clean === amanhaStr) {
    return { label: 'Amanhã', className: 'bg-blue-100 text-blue-900 border-blue-300' };
  }
  if (clean > hojeStr) {
    return { label: 'Próxima', className: 'bg-cyan-100 text-cyan-900 border-cyan-300' };
  }
  return null;
};

// Dados Iniciais Exemplo para Fallback
const GERAR_SUBSTITUICOES_INICIAIS = () => {
  const hoje = new Date().toISOString().split('T')[0];
  return [
    {
      id: 'sub-init-1',
      data: hoje,
      professorAusente: 'Profª Maria Silva',
      disciplina: 'Língua Portuguesa',
      area: 'Linguagens (LGG)',
      turma: '6º Ano A',
      periodoId: 1,
      motivo: 'Atestado Médico / Licença Saúde',
      professorSubstituto: 'Profª Vanessa Rocha',
      tipoSubstituto: 'Mesma Área (Linguagens (LGG))',
      status: 'CONFIRMADA',
      observacao: 'Aulas de Língua Portuguesa com apoio de leitura instrumental'
    },
    {
      id: 'sub-init-2',
      data: hoje,
      professorAusente: 'Prof. Carlos Eduardo',
      disciplina: 'Matemática',
      area: 'Exatas (EXA)',
      turma: '8º Ano A',
      periodoId: 3,
      motivo: 'Treinamento / Formação Pedagógica',
      professorSubstituto: 'Profª Juliana Mendes',
      tipoSubstituto: 'Mesma Área (Exatas (EXA))',
      status: 'CONFIRMADA',
      observacao: 'Atividade prática de recomposição em sala de aula'
    }
  ];
};

export default function SubstituicaoPEI() {
  const [substituicoes, setSubstituicoes] = useState(() => (Array.isArray(window.substituicoesCache) ? window.substituicoesCache : []));
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState(null);
  const [confirmZerarSaldo, setConfirmZerarSaldo] = useState(false);
  const [confirmDeleteDocenteNome, setConfirmDeleteDocenteNome] = useState(null);

  const showFeedback = (msg, type = 'info') => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(msg, type, 4500);
    }
  };

  // State de Slots de Horários
  const [periodosAula, setPeriodosAula] = useState(PERIODOS_AULA);

  // State de Matriz de Indisponibilidade de Professores
  const [indisponibilidadeProfs, setIndisponibilidadeProfs] = useState({});

  // State de Grade Horária Completa (para verificação de docentes ocupados em aula/atividade PEI)
  const [horariosEscola, setHorariosEscola] = useState([]);

  // Sub-abas de visualização: 'painel' | 'sugestao' | 'saldo' | 'relatorio' | 'docentes'
  const [subAba, setSubAba] = useState('painel');

  // Filtros
  const [filtroData, setFiltroData] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroTurma, setFiltroTurma] = useState('TODAS');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [termoBusca, setTermoBusca] = useState('');
  const [tipoOrdenacao, setTipoOrdenacao] = useState('dia-aula'); // 'dia-aula' | 'docente'

  // Escutar Firestore doc 'config_escola/periodos_aula'
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'periodos_aula');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && Array.isArray(docSnap.data().slots) && docSnap.data().slots.length > 0) {
        setPeriodosAula(docSnap.data().slots);
      } else {
        const cached = localStorage.getItem('clovis_periodos_aula');
        if (cached) {
          try { setPeriodosAula(JSON.parse(cached)); } catch(e) {}
        }
      }
    }, (err) => {
      console.warn('Erro ao carregar periodos_aula em SubstituicaoPEI:', err);
    });
    return () => unsubscribe();
  }, []);

  // Escutar Firestore doc 'config_escola/indisponibilidade_professores'
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'indisponibilidade_professores');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().matriz) {
        setIndisponibilidadeProfs(docSnap.data().matriz);
      } else {
        const cached = localStorage.getItem('clovis_indisponibilidade_professores');
        if (cached) {
          try { setIndisponibilidadeProfs(JSON.parse(cached)); } catch(e) {}
        }
      }
    }, (err) => {
      console.warn('Erro ao carregar indisponibilidade_professores em SubstituicaoPEI:', err);
    });
    return () => unsubscribe();
  }, []);

  // Carregar Grade Horária de 'horarios' com cache agressivo / evento local (Zero Reads)
  useEffect(() => {
    const carregarHorariosCache = async () => {
      if (window.gradeCache && Array.isArray(window.gradeCache) && window.gradeCache.length > 0) {
        setHorariosEscola(window.gradeCache);
        return;
      }
      const cached = localStorage.getItem('clovis_horarios_cache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setHorariosEscola(parsed);
          window.gradeCache = parsed;
          return;
        } catch (e) {}
      }
      try {
        const colRef = collection(db, 'horarios');
        let snap;
        try {
          snap = await getDocs(colRef, { source: 'cache' });
          if (!snap || snap.empty) throw new Error('Cache vazio');
        } catch (cErr) {
          snap = await getDocs(colRef, { source: 'server' });
        }
        const docs = [];
        snap.forEach((docSnap) => {
          docs.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (docs.length > 0) {
          setHorariosEscola(docs);
          window.gradeCache = docs;
          localStorage.setItem('clovis_horarios_cache', JSON.stringify(docs));
        }
      } catch (err) {
        console.warn('Erro ao carregar horarios em SubstituicaoPEI:', err);
      }
    };

    carregarHorariosCache();

    const handleHorariosUpdate = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        setHorariosEscola(e.detail);
      }
    };
    window.addEventListener('clovis_horarios_updated', handleHorariosUpdate);
    return () => window.removeEventListener('clovis_horarios_updated', handleHorariosUpdate);
  }, []);

  // Modal Lançamento
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemEdicao, setItemEdicao] = useState(null);
  const [salvando, setSalvando] = useState(false);

  // Formulário de Substituição
  const [form, setForm] = useState({
    data: new Date().toISOString().split('T')[0],
    professorAusente: 'Profª Maria Silva',
    disciplina: 'Língua Portuguesa',
    area: 'Linguagens',
    turma: '6º Ano A',
    periodoId: 1,
    motivo: 'Atestado Médico / Licença Saúde',
    professorSubstituto: '',
    tipoSubstituto: 'Sugestão Automática',
    status: 'CONFIRMADA',
    observacao: ''
  });

  // Role e Permissões
  const [userRole] = useState(() => {
    if (typeof window !== 'undefined' && typeof window.obterRoleAtual === 'function') {
      return window.obterRoleAtual();
    }
    return window?.currentUserRole || 'DIRETOR';
  });

  const roleNorm = String(userRole || 'PROFESSOR').toUpperCase().trim().replace(/-/g, '_');
  const temAcessoSubstituicao = ['DIRETOR', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG'].some(
    r => roleNorm === r || roleNorm.includes(r)
  );
  const podeEditar = temAcessoSubstituicao;

  // Carregar collection 'substituicoes_diarias' com Cache Agressivo (Zero Reads desnecessários)
  const carregarSubstituicoes = useCallback(async (forceServer = false) => {
    setLoading(true);
    setErro(null);
    try {
      let snapshot;
      let colRef = collection(db, 'substituicoes_diarias');
      if (forceServer) {
        try {
          snapshot = await getDocs(colRef, { source: 'server' });
        } catch (e) {
          colRef = collection(db, 'substituicoes_pei');
          snapshot = await getDocs(colRef, { source: 'server' });
        }
      } else {
        try {
          snapshot = await getDocs(colRef, { source: 'cache' });
          if (!snapshot || snapshot.empty) {
            colRef = collection(db, 'substituicoes_pei');
            snapshot = await getDocs(colRef, { source: 'cache' });
            if (!snapshot || snapshot.empty) throw new Error('Cache vazio');
          }
        } catch (cErr) {
          try {
            snapshot = await getDocs(collection(db, 'substituicoes_diarias'), { source: 'server' });
          } catch (sErr) {
            snapshot = await getDocs(collection(db, 'substituicoes_pei'), { source: 'server' });
          }
        }
      }

      const docs = [];
      snapshot.forEach((docSnap) => {
        const dData = docSnap.data();
        docs.push({
          id: docSnap.id,
          ...dData,
          data: dData.data_referencia || dData.data,
          data_referencia: dData.data_referencia || dData.data,
          professorAusente: dData.professor_ausente || dData.professorAusente,
          professor_ausente: dData.professor_ausente || dData.professorAusente,
          professorSubstituto: dData.professor_substituto || dData.professorSubstituto,
          professor_substituto: dData.professor_substituto || dData.professorSubstituto,
          id_aula: dData.id_aula || docSnap.id
        });
      });

      if (docs.length > 0) {
        setSubstituicoes(docs);
        window.substituicoesCache = docs;
        const hojeStr = new Date().toISOString().split('T')[0];
        window.substituicoesHoje = docs.filter(s => (s.data_referencia || s.data) === hojeStr);
        localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(docs));
      } else {
        const cache = localStorage.getItem('clovis_substituicoes_cache');
        if (cache) {
          try {
            const parsed = JSON.parse(cache);
            setSubstituicoes(parsed);
            window.substituicoesCache = parsed;
            const hojeStr = new Date().toISOString().split('T')[0];
            window.substituicoesHoje = parsed.filter(s => (s.data_referencia || s.data) === hojeStr);
          } catch (e) {
            const inis = GERAR_SUBSTITUICOES_INICIAIS();
            setSubstituicoes(inis);
            window.substituicoesCache = inis;
            window.substituicoesHoje = inis;
            localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(inis));
          }
        } else {
          const inis = GERAR_SUBSTITUICOES_INICIAIS();
          setSubstituicoes(inis);
          window.substituicoesCache = inis;
          window.substituicoesHoje = inis;
          localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(inis));
        }
      }
    } catch (err) {
      console.warn('Erro ao conectar Firestore substituicoes_diarias, utilizando dados locais:', err);
      setErro('Modo offline/cache local ativado.');
      const cache = localStorage.getItem('clovis_substituicoes_cache');
      if (cache) {
        try {
          const parsed = JSON.parse(cache);
          setSubstituicoes(parsed);
          window.substituicoesCache = parsed;
          const hojeStr = new Date().toISOString().split('T')[0];
          window.substituicoesHoje = parsed.filter(s => (s.data_referencia || s.data) === hojeStr);
        } catch (e) {
          const inis = GERAR_SUBSTITUICOES_INICIAIS();
          setSubstituicoes(inis);
          window.substituicoesCache = inis;
          window.substituicoesHoje = inis;
        }
      } else {
        const inis = GERAR_SUBSTITUICOES_INICIAIS();
        setSubstituicoes(inis);
        window.substituicoesCache = inis;
        window.substituicoesHoje = inis;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Função Global de Renderização da Grade Diária com Sobreposição em Memória (Zero Reads Extras)
  const renderizarGradeDiaria = useCallback((dataReferencia = null) => {
    const dataAlvo = dataReferencia || (filtroData || new Date().toISOString().split('T')[0]);
    const gradeFixa = window.gradeCache || horariosEscola || [];
    const listaSubs = window.substituicoesCache || substituicoes || [];
    const subsHoje = listaSubs.filter(s => {
      const sData = s.data_referencia || s.data;
      return sData === dataAlvo && s.status !== 'CANCELADA';
    });

    window.substituicoesHoje = subsHoje;

    const [year, month, day] = dataAlvo.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const mapDays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const diaSemana = mapDays[dateObj.getDay()] || 'segunda';
    const diaAlvo = normalizarDia(diaSemana);

    // Cruzar grade fixa com substituições em memória sem queries ao Firestore
    const gradeMesclada = gradeFixa
      .filter(h => normalizarDia(h.dia) === diaAlvo)
      .map(aulaFixa => {
        const pOrder = getPeriodoOrder(aulaFixa.periodoId);
        const subst = subsHoje.find(s => {
          const pSub = getPeriodoOrder(s.periodoId);
          const matchPeriodo = pSub === pOrder;
          const matchTurma = !s.turma || s.turma === aulaFixa.turma;
          const matchProf = isSameProfessor(s.professor_ausente || s.professorAusente, aulaFixa.professor);
          const matchId = s.id_aula && (s.id_aula === aulaFixa.id || s.id_aula === `${dataAlvo}_${pOrder}_${aulaFixa.turma}`);
          return matchId || (matchPeriodo && matchTurma && matchProf);
        });

        if (subst) {
          return {
            ...aulaFixa,
            temSubstituicao: true,
            substituicaoId: subst.id,
            professorOriginal: aulaFixa.professor,
            professorAusente: subst.professor_ausente || subst.professorAusente,
            professorSubstituto: subst.professor_substituto || subst.professorSubstituto,
            professor: subst.professor_substituto || subst.professorSubstituto, // Sobreposição em memória
            tipoSubstituto: subst.tipoSubstituto || 'Substituto',
            motivoSubstituicao: subst.motivo || 'Substituição PEI',
            statusSubstituicao: subst.status || 'CONFIRMADA',
            observacaoSubstituicao: subst.observacao || ''
          };
        }

        return {
          ...aulaFixa,
          temSubstituicao: false
        };
      });

    window.dispatchEvent(new CustomEvent('clovis_grade_diaria_updated', {
      detail: { gradeMesclada, subsHoje, dataAlvo }
    }));

    return gradeMesclada;
  }, [filtroData, horariosEscola, substituicoes]);

  useEffect(() => {
    window.renderizarGradeDiaria = renderizarGradeDiaria;
  }, [renderizarGradeDiaria]);

  // Carregamento em Tempo Real de Substituições via onSnapshot (Ativo enquanto a aba Substituições estiver aberta)
  useEffect(() => {
    setLoading(true);
    setErro(null);

    // 1. Renderização imediata se já houver dados em cache
    const cachedSubs = window.substituicoesCache || (() => {
      try {
        const c = localStorage.getItem('clovis_substituicoes_cache');
        return c ? JSON.parse(c) : null;
      } catch (e) { return null; }
    })();

    if (Array.isArray(cachedSubs) && cachedSubs.length > 0) {
      setSubstituicoes(cachedSubs);
      setLoading(false);
    }

    const colRef = collection(db, 'substituicoes_diarias');

    // Conecta o listener em tempo real exclusivamente enquanto o componente de Substituição estiver montado
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const docs = [];
      snapshot.forEach((docSnap) => {
        const dData = docSnap.data();
        docs.push({
          id: docSnap.id,
          ...dData,
          data: dData.data_referencia || dData.data,
          data_referencia: dData.data_referencia || dData.data,
          professorAusente: dData.professor_ausente || dData.professorAusente,
          professor_ausente: dData.professor_ausente || dData.professorAusente,
          professorSubstituto: dData.professor_substituto || dData.professorSubstituto,
          professor_substituto: dData.professor_substituto || dData.professorSubstituto,
          id_aula: dData.id_aula || docSnap.id
        });
      });

      if (docs.length > 0) {
        setSubstituicoes(docs);
        window.substituicoesCache = docs;
        const hojeStr = new Date().toISOString().split('T')[0];
        window.substituicoesHoje = docs.filter(s => (s.data_referencia || s.data) === hojeStr);
        try {
          localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(docs));
        } catch (e) {}
      } else if (!snapshot.metadata || snapshot.metadata.fromCache === false) {
        // Se vazio no servidor, usa dados iniciais
        const inis = GERAR_SUBSTITUICOES_INICIAIS();
        setSubstituicoes(inis);
        window.substituicoesCache = inis;
        window.substituicoesHoje = inis;
      }

      setLoading(false);
      setIsRealtimeConnected(true);
      setErro(null);
    }, (error) => {
      console.warn('Aviso no listener em tempo real de substituições:', error);
      setIsRealtimeConnected(false);
      setLoading(false);
      setErro('Modo offline / cache local ativado.');
    });

    // Cleanup: Desconecta o listener assim que a aba de Substituições for fechada
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    window.carregarSubstituicoes = carregarSubstituicoes;
  }, [carregarSubstituicoes]);

  useEffect(() => {
    if (typeof window !== 'undefined' && Array.isArray(substituicoes)) {
      window.substituicoesCache = substituicoes;
      const hojeStr = filtroData || new Date().toISOString().split('T')[0];
      window.substituicoesHoje = substituicoes.filter(s => (s.data_referencia || s.data) === hojeStr);
    }
  }, [substituicoes, filtroData]);

  // State do Cadastro de Professores e Áreas do Conhecimento (Sincronizado via Firestore & Cache Local)
  const [cadastroProfessores, setCadastroProfessores] = useState(() => {
    const cached = localStorage.getItem('clovis_cadastro_professores');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    return [];
  });

  const [novoDocenteForm, setNovoDocenteForm] = useState({
    nome: '',
    disciplina: '',
    area: 'Exatas (EXA)',
    tipo: 'EFETIVO',
    saldoAulas: 0
  });

  // Escutar Firestore doc 'config_escola/cadastro_professores'
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'cadastro_professores');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && Array.isArray(docSnap.data().professores)) {
        const profsComArea = docSnap.data().professores.map(p => ({
          ...p,
          area: normalizarArea(p.area)
        }));
        setCadastroProfessores(profsComArea);
        localStorage.setItem('clovis_cadastro_professores', JSON.stringify(profsComArea));
      }
    }, (err) => {
      console.warn('Erro ao carregar cadastro_professores do Firestore:', err);
    });
    return () => unsubscribe();
  }, []);

  // Escutar eventos de exclusão universal e atualização de docentes/horários para sincronia instantânea com a aba Horários
  useEffect(() => {
    const handleEntityDeleted = () => {
      const cached = localStorage.getItem('clovis_cadastro_professores');
      if (cached) {
        try { setCadastroProfessores(JSON.parse(cached)); } catch (err) {}
      }
    };

    const handleTeachersUpdated = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        const profsComArea = e.detail.map(p => ({
          ...p,
          area: normalizarArea(p.area)
        }));
        setCadastroProfessores(profsComArea);
        localStorage.setItem('clovis_cadastro_professores', JSON.stringify(profsComArea));
      }
    };

    const handleHorariosUpdated = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        setHorariosEscola(e.detail);
        localStorage.setItem('clovis_horarios_cache', JSON.stringify(e.detail));
      }
    };

    window.addEventListener('clovis_entity_deleted', handleEntityDeleted);
    window.addEventListener('clovis_teachers_updated', handleTeachersUpdated);
    window.addEventListener('clovis_horarios_updated', handleHorariosUpdated);
    return () => {
      window.removeEventListener('clovis_entity_deleted', handleEntityDeleted);
      window.removeEventListener('clovis_teachers_updated', handleTeachersUpdated);
      window.removeEventListener('clovis_horarios_updated', handleHorariosUpdated);
    };
  }, []);

  const salvarCadastroProfessores = async (novosProfs) => {
    const profsFormatados = novosProfs.map(p => ({
      ...p,
      area: normalizarArea(p.area)
    }));
    setCadastroProfessores(profsFormatados);
    localStorage.setItem('clovis_cadastro_professores', JSON.stringify(profsFormatados));
    try {
      await setDoc(doc(db, 'config_escola', 'cadastro_professores'), {
        professores: profsFormatados,
        atualizadoEm: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error('Erro ao salvar cadastro_professores no Firestore:', err);
    }
  };

  // Migrar e Sincronizar Docentes Automaticamente da Aba de Horários
  const handleMigrarDocentesDoHorario = async (silencioso = false) => {
    if (!horariosEscola || horariosEscola.length === 0) {
      if (!silencioso) {
        showFeedback('Nenhum horário cadastrado na grade horária oficial para migração.', 'warning');
      }
      return;
    }

    const migrados = extrairEMigrarDocentesDoHorario(horariosEscola, cadastroProfessores);
    await salvarCadastroProfessores(migrados);

    if (!silencioso) {
      showFeedback(`${migrados.length} docentes migrados e sincronizados com sucesso da Grade Horária!`, 'success');
    }
  };

  // Auto-migração ao carregar horários caso o cadastro esteja vazio ou defasado
  useEffect(() => {
    if (Array.isArray(horariosEscola) && horariosEscola.length > 0) {
      const profsNaGrade = new Set(horariosEscola.map(h => h.professor?.trim()).filter(Boolean));
      if (profsNaGrade.size > 0 && (!cadastroProfessores || cadastroProfessores.length === 0)) {
        handleMigrarDocentesDoHorario(true);
      }
    }
  }, [horariosEscola]);

  const handleAlterarAreaDocenteInline = (nomeProf, novaArea) => {
    const novosProfs = cadastroProfessores.map(p => {
      if (p.nome === nomeProf) {
        return { ...p, area: novaArea };
      }
      return p;
    });

    const existe = novosProfs.some(p => p.nome === nomeProf);
    if (!existe) {
      const pUnificado = listaProfessoresUnificada.find(p => p.nome === nomeProf);
      novosProfs.push({
        nome: nomeProf,
        disciplina: pUnificado?.disciplina || 'Geral',
        area: novaArea,
        tipo: pUnificado?.tipo || 'EFETIVO',
        saldoAulas: pUnificado?.saldoInicial || 0
      });
    }

    salvarCadastroProfessores(novosProfs);
    if (typeof window.showToast === 'function') {
      window.showToast(`Área de Conhecimento do docente "${nomeProf}" alterada para ${novaArea}!`, 'success');
    }
  };

  const handleAlterarTipoDocenteInline = (nomeProf, novoTipo) => {
    const novosProfs = cadastroProfessores.map(p => {
      if (p.nome === nomeProf) {
        return { ...p, tipo: novoTipo };
      }
      return p;
    });

    const existe = novosProfs.some(p => p.nome === nomeProf);
    if (!existe) {
      const pUnificado = listaProfessoresUnificada.find(p => p.nome === nomeProf);
      novosProfs.push({
        nome: nomeProf,
        disciplina: pUnificado?.disciplina || 'Geral',
        area: pUnificado?.area || 'Exatas (EXA)',
        tipo: novoTipo,
        saldoAulas: pUnificado?.saldoInicial || 0
      });
    }

    salvarCadastroProfessores(novosProfs);
    if (typeof window.showToast === 'function') {
      window.showToast(`Cargo/Vínculo do docente "${nomeProf}" alterado para ${novoTipo}!`, 'success');
    }
  };

  const handleAdicionarDocenteCorpo = (e) => {
    e.preventDefault();
    if (!novoDocenteForm.nome.trim()) return;
    const nome = novoDocenteForm.nome.trim();
    if (cadastroProfessores.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
      showFeedback(`O docente "${nome}" já está cadastrado.`, 'warning');
      return;
    }
    const novo = {
      nome,
      disciplina: novoDocenteForm.disciplina.trim() || 'Geral',
      area: novoDocenteForm.area,
      tipo: novoDocenteForm.tipo,
      saldoAulas: Number(novoDocenteForm.saldoAulas || 0)
    };
    salvarCadastroProfessores([...cadastroProfessores, novo]);
    setNovoDocenteForm({ nome: '', disciplina: '', area: 'Exatas (EXA)', tipo: 'EFETIVO', saldoAulas: 0 });
    showFeedback(`Docente "${nome}" cadastrado com sucesso!`, 'success');
  };

  const handleExcluirDocenteCorpo = async (nomeProf) => {
    const podeDeletar = typeof window !== 'undefined' && typeof window.podeExcluir === 'function' ? window.podeExcluir() : false;
    if (!podeDeletar) {
      showFeedback('Acesso negado: Apenas a Direção Escolar (Diretor e Vice-Diretor) possui autorização para excluir docentes.', 'warning');
      return;
    }
    setConfirmDeleteDocenteNome(null);
    if (typeof window.deletarEntidadeUniversal === 'function') {
      await window.deletarEntidadeUniversal('professor', nomeProf);
    } else {
      const atualizados = cadastroProfessores.filter(p => p.nome !== nomeProf);
      salvarCadastroProfessores(atualizados);
    }
    showFeedback(`Docente "${nomeProf}" removido do cadastro.`, 'info');
  };

  // Atualizar Área automaticamente quando altera a disciplina no form
  const handleDisciplinaChange = (disc) => {
    const area = encontrarAreaDisciplina(disc);
    setForm(prev => ({ ...prev, disciplina: disc, area }));
  };

  // Helper para obter ID do dia da semana a partir da data
  const getDiaSemanaFromData = (dataStr) => {
    if (!dataStr) return 'segunda';
    const [year, month, day] = dataStr.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayNum = dateObj.getDay();
    const mapDays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    return mapDays[dayNum] || 'segunda';
  };

  // Extrair lista unificada e dinâmica de professores a partir do cadastro do gestor e da grade horária oficial
  const listaProfessoresUnificada = useMemo(() => {
    const mapaProfs = {};

    // 1. Usar a lista cadastrada e editada pelo gestor (cadastroProfessores)
    const baseProfs = Array.isArray(cadastroProfessores) ? cadastroProfessores : [];

    baseProfs.forEach(p => {
      if (!p || !p.nome) return;
      const key = p.nome.trim();
      mapaProfs[key] = {
        nome: key,
        disciplina: p.disciplina || 'Geral',
        area: normalizarArea(p.area || encontrarAreaDisciplina(p.disciplina)),
        tipo: p.tipo || 'EFETIVO',
        saldoInicial: p.saldoAulas || p.saldoInicial || 0
      };
    });

    // 2. Mesclar com professores presentes na grade horária oficial (caso ainda não constem)
    horariosEscola.forEach(h => {
      if (h.professor && h.professor.trim()) {
        const nomeProf = h.professor.trim();
        const jaExiste = Object.keys(mapaProfs).some(k => isSameProfessor(k, nomeProf));
        if (!jaExiste) {
          const areaFound = encontrarAreaDisciplina(h.disciplina || '');
          mapaProfs[nomeProf] = {
            nome: nomeProf,
            disciplina: h.disciplina || 'Geral',
            area: areaFound,
            tipo: 'EFETIVO',
            saldoInicial: 0
          };
        }
      }
    });

    return Object.values(mapaProfs);
  }, [cadastroProfessores, horariosEscola]);

  // Helper para nome extenso do dia
  const MAPA_DIAS_EXTENSO = {
    segunda: 'Segunda-feira',
    terca: 'Terça-feira',
    quarta: 'Quarta-feira',
    quinta: 'Quinta-feira',
    sexta: 'Sexta-feira',
    sabado: 'Sábado',
    domingo: 'Domingo'
  };

  // Dia da semana selecionado na data do formulário
  const diaSemanaForm = useMemo(() => getDiaSemanaFromData(form.data), [form.data]);

  // Buscar automaticamente todas as aulas atribuídas ao professor ausente no dia selecionado
  const aulasDoProfessorAusente = useMemo(() => {
    if (!form.professorAusente || !diaSemanaForm) return [];

    const slotsVistos = new Set();
    const diaAlvo = normalizarDia(diaSemanaForm);
    return horariosEscola.filter(h => {
      if (!h || !h.dia || normalizarDia(h.dia) !== diaAlvo) return false;
      if (!isSameProfessor(h.professor, form.professorAusente)) return false;
      if (!isRegularTeachingClass(h)) return false;

      const pOrder = getPeriodoOrder(h.periodoId);
      const slotKey = `${normalizarDia(h.dia)}_${pOrder}`;
      if (slotsVistos.has(slotKey)) return false;
      slotsVistos.add(slotKey);
      return true;
    }).sort((a, b) => getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId));
  }, [form.professorAusente, diaSemanaForm, horariosEscola]);

  // Alocações em lote pré-selecionadas com os melhores substitutos para cada aula do dia
  const [alocacoesLote, setAlocacoesLote] = useState({});

  // Helper para identificar a categoria de cargo do docente
  const getTipoProfessorCategory = (prof) => {
    if (!prof) return 'EFETIVO';
    const tipo = (prof.tipo || prof.cargo || prof.vinculo || '').toUpperCase().trim();
    const nome = (prof.nome || '').toLowerCase();
    const disc = (prof.disciplina || '').toLowerCase();

    if (tipo === 'DIRETOR' || (nome.includes('diretor') && !nome.includes('vice'))) {
      return 'DIRETOR';
    }
    if (tipo === 'VICE_DIRETOR' || tipo === 'VICE-DIRETOR' || tipo === 'VICE' || nome.includes('vice')) {
      return 'VICE_DIRETOR';
    }
    if (tipo === 'CGPG' || tipo === 'CGPCA' || tipo === 'COORDENADOR' || nome.includes('cgpg') || nome.includes('cgpca') || nome.includes('coordenador')) {
      return 'CGPG';
    }
    if (tipo === 'PAAC' || tipo === 'PAAC / EVENTUAL' || nome.includes('paac') || disc.includes('paac')) {
      return 'PAAC';
    }
    return 'EFETIVO';
  };

  // Função para calcular sugestões de substituto para qualquer aula/horário
  const calcularSugestoesParaAula = (periodoId, disciplinaAula, areaAula) => {
    if (!form.professorAusente) return [];

    const profAusenteObj = listaProfessoresUnificada.find(p => isSameProfessor(p.nome, form.professorAusente)) || {
      area: areaAula || form.area,
      disciplina: disciplinaAula || form.disciplina
    };
    const disciplinaAlvo = (disciplinaAula || profAusenteObj.disciplina || form.disciplina || '').trim().toLowerCase();
    const areaAlvo = normalizarArea(areaAula || profAusenteObj.area || form.area);
    const diaSemana = diaSemanaForm;

    // Contagem de carga horária semanal (regência de classe) do professor na grade oficial com deduplicação de slots
    const cargaSemanalProf = {};
    const slotsContadosCarga = new Set();
    horariosEscola.forEach(h => {
      if (h.professor && isRegularTeachingClass(h)) {
        const nome = h.professor.trim();
        const profKey = Object.keys(cargaSemanalProf).find(k => isSameProfessor(k, nome)) || nome;
        const pOrder = getPeriodoOrder(h.periodoId);
        const diaClean = normalizarDia(h.dia);
        const slotKey = `${profKey.toLowerCase()}_${diaClean}_${pOrder}`;
        if (h.dia && h.periodoId) {
          if (!slotsContadosCarga.has(slotKey)) {
            slotsContadosCarga.add(slotKey);
            cargaSemanalProf[profKey] = (cargaSemanalProf[profKey] || 0) + 1;
          }
        } else {
          cargaSemanalProf[profKey] = (cargaSemanalProf[profKey] || 0) + 1;
        }
      }
    });

    // Saldo de substituições confirmadas/aprovadas na base
    const contagemSubst = {};
    substituicoes.forEach(s => {
      if (!s) return;
      const st = String(s.status || 'CONFIRMADA').toUpperCase().trim();
      const isStatusOk = st === 'CONFIRMADA' || st === 'APROVADA' || st === 'REALIZADA' || st === 'CONCLUIDA' || st === 'OK';
      if (isStatusOk && isRegularTeachingClass(s.disciplina)) {
        if (s.professorSubstituto) {
          const keySub = Object.keys(contagemSubst).find(k => isSameProfessor(k, s.professorSubstituto)) || s.professorSubstituto.trim();
          contagemSubst[keySub] = (contagemSubst[keySub] || 0) + 1;
        }
        if (s.professorAusente) {
          const keyAus = Object.keys(contagemSubst).find(k => isSameProfessor(k, s.professorAusente)) || s.professorAusente.trim();
          contagemSubst[keyAus] = (contagemSubst[keyAus] || 0) - 1;
        }
      }
    });

    return listaProfessoresUnificada
      .filter(p => !isSameProfessor(p.nome, form.professorAusente))
      .map(prof => {
        let score = 10000;
        let prioridade = 9;
        let motivoPrioridade = '9ª Prioridade: Diretor';
        let isIndisponivel = false;
        let motivoIndisponivel = '';
        let isOcupado = false;
        let motivoOcupado = '';
        const aulasSemana = cargaSemanalProf[prof.nome] || 0;

        // 1. Validação Rígida de Permanência na Escola (Turnos, Folgas e Janelas)
        const checagemEscola = isTeacherAtSchool(
          prof.nome,
          diaSemana,
          periodoId,
          indisponibilidadeProfs,
          horariosEscola,
          listaProfessoresUnificada
        );

        // 2. Verificar se o professor já possui aula/atividade PEI na grade oficial
        const aulaAgendada = horariosEscola.find(
          h => h.dia === diaSemana &&
               getPeriodoOrder(h.periodoId) === getPeriodoOrder(periodoId) &&
               isSameProfessor(h.professor, prof.nome) &&
               isRegularTeachingClass(h)
        );

        // 3. Verificar se o professor já foi alocado para substituir outra aula no mesmo dia e período
        const jaSubstituindoNoPeriodo = substituicoes.find(
          s => s.data === form.data &&
               getPeriodoOrder(s.periodoId) === getPeriodoOrder(periodoId) &&
               s.status !== 'CANCELADA' &&
               (!itemEdicao || s.id !== itemEdicao.id) &&
               isSameProfessor(s.professorSubstituto, prof.nome)
        );

        if (!checagemEscola.atSchool) {
          isIndisponivel = true;
          motivoIndisponivel = checagemEscola.reason || 'Indisponibilidade Docente Registrada';
          score = -999999;
          prioridade = 99;
          motivoPrioridade = `⛔ INDISPONÍVEL (${motivoIndisponivel})`;
        } else if (aulaAgendada) {
          isOcupado = true;
          motivoOcupado = `${aulaAgendada.disciplina || 'Aula'} (${aulaAgendada.turma || 'PEI'})`;
          score = -888888;
          prioridade = 98;
          motivoPrioridade = `⚠️ OCUPADO(A) EM AULA: ${motivoOcupado}`;
        } else if (jaSubstituindoNoPeriodo) {
          isOcupado = true;
          motivoOcupado = `Substituindo em ${jaSubstituindoNoPeriodo.turma || 'PEI'} (${jaSubstituindoNoPeriodo.disciplina || 'Subst.'})`;
          score = -888888;
          prioridade = 98;
          motivoPrioridade = `⚠️ OCUPADO(A): Substituindo em ${jaSubstituindoNoPeriodo.turma || 'PEI'}`;
        } else {
          // Determinar Ordem Estrita de Substituição PEI (1 a 8) conforme Diretrizes da Escola:
          // 1 - Mesma matéria
          // 2 - Mesma área
          // 3 - paac da área
          // 4 - Qualquer matéria
          // 5 - qualquer área
          // 6 - CGPG
          // 7 - Vice direção
          // 8 - direção
          const category = getTipoProfessorCategory(prof);
          const profDiscNorm = (prof.disciplina || '').trim().toLowerCase();
          const mesmaDisciplina = profDiscNorm && disciplinaAlvo && (
            profDiscNorm === disciplinaAlvo ||
            profDiscNorm.includes(disciplinaAlvo) ||
            disciplinaAlvo.includes(profDiscNorm)
          );

          const profAreaNorm = normalizarArea(prof.area);
          const mesmaArea = profAreaNorm === areaAlvo;

          if (category === 'DIRETOR') {
            prioridade = 8;
            motivoPrioridade = '8ª Prioridade: Direção';
          } else if (category === 'VICE_DIRETOR') {
            prioridade = 7;
            motivoPrioridade = '7ª Prioridade: Vice-direção';
          } else if (category === 'CGPG') {
            prioridade = 6;
            motivoPrioridade = '6ª Prioridade: CGPG';
          } else if (mesmaDisciplina) {
            prioridade = 1;
            motivoPrioridade = `1ª Prioridade: Mesma matéria (${prof.disciplina || 'Matéria'})`;
          } else if (category === 'EFETIVO' && mesmaArea) {
            prioridade = 2;
            motivoPrioridade = `2ª Prioridade: Mesma área (${profAreaNorm})`;
          } else if (category === 'PAAC' && mesmaArea) {
            prioridade = 3;
            motivoPrioridade = `3ª Prioridade: PAAC da área (${profAreaNorm})`;
          } else if (category === 'EFETIVO') {
            prioridade = 4;
            motivoPrioridade = `4ª Prioridade: Qualquer matéria (${prof.disciplina || 'Outra Matéria'})`;
          } else if (category === 'PAAC') {
            prioridade = 5;
            motivoPrioridade = `5ª Prioridade: Qualquer área (PAAC - ${profAreaNorm})`;
          } else {
            prioridade = 5;
            motivoPrioridade = `5ª Prioridade: Qualquer área (${profAreaNorm})`;
          }
        }

        // Saldo real consolidado de substituições confirmadas
        const creditosFirmes = (contagemSubst[prof.nome] || 0);
        const saldoInicial = (prof.saldoInicial || 0);
        const saldoReal = saldoInicial + creditosFirmes;
        const totalAulasSemana = aulasSemana + saldoReal;
        const atingiuTeto32 = totalAulasSemana >= 32 || aulasSemana >= 32;

        if (atingiuTeto32 && !isIndisponivel && !isOcupado) {
          isIndisponivel = true;
          motivoIndisponivel = `Atingiu o teto de 32h semanais (${totalAulasSemana}h totais)`;
          score = -777777;
          prioridade = 97;
          motivoPrioridade = `⛔ TETO ATINGIDO (32h+): ${totalAulasSemana}h na semana`;
        } else {
          // Score: prioridade 1 a 8 no topo; no empate quem está com menos aulas aquela semana tem maior pontuação
          score = 1000000 - (prioridade * 100000) - (totalAulasSemana * 1000) - (saldoReal * 10);
        }

        return {
          ...prof,
          score,
          prioridade,
          motivoPrioridade,
          isIndisponivel,
          motivoIndisponivel,
          isOcupado,
          motivoOcupado,
          aulasSemana,
          atingiuTeto32,
          saldoReal,
          totalAulasSemana
        };
      })
      .sort((a, b) => {
        if ((a.isIndisponivel || a.isOcupado) !== (b.isIndisponivel || b.isOcupado)) {
          return (a.isIndisponivel || a.isOcupado) ? 1 : -1;
        }
        // 1. Ordem de Prioridade PEI (1 a 8)
        if (a.prioridade !== b.prioridade) {
          return a.prioridade - b.prioridade;
        }
        // 2. Critério de Desempate: quem está com menos aulas aquela semana entra primeiro!
        if (a.totalAulasSemana !== b.totalAulasSemana) {
          return a.totalAulasSemana - b.totalAulasSemana;
        }
        if (a.aulasSemana !== b.aulasSemana) {
          return a.aulasSemana - b.aulasSemana;
        }
        if (a.saldoReal !== b.saldoReal) {
          return a.saldoReal - b.saldoReal;
        }
        return a.nome.localeCompare(b.nome);
      });
  };

  // Motor de Sugestão Inteligente de Substituto para o período único selecionado no Form
  const sugestoesSubstitutos = useMemo(() => {
    return calcularSugestoesParaAula(form.periodoId, form.disciplina, form.area);
  }, [form.professorAusente, form.disciplina, form.area, form.data, form.periodoId, substituicoes, indisponibilidadeProfs, horariosEscola, listaProfessoresUnificada]);

  useEffect(() => {
    if (!aulasDoProfessorAusente || aulasDoProfessorAusente.length === 0) {
      setAlocacoesLote({});
      return;
    }

    const novasAlocacoes = {};
    aulasDoProfessorAusente.forEach((aula) => {
      const sugs = calcularSugestoesParaAula(
        aula.periodoId,
        aula.disciplina,
        encontrarAreaDisciplina(aula.disciplina)
      );
      const melhorOpcao = sugs.find(s => !s.isIndisponivel && !s.isOcupado);
      novasAlocacoes[aula.periodoId] = {
        professorSubstituto: melhorOpcao ? melhorOpcao.nome : '',
        tipoSubstituto: melhorOpcao ? melhorOpcao.motivoPrioridade : 'Sugestão Automática PEI',
        observacao: ''
      };
    });
    setAlocacoesLote(novasAlocacoes);
  }, [aulasDoProfessorAusente, form.professorAusente, form.data, diaSemanaForm]);

  // Atualizar alocação de aula em lote individualmente
  const handleMudarSubstitutoLote = (periodoId, nomeSubstituto, disciplinaAula, areaAula) => {
    const sugs = calcularSugestoesParaAula(periodoId, disciplinaAula, areaAula);
    const candObj = sugs.find(s => isSameProfessor(s.nome, nomeSubstituto) || s.nome === nomeSubstituto);

    setAlocacoesLote(prev => ({
      ...prev,
      [periodoId]: {
        ...(prev[periodoId] || {}),
        professorSubstituto: nomeSubstituto,
        tipoSubstituto: candObj?.motivoPrioridade || 'Seleção Manual'
      }
    }));
  };

  // Salvar TODAS as substituições alocadas do dia com 1 clique
  const handleSalvarAlocacoesLote = async (e) => {
    if (e) e.preventDefault();

    if (!form.professorAusente) {
      showFeedback('Por favor, selecione o professor ausente.', 'warning');
      return;
    }

    if (aulasDoProfessorAusente.length === 0) {
      showFeedback('Não foram encontradas aulas regulares registradas para este professor no dia selecionado.', 'warning');
      return;
    }

    const itensParaSalvar = [];
    for (const aula of aulasDoProfessorAusente) {
      const aloc = alocacoesLote[aula.periodoId];
      const pOrder = getPeriodoOrder(aula.periodoId);
      const rotuloAula = getPeriodoRotulo(aula.periodoId);
      if (!aloc || !aloc.professorSubstituto) {
        showFeedback(`A ${rotuloAula} (${aula.turma} - ${aula.disciplina}) não possui professor substituto selecionado.`, 'warning');
        return;
      }

      const userAtivo = obterUsuarioAtivoCompleto();
      const payload = {
        data_referencia: form.data,
        id_aula: aula.id || `${form.data}_${pOrder}_${aula.turma}`,
        professor_ausente: form.professorAusente.trim(),
        professor_substituto: aloc.professorSubstituto.trim(),
        data: form.data,
        professorAusente: form.professorAusente.trim(),
        professorSubstituto: aloc.professorSubstituto.trim(),
        disciplina: (aula.disciplina || form.disciplina || 'Geral').trim(),
        area: encontrarAreaDisciplina(aula.disciplina || form.disciplina),
        turma: (aula.turma || form.turma || 'PEI').trim(),
        sala: aula.sala || 'Sala de Aula',
        periodoId: pOrder <= 14 ? pOrder : (Number(aula.periodoId) || aula.periodoId),
        motivo: form.motivo || MOTIVOS_AUSENCIA[0],
        tipoSubstituto: aloc.tipoSubstituto || 'Sugestão Automática PEI',
        status: 'CONFIRMADA',
        observacao: aloc.observacao ? aloc.observacao.trim() : (aula.observacao || ''),
        criadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };
      itensParaSalvar.push(payload);
    }

    setSalvando(true);
    try {
      const novosDocs = [];
      for (const item of itensParaSalvar) {
        const docRef = await addDoc(collection(db, 'substituicoes_diarias'), item);
        novosDocs.push({ id: docRef.id, ...item });
      }

      // a) Atualização Otimista em Memória
      const novas = [...substituicoes, ...novosDocs];
      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === form.data);
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      // b) Re-renderizar grade diária sobreposta em memória imediatamente (Zero Reads)
      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(form.data);
      } else {
        renderizarGradeDiaria(form.data);
      }

      const auditPayloadLote = {
        modulo: 'Substituição PEI',
        acao: 'CRIAR',
        descricao: `Lançadas ${itensParaSalvar.length} substituições em lote para o dia ${form.data}`,
        detalhes: { data: form.data, quantidade: itensParaSalvar.length }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadLote);
      } else {
        registrarLogAuditoria(auditPayloadLote);
      }

      showFeedback(`${itensParaSalvar.length} substituições do dia salvas com sucesso!`, 'success');

      setSubAba('painel');
      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar em lote no Firestore:', err);
      const fallbackDocs = itensParaSalvar.map((item, idx) => ({
        id: `local-sub-${Date.now()}-${idx}`,
        ...item
      }));
      const novas = [...substituicoes, ...fallbackDocs];
      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === form.data);
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(form.data);
      }

      showFeedback(`Registrado no cache local (${itensParaSalvar.length} substituições).`, 'info');
      setSubAba('painel');
      setIsModalOpen(false);
    } finally {
      setSalvando(false);
    }
  };

  // Salvar uma aula específica da lista
  const handleSalvarAulaUnica = async (aula) => {
    const aloc = alocacoesLote[aula.periodoId];
    if (!aloc || !aloc.professorSubstituto) {
      showFeedback('Por favor, selecione um professor substituto apto antes de confirmar.', 'warning');
      return;
    }

    const pOrder = getPeriodoOrder(aula.periodoId);
    const rotuloAula = getPeriodoRotulo(aula.periodoId);

    const userAtivo = obterUsuarioAtivoCompleto();
    const payload = {
      data_referencia: form.data,
      id_aula: aula.id || `${form.data}_${pOrder}_${aula.turma}`,
      professor_ausente: form.professorAusente.trim(),
      professor_substituto: aloc.professorSubstituto.trim(),
      data: form.data,
      professorAusente: form.professorAusente.trim(),
      professorSubstituto: aloc.professorSubstituto.trim(),
      disciplina: (aula.disciplina || form.disciplina || 'Geral').trim(),
      area: encontrarAreaDisciplina(aula.disciplina || form.disciplina),
      turma: (aula.turma || form.turma || 'PEI').trim(),
      sala: aula.sala || 'Sala de Aula',
      periodoId: pOrder <= 14 ? pOrder : (Number(aula.periodoId) || aula.periodoId),
      motivo: form.motivo || MOTIVOS_AUSENCIA[0],
      tipoSubstituto: aloc.tipoSubstituto || 'Sugestão Automática PEI',
      status: 'CONFIRMADA',
      observacao: aloc.observacao ? aloc.observacao.trim() : (aula.observacao || ''),
      criadoEm: new Date().toISOString(),
      editadoPorNome: userAtivo.nome,
      editadoPorEmail: userAtivo.email,
      editadoPorCargo: userAtivo.cargo,
      editadoEm: new Date().toISOString()
    };

    setSalvando(true);
    try {
      const docRef = await addDoc(collection(db, 'substituicoes_diarias'), payload);
      const itemCriado = { id: docRef.id, ...payload };

      // a) Atualização Otimista
      const novas = [...substituicoes, itemCriado];
      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === form.data);
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      // b) Re-renderizar grade visual sobreposta em memória imediatamente
      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(form.data);
      } else {
        renderizarGradeDiaria(form.data);
      }

      const auditPayloadUnica = {
        modulo: 'Substituição PEI',
        acao: 'LANÇAR',
        descricao: `Lançada e confirmada substituição do(a) prof. ${payload.professorAusente} (${payload.turma}) -> Substituto: ${payload.professorSubstituto} em ${payload.data}`,
        detalhes: { id: docRef.id, payload }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadUnica);
      } else {
        registrarLogAuditoria(auditPayloadUnica);
      }

      showFeedback(`Substituição da ${rotuloAula} (${aula.turma}) salva com sucesso!`, 'success');
    } catch (err) {
      console.error('Erro ao salvar no Firestore:', err);
      const localItem = { id: `local-sub-${Date.now()}`, ...payload };
      const novas = [...substituicoes, localItem];
      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === form.data);
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(form.data);
      }

      showFeedback('Registrado no cache local.', 'info');
    } finally {
      setSalvando(false);
    }
  };

  // Aplicar Sugestão Automática no Form
  const handleSelecionarSubstitutoSugestao = (prof) => {
    if (prof.isIndisponivel) {
      showFeedback(`Docente "${prof.nome}" está fora da escola / folga (${prof.motivoIndisponivel || 'Fora do Expediente'}).`, 'warning');
      return;
    }
    if (prof.isOcupado) {
      showFeedback(`Docente "${prof.nome}" já está ocupado em sala de aula neste horário (${prof.motivoOcupado}).`, 'warning');
      return;
    }

    setForm(prev => ({
      ...prev,
      professorSubstituto: prof.nome,
      tipoSubstituto: prof.motivoPrioridade
    }));

    showFeedback(`Substituto ${prof.nome} selecionado com sucesso!`, 'success');
  };

  // Salvar / Lançar Substituição
  const handleSalvarSubstituicao = async (e) => {
    e.preventDefault();
    setSalvando(true);

    try {
      if (!form.professorSubstituto) {
        showFeedback('Por favor, selecione um professor substituto apto antes de confirmar.', 'warning');
        setSalvando(false);
        return;
      }

      const candObj = sugestoesSubstitutos.find(s => s.nome === form.professorSubstituto);
      if (candObj && (candObj.isIndisponivel || candObj.isOcupado)) {
        showFeedback(`Operação bloqueada: O docente "${form.professorSubstituto}" não pode substituir neste horário (${candObj.motivoPrioridade}).`, 'warning');
        setSalvando(false);
        return;
      }

      const userAtivo = obterUsuarioAtivoCompleto();
      const pNum = Number(form.periodoId);
      const payload = {
        data_referencia: form.data,
        id_aula: form.id_aula || `${form.data}_${pNum}_${form.turma}`,
        professor_ausente: form.professorAusente.trim(),
        professor_substituto: form.professorSubstituto.trim(),
        data: form.data,
        professorAusente: form.professorAusente.trim(),
        professorSubstituto: form.professorSubstituto.trim(),
        disciplina: form.disciplina.trim(),
        area: form.area.trim(),
        turma: form.turma.trim(),
        periodoId: pNum,
        motivo: form.motivo,
        tipoSubstituto: form.tipoSubstituto,
        status: form.status,
        observacao: form.observacao.trim(),
        criadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };

      if (itemEdicao?.id && !itemEdicao.id.startsWith('sub-init-')) {
        try {
          await updateDoc(doc(db, 'substituicoes_diarias', itemEdicao.id), payload);
        } catch (uErr) {
          try {
            await updateDoc(doc(db, 'substituicoes_pei', itemEdicao.id), payload);
          } catch (e2) {}
        }
        const auditPayloadAtualizar = {
          modulo: 'Substituição PEI',
          acao: 'ATUALIZAR',
          descricao: `Atualizada substituição de ${payload.professorAusente} (${payload.turma}) -> Substituto: ${payload.professorSubstituto} (${payload.data})`,
          detalhes: { id: itemEdicao.id, payload }
        };
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria(auditPayloadAtualizar);
        } else {
          registrarLogAuditoria(auditPayloadAtualizar);
        }
      } else {
        const docRef = await addDoc(collection(db, 'substituicoes_diarias'), payload);
        const auditPayloadCriar = {
          modulo: 'Substituição PEI',
          acao: 'LANÇAR',
          descricao: `Lançada nova substituição de ${payload.professorAusente} (${payload.turma}) -> Substituto: ${payload.professorSubstituto} (${payload.data})`,
          detalhes: { id: docRef.id, payload }
        };
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria(auditPayloadCriar);
        } else {
          registrarLogAuditoria(auditPayloadCriar);
        }
      }

      // a) Atualização Otimista
      const novas = itemEdicao
        ? substituicoes.map(s => (s.id === itemEdicao.id ? { ...s, ...payload } : s))
        : [...substituicoes, { id: `local-sub-${Date.now()}`, ...payload }];

      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === form.data);
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      // b) Re-renderizar grade visual sobreposta em memória imediatamente
      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(form.data);
      } else {
        renderizarGradeDiaria(form.data);
      }

      if (typeof window.showToast === 'function') {
        window.showToast('Substituição lançada com sucesso!', 'success');
      }

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar substituição:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Registrado no cache local com sucesso.', 'info');
      }
      setIsModalOpen(false);
    } finally {
      setSalvando(false);
    }
  };

  // Excluir Substituição
  const handleExcluirSubstituicao = async (id) => {
    const podeDeletar = typeof window !== 'undefined' && typeof window.podeExcluir === 'function' ? window.podeExcluir() : false;
    if (!podeDeletar) {
      showFeedback('Acesso negado: Apenas a Direção Escolar (Diretor e Vice-Diretor) possui autorização para excluir substituições.', 'warning');
      return;
    }
    setConfirmDeleteSubId(null);

    try {
      const itemExcluido = substituicoes.find(s => s.id === id);
      if (id && !id.startsWith('sub-init-') && !id.startsWith('local-sub-')) {
        try {
          await deleteDoc(doc(db, 'substituicoes_diarias', id));
        } catch (dErr) {
          try {
            await deleteDoc(doc(db, 'substituicoes_pei', id));
          } catch (e2) {}
        }
      }

      const auditPayloadExcluirSub = {
        modulo: 'Substituição PEI',
        acao: 'EXCLUIR',
        descricao: `Cancelada e removida substituição ID #${id} ${itemExcluido ? `(${itemExcluido.professorAusente} -> ${itemExcluido.professorSubstituto})` : ''}`,
        detalhes: { id, itemExcluido }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadExcluirSub);
      } else {
        registrarLogAuditoria(auditPayloadExcluirSub);
      }

      // a) Atualização Otimista
      const novas = substituicoes.filter(s => s.id !== id);
      setSubstituicoes(novas);
      window.substituicoesCache = novas;
      window.substituicoesHoje = novas.filter(s => (s.data_referencia || s.data) === (filtroData || new Date().toISOString().split('T')[0]));
      localStorage.setItem('clovis_substituicoes_cache', JSON.stringify(novas));

      // b) Re-renderizar grade imediatamente
      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria(filtroData);
      } else {
        renderizarGradeDiaria(filtroData);
      }

      if (typeof window.showToast === 'function') {
        window.showToast('Substituição removida.', 'info');
      }
    } catch (err) {
      console.error('Erro ao remover:', err);
    }
  };

  // Abrir Modal
  const handleAbrirModalNovo = () => {
    setItemEdicao(null);
    const primeiroProf = listaProfessoresUnificada[0] || { nome: 'Profª Maria Silva', disciplina: 'Língua Portuguesa', area: 'Linguagens' };
    setForm({
      data: filtroData || new Date().toISOString().split('T')[0],
      professorAusente: primeiroProf.nome,
      disciplina: primeiroProf.disciplina,
      area: primeiroProf.area,
      turma: '6º Ano A',
      periodoId: 1,
      motivo: MOTIVOS_AUSENCIA[0],
      professorSubstituto: '',
      tipoSubstituto: 'Sugestão Automática',
      status: 'CONFIRMADA',
      observacao: ''
    });
    setIsModalOpen(true);
  };

  const handleAbrirModalEdicao = (item) => {
    setItemEdicao(item);
    setForm({
      data: item.data || new Date().toISOString().split('T')[0],
      professorAusente: item.professorAusente || '',
      disciplina: item.disciplina || '',
      area: item.area || 'Linguagens',
      turma: item.turma || '6º Ano A',
      periodoId: Number(item.periodoId || 1),
      motivo: item.motivo || MOTIVOS_AUSENCIA[0],
      professorSubstituto: item.professorSubstituto || '',
      tipoSubstituto: item.tipoSubstituto || '',
      status: item.status || 'CONFIRMADA',
      observacao: item.observacao || ''
    });
    setIsModalOpen(true);
  };

  // Filtragem e Ordenação Inteligente
  const listagemFiltrada = useMemo(() => {
    const listaNormalizada = normalizeSubstituicoesPeriodos(substituicoes);
    const filtradas = listaNormalizada.filter(item => {
      if (filtroTurma !== 'TODAS' && item.turma !== filtroTurma) return false;
      if (filtroStatus !== 'TODOS' && item.status !== filtroStatus) return false;
      if (termoBusca) {
        const t = termoBusca.toLowerCase();
        const texto = `${item.professorAusente} ${item.professorSubstituto} ${item.disciplina} ${item.turma} ${item.motivo}`.toLowerCase();
        if (!texto.includes(t)) return false;
      }
      return true;
    });

    const hojeStr = getHojeLocalStr();

    return filtradas.sort((a, b) => {
      const dataA = (a.data || '').trim().split('T')[0];
      const dataB = (b.data || '').trim().split('T')[0];

      if (tipoOrdenacao === 'docente') {
        const profA = String(a.professorAusente || '').toLowerCase();
        const profB = String(b.professorAusente || '').toLowerCase();
        const comp = profA.localeCompare(profB, 'pt-BR');
        if (comp !== 0) return comp;
        
        // Dentro do mesmo docente: próxima substituição primeiro
        const isFuturoA = dataA >= hojeStr;
        const isFuturoB = dataB >= hojeStr;
        if (isFuturoA && !isFuturoB) return -1;
        if (!isFuturoA && isFuturoB) return 1;

        if (isFuturoA && isFuturoB) {
          if (dataA !== dataB) return dataA.localeCompare(dataB);
          return getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId);
        } else {
          if (dataA !== dataB) return dataB.localeCompare(dataA);
          return getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId);
        }
      } else {
        // Padrão: Próxima substituição primeiro!
        // 1. Substituições de hoje e futuras vêm antes das que já passaram
        const isFuturoA = dataA >= hojeStr;
        const isFuturoB = dataB >= hojeStr;

        if (isFuturoA && !isFuturoB) return -1;
        if (!isFuturoA && isFuturoB) return 1;

        if (isFuturoA && isFuturoB) {
          // Hoje e futuras: ordem cronológica crescente (a mais próxima vem no topo)
          if (dataA !== dataB) return dataA.localeCompare(dataB);
          return getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId);
        } else {
          // Passadas: histórico decrescente (a mais recente passada no topo)
          if (dataA !== dataB) return dataB.localeCompare(dataA);
          return getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId);
        }
      }
    });
  }, [substituicoes, filtroTurma, filtroStatus, termoBusca, tipoOrdenacao]);

  // Relatório de Eventuais / Saldo de Aulas
  const relatorioSubstitutos = useMemo(() => {
    const mapa = {};
    substituicoes.forEach(s => {
      const prof = s.professorSubstituto;
      if (!prof) return;
      if (!mapa[prof]) {
        mapa[prof] = {
          nome: prof,
          totalAulas: 0,
          turmasAtendidas: new Set(),
          disciplinas: new Set(),
          aulasMes: 0
        };
      }
      mapa[prof].totalAulas += 1;
      mapa[prof].turmasAtendidas.add(s.turma);
      mapa[prof].disciplinas.add(s.disciplina);
    });

    return Object.values(mapa).sort((a, b) => b.totalAulas - a.totalAulas);
  }, [substituicoes]);

  // Consolidado do Saldo de Aulas (Créditos x Débitos) de todos os Professores
  const saldoDocentesConsolidado = useMemo(() => {
    const mapa = {};

    // Helper para buscar chave existente no mapa de forma tolerante
    const findMapaKey = (targetName) => {
      if (!targetName) return null;
      if (mapa[targetName]) return targetName;
      return Object.keys(mapa).find(k => isSameProfessor(k, targetName)) || null;
    };

    // Iniciar com todos os professores da lista unificada
    listaProfessoresUnificada.forEach(p => {
      const slotsUnicos = new Set();
      const aulasRegenciaGrade = horariosEscola.filter(h => {
        if (!h || !h.professor) return false;
        if (!isSameProfessor(h.professor, p.nome) || !isRegularTeachingClass(h)) return false;

        const pOrder = getPeriodoOrder(h.periodoId);
        const diaClean = normalizarDia(h.dia);
        const slotKey = `${diaClean}_${pOrder}`;
        if (diaClean && pOrder !== 999) {
          if (slotsUnicos.has(slotKey)) return false;
          slotsUnicos.add(slotKey);
        }
        return true;
      }).length;

      const inicial = Number(p.saldoInicial ?? p.saldoAulas ?? 0);
      mapa[p.nome] = {
        nome: p.nome,
        disciplina: p.disciplina,
        area: p.area,
        tipo: p.tipo,
        aulasRegenciaGrade,
        saldoInicial: inicial,
        creditos: 0,
        debitos: 0,
        totalFinal: inicial,
        cargaTotalSemana: aulasRegenciaGrade + inicial,
        atingiuTeto32: (aulasRegenciaGrade + inicial) >= 32
      };
    });

    // Computar substituições confirmadas ou aprovadas para aulas de regência válidas (com deduplicação estrita de substituição)
    const subsProcessadas = new Set();
    substituicoes.forEach(s => {
      if (!s) return;
      const st = String(s.status || 'CONFIRMADA').toUpperCase().trim();
      const isStatusOk = st === 'CONFIRMADA' || st === 'APROVADA' || st === 'REALIZADA' || st === 'CONCLUIDA' || st === 'OK';

      if (isStatusOk && isRegularTeachingClass(s.disciplina)) {
        const subKey = s.id || `${s.data}_${s.periodoId}_${s.turma}_${s.professorAusente}_${s.professorSubstituto}`;
        if (subsProcessadas.has(subKey)) return;
        subsProcessadas.add(subKey);

        if (s.professorSubstituto && s.professorSubstituto.trim()) {
          const nameSub = s.professorSubstituto.trim();
          const keySub = findMapaKey(nameSub) || nameSub;
          if (!mapa[keySub]) {
            mapa[keySub] = {
              nome: nameSub,
              disciplina: s.disciplina || 'Geral',
              area: s.area || 'Diversificada / PEI',
              tipo: 'EFETIVO',
              aulasRegenciaGrade: 0,
              saldoInicial: 0,
              creditos: 0,
              debitos: 0,
              totalFinal: 0,
              cargaTotalSemana: 0,
              atingiuTeto32: false
            };
          }
          mapa[keySub].creditos += 1;
        }

        if (s.professorAusente && s.professorAusente.trim()) {
          const nameAus = s.professorAusente.trim();
          const keyAus = findMapaKey(nameAus) || nameAus;
          if (!mapa[keyAus]) {
            mapa[keyAus] = {
              nome: nameAus,
              disciplina: s.disciplina || 'Geral',
              area: s.area || 'Diversificada / PEI',
              tipo: 'EFETIVO',
              aulasRegenciaGrade: 0,
              saldoInicial: 0,
              creditos: 0,
              debitos: 0,
              totalFinal: 0,
              cargaTotalSemana: 0,
              atingiuTeto32: false
            };
          }
          mapa[keyAus].debitos += 1;
        }
      }
    });

    // Calcular saldo final, carga total semanal (Saldo Somado) e flag de teto 32h
    Object.values(mapa).forEach(item => {
      item.totalFinal = item.saldoInicial + item.creditos - item.debitos;
      // Saldo somado (Carga total semanal de aulas contando substituições)
      item.cargaTotalSemana = item.aulasRegenciaGrade + item.totalFinal;
      item.atingiuTeto32 = item.cargaTotalSemana >= 32;
    });

    return Object.values(mapa).sort((a, b) => b.cargaTotalSemana - a.cargaTotalSemana || b.totalFinal - a.totalFinal);
  }, [listaProfessoresUnificada, substituicoes, horariosEscola]);

  // Botão de Zerar Saldo (Ciclo de Fim de Semana)
  const handleZerarSaldoFimDeSemana = async () => {
    if (!podeEditar) {
      showFeedback('Ação restrita: Apenas a Direção Escolar / Gestão possui autorização para zerar os saldos semanais.', 'warning');
      return;
    }
    setConfirmZerarSaldo(false);

    try {
      // 1. Zerar saldoAulas e saldoInicial em todos os docentes
      const profsZerados = (cadastroProfessores || []).map(p => ({
        ...p,
        saldoAulas: 0,
        saldoInicial: 0
      }));
      await salvarCadastroProfessores(profsZerados);

      // 2. Limpar substituições ativas do estado e cache local
      setSubstituicoes([]);
      window.substituicoesCache = [];
      window.substituicoesHoje = [];
      localStorage.removeItem('clovis_substituicoes_cache');

      if (typeof window.renderizarGradeDiaria === 'function') {
        window.renderizarGradeDiaria();
      }

      // 3. Limpar substituições do Firestore
      for (const colName of ['substituicoes_diarias', 'substituicoes_pei']) {
        try {
          const snap = await getDocs(collection(db, colName));
          const batchArr = [];
          snap.forEach((docSnap) => {
            batchArr.push(deleteDoc(doc(db, colName, docSnap.id)));
          });
          if (batchArr.length > 0) {
            await Promise.all(batchArr);
          }
        } catch (fErr) {
          console.warn(`Aviso ao zerar Firestore ${colName}:`, fErr);
        }
      }

      const auditPayloadZerar = {
        modulo: 'Substituição PEI',
        acao: 'EXCLUIR',
        descricao: 'Zerados saldos e créditos semanais de substituição e limpo histórico para o novo ciclo.',
        detalhes: { dataHorario: new Date().toISOString() }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadZerar);
      } else {
        registrarLogAuditoria(auditPayloadZerar);
      }

      showFeedback('Saldo e créditos/débitos zerados com sucesso! Painel preparado para o novo ciclo semanal.', 'success');
    } catch (err) {
      console.error('Erro ao zerar saldo:', err);
      showFeedback('Ocorreu um erro ao zerar os saldos. Tente novamente.', 'error');
    }
  };

  // Exportar Saldo JSON
  const handleExportarSaldoJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(saldoDocentesConsolidado, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `saldo_professores_clovis_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showFeedback('Saldo exportado com sucesso em formato JSON!', 'success');
  };

  // Importar Saldo JSON
  const handleImportarSaldoJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dadosImportados = JSON.parse(event.target.result);
        if (Array.isArray(dadosImportados)) {
          localStorage.setItem('clovis_saldo_professores_import', JSON.stringify(dadosImportados));
          showFeedback(`Importados saldos de ${dadosImportados.length} professores com sucesso!`, 'success');
        } else {
          showFeedback('Formato de arquivo JSON inválido.', 'warning');
        }
      } catch (err) {
        showFeedback('Erro ao processar o arquivo JSON de saldo.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleImprimir = () => {
    window.print();
  };

  if (!temAcessoSubstituicao) {
    return (
      <div className="p-6 md:p-8 bg-[#F8FAFC] min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-7 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] text-center">
          <div className="w-14 h-14 bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight mb-2">Acesso Restrito ao Módulo</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            O acesso à aba de <strong className="text-slate-800 font-semibold">Substituição PEI &amp; Eventuais</strong> é exclusivo para os cargos da Gestão Escolar: <strong className="text-indigo-700 font-semibold">Vice-Diretor, Diretor e CGPG</strong>.
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => window.switchTab && window.switchTab('dashboard')}
              className="bg-slate-900 text-white font-semibold text-xs px-5 py-2.5 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Voltar ao Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* CONTEÚDO DA TELA DA APLICAÇÃO (OCULTO NA IMPRESSÃO) */}
      <div className="w-full min-h-screen bg-[#F8FAFC] pb-20 sm:pb-12 print:hidden">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 pt-3 sm:pt-5 space-y-5">
          {/* Header Glassmorphism */}
          <header className="bg-white/90 backdrop-blur-md sticky top-2 z-20 rounded-3xl p-4 sm:p-5 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg shrink-0">
                <i className="fa-solid fa-user-gear"></i>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                    Substituição PEI &amp; Eventuais
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                    <span className={`w-1.5 h-1.5 rounded-full ${isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
                    {isRealtimeConnected ? 'Tempo Real' : 'Conectando...'}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  E.E. Clóvis de Lucca · Motor de atribuição inteligente por área de conhecimento
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={handleImprimir}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer"
                title="Gerar relatório oficial em PDF ou imprimir"
              >
                <i className="fa-solid fa-file-pdf text-rose-600"></i>
                <span>Exportar PDF</span>
              </button>

              {podeEditar && (
                <button
                  type="button"
                  onClick={handleAbrirModalNovo}
                  className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-user-plus text-xs"></i>
                  <span>Lançar Substituição</span>
                </button>
              )}
            </div>
          </header>

          {erro && (
            <div className="bg-amber-50/90 border border-amber-200/70 border-l-4 border-l-amber-500 text-amber-950 px-4 py-3 rounded-2xl text-xs font-medium flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
                <span>{erro}</span>
              </div>
              <span className="text-[11px] font-medium text-amber-800 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-200/60 shrink-0">Modo Local Ativo</span>
            </div>
          )}

          {/* Bento KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 print:hidden">
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Registradas</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{substituicoes.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-calendar-check"></i>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Confirmadas</p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums mt-0.5">
                  {substituicoes.filter(s => s.status === 'CONFIRMADA').length}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-circle-check"></i>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Substitutos Ativos</p>
                <p className="text-2xl font-bold text-amber-600 tabular-nums mt-0.5">{relatorioSubstitutos.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-clock-rotate-left"></i>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500">Mesma Área PEI</p>
                <p className="text-2xl font-bold text-purple-600 tabular-nums mt-0.5">
                  {substituicoes.filter(s => String(s.tipoSubstituto).includes('Mesma Área')).length}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-star"></i>
              </div>
            </div>
          </section>

          {/* Command Bar & Sub-abas */}
          <section className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-3.5 print:hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-2xl overflow-x-auto no-scrollbar">
                {[
                  { key: 'painel', label: 'Painel', icon: 'fa-list-check' },
                  { key: 'sugestao', label: 'Motor PEI', icon: 'fa-wand-magic-sparkles' },
                  { key: 'saldo', label: 'Saldo', icon: 'fa-scale-balanced' },
                  { key: 'relatorio', label: 'Relatório', icon: 'fa-file-invoice' },
                  { key: 'docentes', label: 'Docentes', icon: 'fa-users-gear' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSubAba(tab.key)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                      subAba === tab.key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <i className={`fa-solid ${tab.icon} text-[11px] ${subAba === tab.key ? 'text-indigo-600' : ''}`}></i>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-72">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={termoBusca}
                  onChange={(e) => setTermoBusca(e.target.value)}
                  placeholder="Buscar professor, turma ou disciplina..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none transition"
                />
              </div>
            </div>

            {subAba === 'painel' && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filtroTurma}
                    onChange={(e) => setFiltroTurma(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30"
                  >
                    <option value="TODAS">Todas as Turmas</option>
                    {TURMAS_PEI.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <select
                    value={filtroStatus}
                    onChange={(e) => setFiltroStatus(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/30"
                  >
                    <option value="TODOS">Todos os Status</option>
                    <option value="CONFIRMADA">Confirmadas</option>
                    <option value="PENDENTE">Pendentes</option>
                  </select>
                </div>

                <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-2xl self-start md:self-auto">
                  <button
                    type="button"
                    onClick={() => setTipoOrdenacao('dia-aula')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      tipoOrdenacao === 'dia-aula'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Mostrar a próxima substituição primeiro"
                  >
                    <i className="fa-solid fa-clock-rotate-left text-[11px] text-indigo-600"></i>
                    <span>Próximas Primeiro</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTipoOrdenacao('docente')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      tipoOrdenacao === 'docente'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Classificar por nome do docente ausente"
                  >
                    <i className="fa-solid fa-user-tie text-[11px] text-indigo-600"></i>
                    <span>Por Docente</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* CONTEÚDO SUB-ABA 1: PAINEL DE SUBSTITUIÇÕES */}
          {subAba === 'painel' && (
            <section className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-slate-500 text-xs font-medium">
                  <i className="fa-solid fa-spinner fa-spin text-2xl text-indigo-600 mb-2 block"></i>
                  Carregando registros de substituição...
                </div>
              ) : listagemFiltrada.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <i className="fa-solid fa-user-check text-3xl text-slate-300"></i>
                  <p className="font-semibold text-slate-600 text-sm">Nenhuma substituição encontrada para os filtros selecionados.</p>
                </div>
              ) : (
                <>
                  {/* Mobile Card View (< md) */}
                  <div className="md:hidden divide-y divide-slate-100">
                    {listagemFiltrada.map((item) => {
                      const listaP = (periodosAula && periodosAula.length > 0) ? periodosAula : PERIODOS_AULA;
                      const periodoObj = listaP.find(p => getPeriodoOrder(p.id ?? p.periodoId ?? p.rotulo) === getPeriodoOrder(item.periodoId)) || { rotulo: getPeriodoRotulo(item.periodoId), horario: '' };
                      const badge = getDataBadgeInfo(item.data);
                      const isConfirming = confirmDeleteSubId === item.id;

                      return (
                        <div key={item.id} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-slate-900 tabular-nums">{formatDataBR(item.data)}</span>
                                {badge && (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                                    {badge.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                                {periodoObj.rotulo} {periodoObj.horario ? `· ${periodoObj.horario}` : ''}
                              </p>
                            </div>
                            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-l-4 ${
                              item.status === 'CONFIRMADA'
                                ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70 border-l-emerald-500'
                                : 'bg-amber-50/90 text-amber-900 border-amber-200/70 border-l-amber-500'
                            }`}>
                              {item.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 gap-2 bg-slate-50/70 p-3 rounded-2xl border border-slate-200/60 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Ausente:</span>
                              <span className="font-semibold text-slate-900 text-right">{item.professorAusente}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Turma / Disciplina:</span>
                              <span className="font-medium text-slate-800 text-right">{item.turma} · {item.disciplina}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Substituto:</span>
                              <span className="font-semibold text-indigo-700 text-right">{item.professorSubstituto}</span>
                            </div>
                            {item.motivo && (
                              <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                                {item.motivo}
                              </div>
                            )}
                          </div>

                          {podeEditar && (
                            <div className="flex items-center justify-end gap-2">
                              {isConfirming ? (
                                <div className="flex items-center gap-2 w-full justify-between bg-rose-50 px-3 py-2 rounded-xl border border-rose-200">
                                  <span className="text-xs font-medium text-rose-900">Excluir registro?</span>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteSubId(null)}
                                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-medium cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExcluirSubstituicao(item.id)}
                                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                                    >
                                      Confirmar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleAbrirModalEdicao(item)}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium cursor-pointer"
                                  >
                                    <i className="fa-solid fa-pen-to-square mr-1"></i> Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteSubId(item.id)}
                                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-medium cursor-pointer"
                                  >
                                    <i className="fa-solid fa-trash mr-1"></i> Excluir
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Table (>= md) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[850px]">
                      <thead>
                        <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                          <th className="p-3.5">Data &amp; Período</th>
                          <th className="p-3.5">Prof. Ausente &amp; Turma</th>
                          <th className="p-3.5">Disciplina &amp; Área</th>
                          <th className="p-3.5">Substituto Alocado</th>
                          <th className="p-3.5">Motivo</th>
                          <th className="p-3.5 text-center">Status</th>
                          {podeEditar && <th className="p-3.5 text-center">Ações</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {listagemFiltrada.map((item) => {
                          const listaP = (periodosAula && periodosAula.length > 0) ? periodosAula : PERIODOS_AULA;
                          const periodoObj = listaP.find(p => getPeriodoOrder(p.id ?? p.periodoId ?? p.rotulo) === getPeriodoOrder(item.periodoId)) || { rotulo: getPeriodoRotulo(item.periodoId), horario: '' };
                          const badge = getDataBadgeInfo(item.data);
                          const isConfirming = confirmDeleteSubId === item.id;

                          return (
                            <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-900 tabular-nums">{formatDataBR(item.data)}</span>
                                  {badge && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                                      {badge.label}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                  <span className="font-medium text-indigo-700">{periodoObj.rotulo}</span>
                                  {periodoObj.horario && <span className="ml-1">({periodoObj.horario})</span>}
                                </div>
                              </td>

                              <td className="p-3.5">
                                <div className="font-semibold text-slate-900">{item.professorAusente}</div>
                                <div className="text-[11px] font-medium text-slate-500">{item.turma}</div>
                              </td>

                              <td className="p-3.5">
                                <div className="font-medium text-slate-800">{item.disciplina}</div>
                                <div className="text-[11px] text-slate-400">{item.area}</div>
                              </td>

                              <td className="p-3.5">
                                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                  <i className="fa-solid fa-user-check text-emerald-600 text-[11px]"></i>
                                  <span>{item.professorSubstituto}</span>
                                </div>
                                <div className="text-[11px] text-slate-500">{item.tipoSubstituto}</div>
                              </td>

                              <td className="p-3.5 text-slate-600 max-w-[190px] truncate" title={item.motivo}>
                                {item.motivo}
                              </td>

                              <td className="p-3.5 text-center">
                                <span className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-l-4 ${
                                  item.status === 'CONFIRMADA'
                                    ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70 border-l-emerald-500'
                                    : 'bg-amber-50/90 text-amber-900 border-amber-200/70 border-l-amber-500'
                                }`}>
                                  {item.status}
                                </span>
                              </td>

                              {podeEditar && (
                                <td className="p-3.5 text-center print:hidden">
                                  {isConfirming ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteSubId(null)}
                                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-medium cursor-pointer"
                                      >
                                        Não
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleExcluirSubstituicao(item.id)}
                                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                                      >
                                        Excluir
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleAbrirModalEdicao(item)}
                                        className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg transition cursor-pointer"
                                        title="Editar"
                                      >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteSubId(item.id)}
                                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
                                        title="Excluir"
                                      >
                                        <i className="fa-solid fa-trash-can"></i>
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* CONTEÚDO SUB-ABA 2: MOTOR DE SUGESTÃO PEI & ALOCAÇÃO AUTOMATIZADA */}
          {subAba === 'sugestao' && (
            <div className="space-y-5">
              {/* Card 1: Seleção do Professor Ausente e Configuração do Dia */}
              <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
                      <i className="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Alocação Automatizada de Substituição PEI
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Selecione o professor ausente e a data para localizar todas as aulas do dia e sugerir substitutos livres.
                      </p>
                    </div>
                  </div>

                  {aulasDoProfessorAusente.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 px-3 py-2 rounded-xl tabular-nums">
                        <strong className="text-slate-900">{aulasDoProfessorAusente.length}</strong> aula(s) em {MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm}
                      </span>
                      {podeEditar && (
                        <button
                          type="button"
                          onClick={handleSalvarAlocacoesLote}
                          disabled={salvando}
                          className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-xs flex items-center gap-2 cursor-pointer"
                        >
                          <i className="fa-solid fa-bolt text-amber-400"></i>
                          <span>{salvando ? 'Salvando...' : `Confirmar Todas (${aulasDoProfessorAusente.length})`}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      1. Professor Ausente
                    </label>
                    <select
                      value={form.professorAusente}
                      onChange={(e) => {
                        const prof = listaProfessoresUnificada.find(p => isSameProfessor(p.nome, e.target.value));
                        setForm(prev => ({
                          ...prev,
                          professorAusente: e.target.value,
                          disciplina: prof ? prof.disciplina : prev.disciplina,
                          area: prof ? prof.area : prev.area
                        }));
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                    >
                      <option value="">-- Selecione o Docente Ausente --</option>
                      {listaProfessoresUnificada.map(p => (
                        <option key={p.nome} value={p.nome}>
                          {p.nome} ({p.disciplina || 'Geral'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      2. Data da Ausência
                    </label>
                    <input
                      type="date"
                      value={form.data}
                      onChange={(e) => setForm({ ...form, data: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none tabular-nums"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Dia: <strong className="text-slate-800">{MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm}</strong>
                    </span>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      3. Motivo da Ausência
                    </label>
                    <select
                      value={form.motivo}
                      onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                    >
                      {MOTIVOS_AUSENCIA.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Card 2: Lista de Aulas e Sugestões */}
              <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Aulas Atribuídas &amp; Sugestões de Substitutos Livres
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cruzamento em tempo real com a grade horária para identificar docentes livres.
                    </p>
                  </div>

                  {aulasDoProfessorAusente.length > 0 && (
                    <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200/70 px-3 py-1 rounded-xl flex items-center gap-1.5 self-start sm:self-auto">
                      <i className="fa-solid fa-circle-check text-emerald-600"></i>
                      <span>Motor PEI · 8 Critérios de Prioridade</span>
                    </span>
                  )}
                </div>

                {/* Ordem dos 8 Critérios PEI */}
                <div className="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-3 text-[11px] text-slate-700 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-scale-balanced text-indigo-600"></i>
                      Ordem de Prioridade PEI
                    </span>
                    <span className="text-amber-800 bg-amber-50 border border-amber-200/70 px-2.5 py-0.5 rounded-lg font-medium">
                      Desempate: menor carga semanal
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5 font-medium text-center text-[11px]">
                    <div className="bg-emerald-50/90 border border-emerald-200/60 text-emerald-900 rounded-lg p-1.5">1. Mesma matéria</div>
                    <div className="bg-teal-50/90 border border-teal-200/60 text-teal-900 rounded-lg p-1.5">2. Mesma área</div>
                    <div className="bg-cyan-50/90 border border-cyan-200/60 text-cyan-900 rounded-lg p-1.5">3. PAAC área</div>
                    <div className="bg-sky-50/90 border border-sky-200/60 text-sky-900 rounded-lg p-1.5">4. Outra matéria</div>
                    <div className="bg-amber-50/90 border border-amber-200/60 text-amber-900 rounded-lg p-1.5">5. Outra área</div>
                    <div className="bg-purple-50/90 border border-purple-200/60 text-purple-900 rounded-lg p-1.5">6. CGPG</div>
                    <div className="bg-indigo-50/90 border border-indigo-200/60 text-indigo-900 rounded-lg p-1.5">7. Vice-direção</div>
                    <div className="bg-rose-50/90 border border-rose-200/60 text-rose-900 rounded-lg p-1.5">8. Direção</div>
                  </div>
                </div>

                {!form.professorAusente ? (
                  <div className="p-10 text-center text-slate-400 space-y-2">
                    <i className="fa-solid fa-user-slash text-3xl text-slate-300"></i>
                    <p className="font-semibold text-slate-600 text-sm">Nenhum professor selecionado.</p>
                    <p className="text-xs">Selecione o professor ausente acima para carregar as aulas do dia.</p>
                  </div>
                ) : aulasDoProfessorAusente.length === 0 ? (
                  <div className="p-8 text-center text-slate-600 space-y-2 bg-amber-50/60 border border-amber-200/70 border-l-4 border-l-amber-500 rounded-2xl">
                    <i className="fa-solid fa-calendar-xmark text-3xl text-amber-600"></i>
                    <p className="font-semibold text-slate-900 text-sm">
                      Nenhuma aula regular encontrada para {form.professorAusente} em {MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm}.
                    </p>
                    <p className="text-xs text-slate-500">
                      Verifique a grade na aba Horários ou altere a data selecionada.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                      <table className="w-full text-left border-collapse min-w-[750px]">
                        <thead>
                          <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                            <th className="p-3.5">Horário / Aula</th>
                            <th className="p-3.5">Turma &amp; Disciplina</th>
                            <th className="p-3.5">Substituto Sugerido</th>
                            <th className="p-3.5 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {aulasDoProfessorAusente.map((aula) => {
                            const listaP = (periodosAula && periodosAula.length > 0) ? periodosAula : PERIODOS_AULA;
                            const periodoObj = listaP.find(p => getPeriodoOrder(p.id ?? p.periodoId ?? p.rotulo) === getPeriodoOrder(aula.periodoId)) || { rotulo: getPeriodoRotulo(aula.periodoId), horario: '' };
                            const areaAula = encontrarAreaDisciplina(aula.disciplina);
                            const sugestoes = calcularSugestoesParaAula(aula.periodoId, aula.disciplina, areaAula);
                            const alocAtual = alocacoesLote[aula.periodoId] || { professorSubstituto: '', tipoSubstituto: '' };
                            const subsAtualObj = sugestoes.find(s => isSameProfessor(s.nome, alocAtual.professorSubstituto) || s.nome === alocAtual.professorSubstituto);

                            return (
                              <tr key={aula.id || aula.periodoId} className="hover:bg-slate-50/70 transition-colors">
                                <td className="p-3.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200/60">
                                      {periodoObj.rotulo}
                                    </span>
                                    {periodoObj.horario && (
                                      <span className="text-xs text-slate-500 tabular-nums">
                                        {periodoObj.horario}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="p-3.5">
                                  <div className="font-semibold text-slate-900">{aula.turma}</div>
                                  <div className="text-xs font-medium text-indigo-700">{aula.disciplina}</div>
                                  <div className="text-[11px] text-slate-400">{areaAula}</div>
                                </td>

                                <td className="p-3.5 max-w-sm">
                                  <select
                                    value={alocAtual.professorSubstituto}
                                    onChange={(e) => handleMudarSubstitutoLote(aula.periodoId, e.target.value, aula.disciplina, areaAula)}
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                                  >
                                    <option value="">-- Selecione o Professor Substituto --</option>
                                    {sugestoes.map(p => {
                                      const isBlocked = p.isIndisponivel || p.isOcupado;
                                      let rotulo = `${p.nome} (${p.disciplina}) — ${p.motivoPrioridade} [Carga: ${p.totalAulasSemana}h]`;
                                      if (isBlocked) {
                                        rotulo = `Bloqueado: ${p.nome} (${p.isIndisponivel ? 'Fora da Escola / Folga' : 'Em Aula: ' + p.motivoOcupado})`;
                                      }
                                      return (
                                        <option key={p.nome} value={p.nome} disabled={isBlocked}>
                                          {rotulo}
                                        </option>
                                      );
                                    })}
                                  </select>

                                  {subsAtualObj && (
                                    <div className="mt-1.5 text-[11px] flex items-center gap-2 flex-wrap">
                                      <span className="px-2 py-0.5 rounded-md font-medium bg-indigo-50 text-indigo-800 border border-indigo-200/60">
                                        {subsAtualObj.motivoPrioridade}
                                      </span>
                                      <span className="text-slate-500 tabular-nums">
                                        Carga: <strong className="text-slate-700">{subsAtualObj.totalAulasSemana}h</strong> ({subsAtualObj.aulasSemana} reg. + {subsAtualObj.saldoReal} subst.)
                                      </span>
                                    </div>
                                  )}
                                </td>

                                <td className="p-3.5 text-center">
                                  {podeEditar && (
                                    <button
                                      type="button"
                                      onClick={() => handleSalvarAulaUnica(aula)}
                                      disabled={salvando || !alocAtual.professorSubstituto}
                                      className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition cursor-pointer inline-flex items-center gap-1.5 ${
                                        alocAtual.professorSubstituto
                                          ? 'bg-slate-900 hover:bg-slate-800 text-white'
                                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      }`}
                                    >
                                      <i className="fa-solid fa-check text-emerald-400"></i>
                                      <span>Salvar</span>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {podeEditar && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleSalvarAlocacoesLote}
                          disabled={salvando}
                          className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs px-5 py-3 rounded-xl transition shadow-xs flex items-center gap-2 cursor-pointer"
                        >
                          <i className="fa-solid fa-bolt text-amber-400"></i>
                          <span>Confirmar e Salvar {aulasDoProfessorAusente.length} Substituição(ões)</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CONTEÚDO SUB-ABA 3: CONTROLE DE SALDO DE AULAS */}
          {subAba === 'saldo' && (
            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-5">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <i className="fa-solid fa-scale-balanced text-amber-500"></i>
                    Extrato de Saldo de Aulas &amp; Créditos/Débitos PEI
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Controle em tempo real de substituições realizadas (+) e faltas justificadas (-) por docente.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => setConfirmZerarSaldo(prev => !prev)}
                    className="inline-flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
                  >
                    <i className="fa-solid fa-rotate-right"></i>
                    <span>Zerar Saldo</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportarSaldoJSON}
                    className="inline-flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer"
                  >
                    <i className="fa-solid fa-download"></i>
                    <span>Exportar JSON</span>
                  </button>

                  <label className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3.5 py-2 rounded-xl transition cursor-pointer">
                    <i className="fa-solid fa-upload text-indigo-600"></i>
                    <span>Importar JSON</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportarSaldoJSON}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {confirmZerarSaldo && (
                <div className="p-4 rounded-2xl bg-rose-50/90 border border-rose-200 border-l-4 border-l-rose-500 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-rose-950">
                    <p className="font-semibold">Confirmar reinício do ciclo semanal (Zerar Saldo)?</p>
                    <p className="text-[11px] text-rose-800 mt-0.5">
                      Esta ação zera o saldo inicial/acumulado de todos os docentes e limpa o histórico de substituições da semana atual.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmZerarSaldo(false)}
                      className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleZerarSaldoFimDeSemana}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Confirmar Reinício
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                      <th className="p-3.5">Docente / Disciplina</th>
                      <th className="p-3.5">Área PEI</th>
                      <th className="p-3.5 text-center">Regência</th>
                      <th className="p-3.5 text-center">Carga Total</th>
                      <th className="p-3.5 text-center">Inicial</th>
                      <th className="p-3.5 text-center">Créditos (+)</th>
                      <th className="p-3.5 text-center">Débitos (-)</th>
                      <th className="p-3.5 text-center">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {saldoDocentesConsolidado.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
                          Nenhum docente cadastrado na grade horária oficial.
                        </td>
                      </tr>
                    ) : (
                      saldoDocentesConsolidado.map((docente) => (
                        <tr key={docente.nome} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-3.5">
                            <div className="font-semibold text-slate-900">{docente.nome}</div>
                            <div className="text-[11px] text-slate-500">{docente.disciplina}</div>
                          </td>
                          <td className="p-3.5 text-slate-600">{docente.area}</td>
                          <td className="p-3.5 text-center font-semibold text-indigo-700 tabular-nums">
                            {docente.aulasRegenciaGrade}h
                          </td>
                          <td className="p-3.5 text-center tabular-nums">
                            <div className="font-bold text-slate-900 text-sm">{docente.cargaTotalSemana}h</div>
                            {docente.atingiuTeto32 ? (
                              <span className="inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                                32h+ (Teto atingido)
                              </span>
                            ) : (
                              <span className="inline-block mt-0.5 text-[11px] text-slate-400">
                                {docente.aulasRegenciaGrade} reg. + {docente.creditos} subst.
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center text-slate-600 tabular-nums">{docente.saldoInicial}</td>
                          <td className="p-3.5 text-center font-semibold text-emerald-700 tabular-nums">+{docente.creditos}</td>
                          <td className="p-3.5 text-center font-semibold text-rose-700 tabular-nums">-{docente.debitos}</td>
                          <td className="p-3.5 text-center tabular-nums">
                            <span className={`inline-block font-semibold text-xs px-2.5 py-1 rounded-lg border border-l-4 ${
                              docente.totalFinal > 0
                                ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70 border-l-emerald-500'
                                : docente.totalFinal < 0
                                ? 'bg-rose-50/90 text-rose-900 border-rose-200/70 border-l-rose-500'
                                : 'bg-slate-50 text-slate-700 border-slate-200 border-l-slate-400'
                            }`}>
                              {docente.totalFinal > 0 ? `+${docente.totalFinal}` : docente.totalFinal} aula(s)
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* CONTEÚDO SUB-ABA 4: RELATÓRIO DE EVENTUAIS */}
          {subAba === 'relatorio' && (
            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-6">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                    Boletim de Controle de Carga Horária &amp; Aulas Eventuais
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    E.E. Clóvis de Lucca · Sincronização de créditos (+), débitos (-) e saldo docente.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleImprimir}
                  className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition inline-flex items-center gap-2 print:hidden cursor-pointer"
                >
                  <i className="fa-solid fa-file-pdf text-rose-400"></i>
                  <span>Gerar PDF / Imprimir</span>
                </button>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <i className="fa-solid fa-scale-balanced text-amber-500"></i>
                  Extrato do Monitor de Carga Horária Docente
                </h3>
                <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                        <th className="p-3">Docente</th>
                        <th className="p-3">Área / Disciplina</th>
                        <th className="p-3 text-center">Regência</th>
                        <th className="p-3 text-center">Carga Total</th>
                        <th className="p-3 text-center">Inicial</th>
                        <th className="p-3 text-center">Créditos (+)</th>
                        <th className="p-3 text-center">Débitos (-)</th>
                        <th className="p-3 text-center">Saldo Acumulado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {saldoDocentesConsolidado.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-6 text-center text-slate-400">
                            Nenhum registro docente para apuração.
                          </td>
                        </tr>
                      ) : (
                        saldoDocentesConsolidado.map((d) => (
                          <tr key={d.nome} className="hover:bg-slate-50/70">
                            <td className="p-3 font-semibold text-slate-900">{d.nome}</td>
                            <td className="p-3 text-slate-600">{d.disciplina} ({d.area})</td>
                            <td className="p-3 text-center font-semibold text-indigo-700 tabular-nums">{d.aulasRegenciaGrade}h</td>
                            <td className="p-3 text-center font-bold text-slate-900 tabular-nums">
                              {d.cargaTotalSemana}h {d.atingiuTeto32 && <span className="text-[10px] text-rose-700 font-semibold ml-1">(32h+)</span>}
                            </td>
                            <td className="p-3 text-center text-slate-600 tabular-nums">{d.saldoInicial}</td>
                            <td className="p-3 text-center font-semibold text-emerald-700 tabular-nums">+{d.creditos}</td>
                            <td className="p-3 text-center font-semibold text-rose-700 tabular-nums">-{d.debitos}</td>
                            <td className="p-3 text-center tabular-nums">
                              <span className={`px-2 py-0.5 rounded-md font-semibold ${
                                d.totalFinal > 0 ? 'bg-emerald-50 text-emerald-900' : d.totalFinal < 0 ? 'bg-rose-50 text-rose-900' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {d.totalFinal > 0 ? `+${d.totalFinal}` : d.totalFinal} aula(s)
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <i className="fa-solid fa-list-check text-indigo-600"></i>
                  Detalhamento de Aulas Substituídas por Docente Eventual
                </h3>
                <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                        <th className="p-3">Docente Substituto</th>
                        <th className="p-3 text-center">Total Aulas</th>
                        <th className="p-3">Turmas Atendidas</th>
                        <th className="p-3">Disciplinas Ministradas</th>
                        <th className="p-3 text-center">Visto Direção</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {relatorioSubstitutos.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-400">
                            Nenhuma aula de substituição computada no período.
                          </td>
                        </tr>
                      ) : (
                        relatorioSubstitutos.map((r) => (
                          <tr key={r.nome} className="hover:bg-slate-50/70">
                            <td className="p-3 font-semibold text-slate-900">{r.nome}</td>
                            <td className="p-3 text-center font-bold text-sm text-emerald-700 tabular-nums">
                              {r.totalAulas}
                            </td>
                            <td className="p-3 text-slate-700">{Array.from(r.turmasAtendidas).join(', ')}</td>
                            <td className="p-3 text-slate-600">{Array.from(r.disciplinas).join(', ')}</td>
                            <td className="p-3 text-center text-slate-400">[ &nbsp;&nbsp;&nbsp;&nbsp; ] OK</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* CONTEÚDO SUB-ABA 5: CONFIGURAÇÃO E CADASTRO DE DOCENTES */}
          {subAba === 'docentes' && (
            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-5">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <i className="fa-solid fa-users-gear text-emerald-600"></i>
                    Configuração &amp; Cadastro de Docentes PEI
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Docentes, disciplinas, áreas de conhecimento e aulas de regência sincronizadas com a grade oficial.
                  </p>
                </div>

                {podeEditar && (
                  <button
                    type="button"
                    onClick={() => handleMigrarDocentesDoHorario(false)}
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition shadow-xs cursor-pointer print:hidden"
                    title="Sincroniza e migra automaticamente todos os docentes da aba Horários"
                  >
                    <i className="fa-solid fa-bolt text-amber-300"></i>
                    <span>Migrar Docentes do Horário</span>
                  </button>
                )}
              </div>

              {podeEditar && (
                <form onSubmit={handleAdicionarDocenteCorpo} className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <i className="fa-solid fa-user-plus text-indigo-600"></i>
                    Adicionar Novo Docente (Eventual / Contratado)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                    <input
                      type="text"
                      value={novoDocenteForm.nome}
                      onChange={(e) => setNovoDocenteForm({ ...novoDocenteForm, nome: e.target.value })}
                      placeholder="Nome Completo do Docente"
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
                      required
                    />
                    <input
                      type="text"
                      value={novoDocenteForm.disciplina}
                      onChange={(e) => setNovoDocenteForm({ ...novoDocenteForm, disciplina: e.target.value, area: encontrarAreaDisciplina(e.target.value) })}
                      placeholder="Disciplina (ex: Matemática)"
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                    <select
                      value={novoDocenteForm.area}
                      onChange={(e) => setNovoDocenteForm({ ...novoDocenteForm, area: e.target.value })}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                      {OPCOES_AREAS_PEI.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <select
                      value={novoDocenteForm.tipo}
                      onChange={(e) => setNovoDocenteForm({ ...novoDocenteForm, tipo: e.target.value })}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                      <option value="EFETIVO">Efetivo PEI</option>
                      <option value="CATEGORIA_O">Categoria O</option>
                      <option value="EVENTUAL">Eventual</option>
                    </select>
                    <button
                      type="submit"
                      className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <i className="fa-solid fa-check"></i>
                      <span>Salvar Docente</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-800 tabular-nums">
                    Corpo Docente PEI ({listaProfessoresUnificada.length} professores)
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    As áreas de conhecimento orientam a ordem de sugestão PEI.
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                        <th className="p-3.5">Docente / Nome</th>
                        <th className="p-3.5">Disciplina</th>
                        <th className="p-3.5">Área de Conhecimento PEI</th>
                        <th className="p-3.5 text-center">Aulas na Grade</th>
                        <th className="p-3.5 text-center">Vínculo</th>
                        {podeEditar && <th className="p-3.5 text-center">Ações</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {listaProfessoresUnificada.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-slate-400">
                            Nenhum docente encontrado. Clique em "Migrar Docentes do Horário" para importar automaticamente.
                          </td>
                        </tr>
                      ) : (
                        listaProfessoresUnificada.map((docente) => {
                          const isConfirmingDoc = confirmDeleteDocenteNome === docente.nome;
                          return (
                            <tr key={docente.nome} className="hover:bg-slate-50/70 transition-colors">
                              <td className="p-3.5 font-semibold text-slate-900">
                                <div className="flex items-center gap-2">
                                  <i className="fa-solid fa-user-tie text-slate-400"></i>
                                  <span>{docente.nome}</span>
                                </div>
                              </td>
                              <td className="p-3.5 text-slate-700">{docente.disciplina}</td>
                              <td className="p-3.5">
                                {podeEditar ? (
                                  <select
                                    value={docente.area}
                                    onChange={(e) => handleAlterarAreaDocenteInline(docente.nome, e.target.value)}
                                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                                  >
                                    {OPCOES_AREAS_PEI.map(a => (
                                      <option key={a} value={a}>{a}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="font-medium text-slate-800">{docente.area}</span>
                                )}
                              </td>
                              <td className="p-3.5 text-center font-semibold text-indigo-700 tabular-nums">
                                {docente.aulasRegenciaGrade || 0}
                              </td>
                              <td className="p-3.5 text-center">
                                {podeEditar ? (
                                  <select
                                    value={docente.tipo || 'EFETIVO'}
                                    onChange={(e) => handleAlterarTipoDocenteInline(docente.nome, e.target.value)}
                                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                                  >
                                    <option value="EFETIVO">Efetivo PEI (Regente)</option>
                                    <option value="PAAC">PAAC / Eventual / Apoio</option>
                                    <option value="CGPG">CGPG / CGPCA</option>
                                    <option value="VICE_DIRETOR">Vice-Diretor(a)</option>
                                    <option value="DIRETOR">Diretor(a) Escolar</option>
                                  </select>
                                ) : (
                                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-medium">
                                    {docente.tipo || 'EFETIVO'}
                                  </span>
                                )}
                              </td>
                              {podeEditar && (
                                <td className="p-3.5 text-center">
                                  {isConfirmingDoc ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteDocenteNome(null)}
                                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-medium cursor-pointer"
                                      >
                                        Não
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleExcluirDocenteCorpo(docente.nome)}
                                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                                      >
                                        Excluir
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteDocenteNome(docente.nome)}
                                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                                      title="Excluir Docente do Cadastro"
                                    >
                                      <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* MODAL LANÇAR / EDITAR SUBSTITUIÇÃO PEI (Bottom-Sheet Mobile / Centered Desktop) */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0" />

              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-wand-magic-sparkles"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-slate-900">
                      {itemEdicao ? 'Editar Substituição PEI' : 'Lançar Substituições do Dia em Lote'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {itemEdicao ? 'Atualize os dados da substituição selecionada' : 'Alocação inteligente por professor ausente'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              {itemEdicao ? (
                <form onSubmit={handleSalvarSubstituicao} className="flex flex-col flex-1 overflow-hidden">
                  <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Data</label>
                        <input
                          type="date"
                          value={form.data}
                          onChange={(e) => setForm({ ...form, data: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 tabular-nums"
                          required
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Período / Aula</label>
                        <select
                          value={form.periodoId}
                          onChange={(e) => setForm({ ...form, periodoId: Number(e.target.value) })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900"
                          required
                        >
                          {PERIODOS_AULA.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.rotulo} ({p.horario})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Professor Ausente</label>
                      <select
                        value={form.professorAusente}
                        onChange={(e) => setForm({ ...form, professorAusente: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900"
                        required
                      >
                        <option value="">-- Selecione o Professor Ausente --</option>
                        {listaProfessoresUnificada.map(p => (
                          <option key={p.nome} value={p.nome}>{p.nome} ({p.disciplina})</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Disciplina</label>
                        <input
                          type="text"
                          value={form.disciplina}
                          onChange={(e) => handleDisciplinaChange(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900"
                          required
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Turma PEI</label>
                        <select
                          value={form.turma}
                          onChange={(e) => setForm({ ...form, turma: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900"
                          required
                        >
                          {TURMAS_PEI.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Motivo da Ausência</label>
                      <select
                        value={form.motivo}
                        onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900"
                        required
                      >
                        {MOTIVOS_AUSENCIA.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>

                    <div className="bg-indigo-50/60 p-3.5 rounded-2xl border border-indigo-200/70 space-y-2">
                      <label className="block font-semibold text-indigo-950">
                        Professor Substituto Alocado
                      </label>
                      <select
                        value={form.professorSubstituto}
                        onChange={(e) => {
                          const selNome = e.target.value;
                          const pObj = sugestoesSubstitutos.find(s => s.nome === selNome);
                          setForm({
                            ...form,
                            professorSubstituto: selNome,
                            tipoSubstituto: pObj?.motivoPrioridade || form.tipoSubstituto
                          });
                        }}
                        className="w-full p-2.5 bg-white border border-indigo-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                        required
                      >
                        <option value="">-- Selecione o Professor Substituto Apto --</option>
                        {sugestoesSubstitutos.map(p => {
                          const isBlocked = p.isIndisponivel || p.isOcupado;
                          let rotulo = `${p.nome} (${p.disciplina}) — ${p.motivoPrioridade} [Carga: ${p.totalAulasSemana}h]`;
                          if (isBlocked) {
                            rotulo = `Bloqueado: ${p.nome} (${p.isIndisponivel ? 'Fora da Escola / Folga' : 'Em Aula: ' + p.motivoOcupado})`;
                          }
                          return (
                            <option key={p.nome} value={p.nome} disabled={isBlocked}>
                              {rotulo}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Observações</label>
                      <textarea
                        value={form.observacao}
                        onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                        placeholder="Orientações de aula deixadas pelo titular..."
                        rows={2}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-normal text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={salvando}
                      className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition shadow-xs cursor-pointer"
                    >
                      {salvando ? 'Salvando...' : 'Atualizar Substituição'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs">
                    <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Data da Ausência</label>
                        <input
                          type="date"
                          value={form.data}
                          onChange={(e) => setForm({ ...form, data: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none tabular-nums"
                          required
                        />
                        <span className="text-[11px] text-slate-500 mt-1 block">
                          Dia: <strong className="text-slate-800">{MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm}</strong>
                        </span>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Professor Ausente</label>
                        <select
                          value={form.professorAusente}
                          onChange={(e) => {
                            const prof = listaProfessoresUnificada.find(p => isSameProfessor(p.nome, e.target.value));
                            setForm(prev => ({
                              ...prev,
                              professorAusente: e.target.value,
                              disciplina: prof ? prof.disciplina : prev.disciplina,
                              area: prof ? prof.area : prev.area
                            }));
                          }}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                          required
                        >
                          <option value="">-- Selecione o Docente Ausente --</option>
                          {listaProfessoresUnificada.map(p => (
                            <option key={p.nome} value={p.nome}>
                              {p.nome} ({p.disciplina || 'Geral'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1.5">Motivo da Ausência</label>
                        <select
                          value={form.motivo}
                          onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                          required
                        >
                          {MOTIVOS_AUSENCIA.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <h4 className="text-sm font-semibold text-slate-900 tabular-nums">
                          Aulas na Grade de {MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm} ({aulasDoProfessorAusente.length} aulas)
                        </h4>
                        {aulasDoProfessorAusente.length > 0 && (
                          <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200/70 px-2.5 py-1 rounded-lg">
                            Substitutos sugeridos por prioridade PEI
                          </span>
                        )}
                      </div>

                      {!form.professorAusente ? (
                        <div className="p-8 text-center text-slate-400 space-y-2 border border-dashed border-slate-200 rounded-2xl">
                          <i className="fa-solid fa-arrow-up text-xl text-indigo-500"></i>
                          <p className="font-semibold text-slate-600 text-sm">Selecione o professor ausente acima.</p>
                          <p className="text-xs">As aulas regulares do dia serão carregadas automaticamente.</p>
                        </div>
                      ) : aulasDoProfessorAusente.length === 0 ? (
                        <div className="p-8 text-center text-slate-600 space-y-2 bg-amber-50/60 border border-amber-200/70 rounded-2xl">
                          <i className="fa-solid fa-calendar-xmark text-2xl text-amber-500"></i>
                          <p className="font-semibold text-slate-900 text-sm">
                            Nenhuma aula regular encontrada para {form.professorAusente} em {MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm}.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50/90 border-b border-slate-200/80 text-slate-500 text-xs font-semibold">
                                <th className="p-3">Horário / Aula</th>
                                <th className="p-3">Turma &amp; Disciplina</th>
                                <th className="p-3">Substituto Alocado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                              {aulasDoProfessorAusente.map((aula) => {
                                const listaP = (periodosAula && periodosAula.length > 0) ? periodosAula : PERIODOS_AULA;
                                const periodoObj = listaP.find(p => getPeriodoOrder(p.id ?? p.periodoId ?? p.rotulo) === getPeriodoOrder(aula.periodoId)) || { rotulo: getPeriodoRotulo(aula.periodoId), horario: '' };
                                const areaAula = encontrarAreaDisciplina(aula.disciplina);
                                const sugestoes = calcularSugestoesParaAula(aula.periodoId, aula.disciplina, areaAula);
                                const alocAtual = alocacoesLote[aula.periodoId] || { professorSubstituto: '', tipoSubstituto: '' };
                                const subsAtualObj = sugestoes.find(s => isSameProfessor(s.nome, alocAtual.professorSubstituto) || s.nome === alocAtual.professorSubstituto);

                                return (
                                  <tr key={aula.id || aula.periodoId} className="hover:bg-slate-50/70">
                                    <td className="p-3">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold">
                                          {periodoObj.rotulo}
                                        </span>
                                        {periodoObj.horario && (
                                          <span className="text-[11px] text-slate-500 tabular-nums">
                                            ({periodoObj.horario})
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    <td className="p-3">
                                      <div className="font-semibold text-slate-900">{aula.turma}</div>
                                      <div className="text-xs font-medium text-indigo-700">{aula.disciplina}</div>
                                      <div className="text-[11px] text-slate-400">{areaAula}</div>
                                    </td>

                                    <td className="p-3">
                                      <select
                                        value={alocAtual.professorSubstituto}
                                        onChange={(e) => handleMudarSubstitutoLote(aula.periodoId, e.target.value, aula.disciplina, areaAula)}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/30 outline-none cursor-pointer"
                                      >
                                        <option value="">-- Selecione o Professor Substituto --</option>
                                        <optgroup label="Sugestões Inteligentes (Livres)">
                                          {sugestoes.filter(p => !p.isIndisponivel && !p.isOcupado).map(p => (
                                            <option key={p.nome} value={p.nome}>
                                              {p.nome} ({p.disciplina}) — {p.motivoPrioridade} [{p.totalAulasSemana}h]
                                            </option>
                                          ))}
                                        </optgroup>
                                        <optgroup label="Todos os Professores da Escola">
                                          {sugestoes.map(p => {
                                            const isBlocked = p.isIndisponivel || p.isOcupado;
                                            let rotulo = `${p.nome} (${p.disciplina}) — ${p.motivoPrioridade} [${p.totalAulasSemana}h]`;
                                            if (isBlocked) {
                                              rotulo = `Bloqueado: ${p.nome} (${p.isIndisponivel ? 'Fora da Escola / Folga' : 'Em Aula: ' + p.motivoOcupado})`;
                                            }
                                            return (
                                              <option key={p.nome} value={p.nome} disabled={isBlocked}>
                                                {rotulo}
                                              </option>
                                            );
                                          })}
                                        </optgroup>
                                      </select>

                                      {subsAtualObj && (
                                        <div className="mt-1 text-[11px] flex items-center gap-1.5 flex-wrap">
                                          <span className="px-2 py-0.5 rounded-md font-medium bg-indigo-50 text-indigo-800 border border-indigo-200/60">
                                            {subsAtualObj.motivoPrioridade}
                                          </span>
                                          <span className="text-slate-500 tabular-nums">
                                            Carga: <strong>{subsAtualObj.totalAulasSemana}h</strong>
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={handleSalvarAlocacoesLote}
                      disabled={salvando || !form.professorAusente || aulasDoProfessorAusente.length === 0}
                      className={`px-5 py-2 text-xs font-semibold rounded-xl transition flex items-center gap-2 cursor-pointer ${
                        salvando || !form.professorAusente || aulasDoProfessorAusente.length === 0
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          : 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
                      }`}
                    >
                      <i className="fa-solid fa-bolt text-amber-400"></i>
                      <span>
                        {salvando
                          ? 'Salvando...'
                          : `Confirmar ${aulasDoProfessorAusente.length} Substituição(ões)`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO EXCLUSIVA DE IMPRESSÃO - IMPRESSORA / RELATÓRIO PDF */}
      <div className="hidden print:block space-y-6 p-6 bg-white text-black font-sans leading-tight">
        <div className="text-center border-b-2 border-black pb-3 space-y-1">
          <h1 className="text-xs font-black uppercase tracking-wider">Governo do Estado de São Paulo — Secretaria da Educação</h1>
          <h2 className="text-xs font-bold uppercase">Diretoria de Ensino — E.E. Clóvis de Lucca</h2>
          <h3 className="text-sm font-black uppercase tracking-tight mt-1 text-black">
            Relatório Oficial de Substituição PEI e Extrato do Banco de Horas
          </h3>
          <p className="text-[9px] font-semibold text-gray-700">
            Emissão: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')} &bull; Unidade Escolar PEI
          </p>
        </div>

        {/* Ficha da Atribuição Diária Atual do Dia (Se houver formulário ativo com aulas) */}
        {form.professorAusente && aulasDoProfessorAusente.length > 0 && (
          <div className="space-y-2 border-b border-black pb-4">
            <h4 className="text-xs font-black uppercase tracking-wide bg-gray-100 p-1.5 border border-black text-center">
              Ficha de Atribuição e Substituição Diária em Lote
            </h4>
            <div className="grid grid-cols-3 gap-2 text-[10px] p-2 border border-black bg-gray-50/50">
              <div><strong>Data da Ausência:</strong> {form.data} ({MAPA_DIAS_EXTENSO[diaSemanaForm] || diaSemanaForm})</div>
              <div><strong>Professor Ausente:</strong> {form.professorAusente}</div>
              <div><strong>Motivo Declarado:</strong> {form.motivo || MOTIVOS_AUSENCIA[0]}</div>
            </div>
            <table className="w-full text-left border-collapse text-[10px] mt-2">
              <thead>
                <tr className="bg-gray-200 border-y border-black font-black uppercase text-[9px]">
                  <th className="p-1.5 border border-black">Aulas / Horário</th>
                  <th className="p-1.5 border border-black">Turma / Disciplina</th>
                  <th className="p-1.5 border border-black">Professor Substituto Designado</th>
                  <th className="p-1.5 border border-black">Enquadramento / Cargo</th>
                  <th className="p-1.5 border border-black text-center">Visto / Assinatura</th>
                </tr>
              </thead>
              <tbody>
                {aulasDoProfessorAusente.map(aula => {
                  const aloc = alocacoesLote[aula.periodoId] || {};
                  return (
                    <tr key={aula.id || aula.periodoId} className="border-b border-black">
                      <td className="p-1.5 border border-black font-bold">
                        {getPeriodoRotulo(aula.periodoId)}
                      </td>
                      <td className="p-1.5 border border-black">{aula.turma} — {aula.disciplina}</td>
                      <td className="p-1.5 border border-black font-black">{aloc.professorSubstituto || '—'}</td>
                      <td className="p-1.5 border border-black text-[9px]">{aloc.tipoSubstituto || '—'}</td>
                      <td className="p-1.5 border border-black w-28 text-center"></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Listagem Geral de Substituições Filtradas (Exatamente com os campos da tabela em tela) */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wide border-b border-black pb-1 flex justify-between items-center">
            <span>Relatório Oficial de Substituições PEI</span>
            <span className="text-[9px] font-bold text-gray-600">Classificação: {tipoOrdenacao === 'docente' ? 'Por Docente' : 'Por Dia e Aula'}</span>
          </h4>
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-gray-200 border-y border-black font-black uppercase text-[9px]">
                <th className="p-1.5 border border-black">Data &amp; Período</th>
                <th className="p-1.5 border border-black">Prof. Ausente &amp; Turma</th>
                <th className="p-1.5 border border-black">Disciplina &amp; Área</th>
                <th className="p-1.5 border border-black">Prof. Substituto Alocado</th>
                <th className="p-1.5 border border-black">Motivo</th>
                <th className="p-1.5 border border-black text-center">Status</th>
                <th className="p-1.5 border border-black text-center min-w-[120px]">Assinatura / Visto</th>
              </tr>
            </thead>
            <tbody>
              {listagemFiltrada.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6">
                    <MascoteSaraState
                      titulo="Nenhuma substituição encontrada para os filtros aplicados!"
                      mensagem="Altere as datas, o docente ou a turma para localizar as aulas de substituição."
                      compact
                    />
                  </td>
                </tr>
              ) : (
                listagemFiltrada.map(s => {
                  const listaP = (periodosAula && periodosAula.length > 0) ? periodosAula : PERIODOS_AULA;
                  const periodoObj = listaP.find(p => getPeriodoOrder(p.id ?? p.periodoId ?? p.rotulo) === getPeriodoOrder(s.periodoId)) || { rotulo: getPeriodoRotulo(s.periodoId), horario: '' };
                  return (
                    <tr key={s.id} className="border-b border-black">
                      <td className="p-1.5 border border-black font-bold whitespace-nowrap">
                        <div>{formatDataBR(s.data)}</div>
                        <div className="text-[9px] text-gray-700 font-bold mt-0.5">
                          {periodoObj.rotulo} {periodoObj.horario && <span className="font-mono text-[8px]">({periodoObj.horario})</span>}
                        </div>
                      </td>
                      <td className="p-1.5 border border-black">
                        <div className="font-extrabold">{s.professorAusente}</div>
                        <div className="text-[9px] font-bold text-gray-800">{s.turma}</div>
                      </td>
                      <td className="p-1.5 border border-black">
                        <div className="font-bold">{s.disciplina}</div>
                        {s.area && <div className="text-[8px] text-gray-600 font-semibold">{s.area}</div>}
                      </td>
                      <td className="p-1.5 border border-black">
                        <div className="font-black">{s.professorSubstituto}</div>
                        {s.tipoSubstituto && <div className="text-[8px] text-gray-600 italic">{s.tipoSubstituto}</div>}
                      </td>
                      <td className="p-1.5 border border-black">{s.motivo}</td>
                      <td className="p-1.5 border border-black text-center font-black text-[9px]">
                        {s.status}
                      </td>
                      <td className="p-1.5 border border-black text-center align-bottom min-w-[120px]">
                        <div className="border-b border-black w-24 mx-auto mt-4 mb-0.5"></div>
                        <span className="text-[7px] text-gray-600 uppercase font-semibold block">Visto / Assinatura</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Extrato Consolidado do Banco de Horas */}
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-black uppercase tracking-wide border-b border-black pb-1">
            2. Extrato do Saldo do Banco de Horas Docente (Consolidado)
          </h4>
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-gray-200 border-y border-black font-black uppercase text-[9px]">
                <th className="p-1.5 border border-black">Docente</th>
                <th className="p-1.5 border border-black">Área / Disciplina</th>
                <th className="p-1.5 border border-black text-center">Regência (Grade)</th>
                <th className="p-1.5 border border-black text-center">Saldo Inicial</th>
                <th className="p-1.5 border border-black text-center">Créditos (+)</th>
                <th className="p-1.5 border border-black text-center">Débitos (-)</th>
                <th className="p-1.5 border border-black text-center">Saldo Final</th>
                <th className="p-1.5 border border-black text-center">Carga Total</th>
              </tr>
            </thead>
            <tbody>
              {saldoDocentesConsolidado.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-3 text-center italic border border-black">Nenhum docente cadastrado.</td>
                </tr>
              ) : (
                saldoDocentesConsolidado.map(d => (
                  <tr key={d.nome} className="border-b border-black">
                    <td className="p-1.5 border border-black font-bold">{d.nome}</td>
                    <td className="p-1.5 border border-black">{d.disciplina} ({d.area})</td>
                    <td className="p-1.5 border border-black text-center font-mono">{d.aulasRegenciaGrade}h</td>
                    <td className="p-1.5 border border-black text-center font-mono">{d.saldoInicial}</td>
                    <td className="p-1.5 border border-black text-center font-mono font-bold">+{d.creditos}</td>
                    <td className="p-1.5 border border-black text-center font-mono font-bold">-{d.debitos}</td>
                    <td className="p-1.5 border border-black text-center font-mono font-black">
                      {d.totalFinal > 0 ? `+${d.totalFinal}` : d.totalFinal} aula(s)
                    </td>
                    <td className="p-1.5 border border-black text-center font-mono font-black bg-gray-50">
                      {d.aulasRegenciaGrade + d.totalFinal}h
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Campo de Assinaturas Oficiais */}
        <div className="pt-12 grid grid-cols-2 gap-8 text-center text-[10px] font-bold uppercase">
          <div>
            <div className="border-b border-black w-3/4 mx-auto mb-1"></div>
            <p>Direção / Vice-Direção Escolar PEI</p>
          </div>
          <div>
            <div className="border-b border-black w-3/4 mx-auto mb-1"></div>
            <p>CGPG / Coordenação Geral Pedagógica</p>
          </div>
        </div>
      </div>
    </>
  );
}
