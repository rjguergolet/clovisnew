import React, { useMemo, useState } from 'react';
import { doc, db, updateDoc } from '../../lib/database';
import {
  AlunoNormalizado,
  formatarTextoSeguro,
  normalizarRa,
  sanitizarPayloadMongo,
  toIsoDate
} from '../../modules/inteligenciaDataEngine';

interface Dashboard4ConvivenciaProps {
  alunos: AlunoNormalizado[];
  ocorrenciasUnificadas: any[];
  onDataUpdated: () => Promise<void> | void;
}

export default function Dashboard4Convivencia({
  alunos,
  ocorrenciasUnificadas,
  onDataUpdated
}: Dashboard4ConvivenciaProps) {
  const [filtroConviva, setFiltroConviva] = useState<'pendentes' | 'registradas' | 'todas'>('pendentes');
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [protocolosDraft, setProtocolosDraft] = useState<Record<string, string>>({});

  const alunosPorRa = useMemo(() => {
    const map = new Map<string, AlunoNormalizado>();
    alunos.forEach((a) => {
      if (a.ra) map.set(normalizarRa(a.ra), a);
    });
    return map;
  }, [alunos]);

  // Filtra ocorrências de convivência EXCLUINDO atrasos rotineiros e tutorias de rotina
  const ocorrenciasConvivencia = useMemo(() => {
    return ocorrenciasUnificadas.filter((oc) => {
      const raKey = normalizarRa(oc.ra || oc.raAluno);
      if (raKey && !alunosPorRa.has(raKey)) return false;

      const tipo = String(oc.tipo || oc.categoria || '').toLowerCase();
      const isAtrasoRotina = oc.isAtraso === true || tipo === 'atraso' || tipo.includes('registro de atraso');
      if (isAtrasoRotina) return false;
      if (tipo.includes('tutoria')) return false;
      if (tipo.includes('busca ativa')) return false;

      return true;
    });
  }, [ocorrenciasUnificadas, alunosPorRa]);

  const distribuicaoTipos = useMemo(() => {
    let disciplinar = 0;
    let questaoDisciplinar = 0;
    let questaoPedagogica = 0;
    let coletiva = 0;
    let outros = 0;

    ocorrenciasConvivencia.forEach((oc) => {
      const tipo = String(oc.tipo || oc.categoria || '').toLowerCase();
      const isColetiva =
        oc.isColetiva === true ||
        Array.isArray(oc.alunosEnvolvidos) && oc.alunosEnvolvidos.length > 1 ||
        tipo.includes('coletiv') ||
        tipo.includes('múltipl') ||
        tipo.includes('multipl');

      if (isColetiva) coletiva++;
      if (tipo.includes('ocorrência disciplinar') || tipo.includes('ocorrencia disciplinar')) disciplinar++;
      else if (tipo.includes('questão disciplinar') || tipo.includes('questao disciplinar')) questaoDisciplinar++;
      else if (tipo.includes('pedagóg') || tipo.includes('pedagog')) questaoPedagogica++;
      else if (!isColetiva) outros++;
    });

    const total = Math.max(1, ocorrenciasConvivencia.length);
    return {
      total: ocorrenciasConvivencia.length,
      items: [
        { label: 'Ocorrência Disciplinar', qtd: disciplinar, cor: 'bg-rose-600' },
        { label: 'Questão Disciplinar', qtd: questaoDisciplinar, cor: 'bg-amber-500' },
        { label: 'Questão Pedagógica', qtd: questaoPedagogica, cor: 'bg-cyan-600' },
        { label: 'Coletiva / Múltiplos Alunos', qtd: coletiva, cor: 'bg-purple-700' },
        { label: 'Outros Registros de Convivência', qtd: outros, cor: 'bg-slate-600' }
      ].map((it) => ({ ...it, pct: Math.round((it.qtd / total) * 100) }))
    };
  }, [ocorrenciasConvivencia]);

  // Painel de Conformidade Conviva SP
  const convivaCompliance = useMemo(() => {
    const graves = ocorrenciasConvivencia.filter((oc) => {
      const tipo = String(oc.tipo || oc.categoria || '').toLowerCase();
      const grav = String(oc.gravidade || '').toLowerCase();
      return (
        oc.registradoConviva !== undefined ||
        tipo.includes('disciplinar') ||
        tipo.includes('coletiv') ||
        tipo.includes('bullying') ||
        tipo.includes('agress') ||
        grav.includes('grave') ||
        grav.includes('alta')
      );
    });

    const registradas = graves.filter((oc) => oc.registradoConviva === true && Boolean(oc.protocoloConviva));
    const pendentesProtocolo = graves.filter((oc) => !oc.registradoConviva || !oc.protocoloConviva);
    const semCienciaFamilia = graves.filter((oc) => !oc.dataCiencia && oc.cienciaResponsavel !== true);

    const listaExibicao =
      filtroConviva === 'pendentes'
        ? graves.filter((oc) => !oc.registradoConviva || !oc.protocoloConviva || !oc.dataCiencia)
        : filtroConviva === 'registradas'
          ? registradas
          : graves;

    return {
      totalGraves: graves.length,
      qtdRegistradas: registradas.length,
      qtdPendentes: pendentesProtocolo.length,
      qtdSemCiencia: semCienciaFamilia.length,
      listaExibicao: listaExibicao.slice(0, 60)
    };
  }, [ocorrenciasConvivencia, filtroConviva]);

  // Termômetro por Turma
  const termometroTurmas = useMemo(() => {
    const map = new Map<string, { turma: string; total: number; graves: number }>();
    ocorrenciasConvivencia.forEach((oc) => {
      const t = String(oc.turma || 'Sem Turma').toUpperCase().trim();
      const curr = map.get(t) || { turma: t, total: 0, graves: 0 };
      curr.total += 1;
      const tipo = String(oc.tipo || '').toLowerCase();
      if (tipo.includes('disciplinar') || tipo.includes('coletiv')) curr.graves += 1;
      map.set(t, curr);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [ocorrenciasConvivencia]);

  const salvarProtocoloConviva = async (oc: any) => {
    if (!oc?.id) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Ocorrência aninhada sem ID top-level; edite pela Ficha do Aluno.', 'warning');
      }
      return;
    }
    const protocolo = (protocolosDraft[oc.id] ?? oc.protocoloConviva ?? '').trim();
    if (!protocolo) return;

    setSalvandoId(oc.id);
    try {
      // Payload estritamente sem id / _id (AGENTS.md)
      const payload = sanitizarPayloadMongo({
        registradoConviva: true,
        protocoloConviva: protocolo
      });
      await updateDoc(doc(db, 'ocorrencias', String(oc.id)), payload);
      await onDataUpdated();
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Protocolo Conviva SP atualizado.', 'success');
      }
    } catch (err) {
      console.error('[Dashboard4Convivencia] Erro ao atualizar protocolo Conviva:', err);
    } finally {
      setSalvandoId(null);
    }
  };

  const abrirFicha = (ra: string) => {
    if (ra && typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  const maxTurma = Math.max(1, ...(termometroTurmas.map((t) => t.total)));

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-base font-extrabold text-[#1d2b4f]">
          Painel 4 · Clima Escolar, Convivência (Conviva SP) & Ocorrências
        </h2>
        <p className="text-xs text-slate-600">
          Visão dedicada à convivência escolar e mediação preventiva (atrasos rotineiros, buscas ativas e tutorias filtrados automaticamente).
        </p>
      </div>

      {/* KPIs Convivência */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ocorrências de Convivência</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1d2b4f] tabular-nums">{distribuicaoTipos.total}</div>
          <div className="mt-1 text-[11px] text-slate-500">Excluindo atrasos rotineiros</div>
        </div>

        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Conviva SP Protocolado</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-700 tabular-nums">{convivaCompliance.qtdRegistradas}</div>
          <div className="mt-1 text-[11px] text-emerald-800">Com protocolo preenchido</div>
        </div>

        <div className="bg-rose-50 rounded-2xl border border-rose-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Pendentes Conviva SP</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-700 tabular-nums">{convivaCompliance.qtdPendentes}</div>
          <div className="mt-1 text-[11px] text-rose-700">Sem registro ou sem protocolo</div>
        </div>

        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Sem Data de Ciência</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-700 tabular-nums">{convivaCompliance.qtdSemCiencia}</div>
          <div className="mt-1 text-[11px] text-amber-800">Aguardando ciência da família</div>
        </div>
      </div>

      {/* Distribuição por Tipo e Termômetro por Turma */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-4">Distribuição por Tipo e Gravidade</h3>
          <div className="space-y-3">
            {distribuicaoTipos.items.map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold text-slate-700">{item.label}</span>
                  <span className="font-extrabold text-[#1d2b4f] tabular-nums">
                    {item.qtd} <span className="text-slate-400 font-semibold">({item.pct}%)</span>
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-md overflow-hidden">
                  <div className={`h-full ${item.cor}`} style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-extrabold text-[#1d2b4f] mb-1">Termômetro de Conflitos por Turma</h3>
          <p className="text-xs text-slate-500 mb-4">Ranking de volume para mediação preventiva da equipe gestora.</p>

          <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {termometroTurmas.map((t) => {
              const pct = Math.round((t.total / maxTurma) * 100);
              return (
                <div key={t.turma}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-extrabold text-slate-800">{t.turma}</span>
                    <span className="tabular-nums text-slate-700">
                      <strong>{t.total}</strong> ocorrências ({t.graves} disciplinares/coletivas)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${t.graves >= 5 ? 'bg-rose-600' : 'bg-cyan-600'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {termometroTurmas.length === 0 && (
              <p className="text-xs text-slate-500">Nenhuma ocorrência de convivência encontrada para os filtros.</p>
            )}
          </div>
        </div>
      </div>

      {/* Painel de Conformidade Conviva SP */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Conformidade Conviva SP & Ciência da Família
            </h3>
            <p className="text-xs text-slate-500">
              Controle de registros graves com protocolo Conviva SP e data de ciência dos responsáveis.
            </p>
          </div>

          <select
            value={filtroConviva}
            onChange={(e) => setFiltroConviva(e.target.value as any)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
          >
            <option value="pendentes">Pendentes de Protocolo ou Ciência</option>
            <option value="registradas">Com Protocolo Conviva SP</option>
            <option value="todas">Todas as Ocorrências Elegíveis</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                <th className="py-3 px-4">Data / Turma</th>
                <th className="py-3 px-3">Estudante</th>
                <th className="py-3 px-3">Tipo & Síntese</th>
                <th className="py-3 px-3">Ciência Família</th>
                <th className="py-3 px-4">Protocolo Conviva SP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {convivaCompliance.listaExibicao.map((oc, idx) => {
                const draftVal = oc.id ? (protocolosDraft[oc.id] ?? oc.protocoloConviva ?? '') : (oc.protocoloConviva || '');
                return (
                  <tr key={oc.id || `${oc.ra}-${idx}`}>
                    <td className="py-2.5 px-4 whitespace-nowrap tabular-nums">
                      <div className="font-bold text-slate-800">{toIsoDate(oc.data || oc.dataRegistro) || '—'}</div>
                      <div className="text-[11px] text-slate-500">{formatarTextoSeguro(oc.turma, '—')}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => abrirFicha(oc.ra)}
                        className="font-bold text-[#1d2b4f] hover:underline text-left cursor-pointer"
                      >
                        {formatarTextoSeguro(oc.nomeAluno, 'Estudante')}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs">
                      <div className="font-bold text-slate-800">{formatarTextoSeguro(oc.tipo || oc.categoria, 'Ocorrência')}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-2">{formatarTextoSeguro(oc.descricao, '—')}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {oc.dataCiencia || oc.cienciaResponsavel ? (
                        <span className="text-emerald-700 font-bold">
                          Ciente ({toIsoDate(oc.dataCiencia) || 'Confirmado'})
                        </span>
                      ) : (
                        <span className="text-rose-700 font-bold">Sem dataCiencia</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {oc.registradoConviva && oc.protocoloConviva ? (
                        <span className="font-bold text-emerald-700 tabular-nums">
                          #{oc.protocoloConviva}
                        </span>
                      ) : oc.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={draftVal}
                            onChange={(e) => setProtocolosDraft((prev) => ({ ...prev, [oc.id]: e.target.value }))}
                            placeholder="Nº Protocolo..."
                            className="w-28 px-2 py-1 border border-slate-300 rounded-lg text-xs"
                          />
                          <button
                            type="button"
                            disabled={salvandoId === oc.id || !draftVal.trim()}
                            onClick={() => salvarProtocoloConviva(oc)}
                            className="px-2.5 py-1 rounded-lg bg-[#1d2b4f] text-white font-bold text-[11px] disabled:opacity-40 cursor-pointer"
                          >
                            {salvandoId === oc.id ? '...' : 'Registrar'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-rose-700 font-semibold">Pendente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {convivaCompliance.listaExibicao.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    Nenhuma ocorrência encontrada neste filtro de conformidade.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
