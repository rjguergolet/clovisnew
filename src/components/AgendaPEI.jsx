import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, collection, getDocs, addDoc, updateDoc, doc, deleteDoc, onSnapshot } from '../lib/database';
import {
  CATEGORIAS_AGENDA,
  TURMAS_ESCOLARES,
  DIAS_DA_SEMANA_REPOSICAO,
  getCategoryConfig,
  checkDayStatus
} from './agendaConstants';

const CATEGORY_FILTER_PILLS = [
  { id: '', label: 'Todas', icon: 'fa-solid fa-layer-group' },
  { id: 'feriado_recesso', label: 'Feriados & Recessos', icon: 'fa-solid fa-umbrella-beach' },
  { id: 'provao', label: 'Provão Paulista', icon: 'fa-solid fa-graduation-cap' },
  { id: 'reposicao', label: 'Sábado Letivo', icon: 'fa-solid fa-arrows-rotate' },
  { id: 'avaliacao', label: 'Avaliações & Conselhos', icon: 'fa-solid fa-file-signature' },
  { id: 'pedagogico', label: 'Pedagógico PEI', icon: 'fa-solid fa-book-open-reader' },
  { id: 'passeios', label: 'Passeios & Feiras', icon: 'fa-solid fa-bus' },
  { id: 'administrativo', label: 'Administrativo', icon: 'fa-solid fa-building-columns' }
];

const ROLE_FILTER_PILLS = [
  { id: '', label: 'Todos os públicos' },
  { id: 'TODA A EQUIPE', label: 'Toda a Equipe' },
  { id: 'PROFESSORES', label: 'Professores' },
  { id: 'SECRETARIA', label: 'Secretaria' },
  { id: 'DIRETOR', label: 'Diretor' },
  { id: 'VICE_DIRETOR', label: 'Vice-Diretor' },
  { id: 'CGPG', label: 'CGPG' },
  { id: 'PAAC', label: 'PAAC' }
];

const NORM_MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export default function AgendaPEI() {
  const [tasks, setTasks] = useState(() => (Array.isArray(window.eventosCache) ? window.eventosCache : []));
  const [loading, setLoading] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [logoFallbackIndex, setLogoFallbackIndex] = useState(0);
  const [feedbackNotice, setFeedbackNotice] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Mês e ano selecionados para o Calendário
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Filtros da Agenda
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'list'
  const [abaStatusLista, setAbaStatusLista] = useState('pendentes'); // 'pendentes', 'concluidos', 'todos'

  // Modal de Detalhes / Criação / Edição / Transformar em Tarefa
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal Guia de Regras Operacionais
  const [isRegrasModalOpen, setIsRegrasModalOpen] = useState(false);

  // Estados de Edição (Apenas Direção, Vice-Diretor e CGPG)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editEventForm, setEditEventForm] = useState({
    id: '',
    titulo: '',
    descricao: '',
    categoria: 'Acolhimento PEI',
    atribuirA: 'TODA A EQUIPE',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: '',
    turmasProvao: ['3ª Série A (EM)', '3ª Série B (EM)', '3ª Série C (EM)'],
    diaDuplicado: 'Segunda-feira',
    motivoReposicao: ''
  });

  // Estados para Transformar Evento em Tarefa (PDCA / rotina_equipe)
  const [isTransformModalOpen, setIsTransformModalOpen] = useState(false);
  const [transformSaving, setTransformSaving] = useState(false);
  const [transformingEvent, setTransformingEvent] = useState(null);
  const [transformTaskForm, setTransformTaskForm] = useState({
    titulo: '',
    descricao: '',
    frequencia: 'Ação Pontual (Prazo Fixo)',
    atribuirA: 'TODA A EQUIPE',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: ''
  });

  // Estados para Postar Evento Direto no Mural de Recados (Diretor, Vice e CGPG)
  const [isMuralModalOpen, setIsMuralModalOpen] = useState(false);
  const [muralSaving, setMuralSaving] = useState(false);
  const [muralEventTarget, setMuralEventTarget] = useState(null);
  const [muralForm, setMuralForm] = useState({
    titulo: '',
    categoria: 'Avisos Gerais',
    prioridade: 'Normal',
    destinatarios: 'todos',
    conteudo: '',
    fixado: false
  });

  // Form de Novo Evento
  const [newEventForm, setNewEventForm] = useState({
    titulo: '',
    descricao: '',
    categoria: 'Acolhimento PEI',
    atribuirA: 'TODA A EQUIPE',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: '',
    turmasProvao: ['3ª Série A (EM)', '3ª Série B (EM)', '3ª Série C (EM)'],
    diaDuplicado: 'Segunda-feira',
    motivoReposicao: ''
  });

  const notify = (message, type = 'info') => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, 4000);
    } else {
      setFeedbackNotice({ message, type });
      setTimeout(() => setFeedbackNotice(null), 4000);
    }
  };

  // Obter Perfil Atual do Usuário
  const [userRole, setUserRole] = useState(() => {
    if (typeof window !== 'undefined' && typeof window.obterRoleAtual === 'function') {
      return window.obterRoleAtual();
    }
    return window?.currentUserRole || 'DIRETOR';
  });

  useEffect(() => {
    const updateRole = () => {
      const role = typeof window.obterRoleAtual === 'function'
        ? window.obterRoleAtual()
        : (window?.currentUserRole || 'PROFESSOR');
      setUserRole(role || 'PROFESSOR');
    };
    updateRole();
    window.addEventListener('taborrolechange', updateRole);
    window.addEventListener('storage', updateRole);
    return () => {
      window.removeEventListener('taborrolechange', updateRole);
      window.removeEventListener('storage', updateRole);
    };
  }, []);

  // Visibilidade para todos, mas apenas DIRETOR, VICE_DIRETOR e CGPG podem fazer alterações/edições
  const getNormalizedRole = (raw) => {
    if (typeof window !== 'undefined' && typeof window.normalizarUserRole === 'function') {
      return window.normalizarUserRole(raw);
    }
    const str = String(raw || '').trim().toUpperCase().replace(/-/g, '_');
    if (str === 'DIRETOR' || str === 'DIREÇÃO' || str === 'DIRECAO') return 'DIRETOR';
    if (str.includes('VICE') || str === 'VICE_DIRETOR') return 'VICE_DIRETOR';
    if (str.includes('CGPG') || str.includes('COORDENA') || str.includes('CGPCG')) return 'CGPG';
    return str || 'PROFESSOR';
  };

  const roleNorm = getNormalizedRole(userRole);
  const podeEditarAgenda = ['DIRETOR', 'VICE_DIRETOR', 'CGPG'].includes(roleNorm);
  const canCreateEvent = podeEditarAgenda;

  // Carregamento em Tempo Real de Eventos via onSnapshot
  useEffect(() => {
    setLoading(true);

    if (Array.isArray(window.eventosCache) && window.eventosCache.length > 0) {
      setTasks(window.eventosCache);
      setLoading(false);
    }

    const colRef = collection(db, 'eventos');

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const list = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dtInicio = data.dataInicio || data.data || data.dataLimite || '';
        if (dtInicio) {
          list.push({
            id: docSnap.id,
            ...data,
            dataInicio: dtInicio,
            dataFim: data.dataFim || dtInicio,
            horaInicio: data.horaInicio || null,
            horaFim: data.horaFim || null,
            categoria: data.categoria || 'Evento Escolar Geral',
            atribuirA: data.atribuirA || 'TODA A EQUIPE',
            turmasProvao: Array.isArray(data.turmasProvao) ? data.turmasProvao : (data.turmasProvao ? [data.turmasProvao] : []),
            diaDuplicado: data.diaDuplicado || '',
            motivoReposicao: data.motivoReposicao || ''
          });
        }
      });

      window.eventosCache = list;
      setTasks(list);
      setLoading(false);
      setIsRealtimeConnected(true);
    }, (error) => {
      console.warn('Aviso no listener em tempo real de eventos:', error);
      setIsRealtimeConnected(false);
      setLoading(false);
      if (Array.isArray(window.eventosCache) && window.eventosCache.length > 0) {
        setTasks(window.eventosCache);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const carregarEventosAgenda = async () => {
    setLoading(true);
    try {
      const colRef = collection(db, 'eventos');
      const serverSnap = await getDocs(colRef);
      const list = [];
      serverSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const dtInicio = data.dataInicio || data.data || data.dataLimite || '';
        if (dtInicio) {
          list.push({
            id: docSnap.id,
            ...data,
            dataInicio: dtInicio,
            dataFim: data.dataFim || dtInicio,
            horaInicio: data.horaInicio || null,
            horaFim: data.horaFim || null,
            categoria: data.categoria || 'Evento Escolar Geral',
            atribuirA: data.atribuirA || 'TODA A EQUIPE',
            turmasProvao: Array.isArray(data.turmasProvao) ? data.turmasProvao : (data.turmasProvao ? [data.turmasProvao] : []),
            diaDuplicado: data.diaDuplicado || '',
            motivoReposicao: data.motivoReposicao || ''
          });
        }
      });
      window.eventosCache = list;
      setTasks(list);
      setIsRealtimeConnected(true);
      notify('Agenda PEI sincronizada com sucesso.', 'success');
    } catch (e) {
      console.warn('Aviso ao recarregar eventos manualmente:', e);
      notify('Não foi possível atualizar os eventos agora.', 'warning');
    } finally {
      setLoading(false);
    }
  };

  // Helper de filtragem por grupo/pill de categoria
  const matchesCategoryPill = (categoriaRaw, filterKey) => {
    if (!filterKey) return true;
    const cat = String(categoriaRaw || '').toLowerCase();
    const cfg = getCategoryConfig(categoriaRaw);
    switch (filterKey) {
      case 'feriado_recesso':
        return cfg.isSpecial === 'feriado' || cat.includes('feriado') || cat.includes('facultativo') || cat.includes('recesso') || cat.includes('sem aula');
      case 'provao':
        return cfg.isSpecial === 'provao' || cat.includes('provão') || cat.includes('provao');
      case 'reposicao':
        return cfg.isSpecial === 'reposicao' || cat.includes('reposição') || cat.includes('reposicao') || cat.includes('sábado letivo') || cat.includes('sabado letivo');
      case 'avaliacao':
        return cfg.grupo === 'avaliacao' || cat.includes('avalia') || cat.includes('prova') || cat.includes('conselho');
      case 'pedagogico':
        return cfg.grupo === 'pedagogico';
      case 'passeios':
        return cfg.grupo === 'passeio' || cat.includes('passeio') || cat.includes('pesquisa') || cat.includes('feira');
      case 'administrativo':
        return cfg.grupo === 'administrativo' || cfg.grupo === 'geral';
      default:
        return cat.includes(filterKey.toLowerCase());
    }
  };

  // Visibilidade Pública Integral: Acessível e filtrável por cargo, categoria e busca
  const filteredEvents = useMemo(() => {
    return tasks.filter((item) => {
      if (selectedRoleFilter && String(item.atribuirA || '').toUpperCase() !== selectedRoleFilter.toUpperCase()) {
        return false;
      }

      if (selectedCategoryFilter && !matchesCategoryPill(item.categoria, selectedCategoryFilter)) {
        return false;
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const tit = (item.titulo || '').toLowerCase();
        const desc = (item.descricao || '').toLowerCase();
        const cat = (item.categoria || '').toLowerCase();
        const atrib = (item.atribuirA || '').toLowerCase();
        const diaDup = (item.diaDuplicado || '').toLowerCase();
        if (!tit.includes(term) && !desc.includes(term) && !cat.includes(term) && !atrib.includes(term) && !diaDup.includes(term)) {
          return false;
        }
      }

      return true;
    });
  }, [tasks, selectedRoleFilter, selectedCategoryFilter, searchTerm]);

  // Ordenação Cronológica Estrita
  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      const dateA = a.dataInicio || '9999-12-31';
      const dateB = b.dataInicio || '9999-12-31';
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      const timeA = a.horaInicio || '00:00';
      const timeB = b.horaInicio || '00:00';
      if (timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }
      return (a.titulo || '').localeCompare(b.titulo || '');
    });
  }, [filteredEvents]);

  // Contadores gerais
  const qtdPendentes = sortedEvents.filter((ev) => !ev.concluido).length;
  const qtdConcluidos = sortedEvents.filter((ev) => Boolean(ev.concluido)).length;
  const qtdTodos = sortedEvents.length;

  // Estatísticas das categorias especiais para o mês atual
  const statsMes = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    const prefix = `${y}-${String(m).padStart(2, '0')}`;

    const eventosMes = tasks.filter((ev) => {
      const dt = ev.dataInicio || ev.data || '';
      const dtFim = ev.dataFim || dt;
      return dt.startsWith(prefix) || dtFim.startsWith(prefix);
    });

    const feriados = eventosMes.filter((ev) => {
      const c = String(ev.categoria || '').toLowerCase();
      return (
        c.includes('feriado') ||
        c.includes('facultativo') ||
        c.includes('recesso') ||
        c.includes('sem aula') ||
        c.includes('suspens') ||
        c.includes('férias') ||
        c.includes('ferias')
      );
    }).length;

    const provao = eventosMes.filter((ev) => {
      const c = String(ev.categoria || '').toLowerCase();
      return c.includes('provão') || c.includes('provao');
    }).length;

    const reposicoes = eventosMes.filter((ev) => {
      const c = String(ev.categoria || '').toLowerCase();
      return c.includes('reposição') || c.includes('reposicao') || c.includes('sábado letivo') || c.includes('sabado letivo');
    }).length;

    return { total: eventosMes.length, feriados, provao, reposicoes };
  }, [currentDate, tasks]);

  const eventsForListView = sortedEvents.filter((ev) => {
    if (abaStatusLista === 'pendentes') return !ev.concluido;
    if (abaStatusLista === 'concluidos') return Boolean(ev.concluido);
    return true;
  });

  // Auxiliares de Data e Calendário
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const todayYMD = toYMD(new Date());

  // Data Selecionada e Refs para a Visualização Mobile (Data Strip)
  const [selectedMobileDateYMD, setSelectedMobileDateYMD] = useState(() => todayYMD);
  const selectedDayPillRef = useRef(null);

  const handlePrevMonth = () => {
    const nextDt = new Date(year, month - 1, 1);
    setCurrentDate(nextDt);
    setSelectedMobileDateYMD(toYMD(nextDt));
  };

  const handleNextMonth = () => {
    const nextDt = new Date(year, month + 1, 1);
    setCurrentDate(nextDt);
    setSelectedMobileDateYMD(toYMD(nextDt));
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedMobileDateYMD(toYMD(now));
  };

  useEffect(() => {
    if (selectedDayPillRef.current) {
      selectedDayPillRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedMobileDateYMD, month, year]);

  // Gerar Dias do Mês para a Date Strip Mobile
  const mobileDaysInMonth = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const daysInM = new Date(y, m + 1, 0).getDate();
    const list = [];
    const daysArr = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    for (let d = 1; d <= daysInM; d++) {
      const dt = new Date(y, m, d);
      const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = daysArr[dt.getDay()];
      const dayStatus = checkDayStatus(ymd, tasks);

      const eventsOnDay = filteredEvents.filter((ev) => {
        const start = ev.dataInicio;
        const end = ev.dataFim || start;
        return ymd >= start && ymd <= end;
      });

      const dotColors = [];
      eventsOnDay.forEach((ev) => {
        const dot = getCategoryConfig(ev.categoria).dotColorClass || 'bg-indigo-600';
        if (!dotColors.includes(dot) && dotColors.length < 3) {
          dotColors.push(dot);
        }
      });

      list.push({
        dayNum: d,
        ymd,
        dayOfWeek,
        isToday: ymd === todayYMD,
        eventsCount: eventsOnDay.length,
        hasPending: eventsOnDay.some((e) => !e.concluido),
        dotColors,
        dayStatus
      });
    }
    return list;
  }, [currentDate, todayYMD, filteredEvents, tasks]);

  // Eventos Filtrados para o Dia Selecionado na Date Strip
  const mobileEventsForSelectedDate = useMemo(() => {
    if (!selectedMobileDateYMD) return [];
    return filteredEvents
      .filter((ev) => {
        const start = ev.dataInicio;
        const end = ev.dataFim || start;
        return selectedMobileDateYMD >= start && selectedMobileDateYMD <= end;
      })
      .sort((a, b) => {
        const timeA = a.horaInicio || '00:00';
        const timeB = b.horaInicio || '00:00';
        return timeA.localeCompare(timeB);
      });
  }, [selectedMobileDateYMD, filteredEvents]);

  const selectedDateDayStatus = useMemo(() => {
    return checkDayStatus(selectedMobileDateYMD, tasks);
  }, [selectedMobileDateYMD, tasks]);

  const handleGoToTodayMobile = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedMobileDateYMD(toYMD(now));
  };

  const handleOpenAddModalForDate = (ymd) => {
    const targetYMD = ymd || selectedMobileDateYMD || todayYMD;
    setNewEventForm((prev) => ({
      ...prev,
      dataInicio: targetYMD,
      dataFim: targetYMD
    }));
    setIsAddModalOpen(true);
  };

  // Gerar dias da grade do mês
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startDayOfWeek = firstDayOfMonth.getDay();

  const calendarCells = [];
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const prevDate = new Date(year, month, -i);
    calendarCells.push({
      dateObj: prevDate,
      ymd: toYMD(prevDate),
      isCurrentMonth: false
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const currDate = new Date(year, month, d);
    calendarCells.push({
      dateObj: currDate,
      ymd: toYMD(currDate),
      isCurrentMonth: true
    });
  }

  const remainingCells = (7 - (calendarCells.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const nextDate = new Date(year, month + 1, i);
    calendarCells.push({
      dateObj: nextDate,
      ymd: toYMD(nextDate),
      isCurrentMonth: false
    });
  }

  const getEventsForDate = (dateYMD) => {
    return filteredEvents.filter((ev) => {
      const start = ev.dataInicio;
      const end = ev.dataFim || start;
      return dateYMD >= start && dateYMD <= end;
    });
  };

  const formatDataBR = (ymd) => {
    if (!ymd) return '';
    const parts = ymd.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return ymd;
  };

  const getDayOfWeekShortBR = (ymd) => {
    if (!ymd) return '';
    const parts = ymd.split('-');
    if (parts.length !== 3) return '';
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return days[d.getDay()];
  };

  const formatRoleLabel = (role) => {
    const r = String(role || 'TODA A EQUIPE').trim().toUpperCase();
    if (r === 'VICE_DIRETOR' || r === 'VICE-DIRETOR') return 'Vice-Direção';
    if (r === 'TODA A EQUIPE') return 'Toda a Equipe';
    if (r === 'PROFESSORES') return 'Professores';
    if (r === 'SECRETARIA') return 'Secretaria';
    if (r === 'DIRETOR') return 'Direção';
    return r;
  };

  const getEventCardStyle = (ev) => {
    if (ev.concluido) {
      return 'bg-slate-100/80 text-slate-400 border border-slate-200/70 border-l-4 border-l-slate-300 line-through';
    }
    const catCfg = getCategoryConfig(ev.categoria);
    return catCfg.cardClass || 'bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600 hover:bg-indigo-100/70 font-medium';
  };

  const isCategoriaFeriadoOuRecesso = (catName) => {
    const c = String(catName || '').toLowerCase();
    return c.includes('feriado') || c.includes('facultativo') || c.includes('recesso') || c.includes('sem aula') || c.includes('férias');
  };

  // Alternar Conclusão do Evento
  const handleToggleConcluido = async (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      notify('Apenas Diretor, Vice-Diretor e CGPG podem alterar o status de eventos.', 'warning');
      return;
    }

    const prevList = [...(tasks || [])];
    const novoStatus = !ev.concluido;
    const updatedList = prevList.map((item) => (item.id === ev.id ? { ...item, concluido: novoStatus } : item));
    setTasks(updatedList);
    window.eventosCache = updatedList;
    if (selectedEvent && selectedEvent.id === ev.id) {
      setSelectedEvent({ ...selectedEvent, concluido: novoStatus });
    }

    try {
      const docRef = doc(db, 'eventos', ev.id);
      const updatePayload = {
        concluido: novoStatus,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: userRole
      };
      await updateDoc(docRef, updatePayload);
    } catch (err) {
      console.error('Erro ao alternar conclusão do evento na Agenda:', err);
      setTasks(prevList);
      window.eventosCache = prevList;
      notify('Erro ao atualizar status do evento.', 'warning');
    }
  };

  // Excluir evento (com confirmação inline segura para iFrames, sem window.confirm)
  const handleDeleteEvent = async (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      notify('Acesso negado: Apenas a Direção Escolar e CGPG possuem autorização para excluir eventos da agenda.', 'warning');
      return;
    }

    if (confirmDeleteId !== ev.id) {
      setConfirmDeleteId(ev.id);
      return;
    }

    setConfirmDeleteId(null);
    const prevList = [...(tasks || [])];
    const updatedList = prevList.filter((item) => item.id !== ev.id);
    setTasks(updatedList);
    window.eventosCache = updatedList;
    if (selectedEvent && selectedEvent.id === ev.id) {
      setSelectedEvent(null);
    }

    try {
      await deleteDoc(doc(db, 'eventos', ev.id));
      notify(`Evento "${ev.titulo}" excluído.`, 'success');
    } catch (err) {
      console.error("Erro ao excluir evento da coleção 'eventos':", err);
      setTasks(prevList);
      window.eventosCache = prevList;
      notify('Erro ao excluir evento no banco de dados.', 'warning');
    }
  };

  // Criar Novo Evento com Validações Especiais
  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!canCreateEvent) {
      notify('Acesso restrito: Apenas Diretor, Vice-Diretor e CGPG podem cadastrar novos eventos na Agenda PEI.', 'warning');
      return;
    }
    if (!newEventForm.titulo.trim() || !newEventForm.dataInicio) {
      notify('Título e Data de Início são obrigatórios.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const dtInicio = newEventForm.dataInicio;
      const dtFim = newEventForm.dataFim ? newEventForm.dataFim : dtInicio;
      const hrInicio = newEventForm.horaInicio ? newEventForm.horaInicio : null;
      const hrFim = newEventForm.horaFim ? newEventForm.horaFim : null;

      // REGRA CRÍTICA: Sem campos 'id' ou '_id' no payload enviado ao banco
      const payload = {
        titulo: newEventForm.titulo.trim(),
        descricao: newEventForm.descricao.trim(),
        categoria: newEventForm.categoria || 'Acolhimento PEI',
        atribuirA: newEventForm.atribuirA || 'TODA A EQUIPE',
        data: dtInicio,
        dataInicio: dtInicio,
        dataFim: dtFim,
        horaInicio: hrInicio,
        horaFim: hrFim,
        turmasProvao: newEventForm.turmasProvao || [],
        diaDuplicado: newEventForm.diaDuplicado || '',
        motivoReposicao: newEventForm.motivoReposicao || '',
        concluido: false,
        criadoEm: new Date().toISOString(),
        criadoPor: userRole
      };

      const docAdded = await addDoc(collection(db, 'eventos'), payload);
      const newEventObj = { id: docAdded.id, ...payload };

      const updatedList = [...(tasks || []), newEventObj];
      setTasks(updatedList);
      window.eventosCache = updatedList;

      setIsAddModalOpen(false);
      setNewEventForm({
        titulo: '',
        descricao: '',
        categoria: 'Acolhimento PEI',
        atribuirA: 'TODA A EQUIPE',
        dataInicio: '',
        horaInicio: '',
        dataFim: '',
        horaFim: '',
        turmasProvao: ['3ª Série A (EM)', '3ª Série B (EM)', '3ª Série C (EM)'],
        diaDuplicado: 'Segunda-feira',
        motivoReposicao: ''
      });

      notify(`Evento "${payload.titulo}" cadastrado com sucesso!`, 'success');
    } catch (err) {
      console.error("Erro ao criar evento na coleção 'eventos':", err);
      notify('Erro ao salvar evento. Tente novamente.', 'warning');
    } finally {
      setSaving(false);
    }
  };

  // Abrir Modal de Edição
  const handleOpenEditModal = (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      notify('Acesso restrito: Apenas a Direção, Vice-Direção e CGPG possuem autorização para editar eventos da Agenda PEI.', 'warning');
      return;
    }

    setConfirmDeleteId(null);
    setEditEventForm({
      id: ev.id,
      titulo: ev.titulo || '',
      descricao: ev.descricao || '',
      categoria: ev.categoria || 'Acolhimento PEI',
      atribuirA: ev.atribuirA || 'TODA A EQUIPE',
      dataInicio: ev.dataInicio || ev.data || '',
      horaInicio: ev.horaInicio || '',
      dataFim: ev.dataFim || ev.dataInicio || ev.data || '',
      horaFim: ev.horaFim || '',
      turmasProvao: Array.isArray(ev.turmasProvao)
        ? ev.turmasProvao
        : (ev.turmasProvao ? [ev.turmasProvao] : ['3ª Série A (EM)', '3ª Série B (EM)', '3ª Série C (EM)']),
      diaDuplicado: ev.diaDuplicado || 'Segunda-feira',
      motivoReposicao: ev.motivoReposicao || ''
    });
    setIsEditModalOpen(true);
  };

  // Salvar Edição de Evento
  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    if (!podeEditarAgenda) {
      notify('Acesso restrito: Apenas a Direção, Vice-Direção e CGPG podem editar eventos.', 'warning');
      return;
    }
    if (!editEventForm.titulo.trim() || !editEventForm.dataInicio) {
      notify('Título e Data de Início são obrigatórios.', 'warning');
      return;
    }

    setEditSaving(true);
    try {
      const targetDocId = editEventForm.id;
      const dtInicio = editEventForm.dataInicio;
      const dtFim = editEventForm.dataFim ? editEventForm.dataFim : dtInicio;
      const hrInicio = editEventForm.horaInicio ? editEventForm.horaInicio : null;
      const hrFim = editEventForm.horaFim ? editEventForm.horaFim : null;

      // REGRA CRÍTICA: Sem campos 'id' ou '_id' no payload enviado ao banco
      const payload = {
        titulo: editEventForm.titulo.trim(),
        descricao: editEventForm.descricao.trim(),
        categoria: editEventForm.categoria || 'Acolhimento PEI',
        atribuirA: editEventForm.atribuirA || 'TODA A EQUIPE',
        data: dtInicio,
        dataInicio: dtInicio,
        dataFim: dtFim,
        horaInicio: hrInicio,
        horaFim: hrFim,
        turmasProvao: editEventForm.turmasProvao || [],
        diaDuplicado: editEventForm.diaDuplicado || '',
        motivoReposicao: editEventForm.motivoReposicao || '',
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: userRole
      };

      const updatedList = (tasks || []).map((item) =>
        item.id === targetDocId ? { ...item, ...payload } : item
      );
      setTasks(updatedList);
      window.eventosCache = updatedList;

      if (selectedEvent && selectedEvent.id === targetDocId) {
        setSelectedEvent((prev) => ({ ...prev, ...payload }));
      }

      await updateDoc(doc(db, 'eventos', targetDocId), payload);
      setIsEditModalOpen(false);
      notify(`Evento "${payload.titulo}" atualizado com sucesso!`, 'success');
    } catch (err) {
      console.error("Erro ao atualizar evento na coleção 'eventos':", err);
      notify('Erro ao salvar alterações no evento. Tente novamente.', 'warning');
    } finally {
      setEditSaving(false);
    }
  };

  // Abrir Modal para Transformar Evento em Tarefa (rotina_equipe)
  const handleOpenTransformModal = (ev, e) => {
    if (e) e.stopPropagation();
    setTransformingEvent(ev);

    const descOriginal = ev.descricao ? ev.descricao.trim() : '';
    const descSugerida = descOriginal
      ? `${descOriginal}\n\n[Origem: Evento da Agenda PEI]`
      : `Ação pedagógica/gestora originada a partir do evento "${ev.titulo}" na Agenda PEI.`;

    setTransformTaskForm({
      titulo: ev.titulo ? `[Agenda] ${ev.titulo}` : '',
      descricao: descSugerida,
      frequencia: 'Ação Pontual (Prazo Fixo)',
      atribuirA: ev.atribuirA || 'TODA A EQUIPE',
      dataInicio: ev.dataInicio || ev.data || '',
      horaInicio: ev.horaInicio || '',
      dataFim: ev.dataFim || ev.dataInicio || ev.data || '',
      horaFim: ev.horaFim || ''
    });

    setIsTransformModalOpen(true);
  };

  // Confirmar Criação da Tarefa (sem id/_id no payload)
  const handleSaveTaskFromEvent = async (e) => {
    e.preventDefault();
    if (!transformTaskForm.titulo.trim()) {
      notify('Por favor, preencha o título da tarefa.', 'warning');
      return;
    }

    const isPontual =
      transformTaskForm.frequencia === 'Ação Pontual (Prazo Fixo)' ||
      transformTaskForm.frequencia === 'Pontual';

    if (isPontual && !transformTaskForm.dataInicio) {
      notify('Por favor, informe a Data de Início da tarefa.', 'warning');
      return;
    }

    setTransformSaving(true);
    try {
      const dtInicio = transformTaskForm.dataInicio || null;
      const dtFim = transformTaskForm.dataFim || dtInicio;
      const hrInicio = transformTaskForm.horaInicio || null;
      const hrFim = transformTaskForm.horaFim || null;

      // REGRA CRÍTICA: Sem campos 'id' ou '_id' no payload enviado ao banco
      const payloadTarefa = {
        titulo: transformTaskForm.titulo.trim(),
        descricao: transformTaskForm.descricao.trim(),
        frequencia: transformTaskForm.frequencia,
        atribuirA: transformTaskForm.atribuirA,
        atribuidoA: transformTaskForm.atribuirA,
        dataInicio: isPontual ? dtInicio : null,
        horaInicio: isPontual ? hrInicio : null,
        dataFim: isPontual ? dtFim : null,
        horaFim: isPontual ? hrFim : null,
        dataLimite: isPontual ? dtFim : null,
        concluidoPor: [],
        concluidaPor: [],
        concluido: false,
        ultimaConclusao: null,
        origemEventoId: transformingEvent ? transformingEvent.id : null,
        origemTituloEvento: transformingEvent ? transformingEvent.titulo : null,
        origemTipo: 'agenda_pei',
        criadoEm: new Date().toISOString(),
        criadoPor: `${userRole} (Gerado via Agenda PEI)`
      };

      const docTarefaRef = await addDoc(collection(db, 'rotina_equipe'), payloadTarefa);
      const novaTarefaComId = { id: docTarefaRef.id, ...payloadTarefa };

      if (typeof window !== 'undefined' && Array.isArray(window.tasksCache)) {
        window.tasksCache = [...window.tasksCache, novaTarefaComId];
      }

      if (transformingEvent && transformingEvent.id) {
        const updateEventoObj = {
          temTarefaVinculada: true,
          tarefaVinculadaId: docTarefaRef.id,
          tarefaVinculadaEm: new Date().toISOString()
        };

        const updatedTasks = (tasks || []).map((t) =>
          t.id === transformingEvent.id ? { ...t, ...updateEventoObj } : t
        );
        setTasks(updatedTasks);
        window.eventosCache = updatedTasks;

        if (selectedEvent && selectedEvent.id === transformingEvent.id) {
          setSelectedEvent((prev) => ({ ...prev, ...updateEventoObj }));
        }

        try {
          await updateDoc(doc(db, 'eventos', transformingEvent.id), updateEventoObj);
        } catch (updateErr) {
          console.warn('Aviso ao marcar vínculo no evento da agenda:', updateErr);
        }
      }

      setIsTransformModalOpen(false);
      notify(`Tarefa "${payloadTarefa.titulo}" criada no painel de Minhas Tarefas (PDCA)!`, 'success');
    } catch (err) {
      console.error('Erro ao salvar tarefa a partir do evento:', err);
      notify('Ocorreu um erro ao transformar o evento em tarefa. Tente novamente.', 'warning');
    } finally {
      setTransformSaving(false);
    }
  };

  // Abrir Modal para Postar Evento Direto no Mural
  const handleOpenMuralModal = (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      notify('Acesso restrito: Apenas Direção, Vice-Direção e CGPG podem postar avisos no Mural de Recados.', 'warning');
      return;
    }

    setMuralEventTarget(ev);

    const isMultiDay = ev.dataInicio && ev.dataFim && ev.dataInicio !== ev.dataFim;
    const datasTexto = isMultiDay
      ? `${formatDataBR(ev.dataInicio)} até ${formatDataBR(ev.dataFim)}`
      : formatDataBR(ev.dataInicio);

    const horarioTexto = ev.horaInicio
      ? `${ev.horaInicio}${ev.horaFim ? ` às ${ev.horaFim}` : ''}`
      : 'Dia Inteiro';

    let dest = 'todos';
    const atribUpper = String(ev.atribuirA || '').toUpperCase();
    if (atribUpper.includes('PROFESSOR') || atribUpper.includes('DOCENTE')) {
      dest = 'professores';
    } else if (atribUpper.includes('DIRETOR') || atribUpper.includes('VICE') || atribUpper.includes('CGPG')) {
      dest = 'gestao';
    }

    let catMural = 'Avisos Gerais';
    const catEvUpper = String(ev.categoria || '').toUpperCase();
    if (catEvUpper.includes('PEDAG') || catEvUpper.includes('ACOLHIMENTO') || catEvUpper.includes('CONSELHO') || catEvUpper.includes('PROVÃO')) {
      catMural = 'Pedagógico';
    } else if (catEvUpper.includes('INSTITUCIONAL') || catEvUpper.includes('FERIADO') || catEvUpper.includes('REPOSIÇÃO') || catEvUpper.includes('RECESSO')) {
      catMural = 'Institucional';
    }

    const linhasEspeciais = [];
    if (ev.categoria?.includes('Provão')) {
      linhasEspeciais.push('Formato: Aulas ONLINE para as demais séries');
      if (ev.turmasProvao?.length) {
        linhasEspeciais.push(`Prova Presencial na Escola: ${ev.turmasProvao.join(', ')}`);
      }
    } else if (ev.categoria?.includes('Reposição')) {
      linhasEspeciais.push(`Sábado Letivo: Grade e horário duplicados da ${ev.diaDuplicado || 'Segunda-feira'}`);
    } else if (isCategoriaFeriadoOuRecesso(ev.categoria)) {
      linhasEspeciais.push('Dia Não Letivo: Atividades escolares e agendamentos suspensos.');
    }

    const textoGerado = [
      `COMPROMISSO NA AGENDA PEI: ${ev.titulo}`,
      `Data: ${datasTexto}`,
      `Horário: ${horarioTexto}`,
      `Público: ${ev.atribuirA || 'Toda a Equipe'}`,
      ev.categoria ? `Categoria: ${ev.categoria}` : '',
      ...linhasEspeciais,
      ev.descricao ? `\nOrientações e Pauta:\n${ev.descricao}` : ''
    ].filter(Boolean).join('\n');

    setMuralForm({
      titulo: `[Agenda PEI] ${ev.titulo}`,
      categoria: catMural,
      prioridade: 'Normal',
      destinatarios: dest,
      conteudo: textoGerado,
      fixado: false
    });
    setIsMuralModalOpen(true);
  };

  // Salvar Recado no Mural (sem id/_id no payload)
  const handlePostToMural = async (e) => {
    e.preventDefault();
    if (!podeEditarAgenda) {
      notify('Apenas a Direção, Vice-Direção e CGPG têm autorização para postar no Mural.', 'warning');
      return;
    }

    if (!muralForm.titulo.trim() || !muralForm.conteudo.trim()) {
      notify('Título e Conteúdo do recado são obrigatórios.', 'warning');
      return;
    }

    setMuralSaving(true);
    try {
      const agoraIso = new Date().toISOString();
      // REGRA CRÍTICA: Sem campos 'id' ou '_id' no payload enviado ao banco
      const novoRecado = {
        titulo: muralForm.titulo.trim(),
        categoria: muralForm.categoria || 'Avisos Gerais',
        prioridade: muralForm.prioridade || 'Normal',
        destinatarios: muralForm.destinatarios || 'todos',
        conteudo: muralForm.conteudo.trim(),
        fixado: Boolean(muralForm.fixado),
        arquivado: false,
        data_criacao: agoraIso,
        autor_nome: 'Gestão Escolar',
        autor_cargo: userRole || 'DIREÇÃO',
        origemAgendaEventoId: muralEventTarget?.id || null,
        origemTipo: 'AGENDA_PEI',
        cientes: []
      };

      let docId = 'mural_' + Date.now();
      try {
        const docRef = await addDoc(collection(db, 'mural_recados'), novoRecado);
        docId = docRef.id;
      } catch (errDb) {
        console.warn('Salvo localmente no mural:', errDb);
      }

      const recadoComId = { id: docId, ...novoRecado };

      if (typeof window !== 'undefined') {
        if (!Array.isArray(window.muralRecadosCache)) {
          window.muralRecadosCache = [];
        }
        window.muralRecadosCache.unshift(recadoComId);
      }

      if (muralEventTarget && muralEventTarget.id) {
        const updateFlagObj = {
          postadoNoMural: true,
          muralRecadoId: docId,
          muralPostadoEm: agoraIso
        };

        const updatedTasks = (tasks || []).map((t) =>
          t.id === muralEventTarget.id ? { ...t, ...updateFlagObj } : t
        );
        setTasks(updatedTasks);
        window.eventosCache = updatedTasks;

        if (selectedEvent && selectedEvent.id === muralEventTarget.id) {
          setSelectedEvent((prev) => ({ ...prev, ...updateFlagObj }));
        }

        try {
          await updateDoc(doc(db, 'eventos', muralEventTarget.id), updateFlagObj);
        } catch (updErr) {
          console.warn('Aviso ao salvar flag postadoNoMural:', updErr);
        }
      }

      setIsMuralModalOpen(false);
      setMuralEventTarget(null);
      notify('Evento postado com sucesso no Mural de Recados!', 'success');
    } catch (err) {
      console.error('Erro ao postar evento no mural:', err);
      notify('Ocorreu um erro ao postar no mural de recados. Tente novamente.', 'warning');
    } finally {
      setMuralSaving(false);
    }
  };

  // Helper para alternar turmas selecionadas no Provão Paulista
  const toggleTurmaProvao = (turma, isEdit = false) => {
    if (isEdit) {
      setEditEventForm((prev) => {
        const current = Array.isArray(prev.turmasProvao) ? [...prev.turmasProvao] : [];
        if (current.includes(turma)) {
          return { ...prev, turmasProvao: current.filter((t) => t !== turma) };
        }
        return { ...prev, turmasProvao: [...current, turma] };
      });
    } else {
      setNewEventForm((prev) => {
        const current = Array.isArray(prev.turmasProvao) ? [...prev.turmasProvao] : [];
        if (current.includes(turma)) {
          return { ...prev, turmasProvao: current.filter((t) => t !== turma) };
        }
        return { ...prev, turmasProvao: [...current, turma] };
      });
    }
  };

  const selectAllTurmasEM = (isEdit = false) => {
    const turmasEM = TURMAS_ESCOLARES.filter((t) => t.includes('(EM)'));
    if (isEdit) {
      setEditEventForm((prev) => ({ ...prev, turmasProvao: turmasEM }));
    } else {
      setNewEventForm((prev) => ({ ...prev, turmasProvao: turmasEM }));
    }
  };

  const hasActiveFilters = Boolean(searchTerm.trim() || selectedCategoryFilter || selectedRoleFilter);

  const logoSrc =
    logoFallbackIndex === 0
      ? '/assets/logo-clovis.svg'
      : logoFallbackIndex === 1
      ? '/assets/aistudio/Logo_Clovis_df1054e5.jpeg'
      : null;

  return (
    <div className="min-h-screen bg-slate-50/80 px-3 py-4 sm:px-6 sm:py-6 pb-24 md:pb-8 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Aviso toast fallback in-component caso window.showToast não esteja presente */}
        {feedbackNotice && (
          <div
            role="status"
            className={`px-4 py-3 rounded-2xl border text-xs font-medium flex items-center justify-between gap-3 shadow-2xs ${
              feedbackNotice.type === 'success'
                ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/80'
                : feedbackNotice.type === 'warning'
                ? 'bg-amber-50/90 text-amber-900 border-amber-200/80'
                : 'bg-white text-slate-800 border-slate-200/80'
            }`}
          >
            <span>{feedbackNotice.message}</span>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              aria-label="Fechar aviso"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        )}

        {/* HEADER GLASSMORPHISM UNIFICADO */}
        <header className="bg-white/90 backdrop-blur-md md:sticky md:top-2 z-20 rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Identidade + Título + Status em Tempo Real */}
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white border border-slate-200/80 shadow-2xs flex items-center justify-center shrink-0 overflow-hidden p-1">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt="Logo EE Prof. Clóvis de Lucca"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoFallbackIndex((idx) => idx + 1)}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <i className="fa-solid fa-school text-indigo-600 text-lg"></i>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 truncate">
                    Agenda PEI &amp; Calendário Escolar
                  </h1>

                  {/* Pílula discreta de status em tempo real */}
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap shrink-0 ${
                      isRealtimeConnected
                        ? 'bg-emerald-50/90 text-emerald-800 border-emerald-200/70'
                        : 'bg-amber-50/90 text-amber-800 border-amber-200/70'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                      }`}
                    ></span>
                    <span>{isRealtimeConnected ? 'Tempo Real' : 'Conectando'}</span>
                  </span>

                  <button
                    type="button"
                    onClick={carregarEventosAgenda}
                    disabled={loading}
                    title="Sincronizar eventos da Agenda PEI"
                    aria-label="Sincronizar eventos"
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <i className={`fa-solid fa-arrows-rotate text-xs ${loading ? 'fa-spin text-indigo-600' : ''}`}></i>
                  </button>
                </div>

                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  EE Prof. Clóvis de Lucca · Feriados, Provão Paulista, Reposições e Cronograma Integrado
                </p>
              </div>
            </div>

            {/* Controles Estilo Apple: Seletor de Mês + Segmented Control + Regras + Novo Evento */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              {/* Seletor de Mês Estilo Apple */}
              <div className="inline-flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/70">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="Mês Anterior"
                  className="w-8 h-8 inline-flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <span className="px-2.5 text-xs font-semibold text-slate-800 min-w-[120px] text-center whitespace-nowrap tabular-nums">
                  {NORM_MONTH_NAMES[month]} {year}
                </span>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Próximo Mês"
                  className="w-8 h-8 inline-flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </div>

              <button
                type="button"
                onClick={handleToday}
                className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Hoje
              </button>

              {/* Segmented Control (Calendário / Lista) */}
              <div className="inline-flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/70">
                <button
                  type="button"
                  onClick={() => setViewMode('calendar')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    viewMode === 'calendar'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <i className="fa-regular fa-calendar text-xs"></i>
                  <span>Calendário</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    viewMode === 'list'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <i className="fa-solid fa-list-ul text-xs"></i>
                  <span>Lista</span>
                </button>
              </div>

              {/* Guia de Regras */}
              <button
                type="button"
                onClick={() => setIsRegrasModalOpen(true)}
                className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Ver Regras Operacionais de Feriados, Provão Paulista e Reposição"
              >
                <i className="fa-regular fa-circle-question text-indigo-600"></i>
                <span className="hidden sm:inline">Regras</span>
              </button>

              {/* CTA Principal (Desktop/Tablet) */}
              {canCreateEvent && (
                <button
                  type="button"
                  onClick={() => handleOpenAddModalForDate()}
                  className="hidden md:inline-flex px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition-colors items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <i className="fa-solid fa-plus text-xs"></i>
                  <span>Novo Evento</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* BENTO GRID: 4 CONTADORES DO MÊS */}
        <section aria-label="Resumo mensal" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
              <i className="fa-regular fa-calendar-check text-base"></i>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 truncate">Total no mês</p>
              <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">
                {statsMes.total} <span className="text-xs font-medium text-slate-400">eventos</span>
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-umbrella-beach text-base"></i>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 truncate">Feriados e Recessos</p>
              <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">
                {statsMes.feriados} <span className="text-xs font-medium text-rose-600/80">sem aulas</span>
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-graduation-cap text-base"></i>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 truncate">Provão Paulista</p>
              <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">
                {statsMes.provao} <span className="text-xs font-medium text-purple-600/80">híbrido / online</span>
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-arrows-rotate text-base"></i>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 truncate">Sábados Letivos</p>
              <p className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">
                {statsMes.reposicoes} <span className="text-xs font-medium text-emerald-600/80">com aula</span>
              </p>
            </div>
          </div>
        </section>

        {/* COMMAND BAR DE FILTROS: BUSCA + FILTER PILLS DESLIZÁVEIS */}
        <section
          aria-label="Filtros da agenda"
          className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] p-3.5 sm:p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por título, categoria, descrição, público ou dia duplicado..."
                className="w-full pl-9 pr-9 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                >
                  <i className="fa-solid fa-xmark text-xs"></i>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 text-xs shrink-0">
              <span className="text-slate-500 font-medium tabular-nums">
                {filteredEvents.length} {filteredEvents.length === 1 ? 'compromisso' : 'compromissos'}
              </span>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategoryFilter('');
                    setSelectedRoleFilter('');
                  }}
                  className="text-indigo-600 hover:text-indigo-800 font-semibold text-xs cursor-pointer whitespace-nowrap"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Filter Pills Horizontais: Categorias */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {CATEGORY_FILTER_PILLS.map((pill) => {
              const active = selectedCategoryFilter === pill.id;
              return (
                <button
                  key={pill.id || 'all-cats'}
                  type="button"
                  onClick={() => setSelectedCategoryFilter(active && pill.id !== '' ? '' : pill.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                      : 'bg-slate-50/80 text-slate-600 border-slate-200/70 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <i className={`${pill.icon} text-[11px] ${active ? 'text-white' : 'text-slate-400'}`}></i>
                  <span>{pill.label}</span>
                </button>
              );
            })}
          </div>

          {/* Filter Pills Horizontais: Público / Cargo */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5 border-t border-slate-100">
            <span className="text-[11px] font-medium text-slate-400 pr-1 shrink-0">Público:</span>
            {ROLE_FILTER_PILLS.map((pill) => {
              const active = selectedRoleFilter === pill.id;
              return (
                <button
                  key={pill.id || 'all-roles'}
                  type="button"
                  onClick={() => setSelectedRoleFilter(active && pill.id !== '' ? '' : pill.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200/80'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* CONTEÚDO PRINCIPAL */}
        {loading && tasks.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] text-center space-y-3">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-indigo-600"></i>
            <p className="text-xs font-medium text-slate-500">
              Sincronizando Agenda PEI com o banco de dados...
            </p>
          </div>
        ) : viewMode === 'calendar' ? (
          <>
            {/* ============================================================== */}
            {/* EXPERIÊNCIA DESKTOP (>= md): GRADE MENSAL DE 7 COLUNAS         */}
            {/* ============================================================== */}
            <div className="hidden md:block bg-white rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden">
              {/* Cabeçalho dos dias da semana */}
              <div className="grid grid-cols-7 bg-slate-50/90 border-b border-slate-200/80 text-xs font-semibold text-slate-500 text-center py-3">
                <div className="text-rose-500">Dom</div>
                <div>Seg</div>
                <div>Ter</div>
                <div>Qua</div>
                <div>Qui</div>
                <div>Sex</div>
                <div className="text-slate-600">Sáb</div>
              </div>

              {/* Grade de 7 Colunas */}
              <div className="grid grid-cols-7 divide-x divide-y divide-slate-200/70 bg-slate-200/40">
                {calendarCells.map((cell) => {
                  const dayEvents = getEventsForDate(cell.ymd);
                  const isToday = cell.ymd === todayYMD;
                  const dayStatus = checkDayStatus(cell.ymd, tasks);

                  return (
                    <div
                      key={cell.ymd}
                      onClick={() => canCreateEvent && handleOpenAddModalForDate(cell.ymd)}
                      className={`p-2.5 min-h-[130px] transition-colors flex flex-col justify-start relative group ${
                        canCreateEvent ? 'cursor-pointer' : ''
                      } ${
                        cell.isCurrentMonth
                          ? (dayStatus.bgCellClass || 'bg-white hover:bg-slate-50/60')
                          : 'bg-slate-50/60 text-slate-400'
                      } ${isToday ? 'ring-2 ring-inset ring-indigo-600/20 bg-indigo-50/10 z-10' : ''}`}
                    >
                      {/* Topo da célula: Dia + Botão rápido '+' no hover */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className={`text-xs tabular-nums inline-flex items-center justify-center ${
                            isToday
                              ? 'w-6 h-6 rounded-full bg-indigo-600 text-white font-semibold shadow-2xs'
                              : cell.isCurrentMonth
                              ? (dayStatus.isWeekend ? 'text-slate-400 font-medium' : 'text-slate-700 font-semibold')
                              : 'text-slate-400 font-normal'
                          }`}
                        >
                          {cell.dateObj.getDate()}
                        </span>

                        <div className="flex items-center gap-1">
                          {canCreateEvent && cell.isCurrentMonth && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenAddModalForDate(cell.ymd);
                              }}
                              aria-label={`Adicionar evento em ${formatDataBR(cell.ymd)}`}
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-500 hover:text-indigo-700 flex items-center justify-center transition-opacity cursor-pointer"
                            >
                              <i className="fa-solid fa-plus text-[10px]"></i>
                            </button>
                          )}

                          {dayEvents.length > 0 && (
                            <span className="text-[11px] font-medium tabular-nums text-slate-400">
                              {dayEvents.length}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Indicadores Semânticos Suaves para Dias Especiais */}
                      {dayStatus.hasFeriado && (
                        <div
                          className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500 flex items-center gap-1.5"
                          title="Dia Não Letivo: Atividades e agendamentos suspensos."
                        >
                          <i className="fa-solid fa-umbrella-beach text-[9px] text-rose-600 shrink-0"></i>
                          <span className="truncate">Sem aula</span>
                        </div>
                      )}

                      {dayStatus.hasReposicao && (
                        <div
                          className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-50/90 text-emerald-900 border border-emerald-200/60 border-l-4 border-l-emerald-500 flex items-center gap-1.5"
                          title={`Sábado Letivo com Aula Presencial (Horário de ${dayStatus.reposicaoEvent?.diaDuplicado || 'Segunda-feira'})`}
                        >
                          <i className="fa-solid fa-arrows-rotate text-[9px] text-emerald-600 shrink-0"></i>
                          <span className="truncate">
                            Reposição ({dayStatus.reposicaoEvent?.diaDuplicado || 'Segunda'})
                          </span>
                        </div>
                      )}

                      {dayStatus.hasProvao && (
                        <div
                          className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-purple-50/90 text-purple-900 border border-purple-200/60 border-l-4 border-l-purple-600 flex items-center gap-1.5"
                          title="Provão Paulista: Aulas regulares online, prova presencial para turmas indicadas."
                        >
                          <i className="fa-solid fa-graduation-cap text-[9px] text-purple-600 shrink-0"></i>
                          <span className="truncate">Provão (Online)</span>
                        </div>
                      )}

                      {dayStatus.isWeekend && !dayStatus.hasReposicao && !dayStatus.hasFeriado && cell.isCurrentMonth && dayEvents.length === 0 && (
                        <div className="text-[10px] font-normal text-slate-400 mt-auto">
                          Fim de semana
                        </div>
                      )}

                      {/* Lista de Eventos do Dia */}
                      <div className="space-y-1 overflow-y-auto max-h-[88px] custom-scrollbar pr-0.5">
                        {dayEvents.map((ev) => {
                          const isMultiDay = ev.dataInicio !== ev.dataFim;
                          const hasTime = Boolean(ev.horaInicio);
                          const catConfig = getCategoryConfig(ev.categoria);

                          return (
                            <div
                              key={`${ev.id}-${cell.ymd}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
                                setSelectedEvent(ev);
                              }}
                              className={`px-2 py-1 rounded-lg text-[11px] leading-tight cursor-pointer transition-colors ${getEventCardStyle(ev)}`}
                              title={`${ev.titulo} · ${ev.categoria}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate flex-1 flex items-center gap-1">
                                  <i className={`${catConfig.icone} text-[9px] shrink-0 opacity-75`}></i>
                                  {hasTime && (
                                    <span className="font-semibold tabular-nums opacity-80 shrink-0">
                                      {ev.horaInicio}
                                    </span>
                                  )}
                                  <span className="truncate font-medium">{ev.titulo}</span>
                                </span>

                                {isMultiDay && (
                                  <span className="text-[9px] font-medium opacity-70 shrink-0">
                                    +dias
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ============================================================== */}
            {/* EXPERIÊNCIA MOBILE NATIVA (< md): DATE STRIP + TIMELINE DIÁRIA */}
            {/* ============================================================== */}
            <div className="block md:hidden space-y-4">
              {/* Date Strip Horizontal Interativa */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] p-3 space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-slate-800">
                    {NORM_MONTH_NAMES[month]} {year}
                  </span>
                  <button
                    type="button"
                    onClick={handleGoToTodayMobile}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    Ir para hoje
                  </button>
                </div>

                <div className="overflow-x-auto no-scrollbar flex gap-2 py-1 scroll-smooth">
                  {mobileDaysInMonth.map((day) => {
                    const isSelected = selectedMobileDateYMD === day.ymd;

                    return (
                      <button
                        key={day.ymd}
                        type="button"
                        ref={isSelected ? selectedDayPillRef : null}
                        onClick={() => setSelectedMobileDateYMD(day.ymd)}
                        className={`min-w-[54px] h-[70px] flex flex-col items-center justify-center gap-1 rounded-2xl transition-all cursor-pointer select-none px-2 shrink-0 border ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : day.isToday
                            ? 'bg-indigo-50/90 text-indigo-800 border-indigo-200/80 font-semibold'
                            : day.dayStatus.hasFeriado
                            ? 'bg-rose-50/60 text-rose-800 border-rose-200/60'
                            : day.dayStatus.hasReposicao
                            ? 'bg-emerald-50/60 text-emerald-800 border-emerald-200/60'
                            : 'bg-slate-50/70 text-slate-700 border-slate-200/60 hover:bg-slate-100'
                        }`}
                      >
                        <span className={`text-[10px] font-medium ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                          {day.dayOfWeek}
                        </span>
                        <span className="text-sm font-bold tabular-nums leading-none">
                          {day.dayNum}
                        </span>
                        {/* Pontos indicadores coloridos para dias com eventos */}
                        <div className="h-2 flex items-center justify-center gap-1">
                          {day.dotColors.length > 0 ? (
                            day.dotColors.map((dotClass, idx) => (
                              <span
                                key={idx}
                                className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : dotClass}`}
                              ></span>
                            ))
                          ) : day.dayStatus.hasFeriado ? (
                            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-rose-300' : 'bg-rose-500'}`}></span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Banner de Status do Dia Selecionado */}
              <div className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-2 ${selectedDateDayStatus.badgeClass}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {formatDataBR(selectedMobileDateYMD)} · {getDayOfWeekShortBR(selectedMobileDateYMD)}
                  </p>
                  <p className="text-xs opacity-90 truncate mt-0.5">
                    {selectedDateDayStatus.statusLabel}
                  </p>
                </div>
                {canCreateEvent && (
                  <button
                    type="button"
                    onClick={() => handleOpenAddModalForDate(selectedMobileDateYMD)}
                    className="px-3 py-1.5 bg-slate-900 text-white font-medium text-xs rounded-xl shrink-0 cursor-pointer"
                  >
                    + Novo
                  </button>
                )}
              </div>

              {/* Timeline Diária Detalhada */}
              <div className="space-y-2.5">
                {mobileEventsForSelectedDate.length === 0 ? (
                  <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] text-center space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                      <i className="fa-regular fa-calendar text-base"></i>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Nenhum evento nesta data</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Selecione outro dia na faixa acima ou crie um novo compromisso.
                      </p>
                    </div>
                    {canCreateEvent && (
                      <button
                        type="button"
                        onClick={() => handleOpenAddModalForDate(selectedMobileDateYMD)}
                        className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl cursor-pointer"
                      >
                        Agendar evento neste dia
                      </button>
                    )}
                  </div>
                ) : (
                  mobileEventsForSelectedDate.map((ev) => {
                    const catCfg = getCategoryConfig(ev.categoria);

                    return (
                      <div
                        key={ev.id}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setSelectedEvent(ev);
                        }}
                        className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-start gap-3 cursor-pointer active:scale-[0.99] transition-transform"
                      >
                        {/* Coluna de Horário na Timeline */}
                        <div className="w-14 shrink-0 pt-0.5 text-left">
                          <span className="text-xs font-semibold text-slate-700 tabular-nums block">
                            {ev.horaInicio || 'Dia todo'}
                          </span>
                          {ev.horaFim && (
                            <span className="text-[11px] text-slate-400 tabular-nums">
                              até {ev.horaFim}
                            </span>
                          )}
                        </div>

                        {/* Conteúdo do Evento */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className={`text-sm font-semibold leading-snug ${ev.concluido ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {ev.titulo}
                            </h4>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] ${catCfg.badgeClass}`}>
                              <i className={catCfg.icone}></i>
                              <span>{ev.categoria}</span>
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500 font-medium">{formatRoleLabel(ev.atribuirA)}</span>
                          </div>

                          {ev.descricao && (
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                              {ev.descricao}
                            </p>
                          )}

                          {ev.categoria?.includes('Reposição') && ev.diaDuplicado && (
                            <p className="text-[11px] font-medium text-emerald-800">
                              Sábado Letivo · Grade horária de {ev.diaDuplicado}
                            </p>
                          )}

                          {ev.categoria?.includes('Provão') && (
                            <p className="text-[11px] font-medium text-purple-800">
                              Aulas online para a escola · Prova presencial para turmas indicadas
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          /* ============================================================== */
          /* VISUALIZAÇÃO EM LISTA / CRONOGRAMA (MOBILE & DESKTOP)          */
          /* ============================================================== */
          <div className="space-y-3.5">
            {/* Sub-Abas de Status na Lista */}
            <div className="bg-white p-2.5 sm:px-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/70 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setAbaStatusLista('pendentes')}
                  className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer inline-flex items-center justify-center gap-2 ${
                    abaStatusLista === 'pendentes'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Pendentes</span>
                  <span className="text-[11px] tabular-nums text-slate-400 font-semibold">{qtdPendentes}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAbaStatusLista('concluidos')}
                  className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer inline-flex items-center justify-center gap-2 ${
                    abaStatusLista === 'concluidos'
                      ? 'bg-white text-emerald-700 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Concluídos</span>
                  <span className="text-[11px] tabular-nums text-slate-400 font-semibold">{qtdConcluidos}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAbaStatusLista('todos')}
                  className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer inline-flex items-center justify-center gap-2 ${
                    abaStatusLista === 'todos'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Todos</span>
                  <span className="text-[11px] tabular-nums text-slate-400 font-semibold">{qtdTodos}</span>
                </button>
              </div>

              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <i className="fa-solid fa-arrow-down-short-wide text-slate-400"></i>
                <span>Ordem cronológica</span>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] divide-y divide-slate-100 overflow-hidden">
              {eventsForListView.length === 0 ? (
                <div className="p-12 text-center text-slate-500 space-y-3">
                  <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <i className="fa-regular fa-calendar-xmark text-lg"></i>
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {abaStatusLista === 'pendentes'
                      ? 'Nenhum evento pendente agendado no momento.'
                      : abaStatusLista === 'concluidos'
                      ? 'Nenhum evento concluído localizado.'
                      : 'Nenhum evento localizado com os filtros selecionados.'}
                  </p>
                  {canCreateEvent && (
                    <button
                      type="button"
                      onClick={() => handleOpenAddModalForDate()}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
                    >
                      Cadastrar evento
                    </button>
                  )}
                </div>
              ) : (
                eventsForListView.map((ev) => {
                  const isMultiDay = ev.dataInicio !== ev.dataFim;
                  const diaSemanaInicio = getDayOfWeekShortBR(ev.dataInicio);
                  const diaSemanaFim = getDayOfWeekShortBR(ev.dataFim);
                  const catCfg = getCategoryConfig(ev.categoria);

                  return (
                    <div
                      key={ev.id}
                      onClick={() => {
                        setConfirmDeleteId(null);
                        setSelectedEvent(ev);
                      }}
                      className={`p-4 sm:px-6 hover:bg-slate-50/70 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 cursor-pointer ${
                        ev.concluido ? 'bg-slate-50/50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        {podeEditarAgenda ? (
                          <button
                            type="button"
                            onClick={(e) => handleToggleConcluido(ev, e)}
                            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                              ev.concluido
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-300 bg-white hover:border-indigo-500 text-transparent'
                            }`}
                            title={ev.concluido ? 'Marcar como pendente' : 'Marcar como concluído'}
                          >
                            <i className="fa-solid fa-check text-[10px]"></i>
                          </button>
                        ) : (
                          <div
                            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              ev.concluido
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-200 bg-slate-100 text-transparent'
                            }`}
                          >
                            <i className="fa-solid fa-check text-[10px]"></i>
                          </div>
                        )}

                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              className={`font-semibold text-sm ${
                                ev.concluido ? 'line-through text-slate-400' : 'text-slate-900'
                              }`}
                            >
                              {ev.titulo}
                            </h3>

                            {ev.categoria && (
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] ${catCfg.badgeClass}`}>
                                <i className={catCfg.icone}></i>
                                <span>{ev.categoria}</span>
                              </span>
                            )}
                          </div>

                          {/* Metadados limpos sem empilhamento de pílulas */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span className="font-medium text-slate-600">{formatRoleLabel(ev.atribuirA)}</span>
                            {ev.categoria?.includes('Provão') && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-purple-700 font-medium">Aulas Online</span>
                              </>
                            )}
                            {ev.categoria?.includes('Reposição') && ev.diaDuplicado && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-medium">Grade de {ev.diaDuplicado}</span>
                              </>
                            )}
                            {isCategoriaFeriadoOuRecesso(ev.categoria) && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-rose-700 font-medium">Sem Aulas</span>
                              </>
                            )}
                            {ev.concluido && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700 font-medium">Concluído</span>
                              </>
                            )}
                          </div>

                          {ev.descricao && (
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                              {ev.descricao}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Data, horário e ações */}
                      <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5 shrink-0 pl-8 lg:pl-0">
                        <div className="text-left lg:text-right mr-1">
                          <div className="font-semibold text-xs text-slate-800 tabular-nums">
                            <span>{formatDataBR(ev.dataInicio)}</span>
                            {diaSemanaInicio && <span className="text-slate-400 font-normal"> ({diaSemanaInicio})</span>}
                            {isMultiDay && (
                              <span>
                                {' '}– {formatDataBR(ev.dataFim)}
                                {diaSemanaFim && <span className="text-slate-400 font-normal"> ({diaSemanaFim})</span>}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {ev.horaInicio ? `${ev.horaInicio}${ev.horaFim ? ` às ${ev.horaFim}` : ''}` : 'Dia inteiro'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => handleOpenTransformModal(ev, e)}
                            className="px-2.5 py-1.5 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-900 font-medium text-xs rounded-xl border border-slate-200/80 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                            title="Transformar este compromisso em uma tarefa da rotina PDCA"
                          >
                            <i className="fa-solid fa-list-check text-amber-600 text-xs"></i>
                            <span className="hidden xl:inline">Virar Tarefa</span>
                          </button>

                          {podeEditarAgenda && (
                            <button
                              type="button"
                              onClick={(e) => handleOpenMuralModal(ev, e)}
                              className={`px-2.5 py-1.5 font-medium text-xs rounded-xl border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                                ev.postadoNoMural || ev.muralRecadoId
                                  ? 'bg-indigo-50/70 text-indigo-800 border-indigo-200/80'
                                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/80'
                              }`}
                              title="Postar no Mural de Recados"
                            >
                              <i className="fa-solid fa-bullhorn text-indigo-600 text-xs"></i>
                              <span className="hidden xl:inline">
                                {ev.postadoNoMural || ev.muralRecadoId ? 'No Mural' : 'Mural'}
                              </span>
                            </button>
                          )}

                          {podeEditarAgenda && (
                            <button
                              type="button"
                              onClick={(e) => handleOpenEditModal(ev, e)}
                              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                              title="Editar evento"
                            >
                              <i className="fa-solid fa-pen-to-square text-slate-500 text-xs"></i>
                              <span className="hidden xl:inline">Editar</span>
                            </button>
                          )}

                          {podeEditarAgenda && (
                            confirmDeleteId === ev.id ? (
                              <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteEvent(ev, e)}
                                  className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-xl cursor-pointer"
                                >
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(null);
                                  }}
                                  className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-xl cursor-pointer"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteEvent(ev, e)}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors rounded-xl cursor-pointer"
                                title="Excluir evento"
                              >
                                <i className="fa-regular fa-trash-can text-xs"></i>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* FAB MOBILE FIXO (CANTO INFERIOR DIREITO) PARA CRIAÇÃO RÁPIDA COM O POLEGAR */}
      {canCreateEvent && (
        <button
          type="button"
          onClick={() => handleOpenAddModalForDate(selectedMobileDateYMD)}
          aria-label="Novo Evento na Agenda PEI"
          className="fixed bottom-6 right-6 z-30 md:hidden w-14 h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/25 flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
        >
          <i className="fa-solid fa-plus text-lg"></i>
        </button>
      )}

      {/* ==================================================================== */}
      {/* MODAL 1: DETALHES DO EVENTO (Bottom-Sheet Mobile / Centered Desktop) */}
      {/* ==================================================================== */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => {
            setConfirmDeleteId(null);
            setSelectedEvent(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                  <i className={getCategoryConfig(selectedEvent.categoria).icone}></i>
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm text-slate-900 truncate">Detalhes do Evento</h3>
                  <p className="text-xs text-slate-500 truncate">Agenda PEI · EE Prof. Clóvis de Lucca</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  setSelectedEvent(null);
                }}
                aria-label="Fechar detalhes"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Corpo Rolável */}
            <div className="p-5 space-y-4 text-sm overflow-y-auto flex-1">
              <div className="space-y-1.5">
                <h2 className="font-bold tracking-tight text-lg text-slate-900 leading-snug">
                  {selectedEvent.titulo}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${getCategoryConfig(selectedEvent.categoria).badgeClass}`}>
                    <i className={getCategoryConfig(selectedEvent.categoria).icone}></i>
                    <span>{selectedEvent.categoria}</span>
                  </span>
                  {selectedEvent.concluido && (
                    <span className="text-emerald-700 font-medium">· Concluído</span>
                  )}
                </div>
              </div>

              {/* Diretriz Provão Paulista */}
              {selectedEvent.categoria?.includes('Provão') && (
                <div className="bg-purple-50/90 p-3.5 rounded-2xl border border-purple-200/60 border-l-4 border-l-purple-600 space-y-2">
                  <div className="flex items-center gap-2 text-purple-900 font-semibold text-xs">
                    <i className="fa-solid fa-graduation-cap text-purple-600"></i>
                    <span>Diretriz do Provão Paulista</span>
                  </div>
                  <p className="text-purple-900/90 text-xs leading-relaxed">
                    As aulas regulares de toda a escola acontecem em formato <strong>online (remoto)</strong>, com exceção exclusiva das turmas abaixo que realizam a avaliação presencialmente:
                  </p>
                  {selectedEvent.turmasProvao?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {selectedEvent.turmasProvao.map((turma, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white text-purple-900 border border-purple-200/70">
                          {turma}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-purple-800/80 italic block">
                      Turmas específicas a confirmar pela coordenação pedagógica.
                    </span>
                  )}
                </div>
              )}

              {/* Diretriz Sábado Letivo / Reposição */}
              {selectedEvent.categoria?.includes('Reposição') && (
                <div className="bg-emerald-50/90 p-3.5 rounded-2xl border border-emerald-200/60 border-l-4 border-l-emerald-500 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                    <i className="fa-solid fa-arrows-rotate text-emerald-600"></i>
                    <span>Sábado Letivo com Aula Presencial</span>
                  </div>
                  <p className="text-emerald-900/90 text-xs leading-relaxed">
                    Haverá aula presencial regular para estudantes e docentes seguindo a grade de <strong>{selectedEvent.diaDuplicado || 'Segunda-feira'}</strong>.
                  </p>
                  {selectedEvent.motivoReposicao && (
                    <p className="text-xs text-emerald-800/90">
                      Motivo: {selectedEvent.motivoReposicao}
                    </p>
                  )}
                </div>
              )}

              {/* Diretriz Feriado / Recesso */}
              {isCategoriaFeriadoOuRecesso(selectedEvent.categoria) && (
                <div className="bg-rose-50/90 p-3.5 rounded-2xl border border-rose-200/60 border-l-4 border-l-rose-500 space-y-1">
                  <div className="flex items-center gap-2 text-rose-900 font-semibold text-xs">
                    <i className="fa-solid fa-umbrella-beach text-rose-600"></i>
                    <span>Dia Não Letivo</span>
                  </div>
                  <p className="text-rose-900/90 text-xs leading-relaxed">
                    Nesta data não há aulas regulares. A Presença Diária bloqueia automaticamente chamadas rotineiras neste dia.
                  </p>
                </div>
              )}

              {selectedEvent.descricao && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500 block">Descrição e orientações</span>
                  <p className="text-xs sm:text-sm text-slate-700 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/70 leading-relaxed whitespace-pre-line">
                    {selectedEvent.descricao}
                  </p>
                </div>
              )}

              {/* Metadados estruturados */}
              <div className="grid grid-cols-2 gap-3.5 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/70 text-xs">
                <div>
                  <span className="text-slate-400 font-medium block mb-0.5">Público-alvo</span>
                  <span className="font-semibold text-slate-800">{formatRoleLabel(selectedEvent.atribuirA)}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block mb-0.5">Horário</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {selectedEvent.horaInicio ? `${selectedEvent.horaInicio}${selectedEvent.horaFim ? ` às ${selectedEvent.horaFim}` : ''}` : 'Dia inteiro'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block mb-0.5">Data de início</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatDataBR(selectedEvent.dataInicio)}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block mb-0.5">Data de término</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatDataBR(selectedEvent.dataFim)}</span>
                </div>
              </div>

              {/* Ações integradas de fluxo (PDCA e Mural) */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleOpenTransformModal(selectedEvent)}
                  className="px-3 py-2 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-900 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                >
                  <i className="fa-solid fa-list-check text-amber-600"></i>
                  <span>Virar Tarefa (PDCA)</span>
                </button>

                {podeEditarAgenda && (
                  <button
                    type="button"
                    onClick={() => handleOpenMuralModal(selectedEvent)}
                    className="px-3 py-2 bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-900 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                  >
                    <i className="fa-solid fa-bullhorn text-indigo-600"></i>
                    <span>{selectedEvent.postadoNoMural || selectedEvent.muralRecadoId ? 'Postar Novamente no Mural' : 'Postar no Mural'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Rodapé Fixo */}
            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {podeEditarAgenda && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleConcluido(selectedEvent)}
                      className={`px-3 py-2 rounded-xl font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 transition-colors ${
                        selectedEvent.concluido
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-900 text-white hover:bg-slate-800'
                      }`}
                    >
                      <i className={`fa-solid ${selectedEvent.concluido ? 'fa-circle-check' : 'fa-check'}`}></i>
                      <span>{selectedEvent.concluido ? 'Concluído' : 'Concluir'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(selectedEvent)}
                      className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-pen-to-square text-slate-500"></i>
                      <span>Editar</span>
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {podeEditarAgenda && (
                  confirmDeleteId === selectedEvent.id ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => handleDeleteEvent(selectedEvent, e)}
                        className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-xl cursor-pointer"
                      >
                        Confirmar exclusão
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-2 bg-white text-slate-600 font-medium text-xs rounded-xl border border-slate-200 cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteEvent(selectedEvent, e)}
                      className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium text-xs rounded-xl border border-rose-200/70 cursor-pointer"
                    >
                      Excluir
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setSelectedEvent(null);
                  }}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: NOVO EVENTO PEI                                             */}
      {/* ==================================================================== */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-calendar-plus"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-900">Novo Evento na Agenda PEI</h3>
                  <p className="text-xs text-slate-500">Feriados, Recessos, Provão Paulista, Sábados Letivos e Ações</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Fechar"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="flex flex-col flex-1 overflow-hidden">
              {/* Corpo Rolável */}
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Título do evento <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newEventForm.titulo}
                    onChange={(e) => setNewEventForm({ ...newEventForm, titulo: e.target.value })}
                    placeholder="Ex: Provão Paulista 3ª Série / Sábado Letivo / Feriado"
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">
                      Categoria <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={newEventForm.categoria}
                      onChange={(e) => {
                        const newCat = e.target.value;
                        setNewEventForm({
                          ...newEventForm,
                          categoria: newCat,
                          titulo:
                            newEventForm.titulo ||
                            (newCat.includes('Provão')
                              ? 'Provão Paulista'
                              : newCat.includes('Reposição')
                              ? 'Reposição de Aulas (Sábado Letivo)'
                              : newCat.includes('Recesso')
                              ? 'Recesso Escolar'
                              : newCat.includes('Feriado')
                              ? 'Feriado Escolar'
                              : '')
                        });
                      }}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 cursor-pointer"
                    >
                      <optgroup label="Funções Especiais">
                        <option value="Feriado / Ponto Facultativo">Feriado / Ponto Facultativo (Sem Aulas)</option>
                        <option value="Recesso Escolar / Sem Aulas">Recesso Escolar / Sem Aulas</option>
                        <option value="Provão Paulista">Provão Paulista (Aulas Online)</option>
                        <option value="Reposição de Aulas (Sábado Letivo)">Reposição de Aulas (Sábado Letivo)</option>
                      </optgroup>
                      <optgroup label="Avaliações &amp; Provas">
                        <option value="Avaliações & Provas">Avaliações &amp; Provas (SAEB / Paulista)</option>
                        <option value="Conselho de Classe & Série">Conselho de Classe &amp; Série</option>
                      </optgroup>
                      <optgroup label="Passeios &amp; Pesquisas">
                        <option value="Passeios & Saídas Pedagógicas">Passeios &amp; Saídas Pedagógicas</option>
                        <option value="Pesquisas & Feiras Científicas">Pesquisas &amp; Feiras Científicas</option>
                      </optgroup>
                      <optgroup label="Pedagógico PEI">
                        <option value="Acolhimento PEI">Acolhimento PEI</option>
                        <option value="Ação Pedagógica & Eletivas">Ação Pedagógica &amp; Eletivas</option>
                        <option value="Plantão de Dúvidas & Tutoria">Plantão de Dúvidas &amp; Tutoria</option>
                        <option value="Formação Continuada / ATPC">Formação Continuada / ATPC</option>
                        <option value="Eventos Cívicos & Culturais">Eventos Cívicos &amp; Culturais</option>
                      </optgroup>
                      <optgroup label="Administrativo &amp; Operacional">
                        <option value="Administrativo & Secretaria">Administrativo &amp; Secretaria</option>
                        <option value="Reunião de Pais & Mestres">Reunião de Pais &amp; Mestres</option>
                        <option value="Planejamento Escolar">Planejamento Escolar</option>
                        <option value="Reunião da Gestão & APM">Reunião da Gestão &amp; APM</option>
                        <option value="Manutenção & Infraestrutura">Manutenção &amp; Infraestrutura</option>
                        <option value="Evento Escolar Geral">Evento Escolar Geral</option>
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">
                      Público-alvo <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={newEventForm.atribuirA}
                      onChange={(e) => setNewEventForm({ ...newEventForm, atribuirA: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 cursor-pointer"
                    >
                      <option value="TODA A EQUIPE">Toda a Equipe</option>
                      <option value="PROFESSORES">Professores</option>
                      <option value="SECRETARIA">Secretaria</option>
                      <option value="DIRETOR">Diretor</option>
                      <option value="VICE_DIRETOR">Vice-Diretor</option>
                      <option value="CGPG">CGPG</option>
                      <option value="PAAC">PAAC</option>
                    </select>
                  </div>
                </div>

                {/* Campos especiais: Provão Paulista */}
                {newEventForm.categoria.includes('Provão') && (
                  <div className="bg-purple-50/90 p-3.5 rounded-2xl border border-purple-200/60 border-l-4 border-l-purple-600 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-purple-900 flex items-center gap-1.5">
                        <i className="fa-solid fa-graduation-cap text-purple-600"></i>
                        <span>Turmas com Prova Presencial</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => selectAllTurmasEM(false)}
                        className="text-xs font-medium text-purple-700 hover:underline cursor-pointer"
                      >
                        Selecionar todo o EM
                      </button>
                    </div>
                    <p className="text-xs text-purple-900/80">
                      As demais turmas terão aulas em formato online. Marque as turmas presenciais:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-2 bg-white rounded-xl border border-purple-200/60">
                      {TURMAS_ESCOLARES.map((turma) => {
                        const isChecked = newEventForm.turmasProvao?.includes(turma);
                        return (
                          <label key={turma} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-purple-50">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleTurmaProvao(turma, false)}
                              className="rounded text-purple-600 focus:ring-purple-500"
                            />
                            <span className="truncate">{turma}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Campos especiais: Reposição de Aulas (Sábado Letivo) */}
                {newEventForm.categoria.includes('Reposição') && (
                  <div className="bg-emerald-50/90 p-3.5 rounded-2xl border border-emerald-200/60 border-l-4 border-l-emerald-500 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                      <i className="fa-solid fa-arrows-rotate text-emerald-600"></i>
                      <span>Configuração do Sábado Letivo</span>
                    </div>
                    <p className="text-xs text-emerald-900/80">
                      Defina qual dia da semana este sábado irá duplicar na grade horária:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Dia da semana duplicado <span className="text-rose-500">*</span>
                        </label>
                        <select
                          value={newEventForm.diaDuplicado}
                          onChange={(e) => setNewEventForm({ ...newEventForm, diaDuplicado: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl font-medium text-emerald-900 text-xs outline-none"
                        >
                          {DIAS_DA_SEMANA_REPOSICAO.map((dia) => (
                            <option key={dia} value={dia}>
                              Horário de {dia}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Motivo da reposição
                        </label>
                        <input
                          type="text"
                          value={newEventForm.motivoReposicao}
                          onChange={(e) => setNewEventForm({ ...newEventForm, motivoReposicao: e.target.value })}
                          placeholder="Ex: Referente à emenda de feriado..."
                          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl text-xs text-slate-800 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Campos especiais: Feriado / Recesso */}
                {isCategoriaFeriadoOuRecesso(newEventForm.categoria) && (
                  <div className="bg-rose-50/90 p-3.5 rounded-2xl border border-rose-200/60 border-l-4 border-l-rose-500 flex items-start gap-2.5 text-rose-900">
                    <i className="fa-solid fa-umbrella-beach text-rose-600 text-sm mt-0.5"></i>
                    <div>
                      <h4 className="font-semibold text-xs">Dia Não Letivo Programado</h4>
                      <p className="text-xs text-rose-900/80 mt-0.5 leading-relaxed">
                        A Presença Diária reconhece este registro automaticamente para sinalizar que não há aulas na data.
                      </p>
                    </div>
                  </div>
                )}

                {/* Datas e Horários */}
                <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-800">Datas e horários</span>
                    <span className="text-[11px] text-slate-400">Horários opcionais (dia inteiro)</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Data de início <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={newEventForm.dataInicio}
                        onChange={(e) => setNewEventForm({ ...newEventForm, dataInicio: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Hora de início
                      </label>
                      <input
                        type="time"
                        value={newEventForm.horaInicio}
                        onChange={(e) => setNewEventForm({ ...newEventForm, horaInicio: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Data de término
                      </label>
                      <input
                        type="date"
                        value={newEventForm.dataFim}
                        onChange={(e) => setNewEventForm({ ...newEventForm, dataFim: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Hora de término
                      </label>
                      <input
                        type="time"
                        value={newEventForm.horaFim}
                        onChange={(e) => setNewEventForm({ ...newEventForm, horaFim: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Descrição / Orientações (opcional)
                  </label>
                  <textarea
                    rows={2}
                    value={newEventForm.descricao}
                    onChange={(e) => setNewEventForm({ ...newEventForm, descricao: e.target.value })}
                    placeholder="Orientações pedagógicas, pauta ou detalhes operacionais..."
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                  ></textarea>
                </div>
              </div>

              {/* Rodapé Fixo */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      <span>Cadastrar Evento</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: EDIÇÃO DE EVENTO PEI                                        */}
      {/* ==================================================================== */}
      {isEditModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-pen-to-square"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-900">Editar Evento PEI</h3>
                  <p className="text-xs text-slate-500">Gestão Escolar · Direção, Vice-Direção e CGPG</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Fechar"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleUpdateEvent} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Título do evento <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editEventForm.titulo}
                    onChange={(e) => setEditEventForm({ ...editEventForm, titulo: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Categoria</label>
                    <select
                      value={editEventForm.categoria}
                      onChange={(e) => setEditEventForm({ ...editEventForm, categoria: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 cursor-pointer"
                    >
                      {CATEGORIAS_AGENDA.map((cat) => (
                        <option key={cat.id} value={cat.nome}>
                          {cat.nome}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Público-alvo</label>
                    <select
                      value={editEventForm.atribuirA}
                      onChange={(e) => setEditEventForm({ ...editEventForm, atribuirA: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-indigo-400 cursor-pointer"
                    >
                      <option value="TODA A EQUIPE">Toda a Equipe</option>
                      <option value="PROFESSORES">Professores</option>
                      <option value="SECRETARIA">Secretaria</option>
                      <option value="DIRETOR">Diretor</option>
                      <option value="VICE_DIRETOR">Vice-Diretor</option>
                      <option value="CGPG">CGPG</option>
                      <option value="PAAC">PAAC</option>
                    </select>
                  </div>
                </div>

                {editEventForm.categoria?.includes('Provão') && (
                  <div className="bg-purple-50/90 p-3.5 rounded-2xl border border-purple-200/60 border-l-4 border-l-purple-600 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-purple-900 flex items-center gap-1.5">
                        <i className="fa-solid fa-graduation-cap text-purple-600"></i>
                        <span>Turmas Presenciais</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => selectAllTurmasEM(true)}
                        className="text-xs font-medium text-purple-700 hover:underline cursor-pointer"
                      >
                        Selecionar todo o EM
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-32 overflow-y-auto p-2 bg-white rounded-xl border border-purple-200/60">
                      {TURMAS_ESCOLARES.map((turma) => {
                        const isChecked = editEventForm.turmasProvao?.includes(turma);
                        return (
                          <label key={turma} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-purple-50">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleTurmaProvao(turma, true)}
                              className="rounded text-purple-600 focus:ring-purple-500"
                            />
                            <span className="truncate">{turma}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {editEventForm.categoria?.includes('Reposição') && (
                  <div className="bg-emerald-50/90 p-3.5 rounded-2xl border border-emerald-200/60 border-l-4 border-l-emerald-500 space-y-3">
                    <span className="font-semibold text-xs text-emerald-900 block">
                      Configuração do Sábado Letivo
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Dia da semana duplicado
                        </label>
                        <select
                          value={editEventForm.diaDuplicado}
                          onChange={(e) => setEditEventForm({ ...editEventForm, diaDuplicado: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl font-medium text-emerald-900 text-xs outline-none"
                        >
                          {DIAS_DA_SEMANA_REPOSICAO.map((dia) => (
                            <option key={dia} value={dia}>
                              Horário de {dia}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Motivo da reposição
                        </label>
                        <input
                          type="text"
                          value={editEventForm.motivoReposicao}
                          onChange={(e) => setEditEventForm({ ...editEventForm, motivoReposicao: e.target.value })}
                          placeholder="Motivo opcional"
                          className="w-full px-3 py-2 bg-white border border-emerald-200 rounded-xl text-xs text-slate-800 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/70 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Data de início <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={editEventForm.dataInicio}
                        onChange={(e) => setEditEventForm({ ...editEventForm, dataInicio: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">Hora de início</label>
                      <input
                        type="time"
                        value={editEventForm.horaInicio}
                        onChange={(e) => setEditEventForm({ ...editEventForm, horaInicio: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">Data de término</label>
                      <input
                        type="date"
                        value={editEventForm.dataFim}
                        onChange={(e) => setEditEventForm({ ...editEventForm, dataFim: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">Hora de término</label>
                      <input
                        type="time"
                        value={editEventForm.horaFim}
                        onChange={(e) => setEditEventForm({ ...editEventForm, horaFim: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:border-indigo-400 tabular-nums"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Descrição e orientações detalhadas
                  </label>
                  <textarea
                    rows={3}
                    value={editEventForm.descricao}
                    onChange={(e) => setEditEventForm({ ...editEventForm, descricao: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                  ></textarea>
                </div>
              </div>

              {/* Rodapé Fixo */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {editSaving ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Atualizando...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: GUIA DE REGRAS OPERACIONAIS                                 */}
      {/* ==================================================================== */}
      {isRegrasModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsRegrasModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-scale-balanced"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-900">Diretrizes da Agenda PEI</h3>
                  <p className="text-xs text-slate-500">Regras operacionais integradas ao sistema</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRegrasModalOpen(false)}
                aria-label="Fechar"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Corpo Rolável */}
            <div className="p-5 space-y-3 text-xs overflow-y-auto flex-1">
              <div className="bg-rose-50/90 p-3.5 rounded-2xl border border-rose-200/60 border-l-4 border-l-rose-500 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-rose-900">
                  <i className="fa-solid fa-umbrella-beach text-rose-600"></i>
                  <span>1. Feriados, Pontos Facultativos e Recessos</span>
                </div>
                <p className="text-rose-900/90 leading-relaxed">
                  Nesses dias não há aulas regulares nem ações rotineiras. A Presença Diária bloqueia automaticamente chamadas nestas datas.
                </p>
              </div>

              <div className="bg-purple-50/90 p-3.5 rounded-2xl border border-purple-200/60 border-l-4 border-l-purple-600 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-purple-900">
                  <i className="fa-solid fa-graduation-cap text-purple-600"></i>
                  <span>2. Provão Paulista (Híbrido / Online)</span>
                </div>
                <p className="text-purple-900/90 leading-relaxed">
                  As aulas regulares ocorrem em formato <strong>online</strong> para a escola, exceto para as turmas selecionadas que comparecem para a prova presencial.
                </p>
              </div>

              <div className="bg-emerald-50/90 p-3.5 rounded-2xl border border-emerald-200/60 border-l-4 border-l-emerald-500 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-emerald-900">
                  <i className="fa-solid fa-arrows-rotate text-emerald-600"></i>
                  <span>3. Reposição de Aulas (Sábado Letivo)</span>
                </div>
                <p className="text-emerald-900/90 leading-relaxed">
                  Haverá aula presencial regular. A gestão define qual dia da semana ele duplica (ex.: horário de Segunda ou Sexta-feira).
                </p>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <i className="fa-regular fa-calendar-xmark text-slate-500"></i>
                  <span>4. Sábados e Domingos</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Por padrão, finais de semana são dias sem aula, <strong>exceto quando houver Reposição de Aulas</strong> cadastrada.
                </p>
              </div>
            </div>

            {/* Rodapé Fixo */}
            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsRegrasModalOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 5: TRANSFORMAR EVENTO EM TAREFA (PDCA)                         */}
      {/* ==================================================================== */}
      {isTransformModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsTransformModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <i className="fa-solid fa-list-check"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-900">Transformar em Tarefa (PDCA)</h3>
                  <p className="text-xs text-slate-500">Integração com Minhas Tarefas da equipe</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTransformModalOpen(false)}
                aria-label="Fechar"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveTaskFromEvent} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Título da tarefa <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={transformTaskForm.titulo}
                    onChange={(e) => setTransformTaskForm({ ...transformTaskForm, titulo: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-500/15"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Frequência</label>
                    <select
                      value={transformTaskForm.frequencia}
                      onChange={(e) => setTransformTaskForm({ ...transformTaskForm, frequencia: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-400 cursor-pointer"
                    >
                      <option value="Ação Pontual (Prazo Fixo)">Ação Pontual (Prazo Fixo)</option>
                      <option value="Diária">Diária</option>
                      <option value="Semanal">Semanal</option>
                      <option value="Mensal">Mensal</option>
                      <option value="Bimestral">Bimestral</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Responsável</label>
                    <select
                      value={transformTaskForm.atribuirA}
                      onChange={(e) => setTransformTaskForm({ ...transformTaskForm, atribuirA: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-400 cursor-pointer"
                    >
                      <option value="TODA A EQUIPE">Toda a Equipe</option>
                      <option value="DIRETOR">Diretor</option>
                      <option value="VICE_DIRETOR">Vice-Diretor</option>
                      <option value="CGPG">CGPG</option>
                      <option value="PROFESSORES">Professores</option>
                      <option value="SECRETARIA">Secretaria</option>
                      <option value="PAAC">PAAC</option>
                    </select>
                  </div>
                </div>

                {(transformTaskForm.frequencia === 'Ação Pontual (Prazo Fixo)' || transformTaskForm.frequencia === 'Pontual') && (
                  <div className="grid grid-cols-2 gap-3 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/70">
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Data de início <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={transformTaskForm.dataInicio}
                        onChange={(e) => setTransformTaskForm({ ...transformTaskForm, dataInicio: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">Data limite</label>
                      <input
                        type="date"
                        value={transformTaskForm.dataFim}
                        onChange={(e) => setTransformTaskForm({ ...transformTaskForm, dataFim: e.target.value })}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 tabular-nums"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">Descrição da tarefa</label>
                  <textarea
                    rows={3}
                    value={transformTaskForm.descricao}
                    onChange={(e) => setTransformTaskForm({ ...transformTaskForm, descricao: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 outline-none focus:bg-white focus:border-amber-400"
                  ></textarea>
                </div>
              </div>

              {/* Rodapé Fixo */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsTransformModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={transformSaving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {transformSaving ? 'Criando tarefa...' : 'Confirmar e Criar Tarefa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 6: POSTAR EVENTO NO MURAL DE RECADOS                           */}
      {/* ==================================================================== */}
      {isMuralModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setIsMuralModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 shrink-0"></div>

            {/* Header Fixo */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-bullhorn"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-900">Postar no Mural de Recados</h3>
                  <p className="text-xs text-slate-500">Aviso oficial integrado com a Agenda PEI</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMuralModalOpen(false)}
                aria-label="Fechar"
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handlePostToMural} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Título do comunicado <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={muralForm.titulo}
                    onChange={(e) => setMuralForm({ ...muralForm, titulo: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 outline-none focus:bg-white focus:border-indigo-400"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Categoria</label>
                    <select
                      value={muralForm.categoria}
                      onChange={(e) => setMuralForm({ ...muralForm, categoria: e.target.value })}
                      className="w-full px-2.5 py-2 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="Avisos Gerais">Avisos Gerais</option>
                      <option value="Pedagógico">Pedagógico</option>
                      <option value="Institucional">Institucional</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Prioridade</label>
                    <select
                      value={muralForm.prioridade}
                      onChange={(e) => setMuralForm({ ...muralForm, prioridade: e.target.value })}
                      className="w-full px-2.5 py-2 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="Normal">Normal</option>
                      <option value="Importante">Importante</option>
                      <option value="Urgente">Urgente</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1.5">Destinatários</label>
                    <select
                      value={muralForm.destinatarios}
                      onChange={(e) => setMuralForm({ ...muralForm, destinatarios: e.target.value })}
                      className="w-full px-2.5 py-2 bg-slate-50/80 border border-slate-200 rounded-xl font-medium text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="todos">Toda a Escola</option>
                      <option value="professores">Professores</option>
                      <option value="gestao">Gestão</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1.5">
                    Conteúdo do recado oficial <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={muralForm.conteudo}
                    onChange={(e) => setMuralForm({ ...muralForm, conteudo: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50/80 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:border-indigo-400 leading-relaxed font-mono"
                  ></textarea>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(muralForm.fixado)}
                    onChange={(e) => setMuralForm({ ...muralForm, fixado: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Fixar comunicado no topo do Mural</span>
                </label>
              </div>

              {/* Rodapé Fixo */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsMuralModalOpen(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs rounded-xl border border-slate-200/80 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={muralSaving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {muralSaving ? 'Publicando...' : 'Publicar no Mural'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
