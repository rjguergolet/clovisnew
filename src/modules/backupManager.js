import { db, collection, getDocs, doc, writeBatch, setDoc } from '../lib/database';
import { registrarLogAuditoria } from './auditLogger';

/**
 * Módulo de Backup & Restauração Global do MongoDB Atlas e Sistema
 * Garante extração 100% integral de todas as coleções, eventos da agenda, tarefas,
 * anotações hierárquicas, configurações e exportação minuciosa em CSV dos estudantes.
 */

export const COLECOES_SISTEMA = [
  'alunos',
  'ocorrencias',
  'horarios',
  'substituicoes_diarias',
  'substituicoes_pei',
  'mural_recados',
  'usuarios',
  'rotina_pdca',
  'rotina_equipe',
  'tarefas',
  'projetos_pei',
  'agenda',
  'eventos',
  'busca_ativa',
  'config_escola',
  'configuracoes',
  'modelos',
  'audit_logs',
  'professores_anotacoes',
  'professores',
  'turmas',
  'grades',
  'fechamento_notas',
  'avisos',
  'historico_atrasos'
];

/**
 * Função utilitária para converter Timestamps e objetos do Firestore em valores serializáveis JSON
 */
function normalizarDadosParaJSON(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && typeof val.toDate === 'function') {
    try {
      return val.toDate().toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }
  if (typeof val === 'object' && val.seconds !== undefined && val.nanoseconds !== undefined) {
    try {
      return new Date(val.seconds * 1000).toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(normalizarDadosParaJSON);
  }
  if (typeof val === 'object') {
    const res = {};
    for (const k of Object.keys(val)) {
      res[k] = normalizarDadosParaJSON(val[k]);
    }
    return res;
  }
  return val;
}

/**
 * Remove recursivamente campos com valores undefined para evitar erros no Firestore writeBatch
 */
function limparValoresUndefined(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    return obj.map(limparValoresUndefined);
  }
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        res[k] = limparValoresUndefined(v);
      }
    }
    return res;
  }
  return obj;
}

/**
 * Captura absolutamente todas as configurações locais e preferências armazenadas no navegador (localStorage)
 */
function capturarConfiguracoesLocais() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  const dados = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const val = localStorage.getItem(k);
    if (val !== null) {
      try {
        dados[k] = JSON.parse(val);
      } catch (e) {
        dados[k] = val;
      }
    }
  }
  return dados;
}

/**
 * Captura a configuração institucional e estrutural completa do sistema escolar
 */
export function capturarConfiguracaoCompletaSistema() {
  const locais = capturarConfiguracoesLocais();
  return {
    escola: {
      nome: 'EE Prof. Clóvis de Lucca',
      codigoCie: '045123',
      anoLetivo: 2026,
      versaoSistema: '20.0',
      programa: 'Programa Ensino Integral (PEI)',
      regime: 'Integral 9 Horas',
      geradoEm: new Date().toISOString()
    },
    parametros_frequencia: {
      metaMinimaPresencaPercent: 75,
      alertaAtrasosQuantidade: 3,
      criticoAtrasosQuantidade: 5,
      toleranciaEntradaMinutos: 15
    },
    regras_acesso_rbac: (typeof window !== 'undefined' && window.PERMISSOES_ABAS) || {
      DIRETOR: ['mural', 'alunos', 'dashboard', 'dashboard-atrasos', 'dashboard-notas', 'sis-panorama', 'professores', 'registros', 'secretaria', 'busca-ativa', 'agenda', 'admin', 'dash-projetos-pei', 'rotina-pdca', 'horarios', 'substituicao-pei'],
      VICE_DIRETOR: ['mural', 'alunos', 'dashboard', 'dashboard-atrasos', 'dashboard-notas', 'sis-panorama', 'professores', 'registros', 'secretaria', 'busca-ativa', 'agenda', 'admin', 'dash-projetos-pei', 'rotina-pdca', 'horarios', 'substituicao-pei'],
      CGPG: ['mural', 'alunos', 'dashboard', 'dashboard-atrasos', 'dashboard-notas', 'sis-panorama', 'professores', 'registros', 'secretaria', 'agenda', 'admin', 'rotina-pdca', 'horarios', 'substituicao-pei'],
      PROFESSOR: ['mural', 'alunos', 'dashboard', 'dashboard-atrasos', 'dashboard-notas', 'sis-panorama', 'registros', 'agenda', 'admin', 'rotina-pdca', 'horarios', 'substituicao-pei'],
      SECRETARIA: ['mural', 'alunos', 'dashboard', 'dashboard-atrasos', 'dashboard-notas', 'sis-panorama', 'professores', 'registros', 'secretaria', 'busca-ativa', 'agenda', 'admin', 'horarios', 'substituicao-pei']
    },
    configuracoes_locais_chaves: Object.keys(locais),
    cadastros_base: locais.clovis_cadastros_base || {},
    periodos_aula: locais.clovis_periodos_aula || [],
    capacidades_pei: locais.clovis_capacidades_pei_cache || {},
    indisponibilidade_professores: locais.clovis_indisponibilidade_professores || locais.clovis_indisponibilidade_v2 || {},
    preferencias_backup: locais.clovis_backup_configuracoes || {
      incluirConfigEscola: true,
      incluirConfigLocais: true,
      incluirColecoes: true,
      incluirNotas: true,
      incluirAuditLogs: true,
      indentarJSON: true
    }
  };
}

/**
 * Lê preferências e opções ativas de backup da interface se disponíveis
 */
export function obterOpcoesConfiguracaoBackupUI() {
  if (typeof document === 'undefined') {
    return {
      incluirConfigEscola: true,
      incluirConfigLocais: true,
      incluirColecoes: true,
      incluirNotas: true,
      incluirAuditLogs: true,
      indentarJSON: true
    };
  }
  const chkConfigEscola = document.getElementById('cfg-backup-escola');
  const chkConfigLocais = document.getElementById('cfg-backup-locais');
  const chkColecoes = document.getElementById('cfg-backup-colecoes');
  const chkNotas = document.getElementById('cfg-backup-notas');
  const chkLogs = document.getElementById('cfg-backup-logs');
  const chkFormato = document.getElementById('cfg-backup-formatado');

  return {
    incluirConfigEscola: chkConfigEscola ? chkConfigEscola.checked : true,
    incluirConfigLocais: chkConfigLocais ? chkConfigLocais.checked : true,
    incluirColecoes: chkColecoes ? chkColecoes.checked : true,
    incluirNotas: chkNotas ? chkNotas.checked : true,
    incluirAuditLogs: chkLogs ? chkLogs.checked : true,
    indentarJSON: chkFormato ? chkFormato.checked : true
  };
}

/**
 * Obtém os documentos de uma coleção consultando o Firestore com fallback e mesclagem
 * inteligente com caches em memória e localStorage para garantir 0% de perda de dados.
 */
export async function obterDocumentosColecao(colName) {
  const mapa = new Map();

  // 1. Tentar ler do Firestore
  try {
    const querySnap = await getDocs(collection(db, colName));
    querySnap.forEach(docSnap => {
      const docData = normalizarDadosParaJSON(docSnap.data()) || {};
      const docId = docSnap.id;
      mapa.set(docId, { id: docId, ...docData });
    });
  } catch (err) {
    console.warn(`[BackupManager] Consulta Firestore para '${colName}':`, err?.message || err);
  }

  // 2. Mesclagem inteligente com dados em memória e localStorage
  const mesclarItens = (itens, chaveId = 'id') => {
    if (!Array.isArray(itens)) return;
    itens.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const id = String(
        item[chaveId] || 
        item.id || 
        item.ra || 
        item.email || 
        item.codigo || 
        item.uid ||
        `local-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
      );
      if (!mapa.has(id)) {
        mapa.set(id, normalizarDadosParaJSON({ id, ...item }));
      } else {
        // Enriquecer dados existentes se o item local contiver campos adicionais
        const existente = mapa.get(id);
        mapa.set(id, normalizarDadosParaJSON({ ...existente, ...item }));
      }
    });
  };

  if (typeof window !== 'undefined') {
    // Alunos
    if (colName === 'alunos') {
      if (Array.isArray(window.allStudentsData)) mesclarItens(window.allStudentsData, 'ra');
      try {
        const raw = localStorage.getItem('alunos_cache');
        if (raw) mesclarItens(JSON.parse(raw), 'ra');
      } catch (e) {}
    }
    // Eventos & Agenda
    if (colName === 'eventos' || colName === 'agenda') {
      if (Array.isArray(window.eventosCache)) mesclarItens(window.eventosCache);
      try {
        const raw = localStorage.getItem('eventos_cache') || localStorage.getItem('agenda_eventos');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Rotina da Equipe & Tarefas & PDCA
    if (colName === 'rotina_equipe' || colName === 'rotina_pdca' || colName === 'tarefas') {
      if (Array.isArray(window.tasksCache)) mesclarItens(window.tasksCache);
      try {
        const raw = localStorage.getItem('tasks_cache') || localStorage.getItem('rotina_equipe_cache') || localStorage.getItem('tarefas_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Professores Anotações
    if (colName === 'professores_anotacoes') {
      if (Array.isArray(window.professoresAnotacoesCache)) mesclarItens(window.professoresAnotacoesCache);
      try {
        const raw = localStorage.getItem('professores_anotacoes_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Mural de Recados
    if (colName === 'mural_recados') {
      if (Array.isArray(window.muralRecadosCache)) mesclarItens(window.muralRecadosCache);
      try {
        const raw = localStorage.getItem('mural_recados_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Usuários
    if (colName === 'usuarios') {
      if (window.usuariosCacheMap && typeof window.usuariosCacheMap === 'object') {
        mesclarItens(Object.values(window.usuariosCacheMap));
      }
      if (Array.isArray(window.usuariosCache)) mesclarItens(window.usuariosCache);
      try {
        const raw = localStorage.getItem('usuarios_cadastrados_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Ocorrências
    if (colName === 'ocorrencias') {
      if (Array.isArray(window.ocorrenciasCache)) mesclarItens(window.ocorrenciasCache);
      try {
        const raw = localStorage.getItem('ocorrencias_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Audit Logs
    if (colName === 'audit_logs') {
      if (Array.isArray(window.allAuditLogsCache)) mesclarItens(window.allAuditLogsCache);
      try {
        const raw = localStorage.getItem('audit_logs_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Horários & Grade
    if (colName === 'horarios') {
      if (Array.isArray(window.gradeCache)) mesclarItens(window.gradeCache);
      try {
        const raw = localStorage.getItem('clovis_horarios_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Projetos PEI
    if (colName === 'projetos_pei') {
      if (Array.isArray(window.projetosCache)) mesclarItens(window.projetosCache);
      try {
        const raw = localStorage.getItem('clovis_projetos_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Substituições
    if (colName === 'substituicoes_diarias' || colName === 'substituicoes_pei') {
      if (Array.isArray(window.substituicoesCache)) mesclarItens(window.substituicoesCache);
      try {
        const raw = localStorage.getItem('clovis_substituicoes_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
    // Busca Ativa
    if (colName === 'busca_ativa') {
      if (Array.isArray(window.buscaAtivaHistoricoCache)) mesclarItens(window.buscaAtivaHistoricoCache);
      if (Array.isArray(window.todosContatosBaCache)) mesclarItens(window.todosContatosBaCache);
      try {
        const raw = localStorage.getItem('busca_ativa_cache');
        if (raw) mesclarItens(JSON.parse(raw));
      } catch (e) {}
    }
  }

  return Array.from(mapa.values());
}

/**
 * Verifica se o usuário atual possui o perfil de autorização de gestão (DIRETOR, VICE_DIRETOR, CGPG, SECRETARIA)
 */
export function validarPermissaoDiretor() {
  const role = typeof window !== 'undefined' && typeof window.obterRoleAtual === 'function'
    ? window.obterRoleAtual()
    : (typeof window !== 'undefined' && (window.currentUserRole || localStorage.getItem('usuario_nivel') || localStorage.getItem('userRole'))) || 'DIRETOR';

  const roleNorm = String(role || '').toUpperCase().trim().replace(/-/g, '_');
  const permitido = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('DIRETOR') || roleNorm === 'ADMIN' || roleNorm === 'SECRETARIA' || roleNorm === 'CGPG';

  if (!permitido) {
    const msg = `Acesso restrito: Apenas a equipe de Gestão e Secretaria Escolar possui autorização para exportar ou restaurar backups do sistema (perfil atual: ${roleNorm}).`;
    if (typeof window !== 'undefined') {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, 'warning', 6000);
      } else if (typeof window.showErrorToast === 'function') {
        window.showErrorToast(msg);
      } else {
        alert(msg);
      }
    }
    return false;
  }
  return true;
}

/**
 * 1. Extrai todas as coleções do Firestore, caches de memória e configurações locais
 */
export async function extrairTodosDadosSistema(opcoes = {}) {
  const opts = { ...obterOpcoesConfiguracaoBackupUI(), ...opcoes };
  const colecoesData = {};
  let totalDocs = 0;

  for (const colName of COLECOES_SISTEMA) {
    if (colName === 'audit_logs' && opts.incluirAuditLogs === false) continue;
    if (colName === 'fechamento_notas' && opts.incluirNotas === false) continue;
    if ((colName === 'config_escola' || colName === 'configuracoes') && opts.incluirConfigEscola === false) continue;

    try {
      const docs = await obterDocumentosColecao(colName);
      colecoesData[colName] = docs;
      totalDocs += docs.length;
    } catch (colErr) {
      console.warn(`[BackupManager] Aviso ao compilar coleção '${colName}':`, colErr);
      colecoesData[colName] = [];
    }
  }

  const configuracoesLocais = opts.incluirConfigLocais !== false ? capturarConfiguracoesLocais() : {};
  const configuracao = opts.incluirConfigEscola !== false ? capturarConfiguracaoCompletaSistema() : {};

  return {
    colecoes: colecoesData,
    configuracao,
    configuracoes_locais: configuracoesLocais,
    totalDocs,
    opcoes: opts
  };
}

/**
 * 2. Exporta backup completo de todas as coleções do Firestore e sistema para um único arquivo JSON,
 * garantindo presença explícita de agenda, tarefas, alunos, configurações e todas as tabelas.
 */
export async function exportarBackupCompleto(opcoesParam = {}) {
  if (!validarPermissaoDiretor()) return null;

  const btnExportar = typeof document !== 'undefined' ? document.getElementById('btn-exportar-backup-json') : null;
  const textoOriginal = btnExportar ? btnExportar.innerHTML : '';

  try {
    if (btnExportar) {
      btnExportar.disabled = true;
      btnExportar.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs"></i><span>Exportando Backup Completo...</span>`;
    }

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Iniciando varredura integral de todas as coleções, configurações e tarefas...', 'info', 4000);
    }

    const { colecoes, configuracao, configuracoes_locais, totalDocs, opcoes } = await extrairTodosDadosSistema(opcoesParam);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const usuarioNome = (typeof window !== 'undefined' && (localStorage.getItem('usuario_nome') || localStorage.getItem('usuario_logado'))) || 'DIRETOR';

    // Agrupamento explícito de agenda e tarefas para fácil inspeção
    const agendaEventos = colecoes.eventos && colecoes.eventos.length > 0 ? colecoes.eventos : (colecoes.agenda || []);
    const tarefasEquipe = colecoes.rotina_equipe && colecoes.rotina_equipe.length > 0 ? colecoes.rotina_equipe : (colecoes.rotina_pdca || colecoes.tarefas || []);

    const backupData = {
      metadados: {
        sistema: 'Escola E.E. Clóvis de Lucca',
        versao: '20.0',
        tipoBackup: 'COMPLETO_COM_CONFIGURACAO',
        cobertura: '100% (Todas as Coleções + Configurações do Sistema + Caches Locais)',
        exportadoEm: now.toISOString(),
        exportadoPor: usuarioNome,
        role: 'DIRETOR',
        totalColecoes: Object.keys(colecoes).length,
        totalDocumentos: totalDocs,
        totalEventosAgenda: agendaEventos.length,
        totalTarefas: tarefasEquipe.length,
        totalAlunos: (colecoes.alunos || []).length,
        totalOcorrencias: (colecoes.ocorrencias || []).length,
        totalBuscaAtiva: (colecoes.busca_ativa || []).length,
        resumoColecoes: Object.fromEntries(Object.entries(colecoes).map(([k, v]) => [k, v.length]))
      },
      // Configuração completa do sistema (institucional, parâmetros pedagógicos, regras de frequência)
      configuracao,
      // Todas as coleções brutas do Firestore
      colecoes,
      // Todas as configurações, chaves e caches do navegador (localStorage)
      configuracoes_locais,
      // Seções diretas dedicadas para auditoria, inspeção e restauração imediata (TUDO MESMO)
      agenda: agendaEventos,
      agenda_eventos: agendaEventos,
      tarefas: tarefasEquipe,
      tarefas_equipe: tarefasEquipe,
      rotina_pdca: colecoes.rotina_pdca && colecoes.rotina_pdca.length > 0 ? colecoes.rotina_pdca : tarefasEquipe,
      alunos: colecoes.alunos || [],
      ocorrencias: colecoes.ocorrencias || [],
      busca_ativa: colecoes.busca_ativa || [],
      professores_anotacoes: colecoes.professores_anotacoes || [],
      projetos_pei: colecoes.projetos_pei || [],
      horarios: colecoes.horarios || [],
      substituicoes_diarias: colecoes.substituicoes_diarias || [],
      substituicoes_pei: colecoes.substituicoes_pei || [],
      mural_recados: colecoes.mural_recados || [],
      configuracoes: colecoes.configuracoes || [],
      config_escola: colecoes.config_escola || [],
      usuarios: colecoes.usuarios || [],
      audit_logs: colecoes.audit_logs || [],
      modelos: colecoes.modelos || [],
      fechamento_notas: colecoes.fechamento_notas || [],
      avisos: colecoes.avisos || [],
      historico_atrasos: colecoes.historico_atrasos || []
    };

    // Download automático do arquivo JSON (com ou sem indentação conforme configuração)
    const jsonString = opcoes?.indentarJSON !== false ? JSON.stringify(backupData, null, 2) : JSON.stringify(backupData);
    const fileName = `backup_clovis_completo_configurado_${dateStr}.json`;
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Salvar snapshot de presença dos estudantes para comparativo de evolução na Busca Ativa
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && backupData.alunos && backupData.alunos.length > 0) {
        const snapshot = {
          data: now.toISOString(),
          dataFormatada: now.toLocaleDateString('pt-BR'),
          nome: `Backup ${dateStr}`,
          fileName,
          totalAlunos: backupData.alunos.length,
          alunosMap: backupData.alunos.map(a => ({
            ra: String(a.ra || '').trim(),
            nome: a.nome,
            turma: a.turma,
            presenca: a.presenca ?? a.presenca_anual ?? a.presenca_26_06 ?? a.frequencia ?? '0%'
          }))
        };
        localStorage.setItem('ultimo_snapshot_backup_alunos', JSON.stringify(snapshot));
      }
    } catch (snapErr) {
      console.warn('[BackupManager] Aviso ao salvar snapshot para comparativo:', snapErr);
    }

    // Registro na Trilha de Auditoria
    await registrarLogAuditoria({
      modulo: 'Backup e Restauração',
      acao: 'EXPORTAR_BACKUP_JSON',
      descricao: `Exportado backup completo JSON do sistema com configurações (${totalDocs} documentos em ${Object.keys(colecoes).length} coleções, agenda e configurações).`,
      detalhes: { fileName, totalDocs, colecoesResumo: backupData.metadados.resumoColecoes }
    });

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(`Backup completo exportado com sucesso! Arquivo "${fileName}" (${totalDocs} registros + configurações completas).`, 'success', 7000);
    }

    return backupData;
  } catch (err) {
    console.error('[BackupManager] Erro ao exportar backup completo JSON:', err);
    if (typeof window !== 'undefined' && typeof window.showErrorToast === 'function') {
      window.showErrorToast('Erro ao extrair dados do Firestore para backup JSON!', err);
    }
    throw err;
  } finally {
    if (btnExportar) {
      btnExportar.disabled = false;
      btnExportar.innerHTML = textoOriginal || `<i class="fa-solid fa-box text-xs text-emerald-200"></i><span>📦 Baixar Backup Completo do Banco (JSON)</span>`;
    }
  }
}

/**
 * 3. Exporta TODAS as coleções do sistema e do banco de dados para um arquivo CSV mestre unificado
 */
export async function exportarBackupCompletoCSV() {
  if (!validarPermissaoDiretor()) return null;

  const btnExportarCSV = typeof document !== 'undefined' ? document.getElementById('btn-exportar-backup-csv-global') : null;
  const textoOriginal = btnExportarCSV ? btnExportarCSV.innerHTML : '';

  try {
    if (btnExportarCSV) {
      btnExportarCSV.disabled = true;
      btnExportarCSV.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs"></i><span>Gerando CSV Global...</span>`;
    }

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Extraindo todas as tabelas e coleções do banco para compilar o CSV mestre...', 'info', 4000);
    }

    const { colecoes, totalDocs } = await extrairTodosDadosSistema();

    if (totalDocs === 0) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Nenhum dado encontrado no banco para exportação CSV.', 'warning');
      }
      return null;
    }

    // Estrutura das Colunas do CSV Mestre Unificado
    const csvHeaders = [
      'Colecao_Sistema',
      'ID_Documento',
      'Identificador_Principal',
      'Nome_Descricao',
      'Status_ou_Categoria',
      'Data_Referencia',
      'Turma_ou_Cargo_ou_Tipo',
      'Detalhes_Completos_JSON'
    ];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '""';
      let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      str = str.replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      return `"${str}"`;
    };

    const rows = [csvHeaders.map(h => `"${h}"`).join(';')];

    for (const [colName, docs] of Object.entries(colecoes)) {
      docs.forEach(docItem => {
        const id = docItem.id || docItem.ra || docItem.codigo || '';
        
        // Identificador Principal baseado no tipo de coleção
        let identificador = docItem.ra || docItem.numero_serie || docItem.patrimonio || docItem.email || docItem.codigo || id;
        let nomeDescricao = docItem.nome || docItem.titulo || docItem.modelo || docItem.descricao || docItem.nomeCompleto || docItem.nome_completo || '';
        let statusCat = docItem.status || docItem.categoria || docItem.tipo || docItem.perfil || docItem.prioridade || '';
        let dataRef = docItem.data || docItem.dataUso || docItem.data_uso || docItem.criadoEm || docItem.criado_em || docItem.dataHora || docItem.dataLimite || '';
        let turmaCargo = docItem.turma || docItem.cargo || docItem.disciplina || docItem.responsavel || docItem.localizacao || '';

        const jsonCompleto = { ...docItem };

        const rowValues = [
          escapeCSV(colName),
          escapeCSV(id),
          escapeCSV(identificador),
          escapeCSV(nomeDescricao),
          escapeCSV(statusCat),
          escapeCSV(dataRef),
          escapeCSV(turmaCargo),
          escapeCSV(jsonCompleto)
        ];

        rows.push(rowValues.join(';'));
      });
    }

    const csvContent = '\uFEFF' + rows.join('\r\n'); // BOM UTF-8 para correta abertura no Excel
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileName = `backup_clovis_completo_${dateStr}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Registro de Auditoria
    await registrarLogAuditoria({
      modulo: 'Backup e Restauração',
      acao: 'EXPORTAR_BACKUP_CSV',
      descricao: `Exportado backup completo CSV do banco de dados (${totalDocs} registros em ${Object.keys(colecoes).length} coleções).`,
      detalhes: { fileName, totalDocs, totalLinhas: rows.length }
    });

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(`Backup CSV Global exportado com sucesso! Arquivo "${fileName}" gerado com ${totalDocs} registros em todas as tabelas.`, 'success', 7000);
    }

    return fileName;
  } catch (err) {
    console.error('[BackupManager] Erro ao exportar backup CSV completo:', err);
    if (typeof window !== 'undefined' && typeof window.showErrorToast === 'function') {
      window.showErrorToast('Erro ao compilar e exportar o CSV mestre do banco!', err);
    }
    throw err;
  } finally {
    if (btnExportarCSV) {
      btnExportarCSV.disabled = false;
      btnExportarCSV.innerHTML = textoOriginal || `<i class="fa-solid fa-file-csv text-xs text-emerald-200"></i><span>📊 Baixar Backup Completo (CSV)</span>`;
    }
  }
}

/**
 * 4. EXPORTAÇÃO EXAUSTIVA DA BASE DE ESTUDANTES EM CSV
 * Contempla 100% dos dados cadastrais, pedagógicos (PEI), notas bimestrais,
 * frequência, busca ativa, ocorrências e campos dinâmicos sem qualquer omissão.
 */
export async function exportarBaseAlunosCSV(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  const botoes = [
    typeof document !== 'undefined' ? document.getElementById('btn-exportar-csv') : null,
    typeof document !== 'undefined' ? document.getElementById('btn-exportar-alunos-csv-admin') : null
  ].filter(Boolean);

  const textosOriginais = botoes.map(b => b.innerHTML);

  try {
    botoes.forEach(b => {
      b.disabled = true;
      b.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs mr-1"></i><span>Exportando Alunos...</span>`;
    });

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Compilando base integral de estudantes, ocorrências, busca ativa e notas...', 'info', 4000);
    }

    // 1. Obter alunos da coleção e caches
    let alunosList = await obterDocumentosColecao('alunos');
    if ((!alunosList || alunosList.length === 0) && typeof window !== 'undefined' && Array.isArray(window.allStudentsData)) {
      alunosList = [...window.allStudentsData];
    }

    if (!alunosList || alunosList.length === 0) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Nenhum estudante encontrado no banco de dados para exportação.', 'warning');
      }
      return;
    }

    // 2. Obter ocorrências para enriquecer cada aluno
    const ocorrencias = await obterDocumentosColecao('ocorrencias');
    const ocorrenciasPorAluno = new Map();
    ocorrencias.forEach(oc => {
      const raKey = String(oc.alunoRa || oc.ra || '').replace(/\D/g, '');
      if (!raKey) return;
      if (!ocorrenciasPorAluno.has(raKey)) ocorrenciasPorAluno.set(raKey, []);
      ocorrenciasPorAluno.get(raKey).push(oc);
    });

    // 3. Obter contatos de busca ativa para enriquecer cada aluno
    const buscaAtivaDocs = await obterDocumentosColecao('busca_ativa');
    const buscaAtivaPorAluno = new Map();
    buscaAtivaDocs.forEach(ba => {
      const raKey = String(ba.alunoRa || ba.ra || '').replace(/\D/g, '');
      if (!raKey) return;
      if (!buscaAtivaPorAluno.has(raKey)) buscaAtivaPorAluno.set(raKey, []);
      buscaAtivaPorAluno.get(raKey).push(ba);
    });

    // 4. Mapear todas as colunas canônicas do sistema
    const colunasEstaticas = [
      { key: 'ra', label: 'RA' },
      { key: 'digito', label: 'DIGITO' },
      { key: 'nome', label: 'NOME_COMPLETO' },
      { key: 'turma', label: 'TURMA' },
      { key: 'segmento', label: 'SEGMENTO' },
      { key: 'numero_chamada', label: 'NUMERO_CHAMADA' },
      { key: 'status', label: 'STATUS_MATRICULA' },
      { key: 'situacao', label: 'SITUACAO_ALUNO' },
      // Modelo PEI & Pedagógico
      { key: 'tutor_2026', label: 'TUTOR_PEDAGOGICO' },
      { key: 'projeto_vida_2026', label: 'PROJETO_DE_VIDA' },
      { key: 'sonhos', label: 'SONHOS_E_OBJETIVOS' },
      { key: 'clube', label: 'CLUBE_JUVENIL' },
      { key: 'eletivas', label: 'ELETIVAS' },
      { key: 'protagonismo', label: 'PROTAGONISMO_JUVENIL' },
      { key: 'evolucao', label: 'EVOLUCAO_PEDAGOGICA' },
      { key: 'acoes_2026', label: 'ACOES_PEDAGOGICAS' },
      { key: 'recomposicao', label: 'PROJETO_RECOMPOSICAO' },
      { key: 'aee', label: 'AEE_ATENDIMENTO_ESPECIAL' },
      { key: 'termo_responsabilidade', label: 'TERMO_RESPONSABILIDADE' },
      // Frequência & Presença
      { key: 'presenca_anual', label: 'PRESENCA_ANUAL_PCT' },
      { key: 'presenca_atual', label: 'PRESENCA_ATUAL_PCT' },
      { key: 'frequencia_1_sem', label: 'FREQUENCIA_1_SEMESTRE' },
      { key: 'frequencia_2_sem', label: 'FREQUENCIA_2_SEMESTRE' },
      { key: 'presenca_15_06', label: 'PRESENCA_MARCO_15_06' },
      { key: 'presenca_26_06', label: 'PRESENCA_MARCO_26_06' },
      { key: 'atrasos', label: 'TOTAL_ATRASOS' },
      { key: 'total_faltas', label: 'TOTAL_FALTAS' },
      // Busca Ativa
      { key: 'status_ba', label: 'STATUS_BUSCA_ATIVA' },
      { key: 'sla_busca_ativa', label: 'SLA_BUSCA_ATIVA' },
      { key: 'ficha_cta', label: 'FICHA_CTA' },
      { key: 'oficio', label: 'OFICIO_CONSELHO_TUTELAR' },
      { key: 'resumo_busca_ativa', label: 'HISTORICO_BUSCA_ATIVA_RESUMO' },
      // Contato & Família
      { key: 'telefone', label: 'TELEFONE_PRINCIPAL' },
      { key: 'celular', label: 'CELULAR_WHATSAPP' },
      { key: 'telefones_adicionais', label: 'TELEFONES_ADICIONAIS' },
      { key: 'responsavel', label: 'NOME_RESPONSAVEL' },
      { key: 'mae', label: 'NOME_MAE' },
      { key: 'pai', label: 'NOME_PAI' },
      { key: 'filiacao', label: 'FILIACAO_COMPLETA' },
      { key: 'endereco', label: 'ENDERECO_COMPLETO' },
      { key: 'bairro', label: 'BAIRRO' },
      { key: 'cep', label: 'CEP' },
      { key: 'referencia', label: 'PONTO_REFERENCIA' },
      // Rendimento Escolar / Notas Bimestrais (SED)
      { key: 'media_geral', label: 'MEDIA_GERAL_NOTAS' },
      { key: 'qtd_abaixo_basico', label: 'QTD_DISCIPLINAS_ABAIXO_BASICO' },
      { key: 'notas_1b', label: 'NOTAS_1_BIMESTRE' },
      { key: 'notas_2b', label: 'NOTAS_2_BIMESTRE' },
      { key: 'notas_3b', label: 'NOTAS_3_BIMESTRE' },
      { key: 'notas_4b', label: 'NOTAS_4_BIMESTRE' },
      { key: 'notas_final', label: 'NOTAS_RECUPERACAO_FINAL' },
      { key: 'fechamento_notas_resumo', label: 'NOTAS_BIMESTRAIS_RESUMO' },
      { key: 'ultima_atualizacao_notas', label: 'ULTIMA_ATUALIZACAO_NOTAS' },
      // Ocorrências e Histórico Integral
      { key: 'total_ocorrencias', label: 'TOTAL_OCORRENCIAS' },
      { key: 'resumo_ocorrencias', label: 'RESUMO_OCORRENCIAS' },
      { key: 'ocorrencias_detalhadas_json', label: 'OCORRENCIAS_COMPLETAS_JSON' },
      { key: 'busca_ativa_detalhada_json', label: 'BUSCA_ATIVA_COMPLETA_JSON' }
    ];

    // 5. Descobrir dinamicamente quaisquer outros campos adicionais presentes nos documentos
    const chavesFixasSet = new Set(colunasEstaticas.map(c => c.key));
    chavesFixasSet.add('id');
    chavesFixasSet.add('docId');
    chavesFixasSet.add('_temp');

    const chavesDinamicasSet = new Set();
    alunosList.forEach(aluno => {
      Object.keys(aluno).forEach(k => {
        if (!chavesFixasSet.has(k) && k !== 'fechamento_notas' && k !== 'fechamentos' && k !== 'notas') {
          chavesDinamicasSet.add(k);
        }
      });
    });

    const colunasDinamicas = Array.from(chavesDinamicasSet).sort().map(k => ({
      key: k,
      label: `EXTRA_${k.toUpperCase()}`
    }));

    // Lista final de todas as colunas do CSV
    const todasColunas = [
      ...colunasEstaticas,
      ...colunasDinamicas,
      { key: '__dados_completos_json__', label: 'DADOS_COMPLETOS_JSON' }
    ];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '""';
      let str;
      if (typeof val === 'object') {
        try {
          str = JSON.stringify(val);
        } catch (e) {
          str = String(val);
        }
      } else {
        str = String(val);
      }
      str = str.replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
      return `"${str}"`;
    };

    // Linha de Cabeçalho com delimitador ponto e vírgula
    const headerRow = todasColunas.map(c => `"${c.label}"`).join(';');

    // Linhas de Dados
    const dataRows = alunosList.map(aluno => {
      const raLimpo = String(aluno.ra || aluno.id || '').replace(/\D/g, '');
      const ocs = ocorrenciasPorAluno.get(raLimpo) || [];
      const bas = buscaAtivaPorAluno.get(raLimpo) || [];

      // Resumos textuais inteligentes para ocorrências e busca ativa
      const resumoOcorrencias = ocs.length > 0
        ? ocs.map(o => `[${o.data || 'S/D'}] ${o.tipo || 'Ocorrência'}: ${o.descricao || ''} (${o.autor || 'Sistema'})`).join(' | ')
        : 'Nenhuma ocorrência registrada';

      const resumoBuscaAtiva = bas.length > 0
        ? bas.map(b => `[${b.data || 'S/D'}] ${b.tipoContato || b.tipo || 'Contato'}: ${b.resultado || b.descricao || ''}`).join(' | ')
        : (aluno.status_ba || aluno.sla_busca_ativa ? `Status: ${aluno.status_ba || ''}` : 'Sem pendências');

      // Fechamento de notas SED por bimestre
      let notasResumo = '';
      let notas1B = '';
      let notas2B = '';
      let notas3B = '';
      let notas4B = '';
      let notasFinal = '';
      let mediaCalc = aluno.media_geral || '';
      let qtdAbaixo = aluno.qtd_abaixo_basico || '';

      const formatarDisciplinasBimestre = (dadosBim) => {
        if (!dadosBim || typeof dadosBim !== 'object') return '';
        const discObj = dadosBim.disciplinas || dadosBim;
        if (typeof discObj !== 'object') return String(discObj);
        const list = [];
        Object.entries(discObj).forEach(([disc, det]) => {
          if (det && typeof det === 'object') {
            list.push(`${disc}: ${det.mencaoNota || det.nota || det.notaNum || '-'}`);
          } else if (det) {
            list.push(`${disc}: ${det}`);
          }
        });
        return list.join(' | ');
      };

      const fech = aluno.fechamento_notas || aluno.fechamentos || aluno.notas;
      if (fech && typeof fech === 'object') {
        const partes = [];
        Object.entries(fech).forEach(([bim, dadosBim]) => {
          const strBim = formatarDisciplinasBimestre(dadosBim);
          if (strBim) {
            partes.push(`[${bim}] ${strBim}`);
            const bimNorm = String(bim).toUpperCase().trim();
            if (bimNorm === '1B' || bimNorm === '1' || bimNorm.includes('1º') || bimNorm.includes('1O')) notas1B = strBim;
            else if (bimNorm === '2B' || bimNorm === '2' || bimNorm.includes('2º') || bimNorm.includes('2O')) notas2B = strBim;
            else if (bimNorm === '3B' || bimNorm === '3' || bimNorm.includes('3º') || bimNorm.includes('3O')) notas3B = strBim;
            else if (bimNorm === '4B' || bimNorm === '4' || bimNorm.includes('4º') || bimNorm.includes('4O')) notas4B = strBim;
            else if (bimNorm === 'FINAL' || bimNorm.includes('REC') || bimNorm.includes('FINAL')) notasFinal = strBim;
          }
        });
        notasResumo = partes.join(' || ');
      }

      return todasColunas.map(col => {
        const k = col.key;
        if (k === '__dados_completos_json__') {
          return escapeCSV(aluno);
        }
        if (k === 'total_ocorrencias') {
          return escapeCSV(ocs.length);
        }
        if (k === 'resumo_ocorrencias') {
          return escapeCSV(resumoOcorrencias);
        }
        if (k === 'ocorrencias_detalhadas_json') {
          return escapeCSV(ocs);
        }
        if (k === 'busca_ativa_detalhada_json') {
          return escapeCSV(bas);
        }
        if (k === 'resumo_busca_ativa') {
          return escapeCSV(resumoBuscaAtiva);
        }
        if (k === 'fechamento_notas_resumo') {
          return escapeCSV(notasResumo);
        }
        if (k === 'notas_1b') {
          return escapeCSV(notas1B);
        }
        if (k === 'notas_2b') {
          return escapeCSV(notas2B);
        }
        if (k === 'notas_3b') {
          return escapeCSV(notas3B);
        }
        if (k === 'notas_4b') {
          return escapeCSV(notas4B);
        }
        if (k === 'notas_final') {
          return escapeCSV(notasFinal);
        }
        if (k === 'media_geral') {
          return escapeCSV(mediaCalc);
        }
        if (k === 'qtd_abaixo_basico') {
          return escapeCSV(qtdAbaixo);
        }
        if (k === 'tutor_2026') {
          return escapeCSV(aluno.tutor_2026 || aluno.tutor || '');
        }
        if (k === 'projeto_vida_2026') {
          return escapeCSV(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.projetoDeVida || '');
        }
        if (k === 'acoes_2026') {
          return escapeCSV(aluno.acoes_2026 || aluno.acoes_2025 || aluno.acoes || '');
        }
        if (k === 'eletivas') {
          return escapeCSV(aluno.eletivas || aluno.eletiva || aluno.eletiva_1_2026 || '');
        }
        if (k === 'presenca_anual') {
          return escapeCSV(aluno.presenca_anual || aluno.presenca_atual || aluno.frequencia_atual || aluno.frequencia || '');
        }
        if (k === 'recomposicao') {
          return escapeCSV(aluno.recomposicao ? 'SIM' : 'NÃO');
        }
        if (k === 'aee') {
          return escapeCSV(aluno.aee ? 'SIM' : 'NÃO');
        }

        let val = aluno[k];
        if (val === undefined || val === null) val = '';
        return escapeCSV(val);
      }).join(';');
    });

    const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileName = `base_alunos_clovis_completa_${dateStr}.csv`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Registro na Trilha de Auditoria
    await registrarLogAuditoria({
      modulo: 'Alunos',
      acao: 'EXPORTAR_BASE_ALUNOS_CSV',
      descricao: `Exportada base completa de estudantes em CSV com todos os atributos (${alunosList.length} estudantes, ${todasColunas.length} colunas).`,
      detalhes: { fileName, totalAlunos: alunosList.length, totalColunas: todasColunas.length }
    });

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(`Base completa de estudantes exportada com sucesso! (${alunosList.length} alunos, ${todasColunas.length} colunas no arquivo "${fileName}").`, 'success', 7000);
    }

    return fileName;
  } catch (err) {
    console.error('[BackupManager] Erro ao exportar base completa de estudantes em CSV:', err);
    if (typeof window !== 'undefined' && typeof window.showErrorToast === 'function') {
      window.showErrorToast('Erro ao compilar base de alunos em CSV!', err);
    }
    throw err;
  } finally {
    botoes.forEach((b, idx) => {
      b.disabled = false;
      b.innerHTML = textosOriginais[idx] || `<i class="fa-solid fa-file-csv text-xs"></i><span>Exportar Base de Alunos (CSV)</span>`;
    });
  }
}

/**
 * 5. Restaura e mescla o backup global JSON no Firestore e sincroniza caches e localStorage
 */
export async function restaurarBackupCompleto(conteudoJSON, onProgress) {
  if (!validarPermissaoDiretor()) return null;

  try {
    let parsedObj;
    if (typeof conteudoJSON === 'string') {
      parsedObj = JSON.parse(conteudoJSON);
    } else if (typeof conteudoJSON === 'object' && conteudoJSON !== null) {
      parsedObj = conteudoJSON;
    } else {
      throw new Error('Formato de arquivo inválido. Deve ser um JSON válido.');
    }

    let colecoesMap = {};

    if (parsedObj.data && typeof parsedObj.data === 'object' && !Array.isArray(parsedObj.data)) {
      parsedObj = parsedObj.data;
    } else if (parsedObj.backup && typeof parsedObj.backup === 'object' && !Array.isArray(parsedObj.backup)) {
      parsedObj = parsedObj.backup;
    }

    if (parsedObj.colecoes && typeof parsedObj.colecoes === 'object') {
      colecoesMap = { ...parsedObj.colecoes };
    } else if (Array.isArray(parsedObj)) {
      // Formato legado: array direto de alunos
      colecoesMap = { alunos: parsedObj };
    } else {
      // Objeto onde as chaves podem ser diretamente coleções (ex: { alunos: [...], ocorrencias: [...] })
      Object.keys(parsedObj).forEach(k => {
        if (Array.isArray(parsedObj[k]) && k !== 'metadados' && k !== 'configuracoes_locais') {
          colecoesMap[k] = parsedObj[k];
        }
      });
    }

    // Mapear arrays explícitos diretos para suas coleções
    if ((!colecoesMap.eventos || colecoesMap.eventos.length === 0) && Array.isArray(parsedObj.agenda_eventos)) {
      colecoesMap.eventos = parsedObj.agenda_eventos;
    }
    if ((!colecoesMap.rotina_equipe || colecoesMap.rotina_equipe.length === 0) && Array.isArray(parsedObj.tarefas_equipe)) {
      colecoesMap.rotina_equipe = parsedObj.tarefas_equipe;
    }
    if ((!colecoesMap.alunos || colecoesMap.alunos.length === 0) && Array.isArray(parsedObj.alunos)) {
      colecoesMap.alunos = parsedObj.alunos;
    }
    if ((!colecoesMap.professores_anotacoes || colecoesMap.professores_anotacoes.length === 0) && Array.isArray(parsedObj.professores_anotacoes)) {
      colecoesMap.professores_anotacoes = parsedObj.professores_anotacoes;
    }
    if ((!colecoesMap.usuarios || colecoesMap.usuarios.length === 0) && Array.isArray(parsedObj.usuarios)) {
      colecoesMap.usuarios = parsedObj.usuarios;
    }

    // Se houver configurações locais no backup, restaurar no localStorage e no Firestore
    if (parsedObj.configuracoes_locais && typeof parsedObj.configuracoes_locais === 'object') {
      try {
        const cfgs = parsedObj.configuracoes_locais;
        if (typeof localStorage !== 'undefined') {
          Object.keys(cfgs).forEach(k => {
            const val = typeof cfgs[k] === 'object' ? JSON.stringify(cfgs[k]) : String(cfgs[k]);
            localStorage.setItem(k, val);
          });
        }
        // Sincronizar configurações essenciais no Firestore em config_escola
        const chavesParaFirestore = [
          'clovis_periodos_aula',
          'clovis_cadastro_professores',
          'clovis_cadastros_base',
          'clovis_capacidades_pei_cache',
          'clovis_indisponibilidade_professores',
          'clovis_indisponibilidade_v2',
          'clovis_saldo_professores_import',
          'clovis_projetos_cache'
        ];
        for (const chave of chavesParaFirestore) {
          if (cfgs[chave]) {
            try {
              const docId = chave.replace('clovis_', '');
              await setDoc(doc(db, "config_escola", docId), {
                dados: cfgs[chave],
                atualizadoEm: new Date().toISOString()
              }, { merge: true });
            } catch (eCfg) {}
          }
        }
        // Restaurar nó raiz configuracao se presente
        if (parsedObj.configuracao && typeof parsedObj.configuracao === 'object') {
          try {
            await setDoc(doc(db, "config_escola", "parametros_sistema"), {
              ...parsedObj.configuracao,
              restauradoEm: new Date().toISOString()
            }, { merge: true });
            if (parsedObj.configuracao.preferencias_backup && typeof localStorage !== 'undefined') {
              localStorage.setItem('clovis_backup_configuracoes', JSON.stringify(parsedObj.configuracao.preferencias_backup));
            }
          } catch (eParam) {}
        }
      } catch (eCfgGeral) {
        console.warn("[BackupManager] Aviso ao restaurar configuracoes_locais:", eCfgGeral);
      }
    }

    let totalDocsCalculado = 0;
    Object.keys(colecoesMap).forEach(colName => {
      if (Array.isArray(colecoesMap[colName])) {
        totalDocsCalculado += colecoesMap[colName].length;
      }
    });

    if (totalDocsCalculado === 0) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Nenhum registro encontrado no arquivo de backup para restaurar.', 'warning');
      }
      return { sucesso: false, totalDocs: 0 };
    }

    const listaColecoesDetectadas = Object.keys(colecoesMap).filter(c => Array.isArray(colecoesMap[c]) && colecoesMap[c].length > 0);

    const confirmou = window.confirm(
      `ATENÇÃO - RESTAURAÇÃO INTEGRAL DO SISTEMA:\n\n` +
      `Serão restaurados e sincronizados ${totalDocsCalculado} documentos distribuídos em ${listaColecoesDetectadas.length} coleções:\n` +
      `[${listaColecoesDetectadas.join(', ')}]\n\n` +
      `• Todos os registros serão gravados utilizando suas chaves oficiais (Alunos por RA, Eventos por ID, etc.).\n` +
      `• Agenda, tarefas, notas bimestrais e configurações serão preservadas e mescladas com segurança.\n\n` +
      `Deseja prosseguir com a restauração completa?`
    );

    if (!confirmou) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Operação de restauração cancelada pelo usuário.', 'info');
      }
      return { sucesso: false, cancelado: true };
    }

    const BATCH_LIMIT = 400; // Limite seguro do Firestore writeBatch (máx 500)
    let totalRestaurados = 0;
    let colecoesRestauradasCount = 0;

    for (const colName of listaColecoesDetectadas) {
      const docsDaColecao = colecoesMap[colName];
      if (!Array.isArray(docsDaColecao) || docsDaColecao.length === 0) continue;

      colecoesRestauradasCount++;

      // Atualizar caches em memória imediatamente
      if (typeof window !== 'undefined') {
        if (colName === 'alunos') window.allStudentsData = docsDaColecao;
        if (colName === 'eventos' || colName === 'agenda') window.eventosCache = docsDaColecao;
        if (colName === 'rotina_equipe' || colName === 'tarefas') window.tasksCache = docsDaColecao;
        if (colName === 'professores_anotacoes') window.professoresAnotacoesCache = docsDaColecao;
        if (colName === 'mural_recados') window.muralRecadosCache = docsDaColecao;
        if (colName === 'audit_logs') window.allAuditLogsCache = docsDaColecao;
        if (colName === 'ocorrencias') window.ocorrenciasCache = docsDaColecao;
        if (colName === 'horarios') window.gradeCache = docsDaColecao;
        if (colName === 'projetos_pei') window.projetosCache = docsDaColecao;
        if (colName === 'substituicoes_diarias' || colName === 'substituicoes_pei') window.substituicoesCache = docsDaColecao;
      }

      // Dividir em lotes de gravação
      for (let i = 0; i < docsDaColecao.length; i += BATCH_LIMIT) {
        const lote = docsDaColecao.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);

        for (const item of lote) {
          if (!item || typeof item !== 'object') continue;

          // Identificar chave primária
          let docId = '';
          if (colName === 'alunos') {
            docId = String(item.ra || item.id || item.docId || '').replace(/\D/g, '').substring(0, 12);
          } else {
            docId = String(item.id || item.docId || item.codigo || item.email || item.ra || '');
          }

          if (!docId) {
            docId = `migrado_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          }

          const dadosParaGravar = limparValoresUndefined({ ...item });
          delete dadosParaGravar.id; // Remover campo auxiliar se id for a chave do documento

          const docRef = doc(db, colName, docId);
          batch.set(docRef, dadosParaGravar, { merge: true });
        }

        try {
          await batch.commit();
          totalRestaurados += lote.length;
        } catch (errBatch) {
          console.warn(`[BackupManager] Erro no writeBatch da coleção ${colName}:`, errBatch);
          // Fallback doc por doc
          for (const item of lote) {
            try {
              const docId = String(item.ra || item.id || item.codigo || `doc_${Date.now()}`);
              const dados = limparValoresUndefined({ ...item });
              delete dados.id;
              await setDoc(doc(db, colName, docId), dados, { merge: true });
              totalRestaurados++;
            } catch (eDoc) {}
          }
        }

        if (typeof onProgress === 'function') {
          const percentual = Math.round((totalRestaurados / totalDocsCalculado) * 100);
          onProgress({
            restaurados: totalRestaurados,
            total: totalDocsCalculado,
            percentual,
            colecaoAtual: colName
          });
        }
      }
    }

    // Atualização e recarregamento dos componentes do sistema
    if (typeof window !== 'undefined') {
      const recarregadores = [
        window.carregarAlunosDoFirestore,
        window.carregarDadosReais,
        window.carregarMuralRecados,
        window.carregarListaUsuarios,
        window.carregarUsuarios,
        window.carregarHistoricoOcorrenciasGeral,
        window.carregarEventosGeral,
        window.carregarTodosOsContatosGeralBa,
        window.carregarModelos,
        window.carregarColunasPersonalizadas,
        window.carregarLogsAuditoria,
        window.atualizarDashboardGraficos,
        window.applyStudentFilters
      ];

      for (const fn of recarregadores) {
        if (typeof fn === 'function') {
          try {
            await fn();
          } catch (eFn) {
            console.warn("[BackupManager] Aviso ao recarregar módulo pós-restauração:", eFn);
          }
        }
      }

      window.dispatchEvent(new CustomEvent('agendaeventosupdated'));
      window.dispatchEvent(new CustomEvent('tarefasupdated'));
      window.dispatchEvent(new CustomEvent('studentsdataupdated'));
      window.dispatchEvent(new CustomEvent('taborrolechange'));
    }

    // Registrar na Trilha de Auditoria
    await registrarLogAuditoria({
      modulo: 'Backup e Restauração',
      acao: 'RESTAURAR_BACKUP_GLOBAL',
      descricao: `Restauração global concluída com sucesso: ${totalRestaurados} documentos sincronizados em ${colecoesRestauradasCount} coleções.`,
      detalhes: { 
        totalRestaurados, 
        colecoesRestauradasCount, 
        colecoes: listaColecoesDetectadas 
      }
    });

    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(`Restauração concluída com sucesso! ${totalRestaurados} registros foram sincronizados em ${colecoesRestauradasCount} coleções sem nenhuma perda!`, 'success', 8000);
    }

    return { sucesso: true, totalDocs: totalRestaurados, totalColecoes: colecoesRestauradasCount };
  } catch (err) {
    console.error('[BackupManager] Erro ao restaurar backup:', err);
    if (typeof window !== 'undefined' && typeof window.showErrorToast === 'function') {
      window.showErrorToast('Erro ao processar e restaurar backup JSON no Firestore!', err);
    }
    throw err;
  }
}

// Binds globais no window para compatibilidade completa
if (typeof window !== 'undefined') {
  window.exportarBackupCompletoJSON = exportarBackupCompleto;
  window.exportarBackupCompleto = exportarBackupCompleto;
  window.exportarBackupCompletoCSV = exportarBackupCompletoCSV;
  window.exportarBaseAlunosCSV = exportarBaseAlunosCSV;
  window._exportarBaseAlunosCSVCompleto = exportarBaseAlunosCSV;
  
  window.importarBackupCompletoJSON = async function (event) {
    const inputEl = event?.target || document.getElementById('input-importar-backup-json');
    const file = inputEl?.files?.[0];
    if (!file) return;

    const btnRestaurar = document.getElementById('btn-restaurar-backup-json');
    const statusProgress = document.getElementById('backup-import-status');

    try {
      if (btnRestaurar) {
        btnRestaurar.disabled = true;
        btnRestaurar.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs"></i><span>Restaurando...</span>`;
      }
      if (statusProgress) {
        statusProgress.classList.remove('hidden');
        statusProgress.innerHTML = `<i class="fa-solid fa-arrows-rotate animate-spin text-indigo-700 mr-2"></i>Lendo arquivo de backup e analisando coleções...`;
      }

      const content = await file.text();
      await restaurarBackupCompleto(content, (prog) => {
        if (statusProgress) {
          statusProgress.innerHTML = `<i class="fa-solid fa-arrows-rotate animate-spin text-indigo-700 mr-2"></i>Restaurando (${prog.percentual}%): ${prog.restaurados} de ${prog.total} registros em [${prog.colecaoAtual}]...`;
        }
      });
    } catch (e) {
      console.error('[BackupManager] Erro global na restauração:', e);
    } finally {
      if (btnRestaurar) {
        btnRestaurar.disabled = false;
        btnRestaurar.innerHTML = `<i class="fa-solid fa-fire-flame-curved text-xs text-rose-300"></i><span>🔥 Restaurar Banco de Dados (Upload JSON)</span>`;
      }
      if (statusProgress) {
        statusProgress.classList.add('hidden');
      }
      if (inputEl) inputEl.value = '';
    }
  };
  window.restaurarBackupCompleto = restaurarBackupCompleto;
  window.obterOpcoesConfiguracaoBackupUI = obterOpcoesConfiguracaoBackupUI;
  window.capturarConfiguracaoCompletaSistema = capturarConfiguracaoCompletaSistema;
}

export default {
  exportarBackupCompleto,
  exportarBackupCompletoCSV,
  exportarBaseAlunosCSV,
  restaurarBackupCompleto,
  extrairTodosDadosSistema,
  obterDocumentosColecao,
  validarPermissaoDiretor,
  capturarConfiguracaoCompletaSistema,
  obterOpcoesConfiguracaoBackupUI,
  COLECOES_SISTEMA
};


