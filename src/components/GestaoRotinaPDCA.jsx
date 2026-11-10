import React, { useState, useEffect } from 'react';
import MascoteSaraState from './MascoteSaraState';
import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  onSnapshot
} from '../lib/database';

/**
 * Componente Refatorado: Minhas Tarefas (Gestão de Rotinas & PDCA da Equipe Gestora)
 * 
 * Funcionalidades Principais:
 * 1. Visão Global da Direção (Filtro Master): Se userRole === 'DIRETOR', visualiza TODAS as tarefas cadastradas.
 * 2. Filtro Restrito por Perfil: Para VICE_DIRETOR e CGPG, exibe apenas tarefas de 'TODA A EQUIPE' ou atribuídas ao seu próprio cargo.
 * 3. Checklist Individual por Usuário (array concluidaPor): O estado de conclusão é gravado por e-mail do usuário.
 * 4. Renovação Diária de Tarefas: Se ultimaDataConclusao < hoje (YYYY-MM-DD), a tarefa diária reaparece como PENDENTE.
 * 5. Botão Manual "Renovar Ciclo Diário" para Direção/Coordenação resetar todas as tarefas diárias.
 */

export function getNormalizedFreqKey(task) {
  if (!task) return 'Ação Pontual (Prazo Fixo)';
  const freq = typeof task === 'string' ? task.trim() : String(task.frequencia || '').trim();
  const fLower = freq.toLowerCase();

  if (fLower.includes('diár') || fLower.includes('diar')) return 'Diária';
  if (fLower.includes('semanal')) return 'Semanal';
  if (fLower.includes('mensal')) return 'Mensal';
  if (fLower.includes('bimestral')) return 'Bimestral';
  if (fLower.includes('semestral')) return 'Semestral';
  if (fLower.includes('anual')) return 'Anual';
  if (fLower.includes('pontual') || fLower.includes('prazo')) return 'Ação Pontual (Prazo Fixo)';

  return freq || 'Ação Pontual (Prazo Fixo)';
}

const FREQUENCIAS = [
  {
    key: 'Diária',
    title: 'Rotina Diária',
    label: 'Diárias',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-extrabold',
    headerBg: 'bg-emerald-900 text-white',
    subBg: 'bg-emerald-50 border-emerald-200 text-emerald-950',
    icon: 'fa-sun',
    accentColor: 'text-emerald-600'
  },
  {
    key: 'Semanal',
    title: 'Rotina Semanal',
    label: 'Semanais',
    badge: 'bg-sky-100 text-sky-800 border-sky-300 font-extrabold',
    headerBg: 'bg-sky-900 text-white',
    subBg: 'bg-sky-50 border-sky-200 text-sky-950',
    icon: 'fa-calendar-week',
    accentColor: 'text-sky-600'
  },
  {
    key: 'Mensal',
    title: 'Rotina Mensal',
    label: 'Mensais',
    badge: 'bg-amber-100 text-amber-800 border-amber-300 font-extrabold',
    headerBg: 'bg-amber-900 text-white',
    subBg: 'bg-amber-50/80 border-amber-200 text-amber-950',
    icon: 'fa-calendar-days',
    accentColor: 'text-amber-600'
  },
  {
    key: 'Bimestral',
    title: 'Rotina Bimestral',
    label: 'Bimestrais',
    badge: 'bg-purple-100 text-purple-800 border-purple-300 font-extrabold',
    headerBg: 'bg-purple-900 text-white',
    subBg: 'bg-purple-50 border-purple-200 text-purple-950',
    icon: 'fa-layer-group',
    accentColor: 'text-purple-600'
  },
  {
    key: 'Semestral',
    title: 'Rotina Semestral',
    label: 'Semestrais',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-300 font-extrabold',
    headerBg: 'bg-indigo-900 text-white',
    subBg: 'bg-indigo-50 border-indigo-200 text-indigo-950',
    icon: 'fa-graduation-cap',
    accentColor: 'text-indigo-600'
  },
  {
    key: 'Anual',
    title: 'Rotina Anual',
    label: 'Anuais',
    badge: 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold',
    headerBg: 'bg-rose-900 text-white',
    subBg: 'bg-rose-50 border-rose-200 text-rose-950',
    icon: 'fa-flag-checkered',
    accentColor: 'text-rose-600'
  },
  {
    key: 'Ação Pontual (Prazo Fixo)',
    title: 'Ações Pontuais (Prazo Fixo)',
    label: 'Pontuais',
    badge: 'bg-slate-100 text-slate-800 border-slate-300 font-extrabold',
    headerBg: 'bg-slate-900 text-white',
    subBg: 'bg-slate-100 border-slate-200 text-slate-900',
    icon: 'fa-calendar-check',
    accentColor: 'text-slate-700'
  }
];

const hierarquiaVisibilidade = {
  'DIRETOR': ['DIRETOR', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'VICE_DIRETOR': ['VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'VICE-DIRETOR': ['VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'CGPG': ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'CGPCG': ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'PAAC': ['PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'PROFESSOR': ['PROFESSOR', 'TODA A EQUIPE']
};

const OPCOES_ATRIBUICAO = [
  'TODA A EQUIPE',
  'DIRETOR',
  'VICE_DIRETOR',
  'CGPG',
  'PAAC',
  'PROFESSOR'
];

/**
 * Helper para obter o e-mail do usuário logado na sessão
 */
export function getCurrentUserEmail() {
  if (typeof window.obterIdentificacaoUsuarioCompleta === 'function') {
    const info = window.obterIdentificacaoUsuarioCompleta();
    if (info && info.email) return info.email.toLowerCase().trim();
  }
  try {
    const usuarioSalvo = localStorage.getItem("usuarioLogado");
    if (usuarioSalvo) {
      const parsed = JSON.parse(usuarioSalvo);
      if (parsed && parsed.email) return parsed.email.toLowerCase().trim();
    }
  } catch (e) {
    // ignore
  }
  if (window.currentUserEmail) return String(window.currentUserEmail).toLowerCase().trim();
  return 'usuario@escola.sp.gov.br';
}

/**
 * Função de Validação de Estado (Motor de Renovação Automática Temporal & Status Unificado)
 * Avalia o status de conclusão de forma unificada para toda a equipe no ciclo vigente.
 */
export function verificarStatus(tarefa, userEmailOverride) {
  if (!tarefa) return false;

  const freq = (tarefa.frequencia || '').trim();
  const isDiaria = freq === 'Diária' || freq === 'Diaria' || freq === 'Rotina Diária';
  const isSemanal = freq === 'Semanal' || freq === 'Rotina Semanal';
  const isPontual = freq === 'Ação Pontual (Prazo Fixo)' || freq === 'Pontual' || freq === 'Ação Pontual';

  const hoje = new Date();
  const year = hoje.getFullYear();
  const month = String(hoje.getMonth() + 1).padStart(2, '0');
  const day = String(hoje.getDate()).padStart(2, '0');
  const hojeStr = `${year}-${month}-${day}`;

  // Início da semana atual (Domingo 00:00:00)
  const startOfWeek = new Date(hoje);
  startOfWeek.setDate(hoje.getDate() - hoje.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  let dataConclusao = null;
  if (tarefa.ultimaConclusao) {
    if (typeof tarefa.ultimaConclusao.toDate === 'function') {
      dataConclusao = tarefa.ultimaConclusao.toDate();
    } else {
      dataConclusao = new Date(tarefa.ultimaConclusao);
    }
  } else if (tarefa.ultimaDataConclusao) {
    dataConclusao = new Date(tarefa.ultimaDataConclusao + 'T00:00:00');
  }

  // 1. RENOVAÇÃO TEMPORAL AUTOMÁTICA DE TAREFAS DIÁRIAS E SEMANAIS
  if (isDiaria) {
    const dtUltima = tarefa.ultimaDataConclusao || (tarefa.ultimaConclusao ? String(tarefa.ultimaConclusao).split('T')[0] : null);
    if (!dtUltima || dtUltima < hojeStr) {
      return false; // Se a data de conclusão for anterior ao dia de hoje, a tarefa reaparece como PENDENTE
    }
  } else if (isSemanal) {
    if (!dataConclusao || isNaN(dataConclusao.getTime()) || dataConclusao < startOfWeek) {
      return false; // Se concluída em semanas anteriores, reaparece como PENDENTE para o novo ciclo semanal
    }
  } else if (!isPontual && dataConclusao && !isNaN(dataConclusao.getTime())) {
    switch (freq) {
      case 'Mensal':
        if (dataConclusao.getFullYear() !== hoje.getFullYear() || dataConclusao.getMonth() !== hoje.getMonth()) return false;
        break;
      case 'Bimestral':
        if (dataConclusao.getFullYear() !== hoje.getFullYear() || Math.floor(dataConclusao.getMonth() / 2) !== Math.floor(hoje.getMonth() / 2)) return false;
        break;
      case 'Semestral':
        if (dataConclusao.getFullYear() !== hoje.getFullYear() || (dataConclusao.getMonth() < 6 ? 1 : 2) !== (hoje.getMonth() < 6 ? 1 : 2)) return false;
        break;
      case 'Anual':
        if (dataConclusao.getFullYear() !== hoje.getFullYear()) return false;
        break;
    }
  }

  // 2. CONCLUSÃO UNIFICADA DA TAREFA
  // Se a tarefa foi concluída no ciclo atual por qualquer membro/atribuição, ela é tratada como CONCLUÍDA unificadamente para todos.
  const isConcluidoGlobal = tarefa.concluido === true || tarefa.concluido === 'true';
  const hasConcluidaPor = Array.isArray(tarefa.concluidaPor) && tarefa.concluidaPor.length > 0;
  const hasConcluidoPor = Array.isArray(tarefa.concluidoPor) && tarefa.concluidoPor.length > 0;

  return isConcluidoGlobal || hasConcluidaPor || hasConcluidoPor;
}

/**
 * Função Auxiliar: Retorna a quantidade de membros da equipe que concluíram a tarefa no ciclo atual
 */
export function getCountConcluidos(task) {
  if (!task) return 0;
  return verificarStatus(task) ? 1 : 0;
}

/**
 * Função Auxiliar: Retorna lista com os nomes de quem concluiu a tarefa no ciclo atual
 */
export function getQuemConcluiu(task, listaUsuariosEquipe = []) {
  if (!task) return [];
  const freq = (task.frequencia || '').trim();
  const isDiaria = freq === 'Diária' || freq === 'Diaria' || freq === 'Rotina Diária';
  const isSemanal = freq === 'Semanal' || freq === 'Rotina Semanal';

  const hoje = new Date();
  const year = hoje.getFullYear();
  const month = String(hoje.getMonth() + 1).padStart(2, '0');
  const day = String(hoje.getDate()).padStart(2, '0');
  const hojeStr = `${year}-${month}-${day}`;

  const startOfWeek = new Date(hoje);
  startOfWeek.setDate(hoje.getDate() - hoje.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  let dataConclusao = null;
  if (task.ultimaConclusao) {
    if (typeof task.ultimaConclusao.toDate === 'function') {
      dataConclusao = task.ultimaConclusao.toDate();
    } else {
      dataConclusao = new Date(task.ultimaConclusao);
    }
  } else if (task.ultimaDataConclusao) {
    dataConclusao = new Date(task.ultimaDataConclusao + 'T00:00:00');
  }

  if (isDiaria) {
    const dtUltima = task.ultimaDataConclusao || (task.ultimaConclusao ? String(task.ultimaConclusao).split('T')[0] : null);
    if (!dtUltima || dtUltima < hojeStr) {
      return [];
    }
  } else if (isSemanal) {
    if (!dataConclusao || isNaN(dataConclusao.getTime()) || dataConclusao < startOfWeek) {
      return [];
    }
  }

  const rawList = Array.isArray(task.concluidaPor) ? task.concluidaPor : (Array.isArray(task.concluidoPor) ? task.concluidoPor : []);
  const nomes = [];

  if (rawList.length > 0) {
    rawList.forEach(item => {
      const itemStr = String(item).trim();
      if (!itemStr) return;
      const itemLower = itemStr.toLowerCase();

      const userFound = Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.find(u =>
        (u.email && u.email.toLowerCase().trim() === itemLower) ||
        (u.nome && u.nome.toLowerCase().trim() === itemLower)
      );

      if (userFound && userFound.nome) {
        if (!nomes.includes(userFound.nome)) nomes.push(userFound.nome);
      } else {
        let display = itemStr;
        if (display.includes('@')) {
          const part = display.split('@')[0];
          display = part.charAt(0).toUpperCase() + part.slice(1);
        }
        if (!nomes.includes(display)) nomes.push(display);
      }
    });
  }

  if (nomes.length === 0 && (task.concluido === true || task.concluido === 'true')) {
    if (task.atualizadoPor) {
      let display = String(task.atualizadoPor);
      if (display.includes('(') && display.includes(')')) {
        const match = display.match(/\(([^)]+)\)/);
        if (match && match[1]) {
          const email = match[1].toLowerCase().trim();
          const u = Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.find(usr => usr.email && usr.email.toLowerCase().trim() === email);
          if (u && u.nome) display = u.nome;
          else {
            const part = match[1].split('@')[0];
            display = part.charAt(0).toUpperCase() + part.slice(1);
          }
        }
      }
      nomes.push(display);
    } else {
      nomes.push("Concluída");
    }
  }

  return nomes;
}

// Formatar data 'YYYY-MM-DD' em 'DD/MM/YYYY'
const formatarData = (dataStr) => {
  if (!dataStr) return '';
  try {
    const parts = String(dataStr).split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return new Date(dataStr).toLocaleDateString('pt-BR');
  } catch {
    return dataStr;
  }
};

/**
 * Utilitário para interpretar URLs no texto de descrição das tarefas
 * e transformar automaticamente em links clicáveis estilizados que abrem em nova aba.
 */
export function renderTextoComLinks(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const rawParts = texto.split(urlRegex);

  return rawParts.map((part, index) => {
    if (!part) return null;
    if (part.match(/^(https?:\/\/|www\.)/i)) {
      let cleanUrl = part.replace(/[.,;)]+$/, '');
      let trailing = part.slice(cleanUrl.length);
      let href = cleanUrl.toLowerCase().startsWith('www.') ? `https://${cleanUrl}` : cleanUrl;

      return (
        <React.Fragment key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-blue-600 hover:text-blue-800 underline font-bold transition-colors inline-flex items-center gap-1 mx-0.5 break-all cursor-pointer bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200 shadow-2xs"
            title={`Abrir em nova aba: ${href}`}
          >
            <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-blue-500"></i>
            <span>{cleanUrl}</span>
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

/**
 * Definições formais dos Níveis de Tarefa (Cargos / Atribuições da Equipe Escolar)
 */
export const NIVEIS_DEFINICOES = [
  {
    key: 'TODA A EQUIPE',
    label: 'Toda a Equipe',
    title: 'Nível: Toda a Equipe Escolar',
    description: 'Rotinas operacionais e metas de engajamento compartilhadas por todos os profissionais da escola',
    icon: 'fa-users-gear',
    badge: 'bg-blue-100 text-blue-900 border-blue-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-blue-500 text-white',
    accentColor: 'text-blue-400'
  },
  {
    key: 'DIRETOR',
    label: 'Direção Escolar',
    title: 'Nível: Direção Escolar',
    description: 'Acompanhamento de diretrizes institucionais, gestão financeira, conselho escolar e articulação comunitária',
    icon: 'fa-user-tie',
    badge: 'bg-purple-100 text-purple-900 border-purple-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-purple-500 text-white',
    accentColor: 'text-purple-400'
  },
  {
    key: 'VICE_DIRETOR',
    label: 'Vice-Direção',
    title: 'Nível: Vice-Direção',
    description: 'Busca ativa escolar, registros de ocorrência, mediação de conflitos, merenda e infraestrutura',
    icon: 'fa-user-shield',
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-amber-500 text-white',
    accentColor: 'text-amber-400'
  },
  {
    key: 'CGPG',
    label: 'Coordenação (CGPG)',
    title: 'Nível: Coordenação Pedagógica (CGPG)',
    description: 'Monitoramento dos Guias de Aprendizagem, observação de sala de aula, ATPCs e indicadores pedagógicos',
    icon: 'fa-user-graduate',
    badge: 'bg-emerald-100 text-emerald-900 border-emerald-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-emerald-500 text-white',
    accentColor: 'text-emerald-400'
  },
  {
    key: 'PAAC',
    label: 'PAAC (Apoio Currículo)',
    title: 'Nível: PAAC (Apoio ao Currículo)',
    description: 'Projetos de nivelamento, acompanhamento de aprendizagem adaptativa e apoio aos professores',
    icon: 'fa-user-pen',
    badge: 'bg-cyan-100 text-cyan-900 border-cyan-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-cyan-500 text-white',
    accentColor: 'text-cyan-400'
  },
  {
    key: 'PROFESSOR',
    label: 'Professores',
    title: 'Nível: Corpo Docente (Professores)',
    description: 'Registros diários de classe, planos de aula, alinhamento de eletivas, tutoria e rotinas de sala de aula',
    icon: 'fa-chalkboard-user',
    badge: 'bg-indigo-100 text-indigo-900 border-indigo-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-indigo-500 text-white',
    accentColor: 'text-indigo-400'
  },
  {
    key: 'INDIVIDUAL',
    label: 'Atribuições Individuais',
    title: 'Nível: Atribuições Individuais / Por Usuário',
    description: 'Tarefas dirigidas especificamente a membros individuais da equipe escolar',
    icon: 'fa-user-check',
    badge: 'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200',
    headerBg: 'bg-slate-900 border-l-4 border-l-fuchsia-500 text-white',
    accentColor: 'text-fuchsia-400'
  }
];

export function getNivelKey(task, listaUsuariosEquipe = []) {
  if (!task) return 'TODA A EQUIPE';
  const target = String(task.atribuidoA || task.atribuirA || '').toUpperCase().trim();
  if (!target) return 'TODA A EQUIPE';
  if (target.includes('DIRETOR') && !target.includes('VICE')) return 'DIRETOR';
  if (target.includes('VICE')) return 'VICE_DIRETOR';
  if (target.includes('CGPG') || target.includes('CGPCG') || target.includes('COORDENA')) return 'CGPG';
  if (target.includes('PAAC')) return 'PAAC';
  if (target.includes('PROFESSOR') && !target.includes('PAAC')) return 'PROFESSOR';
  if (target.includes('EQUIPE') || target === 'TODA A EQUIPE') return 'TODA A EQUIPE';

  if (Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.length > 0) {
    const usr = listaUsuariosEquipe.find(u => {
      const uNome = (u.nome || '').toUpperCase().trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      return uNome && (uNome === target || target.includes(uNome) || uNome.includes(target) || (uEmail && target.toLowerCase().includes(uEmail)));
    });
    if (usr) {
      const uNivel = String(usr.nivel || usr.cargo || '').toUpperCase().trim();
      if (uNivel.includes('DIRETOR') && !uNivel.includes('VICE')) return 'DIRETOR';
      if (uNivel.includes('VICE')) return 'VICE_DIRETOR';
      if (uNivel.includes('CGPG') || uNivel.includes('CGPCG') || uNivel.includes('COORDENA')) return 'CGPG';
      if (uNivel.includes('PAAC')) return 'PAAC';
      if (uNivel.includes('PROFESSOR')) return 'PROFESSOR';
    }
  }

  return 'INDIVIDUAL';
}

export default function GestaoRotinaPDCA() {
  const [userRole, setUserRole] = useState('DIRETOR');
  const [tarefas, setTarefas] = useState(() => (Array.isArray(window.tasksCache) ? window.tasksCache : []));
  const [loading, setLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  // Estados de Filtro
  const [searchTerm, setSearchTerm] = useState('');
  const [statusTab, setStatusTab] = useState('PENDENTES'); // Padrão: 'PENDENTES' ('TODAS', 'PENDENTES', 'CONCLUIDAS')
  const [selectedFreq, setSelectedFreq] = useState('');
  const [selectedNivel, setSelectedNivel] = useState('TODOS'); // Padrão: 'TODOS' ('TODOS', 'DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE')
  const [filtroEscopo, setFiltroEscopo] = useState('MINHAS'); // Padrão: 'MINHAS' ('MINHAS' | 'TODAS_ACESSO')

  // Estados de Layout / UX (Accordion de Frequência & Ver Mais Descrição)
  const [collapsedFreqs, setCollapsedFreqs] = useState({});
  const [expandedDescTasks, setExpandedDescTasks] = useState({});

  const toggleFreqCollapse = (key) => {
    setCollapsedFreqs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAllFreqs = () => setCollapsedFreqs({});
  const collapseAllFreqs = () => {
    const allKeys = FREQUENCIAS.filter((f) => !isPontualFreq(f.key)).reduce(
      (acc, f) => ({ ...acc, [f.key]: true }),
      {}
    );
    setCollapsedFreqs(allKeys);
  };

  const toggleTaskDesc = (taskId) => {
    setExpandedDescTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  // Estado do Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [formData, setFormData] = useState({
    titulo: '',
    descricao: '',
    frequencia: 'Diária',
    atribuirA: 'TODA A EQUIPE',
    dataLimite: ''
  });
  const [saving, setSaving] = useState(false);
  const [listaUsuariosEquipe, setListaUsuariosEquipe] = useState([]);

  // Estado do Modal de Criar Tarefas em Massa (Exclusivo CGPG, Vice e Direção)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkFormData, setBulkFormData] = useState({
    titulo: '',
    descricao: '',
    frequencia: 'Diária',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: '',
    dataLimite: ''
  });
  const [selectedBulkTargets, setSelectedBulkTargets] = useState([]);
  const [customBulkInput, setCustomBulkInput] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState('');

  // Carregar lista de usuários da equipe cadastrados no Firestore
  useEffect(() => {
    const carregarUsuarios = async () => {
      try {
        const querySnap = await getDocs(collection(db, "usuarios"));
        const list = [];
        querySnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && d.nome) {
            list.push({
              id: docSnap.id,
              nome: String(d.nome).trim(),
              nivel: d.nivel || d.cargo || 'Profissional',
              email: d.email || ''
            });
          }
        });
        list.sort((a, b) => a.nome.localeCompare(b.nome));
        if (list.length > 0) {
          setListaUsuariosEquipe(list);
        }
      } catch (err) {
        console.warn("Erro ao carregar lista de usuários da equipe para tarefas:", err);
      }
    };
    carregarUsuarios();
  }, []);

  // 1. Monitorar perfil do usuário logado
  useEffect(() => {
    const updateRole = () => {
      const role = typeof window.obterRoleAtual === 'function'
        ? window.obterRoleAtual()
        : (window.currentUserRole || 'PROFESSOR');
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

  const roleUpper = String(userRole || 'PROFESSOR').toUpperCase().replace(/-/g, '_');
  const isAuthorized = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC', 'PROFESSOR', 'PROFESSOR_PAAC'].some(r => roleUpper.includes(r) || roleUpper === r);
  const isSomenteLeitura = roleUpper.includes('PROFESSOR');

  // 2. Carregamento em Tempo Real de tarefas via onSnapshot (Ativo enquanto a aba estiver aberta)
  useEffect(() => {
    if (!isAuthorized) return;
    setLoading(true);

    // Renderização imediata se já tivermos em cache
    if (Array.isArray(window.tasksCache) && window.tasksCache.length > 0) {
      setTarefas(window.tasksCache);
      setLoading(false);
    }

    const colRef = collection(db, 'rotina_equipe');

    // Conecta o listener em tempo real exclusivamente enquanto o componente de Tarefas estiver montado
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const lista = [];
      snapshot.forEach((docSnap) => {
        lista.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Se a coleção estiver vazia e não for do cache, semear dados iniciais
      if (lista.length === 0 && (!snapshot.metadata || snapshot.metadata.fromCache === false)) {
        seedInitialTasks();
        return;
      }

      if (lista.length > 0) {
        window.tasksCache = lista;
        setTarefas(lista);
      }
      setLoading(false);
      setIsRealtimeConnected(true);
    }, (err) => {
      console.warn("Aviso no listener em tempo real de rotina_equipe:", err);
      setIsRealtimeConnected(false);
      setLoading(false);
      if (Array.isArray(window.tasksCache) && window.tasksCache.length > 0) {
        setTarefas(window.tasksCache);
      }
    });

    // Cleanup: Desconecta o listener assim que a aba for trocada ou fechada (Economia de Leituras)
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [isAuthorized]);

  const carregarTarefas = async (forceServer = false) => {
    if (!isAuthorized) return;
    setLoading(true);
    try {
      const colRef = collection(db, 'rotina_equipe');
      const serverSnap = await getDocs(colRef);
      const lista = [];
      serverSnap.forEach((docSnap) => {
        lista.push({ id: docSnap.id, ...docSnap.data() });
      });
      if (lista.length > 0) {
        window.tasksCache = lista;
        setTarefas(lista);
      }
      setIsRealtimeConnected(true);
    } catch (e) {
      console.warn("Aviso ao recarregar tarefas manualmente:", e);
    } finally {
      setLoading(false);
    }
  };

  // Populamento inicial de tarefas para demonstração
  const seedInitialTasks = async () => {
    const seedData = [
      {
        titulo: 'Verificar Frequência e Alunos Faltosos na Busca Ativa',
        descricao: 'Acompanhar dados do dia e acionar agentes para contato telefônico ou visita.',
        frequencia: 'Diária',
        atribuirA: 'TODA A EQUIPE',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Alinhamento da Coordenação Geral Pedagógica (CGPG)',
        descricao: 'Revisar acompanhamento dos guias de aprendizagem e alinhamento com os CGPCAs.',
        frequencia: 'Semanal',
        atribuirA: 'CGPG',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Apresentação do Plano de Ação Anual da Escola no Conselho',
        descricao: 'Consolidar metas do PEI e publicar no mural institucional.',
        frequencia: 'Ação Pontual (Prazo Fixo)',
        dataLimite: '2026-08-15',
        atribuirA: 'DIRETOR',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Análise de Indicadores de Rendimento e Faltas Consecutivas',
        descricao: 'Consolidar gráficos mensais para reunião com corpo docente e conselho de escola.',
        frequencia: 'Mensal',
        atribuirA: 'DIRETOR',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Reunião de Alinhamento com a Vice-Direção e Agendamentos',
        descricao: 'Verificar zeladoria, merenda escolar e registros de ocorrências disciplinares.',
        frequencia: 'Semanal',
        atribuirA: 'VICE_DIRETOR',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Avaliação Bimestral dos Eixos PEI (Tutoria, Eletivas e Clubes)',
        descricao: 'Monitorar capacidade dos grupos e progresso dos Projetos de Vida dos estudantes.',
        frequencia: 'Bimestral',
        atribuirA: 'TODA A EQUIPE',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      }
    ];

    try {
      const colRef = collection(db, 'rotina_equipe');
      for (const item of seedData) {
        try {
          await addDoc(colRef, item);
        } catch (err) {
          // ignore individual add failure if offline
        }
      }
    } catch (e) {
      console.warn("Aviso ao semear rotina_equipe (modo resiliente local):", e);
    }

    const localSeeded = seedData.map((item, idx) => ({ id: `local-seed-${idx + 1}`, ...item }));
    window.tasksCache = localSeeded;
    setTarefas(localSeeded);
    setLoading(false);
  };

  // 1. Matriz de Hierarquia de Visibilidade de Tarefas (Diretor > Vice > CGPG > PAAC > Professor)
  const cargoBruto = String(userRole || '').toUpperCase().trim();

  const getNormalizedCargo = (raw) => {
    if (!raw) return 'PROFESSOR';
    const str = String(raw).toUpperCase().trim();
    if (str.includes('DIRETOR') && !str.includes('VICE')) return 'DIRETOR';
    if (str.includes('VICE')) return 'VICE_DIRETOR';
    if (str.includes('CGPG') || str.includes('CGPCG') || str.includes('COORDENA')) return 'CGPG';
    if (str === 'PAAC' || str.includes('PAAC')) return 'PAAC';
    if (str.includes('PROFESSOR')) return 'PROFESSOR';
    return str;
  };

  const cargoLogado = getNormalizedCargo(cargoBruto);
  const podeDuplicar = ['DIRETOR', 'VICE_DIRETOR', 'CGPG'].includes(cargoLogado);
  const isProfessor = cargoLogado === 'PROFESSOR';
  const papeisPermitidos = hierarquiaVisibilidade[cargoBruto] || hierarquiaVisibilidade[cargoLogado] || ['TODA A EQUIPE'];

  const isTargetPermitted = (targetRaw) => {
    if (!targetRaw) return true;
    const target = String(targetRaw).toUpperCase().trim();

    // Diretor possui Nível Geral de Acesso Total: enxerga absolutamente TODAS as tarefas de todos os níveis e usuários
    if (cargoLogado === 'DIRETOR') {
      return true;
    }

    // Identificação do Usuário Logado (para verificar atribuições individuais a si mesmo)
    const userEmailLogado = getCurrentUserEmail();
    const userDetails = typeof window.obterIdentificacaoUsuarioCompleta === 'function' ? window.obterIdentificacaoUsuarioCompleta() : null;
    const nomeLogado = (userDetails?.textoCompleto || userDetails?.nome || '').toUpperCase();

    const isAssignedToMe = (nomeLogado && (nomeLogado.includes(target) || target.includes(nomeLogado))) ||
                           (userEmailLogado && target.toLowerCase().includes(userEmailLogado.toLowerCase()));

    // Se a tarefa foi direcionada nominalmente para o próprio usuário logado, ele SEMPRE enxerga
    if (isAssignedToMe) return true;

    // Tarefas atribuídas a "TODA A EQUIPE" são sempre visíveis por todos
    if (target === 'TODA A EQUIPE' || target === 'TODA_EQUIPE' || target === 'EQUIPE GESTORA COMPLETA') {
      return true;
    }

    // Identificar a qual nível de cargo a tarefa foi atribuída
    let targetRole = null;
    if (target.includes('DIRETOR') && !target.includes('VICE')) targetRole = 'DIRETOR';
    else if (target.includes('VICE')) targetRole = 'VICE_DIRETOR';
    else if (target.includes('CGPG') || target.includes('CGPCG') || target.includes('COORDENA')) targetRole = 'CGPG';
    else if (target.includes('PAAC')) targetRole = 'PAAC';
    else if (target.includes('PROFESSOR')) targetRole = 'PROFESSOR';

    // Se for atribuição por nome/email individual de um membro da equipe
    if (!targetRole && Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.length > 0) {
      const targetUserObj = listaUsuariosEquipe.find(u => {
        const uNome = (u.nome || '').toUpperCase().trim();
        const uEmail = (u.email || '').toLowerCase().trim();
        return uNome && (uNome === target || target.includes(uNome) || uNome.includes(target) || (uEmail && target.toLowerCase().includes(uEmail)));
      });
      if (targetUserObj) {
        targetRole = getNormalizedCargo(targetUserObj.nivel || targetUserObj.cargo);
      }
    }

    if (targetRole) {
      return papeisPermitidos.includes(targetRole);
    }

    return false;
  };

  // Filtragem Global de Tarefas
  const tarefasVisiveis = (tarefas || []).filter(task => {
    if (!task) return false;
    const target = String(task?.atribuidoA || task?.atribuirA || '').toUpperCase().trim();
    return isTargetPermitted(target);
  });

  // Função para verificar se a tarefa diz respeito ao usuário específico logado
  const isTaskDizRespeitoAoUsuario = (task) => {
    if (!task) return false;
    const target = String(task?.atribuidoA || task?.atribuirA || '').trim();
    if (!target) return true;

    const targetUpper = target.toUpperCase();

    // 1. Tarefas atribuídas a "TODA A EQUIPE", "TODOS" ou "GERAL" dizem respeito a todos
    if (
      targetUpper === 'TODA A EQUIPE' ||
      targetUpper === 'TODA_EQUIPE' ||
      targetUpper === 'TODOS' ||
      targetUpper === 'GERAL'
    ) {
      return true;
    }

    // 2. Tarefas de "EQUIPE GESTORA" dizem respeito a Diretor, Vice, CGPG e PAAC
    if (targetUpper.includes('GESTORA') || targetUpper.includes('GESTAO')) {
      return ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(cargoLogado);
    }

    // 3. Usuário logado
    const userEmailLogado = getCurrentUserEmail();
    const userDetails = typeof window.obterIdentificacaoUsuarioCompleta === 'function' ? window.obterIdentificacaoUsuarioCompleta() : null;
    const nomeLogado = (userDetails?.textoCompleto || userDetails?.nome || '').toUpperCase().trim();

    // 4. Atribuição nominal direta (por nome ou email)
    if (userEmailLogado && target.toLowerCase().includes(userEmailLogado.toLowerCase())) {
      return true;
    }
    if (nomeLogado) {
      if (nomeLogado === targetUpper || nomeLogado.includes(targetUpper) || targetUpper.includes(nomeLogado)) {
        return true;
      }
      const nomeTokens = nomeLogado.split(' ').filter(t => t.length > 2);
      const matchesTokens = nomeTokens.filter(t => targetUpper.includes(t));
      if (matchesTokens.length >= 2 || (nomeTokens.length === 1 && matchesTokens.length === 1)) {
        return true;
      }
    }

    // 5. Atribuição por Cargo do Usuário Logado
    let targetRole = null;
    if (targetUpper.includes('DIRETOR') && !targetUpper.includes('VICE')) targetRole = 'DIRETOR';
    else if (targetUpper.includes('VICE')) targetRole = 'VICE_DIRETOR';
    else if (targetUpper.includes('CGPG') || targetUpper.includes('CGPCG') || targetUpper.includes('COORDENA')) targetRole = 'CGPG';
    else if (targetUpper.includes('PAAC')) targetRole = 'PAAC';
    else if (targetUpper.includes('PROFESSOR') && !targetUpper.includes('PAAC')) targetRole = 'PROFESSOR';

    if (targetRole && targetRole === cargoLogado) {
      return true;
    }

    // 6. Correspondência com lista de usuários cadastrados
    if (Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.length > 0) {
      const targetUserObj = listaUsuariosEquipe.find(u => {
        const uNome = (u.nome || '').toUpperCase().trim();
        const uEmail = (u.email || '').toLowerCase().trim();
        return uNome && (uNome === targetUpper || targetUpper.includes(uNome) || uNome.includes(targetUpper) || (uEmail && target.toLowerCase().includes(uEmail)));
      });
      if (targetUserObj) {
        const tEmail = (targetUserObj.email || '').toLowerCase().trim();
        const tNome = (targetUserObj.nome || '').toUpperCase().trim();
        if (userEmailLogado && tEmail && userEmailLogado === tEmail) return true;
        if (nomeLogado && tNome && (nomeLogado.includes(tNome) || tNome.includes(nomeLogado))) return true;
      }
    }

    return false;
  };

  // Filtragem por Escopo: 'MINHAS' (padrão) vs 'TODAS_ACESSO'
  const tarefasAposEscopo = (tarefasVisiveis || []).filter(task => {
    if (filtroEscopo === 'MINHAS') {
      return isTaskDizRespeitoAoUsuario(task);
    }
    return true;
  });

  const countMinhasTotal = (tarefasVisiveis || []).filter(t => isTaskDizRespeitoAoUsuario(t)).length;
  const countTodasAcessoTotal = (tarefasVisiveis || []).length;

  // Filtros de Busca, Status e Nível (sem aplicar o filtro de Frequência ainda, para obter contadores exatos)
  const finalFilteredTarefasSemFreq = (tarefasAposEscopo || []).filter(task => {
    if (!task) return false;
    const isDone = verificarStatus(task);

    const matchesSearch =
      (task.titulo || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
      (task.descricao || '').toLowerCase().includes((searchTerm || '').toLowerCase());

    const matchesStatus =
      statusTab === 'TODAS' ? true :
      statusTab === 'PENDENTES' ? !isDone :
      statusTab === 'CONCLUIDAS' ? isDone : true;

    const taskNivel = getNivelKey(task, listaUsuariosEquipe);
    const matchesNivel = selectedNivel === 'TODOS' ? true : taskNivel === selectedNivel;

    return matchesSearch && matchesStatus && matchesNivel;
  });

  // Filtro Final aplicando a Frequência selecionada
  const finalFilteredTarefas = (finalFilteredTarefasSemFreq || []).filter(task => {
    if (!selectedFreq) return true;
    return getNormalizedFreqKey(task) === getNormalizedFreqKey(selectedFreq);
  });

  // Auxiliar para verificar se a frequência é Ação Pontual
  const isPontualFreq = (frequencia) => {
    return getNormalizedFreqKey(frequencia) === 'Ação Pontual (Prazo Fixo)';
  };

  // 1. Ordenação Cronológica Unificada para Exibição no Grid
  const tarefasOrdenadas = [...(finalFilteredTarefas || [])].sort((a, b) => {
    const getTaskTimestamp = (task) => {
      if (!task) return 0;
      const rawDate = task.dataInicio || task.dataLimite || task.prazo || task.data || task.createdAt;
      if (!rawDate) return 0;
      const time = new Date(rawDate).getTime();
      return isNaN(time) ? 0 : time;
    };

    const timeA = getTaskTimestamp(a);
    const timeB = getTaskTimestamp(b);

    if (timeA !== timeB) {
      if (timeA === 0) return 1;
      if (timeB === 0) return -1;
      return timeA - timeB; // Ordem crescente: o que vence primeiro fica no topo
    }

    const aDone = verificarStatus(a);
    const bDone = verificarStatus(b);
    if (aDone !== bDone) return aDone ? 1 : -1;

    return (a?.titulo || '').localeCompare(b?.titulo || '');
  });

  // Agrupamento de Tarefas por Nível com Sub-seções por Frequência/Periodicidade
  const tarefasAgrupadasPorNivel = NIVEIS_DEFINICOES.map((nivelDef) => {
    const items = (tarefasOrdenadas || []).filter((t) => getNivelKey(t, listaUsuariosEquipe) === nivelDef.key);

    // Sub-agrupamento por Frequência/Periodicidade dentro deste Nível
    const subGruposFreq = FREQUENCIAS.map((freqDef) => {
      const fTasks = items.filter((t) => getNormalizedFreqKey(t) === freqDef.key);
      return {
        ...freqDef,
        tasks: fTasks
      };
    }).filter((sub) => sub.tasks.length > 0);

    // Proteção total contra perda de dados: captura tarefas com chaves não mapeadas
    const knownKeys = FREQUENCIAS.map(f => f.key);
    const orphanTasks = items.filter((t) => !knownKeys.includes(getNormalizedFreqKey(t)));
    if (orphanTasks.length > 0) {
      subGruposFreq.push({
        key: 'Outras',
        title: 'Outras Ações e Prazos',
        label: 'Outras',
        badge: 'bg-slate-100 text-slate-800 border-slate-300 font-extrabold',
        headerBg: 'bg-slate-800 text-white',
        subBg: 'bg-slate-50 border-slate-200 text-slate-900',
        icon: 'fa-folder-open',
        accentColor: 'text-slate-600',
        tasks: orphanTasks
      });
    }

    return {
      ...nivelDef,
      tasks: items,
      subGruposFreq
    };
  }).filter((grupo) => grupo.tasks.length > 0);

  const tarefasPontuais = (finalFilteredTarefas || []).filter(t => isPontualFreq(t?.frequencia));

  // Auxiliar para detectar status de atraso da dataLimite/dataInicio em tarefas
  const getStatusAtraso = (task) => {
    if (!task) return null;
    const targetDate = task.dataLimite || task.dataInicio;
    if (!targetDate) return null;
    if (verificarStatus(task)) return null; // Se já concluída, sem alerta

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hojeStr = `${year}-${month}-${day}`;

    const limitStr = String(targetDate).trim();

    if (limitStr < hojeStr) {
      return 'ATRASADO';
    } else if (limitStr === hojeStr) {
      return 'VENCE_HOJE';
    }
    return 'NO_PRAZO';
  };

  // Alternar Checkbox e Atualizar Conclusão Unificada da Tarefa com Atualização Otimista
  const handleToggleConcluido = async (task) => {
    if (isSomenteLeitura || isProfessor) {
      alert("Professores não possuem permissão para marcar tarefas como concluídas.");
      return;
    }
    if (!task || !task.id) return;

    const userEmail = getCurrentUserEmail();
    const isCurrentlyDone = verificarStatus(task);

    const hoje = new Date();
    const year = hoje.getFullYear();
    const month = String(hoje.getMonth() + 1).padStart(2, '0');
    const day = String(hoje.getDate()).padStart(2, '0');
    const hojeStr = `${year}-${month}-${day}`;
    const nowIso = hoje.toISOString();

    let userDetails = null;
    if (typeof window.obterIdentificacaoUsuarioCompleta === 'function') {
      userDetails = window.obterIdentificacaoUsuarioCompleta();
    }
    const nomeUsuario = userDetails?.nome || userDetails?.textoCompleto || userEmail.split('@')[0];

    const patch = isCurrentlyDone ? {
      concluido: false,
      concluidaPor: [],
      concluidoPor: [],
      concluidoPorNome: null,
      ultimaDataConclusao: null,
      ultimaConclusao: null,
      atualizadoEm: nowIso,
      atualizadoPor: `${userRole} (${userEmail})`
    } : {
      concluido: true,
      concluidaPor: [userEmail.toLowerCase().trim()],
      concluidoPor: [userEmail.toLowerCase().trim()],
      concluidoPorNome: nomeUsuario,
      ultimaDataConclusao: hojeStr,
      ultimaConclusao: nowIso,
      atualizadoEm: nowIso,
      atualizadoPor: `${userRole} (${userEmail})`
    };

    // 1. Atualização Otimista no estado local e no window.tasksCache
    const prevList = [...(tarefas || [])];
    const updatedList = prevList.map(t => t.id === task.id ? { ...t, ...patch } : t);
    setTarefas(updatedList);
    window.tasksCache = updatedList;

    try {
      const docRef = doc(db, 'rotina_equipe', task.id);
      await updateDoc(docRef, patch);
    } catch (err) {
      console.error("Erro ao atualizar conclusão unificada da tarefa no Firestore:", err);
      // Reverter estado local em caso de erro
      setTarefas(prevList);
      window.tasksCache = prevList;
    }
  };

  const [renovandoCiclo, setRenovandoCiclo] = useState(false);
  const [renovandoCicloSemanal, setRenovandoCicloSemanal] = useState(false);

  // Botão Manual para Direção/Coordenação: "Renovar Ciclo Diário" com Atualização Otimista
  const handleRenovarCicloDiario = async () => {
    if (!window.confirm("Deseja realmente renovar o ciclo diário?\n\nIsso desmarcará o status de conclusão de TODAS as tarefas da rotina diária para toda a equipe iniciar a nova jornada.")) {
      return;
    }

    setRenovandoCiclo(true);
    try {
      const tarefasDiarias = (tarefas || []).filter(t => {
        const freq = (t?.frequencia || '').trim();
        return freq === 'Diária' || freq === 'Diaria' || freq === 'Rotina Diária';
      });

      if (tarefasDiarias.length === 0) {
        alert("Nenhuma tarefa diária cadastrada encontrada.");
        setRenovandoCiclo(false);
        return;
      }

      const hoje = new Date();
      const year = hoje.getFullYear();
      const month = String(hoje.getMonth() + 1).padStart(2, '0');
      const day = String(hoje.getDate()).padStart(2, '0');
      const hojeStr = `${year}-${month}-${day}`;
      const nowIso = new Date().toISOString();

      const patch = {
        concluidaPor: [],
        concluidoPor: [],
        concluido: false,
        ultimaConclusao: null,
        ultimaDataConclusao: hojeStr,
        atualizadoEm: nowIso,
        atualizadoPor: `${userRole} (${getCurrentUserEmail()} - Renovação Manual de Ciclo Diário)`
      };

      // Atualização Otimista em memória
      const prevList = [...(tarefas || [])];
      const updatedList = prevList.map(t => {
        const freq = (t?.frequencia || '').trim();
        const isDiaria = freq === 'Diária' || freq === 'Diaria' || freq === 'Rotina Diária';
        return isDiaria ? { ...t, ...patch } : t;
      });
      setTarefas(updatedList);
      window.tasksCache = updatedList;

      const batch = writeBatch(db);
      tarefasDiarias.forEach(t => {
        const ref = doc(db, 'rotina_equipe', t.id);
        batch.update(ref, patch);
      });

      await batch.commit();
      alert(`Ciclo diário renovado com sucesso!\n\n${tarefasDiarias.length} tarefa(s) diária(s) resetada(s) como pendentes.`);
    } catch (err) {
      console.error("Erro ao renovar ciclo diário:", err);
      alert("Ocorreu um erro ao renovar o ciclo diário.");
    } finally {
      setRenovandoCiclo(false);
    }
  };

  // Botão Manual para Direção/Coordenação: "Renovar Ciclo Semanal" com Atualização Otimista
  const handleRenovarCicloSemanal = async () => {
    if (!window.confirm("Deseja realmente renovar o ciclo semanal?\n\nIsso desmarcará o status de conclusão de TODAS as tarefas da rotina semanal para toda a equipe iniciar a nova semana.")) {
      return;
    }

    setRenovandoCicloSemanal(true);
    try {
      const tarefasSemanais = (tarefas || []).filter(t => {
        const freq = (t?.frequencia || '').trim();
        return freq === 'Semanal' || freq === 'Rotina Semanal';
      });

      if (tarefasSemanais.length === 0) {
        alert("Nenhuma tarefa semanal cadastrada encontrada.");
        setRenovandoCicloSemanal(false);
        return;
      }

      const hoje = new Date();
      const year = hoje.getFullYear();
      const month = String(hoje.getMonth() + 1).padStart(2, '0');
      const day = String(hoje.getDate()).padStart(2, '0');
      const hojeStr = `${year}-${month}-${day}`;
      const nowIso = new Date().toISOString();

      const patch = {
        concluidaPor: [],
        concluidoPor: [],
        concluido: false,
        ultimaConclusao: null,
        ultimaDataConclusao: hojeStr,
        atualizadoEm: nowIso,
        atualizadoPor: `${userRole} (${getCurrentUserEmail()} - Renovação Manual de Ciclo Semanal)`
      };

      // Atualização Otimista em memória
      const prevList = [...(tarefas || [])];
      const updatedList = prevList.map(t => {
        const freq = (t?.frequencia || '').trim();
        const isSemanal = freq === 'Semanal' || freq === 'Rotina Semanal';
        return isSemanal ? { ...t, ...patch } : t;
      });
      setTarefas(updatedList);
      window.tasksCache = updatedList;

      const batch = writeBatch(db);
      tarefasSemanais.forEach(t => {
        const ref = doc(db, 'rotina_equipe', t.id);
        batch.update(ref, patch);
      });

      await batch.commit();
      alert(`Ciclo semanal renovado com sucesso!\n\n${tarefasSemanais.length} tarefa(s) semanal(is) resetada(s) como pendentes.`);
    } catch (err) {
      console.error("Erro ao renovar ciclo semanal:", err);
      alert("Ocorreu um erro ao renovar o ciclo semanal.");
    } finally {
      setRenovandoCicloSemanal(false);
    }
  };

  // Abrir Modal de Criação / Edição
  const handleOpenModal = (task = null) => {
    if (isSomenteLeitura) return;
    setIsDuplicating(false);
    if (task) {
      setEditingTask(task);
      const dtIni = task.dataInicio || task.dataLimite || '';
      const dtFim = task.dataFim || dtIni;
      setFormData({
        id: task.id,
        titulo: task.titulo || '',
        descricao: task.descricao || '',
        frequencia: task.frequencia || 'Diária',
        atribuirA: task.atribuirA || 'TODA A EQUIPE',
        dataInicio: dtIni,
        horaInicio: task.horaInicio || '',
        dataFim: dtFim,
        horaFim: task.horaFim || '',
        dataLimite: task.dataLimite || dtIni
      });
    } else {
      setEditingTask(null);
      setFormData({
        id: null,
        titulo: '',
        descricao: '',
        frequencia: 'Diária',
        atribuirA: 'TODA A EQUIPE',
        dataInicio: '',
        horaInicio: '',
        dataFim: '',
        horaFim: '',
        dataLimite: ''
      });
    }
    setIsModalOpen(true);
  };

  // Duplicar Tarefa e Atribuir a Outro Perfil (Exclusivo CGPG, Vice-Diretor e Diretor)
  const handleOpenDuplicateModal = (task) => {
    if (isSomenteLeitura || !podeDuplicar || !task) return;
    const dtIni = task.dataInicio || task.dataLimite || '';
    const dtFim = task.dataFim || dtIni;
    setEditingTask(null);
    setIsDuplicating(true);
    setFormData({
      id: null,
      titulo: task.titulo || '',
      descricao: task.descricao || '',
      frequencia: task.frequencia || 'Diária',
      atribuirA: task.atribuirA || 'TODA A EQUIPE',
      dataInicio: dtIni,
      horaInicio: task.horaInicio || '',
      dataFim: dtFim,
      horaFim: task.horaFim || '',
      dataLimite: task.dataLimite || dtIni
    });
    setIsModalOpen(true);
  };

  // Transformar sessão de edição em Duplicação dentro do próprio Modal
  const handleTransformToDuplicate = () => {
    if (!podeDuplicar) return;
    setEditingTask(null);
    setIsDuplicating(true);
    setFormData((prev) => ({
      ...prev,
      id: null
    }));
  };

  // Abrir Modal de Criação em Massa (Exclusivo CGPG, Vice-Diretor e Diretor)
  const handleOpenBulkModal = () => {
    if (isSomenteLeitura || !podeDuplicar) return;
    setBulkFormData({
      titulo: '',
      descricao: '',
      frequencia: 'Diária',
      dataInicio: '',
      horaInicio: '',
      dataFim: '',
      horaFim: '',
      dataLimite: ''
    });
    setSelectedBulkTargets([]);
    setCustomBulkInput('');
    setBulkSuccessMsg('');
    setIsBulkModalOpen(true);
  };

  const toggleBulkTarget = (target) => {
    if (!target) return;
    setSelectedBulkTargets((prev) => {
      if (prev.includes(target)) {
        return prev.filter((t) => t !== target);
      } else {
        return [...prev, target];
      }
    });
  };

  const handleAddCustomBulkTarget = (e) => {
    if (e) e.preventDefault();
    const val = customBulkInput.trim();
    if (val && !selectedBulkTargets.includes(val)) {
      setSelectedBulkTargets((prev) => [...prev, val]);
      setCustomBulkInput('');
    }
  };

  const handleSelectAllUsersBulk = () => {
    const userNames = (listaUsuariosEquipe || []).map((u) => u.nome).filter(Boolean);
    const combined = Array.from(new Set([...selectedBulkTargets, ...userNames]));
    setSelectedBulkTargets(combined);
  };

  const handleClearAllBulkTargets = () => {
    setSelectedBulkTargets([]);
  };

  const handleSaveBulkTasks = async (e) => {
    e.preventDefault();
    if (isSomenteLeitura || !podeDuplicar) return;

    if (!bulkFormData.titulo.trim()) {
      alert("Por favor, preencha o título da tarefa.");
      return;
    }

    if (selectedBulkTargets.length === 0) {
      alert("Por favor, selecione ao menos um destinatário ou perfil para a criação em massa.");
      return;
    }

    const isPontual =
      bulkFormData.frequencia === 'Ação Pontual (Prazo Fixo)' ||
      bulkFormData.frequencia === 'Pontual';

    if (isPontual && !bulkFormData.dataInicio) {
      alert("Por favor, preencha a Data de Início para ações pontuais.");
      return;
    }

    const dtInicio = bulkFormData.dataInicio ? bulkFormData.dataInicio : null;
    const dtFim = bulkFormData.dataFim ? bulkFormData.dataFim : dtInicio;
    const hrInicio = bulkFormData.horaInicio ? bulkFormData.horaInicio : null;
    const hrFim = bulkFormData.horaFim ? bulkFormData.horaFim : null;

    setBulkSaving(true);
    try {
      const colRef = collection(db, 'rotina_equipe');

      const newTasks = [];
      const promises = selectedBulkTargets.map(async (dest) => {
        const payload = {
          titulo: bulkFormData.titulo.trim(),
          descricao: bulkFormData.descricao.trim(),
          frequencia: bulkFormData.frequencia,
          atribuirA: dest,
          atribuidoA: dest,
          dataInicio: isPontual ? dtInicio : null,
          horaInicio: isPontual ? hrInicio : null,
          dataFim: isPontual ? dtFim : null,
          horaFim: isPontual ? hrFim : null,
          dataLimite: isPontual ? dtInicio : null,
          concluidoPor: [],
          concluidaPor: [],
          concluido: false,
          ultimaConclusao: null,
          criadoEm: new Date().toISOString(),
          criadoPor: `${userRole} (Criado em Massa)`
        };
        const docAdded = await addDoc(colRef, payload);
        newTasks.push({ id: docAdded.id, ...payload });
        return docAdded;
      });

      await Promise.all(promises);

      // Atualização Otimista local
      const updatedList = [...(tarefas || []), ...newTasks];
      setTarefas(updatedList);
      window.tasksCache = updatedList;

      setBulkSuccessMsg(`Sucesso! ${selectedBulkTargets.length} tarefas idênticas foram criadas.`);

      setTimeout(() => {
        setIsBulkModalOpen(false);
        setBulkSuccessMsg('');
      }, 1800);
    } catch (err) {
      console.error("Erro ao criar tarefas em massa:", err);
      alert("Ocorreu um erro ao salvar as tarefas em massa. Tente novamente.");
    } finally {
      setBulkSaving(false);
    }
  };

  // Salvar no Firestore com Atualização Otimista
  const handleSaveTask = async (e) => {
    e.preventDefault();
    if (isSomenteLeitura) return;
    if (!formData.titulo.trim()) return;

    const isPontual =
      formData.frequencia === 'Ação Pontual (Prazo Fixo)' ||
      formData.frequencia === 'Pontual';

    if (isPontual && !formData.dataInicio) {
      alert("Por favor, preencha a Data de Início para ações pontuais.");
      return;
    }

    const dtInicio = formData.dataInicio ? formData.dataInicio : null;
    const dtFim = formData.dataFim ? formData.dataFim : dtInicio;
    const hrInicio = formData.horaInicio ? formData.horaInicio : null;
    const hrFim = formData.horaFim ? formData.horaFim : null;

    setSaving(true);
    try {
      const payload = {
        titulo: formData.titulo.trim(),
        descricao: formData.descricao.trim(),
        frequencia: formData.frequencia,
        atribuirA: formData.atribuirA,
        atribuidoA: formData.atribuirA,
        dataInicio: isPontual ? dtInicio : null,
        horaInicio: isPontual ? hrInicio : null,
        dataFim: isPontual ? dtFim : null,
        horaFim: isPontual ? hrFim : null,
        dataLimite: isPontual ? dtInicio : null
      };

      const taskId = isDuplicating ? null : (formData.id || editingTask?.id);

      if (taskId) {
        // É EDIÇÃO: Atualização otimista imediata
        const updatedList = (tarefas || []).map(t => t.id === taskId ? {
          ...t,
          ...payload,
          atualizadoEm: new Date().toISOString(),
          atualizadoPor: userRole
        } : t);
        setTarefas(updatedList);
        window.tasksCache = updatedList;

        const docRef = doc(db, 'rotina_equipe', taskId);
        await updateDoc(docRef, {
          ...payload,
          atualizadoEm: new Date().toISOString(),
          atualizadoPor: userRole
        });
      } else {
        // É NOVO REGISTRO / DUPLICAÇÃO
        const colRef = collection(db, 'rotina_equipe');
        const newObj = {
          ...payload,
          concluido: false,
          concluidaPor: [],
          concluidoPor: [],
          ultimaConclusao: null,
          criadoEm: new Date().toISOString(),
          criadoPor: `${userRole}${isDuplicating ? ' (Duplicada)' : ''}`
        };
        const docRef = await addDoc(colRef, newObj);

        const updatedList = [...(tarefas || []), { id: docRef.id, ...newObj }];
        setTarefas(updatedList);
        window.tasksCache = updatedList;
      }

      setIsModalOpen(false);
      setEditingTask(null);
      setIsDuplicating(false);
      setFormData({
        id: null,
        titulo: '',
        descricao: '',
        frequencia: 'Diária',
        atribuirA: 'TODA A EQUIPE',
        dataInicio: '',
        horaInicio: '',
        dataFim: '',
        horaFim: '',
        dataLimite: ''
      });
    } catch (err) {
      console.error("Erro ao salvar tarefa em rotina_equipe:", err);
    } finally {
      setSaving(false);
    }
  };

  // Excluir Tarefa com Atualização Otimista
  const handleDeleteTask = async (taskId) => {
    if (isSomenteLeitura) return;
    if (!taskId) return;
    const podeDeletar = typeof window !== 'undefined' && typeof window.podeExcluir === 'function' ? window.podeExcluir() : false;
    if (!podeDeletar) {
      const msg = 'Acesso negado: Apenas a Direção Escolar (Diretor e Vice-Diretor) possui autorização para excluir tarefas da rotina.';
      if (typeof window.showToast === 'function') window.showToast(msg, 'warning', 4000);
      else alert(msg);
      return;
    }
    if (!window.confirm("Deseja realmente excluir esta tarefa?")) return;

    // Atualização otimista imediata na memória
    const prevList = [...(tarefas || [])];
    const updatedList = prevList.filter(t => t.id !== taskId);
    setTarefas(updatedList);
    window.tasksCache = updatedList;

    try {
      await deleteDoc(doc(db, 'rotina_equipe', taskId));
    } catch (err) {
      console.error("Erro ao excluir tarefa:", err);
      // Reverter em caso de erro
      setTarefas(prevList);
      window.tasksCache = prevList;
    }
  };

  // Resumos e Indicadores da Tela
  const totalTarefas = (tarefasAposEscopo || []).length;
  const concluidasCount = (tarefasAposEscopo || []).filter(t => verificarStatus(t)).length;
  const pendentesCount = totalTarefas - concluidasCount;

  // Dicionário de metadados para as barras do Termômetro de Progresso
  const METADATA_CATEGORIAS = {
    'DIRETOR': {
      key: 'DIRETOR',
      label: 'Direção',
      roleTarget: ['DIRETOR', 'DIRECAO'],
      icon: 'fa-user-tie',
      badgeColor: 'bg-purple-100 text-purple-900 border-purple-200',
      barColor: 'bg-purple-600',
    },
    'VICE_DIRETOR': {
      key: 'VICE_DIRETOR',
      label: 'Vice-Direção',
      roleTarget: ['VICE_DIRETOR', 'VICE DIRETOR'],
      icon: 'fa-user-shield',
      badgeColor: 'bg-amber-100 text-amber-900 border-amber-200',
      barColor: 'bg-amber-600',
    },
    'CGPG': {
      key: 'CGPG',
      label: 'CGPG',
      roleTarget: ['CGPG', 'COORDENACAO'],
      icon: 'fa-user-graduate',
      badgeColor: 'bg-emerald-100 text-emerald-900 border-emerald-200',
      barColor: 'bg-emerald-600',
    },
    'PAAC': {
      key: 'PAAC',
      label: 'PAAC (Apoio ao Currículo)',
      roleTarget: ['PAAC', 'PROFESSOR_PAAC'],
      icon: 'fa-user-pen',
      badgeColor: 'bg-cyan-100 text-cyan-900 border-cyan-200',
      barColor: 'bg-cyan-600',
    },
    'PROFESSOR': {
      key: 'PROFESSOR',
      label: 'Professores',
      roleTarget: ['PROFESSOR', 'PROFESSORES'],
      icon: 'fa-chalkboard-user',
      badgeColor: 'bg-indigo-100 text-indigo-900 border-indigo-200',
      barColor: 'bg-indigo-600',
    },
    'TODA A EQUIPE': {
      key: 'TODA A EQUIPE',
      label: 'Toda a Equipe',
      roleTarget: ['TODA A EQUIPE', 'TODA_EQUIPE', 'EQUIPE GESTORA COMPLETA'],
      icon: 'fa-users-gear',
      badgeColor: 'bg-blue-100 text-blue-900 border-blue-200',
      barColor: 'bg-blue-600',
    }
  };

  // Dinamismo do Termômetro: Renderiza barras de progresso para cada cargo em papeisPermitidos do usuário logado
  const termometroPorCategoria = (papeisPermitidos || [])
    .map(papel => {
      const cat = METADATA_CATEGORIAS[papel];
      if (!cat) return null;

      const matchedTasks = (tarefasVisiveis || []).filter(t => {
        if (!t) return false;
        const target = String(t?.atribuidoA || t?.atribuirA || '').toUpperCase().trim();
        return (cat.roleTarget || []).map(r => r.toUpperCase()).includes(target) || target === cat.key;
      });

      const total = matchedTasks.length;
      const concluidas = matchedTasks.filter(t => verificarStatus(t)).length;
      const porcentagem = total > 0 ? Math.round((concluidas / total) * 100) : 0;

      return {
        ...cat,
        total,
        concluidas,
        porcentagem
      };
    })
    .filter(Boolean)
    .filter((cat, idx) => {
      return cat.total > 0 || idx < 2;
    });

  // Proteção de Acesso Estrita
  if (!isAuthorized) {
    return (
      <div className="p-6 md:p-8 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Acesso Restrito ao Módulo</h3>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            O módulo <strong className="text-red-700">Task's</strong> é de acesso estrito para Equipe Gestora, PAAC e Professores (<strong className="text-slate-800">DIRETOR, VICE_DIRETOR, CGPG, PAAC e PROFESSOR</strong>).
          </p>
          <div className="mt-5 p-3 bg-slate-100 rounded-xl text-[11px] text-slate-500 font-mono">
            Perfil Atual: <span className="font-bold text-slate-800">{userRole}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 sm:p-6 bg-slate-50 min-h-screen space-y-6">
      {/* Header do Módulo */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 bg-blue-100 text-blue-900 font-extrabold text-[10px] rounded-full uppercase tracking-wide border border-blue-200">
              Módulo Gestor
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-900 font-extrabold text-[10px] rounded-full uppercase tracking-wide border border-emerald-200">
              Visão: {userRole === 'DIRETOR' ? 'DIRETOR (Visão Global Master)' : isSomenteLeitura ? `${userRole} (Somente Leitura)` : userRole}
            </span>
            <button
              type="button"
              onClick={() => setFiltroEscopo(prev => prev === 'MINHAS' ? 'TODAS_ACESSO' : 'MINHAS')}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all cursor-pointer flex items-center gap-1.5 ${
                filtroEscopo === 'MINHAS'
                  ? 'bg-cyan-100 text-cyan-950 border-cyan-300 hover:bg-cyan-200 shadow-2xs'
                  : 'bg-indigo-100 text-indigo-950 border-indigo-300 hover:bg-indigo-200 shadow-2xs'
              }`}
              title="Clique para alternar entre Minhas Tarefas e Todas do Nível"
            >
              <i className={`fa-solid ${filtroEscopo === 'MINHAS' ? 'fa-user-check text-cyan-700' : 'fa-users-viewfinder text-indigo-700'}`}></i>
              <span>{filtroEscopo === 'MINHAS' ? `Padrão: Minhas Tarefas (${countMinhasTotal})` : `Todas do Nível (${countTodasAcessoTotal})`}</span>
            </button>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
              {isRealtimeConnected ? 'Tempo Real Ativo' : 'Conectando...'}
            </span>
            <button
              type="button"
              onClick={() => carregarTarefas(true)}
              disabled={loading}
              title="Recarregar tarefas do servidor"
              className="px-2 py-0.5 text-xs text-slate-600 hover:text-blue-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            >
              <i className={`fa-solid fa-arrows-rotate ${loading ? 'fa-spin text-blue-600' : ''}`}></i>
            </button>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-blue-950 uppercase tracking-tight mt-1 flex items-center gap-2">
            <i className="fa-solid fa-list-check text-cyan-600"></i>
            Tarefas
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Organização e acompanhamento ágil com renovação temporal automática da equipe gestora escolar.
          </p>
        </div>

        {/* Ações: Renovar Ciclo Diário, Renovar Ciclo Semanal & Criar Tarefa */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
          {['DIRETOR', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'DIRECAO', 'COORDENACAO'].some(r => roleUpper.includes(r) || roleUpper === r) && (
            <>
              <button
                type="button"
                onClick={handleRenovarCicloDiario}
                disabled={renovandoCiclo}
                className="w-full sm:w-auto px-4 py-2.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                title="Limpa as conclusões diárias de todas as tarefas para iniciar novo ciclo diário"
              >
                <i className={`fa-solid fa-arrows-rotate ${renovandoCiclo ? 'fa-spin' : ''}`}></i>
                <span>Renovar Ciclo Diário</span>
              </button>

              <button
                type="button"
                onClick={handleRenovarCicloSemanal}
                disabled={renovandoCicloSemanal}
                className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                title="Limpa as conclusões semanais de todas as tarefas para iniciar novo ciclo semanal"
              >
                <i className={`fa-solid fa-calendar-week ${renovandoCicloSemanal ? 'fa-spin' : ''}`}></i>
                <span>Renovar Ciclo Semanal</span>
              </button>
            </>
          )}

          {!isSomenteLeitura && (
            <>
              {podeDuplicar && (
                <button
                  type="button"
                  onClick={handleOpenBulkModal}
                  className="w-full sm:w-auto px-4 py-2.5 bg-purple-700 hover:bg-purple-800 active:bg-purple-900 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
                  title="Criar tarefas idênticas para múltiplos usuários ou perfis em massa (Acesso Restrito: CGPG, Vice e Direção)"
                >
                  <i className="fa-solid fa-users-gear text-purple-200"></i>
                  <span>Criar Tarefas em Massa</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenModal()}
                className="w-full sm:w-auto px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
              >
                <i className="fa-solid fa-plus text-cyan-300"></i>
                <span>Nova Tarefa</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Termômetro de Progresso Segmentado por Função */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-base font-black shrink-0">
              <i className="fa-solid fa-chart-line"></i>
            </div>
            <div>
              <h3 className="font-extrabold text-xs sm:text-sm text-slate-900 uppercase tracking-tight">
                Termômetro de Progresso Segmentado por Função
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Acompanhamento de progresso e engajamento por atribuição de cargo da equipe gestora
              </p>
            </div>
          </div>
        </div>

        {/* Grid de Barras de Progresso por Função */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${termometroPorCategoria.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-3.5 pt-1`}>
          {termometroPorCategoria.map((cat) => (
            <div
              key={cat.key}
              className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-between gap-2.5 transition-all hover:bg-white hover:shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border flex items-center gap-1.5 shrink-0 ${cat.badgeColor}`}>
                  <i className={`fa-solid ${cat.icon}`}></i>
                  {cat.label}
                </span>
                <span className="text-xs font-black text-slate-800 font-mono shrink-0">
                  {cat.porcentagem}%
                </span>
              </div>

              <div className="space-y-1">
                {/* Progress Bar */}
                <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div
                    className={`${cat.barColor} h-full rounded-full transition-all duration-500`}
                    style={{ width: `${cat.porcentagem}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold pt-0.5">
                  <span>{cat.concluidas} de {cat.total} concluída(s)</span>
                  {cat.total === 0 && <span className="italic text-slate-400">Sem tarefas</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cards de Resumo e Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total de Tarefas</p>
            <p className="text-2xl font-black text-slate-800 mt-0.5">{totalTarefas}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-800 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-list-ul"></i>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pendentes no Ciclo</p>
            <p className="text-2xl font-black text-amber-600 mt-0.5">{pendentesCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-clock-rotate-left"></i>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Concluídas no Ciclo</p>
            <p className="text-2xl font-black text-emerald-600 mt-0.5">{concluidasCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg font-bold">
            <i className="fa-solid fa-circle-check"></i>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ações Pontuais</p>
            <span className="text-xs font-black text-amber-700">{(tarefasPontuais || []).length} cadastrada(s)</span>
          </div>
          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mt-2">
            <div
              className="bg-amber-500 h-full transition-all duration-300"
              style={{ width: `${(tarefasPontuais || []).length > 0 ? Math.round(((tarefasPontuais || []).filter(t => verificarStatus(t)).length / (tarefasPontuais || []).length) * 100) : 0}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5">
        
        {/* 1. SELETOR DE ESCOPO: MINHAS TAREFAS (PADRÃO) VS TODAS DO MEU NÍVEL DE ACESSO */}
        <div className="p-3.5 bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-400/20 text-cyan-300 flex items-center justify-center text-base font-black shrink-0 border border-cyan-400/30">
              <i className={`fa-solid ${filtroEscopo === 'MINHAS' ? 'fa-user-check' : 'fa-users-viewfinder'}`}></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase tracking-wider text-white">
                  Visualização: {filtroEscopo === 'MINHAS' ? 'Minhas Tarefas (Específicas)' : 'Todas do Meu Nível de Acesso'}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  filtroEscopo === 'MINHAS'
                    ? 'bg-cyan-400 text-blue-950 font-black'
                    : 'bg-indigo-400 text-slate-950 font-black'
                }`}>
                  {filtroEscopo === 'MINHAS' ? 'Filtro Padrão Ativo' : 'Visão Geral da Equipe'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {filtroEscopo === 'MINHAS'
                  ? `Exibindo apenas tarefas que dizem respeito a você ou ao seu cargo (${cargoLogado}).`
                  : `Exibindo todas as tarefas supervisionáveis no seu nível de permissão (${cargoLogado}).`}
              </p>
            </div>
          </div>

          <div className="flex items-center bg-white/10 p-1 rounded-xl border border-white/15 gap-1 shrink-0 self-stretch sm:self-auto justify-end">
            <button
              type="button"
              onClick={() => setFiltroEscopo('MINHAS')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                filtroEscopo === 'MINHAS'
                  ? 'bg-cyan-400 text-blue-950 shadow-sm'
                  : 'text-blue-100 hover:text-white hover:bg-white/10'
              }`}
              title="Exibir tarefas atribuídas diretamente a você ou ao seu cargo"
            >
              <i className="fa-solid fa-user-check text-[11px]"></i>
              <span>Minhas Tarefas ({countMinhasTotal})</span>
            </button>

            <button
              type="button"
              onClick={() => setFiltroEscopo('TODAS_ACESSO')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                filtroEscopo === 'TODAS_ACESSO'
                  ? 'bg-cyan-400 text-blue-950 shadow-sm'
                  : 'text-blue-100 hover:text-white hover:bg-white/10'
              }`}
              title="Exibir todas as tarefas dentro do seu nível de acesso"
            >
              <i className="fa-solid fa-users-viewfinder text-[11px]"></i>
              <span>Ver Todas do Nível ({countTodasAcessoTotal})</span>
            </button>
          </div>
        </div>

        {/* Filtro por Nível de Cargo / Atribuição */}
        <div className="w-full flex items-center overflow-x-auto gap-1.5 pb-2 border-b border-slate-100 scrollbar-thin">
          <span className="text-[11px] font-black uppercase text-slate-500 mr-1 shrink-0 flex items-center gap-1">
            <i className="fa-solid fa-layer-group text-cyan-600"></i> Níveis:
          </span>
          <button
            type="button"
            onClick={() => setSelectedNivel('TODOS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              selectedNivel === 'TODOS'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <i className="fa-solid fa-list-check text-[11px]"></i>
            Todos os Níveis ({totalTarefas})
          </button>

          {NIVEIS_DEFINICOES.map((nDef) => {
            const countNivel = (finalFilteredTarefasSemFreq || []).filter(t => getNivelKey(t, listaUsuariosEquipe) === nDef.key).length;
            return (
              <button
                key={nDef.key}
                type="button"
                onClick={() => setSelectedNivel(nDef.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  selectedNivel === nDef.key
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className={`fa-solid ${nDef.icon} text-[11px]`}></i>
                {nDef.label} ({countNivel})
              </button>
            );
          })}
        </div>

        {/* Filtro por Periodicidade / Frequência */}
        <div className="w-full flex items-center overflow-x-auto gap-1.5 pb-2 border-b border-slate-100 scrollbar-thin">
          <span className="text-[11px] font-black uppercase text-slate-500 mr-1 shrink-0 flex items-center gap-1">
            <i className="fa-solid fa-clock text-amber-600"></i> Frequências:
          </span>
          <button
            type="button"
            onClick={() => setSelectedFreq('')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              !selectedFreq
                ? 'bg-slate-900 text-white shadow-xs font-black'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <i className="fa-solid fa-calendar-days text-[11px]"></i>
            Todas ({totalTarefas})
          </button>

          {FREQUENCIAS.map((f) => {
            const count = (finalFilteredTarefasSemFreq || []).filter(t => getNormalizedFreqKey(t) === f.key).length;
            const isSelected = selectedFreq === f.key || getNormalizedFreqKey(selectedFreq) === f.key;

            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setSelectedFreq(isSelected ? '' : f.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? `${f.headerBg} shadow-xs font-black ring-2 ring-blue-400`
                    : `${f.badge} hover:opacity-90`
                }`}
              >
                <i className={`fa-solid ${f.icon} text-[11px]`}></i>
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Abas de Status */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setStatusTab('TODAS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusTab === 'TODAS'
                  ? 'bg-white text-blue-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todas ({totalTarefas})
            </button>
            <button
              type="button"
              onClick={() => setStatusTab('PENDENTES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusTab === 'PENDENTES'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pendentes ({pendentesCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusTab('CONCLUIDAS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusTab === 'CONCLUIDAS'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Concluídas ({concluidasCount})
            </button>
          </div>

          {/* Campo de Busca */}
          <div className="flex items-center gap-2 flex-1 justify-end min-w-[240px]">
            <div className="relative w-full sm:w-[260px]">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar tarefa por título/descrição..."
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-400 w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Renderização de Conteúdo das Tarefas Agrupadas e Separadas por Níveis e Periodicidades */}
      <div className="space-y-8">
        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 font-semibold text-xs">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-800 mb-2 block"></i>
            <span>Carregando suas tarefas...</span>
          </div>
        ) : (tarefasAgrupadasPorNivel || []).length === 0 ? (
          <div className="space-y-4">
            <MascoteSaraState
              titulo={filtroEscopo === 'MINHAS' ? "Nenhuma tarefa direcionada diretamente a você!" : "Nenhuma tarefa encontrada!"}
              mensagem={filtroEscopo === 'MINHAS'
                ? `Você não possui tarefas pendentes atribuídas especificamente para o seu nome ou cargo (${cargoLogado}) com os filtros atuais.`
                : "Não há tarefas cadastradas para o seu perfil ou com os filtros selecionados no momento."}
            />
            {filtroEscopo === 'MINHAS' && countTodasAcessoTotal > 0 && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setFiltroEscopo('TODAS_ACESSO')}
                  className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center gap-2"
                >
                  <i className="fa-solid fa-users-viewfinder text-cyan-300"></i>
                  <span>Ver Todas as Tarefas do Meu Nível de Acesso ({countTodasAcessoTotal})</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          tarefasAgrupadasPorNivel.map((grupo) => {
            const concluidasGrupo = grupo.tasks.filter(t => verificarStatus(t)).length;
            const totalGrupo = grupo.tasks.length;
            const percGrupo = totalGrupo > 0 ? Math.round((concluidasGrupo / totalGrupo) * 100) : 0;

            return (
              <div key={grupo.key} className="space-y-5">
                {/* Cabeçalho do Nível de Atribuição */}
                <div className={`p-3.5 sm:p-4 rounded-2xl border shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${grupo.headerBg}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-lg text-cyan-300 font-black shrink-0">
                      <i className={`fa-solid ${grupo.icon}`}></i>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black text-sm sm:text-base uppercase tracking-wider text-white">
                          {grupo.title}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white/20 text-white font-mono">
                          {totalGrupo} tarefa(s)
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5 font-medium leading-relaxed">
                        {grupo.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 border-white/10 pt-2 sm:pt-0">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-300 font-bold uppercase block">Progresso do Nível</span>
                      <span className="text-xs font-black font-mono text-cyan-300">{concluidasGrupo} de {totalGrupo} ({percGrupo}%)</span>
                    </div>
                    <div className="w-24 bg-white/20 h-2.5 rounded-full overflow-hidden p-0.5">
                      <div className="bg-cyan-400 h-full rounded-full transition-all duration-300" style={{ width: `${percGrupo}%` }}></div>
                    </div>
                  </div>
                </div>

                {/* Sub-agrupamento por Periodicidade / Frequência dentro deste Nível */}
                <div className="space-y-6">
                  {grupo.subGruposFreq.map((subFreq) => {
                    const subTotal = subFreq.tasks.length;
                    const subConcluidas = subFreq.tasks.filter(t => verificarStatus(t)).length;

                    return (
                      <div key={subFreq.key} className="space-y-3">
                        {/* Sub-cabeçalho da Periodicidade / Frequência */}
                        <div className={`p-2.5 sm:p-3 rounded-xl border flex items-center justify-between gap-2 shadow-2xs ${subFreq.subBg || 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${subFreq.badge}`}>
                              <i className={`fa-solid ${subFreq.icon}`}></i>
                            </div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-extrabold text-xs sm:text-sm uppercase tracking-wider text-slate-900">
                                {subFreq.title || subFreq.label}
                              </h4>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white/90 border border-slate-200 text-slate-700 font-mono shadow-2xs">
                                {subTotal} {subTotal === 1 ? 'tarefa' : 'tarefas'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs font-black font-mono text-slate-700 bg-white/90 px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                              {subConcluidas} de {subTotal} concluída(s)
                            </span>
                          </div>
                        </div>

                        {/* Grid de Cards de Tarefa do Nível */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {subFreq.tasks.map((task) => {
                            if (!task) return null;
                            const isDone = verificarStatus(task);
                            const quemConcluiu = getQuemConcluiu(task, listaUsuariosEquipe);
                            const statusAtraso = getStatusAtraso(task);

                            let cardBgAndBorder = "bg-white border-slate-200 hover:border-blue-400 shadow-2xs hover:shadow-md";
                            if (isDone) {
                              cardBgAndBorder = "bg-emerald-50 border-emerald-300 shadow-2xs hover:border-emerald-500";
                            } else if (statusAtraso === 'ATRASADO') {
                              cardBgAndBorder = "bg-red-50 border-red-300 shadow-2xs hover:border-red-500";
                            } else if (statusAtraso === 'VENCE_HOJE') {
                              cardBgAndBorder = "bg-orange-50/90 border-orange-300 shadow-2xs hover:border-orange-500";
                            }

                            const freqMeta = (FREQUENCIAS || []).find(f => f.key === getNormalizedFreqKey(task)) || {
                              badge: 'bg-slate-100 text-slate-800 border-slate-300',
                              icon: 'fa-list-check'
                            };

                            return (
                              <div
                                key={task.id}
                                className={`group relative p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all duration-300 cursor-default ${cardBgAndBorder} hover:scale-[1.01] hover:z-20`}
                              >
                                <div className="space-y-2.5">
                                  {/* Header do Card: Checkbox + Título + Botões de Ação */}
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                      <button
                                        type="button"
                                        disabled={isSomenteLeitura || isProfessor}
                                        onClick={() => handleToggleConcluido(task)}
                                        className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                          isProfessor
                                            ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed opacity-50'
                                            : isDone
                                            ? 'bg-emerald-600 border-emerald-600 text-white cursor-pointer'
                                            : statusAtraso === 'ATRASADO'
                                            ? 'border-red-400 bg-white hover:border-red-600 text-transparent cursor-pointer'
                                            : statusAtraso === 'VENCE_HOJE'
                                            ? 'border-orange-400 bg-white hover:border-orange-600 text-transparent cursor-pointer'
                                            : 'border-slate-300 bg-white hover:border-blue-600 text-transparent cursor-pointer'
                                        }`}
                                        title={
                                          isProfessor
                                            ? "Professores não possuem permissão para marcar tarefas como concluídas"
                                            : isDone
                                            ? "Desmarcar conclusão da tarefa"
                                            : "Marcar tarefa como concluída"
                                        }
                                      >
                                        <i className="fa-solid fa-check text-xs"></i>
                                      </button>

                                      <h4
                                        className={`font-bold text-xs uppercase leading-snug break-words transition-colors group-hover:text-blue-950 ${
                                          isDone
                                            ? 'line-through text-emerald-800 font-semibold'
                                            : statusAtraso === 'ATRASADO'
                                            ? 'text-red-950 font-black'
                                            : statusAtraso === 'VENCE_HOJE'
                                            ? 'text-orange-950 font-black'
                                            : 'text-slate-900'
                                        }`}
                                      >
                                        {task.titulo}
                                      </h4>
                                    </div>

                                    {/* Ações (Duplicar / Editar / Excluir) */}
                                    {!isSomenteLeitura && (
                                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                                        {podeDuplicar && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenDuplicateModal(task)}
                                            title="Duplicar Tarefa e Atribuir a Outro Perfil (Acesso Restrito: CGPG/Vice/Direção)"
                                            className="p-1 hover:bg-purple-100 text-purple-600 hover:text-purple-800 rounded-lg transition-colors cursor-pointer"
                                          >
                                            <i className="fa-solid fa-copy text-xs"></i>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleOpenModal(task)}
                                          title="Editar Tarefa"
                                          className="p-1 hover:bg-slate-200 text-slate-500 hover:text-blue-700 rounded-lg transition-colors cursor-pointer"
                                        >
                                          <i className="fa-solid fa-pen-to-square text-xs"></i>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteTask(task.id)}
                                          title="Excluir Tarefa"
                                          className="p-1 hover:bg-red-100/80 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                        >
                                          <i className="fa-solid fa-trash-can text-xs"></i>
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Badges do Card */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {statusAtraso === 'ATRASADO' && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-red-600 text-white border border-red-700 flex items-center gap-1 shadow-2xs animate-pulse">
                                        <i className="fa-solid fa-circle-exclamation"></i>
                                        ATRASADO
                                      </span>
                                    )}

                                    {statusAtraso === 'VENCE_HOJE' && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-orange-500 text-white border border-orange-600 flex items-center gap-1 shadow-2xs">
                                        <i className="fa-solid fa-clock"></i>
                                        VENCE HOJE
                                      </span>
                                    )}

                                    {/* Badge de Frequência */}
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${freqMeta.badge || 'bg-slate-100 text-slate-800 border-slate-300'}`}>
                                      <i className={`fa-solid ${freqMeta.icon || 'fa-list-check'}`}></i>
                                      <span>{task.frequencia || 'Geral'}</span>
                                    </span>

                                    {/* Badge do Nível / Usuário Atribuído */}
                                    {task.atribuirA || task.atribuidoA ? (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${
                                        !OPCOES_ATRIBUICAO.includes(task.atribuirA || task.atribuidoA)
                                          ? 'bg-purple-100 text-purple-900 border-purple-300 font-extrabold shadow-2xs'
                                          : grupo.badge
                                      }`}>
                                        <i className={`fa-solid ${!OPCOES_ATRIBUICAO.includes(task.atribuirA || task.atribuidoA) ? 'fa-user-check text-purple-600' : grupo.icon}`}></i>
                                        <span>
                                          Para: {task.atribuirA || task.atribuidoA}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${grupo.badge}`}>
                                        <i className={`fa-solid ${grupo.icon} mr-1`}></i>
                                        Para: {grupo.label}
                                      </span>
                                    )}

                                    {/* Quem Concluiu a Tarefa */}
                                    {quemConcluiu.length > 0 && (
                                      <span
                                        className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 bg-emerald-100 text-emerald-950 border-emerald-300 shadow-2xs"
                                        title={`Concluído por: ${quemConcluiu.join(', ')}`}
                                      >
                                        <i className="fa-solid fa-user-check text-emerald-600"></i>
                                        <span>Concluído por: {quemConcluiu.join(', ')}</span>
                                      </span>
                                    )}

                                    {/* Badge de Data / Hora */}
                                    {(task.dataInicio || task.dataLimite || task.dataFim) && (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border flex items-center gap-1 ${
                                        statusAtraso === 'ATRASADO'
                                          ? 'bg-red-100 text-red-900 border-red-300'
                                          : statusAtraso === 'VENCE_HOJE'
                                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                                          : 'bg-slate-100 text-slate-800 border-slate-300'
                                      }`}>
                                        <i className="fa-solid fa-calendar-day"></i>
                                        <span>
                                          {task.dataFim && task.dataFim !== (task.dataInicio || task.dataLimite)
                                            ? `${formatarData(task.dataInicio || task.dataLimite)} a ${formatarData(task.dataFim)}`
                                            : formatarData(task.dataInicio || task.dataLimite)}
                                          {task.horaInicio && (
                                            <span className="ml-1 text-blue-950 font-bold">
                                              ⏰ {task.horaInicio}{task.horaFim ? `-${task.horaFim}` : ''}
                                            </span>
                                          )}
                                        </span>
                                      </span>
                                    )}
                                  </div>

                                  {/* Descrição: Expandível ao passar o mouse + suporte a Links clicáveis */}
                                  {task.descricao && (
                                    <div className="pt-2 border-t border-slate-100/90">
                                      <div
                                        className={`text-[11px] leading-relaxed transition-all duration-300 ${
                                          isDone
                                            ? 'text-emerald-800/80 font-medium'
                                            : statusAtraso === 'ATRASADO'
                                            ? 'text-red-900 font-medium'
                                            : statusAtraso === 'VENCE_HOJE'
                                            ? 'text-orange-900 font-medium'
                                            : 'text-slate-700'
                                        } line-clamp-2 group-hover:line-clamp-none group-hover:bg-slate-50/90 group-hover:p-2.5 group-hover:rounded-xl group-hover:border group-hover:border-blue-200/90 group-hover:shadow-2xs`}
                                      >
                                        {renderTextoComLinks(task.descricao)}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Dica de Hover Visual para Leitura Completa */}
                                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-100/60 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <span className="flex items-center gap-1 text-blue-600 font-bold">
                                    <i className="fa-solid fa-up-right-and-down-left-from-center text-[10px]"></i>
                                    Passe o mouse para ler tudo
                                  </span>
                                  {task.descricao && task.descricao.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi) && (
                                    <span className="flex items-center gap-1 text-emerald-600 font-bold">
                                      <i className="fa-solid fa-link text-[10px]"></i>
                                      Links ativos
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
            );
          })
        )}
      </div>

      {/* Modal de Criar / Editar Tarefa */}
      {!isSomenteLeitura && isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header do Modal */}
            <div className={`p-4 flex items-center justify-between text-white ${isDuplicating ? 'bg-purple-950' : 'bg-blue-950'}`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg font-black flex items-center justify-center text-sm ${isDuplicating ? 'bg-purple-400 text-purple-950' : 'bg-cyan-400 text-blue-950'}`}>
                  <i className={`fa-solid ${isDuplicating ? 'fa-copy' : 'fa-list-check'}`}></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm uppercase tracking-wider">
                    {isDuplicating
                      ? 'Duplicar Tarefa e Atribuir a Outro Perfil'
                      : editingTask
                      ? 'Editar Tarefa de Rotina'
                      : 'Nova Tarefa de Rotina'}
                  </h3>
                  <p className="text-[11px] text-cyan-200">
                    {isDuplicating
                      ? 'Atribua esta cópia a um novo perfil ou usuário mantendo os dados originais'
                      : 'Defina o título, a frequência e para quem será atribuída'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Formulário do Modal */}
            <form onSubmit={handleSaveTask} className="p-5 space-y-4 text-xs">
              {/* Banner Informativo quando em Modo Duplicação */}
              {isDuplicating && (
                <div className="bg-purple-50 border border-purple-200 p-3 rounded-xl flex items-center justify-between gap-2 text-purple-950 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-600 text-white font-black flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-copy text-sm"></i>
                    </div>
                    <div>
                      <h4 className="font-extrabold text-xs uppercase text-purple-900">Modo Duplicação Ativo</h4>
                      <p className="text-[11px] text-purple-700">A tarefa original será preservada. Selecione o novo perfil no campo <strong>"Atribuir a"</strong> abaixo.</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-purple-200 text-purple-900 font-black text-[10px] uppercase shrink-0">Acesso CGPG/Vice/Direção</span>
                </div>
              )}
              {/* Campo Título */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Título da Tarefa <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.titulo}
                  onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                  placeholder="Ex: Acompanhar Frequência do Dia e Ações da Busca Ativa"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                />
              </div>

              {/* Campo Descrição */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Descrição / Orientações (Opcional)
                </label>
                <textarea
                  rows={3}
                  value={formData.descricao}
                  onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                  placeholder="Detalhe a rotina, os entregáveis ou links de referência..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                ></textarea>
              </div>

              {/* Grid 2 Colunas: Frequência e Atribuir a */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Frequência */}
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Frequência da Ação <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.frequencia}
                    onChange={(e) => setFormData({ ...formData, frequencia: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {FREQUENCIAS.map((f) => (
                      <option key={f.key} value={f.key}>{f.title}</option>
                    ))}
                  </select>
                </div>

                {/* Atribuir a (Cargo Geral ou Usuário Específico) */}
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Atribuir a <span className="text-red-500">*</span></span>
                    <span className="text-[10px] text-blue-700 font-extrabold">Por Cargo ou Usuário</span>
                  </label>
                  <select
                    value={formData.atribuirA}
                    onChange={(e) => setFormData({ ...formData, atribuirA: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                  >
                    <optgroup label="Níveis e Cargos Gerais">
                      {OPCOES_ATRIBUICAO.map((op) => (
                        <option key={op} value={op}>
                          {op === 'PAAC' ? 'PAAC (Apoio ao Currículo)' : op === 'PROFESSOR' ? 'Professor' : op}
                        </option>
                      ))}
                    </optgroup>
                    {listaUsuariosEquipe.length > 0 && (
                      <optgroup label="Membros Específicos da Equipe">
                        {listaUsuariosEquipe.map((u) => (
                          <option key={u.id} value={u.nome}>
                            👤 {u.nome} ({u.nivel || u.cargo || 'Equipe'})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* Campo de Busca / Digitação Direta do Nome do Usuário */}
                  <div className="mt-1.5">
                    <input
                      type="text"
                      placeholder="Ou digite o nome de um responsável específico..."
                      value={formData.atribuirA}
                      onChange={(e) => setFormData({ ...formData, atribuirA: e.target.value })}
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>

                {/* Campos Condicionais para Ação Pontual (Prazo Fixo) */}
                {(formData.frequencia === 'Ação Pontual (Prazo Fixo)' || formData.frequencia === 'Pontual') && (
                  <div className="sm:col-span-2 bg-blue-50 p-3.5 rounded-xl border border-blue-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-[11px] text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                        <i className="fa-solid fa-calendar-day text-cyan-600"></i>
                        Agendamento da Ação Pontual
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">Horários são opcionais (Dia Inteiro)</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Data de Início */}
                      <div>
                        <label className="block font-bold text-slate-700 text-[11px] uppercase tracking-wider mb-1">
                          Data de Início <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          required
                          value={formData.dataInicio}
                          onChange={(e) => setFormData({ ...formData, dataInicio: e.target.value })}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                        />
                      </div>

                      {/* Hora de Início */}
                      <div>
                        <label className="block font-bold text-slate-700 text-[11px] uppercase tracking-wider mb-1">
                          Hora de Início (Opcional)
                        </label>
                        <input
                          type="time"
                          value={formData.horaInicio}
                          onChange={(e) => setFormData({ ...formData, horaInicio: e.target.value })}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                        />
                      </div>

                      {/* Data de Término */}
                      <div>
                        <label className="block font-bold text-slate-700 text-[11px] uppercase tracking-wider mb-1">
                          Data de Término (Opcional)
                        </label>
                        <input
                          type="date"
                          value={formData.dataFim}
                          onChange={(e) => setFormData({ ...formData, dataFim: e.target.value })}
                          placeholder="Padrão: Mesma data"
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                        />
                      </div>

                      {/* Hora de Término */}
                      <div>
                        <label className="block font-bold text-slate-700 text-[11px] uppercase tracking-wider mb-1">
                          Hora de Término (Opcional)
                        </label>
                        <input
                          type="time"
                          value={formData.horaFim}
                          onChange={(e) => setFormData({ ...formData, horaFim: e.target.value })}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Botoes de Ação do Modal */}
              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {editingTask && podeDuplicar && !isDuplicating && (
                    <button
                      type="button"
                      onClick={handleTransformToDuplicate}
                      className="px-3.5 py-2 bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 font-extrabold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs shadow-2xs"
                      title="Duplicar esta tarefa e atribuir a outro perfil/usuário (Restrito CGPG/Vice/Direção)"
                    >
                      <i className="fa-solid fa-copy text-purple-700"></i>
                      <span>Duplicar para Outro Perfil</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className={`px-5 py-2 text-white font-extrabold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                      isDuplicating
                        ? 'bg-purple-700 hover:bg-purple-800'
                        : 'bg-blue-900 hover:bg-blue-950'
                    }`}
                  >
                    {saving ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin"></i>
                        <span>Salvando...</span>
                      </>
                    ) : isDuplicating ? (
                      <>
                        <i className="fa-solid fa-copy"></i>
                        <span>Salvar Cópia da Tarefa</span>
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-floppy-disk"></i>
                        <span>Salvar Tarefa</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criação de Tarefas em Massa (Exclusivo CGPG, Vice e Direção) */}
      {!isSomenteLeitura && podeDuplicar && isBulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            {/* Header do Modal */}
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-purple-950 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-400 text-purple-950 font-black flex items-center justify-center text-base shrink-0 shadow-sm">
                  <i className="fa-solid fa-users-gear"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base uppercase tracking-wider flex items-center gap-2">
                    <span>Criar Tarefas em Massa</span>
                    <span className="bg-purple-800 text-purple-200 text-[9px] px-2 py-0.5 rounded-full font-bold border border-purple-600">
                      CGPG / Vice / Direção
                    </span>
                  </h3>
                  <p className="text-[11px] text-purple-200">
                    Crie uma única tarefa e atribua automaticamente a múltiplos usuários ou cargos de uma vez
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="text-purple-200 hover:text-white p-1 rounded-lg cursor-pointer transition-colors"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            {/* Conteúdo do Formulário */}
            <form onSubmit={handleSaveBulkTasks} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {/* Banner Informativo */}
              <div className="bg-purple-50 border border-purple-200 p-3 rounded-xl flex items-start gap-2.5 text-purple-950">
                <div className="w-8 h-8 rounded-lg bg-purple-700 text-white font-black flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                  <i className="fa-solid fa-layer-group text-sm"></i>
                </div>
                <div className="text-xs">
                  <h4 className="font-extrabold text-purple-900 uppercase">Geração Múltipla Independente</h4>
                  <p className="text-[11px] text-purple-800 leading-relaxed mt-0.5">
                    Selecione quantos destinatários (pessoas ou perfis) desejar. O sistema criará <strong>uma cópia individual idêntica para cada um</strong>. Cada usuário poderá acompanhar e concluir sua própria tarefa separadamente.
                  </p>
                </div>
              </div>

              {/* Banner de Sucesso */}
              {bulkSuccessMsg && (
                <div className="bg-emerald-100 border border-emerald-300 p-3 rounded-xl flex items-center gap-2.5 text-emerald-950 font-extrabold text-xs animate-in fade-in">
                  <i className="fa-solid fa-circle-check text-emerald-600 text-lg"></i>
                  <span>{bulkSuccessMsg}</span>
                </div>
              )}

              {/* Título da Tarefa */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Título da Tarefa <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={bulkFormData.titulo}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, titulo: e.target.value })}
                  placeholder="Ex: Entregar Documentos da Matrícula e Termo de Compromisso"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 uppercase"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Descrição / Orientações (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={bulkFormData.descricao}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, descricao: e.target.value })}
                  placeholder="Instruções, diretrizes ou links que serão replicados em todas as tarefas..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-purple-500"
                ></textarea>
              </div>

              {/* Frequência & Datas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Frequência da Ação <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={bulkFormData.frequencia}
                    onChange={(e) => setBulkFormData({ ...bulkFormData, frequencia: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
                  >
                    {FREQUENCIAS.map((f) => (
                      <option key={f.key} value={f.key}>{f.title}</option>
                    ))}
                  </select>
                </div>

                {(bulkFormData.frequencia === 'Ação Pontual (Prazo Fixo)' || bulkFormData.frequencia === 'Pontual') && (
                  <div>
                    <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Data Limite / Prazo <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={bulkFormData.dataInicio}
                      onChange={(e) => setBulkFormData({ ...bulkFormData, dataInicio: e.target.value, dataLimite: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                )}
              </div>

              {/* SELEÇÃO EM MASSA DOS DESTINATÁRIOS */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="block font-black text-slate-900 uppercase tracking-wider">
                      Destinatários das Tarefas <span className="text-red-500">*</span>
                    </label>
                    <p className="text-[11px] text-slate-500">Selecione quem receberá uma cópia desta tarefa:</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {listaUsuariosEquipe.length > 0 && (
                      <button
                        type="button"
                        onClick={handleSelectAllUsersBulk}
                        className="px-2.5 py-1 bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 font-bold rounded-lg text-[10px] transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <i className="fa-solid fa-check-double"></i>
                        <span>Todos os Usuários</span>
                      </button>
                    )}
                    {selectedBulkTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllBulkTargets}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 font-bold rounded-lg text-[10px] transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                        <span>Limpar</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Opção 1: Membros Específicos da Equipe */}
                {listaUsuariosEquipe.length > 0 && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <span className="font-extrabold text-[11px] text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <i className="fa-solid fa-users text-purple-600"></i>
                      <span>Membros Cadastrados na Equipe ({listaUsuariosEquipe.length})</span>
                    </span>

                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                      {listaUsuariosEquipe.map((usr) => {
                        const isSelected = selectedBulkTargets.includes(usr.nome);
                        return (
                          <button
                            key={usr.id || usr.nome}
                            type="button"
                            onClick={() => toggleBulkTarget(usr.nome)}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-purple-700 text-white border-purple-800 shadow-xs ring-2 ring-purple-400'
                                : 'bg-white text-slate-700 border-slate-300 hover:border-purple-300 hover:bg-purple-50/50'
                            }`}
                          >
                            <i className={`fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'} text-[11px]`}></i>
                            <span>{usr.nome}</span>
                            <span className={`text-[9px] px-1 rounded uppercase font-black ${isSelected ? 'bg-purple-900 text-purple-200' : 'bg-slate-100 text-slate-500'}`}>
                              {usr.nivel}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Opção 2: Cargos e Perfis Gerais */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                  <span className="font-extrabold text-[11px] text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <i className="fa-solid fa-user-tag text-indigo-600"></i>
                    <span>Cargos e Níveis Gerais da Escola</span>
                  </span>

                  <div className="flex flex-wrap gap-1.5">
                    {OPCOES_ATRIBUICAO.map((cargo) => {
                      const isSelected = selectedBulkTargets.includes(cargo);
                      return (
                        <button
                          key={cargo}
                          type="button"
                          onClick={() => toggleBulkTarget(cargo)}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-700 text-white border-indigo-800 shadow-xs ring-2 ring-indigo-400'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/50'
                          }`}
                        >
                          <i className={`fa-solid ${isSelected ? 'fa-circle-check' : 'fa-circle'} text-[11px]`}></i>
                          <span>{cargo === 'PAAC' ? 'PAAC (Apoio ao Currículo)' : cargo === 'PROFESSOR' ? 'Professores' : cargo}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Opção 3: Adicionar Destinatário Personalizado */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customBulkInput}
                    onChange={(e) => setCustomBulkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomBulkTarget(e); }}
                    placeholder="Adicionar outro nome/perfil específico (ex: Beltrano)..."
                    className="flex-1 p-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomBulkTarget}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-plus"></i>
                    <span>Adicionar</span>
                  </button>
                </div>

                {/* Resumo dos Selecionados */}
                <div className="bg-purple-950 text-white p-3.5 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider">
                    <span className="flex items-center gap-1.5 text-purple-200">
                      <i className="fa-solid fa-list-check text-cyan-400"></i>
                      <span>Resumo da Atribuição</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-purple-800 text-purple-100 font-mono text-[11px]">
                      {selectedBulkTargets.length} destinatário(s)
                    </span>
                  </div>

                  {selectedBulkTargets.length === 0 ? (
                    <p className="text-[11px] text-purple-300 italic">
                      Nenhum destinatário selecionado ainda. Clique nos nomes ou cargos acima para incluir nesta tarefa em massa.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                      {selectedBulkTargets.map((target) => (
                        <span
                          key={target}
                          className="px-2.5 py-1 rounded-lg bg-purple-800/90 text-purple-100 border border-purple-600 font-bold text-xs flex items-center gap-1.5 shadow-2xs"
                        >
                          <span>{target}</span>
                          <button
                            type="button"
                            onClick={() => toggleBulkTarget(target)}
                            className="hover:text-rose-300 cursor-pointer ml-0.5"
                            title="Remover destinatário"
                          >
                            <i className="fa-solid fa-xmark text-xs"></i>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Botoes de Ação */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={bulkSaving || selectedBulkTargets.length === 0}
                  className="px-5 py-2.5 bg-purple-700 hover:bg-purple-800 text-white font-extrabold rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 text-xs uppercase tracking-wider"
                >
                  {bulkSaving ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>Criando {selectedBulkTargets.length} Tarefas...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-users-gear"></i>
                      <span>Criar {selectedBulkTargets.length} Tarefa(s) em Massa</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
