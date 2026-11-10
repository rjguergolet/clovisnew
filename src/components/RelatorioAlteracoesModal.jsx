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
      return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-black uppercase"><i className="fa-solid fa-plus text-[9px] mr-1"></i>{act}</span>;
    }
    if (act.includes('EXCLUIR') || act.includes('DELETAR') || act.includes('REMOVER') || act.includes('CANCELAR')) {
      return <span className="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded text-[10px] font-black uppercase"><i className="fa-solid fa-trash text-[9px] mr-1"></i>{act}</span>;
    }
    if (act.includes('CONFIRMAR') || act.includes('APROVAR')) {
      return <span className="px-2 py-0.5 bg-teal-100 text-teal-800 border border-teal-300 rounded text-[10px] font-black uppercase"><i className="fa-solid fa-check text-[9px] mr-1"></i>{act}</span>;
    }
    return <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-black uppercase"><i className="fa-solid fa-pen-to-square text-[9px] mr-1"></i>{act}</span>;
  };

  const exportarCSV = () => {
    if (logsFiltrados.length === 0) {
      alert('Nenhum log para exportar.');
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
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header do Modal - Padrão Gestão Blue-950 */}
        <div className="bg-blue-950 text-white p-4 sm:p-5 flex items-center justify-between border-b border-blue-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-400 text-blue-950 flex items-center justify-center font-black text-lg shadow-md">
              <i className="fa-solid fa-shield-halved"></i>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wide flex items-center gap-2">
                <span>Trilha de Auditoria &amp; Relatório de Alterações</span>
                <span className="text-[10px] font-bold bg-cyan-400 text-blue-950 px-2 py-0.5 rounded-full uppercase tracking-normal">
                  Exclusivo Direção
                </span>
              </h2>
              <p className="text-xs text-blue-200 font-medium">
                Histórico em tempo real de operações e alterações realizadas no sistema
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-blue-900 hover:bg-blue-800 text-blue-200 hover:text-white flex items-center justify-center transition cursor-pointer"
            title="Fechar Modal (Esc)"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Barra de Filtros e Ferramentas */}
        <div className="bg-slate-50 p-3 sm:p-4 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-center">
          {/* Filtro Módulo */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
              Módulo
            </label>
            <select
              value={filtroModulo}
              onChange={(e) => setFiltroModulo(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500 shadow-2xs"
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

          {/* Filtro Ação */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
              Tipo de Ação
            </label>
            <select
              value={filtroAcao}
              onChange={(e) => setFiltroAcao(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500 shadow-2xs"
            >
              <option value="Todas">Todas as Ações</option>
              <option value="CRIAR">CRIAR / LANÇAR</option>
              <option value="ATUALIZAR">ATUALIZAR / EDITAR</option>
              <option value="EXCLUIR">EXCLUIR / CANCELAR</option>
            </select>
          </div>

          {/* Pesquisa por texto */}
          <div>
            <label className="block text-[10px] font-extrabold text-slate-600 uppercase mb-1">
              Buscar Usuário / Descrição
            </label>
            <div className="relative">
              <input
                type="text"
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
                placeholder="Nome, cargo ou detalhes..."
                className="w-full p-2 pl-8 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500 shadow-2xs"
              />
              <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-2.5 text-slate-400 text-xs"></i>
            </div>
          </div>

          {/* Exportar e Resumo */}
          <div className="flex items-end justify-between sm:justify-end gap-2 pt-1 sm:pt-0">
            <span className="text-[11px] font-bold text-slate-600 bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-300">
              {logsFiltrados.length} log(s)
            </span>
            <button
              type="button"
              onClick={exportarCSV}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              title="Exportar logs filtrados em planilha CSV"
            >
              <i className="fa-solid fa-file-excel"></i>
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Tabela de Logs */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          {loading ? (
            <div className="p-12 text-center text-slate-500 space-y-3">
              <i className="fa-solid fa-spinner fa-spin text-3xl text-cyan-600"></i>
              <p className="text-sm font-semibold">Carregando trilha de auditoria...</p>
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="p-12 text-center text-slate-500 space-y-2 bg-slate-50 rounded-xl border border-dashed border-slate-300 m-2">
              <i className="fa-solid fa-clipboard-check text-3xl text-slate-400 mb-1"></i>
              <p className="text-sm font-bold text-slate-700">Nenhum registro de auditoria encontrado</p>
              <p className="text-xs text-slate-500">Tente ajustar os filtros selecionados acima.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <th className="p-3 border-r border-slate-200 w-36 whitespace-nowrap">Data / Hora</th>
                    <th className="p-3 border-r border-slate-200 w-36 whitespace-nowrap">Módulo</th>
                    <th className="p-3 border-r border-slate-200 w-28 text-center whitespace-nowrap">Ação</th>
                    <th className="p-3 border-r border-slate-200">Descrição das Alterações</th>
                    <th className="p-3 w-48 whitespace-nowrap">Usuário Responsável</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {logsFiltrados.map((log) => (
                    <tr key={log.id} className="hover:bg-cyan-50 transition">
                      {/* Data / Hora */}
                      <td className="p-3 font-mono font-bold text-slate-700 border-r border-slate-100 text-[11px] whitespace-nowrap">
                        {formatarData(log)}
                      </td>

                      {/* Módulo */}
                      <td className="p-3 font-bold text-blue-950 border-r border-slate-100 whitespace-nowrap">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-900 border border-blue-200 rounded text-[11px] font-extrabold inline-block">
                          {log.modulo || 'Geral'}
                        </span>
                      </td>

                      {/* Ação */}
                      <td className="p-3 text-center border-r border-slate-100 whitespace-nowrap">
                        {getAcaoBadge(log.acao)}
                      </td>

                      {/* Descrição e Detalhes */}
                      <td className="p-3 text-slate-800 border-r border-slate-100">
                        <div className="font-semibold text-slate-900 leading-snug">
                          {log.descricao}
                        </div>
                        {log.detalhes && (
                          <button
                            type="button"
                            onClick={() => setSelectedLogDetalhes(log)}
                            className="mt-1 text-[10px] text-cyan-700 hover:text-cyan-900 font-bold underline flex items-center gap-1 cursor-pointer"
                          >
                            <i className="fa-solid fa-code text-[9px]"></i> Ver Detalhes Técnicos
                          </button>
                        )}
                      </td>

                      {/* Usuário / Cargo */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-extrabold text-slate-900 text-xs">
                          {log.usuario || log.usuarioNome || 'Usuário'}
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                          <i className="fa-solid fa-user-shield text-[9px] text-cyan-600"></i>
                          <span>{log.cargo || log.usuarioRole || 'DIRETOR'}</span>
                          {log.email && <span className="text-slate-400 font-normal">({log.email})</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer do Modal */}
        <div className="bg-slate-100 p-3 sm:p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 font-medium">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-lock text-cyan-700"></i>
            <span>Trilha de auditoria protegida e sincronizada via Firestore.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
          >
            Fechar Relatório
          </button>
        </div>

      </div>

      {/* Sub-modal para ver Detalhes Técnicos se clicado */}
      {selectedLogDetalhes && (
        <div className="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 text-slate-100 rounded-xl p-5 max-w-xl w-full border border-slate-700 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2">
              <h3 className="text-sm font-bold text-cyan-400 uppercase">
                Detalhes do Registro #{selectedLogDetalhes.id}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLogDetalhes(null)}
                className="text-slate-400 hover:text-white"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="text-xs space-y-1 font-mono bg-slate-950 p-3 rounded-lg overflow-x-auto border border-slate-800 max-h-60 text-emerald-400">
              <p><strong>Módulo:</strong> {selectedLogDetalhes.modulo}</p>
              <p><strong>Ação:</strong> {selectedLogDetalhes.acao}</p>
              <p><strong>Timestamp:</strong> {selectedLogDetalhes.timestamp}</p>
              <p><strong>Usuário:</strong> {selectedLogDetalhes.usuario} ({selectedLogDetalhes.cargo})</p>
              <p><strong>Descrição:</strong> {selectedLogDetalhes.descricao}</p>
              <div className="mt-2 pt-2 border-t border-slate-800">
                <strong>Payload / Detalhes:</strong>
                <pre className="mt-1 whitespace-pre-wrap text-[10px] text-slate-300">
                  {selectedLogDetalhes.detalhes}
                </pre>
              </div>
            </div>
            <div className="text-right pt-1">
              <button
                type="button"
                onClick={() => setSelectedLogDetalhes(null)}
                className="px-3 py-1.5 bg-cyan-600 text-white text-xs font-bold rounded-lg"
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
