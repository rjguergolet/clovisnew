import React, { useMemo, useState } from 'react';
import {
  analisarJanelasDocentes,
  formatarTextoSeguro,
  SLOTS_GRADE_PEI,
  toIsoDate
} from '../../modules/inteligenciaDataEngine';

interface Dashboard6DocenteProps {
  horarios: any[];
  professores: any[];
  substituicoes: any[];
  indisponibilidade: Record<string, any>;
}

const DIAS_OPCOES = [
  { key: 'segunda', label: 'Segunda-feira' },
  { key: 'terca', label: 'Terça-feira' },
  { key: 'quarta', label: 'Quarta-feira' },
  { key: 'quinta', label: 'Quinta-feira' },
  { key: 'sexta', label: 'Sexta-feira' }
];

export default function Dashboard6Docente({
  horarios,
  professores,
  substituicoes,
  indisponibilidade
}: Dashboard6DocenteProps) {
  const diaInicial = useMemo(() => {
    const dow = new Date().getDay();
    const map: Record<number, string> = { 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta' };
    return map[dow] || 'segunda';
  }, []);

  const [diaSelecionado, setDiaSelecionado] = useState(diaInicial);
  const [slotSelecionado, setSlotSelecionado] = useState('1M');

  const analiseJanelas = useMemo(
    () => analisarJanelasDocentes(diaSelecionado, slotSelecionado, horarios, professores, indisponibilidade),
    [diaSelecionado, slotSelecionado, horarios, professores, indisponibilidade]
  );

  // Histórico e análise de substituições por disciplina, turma e professor
  const resumoSubstituicoes = useMemo(() => {
    const porDisciplina = new Map<string, number>();
    const porTurma = new Map<string, number>();
    const porAusente = new Map<string, number>();
    const porSubstituto = new Map<string, number>();

    (substituicoes || []).forEach((s) => {
      const disc = String(s?.disciplina || s?.componente || 'Não informada').trim();
      const turma = String(s?.turma || '—').toUpperCase().trim();
      const ausente = String(s?.professorAusente || s?.professorFaltante || s?.ausente || '—').trim();
      const substituto = String(s?.professorSubstituto || s?.substituto || '—').trim();

      porDisciplina.set(disc, (porDisciplina.get(disc) || 0) + 1);
      porTurma.set(turma, (porTurma.get(turma) || 0) + 1);
      if (ausente !== '—') porAusente.set(ausente, (porAusente.get(ausente) || 0) + 1);
      if (substituto !== '—') porSubstituto.set(substituto, (porSubstituto.get(substituto) || 0) + 1);
    });

    const recentes = (substituicoes || [])
      .slice()
      .sort((a, b) => String(b?.data || b?.criadoEm || '').localeCompare(String(a?.data || a?.criadoEm || '')))
      .slice(0, 40);

    return {
      total: (substituicoes || []).length,
      porDisciplina: Array.from(porDisciplina.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porTurma: Array.from(porTurma.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porAusente: Array.from(porAusente.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porSubstituto: Array.from(porSubstituto.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      recentes
    };
  }, [substituicoes]);

  const abrirGradeCompleta = () => {
    if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab('horarios');
    }
  };

  const abrirSubstituicao = () => {
    if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab('substituicao-pei');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 6 · Operacional Docente, Grade Horária & Professores Disponíveis (Janelas)
          </h2>
          <p className="text-xs text-slate-600">
            Cruzamento instantâneo de <code className="bg-slate-100 px-1 rounded">horarios</code> (1M a 7T/9T),{' '}
            <code className="bg-slate-100 px-1 rounded">professores</code> e{' '}
            <code className="bg-slate-100 px-1 rounded">indisponibilidade_professores</code> + histórico de substituições.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={abrirGradeCompleta}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
          >
            Grade Horária
          </button>
          <button
            type="button"
            onClick={abrirSubstituicao}
            className="px-3.5 py-2 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
          >
            Registrar Substituição
          </button>
        </div>
      </div>

      {/* Seletor de Dia e Aula + Resumo Janelas */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Disponibilidade de Docentes em Tempo Real (Janelas)
            </h3>
            <p className="text-xs text-slate-500">
              {analiseJanelas.slot.label} ({analiseJanelas.slot.horario}) · Selecione o dia e o horário da grade PEI.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={diaSelecionado}
              onChange={(e) => setDiaSelecionado(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
            >
              {DIAS_OPCOES.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>

            <select
              value={slotSelecionado}
              onChange={(e) => setSlotSelecionado(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
            >
              {SLOTS_GRADE_PEI.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label} ({s.horario})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Disponíveis / Janela */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-emerald-900">
                Em Janela / Disponíveis
              </span>
              <span className="text-sm font-extrabold text-emerald-700 tabular-nums">
                {analiseJanelas.disponiveis.length}
              </span>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 text-xs">
              {analiseJanelas.disponiveis.map((p) => (
                <div key={p.nome} className="p-2 rounded-lg bg-white border border-emerald-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                    <div className="text-[11px] text-slate-500 truncate">{p.disciplina}</div>
                  </div>
                  <span className="text-[10px] font-extrabold text-emerald-700 shrink-0">LIVRE</span>
                </div>
              ))}
              {analiseJanelas.disponiveis.length === 0 && (
                <p className="text-xs text-slate-500">Nenhum docente livre neste horário.</p>
              )}
            </div>
          </div>

          {/* Em Aula */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-slate-700">
                Em Sala de Aula
              </span>
              <span className="text-sm font-extrabold text-[#1d2b4f] tabular-nums">
                {analiseJanelas.emAula.length}
              </span>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 text-xs">
              {analiseJanelas.emAula.map((p) => (
                <div key={`${p.nome}-${p.turma}`} className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                    <div className="text-[11px] text-slate-500 truncate">{p.disciplina}</div>
                  </div>
                  <span className="text-[11px] font-extrabold text-[#1d2b4f] shrink-0">{p.turma}</span>
                </div>
              ))}
              {analiseJanelas.emAula.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma aula alocada neste slot.</p>
              )}
            </div>
          </div>

          {/* Indisponíveis / Fora do Turno */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-rose-900">
                Indisponíveis / Fora de Expediente
              </span>
              <span className="text-sm font-extrabold text-rose-700 tabular-nums">
                {analiseJanelas.indisponiveis.length}
              </span>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 text-xs">
              {analiseJanelas.indisponiveis.map((p) => (
                <div key={p.nome} className="p-2 rounded-lg bg-white border border-rose-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                    <div className="text-[11px] text-rose-700 truncate">{p.motivo}</div>
                  </div>
                </div>
              ))}
              {analiseJanelas.indisponiveis.length === 0 && (
                <p className="text-xs text-slate-500">Todos os docentes cadastrados estão na escola.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Histórico de Substituições */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Resumo de Substituições ({resumoSubstituicoes.total})
            </h3>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">Por Disciplina</div>
            <div className="space-y-1.5 text-xs">
              {resumoSubstituicoes.porDisciplina.map(([d, qtd]) => (
                <div key={d} className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-700 truncate">{d}</span>
                  <span className="font-extrabold text-[#1d2b4f] tabular-nums">{qtd}</span>
                </div>
              ))}
              {resumoSubstituicoes.porDisciplina.length === 0 && (
                <p className="text-xs text-slate-500">Nenhuma substituição registrada.</p>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">Turmas Mais Atendidas</div>
            <div className="space-y-1.5 text-xs">
              {resumoSubstituicoes.porTurma.map(([t, qtd]) => (
                <div key={t} className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-700">{t}</span>
                  <span className="font-extrabold text-cyan-700 tabular-nums">{qtd}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Histórico Recente de Substituições
            </h3>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                  <th className="py-2.5 px-4">Data / Aula</th>
                  <th className="py-2.5 px-3">Turma / Disciplina</th>
                  <th className="py-2.5 px-3">Ausente</th>
                  <th className="py-2.5 px-4">Substituto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resumoSubstituicoes.recentes.map((s, idx) => (
                  <tr key={s?.id || idx}>
                    <td className="py-2.5 px-4 tabular-nums whitespace-nowrap">
                      <div className="font-bold text-slate-800">{toIsoDate(s?.data || s?.criadoEm) || '—'}</div>
                      <div className="text-[11px] text-slate-500">{formatarTextoSeguro(s?.aula || s?.periodo || s?.slot, '—')}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-[#1d2b4f]">{formatarTextoSeguro(s?.turma, '—')}</div>
                      <div className="text-[11px] text-slate-500">{formatarTextoSeguro(s?.disciplina, '—')}</div>
                    </td>
                    <td className="py-2.5 px-3 text-rose-700 font-semibold">
                      {formatarTextoSeguro(s?.professorAusente || s?.professorFaltante, '—')}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-700 font-bold">
                      {formatarTextoSeguro(s?.professorSubstituto || s?.substituto, '—')}
                    </td>
                  </tr>
                ))}
                {resumoSubstituicoes.recentes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Nenhuma substituição lançada na base ativa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
