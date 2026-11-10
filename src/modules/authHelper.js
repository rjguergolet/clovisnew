import { auth } from '../lib/auth';

/**
 * Módulo de Identificação Universal do Usuário Logado
 * Garante extração precisa de Nome, E-mail e Cargo do responsável ativo.
 */

export function normalizarCargo(cargoStr) {
  if (!cargoStr) return 'PROFESSOR';
  const str = String(cargoStr).toUpperCase().trim();
  if (str.includes('VICE')) return 'VICE_DIRETOR';
  if (str.includes('DIRETOR')) return 'DIRETOR';
  if (str.includes('CGPG') || str.includes('COORDENADOR') || str.includes('CGPCG')) return 'CGPG';
  if (str.includes('SECRETARIA')) return 'SECRETARIA';
  if (str.includes('PAAC')) return 'PAAC';
  if (str.includes('PROFESSOR') || str.includes('TUTOR')) return 'PROFESSOR';
  return str.replace(/[^A-Z0-9_]/g, '_') || 'PROFESSOR';
}

export function obterUsuarioAtivoCompleto() {
  let currentUser = null;
  try {
    currentUser = auth?.currentUser || (typeof window !== 'undefined' && window.auth?.currentUser);
  } catch (e) {
    currentUser = null;
  }

  let email = currentUser?.email?.trim() || '';
  let displayName = currentUser?.displayName?.trim() || '';
  let cargo = '';

  // Tentar extrair do localStorage ("usuarioLogado")
  let usuarioSalvoObj = null;
  if (typeof window !== 'undefined') {
    const rawSaved = localStorage.getItem('usuarioLogado');
    if (rawSaved) {
      try {
        usuarioSalvoObj = JSON.parse(rawSaved);
      } catch (e) {}
    }
  }

  if (usuarioSalvoObj) {
    if (!email && usuarioSalvoObj.email) {
      email = String(usuarioSalvoObj.email).trim();
    }
    if (!displayName) {
      displayName = (usuarioSalvoObj.nome || usuarioSalvoObj.nomeCompleto || usuarioSalvoObj.displayName || '').trim();
    }
    if (!cargo) {
      cargo = usuarioSalvoObj.nivelAcesso || usuarioSalvoObj.nivel || usuarioSalvoObj.cargo || usuarioSalvoObj.userRole || '';
    }
  }

  // Fallback de email do localStorage se ainda vazio
  if (!email && typeof window !== 'undefined') {
    email = (localStorage.getItem('usuario_email') || localStorage.getItem('user_email') || '').trim();
  }

  // Fallback de displayName do localStorage se ainda vazio
  if (!displayName && typeof window !== 'undefined') {
    displayName = (localStorage.getItem('usuario_nome') || localStorage.getItem('user_nome') || localStorage.getItem('usuario_logado') || '').trim();
  }

  // Fallback de cargo se ainda vazio
  if (!cargo && typeof window !== 'undefined') {
    if (typeof window.obterRoleAtual === 'function') {
      cargo = window.obterRoleAtual();
    } else {
      cargo = localStorage.getItem('usuario_cargo') || localStorage.getItem('usuario_nivel') || window.currentUserRole || window.userRole || 'PROFESSOR';
    }
  }

  cargo = normalizarCargo(cargo);

  // Tratar nomes genéricos/inválidos ou em branco
  const nomesGenericos = ['USUARIO', 'USUÁRIO', 'USUÁRIO NÃO IDENTIFICADO', 'USUÁRIO DESCONHECIDO', 'GESTAO', 'GESTAO ESCOLAR', 'USER', 'ADMIN', 'ANÔNIMO'];
  if (!displayName || nomesGenericos.includes(displayName.toUpperCase())) {
    if (email && email.includes('@')) {
      const parts = email.split('@')[0].split(/[._-]/);
      displayName = parts
        .filter(Boolean)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
    } else {
      displayName = 'Usuário do Sistema';
    }
  }

  const emailFinal = email || 'usuario@escola.sp.gov.br';
  const formatoCompleto = `${displayName} (${emailFinal} - ${cargo})`;

  const result = {
    nome: displayName,
    email: emailFinal,
    cargo: cargo,
    formatoCompleto: formatoCompleto,
    textoCompleto: formatoCompleto
  };

  return result;
}

export const obterUsuarioLogadoCompleto = obterUsuarioAtivoCompleto;
export const obterIdentificacaoUsuarioCompleta = obterUsuarioAtivoCompleto;

if (typeof window !== 'undefined') {
  window.obterUsuarioAtivoCompleto = obterUsuarioAtivoCompleto;
  window.obterUsuarioLogadoCompleto = obterUsuarioLogadoCompleto;
  window.obterIdentificacaoUsuarioCompleta = obterUsuarioAtivoCompleto;
}

export default {
  obterUsuarioAtivoCompleto,
  obterUsuarioLogadoCompleto,
  obterIdentificacaoUsuarioCompleta,
  normalizarCargo
};
