import React, { useState, useEffect } from 'react';
import PaginaInicial from './components/PaginaInicial';
import GestaoRotinaPDCA from './components/GestaoRotinaPDCA';
import AgendaPEI from './components/AgendaPEI';
import Horarios from './components/Horarios';
import SubstituicaoPEI from './components/SubstituicaoPEI';
import Professores from './components/Professores';
import Auditoria from './components/Auditoria';
import ComparativoFrequencia from './components/ComparativoFrequencia';
import PresencaDiariaIA from './components/PresencaDiariaIA';
import PainelDashboardsUnificado from './components/PainelDashboardsUnificado';
import RelatorioAlteracoesModal from './components/RelatorioAlteracoesModal';
import ModalImportarBoletimPDF from './components/ModalImportarBoletimPDF';
import ErrorBoundary from './components/ErrorBoundary';

// Inicializa módulos globais (window.*)
import './modules/smartCache';
import './modules/dashboardAtrasos';
import './modules/fechamentoNotasManager';
import './modules/digitarBoletimModal';
import './modules/ajusteFrequenciaSedModal';
import './modules/backupManager';
import { normalizarCargo } from './modules/authHelper';

export default function App() {
  const [currentTab, setCurrentTab] = useState(
    typeof window !== 'undefined' && (window as any).currentActiveTab ? (window as any).currentActiveTab : 'inicio'
  );
  const [userRole, setUserRole] = useState('PROFESSOR');
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [alunoBoletimGlobal, setAlunoBoletimGlobal] = useState<any | null>(null);
  const [modalBoletimGlobalAberto, setModalBoletimGlobalAberto] = useState(false);

  useEffect(() => {
    const syncState = () => {
      if (typeof window !== 'undefined' && (window as any).currentActiveTab) {
        setCurrentTab((window as any).currentActiveTab);
      }
      const role = typeof window !== 'undefined' && typeof (window as any).obterRoleAtual === 'function'
        ? (window as any).obterRoleAtual()
        : ((window as any)?.currentUserRole || 'PROFESSOR');
      setUserRole(role || 'PROFESSOR');
    };

    syncState();

    (window as any).abrirRelatorioAuditoria = () => {
      setIsAuditModalOpen(true);
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
  const isProfessorComum = roleNorm === 'PROFESSOR';
  const isAuthorizedProfessores = !isProfessorComum && (
    ['DIRETOR', 'VICE_DIRETOR', 'CGPG', 'CGPCG', 'PAAC', 'PROFESSOR_PAAC', 'SECRETARIA'].includes(roleNorm) ||
    roleNorm.includes('VICE')
  );
  const isAuthorizedSubstituicaoPEI = !isProfessorComum;
  const isAuthorizedPresencaDiaria = !isProfessorComum;
  const isAuthorizedAuditoria = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE');
  const isAuthorizedComparativo = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE') || roleNorm === 'CGPG' || roleNorm === 'CGPCG' || roleNorm === 'SECRETARIA';

  const renderizarConteudoDaAba = () => {
    switch (currentTab) {
      case 'inicio':
        return (
          <PaginaInicial
            onNavigate={(tab) => {
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab(tab);
              } else {
                setCurrentTab(tab);
              }
            }}
          />
        );
      case 'comparativo-frequencia':
        return isAuthorizedComparativo ? (
          <ComparativoFrequencia />
        ) : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-2xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito: O módulo de Comparativo de Frequência (SED vs Mapão) é exclusivo para Gestão, Coordenação e Secretaria.
          </div>
        );
      case 'auditoria':
        return isAuthorizedAuditoria ? (
          <Auditoria />
        ) : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-2xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito: O módulo de Auditoria é exclusivo para Direção e Vice-Direção.
          </div>
        );
      case 'professores':
        return isAuthorizedProfessores ? (
          <Professores userRole={userRole} />
        ) : (
          <PaginaInicial
            onNavigate={(tab) => {
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab(tab);
              } else {
                setCurrentTab(tab);
              }
            }}
          />
        );
      case 'agenda':
        return <AgendaPEI />;
      case 'rotina-pdca':
        return isAuthorizedPDCA ? <GestaoRotinaPDCA /> : (
          <div className="p-8 text-center text-red-600 font-bold bg-white rounded-2xl border border-red-200 m-4 shadow-sm">
            <i className="fa-solid fa-lock text-2xl mb-2 block"></i>
            Acesso Restrito ao Módulo Tarefas PDCA
          </div>
        );
      case 'dashboard':
      case 'dashboard-atrasos':
      case 'dashboard-notas':
      case 'dash-projetos-pei':
        return (
          <PainelDashboardsUnificado
            activeTab={currentTab}
            isAuthorizedPEI={isAuthorizedPEI}
          />
        );
      case 'horarios':
        return <Horarios />;
      case 'substituicao-pei':
        return isAuthorizedSubstituicaoPEI ? (
          <SubstituicaoPEI />
        ) : (
          <PaginaInicial
            onNavigate={(tab) => {
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab(tab);
              } else {
                setCurrentTab(tab);
              }
            }}
          />
        );
      case 'presenca-diaria':
        return isAuthorizedPresencaDiaria ? (
          <PresencaDiariaIA />
        ) : (
          <PaginaInicial
            onNavigate={(tab) => {
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab(tab);
              } else {
                setCurrentTab(tab);
              }
            }}
          />
        );
      default:
        return (
          <PaginaInicial
            onNavigate={(tab) => {
              if (typeof (window as any).switchTab === 'function') {
                (window as any).switchTab(tab);
              } else {
                setCurrentTab(tab);
              }
            }}
          />
        );
    }
  };

  return (
    <div className="w-full h-full min-h-screen bg-transparent text-slate-800 font-sans">
      {!isOnline && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-md sticky top-0 z-50">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>Modo Offline: Você está desconectado da internet. Os dados em cache continuam disponíveis para consulta.</span>
        </div>
      )}

      <main className="w-full min-w-0">
        <ErrorBoundary fallbackTitle="Erro ao carregar o módulo selecionado">
          {renderizarConteudoDaAba()}
        </ErrorBoundary>

        <RelatorioAlteracoesModal
          isOpen={isAuditModalOpen}
          onClose={() => setIsAuditModalOpen(false)}
        />

        <ModalImportarBoletimPDF
          aluno={alunoBoletimGlobal}
          aberto={modalBoletimGlobalAberto}
          aoFechar={() => {
            setModalBoletimGlobalAberto(false);
            setAlunoBoletimGlobal(null);
          }}
        />
      </main>
    </div>
  );
}
