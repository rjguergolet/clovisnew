import React, { useEffect, useRef, useState, useCallback } from 'react';
import DashboardNotas from './DashboardNotas';
import DashProjetosPEI from './DashProjetosPEI';

export type SecaoDashboardId = 'todos' | 'geral' | 'atrasos' | 'notas' | 'projetos';

interface PainelDashboardsUnificadoProps {
  activeTab: string;
  isAuthorizedPEI: boolean;
}

const TAB_TO_SECTION: Record<string, SecaoDashboardId> = {
  dashboard: 'todos',
  'dashboard-atrasos': 'atrasos',
  'dashboard-notas': 'notas',
  'dash-projetos-pei': 'projetos'
};

export default function PainelDashboardsUnificado({
  activeTab,
  isAuthorizedPEI
}: PainelDashboardsUnificadoProps) {
  const [visao, setVisao] = useState<SecaoDashboardId>('todos');
  const [atualizando, setAtualizando] = useState(false);

  const geralSlotRef = useRef<HTMLDivElement | null>(null);
  const atrasosSlotRef = useRef<HTMLDivElement | null>(null);

  const secGeralRef = useRef<HTMLElement | null>(null);
  const secAtrasosRef = useRef<HTMLElement | null>(null);
  const secNotasRef = useRef<HTMLElement | null>(null);
  const secProjetosRef = useRef<HTMLElement | null>(null);

  const dispararAtualizacaoGraficos = useCallback(() => {
    requestAnimationFrame(() => {
      try {
        if (typeof (window as any).atualizarDashboardGraficos === 'function') {
          (window as any).atualizarDashboardGraficos();
        }
        if (typeof (window as any).atualizarDashboardAtrasos === 'function') {
          (window as any).atualizarDashboardAtrasos();
        }
        if (typeof (window as any).carregarEventosGeral === 'function') {
          (window as any).carregarEventosGeral();
        }
        if (typeof (window as any).carregarModelos === 'function') {
          (window as any).carregarModelos();
        }
      } catch (err) {
        console.warn('[PainelDashboardsUnificado] Erro ao atualizar gráficos:', err);
      }
    });
  }, []);

  // Monta os painéis legados (#content-dashboard e #content-dashboard-atrasos)
  // dentro de slots dedicados fora da reconciliação de filhos do React
  useEffect(() => {
    const dashGeral = document.getElementById('content-dashboard');
    const dashAtrasos = document.getElementById('content-dashboard-atrasos');
    const dock = document.getElementById('legacy-dashboards-dock');

    if (dashGeral && geralSlotRef.current) {
      dashGeral.classList.remove('hidden', 'tab-content');
      geralSlotRef.current.appendChild(dashGeral);
    }

    if (dashAtrasos && atrasosSlotRef.current) {
      dashAtrasos.classList.remove('hidden', 'tab-content');
      atrasosSlotRef.current.appendChild(dashAtrasos);
    }

    dispararAtualizacaoGraficos();

    return () => {
      if (dock) {
        if (dashGeral) {
          dashGeral.classList.add('hidden');
          dock.appendChild(dashGeral);
        }
        if (dashAtrasos) {
          dashAtrasos.classList.add('hidden');
          dock.appendChild(dashAtrasos);
        }
      }
    };
  }, [dispararAtualizacaoGraficos]);

  // Sempre que trocar o modo de visão (ex.: isolar ou voltar para Todos), recalcular gráficos visíveis
  useEffect(() => {
    if (visao === 'todos' || visao === 'geral' || visao === 'atrasos') {
      const timer = setTimeout(() => {
        dispararAtualizacaoGraficos();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [visao, dispararAtualizacaoGraficos]);

  const rolarParaSecao = useCallback(
    (secao: Exclude<SecaoDashboardId, 'todos'>) => {
      const targetMap: Record<Exclude<SecaoDashboardId, 'todos'>, HTMLElement | null> = {
        geral: secGeralRef.current,
        atrasos: secAtrasosRef.current,
        notas: secNotasRef.current,
        projetos: secProjetosRef.current
      };
      const targetEl = targetMap[secao];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    []
  );

  // Quando algum atalho externo chama switchTab('dashboard-atrasos' | 'dashboard-notas' | 'dash-projetos-pei'),
  // mantém tudo em uma página só e rola suavemente até a seção solicitada
  useEffect(() => {
    const targetSec = TAB_TO_SECTION[activeTab];
    if (!targetSec || targetSec === 'todos') return;

    if (targetSec === 'projetos' && !isAuthorizedPEI) return;

    setVisao('todos');
    const timer = setTimeout(() => {
      rolarParaSecao(targetSec);
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab, isAuthorizedPEI, rolarParaSecao]);

  const handleAtualizarTodos = async () => {
    setAtualizando(true);
    try {
      if (typeof (window as any).carregarDadosReais === 'function') {
        await (window as any).carregarDadosReais();
      }
      if (typeof (window as any).carregarHistoricoOcorrenciasGeral === 'function') {
        await (window as any).carregarHistoricoOcorrenciasGeral();
      }
      if (typeof (window as any).carregarProjetosPEI === 'function') {
        await (window as any).carregarProjetosPEI(true, true);
      }
      dispararAtualizacaoGraficos();
      window.dispatchEvent(new CustomEvent('studentsdataupdated'));
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Todos os dashboards foram sincronizados com a base atualizada.', 'success');
      }
    } catch (err) {
      console.warn('[PainelDashboardsUnificado] Aviso ao atualizar dados:', err);
    } finally {
      setAtualizando(false);
    }
  };

  const secoesDisponiveis: { id: SecaoDashboardId; label: string; curto: string }[] = [
    { id: 'todos', label: 'Todos na Página', curto: 'Todos' },
    { id: 'geral', label: '01. Geral & Métricas PEI', curto: '01. Geral PEI' },
    { id: 'atrasos', label: '02. Atrasos & Faltas', curto: '02. Atrasos' },
    { id: 'notas', label: '03. Rendimento & Notas', curto: '03. Notas' },
    ...(isAuthorizedPEI ? [{ id: 'projetos' as SecaoDashboardId, label: '04. Projetos PEI & Tutores', curto: '04. Projetos PEI' }] : [])
  ];

  const totalPaineisAtivos = isAuthorizedPEI ? 4 : 3;

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Cabeçalho Executivo Unificado (Single-Elevation) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-2 flex-wrap">
            <span>Gestão Pedagógica &amp; BI</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{totalPaineisAtivos} painéis integrados</span>
            <span aria-hidden="true">·</span>
            <span>EE Prof. Clóvis de Lucca</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight mt-0.5">
            Central Unificada de Dashboards
          </h2>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleAtualizarTodos}
            disabled={atualizando}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <i className={`fa-solid fa-arrows-rotate ${atualizando ? 'animate-spin' : ''}`}></i>
            <span>{atualizando ? 'Sincronizando...' : 'Atualizar Todos'}</span>
          </button>
        </div>
      </div>

      {/* Barra Segmentada de Visão + Atalhos de Rolagem Rápida (Sticky apenas em desktop) */}
      <div className="md:sticky md:top-2 md:z-20 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {secoesDisponiveis.map((sec) => {
            const ativo = visao === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setVisao(sec.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  ativo
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sec.label}
              </button>
            );
          })}
        </div>

        {visao === 'todos' && (
          <div className="flex items-center gap-2 text-xs text-slate-500 overflow-x-auto px-1">
            <span className="font-semibold text-slate-400 whitespace-nowrap shrink-0">Ir para:</span>
            <button
              type="button"
              onClick={() => rolarParaSecao('geral')}
              className="hover:text-blue-900 hover:underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              01. Geral
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => rolarParaSecao('atrasos')}
              className="hover:text-blue-900 hover:underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              02. Atrasos
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => rolarParaSecao('notas')}
              className="hover:text-blue-900 hover:underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              03. Notas
            </button>
            {isAuthorizedPEI && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => rolarParaSecao('projetos')}
                  className="hover:text-blue-900 hover:underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  04. Projetos PEI
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* SEÇÃO 01: DASHBOARD GERAL & MÉTRICAS PEI                           */}
      {/* ================================================================== */}
      <section
        ref={secGeralRef}
        id="sec-dash-geral"
        className={visao === 'todos' || visao === 'geral' ? 'scroll-mt-20 space-y-3' : 'hidden'}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h3 className="text-base font-bold text-slate-900">01. Visão Geral &amp; Métricas PEI</h3>
          <span className="text-xs text-slate-500">Frequência global · Agenda PEI · Busca Ativa · Ocorrências</span>
        </div>
        <div ref={geralSlotRef} className="w-full" />
      </section>

      {/* ================================================================== */}
      {/* SEÇÃO 02: DASHBOARD DE ATRASOS, FALTAS & ASSIDUIDADE               */}
      {/* ================================================================== */}
      <section
        ref={secAtrasosRef}
        id="sec-dash-atrasos"
        className={visao === 'todos' || visao === 'atrasos' ? 'scroll-mt-20 space-y-3 pt-2' : 'hidden'}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h3 className="text-base font-bold text-slate-900">02. Atrasos, Faltas &amp; Assiduidade</h3>
          <span className="text-xs text-slate-500">Ranking clicável · Faixas de presença · Exportação CSV</span>
        </div>
        <div ref={atrasosSlotRef} className="w-full" />
      </section>

      {/* ================================================================== */}
      {/* SEÇÃO 03: DASHBOARD DE RENDIMENTO ESCOLAR & NOTAS                  */}
      {/* ================================================================== */}
      <section
        ref={secNotasRef}
        id="sec-dash-notas"
        className={visao === 'todos' || visao === 'notas' ? 'scroll-mt-20 space-y-3 pt-2' : 'hidden'}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h3 className="text-base font-bold text-slate-900">03. Rendimento Escolar &amp; Notas</h3>
          <span className="text-xs text-slate-500">Bimestres · Médias · Disciplinas abaixo do básico</span>
        </div>
        <DashboardNotas />
      </section>

      {/* ================================================================== */}
      {/* SEÇÃO 04: DASH PROJETOS PEI & PAINEL DE TUTORES                    */}
      {/* ================================================================== */}
      {isAuthorizedPEI && (
        <section
          ref={secProjetosRef}
          id="sec-dash-projetos"
          className={visao === 'todos' || visao === 'projetos' ? 'scroll-mt-20 space-y-3 pt-2' : 'hidden'}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-base font-bold text-slate-900">04. Projetos PEI &amp; Painel Analítico de Tutores</h3>
            <span className="text-xs text-slate-500">Tutoria · Clubes Juvenis · Eletivas · PJ · Projeto de Vida</span>
          </div>
          <DashProjetosPEI />
        </section>
      )}
    </div>
  );
}
