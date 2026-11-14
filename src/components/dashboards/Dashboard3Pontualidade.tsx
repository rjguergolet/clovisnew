import React, { useMemo, useState } from 'react';
import { addDoc, collection, db } from '../../lib/database';
import { obterUsuarioAtivoCompleto } from '../../modules/authHelper';
import {
  AlunoNormalizado,
  extrairHoraMinutoAtraso,
  normalizarRa,
  sanitizarPayloadMongo,
  toIsoDate
} from '../../modules/inteligenciaDataEngine';

interface Dashboard3PontualidadeProps {
  alunos: AlunoNormalizado[];
  ocorrenciasUnificadas: any[];
  onDataUpdated: () => Promise<void> | void;
}

const FAIXAS_MANHA = [
  { label: '07:00–07:15 (Tol.)', min: 420, max: 435 },
  { label: '07:16–07:30', min: 436, max: 450 },
  { label: '07:31–08:00', min: 451, max: 480 },
  { label: '08:01–09:00', min: 481, max: 540 },
  { label: 'Após 09:00', min: 541, max: 779 }
];

const FAIXAS_TARDE = [
  { label: '14:20–14:35 (Tol.)', min: 860, max: 875 },
  { label: '14:36–14:50', min: 876, max: 890 },
  { label: '14:51–15:20', min: 891, max: 920 },
  { label: 'Após 15:20', min: 921, max: 1140 }
];

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

export default function Dashboard3Pontualidade({
  alunos,
  ocorrenciasUnificadas,
  onDataUpdated
}: Dashboard3PontualidadeProps) {
  const [turnoHistograma, setTurnoHistograma] = useState<'manha' | 'tarde'>('manha');
  const [filtroReincidencia, setFiltroReincidencia] = useState<'todos3' | 'critico5'>('todos3');
  const [convocandoRa, setConvocandoRa] = useState<string | null>(null);

  const alunosPorRa = useMemo(() => {
    const map = new Map<string, AlunoNormalizado>();
    alunos.forEach((a) => {
      if (a.ra) map.set(normalizarRa(a.ra), a);
    });
    return map;
  }, [alunos]);

  const { atrasosFiltrados, saidasAntecipadas } = useMemo(() => {
    const atrasos: any[] = [];
    const saidas: any[] = [];

    ocorrenciasUnificadas.forEach((oc) => {
      const raKey = normalizarRa(oc.ra || oc.raAluno);
      if (raKey && !alunosPorRa.has(raKey)) return; // respeita filtros globais

      const tipo = String(oc.tipo || oc.categoria || '').toLowerCase();
      const isAtraso = oc.isAtraso === true || tipo.includes('atraso');
      const isSaida = tipo.includes('saída antecipada') || tipo.includes('saida antecipada');

      if (isSaida) saidas.push(oc);
      else if (isAtraso) atrasos.push(oc);
    });

    return { atrasosFiltrados: atrasos, saidasAntecipadas: saidas };
  }, [ocorrenciasUnificadas, alunosPorRa]);

  // Ranking de Reincidência (réguas: alerta = 3, crítico = 5)
  const rankingReincidencia = useMemo(() => {
    const mapa = new Map<
      string,
      {
        ra: string;
        nome: string;
        turma: string;
        tutor: string;
        totalAtrasos: number;
        somaMinutos: number;
        qtdHorarios: number;
        cienciaResponsavel: boolean;
        convocacaoRegistrada: boolean;
        ultimoAtraso: string;
      }
    >();

    atrasosFiltrados.forEach((oc) => {
      const rk = normalizarRa(oc.ra || oc.raAluno);
      if (!rk) return;
      const aluno = alunosPorRa.get(rk);
      const curr = mapa.get(rk) || {
        ra: aluno?.ra || String(oc.ra || rk),
        nome: aluno?.nome || String(oc.nomeAluno || 'Estudante'),
        turma: aluno?.turma || String(oc.turma || '—'),
        tutor: aluno?.tutor || '—',
        totalAtrasos: 0,
        somaMinutos: 0,
        qtdHorarios: 0,
        cienciaResponsavel: false,
        convocacaoRegistrada: false,
        ultimoAtraso: ''
      };

      curr.totalAtrasos += 1;
      const hm = extrairHoraMinutoAtraso(oc);
      if (hm) {
        curr.somaMinutos += hm.minutosDesdeMeiaNoite;
        curr.qtdHorarios += 1;
      }
      if (oc.cienciaResponsavel === true || Boolean(oc.dataCiencia)) {
        curr.cienciaResponsavel = true;
      }
      const iso = toIsoDate(oc.data || oc.dataRegistro);
      if (iso > curr.ultimoAtraso) curr.ultimoAtraso = iso;

      mapa.set(rk, curr);
    });

    // Verifica também se já existe convocação na trilha
    ocorrenciasUnificadas.forEach((oc) => {
      const tipo = String(oc.tipo || '').toLowerCase();
      if (!tipo.includes('convoca') && !tipo.includes('termo')) return;
      const rk = normalizarRa(oc.ra || oc.raAluno);
      const item = mapa.get(rk);
      if (item) {
        item.convocacaoRegistrada = true;
        if (oc.cienciaResponsavel === true) item.cienciaResponsavel = true;
      }
    });

    const minCut = filtroReincidencia === 'critico5' ? 5 : 3;

    return Array.from(mapa.values())
      .filter((r) => r.totalAtrasos >= minCut)
      .map((r) => {
        let horaMedia = '—';
        if (r.qtdHorarios > 0) {
          const avg = Math.round(r.somaMinutos / r.qtdHorarios);
          const hh = Math.floor(avg / 60);
          const mm = avg % 60;
          horaMedia = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        }
        return { ...r, horaMedia };
      })
      .sort((a, b) => b.totalAtrasos - a.totalAtrasos);
  }, [atrasosFiltrados, alunosPorRa, ocorrenciasUnificadas, filtroReincidencia]);

  // Histograma de Horários e Dias da Semana
  const histograma = useMemo(() => {
    const faixasBase = turnoHistograma === 'manha' ? FAIXAS_MANHA : FAIXAS_TARDE;
    const contagemFaixas = faixasBase.map((f) => ({ ...f, qtd: 0 }));
    const contagemDias = [0, 0, 0, 0, 0]; // Seg..Sex

    atrasosFiltrados.forEach((oc) => {
      const hm = extrairHoraMinutoAtraso(oc);
      if (hm) {
        const idx = contagemFaixas.findIndex(
          (f) => hm.minutosDesdeMeiaNoite >= f.min && hm.minutosDesdeMeiaNoite <= f.max
        );
        if (idx >= 0) contagemFaixas[idx].qtd += 1;
      }

      const iso = toIsoDate(oc.data || oc.dataRegistro);
      if (iso) {
        const dt = new Date(`${iso}T12:00:00`);
        const dow = dt.getDay(); // 1=Seg .. 5=Sex
        if (dow >= 1 && dow <= 5) {
          contagemDias[dow - 1] += 1;
        }
      }
    });

    const maxFaixa = Math.max(1, ...contagemFaixas.map((f) => f.qtd));
    const maxDia = Math.max(1, ...contagemDias);
    return { contagemFaixas, contagemDias, maxFaixa, maxDia };
  }, [atrasosFiltrados, turnoHistograma]);

  // Monitoramento de Saídas Antecipadas por turma e motivos
  const resumoSaidas = useMemo(() => {
    const porTurma = new Map<string, number>();
    const porMotivo = new Map<string, number>();

    saidasAntecipadas.forEach((oc) => {
      const t = String(oc.turma || 'Sem Turma').toUpperCase().trim();
      porTurma.set(t, (porTurma.get(t) || 0) + 1);

      const desc = String(oc.motivo || oc.descricao || 'Não especificado').trim();
      const motivoCurto = desc.length > 48 ? `${desc.slice(0, 48)}…` : desc;
      porMotivo.set(motivoCurto, (porMotivo.get(motivoCurto) || 0) + 1);
    });

    return {
      total: saidasAntecipadas.length,
      turmas: Array.from(porTurma.entries()).sort((a, b) => b[1] - a[1]),
      motivos: Array.from(porMotivo.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
    };
  }, [saidasAntecipadas]);

  const registrarConvocacao = async (item: typeof rankingReincidencia[number]) => {
    setConvocandoRa(item.ra);
    try {
      const user = obterUsuarioAtivoCompleto();
      const agoraIso = new Date().toISOString();

      // Payload estritamente sem id / _id (AGENTS.md)
      const payload = sanitizarPayloadMongo({
        ra: item.ra,
        nomeAluno: item.nome.toUpperCase(),
        turma: item.turma.toUpperCase(),
        tipo: 'Convocação de Responsáveis (Pontualidade)',
        categoria: 'Pontualidade e Atrasos',
        descricao: `Convocação automática gerada pelo Radar de Pontualidade (${item.totalAtrasos} atrasos acumulados · média de chegada ${item.horaMedia}). Termo de Ciência pendente de assinatura.`,
        data: agoraIso,
        dataRegistro: agoraIso,
        cienciaResponsavel: false,
        isAtraso: false,
        usuario: user.textoCompleto,
        autor: user.textoCompleto,
        registradoPor: user.textoCompleto
      });

      await addDoc(collection(db, 'ocorrencias'), payload);
      await onDataUpdated();

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(`Convocação registrada na ficha de ${item.nome}.`, 'success');
      }
    } catch (err) {
      console.error('[Dashboard3Pontualidade] Erro ao gerar convocação:', err);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao registrar convocação de responsáveis.', 'error');
      }
    } finally {
      setConvocandoRa(null);
    }
  };

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  const totalAlerta3 = rankingReincidencia.filter((r) => r.totalAtrasos >= 3 && r.totalAtrasos < 5).length;
  const totalCritico5 = rankingReincidencia.filter((r) => r.totalAtrasos >= 5).length;
  const pendentesCiencia = rankingReincidencia.filter((r) => !r.cienciaResponsavel).length;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 3 · Radar de Pontualidade, Atrasos & Saídas Antecipadas
          </h2>
          <p className="text-xs text-slate-600">
            Réguas institucionais: Alerta = <strong>3 atrasos</strong> · Crítico = <strong>5+ atrasos</strong> · Tolerância = <strong>15 min</strong> (Manhã 07:00 / Tarde 14:20).
          </p>
        </div>
      </div>

      {/* KPIs de Pontualidade */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total de Atrasos</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">{atrasosFiltrados.length}</div>
          <div className="mt-1 text-[11px] text-slate-500">Ocorrências na base filtrada</div>
        </div>

        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Em Alerta (3–4 Atrasos)</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700 tabular-nums">{totalAlerta3}</div>
          <div className="mt-1 text-[11px] text-amber-800">Monitoramento preventivo</div>
        </div>

        <div className="bg-rose-50 rounded-2xl border border-rose-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Críticos (5+ Atrasos)</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{totalCritico5}</div>
          <div className="mt-1 text-[11px] text-rose-700">Convocação imediata</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sem Termo de Ciência</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{pendentesCiencia}</div>
          <div className="mt-1 text-[11px] text-slate-500">Reincidentes sem ciência</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Saídas Antecipadas</div>
          <div className="mt-1 text-2xl font-extrabold text-indigo-700 tabular-nums">{resumoSaidas.total}</div>
          <div className="mt-1 text-[11px] text-slate-500">Registros antes do fim integral</div>
        </div>
      </div>

      {/* Histograma de Horários e Dias da Semana */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-extrabold text-[#1d2b4f]">
                Distribuição por Faixa Horária de Chegada
              </h3>
              <p className="text-xs text-slate-500">
                Turno Manhã a partir das 07:00 · Turno Tarde a partir das 14:20.
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setTurnoHistograma('manha')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  turnoHistograma === 'manha' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
                }`}
              >
                Manhã (07:00+)
              </button>
              <button
                type="button"
                onClick={() => setTurnoHistograma('tarde')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  turnoHistograma === 'tarde' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
                }`}
              >
                Tarde (14:20+)
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {histograma.contagemFaixas.map((f, idx) => {
              const pct = Math.round((f.qtd / histograma.maxFaixa) * 100);
              return (
                <div key={f.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">{f.label}</span>
                    <span className="font-extrabold text-[#1d2b4f] tabular-nums">{f.qtd}</span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${idx === 0 ? 'bg-amber-500' : 'bg-[#1d2b4f]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f]">Atrasos por Dia da Semana</h3>
          <p className="text-xs text-slate-500 mb-4">Concentração entre Segunda e Sexta-feira.</p>

          <div className="grid grid-cols-5 gap-3 items-end h-44 pt-4">
            {DIAS_SEMANA.map((dia, i) => {
              const qtd = histograma.contagemDias[i];
              const hPct = Math.max(6, Math.round((qtd / histograma.maxDia) * 100));
              return (
                <div key={dia} className="flex flex-col items-center justify-end h-full">
                  <span className="text-xs font-extrabold text-[#1d2b4f] tabular-nums mb-1">{qtd}</span>
                  <div className="w-full max-w-[44px] bg-slate-100 rounded-lg h-28 flex items-end overflow-hidden">
                    <div className="w-full bg-cyan-600 rounded-t-md transition-all" style={{ height: `${hPct}%` }} />
                  </div>
                  <span className="mt-1.5 text-xs font-bold text-slate-700">{dia}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ranking de Reincidência Acionável */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Ranking de Reincidência Acionável ({rankingReincidencia.length})
            </h3>
            <p className="text-xs text-slate-500">
              Estudantes com 3+ ou 5+ atrasos, horário médio de chegada e status do Termo de Ciência.
            </p>
          </div>
          <select
            value={filtroReincidencia}
            onChange={(e) => setFiltroReincidencia(e.target.value as any)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
          >
            <option value="todos3">Alerta + Crítico (3+ atrasos)</option>
            <option value="critico5">Somente Críticos (5+ atrasos)</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Aluno</th>
                <th className="py-3 px-3">Turma</th>
                <th className="py-3 px-3 text-center">Atrasos</th>
                <th className="py-3 px-3 text-center">Horário Médio</th>
                <th className="py-3 px-3">Termo de Ciência</th>
                <th className="py-3 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {rankingReincidencia.map((r) => (
                <tr key={r.ra} className={r.totalAtrasos >= 5 ? 'bg-rose-50/40' : ''}>
                  <td className="py-2.5 px-4">
                    <button
                      type="button"
                      onClick={() => abrirFicha(r.ra)}
                      className="font-bold text-[#1d2b4f] hover:underline text-left cursor-pointer"
                    >
                      {r.nome}
                    </button>
                    <div className="text-[11px] text-slate-500">RA {r.ra} · Tutor: {r.tutor}</div>
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-700">{r.turma}</td>
                  <td className="py-2.5 px-3 text-center tabular-nums">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md font-extrabold ${
                        r.totalAtrasos >= 5
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {r.totalAtrasos}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700 tabular-nums">
                    {r.horaMedia}
                  </td>
                  <td className="py-2.5 px-3">
                    {r.cienciaResponsavel ? (
                      <span className="text-emerald-700 font-bold">Assinado / Ciente</span>
                    ) : (
                      <span className="text-rose-700 font-bold">
                        Pendente {r.convocacaoRegistrada ? '(Convocação Gerada)' : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      disabled={convocandoRa === r.ra}
                      onClick={() => registrarConvocacao(r)}
                      className="px-3 py-1.5 rounded-lg bg-[#1d2b4f] hover:bg-blue-900 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer"
                    >
                      {convocandoRa === r.ra ? 'Gerando...' : 'Gerar / Registrar Convocação'}
                    </button>
                  </td>
                </tr>
              ))}
              {rankingReincidencia.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    Nenhum estudante atingiu a régua de reincidência para os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monitoramento de Saídas Antecipadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">Saídas Antecipadas por Turma</h3>
          {resumoSaidas.turmas.length > 0 ? (
            <div className="space-y-2">
              {resumoSaidas.turmas.slice(0, 10).map(([turma, qtd]) => (
                <div key={turma} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                  <span className="font-bold text-slate-700">{turma}</span>
                  <span className="font-extrabold text-[#1d2b4f] tabular-nums">{qtd} saídas</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Nenhuma saída antecipada registrada no período filtrado.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">Principais Motivos de Saída Antecipada</h3>
          {resumoSaidas.motivos.length > 0 ? (
            <div className="space-y-2">
              {resumoSaidas.motivos.map(([motivo, qtd]) => (
                <div key={motivo} className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-slate-100">
                  <span className="text-slate-700 truncate">{motivo}</span>
                  <span className="font-extrabold text-indigo-700 tabular-nums shrink-0">{qtd}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Sem motivos registrados para o filtro atual.</p>
          )}
        </div>
      </div>
    </div>
  );
}
