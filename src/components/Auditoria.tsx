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
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Nenhum registro de auditoria para exportar.', 'warning');
      }
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 pb-12">
      <div className="w-full max-w-7xl mx-auto p-3 sm:p-6 space-y-5">
        {/* CABEÇALHO GLASSMORPHIC DO MÓDULO */}
        <header className="bg-white/90 backdrop-blur-md md:sticky md:top-2 z-20 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xl shrink-0 border border-indigo-200/50">
                <i className="fa-solid fa-shield-halved"></i>
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900">
                    Auditoria do Sistema
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    Direção &amp; Vice-Direção
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
                  Trilha de transparência e conformidade: acompanhe as últimas 25 adições, edições e exclusões realizadas no sistema.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
              <button
                type="button"
                onClick={handleRecarregar}
                disabled={isRefreshing}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold transition-all border border-slate-200/80 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                title="Sincronizar e recarregar dados do banco"
              >
                <i className={`fa-solid fa-rotate text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`}></i>
                <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
              </button>

              <button
                type="button"
                onClick={exportarCSV}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                title="Exportar dados para planilha CSV"
              >
                <i className="fa-solid fa-file-csv text-emerald-400"></i>
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>
        </header>

        {/* BENTO GRID KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Total Analisado</p>
              <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums mt-0.5">{contadores.total}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
              <i className="fa-solid fa-database"></i>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Adições</p>
              <p className="text-2xl font-bold tracking-tight text-emerald-700 tabular-nums mt-0.5">{contadores.adicoes}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-base shrink-0">
              <i className="fa-solid fa-plus"></i>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Edições</p>
              <p className="text-2xl font-bold tracking-tight text-amber-700 tabular-nums mt-0.5">{contadores.edicoes}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-base shrink-0">
              <i className="fa-solid fa-pen-to-square"></i>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Exclusões</p>
              <p className="text-2xl font-bold tracking-tight text-rose-700 tabular-nums mt-0.5">{contadores.exclusoes}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-base shrink-0">
              <i className="fa-solid fa-trash"></i>
            </div>
          </div>
        </section>

        {/* COMMAND BAR DE FILTROS E BUSCA */}
        <section className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] border border-slate-200/80 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            {/* Busca textual */}
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <i className="fa-solid fa-magnifying-glass text-xs"></i>
              </div>
              <input
                type="text"
                value={buscaTexto}
                onChange={(e) => {
                  setBuscaTexto(e.target.value);
                  setVisibleCount(25);
                }}
                placeholder="Pesquisar por usuário, descrição, RA ou detalhe..."
                className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm font-medium text-slate-800 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:bg-white transition-all"
              />
              {buscaTexto && (
                <button
                  type="button"
                  onClick={() => {
                    setBuscaTexto('');
                    setVisibleCount(25);
                  }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <i className="fa-solid fa-xmark text-xs"></i>
                </button>
              )}
            </div>

            {/* Filter Pills deslizáveis de Ação */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0 shrink-0">
              {[
                { id: 'TODOS', label: 'Todas', activeClass: 'bg-slate-900 text-white border-slate-900' },
                { id: 'ADICAO', label: 'Adições', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
                { id: 'EDICAO', label: 'Edições', activeClass: 'bg-amber-600 text-white border-amber-600' },
                { id: 'EXCLUSAO', label: 'Exclusões', activeClass: 'bg-rose-600 text-white border-rose-600' }
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => {
                    setFiltroTipo(pill.id as any);
                    setVisibleCount(25);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap cursor-pointer ${
                    filtroTipo === pill.id
                      ? pill.activeClass
                      : 'bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-slate-100'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Filtro Módulo */}
            <div className="lg:w-56 shrink-0">
              <select
                value={filtroModulo}
                onChange={(e) => {
                  setFiltroModulo(e.target.value);
                  setVisibleCount(25);
                }}
                className="w-full py-2 px-3 text-xs font-medium text-slate-700 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:bg-white transition-all cursor-pointer"
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
          <div className="flex items-center justify-between text-xs text-slate-500 px-1 pt-1 border-t border-slate-100">
            <div>
              Exibindo as <strong className="font-semibold text-slate-700 tabular-nums">{logsExibidos.length}</strong> alterações mais recentes de{' '}
              <strong className="font-semibold text-slate-700 tabular-nums">{logsFiltrados.length}</strong> encontradas.
            </div>
            {visibleCount > 25 && (
              <button
                type="button"
                onClick={() => setVisibleCount(25)}
                className="text-indigo-600 hover:text-indigo-700 font-semibold text-xs cursor-pointer"
              >
                Voltar para as primeiras 25
              </button>
            )}
          </div>
        </section>

        {/* LISTA / TABELA PRINCIPAL DE AUDITORIA */}
        <section className="bg-white rounded-2xl sm:rounded-3xl shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] border border-slate-200/80 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center space-y-3">
              <div className="inline-block animate-spin text-2xl text-indigo-600">
                <i className="fa-solid fa-spinner"></i>
              </div>
              <p className="text-sm font-medium text-slate-500">Carregando trilha de auditoria do sistema...</p>
            </div>
          ) : logsFiltrados.length === 0 ? (
            <div className="p-8">
              <MascoteSaraState
                titulo="Nenhuma alteração encontrada com os filtros atuais!"
                mensagem="Não foram localizados registros de auditoria para os critérios selecionados. Tente limpar a busca ou selecionar outro módulo."
              />
            </div>
          ) : (
            <>
              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-100">
                {logsExibidos.map((item, idx) => {
                  const relTime = formatarTempoRelativo(item);
                  const usuarioNome = item.usuarioNome || item.usuario || 'Usuário';
                  const cargo = item.usuarioRole || item.cargo || 'Gestão';
                  const tipo = classificarAcao(item.acao);

                  const cardBorderClass =
                    tipo === 'ADICAO'
                      ? 'border-l-4 border-l-emerald-500'
                      : tipo === 'EXCLUSAO'
                      ? 'border-l-4 border-l-rose-500'
                      : 'border-l-4 border-l-amber-500';

                  return (
                    <div
                      key={item.id || idx}
                      onClick={() => setSelectedLog(item)}
                      className={`p-4 space-y-2.5 hover:bg-slate-50/80 transition-colors cursor-pointer ${cardBorderClass}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-indigo-50/80 text-indigo-800 border border-indigo-200/50">
                          {item.modulo || 'Geral'}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                          {formatarDataHora(item)} {relTime ? `• ${relTime}` : ''}
                        </span>
                      </div>

                      <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-2">
                        {item.descricao || 'Registro efetuado no sistema.'}
                      </p>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-slate-700 truncate">{usuarioNome}</span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium text-[10px] shrink-0">
                            {cargo}
                          </span>
                        </div>
                        <span className="text-xs text-indigo-600 font-medium shrink-0 flex items-center gap-1">
                          <span>Detalhes</span>
                          <i className="fa-solid fa-chevron-right text-[10px]"></i>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 text-xs font-semibold text-slate-500 border-b border-slate-200/80">
                      <th className="py-3.5 px-4 w-44">Data e Hora</th>
                      <th className="py-3.5 px-3 w-32 text-center">Tipo</th>
                      <th className="py-3.5 px-3 w-40">Módulo</th>
                      <th className="py-3.5 px-4">Descrição da Alteração</th>
                      <th className="py-3.5 px-4 w-60">Responsável</th>
                      <th className="py-3.5 px-3 w-20 text-center">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {logsExibidos.map((item, idx) => {
                      const relTime = formatarTempoRelativo(item);
                      const usuarioNome = item.usuarioNome || item.usuario || 'Usuário';
                      const cargo = item.usuarioRole || item.cargo || 'Gestão';
                      const email = item.usuarioEmail || item.email || '';
                      const tipo = classificarAcao(item.acao);

                      const badgeSoft =
                        tipo === 'ADICAO'
                          ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
                          : tipo === 'EXCLUSAO'
                          ? 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500'
                          : 'bg-amber-50/90 text-amber-900 border-amber-200/60 border-l-amber-500';

                      const badgeLabel = tipo === 'ADICAO' ? 'Adição' : tipo === 'EXCLUSAO' ? 'Exclusão' : 'Edição';
                      const badgeIcon = tipo === 'ADICAO' ? 'fa-plus' : tipo === 'EXCLUSAO' ? 'fa-trash' : 'fa-pen-to-square';

                      return (
                        <tr
                          key={item.id || idx}
                          className="hover:bg-slate-50/80 transition-colors group"
                        >
                          <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap tabular-nums">
                            <div className="font-semibold text-slate-900">{formatarDataHora(item)}</div>
                            {relTime && <span className="text-[11px] text-slate-400">{relTime}</span>}
                          </td>

                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-l-4 ${badgeSoft}`}>
                              <i className={`fa-solid ${badgeIcon} text-[10px]`}></i>
                              <span>{badgeLabel}</span>
                            </span>
                          </td>

                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/80 text-slate-800 border border-indigo-200/50 border-l-4 border-l-indigo-600">
                              {item.modulo || 'Geral'}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-slate-700 font-medium leading-relaxed">
                            <div className="line-clamp-2">{item.descricao || 'Registro efetuado no sistema.'}</div>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900 truncate max-w-[220px]" title={usuarioNome}>
                              {usuarioNome}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate mt-0.5">
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                                {cargo}
                              </span>
                              {email && <span className="truncate" title={email}>{email}</span>}
                            </div>
                          </td>

                          <td className="py-3.5 px-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedLog(item)}
                              className="w-8 h-8 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer inline-flex items-center justify-center"
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
            </>
          )}

          {/* RODAPÉ COM BOTÃO 'VER MAIS' */}
          {!loading && logsFiltrados.length > 0 && (
            <div className="p-4 bg-slate-50/70 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                Mostrando <strong className="text-slate-800 font-semibold tabular-nums">{logsExibidos.length}</strong> de{' '}
                <strong className="text-slate-800 font-semibold tabular-nums">{logsFiltrados.length}</strong> registros
              </div>

              {visibleCount < logsFiltrados.length ? (
                <button
                  type="button"
                  id="btn-auditoria-ver-mais"
                  onClick={() => setVisibleCount((prev) => prev + 25)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-down text-indigo-300"></i>
                  <span>Ver mais (+25 registros)</span>
                </button>
              ) : (
                <div className="text-xs font-medium text-emerald-800 bg-emerald-50/90 px-3 py-1.5 rounded-xl border border-emerald-200/60 border-l-4 border-l-emerald-500 flex items-center gap-1.5">
                  <i className="fa-solid fa-check text-emerald-600"></i>
                  <span>Todos os registros disponíveis estão visíveis</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* MODAL BOTTOM-SHEET DE DETALHES COMPLETOS DO LOG */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-y-auto"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-300"></div>
            </div>

            {/* Cabeçalho do modal */}
            <div className="px-5 py-4 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg shrink-0">
                  <i className="fa-solid fa-clipboard-check"></i>
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-tight text-slate-900">
                    Detalhes da Alteração
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">ID: {selectedLog.id || 'N/A'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            {/* Conteúdo do modal */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-800 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/80">
                <div>
                  <span className="block text-[11px] font-medium text-slate-500">Data e Hora</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatarDataHora(selectedLog)}</span>
                </div>
                <div>
                  <span className="block text-[11px] font-medium text-slate-500">Tipo de Ação</span>
                  <div className="mt-1">{renderBadgeAcao(selectedLog.acao)}</div>
                </div>
                <div>
                  <span className="block text-[11px] font-medium text-slate-500">Módulo</span>
                  <span className="font-semibold text-indigo-700">{selectedLog.modulo || 'Geral'}</span>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Responsável pela Modificação
                </span>
                <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/80 space-y-1">
                  <div className="font-semibold text-slate-900 text-sm">
                    {selectedLog.usuarioNome || selectedLog.usuario || 'Usuário'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-slate-600">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-medium text-[11px] border border-indigo-200/60">
                      {selectedLog.usuarioRole || selectedLog.cargo || 'Gestão'}
                    </span>
                    <span>{selectedLog.usuarioEmail || selectedLog.email || 'E-mail não informado'}</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-1.5">Descrição</span>
                <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/80 font-medium text-slate-800 leading-relaxed">
                  {selectedLog.descricao || 'Sem descrição.'}
                </div>
              </div>

              {selectedLog.detalhes && (
                <div>
                  <span className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Carga Útil / Dados Técnicos (JSON)
                  </span>
                  <pre className="bg-slate-900 text-emerald-300 p-3.5 rounded-2xl text-[11px] font-mono overflow-x-auto max-h-48 border border-slate-800">
                    {typeof selectedLog.detalhes === 'object'
                      ? JSON.stringify(selectedLog.detalhes, null, 2)
                      : String(selectedLog.detalhes)}
                  </pre>
                </div>
              )}
            </div>

            {/* Rodapé do modal */}
            <div className="p-4 bg-slate-50/80 border-t border-slate-200/80 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
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
