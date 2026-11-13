import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, collection, getDocs, addDoc, updateDoc, setDoc, doc, deleteDoc, writeBatch, getDoc, onSnapshot } from '../lib/database';
import { podeExcluir, OPCOES_AREAS_PEI, normalizarArea, encontrarAreaDisciplina, isRegularTeachingClass, extrairEMigrarDocentesDoHorario, isSameProfessor, normalizeTeacherName, getPeriodoOrder, getPeriodoRotulo, isTeacherAtSchool, normalizarDia } from '../utils';
import { registrarLogAuditoria } from '../modules/auditLogger';
import { obterUsuarioAtivoCompleto } from '../modules/authHelper';

// Estrutura de Horários Padrão PEI (Programa Ensino Integral - São Paulo)
const DIAS_SEMANA = [
  { id: 'segunda', label: 'Segunda-feira', short: 'SEG' },
  { id: 'terca', label: 'Terça-feira', short: 'TER' },
  { id: 'quarta', label: 'Quarta-feira', short: 'QUA' },
  { id: 'quinta', label: 'Quinta-feira', short: 'QUI' },
  { id: 'sexta', label: 'Sexta-feira', short: 'SEX' }
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

const TURMAS_PADRAO = [
  '6º Ano A', '6º Ano B', '7º Ano A', '8º Ano A', '9º Ano A',
  '1º Ano A E.M.', '2º Ano A E.M.', '3º Ano A E.M.'
];

const PROFESSORES_PADRAO = [
  'Profª Maria Silva (Português)',
  'Prof. Carlos Eduardo (Matemática)',
  'Profª Ana Paula (Ciências/Biologia)',
  'Prof. Roberto Santos (História)',
  'Prof. Fernando Lima (Geografia)',
  'Profª Juliana Mendes (Física/Química)',
  'Prof. Lucas Costa (Educação Física)',
  'Profª Vanessa Rocha (Inglês/Arte)',
  'Prof. Marcos Souza (Inovação/Robótica)',
  'Profª Camila Santos (PV/Tutoria)'
];

const SALAS_PADRAO = [
  'Sala 01 (6ºA)', 'Sala 02 (6ºB)', 'Sala 03 (7ºA)', 'Sala 04 (8ºA)',
  'Sala 05 (9ºA)', 'Sala 06 (1ºA EM)', 'Sala 07 (2ºA EM)', 'Sala 08 (3ºA EM)',
  'Laboratório de Ciências', 'Sala Maker / Informática', 'Quadra Poliesportiva', 'Sala de Leitura'
];

const DISCIPLINAS_CORES = {
  // 1. Língua Portuguesa / Inglês / Arte / Ed. Física: Amarelo/Laranja
  'Língua Portuguesa': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Português': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Inglês': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Arte': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Artes': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Educação Física': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },
  'Ed. Física': { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' },

  // 2. Matemática: Vermelho/Rose
  'Matemática': { bg: 'bg-rose-100 border-rose-300 text-rose-900 font-bold', badge: 'bg-rose-600 text-white' },

  // 3. Ciências / Biologia / Física / Química: Verde
  'Ciências': { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold', badge: 'bg-emerald-600 text-white' },
  'Biologia': { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold', badge: 'bg-emerald-600 text-white' },
  'Física': { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold', badge: 'bg-emerald-600 text-white' },
  'Química': { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold', badge: 'bg-emerald-600 text-white' },

  // 4. História / Geografia / Filosofia / Sociologia: Roxo/Fúcsia
  'História': { bg: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900 font-bold', badge: 'bg-fuchsia-600 text-white' },
  'Geografia': { bg: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900 font-bold', badge: 'bg-fuchsia-600 text-white' },
  'Filosofia': { bg: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900 font-bold', badge: 'bg-fuchsia-600 text-white' },
  'Sociologia': { bg: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900 font-bold', badge: 'bg-fuchsia-600 text-white' },

  // 5. Eletivas / Projeto de Vida / Práticas / Tecnologia / Orientação / Tutoria / Robótica: Azul/Ciano
  'Eletiva': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Eletivas': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Projeto de Vida': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Práticas Experimentais': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Inovação Tecnológica': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Tecnologia': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Orientação de Estudos': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Estudo Orientado': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Tutoria': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Pensamento Computacional': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Robótica': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },
  'Plantão Pedagógico': { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' },

  // 6. Intervalo / Almoço: Cinza Neutro
  'Intervalo': { bg: 'bg-slate-200 border-slate-300 text-slate-700 italic font-semibold', badge: 'bg-slate-600 text-white' },
  'Intervalo Dirigido': { bg: 'bg-slate-200 border-slate-300 text-slate-700 italic font-semibold', badge: 'bg-slate-600 text-white' },
  'Almoço': { bg: 'bg-slate-200 border-slate-300 text-slate-700 italic font-semibold', badge: 'bg-slate-600 text-white' },
  'Almoço Diversificado': { bg: 'bg-slate-200 border-slate-300 text-slate-700 italic font-semibold', badge: 'bg-slate-600 text-white' }
};

// Dados padrão iniciais para caso o Firestore esteja vazio
const GERAR_HORARIOS_INICIAIS = () => {
  const lista = [];
  const profs = [
    { nome: 'Profª Maria Silva', disciplina: 'Língua Portuguesa' },
    { nome: 'Prof. Carlos Eduardo', disciplina: 'Matemática' },
    { nome: 'Profª Ana Paula', disciplina: 'Ciências' },
    { nome: 'Prof. Roberto Santos', disciplina: 'História' },
    { nome: 'Prof. Fernando Lima', disciplina: 'Geografia' },
    { nome: 'Profª Juliana Mendes', disciplina: 'Física' },
    { nome: 'Prof. Lucas Costa', disciplina: 'Educação Física' },
    { nome: 'Profª Vanessa Rocha', disciplina: 'Inglês' },
    { nome: 'Prof. Marcos Souza', disciplina: 'Inovação Tecnológica' },
    { nome: 'Profª Camila Santos', disciplina: 'Projeto de Vida' }
  ];

  const turmas = TURMAS_PADRAO;
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
  const periodosUteis = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  let idCounter = 1;
  dias.forEach((dia, diaIdx) => {
    turmas.forEach((turma, turmaIdx) => {
      periodosUteis.forEach((periodo) => {
        const profObj = profs[(diaIdx + turmaIdx + periodo) % profs.length];
        const sala = SALAS_PADRAO[turmaIdx % SALAS_PADRAO.length];
        lista.push({
          id: `init-${idCounter++}`,
          dia,
          periodoId: periodo,
          turma,
          professor: profObj.nome,
          disciplina: profObj.disciplina,
          sala,
          observacao: ''
        });
      });
    });
  });

  return lista;
};

export default function Horarios() {
  const [anoGrade, setAnoGrade] = useState(() => {
    try {
      return localStorage.getItem('clovis_ano_letivo') === '2027' ? '2027' : '2026';
    } catch {
      return '2026';
    }
  });
  const [horarios, setHorarios] = useState(() => {
    try {
      if (localStorage.getItem('clovis_ano_letivo') === '2027') {
        const c27 = localStorage.getItem('clovis_grade_horarios_2027');
        return c27 ? JSON.parse(c27) : [];
      }
    } catch {}
    return Array.isArray(window.gradeCache) ? window.gradeCache : [];
  });
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  // Diálogo de confirmação in-app (substitui window.confirm bloqueado em iframes)
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    variant: 'danger',
    onConfirm: null
  });

  const notificar = useCallback((msg, tipo = 'info', duracao = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(msg, tipo, duracao);
    } else {
      console.info(`[Horários PEI - ${tipo}]`, msg);
    }
  }, []);

  const abrirConfirmacao = useCallback(({ title, message, confirmLabel = 'Confirmar', variant = 'danger', onConfirm }) => {
    setConfirmDialog({
      open: true,
      title: title || 'Confirmar Ação',
      message: message || '',
      confirmLabel,
      variant,
      onConfirm
    });
  }, []);

  const handleAlternarAnoGrade = useCallback((novoAno) => {
    const anoVal = novoAno === '2027' ? '2027' : '2026';
    setAnoGrade(anoVal);
    try {
      localStorage.setItem('clovis_ano_letivo', anoVal);
      if (typeof window !== 'undefined') {
        window.anoLetivoAtual = anoVal;
        window.dispatchEvent(new CustomEvent('clovis_ano_letivo_changed', { detail: anoVal }));
      }
    } catch {}
    notificar(`Visualizando Grade Horária do Ano Letivo ${anoVal}!`, 'info');
  }, [notificar]);

  useEffect(() => {
    const onAnoChanged = (e) => {
      const val = e?.detail === '2027' ? '2027' : '2026';
      setAnoGrade(prev => (prev !== val ? val : prev));
    };
    window.addEventListener('clovis_ano_letivo_changed', onAnoChanged);
    return () => window.removeEventListener('clovis_ano_letivo_changed', onAnoChanged);
  }, []);

  // Modo de visualização: 'por_turma' | 'por_professor' | 'por_sala' | 'matriz_geral'
  const [modoVisao, setModoVisao] = useState('por_turma');

  // State de Slots de Horário / Períodos Configuráveis
  const [periodosAula, setPeriodosAula] = useState(PERIODOS_AULA);
  const [isConfigHorariosModalOpen, setIsConfigHorariosModalOpen] = useState(false);

  // State de Controle de Ausência / Indisponibilidade de Professores (Matriz)
  const [indisponibilidadeProfs, setIndisponibilidadeProfs] = useState({});
  const [isAusenciaModalOpen, setIsAusenciaModalOpen] = useState(false);
  const [profAusenciaSelecionado, setProfAusenciaSelecionado] = useState('Profª Maria Silva');
  const [motivoAusenciaInput, setMotivoAusenciaInput] = useState('Janela / Fora de Expediente');

  // Filtros Selecionados
  const [turmaSelecionada, setTurmaSelecionada] = useState('6º Ano A');
  const [professorSelecionado, setProfessorSelecionado] = useState('Profª Maria Silva');
  const [salaSelecionada, setSalaSelecionada] = useState('Sala 01 (6ºA)');
  const [termoBusca, setTermoBusca] = useState('');

  // Filtro de Otimização de Turnos & Indisponibilidade Docente
  const [suprimirTurnosOutros, setSuprimirTurnosOutros] = useState(true);
  const [apenasHorariosNaEscola, setApenasHorariosNaEscola] = useState(true);

  // Escutar Firestore doc 'config_escola/periodos_aula' para sincronizar Slots de Horários
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'periodos_aula');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && Array.isArray(docSnap.data().slots) && docSnap.data().slots.length > 0) {
        setPeriodosAula(docSnap.data().slots);
        localStorage.setItem('clovis_periodos_aula', JSON.stringify(docSnap.data().slots));
      } else {
        const cached = localStorage.getItem('clovis_periodos_aula');
        if (cached) {
          try { setPeriodosAula(JSON.parse(cached)); } catch(e) {}
        }
      }
    }, (err) => {
      console.warn('Erro ao carregar config periodos_aula do Firestore:', err);
      const cached = localStorage.getItem('clovis_periodos_aula');
      if (cached) {
        try { setPeriodosAula(JSON.parse(cached)); } catch(e) {}
      }
    });

    return () => unsubscribe();
  }, []);

  // Escutar Firestore doc 'config_escola/indisponibilidade_professores' para matriz de presença
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'indisponibilidade_professores');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().matriz) {
        setIndisponibilidadeProfs(docSnap.data().matriz);
        localStorage.setItem('clovis_indisponibilidade_professores', JSON.stringify(docSnap.data().matriz));
      } else {
        const cached = localStorage.getItem('clovis_indisponibilidade_professores');
        if (cached) {
          try { setIndisponibilidadeProfs(JSON.parse(cached)); } catch(e) {}
        }
      }
    }, (err) => {
      console.warn('Erro ao carregar indisponibilidade_professores do Firestore:', err);
      const cached = localStorage.getItem('clovis_indisponibilidade_professores');
      if (cached) {
        try { setIndisponibilidadeProfs(JSON.parse(cached)); } catch(e) {}
      }
    });

    return () => unsubscribe();
  }, []);

  // Modal Novo / Edição / Gerenciamento
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGerenciarModalOpen, setIsGerenciarModalOpen] = useState(false);
  const [abaGerenciar, setAbaGerenciar] = useState('grade'); // 'grade' | 'turmas' | 'professores' | 'salas' | 'csv'
  const [filtroGradeAdminBusca, setFiltroGradeAdminBusca] = useState('');
  const [filtroGradeAdminTurma, setFiltroGradeAdminTurma] = useState('TODAS');
  const [filtroGradeAdminProf, setFiltroGradeAdminProf] = useState('TODOS');
  const [filtroGradeAdminDia, setFiltroGradeAdminDia] = useState('TODOS');
  const [aulaEmEdicaoGradeAdmin, setAulaEmEdicaoGradeAdmin] = useState(null);
  const [isCriandoAulaGradeAdmin, setIsCriandoAulaGradeAdmin] = useState(false);
  const [formEdicaoGradeAdmin, setFormEdicaoGradeAdmin] = useState({
    id: '',
    dia: 'segunda',
    periodoId: 1,
    turma: '',
    professor: '',
    disciplina: '',
    sala: ''
  });

  // Modal de Auditoria e Gestão de Aulas Atribuídas (Exclusivo Diretor)
  const [isAuditoriaAulasModalOpen, setIsAuditoriaAulasModalOpen] = useState(false);
  const [auditoriaFiltroProfessor, setAuditoriaFiltroProfessor] = useState('TODOS');
  const [auditoriaFiltroTurma, setAuditoriaFiltroTurma] = useState('TODAS');
  const [auditoriaFiltroDia, setAuditoriaFiltroDia] = useState('TODOS');
  const [auditoriaTermoBusca, setAuditoriaTermoBusca] = useState('');
  
  const [aulaEmEdicaoAuditoria, setAulaEmEdicaoAuditoria] = useState(null);
  const [isCriandoNovaAulaAuditoria, setIsCriandoNovaAulaAuditoria] = useState(false);
  const [formAuditoria, setFormAuditoria] = useState({
    dia: 'segunda',
    periodoId: 1,
    turma: '',
    professor: '',
    disciplina: '',
    sala: '',
    contarSaldo: true
  });

  // State do Modal de Pré-Visualização e Ajustes Finos do CSV Importado
  const [isPreviewCsvModalOpen, setIsPreviewCsvModalOpen] = useState(false);
  const [csvPreviewItems, setCsvPreviewItems] = useState([]);
  const [csvFiltroBusca, setCsvFiltroBusca] = useState('');
  const [csvImportNomeArquivo, setCsvImportNomeArquivo] = useState('');

  const csvPreviewItemsFiltered = useMemo(() => {
    if (!csvFiltroBusca) return csvPreviewItems;
    const busca = csvFiltroBusca.toLowerCase();
    return csvPreviewItems.filter(item =>
      `${item.turma} ${item.professor} ${item.disciplina} ${item.sala}`
        .toLowerCase()
        .includes(busca)
    );
  }, [csvPreviewItems, csvFiltroBusca]);

  const [novoTurmaInput, setNovoTurmaInput] = useState('');
  const [novoProfInput, setNovoProfInput] = useState('');
  const [novaSalaInput, setNovaSalaInput] = useState('');

  // States para Edição de Nomes no Modal "Gerenciar Grade" (Turmas, Professores, Salas)
  const [turmaEmEdicao, setTurmaEmEdicao] = useState(null);
  const [novoNomeTurma, setNovoNomeTurma] = useState('');
  const [profEmEdicao, setProfEmEdicao] = useState(null);
  const [novoNomeProf, setNovoNomeProf] = useState('');
  const [novaDiscProf, setNovaDiscProf] = useState('');
  const [salaEmEdicao, setSalaEmEdicao] = useState(null);
  const [novoNomeSala, setNovoNomeSala] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const [cadastrosCustom, setCadastrosCustom] = useState({
    turmas: [],
    professores: [],
    salas: []
  });
  
  // State de Cadastro Completo do Corpo Docente & Áreas do Conhecimento
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
    turno: 'INTEGRAL',
    saldoAulas: 0
  });

  const [itemEdicao, setItemEdicao] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [substituicoes, setSubstituicoes] = useState(() => {
    const cached = localStorage.getItem('clovis_substituicoes_cache');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    return [];
  });

  // Carregar collection 'substituicoes_diarias' com cache agressivo (Zero Reads desnecessários)
  const carregarSubstituicoesHorarios = useCallback(async (forceServer = false) => {
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
        const cached = localStorage.getItem('clovis_substituicoes_cache');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setSubstituicoes(parsed);
            window.substituicoesCache = parsed;
            const hojeStr = new Date().toISOString().split('T')[0];
            window.substituicoesHoje = parsed.filter(s => (s.data_referencia || s.data) === hojeStr);
          } catch (e) {}
        }
      }
    } catch (err) {
      const cached = localStorage.getItem('clovis_substituicoes_cache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setSubstituicoes(parsed);
          window.substituicoesCache = parsed;
          const hojeStr = new Date().toISOString().split('T')[0];
          window.substituicoesHoje = parsed.filter(s => (s.data_referencia || s.data) === hojeStr);
        } catch (e) {}
      }
    }
  }, []);

  // Listener em tempo real de substituições enquanto a tela de Horários estiver aberta
  useEffect(() => {
    const colRef = collection(db, 'substituicoes_diarias');
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
      }
    }, (err) => {
      console.warn('Aviso no listener em tempo real de substituições em horários:', err);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Escutar Firestore doc 'config_escola/cadastro_professores'
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'cadastro_professores');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && Array.isArray(docSnap.data().professores)) {
        const profsComArea = docSnap.data().professores.map(p => ({
          ...p,
          area: normalizarArea(p.area || encontrarAreaDisciplina(p.disciplina))
        }));
        setCadastroProfessores(profsComArea);
        localStorage.setItem('clovis_cadastro_professores', JSON.stringify(profsComArea));
      }
    }, (err) => console.warn('Erro ao carregar cadastro_professores no Horarios:', err));
    return () => unsubscribe();
  }, []);

  // Escutar Firestore doc 'config_escola/cadastros_base'
  useEffect(() => {
    const docRef = doc(db, 'config_escola', 'cadastros_base');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCadastrosCustom({
          turmas: Array.isArray(data.turmas) ? data.turmas : [],
          professores: Array.isArray(data.professores) ? data.professores : [],
          salas: Array.isArray(data.salas) ? data.salas : []
        });
      }
    }, (err) => console.warn('Erro ao carregar cadastros_base:', err));
    return () => unsubscribe();
  }, []);

  // Escutar eventos globais de exclusão e atualização de docentes
  useEffect(() => {
    const handleEntityDeleted = () => {
      const docRef = doc(db, 'config_escola', 'cadastros_base');
      getDoc(docRef).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCadastrosCustom({
            turmas: Array.isArray(data.turmas) ? data.turmas : [],
            professores: Array.isArray(data.professores) ? data.professores : [],
            salas: Array.isArray(data.salas) ? data.salas : []
          });
        }
      }).catch(() => {});

      const cachedProfs = localStorage.getItem('clovis_cadastro_professores');
      if (cachedProfs) {
        try { setCadastroProfessores(JSON.parse(cachedProfs)); } catch (e) {}
      }
    };

    const handleTeachersUpdated = (e) => {
      if (e.detail && Array.isArray(e.detail)) {
        setCadastroProfessores(e.detail);
      }
    };

    window.addEventListener('clovis_entity_deleted', handleEntityDeleted);
    window.addEventListener('clovis_teachers_updated', handleTeachersUpdated);
    return () => {
      window.removeEventListener('clovis_entity_deleted', handleEntityDeleted);
      window.removeEventListener('clovis_teachers_updated', handleTeachersUpdated);
    };
  }, []);

  // Form de Horário
  const [form, setForm] = useState({
    dia: 'segunda',
    periodoId: 1,
    turma: '6º Ano A',
    professor: 'Profª Maria Silva',
    disciplina: 'Língua Portuguesa',
    sala: 'Sala 01 (6ºA)',
    observacao: ''
  });

  // Identificação do Usuário e Perfil
  const [userRole, setUserRole] = useState(() => {
    if (typeof window !== 'undefined' && typeof window.obterRoleAtual === 'function') {
      return window.obterRoleAtual();
    }
    return window?.currentUserRole || 'PROFESSOR';
  });

  // Modo Planilha / Edição Direta & Drag-and-Drop
  const [modoPlanilha, setModoPlanilha] = useState(false);
  const [inlineDrafts, setInlineDrafts] = useState({});

  // Estados de Arraste e Solte (Drag & Drop) e Duplicação
  const [draggedAula, setDraggedAula] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null); // { dia: 'segunda', periodoId: 1 }
  const [modoDuplicarComArrasto, setModoDuplicarComArrasto] = useState(false);

  const LISTA_DISCIPLINAS_SUGERIDAS = useMemo(() => [
    'Língua Portuguesa',
    'Matemática',
    'Ciências',
    'Biologia',
    'Física',
    'Química',
    'História',
    'Geografia',
    'Inglês',
    'Arte',
    'Educação Física',
    'Projeto de Vida',
    'Orientação de Estudos',
    'Inovação Tecnológica',
    'Eletiva / Tutoria',
    'Tutoria',
    'Intervalo Dirigido',
    'Estudo Orientado',
    'Almoço Diversificado',
    'Plantão Pedagógico',
    'FOLGA / OFF',
    'OFF',
    '-',
    'S',
    '* (BLOQUEIO)'
  ], []);

  // Listener de alteração de perfil/role orientado a eventos (sem polling de 1s)
  useEffect(() => {
    const checarRole = () => {
      const r = typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() : (window.currentUserRole || 'PROFESSOR');
      setUserRole(prev => {
        if (prev !== r) return r;
        return prev;
      });
      const upper = String(r || '').toUpperCase().trim().replace(/-/g, '_');
      const eAutorizado = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG'].some(roleKey => upper === roleKey || upper.includes(roleKey));
      if (!eAutorizado) {
        setModoPlanilha(false);
      }
    };
    checarRole();
    window.addEventListener('storage', checarRole);
    window.addEventListener('taborrolechange', checarRole);
    return () => {
      window.removeEventListener('storage', checarRole);
      window.removeEventListener('taborrolechange', checarRole);
    };
  }, []);

  const roleUpper = String(userRole || 'PROFESSOR').toUpperCase().trim().replace(/-/g, '_');
  // Restrição EXCLUSIVA aos Perfis "DIRETOR", "VICE_DIRETOR" e "CGPG"
  const podeEditar = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG'].some(
    r => roleUpper === r || roleUpper.includes(r)
  );
  const isDiretor = ['DIRETOR', 'DIRETORA', 'DIRECAO'].some(
    r => roleUpper === r || roleUpper.startsWith(r)
  ) || (typeof window.ehDiretor === 'function' ? window.ehDiretor() : false);

  // Helper centralizado de persistência da grade (2026 vigente ou 2027 planejamento)
  const persistirGradeAtual = useCallback(async (novosHorarios, idsDeletadosExtras = [], targetAno = anoGrade) => {
    setHorarios(novosHorarios);

    if (targetAno === '2027') {
      try {
        localStorage.setItem('clovis_grade_horarios_2027', JSON.stringify(novosHorarios));
      } catch (e) {}
      try {
        await setDoc(doc(db, 'config_escola', 'grade_horarios_2027'), {
          anoLetivo: '2027',
          grade: novosHorarios,
          initialized: true,
          atualizadoEm: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.warn('Erro ao sincronizar grade 2027 no banco:', e);
      }
      return;
    }

    // Ano 2026 (vigente)
    let delArr = [];
    try {
      const delRaw = localStorage.getItem('clovis_horarios_deleted_ids');
      delArr = delRaw ? JSON.parse(delRaw) : [];
      if (!Array.isArray(delArr)) delArr = [];
    } catch (e) {
      delArr = [];
    }

    (idsDeletadosExtras || []).forEach((remId) => {
      if (remId && !delArr.includes(remId)) {
        delArr.push(remId);
      }
    });

    try {
      localStorage.setItem('clovis_horarios_deleted_ids', JSON.stringify(delArr));
      localStorage.setItem('clovis_horarios_cache', JSON.stringify(novosHorarios));
    } catch (e) {}

    if (typeof window !== 'undefined') {
      window.gradeCache = novosHorarios;
    }

    try {
      await setDoc(doc(db, 'config_escola', 'grade_horarios_custom'), {
        grade: novosHorarios,
        deletedIds: delArr,
        initialized: true,
        atualizadoEm: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn('Erro ao sincronizar snapshot grade_horarios_custom:', e);
    }
  }, [anoGrade]);

  const handleDuplicarGradePara2027 = useCallback(async (alternarPara2027 = true) => {
    try {
      let base2026 = [];
      if (anoGrade === '2026') {
        base2026 = [...horarios];
      } else {
        const snap2026 = await getDocs(collection(db, 'horarios'));
        snap2026.forEach(d => base2026.push({ id: d.id, ...d.data() }));
        if (base2026.length === 0) {
          const customSnap = await getDoc(doc(db, 'config_escola', 'grade_horarios_custom'));
          if (customSnap.exists() && Array.isArray(customSnap.data()?.grade)) {
            base2026 = customSnap.data().grade;
          }
        }
        if (base2026.length === 0) {
          const cached = localStorage.getItem('clovis_horarios_cache');
          if (cached) base2026 = JSON.parse(cached);
        }
      }

      const grade2027 = (base2026 || []).map((h, idx) => ({
        ...h,
        id: h.id ? `2027_${String(h.id).replace(/^2027_/, '')}` : `2027_aula_${Date.now()}_${idx}`,
        anoLetivo: '2027'
      }));

      await persistirGradeAtual(grade2027, [], '2027');
      notificar(`Sucesso! ${grade2027.length} aulas duplicadas para a Grade de Planejamento 2027.`, 'success', 5000);
      if (alternarPara2027 && anoGrade !== '2027') {
        handleAlternarAnoGrade('2027');
      }
    } catch (e) {
      console.error('Erro ao duplicar grade para 2027:', e);
      notificar('Grade 2027 salva em contingência local.', 'info');
    }
  }, [anoGrade, horarios, persistirGradeAtual, notificar, handleAlternarAnoGrade]);

  // Handlers para o Modo Planilha (Edição Direta de Célula)
  const handleDraftChange = (id, field, value) => {
    setInlineDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value
      }
    }));
  };

  const handleSalvarCelulaDireta = async (aula) => {
    if (!podeEditar) {
      notificar('Acesso negado: Apenas a Direção e Coordenação CGPG possuem autorização para alterar a grade horária.', 'warning');
      return;
    }
    const draft = inlineDrafts[aula.id] || {};
    const safePeriodoId = isNaN(Number(aula.periodoId)) ? aula.periodoId : Number(aula.periodoId);
    const userAtivo = obterUsuarioAtivoCompleto();
    const payload = {
      dia: aula.dia,
      periodoId: safePeriodoId,
      turma: draft.turma !== undefined ? draft.turma : aula.turma,
      professor: draft.professor !== undefined ? draft.professor : aula.professor,
      disciplina: draft.disciplina !== undefined ? draft.disciplina : aula.disciplina,
      sala: draft.sala !== undefined ? draft.sala : aula.sala,
      observacao: '',
      contarSaldo: draft.contarSaldo !== undefined ? draft.contarSaldo : (aula.contarSaldo !== false && aula.ativo !== false),
      editadoPorNome: userAtivo.nome,
      editadoPorEmail: userAtivo.email,
      editadoPorCargo: userAtivo.cargo,
      editadoEm: new Date().toISOString()
    };

    try {
      if (anoGrade === '2026' && aula.id && !String(aula.id).startsWith('init-') && !String(aula.id).startsWith('local-')) {
        const docRef = doc(db, 'horarios', aula.id);
        await setDoc(docRef, payload, { merge: true });
      }

      const atualizados = horarios.map((h) => (h.id === aula.id ? { ...h, ...payload } : h));
      await persistirGradeAtual(atualizados);

      setInlineDrafts((prev) => {
        const copy = { ...prev };
        delete copy[aula.id];
        return copy;
      });

      notificar(`Célula atualizada (${anoGrade}) com sucesso!`, 'success');
    } catch (err) {
      console.error('Erro ao salvar célula em tempo real:', err);
      const atualizados = horarios.map((h) => (h.id === aula.id ? { ...h, ...payload } : h));
      setHorarios(atualizados);
      notificar('Célula atualizada localmente com sucesso.', 'info');
    }
  };

  const handleCriarNovaAulaPlanilha = async (diaId, periodoId) => {
    if (!podeEditar) {
      notificar('Acesso negado: Apenas a Direção e Coordenação CGPG possuem autorização para alterar a grade horária.', 'warning');
      return;
    }
    const newId = anoGrade === '2027' ? `2027_horario-${Date.now()}` : `horario-${Date.now()}`;
    const safePeriodoId = isNaN(Number(periodoId)) ? periodoId : Number(periodoId);
    const userAtivo = obterUsuarioAtivoCompleto();
    const novaAula = {
      id: newId,
      dia: diaId,
      periodoId: safePeriodoId,
      turma: modoVisao === 'por_turma' ? turmaSelecionada : (listaTurmas[0] || '6º Ano A'),
      professor: modoVisao === 'por_professor' ? professorSelecionado : (listaProfessores[0] || 'Profª Maria Silva'),
      disciplina: 'Tutoria',
      sala: modoVisao === 'por_sala' ? salaSelecionada : (listaSalas[0] || 'Sala 01 (6ºA)'),
      observacao: '',
      contarSaldo: true,
      anoLetivo: anoGrade,
      editadoPorNome: userAtivo.nome,
      editadoPorEmail: userAtivo.email,
      editadoPorCargo: userAtivo.cargo,
      editadoEm: new Date().toISOString()
    };

    try {
      if (anoGrade === '2026') {
        const docRef = doc(db, 'horarios', newId);
        await setDoc(docRef, novaAula);
      }
      await persistirGradeAtual([...horarios, novaAula]);
      notificar(`Nova aula alocada na planilha (${anoGrade}) com sucesso!`, 'success');
    } catch (e) {
      console.error('Erro ao criar aula via planilha:', e);
      setHorarios((prev) => [...prev, novaAula]);
    }
  };

  // Handlers para Edição de Slots de Horários
  const handleSalvarSlotsTempo = async (novosSlots) => {
    if (!podeEditar) {
      notificar('Acesso Negado: Apenas a Direção pode alterar os horários e slots das aulas.', 'warning');
      return;
    }
    try {
      const docRef = doc(db, 'config_escola', 'periodos_aula');
      await setDoc(docRef, { slots: novosSlots, atualizadoEm: new Date().toISOString() });
      setPeriodosAula(novosSlots);
      localStorage.setItem('clovis_periodos_aula', JSON.stringify(novosSlots));
      notificar('Slots de horários salvos com sucesso!', 'success');
      setIsConfigHorariosModalOpen(false);
    } catch (e) {
      console.error('Erro ao salvar slots de horários:', e);
      setPeriodosAula(novosSlots);
      localStorage.setItem('clovis_periodos_aula', JSON.stringify(novosSlots));
      notificar('Slots atualizados localmente com sucesso.', 'info');
      setIsConfigHorariosModalOpen(false);
    }
  };

  const handleAdicionarSlotTempo = () => {
    const proximoId = periodosAula.length > 0 ? Math.max(...periodosAula.map(p => Number(p.id) || 0)) + 1 : 1;
    const novoSlot = {
      id: proximoId,
      rotulo: `${proximoId}ª Aula`,
      horario: '16:20 - 17:05',
      tipo: 'aula'
    };
    const atualizados = [...periodosAula, novoSlot];
    setPeriodosAula(atualizados);
  };

  const handleRemoverSlotTempo = (idSlot) => {
    if (periodosAula.length <= 1) {
      notificar('A grade precisa ter ao menos um slot de horário.', 'warning');
      return;
    }
    const filtrados = periodosAula.filter(p => Number(p.id) !== Number(idSlot));
    setPeriodosAula(filtrados);
  };

  // Handlers para Controle de Indisponibilidade / Ausência de Professores
  const handleToggleIndisponibilidade = async (profNome, diaId, periodoId) => {
    if (!podeEditar) {
      notificar('Acesso Negado: Apenas a Direção pode alterar a matriz de disponibilidade docente.', 'warning');
      return;
    }
    const key = `${diaId}-${periodoId}`;
    const profMap = indisponibilidadeProfs[profNome] || {};
    const atualSlot = profMap[key] || { ausente: false, motivo: '' };
    const novoSlot = {
      ausente: !atualSlot.ausente,
      motivo: !atualSlot.ausente ? (motivoAusenciaInput || 'Fora da escola / Janela') : ''
    };

    const novaMatriz = {
      ...indisponibilidadeProfs,
      [profNome]: {
        ...profMap,
        [key]: novoSlot
      }
    };

    try {
      const docRef = doc(db, 'config_escola', 'indisponibilidade_professores');
      await setDoc(docRef, { matriz: novaMatriz, atualizadoEm: new Date().toISOString() });
      setIndisponibilidadeProfs(novaMatriz);
      localStorage.setItem('clovis_indisponibilidade_professores', JSON.stringify(novaMatriz));
      notificar(`Status do(a) ${profNome} atualizado!`, 'success');
    } catch (e) {
      console.error('Erro ao salvar indisponibilidade:', e);
      setIndisponibilidadeProfs(novaMatriz);
      localStorage.setItem('clovis_indisponibilidade_professores', JSON.stringify(novaMatriz));
    }
  };
  // Carregamento em Tempo Real da Grade Horária via onSnapshot (2026 vigente ou 2027 planejamento)
  useEffect(() => {
    setLoading(true);
    setErro(null);

    if (anoGrade === '2027') {
      try {
        const c27 = localStorage.getItem('clovis_grade_horarios_2027');
        if (c27) {
          const parsed27 = JSON.parse(c27);
          if (Array.isArray(parsed27)) {
            setHorarios(parsed27);
            setLoading(false);
          }
        }
      } catch (e) {}

      const doc2027Ref = doc(db, 'config_escola', 'grade_horarios_2027');
      const unsub2027 = onSnapshot(doc2027Ref, (docSnap) => {
        if (docSnap.exists() && Array.isArray(docSnap.data()?.grade)) {
          const g27 = docSnap.data().grade;
          setHorarios(g27);
          try {
            localStorage.setItem('clovis_grade_horarios_2027', JSON.stringify(g27));
          } catch (e) {}
        } else {
          const c27 = localStorage.getItem('clovis_grade_horarios_2027');
          if (c27) {
            try { setHorarios(JSON.parse(c27)); } catch (e) { setHorarios([]); }
          } else {
            setHorarios([]);
          }
        }
        setLoading(false);
        setIsRealtimeConnected(true);
        setErro(null);
      }, (err) => {
        console.warn('Erro ao carregar grade 2027:', err);
        setLoading(false);
        setIsRealtimeConnected(false);
      });

      return () => {
        if (typeof unsub2027 === 'function') unsub2027();
      };
    }

    // Modo 2026 (Grade Vigente)
    const cachedGrade = window.gradeCache || (() => {
      try {
        const c = localStorage.getItem('clovis_horarios_cache');
        return c ? JSON.parse(c) : null;
      } catch (e) { return null; }
    })();

    if (Array.isArray(cachedGrade) && cachedGrade.length > 0) {
      setHorarios(cachedGrade);
      setLoading(false);
    }

    const colRef = collection(db, 'horarios');

    // Conecta o listener em tempo real exclusivamente enquanto o componente Horários estiver montado em 2026
    const unsubscribe = onSnapshot(colRef, async (snapshot) => {
      const docs = [];
      snapshot.forEach((docSnap) => {
        docs.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Carregar lista consolidada de IDs deletados (localStorage + banco)
      let deletedIds = [];
      try {
        const delRaw = localStorage.getItem('clovis_horarios_deleted_ids');
        if (delRaw) deletedIds = JSON.parse(delRaw);
        if (!Array.isArray(deletedIds)) deletedIds = [];
      } catch (e) { deletedIds = []; }

      let customData = null;
      try {
        const customDocSnap = await getDoc(doc(db, 'config_escola', 'grade_horarios_custom'));
        if (customDocSnap && customDocSnap.exists()) {
          customData = customDocSnap.data();
          if (Array.isArray(customData?.deletedIds)) {
            deletedIds = Array.from(new Set([...deletedIds, ...customData.deletedIds]));
            try {
              localStorage.setItem('clovis_horarios_deleted_ids', JSON.stringify(deletedIds));
            } catch (e) {}
          }
        }
      } catch (cErr) {}

      if (docs.length > 0) {
        const docsFiltrados = docs.filter(d => !deletedIds.includes(d.id));
        setHorarios(docsFiltrados);
        window.gradeCache = docsFiltrados;
        try {
          localStorage.setItem('clovis_horarios_cache', JSON.stringify(docsFiltrados));
        } catch (e) {}
      } else if (!snapshot.metadata || snapshot.metadata.fromCache === false) {
        if (customData && (Array.isArray(customData.grade) || customData.initialized === true)) {
          const gradeSalva = (Array.isArray(customData.grade) ? customData.grade : []).filter(d => !deletedIds.includes(d.id));
          setHorarios(gradeSalva);
          window.gradeCache = gradeSalva;
          try {
            localStorage.setItem('clovis_horarios_cache', JSON.stringify(gradeSalva));
          } catch (e) {}
          setLoading(false);
          setIsRealtimeConnected(true);
          return;
        }

        // Fallback para cache local existente se houver
        const cachedLocal = localStorage.getItem('clovis_horarios_cache');
        if (cachedLocal) {
          try {
            const parsed = JSON.parse(cachedLocal);
            if (Array.isArray(parsed)) {
              const parsedFiltrados = parsed.filter(d => !deletedIds.includes(d.id));
              setHorarios(parsedFiltrados);
              window.gradeCache = parsedFiltrados;
              setLoading(false);
              setIsRealtimeConnected(true);
              return;
            }
          } catch (e) {}
        }

        // Se o banco estiver virgem (nunca inicializado), carrega grade inicial expurgando deletados
        const inis = GERAR_HORARIOS_INICIAIS().filter(d => !deletedIds.includes(d.id));
        setHorarios(inis);
        window.gradeCache = inis;
        try {
          localStorage.setItem('clovis_horarios_cache', JSON.stringify(inis));
        } catch (e) {}
      }
      setLoading(false);
      setIsRealtimeConnected(true);
      setErro(null);
    }, (error) => {
      console.warn('Aviso no listener em tempo real de horários:', error);
      setIsRealtimeConnected(false);
      setLoading(false);
      setErro('Conexão offline - Exibindo horários locais.');
    });

    // Cleanup: Desconecta o listener assim que o componente de Horários for fechado
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [anoGrade]);

  // Recarga manual da Grade Horária sob demanda
  const carregarGradeHorarios = useCallback(async (forceServer = false) => {
    setLoading(true);
    setErro(null);
    try {
      if (anoGrade === '2027') {
        const snap2027 = await getDoc(doc(db, 'config_escola', 'grade_horarios_2027'));
        if (snap2027.exists() && Array.isArray(snap2027.data()?.grade)) {
          const g27 = snap2027.data().grade;
          setHorarios(g27);
          localStorage.setItem('clovis_grade_horarios_2027', JSON.stringify(g27));
        }
        if (forceServer) notificar('Grade de planejamento 2027 atualizada do servidor!', 'success');
        setIsRealtimeConnected(true);
        return;
      }

      let deletedIds = [];
      try {
        const delRaw = localStorage.getItem('clovis_horarios_deleted_ids');
        if (delRaw) deletedIds = JSON.parse(delRaw);
        if (!Array.isArray(deletedIds)) deletedIds = [];
      } catch (e) {}

      const [snapshot, customSnap] = await Promise.all([
        getDocs(collection(db, 'horarios')),
        getDoc(doc(db, 'config_escola', 'grade_horarios_custom')).catch(() => null)
      ]);

      if (customSnap && customSnap.exists() && Array.isArray(customSnap.data()?.deletedIds)) {
        deletedIds = Array.from(new Set([...deletedIds, ...customSnap.data().deletedIds]));
      }

      const docs = [];
      snapshot.forEach((docSnap) => {
        if (!deletedIds.includes(docSnap.id)) {
          docs.push({ id: docSnap.id, ...docSnap.data() });
        }
      });

      if (docs.length > 0) {
        setHorarios(docs);
        window.gradeCache = docs;
        try {
          localStorage.setItem('clovis_horarios_cache', JSON.stringify(docs));
        } catch (e) {}
      } else if (customSnap && customSnap.exists() && (Array.isArray(customSnap.data()?.grade) || customSnap.data()?.initialized)) {
        const gSalva = (customSnap.data()?.grade || []).filter(d => !deletedIds.includes(d.id));
        setHorarios(gSalva);
        window.gradeCache = gSalva;
        localStorage.setItem('clovis_horarios_cache', JSON.stringify(gSalva));
      }

      if (forceServer) {
        notificar('Grade horária atualizada com sucesso do servidor!', 'success');
      }
      setIsRealtimeConnected(true);
    } catch (error) {
      console.warn('Erro ao recarregar grade do servidor:', error);
      setErro('Conexão offline - Exibindo horários salvos localmente.');
    } finally {
      setLoading(false);
    }
  }, [anoGrade, notificar]);

  useEffect(() => {
    window.carregarGradeHorarios = carregarGradeHorarios;
  }, [carregarGradeHorarios]);

  // Função Global de Filtragem 100% Offline (Sem novas queries ao Firestore)
  window.filtrarGradeHorarios = function(filtros = {}) {
    const base = window.gradeCache || horarios || [];
    return base.filter(item => {
      if (filtros.professor && !isSameProfessor(item.professor, filtros.professor)) return false;
      if (filtros.turma && item.turma !== filtros.turma) return false;
      if (filtros.sala && item.sala !== filtros.sala) return false;
      if (filtros.dia && normalizarDia(item.dia) !== normalizarDia(filtros.dia)) return false;
      if (filtros.termoBusca) {
        const busca = filtros.termoBusca.toLowerCase();
        const matchText = `${item.turma} ${item.professor} ${item.disciplina} ${item.sala}`.toLowerCase();
        if (!matchText.includes(busca)) return false;
      }
      return true;
    });
  };

  // Transmitir evento global de atualização de horários para o módulo de Substituição PEI
  useEffect(() => {
    if (typeof window !== 'undefined' && Array.isArray(horarios)) {
      window.dispatchEvent(new CustomEvent('clovis_horarios_updated', { detail: horarios }));
    }
  }, [horarios]);

  // Lista única de turmas, professores, salas e disciplinas para os seletores
  const listaTurmas = useMemo(() => {
    const setT = new Set(cadastrosCustom.turmas || []);
    horarios.forEach(h => h.turma && setT.add(h.turma));
    return Array.from(setT).sort();
  }, [cadastrosCustom.turmas, horarios]);

  const listaProfessores = useMemo(() => {
    const setP = new Set();
    (cadastroProfessores || []).forEach(p => p.nome && setP.add(p.nome));
    (cadastrosCustom.professores || []).forEach(p => setP.add(p));
    horarios.forEach(h => h.professor && setP.add(h.professor));
    return Array.from(setP).sort();
  }, [cadastroProfessores, cadastrosCustom.professores, horarios]);

  const salvarCadastroProfessores = async (novosProfs) => {
    const profsFormatados = novosProfs.map(p => ({
      ...p,
      area: normalizarArea(p.area || encontrarAreaDisciplina(p.disciplina))
    }));
    setCadastroProfessores(profsFormatados);
    localStorage.setItem('clovis_cadastro_professores', JSON.stringify(profsFormatados));

    // Manter sincronizado o array simples de nomes em cadastros_base
    const nomesNovos = profsFormatados.map(p => p.nome);
    const baseAtualizada = {
      ...cadastrosCustom,
      professores: Array.from(new Set([...(cadastrosCustom.professores || []), ...nomesNovos]))
    };
    setCadastrosCustom(baseAtualizada);

    try {
      await setDoc(doc(db, 'config_escola', 'cadastro_professores'), {
        professores: profsFormatados,
        atualizadoEm: new Date().toISOString()
      }, { merge: true });

      await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clovis_teachers_updated', { detail: profsFormatados }));
      }
    } catch (err) {
      console.error('Erro ao salvar cadastro_professores no Horarios:', err);
    }
  };

  const handleMigrarDocentesDoHorario = async (silencioso = false) => {
    if (!horarios || horarios.length === 0) {
      if (!silencioso) notificar('Nenhum horário cadastrado na grade oficial para migração.', 'warning');
      return;
    }

    const migrados = extrairEMigrarDocentesDoHorario(horarios, cadastroProfessores);
    await salvarCadastroProfessores(migrados);

    if (!silencioso) {
      notificar(`⚡ ${migrados.length} docentes migrados e sincronizados com sucesso da Grade Horária!`, 'success', 4000);
    }
  };

  const handleAdicionarDocenteCompleto = async (e) => {
    e.preventDefault();
    if (!novoDocenteForm.nome.trim()) return;
    const nome = novoDocenteForm.nome.trim();
    if (cadastroProfessores.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
      notificar(`O docente "${nome}" já está cadastrado.`, 'warning');
      return;
    }
    const novo = {
      nome,
      disciplina: novoDocenteForm.disciplina.trim() || 'Geral',
      area: novoDocenteForm.area || encontrarAreaDisciplina(novoDocenteForm.disciplina),
      tipo: novoDocenteForm.tipo || 'EFETIVO',
      turno: novoDocenteForm.turno || 'INTEGRAL',
      saldoAulas: Number(novoDocenteForm.saldoAulas || 0)
    };

    await salvarCadastroProfessores([...cadastroProfessores, novo]);
    setNovoDocenteForm({
      nome: '',
      disciplina: '',
      area: 'Exatas (EXA)',
      tipo: 'EFETIVO',
      turno: 'INTEGRAL',
      saldoAulas: 0
    });

    if (typeof window.showToast === 'function') {
      window.showToast(`Docente "${nome}" cadastrado com sucesso!`, 'success');
    }
  };

  const handleAlterarAreaDocenteInline = async (nomeProf, novaArea) => {
    const novosProfs = cadastroProfessores.map(p => {
      if (p.nome === nomeProf) return { ...p, area: novaArea };
      return p;
    });

    if (!novosProfs.some(p => p.nome === nomeProf)) {
      const pFound = cadastroProfessores.find(p => p.nome === nomeProf);
      novosProfs.push({
        nome: nomeProf,
        disciplina: pFound?.disciplina || 'Geral',
        area: novaArea,
        tipo: pFound?.tipo || 'EFETIVO',
        turno: pFound?.turno || 'INTEGRAL',
        saldoAulas: pFound?.saldoAulas || 0
      });
    }

    await salvarCadastroProfessores(novosProfs);
    if (typeof window.showToast === 'function') {
      window.showToast(`Área de Conhecimento do docente "${nomeProf}" alterada para ${novaArea}!`, 'success');
    }
  };

  const handleAlterarTurnoDocenteInline = async (nomeProf, novoTurno) => {
    const novosProfs = cadastroProfessores.map(p => {
      if (p.nome === nomeProf) return { ...p, turno: novoTurno };
      return p;
    });

    if (!novosProfs.some(p => p.nome === nomeProf)) {
      const pFound = cadastroProfessores.find(p => p.nome === nomeProf);
      novosProfs.push({
        nome: nomeProf,
        disciplina: pFound?.disciplina || 'Geral',
        area: pFound?.area || 'Exatas (EXA)',
        tipo: pFound?.tipo || 'EFETIVO',
        turno: novoTurno,
        saldoAulas: pFound?.saldoAulas || 0
      });
    }

    await salvarCadastroProfessores(novosProfs);
    if (typeof window.showToast === 'function') {
      window.showToast(`Jornada/Turno do docente "${nomeProf}" alterado para ${novoTurno}!`, 'success');
    }
  };

  const handleAlterarTipoDocenteInline = async (nomeProf, novoTipo) => {
    const novosProfs = cadastroProfessores.map(p => {
      if (p.nome === nomeProf) return { ...p, tipo: novoTipo };
      return p;
    });

    if (!novosProfs.some(p => p.nome === nomeProf)) {
      const pFound = cadastroProfessores.find(p => p.nome === nomeProf);
      novosProfs.push({
        nome: nomeProf,
        disciplina: pFound?.disciplina || 'Geral',
        area: pFound?.area || 'Exatas (EXA)',
        tipo: novoTipo,
        turno: pFound?.turno || 'INTEGRAL',
        saldoAulas: pFound?.saldoAulas || 0
      });
    }

    await salvarCadastroProfessores(novosProfs);
    if (typeof window.showToast === 'function') {
      window.showToast(`Cargo/Vínculo do docente "${nomeProf}" alterado para ${novoTipo}!`, 'success');
    }
  };

  const listaSalas = useMemo(() => {
    const setS = new Set(cadastrosCustom.salas || []);
    horarios.forEach(h => h.sala && setS.add(h.sala));
    return Array.from(setS).sort();
  }, [cadastrosCustom.salas, horarios]);

  // Horário Atual do Relógio para destaque de Aula em Andamento
  const [agoraInfo, setAgoraInfo] = useState({ diaId: '', periodoId: null });
  useEffect(() => {
    const checarAgora = () => {
      const now = new Date();
      const diaNum = now.getDay(); // 0 = Dom, 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex, 6 = Sáb
      const mapDias = ['', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', ''];
      const diaId = mapDias[diaNum] || '';

      const horas = now.getHours();
      const mins = now.getMinutes();
      const minTotal = horas * 60 + mins;

      let pId = null;
      if (minTotal >= 7*60 && minTotal < 7*60+50) pId = 1;
      else if (minTotal >= 7*60+50 && minTotal < 8*60+40) pId = 2;
      else if (minTotal >= 8*60+40 && minTotal < 8*60+50) pId = 'int1';
      else if (minTotal >= 8*60+50 && minTotal < 9*60+40) pId = 3;
      else if (minTotal >= 9*60+40 && minTotal < 10*60+30) pId = 4;
      else if (minTotal >= 10*60+30 && minTotal < 11*60+20) pId = 5;
      else if (minTotal >= 11*60+20 && minTotal < 12*60+20) pId = 'almoco';
      else if (minTotal >= 12*60+20 && minTotal < 13*60+10) pId = 6;
      else if (minTotal >= 13*60+10 && minTotal < 14*60+0) pId = 7;
      else if (minTotal >= 14*60+20 && minTotal < 15*60+10) pId = 8;
      else if (minTotal >= 15*60+10 && minTotal < 16*60+0) pId = 9;

      setAgoraInfo({ diaId, periodoId: pId });
    };

    checarAgora();
    const interval = setInterval(checarAgora, 30000);
    return () => clearInterval(interval);
  }, []);

  // Merge das alterações em tempo real (modo planilha) com os dados de estado
  const horariosEfetivos = useMemo(() => {
    if (!Array.isArray(horarios)) return [];
    return horarios.map((h) => {
      const draft = inlineDrafts[h.id];
      if (!draft) return h;
      return {
        ...h,
        professor: draft.professor !== undefined ? draft.professor : h.professor,
        disciplina: draft.disciplina !== undefined ? draft.disciplina : h.disciplina,
        turma: draft.turma !== undefined ? draft.turma : h.turma,
        sala: draft.sala !== undefined ? draft.sala : h.sala,
        observacao: '',
        contarSaldo: draft.contarSaldo !== undefined ? draft.contarSaldo : h.contarSaldo,
        ativo: draft.ativo !== undefined ? draft.ativo : h.ativo
      };
    });
  }, [horarios, inlineDrafts]);

  // Estatísticas e contadores de carga horária do Professor Selecionado
  // Realiza varredura por toda a matriz da grade horária e substituições acumuladas
  const estatisticasProfessor = useMemo(() => {
    if (!professorSelecionado) {
      return {
        aulasRegulares: 0,
        compromissosInativos: 0,
        totalAlocados: 0,
        creditosSubst: 0,
        debitosSubst: 0,
        saldoInicial: 0,
        saldoAcumulado: 0,
        saldoTotalEfetivo: 0
      };
    }

    let aulasRegulares = 0;
    let compromissosInativos = 0;
    let totalAlocados = 0;

    const slotsVistos = new Set();

    horariosEfetivos.forEach((h) => {
      if (!h || !h.professor || !isSameProfessor(h.professor, professorSelecionado)) return;

      if (!isRegularTeachingClass(h)) {
        compromissosInativos += 1;
        return;
      }

      const pOrder = getPeriodoOrder(h.periodoId);
      const diaClean = normalizarDia(h.dia);
      const slotKey = `${diaClean}_${pOrder}`;

      if (diaClean && pOrder !== 999) {
        if (slotsVistos.has(slotKey)) return;
        slotsVistos.add(slotKey);
      }

      aulasRegulares += 1;
      totalAlocados += 1;
    });

    const profObj = (cadastroProfessores || []).find(p => isSameProfessor(p.nome, professorSelecionado)) || {};
    const saldoInicial = Number(profObj.saldoAulas || profObj.saldoInicial || 0);

    let creditosSubst = 0;
    let debitosSubst = 0;
    const subsProcessadas = new Set();

    (substituicoes || []).forEach(s => {
      if (!s) return;
      const st = String(s.status || 'CONFIRMADA').toUpperCase().trim();
      const isStatusOk = st === 'CONFIRMADA' || st === 'APROVADA' || st === 'REALIZADA' || st === 'CONCLUIDA' || st === 'OK';
      if (isStatusOk && isRegularTeachingClass(s.disciplina)) {
        const subKey = s.id || `${s.data}_${s.periodoId}_${s.turma}_${s.professorAusente}_${s.professorSubstituto}`;
        if (subsProcessadas.has(subKey)) return;
        subsProcessadas.add(subKey);

        if (s.professorSubstituto && isSameProfessor(s.professorSubstituto, professorSelecionado)) {
          creditosSubst += 1;
        }
        if (s.professorAusente && isSameProfessor(s.professorAusente, professorSelecionado)) {
          debitosSubst += 1;
        }
      }
    });

    const saldoAcumulado = saldoInicial + creditosSubst - debitosSubst;
    const saldoTotalEfetivo = aulasRegulares + saldoAcumulado;

    return {
      aulasRegulares,
      compromissosInativos,
      totalAlocados,
      creditosSubst,
      debitosSubst,
      saldoInicial,
      saldoAcumulado,
      saldoTotalEfetivo
    };
  }, [horariosEfetivos, professorSelecionado, cadastroProfessores, substituicoes]);

  // Filtragem de horários para renderização
  const horariosFiltrados = useMemo(() => {
    return horariosEfetivos.filter((item) => {
      if (termoBusca) {
        const busca = termoBusca.toLowerCase();
        const matchText = `${item.turma} ${item.professor} ${item.disciplina} ${item.sala}`.toLowerCase();
        if (!matchText.includes(busca)) return false;
      }

      if (modoVisao === 'por_turma') {
        return item.turma === turmaSelecionada;
      }
      if (modoVisao === 'por_professor') {
        return isSameProfessor(item.professor, professorSelecionado);
      }
      if (modoVisao === 'por_sala') {
        return item.sala === salaSelecionada;
      }
      return true; // matriz_geral
    });
  }, [horariosEfetivos, modoVisao, turmaSelecionada, professorSelecionado, salaSelecionada, termoBusca]);

  // Detecção de segmento (Ensino Médio vs Ensino Fundamental) para filtro por turma
  const isEnsinoMedio = useMemo(() => {
    if (!turmaSelecionada) return false;
    const tUpper = turmaSelecionada.toUpperCase().trim();
    if (tUpper.includes('6º') || tUpper.includes('7º') || tUpper.includes('8º') || tUpper.includes('9º') || tUpper.includes('FUNDAMENTAL') || tUpper.includes('EF')) {
      return false;
    }
    if (tUpper.includes('MÉDIO') || tUpper.includes('MEDIO') || tUpper.includes('EM') || tUpper.includes('SÉRIE') || tUpper.includes('SERIE')) {
      return true;
    }
    return /^[123][ªºa-z\s\-]/i.test(tUpper) || tUpper.startsWith('1') || tUpper.startsWith('2') || tUpper.startsWith('3');
  }, [turmaSelecionada]);

  const isEnsinoFundamental = useMemo(() => {
    if (!turmaSelecionada) return false;
    const tUpper = turmaSelecionada.toUpperCase().trim();
    if (tUpper.includes('FUNDAMENTAL') || tUpper.includes('EF') || tUpper.includes('ANO')) {
      if (!tUpper.includes('MÉDIO') && !tUpper.includes('MEDIO') && !tUpper.includes('EM')) return true;
    }
    return /^[6789][ªºa-z\s\-]/i.test(tUpper) || tUpper.startsWith('6') || tUpper.startsWith('7') || tUpper.startsWith('8') || tUpper.startsWith('9');
  }, [turmaSelecionada]);

  // Períodos de aula a serem exibidos na tabela (considerando segmento e disponibilidade do docente)
  const periodosToRender = useMemo(() => {
    if (!periodosAula || periodosAula.length === 0) return [];

    // Modo Por Turma: Suprimir turnos sem aula (Manhã/Noturno para Ensino Médio, Tarde/Noturno para Fundamental)
    if (modoVisao === 'por_turma') {
      if (!suprimirTurnosOutros) return periodosAula;

      return periodosAula.filter((periodo) => {
        const pOrder = getPeriodoOrder(periodo.id);
        const isMorning = pOrder <= 7; // 1ª à 7ª aula + int1 + almoço
        const isAfternoon = pOrder >= 8 && pOrder <= 12; // 8ª à 12ª aula + int2
        const isNight = pOrder > 12; // Jantar + 13ª + 14ª aula

        // Se houver aula agendada nesta turma neste período, NUNCA ocultar (preserva dados)
        const temAulaAgendada = horariosFiltrados.some(
          (h) => getPeriodoOrder(h.periodoId) === pOrder
        );
        if (temAulaAgendada) return true;

        if (isEnsinoMedio && (isMorning || isNight)) {
          return false; // Suprime horários da manhã e noite para Ensino Médio vespertino
        }
        if (isEnsinoFundamental && (isAfternoon || isNight)) {
          return false; // Suprime horários da tarde e noite para Ensino Fundamental matutino
        }

        return true;
      });
    }

    // Modo Por Professor: Observe Indisponibilidade Docente e horário na escola
    if (modoVisao === 'por_professor') {
      if (!apenasHorariosNaEscola || !professorSelecionado) return periodosAula;

      return periodosAula.filter((periodo) => {
        const pOrder = getPeriodoOrder(periodo.id);

        // Se o professor tem alguma aula agendada neste período na grade, mantém visível
        const isIntervalo = periodo.tipo === 'intervalo';
        const temAulaAgendada = horariosFiltrados.some((h) => {
          if (isIntervalo) {
            return String(h.periodoId).toLowerCase().trim() === String(periodo.id).toLowerCase().trim();
          }
          const hPStr = String(h.periodoId).toLowerCase().trim();
          if (hPStr.startsWith('int') || hPStr.includes('almoco') || hPStr.includes('almoço') || hPStr.includes('jantar')) {
            return false;
          }
          return getPeriodoOrder(h.periodoId) === pOrder;
        });
        if (temAulaAgendada) return true;

        // Verifica se o professor está presente na escola em QUALQUER dia da semana neste período
        const estaPresenteEmAlgumDia = DIAS_SEMANA.some((dia) => {
          const st = isTeacherAtSchool(
            professorSelecionado,
            dia.id,
            periodo.id,
            indisponibilidadeProfs,
            horariosEfetivos,
            cadastroProfessores
          );
          return st.atSchool;
        });

        return estaPresenteEmAlgumDia;
      });
    }

    return periodosAula;
  }, [
    periodosAula,
    modoVisao,
    suprimirTurnosOutros,
    isEnsinoMedio,
    isEnsinoFundamental,
    horariosFiltrados,
    apenasHorariosNaEscola,
    professorSelecionado,
    indisponibilidadeProfs,
    horariosEfetivos,
    cadastroProfessores
  ]);

  // Lógica de Ordenação do Dia da Semana e Aula Atual / Próxima para a Visualização Mobile
  const diaHojeId = useMemo(() => {
    const now = new Date();
    const diaNum = now.getDay(); // 0 = Dom, 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex, 6 = Sáb
    const mapDias = { 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta' };
    return mapDias[diaNum] || 'segunda'; // Se for fim de semana (0 ou 6), considera Segunda-feira
  }, [agoraInfo.diaId]);

  const diasOrdenadosMobile = useMemo(() => {
    const indexHoje = DIAS_SEMANA.findIndex(d => d.id === diaHojeId);
    const startIdx = indexHoje >= 0 ? indexHoje : 0;
    return [...DIAS_SEMANA.slice(startIdx), ...DIAS_SEMANA.slice(0, startIdx)];
  }, [diaHojeId]);

  const [diasExpandidosMobile, setDiasExpandidosMobile] = useState(() => ({
    [diaHojeId]: true
  }));

  useEffect(() => {
    setDiasExpandidosMobile(prev => ({
      ...prev,
      [diaHojeId]: prev[diaHojeId] !== undefined ? prev[diaHojeId] : true
    }));
  }, [diaHojeId]);

  const toggleDiaMobile = (diaId) => {
    setDiasExpandidosMobile(prev => ({
      ...prev,
      [diaId]: !prev[diaId]
    }));
  };

  const infoAulaAtualMobile = useMemo(() => {
    const now = new Date();
    const minsAtuais = now.getHours() * 60 + now.getMinutes();

    let periodoAtualId = null;
    let proximoPeriodoId = null;

    const periodosComHorario = (periodosToRender || []).map(p => {
      const partes = (p.horario || '').split('-').map(s => s.trim());
      let inicio = 0;
      let fim = 0;
      if (partes.length === 2) {
        const [h1, m1] = partes[0].split(':').map(Number);
        const [h2, m2] = partes[1].split(':').map(Number);
        inicio = (h1 || 0) * 60 + (m1 || 0);
        fim = (h2 || 0) * 60 + (m2 || 0);
      }
      return { ...p, inicio, fim };
    });

    const atual = periodosComHorario.find(p => minsAtuais >= p.inicio && minsAtuais < p.fim);
    if (atual) {
      periodoAtualId = atual.id;
    }

    const proximo = periodosComHorario.find(p => p.inicio > minsAtuais);
    if (proximo) {
      proximoPeriodoId = proximo.id;
    }

    return { periodoAtualId, proximoPeriodoId, minsAtuais };
  }, [periodosToRender, agoraInfo]);

  // Função para abrir modal de criação/edição
  const handleAbrirModalNovo = (dia = 'segunda', periodoId = 1) => {
    setItemEdicao(null);
    const safePeriodoId = isNaN(Number(periodoId)) ? periodoId : Number(periodoId);
    setForm({
      dia,
      periodoId: safePeriodoId,
      turma: turmaSelecionada || '6º Ano A',
      professor: professorSelecionado || 'Profª Maria Silva',
      disciplina: 'Tutoria',
      sala: salaSelecionada || 'Sala 01 (6ºA)',
      observacao: '',
      contarSaldo: true
    });
    setIsModalOpen(true);
  };

  const handleAbrirModalEdicao = (item) => {
    setItemEdicao(item);
    const safePeriodoId = isNaN(Number(item.periodoId)) ? item.periodoId : Number(item.periodoId);
    setForm({
      dia: item.dia || 'segunda',
      periodoId: safePeriodoId,
      turma: item.turma || '6º Ano A',
      professor: item.professor || 'Profª Maria Silva',
      disciplina: item.disciplina || 'Língua Portuguesa',
      sala: item.sala || 'Sala 01 (6ºA)',
      observacao: '',
      contarSaldo: item.contarSaldo !== false && item.ativo !== false
    });
    setIsModalOpen(true);
  };

  // Salvar no Banco de Dados / Cache
  const handleSalvarHorario = async (e) => {
    e.preventDefault();
    if (!podeEditar) {
      notificar('Acesso negado: Apenas a Direção e Coordenação CGPG possuem autorização para alterar a grade horária.', 'warning');
      return;
    }
    setSalvando(true);

    try {
      const userAtivo = obterUsuarioAtivoCompleto();
      const safePeriodoId = isNaN(Number(form.periodoId)) ? form.periodoId : Number(form.periodoId);
      const payload = {
        dia: form.dia,
        periodoId: safePeriodoId,
        turma: form.turma.trim(),
        professor: form.professor.trim(),
        disciplina: form.disciplina.trim(),
        sala: form.sala.trim(),
        observacao: '',
        contarSaldo: form.contarSaldo !== false,
        anoLetivo: anoGrade,
        atualizadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };

      let savedId = itemEdicao?.id || `local-${Date.now()}`;

      if (anoGrade === '2026') {
        if (itemEdicao?.id && !String(itemEdicao.id).startsWith('init-') && !String(itemEdicao.id).startsWith('local-')) {
          const docRef = doc(db, 'horarios', itemEdicao.id);
          await updateDoc(docRef, payload);
          const auditPayload = {
            modulo: 'Grade Horária',
            acao: 'ATUALIZAR',
            descricao: `Atualizada aula de ${payload.disciplina} (${payload.turma}) - ${payload.professor} (${payload.dia}, ${payload.periodoId}ª aula, sala ${payload.sala || 'Padrão'})`,
            detalhes: { id: itemEdicao.id, payload }
          };
          if (typeof window.registrarLogAuditoria === 'function') {
            window.registrarLogAuditoria(auditPayload);
          } else {
            registrarLogAuditoria(auditPayload);
          }
        } else {
          const docRef = await addDoc(collection(db, 'horarios'), payload);
          savedId = docRef.id;
          const auditPayload = {
            modulo: 'Grade Horária',
            acao: 'CRIAR',
            descricao: `Criada nova aula de ${payload.disciplina} (${payload.turma}) - ${payload.professor} (${payload.dia}, ${payload.periodoId}ª aula, sala ${payload.sala || 'Padrão'})`,
            detalhes: { id: savedId, payload }
          };
          if (typeof window.registrarLogAuditoria === 'function') {
            window.registrarLogAuditoria(auditPayload);
          } else {
            registrarLogAuditoria(auditPayload);
          }
        }
      } else {
        savedId = itemEdicao?.id || `2027_${Date.now()}`;
      }

      const novosHorarios = itemEdicao
        ? horarios.map(h => (h.id === itemEdicao.id ? { ...h, ...payload, id: savedId } : h))
        : [...horarios, { id: savedId, ...payload }];

      await persistirGradeAtual(novosHorarios);
      notificar(`Horário (${anoGrade}) salvo com sucesso!`, 'success');
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar horário:', error);
      notificar('Erro ao salvar horário no banco. Alteração gravada no cache local.', 'warning');
      setIsModalOpen(false);
    } finally {
      setSalvando(false);
    }
  };

  // Execução efetiva da exclusão de uma aula
  const executarExclusaoHorario = async (id) => {
    try {
      const aulaRemovida = horarios.find(h => h.id === id);

      if (anoGrade === '2026' && id) {
        try {
          await deleteDoc(doc(db, 'horarios', id));
        } catch (delErr) {
          console.warn('Aviso ao deletar doc em horarios:', delErr);
        }
      }

      const auditPayloadExcluir = {
        modulo: `Grade Horária ${anoGrade}`,
        acao: 'EXCLUIR',
        descricao: `Removida aula ${aulaRemovida ? `${aulaRemovida.disciplina} (${aulaRemovida.turma})` : ''} ID #${id} da grade ${anoGrade}.`,
        detalhes: { id, aulaRemovida, anoGrade }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadExcluir);
      } else {
        registrarLogAuditoria(auditPayloadExcluir);
      }

      const novos = horarios.filter(h => h.id !== id);
      await persistirGradeAtual(novos, [id]);
      notificar('Aula removida com sucesso.', 'success');
    } catch (error) {
      console.error('Erro ao excluir:', error);
      const novos = horarios.filter(h => h.id !== id);
      await persistirGradeAtual(novos, [id]);
      notificar('Aula removida da grade.', 'info');
    }
  };

  // Excluir Horário (com confirmação in-app segura para iframe)
  const handleExcluirHorario = (id) => {
    const roleCurrent = typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() : userRole;
    if (!podeExcluir(roleCurrent) && !podeEditar) {
      notificar('Acesso negado: Apenas a Direção Escolar (Diretor, Vice-Diretor e Coordenação CGPG) possui autorização para excluir aulas da grade.', 'warning');
      return;
    }
    const aula = horarios.find(h => h.id === id);
    const resumo = aula ? `${aula.disciplina} (${aula.turma} • ${aula.professor})` : `ID #${id}`;
    abrirConfirmacao({
      title: 'Excluir Aula da Grade',
      message: `Deseja remover permanentemente esta aula da grade ${anoGrade}?\n\n• ${resumo}`,
      confirmLabel: 'Sim, Excluir Aula',
      variant: 'danger',
      onConfirm: () => executarExclusaoHorario(id)
    });
  };

  // Duplicar Aula Instantaneamente para Célula Específica ou Célula Atual
  const handleDuplicarHorario = async (aula, targetDia = null, targetPeriodoId = null) => {
    if (!podeEditar) {
      notificar('Acesso negado: Você não possui permissão para editar ou duplicar a grade horária.', 'warning');
      return;
    }
    setSalvando(true);
    try {
      const destDia = targetDia || aula.dia || 'segunda';
      const destPeriodoId = (targetPeriodoId !== null && targetPeriodoId !== undefined)
        ? (isNaN(Number(targetPeriodoId)) ? targetPeriodoId : Number(targetPeriodoId))
        : (isNaN(Number(aula.periodoId)) ? aula.periodoId : Number(aula.periodoId));

      const userAtivo = obterUsuarioAtivoCompleto();
      const payload = {
        dia: destDia,
        periodoId: destPeriodoId,
        turma: (aula.turma || '').trim(),
        professor: (aula.professor || '').trim(),
        disciplina: (aula.disciplina || '').trim(),
        sala: (aula.sala || '').trim(),
        observacao: '',
        contarSaldo: aula.contarSaldo !== false && aula.ativo !== false,
        anoLetivo: anoGrade,
        atualizadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };

      let newId = `${anoGrade}_local-${Date.now()}`;
      if (anoGrade === '2026') {
        try {
          const docRef = await addDoc(collection(db, 'horarios'), payload);
          newId = docRef.id;
        } catch (e) {
          console.warn('Erro ao salvar cópia no banco, mantendo em snapshot:', e);
        }
      }

      const auditPayloadDuplicar = {
        modulo: `Grade Horária ${anoGrade}`,
        acao: 'CRIAR',
        descricao: `Duplicada aula de ${payload.disciplina} (${payload.turma}) para ${destDia}, ${destPeriodoId}ª aula`,
        detalhes: { newId, payload, idOriginal: aula.id }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadDuplicar);
      } else {
        registrarLogAuditoria(auditPayloadDuplicar);
      }

      const novocopy = { id: newId, ...payload };
      await persistirGradeAtual([...horarios, novocopy]);

      const diaLabel = DIAS_SEMANA.find(d => d.id === destDia)?.label || destDia;
      notificar(`Aula de ${payload.disciplina} duplicada com sucesso para ${diaLabel}!`, 'success');
    } catch (error) {
      console.error('Erro ao duplicar horário:', error);
    } finally {
      setSalvando(false);
    }
  };

  // Handlers para o Painel de Auditoria e Gestão de Aulas Atribuídas (Exclusivo Diretor)
  const handleIniciarEdicaoAuditoria = (aula) => {
    setAulaEmEdicaoAuditoria(aula);
    setIsCriandoNovaAulaAuditoria(false);
    setFormAuditoria({
      dia: aula.dia || 'segunda',
      periodoId: aula.periodoId || 1,
      turma: aula.turma || (listaTurmas[0] || '6º Ano A'),
      professor: aula.professor || (listaProfessores[0] || 'Profª Maria Silva'),
      disciplina: aula.disciplina || 'Língua Portuguesa',
      sala: aula.sala || (listaSalas[0] || 'Sala 01'),
      contarSaldo: aula.contarSaldo !== false && aula.ativo !== false
    });
  };

  const handleIniciarCriacaoAuditoria = () => {
    setAulaEmEdicaoAuditoria(null);
    setIsCriandoNovaAulaAuditoria(true);
    setFormAuditoria({
      dia: auditoriaFiltroDia !== 'TODOS' ? auditoriaFiltroDia : 'segunda',
      periodoId: 1,
      turma: auditoriaFiltroTurma !== 'TODAS' ? auditoriaFiltroTurma : (listaTurmas[0] || '6º Ano A'),
      professor: auditoriaFiltroProfessor !== 'TODOS' ? auditoriaFiltroProfessor : (listaProfessores[0] || 'Profª Maria Silva'),
      disciplina: 'Língua Portuguesa',
      sala: listaSalas[0] || 'Sala 01',
      contarSaldo: true
    });
  };

  const handleSalvarEdicaoAuditoria = async (e) => {
    e.preventDefault();
    if (!isDiretor && !podeEditar) {
      notificar('Acesso negado: Apenas a Direção Escolar possui autorização para auditar ou alterar a grade.', 'warning');
      return;
    }
    setSalvando(true);

    try {
      const userAtivo = obterUsuarioAtivoCompleto();
      const safePeriodoId = isNaN(Number(formAuditoria.periodoId)) ? formAuditoria.periodoId : Number(formAuditoria.periodoId);
      const payload = {
        dia: formAuditoria.dia,
        periodoId: safePeriodoId,
        turma: formAuditoria.turma.trim(),
        professor: formAuditoria.professor.trim(),
        disciplina: formAuditoria.disciplina.trim(),
        sala: formAuditoria.sala.trim(),
        observacao: '',
        contarSaldo: formAuditoria.contarSaldo !== false,
        anoLetivo: anoGrade,
        atualizadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };

      if (isCriandoNovaAulaAuditoria || !aulaEmEdicaoAuditoria?.id || String(aulaEmEdicaoAuditoria.id).startsWith('init-')) {
        let novoId = `${anoGrade}_${Date.now()}`;
        if (anoGrade === '2026') {
          const docRef = await addDoc(collection(db, 'horarios'), payload);
          novoId = docRef.id;
        }
        const auditPayload = {
          modulo: `Grade Horária ${anoGrade}`,
          acao: 'AUDITORIA_DIRETOR_CRIAR',
          descricao: `Diretor atribuiu nova aula: ${payload.disciplina} (${payload.turma}) para ${payload.professor} (${payload.dia}, ${payload.periodoId}ª aula, sala ${payload.sala || 'Padrão'})`,
          detalhes: { id: novoId, payload }
        };
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria(auditPayload);
        } else {
          registrarLogAuditoria(auditPayload);
        }

        const baseSemAntigaInit = (!isCriandoNovaAulaAuditoria && aulaEmEdicaoAuditoria?.id)
          ? horarios.filter(h => h.id !== aulaEmEdicaoAuditoria.id)
          : horarios;
        await persistirGradeAtual([...baseSemAntigaInit, { id: novoId, ...payload }]);
      } else {
        if (anoGrade === '2026') {
          const docRef = doc(db, 'horarios', aulaEmEdicaoAuditoria.id);
          await updateDoc(docRef, payload);
        }
        const auditPayload = {
          modulo: `Grade Horária ${anoGrade}`,
          acao: 'AUDITORIA_DIRETOR_EDITAR',
          descricao: `Diretor alterou aula atribuída: ${payload.disciplina} (${payload.turma}) - Prof. ${payload.professor} (${payload.dia}, ${payload.periodoId}ª aula, sala ${payload.sala || 'Padrão'})`,
          detalhes: { id: aulaEmEdicaoAuditoria.id, payload, anterior: aulaEmEdicaoAuditoria }
        };
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria(auditPayload);
        } else {
          registrarLogAuditoria(auditPayload);
        }

        const novosHorarios = horarios.map(h => h.id === aulaEmEdicaoAuditoria.id ? { ...h, ...payload } : h);
        await persistirGradeAtual(novosHorarios);
      }

      notificar('Aula atribuída salva com sucesso na auditoria!', 'success');
      setAulaEmEdicaoAuditoria(null);
      setIsCriandoNovaAulaAuditoria(false);
    } catch (err) {
      console.error('Erro ao salvar na auditoria:', err);
      notificar('Erro ao salvar aula no banco. Alteração salva localmente.', 'warning');
      setAulaEmEdicaoAuditoria(null);
      setIsCriandoNovaAulaAuditoria(false);
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluirAulaAuditoria = (aula) => {
    const roleCurrent = typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() : userRole;
    if (!podeExcluir(roleCurrent) && !podeEditar) {
      notificar('Acesso negado: Apenas a Direção Escolar e Coordenação possuem autorização para excluir aulas da grade.', 'warning');
      return;
    }

    const rotuloP = getPeriodoRotulo(aula.periodoId);
    abrirConfirmacao({
      title: 'Auditoria da Direção — Excluir Aula',
      message: `Confirma a EXCLUSÃO desta aula atribuída na grade ${anoGrade}?\n\n• Professor: ${aula.professor}\n• Turma: ${aula.turma}\n• Disciplina: ${aula.disciplina}\n• Dia: ${String(aula.dia || '').toUpperCase()} (${rotuloP})\n• Sala: ${aula.sala || 'Padrão'}`,
      confirmLabel: 'Confirmar Exclusão',
      variant: 'danger',
      onConfirm: async () => {
        try {
          if (anoGrade === '2026' && aula.id) {
            try { await deleteDoc(doc(db, 'horarios', aula.id)); } catch (e) {}
          }

          const auditPayload = {
            modulo: `Grade Horária ${anoGrade}`,
            acao: 'AUDITORIA_DIRETOR_EXCLUIR',
            descricao: `Diretor excluiu aula atribuída de ${aula.professor} - ${aula.disciplina} (${aula.turma}) em ${aula.dia}, ${rotuloP}`,
            detalhes: { id: aula.id, aula }
          };

          if (typeof window.registrarLogAuditoria === 'function') {
            window.registrarLogAuditoria(auditPayload);
          } else {
            registrarLogAuditoria(auditPayload);
          }

          const novosHorarios = horarios.filter(h => h.id !== aula.id);
          await persistirGradeAtual(novosHorarios, [aula.id]);
          notificar(`Aula de ${aula.disciplina} (${aula.professor}) removida da grade.`, 'success');
        } catch (err) {
          console.error('Erro ao excluir aula na auditoria:', err);
          const novosHorarios = horarios.filter(h => h.id !== aula.id);
          await persistirGradeAtual(novosHorarios, [aula.id]);
        }
      }
    });
  };

  // Filtragem e Gestão Completa de Dados da Grade PEI no Modal de Administração
  const aulasFiltradasGradeAdmin = useMemo(() => {
    return (horarios || []).filter(h => {
      if (filtroGradeAdminDia !== 'TODOS' && h.dia !== filtroGradeAdminDia) return false;
      if (filtroGradeAdminTurma !== 'TODAS' && h.turma !== filtroGradeAdminTurma) return false;
      if (filtroGradeAdminProf !== 'TODOS' && !isSameProfessor(h.professor, filtroGradeAdminProf)) return false;
      if (filtroGradeAdminBusca && filtroGradeAdminBusca.trim()) {
        const q = String(filtroGradeAdminBusca).toLowerCase().trim();
        const matchProf = String(h.professor || '').toLowerCase().includes(q);
        const matchTurma = String(h.turma || '').toLowerCase().includes(q);
        const matchDisc = String(h.disciplina || '').toLowerCase().includes(q);
        const matchSala = String(h.sala || '').toLowerCase().includes(q);
        if (!matchProf && !matchTurma && !matchDisc && !matchSala) return false;
      }
      return true;
    }).sort((a, b) => {
      const diasOrdem = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
      const dA = diasOrdem[a.dia] || 99;
      const dB = diasOrdem[b.dia] || 99;
      if (dA !== dB) return dA - dB;
      return (Number(a.periodoId) || 0) - (Number(b.periodoId) || 0);
    });
  }, [horarios, filtroGradeAdminDia, filtroGradeAdminTurma, filtroGradeAdminProf, filtroGradeAdminBusca]);

  const handleIniciarEdicaoAulaGradeAdmin = (aula) => {
    setAulaEmEdicaoGradeAdmin(aula);
    setIsCriandoAulaGradeAdmin(false);
    setFormEdicaoGradeAdmin({
      id: aula.id || '',
      dia: aula.dia || 'segunda',
      periodoId: aula.periodoId || 1,
      turma: aula.turma || '',
      professor: aula.professor || '',
      disciplina: aula.disciplina || '',
      sala: aula.sala || ''
    });
  };

  const handleIniciarCriacaoAulaGradeAdmin = () => {
    setAulaEmEdicaoGradeAdmin(null);
    setIsCriandoAulaGradeAdmin(true);
    setFormEdicaoGradeAdmin({
      id: '',
      dia: filtroGradeAdminDia !== 'TODOS' ? filtroGradeAdminDia : 'segunda',
      periodoId: 1,
      turma: filtroGradeAdminTurma !== 'TODAS' ? filtroGradeAdminTurma : (listaTurmas[0] || ''),
      professor: filtroGradeAdminProf !== 'TODOS' ? filtroGradeAdminProf : (listaProfessores[0] || ''),
      disciplina: 'Língua Portuguesa',
      sala: listaSalas[0] || 'Sala 01'
    });
  };

  const handleSalvarAulaGradeAdmin = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formEdicaoGradeAdmin.turma || !formEdicaoGradeAdmin.professor || !formEdicaoGradeAdmin.disciplina) {
      notificar('Preencha Turma, Professor e Disciplina para salvar.', 'warning');
      return;
    }

    setSalvando(true);
    try {
      const userAtivo = obterUsuarioAtivoCompleto();
      const safePeriodoId = isNaN(Number(formEdicaoGradeAdmin.periodoId)) ? formEdicaoGradeAdmin.periodoId : Number(formEdicaoGradeAdmin.periodoId);
      const payload = {
        dia: formEdicaoGradeAdmin.dia,
        periodoId: safePeriodoId,
        turma: formEdicaoGradeAdmin.turma.trim(),
        professor: formEdicaoGradeAdmin.professor.trim(),
        disciplina: formEdicaoGradeAdmin.disciplina.trim(),
        sala: (formEdicaoGradeAdmin.sala || '').trim(),
        observacao: '',
        contarSaldo: true,
        anoLetivo: anoGrade,
        atualizadoEm: new Date().toISOString(),
        editadoPorNome: userAtivo.nome,
        editadoPorEmail: userAtivo.email,
        editadoPorCargo: userAtivo.cargo,
        editadoEm: new Date().toISOString()
      };

      if (isCriandoAulaGradeAdmin || !aulaEmEdicaoGradeAdmin?.id || String(aulaEmEdicaoGradeAdmin.id).startsWith('init-')) {
        let novoId = `${anoGrade}_${Date.now()}`;
        if (anoGrade === '2026') {
          const docRef = await addDoc(collection(db, 'horarios'), payload);
          novoId = docRef.id;
        }
        const baseSemInit = (!isCriandoAulaGradeAdmin && aulaEmEdicaoGradeAdmin?.id)
          ? horarios.filter(h => h.id !== aulaEmEdicaoGradeAdmin.id)
          : horarios;
        await persistirGradeAtual([...baseSemInit, { id: novoId, ...payload }]);
        notificar('Nova aula inserida com sucesso na Grade PEI!', 'success');
      } else {
        if (anoGrade === '2026') {
          const docRef = doc(db, 'horarios', aulaEmEdicaoGradeAdmin.id);
          await updateDoc(docRef, payload);
        }
        const novosHorarios = horarios.map(h => h.id === aulaEmEdicaoGradeAdmin.id ? { ...h, ...payload } : h);
        await persistirGradeAtual(novosHorarios);
        notificar('Aula atualizada com sucesso na Grade PEI!', 'success');
      }

      setAulaEmEdicaoGradeAdmin(null);
      setIsCriandoAulaGradeAdmin(false);
    } catch (err) {
      console.error('Erro ao salvar aula na grade admin:', err);
      notificar('Erro ao salvar no banco. Alteração gravada localmente.', 'warning');
      setAulaEmEdicaoGradeAdmin(null);
      setIsCriandoAulaGradeAdmin(false);
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluirAulaGradeAdmin = (aula) => {
    const roleCurrent = typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() : userRole;
    if (!podeExcluir(roleCurrent) && !podeEditar) {
      notificar('Acesso negado: Você não possui autorização para excluir aulas da grade.', 'warning');
      return;
    }

    abrirConfirmacao({
      title: 'Excluir Aula da Grade',
      message: `Confirma a exclusão da aula de ${aula.disciplina} (${aula.turma} - ${aula.professor}) na grade ${anoGrade}?`,
      confirmLabel: 'Excluir Aula',
      variant: 'danger',
      onConfirm: async () => {
        try {
          if (anoGrade === '2026' && aula.id) {
            try { await deleteDoc(doc(db, 'horarios', aula.id)); } catch (e) {}
          }
          const novosHorarios = horarios.filter(h => h.id !== aula.id);
          await persistirGradeAtual(novosHorarios, [aula.id]);
          notificar('Aula removida da Grade PEI.', 'success');
        } catch (err) {
          console.error('Erro ao excluir aula na grade admin:', err);
          const novosHorarios = horarios.filter(h => h.id !== aula.id);
          await persistirGradeAtual(novosHorarios, [aula.id]);
        }
      }
    });
  };

  // Exclusivo Diretor: Limpar toda a grade de aulas de um determinado professor
  const handleLimparGradeProfessorDiretor = (profNome) => {
    const roleCurrent = typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() : userRole;
    const ehDiretorReal = roleCurrent === 'DIRETOR' || isDiretor || podeEditar;
    if (!ehDiretorReal) {
      notificar('Acesso restrito: Apenas a Direção Escolar tem autorização para limpar a grade completa de um professor.', 'error');
      return;
    }

    const aulasDoProf = (horarios || []).filter(h => isSameProfessor(h.professor, profNome));
    if (aulasDoProf.length === 0) {
      notificar(`Não há aulas atribuídas para ${profNome} na grade.`, 'info');
      return;
    }

    abrirConfirmacao({
      title: 'Limpar Toda a Grade do Professor',
      message: `Confirma a EXCLUSÃO PERMANENTE de TODAS as ${aulasDoProf.length} aulas atribuídas a "${profNome}" na grade ${anoGrade}?\n\nEsta ação limpará a grade deste professor e registrará o log oficial de auditoria.`,
      confirmLabel: `Excluir ${aulasDoProf.length} Aulas`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          setSalvando(true);
          const idsRemovidos = aulasDoProf.map(a => a.id).filter(Boolean);

          if (anoGrade === '2026') {
            const batch = writeBatch(db);
            idsRemovidos.forEach((aId) => {
              batch.delete(doc(db, 'horarios', aId));
            });
            await batch.commit().catch(() => {});
          }

          const auditPayload = {
            modulo: `Grade Horária ${anoGrade}`,
            acao: 'AUDITORIA_DIRETOR_LIMPAR_GRADE_DOCENTE',
            descricao: `Diretor limpou toda a grade do professor ${profNome} (${aulasDoProf.length} aulas excluídas).`,
            detalhes: { professor: profNome, totalAulasRemovidas: aulasDoProf.length, aulas: aulasDoProf }
          };

          if (typeof window.registrarLogAuditoria === 'function') {
            window.registrarLogAuditoria(auditPayload);
          } else {
            registrarLogAuditoria(auditPayload);
          }

          const novosHorarios = horarios.filter(h => !isSameProfessor(h.professor, profNome));
          await persistirGradeAtual(novosHorarios, idsRemovidos);
          notificar(`Grade de ${profNome} limpa com sucesso (${aulasDoProf.length} aulas excluídas).`, 'success');
        } catch (err) {
          console.error('Erro ao limpar grade do professor:', err);
          const novosHorarios = horarios.filter(h => !isSameProfessor(h.professor, profNome));
          await persistirGradeAtual(novosHorarios, aulasDoProf.map(a => a.id));
          notificar(`Grade de ${profNome} limpa localmente.`, 'warning');
        } finally {
          setSalvando(false);
        }
      }
    });
  };

  // Lista ordenada de todas as aulas do professor atualmente selecionado
  const aulasDoProfessorOrdenadas = useMemo(() => {
    if (!professorSelecionado || !Array.isArray(horarios)) return [];
    const filtradas = horarios.filter(h => isSameProfessor(h.professor, professorSelecionado));
    const diasOrdem = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7 };
    return [...filtradas].sort((a, b) => {
      const dA = diasOrdem[normalizarDia(a.dia)] || 99;
      const dB = diasOrdem[normalizarDia(b.dia)] || 99;
      if (dA !== dB) return dA - dB;
      return getPeriodoOrder(a.periodoId) - getPeriodoOrder(b.periodoId);
    });
  }, [horarios, professorSelecionado]);

  const listaAulasAuditoria = useMemo(() => {
    if (!Array.isArray(horarios)) return [];

    let filtradas = horarios.filter(h => {
      if (!h) return false;
      
      if (auditoriaFiltroProfessor && auditoriaFiltroProfessor !== 'TODOS') {
        const p1 = String(h.professor || '').trim().toLowerCase();
        const p2 = String(auditoriaFiltroProfessor).trim().toLowerCase();
        if (p1 !== p2 && !isSameProfessor(h.professor, auditoriaFiltroProfessor) && !p1.includes(p2) && !p2.includes(p1)) {
          return false;
        }
      }

      if (auditoriaFiltroTurma && auditoriaFiltroTurma !== 'TODAS') {
        if (h.turma !== auditoriaFiltroTurma) return false;
      }

      if (auditoriaFiltroDia && auditoriaFiltroDia !== 'TODOS') {
        if (normalizarDia(h.dia) !== normalizarDia(auditoriaFiltroDia)) return false;
      }

      if (auditoriaTermoBusca && auditoriaTermoBusca.trim()) {
        const t = auditoriaTermoBusca.toLowerCase().trim();
        const matchProf = (h.professor || '').toLowerCase().includes(t);
        const matchTurma = (h.turma || '').toLowerCase().includes(t);
        const matchDisc = (h.disciplina || '').toLowerCase().includes(t);
        const matchSala = (h.sala || '').toLowerCase().includes(t);
        const matchDia = (h.dia || '').toLowerCase().includes(t);
        if (!matchProf && !matchTurma && !matchDisc && !matchSala && !matchDia) {
          return false;
        }
      }

      return true;
    });

    const diasOrdem = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7 };
    filtradas.sort((a, b) => {
      const profA = (a.professor || '').localeCompare(b.professor || '');
      if (profA !== 0) return profA;

      const diaA = diasOrdem[normalizarDia(a.dia)] || 99;
      const diaB = diasOrdem[normalizarDia(b.dia)] || 99;
      if (diaA !== diaB) return diaA - diaB;

      const pA = getPeriodoOrder(a.periodoId);
      const pB = getPeriodoOrder(b.periodoId);
      if (pA !== pB) return pA - pB;

      return (a.turma || '').localeCompare(b.turma || '');
    });

    return filtradas;
  }, [horarios, auditoriaFiltroProfessor, auditoriaFiltroTurma, auditoriaFiltroDia, auditoriaTermoBusca]);

  // Handlers de Arraste e Solte (Drag & Drop)
  const handleDragStart = (e, aula) => {
    if (!podeEditar) return;
    setDraggedAula(aula);
    e.dataTransfer.setData('text/plain', aula.id);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragOverCell = (e, diaId, periodoId) => {
    if (!podeEditar || !draggedAula) return;
    e.preventDefault();
    const isCopy = e.altKey || modoDuplicarComArrasto;
    e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';

    const targetPeriodo = isNaN(Number(periodoId)) ? periodoId : Number(periodoId);
    if (dragOverTarget?.dia !== diaId || String(dragOverTarget?.periodoId) !== String(targetPeriodo)) {
      setDragOverTarget({ dia: diaId, periodoId: targetPeriodo });
    }
  };

  const handleDragLeaveCell = (e) => {
    e.preventDefault();
  };

  const handleDropCell = async (e, targetDia, targetPeriodoId) => {
    e.preventDefault();
    setDragOverTarget(null);

    if (!podeEditar || !draggedAula) return;

    const isCopy = e.altKey || modoDuplicarComArrasto;
    const destPeriodoId = isNaN(Number(targetPeriodoId)) ? targetPeriodoId : Number(targetPeriodoId);

    // Se for a mesma célula e não for modo cópia, cancela
    if (draggedAula.dia === targetDia && String(draggedAula.periodoId) === String(destPeriodoId) && !isCopy) {
      setDraggedAula(null);
      return;
    }

    if (isCopy) {
      // Duplicar a aula para a célula alvo
      await handleDuplicarHorario(draggedAula, targetDia, destPeriodoId);
    } else {
      // Mover a aula para a célula alvo
      try {
        const userAtivo = obterUsuarioAtivoCompleto();
        const payload = {
          dia: targetDia,
          periodoId: destPeriodoId,
          atualizadoEm: new Date().toISOString(),
          editadoPorNome: userAtivo.nome,
          editadoPorEmail: userAtivo.email,
          editadoPorCargo: userAtivo.cargo,
          editadoEm: new Date().toISOString()
        };

        if (anoGrade === '2026' && draggedAula.id && !String(draggedAula.id).startsWith('init-') && !String(draggedAula.id).startsWith('local-')) {
          const docRef = doc(db, 'horarios', draggedAula.id);
          await updateDoc(docRef, payload);
        }

        const auditPayloadMover = {
          modulo: `Grade Horária ${anoGrade}`,
          acao: 'ATUALIZAR',
          descricao: `Movida aula de ${draggedAula.disciplina || 'disciplina'} (${draggedAula.turma || ''}) do(a) prof. ${draggedAula.professor || ''} para ${targetDia}, ${destPeriodoId}ª aula.`,
          detalhes: { id: draggedAula.id, deDia: draggedAula.dia, dePeriodo: draggedAula.periodoId, paraDia: targetDia, paraPeriodo: destPeriodoId }
        };
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria(auditPayloadMover);
        } else {
          registrarLogAuditoria(auditPayloadMover);
        }

        const novos = horarios.map(h => (h.id === draggedAula.id ? { ...h, ...payload } : h));
        await persistirGradeAtual(novos);

        const diaLabel = DIAS_SEMANA.find(d => d.id === targetDia)?.label || targetDia;
        notificar(`Aula movida com sucesso para ${diaLabel}!`, 'info');
      } catch (err) {
        console.error('Erro ao mover aula:', err);
      }
    }

    setDraggedAula(null);
  };

  // Restaurar Grade Padrão Completa (Sincronizar Lote no Firestore)
  const handleRestaurarPadrao = () => {
    if (!podeEditar) {
      notificar('Acesso negado: Apenas a Direção possui autorização para alterar a grade horária.', 'warning');
      return;
    }
    abrirConfirmacao({
      title: 'Redefinir para Matriz Padrão PEI',
      message: `Deseja redefinir a grade horária de ${anoGrade} com a matriz padrão inicial da escola?`,
      confirmLabel: 'Redefinir Matriz',
      variant: 'warning',
      onConfirm: async () => {
        setLoading(true);
        const inis = GERAR_HORARIOS_INICIAIS().map(item => ({ ...item, anoLetivo: anoGrade }));
        try {
          if (anoGrade === '2026') {
            localStorage.removeItem('clovis_horarios_deleted_ids');
          }
          await persistirGradeAtual(inis);
          notificar(`Grade horária ${anoGrade} redefinida para a matriz inicial PEI!`, 'success');
          setIsGerenciarModalOpen(false);
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // Baixar modelo de CSV
  const handleBaixarModeloCSV = () => {
    const header = "dia,periodoId,turma,professor,disciplina,sala,observacao\n";
    const rows = [
      "segunda,1,6º Ano A,Profª Maria Silva,Língua Portuguesa,Sala 01 (6ºA),Aula Regular PEI",
      "segunda,2,6º Ano A,Prof. Carlos Eduardo,Matemática,Sala 01 (6ºA),Aula Regular PEI",
      "terca,3,7º Ano A,Profª Ana Paula,Ciências,Laboratório de Ciências,Aula Prática PEI"
    ].join("\n");
    
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_grade_horaria_clovis.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Exportar grade atual em CSV
  const handleExportarCSV = () => {
    const header = "dia,periodoId,turma,professor,disciplina,sala,observacao\n";
    const rows = horarios.map(h => 
      `"${h.dia}","${h.periodoId}","${h.turma || ''}","${h.professor || ''}","${h.disciplina || ''}","${h.sala || ''}","${h.observacao || ''}"`
    ).join("\n");

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grade_horaria_clovis_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handlers para o Modal de Pré-Visualização do CSV Importado
  const handleAtualizarItemPreviewCsv = (index, field, value) => {
    setCsvPreviewItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleRemoverItemPreviewCsv = (index) => {
    setCsvPreviewItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAdicionarItemManualPreviewCsv = () => {
    const novo = {
      id: `csv-manual-${Date.now()}`,
      dia: 'segunda',
      periodoId: 1,
      horaStr: '07:00-07:50',
      turma: '6º Ano A',
      professor: 'Prof. Não informado',
      disciplina: 'Língua Portuguesa',
      sala: 'Sala 01',
      observacao: '',
      contarSaldo: true
    };
    setCsvPreviewItems(prev => [novo, ...prev]);
  };

  // Função para interpretar o conteúdo de cada célula da matriz de horários (Professor x Período)
  const parseCellTextMatrix = (cellText, teacherName) => {
    if (!cellText || typeof cellText !== 'string') return null;
    let raw = cellText.trim();
    if (!raw || raw === '*' || raw === '-' || raw === ';') return null;

    // Normalizar quebras de linha e múltiplos espaços
    raw = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    const upper = raw.toUpperCase();

    // Refeições e intervalos de rotina não são aulas atribuídas
    if (upper === 'ALMOÇO' || upper === 'ALMOCO' || upper === 'JANTAR' || upper === 'INTERVALO') {
      return null;
    }

    // Horários Pedagógicos Coletivos
    if (upper.includes('ATPCG') || upper.includes('ATPCA') || upper === 'ATPC') {
      const disc = upper.includes('ATPCG') ? 'ATPCG' : upper.includes('ATPCA') ? 'ATPCA' : 'ATPC';
      return {
        turma: 'Geral (Docentes)',
        professor: teacherName || 'Prof. Não informado',
        disciplina: disc,
        sala: 'Sala dos Professores',
        observacao: '',
        contarSaldo: true
      };
    }

    if (upper === 'TUTORIA' || upper === 'INT. DIRIGIDO' || upper === 'ESTUDO' || upper.includes('TUTORIA')) {
      return {
        turma: 'Atendimento',
        professor: teacherName || 'Prof. Não informado',
        disciplina: raw,
        sala: 'Acompanhamento',
        observacao: '',
        contarSaldo: true
      };
    }

    if (upper.includes('ELETIVAS') || upper.includes('CLUBES') || upper.includes('ALINHAMENTO')) {
      return {
        turma: 'Diversas Turmas',
        professor: teacherName || 'Prof. Não informado',
        disciplina: raw,
        sala: 'Espaço Comum',
        observacao: '',
        contarSaldo: true
      };
    }

    let turma = '';
    let disciplina = '';
    let sala = 'Sala Regular';

    // Regex para identificar Turma no início (ex: 6A, 7D, 1C, 2A LOG, 3B HUM, 3A EXA)
    const matchTurma = raw.match(/^(?:LIDERANÇA E ORATÓRIA\s+)?([1-9]º?\s*[A-D]\s*(?:LOG|HUM|EXA)?)/i);

    if (matchTurma) {
      turma = matchTurma[1].trim();
      let resto = raw.substring(matchTurma[0].length).trim();

      if (resto.includes('|')) {
        const partes = resto.split('|');
        resto = partes[0].trim();
      }

      // Procura Sala no final (ex: "14 ACESSA", "10 EXA", "1 INFO", "13 LAB", "8 LGG", "3 HUM", "16 HUM")
      const salaRegex = /,?\s*([0-9]{1,2}\s*(?:ACESSA|EXA|INFO|LAB|LGG|HUM|HUMANAS)?|[0-9]{1,2}\s*INFO|[0-9]{1,2}\s*LAB|[0-9]{1,2}\s*ACESSA)$/i;
      const matchSala = resto.match(salaRegex);

      if (matchSala) {
        sala = matchSala[1].trim();
        disciplina = resto.substring(0, resto.lastIndexOf(matchSala[0])).replace(/^,|,$/g, '').trim();
      } else {
        disciplina = resto.replace(/^,|,$/g, '').trim();
      }
    } else {
      disciplina = raw;
      turma = 'Geral';
    }

    disciplina = disciplina.replace(/^,\s*|,\s*$/g, '').replace(/\|.*/, '').trim();
    if (!disciplina) disciplina = 'Atividade Escolar';

    return {
      turma: turma || 'Geral',
      professor: teacherName || 'Prof. Não informado',
      disciplina: disciplina,
      sala: sala || 'Sala Regular',
      observacao: '',
      contarSaldo: true
    };
  };

  // Processador Inteligente de CSV (Nativo para Matrizes com Colunas de Professores e Tabelas de Linhas)
  const processarCsvUploaded = (text, nomeArquivo = 'arquivo.csv') => {
    if (typeof text !== 'string' || !text.trim()) {
      notificar('O arquivo selecionado está vazio.', 'warning');
      return;
    }

    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      notificar('O arquivo CSV deve possuir pelo menos o cabeçalho e uma linha de dados.', 'warning');
      return;
    }

    const headerLine = lines[0];
    const sep = headerLine.includes(';') ? ';' : ',';

    const parseRowCols = (rowStr) => {
      const cols = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < rowStr.length; i++) {
        const char = rowStr[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === sep && !inQuotes) {
          cols.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      cols.push(current.trim().replace(/^["']|["']$/g, ''));
      return cols;
    };

    const headerCols = parseRowCols(headerLine);
    const headerColsUpper = headerCols.map(c => c.toUpperCase());

    const isMatrixFormat = (headerColsUpper[0]?.includes('DIA') || headerColsUpper[0]?.includes('SEMANA')) &&
                           (headerColsUpper[1]?.includes('HORA') || headerColsUpper[1]?.includes('HORARIO'));

    let itemsParsed = [];
    let idCounter = Date.now();

    if (isMatrixFormat) {
      const ignoredCols = ['LIVRE', 'TUTORIA', 'INT. DIRIGIDO', 'HORA DE ESTUDO', 'EM HORAS', 'TOTAL', 'SLA'];
      const teacherCols = [];

      for (let c = 2; c < headerCols.length; c++) {
        const colName = headerCols[c].trim();
        const colUpper = colName.toUpperCase();
        if (colName && !ignoredCols.some(ign => colUpper === ign || colUpper.includes(ign))) {
          teacherCols.push({ colIndex: c, teacherName: colName });
        }
      }

      let currentDay = 'segunda';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const cols = parseRowCols(line);
        if (cols.length < 2) continue;

        const rawDay = cols[0] ? cols[0].trim().toUpperCase() : '';
        const timeStr = cols[1] ? cols[1].trim() : '';

        if (rawDay.includes('TUTORIA') || rawDay.includes('ESTUDO') || timeStr.toLowerCase().includes('horas') || rawDay.startsWith(';;')) {
          continue;
        }
        if (timeStr.toLowerCase().includes('00:50') || timeStr.toLowerCase().includes('em horas')) {
          continue;
        }

        if (rawDay) {
          if (rawDay.includes('SEGUNDA') || rawDay.includes('SEG')) currentDay = 'segunda';
          else if (rawDay.includes('TERÇ') || rawDay.includes('TERC') || rawDay.includes('TER')) currentDay = 'terca';
          else if (rawDay.includes('QUART') || rawDay.includes('QUA')) currentDay = 'quarta';
          else if (rawDay.includes('QUINT') || rawDay.includes('QUI')) currentDay = 'quinta';
          else if (rawDay.includes('SEXT') || rawDay.includes('SEX')) currentDay = 'sexta';
        }

        const mapTimeSlot = (tStr) => {
          if (!tStr) return 1;
          const rawStr = String(tStr).trim();

          const order = getPeriodoOrder(rawStr);
          if (order !== 99 && order >= 1 && order <= 14) {
            if (order === 2.5) return 'int1';
            if (order === 5.5) return 'almoco';
            if (order === 9.5) return 'int2';
            if (order === 12.5) return 'jantar';
            return order;
          }

          const t = rawStr.replace(/\s+/g, '');
          if (t.includes('07:00-07:50') || t.includes('07:00')) return 1;
          if (t.includes('07:50-08:40') || t.includes('07:50')) return 2;
          if (t.includes('08:40-08:50') || t === '08:40') return 'int1';
          if (t.includes('08:50-09:40') || t.includes('08:50') || t.includes('08:40-09:30') || t.includes('08:40-09:40')) return 3;
          if (t.includes('09:40-10:30') || t.includes('09:40')) return 4;
          if (t.includes('10:30-11:20') || t.includes('10:30')) return 5;
          if (t.includes('11:20-12:20') || t === '11:20') return 'almoco';
          if (t.includes('12:20-13:10') || t.includes('12:20')) return 6;
          if (t.includes('13:10-14:00') || t.includes('13:10')) return 7;
          if (t.includes('14:20-15:10') || t.includes('14:20')) return 8;
          if (t.includes('15:10-16:00') || t.includes('15:10')) return 9;
          if (t.includes('16:00-16:10') || t === '16:00') return 'int2';
          if (t.includes('16:10-17:00') || t.includes('16:10')) return 10;
          if (t.includes('17:00-17:50') || t.includes('17:00')) return 11;
          if (t.includes('17:50-18:40') || t.includes('17:50')) return 12;
          if (t.includes('18:40-19:40') || t === '18:40') return 'jantar';
          if (t.includes('19:40-20:30') || t.includes('19:40')) return 13;
          if (t.includes('20:30-21:20') || t.includes('20:30')) return 14;
          return 1;
        };

        const periodoId = mapTimeSlot(timeStr);

        teacherCols.forEach(({ colIndex, teacherName }) => {
          const cellVal = cols[colIndex] ? cols[colIndex].trim() : '';
          if (!cellVal || cellVal === '*' || cellVal === '-' || cellVal === ';') return;

          const parsed = parseCellTextMatrix(cellVal, teacherName);
          if (parsed) {
            itemsParsed.push({
              id: `csv-${idCounter++}`,
              dia: currentDay,
              periodoId: periodoId,
              horaStr: timeStr || '07:00-07:50',
              turma: parsed.turma,
              professor: parsed.professor,
              disciplina: parsed.disciplina,
              sala: parsed.sala,
              observacao: '',
              contarSaldo: parsed.contarSaldo !== false
            });
          }
        });
      }
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseRowCols(lines[i]);
        if (cols.length >= 3) {
          const [dia, periodoId, turma, professor, disciplina, sala, observacao] = cols;
          let d = (dia || 'segunda').toLowerCase().trim();
          if (d.includes('seg')) d = 'segunda';
          else if (d.includes('ter')) d = 'terca';
          else if (d.includes('qua')) d = 'quarta';
          else if (d.includes('qui')) d = 'quinta';
          else if (d.includes('sex')) d = 'sexta';

          if (turma || professor) {
            itemsParsed.push({
              id: `csv-${idCounter++}`,
              dia: d,
              periodoId: isNaN(Number(periodoId)) ? (periodoId || 1) : Number(periodoId),
              horaStr: '07:00-07:50',
              turma: turma || 'Turma Padrão',
              professor: professor || 'Prof. Não informado',
              disciplina: disciplina || 'Geral',
              sala: sala || 'Sala Padrão',
              observacao: ''
            });
          }
        }
      }
    }

    if (itemsParsed.length === 0) {
      notificar('Nenhum horário de aula foi encontrado no arquivo CSV.', 'warning');
      return;
    }

    setCsvPreviewItems(itemsParsed);
    setCsvImportNomeArquivo(nomeArquivo);
    setIsPreviewCsvModalOpen(true);
  };

  // Importar CSV
  const handleImportarCSV = async (e) => {
    if (!podeEditar) {
      notificar('Acesso Negado: Apenas a Direção possui permissão para importar arquivos de grade.', 'warning');
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const readerUtf = new FileReader();
    readerUtf.onload = (evtUtf) => {
      let text = evtUtf.target?.result;
      if (typeof text !== 'string') return;

      if (text.includes('') || text.includes('Ã§') || text.includes('Ã¡') || text.includes('Ã£') || text.includes('Ã‰')) {
        const readerLatin = new FileReader();
        readerLatin.onload = (evtLatin) => {
          const textLatin = evtLatin.target?.result;
          if (typeof textLatin === 'string') {
            processarCsvUploaded(textLatin, file.name);
          } else {
            processarCsvUploaded(text, file.name);
          }
        };
        readerLatin.readAsText(file, 'iso-8859-1');
      } else {
        processarCsvUploaded(text, file.name);
      }
    };

    readerUtf.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // Confirmar e Sincronizar o CSV com a Grade Oficial
  const handleConfirmarEImportarCsv = async () => {
    if (!csvPreviewItems || csvPreviewItems.length === 0) {
      notificar('Não há itens para importar.', 'warning');
      return;
    }

    setSalvando(true);
    try {
      if (anoGrade === '2026') {
        try {
          const batch = writeBatch(db);
          let count = 0;
          for (const item of csvPreviewItems) {
            const docRef = doc(db, 'horarios', item.id);
            batch.set(docRef, {
              dia: item.dia,
              periodoId: item.periodoId,
              turma: item.turma,
              professor: item.professor,
              disciplina: item.disciplina,
              sala: item.sala,
              observacao: '',
              contarSaldo: item.contarSaldo !== false,
              atualizadoEm: new Date().toISOString()
            });
            count++;
            if (count >= 450) break;
          }
          await batch.commit();
        } catch (e) {
          console.warn('Sincronização banco assíncrona:', e);
        }
      }

      await persistirGradeAtual(csvPreviewItems);

      const novosDocentes = extrairEMigrarDocentesDoHorario(csvPreviewItems, cadastroProfessores);
      if (novosDocentes && novosDocentes.length > 0) {
        await salvarCadastroProfessores(novosDocentes);
      }

      const novasTurmasSet = new Set(cadastrosCustom.turmas || []);
      const novasSalasSet = new Set(cadastrosCustom.salas || []);
      const novosProfsSet = new Set(cadastrosCustom.professores || []);

      csvPreviewItems.forEach(item => {
        if (item.turma && item.turma !== '-') novasTurmasSet.add(item.turma);
        if (item.sala && item.sala !== '-') novasSalasSet.add(item.sala);
        if (item.professor && item.professor !== '-') novosProfsSet.add(item.professor);
      });

      const baseAtualizada = {
        turmas: Array.from(novasTurmasSet).sort(),
        professores: Array.from(novosProfsSet).sort(),
        salas: Array.from(novasSalasSet).sort()
      };
      setCadastrosCustom(baseAtualizada);
      try {
        await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });
      } catch (e) {}

      const auditPayloadCsv = {
        modulo: `Grade Horária ${anoGrade}`,
        acao: 'CRIAR',
        descricao: `Importada nova grade horária (${anoGrade}) via CSV contendo ${csvPreviewItems.length} aulas.`,
        detalhes: { quantidadeAulas: csvPreviewItems.length, nomeArquivo: csvImportNomeArquivo }
      };
      if (typeof window.registrarLogAuditoria === 'function') {
        window.registrarLogAuditoria(auditPayloadCsv);
      } else {
        registrarLogAuditoria(auditPayloadCsv);
      }

      notificar(`⚡ Sucesso! ${csvPreviewItems.length} aulas importadas para a grade ${anoGrade}!`, 'success', 5000);
      setIsPreviewCsvModalOpen(false);
      setIsGerenciarModalOpen(false);
    } catch (err) {
      console.error('Erro ao confirmar importação CSV:', err);
      notificar('Ocorreu um erro ao gravar a grade horária. Tente novamente.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  // Limpar toda a grade
  const handleLimparGrade = () => {
    if (!podeEditar) {
      notificar('Acesso Negado: Apenas a Direção possui permissão para redefinir a grade.', 'warning');
      return;
    }
    abrirConfirmacao({
      title: `Limpar Toda a Grade (${anoGrade})`,
      message: `ATENÇÃO: Esta ação irá remover TODAS as ${horarios.length} aulas da grade horária de ${anoGrade}. Deseja continuar?`,
      confirmLabel: 'Limpar Toda a Grade',
      variant: 'danger',
      onConfirm: async () => {
        setSalvando(true);
        try {
          const idsAtuais = (horarios || []).map(h => h.id).filter(Boolean);
          if (anoGrade === '2026' && idsAtuais.length > 0) {
            try {
              const chunkSize = 200;
              for (let i = 0; i < idsAtuais.length; i += chunkSize) {
                const batch = writeBatch(db);
                idsAtuais.slice(i, i + chunkSize).forEach(hId => batch.delete(doc(db, 'horarios', hId)));
                await batch.commit();
              }
            } catch (bErr) {
              console.warn('Aviso ao limpar docs de horarios em lote:', bErr);
            }
          }
          await persistirGradeAtual([], idsAtuais);
          notificar(`Grade horária ${anoGrade} limpa permanentemente.`, 'success');
          setIsGerenciarModalOpen(false);
        } finally {
          setSalvando(false);
        }
      }
    });
  };

  // Funções de Gerenciamento & Exclusão em Cascata (Turmas, Professores e Salas)
  const handleAdicionarTurma = async (e) => {
    e.preventDefault();
    if (!novoTurmaInput.trim()) return;
    const nome = novoTurmaInput.trim();
    if (listaTurmas.includes(nome)) {
      notificar('Esta turma já está cadastrada.', 'warning');
      return;
    }
    const atualizadas = [...(cadastrosCustom.turmas || []), nome];
    try {
      await setDoc(doc(db, 'config_escola', 'cadastros_base'), { ...cadastrosCustom, turmas: atualizadas }, { merge: true });
      setCadastrosCustom(prev => ({ ...prev, turmas: atualizadas }));
      setNovoTurmaInput('');
      notificar(`Turma "${nome}" cadastrada com sucesso!`, 'success');
    } catch(err) {
      console.error(err);
    }
  };

  const handleExcluirTurmaCascata = (turmaNome) => {
    if (!podeExcluir() && !podeEditar) {
      notificar('Permissão negada: Apenas Diretor e Vice-Diretor podem excluir turmas.', 'warning');
      return;
    }
    const afetadas = horarios.filter(h => h.turma === turmaNome);
    abrirConfirmacao({
      title: 'Excluir Turma em Cascata',
      message: `Deseja excluir a turma "${turmaNome}" e remover suas ${afetadas.length} aula(s) da grade ${anoGrade}?`,
      confirmLabel: 'Excluir Turma e Aulas',
      variant: 'danger',
      onConfirm: async () => {
        const baseAtualizada = {
          ...cadastrosCustom,
          turmas: (cadastrosCustom.turmas || []).filter(t => t !== turmaNome)
        };
        setCadastrosCustom(baseAtualizada);
        try {
          await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });
        } catch (e) {}

        const idsRemovidos = afetadas.map(a => a.id).filter(Boolean);
        if (anoGrade === '2026' && idsRemovidos.length > 0) {
          try {
            const batch = writeBatch(db);
            idsRemovidos.forEach(aId => batch.delete(doc(db, 'horarios', aId)));
            await batch.commit();
          } catch (e) {}
        }
        const restantes = horarios.filter(h => h.turma !== turmaNome);
        await persistirGradeAtual(restantes, idsRemovidos);
        if (turmaSelecionada === turmaNome) {
          setTurmaSelecionada(restantes[0]?.turma || baseAtualizada.turmas[0] || '');
        }
        notificar(`Turma "${turmaNome}" e ${afetadas.length} aula(s) removidas com sucesso.`, 'success');
      }
    });
  };

  const executarSalvarEdicaoTurma = async (antigaTurma, nomeLimpo) => {
    setSalvandoEdicao(true);
    try {
      const turmasAtualizadas = Array.from(new Set(
        (cadastrosCustom.turmas || []).map(t => t === antigaTurma ? nomeLimpo : t)
      ));
      if (!turmasAtualizadas.includes(nomeLimpo)) {
        turmasAtualizadas.push(nomeLimpo);
      }
      const baseAtualizada = { ...cadastrosCustom, turmas: turmasAtualizadas };

      const aulasAfetadas = horarios.filter(h => h.turma === antigaTurma);
      if (anoGrade === '2026' && aulasAfetadas.length > 0) {
        const batch = writeBatch(db);
        aulasAfetadas.forEach(aula => {
          if (aula.id && !String(aula.id).startsWith('init-')) {
            const docRef = doc(db, 'horarios', aula.id);
            batch.update(docRef, { turma: nomeLimpo, atualizadoEm: new Date().toISOString() });
          }
        });
        await batch.commit().catch(() => {});
      }

      await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });

      setCadastrosCustom(baseAtualizada);
      const horariosAtualizados = horarios.map(h => h.turma === antigaTurma ? { ...h, turma: nomeLimpo } : h);
      await persistirGradeAtual(horariosAtualizados);

      if (turmaSelecionada === antigaTurma) {
        setTurmaSelecionada(nomeLimpo);
      }

      registrarLogAuditoria({
        acao: 'EDICAO',
        modulo: 'Grade Horária / Turmas',
        descricao: `Turma renomeada de "${antigaTurma}" para "${nomeLimpo}". ${aulasAfetadas.length} aula(s) atualizadas na grade.`,
        autor: obterUsuarioAtivoCompleto()?.nome || 'Gestão Escolar',
        cargo: obterUsuarioAtivoCompleto()?.cargo || 'Direção'
      });

      setTurmaEmEdicao(null);
      setNovoNomeTurma('');
      notificar(`Turma "${antigaTurma}" renomeada para "${nomeLimpo}" (${aulasAfetadas.length} aulas atualizadas)!`, 'success');
    } catch (err) {
      console.error('Erro ao editar turma:', err);
      notificar('Erro ao atualizar turma: ' + (err.message || err), 'error');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const handleSalvarEdicaoTurma = async (antigaTurma) => {
    const nomeLimpo = (novoNomeTurma || '').trim();
    if (!nomeLimpo) {
      notificar('O nome da turma não pode estar vazio.', 'warning');
      return;
    }
    if (nomeLimpo === antigaTurma) {
      setTurmaEmEdicao(null);
      return;
    }
    if (listaTurmas.some(t => t.toLowerCase() === nomeLimpo.toLowerCase())) {
      abrirConfirmacao({
        title: 'Unificar Turma',
        message: `Já existe uma turma cadastrada como "${nomeLimpo}". Deseja unificar as aulas desta turma?`,
        confirmLabel: 'Unificar Turmas',
        variant: 'warning',
        onConfirm: () => executarSalvarEdicaoTurma(antigaTurma, nomeLimpo)
      });
      return;
    }
    await executarSalvarEdicaoTurma(antigaTurma, nomeLimpo);
  };

  const handleAdicionarProfessor = async (e) => {
    e.preventDefault();
    if (!novoProfInput.trim()) return;
    const nome = novoProfInput.trim();
    if (listaProfessores.includes(nome)) {
      notificar('Este professor já está cadastrado.', 'warning');
      return;
    }
    const atualizados = [...(cadastrosCustom.professores || []), nome];
    try {
      await setDoc(doc(db, 'config_escola', 'cadastros_base'), { ...cadastrosCustom, professores: atualizados }, { merge: true });
      setCadastrosCustom(prev => ({ ...prev, professores: atualizados }));
      setNovoProfInput('');
      notificar(`Professor(a) "${nome}" cadastrado(a)!`, 'success');
    } catch(err) {
      console.error(err);
    }
  };

  const handleExcluirProfessorCascata = (profNome) => {
    if (!podeExcluir() && !podeEditar) {
      notificar('Permissão negada: Apenas Diretor e Vice-Diretor podem excluir docentes.', 'warning');
      return;
    }
    const afetadas = horarios.filter(h => isSameProfessor(h.professor, profNome) || h.professor === profNome);
    abrirConfirmacao({
      title: 'Excluir Docente em Cascata',
      message: `Deseja excluir "${profNome}" do cadastro e remover suas ${afetadas.length} aula(s) da grade ${anoGrade}?`,
      confirmLabel: 'Excluir Docente e Aulas',
      variant: 'danger',
      onConfirm: async () => {
        const novosProfs = (cadastroProfessores || []).filter(p => !isSameProfessor(p.nome, profNome) && p.nome !== profNome);
        const baseAtualizada = {
          ...cadastrosCustom,
          professores: (cadastrosCustom.professores || []).filter(p => !isSameProfessor(p, profNome) && p !== profNome)
        };
        setCadastroProfessores(novosProfs);
        setCadastrosCustom(baseAtualizada);
        localStorage.setItem('clovis_cadastro_professores', JSON.stringify(novosProfs));

        try {
          await setDoc(doc(db, 'config_escola', 'cadastro_professores'), { professores: novosProfs, atualizadoEm: new Date().toISOString() }, { merge: true });
          await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });
        } catch (e) {}

        const idsRemovidos = afetadas.map(a => a.id).filter(Boolean);
        if (anoGrade === '2026' && idsRemovidos.length > 0) {
          try {
            const batch = writeBatch(db);
            idsRemovidos.forEach(aId => batch.delete(doc(db, 'horarios', aId)));
            await batch.commit();
          } catch (e) {}
        }
        const restantes = horarios.filter(h => !isSameProfessor(h.professor, profNome) && h.professor !== profNome);
        await persistirGradeAtual(restantes, idsRemovidos);
        if (professorSelecionado === profNome) {
          setProfessorSelecionado(restantes[0]?.professor || novosProfs[0]?.nome || '');
        }
        notificar(`Docente "${profNome}" e ${afetadas.length} aula(s) removidas com sucesso.`, 'success');
      }
    });
  };

  const executarSalvarEdicaoProfessor = async (antigoNome, nomeLimpo, discLimpa) => {
    setSalvandoEdicao(true);
    try {
      let achouDocente = false;
      const novosProfs = (cadastroProfessores || []).map(p => {
        if (isSameProfessor(p.nome, antigoNome) || p.nome === antigoNome) {
          achouDocente = true;
          const novaArea = discLimpa && discLimpa !== p.disciplina
            ? (encontrarAreaDisciplina(discLimpa) || p.area)
            : p.area;
          return {
            ...p,
            nome: nomeLimpo,
            disciplina: discLimpa || p.disciplina || 'Geral',
            area: novaArea
          };
        }
        return p;
      });

      if (!achouDocente) {
        novosProfs.push({
          nome: nomeLimpo,
          disciplina: discLimpa || 'Geral',
          area: normalizarArea(encontrarAreaDisciplina(discLimpa)),
          tipo: 'EFETIVO',
          turno: 'INTEGRAL',
          saldoAulas: 0
        });
      }

      const listaCustomAtualizada = Array.from(new Set(
        (cadastrosCustom.professores || []).map(n => isSameProfessor(n, antigoNome) ? nomeLimpo : n)
      ));
      if (!listaCustomAtualizada.includes(nomeLimpo)) {
        listaCustomAtualizada.push(nomeLimpo);
      }
      const baseAtualizada = { ...cadastrosCustom, professores: listaCustomAtualizada };

      const aulasAfetadas = horarios.filter(h => isSameProfessor(h.professor, antigoNome) || h.professor === antigoNome);
      if (anoGrade === '2026' && aulasAfetadas.length > 0) {
        const batch = writeBatch(db);
        aulasAfetadas.forEach(aula => {
          if (aula.id && !String(aula.id).startsWith('init-')) {
            const docRef = doc(db, 'horarios', aula.id);
            const dadosUpdate = {
              professor: nomeLimpo,
              atualizadoEm: new Date().toISOString()
            };
            if (discLimpa && (!aula.disciplina || aula.disciplina === 'Geral')) {
              dadosUpdate.disciplina = discLimpa;
            }
            batch.update(docRef, dadosUpdate);
          }
        });
        await batch.commit().catch(() => {});
      }

      await setDoc(doc(db, 'config_escola', 'cadastro_professores'), {
        professores: novosProfs,
        atualizadoEm: new Date().toISOString()
      }, { merge: true });

      await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });

      setCadastroProfessores(novosProfs);
      setCadastrosCustom(baseAtualizada);
      localStorage.setItem('clovis_cadastro_professores', JSON.stringify(novosProfs));

      const horariosAtualizados = horarios.map(h => {
        if (isSameProfessor(h.professor, antigoNome) || h.professor === antigoNome) {
          return {
            ...h,
            professor: nomeLimpo,
            ...(discLimpa && (!h.disciplina || h.disciplina === 'Geral') ? { disciplina: discLimpa } : {})
          };
        }
        return h;
      });
      await persistirGradeAtual(horariosAtualizados);

      if (professorSelecionado === antigoNome) {
        setProfessorSelecionado(nomeLimpo);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clovis_teachers_updated', { detail: novosProfs }));
      }

      registrarLogAuditoria({
        acao: 'EDICAO',
        modulo: 'Grade Horária / Docentes',
        descricao: `Docente renomeado de "${antigoNome}" para "${nomeLimpo}". ${aulasAfetadas.length} aula(s) atualizadas na grade.`,
        autor: obterUsuarioAtivoCompleto()?.nome || 'Gestão Escolar',
        cargo: obterUsuarioAtivoCompleto()?.cargo || 'Direção'
      });

      setProfEmEdicao(null);
      setNovoNomeProf('');
      setNovaDiscProf('');
      notificar(`Docente "${antigoNome}" atualizado para "${nomeLimpo}" (${aulasAfetadas.length} aulas sincronizadas)!`, 'success', 4000);
    } catch (err) {
      console.error('Erro ao editar docente:', err);
      notificar('Erro ao atualizar docente: ' + (err.message || err), 'error');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const handleSalvarEdicaoProfessor = async (antigoNome) => {
    const nomeLimpo = (novoNomeProf || '').trim();
    const discLimpa = (novaDiscProf || '').trim();
    if (!nomeLimpo) {
      notificar('O nome do docente não pode estar vazio.', 'warning');
      return;
    }

    if (nomeLimpo !== antigoNome && listaProfessores.some(p => p.toLowerCase() === nomeLimpo.toLowerCase())) {
      abrirConfirmacao({
        title: 'Unificar Docente',
        message: `Já existe um docente com o nome "${nomeLimpo}". Deseja unificar os registros e aulas deste docente?`,
        confirmLabel: 'Unificar Docentes',
        variant: 'warning',
        onConfirm: () => executarSalvarEdicaoProfessor(antigoNome, nomeLimpo, discLimpa)
      });
      return;
    }

    await executarSalvarEdicaoProfessor(antigoNome, nomeLimpo, discLimpa);
  };

  const handleAdicionarSala = async (e) => {
    e.preventDefault();
    if (!novaSalaInput.trim()) return;
    const nome = novaSalaInput.trim();
    if (listaSalas.includes(nome)) {
      notificar('Esta sala já está cadastrada.', 'warning');
      return;
    }
    const atualizadas = [...(cadastrosCustom.salas || []), nome];
    try {
      await setDoc(doc(db, 'config_escola', 'cadastros_base'), { ...cadastrosCustom, salas: atualizadas }, { merge: true });
      setCadastrosCustom(prev => ({ ...prev, salas: atualizadas }));
      setNovaSalaInput('');
      notificar(`Sala "${nome}" cadastrada com sucesso!`, 'success');
    } catch(err) {
      console.error(err);
    }
  };

  const handleExcluirSalaCascata = (salaNome) => {
    if (!podeExcluir() && !podeEditar) {
      notificar('Permissão negada: Apenas Diretor e Vice-Diretor podem excluir salas.', 'warning');
      return;
    }
    const afetadas = horarios.filter(h => h.sala === salaNome);
    abrirConfirmacao({
      title: 'Excluir Sala em Cascata',
      message: `Deseja excluir a sala "${salaNome}" e remover suas ${afetadas.length} atribuição(ões) da grade ${anoGrade}?`,
      confirmLabel: 'Excluir Sala e Atribuições',
      variant: 'danger',
      onConfirm: async () => {
        const baseAtualizada = {
          ...cadastrosCustom,
          salas: (cadastrosCustom.salas || []).filter(s => s !== salaNome)
        };
        setCadastrosCustom(baseAtualizada);
        try {
          await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });
        } catch (e) {}

        const idsRemovidos = afetadas.map(a => a.id).filter(Boolean);
        if (anoGrade === '2026' && idsRemovidos.length > 0) {
          try {
            const batch = writeBatch(db);
            idsRemovidos.forEach(aId => batch.delete(doc(db, 'horarios', aId)));
            await batch.commit();
          } catch (e) {}
        }
        const restantes = horarios.filter(h => h.sala !== salaNome);
        await persistirGradeAtual(restantes, idsRemovidos);
        if (salaSelecionada === salaNome) {
          setSalaSelecionada(restantes[0]?.sala || baseAtualizada.salas[0] || '');
        }
        notificar(`Sala "${salaNome}" e ${afetadas.length} atribuição(ões) removidas com sucesso.`, 'success');
      }
    });
  };

  const executarSalvarEdicaoSala = async (antigaSala, nomeLimpo) => {
    setSalvandoEdicao(true);
    try {
      const salasAtualizadas = Array.from(new Set(
        (cadastrosCustom.salas || []).map(s => s === antigaSala ? nomeLimpo : s)
      ));
      if (!salasAtualizadas.includes(nomeLimpo)) {
        salasAtualizadas.push(nomeLimpo);
      }
      const baseAtualizada = { ...cadastrosCustom, salas: salasAtualizadas };

      const aulasAfetadas = horarios.filter(h => h.sala === antigaSala);
      if (anoGrade === '2026' && aulasAfetadas.length > 0) {
        const batch = writeBatch(db);
        aulasAfetadas.forEach(aula => {
          if (aula.id && !String(aula.id).startsWith('init-')) {
            const docRef = doc(db, 'horarios', aula.id);
            batch.update(docRef, { sala: nomeLimpo, atualizadoEm: new Date().toISOString() });
          }
        });
        await batch.commit().catch(() => {});
      }

      await setDoc(doc(db, 'config_escola', 'cadastros_base'), baseAtualizada, { merge: true });

      setCadastrosCustom(baseAtualizada);
      const horariosAtualizados = horarios.map(h => h.sala === antigaSala ? { ...h, sala: nomeLimpo } : h);
      await persistirGradeAtual(horariosAtualizados);

      if (salaSelecionada === antigaSala) {
        setSalaSelecionada(nomeLimpo);
      }

      registrarLogAuditoria({
        acao: 'EDICAO',
        modulo: 'Grade Horária / Salas',
        descricao: `Sala renomeada de "${antigaSala}" para "${nomeLimpo}". ${aulasAfetadas.length} aula(s) atualizadas na grade.`,
        autor: obterUsuarioAtivoCompleto()?.nome || 'Gestão Escolar',
        cargo: obterUsuarioAtivoCompleto()?.cargo || 'Direção'
      });

      setSalaEmEdicao(null);
      setNovoNomeSala('');
      notificar(`Sala "${antigaSala}" renomeada para "${nomeLimpo}" (${aulasAfetadas.length} aulas atualizadas)!`, 'success');
    } catch (err) {
      console.error('Erro ao editar sala:', err);
      notificar('Erro ao atualizar sala: ' + (err.message || err), 'error');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const handleSalvarEdicaoSala = async (antigaSala) => {
    const nomeLimpo = (novoNomeSala || '').trim();
    if (!nomeLimpo) {
      notificar('O nome da sala/espaço não pode estar vazio.', 'warning');
      return;
    }
    if (nomeLimpo === antigaSala) {
      setSalaEmEdicao(null);
      return;
    }
    if (listaSalas.some(s => s.toLowerCase() === nomeLimpo.toLowerCase())) {
      abrirConfirmacao({
        title: 'Unificar Sala',
        message: `Já existe uma sala chamada "${nomeLimpo}". Deseja unificar as aulas nesta sala?`,
        confirmLabel: 'Unificar Salas',
        variant: 'warning',
        onConfirm: () => executarSalvarEdicaoSala(antigaSala, nomeLimpo)
      });
      return;
    }
    await executarSalvarEdicaoSala(antigaSala, nomeLimpo);
  };

  // Imprimir Grade
  const handleImprimir = () => {
    window.print();
  };

  // Obter Estilo e Cor da Disciplina por Categoria Seduc/PEI
  const getCorDisciplina = (disciplinaNome) => {
    if (!disciplinaNome) return { bg: 'bg-slate-100 text-slate-800 border-slate-200', badge: 'bg-slate-600 text-white' };
    const discUpper = String(disciplinaNome).toUpperCase().trim();

    if (['FOLGA', 'OFF', '-', 'S', '*', 'BLOQUEIO', 'JANELA', 'FORA', 'AUSENTE'].some(term => discUpper === term || discUpper.includes(term))) {
      return { bg: 'bg-rose-100/90 border-2 border-rose-300 text-rose-950 font-bold', badge: 'bg-rose-700 text-white font-black' };
    }

    // 1. Amarelo/Laranja: Língua Portuguesa, Inglês, Arte, Educação Física
    if (['PORTUGUÊS', 'PORTUGUES', 'LÍNGUA PORTUGUESA', 'LINGUA PORTUGUESA', 'INGLÊS', 'INGLES', 'ARTE', 'ARTES', 'EDUCAÇÃO FÍSICA', 'EDUCACAO FISICA', 'ED. FÍSICA', 'ED. FISICA', 'ED FISICA'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-amber-100 border-amber-300 text-amber-900 font-bold', badge: 'bg-amber-600 text-white' };
    }

    // 2. Vermelho/Rose: Matemática
    if (['MATEMÁTICA', 'MATEMATICA', 'MAT'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-rose-100 border-rose-300 text-rose-900 font-bold', badge: 'bg-rose-600 text-white' };
    }

    // 3. Verde: Ciências, Biologia, Física, Química
    if (['CIÊNCIAS', 'CIENCIAS', 'BIOLOGIA', 'FÍSICA', 'FISICA', 'QUÍMICA', 'QUIMICA'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold', badge: 'bg-emerald-600 text-white' };
    }

    // 4. Roxo/Fúcsia: História, Geografia, Filosofia, Sociologia
    if (['HISTÓRIA', 'HISTORIA', 'GEOGRAFIA', 'GEO', 'FILOSOFIA', 'SOCIOLOGIA'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900 font-bold', badge: 'bg-fuchsia-600 text-white' };
    }

    // 5. Ciano/Azul: Eletivas, Projeto de Vida, Práticas, Tecnologia, Orientação, Tutoria, Robótica
    if (['ELETIVA', 'PROJETO DE VIDA', 'PRÁTICA', 'PRATICA', 'TECNOLOGIA', 'INOVAÇÃO', 'INOVACAO', 'ORIENTAÇÃO', 'ORIENTACAO', 'ESTUDO ORIENTADO', 'TUTORIA', 'COMPUTACIONAL', 'ROBÓTICA', 'ROBOTICA', 'PLANTÃO', 'PLANTAO'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-sky-100 border-sky-300 text-sky-900 font-bold', badge: 'bg-sky-600 text-white' };
    }

    // 6. Cinza Neutro: Intervalo, Almoço, Recreio
    if (['INTERVALO', 'ALMOÇO', 'ALMOCO', 'RECREIO'].some(t => discUpper.includes(t))) {
      return { bg: 'bg-slate-200 border-slate-300 text-slate-700 italic font-semibold', badge: 'bg-slate-600 text-white' };
    }

    const chave = Object.keys(DISCIPLINAS_CORES).find(k =>
      disciplinaNome.toLowerCase().includes(k.toLowerCase())
    );
    return DISCIPLINAS_CORES[chave] || { bg: 'bg-sky-100 text-sky-900 border-sky-300 font-bold', badge: 'bg-sky-600 text-white' };
  };
  const getDisciplinaCor = getCorDisciplina;

  // Estatísticas Rápidas com Deduplicação de Slots
  const totalAulasSemanais = useMemo(() => {
    const slotsContados = new Set();
    return horariosEfetivos.filter(h => {
      if (!h || !h.professor || !isRegularTeachingClass(h)) return false;
      const key = `${(h.turma || h.professor).trim()}_${normalizarDia(h.dia)}_${getPeriodoOrder(h.periodoId)}`;
      if (slotsContados.has(key)) return false;
      slotsContados.add(key);
      return true;
    }).length;
  }, [horariosEfetivos]);
  const totalProfessoresAtivos = new Set(horariosEfetivos.map(h => h.professor).filter(Boolean)).size;
  const totalTurmasAtivas = new Set(horariosEfetivos.map(h => h.turma).filter(Boolean)).size;
  const totalSalasAtivas = new Set(horariosEfetivos.map(h => h.sala).filter(Boolean)).size;

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Cabeçalho da Seção */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-950 to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-blue-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-cyan-100 text-cyan-300 flex items-center justify-center text-2xl border border-cyan-400 shadow-inner">
              <i className="fa-solid fa-clock-rotate-left"></i>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-white tracking-tight">Grade Horária Escolar PEI</h1>
                <div className="inline-flex rounded-lg bg-slate-900/80 border border-slate-700 p-0.5 text-[11px] font-black">
                  <button
                    type="button"
                    onClick={() => handleAlternarAnoGrade('2026')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${anoGrade === '2026' ? 'bg-emerald-500 text-slate-950 shadow-xs' : 'text-slate-300 hover:text-white'}`}
                  >
                    Grade 2026 (Vigente)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlternarAnoGrade('2027')}
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${anoGrade === '2027' ? 'bg-cyan-400 text-blue-950 shadow-xs' : 'text-slate-300 hover:text-white'}`}
                  >
                    Grade 2027 (Planejamento)
                  </button>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                  <span className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  {isRealtimeConnected ? 'Sincronizado' : 'Conectando...'}
                </span>
              </div>
              <p className="text-xs text-cyan-200 font-medium mt-0.5">
                Escola Estadual Clóvis de Lucca &bull; Ano Letivo {anoGrade} &bull; Matriz de Aulas por Turma, Professor e Sala
              </p>
            </div>
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => carregarGradeHorarios(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer"
            title="Forçar atualização da Grade Horária a partir do servidor"
          >
            <i className="fa-solid fa-arrows-rotate text-cyan-400"></i>
            <span>Atualizar Grade</span>
          </button>

          <button
            onClick={handleImprimir}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-slate-700 transition shadow-sm cursor-pointer"
          >
            <i className="fa-solid fa-print text-cyan-400"></i>
            <span>Imprimir Grade</span>
          </button>

          {podeEditar ? (
            <>
              <label className="flex items-center gap-2 bg-gradient-to-r from-emerald-700 to-teal-800 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-black px-3.5 py-2.5 rounded-xl border border-emerald-500/70 transition shadow-sm cursor-pointer" title="Importar arquivo CSV (Grade em Matriz ou Tabela)">
                <i className="fa-solid fa-file-csv text-cyan-300"></i>
                <span>Subir CSV (Grade/Matriz)</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleImportarCSV}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => setModoPlanilha(!modoPlanilha)}
                className={`flex items-center gap-2 text-xs font-black px-3.5 py-2.5 rounded-xl transition cursor-pointer border shadow-sm ${
                  modoPlanilha
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-emerald-900/30 ring-2 ring-emerald-400'
                    : 'bg-emerald-800/90 hover:bg-emerald-700 text-emerald-100 border-emerald-600/70'
                }`}
                title="Ativar modo planilha para edição rápida e direta de todas as células da grade"
              >
                <i className={`fa-solid ${modoPlanilha ? 'fa-table-cells-large' : 'fa-file-excel'} text-cyan-300`}></i>
                <span>{modoPlanilha ? 'Modo Planilha Ativo' : 'Ativar Modo Planilha'}</span>
              </button>

              <button
                onClick={() => setIsConfigHorariosModalOpen(true)}
                className="flex items-center gap-2 bg-indigo-900/90 hover:bg-indigo-800 text-indigo-100 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-indigo-700/70 transition shadow-sm cursor-pointer"
                title="Editar slots de tempo (horários das aulas e intervalos)"
              >
                <i className="fa-solid fa-clock text-cyan-300"></i>
                <span>Editar Slots de Horário</span>
              </button>

              <button
                onClick={() => setIsAusenciaModalOpen(true)}
                className="flex items-center gap-2 bg-purple-900 hover:bg-purple-800 text-purple-100 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-purple-700 transition shadow-sm cursor-pointer"
                title="Configurar agenda de ausência / indisponibilidade de professores"
              >
                <i className="fa-solid fa-user-slash text-rose-300"></i>
                <span>Indisponibilidade Docente</span>
              </button>

              {/* Botão de Auditoria de Aulas Atribuídas */}
              {(podeEditar || isDiretor) && (
                <button
                  onClick={() => {
                    setAuditoriaFiltroProfessor(modoVisao === 'por_professor' && professorSelecionado ? professorSelecionado : 'TODOS');
                    setIsAuditoriaAulasModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black px-4 py-2.5 rounded-xl border border-amber-400 shadow-md transition cursor-pointer shrink-0"
                  title="Auditoria e Gestão de Aulas Atribuídas"
                >
                  <i className="fa-solid fa-clipboard-check text-slate-950 text-sm"></i>
                  <span>Auditoria de Atribuição</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  abrirConfirmacao({
                    title: 'Preparar Grade do Ano Letivo 2027',
                    message: 'Deseja criar/atualizar a cópia de planejamento para 2027 a partir da grade vigente de 2026?\n\nNenhuma aula atual de 2026 será alterada ou apagada.',
                    confirmLabel: 'Duplicar para 2027',
                    variant: 'info',
                    onConfirm: () => handleDuplicarGradePara2027(true)
                  });
                }}
                className="flex items-center gap-2 bg-gradient-to-r from-purple-900 to-indigo-950 hover:from-purple-800 hover:to-indigo-900 text-purple-100 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-purple-500/50 transition shadow-sm cursor-pointer"
                title="Duplicar grade atual para planejamento do Ano Letivo 2027"
              >
                <i className="fa-solid fa-calendar-plus text-cyan-300"></i>
                <span>Preparar Grade 2027</span>
              </button>

              <button
                onClick={() => setIsGerenciarModalOpen(true)}
                className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-blue-100 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-blue-700/60 transition shadow-sm cursor-pointer"
                title="Ferramentas de Gerenciamento da Grade (Upload CSV / Redefinição / Exclusão)"
              >
                <i className="fa-solid fa-sliders text-cyan-300"></i>
                <span>Gerenciar Grade</span>
              </button>

              <button
                onClick={() => handleAbrirModalNovo()}
                className="flex items-center gap-2 bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 text-blue-950 text-xs font-black px-4 py-2.5 rounded-xl transition shadow-md cursor-pointer"
              >
                <i className="fa-solid fa-plus text-sm"></i>
                <span>Novo Horário</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsAusenciaModalOpen(true)}
                className="flex items-center gap-2 bg-purple-900 hover:bg-purple-800 text-purple-100 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-purple-700 transition shadow-sm cursor-pointer"
                title="Consultar agenda de ausências dos professores"
              >
                <i className="fa-solid fa-user-slash text-rose-300"></i>
                <span>Ver Ausências Docentes</span>
              </button>

              <div className="flex items-center gap-2 bg-slate-800 text-cyan-300 text-xs font-bold px-3.5 py-2.5 rounded-xl border border-slate-700 shadow-sm" title="Modo somente leitura para docentes">
                <i className="fa-solid fa-eye text-cyan-400"></i>
                <span>Modo de Visualização (Somente Leitura)</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Banner Informativo do Modo Planejamento 2027 */}
      {anoGrade === '2027' && (
        <div className="bg-cyan-50 border-2 border-cyan-300 text-blue-950 px-5 py-4 rounded-2xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs print:hidden">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-400 text-blue-950 flex items-center justify-center font-black shrink-0">
              2027
            </div>
            <div>
              <p className="font-black text-sm">Modo de Planejamento: Grade Horária 2027</p>
              <p className="text-slate-700 font-medium">
                {horarios.length === 0
                  ? 'A base de horários de 2027 ainda está vazia. Você pode duplicar a grade de 2026 com 1 clique ou alocar aulas manualmente sem afetar 2026.'
                  : `Editando a base isolada de 2027 (${horarios.length} aula(s) planejadas). A grade vigente de 2026 permanece intacta.`}
              </p>
            </div>
          </div>
          {podeEditar && (
            <button
              type="button"
              onClick={() => handleDuplicarGradePara2027(false)}
              className="px-4 py-2 bg-blue-950 hover:bg-slate-900 text-white font-black rounded-xl transition cursor-pointer flex items-center gap-2 shrink-0"
            >
              <i className="fa-solid fa-clone text-cyan-300"></i>
              <span>{horarios.length === 0 ? 'Importar Grade de 2026 para 2027' : 'Reimportar Base de 2026'}</span>
            </button>
          )}
        </div>
      )}

      {/* Alertas & Mensagens */}
      {erro && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-triangle-exclamation text-amber-600 text-base"></i>
            <span>{erro}</span>
          </div>
          <span className="text-[11px] text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg">Modo Resiliente Ativo</span>
        </div>
      )}

      {/* Cards de Métricas e Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 print:hidden">
        <div 
          onClick={() => {
            setAuditoriaFiltroProfessor('TODOS');
            setIsAuditoriaAulasModalOpen(true);
          }}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition"
          title="Clique para auditar e gerenciar a lista de todas as aulas atribuídas"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-calendar-check"></i>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Aulas Atribuidas</p>
              <span className="text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded-md">
                Auditar
              </span>
            </div>
            <p className="text-xl font-black text-slate-800">{totalAulasSemanais}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-chalkboard-user"></i>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Professores</p>
            <p className="text-xl font-black text-slate-800">{totalProfessoresAtivos}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-users"></i>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Turmas PEI</p>
            <p className="text-xl font-black text-slate-800">{totalTurmasAtivas}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-door-open"></i>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Salas / Espaços</p>
            <p className="text-xl font-black text-slate-800">{totalSalasAtivas}</p>
          </div>
        </div>
      </div>

      {/* Painel de Modos de Visualização e Filtros */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          {/* Tabs de Seleção de Visão */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setModoVisao('por_turma')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                modoVisao === 'por_turma'
                  ? 'bg-blue-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
              }`}
            >
              <i className="fa-solid fa-users"></i>
              <span>Por Turma</span>
            </button>

            <button
              onClick={() => setModoVisao('por_professor')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                modoVisao === 'por_professor'
                  ? 'bg-blue-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
              }`}
            >
              <i className="fa-solid fa-chalkboard-user"></i>
              <span>Por Professor</span>
            </button>

            <button
              onClick={() => setModoVisao('por_sala')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                modoVisao === 'por_sala'
                  ? 'bg-blue-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
              }`}
            >
              <i className="fa-solid fa-door-open"></i>
              <span>Por Sala / Espaço</span>
            </button>

            <button
              onClick={() => setModoVisao('matriz_geral')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                modoVisao === 'matriz_geral'
                  ? 'bg-blue-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
              }`}
            >
              <i className="fa-solid fa-table-cells"></i>
              <span>Visão Geral</span>
            </button>
          </div>

          {/* Campo de Busca Rápida */}
          <div className="relative w-full sm:w-64">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input
              type="text"
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar disciplina, prof, sala..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-cyan-400 outline-none transition"
            />
            {termoBusca && (
              <button
                onClick={() => setTermoBusca('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            )}
          </div>
        </div>

        {/* Seletores Específicos do Modo Ativo */}
        <div className="flex flex-wrap items-center gap-4">
          {modoVisao === 'por_turma' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <i className="fa-solid fa-filter text-cyan-600"></i>
                  <span>Selecione a Turma:</span>
                </label>
                <select
                  value={turmaSelecionada}
                  onChange={(e) => setTurmaSelecionada(e.target.value)}
                  className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-extrabold text-blue-950 focus:ring-2 focus:ring-cyan-400 outline-none cursor-pointer"
                >
                  {listaTurmas.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Badge do Segmento da Turma */}
              {isEnsinoMedio && (
                <span className="px-2.5 py-1 bg-indigo-100 text-indigo-950 border border-indigo-300 rounded-xl text-xs font-extrabold uppercase flex items-center gap-1.5 shadow-2xs">
                  <i className="fa-solid fa-graduation-cap text-indigo-700"></i>
                  <span>Ensino Médio</span>
                </span>
              )}
              {isEnsinoFundamental && (
                <span className="px-2.5 py-1 bg-teal-100 text-teal-950 border border-teal-300 rounded-xl text-xs font-extrabold uppercase flex items-center gap-1.5 shadow-2xs">
                  <i className="fa-solid fa-school text-teal-700"></i>
                  <span>Ensino Fundamental</span>
                </span>
              )}

              {/* Toggle de Supressão do Turno Inativo */}
              <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer shadow-2xs hover:bg-slate-50 transition select-none">
                <input
                  type="checkbox"
                  checked={suprimirTurnosOutros}
                  onChange={(e) => setSuprimirTurnosOutros(e.target.checked)}
                  className="rounded text-cyan-600 focus:ring-cyan-500 w-4 h-4 cursor-pointer"
                />
                <span>
                  {isEnsinoMedio ? 'Suprimir Manhã (Exibir Tarde)' : isEnsinoFundamental ? 'Suprimir Tarde (Exibir Manhã)' : 'Suprimir Turno Inativo'}
                </span>
              </label>
            </div>
          )}

          {modoVisao === 'por_professor' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <i className="fa-solid fa-filter text-cyan-600"></i>
                  <span>Selecione o Professor:</span>
                </label>
                <select
                  value={professorSelecionado}
                  onChange={(e) => setProfessorSelecionado(e.target.value)}
                  className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-extrabold text-blue-950 focus:ring-2 focus:ring-cyan-400 outline-none cursor-pointer"
                >
                  {listaProfessores.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Botão de Auditoria Direta das Aulas Atribuídas deste Professor */}
              <button
                type="button"
                onClick={() => {
                  setAuditoriaFiltroProfessor(professorSelecionado || 'TODOS');
                  setIsAuditoriaAulasModalOpen(true);
                }}
                className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition cursor-pointer border border-amber-400"
                title={`Auditar e gerenciar lista de aulas atribuídas para ${professorSelecionado}`}
              >
                <i className="fa-solid fa-list-check text-sm"></i>
                <span>Auditar Aulas Atribuídas ({professorSelecionado ? professorSelecionado.split(' ')[0] : 'Docente'})</span>
              </button>

              {/* Toggle de Filtro por Horário de Trabalho na Escola */}
              <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer shadow-2xs hover:bg-slate-50 transition select-none">
                <input
                  type="checkbox"
                  checked={apenasHorariosNaEscola}
                  onChange={(e) => setApenasHorariosNaEscola(e.target.checked)}
                  className="rounded text-cyan-600 focus:ring-cyan-500 w-4 h-4 cursor-pointer"
                />
                <span>Filtrar Apenas Períodos de Trabalho na Escola</span>
              </label>

              {/* Badges de Carga Horária, Substituições e Saldo Efetivo do Professor Selecionado */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs" title="Aulas regulares atribuídas na grade oficial de horários">
                  <i className="fa-solid fa-calculator text-[10px] text-emerald-700"></i>
                  <span>Aulas na Grade: {estatisticasProfessor.aulasRegulares}</span>
                </span>
                <span className="bg-blue-100 text-blue-900 border border-blue-300 px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs" title="Aulas assumidas como substituto (+1 por aula)">
                  <i className="fa-solid fa-user-plus text-[10px] text-blue-700"></i>
                  <span>Créditos (+): +{estatisticasProfessor.creditosSubst}</span>
                </span>
                <span className="bg-rose-100 text-rose-900 border border-rose-300 px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs" title="Ausências registradas (-1 por aula)">
                  <i className="fa-solid fa-user-minus text-[10px] text-rose-700"></i>
                  <span>Débitos (-): -{estatisticasProfessor.debitosSubst}</span>
                </span>
                <span className={`border px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs font-extrabold ${
                  estatisticasProfessor.saldoAcumulado > 0
                    ? 'bg-emerald-200 text-emerald-950 border-emerald-400'
                    : estatisticasProfessor.saldoAcumulado < 0
                    ? 'bg-rose-200 text-rose-950 border-rose-400'
                    : 'bg-slate-100 text-slate-800 border-slate-300'
                }`} title="Saldo acumulado de substituições (Créditos - Débitos + Saldo Inicial)">
                  <i className="fa-solid fa-scale-balanced text-[10px]"></i>
                  <span>Saldo de Substituição: {estatisticasProfessor.saldoAcumulado > 0 ? `+${estatisticasProfessor.saldoAcumulado}` : estatisticasProfessor.saldoAcumulado} aula(s)</span>
                </span>
                <span className="bg-indigo-100 text-indigo-950 border border-indigo-300 px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs" title="Carga horária total efetiva (Aulas na Grade + Saldo de Substituição)">
                  <i className="fa-solid fa-award text-[10px] text-indigo-700"></i>
                  <span>Carga Efetiva: {estatisticasProfessor.saldoTotalEfetivo} aula(s)</span>
                </span>
                <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-2xs" title="Compromissos sem aula (ATPC, Formação, Almoço, Inativo, etc.)">
                  <i className="fa-solid fa-user-clock text-[10px] text-amber-700"></i>
                  <span>Inativos/ATPC: {estatisticasProfessor.compromissosInativos}</span>
                </span>
              </div>
            </div>
          )}

          {modoVisao === 'por_sala' && (
            <div className="flex items-center gap-3">
              <label className="text-xs font-extrabold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <i className="fa-solid fa-filter text-cyan-600"></i>
                <span>Selecione a Sala / Ambiente:</span>
              </label>
              <select
                value={salaSelecionada}
                onChange={(e) => setSalaSelecionada(e.target.value)}
                className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-extrabold text-blue-950 focus:ring-2 focus:ring-cyan-400 outline-none cursor-pointer"
              >
                {listaSalas.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {modoVisao === 'matriz_geral' && (
            <p className="text-xs text-slate-500 font-medium">
              Exibindo a matriz horária completa de todas as turmas e aulas cadastradas no sistema.
            </p>
          )}
        </div>
      </div>

      {/* Banner do Modo Planilha Ativo */}
      {modoPlanilha && podeEditar && (
        <div className="bg-emerald-950 text-emerald-100 p-4 rounded-2xl border border-emerald-700 shadow-md flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-300 flex items-center justify-center text-xl font-black border border-emerald-400">
              <i className="fa-solid fa-file-excel"></i>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                <span>Modo Planilha (Edição Direta) Ativo</span>
                <span className="bg-emerald-500 text-emerald-950 text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase">Ao Vivo</span>
              </p>
              <p className="text-[11px] text-emerald-200/90 mt-0.5">
                Edite matérias, professores e salas diretamente nos seletores de cada célula. Salve instantaneamente no Firestore em tempo real.
              </p>
            </div>
          </div>
          <button
            onClick={() => setModoPlanilha(false)}
            className="bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl border border-emerald-600 transition cursor-pointer shadow-xs"
          >
            Sair do Modo Planilha
          </button>
        </div>
      )}

      {/* Control Banner de Arraste e Solte (Drag & Drop) e Duplicação Rápida */}
      {podeEditar && !modoPlanilha && (
        <div className="bg-slate-900 text-white p-3 sm:p-4 rounded-2xl border border-slate-800 shadow-md flex flex-wrap items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-100 text-cyan-300 flex items-center justify-center text-lg font-black border border-cyan-400 shrink-0">
              <i className="fa-solid fa-up-down-left-right"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase text-cyan-300 tracking-wider">
                  Edição Rápida & Arraste com o Mouse
                </span>
                <span className="bg-cyan-100 text-cyan-200 border border-cyan-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Ativo
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Arraste qualquer aula para mudar de lugar. Para <strong className="text-amber-300">duplicar</strong>, selecione a chave abaixo ou segure a tecla <kbd className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 text-cyan-300 text-[10px] font-mono">ALT</kbd> ao arrastar.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setModoDuplicarComArrasto(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                !modoDuplicarComArrasto
                  ? 'bg-cyan-400 text-blue-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <i className="fa-solid fa-up-down-left-right text-[10px]"></i>
              <span>Mover Aula</span>
            </button>

            <button
              type="button"
              onClick={() => setModoDuplicarComArrasto(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                modoDuplicarComArrasto
                  ? 'bg-amber-400 text-amber-950 shadow-sm ring-2 ring-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <i className="fa-solid fa-clone text-[10px]"></i>
              <span>Duplicar (Copiar)</span>
            </button>
          </div>
        </div>
      )}

      {/* Banners Informativos de Filtros Ativos (Turno / Indisponibilidade) */}
      {modoVisao === 'por_turma' && suprimirTurnosOutros && (isEnsinoMedio || isEnsinoFundamental) && (
        <div className="mb-3 bg-blue-50 border border-blue-200 p-2.5 px-4 rounded-xl text-xs font-semibold text-blue-950 flex items-center justify-between gap-2 flex-wrap shadow-2xs">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-eye-slash text-blue-600 text-sm"></i>
            <span>
              <strong>Visão por Turma Otimizada:</strong> {isEnsinoMedio ? `As aulas da manhã foram suprimidas para a turma do Ensino Médio (${turmaSelecionada}).` : `As aulas da tarde foram suprimidas para a turma do Ensino Fundamental (${turmaSelecionada}).`}
            </span>
          </div>
          <button
            onClick={() => setSuprimirTurnosOutros(false)}
            className="text-[11px] font-extrabold text-blue-700 hover:text-blue-900 underline cursor-pointer"
          >
            Exibir Grade Completa (Todos os Horários)
          </button>
        </div>
      )}

      {modoVisao === 'por_professor' && (
        <div className="mb-3 bg-slate-100 border border-slate-300 p-2.5 px-4 rounded-xl text-xs font-semibold text-slate-900 flex items-center justify-between gap-2 flex-wrap shadow-2xs">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-user-clock text-indigo-600 text-sm"></i>
            <span>
              <strong>Indisponibilidade Docente:</strong> Exibindo horários de presença na escola de {professorSelecionado}.
            </span>
          </div>
          <button
            onClick={() => setApenasHorariosNaEscola(!apenasHorariosNaEscola)}
            className="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
          >
            {apenasHorariosNaEscola ? 'Ver Matriz Completa de 14 Períodos' : 'Ocultar Períodos Sem Presença'}
          </button>
        </div>
      )}

      {/* Título de Impressão */}
      <div className="hidden print:block text-center border-b pb-4 mb-4">
        <h2 className="text-xl font-bold uppercase">Escola Estadual Clóvis de Lucca</h2>
        <h3 className="text-base font-semibold">Grade Horária de Aulas - PEI (Programa Ensino Integral)</h3>
        <p className="text-xs text-slate-600">
          Visualização: {modoVisao === 'por_turma' ? `Turma ${turmaSelecionada}` : modoVisao === 'por_professor' ? `Professor: ${professorSelecionado}` : modoVisao === 'por_sala' ? `Sala: ${salaSelecionada}` : 'Visão Geral'}
        </p>
      </div>

      {/* Tabela / Grid Principal do Horário */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <i className="fa-solid fa-spinner fa-spin text-3xl text-cyan-500 mb-3 block"></i>
          <p className="text-sm font-bold text-slate-700">Carregando grade horária...</p>
        </div>
      ) : (
        <>
          {/* VISUALIZAÇÃO DESKTOP / TABLET (Intacta em md:block) */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-blue-950 text-white text-xs font-black uppercase tracking-wider">
                  <th className="p-3.5 border-b border-blue-900 w-36 text-center">Horário / Período</th>
                  {DIAS_SEMANA.map((dia) => {
                    const ehHoje = agoraInfo.diaId === dia.id;
                    return (
                      <th
                        key={dia.id}
                        className={`p-3.5 border-b border-blue-900 text-center ${
                          ehHoje ? 'bg-cyan-500 text-blue-950 font-black' : ''
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span>{dia.label}</span>
                          {ehHoje && <span className="bg-blue-950 text-cyan-300 text-[10px] px-1.5 py-0.5 rounded uppercase">Hoje</span>}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs font-medium">
                {periodosToRender.map((periodo) => {
                  const isIntervalo = periodo.tipo === 'intervalo';

                  return (
                    <tr key={periodo.id} className={`transition ${isIntervalo ? 'bg-amber-50 hover:bg-amber-50' : 'hover:bg-slate-50'}`}>
                      {/* Coluna do Horário */}
                      <td className={`p-3 border-r border-slate-200 text-center font-bold ${isIntervalo ? 'bg-amber-100/50' : 'bg-slate-50'}`}>
                        <div className="flex items-center justify-center gap-1">
                          {isIntervalo && <i className="fa-solid fa-mug-hot text-amber-600 text-xs mr-0.5"></i>}
                          <span className="text-cyan-900 font-extrabold text-xs">{periodo.rotulo}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{periodo.horario}</div>
                        {isIntervalo && (
                          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-amber-200/80 text-amber-900 rounded mt-1 inline-block">
                            PEI Flexível
                          </span>
                        )}
                      </td>

                      {/* Colunas dos Dias da Semana */}
                      {DIAS_SEMANA.map((dia) => {
                        const ehAulaAgora = agoraInfo.diaId === dia.id && getPeriodoOrder(agoraInfo.periodoId) === getPeriodoOrder(periodo.id);
                        const isTargetCell = dragOverTarget?.dia === dia.id && getPeriodoOrder(dragOverTarget?.periodoId) === getPeriodoOrder(periodo.id);

                        // Aulas/Atividades neste slot específico
                        const aulasNoSlot = horariosFiltrados.filter((h) => {
                          if (h.dia !== dia.id) return false;
                          if (isIntervalo) {
                            return String(h.periodoId).toLowerCase().trim() === String(periodo.id).toLowerCase().trim();
                          }
                          const hIdStr = String(h.periodoId).toLowerCase().trim();
                          if (hIdStr.startsWith('int') || hIdStr.includes('almoco') || hIdStr.includes('almoço') || hIdStr.includes('jantar')) {
                            return false;
                          }
                          return getPeriodoOrder(h.periodoId) === getPeriodoOrder(periodo.id);
                        });

                        // Status do Docente na Escola (se estiver no Modo por Professor)
                        const statusDocente = (modoVisao === 'por_professor' && professorSelecionado)
                          ? isTeacherAtSchool(professorSelecionado, dia.id, periodo.id, indisponibilidadeProfs, horariosEfetivos, cadastroProfessores)
                          : null;

                        return (
                          <td
                            key={dia.id}
                            onDragOver={(e) => !isIntervalo && handleDragOverCell(e, dia.id, periodo.id)}
                            onDragLeave={handleDragLeaveCell}
                            onDrop={(e) => !isIntervalo && handleDropCell(e, dia.id, periodo.id)}
                            className={`p-2 border-r border-slate-200 align-top transition min-h-[90px] relative ${
                              isTargetCell
                                ? 'bg-cyan-100/90 ring-4 ring-cyan-500 ring-inset border-2 border-dashed border-cyan-600 shadow-lg scale-[1.01] z-20'
                                : ehAulaAgora
                                ? 'bg-cyan-50/60 ring-2 ring-inset ring-cyan-400'
                                : statusDocente && !statusDocente.atSchool
                                ? 'bg-slate-50'
                                : isIntervalo
                                ? 'bg-amber-50/30'
                                : ''
                            }`}
                          >
                            {/* Overlay de Arraste na Célula Alvo */}
                            {isTargetCell && (
                              <div className="absolute inset-0 bg-cyan-500/10 backdrop-blur-[1px] rounded-xl flex items-center justify-center pointer-events-none z-30 p-1">
                                <span className="bg-blue-950 text-cyan-200 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border border-cyan-400 shadow-md flex items-center gap-1.5 animate-bounce">
                                  <i className={`fa-solid ${modoDuplicarComArrasto ? 'fa-clone text-amber-300' : 'fa-hand-holding-hand text-cyan-300'}`}></i>
                                  <span>{modoDuplicarComArrasto ? 'Solte para Duplicar Cópia' : 'Solte para Mover Aula'}</span>
                                </span>
                              </div>
                            )}

                            {aulasNoSlot.length === 0 ? (
                              isIntervalo ? (
                                <div className="h-full min-h-[60px] flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-amber-200/80 bg-amber-50/50 text-amber-800">
                                  <span className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
                                    <i className="fa-solid fa-mug-hot text-amber-600 text-xs"></i>
                                    <span>{periodo.rotulo}</span>
                                  </span>
                                  <span className="text-[10px] text-amber-600/70 font-mono mt-0.5">{periodo.horario}</span>
                                </div>
                              ) : statusDocente && !statusDocente.atSchool ? (
                                <div
                                  className={`h-full min-h-[70px] flex flex-col items-center justify-center p-2 rounded-xl border shadow-2xs group relative cursor-help ${
                                    statusDocente.reason?.includes('Indisponibilidade')
                                      ? 'border-rose-300/80 bg-[repeating-linear-gradient(135deg,#fff1f2,#fff1f2_8px,#ffe4e6_8px,#ffe4e6_16px)] text-rose-800'
                                      : 'border-slate-300/80 bg-[repeating-linear-gradient(135deg,#f8fafc,#f8fafc_8px,#f1f5f9_8px,#f1f5f9_16px)] text-slate-500'
                                  }`}
                                  title={statusDocente.reason}
                                >
                                  <div className="flex items-center gap-1.5 font-extrabold text-[11px] uppercase tracking-tight">
                                    <i className={`fa-solid ${statusDocente.reason?.includes('Indisponibilidade') ? 'fa-ban text-rose-500' : 'fa-clock-slash text-slate-400'}`}></i>
                                    <span className={statusDocente.reason?.includes('Indisponibilidade') ? 'text-rose-700' : 'text-slate-600'}>
                                      {statusDocente.reason?.includes('Indisponibilidade') ? 'Indisponível' : 'Fora do Horário'}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-medium text-center mt-0.5 line-clamp-2 px-1 opacity-90">
                                    {statusDocente.reason}
                                  </span>
                                  {podeEditar && (
                                    <button
                                      onClick={() => modoPlanilha ? handleCriarNovaAulaPlanilha(dia.id, periodo.id) : handleAbrirModalNovo(dia.id, periodo.id)}
                                      className="text-[9px] font-bold text-blue-700 hover:text-blue-900 mt-1 opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-white/90 px-1.5 py-0.5 rounded border border-blue-200"
                                    >
                                      <i className="fa-solid fa-plus text-[8px]"></i> + Inserir
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="h-full min-h-[70px] flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 transition group">
                                  <span className="text-[11px] font-bold text-slate-400 group-hover:text-emerald-700 flex items-center gap-1">
                                    <i className="fa-regular fa-circle-check text-emerald-500/80 group-hover:text-emerald-600 text-[10px]"></i>
                                    <span>Vazio (Disponível)</span>
                                  </span>
                                  {podeEditar && (
                                    <button
                                      onClick={() => modoPlanilha ? handleCriarNovaAulaPlanilha(dia.id, periodo.id) : handleAbrirModalNovo(dia.id, periodo.id)}
                                      className={`text-[10px] font-bold mt-1 flex items-center gap-1 hover:underline cursor-pointer ${
                                        modoPlanilha
                                          ? 'text-emerald-800 opacity-100 bg-emerald-100/90 hover:bg-emerald-200 px-2.5 py-1 rounded-lg border border-emerald-300 shadow-2xs font-extrabold'
                                          : 'text-emerald-700 opacity-0 group-hover:opacity-100'
                                      }`}
                                    >
                                      <i className="fa-solid fa-plus text-[9px]"></i> {modoPlanilha ? 'Inserir' : 'Alocar Aula'}
                                    </button>
                                  )}
                                </div>
                              )
                            ) : (
                              <div className="space-y-1.5">
                                {aulasNoSlot.map((aula) => {
                                  const draft = inlineDrafts[aula.id] || {};
                                  const currentDisciplina = draft.disciplina !== undefined ? draft.disciplina : aula.disciplina;
                                  const currentProfessor = draft.professor !== undefined ? draft.professor : aula.professor;
                                  const currentSala = draft.sala !== undefined ? draft.sala : aula.sala;
                                  const currentTurma = draft.turma !== undefined ? draft.turma : aula.turma;

                                  // Visualização em Modo Planilha (Edição Direta)
                                  if (modoPlanilha && podeEditar) {
                                    return (
                                      <div
                                        key={aula.id}
                                        className="p-2 bg-emerald-50/90 border-2 border-emerald-400 rounded-xl shadow-xs space-y-1.5 text-xs animate-fadeIn"
                                      >
                                        {/* Campo Disciplina */}
                                        <div>
                                          <label className="text-[9px] font-black uppercase text-emerald-950 block mb-0.5">
                                            Matéria / Disciplina
                                          </label>
                                          <select
                                            value={currentDisciplina}
                                            onChange={(e) => handleDraftChange(aula.id, 'disciplina', e.target.value)}
                                            className="w-full p-1 bg-white border border-emerald-300 rounded-lg text-[11px] font-extrabold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                          >
                                            {LISTA_DISCIPLINAS_SUGERIDAS.map((d) => (
                                              <option key={d} value={d}>{d}</option>
                                            ))}
                                            {!LISTA_DISCIPLINAS_SUGERIDAS.includes(currentDisciplina) && (
                                              <option value={currentDisciplina}>{currentDisciplina}</option>
                                            )}
                                          </select>
                                        </div>

                                        {/* Campo Professor */}
                                        <div>
                                          <label className="text-[9px] font-black uppercase text-emerald-950 block mb-0.5">
                                            Professor Responsável
                                          </label>
                                          <select
                                            value={currentProfessor}
                                            onChange={(e) => handleDraftChange(aula.id, 'professor', e.target.value)}
                                            className="w-full p-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                          >
                                            {listaProfessores.map((p) => (
                                              <option key={p} value={p}>{p}</option>
                                            ))}
                                            {!listaProfessores.includes(currentProfessor) && (
                                              <option value={currentProfessor}>{currentProfessor}</option>
                                            )}
                                          </select>
                                        </div>

                                        {/* Campo Sala */}
                                        <div>
                                          <label className="text-[9px] font-black uppercase text-emerald-950 block mb-0.5">
                                            Sala / Espaço
                                          </label>
                                          <select
                                            value={currentSala}
                                            onChange={(e) => handleDraftChange(aula.id, 'sala', e.target.value)}
                                            className="w-full p-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-semibold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                          >
                                            {listaSalas.map((s) => (
                                              <option key={s} value={s}>{s}</option>
                                            ))}
                                            {!listaSalas.includes(currentSala) && (
                                              <option value={currentSala}>{currentSala}</option>
                                            )}
                                          </select>
                                        </div>

                                        {/* Campo Turma (se não for visualização por turma) */}
                                        {modoVisao !== 'por_turma' && (
                                          <div>
                                            <label className="text-[9px] font-black uppercase text-emerald-950 block mb-0.5">
                                              Turma
                                            </label>
                                            <select
                                              value={currentTurma}
                                              onChange={(e) => handleDraftChange(aula.id, 'turma', e.target.value)}
                                              className="w-full p-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-bold text-blue-900 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                            >
                                              {listaTurmas.map((t) => (
                                                <option key={t} value={t}>{t}</option>
                                              ))}
                                              {!listaTurmas.includes(currentTurma) && (
                                                <option value={currentTurma}>{currentTurma}</option>
                                              )}
                                            </select>
                                          </div>
                                        )}

                                        {/* Campo Contar no saldo / Status */}
                                        <div>
                                          <label className="text-[9px] font-black uppercase text-emerald-950 block mb-0.5">
                                            Contar no Saldo?
                                          </label>
                                          <select
                                            value={draft.contarSaldo !== undefined ? (draft.contarSaldo ? 'true' : 'false') : ((aula.contarSaldo !== false && aula.ativo !== false) ? 'true' : 'false')}
                                            onChange={(e) => handleDraftChange(aula.id, 'contarSaldo', e.target.value === 'true')}
                                            className="w-full p-1 bg-white border border-emerald-300 rounded-lg text-[10px] font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                          >
                                            <option value="true">Ativo (Conta Saldo)</option>
                                            <option value="false">Inativo (Bloqueia p/ Subst.)</option>
                                          </select>
                                        </div>

                                        {/* Botões da Célula Planilha */}
                                        <div className="flex items-center justify-between pt-1 border-t border-emerald-200/80 gap-1">
                                          <div className="flex items-center gap-1">
                                            <button
                                              onClick={() => handleSalvarCelulaDireta(aula)}
                                              className="px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-[10px] rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer transition"
                                              title="Salvar alterações no Firestore"
                                            >
                                              <i className="fa-solid fa-floppy-disk text-[10px]"></i>
                                              <span>Salvar</span>
                                            </button>
                                            <button
                                              onClick={() => handleDuplicarHorario(aula)}
                                              className="px-2 py-1 bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-[10px] rounded-lg flex items-center gap-1 shadow-2xs cursor-pointer transition"
                                              title="Duplicar esta aula"
                                            >
                                              <i className="fa-solid fa-clone text-[10px]"></i>
                                              <span>Copiar</span>
                                            </button>
                                          </div>

                                          <button
                                            onClick={() => handleExcluirHorario(aula.id)}
                                            className="p-1 text-rose-600 hover:bg-rose-100 rounded-md transition cursor-pointer"
                                            title="Excluir aula"
                                          >
                                            <i className="fa-solid fa-trash text-[10px]"></i>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  // Visualização Padrão da Aula (Com Suporte a Drag and Drop & Duplicação Rápida)
                                  const cores = getCorDisciplina(aula.disciplina);
                                  const isInativo = aula.contarSaldo === false || aula.ativo === false;
                                  const isBeingDragged = draggedAula?.id === aula.id;

                                  return (
                                    <div
                                      key={aula.id}
                                      draggable={podeEditar}
                                      onDragStart={(e) => handleDragStart(e, aula)}
                                      className={`p-2.5 rounded-xl border ${cores.bg} shadow-2xs relative group transition-all hover:shadow-md ${
                                        podeEditar ? 'cursor-grab active:cursor-grabbing hover:border-cyan-500' : ''
                                      } ${isBeingDragged ? 'opacity-30 scale-95 border-dashed border-cyan-600' : ''}`}
                                    >
                                      {/* Badge Disciplina & Status */}
                                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                        <div className="flex items-center gap-1">
                                          {podeEditar && (
                                            <span className="text-slate-400 group-hover:text-cyan-700 cursor-grab active:cursor-grabbing transition" title="Clique e arraste para mover de horário ou duplicar">
                                              <i className="fa-solid fa-grip-vertical text-[10px]"></i>
                                            </span>
                                          )}
                                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${cores.badge}`}>
                                            {aula.disciplina}
                                          </span>
                                          {isInativo && (
                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-md flex items-center gap-1" title="Inativo: Não conta no saldo de aulas, mas bloqueia o professor no motor de substituição">
                                              <i className="fa-solid fa-circle-pause text-[8px]"></i>
                                              Inativo
                                            </span>
                                          )}
                                        </div>

                                        {podeEditar && (
                                          <div className="opacity-85 sm:opacity-70 group-hover:opacity-100 transition flex items-center gap-1 print:hidden">
                                            <button
                                              onClick={() => handleDuplicarHorario(aula)}
                                              className="p-1 hover:bg-cyan-100 text-cyan-800 rounded transition cursor-pointer"
                                              title="Duplicar esta aula instantaneamente"
                                            >
                                              <i className="fa-solid fa-clone text-[10px]"></i>
                                            </button>
                                            <button
                                              onClick={() => handleAbrirModalEdicao(aula)}
                                              className="p-1 hover:bg-white/80 text-slate-700 rounded transition cursor-pointer"
                                              title="Editar Aula"
                                            >
                                              <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                            </button>
                                            <button
                                              onClick={() => handleExcluirHorario(aula.id)}
                                              className="p-1 hover:bg-rose-200 text-rose-700 rounded transition cursor-pointer"
                                              title="Excluir Aula"
                                            >
                                              <i className="fa-solid fa-trash text-[10px]"></i>
                                            </button>
                                          </div>
                                        )}
                                      </div>

                                      {/* Informações da Aula */}
                                      <div className="space-y-0.5">
                                        {modoVisao !== 'por_professor' && (
                                          <p className="font-extrabold text-[11px] leading-tight flex items-center gap-1">
                                            <i className="fa-solid fa-user-tie text-[10px] text-slate-500"></i>
                                            <span>{aula.professor}</span>
                                          </p>
                                        )}

                                        {modoVisao !== 'por_turma' && (
                                          <p className="font-bold text-[11px] text-blue-900 flex items-center gap-1">
                                            <i className="fa-solid fa-users text-[10px] text-blue-600"></i>
                                            <span>{aula.turma}</span>
                                          </p>
                                        )}

                                        {modoVisao !== 'por_sala' && (
                                          <p className="text-[10px] font-semibold text-slate-600 flex items-center gap-1 mt-0.5">
                                            <i className="fa-solid fa-location-dot text-[9px] text-rose-500"></i>
                                            <span>{aula.sala}</span>
                                          </p>
                                        )}


                                      </div>

                                      {ehAulaAgora && (
                                        <div className="mt-1.5 pt-1 border-t border-cyan-300 flex items-center gap-1 text-[9px] font-black text-cyan-900 uppercase tracking-tight">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                                          <span>Em Andamento</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* VISUALIZAÇÃO MOBILE (Telas pequenas - Cards / Accordions Verticais) */}
        <div className="block md:hidden space-y-3">
          {/* Header Informativo Mobile */}
          <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-900 text-white p-3.5 rounded-2xl border border-blue-800 shadow-sm flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-100 text-cyan-300 border border-cyan-400 flex items-center justify-center font-bold text-sm">
                <i className="fa-solid fa-mobile-screen"></i>
              </div>
              <div>
                <p className="font-extrabold text-white text-xs">Grade de Horários Mobile</p>
                <p className="text-[10px] text-cyan-200 font-medium">Iniciando por {DIAS_SEMANA.find(d => d.id === diaHojeId)?.label}</p>
              </div>
            </div>
            <span className="bg-cyan-400 text-blue-950 font-black text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider shadow-xs">
              {agoraInfo.diaId === diaHojeId ? 'Dia Atual' : 'Semana'}
            </span>
          </div>

          {/* Accordion dos Dias da Semana Reordenados */}
          <div className="space-y-3">
            {diasOrdenadosMobile.map((diaObj) => {
              const isHoje = diaObj.id === diaHojeId;
              const isExpanded = !!diasExpandidosMobile[diaObj.id];

              // Total de aulas alocadas para este dia
              const aulasDoDia = horariosFiltrados.filter(h => h.dia === diaObj.id);
              const totalAulasDia = aulasDoDia.length;

              return (
                <div
                  key={diaObj.id}
                  className={`rounded-2xl transition-all duration-200 overflow-hidden ${
                    isHoje
                      ? 'bg-white border-2 border-cyan-400 ring-2 ring-cyan-400/30 shadow-md'
                      : 'bg-white border border-slate-200 shadow-sm'
                  }`}
                >
                  {/* Cabeçalho do Cartão do Dia (Clicável) */}
                  <button
                    type="button"
                    onClick={() => toggleDiaMobile(diaObj.id)}
                    className={`w-full p-3.5 flex items-center justify-between transition cursor-pointer select-none text-left ${
                      isHoje ? 'bg-gradient-to-r from-cyan-50/80 via-white to-blue-50/30' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-2xs ${
                          isHoje
                            ? 'bg-cyan-400 text-blue-950 ring-2 ring-cyan-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {diaObj.short}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className={`font-black text-sm ${isHoje ? 'text-blue-950' : 'text-slate-800'}`}>
                            {diaObj.label}
                          </h3>
                          {isHoje && (
                            <span className="bg-cyan-400 text-blue-950 font-black text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-2xs">
                              HOJE
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] font-semibold text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>{totalAulasDia === 1 ? '1 aula alocada' : `${totalAulasDia} aulas alocadas`}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold transition ${
                        isExpanded ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                      </span>
                    </div>
                  </button>

                  {/* Conteúdo Expandido do Dia */}
                  {isExpanded && (
                    <div className="p-3 pt-0 border-t border-slate-100 divide-y divide-slate-100 space-y-2">
                      {periodosToRender.map((periodo) => {
                        const isIntervalo = periodo.tipo === 'intervalo';
                        const isAulaAtual = isHoje && infoAulaAtualMobile.periodoAtualId === periodo.id;
                        const isProximaAula = isHoje && infoAulaAtualMobile.proximoPeriodoId === periodo.id;

                        const aulasNoSlot = horariosFiltrados.filter((h) => {
                          if (h.dia !== diaObj.id) return false;
                          if (isIntervalo) {
                            return String(h.periodoId).toLowerCase().trim() === String(periodo.id).toLowerCase().trim();
                          }
                          const hIdStr = String(h.periodoId).toLowerCase().trim();
                          if (hIdStr.startsWith('int') || hIdStr.includes('almoco') || hIdStr.includes('almoço') || hIdStr.includes('jantar')) {
                            return false;
                          }
                          return getPeriodoOrder(h.periodoId) === getPeriodoOrder(periodo.id);
                        });

                        const statusDocente = (modoVisao === 'por_professor' && professorSelecionado)
                          ? isTeacherAtSchool(professorSelecionado, diaObj.id, periodo.id, indisponibilidadeProfs, horariosEfetivos, cadastroProfessores)
                          : null;

                        return (
                          <div
                            key={periodo.id}
                            className={`pt-2.5 pb-1 transition-all rounded-xl p-2.5 mt-2 ${
                              isAulaAtual
                                ? 'bg-cyan-50/90 border-2 border-cyan-400 ring-2 ring-cyan-400/20 shadow-xs'
                                : isProximaAula
                                ? 'bg-amber-50/80 border border-amber-300'
                                : isIntervalo
                                ? 'bg-amber-50/30 border border-amber-100'
                                : 'bg-slate-50 border border-slate-100'
                            }`}
                          >
                            {/* Cabeçalho do Período */}
                            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-xs text-blue-950 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                                  {periodo.rotulo}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 font-bold">
                                  {periodo.horario}
                                </span>
                              </div>

                              {/* Badges de Estado Visual Mobile */}
                              <div className="flex items-center gap-1">
                                {isAulaAtual && (
                                  <span className="bg-emerald-600 text-white font-black text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs animate-pulse">
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                                    AULA ATUAL
                                  </span>
                                )}
                                {isProximaAula && !isAulaAtual && (
                                  <span className="bg-amber-500 text-white font-black text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                                    <i className="fa-solid fa-clock text-[9px]"></i>
                                    PRÓXIMA AULA
                                  </span>
                                )}
                                {isIntervalo && (
                                  <span className="bg-amber-100 text-amber-800 font-bold text-[10px] px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                                    <i className="fa-solid fa-mug-hot text-[9px]"></i>
                                    Intervalo
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Aulas no Período */}
                            {aulasNoSlot.length === 0 ? (
                              isIntervalo ? (
                                <div className="p-2.5 rounded-xl border border-dashed border-amber-200 bg-amber-50/40 text-center text-xs text-amber-800 flex items-center justify-between">
                                  <span className="flex items-center gap-1.5 font-bold text-amber-800">
                                    <i className="fa-solid fa-mug-hot text-amber-600 text-[10px]"></i>
                                    <span>{periodo.rotulo}</span>
                                  </span>
                                  <span className="text-[10px] text-amber-600 font-mono">{periodo.horario}</span>
                                </div>
                              ) : statusDocente && !statusDocente.atSchool ? (
                                <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-100/70 text-slate-700 text-center text-xs space-y-0.5">
                                  <span className="font-extrabold text-slate-700 flex items-center justify-center gap-1">
                                    <i className={`fa-solid ${statusDocente.reason?.includes('Indisponibilidade') ? 'fa-ban text-rose-500' : 'fa-clock-slash text-slate-400'} text-[10px]`}></i>
                                    <span>{statusDocente.reason?.includes('Indisponibilidade') ? 'Indisponível' : 'Fora do Horário'}</span>
                                  </span>
                                  <span className="text-[10px] text-slate-500 block">{statusDocente.reason}</span>
                                  {podeEditar && (
                                    <button
                                      type="button"
                                      onClick={() => modoPlanilha ? handleCriarNovaAulaPlanilha(diaObj.id, periodo.id) : handleAbrirModalNovo(diaObj.id, periodo.id)}
                                      className="text-[10px] font-bold text-blue-700 bg-white hover:bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-md mt-1 cursor-pointer"
                                    >
                                      + Inserir
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="p-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/20 text-center text-xs text-slate-500 flex items-center justify-between">
                                  <span className="flex items-center gap-1 font-semibold text-emerald-800">
                                    <i className="fa-regular fa-circle-check text-emerald-600 text-[10px]"></i>
                                    <span>Vazio (Disponível)</span>
                                  </span>
                                  {podeEditar && (
                                    <button
                                      type="button"
                                      onClick={() => modoPlanilha ? handleCriarNovaAulaPlanilha(diaObj.id, periodo.id) : handleAbrirModalNovo(diaObj.id, periodo.id)}
                                      className="text-[10px] font-black text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 px-2 py-1 rounded-lg cursor-pointer"
                                    >
                                      + Alocar
                                    </button>
                                  )}
                                </div>
                              )
                            ) : (
                              <div className="space-y-2">
                                {aulasNoSlot.map((aula) => {
                                  const cores = getCorDisciplina(aula.disciplina);
                                  const isInativo = aula.contarSaldo === false || aula.ativo === false;

                                  return (
                                    <div
                                      key={aula.id}
                                      className={`p-3 rounded-xl border ${cores.bg} shadow-2xs relative space-y-1`}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className={`text-xs font-black uppercase px-2 py-0.5 rounded-md ${cores.badge}`}>
                                          {aula.disciplina}
                                        </span>

                                        {podeEditar && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => handleDuplicarHorario(aula)}
                                              className="p-1 hover:bg-cyan-100 text-cyan-800 rounded transition cursor-pointer"
                                              title="Duplicar"
                                            >
                                              <i className="fa-solid fa-clone text-xs"></i>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAbrirModalEdicao(aula)}
                                              className="p-1 hover:bg-white/80 text-slate-700 rounded transition cursor-pointer"
                                              title="Editar"
                                            >
                                              <i className="fa-solid fa-pen-to-square text-xs"></i>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleExcluirHorario(aula.id)}
                                              className="p-1 hover:bg-rose-200 text-rose-700 rounded transition cursor-pointer"
                                              title="Excluir"
                                            >
                                              <i className="fa-solid fa-trash text-xs"></i>
                                            </button>
                                          </div>
                                        )}
                                      </div>

                                      <div className="text-xs space-y-0.5 pt-0.5">
                                        {modoVisao !== 'por_professor' && (
                                          <p className="font-extrabold text-slate-900 flex items-center gap-1.5">
                                            <i className="fa-solid fa-user-tie text-slate-500 text-[10px]"></i>
                                            <span>{aula.professor}</span>
                                          </p>
                                        )}
                                        {modoVisao !== 'por_turma' && (
                                          <p className="font-bold text-blue-900 flex items-center gap-1.5">
                                            <i className="fa-solid fa-users text-blue-600 text-[10px]"></i>
                                            <span>{aula.turma}</span>
                                          </p>
                                        )}
                                        {modoVisao !== 'por_sala' && (
                                          <p className="font-semibold text-slate-600 flex items-center gap-1.5">
                                            <i className="fa-solid fa-location-dot text-rose-500 text-[10px]"></i>
                                            <span>{aula.sala}</span>
                                          </p>
                                        )}
                                      </div>

                                      {isInativo && (
                                        <span className="inline-block text-[9px] font-extrabold px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded mt-1">
                                          Inativo (Não conta no saldo)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PAINEL DE AUDITORIA E GESTÃO DE GRADE EXCLUSIVO DO DIRETOR (VISUALIZAÇÃO POR PROFESSOR) */}
        {modoVisao === 'por_professor' && (typeof window.obterRoleAtual === 'function' ? window.obterRoleAtual() === 'DIRETOR' : isDiretor) && (
          <div className="mt-8 bg-white border-2 border-amber-300 rounded-2xl shadow-md overflow-hidden animate-fadeIn print:hidden">
            {/* Header do Painel Diretor */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 p-4 sm:p-5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-amber-400/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-lg shadow-sm shrink-0">
                  <i className="fa-solid fa-clipboard-check"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-sm sm:text-base text-white tracking-wide">
                      Painel de Auditoria e Gestão de Grade
                    </h3>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 px-2 py-0.5 rounded-md shadow-xs">
                      Exclusivo Diretor
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-medium mt-0.5">
                    Trilha de auditoria das aulas de <strong className="text-amber-300">{professorSelecionado}</strong> com comandos de exclusão direta.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleLimparGradeProfessorDiretor(professorSelecionado)}
                  disabled={aulasDoProfessorOrdenadas.length === 0 || salvando}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 transition cursor-pointer shadow-sm ${
                    aulasDoProfessorOrdenadas.length === 0
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                      : 'bg-rose-600 hover:bg-rose-700 active:scale-95 text-white border border-rose-400'
                  }`}
                  title={`Remover permanentemente todas as ${aulasDoProfessorOrdenadas.length} aulas de ${professorSelecionado} da grade`}
                >
                  <i className="fa-solid fa-trash-can-arrow-up text-sm"></i>
                  <span>Limpar Toda a Grade deste Professor</span>
                </button>
              </div>
            </div>

            {/* Conteúdo / Tabela de Aulas do Professor */}
            <div className="p-4 sm:p-5">
              {aulasDoProfessorOrdenadas.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-500">
                  <i className="fa-solid fa-calendar-xmark text-3xl mb-2 text-slate-400"></i>
                  <p className="font-bold text-sm text-slate-700">Nenhuma aula atribuída no momento</p>
                  <p className="text-xs text-slate-500 mt-1">
                    O docente <strong>{professorSelecionado}</strong> não possui aulas registradas na grade horária semanal.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                        <th className="p-3 rounded-l-xl">Dia da Semana</th>
                        <th className="p-3">Período / Horário</th>
                        <th className="p-3">Disciplina</th>
                        <th className="p-3">Turma</th>
                        <th className="p-3">Sala</th>
                        <th className="p-3 text-center">Tipo / Carga</th>
                        <th className="p-3 text-right rounded-r-xl">Ação do Diretor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {aulasDoProfessorOrdenadas.map((aula) => {
                        const estiloCor = getCorDisciplina(aula.disciplina);
                        const diaObj = DIAS_SEMANA.find(d => normalizarDia(d.id) === normalizarDia(aula.dia));
                        const rotuloP = getPeriodoRotulo(aula.periodoId);
                        const slotObj = periodosAula.find(p => String(p.id) === String(aula.periodoId));
                        const isInativo = !isRegularTeachingClass(aula.disciplina);

                        return (
                          <tr
                            key={aula.id || `${aula.dia}_${aula.periodoId}_${aula.turma}`}
                            className="hover:bg-slate-50/90 transition group"
                          >
                            <td className="p-3 font-extrabold text-slate-900 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-cyan-600"></span>
                              <span>{diaObj?.label || aula.dia}</span>
                            </td>
                            <td className="p-3 font-bold text-slate-700">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-900 rounded font-black text-[11px]">
                                  {rotuloP}
                                </span>
                                {slotObj && (
                                  <span className="text-[11px] text-slate-500 font-normal">
                                    ({slotObj.inicio} - {slotObj.fim})
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              <span className={`px-2.5 py-1 rounded-lg border text-xs inline-flex items-center gap-1.5 shadow-2xs ${estiloCor.bg}`}>
                                <span>{aula.disciplina}</span>
                              </span>
                            </td>
                            <td className="p-3 font-black text-blue-950">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded border border-slate-200">
                                {aula.turma}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-slate-600">
                              <span className="flex items-center gap-1">
                                <i className="fa-solid fa-location-dot text-rose-500 text-[10px]"></i>
                                <span>{aula.sala || 'Sala Padrão'}</span>
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              {isInativo ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-bold">
                                  Inativo / Formação
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded text-[10px] font-bold">
                                  Aula Regular (+1)
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleExcluirAulaAuditoria(aula)}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-xl text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                                title={`Excluir esta aula de ${aula.disciplina} (${aula.turma})`}
                              >
                                <i className="fa-solid fa-trash-can text-rose-600 text-xs"></i>
                                <span>Excluir</span>
                              </button>
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
        )}
      </>
      )}

      {/* MODAL ADICIONAR / EDITAR HORÁRIO */}
      {isModalOpen && podeEditar && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-blue-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-clock text-cyan-300"></i>
                <h3 className="font-extrabold text-sm uppercase">
                  {itemEdicao ? 'Editar Aula no Horário' : 'Alocar Nova Aula na Grade'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSalvarHorario} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                {/* Dia da Semana */}
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Dia da Semana</label>
                  <select
                    value={form.dia}
                    onChange={(e) => setForm({ ...form, dia: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                    required
                  >
                    {DIAS_SEMANA.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                </div>

                {/* Período / Horário */}
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Período / Horário</label>
                  <select
                    value={form.periodoId}
                    onChange={(e) => setForm({ ...form, periodoId: Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                    required
                  >
                    {periodosAula.filter(p => p.tipo === 'aula').map((p) => (
                      <option key={p.id} value={p.id}>{p.rotulo} ({p.horario})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Turma */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Turma PEI</label>
                <input
                  type="text"
                  list="lista-turmas-datalist"
                  value={form.turma}
                  onChange={(e) => setForm({ ...form, turma: e.target.value })}
                  placeholder="Ex: 6º Ano A"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                  required
                />
                <datalist id="lista-turmas-datalist">
                  {TURMAS_PADRAO.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>

              {/* Disciplina */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Disciplina</label>
                <input
                  type="text"
                  list="lista-disciplinas-datalist"
                  value={form.disciplina}
                  onChange={(e) => setForm({ ...form, disciplina: e.target.value })}
                  placeholder="Ex: Língua Portuguesa"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                  required
                />
                <datalist id="lista-disciplinas-datalist">
                  {Object.keys(DISCIPLINAS_CORES).map(d => <option key={d} value={d} />)}
                </datalist>
              </div>

              {/* Professor */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Professor(a) Responsável</label>
                <input
                  type="text"
                  list="lista-profs-datalist"
                  value={form.professor}
                  onChange={(e) => setForm({ ...form, professor: e.target.value })}
                  placeholder="Ex: Profª Maria Silva"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                  required
                />
                <datalist id="lista-profs-datalist">
                  {PROFESSORES_PADRAO.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>

              {/* Sala / Espaço */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">Sala / Ambiente de Aprendizagem</label>
                <input
                  type="text"
                  list="lista-salas-datalist"
                  value={form.sala}
                  onChange={(e) => setForm({ ...form, sala: e.target.value })}
                  placeholder="Ex: Sala 01 (6ºA) ou Laboratório de Ciências"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-cyan-400"
                  required
                />
                <datalist id="lista-salas-datalist">
                  {SALAS_PADRAO.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              {/* Contar no saldo de aulas? (Ativo / Inativo) */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <label className="block text-xs font-extrabold text-slate-800 uppercase flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-calculator text-cyan-600"></i>
                    <span>Contar no saldo de aulas? (Carga Horária)</span>
                  </span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                    form.contarSaldo !== false
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}>
                    {form.contarSaldo !== false ? 'Ativo (Conta Saldo)' : 'Inativo (Bloqueia p/ Substituição)'}
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contarSaldo: true })}
                    className={`p-2 rounded-xl font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      form.contarSaldo !== false
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <i className="fa-solid fa-circle-check"></i>
                    <span>Ativo (Aula Regular)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contarSaldo: false })}
                    className={`p-2 rounded-xl font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      form.contarSaldo === false
                        ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <i className="fa-solid fa-circle-pause"></i>
                    <span>Inativo (Atendimento/Reunião)</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 italic">
                  {form.contarSaldo !== false
                    ? 'Aulas ativas somam no saldo de regência semanal do professor e o ocupam no motor de substituição.'
                    : 'Atividades inativas NÃO somam no saldo semanal de aulas, mas mantêm o professor ocupado (impedindo substituição neste horário).'}
                </p>
              </div>

              {/* Duplicação Rápida para Outros Dias */}
              {podeEditar && (
                <div className="bg-cyan-50 border border-cyan-200 p-3 rounded-xl space-y-2">
                  <label className="text-xs font-black uppercase text-cyan-950 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <i className="fa-solid fa-clone text-cyan-600"></i>
                      <span>Duplicar esta Aula para Outro Dia</span>
                    </span>
                    <span className="text-[10px] text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded font-bold">Ação Rápida</span>
                  </label>
                  <p className="text-[10px] text-cyan-900 leading-tight">
                    Aulas repetidas podem ser copiadas instantaneamente mantendo a mesma matéria, professor, turma e sala:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {DIAS_SEMANA.filter(d => d.id !== form.dia).map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          handleDuplicarHorario(form, d.id, form.periodoId);
                          setIsModalOpen(false);
                        }}
                        className="px-2.5 py-1.5 bg-white hover:bg-cyan-100 text-cyan-950 border border-cyan-300 rounded-lg text-[10px] font-extrabold shadow-2xs transition cursor-pointer flex items-center gap-1 hover:border-cyan-400"
                      >
                        <i className="fa-solid fa-plus text-[9px] text-cyan-600"></i>
                        <span>Copiar para {d.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 text-blue-950 text-xs font-black rounded-xl transition shadow-sm cursor-pointer flex items-center gap-2"
                >
                  {salvando ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      <span>Salvar Aula</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL GERENCIAR GRADE & CONFIGURAÇÕES / EXCLUSÃO EM CASCATA (EXCLUSIVO DIRETOR) */}
      {isGerenciarModalOpen && podeEditar && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="bg-blue-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-300 flex items-center justify-center">
                  <i className="fa-solid fa-sliders text-sm"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-tight">Administração & Exclusão em Cascata</h3>
                  <p className="text-[10px] text-cyan-200 font-medium">Gestão de Turmas, Docentes, Salas e Dados da Grade PEI</p>
                </div>
              </div>
              <button
                onClick={() => setIsGerenciarModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Sub-abas do Modal */}
            <div className="bg-slate-100 p-2 border-b border-slate-200 flex flex-wrap gap-1 text-xs font-bold">
              <button
                onClick={() => setAbaGerenciar('grade')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  abaGerenciar === 'grade' ? 'bg-blue-950 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-calendar-days text-cyan-400"></i>
                <span>Dados da Grade PEI ({horarios.length})</span>
              </button>
              <button
                onClick={() => setAbaGerenciar('csv')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  abaGerenciar === 'csv' ? 'bg-blue-950 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-file-csv"></i>
                <span>CSV & Importação</span>
              </button>
              <button
                onClick={() => setAbaGerenciar('turmas')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  abaGerenciar === 'turmas' ? 'bg-blue-950 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-users"></i>
                <span>Turmas ({listaTurmas.length})</span>
              </button>
              <button
                onClick={() => setAbaGerenciar('professores')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  abaGerenciar === 'professores' ? 'bg-blue-950 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-chalkboard-user"></i>
                <span>Professores ({listaProfessores.length})</span>
              </button>
              <button
                onClick={() => setAbaGerenciar('salas')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  abaGerenciar === 'salas' ? 'bg-blue-950 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-door-open"></i>
                <span>Salas ({listaSalas.length})</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs">
              {abaGerenciar === 'grade' && (
                <div className="space-y-4">
                  {/* Top Header & Actions */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <div>
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-calendar-days text-blue-900 text-sm"></i>
                        <h4 className="font-black text-slate-900 text-sm">Edição dos Dados da Grade PEI</h4>
                        <span className="bg-blue-100 text-blue-900 font-extrabold text-[10px] px-2 py-0.5 rounded-full">
                          {aulasFiltradasGradeAdmin.length} de {horarios.length} aulas
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Visualize, filtre, adicione, altere ou remova aulas e atribuições docentes diretamente na grade oficial.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleIniciarCriacaoAulaGradeAdmin}
                      className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-extrabold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-sm text-xs shrink-0"
                    >
                      <i className="fa-solid fa-plus text-xs"></i>
                      <span>Nova Aula na Grade</span>
                    </button>
                  </div>

                  {/* Form de Edição / Criação de Aula na Grade */}
                  {(aulaEmEdicaoGradeAdmin || isCriandoAulaGradeAdmin) && (
                    <form onSubmit={handleSalvarAulaGradeAdmin} className="bg-gradient-to-b from-blue-50/70 to-slate-50 p-4 rounded-xl border-2 border-blue-400 shadow-md space-y-3 animate-fadeIn">
                      <div className="flex items-center justify-between pb-2 border-b border-blue-200">
                        <span className="font-black text-blue-950 text-xs flex items-center gap-2">
                          <i className={`fa-solid ${isCriandoAulaGradeAdmin ? 'fa-plus-circle text-emerald-600' : 'fa-pen-to-square text-blue-700'}`}></i>
                          <span>{isCriandoAulaGradeAdmin ? 'Inserir Nova Aula na Grade PEI' : `Editar Aula Atribuída (${aulaEmEdicaoGradeAdmin?.disciplina || 'Aula'})`}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => { setAulaEmEdicaoGradeAdmin(null); setIsCriandoAulaGradeAdmin(false); }}
                          className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          <i className="fa-solid fa-xmark text-sm"></i>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Dia da Semana</label>
                          <select
                            value={formEdicaoGradeAdmin.dia}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, dia: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                          >
                            <option value="segunda">Segunda-feira</option>
                            <option value="terca">Terça-feira</option>
                            <option value="quarta">Quarta-feira</option>
                            <option value="quinta">Quinta-feira</option>
                            <option value="sexta">Sexta-feira</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Período / Aula</label>
                          <select
                            value={formEdicaoGradeAdmin.periodoId}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, periodoId: Number(e.target.value) })}
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                          >
                            {periodosAula.filter(p => p.tipo === 'aula').map(p => (
                              <option key={p.id} value={p.id}>
                                {p.rotulo} ({p.horario})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Turma PEI</label>
                          <input
                            type="text"
                            list="lista-turmas-grade-admin"
                            value={formEdicaoGradeAdmin.turma}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, turma: e.target.value })}
                            placeholder="Ex: 6º Ano A"
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                            required
                          />
                          <datalist id="lista-turmas-grade-admin">
                            {listaTurmas.map(t => <option key={t} value={t} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Professor(a)</label>
                          <input
                            type="text"
                            list="lista-profs-grade-admin"
                            value={formEdicaoGradeAdmin.professor}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, professor: e.target.value })}
                            placeholder="Ex: Profª Maria Silva"
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                            required
                          />
                          <datalist id="lista-profs-grade-admin">
                            {listaProfessores.map(p => <option key={p} value={p} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Disciplina</label>
                          <input
                            type="text"
                            list="lista-disc-grade-admin"
                            value={formEdicaoGradeAdmin.disciplina}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, disciplina: e.target.value })}
                            placeholder="Ex: Língua Portuguesa"
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                            required
                          />
                          <datalist id="lista-disc-grade-admin">
                            {Object.keys(DISCIPLINAS_CORES).map(d => <option key={d} value={d} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">Sala / Ambiente</label>
                          <input
                            type="text"
                            list="lista-salas-grade-admin"
                            value={formEdicaoGradeAdmin.sala}
                            onChange={(e) => setFormEdicaoGradeAdmin({ ...formEdicaoGradeAdmin, sala: e.target.value })}
                            placeholder="Ex: Sala 01 ou Lab"
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                          />
                          <datalist id="lista-salas-grade-admin">
                            {listaSalas.map(s => <option key={s} value={s} />)}
                          </datalist>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-blue-200">
                        <button
                          type="button"
                          onClick={() => { setAulaEmEdicaoGradeAdmin(null); setIsCriandoAulaGradeAdmin(false); }}
                          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs transition cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={salvando}
                          className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-extrabold rounded-lg text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                        >
                          <i className="fa-solid fa-check text-emerald-400"></i>
                          <span>{salvando ? 'Salvando...' : 'Salvar Aula na Grade'}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Barra de Filtros e Busca */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 bg-white p-3 rounded-xl border border-slate-200">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Buscar (Texto)</label>
                      <input
                        type="text"
                        value={filtroGradeAdminBusca}
                        onChange={(e) => setFiltroGradeAdminBusca(e.target.value)}
                        placeholder="Prof, turma, disciplina..."
                        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-blue-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Dia da Semana</label>
                      <select
                        value={filtroGradeAdminDia}
                        onChange={(e) => setFiltroGradeAdminDia(e.target.value)}
                        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                      >
                        <option value="TODOS">Todos os Dias</option>
                        <option value="segunda">Segunda-feira</option>
                        <option value="terca">Terça-feira</option>
                        <option value="quarta">Quarta-feira</option>
                        <option value="quinta">Quinta-feira</option>
                        <option value="sexta">Sexta-feira</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Turma</label>
                      <select
                        value={filtroGradeAdminTurma}
                        onChange={(e) => setFiltroGradeAdminTurma(e.target.value)}
                        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                      >
                        <option value="TODAS">Todas as Turmas ({listaTurmas.length})</option>
                        {listaTurmas.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Docente</label>
                      <select
                        value={filtroGradeAdminProf}
                        onChange={(e) => setFiltroGradeAdminProf(e.target.value)}
                        className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                      >
                        <option value="TODOS">Todos os Docentes ({listaProfessores.length})</option>
                        {listaProfessores.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Tabela de Aulas na Grade */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto bg-white shadow-2xs">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 uppercase font-black text-[11px] sticky top-0 z-10 border-b border-slate-200">
                          <th className="p-2.5">Dia</th>
                          <th className="p-2.5 text-center">Período</th>
                          <th className="p-2.5">Turma</th>
                          <th className="p-2.5">Disciplina</th>
                          <th className="p-2.5">Professor(a)</th>
                          <th className="p-2.5">Sala</th>
                          <th className="p-2.5 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {aulasFiltradasGradeAdmin.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-400 font-medium">
                              <i className="fa-solid fa-folder-open text-2xl text-slate-300 block mb-2"></i>
                              Nenhuma aula encontrada com os filtros selecionados.
                            </td>
                          </tr>
                        ) : (
                          aulasFiltradasGradeAdmin.map((aula) => {
                            const rotuloP = getPeriodoRotulo(aula.periodoId);
                            const diaLabels = {
                              segunda: 'Segunda',
                              terca: 'Terça',
                              quarta: 'Quarta',
                              quinta: 'Quinta',
                              sexta: 'Sexta',
                              sabado: 'Sábado'
                            };
                            return (
                              <tr key={aula.id || `${aula.dia}-${aula.periodoId}-${aula.turma}-${aula.professor}`} className="hover:bg-slate-50 transition">
                                <td className="p-2.5 font-bold text-blue-950 uppercase tracking-tight">
                                  {diaLabels[aula.dia] || aula.dia}
                                </td>
                                <td className="p-2.5 text-center font-mono font-bold text-slate-700">
                                  <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    {rotuloP}
                                  </span>
                                </td>
                                <td className="p-2.5 font-extrabold text-blue-900">
                                  {aula.turma}
                                </td>
                                <td className="p-2.5 font-bold text-slate-800">
                                  {aula.disciplina}
                                </td>
                                <td className="p-2.5 text-slate-700 font-medium">
                                  {aula.professor}
                                </td>
                                <td className="p-2.5 text-slate-500 font-medium">
                                  {aula.sala || 'Sala Padrão'}
                                </td>
                                <td className="p-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleIniciarEdicaoAulaGradeAdmin(aula)}
                                      className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                      title="Editar esta aula atribuída"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                      <span>Editar</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExcluirAulaGradeAdmin(aula)}
                                      className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                      title="Excluir aula da grade"
                                    >
                                      <i className="fa-solid fa-trash-can text-[10px]"></i>
                                      <span>Excluir</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {abaGerenciar === 'csv' && (
                <div className="space-y-4">
                  {/* Bloco 1: Upload e Importação de CSV */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center gap-2 text-blue-950 font-black text-xs uppercase tracking-wide">
                      <i className="fa-solid fa-file-csv text-cyan-600 text-sm"></i>
                      <span>Importação & Upload de Arquivo CSV</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed">
                      Carregue uma planilha CSV contendo a estrutura da grade horária da escola. O arquivo deve conter os campos: <code className="bg-slate-200 px-1 py-0.5 rounded text-[11px] font-mono text-slate-800">dia, periodoId, turma, professor, disciplina, sala</code>.
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <label className="flex items-center gap-2 bg-gradient-to-r from-blue-900 to-blue-950 hover:from-blue-800 hover:to-blue-900 text-white font-bold px-4 py-2.5 rounded-xl transition cursor-pointer shadow-sm">
                        <i className="fa-solid fa-upload text-cyan-400"></i>
                        <span>Selecionar e Importar CSV</span>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={handleImportarCSV}
                          className="hidden"
                        />
                      </label>

                      <button
                        onClick={handleBaixarModeloCSV}
                        className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 font-bold px-3.5 py-2.5 rounded-xl border border-slate-300 transition cursor-pointer"
                      >
                        <i className="fa-solid fa-download text-slate-500"></i>
                        <span>Baixar Modelo CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* Bloco 2: Exportação de Dados */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center gap-2 text-blue-950 font-black text-xs uppercase tracking-wide">
                      <i className="fa-solid fa-file-export text-emerald-600 text-sm"></i>
                      <span>Exportação da Grade Atual</span>
                    </div>
                    <p className="text-slate-600">
                      Faça o download do backup da grade horária cadastrada atualmente no sistema no formato CSV.
                    </p>

                    <button
                      onClick={handleExportarCSV}
                      className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-xl transition cursor-pointer shadow-sm"
                    >
                      <i className="fa-solid fa-file-excel"></i>
                      <span>Exportar Grade para CSV</span>
                    </button>
                  </div>

                  {/* Bloco 3: Operações em Lote */}
                  <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-200/80 space-y-3">
                    <div className="flex items-center gap-2 text-rose-950 font-black text-xs uppercase tracking-wide">
                      <i className="fa-solid fa-triangle-exclamation text-rose-600 text-sm"></i>
                      <span>Ações e Redefinições em Lote</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        onClick={handleRestaurarPadrao}
                        className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 text-white font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer"
                      >
                        <i className="fa-solid fa-rotate text-cyan-300"></i>
                        <span>Restaurar Matriz PEI Padrão</span>
                      </button>

                      <button
                        onClick={handleLimparGrade}
                        className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                        <span>Limpar Toda a Grade</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {abaGerenciar === 'turmas' && (
                <div className="space-y-4">
                  <form onSubmit={handleAdicionarTurma} className="flex gap-2">
                    <input
                      type="text"
                      value={novoTurmaInput}
                      onChange={(e) => setNovoTurmaInput(e.target.value)}
                      placeholder="Ex: 8º Ano C"
                      className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-950 hover:bg-blue-900 text-white font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fa-solid fa-plus text-cyan-400"></i>
                      <span>Cadastrar Turma</span>
                    </button>
                  </form>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 uppercase font-black">
                          <th className="p-2.5">Turma PEI</th>
                          <th className="p-2.5 text-center">Aulas na Grade</th>
                          <th className="p-2.5 text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {listaTurmas.map((t) => {
                          const numAulas = horarios.filter(h => h.turma === t).length;
                          const isEditando = turmaEmEdicao === t;
                          return (
                            <tr key={t} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold text-slate-900">
                                {isEditando ? (
                                  <div className="flex items-center gap-1.5 max-w-sm">
                                    <input
                                      type="text"
                                      value={novoNomeTurma}
                                      onChange={(e) => setNovoNomeTurma(e.target.value)}
                                      className="p-1.5 bg-white border border-blue-400 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 w-full"
                                      autoFocus
                                      disabled={salvandoEdicao}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSalvarEdicaoTurma(t);
                                        if (e.key === 'Escape') setTurmaEmEdicao(null);
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSalvarEdicaoTurma(t)}
                                      disabled={salvandoEdicao}
                                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                                      title="Salvar novo nome da turma"
                                    >
                                      <i className="fa-solid fa-check"></i>
                                      <span>Salvar</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setTurmaEmEdicao(null); setNovoNomeTurma(''); }}
                                      disabled={salvandoEdicao}
                                      className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                                      title="Cancelar"
                                    >
                                      <i className="fa-solid fa-xmark"></i>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{t}</span>
                                    {podeEditar && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTurmaEmEdicao(t);
                                          setNovoNomeTurma(t);
                                        }}
                                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded-md transition text-xs font-bold flex items-center gap-1 cursor-pointer"
                                        title="Editar nome desta turma"
                                      >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                        <span>Editar</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-bold text-slate-600">{numAulas} aula(s)</td>
                              <td className="p-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {podeEditar && !isEditando && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTurmaEmEdicao(t);
                                        setNovoNomeTurma(t);
                                      }}
                                      className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                      title="Editar nome da turma"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-xs"></i>
                                      <span>Editar</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleExcluirTurmaCascata(t)}
                                    className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                    title="Excluir turma e remover todas as suas aulas em cascata"
                                  >
                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                    <span>Excluir</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {abaGerenciar === 'professores' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-200">
                    <div className="text-xs font-bold text-blue-950">
                      <i className="fa-solid fa-sync text-cyan-600 mr-2 animate-spin"></i>
                      <span>Sincronização Automática com Substituição PEI</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleMigrarDocentesDoHorario(false)}
                      className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white text-xs font-black px-3 py-1.5 rounded-lg transition shadow-xs cursor-pointer border border-emerald-500"
                      title="Extrai todos os docentes da grade atual e migra para o cadastro de Substituição PEI"
                    >
                      <i className="fa-solid fa-bolt text-yellow-300"></i>
                      <span>Sincronizar/Migrar Docentes da Grade</span>
                    </button>
                  </div>

                  {/* Form de Cadastro Completo de Docente & Área */}
                  <form onSubmit={handleAdicionarDocenteCompleto} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                    <div className="flex items-center gap-2 text-blue-950 font-black text-xs uppercase tracking-wide">
                      <i className="fa-solid fa-user-plus text-cyan-600"></i>
                      <span>Novo Docente — Cadastrar no Corpo Docente Central</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">Nome do Docente</label>
                        <input
                          type="text"
                          required
                          value={novoDocenteForm.nome}
                          onChange={(e) => setNovoDocenteForm(prev => ({ ...prev, nome: e.target.value }))}
                          placeholder="Ex: Profª Patricia Lima"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">Disciplina Principal</label>
                        <input
                          type="text"
                          value={novoDocenteForm.disciplina}
                          onChange={(e) => {
                            const disc = e.target.value;
                            const areaSugerida = encontrarAreaDisciplina(disc);
                            setNovoDocenteForm(prev => ({ ...prev, disciplina: disc, area: areaSugerida }));
                          }}
                          placeholder="Ex: Matemática"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">Área do Conhecimento PEI</label>
                        <select
                          value={novoDocenteForm.area}
                          onChange={(e) => setNovoDocenteForm(prev => ({ ...prev, area: e.target.value }))}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-800 cursor-pointer"
                        >
                          {OPCOES_AREAS_PEI.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">Jornada / Turno</label>
                        <select
                          value={novoDocenteForm.turno || 'INTEGRAL'}
                          onChange={(e) => setNovoDocenteForm(prev => ({ ...prev, turno: e.target.value }))}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-800 cursor-pointer"
                        >
                          <option value="INTEGRAL">INTEGRAL (1ª a 9ª aula)</option>
                          <option value="MANHA">MANHÃ (1ª a 6ª aula)</option>
                          <option value="TARDE">TARDE (7ª a 9ª aula)</option>
                          <option value="FOLGA">FOLGA / OFF (Inativo)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">Cargo / Vínculo</label>
                        <select
                          value={novoDocenteForm.tipo}
                          onChange={(e) => setNovoDocenteForm(prev => ({ ...prev, tipo: e.target.value }))}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-800 cursor-pointer"
                        >
                          <option value="EFETIVO">Docente Efetivo PEI (Regente)</option>
                          <option value="PAAC">PAAC / Eventual / Apoio</option>
                          <option value="CGPG">CGPG / CGPCA (Coordenador Geral)</option>
                          <option value="VICE_DIRETOR">Vice-Diretor(a)</option>
                          <option value="DIRETOR">Diretor(a) Escolar</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-950 hover:bg-blue-900 text-white font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer text-xs"
                      >
                        <i className="fa-solid fa-plus text-cyan-400"></i>
                        <span>Salvar Docente & Sincronizar</span>
                      </button>
                    </div>
                  </form>

                  {/* Tabela de Docentes Cadastrados e Áreas do Conhecimento */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-100 text-slate-700 uppercase font-black text-[11px] z-10 shadow-xs">
                        <tr>
                          <th className="p-2.5">Nome do Docente</th>
                          <th className="p-2.5">Disciplina</th>
                          <th className="p-2.5">Área do Conhecimento PEI</th>
                          <th className="p-2.5">Jornada / Turno</th>
                          <th className="p-2.5 text-center">Aulas na Grade</th>
                          <th className="p-2.5 text-center">Substituções (+/-)</th>
                          <th className="p-2.5 text-center">Saldo Acumulado</th>
                          <th className="p-2.5 text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {listaProfessores.map((p) => {
                          const profObj = cadastroProfessores.find(doc => isSameProfessor(doc.nome, p)) || {};
                          const areaAtual = profObj.area || normalizarArea(encontrarAreaDisciplina(profObj.disciplina));
                          const disciplinaAtual = profObj.disciplina || 'Geral';
                          const turnoAtual = String(profObj.turno || 'INTEGRAL').toUpperCase().trim();
                          const tipoAtual = profObj.tipo || 'EFETIVO';

                          const numAulas = (() => {
                            const slots = new Set();
                            return horariosEfetivos.filter(h => {
                              if (!h.professor || !isSameProfessor(h.professor, p) || !isRegularTeachingClass(h)) return false;
                              const slotKey = `${normalizarDia(h.dia)}_${getPeriodoOrder(h.periodoId)}`;
                              if (h.dia && h.periodoId) {
                                if (slots.has(slotKey)) return false;
                                slots.add(slotKey);
                              }
                              return true;
                            }).length;
                          })();

                          let creditosRow = 0;
                          let debitosRow = 0;
                          const subsVistasRow = new Set();
                          (substituicoes || []).forEach(s => {
                            if (!s) return;
                            const st = String(s.status || 'CONFIRMADA').toUpperCase().trim();
                            const isStatusOk = st === 'CONFIRMADA' || st === 'APROVADA' || st === 'REALIZADA' || st === 'CONCLUIDA' || st === 'OK';
                            if (isStatusOk && isRegularTeachingClass(s.disciplina)) {
                              const subKey = s.id || `${s.data}_${s.periodoId}_${s.turma}_${s.professorAusente}_${s.professorSubstituto}`;
                              if (subsVistasRow.has(subKey)) return;
                              subsVistasRow.add(subKey);

                              if (s.professorSubstituto && isSameProfessor(s.professorSubstituto, p)) {
                                creditosRow += 1;
                              }
                              if (s.professorAusente && isSameProfessor(s.professorAusente, p)) {
                                debitosRow += 1;
                              }
                            }
                          });

                          const saldoInicialRow = Number(profObj.saldoAulas || profObj.saldoInicial || 0);
                          const saldoAcumuladoRow = saldoInicialRow + creditosRow - debitosRow;

                          const isEditandoProf = profEmEdicao === p;

                          return (
                            <tr key={p} className="hover:bg-slate-50 transition text-xs">
                              <td className="p-2.5 font-bold text-slate-900">
                                {isEditandoProf ? (
                                  <div className="space-y-1.5 p-2 bg-blue-50/90 rounded-lg border border-blue-300 min-w-[200px]">
                                    <div>
                                      <label className="text-[9px] font-black uppercase text-blue-950 block">Nome do Docente:</label>
                                      <input
                                        type="text"
                                        value={novoNomeProf}
                                        onChange={(e) => setNovoNomeProf(e.target.value)}
                                        className="w-full p-1 bg-white border border-blue-400 rounded text-xs font-black text-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Nome do docente"
                                        autoFocus
                                        disabled={salvandoEdicao}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleSalvarEdicaoProfessor(p);
                                          if (e.key === 'Escape') setProfEmEdicao(null);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[9px] font-black uppercase text-blue-950 block">Disciplina Principal:</label>
                                      <input
                                        type="text"
                                        value={novaDiscProf}
                                        onChange={(e) => setNovaDiscProf(e.target.value)}
                                        className="w-full p-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Ex: Matemática"
                                        disabled={salvandoEdicao}
                                      />
                                    </div>
                                    <div className="flex items-center gap-1 pt-1">
                                      <button
                                        type="button"
                                        onClick={() => handleSalvarEdicaoProfessor(p)}
                                        disabled={salvandoEdicao}
                                        className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-black uppercase transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        <i className="fa-solid fa-check"></i>
                                        <span>{salvandoEdicao ? 'Salvando...' : 'Salvar'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setProfEmEdicao(null); setNovoNomeProf(''); setNovaDiscProf(''); }}
                                        disabled={salvandoEdicao}
                                        className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] font-bold transition cursor-pointer"
                                      >
                                        <i className="fa-solid fa-xmark"></i>
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-extrabold">{p}</span>
                                      {podeEditar && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setProfEmEdicao(p);
                                            setNovoNomeProf(p);
                                            setNovaDiscProf(disciplinaAtual);
                                          }}
                                          className="text-blue-600 hover:text-blue-800 p-0.5 hover:bg-blue-50 rounded transition text-[11px] font-bold cursor-pointer"
                                          title="Editar nome e disciplina do docente"
                                        >
                                          <i className="fa-solid fa-pen-to-square"></i>
                                        </button>
                                      )}
                                    </div>
                                    <select
                                      value={tipoAtual}
                                      onChange={(e) => handleAlterarTipoDocenteInline(p, e.target.value)}
                                      className="p-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-700 cursor-pointer"
                                    >
                                      <option value="EFETIVO">EFETIVO PEI</option>
                                      <option value="PAAC">PAAC / EVENTUAL</option>
                                      <option value="CGPG">CGPG / CGPCA</option>
                                      <option value="VICE_DIRETOR">VICE-DIRETOR</option>
                                      <option value="DIRETOR">DIRETOR</option>
                                    </select>
                                  </div>
                                )}
                              </td>

                              <td className="p-2.5 text-slate-600 font-medium">
                                {disciplinaAtual}
                              </td>

                              <td className="p-2.5">
                                <select
                                  value={areaAtual}
                                  onChange={(e) => handleAlterarAreaDocenteInline(p, e.target.value)}
                                  className="w-full p-1 bg-white border border-slate-300 rounded-md font-bold text-[11px] text-slate-800 cursor-pointer hover:border-blue-400 focus:ring-1 focus:ring-blue-500"
                                >
                                  {OPCOES_AREAS_PEI.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              </td>

                              <td className="p-2.5">
                                <select
                                  value={['FOLGA', 'OFF', '-', 'S', 'INATIVO'].includes(turnoAtual) ? 'FOLGA' : turnoAtual}
                                  onChange={(e) => handleAlterarTurnoDocenteInline(p, e.target.value)}
                                  className="w-full p-1 bg-white border border-slate-300 rounded-md font-bold text-[11px] text-slate-800 cursor-pointer hover:border-blue-400 focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="INTEGRAL">INTEGRAL (1ª-9ª)</option>
                                  <option value="MANHA">MANHÃ (1ª-6ª)</option>
                                  <option value="TARDE">TARDE (7ª-9ª)</option>
                                  <option value="FOLGA">FOLGA / OFF</option>
                                </select>
                              </td>

                              <td className="p-2.5 text-center font-bold text-slate-700">
                                {numAulas} aula(s)
                              </td>

                              <td className="p-2.5 text-center text-[11px] font-mono font-bold">
                                <span className="text-emerald-700 font-extrabold">+{creditosRow}</span>
                                <span className="text-slate-400 mx-1">/</span>
                                <span className="text-rose-700 font-extrabold">-{debitosRow}</span>
                              </td>

                              <td className="p-2.5 text-center">
                                <span className={`inline-block font-mono font-black text-[11px] px-2.5 py-0.5 rounded-full border ${
                                  saldoAcumuladoRow > 0
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    : saldoAcumuladoRow < 0
                                    ? 'bg-rose-100 text-rose-900 border-rose-300'
                                    : 'bg-slate-100 text-slate-700 border-slate-300'
                                }`}>
                                  {saldoAcumuladoRow > 0 ? `+${saldoAcumuladoRow}` : saldoAcumuladoRow} aula(s)
                                </span>
                              </td>

                              <td className="p-2.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {podeEditar && !isEditandoProf && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProfEmEdicao(p);
                                        setNovoNomeProf(p);
                                        setNovaDiscProf(disciplinaAtual);
                                      }}
                                      className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                      title="Editar nome e disciplina do docente"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-xs"></i>
                                      <span>Editar</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleExcluirProfessorCascata(p)}
                                    className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                    title="Excluir docente e remover todas as suas aulas na grade em cascata"
                                  >
                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                    <span>Excluir (Cascata)</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {abaGerenciar === 'salas' && (
                <div className="space-y-4">
                  <form onSubmit={handleAdicionarSala} className="flex gap-2">
                    <input
                      type="text"
                      value={novaSalaInput}
                      onChange={(e) => setNovaSalaInput(e.target.value)}
                      placeholder="Ex: Laboratório de Informática"
                      className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-950 hover:bg-blue-900 text-white font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fa-solid fa-plus text-cyan-400"></i>
                      <span>Cadastrar Sala/Espaço</span>
                    </button>
                  </form>

                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 uppercase font-black">
                          <th className="p-2.5">Nome do Espaço / Sala</th>
                          <th className="p-2.5 text-center">Aulas na Sala</th>
                          <th className="p-2.5 text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {listaSalas.map((s) => {
                          const numAulas = horarios.filter(h => h.sala === s).length;
                          const isEditandoSala = salaEmEdicao === s;
                          return (
                            <tr key={s} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold text-slate-900">
                                {isEditandoSala ? (
                                  <div className="flex items-center gap-1.5 max-w-sm">
                                    <input
                                      type="text"
                                      value={novoNomeSala}
                                      onChange={(e) => setNovoNomeSala(e.target.value)}
                                      className="p-1.5 bg-white border border-blue-400 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 w-full"
                                      autoFocus
                                      disabled={salvandoEdicao}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSalvarEdicaoSala(s);
                                        if (e.key === 'Escape') setSalaEmEdicao(null);
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSalvarEdicaoSala(s)}
                                      disabled={salvandoEdicao}
                                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
                                      title="Salvar novo nome da sala"
                                    >
                                      <i className="fa-solid fa-check"></i>
                                      <span>Salvar</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setSalaEmEdicao(null); setNovoNomeSala(''); }}
                                      disabled={salvandoEdicao}
                                      className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                                      title="Cancelar"
                                    >
                                      <i className="fa-solid fa-xmark"></i>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{s}</span>
                                    {podeEditar && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSalaEmEdicao(s);
                                          setNovoNomeSala(s);
                                        }}
                                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded-md transition text-xs font-bold flex items-center gap-1 cursor-pointer"
                                        title="Editar nome da sala/ambiente"
                                      >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                        <span>Editar</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-bold text-slate-600">{numAulas} aula(s)</td>
                              <td className="p-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {podeEditar && !isEditandoSala && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSalaEmEdicao(s);
                                        setNovoNomeSala(s);
                                      }}
                                      className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                      title="Editar nome do espaço/sala"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-xs"></i>
                                      <span>Editar</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleExcluirSalaCascata(s)}
                                    className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg font-bold transition flex items-center gap-1 cursor-pointer text-xs"
                                    title="Excluir sala e limpar atribuições na grade"
                                  >
                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                    <span>Excluir</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setIsGerenciarModalOpen(false)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CONFIGURAÇÃO DE SLOTS DE TEMPO (HORÁRIOS DAS AULAS E INTERVALOS) */}
      {isConfigHorariosModalOpen && podeEditar && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-indigo-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-300 flex items-center justify-center">
                  <i className="fa-solid fa-clock text-sm"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-tight">Configurar Slots de Tempo / Horários</h3>
                  <p className="text-[10px] text-indigo-200 font-medium">Altere os intervalos de tempo, adicione ou remova períodos da grade</p>
                </div>
              </div>
              <button
                onClick={() => setIsConfigHorariosModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="bg-indigo-50 border border-indigo-200 p-3.5 rounded-xl text-xs text-indigo-950 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-info text-indigo-600"></i>
                  <span>Instruções de Configuração</span>
                </p>
                <p className="text-[11px] text-indigo-800">
                  Edite os rótulos (ex: "1ª Aula"), o intervalo de tempo (ex: "07:00 - 07:50") e o tipo (Aula ou Intervalo/Café). As alterações afetam a grade horária e o motor de substituição em tempo real.
                </p>
              </div>

              <div className="space-y-2">
                {periodosAula.map((slot, index) => (
                  <div
                    key={slot.id}
                    className="flex flex-wrap md:flex-nowrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-indigo-300 transition"
                  >
                    <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-950 text-[11px] font-black flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>

                    <div className="w-28 shrink-0">
                      <label className="text-[9px] font-extrabold text-slate-500 uppercase block">Rótulo</label>
                      <input
                        type="text"
                        value={slot.rotulo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPeriodosAula(prev => prev.map(p => p.id === slot.id ? { ...p, rotulo: val } : p));
                        }}
                        className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>

                    <div className="w-36 shrink-0">
                      <label className="text-[9px] font-extrabold text-slate-500 uppercase block">Horário (Início - Fim)</label>
                      <input
                        type="text"
                        value={slot.horario}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPeriodosAula(prev => prev.map(p => p.id === slot.id ? { ...p, horario: val } : p));
                        }}
                        placeholder="Ex: 07:00 - 07:50"
                        className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>

                    <div className="w-28 shrink-0">
                      <label className="text-[9px] font-extrabold text-slate-500 uppercase block">Tipo</label>
                      <select
                        value={slot.tipo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPeriodosAula(prev => prev.map(p => p.id === slot.id ? { ...p, tipo: val } : p));
                        }}
                        className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-extrabold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
                      >
                        <option value="aula">Aula</option>
                        <option value="intervalo">Intervalo</option>
                      </select>
                    </div>

                    <div className="ml-auto flex items-center gap-1 shrink-0 pt-3 md:pt-0">
                      <button
                        onClick={() => handleRemoverSlotTempo(slot.id)}
                        className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg transition cursor-pointer"
                        title="Remover este slot"
                      >
                        <i className="fa-solid fa-trash text-xs"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleAdicionarSlotTempo}
                  className="px-3.5 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-950 text-xs font-extrabold rounded-xl border border-indigo-300 flex items-center gap-1.5 cursor-pointer transition"
                >
                  <i className="fa-solid fa-plus text-xs"></i>
                  <span>Adicionar Novo Horário / Aula</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPeriodosAula(PERIODOS_AULA)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 cursor-pointer transition"
                >
                  Restaurar Horários PEI Padrão
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-100 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsConfigHorariosModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSalvarSlotsTempo(periodosAula)}
                className="px-5 py-2 bg-indigo-900 hover:bg-indigo-800 text-white text-xs font-black rounded-xl transition shadow-sm cursor-pointer flex items-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                <span>Salvar Slots de Horário</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: MATRIZ DE AUSÊNCIA / INDISPONIBILIDADE DE PROFESSORES */}
      {isAusenciaModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-purple-950 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-400/20 text-rose-300 flex items-center justify-center">
                  <i className="fa-solid fa-user-slash text-sm"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-tight">Controle de Indisponibilidade & Ausência Docente</h3>
                  <p className="text-[10px] text-purple-200 font-medium">Marque horários de folga, saídas antecipadas ou ausências periódicas</p>
                </div>
              </div>
              <button
                onClick={() => setIsAusenciaModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-purple-50 p-3.5 rounded-xl border border-purple-200">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-black uppercase text-purple-950">Selecione o Professor:</label>
                  <select
                    value={profAusenciaSelecionado}
                    onChange={(e) => setProfAusenciaSelecionado(e.target.value)}
                    className="p-2 bg-white border border-purple-300 rounded-xl text-xs font-extrabold text-slate-800 outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer min-w-[220px]"
                  >
                    {listaProfessores.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {podeEditar && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-purple-950">Motivo Padrão:</label>
                    <input
                      type="text"
                      value={motivoAusenciaInput}
                      onChange={(e) => setMotivoAusenciaInput(e.target.value)}
                      placeholder="Ex: Folga, Janela, ATPC parcial"
                      className="p-1.5 bg-white border border-purple-300 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-purple-400 w-48"
                    />
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <p className="font-bold text-slate-800 mb-1">
                  {podeEditar ? '💡 Clique nas células abaixo para alternar a disponibilidade do docente:' : 'ℹ️ Consulta de matriz de disponibilidade docente (Modo Somente Leitura):'}
                </p>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500"></span> Disponível na Escola</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-600"></span> FORA DA ESCOLA / INDISPONÍVEL (Desqualificado para substituição)</span>
                </div>
              </div>

              {/* Matriz Semanal de Ausências */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse min-w-[650px]">
                  <thead>
                    <tr className="bg-purple-950 text-white text-xs font-black uppercase">
                      <th className="p-3 border-b border-purple-900 w-32">Horário / Slot</th>
                      {DIAS_SEMANA.map((dia) => (
                        <th key={dia.id} className="p-3 border-b border-purple-900 text-center">
                          {dia.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs font-medium">
                    {periodosAula.filter(p => p.tipo === 'aula').map((periodo) => (
                      <tr key={periodo.id} className="hover:bg-slate-50">
                        <td className="p-2.5 bg-slate-50 border-r border-slate-200 font-bold text-slate-800">
                          <div>{periodo.rotulo}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{periodo.horario}</div>
                        </td>

                        {DIAS_SEMANA.map((dia) => {
                          const key = `${dia.id}-${periodo.id}`;
                          const profMap = indisponibilidadeProfs[profAusenciaSelecionado] || {};
                          const slotInfo = profMap[key] || { ausente: false, motivo: '' };
                          const isAusente = slotInfo.ausente;

                          return (
                            <td
                              key={dia.id}
                              onClick={() => podeEditar && handleToggleIndisponibilidade(profAusenciaSelecionado, dia.id, periodo.id)}
                              className={`p-2 border-r border-slate-200 text-center align-middle transition select-none ${
                                podeEditar ? 'cursor-pointer' : 'cursor-default'
                              } ${
                                isAusente
                                  ? 'bg-rose-100 hover:bg-rose-200 text-rose-950 font-extrabold'
                                  : 'bg-emerald-50/60 hover:bg-emerald-100 text-emerald-950'
                              }`}
                            >
                              {isAusente ? (
                                <div className="space-y-0.5 animate-fadeIn">
                                  <span className="inline-block px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-black uppercase">
                                    ⛔ Fora da Escola
                                  </span>
                                  {slotInfo.motivo && (
                                    <p className="text-[9px] text-rose-800 italic truncate max-w-[100px] mx-auto">
                                      {slotInfo.motivo}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[11px] text-emerald-700 font-bold flex items-center justify-center gap-1">
                                  <i className="fa-solid fa-circle-check text-emerald-600"></i>
                                  <span>Presente</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setIsAusenciaModalOpen(false)}
                className="px-5 py-2 bg-purple-950 hover:bg-purple-900 text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                {podeEditar ? 'Concluir Visualização / Edição' : 'Fechar Visualização'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Pré-Visualização e Ajustes Finos do CSV Importado */}
      {isPreviewCsvModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 p-4 text-white flex items-center justify-between border-b border-blue-900">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-100 text-cyan-300 flex items-center justify-center text-lg font-black border border-cyan-400">
                  <i className="fa-solid fa-file-csv"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base tracking-tight">Pré-visualização e Ajustes da Grade CSV</h3>
                    <span className="bg-cyan-900/80 text-cyan-200 border border-cyan-700/60 px-2.5 py-0.5 rounded-full text-[10px] font-mono">
                      {csvImportNomeArquivo || 'matriz_grade.csv'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-medium">
                    Confirme os horários processados automaticamente. Você pode editar qualquer campo antes de salvar na grade oficial.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPreviewCsvModalOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800/80 transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            {/* Metrics Bar */}
            <div className="bg-slate-50 p-3.5 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
                  <i className="fa-solid fa-calendar-check"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-extrabold text-slate-400">Total Aulas Mapeadas</p>
                  <p className="font-black text-slate-800 text-base">{csvPreviewItems.length}</p>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                  <i className="fa-solid fa-chalkboard-user"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-extrabold text-slate-400">Docentes Identificados</p>
                  <p className="font-black text-slate-800 text-base">
                    {new Set(csvPreviewItems.map(i => i.professor).filter(Boolean)).size}
                  </p>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <i className="fa-solid fa-users"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-extrabold text-slate-400">Turmas Encontradas</p>
                  <p className="font-black text-slate-800 text-base">
                    {new Set(csvPreviewItems.map(i => i.turma).filter(t => t && t !== '-')).size}
                  </p>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-xs">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center font-bold">
                  <i className="fa-solid fa-door-open"></i>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-extrabold text-slate-400">Salas / Ambientes</p>
                  <p className="font-black text-slate-800 text-base">
                    {new Set(csvPreviewItems.map(i => i.sala).filter(s => s && s !== '-')).size}
                  </p>
                </div>
              </div>
            </div>

            {/* Toolbar: Search and Add */}
            <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={csvFiltroBusca}
                  onChange={(e) => setCsvFiltroBusca(e.target.value)}
                  placeholder="Filtrar por docente, turma, disciplina ou sala..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleAdicionarItemManualPreviewCsv}
                  className="px-3.5 py-2 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <i className="fa-solid fa-plus text-cyan-300"></i>
                  <span>+ Adicionar Aula Manualmente</span>
                </button>

                <span className="text-slate-500 text-xs font-semibold bg-slate-100 px-2.5 py-1 rounded-lg">
                  Exibindo {csvPreviewItemsFiltered.length} de {csvPreviewItems.length}
                </span>
              </div>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <table className="w-full text-left border-collapse min-w-[850px] text-xs">
                  <thead>
                    <tr className="bg-blue-950 text-white uppercase text-[11px] font-black tracking-wider">
                      <th className="p-2.5 w-32">Dia</th>
                      <th className="p-2.5 w-36">Período / Slot</th>
                      <th className="p-2.5 w-32">Turma</th>
                      <th className="p-2.5 w-44">Professor</th>
                      <th className="p-2.5">Disciplina</th>
                      <th className="p-2.5 w-36">Sala / Local</th>
                      <th className="p-2.5 w-16 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white font-medium">
                    {csvPreviewItemsFiltered.map((item) => {
                      const realIndex = csvPreviewItems.findIndex(i => i.id === item.id);
                      if (realIndex === -1) return null;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition">
                          <td className="p-2">
                            <select
                              value={item.dia}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'dia', e.target.value)}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                            >
                              <option value="segunda">Segunda</option>
                              <option value="terca">Terça</option>
                              <option value="quarta">Quarta</option>
                              <option value="quinta">Quinta</option>
                              <option value="sexta">Sexta</option>
                            </select>
                          </td>

                          <td className="p-2">
                            <select
                              value={item.periodoId}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'periodoId', isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                            >
                              {periodosAula.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.rotulo} ({p.horario})
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="p-2">
                            <input
                              type="text"
                              value={item.turma}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'turma', e.target.value)}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900"
                            />
                          </td>

                          <td className="p-2">
                            <input
                              type="text"
                              value={item.professor}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'professor', e.target.value)}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-blue-900"
                            />
                          </td>

                          <td className="p-2">
                            <input
                              type="text"
                              value={item.disciplina}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'disciplina', e.target.value)}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                            />
                          </td>

                          <td className="p-2">
                            <input
                              type="text"
                              value={item.sala}
                              onChange={(e) => handleAtualizarItemPreviewCsv(realIndex, 'sala', e.target.value)}
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700"
                            />
                          </td>

                          <td className="p-2 text-center">
                            <button
                              onClick={() => handleRemoverItemPreviewCsv(realIndex)}
                              className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Remover esta linha"
                            >
                              <i className="fa-solid fa-trash-can text-sm"></i>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
                <i className="fa-solid fa-circle-info text-cyan-600"></i>
                <span>Os docentes, turmas e salas importados serão cadastrados e sincronizados automaticamente na base da escola.</span>
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsPreviewCsvModalOpen(false)}
                  className="px-4 py-2.5 bg-white hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  onClick={handleConfirmarEImportarCsv}
                  disabled={salvando}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-extrabold text-xs rounded-xl transition shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {salvando ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Sincronizando no Banco de Dados...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-arrow-up text-cyan-200"></i>
                      <span>Confirmar e Sincronizar na Grade Oficial ({csvPreviewItems.length} Aulas)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AUDITORIA E GESTÃO DE AULAS ATRIBUÍDAS */}
      {isAuditoriaAulasModalOpen && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
            
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950 p-4 sm:p-5 text-white flex items-center justify-between border-b border-amber-500/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black text-lg shadow-md">
                  <i className="fa-solid fa-clipboard-check"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-sm sm:text-base uppercase tracking-wide text-white">
                      Auditoria de Aulas Atribuídas na Grade
                    </h3>
                    <span className="text-[10px] font-black uppercase bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full shadow-2xs">
                      Exclusivo Diretor
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Consulte, altere dados ou exclua diretamente qualquer aula atribuída aos professores e turmas.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleIniciarCriacaoAuditoria()}
                  className="px-3.5 py-2 bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 text-blue-950 font-black text-xs rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
                  title="Atribuir uma nova aula manualmente"
                >
                  <i className="fa-solid fa-plus text-xs"></i>
                  <span className="hidden sm:inline">Nova Atribuição</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAuditoriaAulasModalOpen(false)}
                  className="text-slate-300 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition cursor-pointer"
                  title="Fechar"
                >
                  <i className="fa-solid fa-xmark text-lg"></i>
                </button>
              </div>
            </div>

            {/* Sub-painel: Se estiver em modo de edição ou criação de uma aula atribuída */}
            {(aulaEmEdicaoAuditoria || isCriandoNovaAulaAuditoria) && (
              <div className="p-4 sm:p-5 bg-amber-50/90 border-b border-amber-200 animate-fadeIn">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase text-amber-950">
                    <i className="fa-solid fa-pen-to-square text-amber-700"></i>
                    <span>{isCriandoNovaAulaAuditoria ? 'Atribuir Nova Aula na Grade' : `Alterar Aula Atribuída #${aulaEmEdicaoAuditoria?.id}`}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAulaEmEdicaoAuditoria(null); setIsCriandoNovaAulaAuditoria(false); }}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    <i className="fa-solid fa-xmark mr-1"></i> Cancelar Edição
                  </button>
                </div>

                <form onSubmit={handleSalvarEdicaoAuditoria} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Professor</label>
                    <select
                      value={formAuditoria.professor}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, professor: e.target.value })}
                      required
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                    >
                      {listaProfessores.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      {!listaProfessores.includes(formAuditoria.professor) && formAuditoria.professor && (
                        <option value={formAuditoria.professor}>{formAuditoria.professor}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Disciplina</label>
                    <input
                      type="text"
                      list="lista-disciplinas-auditoria"
                      value={formAuditoria.disciplina}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, disciplina: e.target.value })}
                      required
                      placeholder="Ex: Matemática"
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <datalist id="lista-disciplinas-auditoria">
                      {Object.keys(DISCIPLINAS_CORES).map(d => <option key={d} value={d} />)}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Turma</label>
                    <select
                      value={formAuditoria.turma}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, turma: e.target.value })}
                      required
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                    >
                      {listaTurmas.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      {!listaTurmas.includes(formAuditoria.turma) && formAuditoria.turma && (
                        <option value={formAuditoria.turma}>{formAuditoria.turma}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Dia da Semana</label>
                    <select
                      value={formAuditoria.dia}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, dia: e.target.value })}
                      required
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                    >
                      {DIAS_SEMANA.map(d => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Período / Aula</label>
                    <select
                      value={formAuditoria.periodoId}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, periodoId: e.target.value })}
                      required
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                    >
                      {periodosAula.map(p => (
                        <option key={p.id} value={p.id}>{p.rotulo} ({p.horario})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Sala / Espaço</label>
                    <input
                      type="text"
                      list="lista-salas-auditoria"
                      value={formAuditoria.sala}
                      onChange={(e) => setFormAuditoria({ ...formAuditoria, sala: e.target.value })}
                      placeholder="Ex: Sala 01"
                      className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <datalist id="lista-salas-auditoria">
                      {listaSalas.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>

                  <div className="sm:col-span-3 lg:col-span-6 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-300">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formAuditoria.contarSaldo}
                        onChange={(e) => setFormAuditoria({ ...formAuditoria, contarSaldo: e.target.checked })}
                        className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                      />
                      <span>Contar na carga horária regular do docente</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setAulaEmEdicaoAuditoria(null); setIsCriandoNovaAulaAuditoria(false); }}
                        className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={salvando}
                        className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {salvando ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                        <span>{isCriandoNovaAulaAuditoria ? 'Criar Atribuição' : 'Salvar Alteração'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Barra de Filtros e Busca da Auditoria */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                {/* Filtro por Professor */}
                <div className="min-w-[190px]">
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-0.5">Filtrar por Professor</label>
                  <select
                    value={auditoriaFiltroProfessor}
                    onChange={(e) => setAuditoriaFiltroProfessor(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="TODOS">Todos os Professores ({listaProfessores.length})</option>
                    {listaProfessores.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* Filtro por Turma */}
                <div className="min-w-[140px]">
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-0.5">Filtrar por Turma</label>
                  <select
                    value={auditoriaFiltroTurma}
                    onChange={(e) => setAuditoriaFiltroTurma(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="TODAS">Todas as Turmas ({listaTurmas.length})</option>
                    {listaTurmas.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Filtro por Dia */}
                <div className="min-w-[130px]">
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-0.5">Filtrar por Dia</label>
                  <select
                    value={auditoriaFiltroDia}
                    onChange={(e) => setAuditoriaFiltroDia(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="TODOS">Todos os Dias</option>
                    {DIAS_SEMANA.map(d => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                </div>

                {/* Busca Textual */}
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-0.5">Buscar Rápida</label>
                  <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input
                      type="text"
                      value={auditoriaTermoBusca}
                      onChange={(e) => setAuditoriaTermoBusca(e.target.value)}
                      placeholder="Buscar por docente, disciplina, sala..."
                      className="w-full pl-8 pr-7 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    {auditoriaTermoBusca && (
                      <button
                        type="button"
                        onClick={() => setAuditoriaTermoBusca('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Indicador de Resumo */}
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 bg-amber-100 text-amber-950 border border-amber-300 rounded-xl text-xs font-black shadow-2xs">
                  {listaAulasAuditoria.length} Aulas Listadas
                </span>
                {(auditoriaFiltroProfessor !== 'TODOS' || auditoriaFiltroTurma !== 'TODAS' || auditoriaFiltroDia !== 'TODOS' || auditoriaTermoBusca) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuditoriaFiltroProfessor('TODOS');
                      setAuditoriaFiltroTurma('TODAS');
                      setAuditoriaFiltroDia('TODOS');
                      setAuditoriaTermoBusca('');
                    }}
                    className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                    title="Limpar todos os filtros"
                  >
                    <i className="fa-solid fa-filter-circle-xmark mr-1"></i> Limpar
                  </button>
                )}
              </div>
            </div>

            {/* Tabela de Aulas Atribuídas */}
            <div className="overflow-x-auto overflow-y-auto flex-1 p-4">
              {listaAulasAuditoria.length === 0 ? (
                <div className="p-12 text-center bg-slate-50 border border-slate-200 rounded-2xl">
                  <i className="fa-solid fa-calendar-xmark text-4xl text-slate-400 mb-3 block"></i>
                  <h4 className="text-sm font-black text-slate-800">Nenhuma aula atribuída encontrada com estes filtros</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Tente selecionar outro professor, turma ou limpar os termos de busca para visualizar as aulas.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10">
                      <th className="p-3">Professor / Docente</th>
                      <th className="p-3">Disciplina</th>
                      <th className="p-3">Turma</th>
                      <th className="p-3">Dia da Semana</th>
                      <th className="p-3">Período / Horário</th>
                      <th className="p-3">Sala</th>
                      <th className="p-3 text-center">Contagem</th>
                      <th className="p-3 text-right">Ações da Direção</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {listaAulasAuditoria.map((aula) => {
                      const estiloCor = getCorDisciplina(aula.disciplina);
                      const diaObj = DIAS_SEMANA.find(d => normalizarDia(d.id) === normalizarDia(aula.dia));
                      const rotuloP = getPeriodoRotulo(aula.periodoId);
                      const slotObj = periodosAula.find(p => String(p.id) === String(aula.periodoId));
                      const isSendoEditada = aulaEmEdicaoAuditoria?.id === aula.id;

                      return (
                        <tr
                          key={aula.id || `${aula.dia}_${aula.periodoId}_${aula.turma}_${aula.professor}`}
                          className={`hover:bg-slate-50/90 transition ${isSendoEditada ? 'bg-amber-50/80 ring-1 ring-amber-400' : ''}`}
                        >
                          <td className="p-3 font-extrabold text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <i className="fa-solid fa-chalkboard-user text-slate-400"></i>
                              <span>{aula.professor}</span>
                            </div>
                          </td>

                          <td className="p-3 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-extrabold ${estiloCor.bg}`}>
                              {aula.disciplina}
                            </span>
                          </td>

                          <td className="p-3 font-bold text-slate-800 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-900 border border-blue-200 rounded-md">
                              {aula.turma}
                            </span>
                          </td>

                          <td className="p-3 font-bold text-slate-700 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md uppercase text-[10px] font-black">
                              {diaObj?.label || aula.dia}
                            </span>
                          </td>

                          <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <i className="fa-regular fa-clock text-blue-800 text-[10px]"></i>
                              <span className="font-bold text-slate-900">{rotuloP}</span>
                              {slotObj?.horario && (
                                <span className="text-[10px] text-slate-400">({slotObj.horario})</span>
                              )}
                            </div>
                          </td>

                          <td className="p-3 text-slate-600 whitespace-nowrap">
                            <span className="text-xs font-semibold">{aula.sala || 'Sala Padrão'}</span>
                          </td>

                          <td className="p-3 text-center whitespace-nowrap">
                            {aula.contarSaldo !== false && aula.ativo !== false ? (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-black" title="Conta na carga horária">
                                Regular
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold" title="Não conta na carga horária (ATPC/Inativo)">
                                Inativo/ATPC
                              </span>
                            )}
                          </td>

                          <td className="p-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleIniciarEdicaoAuditoria(aula)}
                                className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold rounded-lg text-xs transition cursor-pointer border border-amber-300 flex items-center gap-1 shadow-2xs"
                                title="Alterar informações desta aula atribuída"
                              >
                                <i className="fa-solid fa-pen-to-square text-amber-800"></i>
                                <span>Alterar</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleExcluirAulaAuditoria(aula)}
                                className="px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-950 font-bold rounded-lg text-xs transition cursor-pointer border border-rose-300 flex items-center gap-1 shadow-2xs"
                                title="Excluir esta aula atribuída da grade"
                              >
                                <i className="fa-solid fa-trash-can text-rose-800"></i>
                                <span>Excluir</span>
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

            {/* Modal Footer */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="font-semibold flex items-center gap-1.5">
                  <i className="fa-solid fa-shield-halved text-amber-600"></i>
                  <span>Painel de Auditoria Diretor: Todas as alterações e exclusões são gravadas com rastro de auditoria.</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 bg-white hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition cursor-pointer flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-print"></i>
                  <span>Imprimir Lista</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAuditoriaAulasModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Concluir / Fechar
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL IN-APP DE CONFIRMAÇÃO (SUBSTITUI window.confirm) */}
      {confirmDialog.open && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-[80] animate-fadeIn">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className={`p-4 text-white flex items-center justify-between ${
              confirmDialog.variant === 'danger' ? 'bg-rose-700' :
              confirmDialog.variant === 'warning' ? 'bg-amber-600' : 'bg-blue-950'
            }`}>
              <div className="flex items-center gap-2.5">
                <i className={`fa-solid ${
                  confirmDialog.variant === 'danger' ? 'fa-trash-can' :
                  confirmDialog.variant === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-question'
                }`}></i>
                <h3 className="font-black text-sm">{confirmDialog.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDialog(prev => ({ ...prev, open: false, onConfirm: null }))}
                className="text-white/80 hover:text-white p-1 cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs sm:text-sm text-slate-700 font-medium whitespace-pre-line leading-relaxed">
                {confirmDialog.message}
              </p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(prev => ({ ...prev, open: false, onConfirm: null }))}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const cb = confirmDialog.onConfirm;
                    setConfirmDialog(prev => ({ ...prev, open: false, onConfirm: null }));
                    if (typeof cb === 'function') {
                      await cb();
                    }
                  }}
                  className={`px-4 py-2 text-white font-black text-xs rounded-xl transition shadow-sm cursor-pointer ${
                    confirmDialog.variant === 'danger' ? 'bg-rose-600 hover:bg-rose-700' :
                    confirmDialog.variant === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-950 hover:bg-slate-900'
                  }`}
                >
                  {confirmDialog.confirmLabel || 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
