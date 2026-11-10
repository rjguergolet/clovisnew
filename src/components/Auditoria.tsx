import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, query, orderBy, limit, onSnapshot, getDocs } from '../lib/database';
import MascoteSaraState from './MascoteSaraState';

export interface AuditLogItem {
  id: string;
  timestamp?: any;
  criadoEm?: number | string;
  atualizadoEm?: string;
  dataHoraISO?: string;
  modulo?: string;
  acao?: string;
  descricao?: string;
  usuario?: string;
  usuarioNome?: string;
  usuarioEmail?: string;
  usuarioRole?: string;
  cargo?: string;
  usuarioCompleto?: string;
  usuarioFormatoCompleto?: string;
  detalhes?: any;
  [key: string]: any;
}

export default function Auditoria() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(25);
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'ADICAO' | 'EDICAO' | 'EXCLUSAO'>('TODOS');
  const [filtroModulo, setFiltroModulo] = useState<string>('TODOS');
  const [buscaTexto, setBuscaTexto] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Carregar dados de audit_logs em tempo real
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const carregarLogs = async () => {
      try {
        const q = query(collection(db, 'audit_logs'), orderBy('criadoEm', 'desc'), limit(500));
        const unsub = onSnapshot(
          q,
          (snapshot) => {
            if (!isMounted) return;
            const items: AuditLogItem[] = snapshot.docs.map((docSnap: any) => ({
              id: docSnap.id,
              ...docSnap.data()
            }));

            // Ordenação defensiva por timestamp decrescente (mais recente primeiro)
            items.sort((a, b) => {
              const timeA = obterTimestampMs(a);
              const timeB = obterTimestampMs(b);
              return timeB - timeA;
            });

            setLogs(items);
            setLoading(false);
            setIsRefreshing(false);
          },
          async (error) => {
            console.warn('[Auditoria] Falha no onSnapshot com orderBy, utilizando fallback getDocs:', error);
            try {
              const fallbackSnap = await getDocs(collection(db, 'audit_logs'));
              if (!isMounted) return;
              const items: AuditLogItem[] = [];
              fallbackSnap.forEach((docSnap) => {
                items.push({ id: docSnap.id, ...docSnap.data() });
              });

              items.sort((a, b) => obterTimestampMs(b) - obterTimestampMs(a));
              setLogs(items);
            } catch (errFallback) {
              console.error('[Auditoria] Erro no fallback de audit_logs:', errFallback);
            } finally {
              if (isMounted) {
                setLoading(false);
                setIsRefreshing(false);
              }
            }
          }
        );

        return () => {
          if (typeof unsub === 'function') unsub();
        };
      } catch (err) {
        console.error('[Auditoria] Erro ao subscrever audit_logs:', err);
        if (isMounted) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    const cleanupPromise = carregarLogs();

    return () => {
      isMounted = false;
      cleanupPromise.then((unsub) => {
        if (typeof unsub === 'function') unsub();
      });
    };
  }, []);

  // Extrair timestamp numérico em milissegundos
  const obterTimestampMs = (item: AuditLogItem): number => {
    if (typeof item.criadoEm === 'number') return item.criadoEm;
    if (item.criadoEm && !isNaN(new Date(item.criadoEm).getTime())) {
      return new Date(item.criadoEm).getTime();
    }
    if (item.timestamp) {
      if (typeof item.timestamp === 'string') {
        const parsed = new Date(item.timestamp).getTime();
        if (!isNaN(parsed)) return parsed;
      }
      if (typeof item.timestamp === 'number') return item.timestamp;
      if (item.timestamp.seconds) return item.timestamp.seconds * 1000;
      if (typeof item.timestamp.toDate === 'function') return item.timestamp.toDate().getTime();
    }
    if (item.dataHoraISO) {
      const parsed = new Date(item.dataHoraISO).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    return 0;
  };

  // Classificar ação em Adição, Edição ou Exclusão
  const classificarAcao = (acao?: string): 'ADICAO' | 'EDICAO' | 'EXCLUSAO' => {
    const act = String(acao || '').toUpperCase().trim();
    if (
      act.includes('CRIAR') ||
      act.includes('INSERIR') ||
      act.includes('NOVO') ||
      act.includes('CADASTRO') ||
      act.includes('LANÇAR') ||
      act.includes('LANCAR') ||
      act.includes('CRIAÇÃO')
    ) {
      return 'ADICAO';
    }
    if (
      act.includes('EXCLUIR') ||
      act.includes('DELETAR') ||
      act.includes('REMOVER') ||
      act.includes('CANCELAR') ||
      act.includes('EXCLUSÃO')
    ) {
      return 'EXCLUSAO';
    }
    return 'EDICAO';
  };

  // Atualizar manualmente os dados
  const handleRecarregar = async () => {
    setIsRefreshing(true);
    try {
      const snap = await getDocs(collection(db, 'audit_logs'));
      const items: AuditLogItem[] = [];
      snap.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      items.sort((a, b) => obterTimestampMs(b) - obterTimestampMs(a));
      setLogs(items);
    } catch (e) {
      console.error('[Auditoria] Falha ao recarregar:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Lista de módulos disponíveis na base
  const listaModulos = useMemo(() => {
    const mods = new Set<string>();
    logs.forEach((item) => {
      if (item.modulo) {
        mods.add(item.modulo.trim());
      }
    });
    return Array.from(mods).sort();
  }, [logs]);

  // Contadores de métricas
  const contadores = useMemo(() => {
    let adicoes = 0;
    let edicoes = 0;
    let exclusoes = 0;

    logs.forEach((item) => {
      const tipo = classificarAcao(item.acao);
      if (tipo === 'ADICAO') adicoes++;
      else if (tipo === 'EDICAO') edicoes++;
      else if (tipo === 'EXCLUSAO') exclusoes++;
    });

    return {
      total: logs.length,
      adicoes,
      edicoes,
      exclusoes
    };
  }, [logs]);

  // Filtragem dos logs
  const logsFiltrados = useMemo(() => {
    return logs.filter((item) => {
      const tipo = classificarAcao(item.acao);

      // Filtro por tipo de alteração
      if (filtroTipo !== 'TODOS' && tipo !== filtroTipo) {
        return false;
      }

      // Filtro por módulo
      if (filtroModulo !== 'TODOS') {
        const itemMod = (item.modulo || '').toLowerCase();
        const fMod = filtroModulo.toLowerCase();
        if (itemMod !== fMod && !itemMod.includes(fMod)) {
          return false;
        }
      }

      // Busca textual
      if (buscaTexto.trim() !== '') {
        const term = buscaTexto.toLowerCase().trim();
        const strBusca = `
          ${item.descricao || ''}
          ${item.usuarioNome || item.usuario || ''}
          ${item.usuarioEmail || item.email || ''}
          ${item.usuarioRole || item.cargo || ''}
          ${item.modulo || ''}
          ${item.acao || ''}
          ${typeof item.detalhes === 'object' ? JSON.stringify(item.detalhes) : item.detalhes || ''}
        `.toLowerCase();

        if (!strBusca.includes(term)) {
          return false;
        }
      }

      return true;
    });
  }, [logs, filtroTipo, filtroModulo, buscaTexto]);

  // Os itens visíveis cortados pelo visibleCount (inicia em 25)
  const logsExibidos = useMemo(() => {
    return logsFiltrados.slice(0, visibleCount);
  }, [logsFiltrados, visibleCount]);

  // Formatação amigável de data e hora
  const formatarDataHora = (item: AuditLogItem) => {
    const ms = obterTimestampMs(item);
    if (!ms) return 'Data não informada';
    try {
      const d = new Date(ms);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return 'Data inválida';
    }
  };

  // Formatação de tempo relativo
  const formatarTempoRelativo = (item: AuditLogItem) => {
    const ms = obterTimestampMs(item);
    if (!ms) return '';
    const diffMs = Date.now() - ms;
    if (diffMs < 0) return 'Agora';
    const diffSeg = Math.floor(diffMs / 1000);
    if (diffSeg < 60) return `há ${diffSeg}s`;
    const diffMin = Math.floor(diffSeg / 60);
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24) return `há ${diffHoras}h`;
    const diffDias = Math.floor(diffHoras / 24);
    if (diffDias === 1) return 'ontem';
    if (diffDias < 30) return `há ${diffDias} dias`;
    return '';
  };

  // Renderizador da Badge de Ação
  const renderBadgeAcao = (acao?: string) => {
    const tipo = classificarAcao(acao);
    if (tipo === 'ADICAO') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-300">
          <i className="fa-solid fa-plus text-[10px]"></i>
          <span>Adição</span>
        </span>
      );
    }
    if (tipo === 'EXCLUSAO') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wide bg-rose-100 text-rose-800 border border-rose-300">
          <i className="fa-solid fa-trash text-[10px]"></i>
          <span>Exclusão</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-300">
        <i className="fa-solid fa-pen-to-square text-[10px]"></i>
        <span>Edição</span>
      </span>
    );
  };

  // Exportar relatório completo para CSV
  const exportarCSV = () => {
    if (logsFiltrados.length === 0) {
      alert('Nenhum registro de auditoria para exportar.');
      return;
    }

    const colunas = ['Data e Hora', 'Ação', 'Módulo', 'Descrição', 'Usuário Responsável', 'Cargo', 'E-mail', 'ID do Registro'];
    const linhas = logsFiltrados.map((item) => {
      const usuarioStr = item.usuarioNome || item.usuario || 'Usuário';
      const cargoStr = item.usuarioRole || item.cargo || '';
      const emailStr = item.usuarioEmail || item.email || '';
      const descLimpa = (item.descricao || '').replace(/"/g, '""');

      return [
        `"${formatarDataHora(item)}"`,
        `"${classificarAcao(item.acao)}"`,
        `"${item.modulo || 'Geral'}"`,
        `"${descLimpa}"`,
        `"${usuarioStr.replace(/"/g, '""')}"`,
        `"${cargoStr}"`,
        `"${emailStr}"`,
        `"${item.id || ''}"`
      ];
    });

    const csvConteudo = 'data:text/csv;charset=utf-8,\uFEFF' + [colunas.join(';'), ...linhas.map((r) => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvConteudo);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `auditoria_clovis_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="bg-gradient-to-r from-blue-950 via-blue-900 to-indigo-950 rounded-2xl p-6 text-white shadow-xl border border-blue-800/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-400 text-blue-950 flex items-center justify-center text-2xl font-black shadow-lg ring-4 ring-cyan-400/20 shrink-0">
              <i className="fa-solid fa-shield-halved"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Auditoria do Sistema
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-cyan-400/20 text-cyan-300 border border-cyan-400/40">
                  Direção &amp; Vice-Direção
                </span>
              </div>
              <p className="text-xs sm:text-sm text-blue-200 mt-1 font-medium leading-relaxed">
                Trilha de transparência e conformidade: acompanhe as últimas 25 adições, edições e exclusões realizadas no sistema.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRecarregar}
              disabled={isRefreshing}
              className="px-3.5 py-2 rounded-xl bg-blue-800/70 hover:bg-blue-700/80 text-white text-xs font-bold transition-all border border-blue-700/60 shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              title="Sincronizar e recarregar dados do banco"
            >
              <i className={`fa-solid fa-rotate ${isRefreshing ? 'animate-spin' : ''}`}></i>
              <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
            </button>

            <button
              type="button"
              onClick={exportarCSV}
              className="px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-blue-950 text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer"
              title="Exportar dados para planilha CSV"
            >
              <i className="fa-solid fa-file-csv text-sm"></i>
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* CARDS DE MÉTRICAS RÁPIDAS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-blue-800/60">
          <div className="bg-blue-900/50 p-3 rounded-xl border border-blue-800/70 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-300">Total Analisado</p>
              <p className="text-xl font-black text-white mt-0.5">{contadores.total}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-800/80 text-cyan-300 flex items-center justify-center text-sm">
              <i className="fa-solid fa-database"></i>
            </div>
          </div>

          <div className="bg-emerald-950/40 p-3 rounded-xl border border-emerald-800/60 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Adições (+)</p>
              <p className="text-xl font-black text-emerald-200 mt-0.5">{contadores.adicoes}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-900/60 text-emerald-300 flex items-center justify-center text-sm">
              <i className="fa-solid fa-plus"></i>
            </div>
          </div>

          <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-800/60 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Edições (✏️)</p>
              <p className="text-xl font-black text-amber-200 mt-0.5">{contadores.edicoes}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-900/60 text-amber-300 flex items-center justify-center text-sm">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
          </div>

          <div className="bg-rose-950/40 p-3 rounded-xl border border-rose-800/60 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">Exclusões (🗑️)</p>
              <p className="text-xl font-black text-rose-200 mt-0.5">{contadores.exclusoes}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-900/60 text-rose-300 flex items-center justify-center text-sm">
              <i className="fa-solid fa-trash"></i>
            </div>
          </div>
        </div>
      </div>

      {/* BARRA DE FILTROS E BUSCA */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Busca textual */}
          <div className="md:col-span-5 relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <i className="fa-solid fa-magnifying-glass text-xs"></i>
            </div>
            <input
              type="text"
              value={buscaTexto}
              onChange={(e) => {
                setBuscaTexto(e.target.value);
                setVisibleCount(25); // reseta para os primeiros 25 na busca
              }}
              placeholder="Pesquisar por usuário, descrição, RA, detalhe..."
              className="w-full pl-9 pr-8 py-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900 focus:bg-white transition-all"
            />
            {buscaTexto && (
              <button
                type="button"
                onClick={() => {
                  setBuscaTexto('');
                  setVisibleCount(25);
                }}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            )}
          </div>

          {/* Filtro Tipo de Ação */}
          <div className="md:col-span-4 flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setFiltroTipo('TODOS');
                setVisibleCount(25);
              }}
              className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer ${
                filtroTipo === 'TODOS'
                  ? 'bg-blue-950 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => {
                setFiltroTipo('ADICAO');
                setVisibleCount(25);
              }}
              className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer ${
                filtroTipo === 'ADICAO'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              Adições
            </button>
            <button
              type="button"
              onClick={() => {
                setFiltroTipo('EDICAO');
                setVisibleCount(25);
              }}
              className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer ${
                filtroTipo === 'EDICAO'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-amber-800 hover:bg-amber-50'
              }`}
            >
              Edições
            </button>
            <button
              type="button"
              onClick={() => {
                setFiltroTipo('EXCLUSAO');
                setVisibleCount(25);
              }}
              className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center cursor-pointer ${
                filtroTipo === 'EXCLUSAO'
                  ? 'bg-rose-700 text-white shadow-xs'
                  : 'text-rose-800 hover:bg-rose-50'
              }`}
            >
              Exclusões
            </button>
          </div>

          {/* Filtro Módulo */}
          <div className="md:col-span-3">
            <select
              value={filtroModulo}
              onChange={(e) => {
                setFiltroModulo(e.target.value);
                setVisibleCount(25);
              }}
              className="w-full py-2 px-3 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900 focus:bg-white transition-all cursor-pointer"
            >
              <option value="TODOS">Todos os Módulos</option>
              {listaModulos.map((mod) => (
                <option key={mod} value={mod}>
                  {mod}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status de exibição */}
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium px-1 pt-1">
          <div>
            Exibindo as <strong>{logsExibidos.length}</strong> alterações mais recentes de{' '}
            <strong>{logsFiltrados.length}</strong> encontradas.
          </div>
          {visibleCount > 25 && (
            <button
              type="button"
              onClick={() => setVisibleCount(25)}
              className="text-blue-900 hover:underline font-bold text-xs cursor-pointer"
            >
              Voltar para as primeiras 25
            </button>
          )}
        </div>
      </div>

      {/* LISTA / TABELA PRINCIPAL DE AUDITORIA */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center space-y-3">
            <div className="inline-block animate-spin text-3xl text-blue-950">
              <i className="fa-solid fa-spinner"></i>
            </div>
            <p className="text-sm font-bold text-slate-600">Carregando trilha de auditoria do sistema...</p>
          </div>
        ) : logsFiltrados.length === 0 ? (
          <div className="p-8">
            <MascoteSaraState
              titulo="Nenhuma alteração encontrada com os filtros atuais!"
              mensagem="Não foram localizados registros de auditoria para os critérios selecionados. Tente limpar a busca ou selecionar outro módulo."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/90 text-[11px] font-black uppercase text-slate-600 border-b border-slate-200">
                  <th className="py-3 px-4 w-44">Data &amp; Hora</th>
                  <th className="py-3 px-3 w-32 text-center">Tipo de Ação</th>
                  <th className="py-3 px-3 w-36">Módulo</th>
                  <th className="py-3 px-4">Descrição da Alteração</th>
                  <th className="py-3 px-4 w-60">Responsável</th>
                  <th className="py-3 px-3 w-20 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logsExibidos.map((item, idx) => {
                  const relTime = formatarTempoRelativo(item);
                  const usuarioNome = item.usuarioNome || item.usuario || 'Usuário';
                  const cargo = item.usuarioRole || item.cargo || 'GESTÃO';
                  const email = item.usuarioEmail || item.email || '';

                  return (
                    <tr
                      key={item.id || idx}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      {/* Data & Hora */}
                      <td className="py-3.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{formatarDataHora(item)}</div>
                        {relTime && <span className="text-[10px] font-medium text-slate-400">{relTime}</span>}
                      </td>

                      {/* Ação */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        {renderBadgeAcao(item.acao)}
                      </td>

                      {/* Módulo */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-blue-50 text-blue-900 border border-blue-200">
                          {item.modulo || 'Geral'}
                        </span>
                      </td>

                      {/* Descrição */}
                      <td className="py-3.5 px-4 text-slate-800 font-medium leading-relaxed">
                        <div className="line-clamp-2">{item.descricao || 'Registro efetuado no sistema.'}</div>
                      </td>

                      {/* Responsável */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 truncate max-w-[220px]" title={usuarioNome}>
                          {usuarioNome}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold truncate">
                          <span className="px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700 font-bold uppercase text-[9px]">
                            {cargo}
                          </span>
                          {email && <span className="truncate" title={email}>{email}</span>}
                        </div>
                      </td>

                      {/* Botão Ver Detalhes */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(item)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Visualizar detalhes completos deste log"
                        >
                          <i className="fa-solid fa-circle-info text-base"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* RODAPÉ COM BOTÃO 'VER MAIS' */}
        {!loading && logsFiltrados.length > 0 && (
          <div className="p-4 bg-slate-50/80 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-600 font-medium">
              Mostrando <strong className="text-slate-900 font-bold">{logsExibidos.length}</strong> de{' '}
              <strong className="text-slate-900 font-bold">{logsFiltrados.length}</strong> registros
            </div>

            {visibleCount < logsFiltrados.length ? (
              <button
                type="button"
                id="btn-auditoria-ver-mais"
                onClick={() => setVisibleCount((prev) => prev + 25)}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-950 hover:bg-blue-900 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 hover:scale-[1.02] cursor-pointer"
              >
                <i className="fa-solid fa-chevron-down text-cyan-300"></i>
                <span>Ver mais (+25 registros)</span>
              </button>
            ) : (
              <div className="text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1.5">
                <i className="fa-solid fa-check text-emerald-600"></i>
                <span>Todos os registros disponíveis estão visíveis na lista</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL DE DETALHES COMPLETOS DO LOG */}
      {selectedLog && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Cabeçalho do modal */}
            <div className="bg-blue-950 p-4 sm:p-5 text-white flex items-center justify-between border-b border-blue-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-400 text-blue-950 flex items-center justify-center text-lg font-black shrink-0">
                  <i className="fa-solid fa-clipboard-check"></i>
                </div>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base uppercase tracking-tight text-white">
                    Detalhes da Alteração
                  </h3>
                  <p className="text-xs text-cyan-200 font-medium">ID: {selectedLog.id || 'N/A'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-blue-900 transition-colors cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Conteúdo do modal */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="block text-[10px] font-black uppercase text-slate-400">Data e Hora</span>
                  <span className="font-bold text-slate-800">{formatarDataHora(selectedLog)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-black uppercase text-slate-400">Tipo de Ação</span>
                  <div className="mt-0.5">{renderBadgeAcao(selectedLog.acao)}</div>
                </div>
                <div>
                  <span className="block text-[10px] font-black uppercase text-slate-400">Módulo</span>
                  <span className="font-bold text-blue-950">{selectedLog.modulo || 'Geral'}</span>
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                  Responsável pela Modificação
                </span>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900 text-sm">
                    {selectedLog.usuarioNome || selectedLog.usuario || 'Usuário'}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 font-medium">
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-950 font-bold uppercase text-[9px]">
                      {selectedLog.usuarioRole || selectedLog.cargo || 'GESTÃO'}
                    </span>
                    <span>{selectedLog.usuarioEmail || selectedLog.email || 'E-mail não informado'}</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">Descrição</span>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 font-medium text-slate-800 leading-relaxed">
                  {selectedLog.descricao || 'Sem descrição.'}
                </div>
              </div>

              {selectedLog.detalhes && (
                <div>
                  <span className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                    Carga Útil / Dados Técnicos (JSON)
                  </span>
                  <pre className="bg-slate-900 text-emerald-300 p-3.5 rounded-xl text-[11px] font-mono overflow-x-auto max-h-48 border border-slate-800">
                    {typeof selectedLog.detalhes === 'object'
                      ? JSON.stringify(selectedLog.detalhes, null, 2)
                      : String(selectedLog.detalhes)}
                  </pre>
                </div>
              )}
            </div>

            {/* Rodapé do modal */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2 bg-blue-950 hover:bg-blue-900 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
