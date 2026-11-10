import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, collection, getDocs, addDoc, updateDoc, doc, deleteDoc, onSnapshot } from '../lib/database';
import {
  CATEGORIAS_AGENDA,
  TURMAS_ESCOLARES,
  DIAS_DA_SEMANA_REPOSICAO,
  getCategoryConfig,
  checkDayStatus
} from './agendaConstants';

export default function AgendaPEI() {
  const [tasks, setTasks] = useState(() => (Array.isArray(window.eventosCache) ? window.eventosCache : []));
  const [loading, setLoading] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

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
      console.warn("Aviso no listener em tempo real de eventos:", error);
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
            atribuirA: data.atribuirA || 'TODA A EQUIPE'
          });
        }
      });
      window.eventosCache = list;
      setTasks(list);
      setIsRealtimeConnected(true);
    } catch (e) {
      console.warn("Aviso ao recarregar eventos manualmente:", e);
    } finally {
      setLoading(false);
    }
  };

  // Visibilidade Pública Integral: Acessível e filtrável por cargo, categoria e busca
  const filteredEvents = tasks.filter((item) => {
    // 1. Filtro por cargo selecionado no dropdown
    if (selectedRoleFilter && item.atribuirA !== selectedRoleFilter) {
      return false;
    }

    // 2. Filtro por Categoria Selecionada
    if (selectedCategoryFilter) {
      const catAtual = String(item.categoria || '').toLowerCase();
      const catFiltro = selectedCategoryFilter.toLowerCase();
      if (!catAtual.includes(catFiltro)) {
        return false;
      }
    }

    // 3. Filtro por palavra-chave de busca
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

  // Estatísticas das 3 categorias especiais para o mês atual
  const statsMes = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    const prefix = `${y}-${String(m).padStart(2, '0')}`;

    const eventosMes = tasks.filter((ev) => {
      const dt = ev.dataInicio || ev.data || '';
      return dt.startsWith(prefix);
    });

    const feriados = eventosMes.filter((ev) => {
      const c = String(ev.categoria || '').toLowerCase();
      return c.includes('feriado') || c.includes('facultativo');
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
    return true; // 'todos'
  });

  // Auxiliares de Data e Calendário
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

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

  useEffect(() => {
    if (selectedDayPillRef.current) {
      selectedDayPillRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedMobileDateYMD]);

  // Gerar Dias do Mês para a Data Strip Mobile
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

      list.push({
        dayNum: d,
        ymd,
        dayOfWeek,
        isToday: ymd === todayYMD,
        eventsCount: eventsOnDay.length,
        hasPending: eventsOnDay.some((e) => !e.concluido),
        dayStatus
      });
    }
    return list;
  }, [currentDate, todayYMD, filteredEvents, tasks]);

  // Eventos Filtrados para o Dia Selecionado na Data Strip
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
    const targetYMD = ymd || todayYMD;
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
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Domingo

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

  // Cores por Atribuição / Cargo
  const getBadgeStyle = (atribuirA) => {
    switch (atribuirA) {
      case 'TODA A EQUIPE':
        return 'bg-blue-600 text-white border-blue-700';
      case 'DIRETOR':
        return 'bg-purple-600 text-white border-purple-700';
      case 'VICE_DIRETOR':
        return 'bg-amber-600 text-white border-amber-700';
      case 'CGPG':
        return 'bg-emerald-600 text-white border-emerald-700';
      case 'PAAC':
      case 'PROFESSOR_PAAC':
        return 'bg-cyan-600 text-white border-cyan-700';
      default:
        return 'bg-slate-700 text-white border-slate-800';
    }
  };

  const getEventCardStyle = (ev) => {
    if (ev.concluido) {
      return 'bg-slate-100 text-slate-500 border-slate-200 line-through';
    }
    const catCfg = getCategoryConfig(ev.categoria);
    return catCfg.cardClass || 'bg-blue-50 border-blue-200 text-blue-950 font-semibold shadow-2xs hover:bg-blue-100';
  };

  // Alternar Conclusão do Evento
  const handleToggleConcluido = async (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      alert("Apenas Diretor, Vice-Diretor e CGPG podem alterar o status de eventos.");
      return;
    }

    const prevList = [...(tasks || [])];
    const novoStatus = !ev.concluido;
    const updatedList = prevList.map(item => item.id === ev.id ? { ...item, concluido: novoStatus } : item);
    setTasks(updatedList);
    window.eventosCache = updatedList;
    if (selectedEvent && selectedEvent.id === ev.id) {
      setSelectedEvent({ ...selectedEvent, concluido: novoStatus });
    }

    try {
      const docRef = doc(db, 'eventos', ev.id);
      await updateDoc(docRef, {
        concluido: novoStatus,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: userRole
      });
    } catch (err) {
      console.error("Erro ao alternar conclusão do evento na Agenda:", err);
      setTasks(prevList);
      window.eventosCache = prevList;
    }
  };

  // Excluir evento
  const handleDeleteEvent = async (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      const msg = 'Acesso negado: Apenas a Direção Escolar e CGPG possuem autorização para excluir eventos da agenda.';
      if (typeof window.showToast === 'function') window.showToast(msg, 'warning', 4000);
      else alert(msg);
      return;
    }
    if (!window.confirm(`Tem certeza que deseja excluir o evento "${ev.titulo}"?`)) return;

    const prevList = [...(tasks || [])];
    const updatedList = prevList.filter(item => item.id !== ev.id);
    setTasks(updatedList);
    window.eventosCache = updatedList;
    if (selectedEvent && selectedEvent.id === ev.id) {
      setSelectedEvent(null);
    }

    try {
      await deleteDoc(doc(db, 'eventos', ev.id));
    } catch (err) {
      console.error("Erro ao excluir evento da coleção 'eventos':", err);
      setTasks(prevList);
      window.eventosCache = prevList;
    }
  };

  // Criar Novo Evento com Validações Especiais
  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!canCreateEvent) {
      alert("Acesso restrito: Apenas Diretor, Vice-Diretor e CGPG podem cadastrar novos eventos na Agenda PEI.");
      return;
    }
    if (!newEventForm.titulo.trim() || !newEventForm.dataInicio) {
      alert("Título e Data de Início são obrigatórios!");
      return;
    }

    setSaving(true);
    try {
      const dtInicio = newEventForm.dataInicio;
      const dtFim = newEventForm.dataFim ? newEventForm.dataFim : dtInicio;
      const hrInicio = newEventForm.horaInicio ? newEventForm.horaInicio : null;
      const hrFim = newEventForm.horaFim ? newEventForm.horaFim : null;

      // NOTA CRÍTICA: Sem campos 'id' ou '_id' no payload para o banco
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

      if (typeof window.showToast === 'function') {
        window.showToast(`Evento "${payload.titulo}" cadastrado com sucesso!`, 'success', 3500);
      }
    } catch (err) {
      console.error("Erro ao criar evento na coleção 'eventos':", err);
      alert("Erro ao salvar evento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  // Abrir Modal de Edição
  const handleOpenEditModal = (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      const msg = "Acesso restrito: Apenas a Direção, Vice-Direção e CGPG possuem autorização para editar eventos da Agenda PEI.";
      if (typeof window.showToast === 'function') window.showToast(msg, 'warning', 4500);
      else alert(msg);
      return;
    }

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
      turmasProvao: Array.isArray(ev.turmasProvao) ? ev.turmasProvao : (ev.turmasProvao ? [ev.turmasProvao] : ['3ª Série A (EM)', '3ª Série B (EM)', '3ª Série C (EM)']),
      diaDuplicado: ev.diaDuplicado || 'Segunda-feira',
      motivoReposicao: ev.motivoReposicao || ''
    });
    setIsEditModalOpen(true);
  };

  // Salvar Edição de Evento
  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    if (!podeEditarAgenda) {
      alert("Acesso restrito: Apenas a Direção, Vice-Direção e CGPG podem editar eventos.");
      return;
    }
    if (!editEventForm.titulo.trim() || !editEventForm.dataInicio) {
      alert("Título e Data de Início são obrigatórios!");
      return;
    }

    setEditSaving(true);
    try {
      const dtInicio = editEventForm.dataInicio;
      const dtFim = editEventForm.dataFim ? editEventForm.dataFim : dtInicio;
      const hrInicio = editEventForm.horaInicio ? editEventForm.horaInicio : null;
      const hrFim = editEventForm.horaFim ? editEventForm.horaFim : null;

      // NOTA CRÍTICA: Sem campos 'id' ou '_id' no payload
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
        item.id === editEventForm.id ? { ...item, ...payload } : item
      );
      setTasks(updatedList);
      window.eventosCache = updatedList;

      if (selectedEvent && selectedEvent.id === editEventForm.id) {
        setSelectedEvent((prev) => ({ ...prev, ...payload }));
      }

      await updateDoc(doc(db, 'eventos', editEventForm.id), payload);
      setIsEditModalOpen(false);

      if (typeof window.showToast === 'function') {
        window.showToast(`Evento "${payload.titulo}" atualizado com sucesso!`, 'success', 4000);
      }
    } catch (err) {
      console.error("Erro ao atualizar evento na coleção 'eventos':", err);
      alert("Erro ao salvar alterações no evento. Tente novamente.");
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

  // Confirmar Criação da Tarefa
  const handleSaveTaskFromEvent = async (e) => {
    e.preventDefault();
    if (!transformTaskForm.titulo.trim()) {
      alert("Por favor, preencha o título da tarefa.");
      return;
    }

    const isPontual =
      transformTaskForm.frequencia === 'Ação Pontual (Prazo Fixo)' ||
      transformTaskForm.frequencia === 'Pontual';

    if (isPontual && !transformTaskForm.dataInicio) {
      alert("Por favor, informe a Data de Início da tarefa.");
      return;
    }

    setTransformSaving(true);
    try {
      const dtInicio = transformTaskForm.dataInicio || null;
      const dtFim = transformTaskForm.dataFim || dtInicio;
      const hrInicio = transformTaskForm.horaInicio || null;
      const hrFim = transformTaskForm.horaFim || null;

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
          console.warn("Aviso ao marcar vínculo no evento da agenda:", updateErr);
        }
      }

      setIsTransformModalOpen(false);

      if (typeof window.showToast === 'function') {
        window.showToast(`Tarefa "${payloadTarefa.titulo}" criada no painel de Minhas Tarefas (PDCA)!`, 'success', 5000);
      } else {
        alert("Tarefa criada com sucesso!");
      }
    } catch (err) {
      console.error("Erro ao salvar tarefa a partir do evento:", err);
      alert("Ocorreu um erro ao transformar o evento em tarefa. Tente novamente.");
    } finally {
      setTransformSaving(false);
    }
  };

  // Abrir Modal para Postar Evento Direto no Mural
  const handleOpenMuralModal = (ev, e) => {
    if (e) e.stopPropagation();
    if (!podeEditarAgenda) {
      const msg = "Acesso restrito: Apenas Direção, Vice-Direção e CGPG podem postar avisos no Mural de Recados.";
      if (typeof window.showToast === 'function') window.showToast(msg, 'warning', 4000);
      else alert(msg);
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
    } else if (catEvUpper.includes('INSTITUCIONAL') || catEvUpper.includes('FERIADO') || catEvUpper.includes('REPOSIÇÃO')) {
      catMural = 'Institucional';
    }

    // Informações especiais no recado
    const linhasEspeciais = [];
    if (ev.categoria?.includes('Provão')) {
      linhasEspeciais.push(`💻 Formato: Aulas ONLINE para as demais séries`);
      if (ev.turmasProvao?.length) {
        linhasEspeciais.push(`🏫 Prova Presencial na Escola: ${ev.turmasProvao.join(', ')}`);
      }
    } else if (ev.categoria?.includes('Reposição')) {
      linhasEspeciais.push(`🎒 Sábado Letivo: Grade e horário duplicados da ${ev.diaDuplicado || 'Segunda-feira'}`);
    } else if (ev.categoria?.includes('Feriado')) {
      linhasEspeciais.push(`🚫 Dia Não Letivo: Atividades escolares e agendamentos suspensos.`);
    }

    const textoGerado = [
      `📅 COMPROMISSO NA AGENDA PEI: ${ev.titulo}`,
      `🗓️ Data: ${datasTexto}`,
      `⏰ Horário: ${horarioTexto}`,
      `👥 Público: ${ev.atribuirA || 'Toda a Equipe'}`,
      ev.categoria ? `🏷️ Categoria: ${ev.categoria}` : '',
      ...linhasEspeciais,
      ev.descricao ? `\n📝 Orientações e Pauta:\n${ev.descricao}` : ''
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

  // Salvar Recado no Mural
  const handlePostToMural = async (e) => {
    e.preventDefault();
    if (!podeEditarAgenda) {
      alert("Apenas a Direção, Vice-Direção e CGPG têm autorização para postar no Mural.");
      return;
    }

    if (!muralForm.titulo.trim() || !muralForm.conteudo.trim()) {
      alert("Título e Conteúdo do recado são obrigatórios!");
      return;
    }

    setMuralSaving(true);
    try {
      const agoraIso = new Date().toISOString();
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
          console.warn("Aviso ao salvar flag postadoNoMural:", updErr);
        }
      }

      setIsMuralModalOpen(false);
      setMuralEventTarget(null);

      if (typeof window.showToast === 'function') {
        window.showToast(`Evento postado com sucesso no Mural de Recados!`, 'success', 4000);
      }
    } catch (err) {
      console.error("Erro ao postar evento no mural:", err);
      alert("Ocorreu um erro ao postar no mural de recados. Tente novamente.");
    } finally {
      setMuralSaving(false);
    }
  };

  const NORM_MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  // Helper para alternar turmas selecionadas no Provão Paulista
  const toggleTurmaProvao = (turma, isEdit = false) => {
    if (isEdit) {
      setEditEventForm((prev) => {
        const current = Array.isArray(prev.turmasProvao) ? [...prev.turmasProvao] : [];
        if (current.includes(turma)) {
          return { ...prev, turmasProvao: current.filter((t) => t !== turma) };
        } else {
          return { ...prev, turmasProvao: [...current, turma] };
        }
      });
    } else {
      setNewEventForm((prev) => {
        const current = Array.isArray(prev.turmasProvao) ? [...prev.turmasProvao] : [];
        if (current.includes(turma)) {
          return { ...prev, turmasProvao: current.filter((t) => t !== turma) };
        } else {
          return { ...prev, turmasProvao: [...current, turma] };
        }
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

  return (
    <div className="p-3 sm:p-5 lg:p-7 max-w-7xl mx-auto space-y-5">
      {/* HEADER SUPERIOR UNIFICADO */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white p-0.5 shadow-md border border-slate-200 flex items-center justify-center shrink-0 ring-2 ring-blue-900/10 overflow-hidden">
            <img src="/assets/aistudio/Logo_Clovis_df1054e5.jpeg" alt="Logo EE Clóvis de Lucca" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-blue-950 uppercase tracking-wide">
                Agenda PEI &amp; Calendário Escolar
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-900 border border-emerald-300">
                Público &amp; Integrado
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
                {isRealtimeConnected ? 'Tempo Real' : 'Conectando'}
              </span>
              <button
                type="button"
                onClick={() => carregarEventosAgenda()}
                disabled={loading}
                title="Recarregar eventos da Agenda PEI"
                className="px-2 py-0.5 text-xs text-slate-600 hover:text-blue-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              >
                <i className={`fa-solid fa-arrows-rotate ${loading ? 'fa-spin text-blue-600' : ''}`}></i>
              </button>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Calendário oficial EE Clóvis de Lucca: Feriados, Provão Paulista, Reposições, Avaliações e Recursos
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Navegação de Mês */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 text-slate-700 hover:text-blue-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
              title="Mês Anterior"
            >
              <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <span className="px-3 text-xs font-black text-blue-950 uppercase tracking-wider min-w-[125px] text-center">
              {NORM_MONTH_NAMES[month]} {year}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 text-slate-700 hover:text-blue-900 hover:bg-white rounded-lg transition-colors cursor-pointer"
              title="Próximo Mês"
            >
              <i className="fa-solid fa-chevron-right text-xs"></i>
            </button>
          </div>

          <button
            type="button"
            onClick={handleToday}
            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs rounded-xl transition-colors cursor-pointer"
          >
            Hoje
          </button>

          {/* Toggle de Visualização (Grade / Lista) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'calendar'
                  ? 'bg-blue-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <i className="fa-solid fa-calendar-grid"></i>
              <span className="hidden sm:inline">Grade</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'list'
                  ? 'bg-blue-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <i className="fa-solid fa-list-ul"></i>
              <span className="hidden sm:inline">Lista</span>
            </button>
          </div>

          {/* Botão Guia de Regras */}
          <button
            type="button"
            onClick={() => setIsRegrasModalOpen(true)}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-300 transition-colors cursor-pointer flex items-center gap-1.5"
            title="Ver Regras Especiais de Feriados, Provão Paulista e Reposição"
          >
            <i className="fa-solid fa-circle-info text-blue-700"></i>
            <span className="hidden xl:inline">Regras</span>
          </button>

          {/* Botão Novo Evento PEI */}
          {canCreateEvent && (
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <i className="fa-solid fa-plus text-cyan-300"></i>
              <span>Novo Evento</span>
            </button>
          )}
        </div>
      </div>

      {/* BARRA DE ESTATÍSTICAS E REGRAS OPERACIONAIS DO MÊS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-900 flex items-center justify-center font-bold text-sm shrink-0">
            <i className="fa-solid fa-calendar-day"></i>
          </div>
          <div>
            <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Total no Mês</span>
            <span className="text-sm font-black text-blue-950">{statsMes.total} eventos</span>
          </div>
        </div>

        <div className="bg-rose-50/80 p-3 rounded-xl border border-rose-200 shadow-2xs flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-200 text-rose-950 flex items-center justify-center font-bold text-sm shrink-0">
            <i className="fa-solid fa-umbrella-beach"></i>
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-rose-800 block">Feriados / P. Fac.</span>
            <span className="text-sm font-black text-rose-950">{statsMes.feriados} (Sem Aulas)</span>
          </div>
        </div>

        <div className="bg-purple-50/80 p-3 rounded-xl border border-purple-200 shadow-2xs flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-200 text-purple-950 flex items-center justify-center font-bold text-sm shrink-0">
            <i className="fa-solid fa-graduation-cap"></i>
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-purple-800 block">Provão Paulista</span>
            <span className="text-sm font-black text-purple-950">{statsMes.provao} (Aulas Online)</span>
          </div>
        </div>

        <div className="bg-emerald-50/80 p-3 rounded-xl border border-emerald-200 shadow-2xs flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-200 text-emerald-950 flex items-center justify-center font-bold text-sm shrink-0">
            <i className="fa-solid fa-arrows-rotate"></i>
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-emerald-800 block">Sábados Letivos</span>
            <span className="text-sm font-black text-emerald-950">{statsMes.reposicoes} (Com Aula)</span>
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS E BUSCA */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
        {/* Campo de Busca */}
        <div className="relative w-full md:w-72">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por título, categoria, descrição ou público..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {/* Filtro por Categoria */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600 uppercase text-[10px]">Categoria:</span>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="p-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
            >
              <option value="">TODAS AS CATEGORIAS</option>
              <optgroup label="⚡ Funções Especiais Essenciais">
                <option value="Feriado / Ponto Facultativo">🚫 Feriado / Ponto Facultativo</option>
                <option value="Provão Paulista">🎓 Provão Paulista (Aulas Online)</option>
                <option value="Reposição de Aulas">🎒 Reposição (Sábado Letivo)</option>
              </optgroup>
              <optgroup label="📚 Avaliações &amp; Rendimento">
                <option value="Avaliações & Provas">Avaliações &amp; Provas</option>
                <option value="Conselho de Classe">Conselho de Classe &amp; Série</option>
              </optgroup>
              <optgroup label="🚌 Passeios &amp; Pesquisas">
                <option value="Passeios & Saídas">Passeios &amp; Saídas Pedagógicas</option>
                <option value="Pesquisas & Feiras">Pesquisas &amp; Feiras Científicas</option>
              </optgroup>
              <optgroup label="💡 Pedagógico PEI">
                <option value="Acolhimento PEI">Acolhimento PEI</option>
                <option value="Ação Pedagógica">Ação Pedagógica &amp; Eletivas</option>
                <option value="Plantão de Dúvidas">Plantão de Dúvidas &amp; Tutoria</option>
                <option value="Formação Continuada">Formação Continuada / ATPC</option>
                <option value="Eventos Cívicos">Eventos Cívicos &amp; Culturais</option>
              </optgroup>
              <optgroup label="💻 Administrativo &amp; Secretaria">
                <option value="Administrativo & Secretaria">Administrativo &amp; Secretaria</option>
                <option value="Reunião de Pais">Reunião de Pais &amp; Mestres</option>
                <option value="Planejamento Escolar">Planejamento Escolar</option>
                <option value="Manutenção & TI">Manutenção &amp; TI</option>
              </optgroup>
            </select>
          </div>

          {/* Filtro por Público */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600 uppercase text-[10px]">Público:</span>
            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value)}
              className="p-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
            >
              <option value="">TODOS</option>
              <option value="TODA A EQUIPE">TODA A EQUIPE</option>
              <option value="PROFESSORES">PROFESSORES</option>
              <option value="SECRETARIA">SECRETARIA</option>
              <option value="DIRETOR">DIRETOR</option>
              <option value="VICE_DIRETOR">VICE_DIRETOR</option>
              <option value="CGPG">CGPG</option>
              <option value="PAAC">PAAC</option>
            </select>
          </div>

          <span className="font-mono font-bold bg-blue-100 text-blue-900 border border-blue-200 px-2.5 py-1 rounded-full text-[11px]">
            {filteredEvents.length} {filteredEvents.length === 1 ? 'evento' : 'eventos'}
          </span>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL: MODO GRADE X MODO LISTA */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <i className="fa-solid fa-spinner fa-spin text-3xl text-blue-900"></i>
          <p className="text-xs font-semibold text-slate-600">Sincronizando Agenda PEI com o banco de dados oficial (eventos)...</p>
        </div>
      ) : viewMode === 'calendar' ? (
        /* VISUALIZAÇÃO DESKTOP: GRADE DO CALENDÁRIO COM REGRAS ESPECIAIS */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 bg-blue-950 text-white font-extrabold text-[11px] uppercase tracking-wider text-center py-2.5 border-b border-blue-900">
            <div className="text-rose-300">DOM</div>
            <div>SEG</div>
            <div>TER</div>
            <div>QUA</div>
            <div>QUI</div>
            <div>SEX</div>
            <div className="text-cyan-300">SÁB</div>
          </div>

          {/* Grade de 7 Colunas */}
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 bg-slate-100 min-h-[580px]">
            {calendarCells.map((cell) => {
              const dayEvents = getEventsForDate(cell.ymd);
              const isToday = cell.ymd === todayYMD;
              const dayStatus = checkDayStatus(cell.ymd, tasks);

              return (
                <div
                  key={cell.ymd}
                  onClick={() => canCreateEvent && handleOpenAddModalForDate(cell.ymd)}
                  className={`p-1.5 sm:p-2 min-h-[115px] sm:min-h-[130px] transition-colors flex flex-col justify-start relative group cursor-pointer ${
                    cell.isCurrentMonth ? (dayStatus.bgCellClass || 'bg-white') : 'bg-slate-50 text-slate-400'
                  } ${isToday ? 'ring-2 ring-blue-600 inset-0 z-10' : ''}`}
                >
                  {/* Topo da Célula: Número do Dia + Indicadores Especiais */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-black px-2 py-0.5 rounded-full ${
                        isToday
                          ? 'bg-blue-900 text-white shadow-xs'
                          : cell.isCurrentMonth
                          ? (dayStatus.isWeekend ? 'text-slate-500 font-bold' : 'text-slate-900 font-extrabold')
                          : 'text-slate-400'
                      }`}
                    >
                      {cell.dateObj.getDate()}
                    </span>

                    {/* Botão sutil de Adicionar rápido visível em hover */}
                    {canCreateEvent && cell.isCurrentMonth && (
                      <span className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-600 hover:text-blue-900 font-bold transition-opacity">
                        <i className="fa-solid fa-plus"></i>
                      </span>
                    )}

                    {dayEvents.length > 0 && (
                      <span className="text-[9px] font-bold font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-full border border-slate-200">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  {/* BANNERS DAS 3 REGRAS ESPECIAIS NA CÉLULA */}
                  {dayStatus.hasFeriado && (
                    <div
                      className="mb-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-rose-100 text-rose-950 border border-rose-300 flex items-center gap-1 shadow-2xs"
                      title="Dia Não Letivo: Atividades e agendamentos suspensos."
                    >
                      <i className="fa-solid fa-umbrella-beach text-[8px] text-rose-700"></i>
                      <span className="truncate">Sem Aula (Feriado)</span>
                    </div>
                  )}

                  {dayStatus.hasReposicao && (
                    <div
                      className="mb-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-100 text-emerald-950 border border-emerald-400 flex items-center gap-1 shadow-2xs"
                      title={`Sábado Letivo com Aula Presencial (Segue grade de ${dayStatus.reposicaoEvent.diaDuplicado || 'Segunda-feira'})`}
                    >
                      <i className="fa-solid fa-arrows-rotate text-[8px] text-emerald-700"></i>
                      <span className="truncate">Sábado Letivo ({dayStatus.reposicaoEvent.diaDuplicado || 'Seg'})</span>
                    </div>
                  )}

                  {dayStatus.hasProvao && (
                    <div
                      className="mb-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-purple-100 text-purple-950 border border-purple-300 flex items-center gap-1 shadow-2xs"
                      title="Provão Paulista: Aulas regulares ONLINE, prova presencial na escola para turmas em avaliação."
                    >
                      <i className="fa-solid fa-graduation-cap text-[8px] text-purple-700"></i>
                      <span className="truncate">Provão (Online)</span>
                    </div>
                  )}

                  {dayStatus.isWeekend && !dayStatus.hasReposicao && !dayStatus.hasFeriado && cell.isCurrentMonth && (
                    <div className="text-[8px] font-bold text-slate-400 uppercase tracking-tight mb-0.5">
                      Fim de Semana
                    </div>
                  )}

                  {/* Lista de Blocos de Eventos */}
                  <div className="space-y-1 overflow-y-auto max-h-[85px] custom-scrollbar pr-0.5">
                    {dayEvents.map((ev) => {
                      const isMultiDay = ev.dataInicio !== ev.dataFim;
                      const hasTime = Boolean(ev.horaInicio);
                      const catConfig = getCategoryConfig(ev.categoria);

                      return (
                        <div
                          key={`${ev.id}-${cell.ymd}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                          }}
                          className={`p-1.5 rounded-lg border text-[10px] leading-tight cursor-pointer transition-all ${getEventCardStyle(
                            ev
                          )}`}
                          title={`${ev.titulo} (${ev.categoria})`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-extrabold truncate flex-1 flex items-center gap-1">
                              <i className={`${catConfig.icone} text-[9px] shrink-0 opacity-80`}></i>
                              {hasTime && (
                                <span className="text-cyan-900 font-bold mr-0.5">
                                  {ev.horaInicio}
                                </span>
                              )}
                              <span>{ev.titulo}</span>
                            </span>

                            {isMultiDay && (
                              <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase bg-indigo-200 text-indigo-900 shrink-0">
                                Multi
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
      ) : (
        /* VISUALIZAÇÃO EM LISTA / CRONOGRAMA */
        <div className="space-y-3">
          {/* Sub-Abas de Status na Lista */}
          <div className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setAbaStatusLista('pendentes')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  abaStatusLista === 'pendentes'
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-clock text-cyan-300"></i>
                <span>Pendentes</span>
                <span className={`px-2 py-0.2 text-[10px] rounded-full font-bold ${
                  abaStatusLista === 'pendentes' ? 'bg-cyan-400 text-blue-950' : 'bg-slate-200 text-slate-700'
                }`}>
                  {qtdPendentes}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAbaStatusLista('concluidos')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  abaStatusLista === 'concluidos'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-circle-check text-emerald-300"></i>
                <span>Concluídos</span>
                <span className={`px-2 py-0.2 text-[10px] rounded-full font-bold ${
                  abaStatusLista === 'concluidos' ? 'bg-emerald-200 text-emerald-950' : 'bg-slate-200 text-slate-700'
                }`}>
                  {qtdConcluidos}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAbaStatusLista('todos')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  abaStatusLista === 'todos'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-layer-group text-slate-300"></i>
                <span>Todos</span>
                <span className={`px-2 py-0.2 text-[10px] rounded-full font-bold ${
                  abaStatusLista === 'todos' ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {qtdTodos}
                </span>
              </button>
            </div>

            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              <i className="fa-solid fa-arrow-down-short-wide text-blue-600"></i>
              <span>Ordem Cronológica</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs divide-y divide-slate-100 overflow-hidden">
            {eventsForListView.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs italic space-y-2">
                <i className="fa-solid fa-calendar-xmark text-3xl text-slate-300 block mb-2"></i>
                <p className="font-semibold text-slate-600">
                  {abaStatusLista === 'pendentes'
                    ? 'Nenhum evento pendente agendado no momento.'
                    : abaStatusLista === 'concluidos'
                    ? 'Nenhum evento concluído localizado.'
                    : 'Nenhum evento agendado localizado com os filtros selecionados.'}
                </p>
              </div>
            ) : (
              eventsForListView.map((ev) => {
                const isMultiDay = ev.dataInicio !== ev.dataFim;
                const diaSemanaInicio = getDayOfWeekShortBR(ev.dataInicio);
                const diaSemanaFim = getDayOfWeekShortBR(ev.dataFim);
                const catCfg = getCategoryConfig(ev.categoria);
                const dayStatus = checkDayStatus(ev.dataInicio, tasks);

                return (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className={`p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer ${
                      ev.concluido ? 'bg-slate-50/70' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {podeEditarAgenda ? (
                        <button
                          type="button"
                          onClick={(e) => handleToggleConcluido(ev, e)}
                          className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                            ev.concluido
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 bg-white hover:border-blue-600 text-transparent'
                          }`}
                          title={ev.concluido ? "Marcar como pendente" : "Marcar como concluído"}
                        >
                          <i className="fa-solid fa-check text-xs"></i>
                        </button>
                      ) : (
                        <div
                          className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                            ev.concluido
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-200 bg-slate-100 text-transparent'
                          }`}
                        >
                          <i className="fa-solid fa-check text-xs"></i>
                        </div>
                      )}

                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3
                            className={`font-extrabold text-xs uppercase ${
                              ev.concluido ? 'line-through text-slate-400' : 'text-blue-950'
                            }`}
                          >
                            {ev.titulo}
                          </h3>

                          {ev.categoria && (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${catCfg.badgeClass}`}>
                              <i className={catCfg.icone}></i>
                              <span>{ev.categoria}</span>
                            </span>
                          )}

                          {/* Chips Especiais */}
                          {ev.categoria?.includes('Provão') && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-purple-100 text-purple-900 border border-purple-300">
                              💻 Aulas Online
                            </span>
                          )}

                          {ev.categoria?.includes('Reposição') && ev.diaDuplicado && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 text-emerald-950 border border-emerald-300">
                              🎒 Segue {ev.diaDuplicado}
                            </span>
                          )}

                          {ev.categoria?.includes('Feriado') && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-rose-100 text-rose-900 border border-rose-300">
                              🚫 Sem Aulas
                            </span>
                          )}

                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getBadgeStyle(ev.atribuirA)}`}>
                            {ev.atribuirA}
                          </span>

                          {ev.concluido && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 text-emerald-900 border border-emerald-300">
                              Concluído
                            </span>
                          )}
                        </div>

                        {ev.descricao && (
                          <p className="text-xs text-slate-600 font-medium line-clamp-2">
                            {ev.descricao}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">
                      <div className="text-right mr-1">
                        <div className="font-mono font-extrabold text-xs text-blue-900 flex items-center justify-end gap-1">
                          <span>{formatDataBR(ev.dataInicio)}</span>
                          {diaSemanaInicio && (
                            <span className="text-[10px] font-extrabold text-slate-500 font-sans uppercase">
                              ({diaSemanaInicio})
                            </span>
                          )}
                          {isMultiDay && (
                            <span>
                              {' - '}{formatDataBR(ev.dataFim)}
                              {diaSemanaFim && ` (${diaSemanaFim})`}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          {ev.horaInicio ? `⏰ ${ev.horaInicio}${ev.horaFim ? ` - ${ev.horaFim}` : ''}` : 'Dia Inteiro'}
                        </div>
                      </div>

                      {/* Botão Virar Tarefa */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenTransformModal(ev, e)}
                        className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-black text-[11px] rounded-xl border border-amber-300 transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        title="Transformar este compromisso em uma tarefa da rotina PDCA"
                      >
                        <i className="fa-solid fa-arrow-right-to-bracket text-amber-800 text-xs"></i>
                        <span className="hidden xl:inline">Virar Tarefa</span>
                      </button>

                      {/* Botão Postar no Mural */}
                      {podeEditarAgenda && (
                        <button
                          type="button"
                          onClick={(e) => handleOpenMuralModal(ev, e)}
                          className={`px-2.5 py-1.5 font-extrabold text-[11px] rounded-xl border transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                            ev.postadoNoMural || ev.muralRecadoId
                              ? 'bg-sky-100 hover:bg-sky-200 text-sky-950 border-sky-300'
                              : 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200'
                          }`}
                          title="Postar no Mural de Recados"
                        >
                          <i className="fa-solid fa-bullhorn text-sky-700 text-xs"></i>
                          <span className="hidden xl:inline">{ev.postadoNoMural || ev.muralRecadoId ? 'Mural ✓' : 'Mural'}</span>
                        </button>
                      )}

                      {/* Botão Editar */}
                      {podeEditarAgenda && (
                        <button
                          type="button"
                          onClick={(e) => handleOpenEditModal(ev, e)}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-950 font-extrabold text-[11px] rounded-xl border border-blue-200 transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                          title="Editar evento"
                        >
                          <i className="fa-solid fa-pen-to-square text-blue-700 text-xs"></i>
                          <span className="hidden xl:inline">Editar</span>
                        </button>
                      )}

                      {podeEditarAgenda && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteEvent(ev, e)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors rounded-lg cursor-pointer"
                          title="Excluir evento"
                        >
                          <i className="fa-solid fa-trash-can text-xs"></i>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* VISUALIZAÇÃO MOBILE (DATA STRIP HORIZONTAL + TIMELINE FEED VERTICAL) */}
      <div className="block md:hidden space-y-4 pt-2">
        <div className="bg-slate-100 p-2.5 rounded-2xl border border-slate-200 space-y-2">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="font-extrabold text-blue-950 uppercase text-[11px] flex items-center gap-1.5">
              <i className="fa-solid fa-calendar-day text-cyan-600"></i>
              <span>Seletor de Dias ({NORM_MONTH_NAMES[month]})</span>
            </span>
            <button
              type="button"
              onClick={handleGoToTodayMobile}
              className="text-[10px] font-black uppercase text-blue-800 bg-white px-2 py-0.5 rounded-lg border border-slate-200"
            >
              Ir para Hoje
            </button>
          </div>

          {/* Faixa Horizontal de Dias */}
          <div className="overflow-x-auto flex gap-2 py-1 px-0.5 custom-scrollbar scroll-smooth">
            {mobileDaysInMonth.map((day) => {
              const isSelected = selectedMobileDateYMD === day.ymd;

              return (
                <button
                  key={day.ymd}
                  type="button"
                  ref={isSelected ? selectedDayPillRef : null}
                  onClick={() => setSelectedMobileDateYMD(day.ymd)}
                  className={`min-w-[62px] min-h-[70px] flex flex-col items-center justify-center rounded-2xl transition-all cursor-pointer select-none p-2 relative ${
                    isSelected
                      ? 'bg-cyan-400 text-blue-950 font-black shadow-md ring-2 ring-cyan-300 scale-105 z-10'
                      : day.isToday
                      ? 'bg-blue-950 text-cyan-300 font-bold border border-blue-800'
                      : day.dayStatus.hasFeriado
                      ? 'bg-rose-50 text-rose-950 border border-rose-300'
                      : day.dayStatus.hasReposicao
                      ? 'bg-emerald-50 text-emerald-950 border border-emerald-400'
                      : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  <span className="text-[10px] uppercase font-black tracking-wide">
                    {day.dayOfWeek}
                  </span>

                  <span className="text-base font-black">
                    {day.dayNum}
                  </span>

                  {day.dayStatus.hasFeriado && (
                    <span className="text-[8px] font-black text-rose-700">🚫</span>
                  )}
                  {day.dayStatus.hasReposicao && (
                    <span className="text-[8px] font-black text-emerald-700">🎒</span>
                  )}
                  {day.dayStatus.hasProvao && (
                    <span className="text-[8px] font-black text-purple-700">💻</span>
                  )}

                  {day.eventsCount > 0 && (
                    <span className={`mt-0.5 px-1.5 py-0.2 text-[9px] font-black rounded-full ${
                      isSelected
                        ? 'bg-blue-950 text-cyan-300'
                        : 'bg-blue-900 text-white'
                    }`}>
                      {day.eventsCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* FEED VERTICAL DO DIA SELECIONADO NO MOBILE */}
        <div className="space-y-3">
          {/* Banner de Status do Dia Selecionado */}
          <div className={`p-3 rounded-2xl border text-xs flex items-center justify-between ${selectedDateDayStatus.badgeClass}`}>
            <div className="flex items-center gap-2">
              <span className="font-black uppercase">
                {formatDataBR(selectedMobileDateYMD)} ({getDayOfWeekShortBR(selectedMobileDateYMD)})
              </span>
              <span className="text-[10px] font-bold">
                • {selectedDateDayStatus.statusLabel}
              </span>
            </div>
            {canCreateEvent && (
              <button
                type="button"
                onClick={() => handleOpenAddModalForDate(selectedMobileDateYMD)}
                className="px-2.5 py-1 bg-blue-900 text-white font-bold text-[10px] rounded-lg shadow-2xs"
              >
                + Novo
              </button>
            )}
          </div>

          {/* Lista de Eventos do Dia */}
          {mobileEventsForSelectedDate.length === 0 ? (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center space-y-2">
              <i className="fa-solid fa-calendar-xmark text-2xl text-slate-300"></i>
              <p className="text-xs font-semibold text-slate-700">Nenhum evento registrado nesta data.</p>
              {canCreateEvent && (
                <button
                  type="button"
                  onClick={() => handleOpenAddModalForDate(selectedMobileDateYMD)}
                  className="px-3 py-1.5 bg-blue-900 text-white text-xs font-bold rounded-xl"
                >
                  Criar Evento Neste Dia
                </button>
              )}
            </div>
          ) : (
            mobileEventsForSelectedDate.map((ev) => {
              const catCfg = getCategoryConfig(ev.categoria);

              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedEvent(ev)}
                  className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs space-y-2 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-extrabold text-xs text-blue-950 uppercase">{ev.titulo}</h4>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border inline-block mt-1 ${catCfg.badgeClass}`}>
                        {ev.categoria}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      {ev.horaInicio || 'Dia Todo'}
                    </span>
                  </div>

                  {ev.descricao && (
                    <p className="text-xs text-slate-600 line-clamp-2">
                      {ev.descricao}
                    </p>
                  )}

                  {ev.categoria?.includes('Reposição') && ev.diaDuplicado && (
                    <div className="text-[10px] font-bold text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                      🎒 Sábado Letivo: Grade horária de {ev.diaDuplicado}
                    </div>
                  )}

                  {ev.categoria?.includes('Provão') && (
                    <div className="text-[10px] font-bold text-purple-900 bg-purple-50 p-2 rounded-lg border border-purple-200">
                      💻 Aulas Online para a escola • Prova presencial para turmas indicadas
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MODAL DETALHES DO EVENTO */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-400 text-blue-950 font-black flex items-center justify-center text-sm">
                  <i className={getCategoryConfig(selectedEvent.categoria).icone}></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider">Detalhes do Evento</h3>
                  <p className="text-[10px] text-cyan-200">Agenda PEI • EE Clóvis de Lucca</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              <div>
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-0.5">Título</span>
                <h2 className="font-extrabold text-sm text-blue-950 uppercase">{selectedEvent.titulo}</h2>
              </div>

              {/* CARD DE FUNÇÃO ESPECIAL OPERACIONAL */}
              {selectedEvent.categoria?.includes('Provão') && (
                <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-200 space-y-2">
                  <div className="flex items-center gap-2 text-purple-950 font-black text-xs uppercase">
                    <i className="fa-solid fa-graduation-cap text-purple-700"></i>
                    <span>Diretriz do Provão Paulista</span>
                  </div>
                  <p className="text-purple-900 font-medium leading-relaxed text-[11px]">
                    As aulas regulares de toda a escola acontecem em formato <strong>ONLINE (Remoto)</strong>, com exceção exclusiva das turmas listadas abaixo que realizam a avaliação presencialmente:
                  </p>
                  {selectedEvent.turmasProvao?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selectedEvent.turmasProvao.map((turma, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-purple-200 text-purple-950 border border-purple-300">
                          🏫 {turma}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-purple-800 italic">Turmas específicas a confirmar pela coordenação pedagógica.</span>
                  )}
                </div>
              )}

              {selectedEvent.categoria?.includes('Reposição') && (
                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-300 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-950 font-black text-xs uppercase">
                    <i className="fa-solid fa-arrows-rotate text-emerald-700"></i>
                    <span>Sábado Letivo com Aula Homologado</span>
                  </div>
                  <p className="text-emerald-900 font-medium leading-relaxed text-[11px]">
                    Haverá aula presencial regular para estudantes e docentes.
                  </p>
                  <div className="p-2.5 bg-white rounded-lg border border-emerald-200 flex items-center justify-between">
                    <span className="text-slate-600 font-bold">Grade Horária Duplicada:</span>
                    <span className="font-black text-emerald-950 text-xs uppercase bg-emerald-100 px-2.5 py-0.5 rounded-md border border-emerald-300">
                      {selectedEvent.diaDuplicado || 'Segunda-feira'}
                    </span>
                  </div>
                  {selectedEvent.motivoReposicao && (
                    <p className="text-[10px] text-slate-600 font-medium">
                      Motivo: {selectedEvent.motivoReposicao}
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-800 font-bold">
                    ✓ Sábado letivo presencial com atividades escolares liberadas.
                  </p>
                </div>
              )}

              {selectedEvent.categoria?.includes('Feriado') && (
                <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-rose-950 font-black text-xs uppercase">
                    <i className="fa-solid fa-umbrella-beach text-rose-700"></i>
                    <span>Dia Não Letivo (Feriado ou Ponto Facultativo)</span>
                  </div>
                  <p className="text-rose-900 font-medium text-[11px]">
                    Nesta data todas as atividades escolares, aulas regulares e ações pedagógicas ficam totalmente suspensas.
                  </p>
                </div>
              )}

              {selectedEvent.descricao && (
                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-0.5">Descrição / Orientações</span>
                  <p className="text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200 font-medium leading-relaxed whitespace-pre-line">
                    {selectedEvent.descricao}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 bg-blue-50/70 p-3 rounded-xl border border-blue-100">
                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Categoria</span>
                  <span className="font-bold text-blue-950">{selectedEvent.categoria}</span>
                </div>

                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Público Alvo</span>
                  <span className="font-bold text-blue-900 uppercase">{selectedEvent.atribuirA}</span>
                </div>

                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Data de Início</span>
                  <span className="font-extrabold text-blue-950 font-mono">{formatDataBR(selectedEvent.dataInicio)}</span>
                </div>

                <div>
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Data de Término</span>
                  <span className="font-extrabold text-blue-950 font-mono">{formatDataBR(selectedEvent.dataFim)}</span>
                </div>

                <div className="col-span-2">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Horário</span>
                  <span className="font-bold text-slate-800">
                    {selectedEvent.horaInicio ? `${selectedEvent.horaInicio}${selectedEvent.horaFim ? ` às ${selectedEvent.horaFim}` : ''}` : 'Dia Inteiro'}
                  </span>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  {podeEditarAgenda && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleToggleConcluido(selectedEvent)}
                        className={`px-3 py-2 rounded-xl font-extrabold text-xs cursor-pointer flex items-center gap-1.5 transition-colors ${
                          selectedEvent.concluido
                            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            : 'bg-blue-900 text-white hover:bg-blue-950'
                        }`}
                      >
                        <i className={`fa-solid ${selectedEvent.concluido ? 'fa-check-circle' : 'fa-circle'}`}></i>
                        <span>{selectedEvent.concluido ? 'Concluído' : 'Concluir'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(selectedEvent)}
                        className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-950 font-extrabold text-xs rounded-xl border border-blue-300 cursor-pointer flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-pen-to-square text-blue-700"></i>
                        <span>Editar</span>
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {podeEditarAgenda && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteEvent(selectedEvent, e)}
                      className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 font-bold text-xs rounded-xl cursor-pointer"
                    >
                      Excluir
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(null)}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CADASTRO DE NOVO EVENTO PEI */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
            <div className="bg-blue-950 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-400 text-blue-950 font-black flex items-center justify-center text-sm">
                  <i className="fa-solid fa-calendar-plus"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider">Novo Evento na Agenda PEI</h3>
                  <p className="text-[10px] text-cyan-200">Suporte completo a Feriados, Provão Paulista e Reposição de Aulas</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Título do Evento <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newEventForm.titulo}
                  onChange={(e) => setNewEventForm({ ...newEventForm, titulo: e.target.value })}
                  placeholder="Ex: Provão Paulista 3ª Série / Reposição de Sábado / Feriado Tiradentes"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Categoria <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={newEventForm.categoria}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      setNewEventForm({
                        ...newEventForm,
                        categoria: newCat,
                        titulo: newEventForm.titulo || (newCat.includes('Provão') ? 'Provão Paulista' : newCat.includes('Reposição') ? 'Reposição de Aulas (Sábado Letivo)' : newCat.includes('Feriado') ? 'Feriado Escolar' : '')
                      });
                    }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <optgroup label="⚡ Funções Especiais Essenciais">
                      <option value="Feriado / Ponto Facultativo">🚫 Feriado / Ponto Facultativo (Sem Aulas)</option>
                      <option value="Provão Paulista">🎓 Provão Paulista (Aulas Online)</option>
                      <option value="Reposição de Aulas (Sábado Letivo)">🎒 Reposição de Aulas (Sábado Letivo)</option>
                    </optgroup>
                    <optgroup label="📚 Avaliações &amp; Provas">
                      <option value="Avaliações & Provas">Avaliações &amp; Provas (SAEB / Paulista)</option>
                      <option value="Conselho de Classe & Série">Conselho de Classe &amp; Série</option>
                    </optgroup>
                    <optgroup label="🚌 Passeios &amp; Pesquisas">
                      <option value="Passeios & Saídas Pedagógicas">Passeios &amp; Saídas Pedagógicas</option>
                      <option value="Pesquisas & Feiras Científicas">Pesquisas &amp; Feiras Científicas</option>
                    </optgroup>
                    <optgroup label="💡 Pedagógico PEI">
                      <option value="Acolhimento PEI">Acolhimento PEI</option>
                      <option value="Ação Pedagógica & Eletivas">Ação Pedagógica &amp; Eletivas</option>
                      <option value="Plantão de Dúvidas & Tutoria">Plantão de Dúvidas &amp; Tutoria</option>
                      <option value="Formação Continuada / ATPC">Formação Continuada / ATPC</option>
                      <option value="Eventos Cívicos & Culturais">Eventos Cívicos &amp; Culturais</option>
                    </optgroup>
                    <optgroup label="💻 Administrativo &amp; Operacional">
                      <option value="Administrativo & Secretaria">Administrativo &amp; Secretaria</option>
                      <option value="Reunião de Pais & Mestres">Reunião de Pais &amp; Mestres</option>
                      <option value="Planejamento Escolar">Planejamento Escolar</option>
                      <option value="Reunião da Gestão & APM">Reunião da Gestão &amp; APM</option>
                      <option value="Manutenção & TI">Manutenção &amp; TI</option>
                      <option value="Evento Escolar Geral">Evento Escolar Geral</option>
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Público Alvo <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={newEventForm.atribuirA}
                    onChange={(e) => setNewEventForm({ ...newEventForm, atribuirA: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="TODA A EQUIPE">TODA A EQUIPE</option>
                    <option value="PROFESSORES">PROFESSORES</option>
                    <option value="SECRETARIA">SECRETARIA</option>
                    <option value="DIRETOR">DIRETOR</option>
                    <option value="VICE_DIRETOR">VICE_DIRETOR</option>
                    <option value="CGPG">CGPG</option>
                    <option value="PAAC">PAAC</option>
                  </select>
                </div>
              </div>

              {/* CAMPOS ESPECIAIS: PROVÃO PAULISTA */}
              {newEventForm.categoria.includes('Provão') && (
                <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-300 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[11px] text-purple-950 uppercase flex items-center gap-1.5">
                      <i className="fa-solid fa-graduation-cap text-purple-700"></i>
                      <span>Turmas com Prova Presencial na Escola</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => selectAllTurmasEM(false)}
                      className="text-[10px] font-bold text-purple-800 hover:underline cursor-pointer"
                    >
                      Selecionar Todo o EM
                    </button>
                  </div>
                  <p className="text-[11px] text-purple-900 font-medium">
                    As demais turmas terão aulas em formato <strong>ONLINE (Remoto)</strong>. Marque quais turmas virão presencialmente:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 bg-white rounded-lg border border-purple-200">
                    {TURMAS_ESCOLARES.map((turma) => {
                      const isChecked = newEventForm.turmasProvao?.includes(turma);
                      return (
                        <label key={turma} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 cursor-pointer p-1 rounded hover:bg-purple-50">
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

              {/* CAMPOS ESPECIAIS: REPOSIÇÃO DE AULAS (SÁBADO LETIVO) */}
              {newEventForm.categoria.includes('Reposição') && (
                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-300 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-950 font-black text-[11px] uppercase">
                    <i className="fa-solid fa-arrows-rotate text-emerald-700"></i>
                    <span>Configuração do Sábado Letivo com Aula</span>
                  </div>
                  <p className="text-[11px] text-emerald-900 font-medium">
                    Haverá aula presencial. Defina qual dia da semana este sábado irá duplicar na grade horária:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                        Dia da Semana Replicado / Duplicado <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={newEventForm.diaDuplicado}
                        onChange={(e) => setNewEventForm({ ...newEventForm, diaDuplicado: e.target.value })}
                        className="w-full p-2 bg-white border border-emerald-300 rounded-lg font-black text-emerald-950 text-xs"
                      >
                        {DIAS_DA_SEMANA_REPOSICAO.map((dia) => (
                          <option key={dia} value={dia}>
                            Horário de {dia}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-700 mb-1">
                        Motivo / Justificativa da Reposição
                      </label>
                      <input
                        type="text"
                        value={newEventForm.motivoReposicao}
                        onChange={(e) => setNewEventForm({ ...newEventForm, motivoReposicao: e.target.value })}
                        placeholder="Ex: Reposição referente à emenda de feriado..."
                        className="w-full p-2 bg-white border border-emerald-300 rounded-lg font-medium text-xs text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* CAMPOS ESPECIAIS: FERIADO / PONTO FACULTATIVO */}
              {newEventForm.categoria.includes('Feriado') && (
                <div className="bg-rose-50 p-3 rounded-xl border border-rose-300 flex items-start gap-2 text-rose-950">
                  <i className="fa-solid fa-umbrella-beach text-rose-700 text-base mt-0.5"></i>
                  <div>
                    <h4 className="font-black text-xs uppercase">Dia Não Letivo Programado</h4>
                    <p className="text-[11px] text-rose-900 leading-tight">
                      Ao cadastrar este dia, todas as aulas e ações escolares ficam automaticamente bloqueadas e suspensas.
                    </p>
                  </div>
                </div>
              )}

              {/* Bloco de Datas e Horários */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[11px] text-blue-950 uppercase tracking-wider">
                    Datas e Horários do Evento
                  </span>
                  <span className="text-[10px] text-slate-500">Horários opcionais (Dia Inteiro)</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Data de Início <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={newEventForm.dataInicio}
                      onChange={(e) => setNewEventForm({ ...newEventForm, dataInicio: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Hora de Início (Opcional)
                    </label>
                    <input
                      type="time"
                      value={newEventForm.horaInicio}
                      onChange={(e) => setNewEventForm({ ...newEventForm, horaInicio: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Data de Término (Opcional)
                    </label>
                    <input
                      type="date"
                      value={newEventForm.dataFim}
                      onChange={(e) => setNewEventForm({ ...newEventForm, dataFim: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Hora de Término (Opcional)
                    </label>
                    <input
                      type="time"
                      value={newEventForm.horaFim}
                      onChange={(e) => setNewEventForm({ ...newEventForm, horaFim: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Descrição / Orientações (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={newEventForm.descricao}
                  onChange={(e) => setNewEventForm({ ...newEventForm, descricao: e.target.value })}
                  placeholder="Orientações pedagógicas, pauta ou detalhes operacionais..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-floppy-disk"></i>
                      <span>Cadastrar Evento</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO DE EVENTO PEI */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
            <div className="bg-blue-950 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500 text-white font-black flex items-center justify-center text-sm shadow-xs">
                  <i className="fa-solid fa-pen-to-square"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider">Editar Evento PEI</h3>
                  <p className="text-[10px] text-cyan-200">Acesso Restrito: Direção, Vice-Direção e CGPG</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <form onSubmit={handleUpdateEvent} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              <div>
                <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                  Título do Evento <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editEventForm.titulo}
                  onChange={(e) => setEditEventForm({ ...editEventForm, titulo: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                    Categoria
                  </label>
                  <select
                    value={editEventForm.categoria}
                    onChange={(e) => setEditEventForm({ ...editEventForm, categoria: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {CATEGORIAS_AGENDA.map((cat) => (
                      <option key={cat.id} value={cat.nome}>{cat.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                    Público Alvo
                  </label>
                  <select
                    value={editEventForm.atribuirA}
                    onChange={(e) => setEditEventForm({ ...editEventForm, atribuirA: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer uppercase"
                  >
                    <option value="TODA A EQUIPE">TODA A EQUIPE</option>
                    <option value="PROFESSORES">PROFESSORES</option>
                    <option value="SECRETARIA">SECRETARIA</option>
                    <option value="DIRETOR">DIRETOR</option>
                    <option value="VICE_DIRETOR">VICE-DIRETOR</option>
                    <option value="CGPG">CGPG</option>
                    <option value="PAAC">PAAC</option>
                  </select>
                </div>
              </div>

              {/* Bloco de Campos Especiais se for Provão Paulista */}
              {editEventForm.categoria?.includes('Provão') && (
                <div className="bg-purple-50 p-3 rounded-xl border border-purple-300 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[11px] text-purple-950 uppercase flex items-center gap-1.5">
                      <i className="fa-solid fa-graduation-cap text-purple-700"></i>
                      <span>Turmas Presenciais</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => selectAllTurmasEM(true)}
                      className="text-[10px] font-bold text-purple-800 hover:underline cursor-pointer"
                    >
                      Selecionar Todo o EM
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-32 overflow-y-auto p-1 bg-white rounded-lg border border-purple-200">
                    {TURMAS_ESCOLARES.map((turma) => {
                      const isChecked = editEventForm.turmasProvao?.includes(turma);
                      return (
                        <label key={turma} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 cursor-pointer p-1 rounded hover:bg-purple-50">
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

              {/* Bloco de Campos Especiais se for Reposição */}
              {editEventForm.categoria?.includes('Reposição') && (
                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-300 space-y-2">
                  <span className="font-extrabold text-[11px] text-emerald-950 uppercase block">
                    Dia da Semana Replicado no Sábado
                  </span>
                  <select
                    value={editEventForm.diaDuplicado}
                    onChange={(e) => setEditEventForm({ ...editEventForm, diaDuplicado: e.target.value })}
                    className="w-full p-2 bg-white border border-emerald-300 rounded-lg font-black text-emerald-950 text-xs"
                  >
                    {DIAS_DA_SEMANA_REPOSICAO.map((dia) => (
                      <option key={dia} value={dia}>Horário de {dia}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Bloco de Datas e Horários */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Data de Início <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={editEventForm.dataInicio}
                      onChange={(e) => setEditEventForm({ ...editEventForm, dataInicio: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Hora de Início
                    </label>
                    <input
                      type="time"
                      value={editEventForm.horaInicio}
                      onChange={(e) => setEditEventForm({ ...editEventForm, horaInicio: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Data de Término
                    </label>
                    <input
                      type="date"
                      value={editEventForm.dataFim}
                      onChange={(e) => setEditEventForm({ ...editEventForm, dataFim: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                      Hora de Término
                    </label>
                    <input
                      type="time"
                      value={editEventForm.horaFim}
                      onChange={(e) => setEditEventForm({ ...editEventForm, horaFim: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                  Descrição / Orientações Detalhadas
                </label>
                <textarea
                  rows={3}
                  value={editEventForm.descricao}
                  onChange={(e) => setEditEventForm({ ...editEventForm, descricao: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white font-extrabold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
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

      {/* MODAL GUIA DE REGRAS OPERACIONAIS E CALENDÁRIO */}
      {isRegrasModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-400 text-blue-950 font-black flex items-center justify-center text-sm">
                  <i className="fa-solid fa-scale-balanced"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider">Diretrizes da Agenda PEI</h3>
                  <p className="text-[10px] text-cyan-200">EE Clóvis de Lucca • Regras Operacionais</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRegrasModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-300 space-y-1">
                <div className="flex items-center gap-2 font-black text-rose-950 uppercase text-xs">
                  <i className="fa-solid fa-umbrella-beach text-rose-700"></i>
                  <span>1. Feriado / Ponto Facultativo</span>
                </div>
                <p className="text-rose-900 leading-relaxed font-medium">
                  Nesses dias tudo fica paralisado: não há aulas regulares nem ações pedagógicas. O sistema bloqueia conflitos e alerta a comunidade.
                </p>
              </div>

              <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-300 space-y-1">
                <div className="flex items-center gap-2 font-black text-purple-950 uppercase text-xs">
                  <i className="fa-solid fa-graduation-cap text-purple-700"></i>
                  <span>2. Provão Paulista</span>
                </div>
                <p className="text-purple-900 leading-relaxed font-medium">
                  As aulas regulares ocorrem em formato <strong>ONLINE (Remoto)</strong> para a maioria da escola, menos para as turmas indicadas que comparecem à escola para prestar a prova presencial.
                </p>
              </div>

              <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-300 space-y-1">
                <div className="flex items-center gap-2 font-black text-emerald-950 uppercase text-xs">
                  <i className="fa-solid fa-arrows-rotate text-emerald-700"></i>
                  <span>3. Reposição de Aulas (Sábado Letivo)</span>
                </div>
                <p className="text-emerald-900 leading-relaxed font-medium">
                  Haverá aula presencial regular. A gestão escolar define qual dia da semana ele duplica (ex: horário de Segunda ou Sexta-feira). Todas as atividades escolares operam normalmente.
                </p>
              </div>

              <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-300 space-y-1">
                <div className="flex items-center gap-2 font-black text-slate-800 uppercase text-xs">
                  <i className="fa-solid fa-calendar-xmark text-slate-600"></i>
                  <span>4. Sábados e Domingos</span>
                </div>
                <p className="text-slate-700 leading-relaxed font-medium">
                  Por padrão, sábados e domingos não têm aula (mesma regra do ponto facultativo ou feriado), <strong>exceto no caso de Reposição de Aulas</strong> homologada.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 text-right shrink-0">
              <button
                type="button"
                onClick={() => setIsRegrasModalOpen(false)}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TRANSFORMAR EVENTO EM TAREFA (PDCA) */}
      {isTransformModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-amber-600 text-slate-950 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-950 text-amber-400 font-black flex items-center justify-center text-sm shadow-xs">
                  <i className="fa-solid fa-list-check"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-950">
                    Transformar Evento em Tarefa (PDCA)
                  </h3>
                  <p className="text-[10px] text-amber-950 font-bold">
                    Integração com Minhas Tarefas da rotina_equipe
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTransformModalOpen(false)}
                className="text-slate-900 hover:text-black p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <form onSubmit={handleSaveTaskFromEvent} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                  Título da Tarefa <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={transformTaskForm.titulo}
                  onChange={(e) => setTransformTaskForm({ ...transformTaskForm, titulo: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                    Frequência da Tarefa
                  </label>
                  <select
                    value={transformTaskForm.frequencia}
                    onChange={(e) => setTransformTaskForm({ ...transformTaskForm, frequencia: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="Ação Pontual (Prazo Fixo)">Ação Pontual (Prazo Fixo)</option>
                    <option value="Diária">Diária</option>
                    <option value="Semanal">Semanal</option>
                    <option value="Mensal">Mensal</option>
                    <option value="Bimestral">Bimestral</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 text-[10px] uppercase mb-1">
                    Atribuir Responsável
                  </label>
                  <select
                    value={transformTaskForm.atribuirA}
                    onChange={(e) => setTransformTaskForm({ ...transformTaskForm, atribuirA: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer uppercase"
                  >
                    <option value="TODA A EQUIPE">TODA A EQUIPE</option>
                    <option value="DIRETOR">DIRETOR</option>
                    <option value="VICE_DIRETOR">VICE-DIRETOR</option>
                    <option value="CGPG">CGPG</option>
                    <option value="PROFESSORES">PROFESSORES</option>
                    <option value="SECRETARIA">SECRETARIA</option>
                    <option value="PAAC">PAAC</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTransformModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={transformSaving}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {transformSaving ? 'Criando Tarefa...' : 'Confirmar e Criar Tarefa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE POSTAR EVENTO NO MURAL */}
      {isMuralModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-gradient-to-r from-sky-900 to-blue-950 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-400 text-blue-950 font-black flex items-center justify-center text-sm shadow-xs">
                  <i className="fa-solid fa-bullhorn"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-white">
                    Postar no Mural de Recados
                  </h3>
                  <p className="text-[10px] text-sky-200">Aviso Oficial Integrado com a Agenda PEI</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMuralModalOpen(false)}
                className="text-white/80 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            <form onSubmit={handlePostToMural} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-[11px] font-extrabold text-slate-700 uppercase mb-1">
                  Título do Comunicado *
                </label>
                <input
                  type="text"
                  required
                  value={muralForm.titulo}
                  onChange={(e) => setMuralForm({ ...muralForm, titulo: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold text-slate-700 uppercase mb-1">
                  Conteúdo do Recado Oficial *
                </label>
                <textarea
                  rows={6}
                  required
                  value={muralForm.conteudo}
                  onChange={(e) => setMuralForm({ ...muralForm, conteudo: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed font-mono text-[11px]"
                ></textarea>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsMuralModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={muralSaving}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-black rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
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
