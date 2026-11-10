import { db, collection, addDoc, serverTimestamp } from '../lib/database';
import { obterUsuarioAtivoCompleto } from './authHelper';

/**
 * Módulo Central de Trilha de Auditoria (Audit Log)
 * Registra eventos de alteração (CRIAR, ATUALIZAR, EXCLUIR, etc.) no MongoDB Atlas.
 */

export async function registrarLogAuditoria(param1, acaoArg, descArg, detalhesArg, usuarioInfoArg) {
  let modulo, acao, descricao, detalhes, usuarioInfo;
  if (param1 && typeof param1 === 'object') {
    ({ modulo, acao, descricao, detalhes = null, usuarioInfo = null } = param1);
  } else {
    modulo = param1;
    acao = acaoArg;
    descricao = descArg;
    detalhes = detalhesArg || null;
    usuarioInfo = usuarioInfoArg || null;
  }

  const acaoUpper = String(acao || "").toUpperCase().trim();
  const moduloLower = String(modulo || "").toLowerCase().trim();

  try {
    const userAtivo = usuarioInfo || (typeof window !== 'undefined' && typeof window.obterIdentificacaoUsuarioCompleta === 'function' ? window.obterIdentificacaoUsuarioCompleta() : obterUsuarioAtivoCompleto());

    const usuarioNome = userAtivo.nome || 'Usuário do Sistema';
    const usuarioEmail = userAtivo.email || 'usuario@escola.sp.gov.br';
    const usuarioRole = userAtivo.cargo || userAtivo.role || 'PROFESSOR';
    const formatoCompleto = userAtivo.formatoCompleto || userAtivo.textoCompleto || `${usuarioNome} (${usuarioEmail} - ${usuarioRole})`;

    const now = new Date();
    const isoDate = now.toISOString();

    const logData = {
      modulo: modulo || 'Geral',
      acao: String(acao || 'ALTERAÇÃO').toUpperCase(),
      descricao: descricao || 'Alteração registrada no sistema.',
      detalhes: detalhes ? (typeof detalhes === 'object' ? JSON.stringify(detalhes) : String(detalhes)) : null,
      usuarioNome: usuarioNome,
      usuarioEmail: usuarioEmail,
      usuarioRole: usuarioRole,
      usuarioFormatoCompleto: formatoCompleto,
      usuario: usuarioNome,
      cargo: usuarioRole,
      email: usuarioEmail,
      timestamp: serverTimestamp(),
      dataHoraISO: isoDate,
      criadoEm: now.getTime()
    };

    const docRef = await addDoc(collection(db, 'audit_logs'), logData);
    console.log(`[AuditLog] Registrado com sucesso ID: ${docRef.id} - ${modulo} (${acao}) por ${usuarioNome}`);
    return docRef.id;
  } catch (err) {
    console.warn('[AuditLog] Erro ao registrar log de auditoria:', err);
    return null;
  }
}

// Garantir retrocompatibilidade com chamadas no window
if (typeof window !== 'undefined') {
  window.registrarLogAuditoria = registrarLogAuditoria;
}

export default registrarLogAuditoria;

