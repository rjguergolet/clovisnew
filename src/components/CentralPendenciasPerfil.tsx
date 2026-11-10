import React, { useState, useMemo } from 'react';

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

  // Total de itens pendentes calculados
  const totalPendencias = useMemo(() => {
    let count = recadosSemCiencia.length + tarefasUrgentes.length;
    if (isProfessor || isPAAC) count += tutoradosEmRisco.length;
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
    tutoradosEmRisco.length,
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

  return (
    <section className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden transition-all duration-200">
      
      {/* 1. TOPO DA CENTRAL DE RESOLUÇÃO */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-400/20 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0 shadow-inner">
            <i className="fa-solid fa-list-check text-xl"></i>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>O que Resolver Hoje · Central de Pendências</span>
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                totalPendencias > 0
                  ? 'bg-rose-500 text-white shadow-xs animate-pulse'
                  : 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/30'
              }`}>
                {totalPendencias > 0 ? `${totalPendencias} ${totalPendencias === 1 ? 'Ação Necessária' : 'Ações Necessárias'}` : 'Tudo em Dia'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Ações diretas e links de resolução prioritária para <strong>{effectiveUser.nome}</strong> ({activeRole}).
            </p>
          </div>
        </div>

        {/* Chave de Modo: Foco vs Analítico */}
        <div className="flex items-center bg-white/10 p-1 rounded-xl border border-white/15 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => onToggleModo('foco')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              modoVisualizacao === 'foco'
                ? 'bg-cyan-400 text-blue-950 shadow-sm font-black'
                : 'text-blue-100 hover:text-white hover:bg-white/10'
            }`}
            title="Exibe a Central de Resoluções e ações de alta prioridade"
          >
            <i className="fa-solid fa-bolt text-xs"></i>
            <span>Modo Foco</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleModo('completo')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              modoVisualizacao === 'completo'
                ? 'bg-cyan-400 text-blue-950 shadow-sm font-black'
                : 'text-blue-100 hover:text-white hover:bg-white/10'
            }`}
            title="Exibe todas as tabelas completas, históricos e gráficos"
          >
            <i className="fa-solid fa-chart-column text-xs"></i>
            <span>Modo Analítico</span>
          </button>
        </div>
      </div>

      {/* 2. BARRA DE FILTROS RÁPIDOS DA CENTRAL */}
      <div className="px-4 py-2.5 bg-slate-100/90 border-b border-slate-200/90 flex items-center gap-1.5 overflow-x-auto text-xs font-bold">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1 hidden sm:inline">Filtrar:</span>
        
        <button
          type="button"
          onClick={() => setFiltroAtivo('todas')}
          className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            filtroAtivo === 'todas'
              ? 'bg-blue-900 text-white shadow-2xs'
              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
          }`}
        >
          <span>Todas a Resolver</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            filtroAtivo === 'todas' ? 'bg-blue-800 text-white' : 'bg-slate-200 text-slate-700'
          }`}>
            {totalPendencias}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('urgentes')}
          className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            filtroAtivo === 'urgentes'
              ? 'bg-rose-600 text-white shadow-2xs'
              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
          }`}
        >
          <i className="fa-solid fa-fire text-rose-500"></i>
          <span>Urgente / Hoje</span>
          {(recadosSemCiencia.length > 0 || tarefasUrgentes.length > 0 || notificacoesPedagogicas.length > 0) && (
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('recados')}
          className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            filtroAtivo === 'recados'
              ? 'bg-purple-700 text-white shadow-2xs'
              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
          }`}
        >
          <i className="fa-solid fa-bullhorn text-purple-600"></i>
          <span>Recados sem Ciência</span>
          {recadosSemCiencia.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-800 font-mono">
              {recadosSemCiencia.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFiltroAtivo('tarefas')}
          className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            filtroAtivo === 'tarefas'
              ? 'bg-amber-600 text-white shadow-2xs'
              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
          }`}
        >
          <i className="fa-solid fa-list-check text-amber-600"></i>
          <span>Tarefas PDCA</span>
          {tarefasUrgentes.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-900 font-mono">
              {tarefasUrgentes.length}
            </span>
          )}
        </button>

        {(isProfessor || isPAAC || isDirecao || isCoord) && (
          <button
            type="button"
            onClick={() => setFiltroAtivo('alunos')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              filtroAtivo === 'alunos'
                ? 'bg-cyan-700 text-white shadow-2xs'
                : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-user-graduate text-cyan-600"></i>
            <span>Estudantes em Alerta</span>
            {(tutoradosEmRisco.length > 0 || alunosBuscaAtivaCount > 0) && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-100 text-cyan-900 font-mono">
                {isProfessor || isPAAC ? tutoradosEmRisco.length : alunosBuscaAtivaCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setFiltroAtivo('aulas_subs')}
          className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            filtroAtivo === 'aulas_subs'
              ? 'bg-blue-800 text-white shadow-2xs'
              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
          }`}
        >
          <i className="fa-solid fa-clock text-blue-700"></i>
          <span>Aulas &amp; Substituições</span>
          {substituicoesSemDocente.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-100 text-rose-800 font-mono">
              {substituicoesSemDocente.length}
            </span>
          )}
        </button>
      </div>

      {/* 3. CONTEÚDO PRINCIPAL: ITENS DE RESOLUÇÃO */}
      <div className="p-4 sm:p-5 bg-slate-50/60 space-y-4">

        {/* --------------------------------------------------------------- */}
        {/* A. BLOCO DE AVISOS DO MURAL AGUARDANDO SUA CIÊNCIA */}
        {/* --------------------------------------------------------------- */}
        {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'recados') && recadosSemCiencia.length > 0 && (
          <div className="p-4 bg-purple-50/90 border border-purple-200 rounded-xl space-y-3 shadow-2xs animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-purple-900 flex items-center gap-2">
                <i className="fa-solid fa-bullhorn text-purple-700"></i>
                <span>Comunicados Oficiais Aguardando Sua Ciência ({recadosSemCiencia.length})</span>
              </span>
              <button
                type="button"
                onClick={() => nav('mural')}
                className="text-xs font-bold text-purple-800 hover:text-purple-950 underline cursor-pointer flex items-center gap-1"
              >
                <span>Mural Completo</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recadosSemCiencia.slice(0, 4).map(rec => (
                <div
                  key={rec.id}
                  className="p-3.5 bg-white rounded-xl border border-purple-100 flex flex-col justify-between gap-2.5 shadow-2xs hover:border-purple-300 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-purple-800 bg-purple-100 px-2 py-0.5 rounded">
                        {rec.destinatarios || 'Oficial'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {(rec.criadoEm || rec.data || '').slice(0, 10).split('-').reverse().join('/')}
                      </span>
                    </div>
                    <h3 className="font-extrabold text-slate-900 text-xs sm:text-sm line-clamp-1" title={rec.titulo}>
                      {rec.titulo}
                    </h3>
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                      {rec.conteudo || rec.mensagem || rec.descricao}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Emitido por: <strong>{rec.autor || 'Direção'}</strong>
                    </p>
                  </div>

                  <div className="pt-2 border-t border-purple-50 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onAbrirRecado ? onAbrirRecado(rec) : nav('mural')}
                      className="text-xs font-bold text-purple-700 hover:text-purple-950 underline cursor-pointer"
                    >
                      Ler Completo
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmarCiencia && onConfirmarCiencia(rec.id)}
                      className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-black text-xs rounded-lg transition shadow-2xs flex items-center gap-1.5 shrink-0 cursor-pointer"
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

        {/* --------------------------------------------------------------- */}
        {/* B. BLOCO DE NOTIFICAÇÕES PEDAGÓGICAS (GESTÃO: DIREÇÃO/VICE/CGPG/PAAC) */}
        {/* --------------------------------------------------------------- */}
        {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && (isDirecao || isCoord || isPAAC) && notificacoesPedagogicas.length > 0 && (
          <div className="p-4 bg-rose-50/90 border border-rose-200 rounded-xl space-y-3 shadow-2xs animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-rose-900 flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                <span>Notificações Pedagógicas Urgentes da Equipe ({notificacoesPedagogicas.length})</span>
              </span>
              <button
                type="button"
                onClick={() => nav('registros')}
                className="text-xs font-bold text-rose-800 hover:text-rose-950 underline cursor-pointer flex items-center gap-1"
              >
                <span>Módulo de Registros</span>
                <i className="fa-solid fa-arrow-right text-[10px]"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {notificacoesPedagogicas.slice(0, 4).map(notif => (
                <div
                  key={notif.id}
                  className="p-3.5 bg-white rounded-xl border border-rose-100 flex flex-col justify-between gap-2 shadow-2xs hover:border-rose-300 transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                        {notif.tipo || 'Ocorrência Pedagógica'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {(notif.notificadoEm || notif.data || notif.criadoEm || '').slice(0, 10).split('-').reverse().join('/')}
                      </span>
                    </div>
                    <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      {notif.nomeAluno || `Estudante RA: ${notif.ra}`}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-mono">
                      Turma: <strong className="text-slate-700">{notif.turma || 'Não informada'}</strong> · Por: <strong className="text-slate-700">{notif.autor_nome || notif.autor || 'Docente'}</strong>
                    </p>
                    <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg line-clamp-2">
                      {notif.descricao || notif.conteudo || 'Sem descrição cadastrada'}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-rose-50 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => onAbrirAluno && notif.ra && onAbrirAluno(notif.ra)}
                      className="text-xs font-bold text-blue-900 hover:underline cursor-pointer"
                    >
                      Ver Ficha do Aluno
                    </button>
                    <button
                      type="button"
                      onClick={() => onAtenderNotificacao && onAtenderNotificacao(notif.id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-lg transition shadow-2xs flex items-center gap-1 cursor-pointer"
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

        {/* --------------------------------------------------------------- */}
        {/* C. GRID DE CARDS OPERACIONAIS DE RESOLUÇÃO POR CARGO */}
        {/* --------------------------------------------------------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">

          {/* 1. TAREFAS CRÍTICAS / PDCA (UNIVERSAL) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'tarefas') && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-list-check text-amber-600"></i>
                    <span>Tarefas com Prazo Hoje / Vencidas</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                    tarefasUrgentes.length > 0
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {tarefasUrgentes.length} no prazo crítico
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Rotinas do plano de ação PEI atribuídas a você que demandam conclusão.
                </p>

                {tarefasUrgentes.length > 0 ? (
                  <div className="mt-2.5 space-y-2 max-h-40 overflow-y-auto pr-1">
                    {tarefasUrgentes.slice(0, 4).map(t => (
                      <div
                        key={t.id}
                        className="p-2 bg-amber-50/70 rounded-lg border border-amber-200 flex items-center justify-between text-xs gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-800 truncate">{t.descricao}</p>
                          <span className="text-[10px] font-mono text-amber-800 font-bold block">
                            Prazo: {t.dataLimite ? String(t.dataLimite).slice(0, 10).split('-').reverse().join('/') : 'Hoje'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleTarefa && onToggleTarefa(t.id, false)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] rounded-md transition shadow-2xs shrink-0 cursor-pointer flex items-center gap-1"
                          title="Marcar tarefa como concluída agora"
                        >
                          <i className="fa-solid fa-check text-[10px]"></i>
                          <span>Concluir</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-center text-xs text-emerald-800 font-semibold flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Nenhuma tarefa atrasada para você hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onNovaTarefa ? onNovaTarefa() : nav('rotina-pdca')}
                  className="text-xs font-bold text-amber-800 hover:text-amber-950 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-plus text-[10px]"></i>
                  <span>Nova Tarefa</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('rotina-pdca')}
                  className="text-xs font-bold text-blue-900 hover:text-blue-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo PDCA</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 2. PROFESSOR / PAAC: TUTORADOS EM RISCO */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'alunos') && (isProfessor || isPAAC) && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-user-graduate text-cyan-700"></i>
                    <span>Tutorados em Risco de Frequência</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                    tutoradosEmRisco.length > 0
                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {tutoradosEmRisco.length} em alerta
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Estudantes sob sua tutoria com presença inferior a 75% ou com faltas excessivas.
                </p>

                {tutoradosEmRisco.length > 0 ? (
                  <div className="mt-2.5 space-y-2 max-h-40 overflow-y-auto pr-1">
                    {tutoradosEmRisco.slice(0, 3).map(al => (
                      <div
                        key={al.ra || al.id}
                        className="p-2 bg-rose-50/70 hover:bg-rose-100/70 rounded-lg border border-rose-200 flex items-center justify-between text-xs transition"
                      >
                        <div className="min-w-0 pr-1">
                          <p className="font-bold text-slate-800 truncate max-w-[130px]">{al.nome}</p>
                          <span className="text-[10px] text-slate-500">{al.turma} · RA {al.ra}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-rose-700">{al.presenca_anual || al.presenca || '68%'}</span>
                          <button
                            type="button"
                            onClick={() => onAbrirAluno && onAbrirAluno(al.ra)}
                            className="px-2 py-1 bg-cyan-700 hover:bg-cyan-800 text-white font-black text-[10px] rounded transition cursor-pointer"
                            title="Abrir prontuário e ficha de acompanhamento"
                          >
                            Ver Ficha
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-center text-xs text-emerald-800 font-semibold flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Nenhum tutorado em risco crítico hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="text-xs font-bold text-rose-700 hover:text-rose-900 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-pen text-[10px]"></i>
                  <span>Lançar Ocorrência</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('alunos')}
                  className="text-xs font-bold text-cyan-800 hover:text-cyan-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo Alunos</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 3. AULAS & PRÓXIMA AULA (PROFESSORES) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'aulas_subs') && isProfessor && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-clock text-blue-800"></i>
                    <span>Próxima Aula / Minha Grade</span>
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-100 text-blue-900">
                    {aulasHoje.length} aula(s) hoje
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Horário e ambiente escolar das suas aulas programadas para hoje.
                </p>

                {aulaAtualOuProxima ? (
                  <div className="mt-2.5 p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-blue-900">
                        {aulaAtualOuProxima.periodoId}ª Aula
                      </span>
                      <span className="font-mono text-[11px] font-bold text-slate-600">
                        {aulaAtualOuProxima.turma}
                      </span>
                    </div>
                    <p className="text-xs font-black text-slate-900">
                      {aulaAtualOuProxima.disciplina || 'Componente Curricular'}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span><i className="fa-solid fa-location-dot text-slate-400 mr-1"></i>{aulaAtualOuProxima.sala || 'Sala de Aula'}</span>
                      <button
                        type="button"
                        onClick={() => nav('horarios')}
                        className="text-blue-900 font-bold hover:underline cursor-pointer"
                      >
                        Ver Detalhes →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-slate-100 rounded-lg text-center text-xs text-slate-600">
                    Nenhuma aula restante para hoje na sua agenda.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="text-xs font-bold text-rose-700 hover:text-rose-900 cursor-pointer flex items-center gap-1"
                >
                  <i className="fa-solid fa-pen text-[10px]"></i>
                  <span>Ocorrência da Aula</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('horarios')}
                  className="text-xs font-bold text-blue-900 hover:text-blue-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Minha Grade Completa</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 4. SUBSTITUIÇÕES PEI DO DIA (GESTÃO & PROFESSORES) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'aulas_subs') && (isDirecao || isCoord || isPAAC || isProfessor) && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-shuffle text-amber-600"></i>
                    <span>Substituições PEI de Hoje</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                    substituicoesSemDocente.length > 0
                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                      : substituicoesHoje.length > 0
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {substituicoesHoje.length} registrada{substituicoesHoje.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Acompanhamento de ausências docentes e cobertura de turmas no dia.
                </p>

                {substituicoesHoje.length > 0 ? (
                  <div className="mt-2.5 space-y-2 max-h-40 overflow-y-auto pr-1">
                    {substituicoesHoje.slice(0, 3).map((sub, idx) => (
                      <div
                        key={sub.id || idx}
                        className="p-2 bg-amber-50/60 rounded-lg border border-amber-200 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span className="truncate max-w-[130px]">Ausente: {sub.professorAusente}</span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-amber-200 text-amber-900 rounded font-mono">
                            {sub.turma}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Substituto: <strong className="text-amber-900">{sub.professorSubstituto || 'A definir'}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-center text-xs text-emerald-800 font-semibold flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Corpo docente 100% presente hoje.</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('substituicao-pei')}
                  className="text-xs font-bold text-amber-900 hover:text-amber-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Gerenciar Substituições</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 5. GESTÃO: BUSCA ATIVA & SLA SEDUC (DIREÇÃO/VICE) */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes' || filtroAtivo === 'alunos') && isDirecao && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-magnifying-glass-location text-rose-600"></i>
                    <span>Busca Ativa &amp; SLA SEDUC</span>
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                    {alunosBuscaAtivaCount} em risco
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Estudantes com 3 faltas consecutivas ou abaixo de 75% (Resolução SEDUC 39/2023).
                </p>

                <div className="mt-2.5 p-2.5 bg-rose-50/60 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>SLA de Contato com Família:</span>
                    <span className="text-rose-700 font-mono">48 horas</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Contate os responsáveis e registre a ata de atendimento para regularização.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('busca-ativa')}
                  className="text-xs font-bold text-rose-800 hover:text-rose-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Abrir Painel Busca Ativa</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 6. GESTÃO / COORDENAÇÃO: AUDITORIA SED VS MAPÃO */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && (isDirecao || isCoord) && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-scale-balanced text-cyan-800"></i>
                    <span>Auditoria SED vs Mapão</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                    alunosMapaoPendentesCount > 0
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {alunosMapaoPendentesCount} pendência{alunosMapaoPendentesCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Estudantes transferidos sem notas lançadas ou com discrepância de presença SED vs Mapão.
                </p>

                <div className="mt-2.5 p-2 bg-slate-50 rounded-lg text-xs flex items-center justify-between">
                  <span className="text-slate-600">Importador de Boletim:</span>
                  <span className="font-bold text-emerald-700 flex items-center gap-1">
                    <i className="fa-solid fa-file-pdf"></i>
                    <span>Leitor PDF Ativo</span>
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('comparativo-frequencia')}
                  className="text-xs font-bold text-blue-900 hover:text-blue-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Abrir Comparativo SED</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

          {/* 7. SECRETARIA: ATRASOS HOJE & DOCUMENTOS */}
          {(filtroAtivo === 'todas' || filtroAtivo === 'urgentes') && isSecretaria && (
            <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-clock-rotate-left text-amber-600"></i>
                    <span>Entradas com Atraso no Portão</span>
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                    {atrasosHojeCount} registrados
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Entradas tardias computadas hoje para acompanhamento com a gestão e famílias.
                </p>

                <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('input-busca-aluno-atraso') || document.querySelector('input[placeholder*="filtrar"]');
                      if (el) (el as HTMLElement).focus();
                      else nav('dashboard-atrasos');
                    }}
                    className="p-2 bg-amber-50 hover:bg-amber-100 text-amber-950 font-bold rounded-lg border border-amber-200 text-center transition cursor-pointer"
                  >
                    + Registrar Atraso
                  </button>
                  <button
                    type="button"
                    onClick={() => nav('dashboard-atrasos')}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg border border-slate-200 text-center transition cursor-pointer"
                  >
                    Ver Relatório
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav('secretaria')}
                  className="text-xs font-bold text-purple-900 hover:text-purple-950 flex items-center gap-1 cursor-pointer"
                >
                  <span>Módulo da Secretaria</span>
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}

        </div>

        {/* --------------------------------------------------------------- */}
        {/* 4. BARRA DE ATALHOS RÁPIDOS DE RESOLUÇÃO (AÇÕES EM 1 CLIQUE) */}
        {/* --------------------------------------------------------------- */}
        <div className="pt-3 border-t border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5 shrink-0">
            <i className="fa-solid fa-bolt text-amber-500"></i>
            <span>Atalhos de Resolução Rápida ({activeRole}):</span>
          </span>

          <div className="flex items-center gap-1.5 flex-wrap">
            {isProfessor && (
              <>
                <button
                  type="button"
                  onClick={() => nav('horarios')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-clock text-blue-800"></i>
                  <span>Meus Horários</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-pen text-rose-700"></i>
                  <span>Nova Ocorrência</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('alunos')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-user-graduate text-cyan-700"></i>
                  <span>Meus Tutorados</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('mural')}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-bullhorn text-purple-700"></i>
                  <span>Mural Oficial</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('substituicao-pei')}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-shuffle text-amber-700"></i>
                  <span>Substituições Hoje</span>
                </button>
              </>
            )}

            {(isCoord || isPAAC) && (
              <>
                <button
                  type="button"
                  onClick={() => nav('comparativo-frequencia')}
                  className="px-2.5 py-1 bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-scale-balanced text-cyan-700"></i>
                  <span>SED vs Mapão</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('substituicao-pei')}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-shuffle text-amber-700"></i>
                  <span>Substituições PEI</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                  <span>Notificações Pedagógicas</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('rotina-pdca')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-list-check text-blue-800"></i>
                  <span>Tarefas PDCA</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('mural')}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-bullhorn text-purple-700"></i>
                  <span>Mural</span>
                </button>
              </>
            )}

            {isDirecao && (
              <>
                <button
                  type="button"
                  onClick={() => nav('busca-ativa')}
                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-magnifying-glass-location text-rose-700"></i>
                  <span>Busca Ativa SEDUC</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('comparativo-frequencia')}
                  className="px-2.5 py-1 bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-scale-balanced text-cyan-800"></i>
                  <span>SED vs Mapão</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('substituicao-pei')}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-shuffle text-amber-700"></i>
                  <span>Substituições Hoje</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('registros')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                  <span>Notificações da Equipe</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('auditoria')}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-shield-halved text-slate-700"></i>
                  <span>Auditoria</span>
                </button>
              </>
            )}

            {isSecretaria && (
              <>
                <button
                  type="button"
                  onClick={() => nav('dashboard-atrasos')}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-clock-rotate-left text-amber-700"></i>
                  <span>Atrasos no Portão</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('secretaria')}
                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-building-columns text-purple-700"></i>
                  <span>Balcão Secretaria</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('alunos')}
                  className="px-2.5 py-1 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-900 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-user-graduate text-cyan-700"></i>
                  <span>Consultar Aluno / RA</span>
                </button>
                <button
                  type="button"
                  onClick={() => nav('mural')}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <i className="fa-solid fa-bullhorn text-purple-700"></i>
                  <span>Mural</span>
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}
