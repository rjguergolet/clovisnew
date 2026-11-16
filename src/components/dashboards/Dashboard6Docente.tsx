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
  usuarios?: any[];
}

const DIAS_OPCOES = [
  { key: 'segunda', label: 'Segunda-feira' },
  { key: 'terca', label: 'Terça-feira' },
  { key: 'quarta', label: 'Quarta-feira' },
  { key: 'quinta', label: 'Quinta-feira' },
  { key: 'sexta', label: 'Sexta-feira' }
];

function getLocalTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekdayFromIso(iso: string): { diaKey: string; isFimDeSemana: boolean } {
  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return { diaKey: 'segunda', isFimDeSemana: false };
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dow = d.getDay();
  const map: Record<number, string> = {
    1: 'segunda',
    2: 'terca',
    3: 'quarta',
    4: 'quinta',
    5: 'sexta'
  };
  return {
    diaKey: map[dow] || 'segunda',
    isFimDeSemana: dow === 0 || dow === 6
  };
}

function formatDateBrLocal(iso?: string | null): string {
  if (!iso) return '—';
  const clean = String(iso).trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return clean;
}

export default function Dashboard6Docente({
  horarios,
  professores,
  substituicoes,
  indisponibilidade,
  usuarios = []
}: Dashboard6DocenteProps) {
  const hojeIso = useMemo(() => getLocalTodayIso(), []);
  const diaInicial = useMemo(() => weekdayFromIso(hojeIso).diaKey, [hojeIso]);

  const [dataSelecionada, setDataSelecionada] = useState(hojeIso);
  const [diaSelecionado, setDiaSelecionado] = useState(diaInicial);
  const [slotSelecionado, setSlotSelecionado] = useState('1M');
  const [buscaDocente, setBuscaDocente] = useState('');
  const [filtroArea, setFiltroArea] = useState('TODAS');
  const [mostrarMapaVinculos, setMostrarMapaVinculos] = useState(false);

  const infoData = useMemo(() => weekdayFromIso(dataSelecionada), [dataSelecionada]);

  const handleDataChange = (novaData: string) => {
    setDataSelecionada(novaData);
    const { diaKey, isFimDeSemana } = weekdayFromIso(novaData);
    if (!isFimDeSemana) {
      setDiaSelecionado(diaKey);
    }
  };

  const analiseJanelas = useMemo(
    () =>
      analisarJanelasDocentes(diaSelecionado, slotSelecionado, horarios, professores, indisponibilidade, {
        dataAlvo: dataSelecionada,
        substituicoes,
        usuarios
      }),
    [diaSelecionado, slotSelecionado, horarios, professores, indisponibilidade, dataSelecionada, substituicoes, usuarios]
  );

  const termoBusca = buscaDocente.trim().toLowerCase();

  const matchesFiltro = (nome?: string, disciplina?: string, area?: string) => {
    if (filtroArea !== 'TODAS' && area && area !== filtroArea) return false;
    if (!termoBusca) return true;
    const text = `${nome || ''} ${disciplina || ''} ${area || ''}`.toLowerCase();
    return text.includes(termoBusca);
  };

  const disponiveisFiltrados = useMemo(
    () => analiseJanelas.disponiveis.filter((p) => matchesFiltro(p.nome, p.disciplina, p.area)),
    [analiseJanelas.disponiveis, termoBusca, filtroArea]
  );

  const emAulaFiltrados = useMemo(
    () => analiseJanelas.emAula.filter((p) => matchesFiltro(p.nome, p.disciplina, '')),
    [analiseJanelas.emAula, termoBusca, filtroArea]
  );

  const indisponiveisFiltrados = useMemo(
    () => analiseJanelas.indisponiveis.filter((p) => matchesFiltro(p.nome, p.disciplina, p.area)),
    [analiseJanelas.indisponiveis, termoBusca, filtroArea]
  );

  const resumoCategoriasIndisp = useMemo(() => {
    const counts = { ausencia: 0, compromisso: 0, teto: 0, indisponibilidade: 0, expediente: 0 };
    analiseJanelas.indisponiveis.forEach((p) => {
      counts[p.categoria] = (counts[p.categoria] || 0) + 1;
    });
    return counts;
  }, [analiseJanelas.indisponiveis]);

  // Histórico e análise de substituições por disciplina, turma e professor
  const resumoSubstituicoes = useMemo(() => {
    const porDisciplina = new Map<string, number>();
    const porTurma = new Map<string, number>();
    const porAusente = new Map<string, number>();
    const porSubstituto = new Map<string, number>();

    (substituicoes || []).forEach((s) => {
      if (String(s?.status || '').toUpperCase().trim() === 'CANCELADA') return;
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
      total: (substituicoes || []).filter((s) => String(s?.status || '').toUpperCase().trim() !== 'CANCELADA').length,
      porDisciplina: Array.from(porDisciplina.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porTurma: Array.from(porTurma.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porAusente: Array.from(porAusente.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      porSubstituto: Array.from(porSubstituto.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      recentes
    };
  }, [substituicoes]);

  const abrirAba = (aba: string) => {
    if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab(aba);
    }
  };

  const badgeCategoriaIndisp = (cat: string) => {
    switch (cat) {
      case 'ausencia':
        return { label: 'Ausente', cls: 'bg-rose-100 text-rose-800 border-rose-200' };
      case 'compromisso':
        return { label: 'ATPC / PEI', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
      case 'teto':
        return { label: 'Teto 32h', cls: 'bg-purple-100 text-purple-800 border-purple-200' };
      case 'indisponibilidade':
        return { label: 'Bloqueio Matriz', cls: 'bg-orange-100 text-orange-800 border-orange-200' };
      default:
        return { label: 'Expediente / Folga', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 6 · Operacional Docente, Disponibilidade Real &amp; Vínculos (2026)
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Cruzamento em tempo real da grade oficial (1M–14N), cadastro de docentes, matriz de indisponibilidade,
            ATPC/formações, substituições da data, teto semanal de 32 aulas e usuários vinculados.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => abrirAba('horarios')}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
          >
            Grade Horária
          </button>
          <button
            type="button"
            onClick={() => abrirAba('substituicao-pei')}
            className="px-3.5 py-2 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer"
          >
            Motor de Substituição PEI
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-emerald-200 p-4">
          <div className="text-[11px] font-bold uppercase text-emerald-700">Disponíveis Reais</div>
          <div className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-1">
            {analiseJanelas.disponiveis.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Livres na escola e abaixo do teto 32h em {formatDateBrLocal(analiseJanelas.dataAlvo)}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase text-slate-600">Em Sala / Substituindo</div>
          <div className="text-2xl font-extrabold text-[#1d2b4f] tabular-nums mt-1">
            {analiseJanelas.emAula.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {analiseJanelas.emAula.filter((p) => p.emSubstituicao).length} cobrindo substituição neste horário
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-rose-200 p-4">
          <div className="text-[11px] font-bold uppercase text-rose-700">Indisponíveis / Bloqueados</div>
          <div className="text-2xl font-extrabold text-rose-700 tabular-nums mt-1">
            {analiseJanelas.indisponiveis.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {resumoCategoriasIndisp.ausencia} aus. · {resumoCategoriasIndisp.compromisso} ATPC · {resumoCategoriasIndisp.teto} teto 32h
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-indigo-200 p-4">
          <div className="text-[11px] font-bold uppercase text-indigo-700">Vínculos Usuário ↔ Horário</div>
          <div className="text-2xl font-extrabold text-indigo-700 tabular-nums mt-1">
            {analiseJanelas.vinculosResumo.docentesComUsuario}
            <span className="text-sm font-bold text-slate-400">/{analiseJanelas.vinculosResumo.totalDocentes}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {analiseJanelas.vinculosResumo.usuariosVinculados} usuários vinculados ao corpo docente
          </div>
        </div>
      </div>

      {/* Painel Principal de Disponibilidade Real */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Disponibilidade Real de Docentes na Escola
            </h3>
            <p className="text-xs text-slate-500">
              {analiseJanelas.slot.label} ({analiseJanelas.slot.horario}) · Semana de{' '}
              {formatDateBrLocal(analiseJanelas.inicioSemana)} a {formatDateBrLocal(analiseJanelas.fimSemana)} ·{' '}
              {analiseJanelas.totalDocentes} docentes cadastrados
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={dataSelecionada}
              onChange={(e) => handleDataChange(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
              title="Data de referência para verificar ausências, substituições e carga semanal"
            />

            <select
              value={diaSelecionado}
              onChange={(e) => setDiaSelecionado(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
            >
              {DIAS_OPCOES.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
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

        {infoData.isFimDeSemana && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-800 font-medium">
            A data selecionada ({formatDateBrLocal(dataSelecionada)}) cai no fim de semana; exibindo a grade de{' '}
            <strong>{DIAS_OPCOES.find((d) => d.key === diaSelecionado)?.label}</strong> para consulta.
          </div>
        )}

        {/* Filtros de busca e área */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={buscaDocente}
            onChange={(e) => setBuscaDocente(e.target.value)}
            placeholder="Filtrar docente, disciplina ou área..."
            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <select
            value={filtroArea}
            onChange={(e) => setFiltroArea(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
          >
            <option value="TODAS">Todas as Áreas PEI</option>
            <option value="Exatas (EXA)">Exatas (EXA)</option>
            <option value="Humanas (HUM)">Humanas (HUM)</option>
            <option value="Linguagens (LGG)">Linguagens (LGG)</option>
            <option value="Ciências da Natureza (NAT)">Ciências da Natureza (NAT)</option>
            <option value="Gestão/Outros (OUT)">Gestão/Outros (OUT)</option>
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Coluna 1: Disponíveis Reais */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-emerald-900">
                Disponíveis Reais (Janela)
              </span>
              <span className="text-sm font-extrabold text-emerald-700 tabular-nums">
                {disponiveisFiltrados.length}
              </span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1 text-xs">
              {disponiveisFiltrados.map((p) => (
                <div key={p.nome} className="p-2.5 rounded-lg bg-white border border-emerald-200 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {p.disciplina} · {p.area}
                      </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                      LIVRE
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                    <span className="tabular-nums font-semibold text-slate-700">
                      Carga semana: {p.cargaSemanalTotal}/32h ({p.aulasRestantesTeto}h livres)
                    </span>
                    <span className="truncate max-w-[140px]">
                      {p.usuarioVinculado ? p.usuarioVinculado.email || p.usuarioVinculado.usuarioNome : 'Sem usuário'}
                    </span>
                  </div>
                </div>
              ))}
              {disponiveisFiltrados.length === 0 && (
                <p className="text-xs text-slate-500 py-3">Nenhum docente realmente disponível neste horário.</p>
              )}
            </div>
          </div>

          {/* Coluna 2: Em Sala de Aula & Substituições */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-slate-700">
                Em Sala / Substituindo
              </span>
              <span className="text-sm font-extrabold text-[#1d2b4f] tabular-nums">
                {emAulaFiltrados.length}
              </span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1 text-xs">
              {emAulaFiltrados.map((p) => (
                <div
                  key={`${p.nome}-${p.turma}-${p.emSubstituicao ? 'sub' : 'reg'}`}
                  className={`p-2.5 rounded-lg bg-white border space-y-1 ${
                    p.emSubstituicao ? 'border-cyan-300 bg-cyan-50/30' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                      <div className="text-[11px] text-slate-500 truncate">{p.disciplina}</div>
                    </div>
                    <span className="text-[11px] font-extrabold text-[#1d2b4f] shrink-0">{p.turma}</span>
                  </div>
                  {p.emSubstituicao && (
                    <div className="text-[10px] font-bold text-cyan-800">
                      Em Substituição{p.professorAusente ? ` (cobrindo ${p.professorAusente})` : ''}
                    </div>
                  )}
                </div>
              ))}
              {emAulaFiltrados.length === 0 && (
                <p className="text-xs text-slate-500 py-3">Nenhuma aula alocada neste slot.</p>
              )}
            </div>
          </div>

          {/* Coluna 3: Indisponíveis / ATPC / Ausentes / Teto */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold uppercase text-rose-900">
                Indisponíveis / Bloqueados
              </span>
              <span className="text-sm font-extrabold text-rose-700 tabular-nums">
                {indisponiveisFiltrados.length}
              </span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1 text-xs">
              {indisponiveisFiltrados.map((p) => {
                const badge = badgeCategoriaIndisp(p.categoria);
                return (
                  <div key={p.nome} className="p-2.5 rounded-lg bg-white border border-rose-200 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800 truncate">{p.nome}</div>
                        <div className="text-[11px] text-rose-700 truncate" title={p.motivo}>
                          {p.motivo}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                      <span className="tabular-nums">Carga semana: {p.cargaSemanalTotal}/32h</span>
                      <span className="truncate max-w-[140px]">
                        {p.usuarioVinculado ? p.usuarioVinculado.email || p.usuarioVinculado.usuarioNome : 'Sem usuário'}
                      </span>
                    </div>
                  </div>
                );
              })}
              {indisponiveisFiltrados.length === 0 && (
                <p className="text-xs text-slate-500 py-3">Nenhum docente indisponível neste filtro.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mapa de Vínculos Usuários ↔ Professores do Horário (2026) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Vínculos Usuários do Sistema ↔ Docentes do Horário (2026)
            </h3>
            <p className="text-xs text-slate-500">
              {analiseJanelas.vinculosResumo.docentesComUsuario} de {analiseJanelas.vinculosResumo.totalDocentes}{' '}
              docentes da grade possuem usuário associado ·{' '}
              {analiseJanelas.vinculosResumo.docentesSemUsuario.length} docentes ainda sem conta vinculada.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMostrarMapaVinculos((v) => !v)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
            >
              {mostrarMapaVinculos ? 'Ocultar Mapa' : 'Ver Mapa de Vínculos'}
            </button>
            <button
              type="button"
              onClick={() => abrirAba('admin')}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
            >
              Gerenciar em Administração
            </button>
          </div>
        </div>

        {analiseJanelas.vinculosResumo.docentesSemUsuario.length > 0 && (
          <div className="rounded-xl bg-amber-50/70 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
            <span className="font-bold">Docentes no horário sem conta vinculada: </span>
            <span>{analiseJanelas.vinculosResumo.docentesSemUsuario.join(', ')}</span>
          </div>
        )}

        {mostrarMapaVinculos && (
          <div className="overflow-x-auto max-h-80 border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <th className="py-2.5 px-3">Usuário</th>
                  <th className="py-2.5 px-3">Cargo</th>
                  <th className="py-2.5 px-3">Docente no Horário (2026)</th>
                  <th className="py-2.5 px-3">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analiseJanelas.vinculosResumo.listaVinculos.map((v, idx) => (
                  <tr key={v.usuarioId || `${v.email}-${idx}`} className="hover:bg-slate-50">
                    <td className="py-2 px-3">
                      <div className="font-bold text-slate-800">{v.usuarioNome}</div>
                      <div className="text-[11px] text-slate-500">{v.email}</div>
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-700">{v.cargo}</td>
                    <td className="py-2 px-3">
                      {v.professorNome ? (
                        <span className="font-bold text-emerald-700">{v.professorNome}</span>
                      ) : (
                        <span className="text-slate-400">
                          {v.cargo === 'SECRETARIA' ? 'Administrativo (sem regência)' : 'Sem vínculo'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {v.professorNome ? (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            v.automatico ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {v.automatico ? 'Sugestão Auto' : 'Salvo no Banco'}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {analiseJanelas.vinculosResumo.listaVinculos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      Nenhum usuário carregado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
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
                      <div className="text-[11px] text-slate-500">
                        {formatarTextoSeguro(s?.aula || s?.periodoRotulo || s?.periodo || s?.slot, '—')}
                      </div>
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
