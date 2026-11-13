import React, { useState, useMemo } from 'react';
import { extrairPercentualFrequencia } from '../utils';

export interface CentralPendenciasPerfilProps {
  activeRole: string;
  effectiveUser: {
    nome: string;
    email: string;
    cargo: string;
    disciplina?: string;
  };
  modoVisualizacao: 'foco' | 'completo';
  onToggleModo: (modo: 'foco' | 'completo') => void;
  recadosSemCiencia?: any[];
  tutoradosEmRisco?: any[];
  tarefasUrgentes?: any[];
  notificacoesPedagogicas?: any[];
  alunosMapaoPendentesCount?: number;
  alunosBuscaAtivaCount?: number;
  atrasosHojeCount?: number;
  proximaAulaHoje?: any | null;
  aulasHoje?: any[];
  substituicoesHoje?: any[];
  onNavigate?: (tabName: string) => void;
  onAbrirAluno?: (ra: string) => void;
  onConfirmarCiencia?: (recadoId: string) => void;
  onAtenderNotificacao?: (notifId: string) => void;
  onToggleTarefa?: (tarefaId: string, concluidoAtual: boolean) => void;
  onNovaTarefa?: () => void;
  onAbrirRecado?: (recado: any) => void;
}

type FiltroPendencias = 'todas' | 'urgentes' | 'recados' | 'tarefas' | 'alunos' | 'aulas_subs';

export default function CentralPendenciasPerfil({
  activeRole,
  effectiveUser,
  modoVisualizacao,
  onToggleModo,
  recadosSemCiencia = [],
  tutoradosEmRisco = [],
  tarefasUrgentes = [],
  notificacoesPedagogicas = [],
  alunosMapaoPendentesCount = 0,
  alunosBuscaAtivaCount = 0,
  atrasosHojeCount = 0,
  proximaAulaHoje = null,
  aulasHoje = [],
  substituicoesHoje = [],
  onNavigate,
  onAbrirAluno,
  onConfirmarCiencia,
  onAtenderNotificacao,
  onToggleTarefa,
  onNovaTarefa,
  onAbrirRecado
}: CentralPendenciasPerfilProps) {
  const [filtroAtivo, setFiltroAtivo] = useState<FiltroPendencias>('todas');

  const roleNorm = (activeRole || '').toUpperCase().replace(/-/g, '_');
  const isProfessor = roleNorm === 'PROFESSOR';
  const isPAAC = roleNorm === 'PAAC' || roleNorm === 'PROFESSOR_PAAC';
  const isCoord = roleNorm === 'CGPG' || roleNorm === 'CGPCG';
  const isDirecao = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE');
  const isSecretaria = roleNorm === 'SECRETARIA';

  const nav = (tab: string) => {
    if (onNavigate) {
      onNavigate(tab);
    } else if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab(tab);
    }
  };

  // Apenas tutorados com frequência estritamente abaixo de 75% (< 75%)
  // Estudantes com 75% ou mais NUNCA devem constar como pendência!
  const tutoradosReaisEmRisco = useMemo(() => {
    return (tutoradosEmRisco || []).filter((al: any) => {
      const freq = extrairPercentualFrequencia(al);
      return freq < 75;
    });
  }, [tutoradosEmRisco]);

  // Total de itens pendentes calculados
  const totalPendencias = useMemo(() => {
    let count = recadosSemCiencia.length + tarefasUrgentes.length;
    if (isProfessor || isPAAC) count += tutoradosReaisEmRisco.length;
    if (isDirecao || isCoord || isPAAC) count += notificacoesPedagogicas.length;
    if (isDirecao || isCoord) {
      if (alunosMapaoPendentesCount > 0) count += 1;
      if (alunosBuscaAtivaCount > 0) count += 1;
    }
    if (isSecretaria && atrasosHojeCount > 0) count += 1;
    if ((isDirecao || isCoord || isPAAC) && substituicoesHoje.length > 0) {
      const subsPendentes = substituicoesHoje.filter(s => !s.professorSubstituto || s.professorSubstituto === 'A definir');
      if (subsPendentes.length > 0) count += subsPendentes.length;
    }
    return count;
  }, [
    recadosSemCiencia.length,
    tarefasUrgentes.length,
    tutoradosReaisEmRisco.length,
    notificacoesPedagogicas.length,
    alunosMapaoPendentesCount,
    alunosBuscaAtivaCount,
    atrasosHojeCount,
    substituicoesHoje,
    isProfessor,
    isPAAC,
    isCoord,
    isDirecao,
    isSecretaria
  ]);

  // Substituições pendentes de atribuição hoje
  const substituicoesSemDocente = useMemo(() => {
    return substituicoesHoje.filter(s => !s.professorSubstituto || s.professorSubstituto === 'A definir' || s.professorSubstituto === '-');
  }, [substituicoesHoje]);

  // Próxima aula ou aula atual do professor
  const aulaAtualOuProxima = useMemo(() => {
    if (!aulasHoje || aulasHoje.length === 0) return null;
    if (proximaAulaHoje) return proximaAulaHoje;
    const now = new Date();
    const curHour = now.getHours();
    const curMin = now.getMinutes();
    const curTime = curHour * 60 + curMin;

    // Horários aproximados do PEI em minutos
    const horariosMinutos: Record<number, { inicio: number; fim: number }> = {
      1: { inicio: 7 * 60 + 30, fim: 8 * 60 + 15 },
      2: { inicio: 8 * 60 + 15, fim: 9 * 60 },
      3: { inicio: 9 * 60, fim: 9 * 60 + 45 },
      4: { inicio: 10 * 60 + 5, fim: 10 * 60 + 50 },
      5: { inicio: 10 * 60 + 50, fim: 11 * 60 + 35 },
      6: { inicio: 11 * 60 + 35, fim: 12 * 60 + 20 },
      7: { inicio: 13 * 60 + 20, fim: 14 * 60 + 5 },
      8: { inicio: 14 * 60 + 5, fim: 14 * 60 + 50 },
      9: { inicio: 15 * 60 + 10, fim: 15 * 60 + 55 }
    };

    const ativas = aulasHoje.filter(a => {
      const p = String(a.turma || '').trim();
      return p && p !== '-' && p !== 'ATPC' && p !== 'ALMOÇO';
    });

    for (const aula of ativas) {
      const pid = Number(aula.periodoId);
      const hRange = horariosMinutos[pid];
      if (hRange && curTime <= hRange.fim) {
        return aula;
      }
    }
    return ativas[0] || aulasHoje[0] || null;
  }, [aulasHoje, proximaAulaHoje]);

  // Discriminação exata de todas as ações necessárias para o perfil
  const discriminacaoAcoes = useMemo(() => {
    const itens: {
      id: string;
      categoria: 'recado' | 'tarefa' | 'tutorado' | 'notificacao' | 'substituicao' | 'busca_ativa' | 'auditoria' | 'atraso';
      categoriaLabel: string;
      corBadge: string;
      corBorda: string;
      icone: string;
      titulo: string;
      subtitulo: string;
      detalheExtra?: string;
      motivoAcao: string;
      botaoAcaoTexto: string;
      botaoAcaoIcone: string;
      aoExecutarAcao: () => void;
      botaoSecundarioTexto?: string;
      aoExecutarSecundario?: () => void;
    }[] = [];

    // 1. Recados do Mural sem ciência
    recadosSemCiencia.forEach((rec: any) => {
      itens.push({
        id: `recado-${rec.id}`,
        categoria: 'recado',
        categoriaLabel: 'Mural Oficial · Ciência Obrigatória',
        corBadge: 'bg-purple-50/90 text-purple-900 border-purple-200/60 border-l-4 border-l-purple-600',
        corBorda: 'border-slate-200/80 border-l-4 border-l-purple-500 bg-white',
        icone: 'fa-solid fa-bullhorn text-purple-600',
        titulo: rec.titulo || 'Comunicado Oficial',
        subtitulo: `Emitido por ${rec.autor || 'Direção'} · Para: ${rec.destinatarios || 'Equipe Escolar'}`,
        detalheExtra: rec.conteudo || rec.mensagem || rec.descricao || '',
        motivoAcao: 'Aguardando sua confirmação individual de leitura',
        botaoAcaoTexto: 'Dar Ciência',
        botaoAcaoIcone: 'fa-solid fa-check',
        aoExecutarAcao: () => {
          if (onConfirmarCiencia) onConfirmarCiencia(rec.id);
        },
        botaoSecundarioTexto: 'Ler Completo',
        aoExecutarSecundario: () => {
          if (onAbrirRecado) onAbrirRecado(rec);
          else nav('mural');
        }
      });
    });

    // 2. Tarefas PDCA com prazo crítico ou vencido
    tarefasUrgentes.forEach((t: any) => {
      const dataPrazo = t.dataLimite ? String(t.dataLimite).slice(0, 10).split('-').reverse().join('/') : 'Hoje';
      itens.push({
        id: `tarefa-${t.id}`,
        categoria: 'tarefa',
        categoriaLabel: 'Plano PDCA · Tarefa Crítica',
        corBadge: 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-4 border-l-amber-500',
        corBorda: 'border-slate-200/80 border-l-4 border-l-amber-500 bg-white',
        icone: 'fa-solid fa-list-check text-amber-600',
        titulo: t.descricao || 'Tarefa da Rotina Escolar',
        subtitulo: `Atribuída a: ${t.atribuirA || t.responsavel || 'Equipe PEI'}`,
        motivoAcao: `Prazo crítico: ${dataPrazo} (Aguardando conclusão)`,
        botaoAcaoTexto: 'Concluir Tarefa',
        botaoAcaoIcone: 'fa-solid fa-check-double',
        aoExecutarAcao: () => {
          if (onToggleTarefa) onToggleTarefa(t.id, false);
        },
        botaoSecundarioTexto: 'Ver no PDCA',
        aoExecutarSecundario: () => nav('rotina-pdca')
      });
    });

    // 3. Tutorados em risco de frequência (Professor / PAAC) - estritamente < 75%
    if (isProfessor || isPAAC) {
      tutoradosReaisEmRisco.forEach((al: any) => {
        const freqNum = extrairPercentualFrequencia(al);
        const presenca = al.presenca_anual || al.presenca || `${freqNum}%`;
        itens.push({
          id: `tutorado-${al.ra || al.id}`,
          categoria: 'tutorado',
          categoriaLabel: 'Tutoria PEI · Frequência em Risco',
          corBadge: 'bg-indigo-50/80 text-slate-800 border-indigo-200/50 border-l-4 border-l-indigo-600',
          corBorda: 'border-slate-200/80 border-l-4 border-l-indigo-500 bg-white',
          icone: 'fa-solid fa-user-graduate text-indigo-600',
          titulo: `${al.nome} · ${al.turma || 'Turma não informada'}`,
          subtitulo: `RA: ${al.ra} · Frequência Atual: ${presenca}`,
          motivoAcao: `Presença em ${presenca} (Abaixo do mínimo legal de 75%)`,
          botaoAcaoTexto: 'Abrir Ficha',
          botaoAcaoIcone: 'fa-solid fa-folder-open',
          aoExecutarAcao: () => {
            if (onAbrirAluno && al.ra) onAbrirAluno(al.ra);
            else nav('alunos');
          },
          botaoSecundarioTexto: 'Lançar Ocorrência',
          aoExecutarSecundario: () => nav('registros')
        });
      });
    }

    // 4. Notificações pedagógicas urgentes (Direção / Vice / CGPG / PAAC)
    if (isDirecao || isCoord || isPAAC) {
      notificacoesPedagogicas.forEach((notif: any) => {
        itens.push({
          id: `notif-${notif.id}`,
          categoria: 'notificacao',
          categoriaLabel: 'Ocorrência Pedagógica · Gestão',
          corBadge: 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-4 border-l-rose-500',
          corBorda: 'border-slate-200/80 border-l-4 border-l-rose-500 bg-white',
          icone: 'fa-solid fa-triangle-exclamation text-rose-600',
          titulo: `${notif.nomeAluno || `Estudante RA ${notif.ra}`} (${notif.turma || 'Turma não informada'})`,
          subtitulo: `Encaminhado por: ${notif.autor_nome || notif.autor || 'Docente'} · Tipo: ${notif.tipo || 'Ocorrência'}`,
          detalheExtra: notif.descricao || notif.conteudo || '',
          motivoAcao: 'Notificação marcada para intervenção imediata da equipe gestora',
          botaoAcaoTexto: 'Atender Alerta',
          botaoAcaoIcone: 'fa-solid fa-check',
          aoExecutarAcao: () => {
            if (onAtenderNotificacao) onAtenderNotificacao(notif.id);
          },
          botaoSecundarioTexto: 'Ver Aluno',
          aoExecutarSecundario: () => {
            if (onAbrirAluno && notif.ra) onAbrirAluno(notif.ra);
            else nav('alunos');
          }
        });
      });
    }

    // 5. Substituições sem docente hoje
    if (isDirecao || isCoord || isPAAC) {
      substituicoesSemDocente.forEach((s: any) => {
        itens.push({
          id: `sub-${s.id || s.periodoId + '-' + s.turma}`,
          categoria: 'substituicao',
          categoriaLabel: 'Substituição PEI · Aula sem Docente',
          corBadge: 'bg-indigo-50/80 text-slate-800 border-indigo-200/50 border-l-4 border-l-indigo-600',
          corBorda: 'border-slate-200/80 border-l-4 border-l-indigo-500 bg-white',
          icone: 'fa-solid fa-shuffle text-indigo-600',
          titulo: `${s.periodoId ? `${s.periodoId}ª Aula · ` : ''}${s.turma} (${s.disciplina || 'Componente'})`,
          subtitulo: `Professor ausente: ${s.professorAusente}`,
          motivoAcao: 'Nenhum professor substituto foi designado para assumir esta aula hoje',
          botaoAcaoTexto: 'Atribuir Docente',
          botaoAcaoIcone: 'fa-solid fa-user-plus',
          aoExecutarAcao: () => nav('substituicao-pei')
        });
      });
    }

    // 6. Alunos em Busca Ativa (Direção)
    if (isDirecao && alunosBuscaAtivaCount > 0) {
      itens.push({
        id: 'alerta-busca-ativa',
        categoria: 'busca_ativa',
        categoriaLabel: 'Busca Ativa SEDUC · SLA 48h',
        corBadge: 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-4 border-l-rose-500',
        corBorda: 'border-slate-200/80 border-l-4 border-l-rose-500 bg-white',
        icone: 'fa-solid fa-magnifying-glass-location text-rose-600',
        titulo: `${alunosBuscaAtivaCount} estudantes em alerta crítico de faltas`,
        subtitulo: 'Estudantes com faltas consecutivas ou frequência inferior a 75%',
        motivoAcao: 'Exigência legal de registro de contato com as famílias e regularização',
        botaoAcaoTexto: 'Abrir Busca Ativa',
        botaoAcaoIcone: 'fa-solid fa-arrow-right',
        aoExecutarAcao: () => nav('busca-ativa')
      });
    }

    // 7. Mapão vs SED (Direção / Coordenação)
    if ((isDirecao || isCoord) && alunosMapaoPendentesCount > 0) {
      itens.push({
        id: 'alerta-mapao-sed',
        categoria: 'auditoria',
        categoriaLabel: 'Auditoria SED vs Mapão · Fechamento',
        corBadge: 'bg-indigo-50/80 text-slate-800 border-indigo-200/50 border-l-4 border-l-indigo-600',
        corBorda: 'border-slate-200/80 border-l-4 border-l-indigo-500 bg-white',
        icone: 'fa-solid fa-scale-balanced text-indigo-600',
        titulo: `${alunosMapaoPendentesCount} estudantes com pendência no Mapão`,
        subtitulo: 'Notas ausentes ou divergência na sincronização de frequência SED',
        motivoAcao: 'Regularização necessária antes do fechamento oficial do bimestre',
        botaoAcaoTexto: 'Auditar SED vs Mapão',
        botaoAcaoIcone: 'fa-solid fa-arrow-right',
        aoExecutarAcao: () => nav('comparativo-frequencia')
      });
    }

    // 8. Atrasos hoje (Secretaria)
    if (isSecretaria && atrasosHojeCount > 0) {
      itens.push({
        id: 'alerta-atrasos-hoje',
        categoria: 'atraso',
        categoriaLabel: 'Portão Escolar · Entradas com Atraso',
        corBadge: 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-4 border-l-amber-500',
        corBorda: 'border-slate-200/80 border-l-4 border-l-amber-500 bg-white',
        icone: 'fa-solid fa-clock-rotate-left text-amber-600',
        titulo: `${atrasosHojeCount} alunos entraram com atraso no portão hoje`,
        subtitulo: 'Acompanhamento de pontualidade e emissão de comunicados aos responsáveis',
        motivoAcao: 'Registros do dia aguardando regularização ou justificativa da secretaria',
        botaoAcaoTexto: 'Ver Atrasos do Dia',
        botaoAcaoIcone: 'fa-solid fa-arrow-right',
        aoExecutarAcao: () => nav('dashboard-atrasos')
      });
    }

    return itens;
  }, [
    recadosSemCiencia,
    tarefasUrgentes,
    tutoradosReaisEmRisco,
    notificacoesPedagogicas,
    substituicoesSemDocente,
    alunosBuscaAtivaCount,
    alunosMapaoPendentesCount,
    atrasosHojeCount,
    isProfessor,
    isPAAC,
    isCoord,
    isDirecao,
    isSecretaria,
    onConfirmarCiencia,
    onAbrirRecado,
    onToggleTarefa,
    onAbrirAluno,
    onAtenderNotificacao
  ]);

  const acoesFiltradas = useMemo(() => {
    if (filtroAtivo === 'todas') return discriminacaoAcoes;
    if (filtroAtivo === 'urgentes') return discriminacaoAcoes.filter(a => a.categoria === 'recado' || a.categoria === 'tarefa' || a.categoria === 'notificacao' || a.categoria === 'substituicao');
    if (filtroAtivo === 'recados') return discriminacaoAcoes.filter(a => a.categoria === 'recado');
    if (filtroAtivo === 'tarefas') return discriminacaoAcoes.filter(a => a.categoria === 'tarefa');
    if (filtroAtivo === 'alunos') return discriminacaoAcoes.filter(a => a.categoria === 'tutorado' || a.categoria === 'busca_ativa');
    if (filtroAtivo === 'aulas_subs') return discriminacaoAcoes.filter(a => a.categoria === 'substituicao');
    return discriminacaoAcoes;
  }, [discriminacaoAcoes, filtroAtivo]);

  return (
    <section className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden transition-all duration-200">
      {/* 1. TOPO DA CENTRAL DE RESOLUÇÃO (GLASSMORPHISM) */}
      <div className="p-5 sm:p-6 bg-white/90 backdrop-blur-md border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-list-check text-lg"></i>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                O que Resolver Hoje · Central de Pendências
              </h2>
              <span className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold border border-l-4 tabular-nums ${
                totalPendencias > 0
                  ? 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500'
                  : 'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
              }`}>
                {totalPendencias > 0
                  ? `${totalPendencias} ${totalPendencias === 1 ? 'ação necessária' : 'ações necessárias'}`
                  : 'Tudo em dia'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ações diretas e resolução prioritária para <strong className="font-semibold text-slate-700">{effectiveUser.nome}</strong> ({activeRole})
            </p>

            {/* Chips interativos de atalho por categoria */}
            {totalPendencias > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                {recadosSemCiencia.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAtivo('recados')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-50/90 hover:bg-purple-100/80 text-purple-900 border border-purple-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Filtrar comunicados sem confirmação de leitura"
                  >
                    <i className="fa-solid fa-bullhorn text-[10px] text-purple-600"></i>
                    <span>{recadosSemCiencia.length} Ciência{recadosSemCiencia.length > 1 ? 's' : ''} no Mural</span>
                  </button>
                )}
                {tarefasUrgentes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAtivo('tarefas')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50/90 hover:bg-amber-100/80 text-amber-900 border border-amber-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Filtrar tarefas com prazo crítico/vencidas"
                  >
                    <i className="fa-solid fa-list-check text-[10px] text-amber-600"></i>
                    <span>{tarefasUrgentes.length} Tarefa{tarefasUrgentes.length > 1 ? 's' : ''} PDCA</span>
                  </button>
                )}
                {(isProfessor || isPAAC) && tutoradosReaisEmRisco.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAtivo('alunos')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50/90 hover:bg-indigo-100/80 text-indigo-900 border border-indigo-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Filtrar tutorados com frequência < 75%"
                  >
                    <i className="fa-solid fa-user-graduate text-[10px] text-indigo-600"></i>
                    <span>{tutoradosReaisEmRisco.length} Tutorado{tutoradosReaisEmRisco.length > 1 ? 's' : ''} em Risco</span>
                  </button>
                )}
                {(isDirecao || isCoord || isPAAC) && notificacoesPedagogicas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAtivo('urgentes')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50/90 hover:bg-rose-100/80 text-rose-900 border border-rose-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Filtrar notificações pedagógicas encaminhadas à gestão"
                  >
                    <i className="fa-solid fa-triangle-exclamation text-[10px] text-rose-600"></i>
                    <span>{notificacoesPedagogicas.length} Notificaç{notificacoesPedagogicas.length > 1 ? 'ões' : 'ão'}</span>
                  </button>
                )}
                {(isDirecao || isCoord || isPAAC) && substituicoesSemDocente.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFiltroAtivo('aulas_subs')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50/90 hover:bg-indigo-100/80 text-indigo-900 border border-indigo-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Filtrar aulas sem professor substituto hoje"
                  >
                    <i className="fa-solid fa-shuffle text-[10px] text-indigo-600"></i>
                    <span>{substituicoesSemDocente.length} Aula{substituicoesSemDocente.length > 1 ? 's' : ''} sem Substituto</span>
                  </button>
                )}
                {isDirecao && alunosBuscaAtivaCount > 0 && (
                  <button
                    type="button"
                    onClick={() => nav('busca-ativa')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50/90 hover:bg-rose-100/80 text-rose-900 border border-rose-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Abrir Busca Ativa SEDUC"
                  >
                    <i className="fa-solid fa-magnifying-glass-location text-[10px] text-rose-600"></i>
                    <span>{alunosBuscaAtivaCount} Busca Ativa</span>
                  </button>
                )}
                {(isDirecao || isCoord) && alunosMapaoPendentesCount > 0 && (
                  <button
                    type="button"
                    onClick={() => nav('comparativo-frequencia')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50/90 hover:bg-indigo-100/80 text-indigo-900 border border-indigo-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Abrir Comparativo SED vs Mapão"
                  >
                    <i className="fa-solid fa-scale-balanced text-[10px] text-indigo-600"></i>
                    <span>{alunosMapaoPendentesCount} Auditoria SED vs Mapão</span>
                  </button>
                )}
                {isSecretaria && atrasosHojeCount > 0 && (
                  <button
                    type="button"
                    onClick={() => nav('dashboard-atrasos')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50/90 hover:bg-amber-100/80 text-amber-900 border border-amber-200/70 flex items-center gap-1.5 transition-colors cursor-pointer tabular-nums"
                    title="Abrir Atrasos do Portão"
                  >
                    <i className="fa-solid fa-clock-rotate-left text-[10px] text-amber-600"></i>
                    <span>{atrasosHojeCount} Atrasos Hoje</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chave de Modo Estilo Apple Segmented Control */}
        <div className="flex items-center bg-slate-100/90 p-1 rounded-2xl border border-slate-200/60 self-start lg:self-auto shrink-0">
          <button
            type="button"
            onClick={() => onToggleModo('foco')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              modoVisualizacao === 'foco'
                ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200/70'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Exibe a Central de Resoluções e ações de alta prioridade"
          >
            <i className={`fa-solid fa-bolt text-[11px] ${modoVisualizacao === 'foco' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
            <span>Modo Foco</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleModo('completo')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              modoVisualizacao === 'completo'
                ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200/70'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Exibe todas as tabelas completas, históricos e gráficos"
          >
            <i className={`fa-solid fa-chart-column text-[11px] ${modoVisualizacao === 'completo' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
            <span>Modo Analítico</span>
          </button>
        </div>
      </div>

      {/* 2. BARRA DE FILTROS RÁPIDOS DESLIZÁVEL (SWIPEABLE PILLS) */}
      <div className="px-4 sm:px-5 py-3 bg-slate-50/70 border-b border-slate-200/70 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-semibold">
        <button
          type="button"
          onClick={() => setFiltroAtivo('todas')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
            filtroAtivo === 'todas'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
          }`}
        >
          <span>Todas a Resolver</span>
          <span className={`font-mono text-[11px] tabular-nums ${
            filtroAtivo === 'todas' ? 'text-slate-300' : 'text-slate-400'
          }`}>
            {totalPendencias}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('urgentes')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
            filtroAtivo === 'urgentes'
              ? 'bg-rose-50 text-rose-900 border-rose-300'
              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-fire text-rose-500 text-[11px]"></i>
          <span>Urgente / Hoje</span>
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('recados')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
            filtroAtivo === 'recados'
              ? 'bg-purple-50 text-purple-900 border-purple-300'
              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-bullhorn text-purple-600 text-[11px]"></i>
          <span>Recados sem Ciência</span>
          {recadosSemCiencia.length > 0 && (
            <span className="font-mono text-[11px] text-purple-700 tabular-nums">{recadosSemCiencia.length}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('tarefas')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
            filtroAtivo === 'tarefas'
              ? 'bg-amber-50 text-amber-900 border-amber-300'
              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-list-check text-amber-600 text-[11px]"></i>
          <span>Tarefas PDCA</span>
          {tarefasUrgentes.length > 0 && (
            <span className="font-mono text-[11px] text-amber-700 tabular-nums">{tarefasUrgentes.length}</span>
          )}
        </button>

        {(isProfessor || isPAAC || isDirecao || isCoord) && (
          <button
            type="button"
            onClick={() => setFiltroAtivo('alunos')}
            className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
              filtroAtivo === 'alunos'
                ? 'bg-indigo-50 text-indigo-900 border-indigo-300'
                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
            }`}
          >
            <i className="fa-solid fa-user-graduate text-indigo-600 text-[11px]"></i>
            <span>Estudantes em Alerta</span>
            {(tutoradosReaisEmRisco.length > 0 || alunosBuscaAtivaCount > 0) && (
              <span className="font-mono text-[11px] text-indigo-700 tabular-nums">
                {isProfessor || isPAAC ? tutoradosReaisEmRisco.length : alunosBuscaAtivaCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setFiltroAtivo('aulas_subs')}
          className={`px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 border ${
            filtroAtivo === 'aulas_subs'
              ? 'bg-indigo-50 text-indigo-900 border-indigo-300'
              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-clock text-indigo-600 text-[11px]"></i>
          <span>{isProfessor ? 'Minhas Aulas' : 'Aulas & Substituições'}</span>
          {!isProfessor && substituicoesSemDocente.length > 0 && (
            <span className="font-mono text-[11px] text-rose-700 tabular-nums">{substituicoesSemDocente.length}</span>
          )}
        </button>
      </div>

      {/* 3. CONTEÚDO PRINCIPAL: ITENS DE RESOLUÇÃO */}
      <div className="p-4 sm:p-6 bg-[#F8FAFC]/60 space-y-5">
        {/* QUADRO DISCRIMINADO DE AÇÕES NECESSÁRIAS */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start sm:items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                totalPendencias > 0 ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600'
              }`}>
                <i className="fa-solid fa-list-check text-sm"></i>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-semibold tracking-tight text-slate-900">
                    Ações Necessárias Identificadas
                  </h3>
                  <span className={`text-xs font-semibold tabular-nums ${
                    totalPendencias > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}>
                    &middot; {totalPendencias} {totalPendencias === 1 ? 'pendente' : 'pendentes'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {totalPendencias > 0
                    ? `Discriminação detalhada para ${effectiveUser.nome} (${activeRole})`
                    : `Tudo regularizado para ${effectiveUser.nome}. Nenhuma ação prioritária em aberto.`}
                </p>
              </div>
            </div>

            {totalPendencias > 0 && (
              <span className="text-xs font-mono text-slate-400 tabular-nums self-start sm:self-auto">
                Exibindo {acoesFiltradas.length} de {totalPendencias}
              </span>
            )}
          </div>

          {/* Lista de Ações Precisas */}
          {totalPendencias > 0 ? (
            <div className="p-4 space-y-2.5">
              {acoesFiltradas.length > 0 ? (
                acoesFiltradas.map((acao) => (
                  <div
                    key={acao.id}
                    className={`p-3.5 sm:p-4 rounded-2xl border ${acao.corBorda} hover:bg-slate-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3`}
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${acao.corBadge} flex items-center gap-1.5`}>
                          <i className={acao.icone}></i>
                          <span>{acao.categoriaLabel}</span>
                        </span>
                        <span className="text-[11px] font-medium text-rose-700 flex items-center gap-1">
                          <i className="fa-solid fa-circle-exclamation text-[10px]"></i>
                          <span>{acao.motivoAcao}</span>
                        </span>
                      </div>

                      <h4 className="font-semibold text-slate-900 text-xs sm:text-sm">
                        {acao.titulo}
                      </h4>

                      <p className="text-xs text-slate-500">
                        {acao.subtitulo}
                      </p>

                      {acao.detalheExtra && (
                        <p className="text-xs text-slate-600 bg-slate-50/80 p-2.5 rounded-xl line-clamp-2 border border-slate-200/60">
                          {acao.detalheExtra}
                        </p>
                      )}
                    </div>

                    {/* Botões de Resolução Direta */}
                    <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 self-end md:self-center">
                      {acao.botaoSecundarioTexto && acao.aoExecutarSecundario && (
                        <button
                          type="button"
                          onClick={acao.aoExecutarSecundario}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {acao.botaoSecundarioTexto}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={acao.aoExecutarAcao}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        title="Executar resolução desta ação"
                      >
                        <i className={`${acao.botaoAcaoIcone} text-[11px]`}></i>
                        <span>{acao.botaoAcaoTexto}</span>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50/60 rounded-2xl border border-slate-200/60">
                  Nenhuma ação encontrada para o filtro selecionado ({filtroAtivo}).
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center space-y-2 bg-emerald-50/30">
              <div className="w-11 h-11 mx-auto rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-lg">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <h4 className="font-semibold text-slate-900 text-sm">
                Tudo em dia para {effectiveUser.nome}
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Não há comunicados sem ciência, tarefas PDCA atrasadas ou estudantes com alerta crítico sob sua responsabilidade neste momento.
              </p>
            </div>
          )}
        </div>

        {/* A. BLOCO DE AVISOS DO MURAL AGUARDANDO SUA CIÊNCIA */}
        {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'recados') && recadosSemCiencia.length > 0 && (
          <div className="p-4 sm:p-5 bg-purple-50/50 border border-purple-200/70 border-l-4 border-l-purple-500 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-semibold text-purple-950 flex items-center gap-2">
                <i className="fa-solid fa-bullhorn text-purple-600"></i>
                <span>Comunicados Oficiais Aguardando Ciência ({recadosSemCiencia.length})</span>
              </span>
              <button
                type="button"
                onClick={() => nav('mural')}
                className="text-xs font-semibold text-purple-700 hover:text-purple-950 cursor-pointer flex items-center gap-1 whitespace-nowrap"
              >
                <span>Mural Completo</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recadosSemCiencia.slice(0, 4).map(rec => (
                <div
                  key={rec.id}
                  className="p-4 bg-white rounded-2xl border border-purple-200/60 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="font-semibold text-purple-800">{rec.destinatarios || 'Oficial'}</span>
                      <span className="font-mono tabular-nums">
                        {(rec.criadoEm || rec.data || '').slice(0, 10).split('-').reverse().join('/')}
                      </span>
                    </div>
                    <h3 className="font-semibold text-slate-900 text-xs sm:text-sm line-clamp-1" title={rec.titulo}>
                      {rec.titulo}
                    </h3>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {rec.conteudo || rec.mensagem || rec.descricao}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Emitido por <strong className="font-medium text-slate-600">{rec.autor || 'Direção'}</strong>
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onAbrirRecado ? onAbrirRecado(rec) : nav('mural')}
                      className="text-xs font-semibold text-purple-700 hover:text-purple-950 cursor-pointer"
                    >
                      Ler Completo
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmarCiencia && onConfirmarCiencia(rec.id)}
                      className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                      title="Registrar confirmação de leitura deste comunicado oficial"
                    >
                      <i className="fa-solid fa-check text-[11px]"></i>
                      <span>Dar Ciência</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* B. BLOCO DE NOTIFICAÇÕES PEDAGÓGICAS */}
        {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && (isDirecao || isCoord || isPAAC) && notificacoesPedagogicas.length > 0 && (
          <div className="p-4 sm:p-5 bg-rose-50/50 border border-rose-200/70 border-l-4 border-l-rose-500 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-semibold text-rose-950 flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                <span>Notificações Pedagógicas Urgentes ({notificacoesPedagogicas.length})</span>
              </span>
              <button
                type="button"
                onClick={() => nav('registros')}
                className="text-xs font-semibold text-rose-700 hover:text-rose-950 cursor-pointer flex items-center gap-1 whitespace-nowrap"
              >
                <span>Módulo de Registros</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {notificacoesPedagogicas.slice(0, 4).map(notif => (
                <div
                  key={notif.id}
                  className="p-4 bg-white rounded-2xl border border-rose-200/60 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-rose-700">{notif.tipo || 'Ocorrência Pedagógica'}</span>
                      <span className="text-slate-400 font-mono tabular-nums">
                        {(notif.notificadoEm || notif.data || notif.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                      </span>
                    </div>
                    <h4 className="font-semibold text-slate-900 text-xs sm:text-sm">
                      {notif.nomeAluno || `Estudante RA: ${notif.ra}`}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {notif.turma || 'Sem turma'} &middot; {notif.autor_nome || notif.autor || 'Docente'}
                    </p>
                    <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl line-clamp-2">
                      {notif.descricao || notif.conteudo || 'Sem descrição cadastrada'}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => onAbrirAluno && notif.ra && onAbrirAluno(notif.ra)}
                      className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer"
                    >
                      Ver Ficha do Aluno
                    </button>
                    <button
                      type="button"
                      onClick={() => onAtenderNotificacao && onAtenderNotificacao(notif.id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Marcar como atendida e ciente da gestão"
                    >
                      <i className="fa-solid fa-check text-[11px]"></i>
                      <span>Atender Alerta</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* C. GRID DE CARDS OPERACIONAIS DE RESOLUÇÃO POR CARGO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. TAREFAS CRÍTICAS / PDCA (UNIVERSAL) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'tarefas') && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-list-check text-xs"></i>
                    </span>
                    <span>Tarefas PDCA</span>
                  </span>
                  <span className={`text-[11px] font-semibold tabular-nums ${
                    tarefasUrgentes.length > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {tarefasUrgentes.length} críticas
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Rotinas do plano de ação PEI atribuídas a você.
                </p>

                {tarefasUrgentes.length > 0 ? (
                  <div className="mt-3 space-y-2 max-h-44 overflow-y-auto pr-1">
                    {tarefasUrgentes.slice(0, 4).map(t => (
                      <div
                        key={t.id}
                        className="p-2.5 bg-amber-50/70 rounded-xl border border-amber-200/70 border-l-4 border-l-amber-500 flex items-center justify-between text-xs gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-800 truncate">{t.descricao}</p>
                          <span className="text-[11px] font-mono text-amber-800 tabular-nums block">
                            Prazo: {t.dataLimite ? String(t.dataLimite).slice(0, 10).split('-').reverse().join('/') : 'Hoje'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleTarefa && onToggleTarefa(t.id, false)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] rounded-lg transition-colors shrink-0 cursor-pointer flex items-center gap-1"
                          title="Marcar tarefa como concluída agora"
                        >
                          <i className="fa-solid fa-check text-[10px]"></i>
                          <span>Concluir</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/70 text-center text-xs text-emerald-800 font-medium flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Nenhuma tarefa atrasada hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onNovaTarefa ? onNovaTarefa() : nav('rotina-pdca')}
                  className="text-xs font-semibold text-amber-700 hover:text-amber-900 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-plus text-[10px]"></i>
                  <span>Nova Tarefa</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('rotina-pdca')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo PDCA</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 2. PROFESSOR / PAAC: TUTORADOS EM RISCO */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'alunos') && (isProfessor || isPAAC) && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-user-graduate text-xs"></i>
                    </span>
                    <span>Tutorados em Risco</span>
                  </span>
                  <span className={`text-[11px] font-semibold tabular-nums ${
                    tutoradosReaisEmRisco.length > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}>
                    {tutoradosReaisEmRisco.length} &lt; 75%
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Estudantes sob sua tutoria com presença inferior a 75%.
                </p>

                {tutoradosReaisEmRisco.length > 0 ? (
                  <div className="mt-3 space-y-2 max-h-44 overflow-y-auto pr-1">
                    {tutoradosReaisEmRisco.slice(0, 3).map(al => {
                      const freq = extrairPercentualFrequencia(al);
                      const presencaStr = al.presenca_anual || al.presenca || `${freq}%`;
                      return (
                        <div
                          key={al.ra || al.id}
                          className="p-2.5 bg-rose-50/60 hover:bg-rose-50 rounded-xl border border-rose-200/70 border-l-4 border-l-rose-500 flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="min-w-0 pr-1">
                            <p className="font-semibold text-slate-900 truncate max-w-[140px]">{al.nome}</p>
                            <span className="text-[11px] text-slate-500 tabular-nums">{al.turma} &middot; RA {al.ra}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono font-semibold text-rose-700 tabular-nums">{presencaStr}</span>
                            <button
                              type="button"
                              onClick={() => onAbrirAluno && onAbrirAluno(al.ra)}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] rounded-lg transition-colors cursor-pointer"
                              title="Abrir prontuário e ficha de acompanhamento"
                            >
                              Ficha
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/70 text-center text-xs text-emerald-800 font-medium flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Nenhum tutorado em risco crítico hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-900 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-pen text-[10px]"></i>
                  <span>Lançar Ocorrência</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('alunos')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo Alunos</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 3. AULAS & PRÓXIMA AULA (PROFESSORES) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'aulas_subs') && isProfessor && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-clock text-xs"></i>
                    </span>
                    <span>Próxima Aula</span>
                  </span>
                  <span className="text-[11px] font-semibold text-indigo-700 tabular-nums">
                    {aulasHoje.length} hoje
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Horário e ambiente das aulas programadas para hoje.
                </p>

                {aulaAtualOuProxima ? (
                  <div className="mt-3 p-3 bg-indigo-50/60 border border-indigo-200/60 border-l-4 border-l-indigo-600 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-indigo-950 tabular-nums">
                        {aulaAtualOuProxima.periodoId}ª Aula
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-slate-600">
                        {aulaAtualOuProxima.turma}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-900">
                      {aulaAtualOuProxima.disciplina || 'Componente Curricular'}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span><i className="fa-solid fa-location-dot text-slate-400 mr-1"></i>{aulaAtualOuProxima.sala || 'Sala de Aula'}</span>
                      <button
                        type="button"
                        onClick={() => nav('horarios')}
                        className="text-indigo-700 font-semibold hover:underline cursor-pointer"
                      >
                        Ver Detalhes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-center text-xs text-slate-500">
                    Nenhuma aula restante para hoje na sua agenda.
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-900 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-pen text-[10px]"></i>
                  <span>Ocorrência</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('horarios')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Minha Grade</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 4. SUBSTITUIÇÕES PEI DO DIA (EXCLUSIVO GESTÃO/PAAC - OCULTO PARA PROFESSOR) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'aulas_subs') && (isDirecao || isCoord || isPAAC) && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-shuffle text-xs"></i>
                    </span>
                    <span>Substituições PEI</span>
                  </span>
                  <span className={`text-[11px] font-semibold tabular-nums ${
                    substituicoesSemDocente.length > 0 ? 'text-rose-700' : substituicoesHoje.length > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {substituicoesHoje.length} hoje
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Ausências docentes e cobertura de turmas no dia.
                </p>

                {substituicoesHoje.length > 0 ? (
                  <div className="mt-3 space-y-2 max-h-44 overflow-y-auto pr-1">
                    {substituicoesHoje.slice(0, 3).map((sub, idx) => (
                      <div
                        key={sub.id || idx}
                        className="p-2.5 bg-amber-50/60 rounded-xl border border-amber-200/70 border-l-4 border-l-amber-500 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-semibold text-slate-800">
                          <span className="truncate max-w-[140px]">Ausente: {sub.professorAusente}</span>
                          <span className="text-[11px] font-mono text-amber-800">{sub.turma}</span>
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Substituto: <strong className="font-semibold text-slate-900">{sub.professorSubstituto || 'A definir'}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/70 text-center text-xs text-emerald-800 font-medium flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Corpo docente 100% presente hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('substituicao-pei')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Gerenciar Substituições</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 5. GESTÃO: BUSCA ATIVA & SLA SEDUC (DIREÇÃO/VICE) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'alunos') && isDirecao && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-magnifying-glass-location text-xs"></i>
                    </span>
                    <span>Busca Ativa &amp; SLA</span>
                  </span>
                  <span className="text-[11px] font-semibold text-rose-700 tabular-nums">
                    {alunosBuscaAtivaCount} em risco
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Estudantes com 3 faltas seguidas ou frequência &lt; 75% (Res. SEDUC 39/2023).
                </p>

                <div className="mt-3 p-3 bg-rose-50/60 border border-rose-200/60 border-l-4 border-l-rose-500 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>SLA de Contato:</span>
                    <span className="text-rose-700 font-mono">48 horas</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Contate os responsáveis e registre a ata de atendimento.
                  </p>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('busca-ativa')}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Abrir Painel Busca Ativa</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 6. GESTÃO / COORDENAÇÃO: AUDITORIA SED VS MAPÃO */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && (isDirecao || isCoord) && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-scale-balanced text-xs"></i>
                    </span>
                    <span>Auditoria SED vs Mapão</span>
                  </span>
                  <span className={`text-[11px] font-semibold tabular-nums ${
                    alunosMapaoPendentesCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {alunosMapaoPendentesCount} pendência{alunosMapaoPendentesCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Transferidos sem notas lançadas ou divergência de frequência SED vs Mapão.
                </p>

                <div className="mt-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200/60 text-xs flex items-center justify-between">
                  <span className="text-slate-600">Importador de Boletim</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1.5">
                    <i className="fa-solid fa-file-pdf"></i>
                    <span>Leitor PDF Ativo</span>
                  </span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('comparativo-frequencia')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Abrir Comparativo SED</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 7. SECRETARIA: ATRASOS HOJE & DOCUMENTOS */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && isSecretaria && (
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 gap-2">
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                      <i className="fa-solid fa-clock-rotate-left text-xs"></i>
                    </span>
                    <span>Atrasos no Portão</span>
                  </span>
                  <span className="text-[11px] font-semibold text-amber-700 tabular-nums">
                    {atrasosHojeCount} hoje
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Entradas tardias computadas hoje para acompanhamento.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('input-busca-aluno-atraso') || document.querySelector('input[placeholder*="filtrar"]');
                      if (el) (el as HTMLElement).focus();
                      else nav('dashboard-atrasos');
                    }}
                    className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold rounded-xl border border-amber-200/70 text-center transition-colors cursor-pointer"
                  >
                    + Registrar Atraso
                  </button>
                  <button
                    type="button"
                    onClick={() => nav('dashboard-atrasos')}
                    className="p-2 bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-semibold rounded-xl border border-slate-200/70 text-center transition-colors cursor-pointer"
                  >
                    Ver Relatório
                  </button>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('secretaria')}
                  className="text-xs font-semibold text-purple-700 hover:text-purple-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo da Secretaria</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 4. BARRA DE ATALHOS RÁPIDOS DE RESOLUÇÃO */}
        <div className="pt-3 border-t border-slate-200/70 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 shrink-0">
            <i className="fa-solid fa-bolt text-amber-500"></i>
            <span>Atalhos Rápidos ({activeRole})</span>
          </span>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {isProfessor && (
              <>
                <button type="button" onClick={() => nav('horarios')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-clock text-indigo-600"></i><span>Meus Horários</span>
                </button>
                <button type="button" onClick={() => nav('registros')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-pen text-rose-600"></i><span>Nova Ocorrência</span>
                </button>
                <button type="button" onClick={() => nav('alunos')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-user-graduate text-indigo-600"></i><span>Meus Tutorados</span>
                </button>
                <button type="button" onClick={() => nav('mural')} className="px-3 py-1.5 bg-purple-50/70 hover:bg-purple-100/70 border border-purple-200/70 text-purple-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-bullhorn text-purple-600"></i><span>Mural Oficial</span>
                </button>
              </>
            )}

            {(isCoord || isPAAC) && (
              <>
                <button type="button" onClick={() => nav('comparativo-frequencia')} className="px-3 py-1.5 bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/70 text-indigo-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-scale-balanced text-indigo-600"></i><span>SED vs Mapão</span>
                </button>
                <button type="button" onClick={() => nav('substituicao-pei')} className="px-3 py-1.5 bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200/70 text-amber-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-shuffle text-amber-600"></i><span>Substituições PEI</span>
                </button>
                <button type="button" onClick={() => nav('registros')} className="px-3 py-1.5 bg-rose-50/70 hover:bg-rose-100/70 border border-rose-200/70 text-rose-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-triangle-exclamation text-rose-600"></i><span>Notificações Pedagógicas</span>
                </button>
                <button type="button" onClick={() => nav('rotina-pdca')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-list-check text-indigo-600"></i><span>Tarefas PDCA</span>
                </button>
                <button type="button" onClick={() => nav('mural')} className="px-3 py-1.5 bg-purple-50/70 hover:bg-purple-100/70 border border-purple-200/70 text-purple-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-bullhorn text-purple-600"></i><span>Mural</span>
                </button>
              </>
            )}

            {isDirecao && (
              <>
                <button type="button" onClick={() => nav('busca-ativa')} className="px-3 py-1.5 bg-rose-50/70 hover:bg-rose-100/70 border border-rose-200/70 text-rose-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-magnifying-glass-location text-rose-600"></i><span>Busca Ativa SEDUC</span>
                </button>
                <button type="button" onClick={() => nav('comparativo-frequencia')} className="px-3 py-1.5 bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/70 text-indigo-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-scale-balanced text-indigo-600"></i><span>SED vs Mapão</span>
                </button>
                <button type="button" onClick={() => nav('substituicao-pei')} className="px-3 py-1.5 bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200/70 text-amber-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-shuffle text-amber-600"></i><span>Substituições Hoje</span>
                </button>
                <button type="button" onClick={() => nav('registros')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-triangle-exclamation text-rose-600"></i><span>Notificações</span>
                </button>
                <button type="button" onClick={() => nav('auditoria')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-shield-halved text-slate-600"></i><span>Auditoria</span>
                </button>
              </>
            )}

            {isSecretaria && (
              <>
                <button type="button" onClick={() => nav('dashboard-atrasos')} className="px-3 py-1.5 bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200/70 text-amber-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-clock-rotate-left text-amber-600"></i><span>Atrasos no Portão</span>
                </button>
                <button type="button" onClick={() => nav('secretaria')} className="px-3 py-1.5 bg-purple-50/70 hover:bg-purple-100/70 border border-purple-200/70 text-purple-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-building-columns text-purple-600"></i><span>Balcão Secretaria</span>
                </button>
                <button type="button" onClick={() => nav('alunos')} className="px-3 py-1.5 bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/70 text-indigo-900 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-user-graduate text-indigo-600"></i><span>Consultar Aluno</span>
                </button>
                <button type="button" onClick={() => nav('mural')} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/80 text-slate-700 font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-bullhorn text-purple-600"></i><span>Mural</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
