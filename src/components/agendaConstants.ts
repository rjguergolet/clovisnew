/**
 * Constantes e Funções Auxiliares Especializadas para a Agenda PEI
 * EE Clóvis de Lucca - Programa Ensino Integral
 */

export interface CategoriaAgendaDef {
  id: string;
  nome: string;
  grupo: 'especial' | 'avaliacao' | 'pedagogico' | 'passeio' | 'administrativo' | 'geral';
  icone: string;
  badgeClass: string;
  borderClass: string;
  cardClass: string;
  descricao: string;
  isSpecial?: 'feriado' | 'provao' | 'reposicao';
}

export const CATEGORIAS_AGENDA: CategoriaAgendaDef[] = [
  // --- FUNÇÕES ESPECIAIS ESSENCIAIS ---
  {
    id: 'feriado_ponto_facultativo',
    nome: 'Feriado / Ponto Facultativo',
    grupo: 'especial',
    icone: 'fa-solid fa-umbrella-beach',
    badgeClass: 'bg-rose-100 text-rose-900 border-rose-300 font-black',
    borderClass: 'border-rose-300',
    cardClass: 'bg-rose-50/80 border-rose-300 text-rose-950 font-bold hover:bg-rose-100',
    descricao: 'Dia não letivo. As atividades escolares, aulas e ações da escola ficam totalmente paralisadas.',
    isSpecial: 'feriado'
  },
  {
    id: 'provao_paulista',
    nome: 'Provão Paulista',
    grupo: 'especial',
    icone: 'fa-solid fa-graduation-cap',
    badgeClass: 'bg-purple-100 text-purple-900 border-purple-300 font-black',
    borderClass: 'border-purple-300',
    cardClass: 'bg-purple-50/90 border-purple-300 text-purple-950 font-bold hover:bg-purple-100',
    descricao: 'As aulas regulares ocorrem em formato ONLINE/remoto, exceto para as turmas selecionadas que farão a prova presencialmente.',
    isSpecial: 'provao'
  },
  {
    id: 'reposicao_aulas',
    nome: 'Reposição de Aulas (Sábado Letivo)',
    grupo: 'especial',
    icone: 'fa-solid fa-arrows-rotate',
    badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-400 font-black',
    borderClass: 'border-emerald-400',
    cardClass: 'bg-emerald-50/90 border-emerald-300 text-emerald-950 font-bold hover:bg-emerald-100',
    descricao: 'Haverá aula presencial regular. Duplica e segue a grade horária de um dia útil da semana definido.',
    isSpecial: 'reposicao'
  },

  // --- AVALIAÇÕES E RENDIMENTO ESCOLAR ---
  {
    id: 'avaliacoes_provas',
    nome: 'Avaliações & Provas',
    grupo: 'avaliacao',
    icone: 'fa-solid fa-file-signature',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
    borderClass: 'border-amber-300',
    cardClass: 'bg-amber-50 border-amber-200 text-amber-950 font-semibold hover:bg-amber-100',
    descricao: 'Provas bimestrais, SAEB, Prova Paulista, Simulados ENEM e avaliações diagnósticas.'
  },
  {
    id: 'conselho_classe',
    nome: 'Conselho de Classe & Série',
    grupo: 'avaliacao',
    icone: 'fa-solid fa-users-rectangle',
    badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    borderClass: 'border-indigo-300',
    cardClass: 'bg-indigo-50 border-indigo-200 text-indigo-950 font-semibold hover:bg-indigo-100',
    descricao: 'Conselho participativo bimestral, análise de rendimento por série e busca ativa.'
  },

  // --- PASSEIOS E ATIVIDADES EXTERNAS ---
  {
    id: 'passeios_saidas',
    nome: 'Passeios & Saídas Pedagógicas',
    grupo: 'passeio',
    icone: 'fa-solid fa-bus',
    badgeClass: 'bg-teal-100 text-teal-900 border-teal-300',
    borderClass: 'border-teal-300',
    cardClass: 'bg-teal-50 border-teal-200 text-teal-950 font-semibold hover:bg-teal-100',
    descricao: 'Visitas culturais, museus, bienais, teatros, excursões e feiras de profissões.'
  },

  // --- PESQUISAS, CIÊNCIA E MOSTRAS ---
  {
    id: 'pesquisas_feiras',
    nome: 'Pesquisas & Feiras Científicas',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-flask-vial',
    badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-300',
    borderClass: 'border-cyan-300',
    cardClass: 'bg-cyan-50 border-cyan-200 text-cyan-950 font-semibold hover:bg-cyan-100',
    descricao: 'Feira de Ciências, mostras científicas, projetos de robótica e pesquisa de campo escolar.'
  },

  // --- PEDAGÓGICO, ELETIVAS E PROTAGONISMO PEI ---
  {
    id: 'acolhimento_pei',
    nome: 'Acolhimento PEI',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-hands-holding-child',
    badgeClass: 'bg-sky-100 text-sky-900 border-sky-300',
    borderClass: 'border-sky-300',
    cardClass: 'bg-sky-50 border-sky-200 text-sky-950 font-semibold hover:bg-sky-100',
    descricao: 'Acolhimento inicial de início de semestre, protagonismo juvenil e acolhimento de novos alunos.'
  },
  {
    id: 'acao_pedagogica',
    nome: 'Ação Pedagógica & Eletivas',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-book-open-reader',
    badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
    borderClass: 'border-blue-300',
    cardClass: 'bg-blue-50 border-blue-200 text-blue-950 font-semibold hover:bg-blue-100',
    descricao: 'Culminância das eletivas, projetos dos clubes juvenis, nivelamento e nivelamento de aprendizagem.'
  },
  {
    id: 'tutoria_duvidas',
    nome: 'Plantão de Dúvidas & Tutoria',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-user-graduate',
    badgeClass: 'bg-violet-100 text-violet-900 border-violet-300',
    borderClass: 'border-violet-300',
    cardClass: 'bg-violet-50 border-violet-200 text-violet-950 font-semibold hover:bg-violet-100',
    descricao: 'Sessões de tutoria individual, acompanhamento pedagógico e grupos de estudo.'
  },
  {
    id: 'formacao_continuada',
    nome: 'Formação Continuada / ATPC',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-chalkboard-user',
    badgeClass: 'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300',
    borderClass: 'border-fuchsia-300',
    cardClass: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-950 font-semibold hover:bg-fuchsia-100',
    descricao: 'ATPC geral e por área do conhecimento, estudo de caso e alinhamentos pedagógicos.'
  },
  {
    id: 'eventos_civicos_culturais',
    nome: 'Eventos Cívicos & Culturais',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-masks-theater',
    badgeClass: 'bg-orange-100 text-orange-900 border-orange-300',
    borderClass: 'border-orange-300',
    cardClass: 'bg-orange-50 border-orange-200 text-orange-950 font-semibold hover:bg-orange-100',
    descricao: 'Festa da Primavera/Junina, Jogos Escolares, Semana da Consciência Negra e atos cívicos.'
  },

  // --- ADMINISTRATIVO, GESTÃO E PAIS ---
  {
    id: 'administrativo_secretaria',
    nome: 'Administrativo & Secretaria',
    grupo: 'administrativo',
    icone: 'fa-solid fa-building-columns',
    badgeClass: 'bg-slate-200 text-slate-900 border-slate-300',
    borderClass: 'border-slate-300',
    cardClass: 'bg-slate-100 border-slate-200 text-slate-900 font-semibold hover:bg-slate-200/70',
    descricao: 'Prazos de digitação no SED, matrículas, transferências, censo escolar e prestação de contas.'
  },
  {
    id: 'reuniao_pais',
    nome: 'Reunião de Pais & Mestres',
    grupo: 'administrativo',
    icone: 'fa-solid fa-users',
    badgeClass: 'bg-lime-100 text-lime-950 border-lime-300',
    borderClass: 'border-lime-300',
    cardClass: 'bg-lime-50 border-lime-200 text-lime-950 font-semibold hover:bg-lime-100',
    descricao: 'Entrega de boletins, plantão com responsáveis e alinhamento do projeto de vida.'
  },
  {
    id: 'planejamento_escolar',
    nome: 'Planejamento Escolar',
    grupo: 'administrativo',
    icone: 'fa-solid fa-compass-drafting',
    badgeClass: 'bg-amber-100 text-amber-950 border-amber-300',
    borderClass: 'border-amber-300',
    cardClass: 'bg-amber-50/70 border-amber-200 text-amber-950 font-semibold hover:bg-amber-100',
    descricao: 'Semana de Planejamento e Replanejamento semestral da equipe escolar.'
  },
  {
    id: 'reuniao_gestao_apm',
    nome: 'Reunião da Gestão & APM',
    grupo: 'administrativo',
    icone: 'fa-solid fa-handshake',
    badgeClass: 'bg-zinc-200 text-zinc-900 border-zinc-400',
    borderClass: 'border-zinc-300',
    cardClass: 'bg-zinc-50 border-zinc-200 text-zinc-950 font-semibold hover:bg-zinc-100',
    descricao: 'Conselho de Escola, APM, reuniões de equipe gestora e alinhamentos de direção.'
  },
  {
    id: 'manutencao_predial',
    nome: 'Manutenção & Infraestrutura',
    grupo: 'administrativo',
    icone: 'fa-solid fa-wrench',
    badgeClass: 'bg-stone-200 text-stone-900 border-stone-300',
    borderClass: 'border-stone-300',
    cardClass: 'bg-stone-50 border-stone-200 text-stone-900 font-semibold hover:bg-stone-100',
    descricao: 'Manutenção predial, pintura, reformas, limpeza e vistoria de salas e instalações.'
  },
  {
    id: 'evento_geral',
    nome: 'Evento Escolar Geral',
    grupo: 'geral',
    icone: 'fa-solid fa-calendar-check',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    borderClass: 'border-slate-300',
    cardClass: 'bg-slate-50 border-slate-200 text-slate-800 font-semibold hover:bg-slate-100',
    descricao: 'Outros compromissos, comunicados e eventos da rotina escolar.'
  }
];

export const TURMAS_ESCOLARES = [
  '6º Ano A (EF)',
  '6º Ano B (EF)',
  '7º Ano A (EF)',
  '7º Ano B (EF)',
  '8º Ano A (EF)',
  '8º Ano B (EF)',
  '9º Ano A (EF)',
  '9º Ano B (EF)',
  '1ª Série A (EM)',
  '1ª Série B (EM)',
  '2ª Série A (EM)',
  '2ª Série B (EM)',
  '3ª Série A (EM)',
  '3ª Série B (EM)',
  '3ª Série C (EM)'
];

export const DIAS_DA_SEMANA_REPOSICAO = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira'
];

export function getCategoryConfig(nomeCategoria: string): CategoriaAgendaDef {
  const norm = String(nomeCategoria || '').trim().toLowerCase();
  
  if (norm.includes('feriado') || norm.includes('facultativo') || norm.includes('ponto facultativo')) {
    return CATEGORIAS_AGENDA[0]; // Feriado / Ponto Facultativo
  }
  if (norm.includes('provão') || norm.includes('provao') || norm.includes('provão paulista')) {
    return CATEGORIAS_AGENDA[1]; // Provão Paulista
  }
  if (norm.includes('reposição') || norm.includes('reposicao') || norm.includes('sábado letivo') || norm.includes('sabado letivo')) {
    return CATEGORIAS_AGENDA[2]; // Reposição de Aulas
  }
  if (norm.includes('passeio') || norm.includes('saída') || norm.includes('visita') || norm.includes('excurs')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'passeios_saidas') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('pesquisa') || norm.includes('feira de ci') || norm.includes('mostra')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'pesquisas_feiras') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('conselho')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'conselho_classe') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('prova') || norm.includes('avaliação') || norm.includes('avaliacao') || norm.includes('saeb')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'avaliacoes_provas') || CATEGORIAS_AGENDA[0];
  }

  const found = CATEGORIAS_AGENDA.find(c => c.nome.toLowerCase() === norm);
  return found || CATEGORIAS_AGENDA[CATEGORIAS_AGENDA.length - 1]; // Evento Escolar Geral
}

export interface DayStatusResult {
  ymd: string;
  dayOfWeek: number; // 0 = Domingo, 6 = Sábado
  isWeekend: boolean;
  hasFeriado: boolean;
  hasProvao: boolean;
  hasReposicao: boolean;
  isLetivo: boolean;
  statusLabel: string;
  badgeClass: string;
  bgCellClass: string;
  feriadoEvent?: any;
  reposicaoEvent?: any;
  provaoEvent?: any;
}

/**
 * Avalia o status letivo e especial de um dia no calendário
 */
export function checkDayStatus(ymd: string, eventsList: any[]): DayStatusResult {
  if (!ymd) {
    return {
      ymd: '',
      dayOfWeek: 0,
      isWeekend: false,
      hasFeriado: false,
      hasProvao: false,
      hasReposicao: false,
      isLetivo: true,
      statusLabel: 'Dia Letivo Regular',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      bgCellClass: ''
    };
  }

  const parts = ymd.split('-');
  const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const dayOfWeek = dt.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Domingo ou Sábado

  // Encontrar eventos associados a este dia
  const eventsOnDay = (eventsList || []).filter(ev => {
    const start = ev.dataInicio || ev.data || '';
    const end = ev.dataFim || start;
    return ymd >= start && ymd <= end;
  });

  const feriadoEvent = eventsOnDay.find(ev => {
    const cat = String(ev.categoria || '').toLowerCase();
    return cat.includes('feriado') || cat.includes('facultativo');
  });

  const provaoEvent = eventsOnDay.find(ev => {
    const cat = String(ev.categoria || '').toLowerCase();
    return cat.includes('provão') || cat.includes('provao');
  });

  const reposicaoEvent = eventsOnDay.find(ev => {
    const cat = String(ev.categoria || '').toLowerCase();
    return cat.includes('reposição') || cat.includes('reposicao') || cat.includes('sábado letivo') || cat.includes('sabado letivo');
  });

  const hasFeriado = Boolean(feriadoEvent);
  const hasProvao = Boolean(provaoEvent);
  const hasReposicao = Boolean(reposicaoEvent);

  // Regra Essencial:
  // Feriado/Ponto Facultativo: Tudo para, não tem aula nem ações.
  // Fim de semana (Sábado e Domingo): Não tem aula (mesma coisa que feriado/ponto facultativo), EXCETO se houver reposição!
  // Reposição: Haverá aula presencial seguindo o dia da semana duplicado.
  const isLetivo = (!hasFeriado && !isWeekend) || hasReposicao;

  let statusLabel = 'Dia Letivo Regular';
  let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let bgCellClass = '';

  if (hasFeriado) {
    statusLabel = '🚫 Feriado / Ponto Facultativo (Sem Aulas)';
    badgeClass = 'bg-rose-100 text-rose-900 border-rose-300 font-black';
    bgCellClass = 'bg-rose-50/40 ring-1 ring-rose-200';
  } else if (hasReposicao) {
    const diaDup = reposicaoEvent?.diaDuplicado || 'Segunda-feira';
    statusLabel = `🎒 Sábado Letivo com Aula (Horário de ${diaDup})`;
    badgeClass = 'bg-emerald-100 text-emerald-950 border-emerald-400 font-black';
    bgCellClass = 'bg-emerald-50/50 ring-1 ring-emerald-300';
  } else if (hasProvao) {
    statusLabel = '💻 Provão Paulista: Aulas Online (Prova Presencial p/ Turmas)';
    badgeClass = 'bg-purple-100 text-purple-900 border-purple-300 font-black';
    bgCellClass = 'bg-purple-50/40 ring-1 ring-purple-200';
  } else if (isWeekend) {
    statusLabel = dayOfWeek === 0 ? 'Domingo (Sem Aulas / Suspenso)' : 'Sábado (Sem Aulas / Suspenso)';
    badgeClass = 'bg-slate-200 text-slate-600 border-slate-300';
    bgCellClass = 'bg-slate-50/70 text-slate-500';
  }

  return {
    ymd,
    dayOfWeek,
    isWeekend,
    hasFeriado,
    hasProvao,
    hasReposicao,
    isLetivo,
    statusLabel,
    badgeClass,
    bgCellClass,
    feriadoEvent,
    reposicaoEvent,
    provaoEvent
  };
}
