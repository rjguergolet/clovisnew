import React, { useEffect, useMemo, useState } from 'react';
import { db, doc, getDoc, setDoc } from '../../lib/database';
import { obterUsuarioAtivoCompleto } from '../../modules/authHelper';
import {
  AlunoNormalizado,
  normalizarRa,
  normalizarStatusChamada,
  sanitizarPayloadMongo
} from '../../modules/inteligenciaDataEngine';

interface ChamadaDiariaConsolidacaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  alunos: AlunoNormalizado[];
  frequenciaDiariaDocs: any[];
  turmaInicial?: string;
  onSaved: () => Promise<void> | void;
}

export default function ChamadaDiariaConsolidacaoModal({
  isOpen,
  onClose,
  alunos,
  frequenciaDiariaDocs,
  turmaInicial = '',
  onSaved
}: ChamadaDiariaConsolidacaoModalProps) {
  const hojeIso = useMemo(() => {
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const [dataChamada, setDataChamada] = useState(hojeIso);
  const [turmaFiltro, setTurmaFiltro] = useState(turmaInicial || '');
  const [busca, setBusca] = useState('');
  const [statusMap, setStatusMap] = useState<Record<string, 'P' | 'F' | 'J'>>({});
  const [salvando, setSalvando] = useState(false);

  const turmasDisponiveis = useMemo(() => {
    const setT = new Set<string>();
    alunos.filter((a) => a.ativo).forEach((a) => {
      if (a.turma) setT.add(a.turma);
    });
    return Array.from(setT).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [alunos]);

  useEffect(() => {
    if (!isOpen) return;
    if (turmaInicial) setTurmaFiltro(turmaInicial);
    else if (!turmaFiltro && turmasDisponiveis.length > 0) setTurmaFiltro(turmasDisponiveis[0]);
  }, [isOpen, turmaInicial, turmaFiltro, turmasDisponiveis]);

  // Carrega registros já existentes para a data selecionada
  useEffect(() => {
    if (!isOpen) return;
    const novoMapa: Record<string, 'P' | 'F' | 'J'> = {};

    const docsDaData = (frequenciaDiariaDocs || []).filter((d) => {
      const dIso = String(d?.data || d?.dataChamada || '').slice(0, 10);
      return dIso === dataChamada || String(d?.id || '').includes(dataChamada);
    });

    docsDaData.forEach((docItem) => {
      if (docItem?.registros && typeof docItem.registros === 'object') {
        Object.entries(docItem.registros).forEach(([raKey, val]: [string, any]) => {
          const st = normalizarStatusChamada(typeof val === 'string' ? val : val?.status);
          if (st) novoMapa[normalizarRa(raKey)] = st;
        });
      }
      if (docItem?.datas?.[dataChamada]) {
        Object.entries(docItem.datas[dataChamada]).forEach(([raKey, val]: [string, any]) => {
          const st = normalizarStatusChamada(typeof val === 'string' ? val : val?.status);
          if (st) novoMapa[normalizarRa(raKey)] = st;
        });
      }
    });

    setStatusMap(novoMapa);
  }, [isOpen, dataChamada, frequenciaDiariaDocs]);

  const alunosTurma = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return alunos
      .filter((a) => a.ativo)
      .filter((a) => !turmaFiltro || a.turma === turmaFiltro)
      .filter((a) => !q || a.nome.toLowerCase().includes(q) || a.ra.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [alunos, turmaFiltro, busca]);

  const resumoTurma = useMemo(() => {
    let p = 0;
    let f = 0;
    let j = 0;
    let pendentes = 0;
    alunosTurma.forEach((al) => {
      const st = statusMap[normalizarRa(al.ra)];
      if (st === 'P') p++;
      else if (st === 'F') f++;
      else if (st === 'J') j++;
      else pendentes++;
    });
    return { p, f, j, pendentes };
  }, [alunosTurma, statusMap]);

  if (!isOpen) return null;

  const marcarTodosPresentes = () => {
    const updated = { ...statusMap };
    alunosTurma.forEach((al) => {
      const rk = normalizarRa(al.ra);
      if (!updated[rk]) {
        updated[rk] = 'P';
      }
    });
    setStatusMap(updated);
  };

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      const docId = `chamada_${dataChamada}`;
      const docRef = doc(db, 'frequencia_diaria', docId);
      const user = obterUsuarioAtivoCompleto();

      let existingRegistros: Record<string, any> = {};
      try {
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data()?.registros) {
          existingRegistros = { ...snap.data().registros };
        }
      } catch {
        // segue com registros locais
      }

      const agoraIso = new Date().toISOString();
      const mergedRegistros: Record<string, any> = { ...existingRegistros };

      alunosTurma.forEach((al) => {
        const rk = normalizarRa(al.ra);
        const st = statusMap[rk];
        if (st) {
          mergedRegistros[al.ra || rk] = {
            status: st,
            nome: al.nome,
            turma: al.turma,
            atualizadoEm: agoraIso
          };
        }
      });

      // Payload estritamente sem id / _id (AGENTS.md)
      const payload = sanitizarPayloadMongo({
        data: dataChamada,
        anoLetivo: dataChamada.slice(0, 4),
        turmaUltimaEdicao: turmaFiltro || 'TODAS',
        registros: mergedRegistros,
        atualizadoPor: user.nome || user.email,
        atualizadoPorCargo: user.cargo,
        atualizadoEm: agoraIso
      });

      await setDoc(docRef, payload, { merge: true });
      await onSaved();

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(`Frequência diária de ${dataChamada} salva e consolidada no Dashboard 1.`, 'success');
      }
      onClose();
    } catch (err) {
      console.error('[ChamadaDiariaConsolidacaoModal] Erro ao salvar chamada:', err);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao salvar chamada diária no banco de dados.', 'error');
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="bg-[#1d2b4f] text-white px-5 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
              Fonte 3 · Chamada Diária em Tempo Real
            </div>
            <h3 className="text-base sm:text-lg font-extrabold truncate">
              Lançamento e Consolidação da Frequência Diária
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
            title="Fechar"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Data Letiva</label>
            <input
              type="date"
              value={dataChamada}
              onChange={(e) => setDataChamada(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-800"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Turma</label>
            <select
              value={turmaFiltro}
              onChange={(e) => setTurmaFiltro(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-800"
            >
              <option value="">Todas as turmas</option>
              {turmasDisponiveis.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Buscar Estudante</label>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome ou RA..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-800"
            />
          </div>
        </div>

        <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-3 tabular-nums font-bold">
            <span className="text-emerald-700">Presentes (P): {resumoTurma.p}</span>
            <span className="text-rose-700">Faltas (F): {resumoTurma.f}</span>
            <span className="text-amber-700">Justificadas (J): {resumoTurma.j}</span>
            <span className="text-slate-500">Pendentes: {resumoTurma.pendentes}</span>
          </div>
          <button
            type="button"
            onClick={marcarTodosPresentes}
            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-bold cursor-pointer transition-colors"
          >
            Marcar Pendentes como Presente (P)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {alunosTurma.map((al) => {
            const rk = normalizarRa(al.ra);
            const st = statusMap[rk];
            return (
              <div key={al.ra} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{al.nome}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    RA {al.ra} · {al.turma} · Tutor: {al.tutor || 'Não atribuído'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(['P', 'F', 'J'] as const).map((code) => {
                    const active = st === code;
                    const colorMap = {
                      P: active ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
                      F: active ? 'bg-rose-600 text-white border-rose-700' : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50',
                      J: active ? 'bg-amber-500 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                    };
                    const titleMap = { P: 'Presente', F: 'Falta', J: 'Justificada' };
                    return (
                      <button
                        key={code}
                        type="button"
                        title={titleMap[code]}
                        onClick={() => setStatusMap((prev) => ({ ...prev, [rk]: code }))}
                        className={`w-10 h-9 rounded-lg border text-xs font-extrabold transition-colors cursor-pointer ${colorMap[code]}`}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {alunosTurma.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              Nenhum estudante ativo encontrado para os filtros selecionados.
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={salvando || alunosTurma.length === 0}
            onClick={handleSalvar}
            className="px-5 py-2 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 disabled:opacity-50 text-white text-xs font-bold cursor-pointer flex items-center gap-2"
          >
            <i className={`fa-solid ${salvando ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
            <span>{salvando ? 'Salvando...' : 'Salvar e Consolidar Chamada'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
