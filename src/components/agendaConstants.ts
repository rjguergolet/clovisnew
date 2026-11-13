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
  dotColorClass: string;
  descricao: string;
  isSpecial?: 'feriado' | 'provao' | 'reposicao';
}

const SOFT_ROSE =
  'bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500';
const SOFT_ROSE_CARD =
  'bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500 hover:bg-rose-100/80';

const SOFT_PURPLE =
  'bg-purple-50/90 text-purple-900 border border-purple-200/60 border-l-4 border-l-purple-600';
const SOFT_PURPLE_CARD =
  'bg-purple-50/90 text-purple-900 border border-purple-200/60 border-l-4 border-l-purple-600 hover:bg-purple-100/80';

const SOFT_EMERALD =
  'bg-emerald-50/90 text-emerald-900 border border-emerald-200/60 border-l-4 border-l-emerald-500';
const SOFT_EMERALD_CARD =
  'bg-emerald-50/90 text-emerald-900 border border-emerald-200/60 border-l-4 border-l-emerald-500 hover:bg-emerald-100/80';

const SOFT_AMBER =
  'bg-amber-50/90 text-amber-900 border border-amber-200/60 border-l-4 border-l-amber-500';
const SOFT_AMBER_CARD =
  'bg-amber-50/90 text-amber-900 border border-amber-200/60 border-l-4 border-l-amber-500 hover:bg-amber-100/80';

const SOFT_INDIGO =
  'bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600';
const SOFT_INDIGO_CARD =
  'bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600 hover:bg-indigo-100/70';

export const CATEGORIAS_AGENDA: CategoriaAgendaDef[] = [
  // --- FUNÇÕES ESPECIAIS ESSENCIAIS ---
  {
    id: 'feriado_ponto_facultativo',
    nome: 'Feriado / Ponto Facultativo',
    grupo: 'especial',
    icone: 'fa-solid fa-umbrella-beach',
    badgeClass: `${SOFT_ROSE} font-medium`,
    borderClass: 'border-rose-200/60',
    cardClass: `${SOFT_ROSE_CARD} font-medium`,
    dotColorClass: 'bg-rose-500',
    descricao: 'Dia não letivo. As atividades escolares, aulas e ações da escola ficam totalmente paralisadas.',
    isSpecial: 'feriado'
  },
  {
    id: 'recesso_sem_aulas',
    nome: 'Recesso Escolar / Sem Aulas',
    grupo: 'especial',
    icone: 'fa-solid fa-calendar-xmark',
    badgeClass: `${SOFT_ROSE} font-medium`,
    borderClass: 'border-rose-200/60',
    cardClass: `${SOFT_ROSE_CARD} font-medium`,
    dotColorClass: 'bg-rose-500',
    descricao: 'Recesso escolar, férias ou suspensão de aulas. Integra-se à Presença Diária para bloquear chamadas neste dia.',
    isSpecial: 'feriado'
  },
  {
    id: 'provao_paulista',
    nome: 'Provão Paulista',
    grupo: 'especial',
    icone: 'fa-solid fa-graduation-cap',
    badgeClass: `${SOFT_PURPLE} font-medium`,
    borderClass: 'border-purple-200/60',
    cardClass: `${SOFT_PURPLE_CARD} font-medium`,
    dotColorClass: 'bg-purple-600',
    descricao: 'As aulas regulares ocorrem em formato ONLINE/remoto, exceto para as turmas selecionadas que farão a prova presencialmente.',
    isSpecial: 'provao'
  },
  {
    id: 'reposicao_aulas',
    nome: 'Reposição de Aulas (Sábado Letivo)',
    grupo: 'especial',
    icone: 'fa-solid fa-arrows-rotate',
    badgeClass: `${SOFT_EMERALD} font-medium`,
    borderClass: 'border-emerald-200/60',
    cardClass: `${SOFT_EMERALD_CARD} font-medium`,
    dotColorClass: 'bg-emerald-500',
    descricao: 'Haverá aula presencial regular. Duplica e segue a grade horária de um dia útil da semana definido.',
    isSpecial: 'reposicao'
  },

  // --- AVALIAÇÕES E RENDIMENTO ESCOLAR ---
  {
    id: 'avaliacoes_provas',
    nome: 'Avaliações & Provas',
    grupo: 'avaliacao',
    icone: 'fa-solid fa-file-signature',
    badgeClass: `${SOFT_AMBER} font-medium`,
    borderClass: 'border-amber-200/60',
    cardClass: `${SOFT_AMBER_CARD} font-medium`,
    dotColorClass: 'bg-amber-500',
    descricao: 'Provas bimestrais, SAEB, Prova Paulista, Simulados ENEM e avaliações diagnósticas.'
  },
  {
    id: 'conselho_classe',
    nome: 'Conselho de Classe & Série',
    grupo: 'avaliacao',
    icone: 'fa-solid fa-users-rectangle',
    badgeClass: `${SOFT_AMBER} font-medium`,
    borderClass: 'border-amber-200/60',
    cardClass: `${SOFT_AMBER_CARD} font-medium`,
    dotColorClass: 'bg-amber-500',
    descricao: 'Conselho participativo bimestral, análise de rendimento por série e busca ativa.'
  },

  // --- PASSEIOS E ATIVIDADES EXTERNAS ---
  {
    id: 'passeios_saidas',
    nome: 'Passeios & Saídas Pedagógicas',
    grupo: 'passeio',
    icone: 'fa-solid fa-bus',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Visitas culturais, museus, bienais, teatros, excursões e feiras de profissões.'
  },

  // --- PESQUISAS, CIÊNCIA E MOSTRAS ---
  {
    id: 'pesquisas_feiras',
    nome: 'Pesquisas & Feiras Científicas',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-flask-vial',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Feira de Ciências, mostras científicas, projetos de robótica e pesquisa de campo escolar.'
  },

  // --- PEDAGÓGICO, ELETIVAS E PROTAGONISMO PEI ---
  {
    id: 'acolhimento_pei',
    nome: 'Acolhimento PEI',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-hands-holding-child',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Acolhimento inicial de início de semestre, protagonismo juvenil e acolhimento de novos alunos.'
  },
  {
    id: 'acao_pedagogica',
    nome: 'Ação Pedagógica & Eletivas',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-book-open-reader',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Culminância das eletivas, projetos dos clubes juvenis, nivelamento e recomposição de aprendizagem.'
  },
  {
    id: 'tutoria_duvidas',
    nome: 'Plantão de Dúvidas & Tutoria',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-user-graduate',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Sessões de tutoria individual, acompanhamento pedagógico e grupos de estudo.'
  },
  {
    id: 'formacao_continuada',
    nome: 'Formação Continuada / ATPC',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-chalkboard-user',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'ATPC geral e por área do conhecimento, estudo de caso e alinhamentos pedagógicos.'
  },
  {
    id: 'eventos_civicos_culturais',
    nome: 'Eventos Cívicos & Culturais',
    grupo: 'pedagogico',
    icone: 'fa-solid fa-masks-theater',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Festa da Primavera/Junina, Jogos Escolares, Semana da Consciência Negra e atos cívicos.'
  },

  // --- ADMINISTRATIVO, GESTÃO E PAIS ---
  {
    id: 'administrativo_secretaria',
    nome: 'Administrativo & Secretaria',
    grupo: 'administrativo',
    icone: 'fa-solid fa-building-columns',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Prazos de digitação no SED, matrículas, transferências, censo escolar e prestação de contas.'
  },
  {
    id: 'reuniao_pais',
    nome: 'Reunião de Pais & Mestres',
    grupo: 'administrativo',
    icone: 'fa-solid fa-users',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Entrega de boletins, plantão com responsáveis e alinhamento do projeto de vida.'
  },
  {
    id: 'planejamento_escolar',
    nome: 'Planejamento Escolar',
    grupo: 'administrativo',
    icone: 'fa-solid fa-compass-drafting',
    badgeClass: `${SOFT_AMBER} font-medium`,
    borderClass: 'border-amber-200/60',
    cardClass: `${SOFT_AMBER_CARD} font-medium`,
    dotColorClass: 'bg-amber-500',
    descricao: 'Semana de Planejamento e Replanejamento semestral da equipe escolar.'
  },
  {
    id: 'reuniao_gestao_apm',
    nome: 'Reunião da Gestão & APM',
    grupo: 'administrativo',
    icone: 'fa-solid fa-handshake',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Conselho de Escola, APM, reuniões de equipe gestora e alinhamentos de direção.'
  },
  {
    id: 'manutencao_predial',
    nome: 'Manutenção & Infraestrutura',
    grupo: 'administrativo',
    icone: 'fa-solid fa-wrench',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
    descricao: 'Manutenção predial, pintura, reformas, limpeza e vistoria de salas e instalações.'
  },
  {
    id: 'evento_geral',
    nome: 'Evento Escolar Geral',
    grupo: 'geral',
    icone: 'fa-solid fa-calendar-check',
    badgeClass: `${SOFT_INDIGO} font-medium`,
    borderClass: 'border-indigo-200/50',
    cardClass: `${SOFT_INDIGO_CARD} font-medium`,
    dotColorClass: 'bg-indigo-600',
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
    return CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('recesso') || norm.includes('sem aula') || norm.includes('suspens') || norm.includes('férias') || norm.includes('ferias')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'recesso_sem_aulas') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('provão') || norm.includes('provao') || norm.includes('provão paulista')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'provao_paulista') || CATEGORIAS_AGENDA[2];
  }
  if (norm.includes('reposição') || norm.includes('reposicao') || norm.includes('sábado letivo') || norm.includes('sabado letivo')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'reposicao_aulas') || CATEGORIAS_AGENDA[3];
  }
  if (norm.includes('passeio') || norm.includes('saída') || norm.includes('saida') || norm.includes('visita') || norm.includes('excurs')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'passeios_saidas') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('pesquisa') || norm.includes('feira') || norm.includes('mostra')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'pesquisas_feiras') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('conselho')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'conselho_classe') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('prova') || norm.includes('avaliação') || norm.includes('avaliacao') || norm.includes('saeb')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'avaliacoes_provas') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('planejamento')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'planejamento_escolar') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('acolhimento')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'acolhimento_pei') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('eletiva') || norm.includes('ação pedag') || norm.includes('acao pedag')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'acao_pedagogica') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('tutoria') || norm.includes('plantão') || norm.includes('plantao')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'tutoria_duvidas') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('atpc') || norm.includes('formação') || norm.includes('formacao')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'formacao_continuada') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('cívico') || norm.includes('civico') || norm.includes('cultural') || norm.includes('culturais')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'eventos_civicos_culturais') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('pais')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'reuniao_pais') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('apm') || norm.includes('gestão') || norm.includes('gestao')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'reuniao_gestao_apm') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('manutenção') || norm.includes('manutencao') || norm.includes('infraestrutura')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'manutencao_predial') || CATEGORIAS_AGENDA[0];
  }
  if (norm.includes('administrativo') || norm.includes('secretaria')) {
    return CATEGORIAS_AGENDA.find(c => c.id === 'administrativo_secretaria') || CATEGORIAS_AGENDA[0];
  }

  const found = CATEGORIAS_AGENDA.find(c => c.nome.toLowerCase() === norm);
  return found || CATEGORIAS_AGENDA[CATEGORIAS_AGENDA.length - 1];
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
      badgeClass: SOFT_EMERALD,
      bgCellClass: ''
    };
  }

  const parts = ymd.split('-');
  const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const dayOfWeek = dt.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const eventsOnDay = (eventsList || []).filter(ev => {
    const start = ev.dataInicio || ev.data || '';
    const end = ev.dataFim || start;
    return Boolean(start) && ymd >= start && ymd <= end;
  });

  const feriadoEvent = eventsOnDay.find(ev => {
    const cat = String(ev.categoria || '').toLowerCase();
    const tit = String(ev.titulo || '').toLowerCase();
    return (
      cat.includes('feriado') ||
      cat.includes('facultativo') ||
      cat.includes('recesso') ||
      cat.includes('sem aula') ||
      cat.includes('suspens') ||
      cat.includes('férias') ||
      cat.includes('ferias') ||
      tit.includes('recesso') ||
      tit.includes('sem aula')
    );
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

  const isLetivo = (!hasFeriado && !isWeekend) || hasReposicao;

  let statusLabel = 'Dia Letivo Regular';
  let badgeClass = 'bg-slate-100/80 text-slate-700 border border-slate-200/80';
  let bgCellClass = '';

  if (hasFeriado) {
    const catF = String(feriadoEvent?.categoria || '').toLowerCase();
    statusLabel = (catF.includes('recesso') || catF.includes('sem aula') || catF.includes('férias') || catF.includes('ferias'))
      ? `Sem Aulas: ${feriadoEvent?.titulo || feriadoEvent?.categoria || 'Recesso Escolar'}`
      : `Feriado / Ponto Facultativo: ${feriadoEvent?.titulo || 'Sem Aulas'}`;
    badgeClass = `${SOFT_ROSE} font-medium`;
    bgCellClass = 'bg-rose-50/30';
  } else if (hasReposicao) {
    const diaDup = reposicaoEvent?.diaDuplicado || 'Segunda-feira';
    statusLabel = `Sábado Letivo com Aula (Horário de ${diaDup})`;
    badgeClass = `${SOFT_EMERALD} font-medium`;
    bgCellClass = 'bg-emerald-50/35';
  } else if (hasProvao) {
    statusLabel = 'Provão Paulista: Aulas Online (Prova Presencial p/ Turmas)';
    badgeClass = `${SOFT_PURPLE} font-medium`;
    bgCellClass = 'bg-purple-50/30';
  } else if (isWeekend) {
    statusLabel = dayOfWeek === 0 ? 'Domingo (Sem Aulas)' : 'Sábado (Sem Aulas)';
    badgeClass = 'bg-slate-100/80 text-slate-600 border border-slate-200/80';
    bgCellClass = 'bg-slate-50/60 text-slate-400';
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
