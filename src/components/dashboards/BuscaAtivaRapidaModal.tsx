import React, { useState } from 'react';
import { addDoc, collection, db, doc, updateDoc } from '../../lib/database';
import { obterUsuarioAtivoCompleto } from '../../modules/authHelper';
import { AlunoNormalizado, sanitizarPayloadMongo } from '../../modules/inteligenciaDataEngine';

interface BuscaAtivaRapidaModalProps {
  aluno: AlunoNormalizado | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function BuscaAtivaRapidaModal({
  aluno,
  onClose,
  onSaved
}: BuscaAtivaRapidaModalProps) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [dataContato, setDataContato] = useState(hoje);
  const [tipoContato, setTipoContato] = useState('Ligação / WhatsApp');
  const [statusBa, setStatusBa] = useState<'Aguardando Retorno' | 'Contato Realizado' | 'Conselho Tutelar'>('Contato Realizado');
  const [compensacaoEntregue, setCompensacaoEntregue] = useState<boolean>(Boolean(aluno?.temCompensacaoEntregue));
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);

  if (!aluno) return null;

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!descricao.trim()) return;

    setSalvando(true);
    try {
      const user = obterUsuarioAtivoCompleto();
      const agoraIso = new Date().toISOString();

      const slaValor =
        statusBa === 'Conselho Tutelar'
          ? 'ENCAMINHADO_CONSELHO'
          : statusBa === 'Aguardando Retorno'
            ? 'AGUARDANDO_RETORNO'
            : 'CONTATO_REALIZADO';

      // Payload estritamente sem id / _id (AGENTS.md)
      const payloadBuscaAtiva = sanitizarPayloadMongo({
        ra: String(aluno.ra),
        nomeAluno: aluno.nome.toUpperCase(),
        turma: aluno.turma.toUpperCase(),
        data: dataContato,
        tipoContato,
        houveResposta: statusBa,
        descricao: descricao.trim(),
        compensacaoEntregue,
        dataRegistro: agoraIso,
        usuario: user.textoCompleto,
        autor: user.textoCompleto,
        autor_email: user.email,
        autor_nome: user.nome,
        autor_cargo: user.cargo
      });

      await addDoc(collection(db, 'busca_ativa'), payloadBuscaAtiva);

      // Atualiza SLA e indicador de compensação no documento do aluno (sem id / _id)
      if (aluno.ra) {
        const docIdAluno = aluno.raw?.id || aluno.ra;
        const payloadAluno = sanitizarPayloadMongo({
          sla_busca_ativa: slaValor,
          compensacao_ausencias_entregue: compensacaoEntregue
        });
        await updateDoc(doc(db, 'alunos', String(docIdAluno)), payloadAluno);
      }

      // Registra também na coleção ocorrencias para manter trilha unificada (sem id / _id)
      const payloadOcorrencia = sanitizarPayloadMongo({
        ra: String(aluno.ra),
        nomeAluno: aluno.nome.toUpperCase(),
        turma: aluno.turma.toUpperCase(),
        tipo: `Busca Ativa - ${tipoContato}`,
        categoria: 'Busca Ativa',
        origem: 'BUSCA_ATIVA',
        descricao: `[Busca Ativa · ${statusBa}] ${descricao.trim()}`,
        data: agoraIso,
        dataRegistro: agoraIso,
        usuario: user.textoCompleto,
        autor: user.textoCompleto,
        registradoPor: user.textoCompleto
      });
      await addDoc(collection(db, 'ocorrencias'), payloadOcorrencia);

      await onSaved();
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(`Busca Ativa registrada para ${aluno.nome}.`, 'success');
      }
      onClose();
    } catch (err) {
      console.error('[BuscaAtivaRapidaModal] Erro ao registrar busca ativa:', err);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Erro ao gravar registro de Busca Ativa.', 'error');
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleSalvar}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="bg-[#1d2b4f] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
              Ação Imediata · Busca Ativa
            </div>
            <h3 className="text-base font-extrabold">{aluno.nome}</h3>
            <p className="text-xs text-blue-200 tabular-nums">
              RA {aluno.ra} · {aluno.turma} · SED {aluno.sedFreq ?? '—'}% · Diária {aluno.diariaFreq ?? '—'}%
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Data da Ação</label>
              <input
                type="date"
                value={dataContato}
                onChange={(e) => setDataContato(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Canal de Contato</label>
              <select
                value={tipoContato}
                onChange={(e) => setTipoContato(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
              >
                <option value="Ligação / WhatsApp">Ligação / WhatsApp</option>
                <option value="Atendimento Presencial">Atendimento Presencial</option>
                <option value="Visita Domiciliar">Visita Domiciliar</option>
                <option value="Encaminhamento Conselho Tutelar">Encaminhamento Conselho Tutelar</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Situação no Funil da Busca Ativa</label>
            <div className="grid grid-cols-3 gap-2">
              {(['Aguardando Retorno', 'Contato Realizado', 'Conselho Tutelar'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setStatusBa(opt)}
                  className={`px-2.5 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                    statusBa === opt
                      ? 'bg-[#1d2b4f] text-white border-[#1d2b4f]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={compensacaoEntregue}
              onChange={(e) => setCompensacaoEntregue(e.target.checked)}
              className="w-4 h-4 rounded text-cyan-600"
            />
            <span className="text-xs font-semibold text-slate-700">
              Compensação de ausências entregue/em acompanhamento pelo estudante
            </span>
          </label>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Síntese do Contato / Encaminhamento</label>
            <textarea
              rows={3}
              required
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva o retorno da família, justificativa apresentada ou encaminhamento..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab('busca-ativa');
              }
              setTimeout(() => {
                if (typeof (window as any).selecionarAlunoParaBuscaAtiva === 'function') {
                  (window as any).selecionarAlunoParaBuscaAtiva(aluno.ra);
                }
              }, 200);
            }}
            className="text-xs font-bold text-cyan-700 hover:text-cyan-900 hover:underline cursor-pointer"
          >
            Abrir Aba Completa de Busca Ativa
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !descricao.trim()}
              className="px-4 py-2 rounded-xl bg-[#1d2b4f] hover:bg-blue-900 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              {salvando ? 'Gravando...' : 'Salvar Registro'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
