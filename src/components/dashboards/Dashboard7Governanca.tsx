import React, { useMemo, useState } from 'react';
import {
  AlunoNormalizado,
  calcularDiasDesde,
  formatarTextoSeguro,
  toIsoDate
} from '../../modules/inteligenciaDataEngine';

interface Dashboard7GovernancaProps {
  alunos: AlunoNormalizado[];
  ocorrenciasUnificadas: any[];
  rotinaPdca: any[];
  tarefas: any[];
  eventosAgenda: any[];
  auditLogs: any[];
}

export default function Dashboard7Governanca({
  alunos,
  ocorrenciasUnificadas,
  rotinaPdca,
  tarefas,
  eventosAgenda,
  auditLogs
}: Dashboard7GovernancaProps) {
  const [mostrarIncompletos, setMostrarIncompletos] = useState(false);

  const tarefasConsolidadas = useMemo(() => {
    const hojeIso = new Date().toISOString().slice(0, 10);
    const todas = [...(rotinaPdca || []), ...(tarefas || [])];

    let concluidas = 0;
    let emAndamento = 0;
    let atrasadas = 0;

    const porResponsavel = new Map<
      string,
      { responsavel: string; total: number; concluidas: number; emAndamento: number; atrasadas: number }
    >();

    todas.forEach((t) => {
      const resp = String(t?.responsavel || t?.cargoResponsavel || t?.atribuidoA || 'Equipe Gestora').trim();
      const statusRaw = String(t?.status || t?.fase || '').toLowerCase();
      const prazo = toIsoDate(t?.prazo || t?.dataLimite || t?.dataFim);

      const isConcluida =
        statusRaw.includes('conclu') ||
        statusRaw.includes('finaliz') ||
        statusRaw.includes('done') ||
        statusRaw === 'act' ||
        t?.concluido === true;

      const isAtrasada = !isConcluida && Boolean(prazo && prazo < hojeIso);

      if (isConcluida) concluidas++;
      else if (isAtrasada) atrasadas++;
      else emAndamento++;

      const curr = porResponsavel.get(resp) || {
        responsavel: resp,
        total: 0,
        concluidas: 0,
        emAndamento: 0,
        atrasadas: 0
      };
      curr.total++;
      if (isConcluida) curr.concluidas++;
      else if (isAtrasada) curr.atrasadas++;
      else curr.emAndamento++;
      porResponsavel.set(resp, curr);
    });

    return {
      total: todas.length,
      concluidas,
      emAndamento,
      atrasadas,
      porResponsavel: Array.from(porResponsavel.values()).sort((a, b) => b.total - a.total)
    };
  }, [rotinaPdca, tarefas]);

  const saudeBase = useMemo(() => {
    const ativos = alunos.filter((a) => a.ativo);

    // Última atualização SED mais recente
    let ultimaSedIso = '';
    ativos.forEach((a) => {
      if (a.dataAtualizacaoSed && a.dataAtualizacaoSed > ultimaSedIso) {
        ultimaSedIso = a.dataAtualizacaoSed;
      }
    });
    const diasSemSed = ultimaSedIso ? calcularDiasDesde(ultimaSedIso) : null;

    // Ocorrências com notificacaoDirecaoPendente: true
    const pendentesDirecao = ocorrenciasUnificadas.filter((oc) => oc.notificacaoDirecaoPendente === true);

    // Cadastros incompletos (sem tutor, sem segmento real ou sem eletiva)
    const incompletos = ativos
      .map((a) => {
        const faltando: string[] = [];
        if (!a.tutor) faltando.push('Tutor');
        if (!a.segmento || a.segmento === 'Não informado') faltando.push('Segmento');
        if (!a.eletiva) faltando.push('Eletiva');
        return { aluno: a, faltando };
      })
      .filter((x) => x.faltando.length > 0);

    return {
      ultimaSedIso,
      diasSemSed,
      pendentesDirecao,
      incompletos
    };
  }, [alunos, ocorrenciasUnificadas]);

  const proximosEventos = useMemo(() => {
    const hojeIso = new Date().toISOString().slice(0, 10);
    return (eventosAgenda || [])
      .filter((ev) => toIsoDate(ev?.data || ev?.dataInicio || ev?.start) >= hojeIso)
      .sort((a, b) =>
        toIsoDate(a?.data || a?.dataInicio || a?.start).localeCompare(
          toIsoDate(b?.data || b?.dataInicio || b?.start)
        )
      )
      .slice(0, 8);
  }, [eventosAgenda]);

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 7 · Governança da Gestão, PDCA & Integridade da Base
          </h2>
          <p className="text-xs text-slate-600">
            Execução de planos (<code className="bg-slate-100 px-1 rounded">rotina_pdca</code>, <code className="bg-slate-100 px-1 rounded">tarefas</code>), agenda institucional e auditoria da qualidade dos dados no MongoDB Atlas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => typeof (window as any).switchTab === 'function' && (window as any).switchTab('rotina-pdca')}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
          >
            Abrir Rotina PDCA
          </button>
          <button
            type="button"
            onClick={() => typeof (window as any).switchTab === 'function' && (window as any).switchTab('agenda')}
            className="px-3 py-2 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
          >
            Abrir Agenda PEI
          </button>
        </div>
      </div>

      {/* KPIs Saúde da Base e PDCA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Execução PDCA / Tarefas</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">
            {tarefasConsolidadas.concluidas} / {tarefasConsolidadas.total}
          </div>
          <div className="mt-1 text-[11px] text-slate-600 tabular-nums">
            {tarefasConsolidadas.emAndamento} em andamento · <strong className="text-rose-700">{tarefasConsolidadas.atrasadas} atrasadas</strong>
          </div>
        </div>

        <div
          className={`rounded-2xl border p-4 ${
            saudeBase.diasSemSed === null || saudeBase.diasSemSed > 14
              ? 'bg-amber-50 border-amber-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Última Atualização SED</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">
            {saudeBase.diasSemSed !== null ? `${saudeBase.diasSemSed} dias` : 'Sem data'}
          </div>
          <div className="mt-1 text-[11px] text-slate-600 tabular-nums">
            {saudeBase.ultimaSedIso ? `Ref.: ${saudeBase.ultimaSedIso}` : 'Campo data_atualizacao_sed não encontrado'}
          </div>
        </div>

        <div
          className={`rounded-2xl border p-4 ${
            saudeBase.pendentesDirecao.length > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Notificações Direção Pendentes</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">
            {saudeBase.pendentesDirecao.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-600">Ocorrências com notificacaoDirecaoPendente</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cadastros Incompletos (Ativos)</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700 tabular-nums">
            {saudeBase.incompletos.length}
          </div>
          <button
            type="button"
            onClick={() => setMostrarIncompletos((v) => !v)}
            className="mt-1 text-[11px] font-bold text-cyan-700 hover:underline cursor-pointer"
          >
            {mostrarIncompletos ? 'Ocultar lista' : 'Inspecionar pendências cadastrais'}
          </button>
        </div>
      </div>

      {mostrarIncompletos && (
        <div className="bg-white rounded-2xl border border-amber-300 p-4">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-2">
            Estudantes Ativos com Cadastro Incompleto (Tutor, Segmento ou Eletiva)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto text-xs">
            {saudeBase.incompletos.slice(0, 90).map(({ aluno, faltando }) => (
              <button
                key={aluno.ra}
                type="button"
                onClick={() => abrirFicha(aluno.ra)}
                className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left cursor-pointer"
              >
                <div className="font-bold text-[#1d2b4f] truncate">{aluno.nome}</div>
                <div className="text-[11px] text-slate-500">
                  {aluno.turma} · Falta: <strong className="text-amber-700">{faltando.join(', ')}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Execução PDCA por Responsável + Agenda PEI */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">Execução PDCA e Tarefas por Responsável</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                  <th className="py-2.5 px-4">Responsável / Frente</th>
                  <th className="py-2.5 px-3 text-center">Concluídas</th>
                  <th className="py-2.5 px-3 text-center">Em Andamento</th>
                  <th className="py-2.5 px-3 text-center">Atrasadas</th>
                  <th className="py-2.5 px-4 text-right">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {tarefasConsolidadas.porResponsavel.map((r) => {
                  const pct = r.total > 0 ? Math.round((r.concluidas / r.total) * 100) : 0;
                  return (
                    <tr key={r.responsavel}>
                      <td className="py-2.5 px-4 font-bold text-slate-800">{r.responsavel}</td>
                      <td className="py-2.5 px-3 text-center font-extrabold text-emerald-700">{r.concluidas}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-cyan-700">{r.emAndamento}</td>
                      <td className="py-2.5 px-3 text-center font-extrabold text-rose-700">{r.atrasadas}</td>
                      <td className="py-2.5 px-4 text-right font-extrabold text-[#1d2b4f]">{pct}%</td>
                    </tr>
                  );
                })}
                {tarefasConsolidadas.porResponsavel.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Nenhuma tarefa registrada em rotina_pdca ou tarefas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">Próximos Marcos da Agenda Institucional</h3>
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 text-xs">
            {proximosEventos.map((ev, idx) => (
              <div key={ev?.id || idx} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-[#1d2b4f] truncate">
                    {formatarTextoSeguro(ev?.titulo || ev?.title || ev?.nome, 'Evento PEI')}
                  </span>
                  <span className="text-[11px] font-bold text-cyan-700 tabular-nums shrink-0">
                    {toIsoDate(ev?.data || ev?.dataInicio || ev?.start)}
                  </span>
                </div>
                {ev?.responsavel && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Responsável: {formatarTextoSeguro(ev.responsavel)}
                  </div>
                )}
              </div>
            ))}
            {proximosEventos.length === 0 && (
              <p className="text-xs text-slate-500">Nenhum evento futuro localizado na agenda.</p>
            )}
          </div>
        </div>
      </div>

      {/* Trilha Recente de Auditoria (audit_logs) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">Últimos Eventos de Auditoria (audit_logs)</h3>
          </div>
          <span className="text-xs font-bold text-slate-500 tabular-nums">{auditLogs.length} registros carregados</span>
        </div>
        <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto text-xs">
          {auditLogs.slice(0, 25).map((log, idx) => {
            const acaoStr = formatarTextoSeguro(log?.acao || log?.action || log?.tipo, 'AÇÃO');
            const descStr = formatarTextoSeguro(log?.descricao) || formatarTextoSeguro(log?.detalhes) || formatarTextoSeguro(log?.alvo);
            const usuarioStr = formatarTextoSeguro(log?.usuarioNome || log?.usuario || log?.autor, 'Sistema');
            return (
              <div key={log?.id || idx} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold text-[#1d2b4f]">{acaoStr}</span>
                  {descStr && <span className="text-slate-500 ml-2 break-words">{descStr}</span>}
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums shrink-0">
                  {usuarioStr} · {toIsoDate(log?.data || log?.timestamp || log?.criadoEm) || '—'}
                </div>
              </div>
            );
          })}
          {auditLogs.length === 0 && (
            <div className="p-6 text-center text-slate-500">Sem logs recentes em audit_logs.</div>
          )}
        </div>
      </div>
    </div>
  );
}
