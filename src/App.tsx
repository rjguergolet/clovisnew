import React, { useState, useEffect } from 'react';
import PaginaInicial from './components/PaginaInicial';
import DashProjetosPEI from './components/DashProjetosPEI';
import GestaoRotinaPDCA from './components/GestaoRotinaPDCA';
import AgendaPEI from './components/AgendaPEI';
import Horarios from './components/Horarios';
import SubstituicaoPEI from './components/SubstituicaoPEI';
import DashboardNotas from './components/DashboardNotas';
import Professores from './components/Professores';
import Auditoria from './components/Auditoria';
import ComparativoFrequencia from './components/ComparativoFrequencia';
import RelatorioAlteracoesModal from './components/RelatorioAlteracoesModal';
import ModalImportarBoletimPDF from './components/ModalImportarBoletimPDF';
import AudioTranscriberModal from './components/AudioTranscriberModal';
import ErrorBoundary from './components/ErrorBoundary';

// Inicializa módulos globais (window.*)
import './modules/smartCache';
import './modules/dashboardAtrasos';
import './modules/fechamentoNotasManager';
import './modules/digitarBoletimModal';
import './modules/ajusteFrequenciaSedModal';
import './modules/backupManager';
import { obterUsuarioAtivoCompleto, normalizarCargo } from './modules/authHelper';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  requires?: 'pei' | 'pdca' | 'professores' | 'auditoria' | 'comparativo';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'inicio', label: 'Início', icon: 'fa-house' },
  { id: 'horarios', label: 'Horários', icon: 'fa-clock' },
  { id: 'professores', label: 'Professores', icon: 'fa-chalkboard-user', requires: 'professores' },
  { id: 'substituicao-pei', label: 'Substituição', icon: 'fa-user-clock' },
  { id: 'agenda', label: 'Agenda PEI', icon: 'fa-calendar-days' },
  { id: 'rotina-pdca', label: 'Rotina PDCA', icon: 'fa-list-check', requires: 'pdca' },
  { id: 'dash-projetos-pei', label: 'Projetos PEI', icon: 'fa-diagram-project', requires: 'pei' },
  { id: 'dashboard-notas', label: 'Notas', icon: 'fa-chart-pie' },
  { id: 'comparativo-frequencia', label: 'SED vs Mapão', icon: 'fa-chart-line', requires: 'comparativo' },
  { id: 'auditoria', label: 'Auditoria', icon: 'fa-shield-halved', requires: 'auditoria' },
];

export default function App() {
  const [currentTab, setCurrentTab] = useState(
    typeof window !== 'undefined' && (window as any).currentActiveTab ? (window as any).currentActiveTab : 'inicio'
  );
  const [userRole, setUserRole] = useState('PROFESSOR');
  const [userName, setUserName] = useState('');
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [alunoBoletimGlobal, setAlunoBoletimGlobal] = useState<any | null>(null);
  const [modalBoletimGlobalAberto, setModalBoletimGlobalAberto] = useState(false);
  const [isAudioTranscriberOpen, setIsAudioTranscriberOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const syncState = () => {
      if (typeof window !== 'undefined' && (window as any).currentActiveTab) {
        setCurrentTab((window as any).currentActiveTab);
      }
      const role = typeof window !== 'undefined' && typeof (window as any).obterRoleAtual === 'function'
        ? (window as any).obterRoleAtual()
        : ((window as any)?.currentUserRole || 'PROFESSOR');
      setUserRole(role || 'PROFESSOR');

      const user = obterUsuarioAtivoCompleto();
      if (user?.nome) {
        setUserName(String(user.nome).trim());
      } else if (user?.email) {
        setUserName(String(user.email).split('@')[0]);
      }
    };

    syncState();

    (window as any).abrirRelatorioAuditoria = () => {
      setIsAuditModalOpen(true);
    };

    (window as any).abrirTranscritorAudio = () => {
      setIsAudioTranscriberOpen(true);
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    window.addEventListener('taborrolechange', syncState);
    window.addEventListener('popstate', syncState);
    window.addEventListener('storage', syncState);

    (window as any).abrirModalImportarBoletimPDFGlobal = (ra: string) => {
      const raLimpo = String(ra || '').replace(/\D/g, '');
      const alunos = (window as any).allStudentsData;
      let al = Array.isArray(alunos) ? alunos.find((a: any) => String(a.ra).replace(/\D/g, '') === raLimpo) : null;
      if (!al && (window as any).currentAlunoModalData) {
        const modalRa = String((window as any).currentAlunoModalData.ra || '').replace(/\D/g, '');
        if (modalRa === raLimpo) {
          al = (window as any).currentAlunoModalData;
        }
      }
      if (al) {
        setAlunoBoletimGlobal(al);
        setModalBoletimGlobalAberto(true);
      } else if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Estudante não localizado na base ativa.', 'warning');
      }
    };

    if (!(window as any).abrirModalImportarBoletimPDF) {
      (window as any).abrirModalImportarBoletimPDF = (window as any).abrirModalImportarBoletimPDFGlobal;
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('taborrolechange', syncState);
      window.removeEventListener('popstate', syncState);
      window.removeEventListener('storage', syncState);
      if ((window as any).abrirRelatorioAuditoria) {
        delete (window as any).abrirRelatorioAuditoria;
      }
      if ((window as any).abrirModalImportarBoletimPDFGlobal) {
        delete (window as any).abrirModalImportarBoletimPDFGlobal;
      }
    };
  }, []);

  const roleUpper = String(userRole || 'PROFESSOR').toUpperCase().trim();
  const roleNorm = normalizarCargo(roleUpper);
  const isAuthorizedPEI = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'PROFESSOR'].some(
    (r) => roleNorm.includes(r) || roleNorm === r
  );
  const isAuthorizedPDCA = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'PAAC', 'PROFESSOR', 'PROFESSOR_PAAC'].some(
    (r) => roleNorm.includes(r) || roleNorm === r
  );
  const isAuthorizedProfessores = ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'SECRETARIA', 'PROFESSOR'].some(
    (r) => roleNorm.includes(r) || roleNorm === r
  );
  const isAuthorizedAuditoria = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE');
  const isAuthorizedComparativo = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE') || roleNorm === 'CGPG' || roleNorm === 'CGPCG' || roleNorm === 'SECRETARIA';

  const isNavAuthorized = (item: NavItem): boolean => {
    if (!item.requires) return true;
    switch (item.requires) {
      case 'pei':
        return isAuthorizedPEI;
      case 'pdca':
        return isAuthorizedPDCA;
      case 'professores':
        return isAuthorizedProfessores;
      case 'auditoria':
        return isAuthorizedAuditoria;
      case 'comparativo':
        return isAuthorizedComparativo;
      default:
        return true;
    }
  };

  const navigateToTab = (tabId: string) => {
    if (typeof (window as any).switchTab === 'function') {
      (window as any).switchTab(tabId);
    } else {
      setCurrentTab(tabId);
    }
    setMobileMenuOpen(false);
  };

  const renderizarConteudoDaAba = () => {
    switch (currentTab) {
      case 'inicio':
        return (
          <PaginaInicial
            onNavigate={(tab) => navigateToTab(tab)}
          />
        );
      case 'comparativo-frequencia':
        return isAuthorizedComparativo ? (
          <ComparativoFrequencia />
        ) : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito: O módulo de Comparativo de Frequência (SED vs Mapão) é exclusivo para Gestão, Coordenação e Secretaria.
          </div>
        );
      case 'auditoria':
        return isAuthorizedAuditoria ? (
          <Auditoria />
        ) : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito: O módulo de Auditoria é exclusivo para Direção e Vice-Direção.
          </div>
        );
      case 'professores':
        return isAuthorizedProfessores ? (
          <Professores userRole={userRole} />
        ) : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito ao módulo de Professores.
          </div>
        );
      case 'agenda':
        return <AgendaPEI />;
      case 'rotina-pdca':
        return isAuthorizedPDCA ? <GestaoRotinaPDCA /> : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito ao Módulo Tarefas PDCA
          </div>
        );
      case 'dash-projetos-pei':
        return isAuthorizedPEI ? <DashProjetosPEI /> : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito ao Dash Projetos PEI
          </div>
        );
      case 'dashboard-notas':
        return <DashboardNotas />;
      case 'horarios':
        return <Horarios />;
      case 'substituicao-pei':
        return <SubstituicaoPEI />;
      default:
        return (
          <PaginaInicial
            onNavigate={(tab) => navigateToTab(tab)}
          />
        );
    }
  };

  const getRoleBadgeStyle = (cargo: string) => {
    if (cargo.includes('DIRETOR')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (cargo.includes('VICE')) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    if (cargo.includes('CGPG') || cargo.includes('COORDENADOR')) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (cargo.includes('SECRETARIA')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (cargo.includes('PAAC')) return 'bg-teal-100 text-teal-800 border-teal-200';
    return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  };

  const getRoleFriendlyName = (cargo: string) => {
    if (cargo === 'DIRETOR') return 'Direção';
    if (cargo === 'VICE_DIRETOR') return 'Vice-Direção';
    if (cargo === 'CGPG') return 'Coord. Geral';
    if (cargo === 'SECRETARIA') return 'Secretaria';
    if (cargo === 'PAAC') return 'PAAC';
    return 'Professor(a)';
  };

  return (
    <div className="w-full min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col antialiased">
      {/* Top Banner de Conexão Offline */}
      {!isOnline && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-sm sticky top-0 z-50">
          <i className="fa-solid fa-triangle-exclamation animate-pulse"></i>
          <span>Modo Offline: Sem conexão à internet. Operando com dados do cache local e MongoDB offline.</span>
        </div>
      )}

      {/* HEADER RESPONSIVO: 'Clovis de Lucca new' */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs transition-all">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
          <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
            
            {/* Logo e Nome da Aplicação */}
            <div 
              onClick={() => navigateToTab('inicio')}
              className="flex items-center gap-3 cursor-pointer group shrink-0 select-none"
              title="Voltar ao início do Clovis de Lucca new"
            >
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-700 via-indigo-600 to-sky-500 text-white shadow-sm overflow-hidden border border-indigo-200 group-hover:scale-105 transition-transform">
                <img 
                  src="/logo-clovis.svg" 
                  alt="Logo" 
                  className="w-full h-full object-cover p-1"
                  onError={(e) => {
                    // Fallback para ícone estilizado se o SVG não estiver pronto
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <i className="fa-solid fa-school text-lg text-white group-hover:rotate-6 transition-transform"></i>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">
                    Clovis de Lucca new
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider">
                    PEI
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 font-medium hidden sm:block truncate max-w-[280px]">
                  E.E. Clóvis de Lucca • Gestão Integrada
                </span>
              </div>
            </div>

            {/* Navegação Desktop (Abas Principais com Rolagem Suave) */}
            <nav className="hidden lg:flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
              {NAV_ITEMS.filter(isNavAuthorized).map((item) => {
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigateToTab(item.id)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer select-none ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-200'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <i className={`fa-solid ${item.icon} text-xs ${isActive ? 'text-white' : 'text-slate-400'}`}></i>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Ações da Direita (Status, Cargo e Menu Mobile) */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Indicador de Conexão Online */}
              <div 
                className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                  isOnline 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
                title={isOnline ? 'Conexão ativa com o MongoDB Atlas' : 'Offline - usando cache'}
              >
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
                <span className="hidden xl:inline">{isOnline ? 'Atlas Conectado' : 'Offline'}</span>
              </div>

              {/* Tag de Cargo do Usuário Logado */}
              <div className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${getRoleBadgeStyle(roleNorm)}`}>
                <i className="fa-solid fa-user-shield text-[11px]"></i>
                <span className="truncate max-w-[120px]">{userName ? `${userName} (${getRoleFriendlyName(roleNorm)})` : getRoleFriendlyName(roleNorm)}</span>
              </div>

              {/* Botão de Auditoria Rápida para Gestores */}
              {isAuthorizedAuditoria && (
                <button
                  onClick={() => setIsAuditModalOpen(true)}
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 transition-colors cursor-pointer"
                  title="Abrir Auditoria de Alterações"
                >
                  <i className="fa-solid fa-clock-rotate-left text-xs"></i>
                  <span className="hidden xl:inline">Histórico</span>
                </button>
              )}

              {/* Botão de Transcrição de Áudio com IA (gemini-3.5-transcribe) */}
              <button
                onClick={() => setIsAudioTranscriberOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 shadow-xs hover:shadow-sm transition-all cursor-pointer"
                title="Gravar áudio com microfone e transcrever com IA (gemini-3.5-transcribe)"
              >
                <i className="fa-solid fa-microphone-lines text-xs"></i>
                <span className="hidden sm:inline">Transcrever Áudio</span>
              </button>

              {/* Botão Hambúrguer Mobile / Tablet */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                aria-label="Abrir Menu de Navegação"
              >
                <i className={`fa-solid ${mobileMenuOpen ? 'fa-xmark text-lg text-indigo-600' : 'fa-bars text-base'}`}></i>
              </button>
            </div>

          </div>
        </div>

        {/* Menu Dropdown Mobile / Tablet */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white/98 backdrop-blur-md px-4 py-3 shadow-lg animate-in slide-in-from-top duration-200">
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${getRoleBadgeStyle(roleNorm)}`}>
                  <i className="fa-solid fa-user text-[11px]"></i>
                  <span>{userName ? `${userName} • ${getRoleFriendlyName(roleNorm)}` : getRoleFriendlyName(roleNorm)}</span>
                </span>
              </div>
              <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${isOnline ? 'text-emerald-600' : 'text-amber-600'}`}>
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                <span>{isOnline ? 'Atlas Online' : 'Modo Offline'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {NAV_ITEMS.filter(isNavAuthorized).map((item) => {
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigateToTab(item.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200/80'
                    }`}
                  >
                    <i className={`fa-solid ${item.icon} text-xs w-4 text-center ${isActive ? 'text-white' : 'text-indigo-500'}`}></i>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 pt-2 border-t border-slate-100 flex flex-col gap-2">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setIsAudioTranscriberOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-sky-600 shadow-xs transition-colors cursor-pointer"
              >
                <i className="fa-solid fa-microphone-lines"></i>
                <span>Transcrever Áudio com IA (gemini-3.5-transcribe)</span>
              </button>

              {isAuthorizedAuditoria && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setIsAuditModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
                >
                  <i className="fa-solid fa-shield-halved text-indigo-600"></i>
                  <span>Auditoria e Histórico Completo de Alterações</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ÁREA DE CONTEÚDO PRINCIPAL COM CLASSES TAILWIND */}
      <main className="flex-1 w-full min-w-0 max-w-7xl mx-auto px-2 sm:px-4 md:px-6 py-4 md:py-6">
        <ErrorBoundary fallbackTitle="Erro ao carregar o módulo selecionado">
          {renderizarConteudoDaAba()}
        </ErrorBoundary>

        {/* Modal de Auditoria Global de Alterações */}
        <RelatorioAlteracoesModal
          isOpen={isAuditModalOpen}
          onClose={() => setIsAuditModalOpen(false)}
        />

        {/* Modal Global de Importação de Boletim em PDF */}
        <ModalImportarBoletimPDF
          aluno={alunoBoletimGlobal}
          aberto={modalBoletimGlobalAberto}
          aoFechar={() => {
            setModalBoletimGlobalAberto(false);
            setAlunoBoletimGlobal(null);
          }}
        />

        {/* Modal de Transcrição de Áudio com IA (gemini-3.5-transcribe) */}
        <AudioTranscriberModal
          isOpen={isAudioTranscriberOpen}
          onClose={() => setIsAudioTranscriberOpen(false)}
        />
      </main>

      {/* Rodapé institucional com identidade do sistema */}
      <footer className="w-full bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500 font-medium">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">Clovis de Lucca new</span>
            <span>•</span>
            <span>Escola Estadual Clóvis de Lucca</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Programa de Ensino Integral (PEI) • SEDUC-SP • MongoDB Atlas Cloud
          </div>
        </div>
      </footer>
    </div>
  );
}
