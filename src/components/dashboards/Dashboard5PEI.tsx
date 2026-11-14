import React, { useMemo, useState } from 'react';
import { AlunoNormalizado } from '../../modules/inteligenciaDataEngine';
import { normalizeTeacherName } from '../../utils';

interface Dashboard5PEIProps {
  alunos: AlunoNormalizado[];
  professores: any[];
  capacidadesPEI: Record<string, any>;
}

export default function Dashboard5PEI({ alunos, professores, capacidadesPEI }: Dashboard5PEIProps) {
  const [abaAlocacao, setAbaAlocacao] = useState<'sem_tutor' | 'sem_clube' | 'sem_eletiva'>('sem_tutor');

  const ativos = useMemo(() => alunos.filter((a) => a.ativo), [alunos]);

  // Termômetro de Lotação de Tutoria
  const lotacaoTutores = useMemo(() => {
    const capTutoresMap: Record<string, number> = {};
    const rawTutoresCap = capacidadesPEI?.tutores || capacidadesPEI?.capacidadeTutores || {};
    Object.entries(rawTutoresCap).forEach(([nome, cap]) => {
      capTutoresMap[normalizeTeacherName(nome)] = Number(cap) || 25;
    });

    const profCargoMap = new Map<string, string>();
    (professores || []).forEach((p) => {
      const n = String(p?.nome || p?.professor || '').trim();
      if (n) profCargoMap.set(normalizeTeacherName(n), String(p?.cargo || p?.funcao || ''));
    });

    const grupos = new Map<string, { nome: string; norm: string; reais: number; meta: number }>();

    ativos.forEach((al) => {
      const nomeTutor = al.tutor || 'Sem Tutor Atribuído';
      if (nomeTutor === 'Sem Tutor Atribuído') return;
      const norm = normalizeTeacherName(nomeTutor);
      if (!grupos.has(norm)) {
        const cargo = profCargoMap.get(norm)?.toUpperCase() || '';
        const isGestor =
          cargo.includes('DIRETOR') ||
          cargo.includes('CGPG') ||
          cargo.includes('CGPCG') ||
          cargo.includes('PAAC') ||
          cargo.includes('COORD');
        const metaConfig = capTutoresMap[norm] ?? (isGestor ? 8 : 26);
        grupos.set(norm, { nome: nomeTutor, norm, reais: 0, meta: metaConfig });
      }
      grupos.get(norm)!.reais += 1;
    });

    return Array.from(grupos.values()).sort((a, b) => b.reais / Math.max(1, b.meta) - a.reais / Math.max(1, a.meta));
  }, [ativos, professores, capacidadesPEI]);

  // Radar de Tutorias Atrasadas (> 30 dias ou nunca registrada), ordenadas por risco acadêmico/frequência
  const tutoriasAtrasadas = useMemo(() => {
    return ativos
      .filter((al) => al.diasSemTutoria === null || al.diasSemTutoria > 30)
      .map((al) => {
        const minFreq = Math.min(al.sedFreq ?? 100, al.diariaFreq ?? 100, al.mapaoFreq ?? 100);
        const riscoFreq = minFreq < 75;
        const riscoNota = (al.mediaGeralAtual !== null && al.mediaGeralAtual < 5) || al.qtdAbaixoBasicoAtual > 0;
        let scoreRisco = 0;
        if (riscoFreq) scoreRisco += 500;
        if (riscoNota) scoreRisco += 300;
        scoreRisco += al.qtdAbaixoBasicoAtual * 40;
        scoreRisco += al.diasSemTutoria ?? 365;
        return { al, riscoFreq, riscoNota, scoreRisco };
      })
      .sort((a, b) => b.scoreRisco - a.scoreRisco);
  }, [ativos]);

  // Clubes, Eletivas & Projeto de Vida
  const projetosDistribuicao = useMemo(() => {
    const clubes = new Map<string, number>();
    const eletivas = new Map<string, number>();
    const pvAreas = new Map<string, number>();

    let semTutor = 0;
    let semClube = 0;
    let semEletiva = 0;

    ativos.forEach((al) => {
      if (!al.tutor) semTutor++;
      if (!al.clube) semClube++;
      else clubes.set(al.clube, (clubes.get(al.clube) || 0) + 1);

      if (!al.eletiva) semEletiva++;
      else eletivas.set(al.eletiva, (eletivas.get(al.eletiva) || 0) + 1);

      if (al.projetoVida) {
        pvAreas.set(al.projetoVida, (pvAreas.get(al.projetoVida) || 0) + 1);
      }
    });

    return {
      clubes: Array.from(clubes.entries()).sort((a, b) => b[1] - a[1]),
      eletivas: Array.from(eletivas.entries()).sort((a, b) => b[1] - a[1]),
      pvAreas: Array.from(pvAreas.entries()).sort((a, b) => b[1] - a[1]),
      semTutor,
      semClube,
      semEletiva
    };
  }, [ativos]);

  const listaSemAlocacao = useMemo(() => {
    if (abaAlocacao === 'sem_tutor') return ativos.filter((a) => !a.tutor);
    if (abaAlocacao === 'sem_clube') return ativos.filter((a) => !a.clube);
    return ativos.filter((a) => !a.eletiva);
  }, [ativos, abaAlocacao]);

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-base font-extrabold text-[#1d2b4f]">
          Painel 5 · Gestão Pedagógica PEI (Tutoria, Clubes, Eletivas & Projeto de Vida)
        </h2>
        <p className="text-xs text-slate-600">
          Monitoramento de lotação de tutores (<code className="bg-slate-100 px-1 rounded">capacidades_pei</code>), tutorias atrasadas (&gt;30 dias) e aderência às frentes do Programa Ensino Integral.
        </p>
      </div>

      {/* KPIs PEI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tutores Ativos</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">{lotacaoTutores.length}</div>
          <div className="mt-1 text-[11px] text-slate-500">{projetosDistribuicao.semTutor} alunos sem tutor</div>
        </div>

        <div className="bg-rose-50 rounded-2xl border border-rose-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Tutorias Atrasadas (&gt;30d)</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{tutoriasAtrasadas.length}</div>
          <div className="mt-1 text-[11px] text-rose-700">Priorizados por nota &lt; 5 ou freq &lt; 75%</div>
        </div>

        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Sem Clube / Eletiva</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700 tabular-nums">
            {projetosDistribuicao.semClube} / {projetosDistribuicao.semEletiva}
          </div>
          <div className="mt-1 text-[11px] text-amber-800">Estudantes ativos aguardando enturmação</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Áreas de Projeto de Vida</div>
          <div className="mt-1 text-2xl font-extrabold text-cyan-700 tabular-nums">{projetosDistribuicao.pvAreas.length}</div>
          <div className="mt-1 text-[11px] text-slate-500">Eixos mapeados em projeto_vida_2026</div>
        </div>
      </div>

      {/* Termômetro de Lotação & Radar de Tutorias Atrasadas */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-6 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-1">
            Termômetro de Lotação de Tutoria (Real × Meta)
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Compara a meta em <code className="bg-slate-100 px-1 rounded">capacidades_pei</code> (ex: 8 gestão / 25–27 docentes) com alunos ativos vinculados.
          </p>

          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {lotacaoTutores.map((t) => {
              const pct = Math.min(130, Math.round((t.reais / Math.max(1, t.meta)) * 100));
              const estourado = t.reais > t.meta;
              return (
                <div key={t.norm}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-bold text-slate-800 truncate">{t.nome}</span>
                    <span className={`font-extrabold tabular-nums ${estourado ? 'text-rose-700' : 'text-[#1d2b4f]'}`}>
                      {t.reais} / {t.meta} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${estourado ? 'bg-rose-600' : pct >= 90 ? 'bg-amber-500' : 'bg-cyan-600'}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {lotacaoTutores.length === 0 && (
              <p className="text-xs text-slate-500">Nenhum tutor vinculado nos cadastros filtrados.</p>
            )}
          </div>
        </div>

        <div className="xl:col-span-6 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70">
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Radar de Tutorias Atrasadas (&gt; 30 dias sem acolhimento)
            </h3>
            <p className="text-xs text-slate-500">
              Ordenado por maior risco acadêmico (nota &lt; 5) ou frequência (&lt; 75%).
            </p>
          </div>

          <div className="flex-1 max-h-[410px] overflow-y-auto divide-y divide-slate-100 text-xs">
            {tutoriasAtrasadas.slice(0, 80).map(({ al, riscoFreq, riscoNota }) => (
              <div key={al.ra} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => abrirFicha(al.ra)}
                    className="font-bold text-[#1d2b4f] hover:underline truncate block text-left cursor-pointer"
                  >
                    {al.nome}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    {al.turma} · Tutor: {al.tutor || 'Sem tutor'}
                    {riscoFreq && <span className="ml-1.5 text-rose-700 font-bold">[Freq &lt;75%]</span>}
                    {riscoNota && <span className="ml-1.5 text-amber-700 font-bold">[Nota &lt;5]</span>}
                  </div>
                </div>
                <div className="text-right tabular-nums shrink-0">
                  <div className="font-extrabold text-rose-700">
                    {al.diasSemTutoria !== null ? `${al.diasSemTutoria} dias` : 'Sem registro'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {al.ultimaTutoria || 'Nunca atendido'}
                  </div>
                </div>
              </div>
            ))}
            {tutoriasAtrasadas.length === 0 && (
              <div className="p-8 text-center text-sm text-emerald-700 font-semibold">
                Todas as tutorias dos estudantes filtrados estão em dia (≤ 30 dias).
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clubes, Eletivas, Projeto de Vida e Alertas de Sem Alocação */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">Clubes Juvenis ({projetosDistribuicao.clubes.length})</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
            {projetosDistribuicao.clubes.map(([nome, qtd]) => (
              <div key={nome} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="font-semibold text-slate-700 truncate">{nome}</span>
                <span className="font-extrabold text-[#1d2b4f] tabular-nums">{qtd}</span>
              </div>
            ))}
            {projetosDistribuicao.clubes.length === 0 && <p className="text-slate-500">Sem clubes registrados.</p>}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">Eletivas ({projetosDistribuicao.eletivas.length})</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
            {projetosDistribuicao.eletivas.map(([nome, qtd]) => (
              <div key={nome} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="font-semibold text-slate-700 truncate">{nome}</span>
                <span className="font-extrabold text-cyan-700 tabular-nums">{qtd}</span>
              </div>
            ))}
            {projetosDistribuicao.eletivas.length === 0 && <p className="text-slate-500">Sem eletivas registradas.</p>}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-3">
            Ranking Projeto de Vida ({projetosDistribuicao.pvAreas.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
            {projetosDistribuicao.pvAreas.map(([area, qtd]) => (
              <div key={area} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="font-semibold text-slate-700 truncate">{area}</span>
                <span className="font-extrabold text-indigo-700 tabular-nums">{qtd}</span>
              </div>
            ))}
            {projetosDistribuicao.pvAreas.length === 0 && <p className="text-slate-500">Sem áreas de Projeto de Vida informadas.</p>}
          </div>
        </div>
      </div>

      {/* Estudantes sem alocação */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Alerta de Estudantes Ativos Sem Alocação ({listaSemAlocacao.length})
            </h3>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setAbaAlocacao('sem_tutor')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                abaAlocacao === 'sem_tutor' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
              }`}
            >
              Sem Tutor ({projetosDistribuicao.semTutor})
            </button>
            <button
              type="button"
              onClick={() => setAbaAlocacao('sem_clube')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                abaAlocacao === 'sem_clube' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
              }`}
            >
              Sem Clube ({projetosDistribuicao.semClube})
            </button>
            <button
              type="button"
              onClick={() => setAbaAlocacao('sem_eletiva')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                abaAlocacao === 'sem_eletiva' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
              }`}
            >
              Sem Eletiva ({projetosDistribuicao.semEletiva})
            </button>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto text-xs">
          {listaSemAlocacao.slice(0, 60).map((al) => (
            <button
              key={al.ra}
              type="button"
              onClick={() => abrirFicha(al.ra)}
              className="p-2.5 rounded-xl border border-slate-200 hover:border-cyan-400 hover:bg-slate-50 text-left cursor-pointer"
            >
              <div className="font-bold text-[#1d2b4f] truncate">{al.nome}</div>
              <div className="text-[11px] text-slate-500 tabular-nums">RA {al.ra} · {al.turma}</div>
            </button>
          ))}
          {listaSemAlocacao.length === 0 && (
            <div className="col-span-full py-4 text-center text-emerald-700 font-semibold">
              100% dos estudantes filtrados estão devidamente alocados nesta frente.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
