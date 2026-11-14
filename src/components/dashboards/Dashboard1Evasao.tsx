import React, { useMemo, useState } from 'react';
import { AlunoNormalizado } from '../../modules/inteligenciaDataEngine';

interface Dashboard1EvasaoProps {
  alunos: AlunoNormalizado[];
  buscaAtivaDocs: any[];
  userRoleNorm: string;
  onAbrirBuscaAtiva: (aluno: AlunoNormalizado) => void;
  onAbrirChamadaDiaria: () => void;
}

export default function Dashboard1Evasao({
  alunos,
  buscaAtivaDocs,
  userRoleNorm,
  onAbrirBuscaAtiva,
  onAbrirChamadaDiaria
}: Dashboard1EvasaoProps) {
  const [filtroTabela, setFiltroTabela] = useState<'todos' | 'criticos' | 'precoce' | 'queda' | 'consecutivas'>('criticos');
  const [ordenacao, setOrdenacao] = useState<'risco' | 'sed' | 'diaria' | 'consecutivas' | 'nome'>('risco');

  const podeAjustarSed = userRoleNorm === 'DIRETOR' || userRoleNorm === 'VICE_DIRETOR' || userRoleNorm.includes('VICE');

  const kpis = useMemo(() => {
    const comSed = alunos.filter((a) => a.sedFreq !== null);
    const comMapao = alunos.filter((a) => a.mapaoFreq !== null);
    const comDiaria = alunos.filter((a) => a.diariaFreq !== null);

    const mediaSed = comSed.length > 0
      ? Math.round((comSed.reduce((acc, a) => acc + (a.sedFreq || 0), 0) / comSed.length) * 10) / 10
      : null;
    const mediaMapao = comMapao.length > 0
      ? Math.round((comMapao.reduce((acc, a) => acc + (a.mapaoFreq || 0), 0) / comMapao.length) * 10) / 10
      : null;
    const mediaDiaria = comDiaria.length > 0
      ? Math.round((comDiaria.reduce((acc, a) => acc + (a.diariaFreq || 0), 0) / comDiaria.length) * 10) / 10
      : null;

    const criticos = alunos.filter((a) => a.criticoGeral);
    const alertaAmarelo = alunos.filter(
      (a) => !a.criticoGeral && (
        (a.sedFreq !== null && a.sedFreq >= 75 && a.sedFreq <= 80) ||
        (a.diariaFreq !== null && a.diariaFreq >= 75 && a.diariaFreq <= 80)
      )
    );
    const quedaBrusca = alunos.filter((a) => a.sedEvolucao !== null && a.sedEvolucao < 0);
    const consecutivas3 = alunos.filter((a) => a.faltasConsecutivas >= 3);
    const alertaPrecoce = alunos.filter((a) => a.alertaPrecoceDiaria);

    return {
      mediaSed,
      mediaMapao,
      mediaDiaria,
      qtdSed: comSed.length,
      qtdMapao: comMapao.length,
      qtdDiaria: comDiaria.length,
      totalCriticos: criticos.length,
      totalAmarelo: alertaAmarelo.length,
      totalQueda: quedaBrusca.length,
      totalConsecutivas: consecutivas3.length,
      totalAlertaPrecoce: alertaPrecoce.length
    };
  }, [alunos]);

  const funilBuscaAtiva = useMemo(() => {
    const criticos = alunos.filter((a) => a.criticoGeral);
    const totalCriticos = criticos.length;
    const semRegistro = criticos.filter((a) => a.statusBuscaAtiva === 'Sem Registro').length;
    const aguardando = criticos.filter((a) => a.statusBuscaAtiva === 'Aguardando Retorno').length;
    const contato = criticos.filter((a) => a.statusBuscaAtiva === 'Contato Realizado').length;
    const conselho = criticos.filter((a) => a.statusBuscaAtiva === 'Conselho Tutelar').length;
    const compensacaoEntregue = criticos.filter((a) => a.temCompensacaoEntregue).length;
    const registrosTotais = buscaAtivaDocs.length;

    return {
      totalCriticos,
      semRegistro,
      aguardando,
      contato,
      conselho,
      compensacaoEntregue,
      registrosTotais
    };
  }, [alunos, buscaAtivaDocs]);

  const listaTabela = useMemo(() => {
    let base = alunos.slice();
    if (filtroTabela === 'criticos') {
      base = base.filter((a) => a.criticoGeral || (a.sedFreq !== null && a.sedFreq <= 80) || (a.diariaFreq !== null && a.diariaFreq <= 80));
    } else if (filtroTabela === 'precoce') {
      base = base.filter((a) => a.alertaPrecoceDiaria);
    } else if (filtroTabela === 'queda') {
      base = base.filter((a) => a.sedEvolucao !== null && a.sedEvolucao < 0);
    } else if (filtroTabela === 'consecutivas') {
      base = base.filter((a) => a.faltasConsecutivas >= 3);
    }

    base.sort((a, b) => {
      if (ordenacao === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordenacao === 'consecutivas') return b.faltasConsecutivas - a.faltasConsecutivas;
      if (ordenacao === 'sed') return (a.sedFreq ?? 999) - (b.sedFreq ?? 999);
      if (ordenacao === 'diaria') return (a.diariaFreq ?? 999) - (b.diariaFreq ?? 999);
      // risco composto
      const score = (al: AlunoNormalizado) => {
        let s = 0;
        if (al.alertaPrecoceDiaria) s += 1000;
        s += al.faltasConsecutivas * 80;
        const minF = Math.min(al.sedFreq ?? 100, al.mapaoFreq ?? 100, al.diariaFreq ?? 100);
        s += Math.max(0, 100 - minF) * 5;
        if (al.sedEvolucao !== null && al.sedEvolucao < 0) s += Math.abs(al.sedEvolucao) * 3;
        return s;
      };
      return score(b) - score(a);
    });

    return base;
  }, [alunos, filtroTabela, ordenacao]);

  const formatPct = (v: number | null) => (v !== null ? `${v.toFixed(1)}%` : '—');

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  const abrirAjusteSed = (ra: string) => {
    if (typeof (window as any).abrirModalAjusteFreqSED === 'function') {
      (window as any).abrirModalAjusteFreqSED(ra);
    } else if (typeof (window as any).showToast === 'function') {
      (window as any).showToast('Modal de ajuste manual da SED indisponível no momento.', 'warning');
    }
  };

  const etapaFunil = [
    { label: 'Críticos (< 75%)', val: funilBuscaAtiva.totalCriticos, cor: 'bg-slate-800', desc: 'Total elegível na base filtrada' },
    { label: 'Sem Ação / Pendente', val: funilBuscaAtiva.semRegistro, cor: 'bg-rose-600', desc: 'Necessita contato imediato' },
    { label: 'Aguardando Retorno', val: funilBuscaAtiva.aguardando, cor: 'bg-amber-500', desc: 'Contato iniciado sem retorno' },
    { label: 'Contato Realizado', val: funilBuscaAtiva.contato, cor: 'bg-cyan-600', desc: 'Família ciente / em retorno' },
    { label: 'Conselho Tutelar', val: funilBuscaAtiva.conselho, cor: 'bg-purple-700', desc: 'Encaminhamento formal ativo' },
    { label: 'Compensação Entregue', val: funilBuscaAtiva.compensacaoEntregue, cor: 'bg-emerald-600', desc: 'Atividade compensatória registrada' }
  ];

  const maxFunil = Math.max(1, funilBuscaAtiva.totalCriticos);

  return (
    <div className="space-y-5">
      {/* Ação de topo específica do Dashboard 1 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 1 · Risco de Evasão, Tripla Frequência & Busca Ativa
          </h2>
          <p className="text-xs text-slate-600">
            Cruzamento simultâneo da Frequência SED (histórica/oficial), Mapão de Conselho (1B–4B) e Chamada Diária em tempo real.
            Meta mínima: <strong className="text-slate-800">75%</strong> · Alerta amarelo: <strong className="text-amber-700">75% a 80%</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={onAbrirChamadaDiaria}
          className="px-4 py-2.5 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-bold flex items-center gap-2 shrink-0 cursor-pointer transition-colors"
        >
          <i className="fa-solid fa-clipboard-check text-cyan-300"></i>
          <span>Lançar / Consolidar Chamada Diária (P/F/J)</span>
        </button>
      </div>

      {/* Cards KPI Comparativos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Média SED (Oficial)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">{formatPct(kpis.mediaSed)}</div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">{kpis.qtdSed} alunos com registro SED</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Média Mapão (Conselho)</div>
          <div className="mt-1 text-2xl font-extrabold text-cyan-700 tabular-nums">{formatPct(kpis.mediaMapao)}</div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">{kpis.qtdMapao} boletins consolidados</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Média Chamada Diária</div>
          <div className="mt-1 text-2xl font-extrabold text-indigo-700 tabular-nums">{formatPct(kpis.mediaDiaria)}</div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">{kpis.qtdDiaria} alunos chamados</div>
        </div>

        <div className="bg-rose-50 rounded-2xl border border-rose-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Críticos (&lt; 75%)</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{kpis.totalCriticos}</div>
          <div className="mt-1 text-[11px] text-rose-700 tabular-nums">
            +{kpis.totalAmarelo} em alerta amarelo (75–80%)
          </div>
        </div>

        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Queda Brusca (SED)</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700 tabular-nums">{kpis.totalQueda}</div>
          <div className="mt-1 text-[11px] text-amber-800 tabular-nums">Evolução negativa entre fechamentos</div>
        </div>

        <div className="bg-white rounded-2xl border border-rose-300 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">3+ Faltas Consecutivas</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{kpis.totalConsecutivas}</div>
          <div className="mt-1 text-[11px] text-slate-600 tabular-nums">
            {kpis.totalAlertaPrecoce} quedas precoces na Diária
          </div>
        </div>
      </div>

      {/* Funil da Busca Ativa & Compensação de Ausências */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Funil da Busca Ativa & Entrega de Compensação de Ausências
            </h3>
            <p className="text-xs text-slate-500">
              Cruzamento de estudantes críticos (&lt; 75% em qualquer fonte ou 3+ faltas seguidas) com os {funilBuscaAtiva.registrosTotais} registros na coleção <code className="text-[11px] bg-slate-100 px-1 rounded">busca_ativa</code>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {etapaFunil.map((et) => {
            const pct = Math.round((et.val / maxFunil) * 100);
            return (
              <div key={et.label} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold text-slate-800">{et.label}</span>
                  <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {et.val} <span className="text-[11px] font-semibold text-slate-500">({pct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-md overflow-hidden">
                  <div className={`h-full ${et.cor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{et.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabela de Divergência & Alerta Precoce */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Tabela de Divergência & Alerta Precoce ({listaTabela.length})
            </h3>
            <p className="text-xs text-slate-500">
              Linhas com fundo vermelho indicam queda da Frequência Diária abaixo de 75% mesmo antes da atualização na SED.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filtroTabela}
              onChange={(e) => setFiltroTabela(e.target.value as any)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
            >
              <option value="criticos">Somente Críticos & Alerta (&lt;= 80%)</option>
              <option value="precoce">Somente Alerta Precoce (Diária &lt; 75%, SED ok)</option>
              <option value="queda">Somente Queda Brusca (Evolução SED &lt; 0%)</option>
              <option value="consecutivas">Somente 3+ Faltas Consecutivas</option>
              <option value="todos">Todos os Estudantes Filtrados</option>
            </select>

            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as any)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
            >
              <option value="risco">Ordenar: Maior Risco</option>
              <option value="consecutivas">Ordenar: Faltas Consecutivas</option>
              <option value="diaria">Ordenar: Menor % Diária</option>
              <option value="sed">Ordenar: Menor % SED</option>
              <option value="nome">Ordenar: Nome A–Z</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Aluno</th>
                <th className="py-3 px-3">Turma</th>
                <th className="py-3 px-3">Tutor</th>
                <th className="py-3 px-3 text-right">% SED</th>
                <th className="py-3 px-3 text-right">% Mapão</th>
                <th className="py-3 px-3 text-right">% Diária</th>
                <th className="py-3 px-3 text-center">Consecutivas</th>
                <th className="py-3 px-3">Status Busca Ativa</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {listaTabela.slice(0, 120).map((al) => {
                const rowClass = al.alertaPrecoceDiaria
                  ? 'bg-rose-50 hover:bg-rose-100/80'
                  : al.criticoGeral
                    ? 'bg-rose-50/40 hover:bg-slate-50'
                    : 'hover:bg-slate-50';

                const badgeFreq = (val: number | null) => {
                  if (val === null) return 'text-slate-400';
                  if (val < 75) return 'text-rose-700 font-extrabold';
                  if (val <= 80) return 'text-amber-700 font-bold';
                  return 'text-emerald-700 font-semibold';
                };

                return (
                  <tr key={al.ra || al.nome} className={rowClass}>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => abrirFicha(al.ra)}
                        className="font-bold text-[#1d2b4f] hover:underline text-left cursor-pointer"
                      >
                        {al.nome}
                      </button>
                      <div className="text-[11px] text-slate-500 tabular-nums flex items-center gap-2">
                        <span>RA {al.ra}</span>
                        {al.alertaPrecoceDiaria && (
                          <span className="text-rose-700 font-extrabold">
                            [Alerta Precoce Diária]
                          </span>
                        )}
                        {al.ajusteManualSed && (
                          <span className="text-indigo-700 font-semibold">[Ajuste SED]</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-700 whitespace-nowrap">{al.turma}</td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-[160px] truncate">{al.tutor || '—'}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                      <span className={badgeFreq(al.sedFreq)}>{formatPct(al.sedFreq)}</span>
                      {al.sedEvolucao !== null && al.sedEvolucao !== 0 && (
                        <span
                          className={`ml-1.5 text-[11px] font-bold ${
                            al.sedEvolucao < 0 ? 'text-rose-600' : 'text-emerald-600'
                          }`}
                          title="Variação em relação ao fechamento anterior da SED"
                        >
                          {al.sedEvolucao < 0 ? '▼' : '▲'} {Math.abs(al.sedEvolucao).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${badgeFreq(al.mapaoFreq)}`}>
                      {formatPct(al.mapaoFreq)}
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${badgeFreq(al.diariaFreq)}`}>
                      {formatPct(al.diariaFreq)}
                      {al.diariaTotalDias > 0 && (
                        <div className="text-[10px] font-normal text-slate-400">
                          {al.diariaPresentes}P / {al.diariaFaltas}F
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center tabular-nums">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-bold ${
                          al.faltasConsecutivas >= 3
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'text-slate-600'
                        }`}
                      >
                        {al.faltasConsecutivas}d
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                          al.statusBuscaAtiva === 'Conselho Tutelar'
                            ? 'bg-purple-50 text-purple-800 border-purple-200'
                            : al.statusBuscaAtiva === 'Contato Realizado'
                              ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                              : al.statusBuscaAtiva === 'Aguardando Retorno'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {al.statusBuscaAtiva}
                      </span>
                      {al.temCompensacaoEntregue && (
                        <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                          Compensação entregue
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onAbrirBuscaAtiva(al)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#1d2b4f] hover:bg-blue-900 text-white text-[11px] font-bold cursor-pointer"
                          title="Registrar ação rápida de Busca Ativa"
                        >
                          Busca Ativa
                        </button>
                        {podeAjustarSed && (
                          <button
                            type="button"
                            onClick={() => abrirAjusteSed(al.ra)}
                            className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
                            title="Ajuste manual de Frequência SED (Direção/Vice)"
                          >
                            Ajuste SED
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {listaTabela.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm text-slate-500">
                    Nenhum estudante encontrado para o filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {listaTabela.length > 120 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            Exibindo os 120 registros prioritários de {listaTabela.length} estudantes filtrados. Use a busca ou filtros globais para refinar.
          </div>
        )}
      </div>
    </div>
  );
}
