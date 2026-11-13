import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  db,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy
} from '../lib/database';
import { obterUsuarioAtivoCompleto } from '../modules/authHelper';
import { registrarLogAuditoria } from '../modules/auditLogger';

/**
 * MÓDULO PROFESSORES & EQUIPE ESCOLAR
 * Acesso exclusivo: Diretor, Vice-Diretor, CGPG e PAAC.
 *
 * HIERARQUIA DE VISIBILIDADE:
 * 1. Diretor: visualiza tudo (Diretor, Vice, CGPG, PAAC, Secretaria)
 * 2. Vice-Diretor: visualiza Vice, CGPG, PAAC, Secretaria (não visualiza anotações do Diretor)
 * 3. CGPG: visualiza CGPG, PAAC, Secretaria (não visualiza anotações do Diretor e Vice)
 * 4. PAAC: visualiza PAAC e Secretaria (não visualiza anotações de Diretor, Vice e CGPG)
 * 5. Secretaria: visualiza apenas as anotações da Secretaria (nível mais baixo, sem ver anotações da gestão escolar)
 */

export const HIERARQUIA_CONFIG = {
  1: {
    nome: 'Diretor',
    codigo: 'DIRETOR',
    badgeClass: 'bg-indigo-50/90 text-indigo-900 border-indigo-200/70',
    pillClass: 'bg-indigo-50/90 text-indigo-900 border-indigo-200/70',
    descricao: 'Nível 1 (Acesso Total: anotações de Diretor, Vice, CGPG, PAAC e Secretaria)'
  },
  2: {
    nome: 'Vice-Diretor',
    codigo: 'VICE_DIRETOR',
    badgeClass: 'bg-blue-50/90 text-blue-900 border-blue-200/70',
    pillClass: 'bg-blue-50/90 text-blue-900 border-blue-200/70',
    descricao: 'Nível 2 (Anotações de Vice-Diretor, CGPG, PAAC e Secretaria)'
  },
  3: {
    nome: 'CGPG',
    codigo: 'CGPG',
    badgeClass: 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70',
    pillClass: 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70',
    descricao: 'Nível 3 (Anotações de CGPG, PAAC e Secretaria)'
  },
  4: {
    nome: 'PAAC',
    codigo: 'PAAC',
    badgeClass: 'bg-purple-50/90 text-purple-900 border-purple-200/70',
    pillClass: 'bg-purple-50/90 text-purple-900 border-purple-200/70',
    descricao: 'Nível 4 (Anotações de PAAC e Secretaria)'
  },
  5: {
    nome: 'Secretaria',
    codigo: 'SECRETARIA',
    badgeClass: 'bg-teal-50/90 text-teal-900 border-teal-200/70',
    pillClass: 'bg-teal-50/90 text-teal-900 border-teal-200/70',
    descricao: 'Nível 5 (Nível mais baixo: anotações e registros da Secretaria Escolar, sem acesso às anotações da gestão)'
  }
};

export const CATEGORIAS_ANOTACAO = [
  { id: 'alinhamento', nome: 'Alinhamento Pedagógico', icone: 'fa-graduation-cap', cor: 'cyan' },
  { id: 'observacao', nome: 'Acompanhamento em Sala de Aula', icone: 'fa-chalkboard-user', cor: 'blue' },
  { id: 'feedback', nome: 'Feedback Formativo / Devolutiva', icone: 'fa-comments', cor: 'emerald' },
  { id: 'ocorrencia', nome: 'Ocorrência Administrativa', icone: 'fa-triangle-exclamation', cor: 'amber' },
  { id: 'pontualidade', nome: 'Pontualidade & Frequência', icone: 'fa-clock', cor: 'violet' },
  { id: 'atestado', nome: 'Atestados & Afastamentos', icone: 'fa-file-medical', cor: 'teal' },
  { id: 'elogio', nome: 'Elogio & Reconhecimento', icone: 'fa-award', cor: 'yellow' },
  { id: 'reuniao', nome: 'Reunião Individual (1 on 1)', icone: 'fa-handshake', cor: 'indigo' },
  { id: 'outros', nome: 'Outros Assuntos / Observação Geral', icone: 'fa-file-lines', cor: 'slate' }
];

export function getHierarchyInfo(cargoRaw) {
  const c = String(cargoRaw || '').toUpperCase().trim();
  if (c.includes('SUPER') || c === 'ADMIN' || c === 'DIRETOR' || c === 'DIREÇÃO' || c === 'DIRECAO') {
    return { nivel: 1, cargo: 'DIRETOR', rotulo: 'Diretor' };
  }
  if (c.includes('VICE')) {
    return { nivel: 2, cargo: 'VICE_DIRETOR', rotulo: 'Vice-Diretor' };
  }
  if (c.includes('CGPG') || c.includes('CGPCG') || c.includes('CGPAC') || c.includes('COORDENAD')) {
    return { nivel: 3, cargo: 'CGPG', rotulo: 'CGPG' };
  }
  if (c.includes('PAAC')) {
    return { nivel: 4, cargo: 'PAAC', rotulo: 'PAAC' };
  }
  if (c.includes('SECRETAR') || c.includes('SECRETÁRIA') || c === 'SECRETARIA' || c.includes('AOE') || c.includes('GOE')) {
    return { nivel: 5, cargo: 'SECRETARIA', rotulo: 'Secretaria' };
  }
  return { nivel: 999, cargo: 'PROFESSOR', rotulo: 'Professor' };
}

export default function Professores({ userRole }) {
  const [professores, setProfessores] = useState([]);
  const [anotacoes, setAnotacoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('equipe'); // 'equipe' | 'timeline'
  
  // Filtros Equipe
  const [buscaTermo, setBuscaTermo] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('TODOS');
  
  // Filtros Timeline
  const [filtroProfessorAnotacao, setFiltroProfessorAnotacao] = useState('');
  const [filtroCategoriaAnotacao, setFiltroCategoriaAnotacao] = useState('');
  const [filtroNivelAutor, setFiltroNivelAutor] = useState('');
  const [buscaTextoAnotacao, setBuscaTextoAnotacao] = useState('');

  // Modais
  const [modalDossie, setModalDossie] = useState(null); // professor object
  const [modalNovaAnotacao, setModalNovaAnotacao] = useState(false);
  const [professorPreSelecionado, setProfessorPreSelecionado] = useState(null);
  const [modalCadastro, setModalCadastro] = useState(false);
  const [modalEditarAcesso, setModalEditarAcesso] = useState(null); // user object
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Form State Nova Anotação
  const [formAnotacao, setFormAnotacao] = useState({
    professorId: '',
    categoria: 'alinhamento',
    titulo: '',
    conteudo: '',
    encaminhamentos: '',
    dataOcorrencia: new Date().toISOString().split('T')[0],
    horario: new Date().toTimeString().slice(0, 5),
    status: 'Concluído'
  });

  // Form State Cadastro / Vínculo
  const [formCadastro, setFormCadastro] = useState({
    id: '',
    nome: '',
    email: '',
    cargo: 'Professor PEI',
    disciplina: 'Língua Portuguesa',
    telefone: '',
    habilitarLogin: true,
    senha: ''
  });

  // Identificação do Usuário Ativo
  const activeUser = useMemo(() => {
    return obterUsuarioAtivoCompleto();
  }, []);

  const currentRoleRaw = userRole || (typeof window !== 'undefined' && window.obterRoleAtual ? window.obterRoleAtual() : activeUser.cargo);
  const hierarquiaAtual = useMemo(() => {
    return getHierarchyInfo(currentRoleRaw);
  }, [currentRoleRaw]);

  const viewerNivel = hierarquiaAtual.nivel;
  const isAuthorized = viewerNivel <= 5;

  // 1. Carregar Professores e Usuários da Coleção "usuarios"
  const carregarUsuarios = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'usuarios'));
      const list = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });

      if (list.length > 0) {
        const seen = new Set();
        const deduplicated = [];
        list.forEach(u => {
          const key = (u.nome || '').toString().toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const emailKey = (u.email || '').toString().toLowerCase().trim();
          if (key && !seen.has(key) && (!emailKey || !seen.has(emailKey))) {
            seen.add(key);
            if (emailKey) seen.add(emailKey);
            deduplicated.push(u);
          }
        });
        deduplicated.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        setProfessores(deduplicated);
        try {
          localStorage.setItem('usuarios_cadastrados_cache', JSON.stringify(deduplicated));
        } catch (e) {}
        return;
      }
    } catch (err) {
      console.warn('Carregamento de equipe/professores operando em modo local resiliente.');
    }

    // Fallback gracioso com cache e equipe escolar padrão
    let localList = [];
    try {
      const raw = localStorage.getItem('usuarios_cadastrados_cache');
      if (raw) localList = JSON.parse(raw);
    } catch (e) {}

    if (!localList || localList.length === 0) {
      if (Array.isArray(window.usuariosCache) && window.usuariosCache.length > 0) {
        localList = [...window.usuariosCache];
      } else {
        localList = [
          { id: 'usr-diretor', nome: 'Diretor Escolar', email: 'diretor@clovis.com', senha: 'Clovis@2026', cargo: 'DIRETOR', nivel: 'DIRETOR', disciplina: 'Gestão Geral', ativo: true },
          { id: 'usr-vice', nome: 'Vice-Diretor Escolar', email: 'vice@clovis.com', senha: 'Clovis@2026', cargo: 'VICE_DIRETOR', nivel: 'VICE_DIRETOR', disciplina: 'Gestão de Turno', ativo: true },
          { id: 'usr-cgpg', nome: 'Coordenador CGPG', email: 'cgpg@clovis.com', senha: 'Clovis@2026', cargo: 'CGPG', nivel: 'CGPG', disciplina: 'Coordenação Pedagógica Geral', ativo: true },
          { id: 'usr-paac', nome: 'Professor PAAC', email: 'paac@clovis.com', senha: 'Clovis@2026', cargo: 'PAAC', nivel: 'PAAC', disciplina: 'Apoio e Acompanhamento Curricular', ativo: true },
          { id: 'usr-sec', nome: 'Secretaria Escolar', email: 'secretaria@clovis.com', senha: 'Clovis@2026', cargo: 'SECRETARIA', nivel: 'SECRETARIA', disciplina: 'Administração', ativo: true },
          { id: 'usr-prof-1', nome: 'Prof. Carlos Silva', email: 'carlos.silva@clovis.com', senha: 'Clovis@2026', cargo: 'PROFESSOR', nivel: 'PROFESSOR', disciplina: 'Matemática', ativo: true },
          { id: 'usr-prof-2', nome: 'Profa. Beatriz Costa', email: 'beatriz.costa@clovis.com', senha: 'Clovis@2026', cargo: 'PROFESSOR', nivel: 'PROFESSOR', disciplina: 'Língua Portuguesa', ativo: true },
          { id: 'usr-prof-3', nome: 'Prof. Marcos Oliveira', email: 'marcos.oliveira@clovis.com', senha: 'Clovis@2026', cargo: 'PROFESSOR', nivel: 'PROFESSOR', disciplina: 'História', ativo: true }
        ];
        try {
          localStorage.setItem('usuarios_cadastrados_cache', JSON.stringify(localList));
        } catch (e) {}
      }
    }

    localList.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    setProfessores(localList);
  }, []);

  // 2. Ouvinte de Anotações de Professores do Firestore com Fallback Resiliente
  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    carregarUsuarios();

    const carregarAnotacoesLocal = () => {
      let local = [];
      try {
        const raw = localStorage.getItem('professores_anotacoes_cache');
        if (raw) local = JSON.parse(raw);
      } catch (e) {}
      if (!local || local.length === 0) {
        // Mock inicial demonstrando perfeitamente a hierarquia (Diretor: 1, Vice: 2, CGPG: 3, PAAC: 4)
        const agora = new Date().toISOString();
        local = [
          {
            id: 'anot-1',
            professorId: 'usr-prof-1',
            professorNome: 'Prof. Carlos Silva',
            categoria: 'desempenho',
            titulo: 'Avaliação da Prova Paulista e Metas do Bimestre',
            descricao: 'Acompanhamento do plano de recomposição de aprendizagem em álgebra com os 9ºs anos.',
            acoesTomadas: 'Reforço semanal às terças-feiras no contraturno com monitoria.',
            autorNome: 'Diretor Escolar',
            autorEmail: 'diretor@clovis.com',
            autorCargo: 'DIRETOR',
            autorNivel: 1,
            criadoEm: agora
          },
          {
            id: 'anot-2',
            professorId: 'usr-prof-2',
            professorNome: 'Profa. Beatriz Costa',
            categoria: 'frequencia',
            titulo: 'Acompanhamento de Atestados e Substituições',
            descricao: 'Organização das aulas atribuídas e alinhamento das atividades de leitura compartilhada.',
            acoesTomadas: 'Aulas repostas e registradas no diário de classe.',
            autorNome: 'Vice-Diretor Escolar',
            autorEmail: 'vice@clovis.com',
            autorCargo: 'VICE_DIRETOR',
            autorNivel: 2,
            criadoEm: agora
          },
          {
            id: 'anot-3',
            professorId: 'usr-prof-1',
            professorNome: 'Prof. Carlos Silva',
            categoria: 'pedagogico',
            titulo: 'Alinhamento dos Guias de Aprendizagem',
            descricao: 'Revisão dos instrumentos avaliativos e nivelamento das habilidades prioritárias.',
            acoesTomadas: 'Ajuste nos materiais de apoio do CMSP e nivelamento pedagógico.',
            autorNome: 'Coordenador CGPG',
            autorEmail: 'cgpg@clovis.com',
            autorCargo: 'CGPG',
            autorNivel: 3,
            criadoEm: agora
          },
          {
            id: 'anot-4',
            professorId: 'usr-prof-3',
            professorNome: 'Prof. Marcos Oliveira',
            categoria: 'pedagogico',
            titulo: 'Oficina Curricular e Apoio em Sala',
            descricao: 'Acompanhamento direto em sala com o projeto temático sobre patrimônio histórico e cidadania.',
            acoesTomadas: 'Elaboração de roteiro de pesquisa conjunta com os estudantes.',
            autorNome: 'Professor PAAC',
            autorEmail: 'paac@clovis.com',
            autorCargo: 'PAAC',
            autorNivel: 4,
            criadoEm: agora
          }
        ];
        try {
          localStorage.setItem('professores_anotacoes_cache', JSON.stringify(local));
        } catch (e) {}
      }
      setAnotacoes(local);
      setLoading(false);
    };

    let unsubscribe = () => {};
    try {
      const q = query(collection(db, 'professores_anotacoes'), orderBy('criadoEm', 'desc'));
      unsubscribe = onSnapshot(
        q,
        snapshot => {
          const list = [];
          snapshot.forEach(docSnap => {
            list.push({ id: docSnap.id, ...docSnap.data() });
          });
          setAnotacoes(list);
          try {
            localStorage.setItem('professores_anotacoes_cache', JSON.stringify(list));
          } catch (e) {}
          setLoading(false);
        },
        error => {
          console.warn('Anotações de professores operando em modo local resiliente.');
          carregarAnotacoesLocal();
        }
      );
    } catch (e) {
      console.warn('Conexão ao banco indisponível, ativando cache local.');
      carregarAnotacoesLocal();
    }

    return () => {
      try {
        unsubscribe();
      } catch (e) {}
    };
  }, [isAuthorized, carregarUsuarios]);

  // FILTRO HIERÁRQUICO FUNDAMENTAL:
  // "abre o modulo professores para a secretária poder fazer anotações (sem ver as nossas, é o nivel mais baixo)"
  // Viewer Nível 1 (Diretor) -> Vê autorNivel 1, 2, 3, 4, 5 (autorNivel >= 1)
  // Viewer Nível 2 (Vice) -> Vê autorNivel 2, 3, 4, 5 (autorNivel >= 2)
  // Viewer Nível 3 (CGPG) -> Vê autorNivel 3, 4, 5 (autorNivel >= 3)
  // Viewer Nível 4 (PAAC) -> Vê autorNivel 4, 5 (autorNivel >= 4)
  // Viewer Nível 5 (Secretaria) -> Vê APENAS autorNivel 5 (anotações da própria secretaria, sem ver as da equipe gestora)
  const anotacoesPermitidas = useMemo(() => {
    return anotacoes.filter(item => {
      const nivelItem = Number(item.autorNivel || 999);
      if (viewerNivel === 5) {
        return nivelItem === 5 || (item.autorCargo && String(item.autorCargo).toUpperCase().includes('SECRETAR'));
      }
      return nivelItem >= viewerNivel;
    });
  }, [anotacoes, viewerNivel]);

  // Mapa de contagem de anotações permitidas por professor
  const contagemAnotacoesPorProf = useMemo(() => {
    const map = {};
    anotacoesPermitidas.forEach(a => {
      const profId = a.professorId || a.professorEmail;
      if (profId) {
        map[profId] = (map[profId] || 0) + 1;
      }
    });
    return map;
  }, [anotacoesPermitidas]);

  // Lista de Professores Filtrada
  const professoresFiltrados = useMemo(() => {
    return professores.filter(p => {
      const nome = (p.nome || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const cargo = (p.cargo || p.nivel || p.funcao || '').toLowerCase();
      const disc = (p.disciplina || '').toLowerCase();
      const termo = buscaTermo.toLowerCase().trim();

      const matchTermo = !termo || nome.includes(termo) || email.includes(termo) || cargo.includes(termo) || disc.includes(termo);

      let matchCargo = true;
      if (filtroCargo === 'PROFESSORES') {
        matchCargo = cargo.includes('prof') || cargo.includes('docente') || disc.length > 0;
      } else if (filtroCargo === 'PAAC') {
        matchCargo = cargo.includes('paac');
      } else if (filtroCargo === 'COORDENADORES') {
        matchCargo = cargo.includes('cgpg') || cargo.includes('coord');
      } else if (filtroCargo === 'DIRECAO') {
        matchCargo = cargo.includes('diretor') || cargo.includes('vice');
      } else if (filtroCargo === 'FUNCIONARIOS') {
        matchCargo = cargo.includes('secretaria') || cargo.includes('aoe') || cargo.includes('agente') || cargo.includes('func');
      }

      return matchTermo && matchCargo;
    });
  }, [professores, buscaTermo, filtroCargo]);

  // Linha do Tempo Filtrada
  const timelineFiltrada = useMemo(() => {
    return anotacoesPermitidas.filter(a => {
      if (filtroProfessorAnotacao && (a.professorId !== filtroProfessorAnotacao && a.professorEmail !== filtroProfessorAnotacao)) {
        return false;
      }
      if (filtroCategoriaAnotacao && a.categoria !== filtroCategoriaAnotacao) {
        return false;
      }
      if (filtroNivelAutor && String(a.autorNivel) !== String(filtroNivelAutor)) {
        return false;
      }
      if (buscaTextoAnotacao) {
        const t = buscaTextoAnotacao.toLowerCase();
        const titulo = (a.titulo || '').toLowerCase();
        const conteudo = (a.conteudo || '').toLowerCase();
        const profNome = (a.professorNome || '').toLowerCase();
        const autorNome = (a.autorNome || '').toLowerCase();
        if (!titulo.includes(t) && !conteudo.includes(t) && !profNome.includes(t) && !autorNome.includes(t)) {
          return false;
        }
      }
      return true;
    });
  }, [anotacoesPermitidas, filtroProfessorAnotacao, filtroCategoriaAnotacao, filtroNivelAutor, buscaTextoAnotacao]);

  // Estatísticas Rápidas
  const stats = useMemo(() => {
    const totalEquipe = professores.length;
    const totalVisiveis = anotacoesPermitidas.length;
    const totalAlinhamentos = anotacoesPermitidas.filter(a => a.categoria === 'alinhamento' || a.categoria === 'feedback').length;
    const totalObservacoes = anotacoesPermitidas.filter(a => a.categoria === 'observacao' || a.categoria === 'ocorrencia').length;
    return { totalEquipe, totalVisiveis, totalAlinhamentos, totalObservacoes };
  }, [professores, anotacoesPermitidas]);

  // Abrir Modal de Nova Anotação
  const handleAbrirNovaAnotacao = (prof = null) => {
    setProfessorPreSelecionado(prof);
    setFormAnotacao({
      professorId: prof ? (prof.id || prof.email) : '',
      categoria: 'alinhamento',
      titulo: '',
      conteudo: '',
      encaminhamentos: '',
      dataOcorrencia: new Date().toISOString().split('T')[0],
      horario: new Date().toTimeString().slice(0, 5),
      status: 'Concluído'
    });
    setModalNovaAnotacao(true);
  };

  // Salvar Nova Anotação
  const handleSalvarAnotacao = async (e) => {
    e.preventDefault();
    if (!formAnotacao.professorId) {
      if (typeof window.showToast === 'function') {
        window.showToast('Por favor, selecione o professor ou funcionário.', 'warning');
      }
      return;
    }
    if (!formAnotacao.titulo.trim() || !formAnotacao.conteudo.trim()) {
      if (typeof window.showToast === 'function') {
        window.showToast('Preencha o título e o relato da anotação.', 'warning');
      }
      return;
    }

    const profObj = professores.find(p => p.id === formAnotacao.professorId || p.email === formAnotacao.professorId);
    const profNome = profObj ? profObj.nome : 'Professor';
    const profEmail = profObj ? profObj.email : '';
    const profCargo = profObj ? (profObj.cargo || profObj.nivel || '') : '';
    const profDisc = profObj ? (profObj.disciplina || '') : '';

    const payload = {
      professorId: formAnotacao.professorId,
      professorNome: profNome,
      professorEmail: profEmail,
      professorCargo: profCargo,
      professorDisciplina: profDisc,
      categoria: formAnotacao.categoria,
      titulo: formAnotacao.titulo.trim(),
      conteudo: formAnotacao.conteudo.trim(),
      encaminhamentos: formAnotacao.encaminhamentos.trim(),
      dataOcorrencia: formAnotacao.dataOcorrencia,
      horario: formAnotacao.horario,
      status: formAnotacao.status,
      // Metadados Rígidos do Autor para a Hierarquia
      autorId: activeUser.email,
      autorNome: activeUser.nome,
      autorEmail: activeUser.email,
      autorCargo: hierarquiaAtual.cargo,
      autorNivel: hierarquiaAtual.nivel,
      criadoEm: formAnotacao.id ? (anotacoes.find(a => a.id === formAnotacao.id)?.criadoEm || new Date().toISOString()) : new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };

    let docId = formAnotacao.id || ('anot-' + Date.now());
    try {
      if (formAnotacao.id) {
        await updateDoc(doc(db, 'professores_anotacoes', formAnotacao.id), payload);
      } else {
        const docRef = await addDoc(collection(db, 'professores_anotacoes'), payload);
        docId = docRef.id;
      }
    } catch (err) {
      console.warn('Persistindo anotação de professor em modo local:', err?.message || err);
    }

    const novaAnotacao = { id: docId, ...payload };
    setAnotacoes(prev => {
      let atualizado;
      if (formAnotacao.id) {
        atualizado = prev.map(item => item.id === formAnotacao.id ? novaAnotacao : item);
      } else {
        atualizado = [novaAnotacao, ...prev];
      }
      try {
        localStorage.setItem('professores_anotacoes_cache', JSON.stringify(atualizado));
      } catch (e) {}
      return atualizado;
    });

    try {
      registrarLogAuditoria({
        modulo: 'Professores',
        acao: formAnotacao.id ? 'Atualização de Anotação' : 'Criação de Anotação',
        detalhes: {
          professor: profNome,
          categoria: formAnotacao.categoria,
          titulo: formAnotacao.titulo,
          autorNivel: hierarquiaAtual.nivel
        }
      });
    } catch (e) {}

    if (typeof window.showToast === 'function') {
      window.showToast(`Anotação de "${profNome}" registrada com sucesso!`, 'success');
    }
    setModalNovaAnotacao(false);
  };

  // Excluir Anotação (Autor ou Diretor) com confirmação inline
  const handleExcluirAnotacao = async (anotacao) => {
    const podeExcluir = viewerNivel === 1 || (anotacao.autorEmail && anotacao.autorEmail.toLowerCase() === activeUser.email.toLowerCase());
    if (!podeExcluir) {
      if (typeof window.showToast === 'function') {
        window.showToast('Apenas o autor da anotação ou a Diretoria Geral podem excluí-la.', 'warning');
      }
      return;
    }

    if (confirmDeleteId !== anotacao.id) {
      setConfirmDeleteId(anotacao.id);
      return;
    }
    setConfirmDeleteId(null);

    try {
      await deleteDoc(doc(db, 'professores_anotacoes', anotacao.id));
    } catch (err) {
      console.warn('Excluindo anotação em modo local:', err?.message || err);
    }

    setAnotacoes(prev => {
      const atualizado = prev.filter(item => item.id !== anotacao.id);
      try {
        localStorage.setItem('professores_anotacoes_cache', JSON.stringify(atualizado));
      } catch (e) {}
      return atualizado;
    });

    try {
      registrarLogAuditoria({
        modulo: 'Professores',
        acao: 'Exclusão de Anotação',
        detalhes: { id: anotacao.id, professor: anotacao.professorNome, titulo: anotacao.titulo }
      });
    } catch (e) {}

    if (typeof window.showToast === 'function') {
      window.showToast('Anotação removida com sucesso.', 'info');
    }
  };

  // Salvar Cadastro / Vínculo de Professor ou Funcionário em "usuarios"
  const handleSalvarCadastro = async (e) => {
    e.preventDefault();
    if (!formCadastro.nome.trim() || !formCadastro.email.trim()) {
      if (typeof window.showToast === 'function') {
        window.showToast('Nome e e-mail institucional são obrigatórios.', 'warning');
      }
      return;
    }

    const payload = {
      nome: formCadastro.nome.trim(),
      email: formCadastro.email.trim().toLowerCase(),
      cargo: formCadastro.cargo,
      nivel: formCadastro.cargo,
      disciplina: formCadastro.disciplina,
      telefone: formCadastro.telefone.trim(),
      acesso_total: formCadastro.cargo.toUpperCase().includes('DIRETOR'),
      ativo: true,
      atualizadoEm: new Date().toISOString()
    };

    if (formCadastro.habilitarLogin && formCadastro.senha) {
      payload.senha = formCadastro.senha.trim();
    }

    let docId = formCadastro.id || ('usr-' + Date.now());
    try {
      if (formCadastro.id) {
        await updateDoc(doc(db, 'usuarios', formCadastro.id), payload);
      } else {
        payload.dataCriacao = new Date().toISOString();
        if (!payload.senha && formCadastro.habilitarLogin) {
          payload.senha = 'escola123';
        }
        const docRef = await addDoc(collection(db, 'usuarios'), payload);
        docId = docRef.id;
      }
    } catch (err) {
      console.warn('Salvando docente em modo local:', err?.message || err);
    }

    const novoUsuario = { id: docId, ...payload };
    setProfessores(prev => {
      let atualizado;
      if (formCadastro.id) {
        atualizado = prev.map(u => u.id === formCadastro.id ? novoUsuario : u);
      } else {
        atualizado = [novoUsuario, ...prev];
      }
      atualizado.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      try {
        localStorage.setItem('usuarios_cadastrados_cache', JSON.stringify(atualizado));
      } catch (e) {}
      if (typeof window !== 'undefined') {
        window.usuariosCache = [...atualizado];
      }
      return atualizado;
    });

    try {
      registrarLogAuditoria({
        modulo: 'Professores',
        acao: formCadastro.id ? 'Atualização de Cadastro' : 'Novo Cadastro de Docente/Equipe',
        detalhes: { nome: payload.nome, email: payload.email, cargo: payload.cargo }
      });
    } catch (e) {}

    if (typeof window.showToast === 'function') {
      window.showToast(formCadastro.id ? `Cadastro de "${payload.nome}" atualizado!` : `Professor/Funcionário "${payload.nome}" cadastrado com sucesso!`, 'success');
    }

    setModalCadastro(false);
  };

  // Imprimir Dossiê do Professor
  const handleImprimirDossie = (prof, profAnotacoes) => {
    const janelaPrint = window.open('', '_blank');
    if (!janelaPrint) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dossiê Pedagógico - ${prof.nome}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #1e293b; }
          h1 { font-size: 20px; color: #1e3a8a; margin-bottom: 4px; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; }
          .header-info { margin-bottom: 20px; font-size: 13px; line-height: 1.6; background: #f8fafc; padding: 12px; border-radius: 8px; }
          .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 14px; background: #fff; }
          .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
          .badge-cat { background: #e0f2fe; color: #0369a1; }
          .badge-autor { background: #f1f5f9; color: #334155; }
          .data { font-size: 11px; color: #64748b; margin-top: 4px; }
          .titulo { font-size: 14px; font-weight: bold; margin: 8px 0 4px 0; color: #0f172a; }
          .conteudo { font-size: 12px; white-space: pre-wrap; color: #334155; }
          .encaminhamentos { margin-top: 8px; padding: 8px; background: #fefce8; border-left: 3px solid #eab308; font-size: 12px; }
          .rodape { margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 12px; font-size: 10px; color: #64748b; text-align: center; }
          @media print { body { padding: 0; } button { display: none; } }
        </style>
      </head>
      <body>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1>EE PROFESSOR CLÓVIS DE LUCCA • DOSSIÊ DO PROFESSOR</h1>
            <div style="font-size: 11px; color: #64748b;">Sistema de Gestão Escolar Integrada • Registro Oficial</div>
          </div>
          <button onclick="window.print()" style="padding: 8px 16px; background: #1e3a8a; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Imprimir</button>
        </div>

        <div class="header-info">
          <strong>Nome:</strong> ${prof.nome || 'Não informado'} &nbsp;|&nbsp;
          <strong>Cargo/Função:</strong> ${prof.cargo || prof.nivel || 'Professor'} &nbsp;|&nbsp;
          <strong>Disciplina:</strong> ${prof.disciplina || 'Não informada'}<br/>
          <strong>E-mail Institucional:</strong> ${prof.email || 'Não informado'} &nbsp;|&nbsp;
          <strong>Telefone:</strong> ${prof.telefone || 'Não informado'} &nbsp;|&nbsp;
          <strong>Total de Registros Visíveis:</strong> ${profAnotacoes.length}
        </div>

        <h3 style="font-size: 14px; color: #1e3a8a; text-transform: uppercase; margin-bottom: 12px;">Histórico de Alinhamentos, Acompanhamentos e Ocorrências</h3>

        ${profAnotacoes.length === 0 ? '<p style="font-style: italic; color: #64748b;">Nenhuma anotação registrada ou visível para o seu nível hierárquico.</p>' : ''}

        ${profAnotacoes.map(a => `
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span class="badge badge-cat">${a.categoria ? a.categoria.toUpperCase() : 'ANOTAÇÃO'}</span>
                <span class="badge badge-autor">Registrado por: ${a.autorCargo || 'Equipe'} (${a.autorNome || a.autorEmail || ''})</span>
              </div>
              <div class="data">${a.dataOcorrencia || ''} ${a.horario ? 'às ' + a.horario : ''}</div>
            </div>
            <div class="titulo">${a.titulo}</div>
            <div class="conteudo">${a.conteudo}</div>
            ${a.encaminhamentos ? `<div class="encaminhamentos"><strong>Encaminhamentos / Prazos:</strong> ${a.encaminhamentos}</div>` : ''}
          </div>
        `).join('')}

        <div class="rodape">
          Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')} por ${activeUser.nome} (${hierarquiaAtual.rotulo}).<br/>
          EE Professor Clóvis de Lucca • Diretoria de Ensino Leste 2
        </div>
      </body>
      </html>
    `;
    janelaPrint.document.write(html);
    janelaPrint.document.close();
  };

  // Se o usuário não tiver nível 1..5 (por exemplo, PROFESSOR comum), tela de bloqueio com mensagem clara
  if (!isAuthorized) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-8 bg-white rounded-3xl border border-rose-200/80 border-l-4 border-l-rose-500 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] text-center space-y-4">
        <div className="w-14 h-14 bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center mx-auto text-xl">
          <i className="fa-solid fa-lock"></i>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Módulo de Gestão e Registros de Professores</h2>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-lg mx-auto">
            O módulo <strong className="font-semibold text-slate-700">Professores</strong> é reservado exclusivamente para os perfis autorizados da escola:
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold">
          <span className="px-3 py-1 bg-indigo-50 text-indigo-900 rounded-lg border border-indigo-200/70">1. Diretor</span>
          <span className="px-3 py-1 bg-blue-50 text-blue-900 rounded-lg border border-blue-200/70">2. Vice-Diretor</span>
          <span className="px-3 py-1 bg-emerald-50 text-emerald-900 rounded-lg border border-emerald-200/70">3. CGPG</span>
          <span className="px-3 py-1 bg-purple-50 text-purple-900 rounded-lg border border-purple-200/70">4. PAAC</span>
          <span className="px-3 py-1 bg-teal-50 text-teal-900 rounded-lg border border-teal-200/70">5. Secretaria</span>
        </div>
        <div className="text-xs text-slate-400">
          Seu perfil atual ({userRole || activeUser.cargo}) não tem privilégio de acesso a este módulo.
        </div>
      </div>
    );
  }

  const hierarquiaConfig = HIERARQUIA_CONFIG[viewerNivel] || HIERARQUIA_CONFIG[1];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* 1. Header Principal Glassmorphism */}
      <div className="bg-white/90 backdrop-blur-md p-5 sm:p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-chalkboard-user text-lg"></i>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Professores &amp; Equipe Escolar
                </h1>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-lg border flex items-center gap-1.5 ${hierarquiaConfig.badgeClass}`}>
                  <i className="fa-solid fa-shield-halved text-[10px]"></i>
                  <span>{hierarquiaConfig.nome} &middot; Nível {viewerNivel}</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">
                {hierarquiaConfig.descricao}. Registros institucionais de alinhamentos pedagógicos, observações de aula e ocorrências.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleAbrirNovaAnotacao()}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <i className="fa-solid fa-plus text-xs"></i>
              <span>Nova Anotação</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFormCadastro({
                  id: '',
                  nome: '',
                  email: '',
                  cargo: 'Professor PEI',
                  disciplina: 'Língua Portuguesa',
                  telefone: '',
                  habilitarLogin: true,
                  senha: ''
                });
                setModalCadastro(true);
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-semibold text-xs rounded-xl border border-slate-200/80 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <i className="fa-solid fa-user-plus text-xs text-indigo-600"></i>
              <span>Cadastrar / Vincular</span>
            </button>
          </div>
        </div>

        {/* Faixa de Regra de Visibilidade */}
        <div className="pt-4 border-t border-slate-200/70 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-circle-info text-indigo-600 text-sm shrink-0"></i>
            <span>
              <strong className="font-semibold text-slate-700">Regra de visibilidade:</strong> Você visualiza anotações do seu nível e dos níveis inferiores.
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] overflow-x-auto no-scrollbar pb-0.5">
            {[
              { n: 1, label: '1. Diretor' },
              { n: 2, label: '2. Vice' },
              { n: 3, label: '3. CGPG' },
              { n: 4, label: '4. PAAC' },
              { n: 5, label: '5. Secretaria' }
            ].map((h, i) => (
              <React.Fragment key={h.n}>
                {i > 0 && <i className="fa-solid fa-chevron-right text-[8px] text-slate-300 shrink-0"></i>}
                <span className={`px-2 py-0.5 rounded-md font-semibold whitespace-nowrap shrink-0 ${
                  viewerNivel === h.n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {h.label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Bento KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Equipe Cadastrada</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{stats.totalEquipe}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-users"></i>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Anotações Visíveis</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{stats.totalVisiveis}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-clipboard-check"></i>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Alinhamentos</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{stats.totalAlinhamentos}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-graduation-cap"></i>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 truncate">Observações</div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{stats.totalObservacoes}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-base shrink-0">
            <i className="fa-solid fa-eye"></i>
          </div>
        </div>
      </div>

      {/* 3. Segmented Control Sub-Abas */}
      <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-2xl border border-slate-200/60 w-fit max-w-full overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setSubTab('equipe')}
          className={`px-4 py-2 text-xs font-semibold flex items-center gap-2 rounded-xl cursor-pointer transition-all whitespace-nowrap shrink-0 ${
            subTab === 'equipe'
              ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200/70'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <i className={`fa-solid fa-address-book text-xs ${subTab === 'equipe' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
          <span>Relação de Professores</span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">{professoresFiltrados.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('timeline')}
          className={`px-4 py-2 text-xs font-semibold flex items-center gap-2 rounded-xl cursor-pointer transition-all whitespace-nowrap shrink-0 ${
            subTab === 'timeline'
              ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-200/70'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <i className={`fa-solid fa-timeline text-xs ${subTab === 'timeline' ? 'text-indigo-600' : 'text-slate-400'}`}></i>
          <span>Linha do Tempo</span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">{anotacoesPermitidas.length}</span>
        </button>
      </div>

      {/* SUB-ABA 1: RELAÇÃO DE PROFESSORES E FUNCIONÁRIOS */}
      {subTab === 'equipe' && (
        <div className="space-y-4">
          {/* Command Bar de Filtros */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="relative w-full lg:w-80">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={buscaTermo}
                onChange={e => setBuscaTermo(e.target.value)}
                placeholder="Buscar por nome, e-mail ou disciplina..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {[
                { id: 'TODOS', label: 'Todos' },
                { id: 'PROFESSORES', label: 'Professores' },
                { id: 'PAAC', label: 'PAAC' },
                { id: 'COORDENADORES', label: 'CGPG' },
                { id: 'DIRECAO', label: 'Direção' },
                { id: 'FUNCIONARIOS', label: 'Secretaria' },
              ].map(pill => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setFiltroCargo(pill.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filtroCargo === pill.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50/80 text-slate-600 border-slate-200/80 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Grid de Professores */}
          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80">
              <i className="fa-solid fa-spinner animate-spin text-2xl mb-2 text-indigo-600 block"></i>
              <span className="text-xs font-medium">Carregando dados dos professores...</span>
            </div>
          ) : professoresFiltrados.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80">
              <i className="fa-solid fa-user-slash text-3xl mb-2 text-slate-300 block"></i>
              <span className="text-xs font-medium">Nenhum professor ou funcionário encontrado com os filtros aplicados.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {professoresFiltrados.map(prof => {
                const qtdAnotacoes = contagemAnotacoesPorProf[prof.id] || contagemAnotacoesPorProf[prof.email] || 0;
                const temSenha = Boolean(prof.senha || prof.acesso_login);
                const cargoStr = prof.cargo || prof.nivel || 'Professor PEI';
                const discStr = prof.disciplina || 'Geral / PEI';
                const iniciais = (prof.nome || 'P')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(p => p[0].toUpperCase())
                  .join('');

                return (
                  <div
                    key={prof.id || prof.email}
                    className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-slate-300/80 transition-colors flex flex-col justify-between space-y-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                            {iniciais}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-900 leading-snug truncate" title={prof.nome}>
                              {prof.nome}
                            </h3>
                            <p className="text-xs font-medium text-indigo-600 truncate mt-0.5">
                              {cargoStr}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 shrink-0 tabular-nums border ${
                            qtdAnotacoes > 0
                              ? 'bg-indigo-50/80 text-indigo-900 border-indigo-200/60'
                              : 'bg-slate-50 text-slate-400 border-slate-200/60'
                          }`}
                          title={`${qtdAnotacoes} anotações visíveis para você`}
                        >
                          <i className="fa-solid fa-clipboard-list text-[10px]"></i>
                          <span>{qtdAnotacoes}</span>
                        </span>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">Disciplina</span>
                          <span className="font-medium text-slate-700 text-right truncate">{discStr}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">E-mail</span>
                          <span className="font-mono text-[11px] text-slate-600 truncate max-w-[180px]" title={prof.email}>
                            {prof.email || '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">Acesso</span>
                          <span className={`text-[11px] font-semibold flex items-center gap-1 ${
                            temSenha ? 'text-emerald-700' : 'text-slate-400'
                          }`}>
                            <i className={`fa-solid ${temSenha ? 'fa-circle-check text-emerald-600' : 'fa-circle-xmark'}`}></i>
                            <span>{temSenha ? 'Habilitado' : 'Sem Senha'}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModalDossie(prof)}
                        className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer tabular-nums"
                        title="Ver histórico pedagógico, alinhamentos e observações deste professor"
                      >
                        <i className="fa-solid fa-address-card text-slate-300"></i>
                        <span>Dossiê ({qtdAnotacoes})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAbrirNovaAnotacao(prof)}
                        className="p-2 w-9 h-9 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/70 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center cursor-pointer"
                        title="Adicionar anotação para este professor"
                      >
                        <i className="fa-solid fa-plus"></i>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormCadastro({
                            id: prof.id || '',
                            nome: prof.nome || '',
                            email: prof.email || '',
                            cargo: prof.cargo || prof.nivel || 'Professor PEI',
                            disciplina: prof.disciplina || 'Língua Portuguesa',
                            telefone: prof.telefone || '',
                            habilitarLogin: Boolean(prof.senha || prof.acesso_login),
                            senha: prof.senha || ''
                          });
                          setModalCadastro(true);
                        }}
                        className="p-2 w-9 h-9 bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center cursor-pointer"
                        title="Editar cadastro / Vincular login no sistema"
                      >
                        <i className="fa-solid fa-pen-to-square"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-ABA 2: LINHA DO TEMPO GERAL DE ANOTAÇÕES */}
      {subTab === 'timeline' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="relative flex-1 min-w-[220px]">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={buscaTextoAnotacao}
                onChange={e => setBuscaTextoAnotacao(e.target.value)}
                placeholder="Buscar em título, relato ou professor..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filtroProfessorAnotacao}
                onChange={e => setFiltroProfessorAnotacao(e.target.value)}
                className="px-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer max-w-[200px]"
              >
                <option value="">Todos os Professores</option>
                {professores.map(p => (
                  <option key={p.id || p.email} value={p.id || p.email}>
                    {p.nome}
                  </option>
                ))}
              </select>

              <select
                value={filtroCategoriaAnotacao}
                onChange={e => setFiltroCategoriaAnotacao(e.target.value)}
                className="px-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              >
                <option value="">Todas as Categorias</option>
                {CATEGORIAS_ANOTACAO.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>

              <select
                value={filtroNivelAutor}
                onChange={e => setFiltroNivelAutor(e.target.value)}
                className="px-3 py-2 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              >
                <option value="">Todos os Autores</option>
                {viewerNivel <= 1 && <option value="1">1. Diretor</option>}
                {viewerNivel <= 2 && <option value="2">2. Vice-Diretor</option>}
                {viewerNivel <= 3 && <option value="3">3. CGPG</option>}
                {viewerNivel <= 4 && <option value="4">4. PAAC</option>}
                {viewerNivel <= 5 && <option value="5">5. Secretaria</option>}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80">
              <i className="fa-solid fa-spinner animate-spin text-2xl mb-2 text-indigo-600 block"></i>
              <span className="text-xs font-medium">Carregando linha do tempo...</span>
            </div>
          ) : timelineFiltrada.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-white rounded-3xl border border-slate-200/80">
              <i className="fa-solid fa-clipboard-question text-3xl mb-2 text-slate-300 block"></i>
              <span className="text-xs font-medium">Nenhuma anotação corresponde aos critérios ou está dentro da sua alçada de visibilidade.</span>
            </div>
          ) : (
            <div className="space-y-3">
              {timelineFiltrada.map(anot => {
                const catObj = CATEGORIAS_ANOTACAO.find(c => c.id === anot.categoria) || {
                  nome: anot.categoria || 'Geral',
                  icone: 'fa-file-lines',
                  cor: 'slate'
                };
                const autorNivelInt = Number(anot.autorNivel || 4);
                const autorHierarquia = HIERARQUIA_CONFIG[autorNivelInt] || HIERARQUIA_CONFIG[4];
                const isConfirming = confirmDeleteId === anot.id;

                return (
                  <div
                    key={anot.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] hover:border-slate-300/80 transition-colors space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-900 text-white flex items-center gap-1.5">
                          <i className="fa-solid fa-user-tie text-slate-300 text-[11px]"></i>
                          <span>{anot.professorNome}</span>
                        </span>

                        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 flex items-center gap-1.5">
                          <i className={`fa-solid ${catObj.icone} text-indigo-600 text-[11px]`}></i>
                          <span>{catObj.nome}</span>
                        </span>

                        <span
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border ${autorHierarquia.pillClass}`}
                          title={`Registrado pelo cargo ${autorHierarquia.nome} (Nível ${autorNivelInt})`}
                        >
                          <i className="fa-solid fa-shield-halved text-[10px]"></i>
                          <span>{autorHierarquia.nome}: {anot.autorNome || anot.autorEmail}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium tabular-nums">
                        <i className="fa-solid fa-calendar-day text-slate-400"></i>
                        <span>{anot.dataOcorrencia || '-'}</span>
                        {anot.horario && <span>às {anot.horario}</span>}

                        {(viewerNivel === 1 || (anot.autorEmail && anot.autorEmail.toLowerCase() === activeUser.email.toLowerCase())) && (
                          <div className="flex items-center gap-1 ml-1">
                            {isConfirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-semibold rounded-lg cursor-pointer"
                              >
                                Cancelar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleExcluirAnotacao(anot)}
                              className={`px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 ${
                                isConfirming
                                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                                  : 'text-rose-500 hover:text-rose-700 hover:bg-rose-50'
                              }`}
                              title={isConfirming ? 'Clique novamente para confirmar exclusão' : 'Excluir anotação'}
                            >
                              <i className="fa-solid fa-trash-can"></i>
                              {isConfirming && <span>Confirmar</span>}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 mb-1">
                        {anot.titulo}
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {anot.conteudo}
                      </p>
                    </div>

                    {anot.encaminhamentos && (
                      <div className="p-3 bg-amber-50/80 border border-amber-200/60 border-l-4 border-l-amber-500 rounded-xl text-xs text-amber-950">
                        <strong className="block text-xs font-semibold text-amber-900 mb-0.5">
                          <i className="fa-solid fa-bullseye mr-1.5"></i>Encaminhamentos &amp; Prazos Combinados
                        </strong>
                        <span className="whitespace-pre-wrap">{anot.encaminhamentos}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: DOSSIÊ INDIVIDUAL DO PROFESSOR (BOTTOM-SHEET MOBILE / DIALOG DESKTOP) */}
      {modalDossie && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0" />
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200/70 bg-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
                  <i className="fa-solid fa-id-card-clip"></i>
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] font-medium text-slate-500 block">
                    Dossiê do Docente &middot; Registro Pedagógico
                  </span>
                  <h3 className="text-base font-bold text-slate-900 leading-tight truncate">{modalDossie.nome}</h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const profAnotacoes = anotacoesPermitidas.filter(
                      a => a.professorId === modalDossie.id || a.professorEmail === modalDossie.email
                    );
                    handleImprimirDossie(modalDossie, profAnotacoes);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Imprimir relatório do dossiê"
                >
                  <i className="fa-solid fa-print text-slate-600"></i>
                  <span className="hidden sm:inline">Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalDossie(null)}
                  className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
              {/* Card de Identificação */}
              <div className="bg-slate-50/80 border border-slate-200/70 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">Função / Cargo</span>
                  <span className="font-semibold text-slate-800">{modalDossie.cargo || modalDossie.nivel || 'Professor PEI'}</span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">Disciplina</span>
                  <span className="font-semibold text-slate-800">{modalDossie.disciplina || 'Geral'}</span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">E-mail</span>
                  <span className="font-mono text-[11px] text-slate-700 break-all">{modalDossie.email || '-'}</span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">Telefone</span>
                  <span className="font-medium text-slate-800 tabular-nums">{modalDossie.telefone || 'Não informado'}</span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">Login no Sistema</span>
                  <span className={`font-semibold ${modalDossie.senha || modalDossie.acesso_login ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {modalDossie.senha || modalDossie.acesso_login ? 'Habilitado' : 'Sem Senha'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block">Anotações Visíveis</span>
                  <span className="font-semibold text-indigo-700 tabular-nums">
                    {
                      anotacoesPermitidas.filter(
                        a => a.professorId === modalDossie.id || a.professorEmail === modalDossie.email
                      ).length
                    }
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <h4 className="text-xs font-semibold text-slate-700">
                  Histórico de Registros Pedagógicos
                </h4>
                <button
                  type="button"
                  onClick={() => handleAbrirNovaAnotacao(modalDossie)}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-plus text-xs"></i>
                  <span>Nova Anotação</span>
                </button>
              </div>

              {(() => {
                const profAnotacoes = anotacoesPermitidas.filter(
                  a => a.professorId === modalDossie.id || a.professorEmail === modalDossie.email
                );

                if (profAnotacoes.length === 0) {
                  return (
                    <div className="p-8 text-center text-slate-400 bg-slate-50/70 border border-slate-200/70 rounded-2xl text-xs">
                      Nenhuma anotação cadastrada para este professor dentro da sua alçada hierárquica.
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {profAnotacoes.map(anot => {
                      const catObj = CATEGORIAS_ANOTACAO.find(c => c.id === anot.categoria) || {
                        nome: anot.categoria || 'Geral',
                        icone: 'fa-file-lines'
                      };
                      const autorNivelInt = Number(anot.autorNivel || 4);
                      const autorHierarquia = HIERARQUIA_CONFIG[autorNivelInt] || HIERARQUIA_CONFIG[4];

                      return (
                        <div
                          key={anot.id}
                          className="bg-white border border-slate-200/80 rounded-2xl p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700">
                                <i className={`fa-solid ${catObj.icone} text-indigo-600 mr-1`}></i>
                                {catObj.nome}
                              </span>
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${autorHierarquia.pillClass}`}>
                                {autorHierarquia.nome}: {anot.autorNome || anot.autorEmail}
                              </span>
                            </div>
                            <span className="text-slate-400 font-medium text-[11px] tabular-nums">
                              {anot.dataOcorrencia || ''} {anot.horario ? 'às ' + anot.horario : ''}
                            </span>
                          </div>

                          <div className="text-xs sm:text-sm font-semibold text-slate-900">{anot.titulo}</div>
                          <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{anot.conteudo}</div>

                          {anot.encaminhamentos && (
                            <div className="p-2.5 bg-amber-50/80 border border-amber-200/60 border-l-4 border-l-amber-500 rounded-xl text-xs text-amber-950">
                              <strong className="font-semibold">Encaminhamentos / Prazos:</strong> {anot.encaminhamentos}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: NOVA ANOTAÇÃO (BOTTOM-SHEET MOBILE / DIALOG DESKTOP) */}
      {modalNovaAnotacao && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0" />
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200/70 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-pen-nib"></i>
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">Novo Registro de Professor</h3>
                  <p className="text-xs text-slate-500">
                    Por <strong className="font-semibold text-slate-700">{activeUser.nome}</strong> ({hierarquiaConfig.nome} &middot; Nível {viewerNivel})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalNovaAnotacao(false)}
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSalvarAnotacao} className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Professor ou Funcionário <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formAnotacao.professorId}
                  onChange={e => setFormAnotacao({ ...formAnotacao, professorId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                  required
                >
                  <option value="">-- Selecione o Professor ou Funcionário --</option>
                  {professores.map(p => (
                    <option key={p.id || p.email} value={p.id || p.email}>
                      {p.nome} — {p.cargo || p.nivel || 'Professor'} ({p.disciplina || 'Geral'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Tipo de Registro / Categoria <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formAnotacao.categoria}
                    onChange={e => setFormAnotacao({ ...formAnotacao, categoria: e.target.value })}
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                  >
                    {CATEGORIAS_ANOTACAO.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Data do Fato / Reunião <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formAnotacao.dataOcorrencia}
                    onChange={e => setFormAnotacao({ ...formAnotacao, dataOcorrencia: e.target.value })}
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Título / Assunto Principal <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formAnotacao.titulo}
                  onChange={e => setFormAnotacao({ ...formAnotacao, titulo: e.target.value })}
                  placeholder="Ex: Alinhamento sobre plano de aula do 2º Bimestre"
                  className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Relato / Descrição Pedagógica ou Administrativa <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={formAnotacao.conteudo}
                  onChange={e => setFormAnotacao({ ...formAnotacao, conteudo: e.target.value })}
                  placeholder="Descreva detalhadamente o ocorrido, observação em sala de aula, orientações repassadas ou feedback prestado..."
                  className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 leading-relaxed resize-y"
                  required
                ></textarea>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Encaminhamentos / Prazos Combinados (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={formAnotacao.encaminhamentos}
                  onChange={e => setFormAnotacao({ ...formAnotacao, encaminhamentos: e.target.value })}
                  placeholder="Metas combinadas com o professor, datas de nova entrega ou providências acertadas..."
                  className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 leading-relaxed resize-y"
                ></textarea>
              </div>

              <div className="p-3 bg-indigo-50/80 border border-indigo-200/60 border-l-4 border-l-indigo-600 rounded-xl text-xs text-slate-800 flex items-center gap-2.5">
                <i className="fa-solid fa-shield-halved text-indigo-600 text-base shrink-0"></i>
                <div>
                  <strong className="font-semibold">Gravação Segura:</strong> Este registro será vinculado ao seu nível <strong className="font-semibold">{hierarquiaConfig.nome} (Nível {viewerNivel})</strong>. Perfis inferiores não terão permissão de leitura.
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalNovaAnotacao(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>Salvar Anotação</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CADASTRAR / VINCULAR PROFESSOR (BOTTOM-SHEET MOBILE / DIALOG DESKTOP) */}
      {modalCadastro && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0" />
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200/70 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-user-plus"></i>
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {formCadastro.id ? 'Editar Dados do Professor' : 'Cadastrar / Vincular Professor'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sincronizado com a base de usuários do sistema
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalCadastro(false)}
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSalvarCadastro} className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nome Completo <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formCadastro.nome}
                  onChange={e => setFormCadastro({ ...formCadastro, nome: e.target.value })}
                  placeholder="Ex: Carlos Eduardo de Oliveira"
                  className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    E-mail Institucional <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formCadastro.email}
                    onChange={e => setFormCadastro({ ...formCadastro, email: e.target.value })}
                    placeholder="professor@clovis.com"
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Cargo / Função <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formCadastro.cargo}
                    onChange={e => setFormCadastro({ ...formCadastro, cargo: e.target.value })}
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                  >
                    <option value="Professor PEI">Professor PEI</option>
                    <option value="Professor Titular">Professor Titular</option>
                    <option value="Professor Eventual">Professor Eventual / Substituto</option>
                    <option value="PAAC">PAAC (Apoio ao Currículo)</option>
                    <option value="CGPG">CGPG (Coordenador Geral)</option>
                    <option value="VICE_DIRETOR">Vice-Diretor</option>
                    <option value="DIRETOR">Diretor de Escola</option>
                    <option value="AOE">AOE (Organização Escolar)</option>
                    <option value="Secretaria">Secretaria Escolar</option>
                    <option value="Outro">Outro Funcionário</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Componente Curricular
                  </label>
                  <input
                    type="text"
                    value={formCadastro.disciplina}
                    onChange={e => setFormCadastro({ ...formCadastro, disciplina: e.target.value })}
                    placeholder="Ex: Matemática, Português..."
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={formCadastro.telefone}
                    onChange={e => setFormCadastro({ ...formCadastro, telefone: e.target.value })}
                    placeholder="(11) 99999-9999"
                    className="w-full p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50/80 border border-slate-200/70 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                    <i className="fa-solid fa-key text-indigo-600"></i>
                    <span>Acesso ao Sistema (Login)</span>
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formCadastro.habilitarLogin}
                      onChange={e => setFormCadastro({ ...formCadastro, habilitarLogin: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-900"></div>
                  </label>
                </div>

                {formCadastro.habilitarLogin && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Definir / Alterar Senha de Login
                    </label>
                    <input
                      type="text"
                      value={formCadastro.senha}
                      onChange={e => setFormCadastro({ ...formCadastro, senha: e.target.value })}
                      placeholder={formCadastro.id ? 'Deixe em branco para manter a senha atual' : 'Ex: escola123'}
                      className="w-full p-2.5 bg-white border border-slate-200/80 rounded-xl text-xs font-mono font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      Ao salvar, este usuário poderá fazer login com este e-mail e senha.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalCadastro(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>Salvar Dados</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
