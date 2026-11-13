import React, { useState, useEffect } from 'react';
import { db, collection, query, orderBy, limit, onSnapshot } from '../lib/database';

/**
 * Componente Modal do Relatório de Alterações / Trilha de Auditoria (Audit Log)
 * Exclusivo para perfis de Gestão (DIRETOR / VICE_DIRETOR)
 */
export default function RelatorioAlteracoesModal({ isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroModulo, setFiltroModulo] = useState('Todos');
  const [filtroAcao, setFiltroAcao] = useState('Todas');
  const [buscaTexto, setBuscaTexto] = useState('');
  const [selectedLogDetalhes, setSelectedLogDetalhes] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    // Tentar query com orderBy desc
    const qWithOrder = query(
      collection(db, 'audit_logs'),
      orderBy('criadoEm', 'desc'),
      limit(200)
    );

    let unsub = null;

    try {
      unsub = onSnapshot(
        qWithOrder,
        (snapshot) => {
          const list = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setLogs(list);
          setLoading(false);
        },
        (error) => {
          console.warn('[AuditLog Modal] Query com orderBy falhou, tentando query simples sem índice:', error);
          // Fallback para query simples e ordenação em memória
          const qSimple = query(collection(db, 'audit_logs'), limit(200));
          unsub = onSnapshot(qSimple, (snapshot) => {
            const list = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }));
            // Ordenar por criadoEm ou timestamp decrescente
            list.sort((a, b) => {
              const timeA = a.criadoEm || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
              const timeB = b.criadoEm || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
              return timeB - timeA;
            });
            setLogs(list);
            setLoading(false);
          });
        }
      );
    } catch (e) {
      console.error('[AuditLog Modal] Erro ao subscrever audit_logs:', e);
      setLoading(false);
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (unsub) unsub();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Filtragem local
  const logsFiltrados = logs.filter((item) => {
    // Filtro Módulo
    if (filtroModulo !== 'Todos') {
      const modNormal = (item.modulo || '').toLowerCase();
      const filtroNormal = filtroModulo.toLowerCase();
      if (!modNormal.includes(filtroNormal) && !filtroNormal.includes(modNormal)) {
        return false;
      }
    }

    // Filtro Ação
    if (filtroAcao !== 'Todas') {
      const acaoItem = (item.acao || '').toUpperCase();
      const acaoFiltro = filtroAcao.toUpperCase();
      if (!acaoItem.includes(acaoFiltro)) {
        return false;
      }
    }

    // Busca textual
    if (buscaTexto.trim() !== '') {
      const term = buscaTexto.toLowerCase();
      const fullStr = `${item.usuario || item.usuarioNome || ''} ${item.cargo || item.usuarioRole || ''} ${item.descricao || ''} ${item.modulo || ''} ${item.acao || ''} ${item.detalhes || ''}`.toLowerCase();
      if (!fullStr.includes(term)) {
        return false;
      }
    }

    return true;
  });

  const formatarData = (item) => {
    const rawDate = item.dataHoraISO || item.timestamp;
    if (rawDate) {
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          return d.toLocaleString('pt-BR');
        }
      } catch (e) {}
    }
    if (item.criadoEm && typeof item.criadoEm === 'number') {
      return new Date(item.criadoEm).toLocaleString('pt-BR');
    }
    return '---';
  };

  const getAcaoBadge = (acao) => {
    const act = String(acao || '').toUpperCase();
    if (act.includes('CRIAR') || act.includes('INSERIR') || act.includes('LANÇAR') || act.includes('LANCAR')) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50/90 text-emerald-900 border border-emerald-200/60 border-l-4 border-l-emerald-500 rounded-lg text-[11px] font-semibold"><i className="fa-solid fa-plus text-[9px]"></i>{act}</span>;
    }
    if (act.includes('EXCLUIR') || act.includes('DELETAR') || act.includes('REMOVER') || act.includes('CANCELAR')) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500 rounded-lg text-[11px] font-semibold"><i className="fa-solid fa-trash text-[9px]"></i>{act}</span>;
    }
    if (act.includes('CONFIRMAR') || act.includes('APROVAR')) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-50/90 text-indigo-900 border border-indigo-200/60 border-l-4 border-l-indigo-600 rounded-lg text-[11px] font-semibold"><i className="fa-solid fa-check text-[9px]"></i>{act}</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50/90 text-amber-900 border border-amber-200/60 border-l-4 border-l-amber-500 rounded-lg text-[11px] font-semibold"><i className="fa-solid fa-pen-to-square text-[9px]"></i>{act}</span>;
  };

  const exportarCSV = () => {
    if (logsFiltrados.length === 0) {
      if (typeof window.showToast === 'function') {
        window.showToast('Nenhum log para exportar.', 'warning');
      }
      return;
    }

    const headers = ['Data e Hora', 'Módulo', 'Ação', 'Descrição', 'Usuário', 'Cargo', 'E-mail'];
    const rows = logsFiltrados.map(l => [
      `"${formatarData(l)}"`,
      `"${l.modulo || ''}"`,
      `"${l.acao || ''}"`,
      `"${(l.descricao || '').replace(/"/g, '""')}"`,
      `"${l.usuario || ''}"`,
      `"${l.cargo || ''}"`,
      `"${l.email || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `trilha_auditoria_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Handle */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300"></div>
        </div>

        {/* Header do Modal */}
        <div className="bg-white/95 backdrop-blur-md px-5 py-4 flex items-center justify-between border-b border-slate-200/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg shrink-0">
              <i className="fa-solid fa-shield-halved"></i>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  Trilha de Auditoria &amp; Alterações
                </h2>
                <span className="text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60 px-2.5 py-0.5 rounded-full">
                  Exclusivo Direção
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Histórico em tempo real de operações e alterações realizadas no sistema
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer shrink-0"
            title="Fechar Modal (Esc)"
          >
            <i className="fa-solid fa-xmark text-base"></i>
          </button>
        </div>

        {/* Barra de Filtros e Ferramentas */}
        <div className="bg-slate-50/80 p-3.5 sm:p-4 border-b border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end shrink-0">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Módulo
            </label>
            <select
              value={filtroModulo}
              onChange={(e) => setFiltroModulo(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            >
              <option value="Todos">Todos os Módulos</option>
              <option value="Grade Horária">Grade Horária</option>
              <option value="Substituição PEI">Substituição PEI</option>
              <option value="Secretaria">Secretaria</option>
              <option value="Alunos">Alunos &amp; Ocorrências</option>
              <option value="Tasks">Tarefas / PDCA</option>
              <option value="Geral">Geral</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Tipo de Ação
            </label>
            <select
              value={filtroAcao}
              onChange={(e) => setFiltroAcao(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            >
              <option value="Todas">Todas as Ações</option>
              <option value="CRIAR">CRIAR / LANÇAR</option>
              <option value="ATUALIZAR">ATUALIZAR / EDITAR</option>
              <option value="EXCLUIR">EXCLUIR / CANCELAR</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Buscar Usuário / Descrição
            </label>
            <div className="relative">
              <input
                type="text"
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
                placeholder="Nome, cargo ou detalhes..."
                className="w-full p-2 pl-8 bg-white border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
              <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-2.5 text-slate-400 text-xs"></i>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2">
            <span className="text-xs font-medium text-slate-600 bg-white px-3 py-2 rounded-xl border border-slate-200/80 tabular-nums">
              {logsFiltrados.length} log(s)
            </span>
            <button
              type="button"
              onClick={exportarCSV}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              title="Exportar logs filtrados em planilha CSV"
            >
              <i className="fa-solid fa-file-csv text-emerald-400"></i>
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Lista / Tabela de Logs */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-[#F8FAFC]">
          {loading ? (
            <div className="p-12 text-center text-slate-500 space-y-3">
              <i className="fa-solid fa-spinner fa-spin text-2xl text-indigo-600"></i>
              <p className="text-sm font-medium">Carregando trilha de auditoria...</p>
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="p-12 text-center text-slate-500 space-y-2 bg-white rounded-2xl border border-dashed border-slate-300">
              <i className="fa-solid fa-clipboard-check text-3xl text-slate-300 mb-1"></i>
              <p className="text-sm font-semibold text-slate-700">Nenhum registro de auditoria encontrado</p>
              <p className="text-xs text-slate-500">Tente ajustar os filtros selecionados acima.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-100">
                {logsFiltrados.map((log) => (
                  <div key={log.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-0.5 bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600 rounded-lg text-xs font-medium">
                        {log.modulo || 'Geral'}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{formatarData(log)}</span>
                    </div>
                    <div>{getAcaoBadge(log.acao)}</div>
                    <p className="text-xs font-medium text-slate-800 leading-snug">{log.descricao}</p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span className="font-semibold text-slate-700">{log.usuario || log.usuarioNome || 'Usuário'}</span>
                      {log.detalhes && (
                        <button
                          type="button"
                          onClick={() => setSelectedLogDetalhes(log)}
                          className="text-indigo-600 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <i className="fa-solid fa-code text-[10px]"></i> Detalhes
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/90 text-slate-500 font-semibold text-xs border-b border-slate-200/80">
                      <th className="p-3.5 w-40 whitespace-nowrap">Data / Hora</th>
                      <th className="p-3.5 w-40 whitespace-nowrap">Módulo</th>
                      <th className="p-3.5 w-32 text-center whitespace-nowrap">Ação</th>
                      <th className="p-3.5">Descrição das Alterações</th>
                      <th className="p-3.5 w-52 whitespace-nowrap">Usuário Responsável</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {logsFiltrados.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition">
                        <td className="p-3.5 font-mono font-medium text-slate-700 text-[11px] whitespace-nowrap tabular-nums">
                          {formatarData(log)}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600 rounded-lg text-xs font-medium inline-block">
                            {log.modulo || 'Geral'}
                          </span>
                        </td>

                        <td className="p-3.5 text-center whitespace-nowrap">
                          {getAcaoBadge(log.acao)}
                        </td>

                        <td className="p-3.5 text-slate-800">
                          <div className="font-medium text-slate-900 leading-snug">
                            {log.descricao}
                          </div>
                          {log.detalhes && (
                            <button
                              type="button"
                              onClick={() => setSelectedLogDetalhes(log)}
                              className="mt-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <i className="fa-solid fa-code text-[10px]"></i> Ver Detalhes Técnicos
                            </button>
                          )}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <div className="font-semibold text-slate-900 text-xs">
                            {log.usuario || log.usuarioNome || 'Usuário'}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {log.cargo || log.usuarioRole || 'DIRETOR'}
                            </span>
                            {log.email && <span className="text-slate-400 truncate max-w-[120px]">{log.email}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer do Modal */}
        <div className="bg-white p-4 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-lock text-indigo-600"></i>
            <span>Trilha de auditoria protegida e sincronizada em tempo real.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition cursor-pointer"
          >
            Fechar Relatório
          </button>
        </div>
      </div>

      {/* Sub-modal Bottom-Sheet para Detalhes Técnicos */}
      {selectedLogDetalhes && (
        <div
          className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelectedLogDetalhes(null)}
        >
          <div
            className="bg-slate-900 text-slate-100 rounded-t-3xl sm:rounded-3xl p-5 max-w-xl w-full border border-slate-700/80 space-y-3 shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 pb-3 shrink-0">
              <h3 className="text-sm font-bold text-indigo-300 tracking-tight">
                Detalhes do Registro #{selectedLogDetalhes.id}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLogDetalhes(null)}
                className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="text-xs space-y-1.5 font-mono bg-slate-950 p-3.5 rounded-2xl overflow-auto border border-slate-800 flex-1 text-emerald-400">
              <p><strong>Módulo:</strong> {selectedLogDetalhes.modulo}</p>
              <p><strong>Ação:</strong> {selectedLogDetalhes.acao}</p>
              <p><strong>Timestamp:</strong> {selectedLogDetalhes.timestamp}</p>
              <p><strong>Usuário:</strong> {selectedLogDetalhes.usuario} ({selectedLogDetalhes.cargo})</p>
              <p><strong>Descrição:</strong> {selectedLogDetalhes.descricao}</p>
              <div className="mt-2 pt-2 border-t border-slate-800">
                <strong>Payload / Detalhes:</strong>
                <pre className="mt-1 whitespace-pre-wrap text-[11px] text-slate-300">
                  {typeof selectedLogDetalhes.detalhes === 'object'
                    ? JSON.stringify(selectedLogDetalhes.detalhes, null, 2)
                    : selectedLogDetalhes.detalhes}
                </pre>
              </div>
            </div>
            <div className="text-right pt-1 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLogDetalhes(null)}
                className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
