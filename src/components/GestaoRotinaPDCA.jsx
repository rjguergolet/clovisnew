import React, { useState, useEffect, useMemo } from 'react';
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
  onSnapshot
} from '../lib/database';

/**
 * Módulo Otimizado: Tarefas & Rotina PDCA (Exclusivo para Equipe Gestora & Apoio Pedagógico)
 * Perfis autorizados: DIRETOR, VICE_DIRETOR, CGPG, CGPCG, PAAC, PROFESSOR_PAAC
 *
 * Funcionalidades:
 * - Controle de periodicidade (Diária, Semanal, Mensal, Bimestral, Semestral, Anual e Ação Pontual)
 * - Regras configuráveis por ciclo: dia da semana (Semanal), dia do mês (Mensal/Bimestral/Semestral/Anual),
 *   mês específico (Anual/Bimestral/Semestral), horário limite & dias úteis (Diária) e janela de aviso amarelo.
 * - Destaque automático em AMARELO ("Prestes a vencer" / "Vence hoje") e VERMELHO ("Atrasada").
 * - Visão orientada à execução (Prioridade / Periodicidade / Por Equipe) com conclusão em 1 clique.
 */

export const DIAS_SEMANA_OPCOES = [
  { value: 1, short: 'Seg', label: 'Segunda-feira' },
  { value: 2, short: 'Ter', label: 'Terça-feira' },
  { value: 3, short: 'Qua', label: 'Quarta-feira' },
  { value: 4, short: 'Qui', label: 'Quinta-feira' },
  { value: 5, short: 'Sex', label: 'Sexta-feira' },
  { value: 6, short: 'Sáb', label: 'Sábado' },
  { value: 0, short: 'Dom', label: 'Domingo' }
];

export const MESES_ANO_OPCOES = [
  { value: 1, short: 'Jan', label: 'Janeiro' },
  { value: 2, short: 'Fev', label: 'Fevereiro' },
  { value: 3, short: 'Mar', label: 'Março' },
  { value: 4, short: 'Abr', label: 'Abril' },
  { value: 5, short: 'Mai', label: 'Maio' },
  { value: 6, short: 'Jun', label: 'Junho' },
  { value: 7, short: 'Jul', label: 'Julho' },
  { value: 8, short: 'Ago', label: 'Agosto' },
  { value: 9, short: 'Set', label: 'Setembro' },
  { value: 10, short: 'Out', label: 'Outubro' },
  { value: 11, short: 'Nov', label: 'Novembro' },
  { value: 12, short: 'Dez', label: 'Dezembro' }
];

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
    label: 'Diária',
    plural: 'Diárias',
    defaultAntecedencia: 0,
    icon: 'fa-sun',
    accentColor: 'text-emerald-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Semanal',
    title: 'Rotina Semanal',
    label: 'Semanal',
    plural: 'Semanais',
    defaultAntecedencia: 1,
    icon: 'fa-calendar-week',
    accentColor: 'text-sky-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Mensal',
    title: 'Rotina Mensal',
    label: 'Mensal',
    plural: 'Mensais',
    defaultAntecedencia: 3,
    icon: 'fa-calendar-days',
    accentColor: 'text-amber-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Bimestral',
    title: 'Rotina Bimestral',
    label: 'Bimestral',
    plural: 'Bimestrais',
    defaultAntecedencia: 5,
    icon: 'fa-layer-group',
    accentColor: 'text-purple-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Semestral',
    title: 'Rotina Semestral',
    label: 'Semestral',
    plural: 'Semestrais',
    defaultAntecedencia: 7,
    icon: 'fa-graduation-cap',
    accentColor: 'text-indigo-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Anual',
    title: 'Rotina Anual',
    label: 'Anual',
    plural: 'Anuais',
    defaultAntecedencia: 15,
    icon: 'fa-flag-checkered',
    accentColor: 'text-rose-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  },
  {
    key: 'Ação Pontual (Prazo Fixo)',
    title: 'Ações Pontuais (Prazo Fixo)',
    label: 'Pontual',
    plural: 'Pontuais',
    defaultAntecedencia: 2,
    icon: 'fa-calendar-check',
    accentColor: 'text-slate-700',
    activeTabClass: 'bg-slate-900 text-white border-slate-900'
  }
];

const PERFIS_AUTORIZADOS_PDCA = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC'];

const hierarquiaVisibilidade = {
  'DIRETOR': ['DIRETOR', 'VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'VICE_DIRETOR': ['VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'VICE-DIRETOR': ['VICE_DIRETOR', 'VICE-DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'CGPG': ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'CGPCG': ['CGPG', 'CGPCG', 'PAAC', 'PROFESSOR', 'TODA A EQUIPE'],
  'PAAC': ['PAAC', 'TODA A EQUIPE'],
  'PROFESSOR_PAAC': ['PAAC', 'TODA A EQUIPE']
};

const OPCOES_ATRIBUICAO = [
  'TODA A EQUIPE',
  'DIRETOR',
  'VICE_DIRETOR',
  'CGPG',
  'PAAC'
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoLocal(dateObj) {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
}

function parseIsoDateLocal(isoStr) {
  if (!isoStr) return null;
  const clean = String(isoStr).trim().slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

function diffDaysLocal(targetIso, baseDate = new Date()) {
  const target = parseIsoDateLocal(targetIso);
  if (!target) return null;
  const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function getDaysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function getMondayOfWeek(dateObj) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
  const day = d.getDay(); // 0=Dom..6=Sab
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMon);
  return d;
}

function formatIsoShortBr(isoStr) {
  if (!isoStr) return '';
  const parts = String(isoStr).slice(0, 10).split('-');
  if (parts.length !== 3) return isoStr;
  return `${parts[2]}/${parts[1]}`;
}

function formatIsoFullBr(isoStr) {
  if (!isoStr) return '';
  const parts = String(isoStr).slice(0, 10).split('-');
  if (parts.length !== 3) return isoStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function getDefaultAntecedencia(freqKey) {
  const found = FREQUENCIAS.find((f) => f.key === freqKey);
  return found ? found.defaultAntecedencia : 2;
}

/**
 * Extrai a data (YYYY-MM-DD) da última conclusão registrada na tarefa
 */
function extrairDataConclusaoIso(tarefa) {
  if (!tarefa) return null;
  if (tarefa.ultimaDataConclusao) {
    const s = String(tarefa.ultimaDataConclusao).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  if (tarefa.ultimaConclusao) {
    if (typeof tarefa.ultimaConclusao.toDate === 'function') {
      return toIsoLocal(tarefa.ultimaConclusao.toDate());
    }
    const dt = new Date(tarefa.ultimaConclusao);
    if (!isNaN(dt.getTime())) return toIsoLocal(dt);
  }
  return null;
}

/**
 * Retorna texto legível descrevendo a regra configurada da recorrência
 */
export function formatarRegraRecorrencia(tarefa) {
  const freq = getNormalizedFreqKey(tarefa);
  const regra = tarefa?.regraRecorrencia || {};
  const diasAnt = regra.diasAntecedencia !== undefined && regra.diasAntecedencia !== null
    ? Number(regra.diasAntecedencia)
    : getDefaultAntecedencia(freq);

  if (freq === 'Diária') {
    const segSex = regra.apenasDiasUteis !== false ? 'Seg a Sex' : 'Todos os dias';
    const hora = regra.horarioLimite ? ` · até ${regra.horarioLimite}` : '';
    return `${segSex}${hora}`;
  }
  if (freq === 'Semanal') {
    const diaSem = regra.diaSemana !== undefined && regra.diaSemana !== null ? Number(regra.diaSemana) : 5;
    const diaObj = DIAS_SEMANA_OPCOES.find((d) => d.value === diaSem) || DIAS_SEMANA_OPCOES[4];
    return `Toda ${diaObj.label} · alerta ${diasAnt}d antes`;
  }
  if (freq === 'Mensal') {
    const diaMes = Number(regra.diaMes) || 25;
    return `Todo dia ${pad2(diaMes)} · alerta ${diasAnt}d antes`;
  }
  if (freq === 'Bimestral') {
    const mesBim = Number(regra.mesNoBimestre) === 1 ? '1º mês' : '2º mês';
    const diaMes = Number(regra.diaMes) || 20;
    return `${mesBim} do bimestre, dia ${pad2(diaMes)} · alerta ${diasAnt}d antes`;
  }
  if (freq === 'Semestral') {
    const mesSem = Math.min(6, Math.max(1, Number(regra.mesNoSemestre) || 6));
    const diaMes = Number(regra.diaMes) || 15;
    return `${mesSem}º mês do semestre, dia ${pad2(diaMes)} · alerta ${diasAnt}d antes`;
  }
  if (freq === 'Anual') {
    const mesAno = Math.min(12, Math.max(1, Number(regra.mesAno) || 11));
    const diaMes = Number(regra.diaMes) || 15;
    const mesObj = MESES_ANO_OPCOES.find((m) => m.value === mesAno) || MESES_ANO_OPCOES[10];
    return `Todo ${pad2(diaMes)} de ${mesObj.short} · alerta ${diasAnt}d antes`;
  }
  const dtRef = tarefa?.dataFim || tarefa?.dataLimite || tarefa?.dataInicio;
  return dtRef ? `Prazo ${formatIsoFullBr(dtRef)} · alerta ${diasAnt}d antes` : 'Prazo não definido';
}

/**
 * Helper para obter o e-mail do usuário logado na sessão
 */
export function getCurrentUserEmail() {
  if (typeof window.obterIdentificacaoUsuarioCompleta === 'function') {
    const info = window.obterIdentificacaoUsuarioCompleta();
    if (info && info.email) return info.email.toLowerCase().trim();
  }
  try {
    const usuarioSalvo = localStorage.getItem('usuarioLogado');
    if (usuarioSalvo) {
      const parsed = JSON.parse(usuarioSalvo);
      if (parsed && parsed.email) return parsed.email.toLowerCase().trim();
    }
  } catch {
    // ignore
  }
  if (window.currentUserEmail) return String(window.currentUserEmail).toLowerCase().trim();
  return 'usuario@escola.sp.gov.br';
}

/**
 * Motor de Renovação Automática Temporal & Status Unificado no ciclo vigente
 */
export function verificarStatus(tarefa) {
  if (!tarefa) return false;

  const isConcluidoFlag =
    tarefa.concluido === true ||
    tarefa.concluido === 'true' ||
    (Array.isArray(tarefa.concluidaPor) && tarefa.concluidaPor.length > 0) ||
    (Array.isArray(tarefa.concluidoPor) && tarefa.concluidoPor.length > 0);

  if (!isConcluidoFlag) return false;

  const freq = getNormalizedFreqKey(tarefa);
  const dtUltimaIso = extrairDataConclusaoIso(tarefa);
  const hoje = new Date();
  const hojeStr = toIsoLocal(hoje);

  if (freq === 'Ação Pontual (Prazo Fixo)') {
    return true;
  }

  if (!dtUltimaIso) return false;

  if (freq === 'Diária') {
    return dtUltimaIso >= hojeStr;
  }

  if (freq === 'Semanal') {
    const mondayStr = toIsoLocal(getMondayOfWeek(hoje));
    return dtUltimaIso >= mondayStr;
  }

  const dtUltima = parseIsoDateLocal(dtUltimaIso);
  if (!dtUltima) return false;

  if (freq === 'Mensal') {
    return (
      dtUltima.getFullYear() === hoje.getFullYear() &&
      dtUltima.getMonth() === hoje.getMonth()
    );
  }

  if (freq === 'Bimestral') {
    return (
      dtUltima.getFullYear() === hoje.getFullYear() &&
      Math.floor(dtUltima.getMonth() / 2) === Math.floor(hoje.getMonth() / 2)
    );
  }

  if (freq === 'Semestral') {
    const semHoje = hoje.getMonth() < 6 ? 1 : 2;
    const semUlt = dtUltima.getMonth() < 6 ? 1 : 2;
    return dtUltima.getFullYear() === hoje.getFullYear() && semUlt === semHoje;
  }

  if (freq === 'Anual') {
    return dtUltima.getFullYear() === hoje.getFullYear();
  }

  return true;
}

/**
 * Calcula vencimento do ciclo vigente, dias restantes, alerta amarelo ("prestes a vencer") e atraso
 */
export function calcularStatusPrazoTarefa(tarefa, nowOverride = null) {
  const agora = nowOverride || new Date();
  const hojeIso = toIsoLocal(agora);
  const freq = getNormalizedFreqKey(tarefa);
  const regra = tarefa?.regraRecorrencia || {};
  const concluida = verificarStatus(tarefa);
  const diasAntecedencia = Math.max(
    0,
    Number(
      regra.diasAntecedencia !== undefined && regra.diasAntecedencia !== null
        ? regra.diasAntecedencia
        : getDefaultAntecedencia(freq)
    ) || 0
  );

  let dueIso = null;
  let dueLabel = '';

  if (freq === 'Diária') {
    dueIso = hojeIso;
    const apenasUteis = regra.apenasDiasUteis !== false;
    const dow = agora.getDay();
    const ehFimDeSemana = dow === 0 || dow === 6;

    if (concluida) {
      return {
        concluida: true,
        nivelUrgencia: 'CONCLUIDA',
        emAlertaAmarelo: false,
        atrasada: false,
        dataVencimentoIso: hojeIso,
        dataVencimentoLabel: `Hoje (${formatIsoShortBr(hojeIso)})`,
        regraResumo: formatarRegraRecorrencia(tarefa),
        contagemLabel: 'Concluída hoje',
        diasRestantes: 0
      };
    }

    if (apenasUteis && ehFimDeSemana) {
      return {
        concluida: false,
        nivelUrgencia: 'NO_PRAZO',
        emAlertaAmarelo: false,
        atrasada: false,
        dataVencimentoIso: hojeIso,
        dataVencimentoLabel: 'Próximo dia útil',
        regraResumo: formatarRegraRecorrencia(tarefa),
        contagemLabel: 'Pausa de fim de semana',
        diasRestantes: 1
      };
    }

    if (regra.horarioLimite && /^\d{2}:\d{2}$/.test(regra.horarioLimite)) {
      const [hh, mm] = regra.horarioLimite.split(':').map(Number);
      const minAgora = agora.getHours() * 60 + agora.getMinutes();
      const minLimite = hh * 60 + mm;
      if (minAgora > minLimite) {
        return {
          concluida: false,
          nivelUrgencia: 'ATRASADA',
          emAlertaAmarelo: false,
          atrasada: true,
          dataVencimentoIso: hojeIso,
          dataVencimentoLabel: `Hoje até ${regra.horarioLimite}`,
          regraResumo: formatarRegraRecorrencia(tarefa),
          contagemLabel: `Passou do horário (${regra.horarioLimite})`,
          diasRestantes: 0
        };
      }
      return {
        concluida: false,
        nivelUrgencia: 'VENCE_HOJE',
        emAlertaAmarelo: true,
        atrasada: false,
        dataVencimentoIso: hojeIso,
        dataVencimentoLabel: `Hoje até ${regra.horarioLimite}`,
        regraResumo: formatarRegraRecorrencia(tarefa),
        contagemLabel: `Vence hoje até ${regra.horarioLimite}`,
        diasRestantes: 0
      };
    }

    return {
      concluida: false,
      nivelUrgencia: 'VENCE_HOJE',
      emAlertaAmarelo: true,
      atrasada: false,
      dataVencimentoIso: hojeIso,
      dataVencimentoLabel: `Hoje (${formatIsoShortBr(hojeIso)})`,
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: 'Rotina de hoje · pendente',
      diasRestantes: 0
    };
  }

  if (freq === 'Semanal') {
    const diaSemana = regra.diaSemana !== undefined && regra.diaSemana !== null ? Number(regra.diaSemana) : 5;
    const monday = getMondayOfWeek(agora);
    const offsetFromMon = diaSemana === 0 ? 6 : diaSemana - 1;
    const dueDt = new Date(monday);
    dueDt.setDate(monday.getDate() + offsetFromMon);
    dueIso = toIsoLocal(dueDt);
    const diaObj = DIAS_SEMANA_OPCOES.find((d) => d.value === diaSemana) || DIAS_SEMANA_OPCOES[4];
    dueLabel = `${diaObj.short}, ${formatIsoShortBr(dueIso)}`;
  } else if (freq === 'Mensal') {
    const year = agora.getFullYear();
    const month0 = agora.getMonth();
    const maxDay = getDaysInMonth(year, month0);
    const diaClamped = Math.min(maxDay, Math.max(1, Number(regra.diaMes) || 25));
    dueIso = `${year}-${pad2(month0 + 1)}-${pad2(diaClamped)}`;
    dueLabel = `Dia ${formatIsoShortBr(dueIso)}`;
  } else if (freq === 'Bimestral') {
    const year = agora.getFullYear();
    const bimesterStartMonth0 = Math.floor(agora.getMonth() / 2) * 2;
    const targetMonth0 = Number(regra.mesNoBimestre) === 1 ? bimesterStartMonth0 : bimesterStartMonth0 + 1;
    const maxDay = getDaysInMonth(year, targetMonth0);
    const diaClamped = Math.min(maxDay, Math.max(1, Number(regra.diaMes) || 20));
    dueIso = `${year}-${pad2(targetMonth0 + 1)}-${pad2(diaClamped)}`;
    dueLabel = `Dia ${formatIsoShortBr(dueIso)}`;
  } else if (freq === 'Semestral') {
    const year = agora.getFullYear();
    const semStartMonth0 = agora.getMonth() < 6 ? 0 : 6;
    const mesOffset = Math.min(5, Math.max(0, (Number(regra.mesNoSemestre) || 6) - 1));
    const targetMonth0 = semStartMonth0 + mesOffset;
    const maxDay = getDaysInMonth(year, targetMonth0);
    const diaClamped = Math.min(maxDay, Math.max(1, Number(regra.diaMes) || 15));
    dueIso = `${year}-${pad2(targetMonth0 + 1)}-${pad2(diaClamped)}`;
    dueLabel = `${formatIsoFullBr(dueIso)}`;
  } else if (freq === 'Anual') {
    const year = agora.getFullYear();
    const targetMonth0 = Math.min(11, Math.max(0, (Number(regra.mesAno) || 11) - 1));
    const maxDay = getDaysInMonth(year, targetMonth0);
    const diaClamped = Math.min(maxDay, Math.max(1, Number(regra.diaMes) || 15));
    dueIso = `${year}-${pad2(targetMonth0 + 1)}-${pad2(diaClamped)}`;
    dueLabel = `${formatIsoFullBr(dueIso)}`;
  } else {
    // Ação Pontual (Prazo Fixo)
    const rawTarget = tarefa?.dataFim || tarefa?.dataLimite || tarefa?.dataInicio;
    dueIso = rawTarget ? String(rawTarget).trim().slice(0, 10) : null;
    dueLabel = dueIso ? formatIsoFullBr(dueIso) : 'Sem prazo';
  }

  const diasRestantes = dueIso ? diffDaysLocal(dueIso, agora) : null;

  if (concluida) {
    return {
      concluida: true,
      nivelUrgencia: 'CONCLUIDA',
      emAlertaAmarelo: false,
      atrasada: false,
      dataVencimentoIso: dueIso,
      dataVencimentoLabel: dueLabel,
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: 'Concluída no ciclo',
      diasRestantes
    };
  }

  if (diasRestantes === null) {
    return {
      concluida: false,
      nivelUrgencia: 'NO_PRAZO',
      emAlertaAmarelo: false,
      atrasada: false,
      dataVencimentoIso: null,
      dataVencimentoLabel: 'Sem prazo',
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: 'Sem vencimento definido',
      diasRestantes: null
    };
  }

  if (diasRestantes < 0) {
    const diasAtraso = Math.abs(diasRestantes);
    return {
      concluida: false,
      nivelUrgencia: 'ATRASADA',
      emAlertaAmarelo: false,
      atrasada: true,
      dataVencimentoIso: dueIso,
      dataVencimentoLabel: dueLabel,
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: `Atrasada há ${diasAtraso} ${diasAtraso === 1 ? 'dia' : 'dias'}`,
      diasRestantes
    };
  }

  if (diasRestantes === 0) {
    return {
      concluida: false,
      nivelUrgencia: 'VENCE_HOJE',
      emAlertaAmarelo: true,
      atrasada: false,
      dataVencimentoIso: dueIso,
      dataVencimentoLabel: dueLabel,
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: 'Vence hoje',
      diasRestantes: 0
    };
  }

  if (diasRestantes <= diasAntecedencia) {
    return {
      concluida: false,
      nivelUrgencia: 'PRESTES_A_VENCER',
      emAlertaAmarelo: true,
      atrasada: false,
      dataVencimentoIso: dueIso,
      dataVencimentoLabel: dueLabel,
      regraResumo: formatarRegraRecorrencia(tarefa),
      contagemLabel: diasRestantes === 1 ? 'Prestes a vencer · amanhã' : `Prestes a vencer · em ${diasRestantes} dias`,
      diasRestantes
    };
  }

  return {
    concluida: false,
    nivelUrgencia: 'NO_PRAZO',
    emAlertaAmarelo: false,
    atrasada: false,
    dataVencimentoIso: dueIso,
    dataVencimentoLabel: dueLabel,
    regraResumo: formatarRegraRecorrencia(tarefa),
    contagemLabel: `Faltam ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`,
    diasRestantes
  };
}

export function getCountConcluidos(task) {
  if (!task) return 0;
  return verificarStatus(task) ? 1 : 0;
}

export function getQuemConcluiu(task, listaUsuariosEquipe = []) {
  if (!task) return [];
  if (!verificarStatus(task)) return [];

  const rawList = Array.isArray(task.concluidaPor)
    ? task.concluidaPor
    : Array.isArray(task.concluidoPor)
    ? task.concluidoPor
    : [];
  const nomes = [];

  if (rawList.length > 0) {
    rawList.forEach((item) => {
      const itemStr = String(item).trim();
      if (!itemStr) return;
      const itemLower = itemStr.toLowerCase();

      const userFound =
        Array.isArray(listaUsuariosEquipe) &&
        listaUsuariosEquipe.find(
          (u) =>
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
    if (task.concluidoPorNome) {
      nomes.push(task.concluidoPorNome);
    } else if (task.atualizadoPor) {
      let display = String(task.atualizadoPor);
      const match = display.match(/\(([^)]+)\)/);
      if (match && match[1]) {
        const email = match[1].toLowerCase().trim();
        const u =
          Array.isArray(listaUsuariosEquipe) &&
          listaUsuariosEquipe.find((usr) => usr.email && usr.email.toLowerCase().trim() === email);
        if (u && u.nome) display = u.nome;
        else {
          const part = match[1].split('@')[0];
          display = part.charAt(0).toUpperCase() + part.slice(1);
        }
      }
      nomes.push(display);
    } else {
      nomes.push('Concluída');
    }
  }

  return nomes;
}

export function renderTextoComLinks(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const rawParts = texto.split(urlRegex);

  return rawParts.map((part, index) => {
    if (!part) return null;
    if (part.match(/^(https?:\/\/|www\.)/i)) {
      const cleanUrl = part.replace(/[.,;)]+$/, '');
      const trailing = part.slice(cleanUrl.length);
      const href = cleanUrl.toLowerCase().startsWith('www.') ? `https://${cleanUrl}` : cleanUrl;

      return (
        <React.Fragment key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-blue-700 hover:text-blue-900 underline font-medium inline-flex items-center gap-1 mx-0.5 break-all cursor-pointer"
            title={`Abrir em nova aba: ${href}`}
          >
            <span>{cleanUrl}</span>
            <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export const NIVEIS_DEFINICOES = [
  {
    key: 'TODA A EQUIPE',
    label: 'Toda a Equipe',
    title: 'Toda a Equipe Gestora',
    description: 'Rotinas compartilhadas entre Direção, Vice-Direção, Coordenação e PAAC',
    icon: 'fa-users-gear',
    barColor: 'bg-indigo-600'
  },
  {
    key: 'DIRETOR',
    label: 'Direção',
    title: 'Direção Escolar',
    description: 'Diretrizes institucionais, gestão financeira, conselho escolar e comunidade',
    icon: 'fa-user-tie',
    barColor: 'bg-purple-600'
  },
  {
    key: 'VICE_DIRETOR',
    label: 'Vice-Direção',
    title: 'Vice-Direção',
    description: 'Busca ativa escolar, ocorrências, mediação de conflitos e infraestrutura',
    icon: 'fa-user-shield',
    barColor: 'bg-amber-500'
  },
  {
    key: 'CGPG',
    label: 'CGPG',
    title: 'Coordenação Pedagógica (CGPG)',
    description: 'Guias de aprendizagem, observação de aula, ATPCs e indicadores',
    icon: 'fa-user-graduate',
    barColor: 'bg-emerald-500'
  },
  {
    key: 'PAAC',
    label: 'PAAC',
    title: 'PAAC (Apoio ao Currículo)',
    description: 'Nivelamento, acompanhamento de aprendizagem e apoio pedagógico',
    icon: 'fa-user-pen',
    barColor: 'bg-cyan-600'
  },
  {
    key: 'PROFESSOR',
    label: 'Docentes',
    title: 'Corpo Docente (Referência)',
    description: 'Registros e prazos acompanhados pela coordenação',
    icon: 'fa-chalkboard-user',
    barColor: 'bg-sky-500'
  },
  {
    key: 'INDIVIDUAL',
    label: 'Individuais',
    title: 'Atribuições Nominais',
    description: 'Tarefas direcionadas a membros específicos da equipe',
    icon: 'fa-user-check',
    barColor: 'bg-fuchsia-600'
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
    const usr = listaUsuariosEquipe.find((u) => {
      const uNome = (u.nome || '').toUpperCase().trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      return (
        uNome &&
        (uNome === target ||
          target.includes(uNome) ||
          uNome.includes(target) ||
          (uEmail && target.toLowerCase().includes(uEmail)))
      );
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

function getDefaultRegraForm(freq = 'Diária') {
  const norm = getNormalizedFreqKey(freq);
  return {
    diaSemana: 5, // Sexta-feira padrão
    diaMes: norm === 'Mensal' ? 25 : norm === 'Bimestral' ? 20 : 15,
    mesNoBimestre: 2,
    mesNoSemestre: 6,
    mesAno: 11,
    horarioLimite: '',
    apenasDiasUteis: true,
    diasAntecedencia: getDefaultAntecedencia(norm)
  };
}

export default function GestaoRotinaPDCA() {
  const [userRole, setUserRole] = useState('PROFESSOR');
  const [tarefas, setTarefas] = useState(() => (Array.isArray(window.tasksCache) ? window.tasksCache : []));
  const [loading, setLoading] = useState(true);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  // Modos de visualização & filtros orientados à execução
  const [viewMode, setViewMode] = useState('PRIORIDADE'); // 'PRIORIDADE' | 'PERIODICIDADE' | 'EQUIPE'
  const [filtroUrgencia, setFiltroUrgencia] = useState('PENDENTES'); // 'PENDENTES' | 'AMARELO' | 'ATRASADAS' | 'CONCLUIDAS' | 'TODAS'
  const [selectedFreq, setSelectedFreq] = useState('');
  const [selectedNivel, setSelectedNivel] = useState('TODOS');
  const [filtroEscopo, setFiltroEscopo] = useState('MINHAS');
  const [searchTerm, setSearchTerm] = useState('');

  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [expandedDescTasks, setExpandedDescTasks] = useState({});

  const toggleGroupCollapse = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTaskDesc = (taskId) => {
    setExpandedDescTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  // Modal Criar / Editar / Duplicar
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [formData, setFormData] = useState({
    id: null,
    titulo: '',
    descricao: '',
    frequencia: 'Diária',
    atribuirA: 'TODA A EQUIPE',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: '',
    dataLimite: '',
    regraRecorrencia: getDefaultRegraForm('Diária')
  });
  const [saving, setSaving] = useState(false);
  const [listaUsuariosEquipe, setListaUsuariosEquipe] = useState([]);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState(null);
  const [confirmRenewCycle, setConfirmRenewCycle] = useState(null); // 'DIARIO' | 'SEMANAL' | 'MENSAL' | null
  const [showRenewMenu, setShowRenewMenu] = useState(false);

  // Modal Criação em Massa
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkFormData, setBulkFormData] = useState({
    titulo: '',
    descricao: '',
    frequencia: 'Diária',
    dataInicio: '',
    horaInicio: '',
    dataFim: '',
    horaFim: '',
    dataLimite: '',
    regraRecorrencia: getDefaultRegraForm('Diária')
  });
  const [selectedBulkTargets, setSelectedBulkTargets] = useState([]);
  const [customBulkInput, setCustomBulkInput] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState('');

  const [renovandoCiclo, setRenovandoCiclo] = useState(false);

  const showFeedback = (msg, type = 'info') => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(msg, type, 4000);
    }
  };

  // 1. Monitorar perfil do usuário logado
  useEffect(() => {
    const updateRole = () => {
      const role =
        typeof window.obterRoleAtual === 'function'
          ? window.obterRoleAtual()
          : window.currentUserRole || 'PROFESSOR';
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

  const getNormalizedCargo = (raw) => {
    if (!raw) return 'PROFESSOR';
    const str = String(raw).toUpperCase().trim().replace(/-/g, '_');
    if (str.includes('VICE')) return 'VICE_DIRETOR';
    if (str.includes('DIRETOR') || str.includes('DIRECAO') || str.includes('DIREÇÃO')) return 'DIRETOR';
    if (str.includes('CGPG') || str.includes('CGPCG') || str.includes('COORDENA')) return 'CGPG';
    if (str.includes('SECRETARIA')) return 'SECRETARIA';
    if (str === 'PAAC' || str === 'PROFESSOR_PAAC' || str.includes('PAAC')) return 'PAAC';
    if (str.includes('PROFESSOR') || str.includes('TUTOR') || str.includes('DOCENTE')) return 'PROFESSOR';
    return str;
  };

  const cargoBruto = String(userRole || '').toUpperCase().trim();
  const cargoLogado = getNormalizedCargo(cargoBruto);

  // CONTROLE ESTRITO DE ACESSO ("Só pra quem tem que ter acesso a isso")
  const isAuthorized = PERFIS_AUTORIZADOS_PDCA.includes(cargoLogado);
  const podeGerenciarEquipe = ['DIRETOR', 'VICE_DIRETOR', 'CGPG'].includes(cargoLogado);
  const podeDuplicar = ['DIRETOR', 'VICE_DIRETOR', 'CGPG'].includes(cargoLogado);
  const podeRenovarCiclo = ['DIRETOR', 'VICE_DIRETOR', 'CGPG'].includes(cargoLogado);
  const podeExcluirTarefa = typeof window !== 'undefined' && typeof window.podeExcluir === 'function'
    ? window.podeExcluir()
    : ['DIRETOR', 'VICE_DIRETOR'].includes(cargoLogado);

  // Carregar lista de usuários da equipe autorizada
  useEffect(() => {
    if (!isAuthorized) return;
    const carregarUsuarios = async () => {
      try {
        const querySnap = await getDocs(collection(db, 'usuarios'));
        const list = [];
        querySnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d && d.nome) {
            list.push({
              id: docSnap.id,
              nome: String(d.nome).trim(),
              nivel: d.nivel || d.cargo || 'Equipe',
              email: d.email || ''
            });
          }
        });
        list.sort((a, b) => a.nome.localeCompare(b.nome));
        if (list.length > 0) {
          setListaUsuariosEquipe(list);
        }
      } catch (err) {
        console.warn('Erro ao carregar lista de usuários da equipe para tarefas:', err);
      }
    };
    carregarUsuarios();
  }, [isAuthorized]);

  // 2. Listener em tempo real de rotina_equipe
  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }
    setLoading(true);

    if (Array.isArray(window.tasksCache) && window.tasksCache.length > 0) {
      setTarefas(window.tasksCache);
      setLoading(false);
    }

    const colRef = collection(db, 'rotina_equipe');
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const lista = [];
        snapshot.forEach((docSnap) => {
          lista.push({ id: docSnap.id, ...docSnap.data() });
        });

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
      },
      (err) => {
        console.warn('Aviso no listener em tempo real de rotina_equipe:', err);
        setIsRealtimeConnected(false);
        setLoading(false);
        if (Array.isArray(window.tasksCache) && window.tasksCache.length > 0) {
          setTarefas(window.tasksCache);
        }
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isAuthorized]);

  const carregarTarefas = async () => {
    if (!isAuthorized) return;
    setLoading(true);
    try {
      const serverSnap = await getDocs(collection(db, 'rotina_equipe'));
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
      console.warn('Aviso ao recarregar tarefas manualmente:', e);
    } finally {
      setLoading(false);
    }
  };

  const seedInitialTasks = async () => {
    const seedData = [
      {
        titulo: 'Verificar Frequência e Alunos Faltosos na Busca Ativa',
        descricao: 'Acompanhar dados do dia e acionar agentes para contato telefônico ou visita.',
        frequencia: 'Diária',
        regraRecorrencia: { apenasDiasUteis: true, horarioLimite: '10:30', diasAntecedencia: 0 },
        atribuirA: 'TODA A EQUIPE',
        atribuidoA: 'TODA A EQUIPE',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Alinhamento da Coordenação Geral Pedagógica (CGPG)',
        descricao: 'Revisar acompanhamento dos guias de aprendizagem e alinhamento com os CGPCAs.',
        frequencia: 'Semanal',
        regraRecorrencia: { diaSemana: 5, diasAntecedencia: 1 },
        atribuirA: 'CGPG',
        atribuidoA: 'CGPG',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Análise de Indicadores de Rendimento e Faltas Consecutivas',
        descricao: 'Consolidar gráficos mensais para reunião com corpo docente e conselho de escola.',
        frequencia: 'Mensal',
        regraRecorrencia: { diaMes: 25, diasAntecedencia: 3 },
        atribuirA: 'DIRETOR',
        atribuidoA: 'DIRETOR',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Reunião de Alinhamento com a Vice-Direção e Infraestrutura',
        descricao: 'Verificar zeladoria, merenda escolar e registros de ocorrências disciplinares.',
        frequencia: 'Semanal',
        regraRecorrencia: { diaSemana: 1, diasAntecedencia: 1 },
        atribuirA: 'VICE_DIRETOR',
        atribuidoA: 'VICE_DIRETOR',
        concluido: false,
        ultimaConclusao: null,
        criadoEm: new Date().toISOString()
      },
      {
        titulo: 'Avaliação Bimestral dos Eixos PEI (Tutoria, Eletivas e Clubes)',
        descricao: 'Monitorar capacidade dos grupos e progresso dos Projetos de Vida dos estudantes.',
        frequencia: 'Bimestral',
        regraRecorrencia: { mesNoBimestre: 2, diaMes: 20, diasAntecedencia: 5 },
        atribuirA: 'TODA A EQUIPE',
        atribuidoA: 'TODA A EQUIPE',
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
        } catch {
          // ignore offline
        }
      }
    } catch (e) {
      console.warn('Aviso ao semear rotina_equipe:', e);
    }

    const localSeeded = seedData.map((item, idx) => ({ id: `local-seed-${idx + 1}`, ...item }));
    window.tasksCache = localSeeded;
    setTarefas(localSeeded);
    setLoading(false);
  };

  // Visibilidade hierárquica por cargo
  const papeisPermitidos = hierarquiaVisibilidade[cargoBruto] || hierarquiaVisibilidade[cargoLogado] || ['TODA A EQUIPE'];

  const isTargetPermitted = (targetRaw) => {
    if (!targetRaw) return true;
    const target = String(targetRaw).toUpperCase().trim();

    if (cargoLogado === 'DIRETOR') return true;

    const userEmailLogado = getCurrentUserEmail();
    const userDetails =
      typeof window.obterIdentificacaoUsuarioCompleta === 'function'
        ? window.obterIdentificacaoUsuarioCompleta()
        : null;
    const nomeLogado = (userDetails?.textoCompleto || userDetails?.nome || '').toUpperCase();

    const isAssignedToMe =
      (nomeLogado && (nomeLogado.includes(target) || target.includes(nomeLogado))) ||
      (userEmailLogado && target.toLowerCase().includes(userEmailLogado.toLowerCase()));

    if (isAssignedToMe) return true;

    if (target === 'TODA A EQUIPE' || target === 'TODA_EQUIPE' || target === 'EQUIPE GESTORA COMPLETA') {
      return true;
    }

    let targetRole = null;
    if (target.includes('DIRETOR') && !target.includes('VICE')) targetRole = 'DIRETOR';
    else if (target.includes('VICE')) targetRole = 'VICE_DIRETOR';
    else if (target.includes('CGPG') || target.includes('CGPCG') || target.includes('COORDENA')) targetRole = 'CGPG';
    else if (target.includes('PAAC')) targetRole = 'PAAC';
    else if (target.includes('PROFESSOR')) targetRole = 'PROFESSOR';

    if (!targetRole && Array.isArray(listaUsuariosEquipe) && listaUsuariosEquipe.length > 0) {
      const targetUserObj = listaUsuariosEquipe.find((u) => {
        const uNome = (u.nome || '').toUpperCase().trim();
        const uEmail = (u.email || '').toLowerCase().trim();
        return (
          uNome &&
          (uNome === target ||
            target.includes(uNome) ||
            uNome.includes(target) ||
            (uEmail && target.toLowerCase().includes(uEmail)))
        );
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

  const isTaskDizRespeitoAoUsuario = (task) => {
    if (!task) return false;
    const target = String(task?.atribuidoA || task?.atribuirA || '').trim();
    if (!target) return true;

    const targetUpper = target.toUpperCase();
    if (['TODA A EQUIPE', 'TODA_EQUIPE', 'TODOS', 'GERAL'].includes(targetUpper)) return true;

    if (targetUpper.includes('GESTORA') || targetUpper.includes('GESTAO')) {
      return ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC'].includes(cargoLogado);
    }

    const userEmailLogado = getCurrentUserEmail();
    const userDetails =
      typeof window.obterIdentificacaoUsuarioCompleta === 'function'
        ? window.obterIdentificacaoUsuarioCompleta()
        : null;
    const nomeLogado = (userDetails?.textoCompleto || userDetails?.nome || '').toUpperCase().trim();

    if (userEmailLogado && target.toLowerCase().includes(userEmailLogado.toLowerCase())) return true;
    if (nomeLogado) {
      if (nomeLogado === targetUpper || nomeLogado.includes(targetUpper) || targetUpper.includes(nomeLogado)) return true;
      const nomeTokens = nomeLogado.split(' ').filter((t) => t.length > 2);
      const matchesTokens = nomeTokens.filter((t) => targetUpper.includes(t));
      if (matchesTokens.length >= 2 || (nomeTokens.length === 1 && matchesTokens.length === 1)) return true;
    }

    let targetRole = null;
    if (targetUpper.includes('DIRETOR') && !targetUpper.includes('VICE')) targetRole = 'DIRETOR';
    else if (targetUpper.includes('VICE')) targetRole = 'VICE_DIRETOR';
    else if (targetUpper.includes('CGPG') || targetUpper.includes('CGPCG') || targetUpper.includes('COORDENA')) targetRole = 'CGPG';
    else if (targetUpper.includes('PAAC')) targetRole = 'PAAC';
    else if (targetUpper.includes('PROFESSOR') && !targetUpper.includes('PAAC')) targetRole = 'PROFESSOR';

    if (targetRole && targetRole === cargoLogado) return true;

    return false;
  };

  // Enriquecimento com status de vencimento calculado uma única vez por atualização
  const tarefasVisiveis = useMemo(() => {
    return (tarefas || [])
      .filter((task) => {
        if (!task) return false;
        const target = String(task?.atribuidoA || task?.atribuirA || '').toUpperCase().trim();
        return isTargetPermitted(target);
      })
      .map((task) => ({
        ...task,
        _freqKey: getNormalizedFreqKey(task),
        _nivelKey: getNivelKey(task, listaUsuariosEquipe),
        _statusInfo: calcularStatusPrazoTarefa(task)
      }));
  }, [tarefas, cargoLogado, cargoBruto, listaUsuariosEquipe]);

  const tarefasAposEscopo = useMemo(() => {
    if (filtroEscopo === 'MINHAS') {
      return tarefasVisiveis.filter((t) => isTaskDizRespeitoAoUsuario(t));
    }
    return tarefasVisiveis;
  }, [tarefasVisiveis, filtroEscopo, cargoLogado]);

  const countMinhasTotal = useMemo(
    () => tarefasVisiveis.filter((t) => isTaskDizRespeitoAoUsuario(t)).length,
    [tarefasVisiveis, cargoLogado]
  );
  const countTodasAcessoTotal = tarefasVisiveis.length;

  // Métricas reais do escopo selecionado
  const metrics = useMemo(() => {
    let atrasadas = 0;
    let prestesVencer = 0;
    let pendentes = 0;
    let concluidas = 0;

    tarefasAposEscopo.forEach((t) => {
      const st = t._statusInfo;
      if (st.concluida) {
        concluidas++;
      } else {
        pendentes++;
        if (st.atrasada) atrasadas++;
        else if (st.emAlertaAmarelo) prestesVencer++;
      }
    });

    return {
      total: tarefasAposEscopo.length,
      atrasadas,
      prestesVencer,
      pendentes,
      concluidas
    };
  }, [tarefasAposEscopo]);

  // Tarefas após filtros (Busca + Nível + Periodicidade + Urgência)
  const tarefasFiltradas = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tarefasAposEscopo
      .filter((t) => {
        if (q) {
          const hit =
            (t.titulo || '').toLowerCase().includes(q) ||
            (t.descricao || '').toLowerCase().includes(q) ||
            (t.atribuirA || t.atribuidoA || '').toLowerCase().includes(q);
          if (!hit) return false;
        }
        if (selectedNivel !== 'TODOS' && t._nivelKey !== selectedNivel) return false;
        if (selectedFreq && t._freqKey !== selectedFreq) return false;

        const st = t._statusInfo;
        if (filtroUrgencia === 'PENDENTES') return !st.concluida;
        if (filtroUrgencia === 'AMARELO') return !st.concluida && st.emAlertaAmarelo;
        if (filtroUrgencia === 'ATRASADAS') return !st.concluida && st.atrasada;
        if (filtroUrgencia === 'CONCLUIDAS') return st.concluida;
        return true;
      })
      .sort((a, b) => {
        const stA = a._statusInfo;
        const stB = b._statusInfo;
        const rank = (st) => {
          if (st.concluida) return 4;
          if (st.atrasada) return 0;
          if (st.nivelUrgencia === 'VENCE_HOJE') return 1;
          if (st.nivelUrgencia === 'PRESTES_A_VENCER') return 2;
          return 3;
        };
        const rA = rank(stA);
        const rB = rank(stB);
        if (rA !== rB) return rA - rB;
        const dA = stA.diasRestantes ?? 9999;
        const dB = stB.diasRestantes ?? 9999;
        if (dA !== dB) return dA - dB;
        return (a.titulo || '').localeCompare(b.titulo || '');
      });
  }, [tarefasAposEscopo, searchTerm, selectedNivel, selectedFreq, filtroUrgencia]);

  // Agrupamento conforme o modo escolhido
  const gruposExibicao = useMemo(() => {
    if (viewMode === 'PRIORIDADE') {
      const buckets = [
        {
          key: 'ATRASADAS',
          title: 'Atrasadas · Ação Imediata',
          subtitle: 'Tarefas que ultrapassaram o prazo configurado do ciclo',
          icon: 'fa-circle-exclamation',
          headerTint: 'text-rose-800',
          tasks: tarefasFiltradas.filter((t) => !t._statusInfo.concluida && t._statusInfo.atrasada)
        },
        {
          key: 'AMARELO',
          title: 'Prestes a Vencer & Hoje (Alerta Amarelo)',
          subtitle: 'Vencem hoje ou entraram na janela de antecedência configurada',
          icon: 'fa-clock',
          headerTint: 'text-amber-800',
          tasks: tarefasFiltradas.filter((t) => !t._statusInfo.concluida && t._statusInfo.emAlertaAmarelo)
        },
        {
          key: 'NO_PRAZO',
          title: 'Programadas no Ciclo (No Prazo)',
          subtitle: 'Rotinas futuras do ciclo vigente fora da janela de alerta',
          icon: 'fa-calendar-check',
          headerTint: 'text-slate-800',
          tasks: tarefasFiltradas.filter(
            (t) => !t._statusInfo.concluida && !t._statusInfo.atrasada && !t._statusInfo.emAlertaAmarelo
          )
        },
        {
          key: 'CONCLUIDAS',
          title: 'Concluídas no Ciclo Vigente',
          subtitle: 'Serão renovadas automaticamente no próximo ciclo',
          icon: 'fa-circle-check',
          headerTint: 'text-emerald-800',
          tasks: tarefasFiltradas.filter((t) => t._statusInfo.concluida)
        }
      ];
      return buckets.filter((b) => b.tasks.length > 0);
    }

    if (viewMode === 'PERIODICIDADE') {
      return FREQUENCIAS.map((f) => {
        const tasksFreq = tarefasFiltradas.filter((t) => t._freqKey === f.key);
        const totalCiclo = tarefasAposEscopo.filter((t) => t._freqKey === f.key).length;
        const concluidasCiclo = tarefasAposEscopo.filter((t) => t._freqKey === f.key && t._statusInfo.concluida).length;
        return {
          key: f.key,
          title: f.title,
          subtitle: `${concluidasCiclo} de ${totalCiclo} concluída(s) no ciclo · alerta padrão ${f.defaultAntecedencia}d antes`,
          icon: f.icon,
          headerTint: f.accentColor,
          tasks: tasksFreq
        };
      }).filter((g) => g.tasks.length > 0);
    }

    // viewMode === 'EQUIPE'
    return NIVEIS_DEFINICOES.map((n) => {
      const tasksNivel = tarefasFiltradas.filter((t) => t._nivelKey === n.key);
      const totalNivel = tarefasAposEscopo.filter((t) => t._nivelKey === n.key).length;
      const concluidasNivel = tarefasAposEscopo.filter((t) => t._nivelKey === n.key && t._statusInfo.concluida).length;
      return {
        key: n.key,
        title: n.title,
        subtitle: `${concluidasNivel} de ${totalNivel} concluída(s) · ${n.description}`,
        icon: n.icon,
        headerTint: 'text-slate-900',
        tasks: tasksNivel
      };
    }).filter((g) => g.tasks.length > 0);
  }, [viewMode, tarefasFiltradas, tarefasAposEscopo]);

  // Conclusão em 1 clique (sem campos id/_id no payload!)
  const handleToggleConcluido = async (task) => {
    if (!isAuthorized || !task || !task.id) return;

    const userEmail = getCurrentUserEmail();
    const isCurrentlyDone = verificarStatus(task);

    const agora = new Date();
    const hojeStr = toIsoLocal(agora);
    const nowIso = agora.toISOString();

    const userDetails =
      typeof window.obterIdentificacaoUsuarioCompleta === 'function'
        ? window.obterIdentificacaoUsuarioCompleta()
        : null;
    const nomeUsuario = userDetails?.nome || userDetails?.textoCompleto || userEmail.split('@')[0];

    const patch = isCurrentlyDone
      ? {
          concluido: false,
          concluidaPor: [],
          concluidoPor: [],
          concluidoPorNome: null,
          ultimaDataConclusao: null,
          ultimaConclusao: null,
          atualizadoEm: nowIso,
          atualizadoPor: `${userRole} (${userEmail})`
        }
      : {
          concluido: true,
          concluidaPor: [userEmail.toLowerCase().trim()],
          concluidoPor: [userEmail.toLowerCase().trim()],
          concluidoPorNome: nomeUsuario,
          ultimaDataConclusao: hojeStr,
          ultimaConclusao: nowIso,
          atualizadoEm: nowIso,
          atualizadoPor: `${userRole} (${userEmail})`
        };

    const prevList = [...(tarefas || [])];
    const updatedList = prevList.map((t) => (t.id === task.id ? { ...t, ...patch } : t));
    setTarefas(updatedList);
    window.tasksCache = updatedList;

    try {
      await updateDoc(doc(db, 'rotina_equipe', task.id), patch);
      showFeedback(
        isCurrentlyDone ? 'Tarefa reaberta como pendente.' : 'Tarefa marcada como concluída no ciclo!',
        isCurrentlyDone ? 'info' : 'success'
      );
    } catch (err) {
      console.error('Erro ao atualizar conclusão da tarefa:', err);
      setTarefas(prevList);
      window.tasksCache = prevList;
      showFeedback('Erro ao atualizar status da tarefa.', 'error');
    }
  };

  // Renovação manual de ciclo (Diário / Semanal / Mensal) — sem id/_id no payload
  const handleRenovarCiclo = async (tipoCiclo) => {
    if (!podeRenovarCiclo) return;
    setConfirmRenewCycle(null);
    setShowRenewMenu(false);
    setRenovandoCiclo(true);

    try {
      const targetFreq =
        tipoCiclo === 'DIARIO' ? 'Diária' : tipoCiclo === 'SEMANAL' ? 'Semanal' : 'Mensal';
      const matchingTasks = (tarefas || []).filter((t) => getNormalizedFreqKey(t) === targetFreq);

      if (matchingTasks.length === 0) {
        showFeedback(`Nenhuma tarefa ${targetFreq.toLowerCase()} encontrada.`, 'info');
        setRenovandoCiclo(false);
        return;
      }

      const nowIso = new Date().toISOString();
      const patch = {
        concluidaPor: [],
        concluidoPor: [],
        concluidoPorNome: null,
        concluido: false,
        ultimaConclusao: null,
        ultimaDataConclusao: null,
        atualizadoEm: nowIso,
        atualizadoPor: `${userRole} (${getCurrentUserEmail()} - Renovação Manual ${targetFreq})`
      };

      const prevList = [...(tarefas || [])];
      const updatedList = prevList.map((t) =>
        getNormalizedFreqKey(t) === targetFreq ? { ...t, ...patch } : t
      );
      setTarefas(updatedList);
      window.tasksCache = updatedList;

      const batch = writeBatch(db);
      matchingTasks.forEach((t) => {
        batch.update(doc(db, 'rotina_equipe', t.id), patch);
      });
      await batch.commit();

      showFeedback(
        `Ciclo ${targetFreq.toLowerCase()} renovado! ${matchingTasks.length} tarefa(s) reabertas.`,
        'success'
      );
    } catch (err) {
      console.error('Erro ao renovar ciclo:', err);
      showFeedback('Erro ao renovar o ciclo.', 'error');
    } finally {
      setRenovandoCiclo(false);
    }
  };

  // Abrir Modal de Criação / Edição
  const handleOpenModal = (task = null) => {
    if (!isAuthorized) return;
    setIsDuplicating(false);
    if (task) {
      const freqNorm = getNormalizedFreqKey(task);
      const defaults = getDefaultRegraForm(freqNorm);
      setEditingTask(task);
      const dtIni = task.dataInicio || task.dataLimite || '';
      const dtFim = task.dataFim || dtIni;
      setFormData({
        id: task.id,
        titulo: task.titulo || '',
        descricao: task.descricao || '',
        frequencia: freqNorm,
        atribuirA: task.atribuirA || task.atribuidoA || 'TODA A EQUIPE',
        dataInicio: dtIni,
        horaInicio: task.horaInicio || '',
        dataFim: dtFim,
        horaFim: task.horaFim || '',
        dataLimite: task.dataLimite || dtIni,
        regraRecorrencia: { ...defaults, ...(task.regraRecorrencia || {}) }
      });
    } else {
      const defaultFreq = selectedFreq || 'Diária';
      setEditingTask(null);
      setFormData({
        id: null,
        titulo: '',
        descricao: '',
        frequencia: defaultFreq,
        atribuirA: cargoLogado === 'DIRETOR' ? 'TODA A EQUIPE' : cargoLogado,
        dataInicio: '',
        horaInicio: '',
        dataFim: '',
        horaFim: '',
        dataLimite: '',
        regraRecorrencia: getDefaultRegraForm(defaultFreq)
      });
    }
    setIsModalOpen(true);
  };

  const handleOpenDuplicateModal = (task) => {
    if (!isAuthorized || !podeDuplicar || !task) return;
    const freqNorm = getNormalizedFreqKey(task);
    const defaults = getDefaultRegraForm(freqNorm);
    const dtIni = task.dataInicio || task.dataLimite || '';
    const dtFim = task.dataFim || dtIni;
    setEditingTask(null);
    setIsDuplicating(true);
    setFormData({
      id: null,
      titulo: task.titulo || '',
      descricao: task.descricao || '',
      frequencia: freqNorm,
      atribuirA: task.atribuirA || task.atribuidoA || 'TODA A EQUIPE',
      dataInicio: dtIni,
      horaInicio: task.horaInicio || '',
      dataFim: dtFim,
      horaFim: task.horaFim || '',
      dataLimite: task.dataLimite || dtIni,
      regraRecorrencia: { ...defaults, ...(task.regraRecorrencia || {}) }
    });
    setIsModalOpen(true);
  };

  const handleTransformToDuplicate = () => {
    if (!podeDuplicar) return;
    setEditingTask(null);
    setIsDuplicating(true);
    setFormData((prev) => ({ ...prev, id: null }));
  };

  const handleFormFreqChange = (novaFreq) => {
    const defaults = getDefaultRegraForm(novaFreq);
    setFormData((prev) => ({
      ...prev,
      frequencia: novaFreq,
      regraRecorrencia: {
        ...defaults,
        ...prev.regraRecorrencia,
        diasAntecedencia: defaults.diasAntecedencia
      }
    }));
  };

  // Preview ao vivo do próximo vencimento e início do alerta amarelo no modal
  const formPreviewPrazo = useMemo(() => {
    return calcularStatusPrazoTarefa({
      titulo: formData.titulo || 'Prévia',
      frequencia: formData.frequencia,
      dataInicio: formData.dataInicio,
      dataFim: formData.dataFim,
      dataLimite: formData.dataInicio,
      regraRecorrencia: formData.regraRecorrencia,
      concluido: false
    });
  }, [formData]);

  // Salvar Tarefa (estritamente sem id ou _id no payload JSON!)
  const handleSaveTask = async (e) => {
    e.preventDefault();
    if (!isAuthorized) return;
    if (!formData.titulo.trim()) return;

    const freqNorm = getNormalizedFreqKey(formData.frequencia);
    const isPontual = freqNorm === 'Ação Pontual (Prazo Fixo)';

    if (isPontual && !formData.dataInicio) {
      showFeedback('Informe a Data de Prazo para ações pontuais.', 'warning');
      return;
    }

    const dtInicio = formData.dataInicio ? formData.dataInicio : null;
    const dtFim = formData.dataFim ? formData.dataFim : dtInicio;
    const hrInicio = formData.horaInicio ? formData.horaInicio : null;
    const hrFim = formData.horaFim ? formData.horaFim : null;

    const regraSanitizada = {
      diaSemana: Number(formData.regraRecorrencia?.diaSemana ?? 5),
      diaMes: Math.min(31, Math.max(1, Number(formData.regraRecorrencia?.diaMes ?? 25))),
      mesNoBimestre: Number(formData.regraRecorrencia?.mesNoBimestre ?? 2),
      mesNoSemestre: Math.min(6, Math.max(1, Number(formData.regraRecorrencia?.mesNoSemestre ?? 6))),
      mesAno: Math.min(12, Math.max(1, Number(formData.regraRecorrencia?.mesAno ?? 11))),
      horarioLimite: formData.regraRecorrencia?.horarioLimite || '',
      apenasDiasUteis: formData.regraRecorrencia?.apenasDiasUteis !== false,
      diasAntecedencia: Math.max(0, Number(formData.regraRecorrencia?.diasAntecedencia ?? getDefaultAntecedencia(freqNorm)))
    };

    setSaving(true);
    try {
      const payload = {
        titulo: formData.titulo.trim(),
        descricao: formData.descricao.trim(),
        frequencia: freqNorm,
        regraRecorrencia: regraSanitizada,
        atribuirA: formData.atribuirA,
        atribuidoA: formData.atribuirA,
        dataInicio: isPontual ? dtInicio : null,
        horaInicio: isPontual ? hrInicio : null,
        dataFim: isPontual ? dtFim : null,
        horaFim: isPontual ? hrFim : null,
        dataLimite: isPontual ? dtInicio : null
      };

      const taskId = isDuplicating ? null : formData.id || editingTask?.id;

      if (taskId) {
        const nowIso = new Date().toISOString();
        const updatedList = (tarefas || []).map((t) =>
          t.id === taskId ? { ...t, ...payload, atualizadoEm: nowIso, atualizadoPor: userRole } : t
        );
        setTarefas(updatedList);
        window.tasksCache = updatedList;

        await updateDoc(doc(db, 'rotina_equipe', taskId), {
          ...payload,
          atualizadoEm: nowIso,
          atualizadoPor: userRole
        });
        showFeedback('Tarefa e regra de vencimento atualizadas.', 'success');
      } else {
        const newObj = {
          ...payload,
          concluido: false,
          concluidaPor: [],
          concluidoPor: [],
          ultimaConclusao: null,
          ultimaDataConclusao: null,
          criadoEm: new Date().toISOString(),
          criadoPor: `${userRole}${isDuplicating ? ' (Duplicada)' : ''}`
        };
        const docRef = await addDoc(collection(db, 'rotina_equipe'), newObj);
        const updatedList = [...(tarefas || []), { id: docRef.id, ...newObj }];
        setTarefas(updatedList);
        window.tasksCache = updatedList;
        showFeedback(isDuplicating ? 'Cópia criada com sucesso.' : 'Nova tarefa criada com sucesso.', 'success');
      }

      setIsModalOpen(false);
      setEditingTask(null);
      setIsDuplicating(false);
    } catch (err) {
      console.error('Erro ao salvar tarefa em rotina_equipe:', err);
      showFeedback('Erro ao salvar tarefa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Modal Em Massa
  const handleOpenBulkModal = () => {
    if (!isAuthorized || !podeDuplicar) return;
    setBulkFormData({
      titulo: '',
      descricao: '',
      frequencia: 'Semanal',
      dataInicio: '',
      horaInicio: '',
      dataFim: '',
      horaFim: '',
      dataLimite: '',
      regraRecorrencia: getDefaultRegraForm('Semanal')
    });
    setSelectedBulkTargets([]);
    setCustomBulkInput('');
    setBulkSuccessMsg('');
    setIsBulkModalOpen(true);
  };

  const toggleBulkTarget = (target) => {
    if (!target) return;
    setSelectedBulkTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target]
    );
  };

  const handleAddCustomBulkTarget = (e) => {
    if (e) e.preventDefault();
    const val = customBulkInput.trim();
    if (val && !selectedBulkTargets.includes(val)) {
      setSelectedBulkTargets((prev) => [...prev, val]);
      setCustomBulkInput('');
    }
  };

  const handleSaveBulkTasks = async (e) => {
    e.preventDefault();
    if (!isAuthorized || !podeDuplicar) return;
    if (!bulkFormData.titulo.trim() || selectedBulkTargets.length === 0) {
      showFeedback('Preencha o título e selecione ao menos um destinatário.', 'warning');
      return;
    }

    const freqNorm = getNormalizedFreqKey(bulkFormData.frequencia);
    const isPontual = freqNorm === 'Ação Pontual (Prazo Fixo)';
    if (isPontual && !bulkFormData.dataInicio) {
      showFeedback('Informe a Data Limite para ações pontuais.', 'warning');
      return;
    }

    const regraSanitizada = {
      diaSemana: Number(bulkFormData.regraRecorrencia?.diaSemana ?? 5),
      diaMes: Math.min(31, Math.max(1, Number(bulkFormData.regraRecorrencia?.diaMes ?? 25))),
      mesNoBimestre: Number(bulkFormData.regraRecorrencia?.mesNoBimestre ?? 2),
      mesNoSemestre: Math.min(6, Math.max(1, Number(bulkFormData.regraRecorrencia?.mesNoSemestre ?? 6))),
      mesAno: Math.min(12, Math.max(1, Number(bulkFormData.regraRecorrencia?.mesAno ?? 11))),
      horarioLimite: bulkFormData.regraRecorrencia?.horarioLimite || '',
      apenasDiasUteis: bulkFormData.regraRecorrencia?.apenasDiasUteis !== false,
      diasAntecedencia: Math.max(0, Number(bulkFormData.regraRecorrencia?.diasAntecedencia ?? getDefaultAntecedencia(freqNorm)))
    };

    setBulkSaving(true);
    try {
      const colRef = collection(db, 'rotina_equipe');
      const newTasks = [];
      const dtInicio = bulkFormData.dataInicio || null;
      const dtFim = bulkFormData.dataFim || dtInicio;

      await Promise.all(
        selectedBulkTargets.map(async (dest) => {
          const payload = {
            titulo: bulkFormData.titulo.trim(),
            descricao: bulkFormData.descricao.trim(),
            frequencia: freqNorm,
            regraRecorrencia: regraSanitizada,
            atribuirA: dest,
            atribuidoA: dest,
            dataInicio: isPontual ? dtInicio : null,
            horaInicio: isPontual ? bulkFormData.horaInicio || null : null,
            dataFim: isPontual ? dtFim : null,
            horaFim: isPontual ? bulkFormData.horaFim || null : null,
            dataLimite: isPontual ? dtInicio : null,
            concluidoPor: [],
            concluidaPor: [],
            concluido: false,
            ultimaConclusao: null,
            ultimaDataConclusao: null,
            criadoEm: new Date().toISOString(),
            criadoPor: `${userRole} (Criado em Massa)`
          };
          const docAdded = await addDoc(colRef, payload);
          newTasks.push({ id: docAdded.id, ...payload });
        })
      );

      const updatedList = [...(tarefas || []), ...newTasks];
      setTarefas(updatedList);
      window.tasksCache = updatedList;
      setBulkSuccessMsg(`${selectedBulkTargets.length} tarefa(s) criada(s) com sucesso.`);
      showFeedback(`${selectedBulkTargets.length} tarefa(s) criada(s)!`, 'success');
      setTimeout(() => {
        setIsBulkModalOpen(false);
        setBulkSuccessMsg('');
      }, 1200);
    } catch (err) {
      console.error('Erro ao criar tarefas em massa:', err);
      showFeedback('Erro ao salvar tarefas em massa.', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  // Exclusão (estritamente Diretor / Vice-Diretor)
  const handleDeleteTask = async (taskId) => {
    if (!isAuthorized || !taskId) return;
    if (!podeExcluirTarefa) {
      showFeedback('Acesso negado: apenas Diretor e Vice-Diretor podem excluir tarefas.', 'warning');
      return;
    }

    setConfirmDeleteTaskId(null);
    const prevList = [...(tarefas || [])];
    const updatedList = prevList.filter((t) => t.id !== taskId);
    setTarefas(updatedList);
    window.tasksCache = updatedList;

    try {
      await deleteDoc(doc(db, 'rotina_equipe', taskId));
      showFeedback('Tarefa excluída.', 'success');
    } catch (err) {
      console.error('Erro ao excluir tarefa:', err);
      setTarefas(prevList);
      window.tasksCache = prevList;
      showFeedback('Erro ao excluir tarefa.', 'error');
    }
  };

  // Renderizador compartilhado de campos da Regra de Recorrência (usado no modal individual e em massa)
  const renderRecorrenciaFields = (freqVal, regra, onUpdateRegra) => {
    const freqNorm = getNormalizedFreqKey(freqVal);
    if (freqNorm === 'Diária') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">Configuração da Rotina Diária</span>
            <span className="text-[11px] text-slate-500">Renova todo dia à 00h</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={regra.apenasDiasUteis !== false}
                onChange={(e) => onUpdateRegra({ apenasDiasUteis: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-slate-900"
              />
              <span>Apenas dias úteis (Segunda a Sexta)</span>
            </label>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Horário limite diário (opcional)
              </label>
              <input
                type="time"
                value={regra.horarioLimite || ''}
                onChange={(e) => onUpdateRegra({ horarioLimite: e.target.value })}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 tabular-nums"
              />
            </div>
          </div>
        </div>
      );
    }

    if (freqNorm === 'Semanal') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">Dia de Vencimento Semanal</span>
            <span className="text-[11px] text-slate-500">Renova toda segunda-feira</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DIAS_SEMANA_OPCOES.map((dia) => {
              const active = Number(regra.diaSemana ?? 5) === dia.value;
              return (
                <button
                  key={dia.value}
                  type="button"
                  onClick={() => onUpdateRegra({ diaSemana: dia.value })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {dia.short}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="text-[11px] font-medium text-slate-600">
              Marcar em amarelo quantos dias antes?
            </label>
            <select
              value={Number(regra.diasAntecedencia ?? 1)}
              onChange={(e) => onUpdateRegra({ diasAntecedencia: Number(e.target.value) })}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 tabular-nums cursor-pointer"
            >
              <option value={0}>Apenas no dia (0 dias)</option>
              <option value={1}>1 dia antes</option>
              <option value={2}>2 dias antes</option>
              <option value={3}>3 dias antes</option>
            </select>
          </div>
        </div>
      );
    }

    if (freqNorm === 'Mensal') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">Dia de Vencimento Mensal</span>
            <span className="text-[11px] text-slate-500">Ajusta automaticamente em meses curtos</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Todo dia do mês (1 a 31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={Number(regra.diaMes ?? 25)}
                onChange={(e) =>
                  onUpdateRegra({ diaMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Alerta amarelo (dias antes)
              </label>
              <select
                value={Number(regra.diasAntecedencia ?? 3)}
                onChange={(e) => onUpdateRegra({ diasAntecedencia: Number(e.target.value) })}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 tabular-nums cursor-pointer"
              >
                <option value={1}>1 dia antes</option>
                <option value={2}>2 dias antes</option>
                <option value={3}>3 dias antes</option>
                <option value={5}>5 dias antes</option>
                <option value={7}>7 dias antes</option>
              </select>
            </div>
          </div>
        </div>
      );
    }

    if (freqNorm === 'Bimestral') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <span className="text-xs font-semibold text-slate-900 block">Regra Bimestral</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Mês no bimestre</label>
              <select
                value={Number(regra.mesNoBimestre ?? 2)}
                onChange={(e) => onUpdateRegra({ mesNoBimestre: Number(e.target.value) })}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
              >
                <option value={1}>1º mês do bimestre</option>
                <option value={2}>2º mês (fechamento)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Dia do mês</label>
              <input
                type="number"
                min={1}
                max={31}
                value={Number(regra.diaMes ?? 20)}
                onChange={(e) =>
                  onUpdateRegra({ diaMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Alerta amarelo (dias)</label>
              <input
                type="number"
                min={0}
                max={30}
                value={Number(regra.diasAntecedencia ?? 5)}
                onChange={(e) =>
                  onUpdateRegra({ diasAntecedencia: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
          </div>
        </div>
      );
    }

    if (freqNorm === 'Semestral') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <span className="text-xs font-semibold text-slate-900 block">Regra Semestral</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Mês do semestre</label>
              <select
                value={Number(regra.mesNoSemestre ?? 6)}
                onChange={(e) => onUpdateRegra({ mesNoSemestre: Number(e.target.value) })}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}º mês do semestre</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Dia do mês</label>
              <input
                type="number"
                min={1}
                max={31}
                value={Number(regra.diaMes ?? 15)}
                onChange={(e) =>
                  onUpdateRegra({ diaMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Alerta amarelo (dias)</label>
              <input
                type="number"
                min={0}
                max={45}
                value={Number(regra.diasAntecedencia ?? 7)}
                onChange={(e) =>
                  onUpdateRegra({ diasAntecedencia: Math.min(45, Math.max(0, Number(e.target.value) || 0)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
          </div>
        </div>
      );
    }

    if (freqNorm === 'Anual') {
      return (
        <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <span className="text-xs font-semibold text-slate-900 block">Data Anual de Vencimento</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Mês do ano</label>
              <select
                value={Number(regra.mesAno ?? 11)}
                onChange={(e) => onUpdateRegra({ mesAno: Number(e.target.value) })}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
              >
                {MESES_ANO_OPCOES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Dia do mês</label>
              <input
                type="number"
                min={1}
                max={31}
                value={Number(regra.diaMes ?? 15)}
                onChange={(e) =>
                  onUpdateRegra({ diaMes: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Alerta amarelo (dias)</label>
              <input
                type="number"
                min={0}
                max={60}
                value={Number(regra.diasAntecedencia ?? 15)}
                onChange={(e) =>
                  onUpdateRegra({ diasAntecedencia: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })
                }
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 tabular-nums"
              />
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // Bloqueio estrito para perfis sem permissão (ex: PROFESSOR comum, SECRETARIA)
  if (!isAuthorized) {
    return (
      <div className="p-6 md:p-10 bg-[#F8FAFC] min-h-[70vh] flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-7 text-center">
          <div className="w-12 h-12 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl flex items-center justify-center mx-auto mb-4 text-lg">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h3 className="text-base font-bold text-slate-900">Acesso Restrito à Gestão</h3>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            O módulo <strong>Tarefas &amp; Rotina PDCA</strong> é exclusivo para Direção, Vice-Direção, Coordenação Pedagógica (CGPG) e PAAC.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            Perfil atual: <span className="font-semibold text-slate-800">{userRole}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-[#F8FAFC] pb-20 sm:pb-10">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 pt-4 space-y-5">
        {/* 1. CABEÇALHO LIMPO E FUNCIONAL */}
        <header className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                <span className="font-semibold text-slate-700">Rotina &amp; Operações</span>
                <span aria-hidden="true">·</span>
                <span>{cargoLogado === 'DIRETOR' ? 'Visão Global Master' : `Acesso ${cargoLogado}`}</span>
                <span aria-hidden="true">·</span>
                <span>{isRealtimeConnected ? 'Sincronizado' : 'Conectando'}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Tarefas &amp; Rotina PDCA
              </h1>
            </div>

            {/* Ações da Gestão */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={carregarTarefas}
                disabled={loading}
                title="Sincronizar tarefas agora"
                className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <i className={`fa-solid fa-arrows-rotate text-xs ${loading ? 'fa-spin text-slate-900' : ''}`}></i>
              </button>

              {podeRenovarCiclo && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowRenewMenu((prev) => !prev)}
                    disabled={renovandoCiclo}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <i className={`fa-solid fa-rotate text-[11px] ${renovandoCiclo ? 'fa-spin' : ''}`}></i>
                    <span>Renovar Ciclo</span>
                    <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
                  </button>

                  {showRenewMenu && (
                    <div className="absolute right-0 mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30">
                      <button
                        type="button"
                        onClick={() => { setShowRenewMenu(false); setConfirmRenewCycle('DIARIO'); }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                      >
                        <i className="fa-solid fa-sun text-amber-600 w-3.5"></i>
                        <span>Renovar Diárias</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowRenewMenu(false); setConfirmRenewCycle('SEMANAL'); }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                      >
                        <i className="fa-solid fa-calendar-week text-sky-600 w-3.5"></i>
                        <span>Renovar Semanais</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowRenewMenu(false); setConfirmRenewCycle('MENSAL'); }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                      >
                        <i className="fa-solid fa-calendar-days text-indigo-600 w-3.5"></i>
                        <span>Renovar Mensais</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {podeDuplicar && (
                <button
                  type="button"
                  onClick={handleOpenBulkModal}
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  title="Atribuir a mesma tarefa para vários cargos ou pessoas"
                >
                  <i className="fa-solid fa-users-gear text-[11px]"></i>
                  <span>Em Massa</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenModal()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <i className="fa-solid fa-plus text-[11px]"></i>
                <span>Nova Tarefa</span>
              </button>
            </div>
          </div>

          {confirmRenewCycle && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-950">
                <i className="fa-solid fa-triangle-exclamation text-amber-700 mt-0.5"></i>
                <div>
                  <p className="font-semibold">
                    Confirmar renovação manual do ciclo {confirmRenewCycle.toLowerCase()}?
                  </p>
                  <p className="text-[11px] text-amber-900 mt-0.5">
                    Todas as tarefas dessa periodicidade voltarão ao status pendente.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmRenewCycle(null)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleRenovarCiclo(confirmRenewCycle)}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}
        </header>

        {/* 2. KPIs INTERATIVOS (CLICÁVEIS PARA FILTRAGEM INSTANTÂNEA) */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setFiltroUrgencia(filtroUrgencia === 'ATRASADAS' ? 'PENDENTES' : 'ATRASADAS')}
            className={`text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
              filtroUrgencia === 'ATRASADAS'
                ? 'bg-rose-50 border-rose-400'
                : metrics.atrasadas > 0
                ? 'bg-white border-rose-200 hover:border-rose-300'
                : 'bg-white border-slate-200/80 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-600">
              <span>Atrasadas</span>
              <i className="fa-solid fa-circle-exclamation text-rose-600"></i>
            </div>
            <p className={`text-2xl font-bold tabular-nums mt-1.5 ${metrics.atrasadas > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
              {metrics.atrasadas}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Passaram do vencimento</p>
          </button>

          <button
            type="button"
            onClick={() => setFiltroUrgencia(filtroUrgencia === 'AMARELO' ? 'PENDENTES' : 'AMARELO')}
            className={`text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
              filtroUrgencia === 'AMARELO'
                ? 'bg-amber-100/80 border-amber-400'
                : metrics.prestesVencer > 0
                ? 'bg-amber-50/70 border-amber-300 hover:border-amber-400'
                : 'bg-white border-slate-200/80 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-amber-900">
              <span>Prestes a Vencer</span>
              <i className="fa-solid fa-clock text-amber-600"></i>
            </div>
            <p className={`text-2xl font-bold tabular-nums mt-1.5 ${metrics.prestesVencer > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {metrics.prestesVencer}
            </p>
            <p className="text-[11px] text-amber-800/80 mt-0.5">Alerta amarelo · vencem hoje ou em breve</p>
          </button>

          <button
            type="button"
            onClick={() => setFiltroUrgencia('PENDENTES')}
            className={`text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
              filtroUrgencia === 'PENDENTES'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white border-slate-200/80 hover:border-slate-300'
            }`}
          >
            <div className={`flex items-center justify-between gap-2 text-xs font-medium ${filtroUrgencia === 'PENDENTES' ? 'text-slate-300' : 'text-slate-600'}`}>
              <span>Pendentes no Ciclo</span>
              <i className={`fa-solid fa-list-check ${filtroUrgencia === 'PENDENTES' ? 'text-white' : 'text-slate-500'}`}></i>
            </div>
            <p className={`text-2xl font-bold tabular-nums mt-1.5 ${filtroUrgencia === 'PENDENTES' ? 'text-white' : 'text-slate-900'}`}>
              {metrics.pendentes}
            </p>
            <p className={`text-[11px] mt-0.5 ${filtroUrgencia === 'PENDENTES' ? 'text-slate-300' : 'text-slate-500'}`}>
              Total a executar
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFiltroUrgencia(filtroUrgencia === 'CONCLUIDAS' ? 'PENDENTES' : 'CONCLUIDAS')}
            className={`text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
              filtroUrgencia === 'CONCLUIDAS'
                ? 'bg-emerald-50 border-emerald-400'
                : 'bg-white border-slate-200/80 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-600">
              <span>Concluídas no Ciclo</span>
              <i className="fa-solid fa-circle-check text-emerald-600"></i>
            </div>
            <p className="text-2xl font-bold tabular-nums text-emerald-700 mt-1.5">
              {metrics.concluidas}
              <span className="text-xs font-medium text-slate-400 ml-1.5">
                / {metrics.total}
              </span>
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Renovam no próximo ciclo</p>
          </button>
        </section>

        {/* 3. BARRA UNIFICADA DE VISÃO, ESCOPO E FILTROS */}
        <section className="bg-white p-4 rounded-2xl border border-slate-200/80 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Modo de Exibição */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode('PRIORIDADE')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'PRIORIDADE' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Prioridade
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('PERIODICIDADE')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'PERIODICIDADE' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Por Periodicidade
                </button>
                {podeGerenciarEquipe && (
                  <button
                    type="button"
                    onClick={() => setViewMode('EQUIPE')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      viewMode === 'EQUIPE' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Por Cargo
                  </button>
                )}
              </div>

              {/* Escopo: Minhas vs Equipe */}
              <div className="inline-flex items-center bg-slate-100 p-1 rounded-lg gap-1">
                <button
                  type="button"
                  onClick={() => setFiltroEscopo('MINHAS')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    filtroEscopo === 'MINHAS' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Minhas ({countMinhasTotal})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroEscopo('TODAS_ACESSO')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    filtroEscopo === 'TODAS_ACESSO' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cargoLogado === 'DIRETOR' ? `Toda Escola (${countTodasAcessoTotal})` : `Meu Nível (${countTodasAcessoTotal})`}
                </button>
              </div>
            </div>

            {/* Busca + Filtro Status Completo + Filtro Cargo */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar tarefa ou responsável..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:border-slate-400"
                />
              </div>

              {podeGerenciarEquipe && (
                <select
                  value={selectedNivel}
                  onChange={(e) => setSelectedNivel(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 cursor-pointer"
                >
                  <option value="TODOS">Todos os cargos</option>
                  {NIVEIS_DEFINICOES.map((n) => (
                    <option key={n.key} value={n.key}>{n.label}</option>
                  ))}
                </select>
              )}

              <select
                value={filtroUrgencia}
                onChange={(e) => setFiltroUrgencia(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 cursor-pointer"
              >
                <option value="PENDENTES">Pendentes ({metrics.pendentes})</option>
                <option value="AMARELO">Prestes a vencer ({metrics.prestesVencer})</option>
                <option value="ATRASADAS">Atrasadas ({metrics.atrasadas})</option>
                <option value="CONCLUIDAS">Concluídas ({metrics.concluidas})</option>
                <option value="TODAS">Todas ({metrics.total})</option>
              </select>
            </div>
          </div>

          {/* Filtro por Periodicidade (Ciclo) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-400 mr-1 shrink-0">Periodicidade:</span>
            <button
              type="button"
              onClick={() => setSelectedFreq('')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                !selectedFreq ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              Todas ({tarefasAposEscopo.length})
            </button>
            {FREQUENCIAS.map((f) => {
              const count = tarefasAposEscopo.filter((t) => t._freqKey === f.key).length;
              const isSelected = selectedFreq === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSelectedFreq(isSelected ? '' : f.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 tabular-nums ${
                    isSelected
                      ? f.activeTabClass
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  <i className={`fa-solid ${f.icon} text-[10px]`}></i>
                  <span>{f.plural} ({count})</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. LISTA OPERACIONAL DE TAREFAS (LIMPA, DENSA E ACIONÁVEL EM 1 CLIQUE) */}
        <section className="space-y-4">
          {loading ? (
            <div className="bg-white p-10 rounded-2xl border border-slate-200/80 text-center text-slate-500 text-xs">
              <i className="fa-solid fa-spinner fa-spin text-xl text-slate-700 mb-2 block"></i>
              <span>Carregando rotina de tarefas...</span>
            </div>
          ) : gruposExibicao.length === 0 ? (
            <div className="space-y-3">
              <MascoteSaraState
                titulo="Nenhuma tarefa encontrada neste filtro"
                mensagem={
                  filtroUrgencia === 'PENDENTES'
                    ? 'Todas as tarefas pendentes deste recorte já foram concluídas no ciclo atual.'
                    : 'Ajuste os filtros acima ou cadastre uma nova tarefa recorrente.'
                }
              />
              <div className="flex items-center justify-center gap-2">
                {filtroEscopo === 'MINHAS' && countTodasAcessoTotal > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroEscopo('TODAS_ACESSO')}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 font-semibold text-xs rounded-lg cursor-pointer"
                  >
                    Ver tarefas da equipe ({countTodasAcessoTotal})
                  </button>
                )}
                {filtroUrgencia !== 'TODAS' && (
                  <button
                    type="button"
                    onClick={() => setFiltroUrgencia('TODAS')}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg cursor-pointer"
                  >
                    Mostrar Todas ({metrics.total})
                  </button>
                )}
              </div>
            </div>
          ) : (
            gruposExibicao.map((grupo) => {
              const isCollapsed = !!collapsedGroups[grupo.key];
              return (
                <div key={grupo.key} className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapse(grupo.key)}
                    className="w-full px-4 py-3 bg-slate-50/70 hover:bg-slate-100/70 border-b border-slate-200/70 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <i className={`fa-solid ${grupo.icon} text-sm ${grupo.headerTint} shrink-0`}></i>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className={`text-sm font-bold ${grupo.headerTint} truncate`}>{grupo.title}</h2>
                          <span className="text-xs font-semibold text-slate-500 tabular-nums shrink-0">
                            ({grupo.tasks.length})
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{grupo.subtitle}</p>
                      </div>
                    </div>
                    <i className={`fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'} text-xs text-slate-400 shrink-0`}></i>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {grupo.tasks.map((task) => {
                        const st = task._statusInfo;
                        const isDone = st.concluida;
                        const quemConcluiu = getQuemConcluiu(task, listaUsuariosEquipe);
                        const isExpanded = !!expandedDescTasks[task.id];
                        const isConfirmingDelete = confirmDeleteTaskId === task.id;
                        const destinatario = task.atribuirA || task.atribuidoA || 'TODA A EQUIPE';

                        let rowSurface = 'bg-white hover:bg-slate-50/70';
                        if (isDone) {
                          rowSurface = 'bg-emerald-50/35 hover:bg-emerald-50/55';
                        } else if (st.atrasada) {
                          rowSurface = 'bg-rose-50/80 hover:bg-rose-50';
                        } else if (st.emAlertaAmarelo) {
                          rowSurface = 'bg-amber-50/90 hover:bg-amber-100/60';
                        }

                        return (
                          <div key={task.id} className={`px-4 py-3 transition-colors ${rowSurface}`}>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              {/* Checkbox 1-clique + Título + Metadados */}
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleConcluido(task)}
                                  aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
                                  title={isDone ? 'Desmarcar conclusão' : 'Concluir no ciclo atual'}
                                  className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                                    isDone
                                      ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                                      : st.atrasada
                                      ? 'bg-white border-rose-400 text-transparent hover:border-rose-600 hover:text-rose-500'
                                      : st.emAlertaAmarelo
                                      ? 'bg-white border-amber-500 text-transparent hover:border-amber-700 hover:text-amber-600'
                                      : 'bg-white border-slate-300 text-transparent hover:border-slate-700 hover:text-slate-600'
                                  }`}
                                >
                                  <i className="fa-solid fa-check text-xs"></i>
                                </button>

                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3
                                      className={`text-sm font-semibold leading-snug ${
                                        isDone
                                          ? 'line-through text-emerald-900/75'
                                          : st.atrasada
                                          ? 'text-rose-950'
                                          : st.emAlertaAmarelo
                                          ? 'text-amber-950'
                                          : 'text-slate-900'
                                      }`}
                                    >
                                      {task.titulo || task.descricao}
                                    </h3>

                                    {/* Indicador semântico explícito (cor + ícone + texto) */}
                                    {!isDone && st.atrasada && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-900 border border-rose-300 tabular-nums whitespace-nowrap">
                                        <i className="fa-solid fa-circle-exclamation text-[10px]"></i>
                                        <span>{st.contagemLabel}</span>
                                      </span>
                                    )}
                                    {!isDone && st.emAlertaAmarelo && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-200/80 text-amber-950 border border-amber-400 tabular-nums whitespace-nowrap">
                                        <i className="fa-solid fa-clock text-[10px]"></i>
                                        <span>{st.contagemLabel}</span>
                                      </span>
                                    )}
                                  </div>

                                  {/* Metadados limpos sem pílulas */}
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                                    <span className="font-medium text-slate-800">{task._freqKey}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{st.regraResumo}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>Responsável: <strong className="font-medium text-slate-800">{destinatario}</strong></span>
                                    {st.dataVencimentoLabel && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span>Vencimento: <strong className="font-medium text-slate-800">{st.dataVencimentoLabel}</strong></span>
                                      </>
                                    )}
                                    {!isDone && !st.atrasada && !st.emAlertaAmarelo && st.contagemLabel && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-slate-500">{st.contagemLabel}</span>
                                      </>
                                    )}
                                    {isDone && quemConcluiu.length > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-emerald-800 font-medium">
                                          Concluída por {quemConcluiu.join(', ')}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Descrição expansível */}
                                  {task.descricao && task.descricao !== task.titulo && (
                                    <div className="pt-0.5">
                                      <div
                                        className={`text-xs text-slate-600 leading-relaxed ${
                                          isExpanded ? '' : 'line-clamp-1'
                                        }`}
                                      >
                                        {renderTextoComLinks(task.descricao)}
                                      </div>
                                      {task.descricao.length > 90 && (
                                        <button
                                          type="button"
                                          onClick={() => toggleTaskDesc(task.id)}
                                          className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer mt-0.5"
                                        >
                                          {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Ações da Linha */}
                              <div className="flex items-center justify-end gap-1.5 shrink-0 pl-12 sm:pl-0">
                                {isConfirmingDelete ? (
                                  <div className="flex items-center gap-1.5 bg-white border border-rose-300 rounded-lg px-2 py-1">
                                    <span className="text-[11px] font-medium text-rose-900">Excluir?</span>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteTaskId(null)}
                                      className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                                    >
                                      Não
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="px-2 py-1 text-[11px] font-semibold bg-rose-600 text-white rounded cursor-pointer"
                                    >
                                      Sim
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleConcluido(task)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                        isDone
                                          ? 'bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                                          : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                                      }`}
                                    >
                                      {isDone ? 'Reabrir' : 'Concluir'}
                                    </button>
                                    {podeDuplicar && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenDuplicateModal(task)}
                                        title="Duplicar tarefa"
                                        className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer"
                                      >
                                        <i className="fa-solid fa-copy text-xs"></i>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenModal(task)}
                                      title="Editar tarefa e regra de vencimento"
                                      className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-xs"></i>
                                    </button>
                                    {podeExcluirTarefa && (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteTaskId(task.id)}
                                        title="Excluir tarefa"
                                        className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-700 flex items-center justify-center cursor-pointer"
                                      >
                                        <i className="fa-solid fa-trash-can text-xs"></i>
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>

      {/* Modal Criar / Editar / Duplicar Tarefa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {isDuplicating
                    ? 'Duplicar Tarefa'
                    : editingTask
                    ? 'Editar Tarefa & Regra de Vencimento'
                    : 'Nova Tarefa de Rotina'}
                </h3>
                <p className="text-xs text-slate-500">
                  Defina periodicidade, dia exato de vencimento e antecedência do alerta amarelo
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Título da Tarefa <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.titulo}
                    onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                    placeholder="Ex: Consolidar fechamento semanal de Busca Ativa"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-900 outline-none focus:border-slate-400"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Descrição / Orientações (Opcional)
                  </label>
                  <textarea
                    rows={2}
                    value={formData.descricao}
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                    placeholder="Passos, links de planilhas ou critérios de execução..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none focus:border-slate-400"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Periodicidade <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={formData.frequencia}
                      onChange={(e) => handleFormFreqChange(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-900 cursor-pointer"
                    >
                      {FREQUENCIAS.map((f) => (
                        <option key={f.key} value={f.key}>{f.title}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Atribuir a <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={formData.atribuirA}
                      onChange={(e) => setFormData({ ...formData, atribuirA: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-900 cursor-pointer"
                    >
                      <optgroup label="Níveis e Cargos da Gestão">
                        {OPCOES_ATRIBUICAO.map((op) => (
                          <option key={op} value={op}>
                            {op === 'PAAC' ? 'PAAC (Apoio ao Currículo)' : op}
                          </option>
                        ))}
                      </optgroup>
                      {listaUsuariosEquipe.length > 0 && (
                        <optgroup label="Membros Específicos da Equipe">
                          {listaUsuariosEquipe.map((u) => (
                            <option key={u.id} value={u.nome}>
                              {u.nome} ({u.nivel || 'Equipe'})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {renderRecorrenciaFields(formData.frequencia, formData.regraRecorrencia, (patch) =>
                    setFormData((prev) => ({
                      ...prev,
                      regraRecorrencia: { ...prev.regraRecorrencia, ...patch }
                    }))
                  )}

                  {getNormalizedFreqKey(formData.frequencia) === 'Ação Pontual (Prazo Fixo)' && (
                    <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <span className="text-xs font-semibold text-slate-900 block">
                        Prazo da Ação Pontual
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Data / Prazo <span className="text-rose-600">*</span>
                          </label>
                          <input
                            type="date"
                            required
                            value={formData.dataInicio}
                            onChange={(e) => setFormData({ ...formData, dataInicio: e.target.value, dataLimite: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">Data Término</label>
                          <input
                            type="date"
                            value={formData.dataFim}
                            onChange={(e) => setFormData({ ...formData, dataFim: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">Alerta amarelo (dias)</label>
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={Number(formData.regraRecorrencia?.diasAntecedencia ?? 2)}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                regraRecorrencia: {
                                  ...prev.regraRecorrencia,
                                  diasAntecedencia: Math.max(0, Number(e.target.value) || 0)
                                }
                              }))
                            }
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold tabular-nums"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Prévia do Comportamento de Vencimento */}
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 tabular-nums ${
                    formPreviewPrazo.atrasada
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : formPreviewPrazo.emAlertaAmarelo
                      ? 'bg-amber-50 border-amber-300 text-amber-950'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <div>
                    <span className="font-semibold block">Prévia do Ciclo Atual: {formPreviewPrazo.dataVencimentoLabel}</span>
                    <span className="text-[11px] opacity-85">{formPreviewPrazo.regraResumo}</span>
                  </div>
                  <span className="font-semibold text-[11px] shrink-0">{formPreviewPrazo.contagemLabel}</span>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
                <div>
                  {editingTask && podeDuplicar && !isDuplicating && (
                    <button
                      type="button"
                      onClick={handleTransformToDuplicate}
                      className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
                    >
                      Duplicar
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : isDuplicating ? 'Salvar Cópia' : 'Salvar Tarefa'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Criação em Massa */}
      {podeDuplicar && isBulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900">Criar Tarefa em Massa</h3>
                <p className="text-xs text-slate-500">Gere cópias independentes com a mesma regra de vencimento para múltiplos cargos/membros</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveBulkTasks} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                {bulkSuccessMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
                    {bulkSuccessMsg}
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    Título da Tarefa <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={bulkFormData.titulo}
                    onChange={(e) => setBulkFormData({ ...bulkFormData, titulo: e.target.value })}
                    placeholder="Ex: Preencher plano de ação semanal"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">Descrição (Opcional)</label>
                  <textarea
                    rows={2}
                    value={bulkFormData.descricao}
                    onChange={(e) => setBulkFormData({ ...bulkFormData, descricao: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">Periodicidade</label>
                    <select
                      value={bulkFormData.frequencia}
                      onChange={(e) => {
                        const nova = e.target.value;
                        const def = getDefaultRegraForm(nova);
                        setBulkFormData((prev) => ({
                          ...prev,
                          frequencia: nova,
                          regraRecorrencia: { ...def, diasAntecedencia: def.diasAntecedencia }
                        }));
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-900 cursor-pointer"
                    >
                      {FREQUENCIAS.map((f) => (
                        <option key={f.key} value={f.key}>{f.title}</option>
                      ))}
                    </select>
                  </div>

                  {getNormalizedFreqKey(bulkFormData.frequencia) === 'Ação Pontual (Prazo Fixo)' && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1.5">Data Limite *</label>
                      <input
                        type="date"
                        required
                        value={bulkFormData.dataInicio}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, dataInicio: e.target.value, dataLimite: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg tabular-nums"
                      />
                    </div>
                  )}

                  {renderRecorrenciaFields(bulkFormData.frequencia, bulkFormData.regraRecorrencia, (patch) =>
                    setBulkFormData((prev) => ({
                      ...prev,
                      regraRecorrencia: { ...prev.regraRecorrencia, ...patch }
                    }))
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      Destinatários ({selectedBulkTargets.length} selecionado(s))
                    </span>
                    {selectedBulkTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedBulkTargets([])}
                        className="text-xs font-medium text-rose-700 hover:underline cursor-pointer"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {OPCOES_ATRIBUICAO.map((cargo) => {
                      const active = selectedBulkTargets.includes(cargo);
                      return (
                        <button
                          key={cargo}
                          type="button"
                          onClick={() => toggleBulkTarget(cargo)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {cargo}
                        </button>
                      );
                    })}
                  </div>

                  {listaUsuariosEquipe.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                      {listaUsuariosEquipe.map((usr) => {
                        const active = selectedBulkTargets.includes(usr.nome);
                        return (
                          <button
                            key={usr.id || usr.nome}
                            type="button"
                            onClick={() => toggleBulkTarget(usr.nome)}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                              active
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {usr.nome}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={customBulkInput}
                      onChange={(e) => setCustomBulkInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomBulkTarget(e); }}
                      placeholder="Outro destinatário nominal..."
                      className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomBulkTarget}
                      className="px-3 py-2 bg-slate-900 text-white font-semibold rounded-lg text-xs cursor-pointer"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={bulkSaving || selectedBulkTargets.length === 0}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs cursor-pointer disabled:opacity-50 tabular-nums"
                >
                  {bulkSaving ? 'Criando...' : `Criar ${selectedBulkTargets.length} tarefa(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
