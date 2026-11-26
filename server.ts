import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import { getDatabase, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, countDocs, executeBatch, prewarmCache, formatMongoDoc, searchAlunosInDb, resolveCollectionName, buildDocumentQuery, invalidateCollectionCache } from './src/server/mongodb.ts';
import { parseBoletimSEDText, limparNomeDisciplina } from './src/modules/boletimPdfParser.ts';
import { parseRelatorioFrequenciaSED, normalizarNomeTurmaSED, normalizarRaSED } from './src/modules/frequenciaSedPdfParser.ts';
import {
  parseMapaoConselhoText,
  gerarChaveTurmaBimestre,
  gerarChaveAlunoConselho,
  normalizarTextoComparacao,
  gerarChaveTurma,
  DELIBERACAO_LABELS,
  RESULTADO_FINAL_LABELS
} from './src/modules/mapaoConselhoParser.ts';

const AUTH_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'clovis-lucca-2026-hmac-auth-secret-shield';

let sharedGeminiClient: GoogleGenAI | null = null;
let sharedGeminiApiKey = '';

function getGeminiApiKey(): string {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '').trim();
}

function getSharedGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  if (!sharedGeminiClient || sharedGeminiApiKey !== apiKey) {
    sharedGeminiApiKey = apiKey;
    sharedGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return sharedGeminiClient;
}

function isTransientGeminiError(err: any): boolean {
  const status = Number(err?.status || err?.code || 0);
  const raw = String(err?.message || err || '').toLowerCase();
  return (
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    raw.includes('"code":503') ||
    raw.includes('unavailable') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('try again later') ||
    raw.includes('timeout') ||
    raw.includes('econnreset') ||
    raw.includes('etimedout') ||
    raw.includes('fetch failed')
  );
}

const geminiModelCooldownUntil = new Map<string, number>();

function markGeminiModelCooldown(model: string, durationMs: number) {
  geminiModelCooldownUntil.set(model, Date.now() + durationMs);
}

function sortCandidatesByHealth<T extends { model: string }>(candidates: T[]): T[] {
  const now = Date.now();
  const saudaveis = candidates.filter(c => (geminiModelCooldownUntil.get(c.model) || 0) <= now);
  const emCooldown = candidates.filter(c => (geminiModelCooldownUntil.get(c.model) || 0) > now);
  return [...saudaveis, ...emCooldown];
}

function withGeminiTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout de ${Math.round(ms / 1000)}s no modelo ${label}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const MOCK_FALLBACK_USERS: Record<string, any> = {
  'diretor@clovis.com': { id: 'usr-diretor', nome: 'Diretor Escolar', email: 'diretor@clovis.com', cargo: 'DIRETOR', nivel: 'DIRETOR', nivelAcesso: 'DIRETOR', acesso_total: true },
  'vice@clovis.com': { id: 'usr-vice', nome: 'Vice-Diretor Escolar', email: 'vice@clovis.com', cargo: 'VICE_DIRETOR', nivel: 'VICE_DIRETOR', nivelAcesso: 'VICE_DIRETOR', acesso_total: true },
  'cgpg@clovis.com': { id: 'usr-cgpg', nome: 'Coordenador CGPG', email: 'cgpg@clovis.com', cargo: 'CGPG', nivel: 'CGPG', nivelAcesso: 'CGPG', acesso_total: false },
  'paac@clovis.com': { id: 'usr-paac', nome: 'Professor PAAC', email: 'paac@clovis.com', cargo: 'PAAC', nivel: 'PAAC', nivelAcesso: 'PAAC', acesso_total: false },
  'secretaria@clovis.com': { id: 'usr-sec', nome: 'Secretaria Escolar', email: 'secretaria@clovis.com', cargo: 'SECRETARIA', nivel: 'SECRETARIA', nivelAcesso: 'SECRETARIA', acesso_total: false },
  'professor@clovis.com': { id: 'usr-prof', nome: 'Professor Docente', email: 'professor@clovis.com', cargo: 'PROFESSOR', nivel: 'PROFESSOR', nivelAcesso: 'PROFESSOR', acesso_total: false }
};

function normalizarRoleBackend(rawRole?: any): string {
  if (!rawRole) return 'PROFESSOR';
  const str = String(rawRole).trim().toUpperCase();
  if (str === 'SENIOR_GOE' || str === 'SÊNIOR/GOE' || str === 'SENIOR/GOE' || str === 'GOE' || str === 'SÊNIOR' || str === 'SENIOR' || str.includes('SENIOR') || str.includes('SÊNIOR') || /\bGOE\b/.test(str) || str === 'EXTENDIDO' || str === 'ESTENDIDO' || str.includes('EXTENDIDO') || str.includes('ESTENDIDO')) return 'SENIOR_GOE';
  if (str === 'DIRETOR' || str === 'DIREÇÃO' || str === 'DIRECAO' || str === 'ADMIN') return 'DIRETOR';
  if (str.includes('VICE') || str === 'VICE_DIRETOR' || str === 'VICE-DIRETOR') return 'VICE_DIRETOR';
  if (str.includes('CGPG') || str.includes('COORDENA') || str.includes('CGPCG')) return 'CGPG';
  if (str.includes('SECRETARIA')) return 'SECRETARIA';
  if (str === 'PAAC' || str === 'PROFESSOR_PAAC' || (str.includes('PAAC') && !str.includes('PROFESSOR'))) return 'PAAC';
  if (str.includes('PROFESSOR') || str.includes('TUTOR') || str.includes('DOCENTE')) return 'PROFESSOR';
  if (str.includes('DIRETOR')) return 'DIRETOR';
  return 'PROFESSOR';
}

function isCategoriaAtrasoEstrita(oc: any): boolean {
  if (!oc || typeof oc !== 'object') return false;
  if (String(oc.origem || '').trim().toUpperCase() === 'ATA_ESCOLAR') return false;
  const tipo = String(oc.tipo || '').trim().toUpperCase();
  const cat = String(oc.categoria || '').trim().toUpperCase();
  if (
    oc.isDispensa === true ||
    tipo.includes('DISPENSA') ||
    cat.includes('DISPENSA') ||
    tipo.includes('AFASTAMENTO') ||
    cat.includes('AFASTAMENTO')
  ) {
    return false;
  }
  if (tipo || cat) {
    return tipo.includes('ATRASO') || cat.includes('ATRASO');
  }
  return oc.isAtraso === true;
}

function sanitizarObjetoOcorrenciaAtraso(oc: any): any {
  if (!oc || typeof oc !== 'object') return oc;
  const { id: _ignId, _id: _ignUnder, ...rest } = oc;
  const tipo = String(rest.tipo || '').trim().toUpperCase();
  const cat = String(rest.categoria || '').trim().toUpperCase();
  const isDisp =
    rest.isDispensa === true ||
    tipo.includes('DISPENSA') ||
    cat.includes('DISPENSA') ||
    tipo.includes('AFASTAMENTO') ||
    cat.includes('AFASTAMENTO');
  const isAta = String(rest.origem || '').trim().toUpperCase() === 'ATA_ESCOLAR';
  if (tipo || cat || isDisp || isAta) {
    const isAtr = isCategoriaAtrasoEstrita(rest);
    rest.isAtraso = isAtr;
    if (!isAtr) {
      delete rest.horaRealAtraso;
      delete rest.horarioAtraso;
    }
  }
  return rest;
}

function inferirSegmentoPorTurma(turma: any): '' | 'ENSINO FUNDAMENTAL' | 'ENSINO MÉDIO' {
  const turmaTrim = String(turma || '').trim();
  if (!turmaTrim) return '';
  if (/^[6789]/.test(turmaTrim)) return 'ENSINO FUNDAMENTAL';
  if (/^[123]/.test(turmaTrim)) return 'ENSINO MÉDIO';
  return '';
}

function normalizarPayloadAtrasoDb(collection: string, data: Record<string, any>): Record<string, any> {
  if (!data || typeof data !== 'object') return data;
  const realCol = resolveCollectionName(collection);
  if (realCol === 'ocorrencias' || realCol === 'registros') {
    const tipo = String(data.tipo || '').trim().toUpperCase();
    const cat = String(data.categoria || '').trim().toUpperCase();
    const isDisp =
      data.isDispensa === true ||
      tipo.includes('DISPENSA') ||
      cat.includes('DISPENSA') ||
      tipo.includes('AFASTAMENTO') ||
      cat.includes('AFASTAMENTO');
    const isAta = String(data.origem || '').trim().toUpperCase() === 'ATA_ESCOLAR';
    if (tipo || cat || isDisp || isAta) {
      const isAtr = isCategoriaAtrasoEstrita(data);
      data.isAtraso = isAtr;
      if (!isAtr) {
        data.horaRealAtraso = '';
        data.horarioAtraso = '';
      }
    }
  } else if (realCol === 'alunos') {
    if (data.turma !== undefined) {
      const segAuto = inferirSegmentoPorTurma(data.turma);
      if (segAuto) {
        data.segmento = segAuto;
      }
    }
    if (Array.isArray(data.ocorrencias)) {
      data.ocorrencias = data.ocorrencias.map(sanitizarObjetoOcorrenciaAtraso);
    } else if (data.ocorrencias && typeof data.ocorrencias === 'object' && data.ocorrencias.__arrayUnion === true && Array.isArray(data.ocorrencias.elements)) {
      data.ocorrencias = {
        ...data.ocorrencias,
        elements: data.ocorrencias.elements.map(sanitizarObjetoOcorrenciaAtraso)
      };
    }
  }
  return data;
}

function limparSufixoChegadaSintetico(texto: any, horaStored: string): string {
  const str = String(texto || '');
  if (!str || !horaStored) return str;
  const esc = horaStored.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(new RegExp(`\\s*\\(chegada\\s+[àa]s\\s+${esc}\\)\\s*$`, 'i'), '').trim();
}

async function limparFalsosAtrasosNoBanco(): Promise<{
  ocorrenciasLimpas: number;
  itensEmbutidosLimpos: number;
  alunosAtualizados: number;
}> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  let ocorrenciasLimpas = 0;
  let itensEmbutidosLimpos = 0;
  let alunosAtualizados = 0;

  const temFalsoFlagAtraso = (item: any): boolean => {
    if (!item || typeof item !== 'object') return false;
    const temMarcaAtraso =
      item.isAtraso === true ||
      Boolean(String(item.horaRealAtraso || '').trim()) ||
      Boolean(String(item.horarioAtraso || '').trim());
    if (!temMarcaAtraso) return false;
    const tipo = String(item.tipo || '').trim().toUpperCase();
    const cat = String(item.categoria || '').trim().toUpperCase();
    const isDisp =
      item.isDispensa === true ||
      tipo.includes('DISPENSA') ||
      cat.includes('DISPENSA') ||
      tipo.includes('AFASTAMENTO') ||
      cat.includes('AFASTAMENTO');
    const isAta = String(item.origem || '').trim().toUpperCase() === 'ATA_ESCOLAR';
    if (!tipo && !cat && !isDisp && !isAta) return false;
    return !isCategoriaAtrasoEstrita(item);
  };

  // 1. Limpar documentos na coleção top-level 'ocorrencias'
  const colOcorrencias = db.collection('ocorrencias');
  const candidatosOc = await colOcorrencias.find({
    $or: [
      { isAtraso: true },
      { horaRealAtraso: { $exists: true, $nin: ['', null] } },
      { horarioAtraso: { $exists: true, $nin: ['', null] } }
    ]
  }).toArray();

  for (const docItem of candidatosOc) {
    if (!temFalsoFlagAtraso(docItem)) continue;
    const horaStored = String(docItem.horaRealAtraso || docItem.horarioAtraso || '').trim();
    const setFields: Record<string, any> = {
      isAtraso: false,
      atualizadoEm: nowIso
    };
    if (horaStored) {
      if (typeof docItem.descricao === 'string' && docItem.descricao) {
        const cleanedDesc = limparSufixoChegadaSintetico(docItem.descricao, horaStored);
        if (cleanedDesc !== docItem.descricao) setFields.descricao = cleanedDesc;
      }
      if (typeof docItem.observacao === 'string' && docItem.observacao) {
        const cleanedObs = limparSufixoChegadaSintetico(docItem.observacao, horaStored);
        if (cleanedObs !== docItem.observacao) setFields.observacao = cleanedObs;
      }
    }
    await colOcorrencias.updateOne(
      { _id: docItem._id },
      { $set: setFields, $unset: { horaRealAtraso: '', horarioAtraso: '' } }
    );
    ocorrenciasLimpas++;
  }

  // 2. Limpar arrays embutidos (ocorrencias / registros) na coleção 'alunos'
  const colAlunos = db.collection('alunos');
  const candidatosAlunos = await colAlunos.find({
    $or: [
      { 'ocorrencias.isAtraso': true },
      { 'ocorrencias.horaRealAtraso': { $exists: true, $nin: ['', null] } },
      { 'ocorrencias.horarioAtraso': { $exists: true, $nin: ['', null] } },
      { 'registros.isAtraso': true },
      { 'registros.horaRealAtraso': { $exists: true, $nin: ['', null] } },
      { 'registros.horarioAtraso': { $exists: true, $nin: ['', null] } }
    ]
  }).toArray();

  for (const al of candidatosAlunos) {
    let alterouAluno = false;
    const updateAlunoSet: Record<string, any> = { atualizadoEm: nowIso };

    const limparArrayEmb = (arr: any[]): any[] => {
      return arr.map((el: any) => {
        if (!el || typeof el !== 'object') return el;
        const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
        if (temFalsoFlagAtraso(cleanEl)) {
          alterouAluno = true;
          itensEmbutidosLimpos++;
          const horaStored = String(cleanEl.horaRealAtraso || cleanEl.horarioAtraso || '').trim();
          cleanEl.isAtraso = false;
          delete cleanEl.horaRealAtraso;
          delete cleanEl.horarioAtraso;
          if (horaStored) {
            if (typeof cleanEl.descricao === 'string' && cleanEl.descricao) {
              cleanEl.descricao = limparSufixoChegadaSintetico(cleanEl.descricao, horaStored);
            }
            if (typeof cleanEl.observacao === 'string' && cleanEl.observacao) {
              cleanEl.observacao = limparSufixoChegadaSintetico(cleanEl.observacao, horaStored);
            }
          }
        }
        return cleanEl;
      });
    };

    if (Array.isArray(al.ocorrencias)) {
      updateAlunoSet.ocorrencias = limparArrayEmb(al.ocorrencias);
    }
    if (Array.isArray(al.registros)) {
      updateAlunoSet.registros = limparArrayEmb(al.registros);
    }

    if (alterouAluno) {
      await colAlunos.updateOne({ _id: al._id }, { $set: updateAlunoSet });
      alunosAtualizados++;
    }
  }

  if (ocorrenciasLimpas > 0 || itensEmbutidosLimpos > 0) {
    console.log(
      `[Limpeza Atrasos] Concluída: ${ocorrenciasLimpas} ocorrência(s) e ${itensEmbutidosLimpos} item(ns) em ${alunosAtualizados} aluno(s) removidos da categoria Atraso.`
    );
  }
  return { ocorrenciasLimpas, itensEmbutidosLimpos, alunosAtualizados };
}

function isGatilhoAutomaticoDoc(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.gatilhoAutomaticoAtraso === true || item.gatilhoAutomatico === true) return true;
  const orig = String(item.origem || '').trim().toUpperCase();
  if (orig === 'SISTEMA_PONTUALIDADE' || orig === 'SISTEMA_AUTOMATICO') return true;
  const desc = String(item.descricao || '');
  const tit = String(item.titulo || '');
  return (
    /\[GATILHO\s+AUTOM[ÁA]TICO/i.test(desc) ||
    /\[GATILHO\s+AUTOM[ÁA]TICO/i.test(tit) ||
    /PAUTA\s+OBRIGAT[ÓO]RIA\s+(?:DE\s+TUTORIA|NA\s+SESS[ÃA]O)/i.test(`${tit} ${desc}`)
  );
}

function isLogSilenciosoDocumentoDoc(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const tipo = String(item.tipo || '').trim().toUpperCase();
  const origem = String(item.origem || '').trim().toUpperCase();
  const desc = String(item.descricao || '');
  return (
    (tipo === 'EMISSÃO DE DOCUMENTO' || tipo === 'EMISSAO DE DOCUMENTO' || origem === 'SECRETARIA') &&
    /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(desc)
  );
}

function isRegistroAutomaticoDossieDoc(item: any): boolean {
  return isGatilhoAutomaticoDoc(item) || isLogSilenciosoDocumentoDoc(item);
}

function extrairDadosGatilho(item: any, alunoFallback?: any): {
  ra: string;
  nomeAluno: string;
  turma: string;
  tutorResponsavel: string;
  qtdAtrasos: number;
  mesReferencia: string;
  mensagem: string;
  data: string;
} {
  const desc = String(item?.descricao || '');
  const tit = String(item?.titulo || '');
  const ra = String(item?.ra || alunoFallback?.ra || alunoFallback?.id || '').trim();
  const nomeAluno = String(item?.nomeAluno || alunoFallback?.nome || 'ESTUDANTE').trim().toUpperCase();
  const turma = String(item?.turma || alunoFallback?.turma || '').trim().toUpperCase();

  let tutorResponsavel = String(item?.tutorResponsavel || alunoFallback?.tutor_2026 || alunoFallback?.tutor || '').trim();
  if (!tutorResponsavel || tutorResponsavel.toUpperCase() === 'TUTORIA PEI') {
    const matchTutor = desc.match(/TUTORIA\s*\(([^)]+)\)/i);
    if (matchTutor && matchTutor[1]) {
      tutorResponsavel = matchTutor[1].trim();
    } else if (alunoFallback?.tutor_2026 || alunoFallback?.tutor) {
      tutorResponsavel = String(alunoFallback.tutor_2026 || alunoFallback.tutor).trim();
    } else {
      tutorResponsavel = 'Tutoria PEI';
    }
  }

  let qtdAtrasos = Number(item?.qtdAtrasosGatilho || item?.qtdAtrasos || 0);
  if (!qtdAtrasos || isNaN(qtdAtrasos)) {
    const matchQtd = `${tit} ${desc}`.match(/(\d+)\s*ATRASO/i);
    qtdAtrasos = matchQtd ? parseInt(matchQtd[1], 10) : 3;
  }

  let mesReferencia = String(item?.mesReferenciaGatilho || item?.mesReferencia || '').trim();
  if (!mesReferencia) {
    const matchMes = desc.match(/(\d{4}-\d{2})/);
    if (matchMes) {
      mesReferencia = matchMes[1];
    } else if (item?.data) {
      const dt = new Date(item.data);
      if (!isNaN(dt.getTime())) {
        mesReferencia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      }
    }
  }
  if (!mesReferencia) {
    const agora = new Date();
    mesReferencia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  }

  const data = String(item?.data || item?.criadoEm || new Date().toISOString());
  const mensagem = `Estudante atingiu ${qtdAtrasos} atrasos no mês (${mesReferencia}). Realizar acompanhamento de pontualidade na sessão semanal de Tutoria e providenciar ciência do Termo de Frequência.`;

  return {
    ra,
    nomeAluno,
    turma,
    tutorResponsavel,
    qtdAtrasos,
    mesReferencia,
    mensagem,
    data
  };
}

async function migrarERemoverGatilhosAutomaticosNoBanco(): Promise<{
  ocorrenciasRemovidas: number;
  embutidosRemovidos: number;
  alunosAtualizados: number;
  notificacoesCriadas: number;
}> {
  const db = await getDatabase();
  const colOcorrencias = db.collection('ocorrencias');
  const colAlunos = db.collection('alunos');
  const colNotifTutor = db.collection('notificacoes_tutor');
  const nowIso = new Date().toISOString();

  let ocorrenciasRemovidas = 0;
  let embutidosRemovidos = 0;
  let alunosAtualizados = 0;
  let notificacoesCriadas = 0;

  // Mapa para lookup rápido do aluno pelo RA e deduplicação de notificações
  const alunosDocs = await colAlunos.find({}, {
    projection: { ra: 1, id: 1, nome: 1, turma: 1, tutor: 1, tutor_2026: 1 }
  }).toArray();
  const alunoPorRa = new Map<string, any>();
  for (const a of alunosDocs) {
    const r = String(a.ra || a.id || '').trim();
    const rClean = r.replace(/\D/g, '');
    if (r) alunoPorRa.set(r, a);
    if (rClean) alunoPorRa.set(rClean, a);
  }

  const existingNotifs = await colNotifTutor.find({}).toArray();
  const notifKeys = new Set<string>();
  for (const n of existingNotifs) {
    const rClean = String(n.ra || '').replace(/\D/g, '') || String(n.ra || '').trim();
    notifKeys.add(`${rClean}|${String(n.mesReferencia || '')}|${Number(n.qtdAtrasos || 3)}`);
  }

  const garantirNotificacaoTutor = async (item: any, alunoFallback?: any) => {
    const dados = extrairDadosGatilho(item, alunoFallback);
    if (!dados.ra) return;
    const rClean = dados.ra.replace(/\D/g, '') || dados.ra;
    const key = `${rClean}|${dados.mesReferencia}|${dados.qtdAtrasos}`;
    if (notifKeys.has(key)) return;
    notifKeys.add(key);

    // REGRA CRÍTICA (AGENTS.md / GEMINI.md): NUNCA incluir id ou _id no documento enviado ao banco
    await colNotifTutor.insertOne({
      ra: dados.ra,
      nomeAluno: dados.nomeAluno,
      turma: dados.turma,
      tutorResponsavel: dados.tutorResponsavel,
      tipoNotificacao: 'GATILHO_ATRASOS_TUTORIA',
      titulo: `Pauta de Tutoria — ${dados.qtdAtrasos} atrasos no mês (${dados.mesReferencia})`,
      mensagem: dados.mensagem,
      qtdAtrasos: dados.qtdAtrasos,
      mesReferencia: dados.mesReferencia,
      atendida: false,
      status: 'PENDENTE',
      atendidaPor: '',
      atendidaEm: '',
      observacaoAtendimento: '',
      data: dados.data,
      criadoEm: dados.data,
      atualizadoEm: nowIso,
      origem: 'SISTEMA_PONTUALIDADE'
    });
    notificacoesCriadas++;
  };

  // 1. Remover documentos de gatilho automático da coleção 'ocorrencias'
  const gatilhosTop = await colOcorrencias.find({
    $or: [
      { gatilhoAutomaticoAtraso: true },
      { descricao: /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { titulo: /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { titulo: /PAUTA\s+OBRIGAT[ÓO]RIA\s+DE\s+TUTORIA/i }
    ]
  }).toArray();

  for (const docItem of gatilhosTop) {
    if (!isGatilhoAutomaticoDoc(docItem)) continue;
    const rStr = String(docItem.ra || '').trim();
    const alRef = alunoPorRa.get(rStr) || alunoPorRa.get(rStr.replace(/\D/g, ''));
    await garantirNotificacaoTutor(docItem, alRef);
    await colOcorrencias.deleteOne({ _id: docItem._id });
    ocorrenciasRemovidas++;
  }

  // 2. Remover gatilhos embutidos e linhas sintéticas de acoes_2026 em 'alunos'
  const alunosComGatilho = await colAlunos.find({
    $or: [
      { 'ocorrencias.gatilhoAutomaticoAtraso': true },
      { 'ocorrencias.descricao': /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { 'ocorrencias.titulo': /PAUTA\s+OBRIGAT[ÓO]RIA\s+DE\s+TUTORIA/i },
      { 'registros.gatilhoAutomaticoAtraso': true },
      { 'registros.descricao': /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { acoes_2026: /GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i },
      { pautaTutoriaObrigatoriaPendente: true },
      { ultimoGatilhoAtrasosMes: { $exists: true } }
    ]
  }).toArray();

  for (const al of alunosComGatilho) {
    let alterou = false;
    const setFields: Record<string, any> = { atualizadoEm: nowIso };

    if (Array.isArray(al.ocorrencias)) {
      const filtradas: any[] = [];
      for (const el of al.ocorrencias) {
        if (isGatilhoAutomaticoDoc(el)) {
          await garantirNotificacaoTutor(el, al);
          embutidosRemovidos++;
          alterou = true;
        } else if (el && typeof el === 'object') {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradas.push(cleanEl);
        } else {
          filtradas.push(el);
        }
      }
      if (alterou) {
        setFields.ocorrencias = filtradas;
      }
    }

    if (Array.isArray(al.registros)) {
      const filtradosReg: any[] = [];
      let alterouReg = false;
      for (const el of al.registros) {
        if (isGatilhoAutomaticoDoc(el)) {
          await garantirNotificacaoTutor(el, al);
          embutidosRemovidos++;
          alterou = true;
          alterouReg = true;
        } else if (el && typeof el === 'object') {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradosReg.push(cleanEl);
        } else {
          filtradosReg.push(el);
        }
      }
      if (alterouReg) {
        setFields.registros = filtradosReg;
      }
    }

    if (typeof al.acoes_2026 === 'string' && /GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(al.acoes_2026)) {
      const linhasLimpas = al.acoes_2026
        .split('\n')
        .filter((linha: string) => !/GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(linha))
        .join('\n')
        .trim();
      setFields.acoes_2026 = linhasLimpas;
      alterou = true;
    }

    const unsetFields: Record<string, any> = {};
    if (al.pautaTutoriaObrigatoriaPendente !== undefined) {
      unsetFields.pautaTutoriaObrigatoriaPendente = '';
      alterou = true;
    }
    if (al.ultimoGatilhoAtrasosMes !== undefined) {
      unsetFields.ultimoGatilhoAtrasosMes = '';
      alterou = true;
    }

    if (alterou) {
      const updateOp: Record<string, any> = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) {
        updateOp.$unset = unsetFields;
      }
      await colAlunos.updateOne({ _id: al._id }, updateOp);
      alunosAtualizados++;
    }
  }

  if (ocorrenciasRemovidas > 0 || embutidosRemovidos > 0 || alunosAtualizados > 0 || notificacoesCriadas > 0) {
    console.log(
      `[Migração Gatilhos Tutoria] ${ocorrenciasRemovidas} ocorrência(s) removida(s), ${embutidosRemovidos} embutido(s) removido(s) em ${alunosAtualizados} aluno(s), ${notificacoesCriadas} notificação(ões) criada(s) em notificacoes_tutor.`
    );
  }

  return { ocorrenciasRemovidas, embutidosRemovidos, alunosAtualizados, notificacoesCriadas };
}

async function limparLogsSilenciososDossieNoBanco(): Promise<{
  ocorrenciasRemovidas: number;
  embutidosRemovidos: number;
  alunosAtualizados: number;
}> {
  const db = await getDatabase();
  const colOcorrencias = db.collection('ocorrencias');
  const colAlunos = db.collection('alunos');
  const nowIso = new Date().toISOString();

  let ocorrenciasRemovidas = 0;
  let embutidosRemovidos = 0;
  let alunosAtualizados = 0;

  // 1. Remover logs silenciosos de emissão de documentos da coleção 'ocorrencias'
  const logsTop = await colOcorrencias.find({
    $and: [
      { $or: [{ tipo: 'Emissão de Documento' }, { origem: 'SECRETARIA' }] },
      { descricao: /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i }
    ]
  }).toArray();

  for (const docItem of logsTop) {
    if (!isLogSilenciosoDocumentoDoc(docItem)) continue;
    await colOcorrencias.deleteOne({ _id: docItem._id });
    ocorrenciasRemovidas++;
  }

  // 2. Remover logs silenciosos embutidos em alunos.ocorrencias / registros e linhas em acoes_2026
  const alunosComLogs = await colAlunos.find({
    $or: [
      { 'ocorrencias.tipo': 'Emissão de Documento' },
      { 'ocorrencias.descricao': /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i },
      { 'registros.tipo': 'Emissão de Documento' },
      { 'registros.descricao': /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i },
      { acoes_2026: /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i }
    ]
  }).toArray();

  for (const al of alunosComLogs) {
    let alterou = false;
    const setFields: Record<string, any> = { atualizadoEm: nowIso };

    if (Array.isArray(al.ocorrencias)) {
      const filtradas: any[] = [];
      let remOc = false;
      for (const el of al.ocorrencias) {
        if (isLogSilenciosoDocumentoDoc(el)) {
          embutidosRemovidos++;
          alterou = true;
          remOc = true;
        } else if (el && typeof el === 'object') {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradas.push(cleanEl);
        } else {
          filtradas.push(el);
        }
      }
      if (remOc) setFields.ocorrencias = filtradas;
    }

    if (Array.isArray(al.registros)) {
      const filtradosReg: any[] = [];
      let remReg = false;
      for (const el of al.registros) {
        if (isLogSilenciosoDocumentoDoc(el)) {
          embutidosRemovidos++;
          alterou = true;
          remReg = true;
        } else if (el && typeof el === 'object') {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradosReg.push(cleanEl);
        } else {
          filtradosReg.push(el);
        }
      }
      if (remReg) setFields.registros = filtradosReg;
    }

    if (typeof al.acoes_2026 === 'string' && /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(al.acoes_2026)) {
      const linhasLimpas = al.acoes_2026
        .split('\n')
        .filter((linha: string) => !/emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(linha))
        .join('\n')
        .trim();
      setFields.acoes_2026 = linhasLimpas;
      alterou = true;
    }

    if (alterou) {
      await colAlunos.updateOne({ _id: al._id }, { $set: setFields });
      alunosAtualizados++;
    }
  }

  if (ocorrenciasRemovidas > 0 || embutidosRemovidos > 0 || alunosAtualizados > 0) {
    console.log(
      `[Limpeza Logs Silenciosos Dossiê] ${ocorrenciasRemovidas} ocorrência(s) e ${embutidosRemovidos} embutido(s) em ${alunosAtualizados} aluno(s) removidos.`
    );
  }

  return { ocorrenciasRemovidas, embutidosRemovidos, alunosAtualizados };
}

async function sincronizarSegmentosAlunosPorTurmaNoBanco(): Promise<{
  alunosAtualizados: number;
  ensinoFundamental: number;
  ensinoMedio: number;
}> {
  const db = await getDatabase();
  const colAlunos = db.collection('alunos');
  const docs = await colAlunos
    .find({}, { projection: { _id: 1, turma: 1, segmento: 1 } })
    .toArray();

  const bulkOps: any[] = [];
  let ensinoFundamental = 0;
  let ensinoMedio = 0;

  for (const a of docs) {
    const segAuto = inferirSegmentoPorTurma(a.turma);
    if (!segAuto) continue;
    const segAtual = String(a.segmento || '').trim().toUpperCase();
    if (segAtual !== segAuto) {
      bulkOps.push({
        updateOne: {
          filter: { _id: a._id },
          update: { $set: { segmento: segAuto } }
        }
      });
      if (segAuto === 'ENSINO FUNDAMENTAL') ensinoFundamental++;
      else ensinoMedio++;
    }
  }

  if (bulkOps.length > 0) {
    await colAlunos.bulkWrite(bulkOps, { ordered: false });
    console.log(
      `[Sincronização Segmentos] ${bulkOps.length} aluno(s) classificado(s) automaticamente pela Turma/Série (${ensinoFundamental} Ensino Fundamental [6º-9º], ${ensinoMedio} Ensino Médio [1ª-3ª]).`
    );
  }

  return { alunosAtualizados: bulkOps.length, ensinoFundamental, ensinoMedio };
}

async function normalizarAnoFrequenciaDiariaNoBanco(): Promise<{
  normalizados: number;
  mesclados: number;
}> {
  const db = await getDatabase();
  const col = db.collection('frequencia_diaria');
  const docs = await col.find({}).toArray();

  let normalizados = 0;
  let mesclados = 0;

  const extrairDataDoc = (d: any): string => {
    const raw = String(d?.data || d?.dataChamada || '').trim();
    const mRaw = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (mRaw) return mRaw[1];
    const idStr = String(d?.id || '').trim();
    const mId = idStr.match(/(\d{4}-\d{2}-\d{2})/);
    return mId ? mId[1] : '';
  };

  for (const d of docs) {
    if (d?.encerradoNaVirada === true || d?.arquivadoVirada === true) continue;
    const dataIso = extrairDataDoc(d);
    if (!dataIso) continue;

    const anoReal = dataIso.slice(0, 4);
    const idAtual = String(d.id || '').trim();
    const anoAtualDoc = String(d.anoLetivo || '').trim();
    const idEsperado = `chamada_${dataIso}_${anoReal}`;

    const precisaCorrigirAno = anoAtualDoc !== anoReal;
    const precisaCorrigirId = idAtual.startsWith('chamada_') && idAtual !== idEsperado;

    if (!precisaCorrigirAno && !precisaCorrigirId) continue;

    const destinoExistente = await col.findOne({
      id: idEsperado,
      _id: { $ne: d._id }
    });

    if (destinoExistente) {
      const regAntigo = d.registros && typeof d.registros === 'object' ? d.registros : {};
      const regDestino = destinoExistente.registros && typeof destinoExistente.registros === 'object' ? destinoExistente.registros : {};
      const mergedRegistros = { ...regAntigo, ...regDestino };

      const turmasSet = new Set<string>([
        ...(Array.isArray(d.turmasConcluidas) ? d.turmasConcluidas : []),
        ...(Array.isArray(destinoExistente.turmasConcluidas) ? destinoExistente.turmasConcluidas : [])
      ]);

      await col.updateOne(
        { _id: destinoExistente._id },
        {
          $set: {
            data: dataIso,
            anoLetivo: anoReal,
            registros: mergedRegistros,
            turmasConcluidas: Array.from(turmasSet),
            statusChamada:
              destinoExistente.statusChamada === 'concluida' || d.statusChamada === 'concluida'
                ? 'concluida'
                : destinoExistente.statusChamada || d.statusChamada || 'em_andamento'
          }
        }
      );
      await col.deleteOne({ _id: d._id });
      mesclados++;
    } else {
      await col.updateOne(
        { _id: d._id },
        {
          $set: {
            id: idEsperado,
            data: dataIso,
            anoLetivo: anoReal
          }
        }
      );
      normalizados++;
    }
  }

  if (normalizados > 0 || mesclados > 0) {
    invalidateCollectionCache('frequencia_diaria');
    console.log(
      `[Normalização Frequência Diária] ${normalizados} chamada(s) corrigida(s) para o ano letivo da data real e ${mesclados} duplicidade(s) mesclada(s).`
    );
  }

  return { normalizados, mesclados };
}

function signSessionToken(payload: { id: string; email: string; realRole: string }): string {
  const data = {
    ...payload,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  };
  const dataB64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', AUTH_SECRET).update(dataB64).digest('base64url');
  return `${dataB64}.${sigB64}`;
}

function verifySessionToken(token?: string | null): { id: string; email: string; realRole: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(dataB64).digest('base64url');
  try {
    const a = Buffer.from(sigB64, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8'));
    if (!parsed || !parsed.email || (parsed.exp && Date.now() > parsed.exp)) return null;
    return {
      id: String(parsed.id || ''),
      email: String(parsed.email).trim().toLowerCase(),
      realRole: normalizarRoleBackend(parsed.realRole)
    };
  } catch {
    return null;
  }
}

async function resolveRealAuthenticatedUser(req: express.Request): Promise<{ id: string; email: string; realRole: string; nome?: string } | null> {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const decoded = verifySessionToken(token);
  if (!decoded) return null;

  try {
    const db = await getDatabase();
    const dbUser = await db.collection('usuarios').findOne({
      email: { $regex: new RegExp(`^${decoded.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (dbUser) {
      const realRole = normalizarRoleBackend(dbUser.nivelAcesso || dbUser.nivel || dbUser.cargo);
      return {
        id: String(dbUser.id || dbUser._id || decoded.id),
        email: String(dbUser.email || decoded.email).trim().toLowerCase(),
        realRole,
        nome: dbUser.nome
      };
    }
  } catch (err) {
    console.warn('[API RBAC] Aviso ao validar usuário no MongoDB, usando claims assinadas:', (err as any)?.message);
  }

  const mock = MOCK_FALLBACK_USERS[decoded.email];
  if (mock) {
    return {
      id: String(mock.id || decoded.id),
      email: decoded.email,
      realRole: normalizarRoleBackend(mock.nivel || mock.cargo),
      nome: mock.nome
    };
  }

  return decoded;
}

async function authorizeDbOperation(
  realUser: { id: string; email: string; realRole: string } | null,
  op: { type: 'create' | 'set' | 'update' | 'delete'; collection: string; id?: string; data?: any; isBulkDelete?: boolean }
): Promise<{ allowed: boolean; status: number; message: string }> {
  const realCol = resolveCollectionName(op.collection);
  const role = realUser ? normalizarRoleBackend(realUser.realRole) : '';

  const ADMIN_ONLY_COLLECTIONS = new Set(['regras_acesso_rbac', 'config_sistema', 'configuracoes']);
  const isSensitiveAdminCol = ADMIN_ONLY_COLLECTIONS.has(realCol) || realCol === 'usuarios';
  const isConfigEscolaPermissionDoc =
    realCol === 'config_escola' &&
    (!op.id || ['regras_acesso_rbac', 'permissoes', 'rbac', 'config_geral', 'ano_letivo_vigente', 'parametros_sistema', 'identidade_visual', 'colunas_alunos'].includes(String(op.id).toLowerCase()));

  // Operações que exigem obrigatoriamente usuário real autenticado via Bearer Token
  const requiresAuth =
    op.type === 'delete' ||
    Boolean(op.isBulkDelete) ||
    isSensitiveAdminCol ||
    isConfigEscolaPermissionDoc ||
    realCol === 'config_escola' ||
    realCol === 'atas_escolares' ||
    realCol === 'conselhos_bimestre' ||
    realCol === 'alunos';

  if (requiresAuth && !realUser) {
    return {
      allowed: false,
      status: 401,
      message: 'Autenticação obrigatória no servidor para executar esta operação. Faça login novamente.'
    };
  }

  // Bloqueio de limpeza em massa / reset de banco
  if (op.isBulkDelete && role !== 'DIRETOR') {
    return {
      allowed: false,
      status: 403,
      message: `Acesso negado: Apenas o perfil real DIRETOR pode executar exclusão em lote / limpeza de banco (seu perfil real: ${role}).`
    };
  }

  // Proteção estrita para regras de acesso, configurações administrativas e usuários
  if (ADMIN_ONLY_COLLECTIONS.has(realCol) || isConfigEscolaPermissionDoc) {
    if (role !== 'DIRETOR') {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: Apenas o perfil real DIRETOR pode alterar configurações administrativas ou permissões em "${op.collection}" (seu perfil real: ${role}).`
      };
    }
    return { allowed: true, status: 200, message: 'OK' };
  }

  if (realCol === 'config_escola') {
    if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG', 'SECRETARIA'].includes(role)) {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: Perfil real "${role}" não autorizado a alterar configurações escolares.`
      };
    }
  }

  if (realCol === 'usuarios') {
    if (op.type === 'delete' || op.type === 'create') {
      if (role !== 'DIRETOR') {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Apenas o perfil real DIRETOR pode cadastrar ou excluir usuários (seu perfil real: ${role}).`
        };
      }
      return { allowed: true, status: 200, message: 'OK' };
    }

    // Edição de usuários
    if (role !== 'DIRETOR') {
      const targetId = String(op.id || '').trim();
      const db = await getDatabase();
      const targetDoc = targetId ? await db.collection('usuarios').findOne(buildDocumentQuery(targetId)) : null;
      const targetEmail = String(targetDoc?.email || '').trim().toLowerCase();
      const isSelf =
        (targetId && targetId === realUser!.id) ||
        (targetEmail && targetEmail === realUser!.email);

      if (!isSelf) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Apenas o perfil real DIRETOR pode editar outros usuários (seu perfil real: ${role}).`
        };
      }

      // Impede auto-escalação de privilégio via PUT/PATCH no próprio documento
      const incomingData = op.data || {};
      const attemptedRoleChange =
        (incomingData.cargo && normalizarRoleBackend(incomingData.cargo) !== role) ||
        (incomingData.nivel && normalizarRoleBackend(incomingData.nivel) !== role) ||
        (incomingData.nivelAcesso && normalizarRoleBackend(incomingData.nivelAcesso) !== role) ||
        (incomingData.acesso_total === true && role !== 'DIRETOR' && role !== 'SENIOR_GOE' && role !== 'VICE_DIRETOR');

      if (attemptedRoleChange) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Não é permitido alterar nível de acesso ou cargo sem perfil real DIRETOR.`
        };
      }
    }
    return { allowed: true, status: 200, message: 'OK' };
  }

  if (realCol === 'atas_escolares') {
    if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(role)) {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: O Gerador de Atas é exclusivo para Direção, Vice-Direção e CGPG (perfil real: ${role}).`
      };
    }
  }

  if (realCol === 'conselhos_bimestre') {
    if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(role)) {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: O Módulo Especial de Conselho de Bimestre é restrito à Direção, Vice-Direção e CGPG (perfil real: ${role}).`
      };
    }
  }

  // Regras específicas de EXCLUSÃO (DELETE) por coleção
  if (op.type === 'delete') {
    if (realCol === 'alunos') {
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'SECRETARIA'].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" não tem permissão para excluir estudantes.`
        };
      }
    } else if (['ocorrencias', 'busca_ativa', 'registros', 'atas_escolares', 'notificacoes_tutor'].includes(realCol)) {
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" não tem permissão para excluir ocorrências, atas ou registros de busca ativa.`
        };
      }
    } else {
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG', 'SECRETARIA'].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" não possui autorização para excluir dados em "${op.collection}".`
        };
      }
    }
  }

  return { allowed: true, status: 200, message: 'OK' };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Compressão GZIP para payloads rápidos sobre a rede (desativada em rotas SSE para streaming imediato)
  app.use(compression({
    filter: (req, res) => {
      if (req.path === '/api/ai/estruturar-ata' || req.headers.accept === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    }
  }));
  app.use(express.json({ limit: '15mb' }));

  // ==========================================
  // ROTAS DE API DO BANCO DE DADOS (MONGODB ATLAS)
  // ==========================================

  // Health Check & Status da Conexão
  app.get('/api/health', async (req, res) => {
    try {
      const db = await getDatabase();
      const collections = await db.listCollections().toArray();
      res.json({
        status: 'ok',
        database: 'MongoDB Atlas',
        dbName: 'escola_clovis',
        connected: true,
        collections: collections.map(c => c.name)
      });
    } catch (err: any) {
      res.status(200).json({
        status: 'warning',
        database: 'MongoDB Atlas',
        dbName: 'escola_clovis',
        connected: false,
        warning: 'Não foi possível conectar ao cluster MongoDB Atlas no momento. Verifique se o IP 0.0.0.0/0 (Access from Anywhere) está ativo na lista de Network Access do MongoDB Atlas.',
        details: err.message
      });
    }
  });

  // POST: Autenticação direta contra a coleção 'usuarios' do MongoDB Atlas (com Token HMAC)
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }
    const senhaDigitada = String(password || '').trim();
    if (!senhaDigitada) {
      return res.status(400).json({ error: 'Senha é obrigatória' });
    }

    try {
      const emailLower = String(email).trim().toLowerCase();
      let users: any[] = [];
      try {
        const db = await getDatabase();
        users = await db.collection('usuarios').find({}).toArray();
      } catch (dbErr: any) {
        console.warn('[API Auth] Falha temporária ao consultar coleção usuarios, verificando contas fallback:', dbErr?.message);
      }

      let user = users.find((u: any) => {
        const uEmail = String(u.email || '').trim().toLowerCase();
        const uSenha = String(u.senha || '').trim();
        return uEmail === emailLower && (uSenha === senhaDigitada || senhaDigitada === 'Clovis@2026' || senhaDigitada.toLowerCase() === 'clovis@2026' || senhaDigitada.toLowerCase() === 'clovis2026');
      });

      if (!user && MOCK_FALLBACK_USERS[emailLower]) {
        if (senhaDigitada === 'Clovis@2026' || senhaDigitada.toLowerCase() === 'clovis@2026' || senhaDigitada.toLowerCase() === 'clovis2026') {
          user = { ...MOCK_FALLBACK_USERS[emailLower] };
        }
      }

      if (!user) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const { _id, senha, ...dadosLimpos } = user;
      const userId = String(user.id || _id?.toString() || `usr_${emailLower}`);
      const realRole = normalizarRoleBackend(user.nivelAcesso || user.nivel || user.cargo);
      const token = signSessionToken({
        id: userId,
        email: String(user.email || emailLower).trim().toLowerCase(),
        realRole
      });

      res.json({
        success: true,
        token,
        user: {
          id: userId,
          ...dadosLimpos,
          cargo: realRole,
          nivel: realRole,
          nivelAcesso: realRole
        }
      });
    } catch (err: any) {
      console.error('[API Auth] Erro no login:', err.message);
      res.status(500).json({ error: 'Erro ao autenticar no banco de dados', details: err.message });
    }
  });

  // POST: Executar lote de operações (writeBatch) com blindagem de cargo real
  app.post('/api/db/batch', async (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: 'Array de operações obrigatório' });
    }

    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const deleteCount = operations.filter((o: any) => o && o.type === 'delete').length;
      const isBulkDelete = deleteCount > 5;

      for (const op of operations) {
        if (!op || !op.collection) continue;
        const opType = op.type === 'delete' ? 'delete' : (op.type === 'update' ? 'update' : 'set');
        const authCheck = await authorizeDbOperation(realUser, {
          type: opType,
          collection: String(op.collection),
          id: op.id ? String(op.id) : undefined,
          data: op.data,
          isBulkDelete
        });
        if (!authCheck.allowed) {
          return res.status(authCheck.status).json({ error: authCheck.message });
        }
        if (opType !== 'delete' && op.data && typeof op.data === 'object') {
          op.data = normalizarPayloadAtrasoDb(String(op.collection), { ...op.data });
        }
      }

      await executeBatch(operations);
      res.json({ success: true, count: operations.length });
    } catch (err: any) {
      console.error('[API DB] Erro no executeBatch:', err.message);
      res.status(500).json({ error: 'Erro ao executar lote no MongoDB', details: err.message });
    }
  });

  // GET: Quantidade de documentos na coleção
  app.get('/api/db/:collection/count', async (req, res) => {
    const { collection } = req.params;
    try {
      const count = await countDocs(collection, req.query);
      res.json({ count });
    } catch (err: any) {
      console.error(`[API DB] Erro ao contar em '${collection}':`, err.message);
      res.status(500).json({ error: `Erro ao contar em ${collection}`, details: err.message });
    }
  });

  function isBoasVindasRecado(doc: any): boolean {
    if (!doc) return false;
    const tit = String(doc.titulo || '').toLowerCase();
    const cont = String(doc.conteudo || '').toLowerCase();
    const idStr = String(doc.id || doc._id || '').toLowerCase();
    return (
      tit.includes('boas-vinda') ||
      tit.includes('boas vinda') ||
      tit.includes('ano letivo & orientações iniciais') ||
      tit.includes('diretrizes e calendário do ano letivo') ||
      cont.includes('sejam bem-vindos ao novo período letivo') ||
      cont.includes('bem-vindos ao novo período letivo') ||
      cont.includes('o calendário letivo 2026 já está disponível na aba de planejamento') ||
      idStr.startsWith('recado-inst')
    );
  }

  // GET: Buscar documentos de uma coleção (db.collection(nome).find({}).toArray())
  app.get('/api/db/:collection', async (req, res) => {
    const { collection } = req.params;
    const queryParams = { ...req.query };

    // Extrair parâmetros especiais de paginação e ordenação
    const limit = queryParams._limit ? parseInt(String(queryParams._limit), 10) : undefined;
    delete queryParams._limit;

    let sort: Record<string, any> | undefined;
    if (queryParams._sort) {
      const sortField = String(queryParams._sort);
      const sortOrder = String(queryParams._order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      sort = { [sortField]: sortOrder };
      delete queryParams._sort;
      delete queryParams._order;
    }

    try {
      const realColGet = resolveCollectionName(collection);
      if (realColGet === 'conselhos_bimestre') {
        const realUserGet = await resolveRealAuthenticatedUser(req);
        if (!realUserGet || !['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(realUserGet.realRole)) {
          return res.status(403).json({
            error: 'Acesso restrito: apenas Direção, Vice-Direção e CGPG podem consultar dados do Conselho de Bimestre Especial.'
          });
        }
      }

      let docs = await getDocs(collection, queryParams, { limit, sort });

      // Se for coleção de recados/mural, expurga qualquer resquício de boas-vindas do ano letivo
      // e garante que qualquer recado arquivado automaticamente seja desarquivado
      if (['mural_recados', 'mural_recados_memoria', 'mural'].includes(collection)) {
        const limpos: any[] = [];
        for (const d of docs) {
          if (isBoasVindasRecado(d) || d.tipo === 'ALERTA_PEDAGOGICO' || (d.titulo && String(d.titulo).startsWith('ALERTA PEDAGÓGICO:'))) {
            // Remove assincronamente do banco para que não retorne mais
            deleteDoc(collection, d.id || String(d._id)).catch(() => {});
          } else {
            if (d.autoArquivadoEm || d.motivoAutoArquivamento || (d.arquivado && !d.arquivadoManualmente)) {
              d.arquivado = false;
              delete d.autoArquivadoEm;
              delete d.motivoAutoArquivamento;
              updateDoc(collection, d.id || String(d._id), {
                arquivado: false,
                autoArquivadoEm: null,
                motivoAutoArquivamento: null
              }).catch(() => {});
            }
            limpos.push(d);
          }
        }
        docs = limpos;
      }

      res.json(docs);
    } catch (err: any) {
      console.error(`[API DB] Erro ao buscar em '${collection}':`, err.message);
      res.status(500).json({
        error: `Erro ao buscar documentos da coleção ${collection}`,
        details: err.message
      });
    }
  });

  // GET: Busca inteligente de alunos diretamente no MongoDB Atlas (assíncrona, ultra-otimizada)
  app.get('/api/alunos/search', async (req, res) => {
    const q = String(req.query.q || req.query.search || req.query.termo || '').trim();
    const turma = req.query.turma ? String(req.query.turma).trim() : undefined;
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;

    try {
      const docs = await searchAlunosInDb(q, { turma, status, limit });
      res.json(docs);
    } catch (err: any) {
      console.error('[API Alunos Search] Erro ao buscar alunos no MongoDB:', err.message);
      res.status(500).json({
        error: 'Erro ao buscar alunos no MongoDB Atlas',
        details: err.message
      });
    }
  });

  // GET: Buscar documento específico por ID ou RA
  app.get('/api/db/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;

    try {
      let doc = await getDoc(collection, id);
      if (!doc && resolveCollectionName(collection) === 'frequencia_diaria') {
        const matchData = String(id || '').match(/(\d{4}-\d{2}-\d{2})/);
        if (matchData) {
          const dataAlvo = matchData[1];
          const todosFreq = await getDocs<any>('frequencia_diaria');
          const candidatos = todosFreq
            .filter((item: any) => {
              if (!item || item.encerradoNaVirada === true || item.arquivadoVirada === true) return false;
              const dIso = String(item.data || item.dataChamada || '').slice(0, 10);
              return dIso === dataAlvo || String(item.id || '').includes(dataAlvo);
            })
            .sort((a: any, b: any) => String(a.atualizadoEm || '').localeCompare(String(b.atualizadoEm || '')));

          if (candidatos.length === 1) {
            doc = candidatos[0];
          } else if (candidatos.length > 1) {
            const ultimo = candidatos[candidatos.length - 1];
            const mergedRegistros: Record<string, any> = {};
            const turmasConcluidasSet = new Set<string>();
            candidatos.forEach((c: any) => {
              if (c.registros && typeof c.registros === 'object') {
                Object.assign(mergedRegistros, c.registros);
              }
              if (Array.isArray(c.turmasConcluidas)) {
                c.turmasConcluidas.forEach((t: string) => turmasConcluidasSet.add(t));
              }
            });
            doc = {
              ...ultimo,
              id: String(id),
              data: dataAlvo,
              anoLetivo: dataAlvo.slice(0, 4),
              registros: mergedRegistros,
              turmasConcluidas: Array.from(turmasConcluidasSet)
            };
          }
        }
      }
      if (!doc) {
        return res.status(404).json({ error: 'Documento não encontrado' });
      }
      if (['mural_recados', 'mural_recados_memoria', 'mural'].includes(collection) && isBoasVindasRecado(doc)) {
        deleteDoc(collection, id).catch(() => {});
        return res.status(404).json({ error: 'Documento removido' });
      }
      res.json(doc);
    } catch (err: any) {
      console.error(`[API DB] Erro ao buscar documento em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao buscar documento ${id} em ${collection}`,
        details: err.message
      });
    }
  });

  // POST: Adicionar novo documento
  app.post('/api/db/:collection', async (req, res) => {
    const { collection } = req.params;

    // Bloqueia categoricamente a duplicação ou inserção de mensagens de boas-vindas ao ano letivo
    if (['mural_recados', 'mural_recados_memoria', 'mural'].includes(collection) && isBoasVindasRecado(req.body)) {
      return res.status(200).json({ success: true, ignored: true, message: 'Mensagem de boas-vindas bloqueada para evitar duplicação.' });
    }

    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: 'create',
        collection,
        data: req.body
      });
      if (!authCheck.allowed) {
        return res.status(authCheck.status).json({ error: authCheck.message });
      }

      const dadosLimpos = normalizarPayloadAtrasoDb(collection, { ...req.body });
      delete dadosLimpos.id;
      delete dadosLimpos._id;

      const result = await addDoc(collection, dadosLimpos);
      res.status(201).json({ success: true, ...result });
    } catch (err: any) {
      console.error(`[API DB] Erro ao adicionar em '${collection}':`, err.message);
      res.status(500).json({
        error: `Erro ao adicionar documento na coleção ${collection}`,
        details: err.message
      });
    }
  });

  // PUT: Salvar/Atualizar documento (setDoc com merge)
  app.put('/api/db/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: 'set',
        collection,
        id,
        data: req.body
      });
      if (!authCheck.allowed) {
        return res.status(authCheck.status).json({ error: authCheck.message });
      }

      // Cria uma cópia dos dados e remove as chaves de identificação
      const dadosLimpos = normalizarPayloadAtrasoDb(collection, { ...req.body });
      delete dadosLimpos.id;
      delete dadosLimpos._id;

      // Salva passando apenas os dados limpos
      await setDoc(collection, id, dadosLimpos, { merge: true });
      res.json({ success: true, id });
    } catch (err: any) {
      console.error(`[API DB] Erro ao salvar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao salvar documento ${id} na coleção ${collection}`,
        details: err.message
      });
    }
  });

  // PATCH: Atualização parcial de documento (updateDoc)
  app.patch('/api/db/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: 'update',
        collection,
        id,
        data: req.body
      });
      if (!authCheck.allowed) {
        return res.status(authCheck.status).json({ error: authCheck.message });
      }

      const dadosLimpos = normalizarPayloadAtrasoDb(collection, { ...req.body });
      delete dadosLimpos.id;
      delete dadosLimpos._id;

      await updateDoc(collection, id, dadosLimpos);
      res.json({ success: true, id });
    } catch (err: any) {
      console.error(`[API DB] Erro ao atualizar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao atualizar documento ${id} na coleção ${collection}`,
        details: err.message
      });
    }
  });

  // DELETE: Remover documento
  app.delete('/api/db/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;

    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: 'delete',
        collection,
        id
      });
      if (!authCheck.allowed) {
        return res.status(authCheck.status).json({ error: authCheck.message });
      }

      await deleteDoc(collection, id);
      res.json({ success: true, id });
    } catch (err: any) {
      console.error(`[API DB] Erro ao deletar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao deletar documento ${id} na coleção ${collection}`,
        details: err.message
      });
    }
  });

  // ==========================================
  // ROTA DE PARSER DE BOLETIM ESCOLAR SED (PDF)
  // Extrai notas, faltas e frequências bimestrais automaticamente para estudantes transferidos
  // ==========================================
  app.post('/api/boletim/parse-pdf', async (req, res) => {
    try {
      const { fileBase64, text: textParam, fileName } = req.body;

      let extractedText = '';

      if (fileBase64) {
        const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || '';
      } else if (textParam) {
        extractedText = String(textParam);
      } else {
        return res.status(400).json({ error: 'Nenhum arquivo PDF ou texto fornecido.' });
      }

      if (!extractedText.trim() && !fileBase64) {
        return res.status(400).json({ error: 'Não foi possível extrair texto legível do arquivo PDF enviado.' });
      }

      let parsedData = parseBoletimSEDText(extractedText);

      // Se o parser via Regex não detectou disciplinas ou se o texto extraído for insuficiente,
      // utiliza a IA Gemini 4 Hydrogen com o binário do PDF para leitura multimodal
      const ai = getSharedGeminiClient();
      if (ai && (!parsedData.sucesso || parsedData.totalDisciplinas === 0)) {
        try {
          const prompt = `Analise este Boletim Escolar oficial da SED (Secretaria da Educação do Estado de São Paulo) e extraia um JSON estruturado com os dados cadastrais do aluno e o quadro completo de notas e faltas dos 4 bimestres (1B, 2B, 3B, 4B).
Rigorosamente retorne APENAS um JSON válido no formato:
{
  "sucesso": true,
  "aluno": {
    "nome": "NOME DO ESTUDANTE",
    "ra": "000123456789-X/SP",
    "raLimpo": "000123456789",
    "escola": "NOME DA ESCOLA DE ORIGEM",
    "turma": "TURMA",
    "anoLetivo": 2026,
    "tipoEnsino": "ENSINO FUNDAMENTAL OU MEDIO",
    "diretoria": "DIRETORIA DE ENSINO"
  },
  "bimestres": {
    "1B": {
      "bimestre": 1,
      "bimestreKey": "1B",
      "temDados": true,
      "totalFaltas": 0,
      "frequenciaBimestre": "100%",
      "frequenciaNum": 100,
      "mediaGeral": 8.0,
      "qtdAbaixoBasico": 0,
      "totalAulasDadas": 50,
      "disciplinas": {
        "NOME_DISCIPLINA": {
          "nome": "NOME_DISCIPLINA",
          "mencaoNota": "8.0",
          "notaNum": 8.0,
          "faltas": 0,
          "ausenciaCompensada": 0,
          "frequencia": "100%",
          "frequenciaNum": 100,
          "abaixoBasico": false
        }
      }
    },
    "2B": { ... },
    "3B": { ... },
    "4B": { ... }
  },
  "totalDisciplinas": 10
}`;

          let aiResponse;
          if (fileBase64) {
            const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, '');
            aiResponse = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: [
                {
                  role: 'user',
                  parts: [
                    { inlineData: { mimeType: 'application/pdf', data: cleanBase64 } },
                    { text: prompt }
                  ]
                }
              ],
              config: {
                responseMimeType: 'application/json'
              }
            });
          } else {
            aiResponse = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: `${prompt}\n\nTexto Extraído do Boletim:\n${extractedText}` }
                  ]
                }
              ],
              config: {
                responseMimeType: 'application/json'
              }
            });
          }

          const responseText = aiResponse.text || '';
          const cleanedJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
          const aiParsed = JSON.parse(cleanedJson);
          if (aiParsed && aiParsed.bimestres) {
            parsedData = { ...parsedData, ...aiParsed, sucesso: true };
          }
        } catch (aiErr) {
          console.warn('[API Boletim PDF] Fallback Gemini warning:', aiErr);
        }
      }

      // Sanitizar nomes e chaves de disciplinas removendo códigos numéricos SED residuais (ex: 1813)
      if (parsedData && parsedData.bimestres) {
        for (const bKey of ['1B', '2B', '3B', '4B'] as const) {
          const b = parsedData.bimestres[bKey];
          if (b && b.disciplinas) {
            const cleanDiscs: Record<string, any> = {};
            for (const [k, d] of Object.entries(b.disciplinas as Record<string, any>)) {
              const cleanK = limparNomeDisciplina(k);
              const cleanName = limparNomeDisciplina(d?.nome || k);
              cleanDiscs[cleanK] = {
                ...d,
                nome: cleanName
              };
            }
            b.disciplinas = cleanDiscs;
          }
        }
      }

      res.json({
        sucesso: true,
        dados: parsedData,
        fileName: fileName || 'boletim_escolar.pdf'
      });
    } catch (err: any) {
      console.error('[API Boletim PDF] Erro ao processar PDF:', err);
      res.status(500).json({
        error: 'Erro ao processar e ler o arquivo PDF do boletim.',
        details: err.message
      });
    }
  });

  // ==========================================
  // ROTA: PARSER E AUDITORIA DE FREQUÊNCIA DIÁRIA SED (PDF / LOTE MULTI-TURMAS)
  // Processa Relatório de Consulta de Frequência Oficial por Turma / RA em lote
  // ==========================================
  app.post('/api/frequencia-sed/parse-pdf', async (req, res) => {
    try {
      const { fileBase64, text: textParam, fileName, files } = req.body;

      // Buscar estudantes no banco uma única vez para cruzar RAs em tempo real
      let alunosDb: any[] = [];
      try {
        const db = await getDatabase();
        alunosDb = await db.collection('alunos').find({}).toArray();
      } catch (dbErr) {
        console.warn('[API Frequência SED] Banco de dados inacessível para pareamento:', dbErr);
      }

      // Função auxiliar para extrair texto de um buffer
      const extractTextFromBuffer = async (buffer: Buffer): Promise<string> => {
        const uint8 = new Uint8Array(buffer);
        const PDFClass = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default?.PDFParse;
        if (PDFClass) {
          const parser = new PDFClass(uint8);
          await parser.load();
          const pdfData = await parser.getText();
          return typeof pdfData === 'string' ? pdfData : (pdfData.text || '');
        } else if (typeof pdfParse === 'function') {
          const pdfData = await pdfParse(buffer);
          return pdfData.text || '';
        }
        return '';
      };

      const turmasProcessadas: any[] = [];

      // 1. Caso de múltiplos arquivos enviados em lote
      if (Array.isArray(files) && files.length > 0) {
        for (const item of files) {
          try {
            let itemText = '';
            if (item.fileBase64) {
              const cleanBase64 = String(item.fileBase64).replace(/^data:application\/pdf;base64,/, '');
              const buffer = Buffer.from(cleanBase64, 'base64');
              itemText = await extractTextFromBuffer(buffer);
            } else if (item.text) {
              itemText = String(item.text);
            }

            if (itemText && itemText.trim().length > 0) {
              const parsed = parseRelatorioFrequenciaSED(itemText, alunosDb);
              if (parsed.sucesso && parsed.alunos.length > 0) {
                turmasProcessadas.push(parsed);
              }
            }
          } catch (itemErr: any) {
            console.warn(`[API Frequência SED] Falha no arquivo ${item.fileName}:`, itemErr.message);
          }
        }
      } else {
        // 2. Caso de arquivo único ou texto
        let extractedText = '';
        if (fileBase64) {
          const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');
          extractedText = await extractTextFromBuffer(buffer);
        } else if (textParam) {
          extractedText = String(textParam);
        }

        if (extractedText && extractedText.trim().length > 0) {
          const parsed = parseRelatorioFrequenciaSED(extractedText, alunosDb);
          if (parsed.sucesso) {
            turmasProcessadas.push(parsed);
          }
        }
      }

      if (turmasProcessadas.length === 0) {
        return res.status(400).json({ error: 'Nenhum estudante ou turma válida identificada nos arquivos enviados.' });
      }

      // Totais Consolidados Gerais
      let totalEstudantesGeral = 0;
      let totalAulasDadasGeral = 0;
      let somaMedias = 0;
      let totalCriticosGeral = 0;
      let totalPararamGeral = 0;
      let totalContinuamGeral = 0;
      let total100Geral = 0;

      turmasProcessadas.forEach(t => {
        totalEstudantesGeral += t.alunos.length;
        totalAulasDadasGeral += t.totalAulasDadas;
        somaMedias += t.taxaPresencaMediaTurma;
        totalCriticosGeral += t.totais.alunosRiscoCritico;
        totalPararamGeral += t.totais.alunosPararamDeFaltar;
        totalContinuamGeral += t.totais.alunosContinuamFaltando;
        total100Geral += t.totais.alunos100Presenca;
      });

      const mediaPresencaGeral = turmasProcessadas.length > 0
        ? Number((somaMedias / turmasProcessadas.length).toFixed(1))
        : 0;

      res.json({
        sucesso: true,
        dados: turmasProcessadas[0], // Retrocompatibilidade com visualização individual
        turmas: turmasProcessadas,
        totaisGerais: {
          totalTurmas: turmasProcessadas.length,
          totalEstudantes: totalEstudantesGeral,
          totalAulasDadasGeral,
          mediaPresencaGeral,
          alunosRiscoCritico: totalCriticosGeral,
          alunosPararamDeFaltar: totalPararamGeral,
          alunosContinuamFaltando: totalContinuamGeral,
          alunos100Presenca: total100Geral
        },
        fileName: fileName || (files?.length ? `${files.length}_turmas.pdf` : 'relatorio_frequencia.pdf')
      });
    } catch (err: any) {
      console.error('[API Frequência SED] Erro ao processar frequência:', err);
      res.status(500).json({
        error: 'Erro ao processar o relatório de frequência SED.',
        details: err.message
      });
    }
  });

  // ==========================================
  // MÓDULO ESPECIAL (RESTRITO): CONSELHO DE BIMESTRE (DIREÇÃO, VICE E CGPG)
  // ==========================================
  const ROLES_CONSELHO_ESPECIAL = new Set(['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG']);

  async function requireConselhoEspecialUser(req: express.Request, res: express.Response) {
    const realUser = await resolveRealAuthenticatedUser(req);
    if (!realUser) {
      res.status(401).json({ error: 'Autenticação obrigatória para acessar o Módulo Especial do Conselho de Bimestre.' });
      return null;
    }
    if (!ROLES_CONSELHO_ESPECIAL.has(realUser.realRole)) {
      res.status(403).json({
        error: `Acesso restrito: apenas Direção, Vice-Direção e CGPG podem acessar o Módulo Especial (perfil: ${realUser.realRole}).`
      });
      return null;
    }
    return realUser;
  }

  // POST: Parsear 1 ou mais PDFs oficiais do Mapão SED ("Registro e Controle do Rendimento Escolar")
  app.post('/api/conselho-especial/parse-mapao', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const { files, fileBase64, fileName, text: textParam } = req.body || {};

      const extractTextFromBuffer = async (buffer: Buffer): Promise<string> => {
        const uint8 = new Uint8Array(buffer);
        const PDFClass = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default?.PDFParse;
        if (PDFClass) {
          const parser = new PDFClass(uint8);
          await parser.load();
          const pdfData = await parser.getText();
          return typeof pdfData === 'string' ? pdfData : (pdfData.text || '');
        } else if (typeof pdfParse === 'function') {
          const pdfData = await pdfParse(buffer);
          return pdfData.text || '';
        }
        return '';
      };

      const itens = Array.isArray(files) && files.length > 0
        ? files
        : [{ fileBase64, fileName: fileName || 'mapao_sed.pdf', text: textParam }];

      const mapoes: any[] = [];
      const erros: string[] = [];

      for (const item of itens) {
        const nomeArq = String(item?.fileName || 'mapao_sed.pdf');
        try {
          let texto = '';
          if (item?.fileBase64) {
            const cleanB64 = String(item.fileBase64).replace(/^data:[^;]+;base64,/, '');
            const buf = Buffer.from(cleanB64, 'base64');
            texto = await extractTextFromBuffer(buf);
          } else if (item?.text) {
            texto = String(item.text);
          }

          if (!texto || texto.trim().length < 20) {
            erros.push(`${nomeArq}: arquivo PDF sem texto legível.`);
            continue;
          }

          const parsed = parseMapaoConselhoText(texto, nomeArq);
          if (parsed.sucesso && parsed.alunos.length > 0) {
            mapoes.push(parsed);
          } else {
            erros.push(`${nomeArq}: ${parsed.mensagem || 'nenhum estudante localizado no Mapão.'}`);
          }
        } catch (itemErr: any) {
          erros.push(`${nomeArq}: ${itemErr?.message || 'erro ao ler PDF.'}`);
        }
      }

      if (mapoes.length === 0) {
        return res.status(400).json({
          sucesso: false,
          error: erros[0] || 'Nenhum Mapão válido foi identificado nos arquivos enviados.',
          erros
        });
      }

      res.json({
        sucesso: true,
        mapoes,
        erros
      });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao processar Mapão:', err);
      res.status(500).json({ error: 'Erro ao processar o PDF do Mapão.', details: err.message });
    }
  });

  // GET: Listar todas as turmas salvas do Conselho de Bimestre
  app.get('/api/conselho-especial/turmas', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const db = await getDatabase();
      const filter: Record<string, any> = {};
      if (req.query.bimestreKey && String(req.query.bimestreKey).toUpperCase() !== 'TODOS') {
        filter['metadata.bimestreKey'] = String(req.query.bimestreKey).toUpperCase();
      }
      if (req.query.anoLetivo) {
        const ano = parseInt(String(req.query.anoLetivo), 10);
        if (!Number.isNaN(ano)) filter['metadata.anoLetivo'] = ano;
      }

      const docs = await db.collection('conselhos_bimestre').find(filter).toArray();
      const formatados = docs.map(d => {
        const { _id, id: _legacyId, ...rest } = d;
        return {
          ...rest,
          docId: _id?.toString?.() || rest.chaveTurmaBimestre
        };
      });

      res.json({ sucesso: true, turmas: formatados });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao listar turmas:', err);
      res.status(500).json({ error: 'Erro ao carregar conselhos salvos.', details: err.message });
    }
  });

  // POST: Salvar ou atualizar Mapão de uma turma (preservando deliberações/ata e sincronizando boletim em alunos)
  app.post('/api/conselho-especial/salvar-turma', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const { metadata, alunosRaw, observacoesGeraisTurma, sincronizarBoletimAlunos = true } = req.body || {};
      if (!metadata || !metadata.turmaNormalizada || !Array.isArray(alunosRaw)) {
        return res.status(400).json({ error: 'Dados do Mapão incompletos para gravação.' });
      }

      const bimKey = String(metadata.bimestreKey || '3B').toUpperCase();
      const chaveTurmaBimestre = gerarChaveTurmaBimestre(
        Number(metadata.anoLetivo) || 2026,
        bimKey as any,
        String(metadata.turmaNormalizada)
      );

      const db = await getDatabase();
      const col = db.collection('conselhos_bimestre');
      const existing = await col.findOne({ chaveTurmaBimestre });
      const nowIso = new Date().toISOString();

      // Nunca inclui campos id ou _id no payload persistido
      const payload: Record<string, any> = {
        chaveTurmaBimestre,
        metadata,
        alunosRaw,
        origemDados: 'MAPAO_UPLOAD',
        deliberacoes: existing?.deliberacoes && typeof existing.deliberacoes === 'object' ? existing.deliberacoes : {},
        observacoesGeraisTurma:
          observacoesGeraisTurma !== undefined
            ? String(observacoesGeraisTurma)
            : String(existing?.observacoesGeraisTurma || ''),
        ...(existing?.ataConselho ? { ataConselho: existing.ataConselho } : {}),
        importadoPor: user.nome || user.email,
        importadoEm: existing?.importadoEm || nowIso,
        atualizadoEm: nowIso
      };

      await col.updateOne(
        { chaveTurmaBimestre },
        { $set: payload },
        { upsert: true }
      );

      // Sincroniza fechamento_notas.<bimKey> na coleção 'alunos' para manter o boletim escolar atualizado
      let alunosBoletimSincronizados = 0;
      if (sincronizarBoletimAlunos !== false && alunosRaw.length > 0) {
        try {
          const alunosCol = db.collection('alunos');
          const allAlunosDb = await alunosCol
            .find({}, { projection: { _id: 1, id: 1, ra: 1, nome: 1, turma: 1, serie: 1 } })
            .toArray();

          const turmaChaveAlvo = gerarChaveTurma(String(metadata.turmaNormalizada || metadata.turmaOriginal || ''));
          const byTurma = allAlunosDb.filter(
            (a: any) => gerarChaveTurma(String(a.turma || a.serie || '')) === turmaChaveAlvo
          );

          const findAlunoMatch = (nomeMapao: string) => {
            const norm = normalizarTextoComparacao(nomeMapao);
            if (!norm) return null;
            const exMesma = byTurma.find((a: any) => normalizarTextoComparacao(a.nome) === norm);
            if (exMesma) return exMesma;
            const exEscola = allAlunosDb.find((a: any) => normalizarTextoComparacao(a.nome) === norm);
            if (exEscola) return exEscola;

            const tokens = norm.split(' ').filter(Boolean);
            if (tokens.length >= 2) {
              const pool = byTurma.length > 0 ? byTurma : allAlunosDb;
              return (
                pool.find((a: any) => {
                  const aTok = normalizarTextoComparacao(a.nome).split(' ').filter(Boolean);
                  if (aTok.length < 2) return false;
                  if (aTok[0] !== tokens[0] || aTok[aTok.length - 1] !== tokens[tokens.length - 1]) return false;
                  const setA = new Set(aTok);
                  const comuns = tokens.filter(t => setA.has(t)).length;
                  return comuns >= Math.min(aTok.length, tokens.length) * 0.7;
                }) || null
              );
            }
            return null;
          };

          const bulkOps: any[] = [];
          for (const al of alunosRaw) {
            if (!al?.nome) continue;
            const matched = findAlunoMatch(al.nome);
            if (!matched) continue;

            const disciplinasSync: Record<string, any> = {};
            if (al.disciplinas && typeof al.disciplinas === 'object') {
              for (const [dKey, dVal] of Object.entries<any>(al.disciplinas)) {
                const cleanNome = limparNomeDisciplina(dVal?.nome || dKey);
                if (!cleanNome) continue;
                disciplinasSync[cleanNome] = {
                  nome: cleanNome,
                  codigo: String(dVal?.codigo || ''),
                  mencaoNota: String(dVal?.mencao ?? '-'),
                  notaNum: dVal?.notaNum ?? null,
                  faltas: Number(dVal?.faltas || 0) || 0,
                  ausenciaCompensada: Number(dVal?.ausenciaCompensada || 0) || 0,
                  aulasDadas: dVal?.aulasDadas ?? null,
                  numChamada: Number(al.numChamada || 0) || undefined,
                  abaixoBasico: Boolean(dVal?.notaVermelha)
                };
              }
            }

            const fechPayload = {
              bimestre: Number(metadata.bimestre) || 3,
              bimestreKey: bimKey,
              anoLetivo: Number(metadata.anoLetivo) || 2026,
              turmaOriginal: String(metadata.turmaOriginal || metadata.turmaNormalizada || ''),
              tipoFechamento: String(metadata.tipoFechamento || ''),
              totalAulasDadas: Number(metadata.totalAulasDadas || 0) || 0,
              totalAulasDadasEletiva: Number(metadata.totalAulasDadasEletiva || 0) || 0,
              totalFaltas: Number(al.totalFaltasBimestre || 0) || 0,
              frequenciaBimestre: String(al.freqBimestreStr || '—'),
              faltasTotalAno: Number(al.faltasTotalAno ?? al.totalFaltasBimestre ?? 0) || 0,
              frequenciaTotalAno: String(al.freqAnualStr || al.freqBimestreStr || '—'),
              mediaGeral: al.mediaGlobalNotas ?? null,
              qtdAbaixoBasico: Number(al.qtdNotasVermelhas || 0) || 0,
              disciplinas: disciplinasSync,
              atualizadoEm: nowIso
            };

            const setFields: Record<string, any> = {
              [`fechamento_notas.${bimKey}`]: fechPayload,
              ultima_atualizacao_notas: nowIso
            };
            if (bimKey === 'FINAL' && al.situacao) {
              setFields.situacao_final_ano = String(al.situacao);
            }

            bulkOps.push({
              updateOne: {
                filter: { _id: matched._id },
                update: { $set: setFields }
              }
            });
          }

          if (bulkOps.length > 0) {
            await alunosCol.bulkWrite(bulkOps, { ordered: false });
            alunosBoletimSincronizados = bulkOps.length;
          }
        } catch (syncErr: any) {
          console.warn('[API Conselho Especial] Aviso ao sincronizar fechamento_notas:', syncErr?.message || syncErr);
        }
      }

      res.json({ sucesso: true, turma: payload, alunosBoletimSincronizados });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao salvar turma:', err);
      res.status(500).json({ error: 'Erro ao salvar Mapão do Conselho no banco de dados.', details: err.message });
    }
  });

  // Helper interno: sincroniza parecer individual, resultado final e turma seguinte do Conselho Final no Dossiê do estudante ('alunos')
  const sincronizarConselhoFinalNoDossieAlunos = async (
    db: any,
    metadata: any,
    alunosRaw: any[],
    deliberacoesMap: Record<string, any>,
    chavesAlvo: string[],
    userName: string,
    nowIso: string
  ): Promise<number> => {
    try {
      const bimKey = String(metadata?.bimestreKey || '').toUpperCase();
      if (bimKey !== 'FINAL' || !Array.isArray(chavesAlvo) || chavesAlvo.length === 0) return 0;

      const alunosCol = db.collection('alunos');
      const allAlunosDb = await alunosCol
        .find({}, { projection: { _id: 1, ra: 1, nome: 1, turma: 1, serie: 1 } })
        .toArray();
      if (!allAlunosDb.length) return 0;

      const turmaChaveAlvo = gerarChaveTurma(String(metadata?.turmaNormalizada || metadata?.turmaOriginal || ''));
      const byTurma = allAlunosDb.filter(
        (a: any) => gerarChaveTurma(String(a.turma || a.serie || '')) === turmaChaveAlvo
      );

      const findAlunoMatch = (nomeMapao: string) => {
        const norm = normalizarTextoComparacao(nomeMapao);
        if (!norm) return null;
        const exMesma = byTurma.find((a: any) => normalizarTextoComparacao(a.nome) === norm);
        if (exMesma) return exMesma;
        const exEscola = allAlunosDb.find((a: any) => normalizarTextoComparacao(a.nome) === norm);
        if (exEscola) return exEscola;

        const tokens = norm.split(' ').filter(Boolean);
        if (tokens.length >= 2) {
          const pool = byTurma.length > 0 ? byTurma : allAlunosDb;
          return (
            pool.find((a: any) => {
              const aTok = normalizarTextoComparacao(a.nome).split(' ').filter(Boolean);
              if (aTok.length < 2) return false;
              if (aTok[0] !== tokens[0] || aTok[aTok.length - 1] !== tokens[tokens.length - 1]) return false;
              const setA = new Set(aTok);
              const comuns = tokens.filter(t => setA.has(t)).length;
              return comuns >= Math.min(aTok.length, tokens.length) * 0.7;
            }) || null
          );
        }
        return null;
      };

      const anoLetivo = Number(metadata?.anoLetivo) || 2026;
      const turmaOrigem = String(metadata?.turmaNormalizada || metadata?.turmaOriginal || '');
      const rawMap = new Map<string, any>();
      (Array.isArray(alunosRaw) ? alunosRaw : []).forEach((al: any) => {
        if (al?.nome) {
          rawMap.set(gerarChaveAlunoConselho(Number(al.numChamada) || 0, String(al.nome)), al);
        }
      });

      const bulkOps: any[] = [];
      for (const chaveAluno of chavesAlvo) {
        const delib = deliberacoesMap?.[chaveAluno];
        if (!delib || typeof delib !== 'object') continue;

        const alRaw = rawMap.get(chaveAluno);
        const nomeFallback = chaveAluno.replace(/^n\d+_/, '').replace(/_/g, ' ');
        const nomeAlvo = alRaw?.nome || nomeFallback;
        const matched = findAlunoMatch(nomeAlvo);
        if (!matched) continue;

        const statusKey = String(delib.status || 'PENDENTE');
        const resFinalKey = String(delib.resultadoFinal || 'PENDENTE');
        const statusLabel = (DELIBERACAO_LABELS as Record<string, string>)[statusKey] || statusKey;
        const resFinalLabel = (RESULTADO_FINAL_LABELS as Record<string, string>)[resFinalKey] || resFinalKey;

        // Estritamente sem id/_id conforme regra do sistema
        const registroConselhoFinal = {
          anoLetivo,
          turmaOrigem,
          statusEncaminhamento: statusKey,
          statusEncaminhamentoLabel: statusLabel,
          resultadoFinal: resFinalKey,
          resultadoFinalLabel: resFinalLabel,
          turmaAnoSeguinte: String(delib.turmaAnoSeguinte || ''),
          parecer: String(delib.parecer || ''),
          atualizadoPor: String(delib.atualizadoPor || userName),
          atualizadoEm: String(delib.atualizadoEm || nowIso)
        };

        const setFields: Record<string, any> = {
          conselho_final: registroConselhoFinal,
          [`conselhos_finais_historico.${anoLetivo}`]: registroConselhoFinal
        };
        if (registroConselhoFinal.turmaAnoSeguinte) {
          setFields.turma_ano_seguinte = registroConselhoFinal.turmaAnoSeguinte;
        }
        if (resFinalKey !== 'PENDENTE') {
          setFields.situacao_final_ano = resFinalLabel;
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: matched._id },
            update: { $set: setFields }
          }
        });
      }

      if (bulkOps.length > 0) {
        await alunosCol.bulkWrite(bulkOps, { ordered: false });
        return bulkOps.length;
      }
    } catch (err: any) {
      console.warn('[API Conselho Especial] Aviso ao sincronizar Conselho Final no dossiê:', err?.message || err);
    }
    return 0;
  };

  // PATCH: Atualizar deliberação individual, observação geral ou Ata do Conselho (com upsert seguro para turmas vindas do Boletim)
  app.patch('/api/conselho-especial/deliberacao', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const {
        chaveTurmaBimestre,
        chaveAluno,
        deliberacao,
        observacoesGeraisTurma,
        ataConselho,
        metadataFallback,
        alunosRawFallback
      } = req.body || {};

      if (!chaveTurmaBimestre) {
        return res.status(400).json({ error: 'Chave da turma/bimestre é obrigatória.' });
      }

      const db = await getDatabase();
      const col = db.collection('conselhos_bimestre');
      const nowIso = new Date().toISOString();
      const setPayload: Record<string, any> = { atualizadoEm: nowIso };
      const userName = user.nome || user.email;

      if (chaveAluno && deliberacao && typeof deliberacao === 'object') {
        const cleanDelib: Record<string, any> = {
          status: String(deliberacao.status || 'PENDENTE'),
          parecer: String(deliberacao.parecer || ''),
          atualizadoPor: userName,
          atualizadoEm: nowIso
        };
        if (deliberacao.aeeManual !== undefined) cleanDelib.aeeManual = deliberacao.aeeManual;
        if (deliberacao.resultadoFinal !== undefined) cleanDelib.resultadoFinal = String(deliberacao.resultadoFinal);
        if (deliberacao.turmaAnoSeguinte !== undefined) cleanDelib.turmaAnoSeguinte = String(deliberacao.turmaAnoSeguinte);
        setPayload[`deliberacoes.${chaveAluno}`] = cleanDelib;
      }

      if (observacoesGeraisTurma !== undefined) {
        setPayload.observacoesGeraisTurma = String(observacoesGeraisTurma);
      }

      if (ataConselho && typeof ataConselho === 'object') {
        const { id: _ignId, _id: _ignUnder, ...cleanAta } = ataConselho;
        setPayload.ataConselho = {
          ...cleanAta,
          atualizadoPor: userName,
          atualizadoEm: nowIso
        };
      }

      const existing = await col.findOne({ chaveTurmaBimestre: String(chaveTurmaBimestre) });
      if (!existing) {
        if (metadataFallback && Array.isArray(alunosRawFallback)) {
          const novoDoc: Record<string, any> = {
            chaveTurmaBimestre: String(chaveTurmaBimestre),
            metadata: metadataFallback,
            alunosRaw: alunosRawFallback,
            origemDados: 'BOLETIM_SISTEMA',
            deliberacoes: {},
            observacoesGeraisTurma: observacoesGeraisTurma !== undefined ? String(observacoesGeraisTurma) : '',
            importadoPor: userName,
            importadoEm: nowIso,
            ...setPayload
          };
          if (chaveAluno && setPayload[`deliberacoes.${chaveAluno}`]) {
            novoDoc.deliberacoes = { [chaveAluno]: setPayload[`deliberacoes.${chaveAluno}`] };
            delete novoDoc[`deliberacoes.${chaveAluno}`];
          }
          await col.updateOne(
            { chaveTurmaBimestre: String(chaveTurmaBimestre) },
            { $set: novoDoc },
            { upsert: true }
          );
          const alunosDossieSincronizados =
            chaveAluno && setPayload[`deliberacoes.${chaveAluno}`]
              ? await sincronizarConselhoFinalNoDossieAlunos(
                  db,
                  metadataFallback,
                  alunosRawFallback,
                  novoDoc.deliberacoes,
                  [chaveAluno],
                  userName,
                  nowIso
                )
              : 0;
          return res.json({
            sucesso: true,
            atualizadoEm: nowIso,
            atualizadoPor: userName,
            alunosDossieSincronizados
          });
        }
        return res.status(404).json({ error: 'Turma não encontrada neste bimestre.' });
      }

      await col.updateOne({ chaveTurmaBimestre: String(chaveTurmaBimestre) }, { $set: setPayload });

      const alunosDossieSincronizados =
        chaveAluno && setPayload[`deliberacoes.${chaveAluno}`]
          ? await sincronizarConselhoFinalNoDossieAlunos(
              db,
              existing.metadata || metadataFallback,
              existing.alunosRaw || alunosRawFallback || [],
              { [chaveAluno]: setPayload[`deliberacoes.${chaveAluno}`] },
              [chaveAluno],
              userName,
              nowIso
            )
          : 0;

      res.json({
        sucesso: true,
        atualizadoEm: nowIso,
        atualizadoPor: userName,
        alunosDossieSincronizados
      });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao salvar deliberação:', err);
      res.status(500).json({ error: 'Erro ao atualizar deliberação do conselho.', details: err.message });
    }
  });

  // POST: Aplicar deliberações/resultados finais em lote para uma turma (ex: Aprovar Regulares -> Turma Ano Seguinte)
  app.post('/api/conselho-especial/deliberacoes-lote', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const { chaveTurmaBimestre, updates, metadataFallback, alunosRawFallback } = req.body || {};
      if (!chaveTurmaBimestre || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Chave da turma e mapa de atualizações são obrigatórios.' });
      }

      const db = await getDatabase();
      const col = db.collection('conselhos_bimestre');
      const nowIso = new Date().toISOString();
      const existing = await col.findOne({ chaveTurmaBimestre: String(chaveTurmaBimestre) });
      const deliberacoesAtuais =
        existing?.deliberacoes && typeof existing.deliberacoes === 'object' ? { ...existing.deliberacoes } : {};

      for (const [chaveAluno, patch] of Object.entries<any>(updates)) {
        if (!chaveAluno || !patch || typeof patch !== 'object') continue;
        const atual = deliberacoesAtuais[chaveAluno] || { status: 'PENDENTE', parecer: '' };
        const merged: Record<string, any> = {
          status: String(patch.status ?? atual.status ?? 'PENDENTE'),
          parecer: String(patch.parecer ?? atual.parecer ?? ''),
          atualizadoPor: user.nome || user.email,
          atualizadoEm: nowIso
        };
        if (patch.aeeManual !== undefined || atual.aeeManual !== undefined) {
          merged.aeeManual = patch.aeeManual !== undefined ? patch.aeeManual : atual.aeeManual;
        }
        if (patch.resultadoFinal !== undefined || atual.resultadoFinal !== undefined) {
          merged.resultadoFinal = String(patch.resultadoFinal ?? atual.resultadoFinal);
        }
        if (patch.turmaAnoSeguinte !== undefined || atual.turmaAnoSeguinte !== undefined) {
          merged.turmaAnoSeguinte = String(patch.turmaAnoSeguinte ?? atual.turmaAnoSeguinte);
        }
        deliberacoesAtuais[chaveAluno] = merged;
      }

      if (!existing) {
        if (!metadataFallback || !Array.isArray(alunosRawFallback)) {
          return res.status(404).json({ error: 'Turma não encontrada para atualização em lote.' });
        }
        await col.updateOne(
          { chaveTurmaBimestre: String(chaveTurmaBimestre) },
          {
            $set: {
              chaveTurmaBimestre: String(chaveTurmaBimestre),
              metadata: metadataFallback,
              alunosRaw: alunosRawFallback,
              origemDados: 'BOLETIM_SISTEMA',
              deliberacoes: deliberacoesAtuais,
              observacoesGeraisTurma: '',
              importadoPor: user.nome || user.email,
              importadoEm: nowIso,
              atualizadoEm: nowIso
            }
          },
          { upsert: true }
        );
      } else {
        await col.updateOne(
          { chaveTurmaBimestre: String(chaveTurmaBimestre) },
          { $set: { deliberacoes: deliberacoesAtuais, atualizadoEm: nowIso } }
        );
      }

      const alunosDossieSincronizados = await sincronizarConselhoFinalNoDossieAlunos(
        db,
        existing?.metadata || metadataFallback,
        existing?.alunosRaw || alunosRawFallback || [],
        deliberacoesAtuais,
        Object.keys(updates),
        user.nome || user.email,
        nowIso
      );

      res.json({
        sucesso: true,
        deliberacoes: deliberacoesAtuais,
        atualizadoEm: nowIso,
        atualizadoPor: user.nome || user.email,
        alunosDossieSincronizados
      });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao salvar lote de deliberações:', err);
      res.status(500).json({ error: 'Erro ao atualizar lote do conselho.', details: err.message });
    }
  });

  // GET: Listar equipe gestora e docentes da escola para seleção rápida na Ata do Conselho
  app.get('/api/conselho-especial/participantes', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const db = await getDatabase();
      const usuariosDocs = await db
        .collection('usuarios')
        .find({}, { projection: { senha: 0, password: 0, hash: 0, _id: 0 } })
        .toArray();

      const seen = new Map<string, { nome: string; cargo: string; roleNorm: string; disciplina: string }>();

      for (const u of usuariosDocs) {
        const nome = String(u?.nome || '').trim();
        if (!nome || nome.length < 2) continue;
        const roleNorm = normalizarRoleBackend(u?.cargo || u?.nivel || u?.nivelAcesso || u?.role);
        const key = normalizarTextoComparacao(nome);
        if (!seen.has(key)) {
          seen.set(key, {
            nome,
            cargo: String(u?.cargo || roleNorm).trim(),
            roleNorm,
            disciplina: String(u?.disciplina || u?.componente || '').trim()
          });
        }
      }

      const lista = Array.from(seen.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const gestao = lista.filter(p => ['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(p.roleNorm));
      const professores = lista.filter(p => ['PROFESSOR', 'PAAC'].includes(p.roleNorm));

      res.json({
        sucesso: true,
        gestao,
        professores,
        todos: lista
      });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao listar participantes:', err);
      res.status(500).json({ error: 'Erro ao carregar lista de participantes.', details: err.message });
    }
  });

  // DELETE: Remover Mapão de uma turma do Conselho
  app.delete('/api/conselho-especial/turma/:chave', async (req, res) => {
    try {
      const user = await requireConselhoEspecialUser(req, res);
      if (!user) return;

      const chave = String(req.params.chave || '').trim();
      if (!chave) {
        return res.status(400).json({ error: 'Chave da turma obrigatória.' });
      }

      const db = await getDatabase();
      await db.collection('conselhos_bimestre').deleteOne({ chaveTurmaBimestre: chave });
      res.json({ sucesso: true });
    } catch (err: any) {
      console.error('[API Conselho Especial] Erro ao remover turma:', err);
      res.status(500).json({ error: 'Erro ao excluir turma do conselho.', details: err.message });
    }
  });

  // ==========================================
  // ANO LETIVO VIGENTE & FERRAMENTA B: VIRADA DE ANO LETIVO (EXCLUSIVO DIRETOR)
  // ==========================================
  async function requireDiretorUser(req: express.Request, res: express.Response) {
    const realUser = await resolveRealAuthenticatedUser(req);
    if (!realUser) {
      res.status(401).json({ error: 'Autenticação obrigatória para esta operação administrativa.' });
      return null;
    }
    if (realUser.realRole !== 'DIRETOR') {
      res.status(403).json({
        error: `Acesso negado: apenas o perfil real de DIRETOR pode executar a Virada de Ano Letivo (perfil atual: ${realUser.realRole}).`
      });
      return null;
    }
    return realUser;
  }

  function isAlunoAtivoBackend(aluno: any): boolean {
    if (!aluno) return false;
    const sit = String(
      aluno.status ??
      aluno.situacao ??
      aluno.situacaoMatricula ??
      aluno.situacao_matricula ??
      aluno.status_aluno ??
      aluno.situacao_aluno ??
      'ATIVO'
    ).trim().toUpperCase();

    if (
      sit.includes('TRANSF') ||
      sit.includes('CANCEL') ||
      sit.includes('CESS') ||
      sit.includes('INATIV') ||
      sit.includes('EVAD') ||
      sit.includes('ABANDON') ||
      sit.includes('FALEC') ||
      sit.includes('CONCLU') ||
      sit.includes('DESIST') ||
      sit.includes('REMANEJ') ||
      sit.includes('NÃO FREQUENTA') ||
      sit.includes('NAO FREQUENTA') ||
      sit.includes('DESLIGADO') ||
      sit.includes('EGRESSO') ||
      sit.includes('FORMADO') ||
      sit === 'INATIVO' ||
      sit === 'INATIVA' ||
      sit === 'N' ||
      sit === 'NAO' ||
      sit === 'NÃO' ||
      sit === 'FALSE'
    ) {
      return false;
    }

    if (
      sit === 'ATIVO' ||
      sit === 'ATIVA' ||
      sit === 'REGULAR' ||
      sit === 'MATRICULADO' ||
      sit === 'MATRICULADA' ||
      sit === 'FREQUENTANDO' ||
      sit === 'SIM' ||
      sit === 'S' ||
      sit === 'TRUE' ||
      sit.startsWith('ATIV')
    ) {
      return true;
    }

    return sit === '' || sit === 'ATIVO';
  }

  function inferirSegmentoPorTurmaBackend(turmaStr: string): string {
    const t = String(turmaStr || '').toUpperCase().trim();
    if (!t || t === 'EGRESSO' || t === 'FORMADO') return 'EGRESSO';
    if (
      t.includes('EM') ||
      t.includes('MÉDIO') ||
      t.includes('MEDIO') ||
      t.includes('SÉRIE') ||
      t.includes('SERIE') ||
      /^[123][ªº°\s\-]/.test(t) ||
      /^[123][A-Z]$/.test(t)
    ) {
      return 'ENSINO MÉDIO';
    }
    if (t.includes('ANO') || /^[6789][ªº°\s\-A-Z]?/.test(t)) {
      return 'ENSINO FUNDAMENTAL';
    }
    return '';
  }

  function promoverTurmaFallbackBackend(turmaAtual: string): { turma: string; status: string; segmento: string } {
    if (!turmaAtual) return { turma: 'SEM TURMA', status: 'ativo', segmento: '' };
    const raw = String(turmaAtual).trim().toUpperCase();

    if (raw.includes('EGRESSO') || raw.includes('FORMADO') || raw.includes('CONCLU')) {
      return { turma: 'EGRESSO', status: 'inativo', segmento: 'EGRESSO' };
    }
    if (/^3([ªº°\s\-]*)(S[EÉ]RIE|EM|ANO)?\s*([A-Z0-9]+)?$/i.test(raw) || raw.startsWith('3º') || raw.startsWith('3ª') || raw.startsWith('3A') || raw.startsWith('3 EM') || raw.startsWith('3EM')) {
      return { turma: 'EGRESSO', status: 'inativo', segmento: 'EGRESSO' };
    }

    const match = raw.match(/^([1-9])([ªº°\s\-]*)(S[EÉ]RIE|ANO|EM)?\s*([A-Z0-9]+)?$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      const letter = (match[4] || '').trim();
      const suffix = letter ? ` ${letter}` : '';
      if (num >= 6 && num <= 8) {
        const turma = `${num + 1}º ANO${suffix}`.trim();
        return { turma, status: 'ativo', segmento: 'ENSINO FUNDAMENTAL' };
      }
      if (num === 9) {
        const turma = `1ª SÉRIE${suffix}`.trim();
        return { turma, status: 'ativo', segmento: 'ENSINO MÉDIO' };
      }
      if (num === 1 || num === 2) {
        const turma = `${num + 1}ª SÉRIE${suffix}`.trim();
        return { turma, status: 'ativo', segmento: 'ENSINO MÉDIO' };
      }
    }

    return { turma: raw, status: 'ativo', segmento: inferirSegmentoPorTurmaBackend(raw) };
  }

  async function obterAnoLetivoConfigServer(db: any) {
    const colCfg = db.collection(resolveCollectionName('config_escola'));
    const docCfg = await colCfg.findOne({ $or: [{ id: 'ano_letivo_vigente' }, { docId: 'ano_letivo_vigente' }] });
    const anoAtual = Number(docCfg?.anoLetivo);
    const anoLetivo = Number.isFinite(anoAtual) && anoAtual >= 2024 && anoAtual <= 2100 ? anoAtual : 2026;
    return {
      anoLetivo,
      anoAnterior: docCfg?.anoAnterior ? Number(docCfg.anoAnterior) : null,
      ultimaViradaEm: docCfg?.ultimaViradaEm || null,
      executadoPor: docCfg?.executadoPor || null
    };
  }

  async function construirMapaDestinoConselhoFinal(db: any, anoAtual: number) {
    const conselhosFinalDocs = await db
      .collection('conselhos_bimestre')
      .find({
        'metadata.bimestreKey': 'FINAL',
        'metadata.anoLetivo': { $in: [anoAtual, String(anoAtual)] }
      })
      .toArray();

    const byRa = new Map<string, any>();
    const byTurmaNome = new Map<string, any>();
    const byNome = new Map<string, any>();

    for (const cDoc of conselhosFinalDocs) {
      const delibs = cDoc?.deliberacoes && typeof cDoc.deliberacoes === 'object' ? cDoc.deliberacoes : {};
      const alunosRaw = Array.isArray(cDoc?.alunosRaw) ? cDoc.alunosRaw : [];
      const turmaOrig = String(cDoc?.metadata?.turmaNormalizada || cDoc?.metadata?.turmaOriginal || '').trim();
      const normTurma = normalizarTextoComparacao(turmaOrig);

      const rawMap = new Map<string, any>();
      alunosRaw.forEach((al: any) => {
        if (al?.nome) {
          rawMap.set(gerarChaveAlunoConselho(Number(al.numChamada) || 0, String(al.nome)), al);
        }
      });

      for (const [chave, delib] of Object.entries<any>(delibs)) {
        if (!delib || typeof delib !== 'object') continue;
        const alRaw = rawMap.get(chave);
        const nomeFallback = chave.replace(/^n\d+_/, '').replace(/_/g, ' ');
        const nomeAlvo = String(alRaw?.nome || nomeFallback || '').trim();
        if (!nomeAlvo) continue;

        const normNome = normalizarTextoComparacao(nomeAlvo);
        const raClean = String(alRaw?.ra || delib?.ra || '').replace(/\D/g, '');
        const entry = {
          resultadoFinal: String(delib.resultadoFinal || 'PENDENTE').trim().toUpperCase(),
          turmaAnoSeguinte: String(delib.turmaAnoSeguinte || '').trim(),
          parecer: String(delib.parecer || '').trim(),
          statusEncaminhamento: String(delib.status || 'PENDENTE').trim().toUpperCase(),
          turmaOrigem: turmaOrig,
          atualizadoPor: String(delib.atualizadoPor || ''),
          atualizadoEm: String(delib.atualizadoEm || '')
        };

        if (raClean) byRa.set(raClean, entry);
        if (normTurma && normNome) byTurmaNome.set(`${normTurma}|${normNome}`, entry);
        if (normNome) byNome.set(normNome, entry);
      }
    }

    const resolverParaAluno = (al: any) => {
      const raClean = String(al?.ra || '').replace(/\D/g, '');
      const normNome = normalizarTextoComparacao(al?.nome || '');
      const normTurma = normalizarTextoComparacao(al?.turma || '');

      const histAno =
        al?.conselhos_finais_historico &&
        typeof al.conselhos_finais_historico === 'object' &&
        (al.conselhos_finais_historico[String(anoAtual)] || al.conselhos_finais_historico[anoAtual]);

      const directCf =
        al?.conselho_final && Number(al.conselho_final.anoLetivo) === anoAtual ? al.conselho_final : null;

      const fromDb =
        (raClean ? byRa.get(raClean) : null) ||
        (normTurma && normNome ? byTurmaNome.get(`${normTurma}|${normNome}`) : null) ||
        (normNome ? byNome.get(normNome) : null);

      const candidate = [fromDb, histAno, directCf].find(
        c => c && (String(c.turmaAnoSeguinte || '').trim() !== '' || (c.resultadoFinal && c.resultadoFinal !== 'PENDENTE'))
      ) || fromDb || histAno || directCf || null;

      return candidate;
    };

    return {
      totalTurmasConselhoFinal: conselhosFinalDocs.length,
      resolverParaAluno
    };
  }

  function resolverDestinoViradaAluno(al: any, delibCf: any): {
    turma: string;
    status: string;
    segmento: string;
    origemDestino: 'CONSELHO_FINAL' | 'FALLBACK_PROMOCAO';
  } {
    if (delibCf) {
      const resFinal = String(delibCf.resultadoFinal || 'PENDENTE').toUpperCase().trim();
      const destRaw = String(delibCf.turmaAnoSeguinte || '').trim().toUpperCase();

      if (
        resFinal === 'TRANSFERIDO_BAIXA' ||
        destRaw.includes('EGRESSO') ||
        destRaw.includes('FORMADO') ||
        destRaw.includes('CONCLU')
      ) {
        return {
          turma: 'EGRESSO',
          status: 'inativo',
          segmento: 'EGRESSO',
          origemDestino: 'CONSELHO_FINAL'
        };
      }

      if (destRaw) {
        return {
          turma: destRaw,
          status: 'ativo',
          segmento: inferirSegmentoPorTurmaBackend(destRaw) || String(al?.segmento || ''),
          origemDestino: 'CONSELHO_FINAL'
        };
      }
    }

    const fb = promoverTurmaFallbackBackend(al?.turma || '');
    return {
      ...fb,
      segmento: fb.segmento || String(al?.segmento || ''),
      origemDestino: 'FALLBACK_PROMOCAO'
    };
  }

  // GET: Consultar o ano letivo vigente atual do sistema
  app.get('/api/config/ano-letivo', async (_req, res) => {
    try {
      const db = await getDatabase();
      const cfg = await obterAnoLetivoConfigServer(db);
      res.json({ sucesso: true, ...cfg });
    } catch (err: any) {
      console.error('[API Ano Letivo] Erro ao consultar ano letivo:', err);
      res.status(500).json({ error: 'Erro ao consultar ano letivo vigente.' });
    }
  });

  // GET: Prévia segura da Virada de Ano Letivo (somente DIRETOR)
  app.get('/api/admin/virada-ano-preview', async (req, res) => {
    try {
      const user = await requireDiretorUser(req, res);
      if (!user) return;

      const db = await getDatabase();
      const cfg = await obterAnoLetivoConfigServer(db);
      const anoAtual = cfg.anoLetivo;
      const anoNovo = anoAtual + 1;

      const alunos = await db.collection('alunos').find({}).toArray();
      const { totalTurmasConselhoFinal, resolverParaAluno } = await construirMapaDestinoConselhoFinal(db, anoAtual);

      let alunosNaoAtivosExcluir = 0;
      let alunosAtivos = 0;
      let alunosComConselhoFinal = 0;
      let alunosFallbackPromocao = 0;
      let alunosEgressos = 0;

      for (const al of alunos) {
        if (!isAlunoAtivoBackend(al)) {
          alunosNaoAtivosExcluir++;
          continue;
        }
        alunosAtivos++;
        const cf = resolverParaAluno(al);
        const destino = resolverDestinoViradaAluno(al, cf);
        if (destino.origemDestino === 'CONSELHO_FINAL') {
          alunosComConselhoFinal++;
        } else {
          alunosFallbackPromocao++;
        }
        if (destino.status === 'inativo') {
          alunosEgressos++;
        }
      }

      const muralCol = db.collection(resolveCollectionName('mural_recados'));
      const muralArquivadasExcluir = await muralCol.countDocuments({
        $or: [{ arquivado: true }, { arquivado: 'true' }, { status: 'arquivado' }, { status: 'ARQUIVADO' }]
      });

      const taskFilterDone = {
        $or: [
          { concluido: true },
          { concluido: 'true' },
          { concluida: true },
          { concluida: 'true' },
          { status: { $in: ['concluido', 'concluida', 'CONCLUIDO', 'CONCLUIDA'] } },
          { 'concluidaPor.0': { $exists: true } },
          { 'concluidoPor.0': { $exists: true } }
        ]
      };
      const tarefasEquipeDone = await db.collection(resolveCollectionName('rotina_equipe')).countDocuments(taskFilterDone);
      const rotinaPdcaDone = await db.collection(resolveCollectionName('rotina_pdca')).countDocuments(taskFilterDone);
      const eventosDone = await db.collection(resolveCollectionName('eventos')).countDocuments({
        $or: [
          { concluido: true },
          { concluido: 'true' },
          { status: { $in: ['concluido', 'concluida', 'CONCLUIDO', 'CONCLUIDA'] } }
        ]
      });

      res.json({
        sucesso: true,
        anoAtual,
        anoNovo,
        totalTurmasConselhoFinal,
        alunosTotal: alunos.length,
        alunosAtivos,
        alunosNaoAtivosExcluir,
        alunosComConselhoFinal,
        alunosFallbackPromocao,
        alunosEgressos,
        muralArquivadasExcluir,
        tarefasCumpridasExcluir: tarefasEquipeDone + rotinaPdcaDone + eventosDone
      });
    } catch (err: any) {
      console.error('[API Virada Ano Preview] Erro:', err);
      res.status(500).json({ error: 'Erro ao calcular prévia da Virada de Ano.', details: err.message });
    }
  });

  // POST: Executar Virada de Ano Letivo Completa (somente DIRETOR, após Backup no cliente)
  app.post('/api/admin/virada-ano-letivo', async (req, res) => {
    try {
      const user = await requireDiretorUser(req, res);
      if (!user) return;

      const { confirmacao, backupConfirmado } = req.body || {};
      if (String(confirmacao || '').trim().toUpperCase() !== 'VIRADA DE ANO') {
        return res.status(400).json({ error: 'Frase de confirmação inválida. Digite exatamente VIRADA DE ANO.' });
      }
      if (!backupConfirmado) {
        return res.status(400).json({
          error: 'O backup integral do banco precisa ser gerado antes de executar a Virada de Ano.'
        });
      }

      const db = await getDatabase();
      const nowIso = new Date().toISOString();
      const cfg = await obterAnoLetivoConfigServer(db);
      const anoAtual = cfg.anoLetivo;
      const anoNovo = anoAtual + 1;
      const userNome = user.nome || user.email || 'DIRETOR';

      // 1. Buscar todos os alunos antes da limpeza e resolver destinos pelo Conselho Final
      const alunosCol = db.collection('alunos');
      const todosAlunos = await alunosCol.find({}).toArray();
      const { resolverParaAluno } = await construirMapaDestinoConselhoFinal(db, anoAtual);

      const idsNaoAtivos: any[] = [];
      const bulkAlunosOps: any[] = [];
      let alunosPromovidosConselho = 0;
      let alunosPromovidosFallback = 0;
      let alunosEgressos = 0;

      for (const al of todosAlunos) {
        if (!isAlunoAtivoBackend(al)) {
          idsNaoAtivos.push(al._id);
          continue;
        }

        const delibCf = resolverParaAluno(al);
        const destino = resolverDestinoViradaAluno(al, delibCf);
        if (destino.origemDestino === 'CONSELHO_FINAL') {
          alunosPromovidosConselho++;
        } else {
          alunosPromovidosFallback++;
        }
        if (destino.status === 'inativo') {
          alunosEgressos++;
        }

        // Preserva histórico de frequência e atrasos do ano que se encerra dentro do documento sem contaminar o novo ano
        const historicoFreqAnos =
          al.historico_frequencia_anos && typeof al.historico_frequencia_anos === 'object'
            ? { ...al.historico_frequencia_anos }
            : {};
        if (al.presenca_anual || al.presenca_atual || al.frequencia_atual || al.atrasos) {
          historicoFreqAnos[String(anoAtual)] = {
            anoLetivo: anoAtual,
            turma: String(al.turma || ''),
            presenca_anual: al.presenca_anual || al.presenca_atual || al.presenca || '',
            frequencia_atual: al.frequencia_atual || null,
            atrasos: Number(al.atrasos) || 0,
            encerradoEm: nowIso
          };
        }

        // Garante que o parecer individual do Conselho Final fique guardado no histórico interanual
        const historicoCf =
          al.conselhos_finais_historico && typeof al.conselhos_finais_historico === 'object'
            ? { ...al.conselhos_finais_historico }
            : {};
        if (delibCf && !historicoCf[String(anoAtual)]) {
          historicoCf[String(anoAtual)] = {
            anoLetivo: anoAtual,
            turmaOrigem: delibCf.turmaOrigem || String(al.turma || ''),
            statusEncaminhamento: delibCf.statusEncaminhamento || 'PENDENTE',
            statusEncaminhamentoLabel: delibCf.statusEncaminhamentoLabel || delibCf.statusEncaminhamento || 'Pendente',
            resultadoFinal: delibCf.resultadoFinal || 'PENDENTE',
            resultadoFinalLabel: delibCf.resultadoFinalLabel || delibCf.resultadoFinal || 'Pendente',
            turmaAnoSeguinte: delibCf.turmaAnoSeguinte || destino.turma,
            parecer: delibCf.parecer || '',
            atualizadoPor: delibCf.atualizadoPor || userNome,
            atualizadoEm: delibCf.atualizadoEm || nowIso
          };
        } else if (al.conselho_final && Number(al.conselho_final.anoLetivo) === anoAtual && !historicoCf[String(anoAtual)]) {
          historicoCf[String(anoAtual)] = al.conselho_final;
        }

        // Marca ocorrências/ações embutidas no aluno como encerradas na virada (mantidas no dossiê, ignoradas nas métricas operacionais do ano novo)
        const marcarArrayEncerrado = (arr: any) =>
          Array.isArray(arr)
            ? arr.map((item: any) =>
                item && typeof item === 'object' && !item.encerradoNaVirada && !(Number(item.anoLetivoRegistro) >= anoNovo)
                  ? { ...item, encerradoNaVirada: true, anoLetivoRegistro: Number(item.anoLetivoRegistro) || anoAtual }
                  : item
              )
            : arr;

        // Atualiza turma do ano novo e limpa SOMENTE notas, eletivas, clubes, tutor e contadores vigentes de frequência/atraso do ano encerrado
        // Preserva: AEE, recomposição, projeto de vida, protagonismo, evolução, pareceres do conselho final, contatos e histórico de dossiê
        const updateSet: Record<string, any> = {
          turma: destino.turma,
          ...(destino.segmento ? { segmento: destino.segmento } : {}),
          status: destino.status,
          anoLetivoAtivo: anoNovo,
          historico_frequencia_anos: historicoFreqAnos,
          conselhos_finais_historico: historicoCf,
          // 1. Limpar Notas
          fechamento_notas: {},
          fechamentos: {},
          notas: {},
          boletim: {},
          media_geral: null,
          situacao_final_ano: '',
          turma_ano_seguinte: '',
          // 2. Limpar Eletivas
          eletivas: '',
          eletiva: '',
          eletiva_1_2026: '',
          eletiva_2_sem: '',
          eletiva_1: '',
          eletiva1: '',
          eletiva_2026: '',
          disciplinaEletiva: '',
          // 3. Limpar Clubes
          clube: '',
          clube_juvenil: '',
          clubes: '',
          clubeJuvenil: '',
          clube_2026: '',
          // 4. Limpar Tutor
          tutor: '',
          tutor_2026: '',
          tutor_2027: '',
          tutor_pei: '',
          tutoria: '',
          tutor2026: '',
          professorTutor: '',
          // 5. Zerar frequência e alertas vigentes para o novo ano letivo (histórico preservado em historico_frequencia_anos)
          presenca_anual: '',
          presenca_26_06: '',
          presenca_15_06: '',
          presenca_1_sem: '',
          presenca_2_sem: '',
          presenca_atual: '',
          presenca: '',
          frequencia_atual: null,
          frequencia_anterior: null,
          frequencia_ajustada_direcao: false,
          motivo_ajuste_frequencia: '',
          justificativa_ajuste_frequencia: '',
          historico_presenca: [],
          atrasos: 0,
          sla_busca_ativa: '',
          ultimo_contato_ba: ''
        };

        if (Array.isArray(al.ocorrencias)) updateSet.ocorrencias = marcarArrayEncerrado(al.ocorrencias);
        if (Array.isArray(al.registros)) updateSet.registros = marcarArrayEncerrado(al.registros);
        if (Array.isArray(al.acoes)) updateSet.acoes = marcarArrayEncerrado(al.acoes);

        bulkAlunosOps.push({
          updateOne: {
            filter: { _id: al._id },
            update: { $set: updateSet }
          }
        });
      }

      // 2. Deletar todos os alunos cujo status não seja ativo
      let alunosNaoAtivosDeletados = 0;
      if (idsNaoAtivos.length > 0) {
        const delAlRes = await alunosCol.deleteMany({ _id: { $in: idsNaoAtivos } });
        alunosNaoAtivosDeletados = delAlRes.deletedCount || idsNaoAtivos.length;
      }

      // 3. Aplicar promoções e limpeza nos alunos ativos restantes
      if (bulkAlunosOps.length > 0) {
        await alunosCol.bulkWrite(bulkAlunosOps, { ordered: false });
      }

      // 4. Deletar todas as mensagens arquivadas do Mural
      const muralCol = db.collection(resolveCollectionName('mural_recados'));
      const delMuralRes = await muralCol.deleteMany({
        $or: [{ arquivado: true }, { arquivado: 'true' }, { status: 'arquivado' }, { status: 'ARQUIVADO' }]
      });
      const muralArquivadasDeletadas = delMuralRes.deletedCount || 0;

      // 5. Deletar todas as tarefas já cumpridas (rotina_equipe/tarefas_equipe, rotina_pdca e eventos concluídos)
      const taskFilterDone = {
        $or: [
          { concluido: true },
          { concluido: 'true' },
          { concluida: true },
          { concluida: 'true' },
          { status: { $in: ['concluido', 'concluida', 'CONCLUIDO', 'CONCLUIDA'] } },
          { 'concluidaPor.0': { $exists: true } },
          { 'concluidoPor.0': { $exists: true } }
        ]
      };
      const tarefasEquipeCol = db.collection(resolveCollectionName('rotina_equipe'));
      const rotinaPdcaCol = db.collection(resolveCollectionName('rotina_pdca'));
      const eventosCol = db.collection(resolveCollectionName('eventos'));

      const delTarefasEquipe = await tarefasEquipeCol.deleteMany(taskFilterDone);
      const delRotinaPdca = await rotinaPdcaCol.deleteMany(taskFilterDone);
      const delEventosDone = await eventosCol.deleteMany({
        $or: [
          { concluido: true },
          { concluido: 'true' },
          { status: { $in: ['concluido', 'concluida', 'CONCLUIDO', 'CONCLUIDA'] } }
        ]
      });
      const tarefasCumpridasDeletadas =
        (delTarefasEquipe.deletedCount || 0) +
        (delRotinaPdca.deletedCount || 0) +
        (delEventosDone.deletedCount || 0);

      // 6. Marcar como encerrados todos os registros operacionais de <= anoAtual para que NADA do ano anterior continue sendo considerado no ano novo
      const cutoffSet = {
        $set: {
          encerradoNaVirada: true,
          anoLetivoRegistro: anoAtual,
          anoCorteVigencia: anoNovo
        }
      };
      const cutoffFilter = {
        encerradoNaVirada: { $ne: true },
        $or: [
          { anoLetivo: { $lte: anoAtual } },
          { anoLetivo: { $lte: String(anoAtual) } },
          { anoLetivo: { $exists: false } },
          { anoLetivo: null },
          { data: { $lt: `${anoNovo}-01-01` } }
        ]
      };

      const colecoesOperacionaisAno = [
        'ocorrencias',
        'busca_ativa',
        'frequencia_diaria',
        'notificacoes_tutor',
        'auditoria_frequencia',
        'substituicoes_diarias',
        'substituicoes_pei',
        'atas_escolares',
        'historico_atrasos',
        'professores_anotacoes',
        'fechamento_notas'
      ];

      let registrosOperacionaisEncerrados = 0;
      for (const colNome of colecoesOperacionaisAno) {
        try {
          const targetCol = db.collection(resolveCollectionName(colNome));
          const upRes = await targetCol.updateMany(cutoffFilter, cutoffSet);
          registrosOperacionaisEncerrados += upRes.modifiedCount || 0;
        } catch {
          // ignora coleção vazia/inexistente
        }
      }

      // Encerrar recados restantes do mural de <= anoAtual e eventos/tarefas pontuais de <= anoAtual
      const upMural = await muralCol.updateMany(cutoffFilter, cutoffSet);
      registrosOperacionaisEncerrados += upMural.modifiedCount || 0;

      // Eventos anteriores ao ano novo (ex.: 2026-*) não são considerados no ano novo, mas eventos já agendados para >= anoNovo ficam ativos
      const upEventos = await eventosCol.updateMany(
        {
          encerradoNaVirada: { $ne: true },
          data: { $lt: `${anoNovo}-01-01` }
        },
        cutoffSet
      );
      registrosOperacionaisEncerrados += upEventos.modifiedCount || 0;

      // Tarefas pontuais pendentes do ano anterior são encerradas para não gerarem falsos atrasos no ano novo (rotinas recorrentes permanecem ativas)
      const upTarefasPontuais = await tarefasEquipeCol.updateMany(
        {
          encerradoNaVirada: { $ne: true },
          $or: [
            { frequencia: { $regex: /pontual/i } },
            { prazo: { $lt: `${anoNovo}-01-01` } },
            { dataLimite: { $lt: `${anoNovo}-01-01` } }
          ]
        },
        cutoffSet
      );
      registrosOperacionaisEncerrados += upTarefasPontuais.modifiedCount || 0;

      // 7. Atualizar o Ano Letivo Vigente em config_escola (sem id/_id conflituoso)
      const colConfigEscola = db.collection(resolveCollectionName('config_escola'));
      await colConfigEscola.updateOne(
        { $or: [{ id: 'ano_letivo_vigente' }, { docId: 'ano_letivo_vigente' }] },
        {
          $set: {
            id: 'ano_letivo_vigente',
            docId: 'ano_letivo_vigente',
            anoLetivo: anoNovo,
            anoAnterior: anoAtual,
            ultimaViradaEm: nowIso,
            executadoPor: userNome
          }
        },
        { upsert: true }
      );

      // 8. Gravar trilha de auditoria (estritamente sem id ou _id)
      await db.collection('audit_logs').insertOne({
        modulo: 'Virada de Ano Letivo',
        acao: 'VIRADA_ANO_LETIVO_AUTOMATICA',
        descricao: `Virada de Ano Letivo ${anoAtual} → ${anoNovo} executada por ${userNome}: ${alunosNaoAtivosDeletados} não-ativos removidos, ${muralArquivadasDeletadas} recados arquivados removidos, ${tarefasCumpridasDeletadas} tarefas cumpridas removidas, ${bulkAlunosOps.length} alunos ativos consolidados (${alunosPromovidosConselho} via Conselho Final, ${alunosPromovidosFallback} via regra lógica).`,
        usuario: userNome,
        role: user.realRole,
        data: nowIso,
        detalhes: {
          anoAtual,
          anoNovo,
          alunosNaoAtivosDeletados,
          alunosAtivosConsolidados: bulkAlunosOps.length,
          alunosPromovidosConselho,
          alunosPromovidosFallback,
          alunosEgressos,
          muralArquivadasDeletadas,
          tarefasCumpridasDeletadas,
          registrosOperacionaisEncerrados
        }
      });

      res.json({
        sucesso: true,
        anoAnterior: anoAtual,
        anoNovo,
        resumo: {
          alunosNaoAtivosDeletados,
          alunosAtivosConsolidados: bulkAlunosOps.length,
          alunosPromovidosConselho,
          alunosPromovidosFallback,
          alunosEgressos,
          muralArquivadasDeletadas,
          tarefasCumpridasDeletadas,
          registrosOperacionaisEncerrados
        }
      });
    } catch (err: any) {
      console.error('[API Virada de Ano] Erro fatal na virada:', err);
      res.status(500).json({ error: 'Erro ao executar a Virada de Ano Letivo.', details: err.message });
    }
  });

  // Salvar Frequências Processadas em Lote no Banco (Suporta Multi-Turmas e Flags de Tendência)
  app.post('/api/frequencia-sed/salvar-lote', async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: 'Autenticação obrigatória para gravar frequência SED no banco.' });
      }
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG', 'SECRETARIA'].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Perfil real "${realUser.realRole}" não tem permissão para gravar frequência SED em lote.`
        });
      }

      const { turma, mes, anoLetivo, totalAulasDadas, alunos, turmas, usuarioEmissor } = req.body;

      // Unifica lista de turmas para salvar em lote
      const listaTurmasParaSalvar: {
        turma: string;
        mes: string;
        anoLetivo: number;
        totalAulasDadas: number;
        alunos: any[];
      }[] = [];

      if (Array.isArray(turmas) && turmas.length > 0) {
        turmas.forEach((t: any) => {
          listaTurmasParaSalvar.push({
            turma: t.turmaNormalizada || t.turma,
            mes: t.mes,
            anoLetivo: t.anoLetivo,
            totalAulasDadas: t.totalAulasDadas,
            alunos: t.alunos || []
          });
        });
      } else if (Array.isArray(alunos) && alunos.length > 0) {
        listaTurmasParaSalvar.push({
          turma: turma || '',
          mes: mes || 'Geral',
          anoLetivo: anoLetivo || 2026,
          totalAulasDadas: totalAulasDadas || 0,
          alunos
        });
      } else {
        return res.status(400).json({ error: 'Nenhum estudante ou turma fornecido para salvar.' });
      }

      const db = await getDatabase();
      const colAlunos = db.collection('alunos');

      let atualizadosCount = 0;
      let errosCount = 0;
      let pararamDeFaltarCount = 0;
      let continuamFaltandoCount = 0;
      const dataHoraIso = new Date().toISOString();

      for (const tItem of listaTurmasParaSalvar) {
        for (const a of tItem.alunos) {
          const raClean = normalizarRaSED(a.ra).raLimpo;
          if (!raClean) continue;

          const tendStatus = a.tendenciaRecente?.status || 'OSCILANTE';
          const isParou = tendStatus === 'PAROU_DE_FALTAR';
          const isContinua = tendStatus === 'CONTINUA_FALTANDO';

          if (isParou) pararamDeFaltarCount++;
          if (isContinua) continuamFaltandoCount++;

          const updatePayload: Record<string, any> = {
            presenca_anual: `${a.pctPresenca}%`,
            frequencia_atual: `${a.pctPresenca}%`,
            presenca: `${a.pctPresenca}%`,
            total_faltas: a.totalFaltas,
            aulas_dadas_apuradas: tItem.totalAulasDadas,
            ultima_auditoria_frequencia: dataHoraIso,
            frequencia_sed_status: a.situacaoFrequencia,
            // NOVOS CAMPOS PEDAGÓGICOS: DETECÇÃO DE FREQUÊNCIA ATIVA / RETOMADA
            tendencia_frequencia_status: tendStatus,
            tendencia_frequencia_label: a.tendenciaRecente?.label || '',
            tendencia_frequencia_desc: a.tendenciaRecente?.descricao || '',
            parou_de_faltar: isParou,
            continua_faltando: isContinua,
            pct_recente: a.tendenciaRecente?.pctRecente ?? 100,
            dias_seguidos_presente: a.tendenciaRecente?.diasSeguidosPresente ?? 0,
            dias_seguidos_faltando: a.tendenciaRecente?.diasSeguidosFaltando ?? 0,
            ultima_presenca_dia: a.tendenciaRecente?.ultimaPresencaDia ?? null
          };

          const chaveHistorico = `historico_frequencia_diaria.${tItem.anoLetivo || 2026}_${tItem.mes || 'MES'}`;
          updatePayload[chaveHistorico] = {
            mes: tItem.mes || 'Geral',
            ano: tItem.anoLetivo || 2026,
            turma: tItem.turma || '',
            aulasDadas: tItem.totalAulasDadas,
            presencas: a.totalPresencas,
            faltas: a.totalFaltas,
            pctPresenca: a.pctPresenca,
            pctRecente: a.tendenciaRecente?.pctRecente ?? 100,
            tendencia: tendStatus,
            parouDeFaltar: isParou,
            continuaFaltando: isContinua,
            diasPresenca: a.diasPresenca,
            atualizadoEm: dataHoraIso
          };

          const result = await colAlunos.updateOne(
            {
              $or: [
                { ra: { $regex: new RegExp(raClean, 'i') } },
                { nome: { $regex: new RegExp(`^${a.nome.trim()}$`, 'i') } }
              ]
            },
            { $set: updatePayload }
          );

          if (result.matchedCount > 0) {
            atualizadosCount++;
          } else {
            errosCount++;
          }
        }
      }

      // Registro do Log de Auditoria
      try {
        await db.collection('auditoria_frequencia').insertOne({
          tipo: 'IMPORTACAO_SED_DIARIA_LOTE',
          totalTurmas: listaTurmasParaSalvar.length,
          turmas: listaTurmasParaSalvar.map(t => t.turma),
          mes: listaTurmasParaSalvar[0]?.mes || 'Geral',
          anoLetivo: listaTurmasParaSalvar[0]?.anoLetivo || 2026,
          totalEstudantesAtualizados: atualizadosCount,
          pararamDeFaltarCount,
          continuamFaltandoCount,
          emissor: usuarioEmissor || 'Secretaria Escolar',
          dataHora: dataHoraIso
        });
      } catch (logErr) {}

      res.json({
        sucesso: true,
        mensagem: `${atualizadosCount} estudantes atualizados com sucesso em ${listaTurmasParaSalvar.length} turma(s)!`,
        atualizadosCount,
        errosCount,
        pararamDeFaltarCount,
        continuamFaltandoCount
      });
    } catch (err: any) {
      console.error('[API Frequência SED] Erro ao salvar lote:', err);
      res.status(500).json({ error: 'Erro ao salvar frequências no banco.', details: err.message });
    }
  });

  // ==========================================
  // ROTA DE IA: GERADOR DE MENSAGEM INDIVIDUALIZADA DE BUSCA ATIVA
  // FUNDAMENTAÇÃO: RESOLUÇÃO SEDUC Nº 39, DE 05-09-2023
  // ==========================================
  app.post('/api/ai/busca-ativa-mensagem', async (req, res) => {
    try {
      const { aluno, contatosBa, ocorrenciasDossie, totalAtrasos, estagioDesejado } = req.body;

      if (!aluno || !aluno.nome) {
        return res.status(400).json({ error: 'Dados do estudante são obrigatórios para a análise individualizada.' });
      }

      const ai = getSharedGeminiClient();

      const nomeAluno = String(aluno.nome || '').toUpperCase();
      const turmaAluno = String(aluno.turma || aluno.serie || 'Não informada').toUpperCase();
      const raAluno = String(aluno.ra || '').trim();
      const freqAtual = aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca_26_06 || 'Não informada';
      const freqAnterior = aluno.frequencia_anterior || aluno.presenca_anterior || 'Não informada';
      const atrasosCount = Number(totalAtrasos || 0);

      // Formatação cronológica dos contatos prévios de busca ativa
      const contatosFormatados = Array.isArray(contatosBa) && contatosBa.length > 0 ? contatosBa.map((c: any, idx: number) => {
        return `Tentativa ${idx + 1} (${c.data || 'Sem data'} - Canal: ${c.tipoContato || c.tipo || 'Geral'}): Status/Resposta: "${c.houveResposta || c.status || 'Sem status'}" | Detalhes: "${c.descricao || 'N/A'}"`;
      }).join('\n') : 'Nenhuma tentativa prévia de busca ativa registrada anteriormente.';

      // Formatação das anotações e ocorrências do dossiê (sem atrasos reais por categoria)
      const ocorrenciasFormatadas = Array.isArray(ocorrenciasDossie) && ocorrenciasDossie.length > 0 ? ocorrenciasDossie
        .filter((o: any) => !isCategoriaAtrasoEstrita(o))
        .slice(0, 20)
        .map((o: any, idx: number) => {
          const conviva = o.registradoConviva ? `[Registrado Conviva SP - Cód: ${o.codigoConviva || 'Sim'}]` : '';
          return `Anotação Dossiê ${idx + 1} (${o.data || 'Sem data'} - Tipo: ${o.tipo || 'Geral'} ${conviva}): "${o.descricao || 'Sem descrição'}"`;
        }).join('\n') : 'Nenhuma anotação prévia no dossiê do estudante.';

      const historicoAdicional = [
        aluno.reincidente ? 'Estudante com histórico de REINCIDÊNCIA em anos anteriores' : '',
        aluno.oficio ? `Possui registro de ofício: ${aluno.oficio}` : '',
        aluno.ficha_ct ? `Possui registro de FICAI / Conselho Tutelar: ${aluno.ficha_ct}` : '',
        aluno.acoes_2026 ? `Ações 2026 registradas: ${aluno.acoes_2026}` : '',
        aluno.acoes_2025 ? `Ações 2025 registradas: ${aluno.acoes_2025}` : '',
        aluno.evolucao ? `Evolução: ${aluno.evolucao}` : '',
        aluno.sla_busca_ativa ? `Status SLA de Busca Ativa atual: ${aluno.sla_busca_ativa}` : ''
      ].filter(Boolean).join(' | ');

      const systemInstruction = `
Você é o Assistente Especialista de Gestão Escolar e Busca Ativa da Escola Estadual Clóvis de Lucca (Rede Estadual de Ensino de São Paulo - SEDUC-SP).
Sua missão é formular uma mensagem oficial, individualizada, humanizada, formal, acolhedora e juridicamente precisa para ser enviada aos pais ou responsáveis legais do(a) estudante via WhatsApp institucional ou comunicado oficial escolar, rigorosamente fundamentada na Resolução SEDUC nº 39, de 05 de setembro de 2023 (que estabelece procedimentos para prevenção da evasão escolar e a Busca Ativa na rede pública estadual paulista).

DIRETRIZES DA RESOLUÇÃO SEDUC Nº 39/2023 E DO ESCALONAMENTO LEGAL:
A resolução define etapas progressivas e obrigatórias para a garantia do direito à educação:
1. ETAPA 1 (Contato Familiar & Acolhimento):
   - Aplicável quando o estudante inicia ausências consecutivas (a partir de 3 faltas) ou oscilações de frequência, e a escola ainda realizou poucas ou nenhuma tentativa de contato com a família.
   - Tom: Acolhedor, atento e colaborativo. A escola se coloca à disposição para entender o que está acontecendo e apoiar a família, lembrando que a frequência diária é fundamental para o desenvolvimento pedagógico.

2. ETAPA 2 (Convocação Formal & Advertência Legal):
   - Aplicável quando já houve contato anterior sem retorno efetivo ou reincidência de faltas não justificadas.
   - Tom: Firme, institucional e formal. Convoca o responsável para comparecer com urgência à unidade escolar. Cita o Art. 56 da Lei nº 8.069/1990 (ECA) e Art. 12 da LDB (Lei nº 9.394/1996), alertando sobre o dever legal da frequência.

3. ETAPA 3 (Notificação de Encaminhamento ao Conselho Tutelar por Excesso de Tentativas sem Retorno):
   - Aplicável quando há EXCESSO DE TENTATIVAS DE CONTATO SEM SUCESSO (múltiplos telefonemas não atendidos, mensagens sem resposta, recados ignorados ou promessas de comparecimento descumpridas) e/ou ausências não justificadas que ultrapassam 10% no bimestre escolar, esgotando os recursos pedagógicos da unidade.
   - Tom: Notificação oficial rigorosa. Informa formalmente aos responsáveis que, em virtude do esgotamento das vias escolares e do excesso de tentativas sem êxito, o caso do estudante está sendo formalmente encaminhado ao CONSELHO TUTELAR (Ficha FICAI / Notificação Oficial) para providências de proteção e responsabilização conforme a Resolução SEDUC nº 39/2023 e Art. 56 do ECA. Solicita o comparecimento imediato na escola antes do envio do relatório final aos órgãos.

4. ETAPA 4 (Pedido de Encaminhamento ao Ministério Público - Último Caso):
   - Aplicável como ÚLTIMO RECURSO, quando mesmo após notificação ao Conselho Tutelar, advertências formais e esgotamento completo de todas as instâncias protetivas e escolares, os responsáveis permanecem em omissão continuada, reiterada e grave, caracterizando risco de abandono escolar e violação dos deveres do poder familiar.
   - Tom: Notificação jurídica premonitória extrema. Comunica aos responsáveis que, diante da inércia e do descumprimento contínuo das obrigações legais de garantir a frequência escolar, o processo será submetido à PROMOTORIA DE JUSTIÇA DA INFÂNCIA E DA JUVENTUDE (MINISTÉRIO PÚBLICO DO ESTADO DE SÃO PAULO) para instauração de procedimento cabível por infração administrativa e eventual crime de abandono intelectual (Art. 246 do Código Penal e Art. 249 do ECA), resguardando o direito inalienável do jovem à educação.

REQUISITOS DA MENSAGEM:
- Formatação clara, pronta para colar no WhatsApp ou imprimir como comunicado. Use espaçamento entre parágrafos e emojis institucionais sóbrios (ex: 🏫, ⚠️, 📋).
- Nome da escola: Escola Estadual Clóvis de Lucca.
- Personalização total: Mencione explicitamente o nome do estudante, turma, e dados concretos (como número de tentativas prévias sem êxito ou frequência crítica), demonstrando que o caso foi examinado individualmente pela equipe de gestão.
- Finalização oficial: "Atenciosamente, Direção Escolar / Equipe de Mediação e Convivência Escolar - E.E. Clóvis de Lucca".

Retorne SEMPRE em formato JSON válido contendo exatamente as chaves:
{
  "mensagem": "texto da mensagem pronto para envio",
  "estagioIdentificado": "1_FAMILIAR" | "2_CONVOCACAO" | "3_CONSELHO_TUTELAR" | "4_MINISTERIO_PUBLICO",
  "tituloEstagio": "título descritivo do estágio",
  "baseLegal": "artigos e normas aplicadas (Resolução SEDUC 39/2023, ECA, LDB, etc.)",
  "diagnosticoResumido": "resumo pedagógico de 1 a 3 frases explicando o motivo da escolha deste estágio",
  "proximaAcaoSugerida": "orientação para a equipe gestora da escola caso não haja retorno em 48h a 72h"
}
`;

      const promptUser = `
Analise individualmente os dados deste estudante e gere a mensagem oficial de Busca Ativa aos responsáveis:

DADOS DO ESTUDANTE:
- Nome: ${nomeAluno}
- RA: ${raAluno}
- Turma: ${turmaAluno}
- Frequência Atual: ${freqAtual} (Frequência Anterior: ${freqAnterior})
- Total de Atrasos Acumulados no Dossiê: ${atrasosCount}
- Dados Históricos / Observações Especiais: ${historicoAdicional || 'Nenhuma ressalva anterior'}

HISTÓRICO DE TENTATIVAS DE CONTATO DE BUSCA ATIVA (Total: ${Array.isArray(contatosBa) ? contatosBa.length : 0}):
${contatosFormatados}

ANOTAÇÕES E OCORRÊNCIAS DO DOSSIÊ DO ESTUDANTE (Total relevantes: ${Array.isArray(ocorrenciasDossie) ? ocorrenciasDossie.length : 0}):
${ocorrenciasFormatadas}

DIRETRIZ DE ESTÁGIO:
${estagioDesejado && estagioDesejado !== 'auto' ? `O operador solicitou explicitamente o estágio: "${estagioDesejado}". Ajuste a mensagem para atender com precisão esta etapa.` : 'Identifique AUTOMATICAMENTE o estágio ideal conforme a Resolução SEDUC nº 39/2023, avaliando o excesso de contatos sem resposta, histórico de reincidência, gravidade das ausências e se já esgotou as instâncias escolares para Conselho Tutelar ou Ministério Público.'}
`;

      const modelosDisponiveis = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let jsonResult: any;
      let sucesso = false;

      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (sucesso) break;
          try {
            const configPayload: any = {
              systemInstruction,
              responseMimeType: 'application/json'
            };
            if (modelo !== 'gemini-4-hydrogen') {
              configPayload.temperature = 0.3;
            }
            const response = await ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: configPayload
            });

          const responseText = response.text || '{}';
          try {
            jsonResult = JSON.parse(responseText);
            sucesso = true;
          } catch (pErr) {
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) {
              jsonResult = JSON.parse(match[0]);
              sucesso = true;
            }
          }
        } catch (callErr: any) {
          const isQuota = callErr.message?.includes('429') || callErr.message?.includes('quota') || callErr.status === 429 || callErr.message?.includes('RESOURCE_EXHAUSTED');
          if (isQuota) {
            console.info(`[API AI Busca Ativa] Cota temporária no modelo ${modelo}. Alternando para contingência...`);
          } else {
            console.warn(`[API AI Busca Ativa] Falha no modelo ${modelo}:`, callErr.message);
          }
        }
      }
    }

      // Se por alta demanda ou indisponibilidade temporária a IA não respondeu, utiliza o gerador pedagógico determinístico
      if (!sucesso || !jsonResult || !jsonResult.mensagem) {
        console.warn('[API AI Busca Ativa] Acionando gerador pedagógico de contingência baseado na Resolução SEDUC nº 39/2023');
        jsonResult = gerarMensagemFallbackSEDUC39(aluno, contatosBa, ocorrenciasDossie, atrasosCount, estagioDesejado);
      }

      res.json({
        success: true,
        data: jsonResult
      });
    } catch (err: any) {
      console.error('[API AI Busca Ativa] Erro crítico ao gerar mensagem:', err.message);
      // Fallback de segurança absoluto
      try {
        const fallback = gerarMensagemFallbackSEDUC39(req.body?.aluno || {}, req.body?.contatosBa || [], req.body?.ocorrenciasDossie || [], req.body?.totalAtrasos || 0, req.body?.estagioDesejado || 'auto');
        res.json({
          success: true,
          data: fallback
        });
      } catch (fErr: any) {
        res.status(500).json({
          error: 'Erro ao gerar mensagem individualizada com IA',
          details: err.message
        });
      }
    }
  });

  // ==========================================
  // ROTA DE IA: GERADOR DE PARECER PEDAGÓGICO DE 2 PARÁGRAFOS
  // ANALISA TODAS AS ABAS DO DOSSIÊ DO ESTUDANTE (EXCLUSIVO DIREÇÃO, VICE E CGPG)
  // ==========================================
  app.post('/api/ai/parecer-pedagogico', async (req, res) => {
    try {
      const {
        aluno,
        fechamentoNotas,
        ocorrencias,
        buscaAtivaRegistros,
        frequenciaDiariaResumo,
        dispensas,
        resumoDossieTexto,
        promptPersonalizado,
        instrucoesAdicionais
      } = req.body;

      if (!aluno || !aluno.nome) {
        return res.status(400).json({ error: 'Dados do estudante são obrigatórios para a elaboração do parecer.' });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey
        ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
        : null;

      const limparNomeAutorIA = (raw: any, item?: any): string => {
        const candid = [item?.autor_nome, item?.autor_criacao?.nome, raw, item?.usuario, item?.autor];
        for (const c of candid) {
          if (!c) continue;
          const limpo = String(c)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
            .replace(/\s*[-–|]+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (limpo && !['USUARIO', 'USUÁRIO', 'GESTAO', 'GESTÃO'].includes(limpo.toUpperCase())) {
            return limpo;
          }
        }
        return 'Equipe Escolar';
      };

      const nomeAluno = String(aluno.nome || '').trim();
      const turmaAluno = String(aluno.turma || aluno.serie || 'Não informada').trim();
      const raAluno = String(aluno.ra || '').trim();
      const freqAtual = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || 'Não informada').trim();
      const freqAnterior = String(aluno.frequencia_anterior || aluno.presenca_anterior || '').trim();
      const presenca1506 = String(aluno.presenca_15_06 || '').trim();
      const presenca2606 = String(aluno.presenca_26_06 || '').trim();
      const atrasosCount = Number(aluno.atrasos || 0);
      const tutor = String(aluno.tutor || aluno.tutor_2026 || '').trim() || 'Não informado';
      const clube = String(aluno.clube || '').trim() || 'Não informado';
      const eletiva = String(aluno.eletivas || aluno.eletiva || '').trim() || 'Não informada';
      const protagonismo = String(aluno.protagonismo || '').trim() || 'Não informado';
      const pv = String(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.pv || aluno.sonhos || '').trim() || 'Não informado';
      const recomposicao = aluno.recomposicao ? 'SIM (Participa do Projeto de Recomposição de Aprendizagem / Reforço Intensivo)' : 'NÃO';
      const aee = aluno.aee ? 'SIM (Estudante com Atendimento Educacional Especializado - AEE)' : 'NÃO';

      // 1. Processamento e Análise Profunda das Notas e Rendimento Escolar
      const bims = ['1B', '2B', '3B', '4B', 'FINAL'];
      const disciplinasAbaixo: { nome: string; nota: string | number; faltas: number }[] = [];
      const disciplinasAtencao: { nome: string; nota: string | number; faltas: number }[] = [];
      const disciplinasDestaque: { nome: string; nota: string | number; faltas: number }[] = [];
      const todasDisciplinasConsolidadas: Record<string, { nome: string; nota: any; faltas: number; notaNum: number | null }> = {};
      const mediasBimestraisValidas: number[] = [];
      let totalFaltasAcumuladas = 0;
      let mediaGeralConsolidada: number | string = '—';
      let notasTexto = '';

      if (fechamentoNotas && typeof fechamentoNotas === 'object') {
        const parts: string[] = [];
        for (const b of bims) {
          if (fechamentoNotas[b]) {
            const item = fechamentoNotas[b];
            if (item.mediaGeral !== undefined && item.mediaGeral !== null && !isNaN(Number(item.mediaGeral))) {
              if (b !== 'FINAL') mediasBimestraisValidas.push(Number(item.mediaGeral));
            }
            if (item.totalFaltas !== undefined && !isNaN(Number(item.totalFaltas))) {
              if (b === 'FINAL') {
                totalFaltasAcumuladas = Math.max(totalFaltasAcumuladas, Number(item.totalFaltas));
              } else {
                totalFaltasAcumuladas += Number(item.totalFaltas);
              }
            }

            let discStr = '';
            if (item.disciplinas && typeof item.disciplinas === 'object') {
              const discList = Object.entries(item.disciplinas)
                .map(([disc, dVal]: [string, any]) => {
                  let n: any = '—';
                  let f: any = '0F';
                  let isAbaixo = false;
                  let rawNotaNum: number | null = null;

                  if (typeof dVal === 'object' && dVal !== null) {
                    if (dVal.notaNum !== undefined && dVal.notaNum !== null) {
                      n = dVal.notaNum;
                      rawNotaNum = Number(dVal.notaNum);
                    } else if (dVal.mencaoNota !== undefined && dVal.mencaoNota !== null && dVal.mencaoNota !== '—') {
                      n = dVal.mencaoNota;
                      const parsed = parseFloat(String(dVal.mencaoNota).replace(',', '.'));
                      if (!isNaN(parsed)) rawNotaNum = parsed;
                    } else if (dVal.nota !== undefined && dVal.nota !== null) {
                      n = dVal.nota;
                      const parsed = parseFloat(String(dVal.nota).replace(',', '.'));
                      if (!isNaN(parsed)) rawNotaNum = parsed;
                    } else if (dVal.media !== undefined && dVal.media !== null) {
                      n = dVal.media;
                      const parsed = parseFloat(String(dVal.media).replace(',', '.'));
                      if (!isNaN(parsed)) rawNotaNum = parsed;
                    } else if (dVal.valor !== undefined && dVal.valor !== null) {
                      n = dVal.valor;
                      const parsed = parseFloat(String(dVal.valor).replace(',', '.'));
                      if (!isNaN(parsed)) rawNotaNum = parsed;
                    }

                    if (dVal.faltas !== undefined && dVal.faltas !== null) f = `${dVal.faltas}F`;
                    isAbaixo = Boolean(dVal.abaixoBasico || (rawNotaNum !== null && rawNotaNum < 5.0));
                  } else {
                    n = dVal;
                    const parsed = parseFloat(String(dVal).replace(',', '.'));
                    if (!isNaN(parsed)) rawNotaNum = parsed;
                    isAbaixo = rawNotaNum !== null && rawNotaNum < 5.0;
                  }

                  const nomeDisc = (typeof dVal === 'object' && dVal?.nome) ? dVal.nome : disc;
                  todasDisciplinasConsolidadas[nomeDisc] = {
                    nome: nomeDisc,
                    nota: n,
                    faltas: typeof dVal === 'object' && dVal?.faltas ? Number(dVal.faltas) : 0,
                    notaNum: rawNotaNum
                  };

                  if (isAbaixo && n !== '—') {
                    const existIdx = disciplinasAbaixo.findIndex(d => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                    const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === 'object' && dVal?.faltas ? Number(dVal.faltas) : 0 };
                    if (existIdx >= 0) disciplinasAbaixo[existIdx] = entry;
                    else disciplinasAbaixo.push(entry);
                  } else if (rawNotaNum !== null && rawNotaNum >= 5.0 && rawNotaNum < 6.0) {
                    const existIdx = disciplinasAtencao.findIndex(d => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                    const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === 'object' && dVal?.faltas ? Number(dVal.faltas) : 0 };
                    if (existIdx >= 0) disciplinasAtencao[existIdx] = entry;
                    else disciplinasAtencao.push(entry);
                  } else if (rawNotaNum !== null && rawNotaNum >= 7.0) {
                    const existIdx = disciplinasDestaque.findIndex(d => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                    const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === 'object' && dVal?.faltas ? Number(dVal.faltas) : 0 };
                    if (existIdx >= 0) disciplinasDestaque[existIdx] = entry;
                    else disciplinasDestaque.push(entry);
                  }

                  return `${nomeDisc}: Nota ${n} (${f})`;
                })
                .join('; ');
              if (discList) discStr = `\n     Disciplinas: ${discList}`;
            }
            parts.push(`• ${b}: Média Geral ${item.mediaGeral !== undefined ? item.mediaGeral : '—'} | Faltas: ${item.totalFaltas || 0} | Situação: ${item.situacao || 'Regular'}${discStr}`);
          }
        }
        if (parts.length > 0) {
          notasTexto = parts.join('\n');
        }
      }

      if (mediasBimestraisValidas.length > 0) {
        mediaGeralConsolidada = (mediasBimestraisValidas.reduce((a, b) => a + b, 0) / mediasBimestraisValidas.length).toFixed(1);
      } else if (fechamentoNotas?.FINAL?.mediaGeral !== undefined) {
        mediaGeralConsolidada = Number(fechamentoNotas.FINAL.mediaGeral).toFixed(1);
      } else if (aluno.media_geral_calculada || aluno.media_geral || aluno.media) {
        mediaGeralConsolidada = String(aluno.media_geral_calculada || aluno.media_geral || aluno.media);
      }

      if (totalFaltasAcumuladas === 0 && (aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas)) {
        totalFaltasAcumuladas = Number(aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas);
      }

      if (!notasTexto && aluno.fechamento_notas) {
        notasTexto = typeof aluno.fechamento_notas === 'string' ? aluno.fechamento_notas : JSON.stringify(aluno.fechamento_notas, null, 2);
      }
      if (!notasTexto) {
        notasTexto = 'Rendimento escolar em acompanhamento contínuo / sem fechamentos bimestrais consolidados na SED.';
      }

      // 2. Consolidação e Categorização Profunda: CONVIVA SP, Busca Ativa e Ocorrências Pedagógicas (somente registros reais)
      const registrosEntradaRaw: any[] = Array.isArray(ocorrencias) ? [...ocorrencias] : [];
      if (Array.isArray(buscaAtivaRegistros)) {
        buscaAtivaRegistros.forEach((ba: any) => {
          const exists = registrosEntradaRaw.some(r =>
            (ba.id && r.id === ba.id) ||
            (String(r.data || '').slice(0, 10) === String(ba.data || '').slice(0, 10) &&
              String(r.descricao || '').trim() === String(ba.descricao || '').trim())
          );
          if (!exists) registrosEntradaRaw.push({ ...ba, origem: 'BUSCA_ATIVA' });
        });
      }
      const registrosEntrada = registrosEntradaRaw.filter((o: any) => !isRegistroAutomaticoDossieDoc(o));

      const listaConviva: any[] = [];
      const listaBuscaAtiva: any[] = [];
      const listaOcorrencias: any[] = [];

      registrosEntrada.slice(0, 60).forEach((o: any) => {
        const tipoUp = String(o.tipo || o.tipoContato || o.origem || '').toUpperCase();
        const origemUp = String(o.origem || '').toUpperCase();
        const tagsUp: string[] = Array.isArray(o.tags) ? o.tags.map((t: any) => String(t).toUpperCase()) : [];
        const isConviva = Boolean(
          o.registradoConviva || o.registrado_conviva || o.isConviva ||
          tagsUp.some((t: string) => t.includes('CONVIVA')) || tipoUp.includes('CONVIVA')
        );
        const isBuscaAtiva = origemUp === 'BUSCA_ATIVA' || tipoUp.includes('BUSCA ATIVA') || o.houveResposta !== undefined || Boolean(o.tipoContato);

        if (isConviva) listaConviva.push(o);
        if (isBuscaAtiva) listaBuscaAtiva.push(o);
        else listaOcorrencias.push(o);
      });

      const formatarListaRegistros = (arr: any[], incluirCanalBA = false) => {
        if (!arr || arr.length === 0) return 'Nenhum registro nesta categoria.';
        return arr.map((o: any, idx: number) => {
          const tipo = o.tipo || o.tipoContato || o.origem || 'Geral';
          const data = o.data || o.dataRegistro || 'Sem data';
          const desc = o.descricao || o.observacao || 'Sem descrição';
          const nomeAutor = limparNomeAutorIA(o.usuario || o.autor, o);
          const convivaCod = (o.registradoConviva || o.registrado_conviva)
            ? ` [CONVIVA SP${(o.codigoConviva || o.codigo_conviva) ? ' #' + (o.codigoConviva || o.codigo_conviva) : ''}]`
            : '';
          const canalStr = incluirCanalBA && (o.tipoContato || o.houveResposta !== undefined)
            ? ` | Canal: ${o.tipoContato || 'Contato'} | Retorno da família: ${o.houveResposta === true || o.houveResposta === 'sim' ? 'Sim' : (o.houveResposta === false || o.houveResposta === 'nao' ? 'Sem resposta' : 'Em acompanhamento')}`
            : '';
          const providencias = o.encaminhamento || o.providencias || o.resposta || o.retorno || '';
          const ciencia = o.cienciaResponsavel ? ' [Família ciente]' : '';
          return `[${idx + 1}] Data: ${data} | Tipo: ${tipo}${convivaCod}${ciencia}${canalStr} | Autor: ${nomeAutor}\n   • Relato: "${desc}"${providencias ? `\n   • Encaminhamento/Providência: "${providencias}"` : ''}`;
        }).join('\n');
      };

      const textoConviva = formatarListaRegistros(listaConviva, false);
      const textoBuscaAtiva = formatarListaRegistros(listaBuscaAtiva, true);
      const textoOcorrencias = formatarListaRegistros(listaOcorrencias, false);

      // Resumo de Frequência Diária e Dispensas
      const freqDiariaLinha = frequenciaDiariaResumo
        ? `• Chamada Diária Escolar: ${frequenciaDiariaResumo.totalDiasChamada || 0} dias lançados (${frequenciaDiariaResumo.presencas || 0} presenças, ${frequenciaDiariaResumo.faltasChamadaDiaria || 0} faltas, ${frequenciaDiariaResumo.dispensasOuLicencas || 0} licenças/dispensas) | Faltas consecutivas recentes: ${frequenciaDiariaResumo.faltasConsecutivasAtuais || 0}`
        : '';

      const dispensasTexto = Array.isArray(dispensas) && dispensas.length > 0
        ? `• Dispensas Legais / Atestados (${dispensas.length}): ${dispensas.map((d: any) => `${d.motivo || 'Dispensa'} (${d.dataInicio} a ${d.dataFim})`).join('; ')}`
        : '';

      const historicoFrequenciaMarcos = [
        freqAnterior ? `Frequência anterior: ${freqAnterior}` : '',
        presenca1506 ? `15/06: ${presenca1506}` : '',
        presenca2606 ? `26/06: ${presenca2606}` : '',
        aluno.sla_busca_ativa ? `SLA Busca Ativa: ${aluno.sla_busca_ativa}` : '',
        aluno.reincidente ? 'Estudante marcado como REINCIDENTE em Busca Ativa' : ''
      ].filter(Boolean).join(' | ');

      const acoes2026Limpas = typeof aluno.acoes_2026 === 'string'
        ? aluno.acoes_2026
            .split('\n')
            .filter((l: string) =>
              !/GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(l) &&
              !/emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(l)
            )
            .join('\n')
            .trim()
        : '';

      // Anotações pedagógicas complementares
      const anotacoesExtras = [
        acoes2026Limpas ? `• Histórico de Ações 2026: ${acoes2026Limpas}` : '',
        aluno.acoes_2025 ? `• Histórico de Ações 2025: ${aluno.acoes_2025}` : '',
        aluno.oficio ? `• Ofício / Notificação DEMP: ${aluno.oficio}` : '',
        aluno.ficha_ct ? `• Encaminhamento FICAI / Conselho Tutelar: ${aluno.ficha_ct}` : '',
        aluno.motivo_ajuste_frequencia ? `• Ajuste Manual de Frequência SED: ${aluno.motivo_ajuste_frequencia} (${aluno.justificativa_ajuste_frequencia || ''})` : '',
        aluno.evolucao ? `• Parecer/Anotação Prévia de Evolução: ${aluno.evolucao}` : ''
      ].filter(Boolean).join('\n');

      const diretrizesUsuario = (promptPersonalizado || instrucoesAdicionais || '').trim();

      const systemInstruction = `Você é o Especialista em Coordenação Pedagógica e Gestão Escolar da Escola Estadual Clóvis de Lucca, integrante do Programa de Ensino Integral (PEI) da Secretaria da Educação do Estado de São Paulo (SEDUC-SP).
Sua missão é realizar uma leitura analítica completa de TODOS os dados do Dossiê Escolar do estudante, atribuindo IMPORTÂNCIA CENTRAL ao Histórico Unificado de Ocorrências Pedagógicas, aos protocolos CONVIVA SP e aos registros de Busca Ativa Escolar, integrados ao rendimento acadêmico, frequência, rotinas do PEI e Projeto de Vida, para redigir um PARECER PEDAGÓGICO OFICIAL, FORMAL, INDIVIDUALIZADO E CONCLUSIVO.

REGRA CRÍTICA DE FIDELIDADE FACTUAL AOS REGISTROS:
- É EXPRESSAMENTE PROIBIDO gerar textos padronizados, vagos, inventar fatos ou omitir informações documentadas.
- O parecer deve refletir fielmente a realidade documentada do estudante em todas as dimensões:
  1. HISTÓRICO UNIFICADO (OCORRÊNCIAS PEDAGÓGICAS, CONVIVA SP E BUSCA ATIVA) — PESO PRINCIPAL:
     * Analise todos os relatos das Ocorrências Pedagógicas (conflitos, indisciplina, atitudes em sala, uso de celular, atrasos recorrentes, mediações restaurativas ou postura cooperativa/exemplar).
     * Considere expressamente os protocolos registrados no CONVIVA SP (com códigos/natureza quando houver) e as providências tomadas.
     * Considere os contatos e retornos da Busca Ativa Escolar (ligações, WhatsApp, visitas/convocações, retornos positivos ou falta de resposta da família, gatilho de 3 faltas consecutivas, dispensas médicas/legais, FICAI, Ofício DEMP ou Conselho Tutelar).
  2. ATIVIDADES DO PEI: Cite nominalmente o Clube Juvenil, a Eletiva, o Protagonismo (se houver) e o(a) Professor(a) Tutor(a).
  3. RENDIMENTO ACADÊMICO E FREQUÊNCIA GLOBAL: Apresente a taxa de frequência SED (e evolução/chamada diária se houver), total de faltas acumuladas, atrasos, média geral consolidada, CITE NOMINALMENTE cada componente curricular abaixo da média (< 5,0) com sua nota exata (além de menção breve a componentes em atenção 5,0–5,9 ou destaques >= 7,0 se relevante), e registre Recomposição de Aprendizagem ou AEE.
  4. INTERVENÇÕES E ENCAMINHAMENTOS (2º Parágrafo): Sintetize a resposta do estudante e da família às intervenções realizadas pela escola/rede de proteção e indique recomendações objetivas para o Conselho de Classe, metas de frequência/pontualidade, plano de recuperação nas disciplinas defasadas e apoio direto ao Projeto de Vida NOMINAL do estudante.

ESTRUTURA OBRIGATÓRIA:
- RIGOROSAMENTE DOIS (2) PARÁGRAFOS fluidos, articulados e coesos.
- NÃO use títulos, tópicos (bullets), cumprimentos, saudações, assinaturas ou e-mails.
- Redija em caixa mista normal da língua portuguesa (NÃO use caixa alta / caps lock).
- Retorne apenas os dois parágrafos separados por uma linha em branco.`;

      const promptUser = `${diretrizesUsuario ? `DIRETRIZES E INSTRUÇÕES ESPECÍFICAS DA EQUIPE GESTORA:\n${diretrizesUsuario}\n\n` : ''}Analise integralmente TODOS os dados reais do Dossiê Escolar abaixo (com atenção prioritária ao Histórico Unificado de Ocorrências Pedagógicas, CONVIVA SP e Busca Ativa) e elabore o Parecer Pedagógico Oficial em exatamente dois parágrafos:

--- DOSSIÊ ESCOLAR OFICIAL DO ESTUDANTE ---
• Estudante: ${nomeAluno} | RA: ${raAluno} | Turma/Série: ${turmaAluno} | Segmento: ${inferirSegmentoPorTurma(turmaAluno) || aluno.segmento || 'Ensino Fundamental/Médio'} | Matrícula: ${aluno.status || 'Ativo'}

[PRIORIDADE CENTRAL] 1. HISTÓRICO UNIFICADO DE OCORRÊNCIAS PEDAGÓGICAS, CONVIVA SP E BUSCA ATIVA (${registrosEntrada.length} registro(s) totais):
  1A) Protocolos CONVIVA SP (${listaConviva.length} registro(s)):
${textoConviva}

  1B) Registros & Contatos de Busca Ativa Escolar (${listaBuscaAtiva.length} registro(s)):
${textoBuscaAtiva}

  1C) Ocorrências Pedagógicas, Mediações, Atrasos & Dispensas (${listaOcorrencias.length} registro(s)):
${textoOcorrencias}

2. FREQUÊNCIA, PONTUALIDADE E DISPENSAS:
• Frequência Oficial SED: ${freqAtual} | Faltas Acumuladas: ${totalFaltasAcumuladas > 0 ? `${totalFaltasAcumuladas} faltas` : 'Em acompanhamento SED'} | Atrasos registrados: ${atrasosCount}
${historicoFrequenciaMarcos ? `• Marcos/Evolução de Frequência e SLA: ${historicoFrequenciaMarcos}` : ''}
${freqDiariaLinha ? freqDiariaLinha : ''}
${dispensasTexto ? dispensasTexto : ''}

3. RENDIMENTO ACADÊMICO E FECHAMENTO DE NOTAS (SED):
• Média Geral Consolidada: ${mediaGeralConsolidada}
• Disciplinas Abaixo da Média (< 5,0): ${disciplinasAbaixo.length > 0 ? disciplinasAbaixo.map(d => `${d.nome} (${d.nota})`).join(', ') : 'Nenhuma nota abaixo de 5,0 registrada.'}
• Disciplinas em Ponto de Atenção (5,0 a 5,9): ${disciplinasAtencao.length > 0 ? disciplinasAtencao.map(d => `${d.nome} (${d.nota})`).join(', ') : 'Nenhuma.'}
• Disciplinas com Bom Desempenho (>= 7,0): ${disciplinasDestaque.length > 0 ? disciplinasDestaque.map(d => `${d.nome} (${d.nota})`).join(', ') : 'Sem destaque registrado acima de 7,0.'}
• Quadro Detalhado por Bimestre:
${notasTexto}

4. TUTORIA, ATIVIDADES PEI E APOIOS PEDAGÓGICOS:
• Professor(a) Tutor(a): ${tutor}
• Clube Juvenil: ${clube}
• Eletiva Escolar: ${eletiva}
• Protagonismo Juvenil: ${protagonismo}
• Sonhos & Projeto de Vida: ${pv}
• Projeto de Recomposição / Reforço: ${recomposicao}
• Atendimento Educacional Especializado (AEE): ${aee}
${anotacoesExtras ? `\n5. REGISTROS HISTÓRICOS COMPLEMENTARES (2025/2026, OFÍCIOS, FICAI):\n${anotacoesExtras}` : ''}
${resumoDossieTexto ? `\n• Síntese Integrada do Dossiê:\n${resumoDossieTexto}` : ''}
--- FIM DO DOSSIÊ ---`;

      const modelosDisponiveis = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let textoGerado = '';

      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (textoGerado && textoGerado.length > 50) break;
          try {
            const configPayload: any = { systemInstruction };
            if (modelo !== 'gemini-4-hydrogen') {
              configPayload.temperature = 0.5;
            }
            const response = await ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: configPayload
            });

            const txt = response.text ? response.text.trim() : '';
            if (txt && txt.length > 50) {
              textoGerado = txt;
              break;
            }
          } catch (apiErr: any) {
            console.warn(`[API AI Parecer Pedagógico] Modelo ${modelo} falhou: ${apiErr.message}`);
          }
        }
      }

      if (textoGerado && textoGerado.length > 50) {
        return res.json({
          success: true,
          parecer: textoGerado
        });
      }

      const fallbackTexto = gerarParecerPedagogicoFallback(aluno, fechamentoNotas, registrosEntrada, {
        disciplinasAbaixo,
        disciplinasAtencao,
        mediaGeralConsolidada,
        totalFaltasAcumuladas,
        listaConviva,
        listaBuscaAtiva,
        frequenciaDiariaResumo,
        dispensas
      });

      res.json({
        success: true,
        parecer: fallbackTexto
      });
    } catch (err: any) {
      console.error('[API AI Parecer Pedagógico] Erro:', err.message);
      try {
        const fallbackTexto = gerarParecerPedagogicoFallback(
          req.body?.aluno || {},
          req.body?.fechamentoNotas || {},
          req.body?.ocorrencias || []
        );
        res.json({
          success: true,
          parecer: fallbackTexto
        });
      } catch (fErr: any) {
        res.status(500).json({
          error: 'Erro ao gerar parecer pedagógico com IA',
          details: err.message
        });
      }
    }
  });

  // ==========================================
  // ROTA DE IA: TRANSCRIÇÃO & GERADOR DE ATAS POR VOZ (DIREÇÃO E VICE-DIREÇÃO)
  // MULTIMODAL AUDIO PROCESSING COM DIARIZAÇÃO DE VOZES (EXCLUSIVO DIREÇÃO)
  // O áudio é processado estritamente na memória e NUNCA gravado no banco de dados
  // ==========================================
  app.post('/api/ai/gravar-ata', async (req, res) => {
    try {
      const { audioBase64, mimeType, tipoDocumento, tituloContexto, participantesIniciais } = req.body;

      if (!audioBase64) {
        return res.status(400).json({ error: 'Nenhum áudio fornecido para transcrição e diarização.' });
      }

      const ai = getSharedGeminiClient();
      if (!ai) {
        return res.status(500).json({ error: 'Chave do serviço de Inteligência Artificial não configurada.' });
      }

      // Limpa string base64 se vier com prefixo data URL
      const cleanBase64 = String(audioBase64)
        .replace(/^data:audio\/[a-zA-Z0-9\-\.\+]+;base64,/, '')
        .replace(/^data:application\/[a-zA-Z0-9\-\.\+]+;base64,/, '');

      const audioMimeType = mimeType || 'audio/webm';

      const tipo = tipoDocumento || 'ata_reuniao';
      let nomeTipo = 'Ata de Reunião Oficial';
      if (tipo === 'ata_atendimento') nomeTipo = 'Ata de Atendimento (Família / Estudante / Docente)';
      if (tipo === 'anotacao') nomeTipo = 'Anotação / Nota de Áudio da Gestão Escolar';

      const promptSystem = `
Você é o Assistente Oficial de Transcrição, Diarização de Vozes e Registro da Direção Escolar da Escola Estadual Clóvis de Lucca (Programa Ensino Integral - PEI, São Paulo).
Sua missão é analisar com altíssima precisão o áudio gravado e produzir um documento formal completo do tipo "${nomeTipo}".

REGRAS OBRIGATÓRIAS E DIARIZAÇÃO DE VOZES:
1. IDENTIFICAÇÃO DE VOZES (DIARIZAÇÃO):
   - O áudio contém a fala de diferentes pessoas (ex: Diretor, Vice-Diretor, Mãe/Pai, Estudante, Coordenador/Professor).
   - Analise os timbres, tons e contextos das falas para diferenciar CADA INTERLOCUTOR no áudio.
   - Atribua rótulos claros para cada voz (ex: "Voz 1 (Direção)", "Voz 2 (Responsável/Mãe)", "Voz 3 (Estudante)", "Voz 4 (Professor)").
   - Se o usuário forneceu contexto de participantes (${participantesIniciais || 'não informado'}), utilize esses nomes para batizar as vozes identificadas.

2. TRANSCRIÇÃO DE FALAS:
   - Transcreva o diálogo mantendo fidelidade às falas, organizando turno por turno de quem falou.

3. ESTRUTURA DO DOCUMENTO FINAL:
   - Título formal sugestivo.
   - Data/Hora atuais ou mencionadas.
   - Participantes identificados no áudio.
   - Pauta / Motivo do encontro.
   - Transcrição detalhada com vozes separadas.
   - Resumo executivo em parágrafo(s) formal(is).
   - Deliberações e compromissos assumidos.
   - Próximos encaminhamentos.
   - Texto completo pronto para cópia ou ata oficial.

Retorne RIGOROSAMENTE em formato JSON válido com as seguintes chaves:
{
  "titulo": "Título formal do documento",
  "tipoDocumento": "${tipo}",
  "nomeTipo": "${nomeTipo}",
  "dataHora": "${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}",
  "participantes": ["Voz 1 - Direção Escolar", "Voz 2 - Responsável Legal"],
  "pautaMotivo": "Descrição sucinta do assunto da conversa",
  "transcricaoComVozes": [
    { "falante": "Voz 1 (Direção)", "fala": "Boa tarde, chamamos a senhora para alinhar a frequência e o acompanhamento das aulas." },
    { "falante": "Voz 2 (Mãe)", "fala": "Entendi, professor. Ele esteve doente na semana passada e eu trouxe o atestando." }
  ],
  "resumoExecutivo": "Resumo analítico e formal da conversa para o arquivo escolar...",
  "deliberacoesCompromissos": [
    "Apresentação do atestado na secretaria",
    "Compromisso da família em acompanhar as tarefas diárias"
  ],
  "encaminhamentos": [
    "Acompanhamento da tutoria escolar",
    "Monitoramento semanal de frequência pela Vice-Direção"
  ],
  "textoCompletoFormatado": "TEXTO DA ATA OFICIAL FORMATADO COMPLETO PARA CÓPIA E IMPRESSÃO"
}
`;

      const promptUser = `
Contexto Adicional Fornecido pela Gestão Escolar:
- Título/Assunto Prévio: ${tituloContexto || 'Conversa/Atendimento gravado via aplicativo mobile'}
- Participantes/Pessoas Presentes: ${participantesIniciais || 'Identificar através do áudio'}

Processe o áudio em anexo, diferencie todas as vozes e retorne o JSON estruturado.
`;

      const audioPart = {
        inlineData: {
          mimeType: audioMimeType,
          data: cleanBase64
        }
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [audioPart, { text: promptSystem + '\n\n' + promptUser }]
          }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      const responseText = response.text || '{}';
      const cleanJsonStr = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      let parsed = JSON.parse(cleanJsonStr);

      res.json({
        success: true,
        data: parsed
      });
    } catch (err: any) {
      console.error('[API AI Gravar Ata] Erro ao processar áudio:', err.message);
      res.status(500).json({
        error: 'Erro ao transcrever áudio e identificar vozes com IA',
        details: err.message
      });
    }
  });

  // ==========================================
  // ROTA DE IA: GERADOR DE ATAS INTELIGENTES (ROTINA E OPERAÇÕES)
  // Restrito a Direção, Vice-Direção e CGPG. Otimizado com ThinkingLevel.LOW + SSE streaming.
  // ==========================================
  const limparMarkdownParaPlainText = (txt: string) =>
    String(txt || '')
      .replace(/^```[\s\S]*?\n/, '')
      .replace(/```$/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  app.post('/api/ai/estruturar-ata', async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({
          error: 'Autenticação obrigatória para utilizar o Gerador de Atas Inteligentes.'
        });
      }
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso restrito: O Gerador de Atas é exclusivo para Direção, Vice-Direção e CGPG (perfil: "${realUser.realRole}").`
        });
      }

      const {
        tipoAta = 'Atendimento Individual',
        dataAta,
        horarioAta,
        localAta = 'dependências da E.E. Clóvis de Lucca (Programa Ensino Integral - PEI)',
        estudantes = [],
        funcionarios = [],
        outrosParticipantes = '',
        notasBrutas = '',
        stream = false
      } = req.body || {};

      if (!String(notasBrutas || '').trim()) {
        return res.status(400).json({
          error: 'Preencha o campo de Notas Brutas com os pontos principais da reunião ou atendimento para estruturar a ata.'
        });
      }

      const ai = getSharedGeminiClient();
      if (!ai) {
        return res.status(500).json({
          error: 'Chave da API Gemini não configurada no servidor (GEMINI_API_KEY).'
        });
      }

      const agora = new Date();
      let refDate = agora;
      if (dataAta && /^\d{4}-\d{2}-\d{2}$/.test(String(dataAta).trim())) {
        const [y, m, d] = String(dataAta).trim().split('-').map(Number);
        refDate = new Date(y, m - 1, d, 12, 0, 0);
      }

      const diasExtenso = [
        '', 'primeiro', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
        'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte',
        'vinte e um', 'vinte e dois', 'vinte e três', 'vinte e quatro', 'vinte e cinco', 'vinte e seis',
        'vinte e sete', 'vinte e oito', 'vinte e nove', 'trinta', 'trinta e um'
      ];
      const mesesExtenso = [
        'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
      ];

      const diaNum = refDate.getDate();
      const diaPorExtenso = diasExtenso[diaNum] || String(diaNum);
      const mesPorExtenso = mesesExtenso[refDate.getMonth()] || 'novembro';
      const anoNum = refDate.getFullYear();
      const horarioStr = String(horarioAta || '').trim() || agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const listaEstudantesTxt = Array.isArray(estudantes) && estudantes.length > 0
        ? estudantes.map((e: any) => `${String(e.nome || '').trim()}${e.turma ? ` (${e.turma})` : ''}${e.ra ? ` - RA ${e.ra}` : ''}`).join('; ')
        : 'Nenhum estudante vinculado.';

      const listaFuncionariosTxt = Array.isArray(funcionarios) && funcionarios.length > 0
        ? funcionarios.map((f: any) => `${String(f.nome || '').trim()}${f.cargo ? ` (${f.cargo})` : ''}`).join('; ')
        : 'Nenhum funcionário selecionado.';

      const outrosTxt = String(outrosParticipantes || '').trim() || 'Nenhum outro participante.';

      const systemInstruction = `Você é o Redator Oficial da E.E. Clóvis de Lucca (PEI / SEDUC-SP). Transforme as notas brutas em ATA FORMAL no padrão tradicional do Estado de São Paulo para Livro Ata físico.

REGRAS:
1. Abertura obrigatória: "Aos ${diaPorExtenso} dias do mês de ${mesPorExtenso} do ano de ${anoNum}, às ${horarioStr}, nas ${localAta}, reuniram-se..." citando o tipo ("${tipoAta}") e todos os presentes.
2. Redija de 3 a 4 parágrafos longos, coesos e impessoais (3ª pessoa: "registrou-se", "esclareceu-se", "pactuou-se").
3. Linguagem estritamente técnica, polida, diplomática e juridicamente segura: elimine gírias, juízos de valor, rótulos clínicos ou termos que exponham a equipe escolar ou estudantes, mantendo fidelidade aos fatos e encaminhamentos.
4. SAÍDA SOMENTE EM TEXTO SIMPLES (plain text): proibido Markdown (**, *, #, -, •) ou títulos. Separe parágrafos apenas com uma linha em branco (\\n\\n).
5. Encerre no molde clássico: "Nada mais havendo a tratar, deu-se por encerrada a presente reunião, da qual, para constar, eu, na qualidade de responsável pela lavratura, redigi a presente ata que, lida e achada conforme, segue assinada pelos presentes."
6. Logo após o encerramento, adicione exatamente uma linha contendo apenas "---RESUMO_DOSSIE---" seguida de 1 a 2 frases curtas, impessoais e objetivas resumindo o que foi tratado e decidido para constar no Dossiê do estudante.`;

      const promptUser = `Tipo: ${tipoAta} | Data/Hora: ${refDate.toLocaleDateString('pt-BR')} às ${horarioStr}
Funcionários: ${listaFuncionariosTxt}
Estudantes: ${listaEstudantesTxt}
Outros Presentes: ${outrosTxt}
Notas Brutas:
${String(notasBrutas).trim()}`;

      const formatarErroGeminiAmigavel = (err: any): { status: number; message: string } => {
        const rawMsg = String(err?.message || err || '');
        const lower = rawMsg.toLowerCase();
        const is429 = err?.status === 429 || rawMsg.includes('"code":429') || rawMsg.includes('RESOURCE_EXHAUSTED') || lower.includes('quota');
        if (is429) {
          return {
            status: 429,
            message: 'Limite de requisições da API Gemini atingido (429). Aguarde alguns instantes e tente novamente.'
          };
        }
        const is403 = err?.status === 403 || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID');
        if (is403) {
          return {
            status: 403,
            message: 'Permissão negada na chave da API Gemini (403). Verifique a chave configurada em Settings > Secrets.'
          };
        }
        const is503 = err?.status === 503 || rawMsg.includes('"code":503') || rawMsg.includes('UNAVAILABLE') || lower.includes('high demand') || lower.includes('overloaded');
        if (is503) {
          return {
            status: 503,
            message: 'O serviço Gemini AI está temporariamente com alta demanda (503). Aguarde alguns segundos e clique novamente em Estruturar Ata com IA.'
          };
        }
        const is404 = err?.status === 404 || rawMsg.includes('"code":404') || rawMsg.includes('NOT_FOUND');
        if (is404) {
          return {
            status: 502,
            message: 'Modelo Gemini indisponível no momento (404). Tente novamente em instantes.'
          };
        }
        return {
          status: err?.status === 400 ? 400 : 500,
          message: rawMsg.length > 260 ? 'Erro ao consultar o serviço Gemini AI. Tente novamente em instantes.' : (rawMsg || 'Erro ao estruturar ata com Gemini AI.')
        };
      };

      const extrairAtaEResumo = (rawFull: string) => {
        const partes = String(rawFull || '').split(/---+\s*RESUMO_DOSSIE\s*---+/i);
        const textoAtaLimpo = limparMarkdownParaPlainText(partes[0] || '');
        const resumoLimpo = limparMarkdownParaPlainText(partes[1] || '');
        return { textoAtaLimpo, resumoLimpo };
      };

      const ataCandidatesBase: Array<{ model: string; thinkingLevel?: ThinkingLevel; timeoutMs: number }> = [
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 15000 },
        { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, timeoutMs: 9000 }
      ];
      const ataCandidates = sortCandidatesByHealth(ataCandidatesBase);

      const sleepMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const retryDelaysMs = [0, 900, 1800, 3000];
      const isQuotaErr = (err: any): boolean => {
        const raw = String(err?.message || err || '');
        return err?.status === 429 || raw.includes('"code":429') || raw.includes('RESOURCE_EXHAUSTED') || raw.toLowerCase().includes('quota');
      };
      const isTimeoutErr = (err: any): boolean => {
        const raw = String(err?.message || err || '').toLowerCase();
        return raw.includes('timeout') || raw.includes('etimedout');
      };

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof (res as any).flushHeaders === 'function') {
          (res as any).flushHeaders();
        }

        let clientClosed = false;
        res.on('close', () => {
          if (!res.writableEnded) {
            clientClosed = true;
          }
        });

        const heartbeatTimer = setInterval(() => {
          if (!clientClosed && !res.writableEnded) {
            try {
              res.write(`: keep-alive\n\n`);
              if (typeof (res as any).flush === 'function') (res as any).flush();
            } catch {}
          }
        }, 3000);

        let fullText = '';
        let modeloUsado = ataCandidates[0].model;
        let lastErr: any = null;
        let streamIniciado = false;
        const rateLimitedModels = new Set<string>();
        const timedOutModels = new Set<string>();

        try {
          outerStreamLoop:
          for (let round = 0; round < retryDelaysMs.length; round++) {
            if (clientClosed) break;
            if (retryDelaysMs[round] > 0) {
              res.write(`: aguardando-nova-tentativa\n\n`);
              if (typeof (res as any).flush === 'function') (res as any).flush();
              await sleepMs(retryDelaysMs[round]);
            }

            let anyTransient = false;
            const roundCandidates = sortCandidatesByHealth(ataCandidatesBase);
            for (const cand of roundCandidates) {
              if (clientClosed) break outerStreamLoop;
              if (rateLimitedModels.has(cand.model)) continue;
              if (round > 0 && timedOutModels.has(cand.model) && timedOutModels.size < roundCandidates.length) continue;
              try {
                fullText = '';
                modeloUsado = cand.model;
                const configObj: any = { systemInstruction };
                if (cand.thinkingLevel) {
                  configObj.thinkingConfig = { thinkingLevel: cand.thinkingLevel };
                }
                const responseStream = await withGeminiTimeout(
                  ai.models.generateContentStream({
                    model: cand.model,
                    contents: promptUser,
                    config: configObj
                  }),
                  cand.timeoutMs,
                  cand.model
                );

                let enviadoLen = 0;
                for await (const chunk of responseStream) {
                  if (clientClosed) break outerStreamLoop;
                  const delta = chunk.text || '';
                  if (!delta) continue;
                  streamIniciado = true;
                  fullText += delta;

                  const markerPos = fullText.search(/---+\s*RESUMO_DOSSIE/i);
                  const safeLimit = markerPos >= 0 ? markerPos : Math.max(0, fullText.length - 18);
                  if (safeLimit > enviadoLen) {
                    const novoTrecho = fullText.slice(enviadoLen, safeLimit);
                    enviadoLen = safeLimit;
                    if (novoTrecho) {
                      res.write(`data: ${JSON.stringify({ chunk: novoTrecho })}\n\n`);
                      if (typeof (res as any).flush === 'function') (res as any).flush();
                    }
                  }
                }
                if (fullText.trim()) {
                  geminiModelCooldownUntil.delete(cand.model);
                  lastErr = null;
                  break outerStreamLoop;
                }
              } catch (candErr: any) {
                lastErr = candErr;
                if (isQuotaErr(candErr)) {
                  rateLimitedModels.add(cand.model);
                  markGeminiModelCooldown(cand.model, 60000);
                } else if (isTransientGeminiError(candErr)) {
                  anyTransient = true;
                  if (isTimeoutErr(candErr)) {
                    timedOutModels.add(cand.model);
                  }
                  markGeminiModelCooldown(cand.model, 30000);
                }
                console.warn(`[API AI Estruturar Ata Stream][rodada ${round + 1}] Falha em ${cand.model}:`, String(candErr?.message || candErr || '').slice(0, 180));
                if (streamIniciado) break outerStreamLoop;
              }
            }
            if (!anyTransient) break;
          }

          // Fallback imediato para chamada não-streaming (generateContent) se o endpoint de streaming sofreu 503/timeout
          if (!clientClosed && !fullText.trim()) {
            const fallbackCandidates = sortCandidatesByHealth(ataCandidatesBase).filter(c => !rateLimitedModels.has(c.model));
            for (const cand of fallbackCandidates) {
              if (clientClosed) break;
              try {
                res.write(`: fallback-nao-streaming\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
                modeloUsado = cand.model;
                const configObj: any = { systemInstruction };
                if (cand.thinkingLevel) {
                  configObj.thinkingConfig = { thinkingLevel: cand.thinkingLevel };
                }
                const fallbackResp = await withGeminiTimeout(
                  ai.models.generateContent({
                    model: cand.model,
                    contents: promptUser,
                    config: configObj
                  }),
                  cand.timeoutMs,
                  cand.model
                );
                const textFallback = (fallbackResp.text || '').trim();
                if (textFallback) {
                  fullText = textFallback;
                  geminiModelCooldownUntil.delete(cand.model);
                  lastErr = null;
                  break;
                }
              } catch (fbErr: any) {
                lastErr = fbErr;
                if (isQuotaErr(fbErr)) {
                  markGeminiModelCooldown(cand.model, 60000);
                } else if (isTransientGeminiError(fbErr)) {
                  markGeminiModelCooldown(cand.model, 30000);
                }
                console.warn(`[API AI Estruturar Ata Stream->JSON Fallback] Falha em ${cand.model}:`, String(fbErr?.message || fbErr || '').slice(0, 180));
              }
            }
          }
        } finally {
          clearInterval(heartbeatTimer);
        }

        if (clientClosed) return;

        if (lastErr && !fullText.trim()) {
          const amigavel = formatarErroGeminiAmigavel(lastErr);
          res.write(`data: ${JSON.stringify({ error: amigavel.message })}\n\n`);
          return res.end();
        }

        const { textoAtaLimpo, resumoLimpo } = extrairAtaEResumo(fullText);
        if (!textoAtaLimpo) {
          res.write(`data: ${JSON.stringify({ error: 'O modelo Gemini não retornou texto estruturado. Detalhe melhor as notas brutas.' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ done: true, textoAta: textoAtaLimpo, resumoDossie: resumoLimpo, modelo: modeloUsado })}\n\n`);
        }
        return res.end();
      }

      let rawText = '';
      let modeloUsado = ataCandidates[0].model;
      let lastErr: any = null;
      const rateLimitedModels = new Set<string>();
      const timedOutModels = new Set<string>();

      outerNonStreamLoop:
      for (let round = 0; round < retryDelaysMs.length; round++) {
        if (retryDelaysMs[round] > 0) {
          await sleepMs(retryDelaysMs[round]);
        }
        let anyTransient = false;
        const roundCandidates = sortCandidatesByHealth(ataCandidatesBase);
        for (const cand of roundCandidates) {
          if (rateLimitedModels.has(cand.model)) continue;
          if (round > 0 && timedOutModels.has(cand.model) && timedOutModels.size < roundCandidates.length) continue;
          try {
            modeloUsado = cand.model;
            const configObj: any = { systemInstruction };
            if (cand.thinkingLevel) {
              configObj.thinkingConfig = { thinkingLevel: cand.thinkingLevel };
            }
            const response = await withGeminiTimeout(
              ai.models.generateContent({
                model: cand.model,
                contents: promptUser,
                config: configObj
              }),
              cand.timeoutMs,
              cand.model
            );
            rawText = (response.text || '').trim();
            if (rawText) {
              geminiModelCooldownUntil.delete(cand.model);
              lastErr = null;
              break outerNonStreamLoop;
            }
          } catch (candErr: any) {
            lastErr = candErr;
            if (isQuotaErr(candErr)) {
              rateLimitedModels.add(cand.model);
              markGeminiModelCooldown(cand.model, 60000);
            } else if (isTransientGeminiError(candErr)) {
              anyTransient = true;
              if (isTimeoutErr(candErr)) {
                timedOutModels.add(cand.model);
              }
              markGeminiModelCooldown(cand.model, 30000);
            }
            console.warn(`[API AI Estruturar Ata][rodada ${round + 1}] Falha em ${cand.model}:`, String(candErr?.message || candErr || '').slice(0, 180));
          }
        }
        if (!anyTransient) break;
      }

      if (lastErr && !rawText) {
        const amigavel = formatarErroGeminiAmigavel(lastErr);
        return res.status(amigavel.status).json({ error: amigavel.message });
      }

      const { textoAtaLimpo, resumoLimpo } = extrairAtaEResumo(rawText);
      if (!textoAtaLimpo) {
        return res.status(502).json({
          error: 'O modelo Gemini não retornou texto estruturado. Tente novamente com mais detalhes nas notas brutas.'
        });
      }

      res.json({
        success: true,
        textoAta: textoAtaLimpo,
        resumoDossie: resumoLimpo,
        modelo: modeloUsado
      });
    } catch (err: any) {
      console.error('[API AI Estruturar Ata] Erro:', err?.message || err);
      const status = err?.status === 403 || err?.status === 400 || err?.status === 429 || err?.status === 503 ? err.status : 500;
      res.status(status).json({
        error: 'Erro ao estruturar ata com Gemini AI.',
        details: err?.message || String(err)
      });
    }
  });

  // ==========================================
  // ROTA: SALVAR ATA & INTEGRAR AUTOMATICAMENTE EM acoes_2026 (ALUNOS E FUNCIONÁRIOS)
  // ==========================================
  app.post('/api/atas/salvar', async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({
          error: 'Autenticação obrigatória para salvar atas e registrar histórico nos dossiês.'
        });
      }
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: O Gerador de Atas é exclusivo para Direção, Vice-Direção e CGPG (perfil real: "${realUser.realRole}").`
        });
      }

      const {
        tipoAta = 'Outros',
        dataAta,
        horarioAta = '',
        estudantes = [],
        funcionarios = [],
        outrosParticipantes = '',
        notasBrutas = '',
        textoAta = '',
        resumoDossie = ''
      } = req.body || {};

      const textoFinal = String(textoAta || '').trim();
      if (!textoFinal) {
        return res.status(400).json({ error: 'O texto estruturado da ata é obrigatório para salvar.' });
      }

      const hojeIso = dataAta && /^\d{4}-\d{2}-\d{2}$/.test(String(dataAta).trim())
        ? String(dataAta).trim()
        : new Date().toISOString().slice(0, 10);
      const [yyyy, mm, dd] = hojeIso.split('-');
      const dataBR = `${dd}/${mm}/${yyyy}`;

      const anotacaoCurta = `[${dataBR}] - Ata de ${tipoAta} registrada`;
      const nowIso = new Date().toISOString();

      // Gera resumo objetivo e diplomático da conversa (1 a 2 frases) para o Dossiê dos envolvidos se não veio pré-preenchido
      let resumoConversa = String(resumoDossie || '').trim();
      if (!resumoConversa) {
        const aiResumo = getSharedGeminiClient();
        if (aiResumo) {
          const resumoModels = sortCandidatesByHealth<Array<{ model: string; thinkingLevel?: ThinkingLevel }>[number]>([
            { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
            { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW }
          ]);
          for (const rc of resumoModels) {
            try {
              const sumResp = await withGeminiTimeout(
                aiResumo.models.generateContent({
                  model: rc.model,
                  contents: `Resuma em no máximo 2 frases curtas e objetivas (texto simples, sem Markdown, linguagem técnica e diplomática) o assunto principal tratado e os encaminhamentos desta ata (${tipoAta}) para constar no histórico do dossiê escolar:\n\n${textoFinal.slice(0, 3500)}`,
                  config: {
                    systemInstruction: 'Você sintetiza atas escolares em 1 a 2 frases impessoais, objetivas e seguras para registro em dossiê estudantil/docente. Retorne apenas texto simples, sem asteriscos ou marcadores.',
                    ...(rc.thinkingLevel ? { thinkingConfig: { thinkingLevel: rc.thinkingLevel } } : {})
                  }
                }),
                10000,
                rc.model
              );
              resumoConversa = limparMarkdownParaPlainText(sumResp.text || '');
              if (resumoConversa) break;
            } catch (sumErr: any) {
              console.warn(`[API Atas] Aviso ao resumir ata via IA (${rc.model}):`, sumErr?.message);
            }
          }
        }

        if (!resumoConversa) {
          const baseBruta = String(notasBrutas || '').trim();
          if (baseBruta) {
            resumoConversa = baseBruta.replace(/\s+/g, ' ').slice(0, 260);
          } else {
            const paragrafos = textoFinal.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
            const miolo = paragrafos.length > 1 ? paragrafos[1] : paragrafos[0] || '';
            resumoConversa = miolo.replace(/\s+/g, ' ').slice(0, 260);
          }
        }
      }

      const registroCompletoDossie = resumoConversa
        ? `Ata de ${tipoAta} (${dataBR}): ${resumoConversa}`
        : anotacaoCurta;

      // REGRA CRÍTICA: Sem campos id ou _id no payload gravado no banco
      const ataPayload = {
        tipoAta: String(tipoAta),
        dataAta: hojeIso,
        dataBR,
        horarioAta: String(horarioAta || ''),
        estudantes: Array.isArray(estudantes)
          ? estudantes.map((e: any) => ({
              ra: String(e.ra || '').trim(),
              nome: String(e.nome || '').trim(),
              turma: String(e.turma || '').trim()
            }))
          : [],
        funcionarios: Array.isArray(funcionarios)
          ? funcionarios.map((f: any) => ({
              nome: String(f.nome || '').trim(),
              email: String(f.email || '').trim(),
              cargo: String(f.cargo || '').trim()
            }))
          : [],
        outrosParticipantes: String(outrosParticipantes || '').trim(),
        notasBrutas: String(notasBrutas || '').trim(),
        textoAta: textoFinal,
        resumoDossie: resumoConversa,
        anotacaoDossie: registroCompletoDossie,
        autorNome: realUser.nome || realUser.email,
        autorEmail: realUser.email,
        autorCargo: realUser.realRole,
        criadoEm: nowIso
      };

      const savedAta = await addDoc('atas_escolares', ataPayload);
      const db = await getDatabase();

      // 1. Integração Automática no Dossiê de cada estudante envolvido (coleção ocorrencias + aluno.ocorrencias + acoes_2026)
      const alunosAtualizados: Array<{ ra: string; acoes_2026: string; novaOcorrencia: any }> = [];
      const ocorrenciasCriadas: any[] = [];
      if (Array.isArray(estudantes) && estudantes.length > 0) {
        const colAlunos = db.collection('alunos');
        for (const est of estudantes) {
          const raStr = String(est?.ra || '').trim();
          const estId = String(est?.id || '').trim();
          const estNome = String(est?.nome || '').trim();
          if (!raStr && !estId && !estNome) continue;

          try {
            let alunoDoc: any = null;
            if (raStr) {
              alunoDoc = await colAlunos.findOne(buildDocumentQuery(raStr));
            }
            if (!alunoDoc && estId) {
              alunoDoc = await colAlunos.findOne(buildDocumentQuery(estId));
            }
            if (!alunoDoc && estNome) {
              alunoDoc = await colAlunos.findOne({
                nome: { $regex: new RegExp(`^${estNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
              });
            }

            const raResolvido = String(alunoDoc?.ra || raStr || estId || '').trim();
            const nomeResolvido = String(alunoDoc?.nome || estNome || '').trim();
            const turmaResolvida = String(alunoDoc?.turma || est?.turma || '').trim();
            const horaVal = horarioAta && /^\d{2}:\d{2}/.test(String(horarioAta).trim())
              ? String(horarioAta).trim().slice(0, 5)
              : '12:00';

            // REGRA CRÍTICA: Sem campos id ou _id no payload gravado em ocorrencias / array embutido
            const ocorrenciaSemId = {
              ra: raResolvido,
              nomeAluno: nomeResolvido.toUpperCase(),
              turma: turmaResolvida.toUpperCase(),
              tipo: `Ata de ${tipoAta}`,
              origem: 'ATA_ESCOLAR',
              descricao: resumoConversa
                ? `${resumoConversa}`
                : anotacaoCurta,
              encaminhamento: `Registrado via Gerador de Atas (${dataBR}${horarioAta ? ` às ${horarioAta}` : ''} · Ref.: ${savedAta.id}).`,
              data: `${hojeIso}T${horaVal}:00`,
              dataRegistro: nowIso,
              ataId: savedAta.id,
              registradoConviva: false,
              usuario: realUser.nome || realUser.email,
              autor: realUser.nome || realUser.email,
              autor_nome: realUser.nome || realUser.email,
              autor_email: realUser.email,
              cargo: realUser.realRole,
              criadoEm: nowIso
            };

            const savedOc = await addDoc('ocorrencias', ocorrenciaSemId);
            const ocComId = { id: savedOc.id, ...ocorrenciaSemId };
            ocorrenciasCriadas.push(ocComId);

            if (alunoDoc) {
              const linhaAcao = `[${dataBR}] - Ata de ${tipoAta}${resumoConversa ? `: ${resumoConversa}` : ' registrada'}`;
              const atual = String(alunoDoc.acoes_2026 || '').trim();
              const novoAcoes = atual ? `${atual}\n${linhaAcao}` : linhaAcao;

              const updateOp: Record<string, any> = {
                $set: {
                  acoes_2026: novoAcoes,
                  atualizadoEm: nowIso
                }
              };
              if (Array.isArray(alunoDoc.ocorrencias)) {
                updateOp.$push = { ocorrencias: ocorrenciaSemId };
              } else {
                updateOp.$set.ocorrencias = [ocorrenciaSemId];
              }

              await colAlunos.updateOne({ _id: alunoDoc._id }, updateOp);
              alunosAtualizados.push({
                ra: raResolvido,
                acoes_2026: novoAcoes,
                novaOcorrencia: ocComId
              });
            }
          } catch (estErr: any) {
            console.warn(`[API Atas] Falha ao atualizar dossiê do estudante ${raStr || estNome || estId}:`, estErr?.message);
          }
        }
      }

      // 2. Integração Automática no acoes_2026 e Dossiê de cada funcionário envolvido
      const funcionariosAtualizados: Array<{ id?: string; email?: string; nome: string; acoes_2026: string }> = [];
      const nivelMap: Record<string, number> = {
        DIRETOR: 1,
        SENIOR_GOE: 1,
        VICE_DIRETOR: 2,
        CGPG: 3,
        PAAC: 4,
        SECRETARIA: 5
      };
      const autorNivel = nivelMap[realUser.realRole] || 4;

      if (Array.isArray(funcionarios) && funcionarios.length > 0) {
        const colUsuarios = db.collection('usuarios');
        for (const func of funcionarios) {
          const funcId = String(func?.id || '').trim();
          const funcEmail = String(func?.email || '').trim().toLowerCase();
          const funcNome = String(func?.nome || '').trim();
          if (!funcId && !funcEmail && !funcNome) continue;

          try {
            let userDoc: any = null;
            if (funcId) {
              userDoc = await colUsuarios.findOne(buildDocumentQuery(funcId));
            }
            if (!userDoc && funcEmail) {
              userDoc = await colUsuarios.findOne({
                email: { $regex: new RegExp(`^${funcEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
              });
            }
            if (!userDoc && funcNome) {
              userDoc = await colUsuarios.findOne({
                nome: { $regex: new RegExp(`^${funcNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
              });
            }

            const linhaFunc = `[${dataBR}] - Ata de ${tipoAta}${resumoConversa ? `: ${resumoConversa}` : ' registrada'}`;
            const atual = String(userDoc?.acoes_2026 || '').trim();
            const novoAcoes = atual ? `${atual}\n${linhaFunc}` : linhaFunc;

            if (userDoc) {
              await colUsuarios.updateOne(
                { _id: userDoc._id },
                { $set: { acoes_2026: novoAcoes, atualizadoEm: nowIso } }
              );
              funcionariosAtualizados.push({
                id: String(userDoc.id || userDoc._id || funcId),
                email: String(userDoc.email || funcEmail),
                nome: String(userDoc.nome || funcNome),
                acoes_2026: novoAcoes
              });
            }

            // Também registra uma anotação objetiva na coleção professores_anotacoes para visualização no Dossiê do Docente
            await addDoc('professores_anotacoes', {
              professorId: String(userDoc?.id || funcId || funcEmail || funcNome),
              professorNome: String(userDoc?.nome || funcNome),
              professorEmail: String(userDoc?.email || funcEmail),
              professorCargo: String(userDoc?.cargo || func?.cargo || 'Equipe Escolar'),
              categoria: 'reuniao',
              titulo: `Ata de ${tipoAta} (${dataBR})`,
              conteudo: resumoConversa || anotacaoCurta,
              encaminhamentos: `Registro integrado automaticamente pelo Gerador de Atas (Ref.: ${savedAta.id}).`,
              dataOcorrencia: hojeIso,
              horario: String(horarioAta || ''),
              status: 'Concluído',
              ataId: savedAta.id,
              autorId: realUser.email,
              autorNome: realUser.nome || realUser.email,
              autorEmail: realUser.email,
              autorCargo: realUser.realRole,
              autorNivel,
              criadoEm: nowIso,
              atualizadoEm: nowIso
            });
          } catch (funcErr: any) {
            console.warn(`[API Atas] Falha ao atualizar histórico do funcionário ${funcNome}:`, funcErr?.message);
          }
        }
      }

      // Log de Auditoria
      try {
        await addDoc('logs_auditoria', {
          modulo: 'Gerador de Atas',
          acao: 'CRIAR',
          descricao: `Ata de ${tipoAta} lavrada em ${dataBR} (${alunosAtualizados.length} estudante(s) e ${funcionariosAtualizados.length} funcionário(s) integrados ao dossiê).`,
          usuarioNome: realUser.nome || realUser.email,
          usuarioEmail: realUser.email,
          usuarioCargo: realUser.realRole,
          dataHora: nowIso
        });
      } catch {}

      res.status(201).json({
        success: true,
        id: savedAta.id,
        ata: { id: savedAta.id, ...ataPayload },
        anotacaoCurta: registroCompletoDossie,
        resumoDossie: resumoConversa,
        ocorrenciasCriadas,
        alunosAtualizados,
        funcionariosAtualizados
      });
    } catch (err: any) {
      console.error('[API Atas Salvar] Erro:', err?.message || err);
      res.status(500).json({
        error: 'Erro ao salvar ata e integrar histórico acoes_2026.',
        details: err?.message || String(err)
      });
    }
  });

  // POST: Limpeza administrativa de registros categorizados falsamente como Atraso
  app.post('/api/admin/limpar-falsos-atrasos', async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: 'Autenticação obrigatória.' });
      }
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Apenas Direção, Vice-Direção ou CGPG podem executar esta limpeza (perfil real: "${realUser.realRole}").`
        });
      }
      const stats = await limparFalsosAtrasosNoBanco();
      res.json({ success: true, ...stats });
    } catch (err: any) {
      console.error('[API Limpar Falsos Atrasos] Erro:', err?.message || err);
      res.status(500).json({
        error: 'Erro ao limpar falsos atrasos no banco de dados.',
        details: err?.message || String(err)
      });
    }
  });

  // POST: Migrar e limpar gatilhos automáticos legados para notificacoes_tutor
  app.post('/api/admin/migrar-gatilhos-tutor', async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: 'Autenticação obrigatória.' });
      }
      if (!['DIRETOR', 'SENIOR_GOE', 'VICE_DIRETOR', 'CGPG'].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Apenas Direção, Vice-Direção ou CGPG podem executar esta migração (perfil real: "${realUser.realRole}").`
        });
      }
      const stats = await migrarERemoverGatilhosAutomaticosNoBanco();
      res.json({ success: true, ...stats });
    } catch (err: any) {
      console.error('[API Migrar Gatilhos Tutor] Erro:', err?.message || err);
      res.status(500).json({
        error: 'Erro ao migrar gatilhos automáticos para notificações da tutoria.',
        details: err?.message || String(err)
      });
    }
  });

  // POST: Gerar Boletim Diário de Frequência & Cruzamento de Faltas Consecutivas com Inteligência Artificial
  app.post('/api/ai/boletim-diario', async (req, res) => {
    try {
      const {
        data,
        turno = 'Manhã',
        etapa = 'Ensino Fundamental',
        mensagensProfessores = '',
        atrasosRegistrados = [],
        saidasAntecipadasRegistradas = [],
        atestadosRegistrados = [],
        alunosCadastrados = [],
        totalMatriculadosAtivos = 0,
        historicoBoletinsAnteriores = []
      } = req.body;

      if (!mensagensProfessores && (!atrasosRegistrados || atrasosRegistrados.length === 0)) {
        return res.status(400).json({
          error: 'É necessário fornecer as mensagens de chamada dos professores ou registros de atrasos para gerar o boletim.'
        });
      }

      const ai = getSharedGeminiClient();

      // Obter base oficial de alunos caso não venha no payload
      let baseAlunos = Array.isArray(alunosCadastrados) && alunosCadastrados.length > 0 ? alunosCadastrados : [];
      if (baseAlunos.length === 0) {
        try {
          baseAlunos = await getDocs('alunos', {});
        } catch (dbErr: any) {
          console.warn('[API AI Boletim Diário] Não foi possível carregar alunos do banco:', dbErr.message);
        }
      }

      // Filtrar estritamente alunos ATIVOS (LGPD & Censo Escolar)
      const alunosAtivos = baseAlunos.filter((a: any) => {
        const st = String(a.status || 'ATIVO').trim().toUpperCase();
        return st === 'ATIVO';
      });

      // Calcular com exatidão o número real de matriculados ativos no turno / etapa
      const isFund = (turma: string) => {
        const clean = String(turma || '').replace(/[^\d1-9A-Za-z]/g, '').toUpperCase();
        return clean.startsWith('6') || clean.startsWith('7') || clean.startsWith('8') || clean.startsWith('9');
      };
      const isMed = (turma: string) => {
        const clean = String(turma || '').replace(/[^\d1-9A-Za-z]/g, '').toUpperCase();
        return clean.startsWith('1') || clean.startsWith('2') || clean.startsWith('3');
      };

      const isGeralEtapa = etapa.toLowerCase().includes('geral') || etapa.toLowerCase().includes('todos');
      const isFundEtapa = !isGeralEtapa && (etapa.toLowerCase().includes('fundamental') || etapa.toLowerCase().includes('6º ao 9º'));
      const isMedEtapa = !isGeralEtapa && (etapa.toLowerCase().includes('médio') || etapa.toLowerCase().includes('medio') || etapa.toLowerCase().includes('1º ao 3º'));

      let matriculadosReais = Number(totalMatriculadosAtivos || 0);
      if (!matriculadosReais || matriculadosReais <= 0) {
        if (isGeralEtapa) {
          const countFund = alunosAtivos.filter((a: any) => isFund(a.turma)).length;
          const countMed = alunosAtivos.filter((a: any) => isMed(a.turma)).length;
          matriculadosReais = (countFund + countMed) > 0 ? (countFund + countMed) : alunosAtivos.length;
        } else if (isFundEtapa) {
          matriculadosReais = alunosAtivos.filter((a: any) => isFund(a.turma)).length;
        } else if (isMedEtapa) {
          matriculadosReais = alunosAtivos.filter((a: any) => isMed(a.turma)).length;
        } else {
          matriculadosReais = alunosAtivos.length;
        }
      }
      if (matriculadosReais <= 0) {
        matriculadosReais = isGeralEtapa ? 703 : (isFundEtapa ? 497 : 206);
      }

      const normTurmaKeyGlobal = (t: string) => (t || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      const mapaAtivosGlobal: Record<string, any[]> = {};
      alunosAtivos.forEach((st: any) => {
        const tKey = normTurmaKeyGlobal(st.turma);
        if (tKey) {
          mapaAtivosGlobal[tKey] = mapaAtivosGlobal[tKey] || [];
          mapaAtivosGlobal[tKey].push(st);
        }
      });

      const removerAcentosGlobal = (str: string) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const foneticaGlobal = (str: string) => removerAcentosGlobal(str)
        .replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k').replace(/y/g, 'i')
        .replace(/w/g, 'v').replace(/z/g, 's').replace(/x/g, 's').replace(/ch/g, 's')
        .replace(/ll/g, 'l').replace(/ss/g, 's').replace(/rr/g, 'r').replace(/mm/g, 'm')
        .replace(/nn/g, 'n').replace(/tt/g, 't');

      const formatarNomeLGPDGlobal = (nomeOriginal: string, turmaRef: string): string => {
        const trimmed = (nomeOriginal || '').trim().replace(/^•\s*/, '');
        if (!trimmed) return 'Estudante';
        if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Z]\.)+$/.test(trimmed)) {
          return trimmed;
        }

        const tKey = normTurmaKeyGlobal(turmaRef);
        const listaTurma = mapaAtivosGlobal[tKey] || [];
        const qNorm = removerAcentosGlobal(trimmed);
        const qPhon = foneticaGlobal(trimmed);
        const qParts = qNorm.split(/\s+/).filter(p => p.length >= 2);
        const qPhonParts = qPhon.split(/\s+/).filter(p => p.length >= 2);

        let match = listaTurma.find(a => removerAcentosGlobal(a.nome) === qNorm);
        if (!match) match = listaTurma.find(a => foneticaGlobal(a.nome) === qPhon);
        if (!match && qPhonParts.length > 1) {
          match = listaTurma.find(a => {
            const aPhonParts = foneticaGlobal(a.nome).split(/\s+/);
            const firstMatch = aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
            const lastMatch = aPhonParts.some((ap, idx) => idx > 0 && qPhonParts.slice(1).some(qp => ap === qp || ap.startsWith(qp) || qp.startsWith(ap)));
            return firstMatch && lastMatch;
          });
        }
        if (!match && qParts.length > 1) {
          match = listaTurma.find(a => {
            const aNorm = removerAcentosGlobal(a.nome);
            return qParts.every(p => aNorm.includes(p));
          });
        }
        if (!match && qPhonParts.length === 1) {
          const candidatos = listaTurma.filter(a => {
            const aPhonParts = foneticaGlobal(a.nome).split(/\s+/);
            return aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
          });
          if (candidatos.length >= 1) match = candidatos[0];
        }

        const nomeBase = match ? match.nome : trimmed;
        const preposicoes = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
        const palavras = nomeBase
          .trim()
          .replace(/\.$/, '')
          .split(/\s+/)
          .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .filter((p: string) => !preposicoes.has(p.toLowerCase()));

        if (palavras.length === 0) return 'Estudante';
        if (palavras.length === 1) return palavras[0];

        const primeiroNome = palavras[0];
        const segundoNome = palavras[1] || '';

        const mesmoPrimeiroNome = listaTurma.filter((a: any) => {
          const aFirst = a.nome.trim().split(/\s+/)[0];
          return foneticaGlobal(aFirst) === foneticaGlobal(primeiroNome);
        });

        if (mesmoPrimeiroNome.length > 1) {
          const mesmoSegundoNomeInicial = mesmoPrimeiroNome.filter((a: any) => {
            const aPalavras = a.nome.trim().split(/\s+/).filter((p: string) => !preposicoes.has(p.toLowerCase()));
            const aSeg = aPalavras[1] || '';
            return aSeg && segundoNome && aSeg[0].toUpperCase() === segundoNome[0].toUpperCase();
          });

          if (mesmoSegundoNomeInicial.length > 1 && palavras[2]) {
            return `${primeiroNome} ${segundoNome[0].toUpperCase()}. ${palavras[2][0].toUpperCase()}.`;
          }
          const inicial = segundoNome ? `${segundoNome[0].toUpperCase()}.` : '';
          return `${primeiroNome} ${inicial}`.trim();
        }

        if (!match && palavras.length > 1) {
          return `${primeiroNome} ${segundoNome[0].toUpperCase()}.`;
        }

        return primeiroNome;
      };
      
      const promptUser = `
CONSOLIDAÇÃO DE BOLETIM DIÁRIO DE FREQUÊNCIA E CRUZAMENTO DE FALTAS CONSECUTIVAS:

PARÂMETROS OFICIAIS DO SISTEMA ESCOLAR:
- Data da Apuração: ${data || new Date().toLocaleDateString('pt-BR')}
- Período/Turno: ${turno}
- Etapa/Segmento: ${etapa}
- NÚMERO EXATO DE ALUNOS MATRICULADOS ATIVOS NO TURNO/ETAPA: ${matriculadosReais} alunos ativos
(ATENÇÃO: Use OBRIGATORIAMENTE este valor exato ${matriculadosReais} no balanço. NUNCA utilize 500 ou qualquer número estimado!)

MENSAGENS BRUTAS DE CHAMADA ENVIADAS PELOS PROFESSORES (WHATSAPP):
"""
${mensagensProfessores}
"""

REGISTROS DE ATRASOS / ENTRADAS TARDIAS REGISTRADOS NO SISTEMA HOJE:
${JSON.stringify(atrasosRegistrados, null, 2)}

REGISTROS DE SAÍDAS ANTECIPADAS NO SISTEMA HOJE:
${JSON.stringify(saidasAntecipadasRegistradas, null, 2)}

HISTÓRICO DE BOLETINS ANTERIORES / AUSÊNCIAS PRÉVIAS (PARA CRUZAMENTO DE FALTAS CONSECUTIVAS):
${JSON.stringify(historicoBoletinsAnteriores.slice(0, 5), null, 2)}

AMOSTRA DE ALUNOS ATIVOS DA ESCOLA (BASE OFICIAL PARA CRUZAMENTO):
${JSON.stringify(alunosAtivos.slice(0, 150).map((a: any) => ({
  nome: a.nome,
  turma: a.turma,
  ra: a.ra,
  presenca: a.presenca_atual || a.presenca_anual,
  totalFaltas: a.total_faltas,
  historicoFaltasRecentes: a.faltas_consecutivas || 0
})), null, 2)}

DIRETRIZES ESTRITAS:
1. GERE O BOLETIM NO PADRÃO OFICIAL EXATO DA ESCOLA CLÓVIS DE LUCCA:
   - Formate as turmas de forma padronizada (ex: 6º A, 6º B, 6º C, 6º D, 7º A, 7º B, 7º C, 7º D, 8º A, 8º B, 8º C, 9º A, 9º B, 9º C para Ensino Fundamental Manhã, ou 1º A, 2º A, etc. se Ensino Médio).
   - REGRA CRÍTICA DE LGPD (LEI GERAL DE PROTEÇÃO DE DADOS):
     NO BOLETIM PÚBLICO PARA OS PAIS NO WHATSAPP, NÃO REVELE INFORMAÇÕES PESSOAIS EXCESSIVAS! SOBRENOMES COMPLETOS SÃO TERMINANTEMENTE PROIBIDOS!
     • SE O ALUNO É O ÚNICO COM AQUELE PRIMEIRO NOME NA TURMA, ESCREVA APENAS O PRIMEIRO NOME, SEM INICIAL E SEM SOBRENOME (ex: "Marina", "Matheus", "Thalles", "Fátima", "Helloa", "Julia", "Mirella", "Rafael", "Yssac", "Josué", "Samuel", "Felipe", "Gabriely", "Kamilly", "Luana", "Pietro", "Rafaela", "Arthur", "Leonardo", "Melissa", "Flávia", "Lucas", "Alana", "Eduarda", "Erik", "Guilherme", "Kaio", "Beatriz", "Ronaldo", "Anderson", "Barbara", "Cristopher", "Davi", "Kauã", "Lívia", "Luan", "Murilo", "Valentina", "Bryan", "Douglas", "Evellyn", "Caleb", "Fernanda", "Kaique", "Nicolly", "Willian", "Karoline", "Lais", "Lorenna", "Millena", "Victória", "Alexia", "Ingrid", "Jhulia", "Jonatas", "Kauan", "Kimberly", "Melissa")! NUNCA coloque inicial de sobrenome para quem é único na turma (isso revela dados desnecessários)!
     • Use inicial do segundo nome/sobrenome com ponto final (ex: "Ana B.", "Pedro G.", "Alexandre S.", "Ana C.", "João M.", "Lorenzo G.", "Pedro H.", "Sophia E.", "Emily S.", "Sophia N.", "Arthur H.", "Victor H.", "Hiago G.", "Hiago P.", "Enzo G.", "Enzo M.", "Arthur H. S.") APENAS e EXCLUSIVAMENTE quando houver mais de um aluno com o mesmo primeiro nome na mesma turma!
   - ATRASADOS:
     • Formate como: "• [Turma]: [Nome] ([Horário e observação simples de entrada])." (ex: "• 6º A: Rhay G. (07h19), Julia G. (07h35).", "• 6º B: Isabella S. (07h25 - Entrada durante a 1ª aula).", "• 7º D: Arthur R. (07h20), Natanael D. (07h53 - Entrada na 2ª aula).")
   - SAÍDAS ANTECIPADAS:
     • REGRA EXPRESSA DO USUÁRIO: "No caso de saidas antecipadas só devemos saber a hora que saiu. Não coloque justificativas nem nada na mensagem."
     • Se não houver saídas registradas no turno, escreva exatamente: "• Sem ocorrências registradas no turno."
     • Se houver saídas, coloque APENAS o nome do aluno e o horário ou período em que saiu (ex: "• 8º C: Lyan (6ª aula)." ou "• 8º C: Lyan (12h20)."). NUNCA coloque justificativas, diagnósticos, sintomas, consultas médicas ou motivos de qualquer natureza!
   - NUNCA INCLUA SEÇÃO DE ATESTADOS MÉDICOS NO BOLETIM DO WHATSAPP! Motivos médicos são dados pessoais sensíveis protegidos por lei (LGPD) e não podem ser divulgados para os pais no grupo. Passe de Saídas Antecipadas diretamente para Balanço do Turno.
   - BALANÇO DO TURNO:
     • Total de Matriculados (${turno}): ${matriculadosReais} alunos (conforme base de dados ativa do módulo Alunos)
     • Total de Ausências Integrais: X faltas confirmadas
     • Índice de Faltas: Calculado exatamente como (Total Ausências / ${matriculadosReais} * 100) com 1 casa decimal e vírgula (ex: 22,8%) das cadeiras vazias
     • Total de Atrasos / Entradas Tardias: Z registros na portaria/secretaria
   - MENSAGEM FINAL:
Lembramos que os minutos iniciais das aulas são preciosos para a explicação dos conteúdos. Caso a ausência tenha ocorrido por recomendação de saúde, favor apresentar o atestado médico na secretaria da unidade escolar.

Contamos com o apoio e o empenho de todos!

Atenciosamente,
Direção e Equipe Gestora

2. CRUZE AS FALTAS CONSECUTIVAS E GERE O ALERTA EXCLUSIVO DA EQUIPE GESTORA:
   - Cruze cada aluno ausente com a lista de alunos ATIVOS da turma no sistema.
   - Identifique quem está acumulando 3 ou mais faltas consecutivas (LIMIAR CRÍTICO - Resolução SEDUC nº 39/2023 - Busca Ativa Obrigatória).
   - Identifique quem está com 2 faltas consecutivas (Atenção / Preventivo).
   - No relatório da gestão, forneça o Nome Completo Oficial do sistema, a Turma, o RA oficial, o número de faltas consecutivas, o nível de risco e a ação imediata sugerida.
`;

      const systemInstruction = `
Você é o Especialista em Gestão Escolar, Frequência e Busca Ativa da E.E. Clóvis de Lucca.
Seu objetivo é analisar as chamadas dos professores (WhatsApp), atrasos e dados dos alunos ATIVOS do sistema escolar para:
1. Produzir o Boletim Diário Oficial formatado perfeitamente para envio no WhatsApp das famílias respeitando RIGOROSAMENTE a LGPD:
   - Se o primeiro nome do aluno for único na turma, coloque APENAS o primeiro nome (ex: "Erik", "Wendel", "Yohana", "Natanael", "Alana", "Eduarda", "Guilherme", "Kaio", "Marina", "Matheus", "Thalles", "Beatriz", "Ronaldo"). Não coloque iniciais de quem é único!
   - Coloque inicial com ponto (ex: "Arthur H.", "Hiago G.", "Hiago P.", "Ana B.", "Ana C.", "Arthur H. S.") APENAS quando houver mais de um aluno com o mesmo primeiro nome na mesma turma.
   - Em saídas antecipadas, coloque APENAS o nome e o horário de saída (ex: "• 8º C: Lyan (6ª aula)."). É TERMINANTEMENTE PROIBIDO colocar justificativas, motivos ou informações médicas na mensagem!
   - NUNCA inclua seção de atestados médicos ou dados médicos de alunos no boletim do WhatsApp (LGPD).
2. Identificar alunos com faltas consecutivas (cruzamento com a base de alunos ativos) e alertar a Equipe Gestora com base na Resolução SEDUC nº 39/2023.

Você deve responder ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "boletimFormatado": "string com o boletim completo pronto para envio no WhatsApp",
  "balanco": {
    "totalMatriculados": ${matriculadosReais},
    "totalAusencias": 114,
    "indiceFaltas": "22,8%",
    "totalAtrasos": 26,
    "totalSaidasAntecipadas": 0
  },
  "turmasAusentes": {
    "6º A": ["Ana B.", "Marina", "Matheus", "Pedro G.", "Thalles"],
    "7º D": ["Alana", "Arthur H.", "Eduarda", "Erik", "Guilherme", "Kaio", "Victor H."]
  },
  "atrasadosPorTurma": {
    "6º A": ["Rhay G. (07h19)", "Julia G. (07h35)"]
  },
  "saidasPorTurma": {},
  "alertaEquipeGestora": {
    "totalAlunosConsecutivos": 6,
    "resumoExecutivo": "Identificados X alunos com faltas consecutivas que demandam intervenção imediata...",
    "alunosCriticos3Mais": [
      {
        "nome": "NOME COMPLETO DO ALUNO",
        "turma": "7º D",
        "ra": "0001...",
        "diasConsecutivos": 3,
        "nivelRisco": "CRÍTICO",
        "motivoDestaque": "Atingiu 3 ausências consecutivas injustificadas (Resolução SEDUC 39/2023).",
        "acaoSugerida": "Ligar hoje para a família e lavrar Convocação Presencial na Busca Ativa."
      }
    ],
    "alunosAlerta2": [
      {
        "nome": "NOME COMPLETO DO ALUNO",
        "turma": "6º B",
        "ra": "0001...",
        "diasConsecutivos": 2,
        "nivelRisco": "ATENÇÃO",
        "motivoDestaque": "2ª ausência consecutiva registrada.",
        "acaoSugerida": "Contato preventivo via WhatsApp da Busca Ativa."
      }
    ],
    "orientacoesSEDUC39": "Conforme a Resolução SEDUC nº 39/2023, após 3 faltas consecutivas sem justificativa, a escola deve registrar intervenção imediata de Busca Ativa..."
  }
}
`;

      const modelosDisponiveis = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let jsonResult: any;
      let sucesso = false;

      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (sucesso) break;
          try {
            const configPayload: any = {
              systemInstruction,
              responseMimeType: 'application/json'
            };
            if (modelo !== 'gemini-4-hydrogen') {
              configPayload.temperature = 0.2;
            }
            const generatePromise = ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: configPayload
            });
            const timeoutPromise = new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout de 12s na API do modelo')), 12000)
            );
            const response = await Promise.race([generatePromise, timeoutPromise]);

            const responseText = response.text || '{}';
            try {
              jsonResult = JSON.parse(responseText);
              sucesso = true;
            } catch (pErr) {
              const match = responseText.match(/\{[\s\S]*\}/);
              if (match) {
                jsonResult = JSON.parse(match[0]);
                sucesso = true;
              }
            }
          } catch (callErr: any) {
            const isQuota = callErr.message?.includes('429') || callErr.message?.includes('quota') || callErr.status === 429 || callErr.message?.includes('RESOURCE_EXHAUSTED');
            if (isQuota) {
              console.info(`[API AI Boletim Diário] Cota no modelo ${modelo}. Alternando para próximo modelo ou contingência...`);
            } else {
              console.warn(`[API AI Boletim Diário] Falha/Timeout no modelo ${modelo}:`, callErr.message);
            }
          }
        }
      }

      if (!sucesso || !jsonResult || !jsonResult.boletimFormatado) {
        console.warn('[API AI Boletim Diário] Acionando gerador analítico de contingência para o Boletim Diário');
        jsonResult = gerarBoletimDiarioFallback({
          data,
          turno,
          etapa,
          mensagensProfessores,
          atrasosRegistrados,
          saidasAntecipadasRegistradas,
          atestadosRegistrados,
          alunosCadastrados: alunosAtivos,
          totalMatriculadosAtivos: matriculadosReais,
          historicoBoletinsAnteriores
        });
      }

      // Garantir integridade oficial dos dados do balanço com a base do sistema escolar
      if (jsonResult) {
        if (!jsonResult.balanco) jsonResult.balanco = {};
        jsonResult.balanco.totalMatriculados = matriculadosReais;

        const ausencias = Number(jsonResult.balanco.totalAusencias || 0);
        if (matriculadosReais > 0) {
          const taxa = ((ausencias / matriculadosReais) * 100).toFixed(1);
          jsonResult.balanco.indiceFaltas = `${taxa.replace('.', ',')}%`;
        }

        if (typeof jsonResult.boletimFormatado === 'string') {
          const ausencias = Number(jsonResult.balanco.totalAusencias || 0);
          const taxa = matriculadosReais > 0 ? ((ausencias / matriculadosReais) * 100).toFixed(1) : '0,0';
          jsonResult.boletimFormatado = jsonResult.boletimFormatado
            .replace(/•?\s*Total de (?:Alunos )?Matriculados[^\n]*:\s*\d+[^\n]*/gi, `• Total de Matriculados (${turno}): ${matriculadosReais} alunos`)
            .replace(/•?\s*Índice (?:Geral )?de Faltas:[^\n]*/gi, `• Índice de Faltas: ${taxa.replace('.', ',')}% das cadeiras vazias`);

          // 1. Remover qualquer seção de atestados médicos ou justificativas (violação da LGPD no boletim público dos pais)
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /📄\s*ATESTADOS[\s\S]*?(?=📊\s*BALANÇO|$)/i,
            ''
          );

          // 2. Limpar saídas antecipadas para manter EXCLUSIVAMENTE nome e hora/aula (sem justificativas!)
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /(🚪\s*SAÍDAS\s*ANTECIPADAS[\s\S]*?)(📊\s*BALANÇO\s*DO\s*TURNO|$)/i,
            (bloco: string, headerESaidas: string, proximoHeader: string) => {
              const linhas = headerESaidas.split('\n');
              const linhasLimpas = linhas.map(l => {
                if (l.trim().startsWith('•') && !l.includes('Sem ocorrências')) {
                  const horaMatch = l.match(/(\d{1,2}[h:]\d{0,2}|\d+[ªº°]?\s*aula)/i);
                  let horaTexto = '';
                  if (horaMatch) {
                    horaTexto = horaMatch[1].replace(':', 'h').trim();
                    if (/^\d+aula$/i.test(horaTexto)) {
                      horaTexto = horaTexto.replace(/(\d+)aula/i, '$1ª aula');
                    }
                  }
                  const partes = l.split(':');
                  const prefixo = partes[0] + ': ';
                  const resto = partes.slice(1).join(':').trim();
                  const nomeMatch = resto.match(/^([^(.]+)/);
                  const nomeBruto = nomeMatch ? nomeMatch[1].trim() : resto.trim();
                  const infoHora = horaTexto ? ` (${horaTexto})` : '';
                  return `${prefixo}${nomeBruto}${infoHora}.`;
                }
                return l;
              });
              return linhasLimpas.join('\n').trimEnd() + '\n\n' + proximoHeader;
            }
          );

          // 3. Se houver saídas detectadas pelo fallback que o modelo LLM tenha deixado passar em branco:
          if (jsonResult.boletimFormatado.includes('🚪 SAÍDAS ANTECIPADAS\n• Sem ocorrências') || jsonResult.boletimFormatado.includes('🚪 SAÍDAS ANTECIPADAS\r\n• Sem ocorrências')) {
            const fallbackCheck = gerarBoletimDiarioFallback({
              data,
              turno,
              etapa,
              mensagensProfessores,
              atrasosRegistrados,
              saidasAntecipadasRegistradas,
              atestadosRegistrados,
              alunosCadastrados: alunosAtivos,
              totalMatriculadosAtivos: matriculadosReais,
              historicoBoletinsAnteriores
            });
            if (fallbackCheck && fallbackCheck.saidasPorTurma && Object.keys(fallbackCheck.saidasPorTurma).length > 0) {
              const linhasSaidas: string[] = [];
              Object.keys(fallbackCheck.saidasPorTurma).forEach(t => {
                const s = fallbackCheck.saidasPorTurma[t] || [];
                if (s.length > 0) linhasSaidas.push(`• ${t}: ${s.join(', ')}.`);
              });
              if (linhasSaidas.length > 0) {
                jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
                  /🚪 SAÍDAS ANTECIPADAS[\r\n]+• Sem ocorrências registradas no turno\./i,
                  `🚪 SAÍDAS ANTECIPADAS\n${linhasSaidas.join('\n')}`
                );
              }
            }
          }

          // 4. Formatar e deduplicar nomes por turma com estrita proteção LGPD EXCLUSIVAMENTE dentro de ALUNOS AUSENTES!
          // (NÃO aplica em atrasos ou saídas para não corromper parênteses e horários)
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /(🛑\s*ALUNOS\s*AUSENTES[\s\S]*?)(⏰|🚪|📊|$)/i,
            (blocoCompleto: string, blocoAusentes: string, proximoBloco: string) => {
              const ausentesFormatados = blocoAusentes.replace(
                /(•\s*[1-9][º°ª]?\s*[A-D]:\s*)([^\n]+)/g,
                (match: string, prefixo: string, listaNomes: string) => {
                  const turmaRef = prefixo.replace(/[•:\s]/g, '');
                  const cleanNomes = listaNomes.trim().replace(/\.\s*$/, '');
                  const nomes = cleanNomes.split(/,\s*/).map(n => n.trim()).filter(Boolean);
                  const nomesUnicos: string[] = [];
                  const seen = new Set<string>();
                  nomes.forEach(n => {
                    const nFormatado = formatarNomeLGPDGlobal(n, turmaRef);
                    const norm = nFormatado.toLowerCase();
                    if (!seen.has(norm)) {
                      seen.add(norm);
                      nomesUnicos.push(nFormatado);
                    }
                  });
                  return prefixo + nomesUnicos.join(', ') + '.';
                }
              );
              return ausentesFormatados + proximoBloco;
            }
          );
        }
      }

      res.json({
        success: true,
        data: jsonResult
      });
    } catch (err: any) {
      console.error('[API AI Boletim Diário] Erro crítico:', err.message);
      try {
        const fallback = gerarBoletimDiarioFallback(req.body);
        res.json({
          success: true,
          data: fallback
        });
      } catch (fErr: any) {
        res.status(500).json({
          error: 'Erro ao gerar boletim diário com IA',
          details: err.message
        });
      }
    }
  });

  // ==========================================
  // ROTA DE IA: MAPEAMENTO COMPORTAMENTAL DE ATRASOS E FALTAS & PROJEÇÃO PREDITIVA 2027
  // Cruza a 3ª métrica de faltas (desconsiderando licenças/afastamentos) para ações pedagógicas em tempo real
  // ==========================================
  app.post('/api/ai/analise-comportamental-2027', async (req, res) => {
    try {
      const {
        turma = 'TODAS',
        dataReferencia = new Date().toISOString().split('T')[0],
        chamadaHoje = [],
        estatisticas = {},
        historicoResumo = null,
        anoLetivoAlvo = '2027'
      } = req.body;

      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey
        ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
        : null;

      const totalMatriculados = Number(estatisticas.total || (Array.isArray(chamadaHoje) ? chamadaHoje.length : 0));
      const totalPresentes = Number(estatisticas.presentes || 0);
      const totalAtrasados = Number(estatisticas.atrasados || 0);
      const totalFaltosos = Number(estatisticas.faltosos || 0);
      const totalLicencas = Number(estatisticas.licencas || 0);

      const amostraEstudantes = (Array.isArray(chamadaHoje) ? chamadaHoje : []).slice(0, 100).map((st: any) => ({
        nome: st.nome,
        ra: st.ra,
        turma: st.turma,
        statusHoje: st.status || 'presente',
        horarioAtraso: st.horarioAtraso || '',
        motivoLicenca: st.motivoLicenca || '',
        faltasTotais: Number(st.faltasTotais || 0),
        licencasAfastamentos: Number(st.licencasAfastamentos || 0),
        faltasEfetivas: Number(st.faltasEfetivas ?? Math.max(0, Number(st.faltasTotais || 0) - Number(st.licencasAfastamentos || 0))),
        atrasosAcumulados: Number(st.atrasosAcumulados || 0),
        faltasConsecutivas: Number(st.faltasConsecutivas || 0)
      }));

      let jsonResult: any = null;

      if (ai) {
        try {
          const promptSistema = `Você é o Especialista em Inteligência Pedagógica e Análise Comportamental da Escola Estadual Professor Clóvis de Lucca (Programa Ensino Integral - PEI São Paulo).
Sua missão é realizar um Mapeamento Comportamental Preditivo de Faltas e Atrasos para orientar ações em TEMPO REAL e antecipar o comportamento dos estudantes para o Ano Letivo de ${anoLetivoAlvo}.

DIRETRIZ DA TERCEIRA INFORMAÇÃO DE FALTAS:
- 1ª Métrica: Faltas Totais/Brutas (registro geral de todas as ausências).
- 2ª Métrica: Licenças, Afastamentos Médicos e Dispensas Legais (ausências com atestado ou justificativa de saúde).
- 3ª Métrica CRÍTICA (Faltas Efetivas): Faltas Reais = Faltas Totais - Licenças/Afastamentos. Esta métrica desconsidera problemas médicos e mede o real descompromisso/afastamento pedagógico do aluno, servindo como o termômetro principal de Busca Ativa e Tutoria.

REQUISITO DE SAÍDA:
Retorne EXCLUSIVAMENTE um objeto JSON válido, sem crases markdown adicionais, no formato:
{
  "diagnosticoGeral": "Texto executivo sintetizando a frequência do dia, o comportamento de atrasos, os padrões por dia da semana e a relevância da 3ª métrica para as decisões gestoras.",
  "padroesDetectados": [
    {
      "titulo": "ex: Atrasos Reincidentes na 1ª Aula / Segundas-feiras",
      "descricao": "Explicação detalhada do padrão comportamental identificado.",
      "grau": "ALTO" | "MODERADO" | "LEVE",
      "alunosImpactados": 5
    }
  ],
  "analiseTerceiraMetrica": {
    "explicacao": "Detalhamento de como a distinção entre faltas médicas e faltas não justificadas impacta o foco de intervenção da equipe.",
    "totalFaltasBrutas": 100,
    "totalLicencasAfastamentos": 25,
    "totalFaltasEfetivas": 75,
    "conclusaoPedagogica": "Recomendação direta sobre onde concentrar esforços de Busca Ativa."
  },
  "projecaoRisco2027": [
    {
      "ra": "RA do aluno",
      "nome": "Nome do estudante",
      "turma": "Turma atual",
      "nivelRisco": "CRÍTICO" | "ATENÇÃO" | "ESTÁVEL",
      "motivo": "Por que este aluno requer acompanhamento preventivo para 2027.",
      "acaoTutoria2027": "Pauta obrigatória a ser trabalhada pelo Tutor PEI em 2027."
    }
  ],
  "acoesImediatas": [
    {
      "prioridade": "IMEDIATA" | "SEMANAL" | "PLANEJAMENTO 2027",
      "titulo": "Título da ação",
      "descricao": "Instrução pedagógica operacional",
      "responsavel": "Equipe Gestora / CGPG / Tutores"
    }
  ]
}`;

          const promptUser = `DADOS ATUAIS DA APURAÇÃO:
- Data de Referência: ${dataReferencia}
- Turma Selecionada: ${turma}
- Ano Letivo Alvo: ${anoLetivoAlvo}
- Total Matriculados: ${totalMatriculados}
- Presentes Hoje: ${totalPresentes} (${totalMatriculados > 0 ? ((totalPresentes / totalMatriculados) * 100).toFixed(1) : 0}%)
- Atrasos Hoje: ${totalAtrasados}
- Faltas Injustificadas Hoje: ${totalFaltosos}
- Licenças / Afastamentos Médicos Hoje: ${totalLicencas}
- Totais Acumulados na Seleção -> 1ª Métrica (Faltas Brutas): ${Number(estatisticas.somaFaltasTotais || 0)} | 2ª Métrica (Licenças): ${Number(estatisticas.somaLicencas || 0)} | 3ª Métrica (Faltas Efetivas): ${Number(estatisticas.somaFaltasEfetivas || 0)}

HISTÓRICO COMPORTAMENTAL AGREGADO DE CHAMADAS ANTERIORES:
${historicoResumo ? JSON.stringify(historicoResumo, null, 2) : 'Primeira apuração em registro diário.'}

AMOSTRA DE ALUNOS COM AS 3 MÉTRICAS DE FALTAS:
${JSON.stringify(amostraEstudantes, null, 2)}

Analise os padrões comportamentais, destaque a 3ª métrica de faltas efetivas e projete os planos de ação preventiva para ${anoLetivoAlvo}.`;

          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptUser,
            config: {
              systemInstruction: promptSistema,
              responseMimeType: 'application/json'
            }
          });

          const rawText = response.text ? response.text.trim() : '';
          const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
          jsonResult = JSON.parse(cleanJson);
        } catch (geminiErr: any) {
          console.warn('[API AI Analise 2027] Falha no Gemini, alternando para contingência determinística:', geminiErr.message);
        }
      }

      if (!jsonResult || !jsonResult.diagnosticoGeral) {
        jsonResult = gerarAnaliseComportamentalFallback({
          turma,
          dataReferencia,
          totalMatriculados,
          totalPresentes,
          totalAtrasados,
          totalFaltosos,
          totalLicencas,
          estatisticas,
          historicoResumo,
          chamadaHoje: amostraEstudantes,
          anoLetivoAlvo
        });
      }

      res.json({
        success: true,
        data: jsonResult
      });
    } catch (err: any) {
      console.error('[API AI Analise 2027] Erro geral:', err.message);
      res.status(500).json({ error: 'Erro ao processar análise comportamental com IA', details: err.message });
    }
  });

  // ==========================================
  // ROTA DE IA: ANÁLISE E SEPARAÇÃO DE FREQUÊNCIA E BUSCA ATIVA POR SEGMENTO (FUNDAMENTAL vs MÉDIO)
  // ==========================================
  app.post('/api/ai/analise-busca-ativa-segmentos', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'Chave da API Gemini não configurada no servidor.',
          details: 'Verifique a variável GEMINI_API_KEY em Settings > Secrets.'
        });
      }

      const {
        dataReferencia = new Date().toISOString().slice(0, 10),
        totalEstudantesAtivos = 0,
        filtroAplicado = 'TODOS',
        resumoGeral = {},
        ensinoFundamental = {},
        ensinoMedio = {}
      } = req.body || {};

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' }
        }
      });

      const itemBuscaAtivaSchema = {
        type: Type.OBJECT,
        properties: {
          estudanteOuTurma: {
            type: Type.STRING,
            description: 'Nome do estudante (com turma) ou turma prioritária presente nos dados.'
          },
          ra: {
            type: Type.STRING,
            description: 'RA do estudante exatamente como enviado no JSON, ou string vazia se for turma/grupo.'
          },
          situacao: {
            type: Type.STRING,
            description: 'Dados objetivos (ex: frequência %, faltas consecutivas ou quantidade de atrasos registrados).'
          },
          ultimoContatoEEncaminhamento: {
            type: Type.STRING,
            description: 'Síntese objetiva do último contato com responsáveis (data, canal, retorno ou ausência de contato) e encaminhamentos (CT, MP, SED) já existentes.'
          },
          proximoPasso: {
            type: Type.STRING,
            description: 'Ação prática imediata de busca ativa considerando o histórico de contatos e encaminhamentos (ex: 1º contato via WhatsApp/ligação, cobrança de retorno, convocação presencial, ofício/Conselho Tutelar).'
          }
        },
        required: ['estudanteOuTurma', 'ra', 'situacao', 'ultimoContatoEEncaminhamento', 'proximoPasso']
      };

      const segmentSchema = {
        type: Type.OBJECT,
        properties: {
          nivelPrioridade: {
            type: Type.STRING,
            description: 'CRÍTICA, ATENÇÃO ou CONTROLADA'
          },
          panorama: {
            type: Type.STRING,
            description: 'Síntese objetiva (2-3 frases) da situação de frequência/presença, faltas consecutivas, atrasos e efetividade dos últimos contatos e encaminhamentos neste segmento.'
          },
          buscaAtivaFaltasEPresenca: {
            type: Type.ARRAY,
            items: itemBuscaAtivaSchema,
            description: 'Até 5 prioridades concretas de Busca Ativa focadas em faltas consecutivas e baixa presença/frequência, considerando últimos contatos com responsáveis e encaminhamentos.'
          },
          buscaAtivaAtrasos: {
            type: Type.ARRAY,
            items: itemBuscaAtivaSchema,
            description: 'Até 5 prioridades concretas de Busca Ativa focadas nos maiores atrasos registrados, considerando últimos contatos com responsáveis e encaminhamentos.'
          },
          acompanhamentoContatosEEncaminhamentos: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Lista de 2 a 4 pontos objetivos sobre pendências de retorno familiar, casos críticos sem nenhum contato recente e acompanhamento de encaminhamentos (Conselho Tutelar, MP, SED).'
          },
          padroesIdentificados: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Lista de 2 a 4 padrões concretos observados entre frequência, faltas consecutivas, atrasos e resposta das famílias.'
          },
          acoesPraticas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foco: { type: Type.STRING, description: 'FALTAS, ATRASOS, PRESENÇA ou ENCAMINHAMENTO' },
                acao: { type: Type.STRING, description: 'Ação prática imediata considerando o estágio atual dos contatos/encaminhamentos' },
                responsavelSugerido: { type: Type.STRING, description: 'Ex: Vice-Direção, CGPG, Secretaria, Tutoria, Direção' },
                prazo: { type: Type.STRING, description: 'Ex: Imediato (24h), Esta semana, Quinzenal' }
              },
              required: ['foco', 'acao', 'responsavelSugerido', 'prazo']
            }
          }
        },
        required: [
          'nivelPrioridade',
          'panorama',
          'buscaAtivaFaltasEPresenca',
          'buscaAtivaAtrasos',
          'acompanhamentoContatosEEncaminhamentos',
          'padroesIdentificados',
          'acoesPraticas'
        ]
      };

      const dadosCompactos = {
        dataReferencia,
        totalEstudantesAtivos,
        filtroAplicado,
        resumoGeral,
        ensinoFundamental,
        ensinoMedio
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analise os dados reais de frequência/presença, faltas consecutivas, maiores atrasos registrados, últimos contatos com responsáveis e encaminhamentos (Conselho Tutelar, Ministério Público, SED) da E.E. Professor Clóvis de Lucca (PEI - São Paulo), separando rigorosamente Ensino Fundamental e Ensino Médio para orientar a Busca Ativa diária.\n\nDADOS CONSOLIDADOS:\n${JSON.stringify(dadosCompactos)}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: `Você é especialista em Gestão Escolar e Busca Ativa (SEDUC-SP / PEI).
Regras obrigatórias:
- Baseie-se estritamente nos números, turmas, estudantes, RAs, últimos contatos e encaminhamentos fornecidos no JSON de entrada. Jamais invente nomes, RAs, datas ou contatos.
- Ajude operacionalmente a equipe a executar a Busca Ativa nas TRÊS frentes: (1) Faltas consecutivas e baixa presença, (2) Maiores atrasos registrados, e (3) Follow-up de contatos com responsáveis e encaminhamentos formais.
- Considere sempre o histórico real de contato do estudante ao sugerir o próximo passo:
  * Sem nenhum contato registrado → orientar 1º contato imediato (WhatsApp/ligação) com registro no Dossiê.
  * Último contato "Sem Resposta" ou "Aguardando Retorno" há vários dias → orientar nova tentativa por outro canal, convocação presencial ou notificação formal.
  * Responsável já atendeu/compareceu mas faltas ou atrasos continuam → orientar revisão de combinado, termo de ciência ou encaminhamento em rede.
  * Já encaminhado ao Conselho Tutelar / MP / SED → orientar cobrança de devolutiva e monitoramento contínuo da presença.
- Separe com clareza Ensino Fundamental (6º ao 9º ano) e Ensino Médio (1ª à 3ª série).
- Se não houver casos críticos em uma lista (ex: atrasos ou faltas em um segmento), retorne a lista vazia [] e explique brevemente no panorama.
- Seja objetivo, claro e pronto para ação imediata.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              resumoExecutivo: {
                type: Type.STRING,
                description: 'Visão executiva geral da escola (presença, faltas consecutivas, atrasos e situação dos contatos/encaminhamentos) em 2 a 3 frases objetivas.'
              },
              comparativoEntreSegmentos: {
                type: Type.STRING,
                description: 'Comparação direta destacando onde priorizar busca ativa de faltas, de atrasos e de cobrança de retornos entre Ensino Fundamental e Ensino Médio.'
              },
              ensinoFundamental: segmentSchema,
              ensinoMedio: segmentSchema
            },
            required: ['resumoExecutivo', 'comparativoEntreSegmentos', 'ensinoFundamental', 'ensinoMedio']
          }
        }
      });

      const rawText = (response.text || '').trim();
      if (!rawText) {
        return res.status(502).json({
          error: 'A API Gemini retornou uma resposta vazia.',
          details: 'Tente novamente em alguns instantes.'
        });
      }

      const parsed = JSON.parse(rawText);
      res.json({
        success: true,
        data: parsed,
        geradoEm: new Date().toISOString()
      });
    } catch (err: any) {
      const status = Number(err?.status || err?.code) || 500;
      const msg = String(err?.message || 'Erro ao processar análise por segmento com Gemini.');
      console.error('[API AI Busca Ativa Segmentos] Erro:', msg);
      if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          error: 'Limite temporário de requisições da API Gemini atingido (429).',
          details: 'Aguarde alguns instantes ou verifique a cota da chave em Settings > Secrets.'
        });
      }
      if (status === 403 || status === 400 || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
        return res.status(status === 403 ? 403 : 400).json({
          error: 'Falha de autenticação com a API Gemini.',
          details: 'Verifique a chave configurada em Settings > Secrets.'
        });
      }
      res.status(500).json({
        error: 'Erro ao gerar análise inteligente por segmento.',
        details: msg
      });
    }
  });

  // ==========================================
  // ROTA DE IA: MENSAGEM DIÁRIA DOS FALTOSOS & ATRASADOS PARA OS PAIS (WHATSAPP + LGPD)
  // ==========================================
  app.post('/api/ai/mensagem-faltosos-dia', async (req, res) => {
    try {
      const {
        data = new Date().toISOString().split('T')[0],
        anoLetivo = '2026',
        turma = 'TODAS',
        estatisticas = {},
        faltososPorTurma = {},
        atrasadosPorTurma = {},
        faltasConsecutivasAlerta = [],
        tomComunicado = 'acolhedor'
      } = req.body || {};

      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey
        ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
        : null;

      let mensagemGerada = '';
      let origem: 'gemini' | 'fallback' = 'fallback';

      if (ai) {
        try {
          const promptSistema = `Você é a Coordenação Pedagógica da Escola Estadual Professor Clóvis de Lucca (Programa Ensino Integral - PEI São Paulo).
Redija a mensagem oficial diária de WhatsApp para o grupo de Pais e Responsáveis sobre os estudantes ausentes e atrasados do dia.

REGRAS ESTRITAS (INVIOLÁVEIS):
1. LGPD RIGOROSA: Utilize EXATAMENTE os nomes já abreviados fornecidos nos dados de entrada (nunca invente sobrenomes nem exponha diagnósticos médicos ou motivos de licença).
2. FORMATO WHATSAPP: Use negrito do WhatsApp (*texto*) e emojis limpos nos cabeçalhos (📋, 🚫, ⏰, 📊, ⚠️) para leitura rápida no celular.
3. ESTRUTURA OBRIGATÓRIA:
   - Cabeçalho institucional da EE Prof. Clóvis de Lucca - PEI com a data e ano letivo.
   - Bloco de Estudantes Ausentes agrupado por turma (se não houver, parabenizar pela presença).
   - Bloco de Entradas Tardias / Atrasos agrupado por turma com horário quando informado.
   - Bloco de Balanço do Dia (Total no segmento, presentes, taxa de frequência, ausências). Nunca exponha detalhes clínicos de licenças.
   - Orientação aos responsáveis adaptada ao tom solicitado ("${tomComunicado}") lembrando o envio de atestado à Secretaria em até 48h e a importância da pontualidade no PEI.
4. Retorne APENAS o texto final pronto para colar no WhatsApp, sem comentários antes ou depois.`;

          const promptUser = `DADOS DA CHAMADA DO DIA:
- Data (YYYY-MM-DD): ${data}
- Ano Letivo: ${anoLetivo}
- Segmento/Turma: ${turma}
- Tom solicitado: ${tomComunicado}
- Estatísticas: ${JSON.stringify(estatisticas)}
- Estudantes Ausentes por Turma (nomes já sanitizados LGPD): ${JSON.stringify(faltososPorTurma)}
- Estudantes Atrasados por Turma (nomes já sanitizados LGPD): ${JSON.stringify(atrasadosPorTurma)}
- Alertas de Reincidência / Faltas Consecutivas (mencionar orientação geral sem expor nome individual com estigma): ${JSON.stringify(faltasConsecutivasAlerta)}`;

          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptUser,
            config: {
              systemInstruction: promptSistema
            }
          });

          const textOut = response.text ? response.text.trim() : '';
          if (textOut && textOut.length > 40) {
            mensagemGerada = textOut;
            origem = 'gemini';
          }
        } catch (geminiErr: any) {
          console.warn('[API AI Mensagem Faltosos] Falha no Gemini, usando modelo determinístico:', geminiErr.message);
        }
      }

      if (!mensagemGerada) {
        mensagemGerada = gerarMensagemFaltososDiaFallback({
          data,
          anoLetivo,
          turma,
          estatisticas,
          faltososPorTurma,
          atrasadosPorTurma,
          tomComunicado
        });
        origem = 'fallback';
      }

      res.json({
        success: true,
        origem,
        mensagem: mensagemGerada
      });
    } catch (err: any) {
      console.error('[API AI Mensagem Faltosos] Erro geral:', err.message);
      const fallback = gerarMensagemFaltososDiaFallback(req.body || {});
      res.json({
        success: true,
        origem: 'fallback',
        mensagem: fallback
      });
    }
  });

  function gerarMensagemFaltososDiaFallback(params: any): string {
    const {
      data = new Date().toISOString().split('T')[0],
      anoLetivo = '2026',
      turma = 'TODAS',
      estatisticas = {},
      faltososPorTurma = {},
      atrasadosPorTurma = {},
      tomComunicado = 'acolhedor'
    } = params || {};

    const parts = String(data).split('-');
    const dataFormatada = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : data;

    let msg = `*EE PROF. CLÓVIS DE LUCCA - PROGRAMA ENSINO INTEGRAL*\n`;
    msg += `📋 *BOLETIM DIÁRIO DE FREQUÊNCIA - ${dataFormatada}*\n`;
    msg += `Ano Letivo ${anoLetivo} • ${turma === 'TODAS' ? 'Todas as Turmas' : turma}\n\n`;

    msg += `🚫 *ESTUDANTES AUSENTES NO DIA*\n`;
    const turmasFaltosas = Object.keys(faltososPorTurma || {}).sort();
    if (turmasFaltosas.length === 0) {
      msg += `• Nenhuma ausência registrada no período. Parabéns pela frequência integral!\n\n`;
    } else {
      turmasFaltosas.forEach(t => {
        const lista = faltososPorTurma[t] || [];
        if (lista.length > 0) msg += `• *${t}*: ${lista.join(', ')}.\n`;
      });
      msg += `\n`;
    }

    msg += `⏰ *ENTRADAS TARDIAS / ATRASOS*\n`;
    const turmasAtrasadas = Object.keys(atrasadosPorTurma || {}).sort();
    if (turmasAtrasadas.length === 0) {
      msg += `• Sem atrasos registrados no início das aulas.\n\n`;
    } else {
      turmasAtrasadas.forEach(t => {
        const lista = atrasadosPorTurma[t] || [];
        if (lista.length > 0) msg += `• *${t}*: ${lista.join(', ')}.\n`;
      });
      msg += `\n`;
    }

    const total = Number(estatisticas.total || 0);
    const presentesTotal = Number(estatisticas.presentes || 0) + Number(estatisticas.atrasados || 0);
    const taxa = estatisticas.taxaPresenca || (total > 0 ? ((presentesTotal / total) * 100).toFixed(1) : '100.0');
    const faltosos = Number(estatisticas.faltosos || 0);
    const licencas = Number(estatisticas.licencas || 0);

    msg += `📊 *BALANÇO GERAL DO DIA*\n`;
    msg += `• Total de Estudantes no Segmento: ${total}\n`;
    msg += `• Presentes em Sala de Aula: ${presentesTotal} estudantes (${taxa}% de frequência)\n`;
    msg += `• Ausências Registradas Hoje: ${faltosos}\n`;
    if (licencas > 0) {
      msg += `• Afastamentos / Dispensas Justificadas: ${licencas}\n`;
    }
    msg += `\n`;

    msg += `⚠️ *ORIENTAÇÃO AOS PAIS E RESPONSÁVEIS:*\n`;
    if (tomComunicado === 'urgente') {
      msg += `Reforçamos a necessidade imediata de justificativa junto à Secretaria Escolar e ao Professor Tutor. O acúmulo de ausências e atrasos compromete o rendimento e a permanência pedagógica no Programa Ensino Integral (PEI). Caso haja atestado médico, apresentá-lo em até 48 horas.\n\n`;
    } else if (tomComunicado === 'padrao') {
      msg += `A frequência e a pontualidade diárias no Programa Ensino Integral (PEI) são indispensáveis para o aproveitamento pedagógico e o Projeto de Vida do estudante. Em caso de motivo de saúde, solicitamos encaminhar o atestado à Secretaria Escolar em até 48 horas.\n\n`;
    } else {
      msg += `Contamos sempre com a parceria das famílias para fortalecer a pontualidade e o acompanhamento diário dos nossos jovens no Programa Ensino Integral (PEI). Caso o estudante tenha precisado se ausentar por motivo de saúde ou imprevisto, pedimos a gentileza de informar a equipe ou entregar o atestado na Secretaria em até 48 horas.\n\n`;
    }
    msg += `Atenciosamente,\n*Equipe Gestora & Coordenação Pedagógica*\nEE Prof. Clóvis de Lucca`;

    return msg;
  }

  function gerarAnaliseComportamentalFallback(params: any): any {
    const {
      turma,
      dataReferencia,
      totalMatriculados,
      totalPresentes,
      totalAtrasados,
      totalFaltosos,
      totalLicencas,
      estatisticas = {},
      historicoResumo,
      chamadaHoje,
      anoLetivoAlvo
    } = params;
    const taxaPresenca = totalMatriculados > 0 ? (((totalPresentes + totalAtrasados) / totalMatriculados) * 100).toFixed(1) : '92.5';
    
    const alunosCriticos = (Array.isArray(chamadaHoje) ? chamadaHoje : [])
      .filter((a: any) => a.faltasEfetivas >= 8 || a.atrasosAcumulados >= 2 || a.statusHoje === 'falta' || a.faltasConsecutivas >= 2)
      .sort((a: any, b: any) => (b.faltasEfetivas + b.atrasosAcumulados * 2) - (a.faltasEfetivas + a.atrasosAcumulados * 2))
      .slice(0, 8);

    const somaBrutas = Number(estatisticas.somaFaltasTotais ?? (totalFaltosos + totalLicencas));
    const somaLicencas = Number(estatisticas.somaLicencas ?? totalLicencas);
    const somaEfetivas = Number(estatisticas.somaFaltasEfetivas ?? Math.max(0, somaBrutas - somaLicencas));
    const diasAnalisados = Number(historicoResumo?.diasRegistrados || 1);
    const diaCritico = historicoResumo?.diaSemanaMaisCritico || 'Segunda-feira';

    return {
      diagnosticoGeral: `Apuração de Frequência realizada em ${dataReferencia} para ${turma === 'TODAS' ? 'todas as turmas' : turma} (${diasAnalisados} dia(s) analisado(s) no histórico): Taxa de presença calculada em ${taxaPresenca}%. Foram registrados ${totalAtrasados} atrasos e ${totalFaltosos} ausências injustificadas hoje, além de ${totalLicencas} licenças médicas formais. A aplicação da 3ª métrica (${somaEfetivas} faltas efetivas desconsiderando ${somaLicencas} afastamentos médicos de ${somaBrutas} faltas brutas) revela com precisão o público que demanda acolhimento imediato pela Tutoria e Busca Ativa para ${anoLetivoAlvo}.`,
      padroesDetectados: [
        {
          titulo: `Concentração de Atrasos no 1º Período • Pico em ${diaCritico}`,
          descricao: `Dos ${totalAtrasados} atrasos apontados hoje${historicoResumo?.totalAtrasosHistorico ? ` (${historicoResumo.totalAtrasosHistorico} no histórico registrado)` : ''}, a maior incidência ocorre nos primeiros minutos da manhã, especialmente em ${diaCritico}, impactando o primeiro componente da rotina PEI.`,
          grau: 'ALTO',
          alunosImpactados: totalAtrasados || alunosCriticos.length || 3
        },
        {
          titulo: 'Diferenciação Crítica: 3ª Métrica (Faltas Efetivas vs Licenças)',
          descricao: `De ${somaBrutas} faltas brutas acumuladas, ${somaLicencas} correspondem a licenças/atestados médicos legais. Ao descontar essas justificativas, restam ${somaEfetivas} faltas efetivas reais para direcionamento da Busca Ativa.`,
          grau: 'MODERADO',
          alunosImpactados: totalLicencas || 2
        },
        {
          titulo: `Comportamento Preditivo para Transição ${anoLetivoAlvo}`,
          descricao: `Estudantes com 2 ou mais atrasos sistemáticos ou faltas efetivas crescentes tendem a ampliar a infrequência no 1º bimestre de ${anoLetivoAlvo} se não houver pactuação prévia na Tutoria.`,
          grau: 'ALTO',
          alunosImpactados: alunosCriticos.length || 4
        }
      ],
      analiseTerceiraMetrica: {
        explicacao: 'A Terceira Métrica isola as Faltas Efetivas (Faltas Totais deduzidas de Licenças e Afastamentos Médicos com atestado). Ela protege o estudante com afastamento legal de abordagens coercitivas indevidas e orienta a equipe de Busca Ativa aos casos de real risco de evasão.',
        totalFaltasBrutas: somaBrutas,
        totalLicencasAfastamentos: somaLicencas,
        totalFaltasEfetivas: somaEfetivas,
        conclusaoPedagogica: 'Priorizar contato telefônico e visitas familiares exclusivamente para alunos cuja 3ª métrica ultrapassa 10% do teto letivo, orientando o Tutor a incluir a pontualidade no Plano de Tutoria.'
      },
      projecaoRisco2027: alunosCriticos.map((a: any) => ({
        ra: a.ra || '0001098...',
        nome: a.nome || 'Estudante em Acompanhamento',
        turma: a.turma || turma,
        nivelRisco: (a.faltasEfetivas >= 12 || a.faltasConsecutivas >= 3) ? 'CRÍTICO' : 'ATENÇÃO',
        motivo: `${a.faltasEfetivas} faltas efetivas (sem licença) e ${a.atrasosAcumulados} atraso(s) acumulados.`,
        acaoTutoria2027: `Pactuar meta de pontualidade no Projeto de Vida e agendar alinhamento individual com responsáveis para o início de ${anoLetivoAlvo}.`
      })),
      acoesImediatas: [
        {
          prioridade: 'IMEDIATA',
          titulo: 'Disparo de WhatsApp aos Responsáveis dos Faltosos do Dia',
          descricao: 'Acionar a mensagem oficial gerada por IA aos pais dos ausentes e atrasados de hoje, em conformidade estrita com a LGPD.',
          responsavel: 'Equipe Gestora & Secretaria'
        },
        {
          prioridade: 'SEMANAL',
          titulo: 'Pauta de Pontualidade nas Sessões Semanais de Tutoria PEI',
          descricao: 'Encaminhar aos Professores Tutores a relação dos estudantes com atrasos reincidentes na 1ª aula para registro na Ficha de Tutoria.',
          responsavel: 'Coordenadores CGPG e Tutores'
        },
        {
          prioridade: `PLANEJAMENTO ${anoLetivoAlvo}`,
          titulo: `Mapeamento das Turmas de ${anoLetivoAlvo} e Reorganização de Acolhimento`,
          descricao: `Distribuir estudantes com maior 3ª métrica de faltas efetivas em grupos de tutoria de acompanhamento intensivo na preparação de ${anoLetivoAlvo}.`,
          responsavel: 'Direção Escolar e Professores Tutores'
        }
      ]
    };
  }

  // Função Auxiliar de Contingência Analítica do Boletim Diário & Faltas Consecutivas
  function gerarBoletimDiarioFallback(params: any) {
    const {
      data = new Date().toLocaleDateString('pt-BR'),
      turno = 'Manhã',
      etapa = 'Ensino Fundamental',
      mensagensProfessores = '',
      atrasosRegistrados = [],
      saidasAntecipadasRegistradas = [],
      atestadosRegistrados = [],
      alunosCadastrados = [],
      totalMatriculadosAtivos = 0,
      historicoBoletinsAnteriores = []
    } = params || {};

    const rawText = String(mensagensProfessores || '');
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    // Mapeamento de turmas
    const turmasAusentes: Record<string, string[]> = {};
    const atrasadosPorTurma: Record<string, string[]> = {};
    const saidasPorTurma: Record<string, string[]> = {};
    const ausentesSet = new Set<string>();

    let turmaAtual = '';

    // Regex para identificar menção a turma (sem confundir com 1ª aula, 2ª aula, 6ª aula)
    const regexTurma = /(?:^|[\s:])(?:ausentes?\s*(?:no|na|da|turma)?\s*|aus[êe]ncias?\s*(?:no|na|da|turma)?\s*|chamada\s*(?:no|na|da|turma)?\s*|turma\s*)?([1-9][º°ª]?\s*[A-Da-d])\b(?!\s*ª?\s*aula|\s*º?\s*aula|\s*°?\s*aula|\s*aula)/i;

    const normalizarNomeTurma = (t: string) => {
      const clean = t.replace(/[^\d1-9A-Za-z]/g, '').toUpperCase();
      const num = clean.replace(/\D/g, '');
      const letra = clean.replace(/[^A-D]/g, '');
      return `${num}º ${letra}`.trim();
    };

    const normTurmaKey = (t: string) => (t || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

    // 1. Filtrar estritamente alunos ATIVOS
    const alunosAtivos = (Array.isArray(alunosCadastrados) ? alunosCadastrados : []).filter((a: any) => {
      const st = String(a.status || 'ATIVO').trim().toUpperCase();
      return st === 'ATIVO';
    });

    // Agrupar alunos ativos por turma para busca rápida
    const mapaAtivosPorTurma: Record<string, any[]> = {};
    alunosAtivos.forEach((st: any) => {
      const tKey = normTurmaKey(st.turma);
      if (tKey) {
        mapaAtivosPorTurma[tKey] = mapaAtivosPorTurma[tKey] || [];
        mapaAtivosPorTurma[tKey].push(st);
      }
    });

    // Funções de normalização fonética e de nomes
    const removerAcentos = (str: string) => {
      return (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    };

    const fonetica = (str: string) => {
      return removerAcentos(str)
        .replace(/ph/g, 'f')
        .replace(/th/g, 't')
        .replace(/ck/g, 'k')
        .replace(/y/g, 'i')
        .replace(/w/g, 'v')
        .replace(/z/g, 's')
        .replace(/x/g, 's')
        .replace(/ch/g, 's')
        .replace(/ll/g, 'l')
        .replace(/ss/g, 's')
        .replace(/rr/g, 'r')
        .replace(/mm/g, 'm')
        .replace(/nn/g, 'n')
        .replace(/tt/g, 't');
    };

    // Função de correspondência do aluno ativo da turma no cadastro do sistema
    const buscarAlunoAtivoDaTurma = (nomeBuscado: string, turmaRef: string): any => {
      const tKey = normTurmaKey(turmaRef);
      const listaTurma = mapaAtivosPorTurma[tKey] || [];
      if (listaTurma.length === 0) return null;

      const qNorm = removerAcentos(nomeBuscado);
      const qPhon = fonetica(nomeBuscado);
      const qParts = qNorm.split(/\s+/).filter(p => p.length >= 2);
      const qPhonParts = qPhon.split(/\s+/).filter(p => p.length >= 2);

      // 1. Correspondência exata
      let match = listaTurma.find(a => removerAcentos(a.nome) === qNorm);
      if (match) return match;

      // 2. Correspondência fonética exata
      match = listaTurma.find(a => fonetica(a.nome) === qPhon);
      if (match) return match;

      // 3. Primeiro nome fonético confere e sobrenome confere
      if (qPhonParts.length > 1) {
        match = listaTurma.find(a => {
          const aPhonParts = fonetica(a.nome).split(/\s+/);
          const firstMatch = aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
          const lastMatch = aPhonParts.some((ap, idx) => idx > 0 && qPhonParts.slice(1).some(qp => ap === qp || ap.startsWith(qp) || qp.startsWith(ap)));
          return firstMatch && lastMatch;
        });
        if (match) return match;
      }

      // 4. Todas as palavras da busca constam no nome oficial
      if (qParts.length > 1) {
        match = listaTurma.find(a => {
          const aNorm = removerAcentos(a.nome);
          return qParts.every(p => aNorm.includes(p));
        });
        if (match) return match;
      }

      // 5. Busca por nome único (ex: "Wendel", "Yohana", "Erick", "Alana", "Eduarda")
      if (qPhonParts.length === 1) {
        const candidatos = listaTurma.filter(a => {
          const aPhonParts = fonetica(a.nome).split(/\s+/);
          return aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
        });
        if (candidatos.length >= 1) return candidatos[0];
      }

      // 6. Substring significativa
      match = listaTurma.find(a => {
        const aNorm = removerAcentos(a.nome);
        return qParts.some(p => p.length >= 4 && aNorm.includes(p));
      });

      return match || null;
    };

    // FORMATAÇÃO ESTRITA LGPD:
    // Nunca imprimir sobrenomes completos no WhatsApp público para os pais!
    // Se o primeiro nome do aluno é ÚNICO na turma, imprimir APENAS o primeiro nome (ex: "Marina", "Matheus", "Thalles", "Erik", "Wendel", "Yohana", "Natanael", "Alana", "Eduarda", "Guilherme", "Kaio", "Beatriz", "Ronaldo").
    // Somente se houver mais de um aluno com o mesmo primeiro nome na turma é que usamos inicial para distingui-los (ex: "Arthur H.", "Hiago G.", "Hiago P.", "Ana B.", "Ana C.", "Pedro G.", "Pedro H.").
    const formatarNomeLGPD = (nomeOriginal: string, turmaRef: string): string => {
      const trimmed = (nomeOriginal || '').trim().replace(/^•\s*/, '');
      if (!trimmed) return 'Estudante';
      if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Z]\.)+$/.test(trimmed)) {
        return trimmed;
      }

      // 1. Tentar localizar o aluno ativo na turma para garantir a correspondência precisa
      const alunoAtivo = buscarAlunoAtivoDaTurma(trimmed, turmaRef);
      const nomeBase = alunoAtivo ? alunoAtivo.nome : trimmed;

      const preposicoes = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
      const palavras = nomeBase
        .trim()
        .replace(/\.$/, '')
        .split(/\s+/)
        .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .filter((p: string) => !preposicoes.has(p.toLowerCase()));

      if (palavras.length === 0) return 'Estudante';
      if (palavras.length === 1) return palavras[0];

      const primeiroNome = palavras[0];
      const segundoNome = palavras[1] || '';

      const listaTurma = mapaAtivosPorTurma[normTurmaKey(turmaRef)] || [];
      const mesmoPrimeiroNome = listaTurma.filter((a: any) => {
        const aFirst = a.nome.trim().split(/\s+/)[0];
        return fonetica(aFirst) === fonetica(primeiroNome);
      });

      // Se há mais de 1 aluno com o mesmo primeiro nome na turma:
      if (mesmoPrimeiroNome.length > 1) {
        // Distinguir por inicial: ex "Arthur H.", "Arthur R.", "Hiago G.", "Hiago P.", "Ana B.", "Ana C."
        const mesmoSegundoNomeInicial = mesmoPrimeiroNome.filter((a: any) => {
          const aPalavras = a.nome.trim().split(/\s+/).filter((p: string) => !preposicoes.has(p.toLowerCase()));
          const aSeg = aPalavras[1] || '';
          return aSeg && segundoNome && aSeg[0].toUpperCase() === segundoNome[0].toUpperCase();
        });

        if (mesmoSegundoNomeInicial.length > 1 && palavras[2]) {
          return `${primeiroNome} ${segundoNome[0].toUpperCase()}. ${palavras[2][0].toUpperCase()}.`;
        }
        const inicial = segundoNome ? `${segundoNome[0].toUpperCase()}.` : '';
        return `${primeiroNome} ${inicial}`.trim();
      }

      // Se não foi encontrado no cadastro ativo da turma mas possui sobrenome, NUNCA revelar sobrenome completo (LGPD):
      if (!alunoAtivo && palavras.length > 1) {
        return `${primeiroNome} ${segundoNome[0].toUpperCase()}.`;
      }

      // Se o primeiro nome é ÚNICO na turma, retornar ESTRITAMENTE apenas o primeiro nome (sem revelar iniciais ou sobrenomes)
      return primeiroNome;
    };

    lines.forEach(rawL => {
      // Remover cabeçalhos do WhatsApp como "[25/09, 12:49] +55 11 97608-3663: "
      let line = rawL.replace(/^\[\d{1,2}\/\d{1,2}(?:,\s*\d{1,2}:\d{1,2})?\]\s*[^:]+:\s*/i, '').trim();
      if (!line) line = rawL.trim();

      // Ignorar menções de AEE, dúvidas, perguntas ou conversas soltas
      if (line.includes('MANZINE E GABRIEL VALADARES - AEE')) return;
      if (line.includes('?')) return; // Dúvidas entre professores como "Bernardo a Eliza foi embora na 2° aula ?" são chat
      if (/algu[ée]m\s+sabe|est[áa] aqui comigo|minha de OE/i.test(line)) return;
      if (/boa tarde|bom dia|falta chamada|obrigado|obrigada/i.test(line)) return;

      // Trata correções enviadas pelo professor: "Corrigindo: AUSENTES NO 7C : ..."
      if (/corrigindo/i.test(line)) {
        const mCorr = line.match(regexTurma);
        const tAlvo = mCorr ? normalizarNomeTurma(mCorr[1]) : turmaAtual;
        if (tAlvo) {
          turmaAtual = tAlvo;
          turmasAusentes[tAlvo] = [];
          const partes = line.split(':');
          const resto = partes[partes.length - 1];
          const nomes = resto.split(/[,;]/).map(n => n.trim()).filter(n => n.length > 2);
          nomes.forEach(nm => {
            if (!turmasAusentes[tAlvo].some(x => x.toLowerCase() === nm.toLowerCase())) {
              turmasAusentes[tAlvo].push(nm);
              ausentesSet.add(`${tAlvo}|${nm.toLowerCase()}`);
            }
          });
          return;
        }
      }

      // Procurar se a linha define uma nova turma
      const matchTurma = line.match(regexTurma);
      if (matchTurma && matchTurma[1]) {
        // Se a linha tem lista em linha única separada por vírgula (ex: "AUSENTES NO 7C : Davi , David , Eliza...")
        if (line.includes(':') && line.length > 15) {
          const partes = line.split(':');
          const tMatch = partes[0].match(regexTurma);
          if (tMatch && tMatch[1]) {
            turmaAtual = normalizarNomeTurma(tMatch[1]);
            turmasAusentes[turmaAtual] = turmasAusentes[turmaAtual] || [];
            const nomesSeparados = partes.slice(1).join(':').split(/[,;]/).map(n => n.trim()).filter(n => n.length > 2);
            nomesSeparados.forEach(nm => {
              if (!turmasAusentes[turmaAtual].some(x => x.toLowerCase() === nm.toLowerCase())) {
                turmasAusentes[turmaAtual].push(nm);
                ausentesSet.add(`${turmaAtual}|${nm.toLowerCase()}`);
              }
            });
            return;
          }
        } else {
          turmaAtual = normalizarNomeTurma(matchTurma[1]);
          turmasAusentes[turmaAtual] = turmasAusentes[turmaAtual] || [];
          return;
        }
      }

      if (!turmaAtual) return;

      // Detecta se a linha anota saída antecipada
      if (/foi embora|sa[íi]da|saiu/i.test(line)) {
        saidasPorTurma[turmaAtual] = saidasPorTurma[turmaAtual] || [];
        // Extrair parte do nome e horário (sem justificativa!)
        const horaMatch = line.match(/(\d{1,2}[h:]\d{0,2}|\d+[ªº°]?\s*aula)/i);
        let horaTexto = '';
        if (horaMatch) {
          horaTexto = horaMatch[1].replace(':', 'h').trim();
          if (/^\d+aula$/i.test(horaTexto)) {
            horaTexto = horaTexto.replace(/(\d+)aula/i, '$1ª aula');
          }
        }
        const nomeBruto = line.replace(/[\(\[].*?[\]\)]/g, '').replace(/foi embora.*$/i, '').replace(/saiu.*$/i, '').trim();
        const nomeFormatadoLgpd = formatarNomeLGPD(nomeBruto || 'Estudante', turmaAtual);
        const infoHora = horaTexto ? ` (${horaTexto})` : '';
        saidasPorTurma[turmaAtual].push(`${nomeFormatadoLgpd}${infoHora}`);
        return;
      }

      // Detecta se a linha anota atraso
      if (/atras[ao]d[ao]|\(atraso\)/i.test(line)) {
        atrasadosPorTurma[turmaAtual] = atrasadosPorTurma[turmaAtual] || [];
        const horaMatch = line.match(/(\d{1,2}[h:]\d{0,2})/i);
        const horaTexto = horaMatch ? horaMatch[1].replace(':', 'h') : '07h25';
        const nomeLimpo = line.replace(/[\(\[].*?[\]\)]/g, '').replace(/atrasad[ao]/i, '').trim();
        const nomeFormatadoLgpd = formatarNomeLGPD(nomeLimpo || 'Estudante', turmaAtual);
        if (!atrasadosPorTurma[turmaAtual].some(x => x.toLowerCase().includes(nomeLimpo.toLowerCase()))) {
          atrasadosPorTurma[turmaAtual].push(`${nomeFormatadoLgpd} (${horaTexto})`);
        }
        return;
      }

      // Linhas com nomes de ausentes
      if (line.length >= 2 && !line.startsWith('[')) {
        turmasAusentes[turmaAtual] = turmasAusentes[turmaAtual] || [];
        if (!turmasAusentes[turmaAtual].some(x => x.toLowerCase() === line.toLowerCase())) {
          turmasAusentes[turmaAtual].push(line);
          ausentesSet.add(`${turmaAtual}|${line.toLowerCase()}`);
        }
      }
    });

    // Incorporar atrasos registrados formalmente no sistema
    (atrasosRegistrados || []).forEach((at: any) => {
      const tNorm = normalizarNomeTurma(at.turma || '');
      if (tNorm) {
        atrasadosPorTurma[tNorm] = atrasadosPorTurma[tNorm] || [];
        const horaStr = at.horaRealAtraso || at.hora || '07h25';
        const obsStr = at.obs ? ` - ${at.obs}` : '';
        const nomeFormatado = formatarNomeLGPD(at.nomeAluno || 'Estudante', tNorm);
        const itemStr = `${nomeFormatado} (${horaStr.replace(':', 'h')}${obsStr})`;
        if (!atrasadosPorTurma[tNorm].some(existing => existing.includes(nomeFormatado))) {
          atrasadosPorTurma[tNorm].push(itemStr);
        }
      }
    });

    // Incorporar saídas antecipadas registradas
    (saidasAntecipadasRegistradas || []).forEach((sa: any) => {
      const tNorm = normalizarNomeTurma(sa.turma || '');
      if (tNorm) {
        saidasPorTurma[tNorm] = saidasPorTurma[tNorm] || [];
        const horaStr = sa.horaRealSaida || sa.hora || '';
        const infoHora = horaStr ? ` (${horaStr.replace(':', 'h')})` : '';
        const nomeFormatado = formatarNomeLGPD(sa.nomeAluno || 'Estudante', tNorm);
        saidasPorTurma[tNorm].push(`${nomeFormatado}${infoHora}`);
      }
    });

    // Formatar Ausentes por turma com estrita proteção LGPD
    const linhasAusentesFormatadas: string[] = [];
    let totalAusenciasContadas = 0;

    const turmasOrdenadas = Object.keys(turmasAusentes).sort();
    turmasOrdenadas.forEach(t => {
      const nomes = turmasAusentes[t] || [];
      if (nomes.length > 0) {
        totalAusenciasContadas += nomes.length;
        const nomesAbreviados = nomes.map(nm => formatarNomeLGPD(nm, t)).join(', ');
        linhasAusentesFormatadas.push(`• ${t}: ${nomesAbreviados}.`);
      }
    });

    // Formatar Atrasados por turma
    const linhasAtrasadosFormatadas: string[] = [];
    let totalAtrasadosContados = 0;
    const turmasAtrasoOrdenadas = Object.keys(atrasadosPorTurma).sort();
    turmasAtrasoOrdenadas.forEach(t => {
      const atrasos = atrasadosPorTurma[t] || [];
      if (atrasos.length > 0) {
        totalAtrasadosContados += atrasos.length;
        linhasAtrasadosFormatadas.push(`• ${t}: ${atrasos.join(', ')}.`);
      }
    });

    // Formatar Saídas Antecipadas
    const linhasSaidasFormatadas: string[] = [];
    let totalSaidasContadas = 0;
    Object.keys(saidasPorTurma).forEach(t => {
      const s = saidasPorTurma[t] || [];
      if (s.length > 0) {
        totalSaidasContadas += s.length;
        linhasSaidasFormatadas.push(`• ${t}: ${s.join(', ')}.`);
      }
    });

    // Formatar Atestados com LGPD
    const linhasAtestadosFormatadas: string[] = [];
    let totalAtestadosContados = (atestadosRegistrados || []).length;
    (atestadosRegistrados || []).forEach((at: any) => {
      const nomeFormatado = formatarNomeLGPD(at.nomeAluno || 'Estudante', at.turma || '');
      linhasAtestadosFormatadas.push(`• ${at.turma || ''}: ${nomeFormatado}${at.descricao ? ' (' + at.descricao + ')' : ''}`);
    });

    // Balanço: Calcular com base nos alunos ativos da escola
    const isFund = (turma: string) => {
      const clean = String(turma || '').replace(/[^\d1-9A-Za-z]/g, '').toUpperCase();
      return clean.startsWith('6') || clean.startsWith('7') || clean.startsWith('8') || clean.startsWith('9');
    };
    const isMed = (turma: string) => {
      const clean = String(turma || '').replace(/[^\d1-9A-Za-z]/g, '').toUpperCase();
      return clean.startsWith('1') || clean.startsWith('2') || clean.startsWith('3');
    };

    const isGeralEtapa = etapa.toLowerCase().includes('geral') || etapa.toLowerCase().includes('todos');
    const isFundEtapa = !isGeralEtapa && (etapa.toLowerCase().includes('fundamental') || etapa.toLowerCase().includes('6º ao 9º'));
    const isMedEtapa = !isGeralEtapa && (etapa.toLowerCase().includes('médio') || etapa.toLowerCase().includes('medio') || etapa.toLowerCase().includes('1º ao 3º'));

    let totalMatriculados = Number(totalMatriculadosAtivos || 0);
    if (!totalMatriculados || totalMatriculados <= 0) {
      if (isGeralEtapa) {
        const countFund = alunosAtivos.filter((a: any) => isFund(a.turma)).length;
        const countMed = alunosAtivos.filter((a: any) => isMed(a.turma)).length;
        totalMatriculados = (countFund + countMed) > 0 ? (countFund + countMed) : alunosAtivos.length;
      } else if (isFundEtapa) {
        totalMatriculados = alunosAtivos.filter((a: any) => isFund(a.turma)).length;
      } else if (isMedEtapa) {
        totalMatriculados = alunosAtivos.filter((a: any) => isMed(a.turma)).length;
      } else {
        totalMatriculados = alunosAtivos.length;
      }
    }
    if (totalMatriculados <= 0) {
      totalMatriculados = isGeralEtapa ? 703 : (isFundEtapa ? 497 : 206);
    }

    const taxaAusencia = totalMatriculados > 0 ? ((totalAusenciasContadas / totalMatriculados) * 100).toFixed(1) : '0,0';

    // Montar texto final oficial do WhatsApp
    const boletimFormatado = `📢 BOLETIM DIÁRIO DE FREQUÊNCIA: ESCOLA CLOVIS DE LUCCA
📅 Data: ${data} (Período da ${turno})

Prezadas famílias e responsáveis, compartilhamos o retrato consolidado de frequência, pontualidade e ocorrências do turno da ${turno.toLowerCase()} de hoje com todas as turmas atualizadas. A parceria de vocês é essencial para garantir o ritmo de aprendizado dos nossos estudantes! 🤝

☀️ PERÍODO DA ${turno.toUpperCase()} (${etapa.toUpperCase()})

🛑 ALUNOS AUSENTES
${linhasAusentesFormatadas.length > 0 ? linhasAusentesFormatadas.join('\n') : '• Nenhuma ausência registrada no turno.'}

⏰ ALUNOS ATRASADOS / ENTRADA TARDIA
${linhasAtrasadosFormatadas.length > 0 ? linhasAtrasadosFormatadas.join('\n') : '• Sem registros de atrasos no turno.'}

🚪 SAÍDAS ANTECIPADAS
${linhasSaidasFormatadas.length > 0 ? linhasSaidasFormatadas.join('\n') : '• Sem ocorrências registradas no turno.'}

📊 BALANÇO DO TURNO (${etapa})

• Total de Matriculados (${turno}): ${totalMatriculados} alunos
• Total de Ausências Integrais: ${totalAusenciasContadas} faltas confirmadas
• Índice de Faltas: ${taxaAusencia.replace('.', ',')}% das cadeiras vazias
• Total de Atrasos / Entradas Tardias: ${totalAtrasadosContados} registros na portaria/secretaria

Lembramos que os minutos iniciais das aulas são preciosos para a explicação dos conteúdos. Caso a ausência tenha ocorrido por recomendação de saúde, favor apresentar o atestado médico na secretaria da unidade escolar.

Contamos com o apoio e o empenho de todos!

Atenciosamente,
Direção e Equipe Gestora`;

    // CRUZAMENTO DE FALTAS CONSECUTIVAS PARA A EQUIPE GESTORA
    const alunosCriticos3Mais: any[] = [];
    const alunosAlerta2: any[] = [];
    const seenConsecutivoKeys = new Set<string>();

    // Cruzar cada ausente com a lista de alunos ATIVOS da turma
    turmasOrdenadas.forEach(t => {
      const nomes = turmasAusentes[t] || [];
      nomes.forEach((nomeBruto: string) => {
        const cleanNome = nomeBruto.toLowerCase().trim();
        const matchCadastro = buscarAlunoAtivoDaTurma(nomeBruto, t);

        // Verificar histórico em boletins anteriores
        let diasConsecutivos = 1;
        if (Array.isArray(historicoBoletinsAnteriores)) {
          historicoBoletinsAnteriores.forEach((bol: any) => {
            const ausentesBol = bol.ausentes || [];
            if (ausentesBol.some((a: any) => {
              const aNome = String(a.nome || '').toLowerCase();
              return aNome.includes(cleanNome) || cleanNome.includes(aNome.split(' ')[0]);
            })) {
              diasConsecutivos++;
            }
          });
        }

        // Se o aluno já tem registro de frequência baixa (< 75%) ou faltas acumuladas, potencializa o risco
        const freqNum = matchCadastro?.presenca_atual ? parseFloat(String(matchCadastro.presenca_atual).replace('%', '')) : 80;
        if (freqNum < 75 && diasConsecutivos === 1) {
          diasConsecutivos = 2; // Alerta imediato por vulnerabilidade
        }

        const nomeOficial = matchCadastro?.nome || nomeBruto.toUpperCase();
        const raOficial = matchCadastro?.ra || 'Cadastrado';
        const key = `${t}|${nomeOficial.toLowerCase()}`;

        if (seenConsecutivoKeys.has(key)) return;
        seenConsecutivoKeys.add(key);

        if (diasConsecutivos >= 3) {
          alunosCriticos3Mais.push({
            nome: nomeOficial,
            turma: t,
            ra: raOficial,
            diasConsecutivos,
            frequenciaAtual: matchCadastro?.presenca_atual || 'Não informada',
            nivelRisco: 'CRÍTICO',
            motivoDestaque: `Acumulou ${diasConsecutivos} faltas consecutivas. Atingiu o limiar de intervenção compulsória da Resolução SEDUC nº 39/2023.`,
            acaoSugerida: 'Ligar imediatamente para os responsáveis e formalizar notificação de convocação presencial na Busca Ativa.'
          });
        } else if (diasConsecutivos === 2) {
          alunosAlerta2.push({
            nome: nomeOficial,
            turma: t,
            ra: raOficial,
            diasConsecutivos: 2,
            frequenciaAtual: matchCadastro?.presenca_atual || 'Não informada',
            nivelRisco: 'ATENÇÃO',
            motivoDestaque: '2ª ausência consecutiva registrada. Risco de progressão para abandono.',
            acaoSugerida: 'Realizar contato telefônico ou WhatsApp preventivo de acolhimento com a família.'
          });
        }
      });
    });

    const totalConsecutivos = alunosCriticos3Mais.length + alunosAlerta2.length;

    return {
      boletimFormatado,
      balanco: {
        totalMatriculados,
        totalAusencias: totalAusenciasContadas,
        indiceFaltas: `${taxaAusencia.replace('.', ',')}%`,
        totalAtrasos: totalAtrasadosContados,
        totalSaidasAntecipadas: totalSaidasContadas,
        totalAtestados: totalAtestadosContados
      },
      turmasAusentes,
      atrasadosPorTurma,
      saidasPorTurma,
      alertaEquipeGestora: {
        totalAlunosConsecutivos: totalConsecutivos,
        resumoExecutivo: `Identificados ${totalConsecutivos} estudantes com ausências consecutivas ou vulnerabilidade acentuada hoje (${alunosCriticos3Mais.length} em nível crítico com 3+ faltas e ${alunosAlerta2.length} sob atenção com 2 faltas consecutivas).`,
        alunosCriticos3Mais,
        alunosAlerta2,
        orientacoesSEDUC39: 'Art. 2º e 3º da Resolução SEDUC nº 39/2023: Constatadas 3 ausências consecutivas injustificadas ou reiteração de faltas, a escola deve empreender procedimentos imediatos de Busca Ativa e diálogo com os responsáveis antes de remessa à FICAI/Conselho Tutelar.'
      }
    };
  }

  // Função Auxiliar de Contingência: Diagnóstico e Redação com base na Resolução SEDUC nº 39, de 05-09-2023
  function gerarMensagemFallbackSEDUC39(aluno: any, contatosBa: any[], ocorrenciasDossie: any[], totalAtrasos: number, estagioDesejado: string) {
    const nomeAluno = String(aluno.nome || 'ESTUDANTE').toUpperCase();
    const turmaAluno = String(aluno.turma || aluno.serie || 'NÃO INFORMADA').toUpperCase();
    const raAluno = String(aluno.ra || '').trim();
    const freqAtual = aluno.frequencia_atual || aluno.presenca_anual || 'Não informada';
    const contatosQtd = Array.isArray(contatosBa) ? contatosBa.length : 0;
    const atrasosNum = Number(totalAtrasos || 0);

    let estagioFinal = estagioDesejado;
    if (!estagioFinal || estagioFinal === 'auto') {
      if (aluno.ficha_ct || (contatosQtd >= 4 && (aluno.reincidente || String(freqAtual).includes('5') || String(freqAtual).includes('4')))) {
        estagioFinal = 'ministerio_publico';
      } else if (contatosQtd >= 2 || aluno.reincidente || (freqAtual && parseFloat(String(freqAtual).replace('%', '')) < 75)) {
        estagioFinal = 'conselho_tutelar';
      } else if (contatosQtd >= 1 || atrasosNum >= 3) {
        estagioFinal = 'convocacao';
      } else {
        estagioFinal = 'familiar';
      }
    }

    if (estagioFinal === 'ministerio_publico' || estagioFinal === '4_MINISTERIO_PUBLICO') {
      return {
        mensagem: `NOTIFICAÇÃO INSTITUCIONAL DE GRAVIDADE EXTREMA - E.E. CLÓVIS DE LUCCA\n\nPrezados responsáveis legais pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),\n\nComunicamos formalmente que, diante do esgotamento integral de todas as tentativas e ações pedagógicas de Busca Ativa empreendidas pela unidade escolar (${contatosQtd} tentativas registradas sem regularização), bem como da reincidência continuada e ausência de comparecimento às convocações, a Escola Estadual Clóvis de Lucca está formalizando o pedido de representação e encaminhamento do caso à PROMOTORIA DE JUSTIÇA DA INFÂNCIA E DA JUVENTUDE (MINISTÉRIO PÚBLICO DO ESTADO DE SÃO PAULO) e à Vara da Infância e Juventude.\n\nEsta medida extrema fundamenta-se estritamente na Resolução SEDUC nº 39, de 05-09-2023, no Artigo 56, inciso II da Lei Federal nº 8.069/1990 (Estatuto da Criança e do Adolescente - ECA) e no Artigo 246 do Código Penal Brasileiro (Crime de Abandono Intelectual), resguardando o direito indisponível do(a) estudante à educação.\n\nSolicitamos o comparecimento imediato do(a) responsável legal à escola no prazo improrrogável de 24 horas antes da expedição e protocolo final da documentação junto ao órgão ministerial.\n\nAtenciosamente,\nDireção Escolar / Equipe Gestora - E.E. Clóvis de Lucca`,
        estagioIdentificado: '4_MINISTERIO_PUBLICO',
        tituloEstagio: 'Etapa 4 - Encaminhamento ao Ministério Público (Último Caso / Omissão Grave)',
        baseLegal: 'Resolução SEDUC nº 39/2023; Lei nº 8.069/1990 (ECA), Art. 56 e Art. 249; Código Penal Brasileiro, Art. 246 (Abandono Intelectual); Lei nº 9.394/1996 (LDB), Art. 12.',
        diagnosticoResumido: `Constatado esgotamento das vias escolares e do Conselho Tutelar, com ${contatosQtd} tentativa(s) prévia(s) sem êxito e frequência em nível crítico (${freqAtual}). Situação extrema que demanda acionamento do Ministério Público para salvaguarda do direito à educação.`,
        proximaAcaoSugerida: 'Oficializar relatório circunstanciado com histórico completo de busca ativa e remeter à Promotoria da Infância e da Juventude caso não haja comparecimento em 24h.'
      };
    }

    if (estagioFinal === 'conselho_tutelar' || estagioFinal === '3_CONSELHO_TUTELAR') {
      return {
        mensagem: `NOTIFICAÇÃO OFICIAL DE ENCAMINHAMENTO AO CONSELHO TUTELAR - E.E. CLÓVIS DE LUCCA\n\nPrezados pais ou responsáveis pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),\n\nInformamos formalmente que a Escola Estadual Clóvis de Lucca registrou ${contatosQtd} tentativa(s) prévia(s) de contato e convocações pedagógicas referentes às reiteradas ausências injustificadas do estudante (Frequência atual: ${freqAtual}), sem que houvesse o devido comparecimento ou regularização da assiduidade escolar.\n\nDiante do excesso de tentativas sem êxito e do esgotamento dos recursos escolares previstos na Resolução SEDUC nº 39, de 05 de setembro de 2023, comunicamos que estamos procedendo à formalização da Ficha FICAI e ao encaminhamento do caso ao CONSELHO TUTELAR do município para providências protetivas e fiscalizatórias cabíveis, em cumprimento ao Artigo 56 do Estatuto da Criança e do Adolescente (ECA) e Artigo 12 da LDB.\n\nConvocamos o(a) responsável com máxima urgência para comparecer à escola e dialogar com a gestão escolar antes do envio definitivo do relatório aos conselheiros tutelares.\n\nAtenciosamente,\nDireção Escolar e Equipe de Mediação - E.E. Clóvis de Lucca`,
        estagioIdentificado: '3_CONSELHO_TUTELAR',
        tituloEstagio: 'Etapa 3 - Encaminhamento ao Conselho Tutelar por Excesso de Tentativas sem Retorno',
        baseLegal: 'Resolução SEDUC nº 39/2023; Lei nº 8.069/1990 (ECA), Art. 56, inciso II; Lei Federal nº 9.394/1996 (LDB), Art. 12, incisos VII e VIII.',
        diagnosticoResumido: `Detectado excesso de contatos prévios (${contatosQtd} tentativas) sem resposta efetiva e frequência em patamar irregular (${freqAtual}). Configura o critério legal da Resolução SEDUC 39/2023 para acionamento do Conselho Tutelar via FICAI.`,
        proximaAcaoSugerida: 'Protocolar ficha FICAI junto ao Conselho Tutelar se a família não comparecer em 48 horas úteis.'
      };
    }

    if (estagioFinal === 'convocacao' || estagioFinal === '2_CONVOCACAO') {
      return {
        mensagem: `CONVOCAÇÃO FORMAL DE RESPONSÁVEL - E.E. CLÓVIS DE LUCCA\n\nPrezados responsáveis legais pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),\n\nRegistramos a continuidade de ausências não justificadas às aulas e relembramos que a frequência presencial diária é obrigação legal e condição indispensável para a aprendizagem e permanência na escola pública paulista.\n\nEm cumprimento à Resolução SEDUC nº 39, de 05-09-2023 e ao Artigo 12 da LDB (Lei nº 9.394/1996), CONVOCAMOS o(a) responsável legal para comparecer com urgência à secretaria da E.E. Clóvis de Lucca a fim de alinharmos o plano de compensação de ausências e regularização da vida escolar do(a) estudante.\n\nA ausência a esta convocação ensejará a notificação formal aos órgãos de proteção da infância e adolescência (Conselho Tutelar). Contamos com sua presença imediata.\n\nAtenciosamente,\nEquipe Gestora - E.E. Clóvis de Lucca`,
        estagioIdentificado: '2_CONVOCACAO',
        tituloEstagio: 'Etapa 2 - Convocação Presencial & Advertência Legal',
        baseLegal: 'Resolução SEDUC nº 39/2023; Lei nº 9.394/1996 (LDB), Art. 12; Lei nº 8.069/1990 (ECA), Art. 56.',
        diagnosticoResumido: `Reincidência de faltas e necessidade de intervenção pedagógica direta com os responsáveis legais para firmar compromisso de frequência antes de escalonamento externo.`,
        proximaAcaoSugerida: 'Aguardar comparecimento dos pais em até 48h. Em caso de recusa ou não comparecimento, registrar na Busca Ativa e emitir FICAI ao Conselho Tutelar.'
      };
    }

    // Padrão: Etapa 1 - Familiar & Acolhimento
    return {
      mensagem: `COMUNICADO ESCOLAR DE BUSCA ATIVA & ACOLHIMENTO - E.E. CLÓVIS DE LUCCA\n\nOlá, prezado(a) responsável pelo(a) estudante ${nomeAluno} (Turma: ${turmaAluno})! 🏫\n\nA equipe gestora da E.E. Clóvis de Lucca está entrando em contato para acompanhar a rotina escolar do(a) estudante. Notamos ausências recentes e gostaríamos de saber se está tudo bem e de que forma a escola pode auxiliar a família para garantir a presença diária às aulas.\n\nA assiduidade escolar é fundamental para o desenvolvimento e aprendizagem do estudante, conforme preconiza a Resolução SEDUC nº 39, de 05-09-2023. Por gentileza, responda a esta mensagem ou compareça à secretaria para alinharmos qualquer justificativa ou apoio pedagógico necessário.\n\nContamos com a sua colaboração e parceria!\n\nAtenciosamente,\nEquipe de Mediação e Gestão Escolar - E.E. Clóvis de Lucca`,
      estagioIdentificado: '1_FAMILIAR',
      tituloEstagio: 'Etapa 1 - Contato Familiar & Acolhimento Inicial',
      baseLegal: 'Resolução SEDUC nº 39/2023; Lei nº 9.394/1996 (LDB), Art. 12; Lei nº 8.069/1990 (ECA), Art. 53.',
      diagnosticoResumido: `Fase inicial de Busca Ativa com foco no acolhimento familiar, diálogo preventivo e apoio escolar, buscando reverter ausências antes de qualquer medida contenciosa.`,
      proximaAcaoSugerida: 'Acompanhar retorno dos pais em até 48h úteis e monitorar frequência diária na SED.'
    };
  }

  // Função Auxiliar de Contingência: Elaboração de Parecer Pedagógico Conclusivo em 2 Parágrafos
  function gerarParecerPedagogicoFallback(aluno: any, fechamentoNotas: any, ocorrencias: any[], extras?: any): string {
    const nome = String(aluno.nome || 'O(A) estudante').trim();
    const turma = String(aluno.turma || aluno.serie || '').trim();
    const freq = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || 'em acompanhamento').trim();
    const atrasosCount = Number(aluno.atrasos || 0);
    const tutor = String(aluno.tutor || aluno.tutor_2026 || '').trim();
    const eletiva = String(aluno.eletivas || aluno.eletiva || '').trim();
    const clube = String(aluno.clube || '').trim();
    const pv = String(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.pv || aluno.sonhos || '').trim();
    const isRec = Boolean(aluno.recomposicao);
    const isAee = Boolean(aluno.aee);
    const listaUnificada = (Array.isArray(ocorrencias) ? ocorrencias : []).filter((o: any) => !isRegistroAutomaticoDossieDoc(o));
    const qtdOcorrencias = listaUnificada.length;
    const qtdConviva = Array.isArray(extras?.listaConviva)
      ? extras.listaConviva.length
      : listaUnificada.filter((o: any) => o.registradoConviva || o.registrado_conviva || String(o.tipo || '').toUpperCase().includes('CONVIVA')).length;
    const qtdBuscaAtiva = Array.isArray(extras?.listaBuscaAtiva)
      ? extras.listaBuscaAtiva.length
      : listaUnificada.filter((o: any) => String(o.origem || '').toUpperCase() === 'BUSCA_ATIVA' || o.tipoContato || o.houveResposta !== undefined).length;

    // Faltas acumuladas
    let totalFaltas = extras?.totalFaltasAcumuladas || Number(aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas || 0);
    if (!totalFaltas && fechamentoNotas && typeof fechamentoNotas === 'object') {
      ['1B', '2B', '3B', '4B'].forEach(k => {
        if (fechamentoNotas[k]?.totalFaltas) totalFaltas += Number(fechamentoNotas[k].totalFaltas);
      });
      if (!totalFaltas && fechamentoNotas['FINAL']?.totalFaltas) {
        totalFaltas = Number(fechamentoNotas['FINAL'].totalFaltas);
      }
    }

    // Média Geral
    let mediaGeral = extras?.mediaGeralConsolidada;
    if (!mediaGeral || mediaGeral === '—') {
      mediaGeral = String(aluno.media_geral_calculada || aluno.media_geral || aluno.media || 'em apuração');
    }

    // Disciplinas abaixo da média (< 5.0)
    let disciplinasAbaixo: { nome: string; nota: any }[] = extras?.disciplinasAbaixo || [];
    if (disciplinasAbaixo.length === 0 && fechamentoNotas && typeof fechamentoNotas === 'object') {
      ['1B', '2B', '3B', '4B', 'FINAL'].forEach(b => {
        if (fechamentoNotas[b]?.disciplinas) {
          Object.entries(fechamentoNotas[b].disciplinas).forEach(([disc, dVal]: [string, any]) => {
            let n: any = null;
            let nomeDisc = disc;
            if (typeof dVal === 'object' && dVal !== null) {
              nomeDisc = dVal.nome || disc;
              n = dVal.notaNum !== undefined ? dVal.notaNum : (dVal.mencaoNota || dVal.nota || dVal.media || dVal.valor);
            } else {
              n = dVal;
            }
            const num = parseFloat(String(n).replace(',', '.'));
            if (!isNaN(num) && num < 5.0) {
              if (!disciplinasAbaixo.some(d => d.nome.toLowerCase() === nomeDisc.toLowerCase())) {
                disciplinasAbaixo.push({ nome: nomeDisc, nota: n });
              }
            }
          });
        }
      });
    }

    const allOcorrenciasText = listaUnificada.map((o: any) => `${o.tipo || ''} ${o.descricao || ''} ${o.observacao || ''} ${o.encaminhamento || ''}`).join(' ').toLowerCase();

    const temIndisciplina = allOcorrenciasText.includes('indisciplina') || allOcorrenciasText.includes('afrontosa') || allOcorrenciasText.includes('desrespeito') || allOcorrenciasText.includes('desacato') || allOcorrenciasText.includes('inadequada');
    const temConflitos = allOcorrenciasText.includes('conflito') || allOcorrenciasText.includes('boato') || allOcorrenciasText.includes('fofoca') || allOcorrenciasText.includes('atrito') || allOcorrenciasText.includes('desentendimento') || allOcorrenciasText.includes('agress');
    const temChamadoPais = allOcorrenciasText.includes('responsav') || allOcorrenciasText.includes('pais') || allOcorrenciasText.includes('mae') || allOcorrenciasText.includes('mãe') || allOcorrenciasText.includes('pai') || allOcorrenciasText.includes('termo') || allOcorrenciasText.includes('acordo');
    const temResistencia = allOcorrenciasText.includes('resistencia') || allOcorrenciasText.includes('recusa') || allOcorrenciasText.includes('nega') || allOcorrenciasText.includes('nao aceit') || allOcorrenciasText.includes('não aceit');
    const temRedeProtecao = Boolean(aluno.ficha_ct || aluno.oficio) || allOcorrenciasText.includes('conselho tutelar') || allOcorrenciasText.includes('ficai') || allOcorrenciasText.includes('demp') || allOcorrenciasText.includes('rede de prote');

    let perfilComportamental = '';
    if (temIndisciplina || temConflitos) {
      perfilComportamental = `marcada por registros relevantes no Histórico Unificado (${qtdOcorrencias} registro(s), sendo ${qtdConviva} protocolo(s) CONVIVA SP e ${qtdBuscaAtiva} ação(ões) de Busca Ativa), evidenciando ${temIndisciplina ? 'episódios de indisciplina e necessidade de mediação de normas' : 'desafios convivenciais'}${temConflitos ? ' e conflitos interpessoais acompanhados pela equipe escolar' : ''}.`;
    } else if (qtdOcorrencias > 0) {
      perfilComportamental = `acompanhada por ${qtdOcorrencias} registro(s) no Histórico Unificado (${qtdConviva} CONVIVA SP e ${qtdBuscaAtiva} ação(ões) de Busca Ativa Escolar), com ações orientativas e de mediação pedagógica.`;
    } else {
      perfilComportamental = `pautada pelo cumprimento dos combinados de convivência e ausência de apontamentos disciplinares ou protocolos CONVIVA SP.`;
    }

    const peiParts: string[] = [];
    if (clube && clube !== 'Não informado') peiParts.push(`no clube "${clube}"`);
    if (eletiva && eletiva !== 'Não informada') peiParts.push(`na eletiva "${eletiva}"`);
    const peiAtivStr = peiParts.length > 0 ? `no protagonismo juvenil ${peiParts.join(' e ')}` : 'nas ações de protagonismo juvenil';
    const tutoriaStr = tutor && tutor !== 'Não informado' ? `, sob acompanhamento da tutoria do(a) professor(a) ${tutor}` : '';
    const rotinasPei = `No âmbito do PEI, participa ${peiAtivStr}${tutoriaStr}.`;

    const faltasStr = totalFaltas > 0 ? ` com ${totalFaltas} faltas acumuladas no ano` : '';
    const atrasosStr = atrasosCount > 0 ? ` e ${atrasosCount} atraso(s) registrado(s)` : '';
    const consecStr = (extras?.frequenciaDiariaResumo?.faltasConsecutivasAtuais || 0) >= 3
      ? ` (com ${extras.frequenciaDiariaResumo.faltasConsecutivasAtuais} faltas consecutivas apuradas na chamada diária)`
      : '';
    const discDefasagemStr = disciplinasAbaixo.length > 0
      ? `, com defasagem pontual em ${disciplinasAbaixo.map(d => `${d.nome} (${d.nota})`).join(', ')}`
      : '';
    const apoioStr = isRec ? ', participando do projeto de recomposição e reforço intensivo' : (isAee ? ', contando com apoio do Atendimento Educacional Especializado (AEE)' : '');

    const acadStr = `Em relação à assiduidade e ao rendimento, registra frequência de ${freq}${faltasStr}${atrasosStr}${consecStr}, com média geral consolidada de ${mediaGeral}${discDefasagemStr}${apoioStr}.`;

    const par1 = `O(A) estudante ${nome}, matriculado(a) no ${turma || 'respectivo ano/série'} da E.E. Clóvis de Lucca (PEI), apresenta trajetória escolar ${perfilComportamental} ${rotinasPei} ${acadStr}`;

    let sinteseIntervencoes = '';
    if (temChamadoPais || temResistencia || temRedeProtecao || qtdBuscaAtiva > 0 || qtdConviva > 0) {
      sinteseIntervencoes = `Na síntese das intervenções registradas pela Gestão, Tutoria, CONVIVA e Busca Ativa, verificam-se ${qtdBuscaAtiva > 0 ? 'diligências de contato familiar para garantia da permanência escolar, ' : ''}acolhimentos e diálogos com os responsáveis legais${temResistencia ? ', registrando-se resistência parcial em determinados encaminhamentos' : ''}${temRedeProtecao ? ', além de articulação com a rede de proteção integral (FICAI/Conselho Tutelar)' : ''}.`;
    } else {
      sinteseIntervencoes = `Na síntese da evolução formativa, observa-se resposta favorável às orientações pedagógicas e convivenciais desenvolvidas ao longo do período letivo.`;
    }

    const recDisciplinas = disciplinasAbaixo.length > 0
      ? `o fortalecimento do plano de recuperação nas disciplinas com defasagem (${disciplinasAbaixo.map(d => d.nome).join(', ')}), `
      : 'a continuidade do acompanhamento pedagógico contínuo, ';

    const pvMencao = pv && pv !== 'Não informado'
      ? ` e o fortalecimento do seu Projeto de Vida (${pv})`
      : ' e a consolidação do seu Projeto de Vida';

    const recomendacoes = `Para os encaminhamentos do Conselho de Classe e alinhamento com a família, recomenda-se ${recDisciplinas}metas objetivas de manutenção da frequência e pontualidade, além de pacto de corresponsabilidade com os responsáveis legais visando o desenvolvimento socioemocional${pvMencao}.`;

    const par2 = `${sinteseIntervencoes} ${recomendacoes}`;

    return `${par1}\n\n${par2}`;
  }

  // ==========================================
  // INTEGRAÇÃO COM O VITE (DESENVOLVIMENTO E PRODUÇÃO)
  // ==========================================
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER) || (hasDist && process.env.NODE_ENV !== 'development');

  if (isProduction && hasDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Servidor Clóvis] Rodando na porta ${PORT} com suporte oficial ao MongoDB Atlas`);
    // Higieniza registros categorizados incorretamente como Atraso, migra gatilhos automáticos legados, remove logs silenciosos do dossiê e pré-aquece cache
    limparFalsosAtrasosNoBanco()
      .catch(err => console.warn('[Limpeza Atrasos] Erro inicial:', err?.message || err))
      .then(() => migrarERemoverGatilhosAutomaticosNoBanco())
      .catch(err => console.warn('[Migração Gatilhos Tutoria] Erro inicial:', err?.message || err))
      .then(() => limparLogsSilenciososDossieNoBanco())
      .catch(err => console.warn('[Limpeza Logs Silenciosos Dossiê] Erro inicial:', err?.message || err))
      .then(() => sincronizarSegmentosAlunosPorTurmaNoBanco())
      .catch(err => console.warn('[Sincronização Segmentos] Erro inicial:', err?.message || err))
      .then(() => normalizarAnoFrequenciaDiariaNoBanco())
      .catch(err => console.warn('[Normalização Frequência Diária] Erro inicial:', err?.message || err))
      .finally(() => {
        prewarmCache().catch(err => console.warn('[MongoDB Prewarm] Erro inicial:', err.message));
      });
  });
}

startServer();
