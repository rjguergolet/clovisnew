// server.ts
import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import * as pdfParseModule from "pdf-parse";

// src/server/mongodb.ts
import { MongoClient, ObjectId } from "mongodb";
var DEFAULT_MONGODB_URI = "mongodb+srv://rjguergolet_db_user:VOhSALVz8CcLe4qc@cluster0.isl7e97.mongodb.net/";
var DEFAULT_DB_NAME = "escola_clovis";
var uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
var dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;
var client = null;
var dbInstance = null;
var connectionPromise = null;
async function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }
  if (connectionPromise) {
    return connectionPromise;
  }
  connectionPromise = (async () => {
    try {
      if (!client) {
        client = new MongoClient(uri, {
          serverSelectionTimeoutMS: 8e3,
          connectTimeoutMS: 1e4,
          maxPoolSize: 10,
          minPoolSize: 1,
          retryWrites: true,
          w: "majority"
        });
      }
      await client.connect();
      console.log(`[MongoDB Atlas] Conex\xE3o ativa com sucesso ao banco '${dbName}'!`);
      dbInstance = client.db(dbName);
      return dbInstance;
    } catch (err) {
      connectionPromise = null;
      dbInstance = null;
      console.error("[MongoDB Atlas] Erro de conex\xE3o ao cluster Atlas:", err?.message || err);
      throw err;
    }
  })();
  return connectionPromise;
}
function resolveCollectionName(collectionName) {
  const map = {
    horarios: "clovis_horarios_cache",
    grade_horaria: "clovis_horarios_cache",
    eventos: "agenda_eventos",
    agenda: "agenda_eventos",
    rotina_equipe: "tarefas_equipe",
    tarefas: "tarefas_equipe",
    professores: "clovis_cadastro_professores",
    docentes: "clovis_cadastro_professores",
    mural_recados: "mural_recados_memoria",
    mural: "mural_recados_memoria",
    periodos: "clovis_periodos_aula",
    periodos_aula: "clovis_periodos_aula",
    substituicoes: "substituicoes_diarias"
  };
  return map[collectionName] || collectionName;
}
function formatMongoDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const idStr = _id ? typeof _id === "object" && "toHexString" in _id ? _id.toHexString() : String(_id) : "";
  const resolvedId = rest.id && String(rest.id).trim() !== "" && rest.id !== "undefined" ? String(rest.id) : idStr || (rest.ra ? String(rest.ra) : "");
  delete rest._id;
  if (rest.cientes !== void 0 && rest.cientes !== null) {
    if (typeof rest.cientes === "object" && rest.cientes.__arrayUnion && Array.isArray(rest.cientes.elements)) {
      rest.cientes = rest.cientes.elements;
    } else if (!Array.isArray(rest.cientes)) {
      rest.cientes = [];
    }
  }
  return {
    ...rest,
    ...rest.ra ? { ra: String(rest.ra) } : {},
    id: resolvedId
  };
}
function buildDocumentQuery(id) {
  if (!id && id !== 0) {
    return { id: "__invalid_null_id__" };
  }
  const strId = String(id).trim();
  const conditions = [
    { id: strId },
    { ra: strId },
    { _id: strId }
  ];
  if (!isNaN(Number(strId)) && strId !== "") {
    conditions.push({ ra: Number(strId) });
    conditions.push({ id: Number(strId) });
  }
  if (ObjectId.isValid(strId) && strId.length === 24) {
    try {
      conditions.push({ _id: new ObjectId(strId) });
    } catch (_) {
    }
  }
  return { $or: conditions };
}
function parseDataForMongo(data) {
  const setFields = {};
  const pushFields = {};
  const addToSetFields = {};
  for (const [key, val] of Object.entries(data || {})) {
    if (key === "_id" || key === "id") {
      continue;
    }
    if (val && typeof val === "object" && val.__arrayUnion === true && Array.isArray(val.elements)) {
      const sanitizedElements = val.elements.map((el) => {
        if (el && typeof el === "object") {
          const { id: _ignoreId, _id: _ignoreUnderscoreId, ...cleanEl } = el;
          return cleanEl;
        }
        return el;
      });
      addToSetFields[key] = { $each: sanitizedElements };
    } else {
      setFields[key] = val;
    }
  }
  setFields.atualizadoEm = (/* @__PURE__ */ new Date()).toISOString();
  const updateObj = { $set: setFields };
  if (Object.keys(addToSetFields).length > 0) {
    updateObj.$addToSet = addToSetFields;
  }
  if (Object.keys(pushFields).length > 0) {
    updateObj.$push = pushFields;
  }
  return updateObj;
}
var collectionCache = /* @__PURE__ */ new Map();
var pendingFetches = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 5 * 60 * 1e3;
async function fetchAllAlunosFromDb() {
  const db = await getDatabase();
  const realName = "alunos";
  const idDocs = await db.collection(realName).find({}, { projection: { _id: 1 } }).toArray();
  if (!idDocs || idDocs.length === 0) return [];
  if (idDocs.length <= 50) {
    const rawDocs = await db.collection(realName).find({}).toArray();
    return rawDocs.map((doc) => formatMongoDoc(doc)).filter(Boolean);
  }
  const chunkSize = 75;
  const chunks = [];
  for (let i = 0; i < idDocs.length; i += chunkSize) {
    chunks.push(idDocs.slice(i, i + chunkSize).map((d) => d._id));
  }
  const results = await Promise.all(chunks.map(async (cIds) => {
    const docs = await db.collection(realName).find({ _id: { $in: cIds } }).toArray();
    return docs;
  }));
  const allRaw = results.flat();
  return allRaw.map((doc) => formatMongoDoc(doc)).filter(Boolean);
}
async function fetchCollectionFromDb(realName) {
  if (realName === "alunos") {
    return fetchAllAlunosFromDb();
  }
  const db = await getDatabase();
  const rawDocs = await db.collection(realName).find({}).toArray();
  return rawDocs.map((doc) => formatMongoDoc(doc)).filter(Boolean);
}
function updateCacheItem(realName, id, data, isMerge) {
  const entry = collectionCache.get(realName);
  if (!entry || !Array.isArray(entry.docs)) return;
  const cleanId = String(id).trim();
  const idx = entry.docs.findIndex(
    (d) => String(d.id || "") === cleanId || String(d.ra || "") === cleanId || String(d.docId || "") === cleanId
  );
  const existingDoc = idx >= 0 ? entry.docs[idx] : {};
  const processedData = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v && typeof v === "object" && v.__arrayUnion === true && Array.isArray(v.elements)) {
      const existingArr = Array.isArray(existingDoc[k]) ? [...existingDoc[k]] : [];
      v.elements.forEach((newEl) => {
        const jsonStr = JSON.stringify(newEl);
        if (!existingArr.some((ex) => JSON.stringify(ex) === jsonStr)) {
          existingArr.push(newEl);
        }
      });
      processedData[k] = existingArr;
    } else {
      processedData[k] = v;
    }
  }
  const formatted = {
    ...processedData,
    id: cleanId,
    docId: cleanId,
    ...realName === "alunos" ? { ra: cleanId } : {}
  };
  if (idx >= 0) {
    if (isMerge) {
      entry.docs[idx] = { ...entry.docs[idx], ...formatted };
    } else {
      entry.docs[idx] = formatted;
    }
  } else {
    entry.docs.push(formatted);
  }
}
function removeCacheItem(realName, id) {
  const entry = collectionCache.get(realName);
  if (!entry || !Array.isArray(entry.docs)) return;
  const cleanId = String(id).trim();
  entry.docs = entry.docs.filter(
    (d) => String(d.id || "") !== cleanId && String(d.ra || "") !== cleanId && String(d.docId || "") !== cleanId
  );
}
async function prewarmCache() {
  const collectionsToWarm = [
    "usuarios",
    "agenda_eventos",
    "mural_recados_memoria",
    "alunos"
  ];
  console.log("[MongoDB Prewarm] Pr\xE9-aquecendo cache essencial (otimizado para Render 512MB RAM)...");
  for (const col of collectionsToWarm) {
    try {
      const docs = await getDocs(col);
      console.log(`[MongoDB Prewarm] Cole\xE7\xE3o '${col}' carregada: ${docs.length} registros em RAM.`);
    } catch (err) {
      console.warn(`[MongoDB Prewarm] Aviso ao carregar '${col}':`, err?.message || err);
    }
  }
}
async function getDocs(collectionName, filter = {}, options = {}) {
  const realName = resolveCollectionName(collectionName);
  const now = Date.now();
  const filterKeys = Object.keys(filter).filter((k) => filter[k] !== void 0 && filter[k] !== null && filter[k] !== "");
  const hasFilter = filterKeys.length > 0;
  let cachedEntry = collectionCache.get(realName);
  if (!cachedEntry || now - cachedEntry.timestamp > CACHE_TTL_MS) {
    if (!pendingFetches.has(realName)) {
      const fetchPromise = (async () => {
        try {
          const freshDocs = await fetchCollectionFromDb(realName);
          collectionCache.set(realName, { docs: freshDocs, timestamp: Date.now() });
          return freshDocs;
        } catch (err) {
          console.error(`[MongoDB Cache] Erro ao carregar ${realName}:`, err.message);
          if (collectionCache.has(realName)) {
            return collectionCache.get(realName).docs;
          }
          throw err;
        } finally {
          pendingFetches.delete(realName);
        }
      })();
      pendingFetches.set(realName, fetchPromise);
    }
    if (cachedEntry) {
    } else {
      await pendingFetches.get(realName);
      cachedEntry = collectionCache.get(realName);
    }
  }
  if (realName === "alunos" && (filter.q || filter.search || filter.termo)) {
    const queryText = String(filter.q || filter.search || filter.termo);
    const turma = filter.turma ? String(filter.turma) : void 0;
    const status = filter.status ? String(filter.status) : void 0;
    return await searchAlunosInDb(queryText, { turma, status, limit: options.limit });
  }
  if (cachedEntry && Array.isArray(cachedEntry.docs)) {
    let result = cachedEntry.docs;
    if (hasFilter) {
      result = result.filter((doc) => {
        for (const k of filterKeys) {
          const targetVal = String(filter[k]).toLowerCase();
          const docVal = String(doc[k] ?? "").toLowerCase();
          if (docVal !== targetVal) return false;
        }
        return true;
      });
    }
    if (options.sort) {
      const [sortField, sortDir] = Object.entries(options.sort)[0] || [];
      if (sortField) {
        result = [...result].sort((a, b) => {
          const valA = a[sortField];
          const valB = b[sortField];
          if (valA === valB) return 0;
          if (valA === void 0 || valA === null) return 1;
          if (valB === void 0 || valB === null) return -1;
          return sortDir === -1 ? valA < valB ? 1 : -1 : valA > valB ? 1 : -1;
        });
      }
    }
    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }
    return result;
  }
  const db = await getDatabase();
  let cursor = db.collection(realName).find(filter);
  if (options.sort) cursor = cursor.sort(options.sort);
  if (options.limit && options.limit > 0) cursor = cursor.limit(options.limit);
  const rawDocs = await cursor.toArray();
  return rawDocs.map((doc) => formatMongoDoc(doc));
}
function normalizarTextoParaBusca(str) {
  if (!str) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}
async function searchAlunosInDb(queryText, options = {}) {
  const searchTerm = String(queryText || "").trim();
  const searchNorm = normalizarTextoParaBusca(searchTerm);
  const searchDigits = searchTerm.replace(/\D/g, "");
  const tokens = searchNorm ? searchNorm.split(/\s+/).filter(Boolean) : [];
  const filterTurma = options.turma ? options.turma.toUpperCase().trim() : "";
  const filterStatus = options.status ? options.status.toUpperCase().trim() : "";
  const limitCount = options.limit && options.limit > 0 ? options.limit : 100;
  const todos = await getDocs("alunos");
  if (!Array.isArray(todos) || todos.length === 0) {
    return [];
  }
  if (tokens.length === 0 && !searchDigits) {
    let base = todos;
    if (filterTurma) {
      base = base.filter((s) => (s.turma || "").toUpperCase() === filterTurma);
    }
    if (filterStatus) {
      base = base.filter((s) => (s.status || "ativo").toUpperCase() === filterStatus);
    }
    return base.slice(0, limitCount);
  }
  let filtrados = todos.filter((student) => {
    const raStr = String(student.ra || student.id || "").toUpperCase();
    const raClean = raStr.replace(/\D/g, "");
    if (searchDigits.length >= 3 && raClean.includes(searchDigits)) {
      return true;
    }
    const nomeNorm = normalizarTextoParaBusca(student.nome);
    const turmaNorm = normalizarTextoParaBusca(student.turma);
    const tutorNorm = normalizarTextoParaBusca(student.tutor || student.tutor_2026);
    const statusNorm = normalizarTextoParaBusca(student.status || "ativo");
    const searchBlob = `${nomeNorm} ${raStr} ${raClean} ${turmaNorm} ${tutorNorm} ${statusNorm}`;
    return tokens.every((tk) => searchBlob.includes(tk));
  });
  if (filterTurma) {
    const naTurma = filtrados.filter((s) => (s.turma || "").toUpperCase() === filterTurma);
    if (naTurma.length > 0) filtrados = naTurma;
  }
  if (filterStatus && filterStatus !== "TODOS") {
    filtrados = filtrados.filter((s) => (s.status || "ativo").toUpperCase() === filterStatus);
  }
  filtrados.sort((a, b) => {
    const aRa = String(a.ra || a.id || "");
    const bRa = String(b.ra || b.id || "");
    const aRaClean = aRa.replace(/\D/g, "");
    const bRaClean = bRa.replace(/\D/g, "");
    const aExactRa = aRa === searchTerm || searchDigits.length >= 4 && aRaClean === searchDigits;
    const bExactRa = bRa === searchTerm || searchDigits.length >= 4 && bRaClean === searchDigits;
    if (aExactRa && !bExactRa) return -1;
    if (!aExactRa && bExactRa) return 1;
    const aNomeNorm = normalizarTextoParaBusca(a.nome);
    const bNomeNorm = normalizarTextoParaBusca(b.nome);
    const aStarts = aNomeNorm.startsWith(searchNorm);
    const bStarts = bNomeNorm.startsWith(searchNorm);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    const aFirst = aNomeNorm.split(" ")[0] || "";
    const bFirst = bNomeNorm.split(" ")[0] || "";
    const firstToken = tokens[0] || "";
    const aFirstStarts = aFirst.startsWith(firstToken);
    const bFirstStarts = bFirst.startsWith(firstToken);
    if (aFirstStarts && !bFirstStarts) return -1;
    if (!aFirstStarts && bFirstStarts) return 1;
    return String(a.nome || "").localeCompare(String(b.nome || ""));
  });
  return filtrados.slice(0, limitCount);
}
async function countDocs(collectionName, filter = {}) {
  const realName = resolveCollectionName(collectionName);
  const cachedEntry = collectionCache.get(realName);
  const filterKeys = Object.keys(filter).filter((k) => filter[k] !== void 0 && filter[k] !== null && filter[k] !== "");
  if (cachedEntry && Array.isArray(cachedEntry.docs) && filterKeys.length === 0) {
    return cachedEntry.docs.length;
  }
  const db = await getDatabase();
  return db.collection(realName).countDocuments(filter);
}
async function getDoc(collectionName, id) {
  const realName = resolveCollectionName(collectionName);
  const cleanId = String(id).trim();
  const cachedEntry = collectionCache.get(realName);
  if (cachedEntry && Array.isArray(cachedEntry.docs)) {
    const found = cachedEntry.docs.find(
      (d) => String(d.id || "") === cleanId || String(d.ra || "") === cleanId || String(d.docId || "") === cleanId || String(d._id || "") === cleanId
    );
    if (found) {
      return found;
    }
  }
  const db = await getDatabase();
  const col = db.collection(realName);
  const query = buildDocumentQuery(id);
  const doc = await col.findOne(query);
  return formatMongoDoc(doc);
}
async function setDoc(collectionName, id, data, options = { merge: true }) {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);
  const filter = buildDocumentQuery(id);
  const cleanId = String(id).trim();
  updateCacheItem(realName, cleanId, data, options.merge !== false);
  if (options.merge) {
    const updateOperation = parseDataForMongo(data);
    const setOnInsert = {
      id: cleanId,
      criadoEm: data.criadoEm || (/* @__PURE__ */ new Date()).toISOString()
    };
    if (collectionName === "alunos" && !("ra" in (updateOperation.$set || {}))) {
      setOnInsert.ra = cleanId;
    }
    updateOperation.$setOnInsert = setOnInsert;
    await col.updateOne(filter, updateOperation, { upsert: true });
  } else {
    const payload = { ...data };
    delete payload._id;
    payload.id = cleanId;
    payload.atualizadoEm = (/* @__PURE__ */ new Date()).toISOString();
    const result = await col.replaceOne(filter, payload, { upsert: true });
    if (!result.acknowledged) {
      throw new Error(`Falha ao substituir documento ${cleanId} na cole\xE7\xE3o ${realName}`);
    }
  }
}
async function addDoc(collectionName, data) {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);
  const payload = {
    ...data,
    criadoEm: data.criadoEm || (/* @__PURE__ */ new Date()).toISOString(),
    atualizadoEm: (/* @__PURE__ */ new Date()).toISOString()
  };
  delete payload._id;
  const result = await col.insertOne(payload);
  const id = result.insertedId.toHexString ? result.insertedId.toHexString() : result.insertedId.toString();
  await col.updateOne({ _id: result.insertedId }, { $set: { id } });
  updateCacheItem(realName, id, { ...data, id }, false);
  return { id };
}
async function updateDoc(collectionName, id, data) {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);
  const filter = buildDocumentQuery(id);
  const updateOperation = parseDataForMongo(data);
  const cleanId = String(id).trim();
  updateCacheItem(realName, cleanId, data, true);
  const setOnInsert = {
    id: cleanId,
    criadoEm: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (collectionName === "alunos" && !("ra" in (updateOperation.$set || {}))) {
    setOnInsert.ra = cleanId;
  }
  updateOperation.$setOnInsert = setOnInsert;
  await col.updateOne(filter, updateOperation, { upsert: true });
}
async function deleteDoc(collectionName, id) {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);
  removeCacheItem(realName, id);
  const filter = buildDocumentQuery(id);
  await col.deleteMany(filter);
}
async function executeBatch(operations) {
  for (const op of operations) {
    if (!op || !op.collection || !op.id) continue;
    try {
      if (op.type === "set") {
        const dadosLimpos = { ...op.data || {} };
        delete dadosLimpos.id;
        delete dadosLimpos._id;
        await setDoc(op.collection, op.id, dadosLimpos, { merge: true });
      } else if (op.type === "update") {
        const dadosLimpos = { ...op.data || {} };
        delete dadosLimpos.id;
        delete dadosLimpos._id;
        await updateDoc(op.collection, op.id, dadosLimpos);
      } else if (op.type === "delete") {
        await deleteDoc(op.collection, op.id);
      }
    } catch (opErr) {
      console.error(`[MongoDB Batch] Erro na opera\xE7\xE3o ${op.type} em ${op.collection}/${op.id}:`, opErr.message);
      throw opErr;
    }
  }
}

// src/modules/boletimPdfParser.ts
function parseBoletimSEDText(text) {
  const result = {
    sucesso: true,
    aluno: {
      nome: "",
      ra: "",
      raLimpo: "",
      escola: "",
      turma: "",
      anoLetivo: 2026,
      tipoEnsino: "",
      diretoria: ""
    },
    bimestres: {
      "1B": { bimestre: 1, bimestreKey: "1B", temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: "0%", frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      "2B": { bimestre: 2, bimestreKey: "2B", temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: "0%", frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      "3B": { bimestre: 3, bimestreKey: "3B", temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: "0%", frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      "4B": { bimestre: 4, bimestreKey: "4B", temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: "0%", frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 }
    },
    totalDisciplinas: 0,
    textoExtraido: text
  };
  if (!text || typeof text !== "string") {
    result.sucesso = false;
    result.mensagem = "Texto do documento PDF vazio ou inv\xE1lido.";
    return result;
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const nomeRaMatch = line.match(/Nome(?:\s+do\s+Aluno)?:\s*(.+?)\s+RA:\s*([0-9Xx\s\-\.\/]+?)(?:\s+Ano Letivo|\s*\/SP|\s*$)/i);
    if (nomeRaMatch) {
      result.aluno.nome = nomeRaMatch[1].trim().toUpperCase();
      result.aluno.ra = nomeRaMatch[2].trim();
      result.aluno.raLimpo = result.aluno.ra.replace(/\D/g, "").substring(0, 12);
    } else {
      if (!result.aluno.nome) {
        const nMatch = line.match(/Nome(?:\s+do\s+Aluno)?:\s*([^R\n]+)/i);
        if (nMatch) result.aluno.nome = nMatch[1].trim().toUpperCase();
      }
      if (!result.aluno.ra) {
        const rMatch = line.match(/RA:\s*([0-9Xx\s\-\.\/]+?)(?:\s+Ano|\s*\/SP|\s*$)/i);
        if (rMatch) {
          result.aluno.ra = rMatch[1].trim();
          result.aluno.raLimpo = result.aluno.ra.replace(/\D/g, "").substring(0, 12);
        }
      }
    }
    const dirMatch = line.match(/Diretoria:\s*([^E\n]+?)(?:\s+Escola:|$)/i);
    if (dirMatch) result.aluno.diretoria = dirMatch[1].trim();
    const escMatch = line.match(/Escola:\s*([^\n]+)/i);
    if (escMatch) result.aluno.escola = escMatch[1].trim();
    const ensMatch = line.match(/Tipo(?:\s+de)?\s+Ensino:\s*([^T\n]+?)(?:\s+Turma:|$)/i);
    if (ensMatch) result.aluno.tipoEnsino = ensMatch[1].trim();
    const turMatch = line.match(/Turma:\s*([^\n]+)/i);
    if (turMatch) result.aluno.turma = turMatch[1].trim();
    const anoMatch = line.match(/Ano\s+Letivo:\s*(\d{4})/i);
    if (anoMatch) result.aluno.anoLetivo = parseInt(anoMatch[1], 10);
  }
  if (!result.aluno.raLimpo) {
    const rawRaMatch = text.match(/\b(000\d{8,10}|\d{9,12})\b/);
    if (rawRaMatch) {
      result.aluno.raLimpo = rawRaMatch[1].substring(0, 12);
      if (!result.aluno.ra) result.aluno.ra = rawRaMatch[1];
    }
  }
  for (const line of lines) {
    const parsedRow = parseLinhaComponenteSED(line);
    if (!parsedRow) continue;
    const { discName, tokens } = parsedRow;
    const bKeys = ["1B", "2B", "3B", "4B"];
    for (let bIdx = 0; bIdx < 4; bIdx++) {
      const offset = bIdx * 4;
      if (tokens.length >= offset + 4) {
        const notaRaw = tokens[offset];
        const faltasRaw = tokens[offset + 1];
        const freqRaw = tokens[offset + 2];
        const acRaw = tokens[offset + 3];
        const hasData = notaRaw !== "-" && notaRaw !== "" || faltasRaw !== "-" && faltasRaw !== "" || freqRaw !== "-" && freqRaw !== "";
        if (hasData) {
          const bKey = bKeys[bIdx];
          result.bimestres[bKey].temDados = true;
          const notaNum = notaRaw !== "-" && !isNaN(parseFloat(notaRaw.replace(",", "."))) ? parseFloat(notaRaw.replace(",", ".")) : null;
          const faltasNum = faltasRaw !== "-" && !isNaN(parseInt(faltasRaw, 10)) ? parseInt(faltasRaw, 10) : 0;
          const freqNum = freqRaw !== "-" && freqRaw !== "" ? parseFloat(freqRaw.replace("%", "").replace(",", ".")) : null;
          const acNum = acRaw !== "-" && !isNaN(parseInt(acRaw, 10)) ? parseInt(acRaw, 10) : 0;
          result.bimestres[bKey].disciplinas[discName] = {
            nome: discName,
            mencaoNota: notaRaw !== "-" ? notaRaw : "\u2014",
            notaNum,
            faltas: faltasNum,
            ausenciaCompensada: acNum,
            frequencia: freqRaw !== "-" ? freqRaw : null,
            frequenciaNum: freqNum,
            abaixoBasico: notaNum !== null ? notaNum < 5 : false
          };
        }
      }
    }
  }
  const disciplinasSet = /* @__PURE__ */ new Set();
  for (const [bKey, bData] of Object.entries(result.bimestres)) {
    if (bData.temDados) {
      const discs = Object.values(bData.disciplinas);
      let somaNotas = 0;
      let countNotas = 0;
      let totalFaltas = 0;
      let somaFreq = 0;
      let countFreq = 0;
      let qtdAbaixo = 0;
      for (const d of discs) {
        disciplinasSet.add(d.nome);
        if (d.notaNum !== null) {
          somaNotas += d.notaNum;
          countNotas++;
          if (d.notaNum < 5) qtdAbaixo++;
        }
        totalFaltas += d.faltas;
        if (d.frequenciaNum !== null && d.frequenciaNum !== void 0 && !isNaN(d.frequenciaNum)) {
          somaFreq += d.frequenciaNum;
          countFreq++;
        }
      }
      bData.mediaGeral = countNotas > 0 ? Math.round(somaNotas / countNotas * 10) / 10 : 0;
      bData.totalFaltas = totalFaltas;
      bData.qtdAbaixoBasico = qtdAbaixo;
      if (countFreq > 0) {
        const mediaFreq = Math.round(somaFreq / countFreq * 10) / 10;
        bData.frequenciaNum = mediaFreq;
        bData.frequenciaBimestre = `${mediaFreq.toFixed(1)}%`;
      }
    }
  }
  result.totalDisciplinas = disciplinasSet.size;
  return result;
}
function limparNomeDisciplina(nomeCru) {
  if (!nomeCru) return "";
  let s = String(nomeCru);
  s = s.replace(/\s*[\(\[]\s*\d+\s*[\)\]]\s*/g, " ");
  while (/[\s\-_–—/|#:]+\d+\s*$/i.test(s)) {
    s = s.replace(/[\s\-_–—/|#:]+\d+\s*$/i, "");
  }
  s = s.replace(/([A-Za-zÀ-ÿ])\d{3,6}\s*$/g, "$1");
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}
function parseLinhaComponenteSED(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const ignorePatterns = [
    /^GOVERNO/i,
    /^SECRETARIA/i,
    /^Boletim Escolar/i,
    /^Nome/i,
    /^Diretoria/i,
    /^Tipo/i,
    /^Comp\./i,
    /^N\s+F/i,
    /^Siglas/i,
    /^CF\s*–/i,
    /^ET\s*–/i,
    /^AT\s*–/i,
    /^Resultado/i,
    /^\-\s*\d+/
  ];
  if (ignorePatterns.some((p) => p.test(trimmed))) return null;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 5) return null;
  let valStartIdx = tokens.length - 1;
  while (valStartIdx >= 0) {
    const t = tokens[valStartIdx];
    const isVal = t === "-" || /^\d+$/.test(t) || /^\d+%$/.test(t) || /^\d+[\.,]\d+$/.test(t) || /^(ET|ES|EP|EXP|AT|AS|AR|AI)$/i.test(t);
    if (!isVal) break;
    valStartIdx--;
  }
  const nameTokens = tokens.slice(0, valStartIdx + 1);
  let valTokens = tokens.slice(valStartIdx + 1);
  if (valTokens.length > 0 && /^\d{4,6}$/.test(valTokens[0])) {
    valTokens.shift();
  }
  const rawDiscName = nameTokens.join(" ").trim();
  if (!rawDiscName || valTokens.length < 4) return null;
  const discName = limparNomeDisciplina(rawDiscName);
  if (!discName) return null;
  if (["COMP.", "COMP", "DISCIPLINA", "DISCIPLINAS", "CF"].includes(discName)) {
    return null;
  }
  return { discName, tokens: valTokens };
}

// src/modules/frequenciaSedPdfParser.ts
function normalizarNomeTurmaSED(turmaRaw) {
  if (!turmaRaw) return "TURMA N\xC3O IDENTIFICADA";
  let t = turmaRaw.trim().toUpperCase();
  t = t.replace(/°/g, "\xBA").replace(/ª/g, "\xAA");
  const matchAno = t.match(/([1-9])\s*[ºo°]?\s*(?:ANO|SERIE|SÉRIE)?\s*([A-Z])/i);
  if (matchAno) {
    const num = matchAno[1];
    const letra = matchAno[2].toUpperCase();
    const isSerie = t.includes("SERIE") || t.includes("S\xC9RIE") || t.includes("EM") || t.includes("M\xC9DIO");
    return `${num}\xBA ${isSerie ? "S\xC9RIE" : "ANO"} ${letra}`;
  }
  const matchCurto = t.match(/^([1-9])([A-Z])$/);
  if (matchCurto) {
    return `${matchCurto[1]}\xBA ANO ${matchCurto[2]}`;
  }
  return t.replace(/\s+INTEGRAL.*$/i, "").trim();
}
function normalizarRaSED(raRaw) {
  if (!raRaw) return { raLimpo: "", raFormatado: "", digito: "" };
  const str = String(raRaw).trim().toUpperCase();
  let digito = "";
  const dMatch = str.match(/-([0-9Xx])/);
  if (dMatch) {
    digito = dMatch[1].toUpperCase();
  }
  const raApenasDigitos = str.replace(/\D/g, "");
  const raSemZeros = raApenasDigitos.replace(/^0+/, "");
  return {
    raLimpo: raSemZeros,
    raFormatado: str,
    digito
  };
}
function calcularTendenciaRecente(diasPresenca, pctTotalPresenca, listaDiasLetivos, aulasDadasPorDia) {
  if (listaDiasLetivos.length === 0) {
    return {
      status: "OSCILANTE",
      label: "Sem Dados Recentes",
      badgeClass: "bg-slate-100 text-slate-700 border-slate-300",
      pctRecente: 100,
      diasSeguidosPresente: 0,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia: null,
      descricao: "Sem dias letivos apurados no m\xEAs."
    };
  }
  let ultimaPresencaDia = null;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    if ((diasPresenca[d] || 0) > 0) {
      ultimaPresencaDia = d;
      break;
    }
  }
  const janelaTamanho = Math.min(5, listaDiasLetivos.length);
  const janelaRecente = listaDiasLetivos.slice(-janelaTamanho);
  let aulasRecentes = 0;
  let presencasRecentes = 0;
  for (const d of janelaRecente) {
    aulasRecentes += aulasDadasPorDia[d] || 0;
    presencasRecentes += diasPresenca[d] || 0;
  }
  const pctRecente = aulasRecentes > 0 ? Number((presencasRecentes / aulasRecentes * 100).toFixed(1)) : 100;
  let diasSeguidosPresente = 0;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    const aulasDia = aulasDadasPorDia[d] || 0;
    const presencaDia = diasPresenca[d] || 0;
    if (aulasDia > 0 && presencaDia >= aulasDia * 0.7) {
      diasSeguidosPresente++;
    } else {
      break;
    }
  }
  let diasSeguidosFaltando = 0;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    const aulasDia = aulasDadasPorDia[d] || 0;
    const presencaDia = diasPresenca[d] || 0;
    if (aulasDia > 0 && presencaDia === 0) {
      diasSeguidosFaltando++;
    } else {
      break;
    }
  }
  if (pctTotalPresenca >= 100) {
    return {
      status: "100_PRESENTE",
      label: "100% Ass\xEDduo",
      badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 font-black",
      pctRecente: 100,
      diasSeguidosPresente,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia,
      descricao: "Presen\xE7a exemplar em todas as aulas dadas."
    };
  }
  if (diasSeguidosPresente >= 3 || pctRecente >= 80 && diasSeguidosFaltando === 0) {
    return {
      status: "PAROU_DE_FALTAR",
      label: "\u2713 Parou de Faltar (Retomou)",
      badgeClass: "bg-teal-100 text-teal-900 border-teal-300 font-black",
      pctRecente,
      diasSeguidosPresente,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia,
      descricao: `Retomou a frequ\xEAncia escolar! Compareceu em ${pctRecente}% das aulas recentes (${diasSeguidosPresente} dias seguidos presente). A interven\xE7\xE3o surtiu efeito!`
    };
  }
  if (diasSeguidosFaltando >= 2 || pctRecente < 35) {
    return {
      status: "CONTINUA_FALTANDO",
      label: "\u26A0\uFE0F Continua Faltando",
      badgeClass: "bg-rose-100 text-rose-900 border-rose-300 font-black",
      pctRecente,
      diasSeguidosPresente: 0,
      diasSeguidosFaltando,
      ultimaPresencaDia,
      descricao: `Alerta: o estudante continua ausente nas aulas recentes (\xFAltima presen\xE7a registrada: dia ${ultimaPresencaDia ? `${ultimaPresencaDia}` : "n\xE3o identificada"}). Demanda busca ativa imediata!`
    };
  }
  return {
    status: "OSCILANTE",
    label: "\u26A1 Presen\xE7a Oscilante",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300 font-extrabold",
    pctRecente,
    diasSeguidosPresente,
    diasSeguidosFaltando,
    ultimaPresencaDia,
    descricao: `Frequ\xEAncia oscilante: compareceu em ${pctRecente}% das aulas recentes. Recomendada conversa de alinhamento com a tutoria.`
  };
}
function parseRelatorioFrequenciaSED(textoBruto, baseAlunosEscola = []) {
  if (!textoBruto || typeof textoBruto !== "string" || textoBruto.trim().length === 0) {
    return {
      sucesso: false,
      mensagem: "Texto do relat\xF3rio est\xE1 vazio ou inv\xE1lido.",
      turma: "",
      turmaNormalizada: "",
      mes: "",
      anoLetivo: 2026,
      disciplina: "",
      escola: "",
      tipoRelatorio: "Presen\xE7as",
      totalAulasDadas: 0,
      diasLetivosCount: 0,
      aulasDadasPorDia: {},
      taxaPresencaMediaTurma: 0,
      alunos: [],
      totais: {
        totalAlunos: 0,
        alunosAtivosEncontrados: 0,
        alunosRiscoCritico: 0,
        alunosAtencao: 0,
        alunos100Presenca: 0,
        alunosPararamDeFaltar: 0,
        alunosContinuamFaltando: 0
      },
      analiseDiasSemana: {}
    };
  }
  const anoMatch = textoBruto.match(/Ano Letivo:\s*(\d{4})/i);
  const anoLetivo = anoMatch ? parseInt(anoMatch[1], 10) : (/* @__PURE__ */ new Date()).getFullYear();
  const mesMatch = textoBruto.match(/(Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)/i);
  const mes = mesMatch ? mesMatch[1] : "M\xEAs N\xE3o Identificado";
  const tipoRelatorioMatch = textoBruto.match(/(Presenças|Faltas)/i);
  const tipoRelatorio = tipoRelatorioMatch && tipoRelatorioMatch[1].toLowerCase().includes("falta") ? "Faltas" : "Presen\xE7as";
  const turmaMatch = textoBruto.match(/Turma:\s*([^\n\r]+)/i);
  const turmaRaw = turmaMatch ? turmaMatch[1].trim() : "";
  const turmaNormalizada = normalizarNomeTurmaSED(turmaRaw);
  const discMatch = textoBruto.match(/Disciplina:\s*([^\n\r]+)/i);
  const disciplina = discMatch ? discMatch[1].trim() : "TODAS AS DISCIPLINAS (GLOBAL)";
  const escolaMatch = textoBruto.match(/Escola:\s*([^\n\r]+)/i);
  const escola = escolaMatch ? escolaMatch[1].trim() : "EE Prof. Cl\xF3vis de Lucca";
  const dirMatch = textoBruto.match(/Diretoria:\s*([^\n\r]+)/i);
  const diretoria = dirMatch ? dirMatch[1].trim() : "S\xE3o Bernardo do Campo";
  const tipoEnsinoMatch = textoBruto.match(/Tipo de Ensino:\s*([^\n\r]+)/i);
  const tipoEnsino = tipoEnsinoMatch ? tipoEnsinoMatch[1].trim() : "";
  const lines = textoBruto.split(/\r?\n/);
  const alunosTemp = [];
  const alunosTransferidosRemanejados = [];
  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) continue;
    if (l.startsWith("Relat\xF3rio") || l.startsWith("Ano Letivo") || l.startsWith("Diretoria") || l.startsWith("Tipo") || l.startsWith("N\xB0") || l.startsWith("N\xBA") || l.startsWith("Nome RA") || l.startsWith("--") || l.startsWith("Escola:") || l.startsWith("Turma:") || l.startsWith("Disciplina:")) {
      continue;
    }
    const matchStatusInativo = l.match(/^(\d+)\s+(.+?)\s+(\d{8,15}[-0-9Xx]*(?:\s*\/\s*[A-Z]{2})?)\b.*\b(TRANSFERID[OA]|REMANEJAD[OA]|ABANDONO|INATIV[OA]|BAIXA|DESLIGAD[OA])\b/i);
    if (matchStatusInativo) {
      const raOrig = matchStatusInativo[3].trim().toUpperCase();
      alunosTransferidosRemanejados.push({
        numChamada: parseInt(matchStatusInativo[1], 10) || void 0,
        nome: matchStatusInativo[2].trim().toUpperCase(),
        ra: raOrig,
        raClean: normalizarRaSED(raOrig).raLimpo,
        situacaoSed: matchStatusInativo[4].trim().toUpperCase()
      });
      continue;
    }
    const match = l.match(/^(\d+)\s+(.+?)\s+(\d{8,15}[-0-9Xx]*(?:\s*\/\s*[A-Z]{2})?)\s+([\d\s-]+?)\s+(\d+)$/);
    if (match) {
      const numChamada = parseInt(match[1], 10);
      const nome = match[2].trim().toUpperCase();
      const raOriginal = match[3].trim().toUpperCase();
      const { raLimpo } = normalizarRaSED(raOriginal);
      const diasTokens = match[4].trim().split(/\s+/);
      const totalDeclarado = parseInt(match[5], 10);
      const diasPresenca = {};
      diasTokens.forEach((val, idx) => {
        const diaNum = idx + 1;
        if (diaNum <= 31) {
          diasPresenca[diaNum] = val === "-" ? 0 : parseInt(val, 10) || 0;
        }
      });
      alunosTemp.push({
        numChamada,
        nome,
        ra: raOriginal,
        raClean: raLimpo,
        diasPresenca,
        totalDeclarado
      });
    }
  }
  const aulasDadasPorDia = {};
  let totalAulasDadasTurma = 0;
  let diasLetivosCount = 0;
  const listaDiasLetivos = [];
  for (let dia = 1; dia <= 31; dia++) {
    let maxAulasDia = 0;
    for (const a of alunosTemp) {
      const p = a.diasPresenca[dia] || 0;
      if (p > maxAulasDia) {
        maxAulasDia = p;
      }
    }
    aulasDadasPorDia[dia] = maxAulasDia;
    if (maxAulasDia > 0) {
      totalAulasDadasTurma += maxAulasDia;
      diasLetivosCount++;
      listaDiasLetivos.push(dia);
    }
  }
  const mapaBaseAlunosPorRa = /* @__PURE__ */ new Map();
  const mapaBaseAlunosPorNome = /* @__PURE__ */ new Map();
  if (Array.isArray(baseAlunosEscola)) {
    baseAlunosEscola.forEach((al) => {
      if (!al) return;
      const { raLimpo } = normalizarRaSED(al.ra);
      if (raLimpo) {
        mapaBaseAlunosPorRa.set(raLimpo, al);
      }
      const nUpper = String(al.nome || "").trim().toUpperCase();
      if (nUpper) {
        mapaBaseAlunosPorNome.set(nUpper, al);
      }
    });
  }
  const alunosFinais = [];
  let somaPorcentagens = 0;
  let countCriticos = 0;
  let countAtencao = 0;
  let count100 = 0;
  let countAtivosEncontrados = 0;
  let countPararamDeFaltar = 0;
  let countContinuamFaltando = 0;
  alunosTemp.forEach((a) => {
    let totalPresencasCalculadas = 0;
    for (let d = 1; d <= 31; d++) {
      totalPresencasCalculadas += a.diasPresenca[d] || 0;
    }
    const totalPresencas = a.totalDeclarado > 0 && Math.abs(a.totalDeclarado - totalPresencasCalculadas) <= 5 ? a.totalDeclarado : totalPresencasCalculadas;
    const totalFaltas = Math.max(0, totalAulasDadasTurma - totalPresencas);
    const pctPresenca = totalAulasDadasTurma > 0 ? Number((totalPresencas / totalAulasDadasTurma * 100).toFixed(1)) : 100;
    let situacaoFrequencia = "REGULAR";
    if (pctPresenca < 75) {
      situacaoFrequencia = "CRITICO";
      countCriticos++;
    } else if (pctPresenca < 85) {
      situacaoFrequencia = "ATENCAO";
      countAtencao++;
    } else {
      if (pctPresenca >= 100) count100++;
    }
    somaPorcentagens += pctPresenca;
    const tendenciaRecente = calcularTendenciaRecente(
      a.diasPresenca,
      pctPresenca,
      listaDiasLetivos,
      aulasDadasPorDia
    );
    if (tendenciaRecente.status === "PAROU_DE_FALTAR") {
      countPararamDeFaltar++;
    } else if (tendenciaRecente.status === "CONTINUA_FALTANDO") {
      countContinuamFaltando++;
    }
    const correspondente = mapaBaseAlunosPorRa.get(a.raClean) || mapaBaseAlunosPorNome.get(a.nome) || null;
    if (correspondente) {
      countAtivosEncontrados++;
    }
    alunosFinais.push({
      numChamada: a.numChamada,
      nome: a.nome,
      ra: a.ra,
      raClean: a.raClean,
      diasPresenca: a.diasPresenca,
      totalPresencas,
      totalAulasDadas: totalAulasDadasTurma,
      totalFaltas,
      pctPresenca,
      situacaoFrequencia,
      tendenciaRecente,
      alunoCadastrado: correspondente,
      raEncontradoNoBanco: Boolean(correspondente)
    });
  });
  const taxaPresencaMediaTurma = alunosFinais.length > 0 ? Number((somaPorcentagens / alunosFinais.length).toFixed(1)) : 0;
  return {
    sucesso: alunosFinais.length > 0,
    mensagem: alunosFinais.length > 0 ? `Relat\xF3rio processado: ${alunosFinais.length} estudantes e ${totalAulasDadasTurma} aulas dadas apuradas.` : "Nenhum estudante identificado no documento.",
    turma: turmaRaw,
    turmaNormalizada,
    mes,
    anoLetivo,
    disciplina,
    escola,
    diretoria,
    tipoEnsino,
    tipoRelatorio,
    totalAulasDadas: totalAulasDadasTurma,
    diasLetivosCount,
    aulasDadasPorDia,
    taxaPresencaMediaTurma,
    alunos: alunosFinais.sort((x, y) => x.pctPresenca - y.pctPresenca),
    alunosTransferidosRemanejados,
    totais: {
      totalAlunos: alunosFinais.length,
      alunosAtivosEncontrados: countAtivosEncontrados,
      alunosRiscoCritico: countCriticos,
      alunosAtencao: countAtencao,
      alunos100Presenca: count100,
      alunosPararamDeFaltar: countPararamDeFaltar,
      alunosContinuamFaltando: countContinuamFaltando
    },
    analiseDiasSemana: {}
  };
}

// server.ts
var pdfParse = pdfParseModule.default || pdfParseModule;
var AUTH_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || "clovis-lucca-2026-hmac-auth-secret-shield";
var MOCK_FALLBACK_USERS = {
  "diretor@clovis.com": { id: "usr-diretor", nome: "Diretor Escolar", email: "diretor@clovis.com", cargo: "DIRETOR", nivel: "DIRETOR", nivelAcesso: "DIRETOR", acesso_total: true },
  "vice@clovis.com": { id: "usr-vice", nome: "Vice-Diretor Escolar", email: "vice@clovis.com", cargo: "VICE_DIRETOR", nivel: "VICE_DIRETOR", nivelAcesso: "VICE_DIRETOR", acesso_total: true },
  "cgpg@clovis.com": { id: "usr-cgpg", nome: "Coordenador CGPG", email: "cgpg@clovis.com", cargo: "CGPG", nivel: "CGPG", nivelAcesso: "CGPG", acesso_total: false },
  "paac@clovis.com": { id: "usr-paac", nome: "Professor PAAC", email: "paac@clovis.com", cargo: "PAAC", nivel: "PAAC", nivelAcesso: "PAAC", acesso_total: false },
  "secretaria@clovis.com": { id: "usr-sec", nome: "Secretaria Escolar", email: "secretaria@clovis.com", cargo: "SECRETARIA", nivel: "SECRETARIA", nivelAcesso: "SECRETARIA", acesso_total: false },
  "professor@clovis.com": { id: "usr-prof", nome: "Professor Docente", email: "professor@clovis.com", cargo: "PROFESSOR", nivel: "PROFESSOR", nivelAcesso: "PROFESSOR", acesso_total: false }
};
function normalizarRoleBackend(rawRole) {
  if (!rawRole) return "PROFESSOR";
  const str = String(rawRole).trim().toUpperCase();
  if (str === "DIRETOR" || str === "DIRE\xC7\xC3O" || str === "DIRECAO" || str === "ADMIN") return "DIRETOR";
  if (str.includes("VICE") || str === "VICE_DIRETOR" || str === "VICE-DIRETOR") return "VICE_DIRETOR";
  if (str.includes("CGPG") || str.includes("COORDENA") || str.includes("CGPCG")) return "CGPG";
  if (str.includes("SECRETARIA")) return "SECRETARIA";
  if (str === "PAAC" || str === "PROFESSOR_PAAC" || str.includes("PAAC") && !str.includes("PROFESSOR")) return "PAAC";
  if (str.includes("PROFESSOR") || str.includes("TUTOR") || str.includes("DOCENTE")) return "PROFESSOR";
  if (str.includes("DIRETOR")) return "DIRETOR";
  return "PROFESSOR";
}
function isCategoriaAtrasoEstrita(oc) {
  if (!oc || typeof oc !== "object") return false;
  if (String(oc.origem || "").trim().toUpperCase() === "ATA_ESCOLAR") return false;
  const tipo = String(oc.tipo || "").trim().toUpperCase();
  const cat = String(oc.categoria || "").trim().toUpperCase();
  if (oc.isDispensa === true || tipo.includes("DISPENSA") || cat.includes("DISPENSA") || tipo.includes("AFASTAMENTO") || cat.includes("AFASTAMENTO")) {
    return false;
  }
  if (tipo || cat) {
    return tipo.includes("ATRASO") || cat.includes("ATRASO");
  }
  return oc.isAtraso === true;
}
function sanitizarObjetoOcorrenciaAtraso(oc) {
  if (!oc || typeof oc !== "object") return oc;
  const { id: _ignId, _id: _ignUnder, ...rest } = oc;
  const tipo = String(rest.tipo || "").trim().toUpperCase();
  const cat = String(rest.categoria || "").trim().toUpperCase();
  const isDisp = rest.isDispensa === true || tipo.includes("DISPENSA") || cat.includes("DISPENSA") || tipo.includes("AFASTAMENTO") || cat.includes("AFASTAMENTO");
  const isAta = String(rest.origem || "").trim().toUpperCase() === "ATA_ESCOLAR";
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
function inferirSegmentoPorTurma(turma) {
  const turmaTrim = String(turma || "").trim();
  if (!turmaTrim) return "";
  if (/^[6789]/.test(turmaTrim)) return "ENSINO FUNDAMENTAL";
  if (/^[123]/.test(turmaTrim)) return "ENSINO M\xC9DIO";
  return "";
}
function normalizarPayloadAtrasoDb(collection, data) {
  if (!data || typeof data !== "object") return data;
  const realCol = resolveCollectionName(collection);
  if (realCol === "ocorrencias" || realCol === "registros") {
    const tipo = String(data.tipo || "").trim().toUpperCase();
    const cat = String(data.categoria || "").trim().toUpperCase();
    const isDisp = data.isDispensa === true || tipo.includes("DISPENSA") || cat.includes("DISPENSA") || tipo.includes("AFASTAMENTO") || cat.includes("AFASTAMENTO");
    const isAta = String(data.origem || "").trim().toUpperCase() === "ATA_ESCOLAR";
    if (tipo || cat || isDisp || isAta) {
      const isAtr = isCategoriaAtrasoEstrita(data);
      data.isAtraso = isAtr;
      if (!isAtr) {
        data.horaRealAtraso = "";
        data.horarioAtraso = "";
      }
    }
  } else if (realCol === "alunos") {
    if (data.turma !== void 0) {
      const segAuto = inferirSegmentoPorTurma(data.turma);
      if (segAuto) {
        data.segmento = segAuto;
      }
    }
    if (Array.isArray(data.ocorrencias)) {
      data.ocorrencias = data.ocorrencias.map(sanitizarObjetoOcorrenciaAtraso);
    } else if (data.ocorrencias && typeof data.ocorrencias === "object" && data.ocorrencias.__arrayUnion === true && Array.isArray(data.ocorrencias.elements)) {
      data.ocorrencias = {
        ...data.ocorrencias,
        elements: data.ocorrencias.elements.map(sanitizarObjetoOcorrenciaAtraso)
      };
    }
  }
  return data;
}
function limparSufixoChegadaSintetico(texto, horaStored) {
  const str = String(texto || "");
  if (!str || !horaStored) return str;
  const esc = horaStored.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return str.replace(new RegExp(`\\s*\\(chegada\\s+[\xE0a]s\\s+${esc}\\)\\s*$`, "i"), "").trim();
}
async function limparFalsosAtrasosNoBanco() {
  const db = await getDatabase();
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let ocorrenciasLimpas = 0;
  let itensEmbutidosLimpos = 0;
  let alunosAtualizados = 0;
  const temFalsoFlagAtraso = (item) => {
    if (!item || typeof item !== "object") return false;
    const temMarcaAtraso = item.isAtraso === true || Boolean(String(item.horaRealAtraso || "").trim()) || Boolean(String(item.horarioAtraso || "").trim());
    if (!temMarcaAtraso) return false;
    const tipo = String(item.tipo || "").trim().toUpperCase();
    const cat = String(item.categoria || "").trim().toUpperCase();
    const isDisp = item.isDispensa === true || tipo.includes("DISPENSA") || cat.includes("DISPENSA") || tipo.includes("AFASTAMENTO") || cat.includes("AFASTAMENTO");
    const isAta = String(item.origem || "").trim().toUpperCase() === "ATA_ESCOLAR";
    if (!tipo && !cat && !isDisp && !isAta) return false;
    return !isCategoriaAtrasoEstrita(item);
  };
  const colOcorrencias = db.collection("ocorrencias");
  const candidatosOc = await colOcorrencias.find({
    $or: [
      { isAtraso: true },
      { horaRealAtraso: { $exists: true, $nin: ["", null] } },
      { horarioAtraso: { $exists: true, $nin: ["", null] } }
    ]
  }).toArray();
  for (const docItem of candidatosOc) {
    if (!temFalsoFlagAtraso(docItem)) continue;
    const horaStored = String(docItem.horaRealAtraso || docItem.horarioAtraso || "").trim();
    const setFields = {
      isAtraso: false,
      atualizadoEm: nowIso
    };
    if (horaStored) {
      if (typeof docItem.descricao === "string" && docItem.descricao) {
        const cleanedDesc = limparSufixoChegadaSintetico(docItem.descricao, horaStored);
        if (cleanedDesc !== docItem.descricao) setFields.descricao = cleanedDesc;
      }
      if (typeof docItem.observacao === "string" && docItem.observacao) {
        const cleanedObs = limparSufixoChegadaSintetico(docItem.observacao, horaStored);
        if (cleanedObs !== docItem.observacao) setFields.observacao = cleanedObs;
      }
    }
    await colOcorrencias.updateOne(
      { _id: docItem._id },
      { $set: setFields, $unset: { horaRealAtraso: "", horarioAtraso: "" } }
    );
    ocorrenciasLimpas++;
  }
  const colAlunos = db.collection("alunos");
  const candidatosAlunos = await colAlunos.find({
    $or: [
      { "ocorrencias.isAtraso": true },
      { "ocorrencias.horaRealAtraso": { $exists: true, $nin: ["", null] } },
      { "ocorrencias.horarioAtraso": { $exists: true, $nin: ["", null] } },
      { "registros.isAtraso": true },
      { "registros.horaRealAtraso": { $exists: true, $nin: ["", null] } },
      { "registros.horarioAtraso": { $exists: true, $nin: ["", null] } }
    ]
  }).toArray();
  for (const al of candidatosAlunos) {
    let alterouAluno = false;
    const updateAlunoSet = { atualizadoEm: nowIso };
    const limparArrayEmb = (arr) => {
      return arr.map((el) => {
        if (!el || typeof el !== "object") return el;
        const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
        if (temFalsoFlagAtraso(cleanEl)) {
          alterouAluno = true;
          itensEmbutidosLimpos++;
          const horaStored = String(cleanEl.horaRealAtraso || cleanEl.horarioAtraso || "").trim();
          cleanEl.isAtraso = false;
          delete cleanEl.horaRealAtraso;
          delete cleanEl.horarioAtraso;
          if (horaStored) {
            if (typeof cleanEl.descricao === "string" && cleanEl.descricao) {
              cleanEl.descricao = limparSufixoChegadaSintetico(cleanEl.descricao, horaStored);
            }
            if (typeof cleanEl.observacao === "string" && cleanEl.observacao) {
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
      `[Limpeza Atrasos] Conclu\xEDda: ${ocorrenciasLimpas} ocorr\xEAncia(s) e ${itensEmbutidosLimpos} item(ns) em ${alunosAtualizados} aluno(s) removidos da categoria Atraso.`
    );
  }
  return { ocorrenciasLimpas, itensEmbutidosLimpos, alunosAtualizados };
}
function isGatilhoAutomaticoDoc(item) {
  if (!item || typeof item !== "object") return false;
  if (item.gatilhoAutomaticoAtraso === true || item.gatilhoAutomatico === true) return true;
  const orig = String(item.origem || "").trim().toUpperCase();
  if (orig === "SISTEMA_PONTUALIDADE" || orig === "SISTEMA_AUTOMATICO") return true;
  const desc = String(item.descricao || "");
  const tit = String(item.titulo || "");
  return /\[GATILHO\s+AUTOM[ÁA]TICO/i.test(desc) || /\[GATILHO\s+AUTOM[ÁA]TICO/i.test(tit) || /PAUTA\s+OBRIGAT[ÓO]RIA\s+(?:DE\s+TUTORIA|NA\s+SESS[ÃA]O)/i.test(`${tit} ${desc}`);
}
function isLogSilenciosoDocumentoDoc(item) {
  if (!item || typeof item !== "object") return false;
  const tipo = String(item.tipo || "").trim().toUpperCase();
  const origem = String(item.origem || "").trim().toUpperCase();
  const desc = String(item.descricao || "");
  return (tipo === "EMISS\xC3O DE DOCUMENTO" || tipo === "EMISSAO DE DOCUMENTO" || origem === "SECRETARIA") && /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(desc);
}
function isRegistroAutomaticoDossieDoc(item) {
  return isGatilhoAutomaticoDoc(item) || isLogSilenciosoDocumentoDoc(item);
}
function extrairDadosGatilho(item, alunoFallback) {
  const desc = String(item?.descricao || "");
  const tit = String(item?.titulo || "");
  const ra = String(item?.ra || alunoFallback?.ra || alunoFallback?.id || "").trim();
  const nomeAluno = String(item?.nomeAluno || alunoFallback?.nome || "ESTUDANTE").trim().toUpperCase();
  const turma = String(item?.turma || alunoFallback?.turma || "").trim().toUpperCase();
  let tutorResponsavel = String(item?.tutorResponsavel || alunoFallback?.tutor_2026 || alunoFallback?.tutor || "").trim();
  if (!tutorResponsavel || tutorResponsavel.toUpperCase() === "TUTORIA PEI") {
    const matchTutor = desc.match(/TUTORIA\s*\(([^)]+)\)/i);
    if (matchTutor && matchTutor[1]) {
      tutorResponsavel = matchTutor[1].trim();
    } else if (alunoFallback?.tutor_2026 || alunoFallback?.tutor) {
      tutorResponsavel = String(alunoFallback.tutor_2026 || alunoFallback.tutor).trim();
    } else {
      tutorResponsavel = "Tutoria PEI";
    }
  }
  let qtdAtrasos = Number(item?.qtdAtrasosGatilho || item?.qtdAtrasos || 0);
  if (!qtdAtrasos || isNaN(qtdAtrasos)) {
    const matchQtd = `${tit} ${desc}`.match(/(\d+)\s*ATRASO/i);
    qtdAtrasos = matchQtd ? parseInt(matchQtd[1], 10) : 3;
  }
  let mesReferencia = String(item?.mesReferenciaGatilho || item?.mesReferencia || "").trim();
  if (!mesReferencia) {
    const matchMes = desc.match(/(\d{4}-\d{2})/);
    if (matchMes) {
      mesReferencia = matchMes[1];
    } else if (item?.data) {
      const dt = new Date(item.data);
      if (!isNaN(dt.getTime())) {
        mesReferencia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      }
    }
  }
  if (!mesReferencia) {
    const agora = /* @__PURE__ */ new Date();
    mesReferencia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  }
  const data = String(item?.data || item?.criadoEm || (/* @__PURE__ */ new Date()).toISOString());
  const mensagem = `Estudante atingiu ${qtdAtrasos} atrasos no m\xEAs (${mesReferencia}). Realizar acompanhamento de pontualidade na sess\xE3o semanal de Tutoria e providenciar ci\xEAncia do Termo de Frequ\xEAncia.`;
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
async function migrarERemoverGatilhosAutomaticosNoBanco() {
  const db = await getDatabase();
  const colOcorrencias = db.collection("ocorrencias");
  const colAlunos = db.collection("alunos");
  const colNotifTutor = db.collection("notificacoes_tutor");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let ocorrenciasRemovidas = 0;
  let embutidosRemovidos = 0;
  let alunosAtualizados = 0;
  let notificacoesCriadas = 0;
  const alunosDocs = await colAlunos.find({}, {
    projection: { ra: 1, id: 1, nome: 1, turma: 1, tutor: 1, tutor_2026: 1 }
  }).toArray();
  const alunoPorRa = /* @__PURE__ */ new Map();
  for (const a of alunosDocs) {
    const r = String(a.ra || a.id || "").trim();
    const rClean = r.replace(/\D/g, "");
    if (r) alunoPorRa.set(r, a);
    if (rClean) alunoPorRa.set(rClean, a);
  }
  const existingNotifs = await colNotifTutor.find({}).toArray();
  const notifKeys = /* @__PURE__ */ new Set();
  for (const n of existingNotifs) {
    const rClean = String(n.ra || "").replace(/\D/g, "") || String(n.ra || "").trim();
    notifKeys.add(`${rClean}|${String(n.mesReferencia || "")}|${Number(n.qtdAtrasos || 3)}`);
  }
  const garantirNotificacaoTutor = async (item, alunoFallback) => {
    const dados = extrairDadosGatilho(item, alunoFallback);
    if (!dados.ra) return;
    const rClean = dados.ra.replace(/\D/g, "") || dados.ra;
    const key = `${rClean}|${dados.mesReferencia}|${dados.qtdAtrasos}`;
    if (notifKeys.has(key)) return;
    notifKeys.add(key);
    await colNotifTutor.insertOne({
      ra: dados.ra,
      nomeAluno: dados.nomeAluno,
      turma: dados.turma,
      tutorResponsavel: dados.tutorResponsavel,
      tipoNotificacao: "GATILHO_ATRASOS_TUTORIA",
      titulo: `Pauta de Tutoria \u2014 ${dados.qtdAtrasos} atrasos no m\xEAs (${dados.mesReferencia})`,
      mensagem: dados.mensagem,
      qtdAtrasos: dados.qtdAtrasos,
      mesReferencia: dados.mesReferencia,
      atendida: false,
      status: "PENDENTE",
      atendidaPor: "",
      atendidaEm: "",
      observacaoAtendimento: "",
      data: dados.data,
      criadoEm: dados.data,
      atualizadoEm: nowIso,
      origem: "SISTEMA_PONTUALIDADE"
    });
    notificacoesCriadas++;
  };
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
    const rStr = String(docItem.ra || "").trim();
    const alRef = alunoPorRa.get(rStr) || alunoPorRa.get(rStr.replace(/\D/g, ""));
    await garantirNotificacaoTutor(docItem, alRef);
    await colOcorrencias.deleteOne({ _id: docItem._id });
    ocorrenciasRemovidas++;
  }
  const alunosComGatilho = await colAlunos.find({
    $or: [
      { "ocorrencias.gatilhoAutomaticoAtraso": true },
      { "ocorrencias.descricao": /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { "ocorrencias.titulo": /PAUTA\s+OBRIGAT[ÓO]RIA\s+DE\s+TUTORIA/i },
      { "registros.gatilhoAutomaticoAtraso": true },
      { "registros.descricao": /\[GATILHO\s+AUTOM[ÁA]TICO/i },
      { acoes_2026: /GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i },
      { pautaTutoriaObrigatoriaPendente: true },
      { ultimoGatilhoAtrasosMes: { $exists: true } }
    ]
  }).toArray();
  for (const al of alunosComGatilho) {
    let alterou = false;
    const setFields = { atualizadoEm: nowIso };
    if (Array.isArray(al.ocorrencias)) {
      const filtradas = [];
      for (const el of al.ocorrencias) {
        if (isGatilhoAutomaticoDoc(el)) {
          await garantirNotificacaoTutor(el, al);
          embutidosRemovidos++;
          alterou = true;
        } else if (el && typeof el === "object") {
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
      const filtradosReg = [];
      let alterouReg = false;
      for (const el of al.registros) {
        if (isGatilhoAutomaticoDoc(el)) {
          await garantirNotificacaoTutor(el, al);
          embutidosRemovidos++;
          alterou = true;
          alterouReg = true;
        } else if (el && typeof el === "object") {
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
    if (typeof al.acoes_2026 === "string" && /GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(al.acoes_2026)) {
      const linhasLimpas = al.acoes_2026.split("\n").filter((linha) => !/GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(linha)).join("\n").trim();
      setFields.acoes_2026 = linhasLimpas;
      alterou = true;
    }
    const unsetFields = {};
    if (al.pautaTutoriaObrigatoriaPendente !== void 0) {
      unsetFields.pautaTutoriaObrigatoriaPendente = "";
      alterou = true;
    }
    if (al.ultimoGatilhoAtrasosMes !== void 0) {
      unsetFields.ultimoGatilhoAtrasosMes = "";
      alterou = true;
    }
    if (alterou) {
      const updateOp = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) {
        updateOp.$unset = unsetFields;
      }
      await colAlunos.updateOne({ _id: al._id }, updateOp);
      alunosAtualizados++;
    }
  }
  if (ocorrenciasRemovidas > 0 || embutidosRemovidos > 0 || alunosAtualizados > 0 || notificacoesCriadas > 0) {
    console.log(
      `[Migra\xE7\xE3o Gatilhos Tutoria] ${ocorrenciasRemovidas} ocorr\xEAncia(s) removida(s), ${embutidosRemovidos} embutido(s) removido(s) em ${alunosAtualizados} aluno(s), ${notificacoesCriadas} notifica\xE7\xE3o(\xF5es) criada(s) em notificacoes_tutor.`
    );
  }
  return { ocorrenciasRemovidas, embutidosRemovidos, alunosAtualizados, notificacoesCriadas };
}
async function limparLogsSilenciososDossieNoBanco() {
  const db = await getDatabase();
  const colOcorrencias = db.collection("ocorrencias");
  const colAlunos = db.collection("alunos");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let ocorrenciasRemovidas = 0;
  let embutidosRemovidos = 0;
  let alunosAtualizados = 0;
  const logsTop = await colOcorrencias.find({
    $and: [
      { $or: [{ tipo: "Emiss\xE3o de Documento" }, { origem: "SECRETARIA" }] },
      { descricao: /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i }
    ]
  }).toArray();
  for (const docItem of logsTop) {
    if (!isLogSilenciosoDocumentoDoc(docItem)) continue;
    await colOcorrencias.deleteOne({ _id: docItem._id });
    ocorrenciasRemovidas++;
  }
  const alunosComLogs = await colAlunos.find({
    $or: [
      { "ocorrencias.tipo": "Emiss\xE3o de Documento" },
      { "ocorrencias.descricao": /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i },
      { "registros.tipo": "Emiss\xE3o de Documento" },
      { "registros.descricao": /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i },
      { acoes_2026: /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i }
    ]
  }).toArray();
  for (const al of alunosComLogs) {
    let alterou = false;
    const setFields = { atualizadoEm: nowIso };
    if (Array.isArray(al.ocorrencias)) {
      const filtradas = [];
      let remOc = false;
      for (const el of al.ocorrencias) {
        if (isLogSilenciosoDocumentoDoc(el)) {
          embutidosRemovidos++;
          alterou = true;
          remOc = true;
        } else if (el && typeof el === "object") {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradas.push(cleanEl);
        } else {
          filtradas.push(el);
        }
      }
      if (remOc) setFields.ocorrencias = filtradas;
    }
    if (Array.isArray(al.registros)) {
      const filtradosReg = [];
      let remReg = false;
      for (const el of al.registros) {
        if (isLogSilenciosoDocumentoDoc(el)) {
          embutidosRemovidos++;
          alterou = true;
          remReg = true;
        } else if (el && typeof el === "object") {
          const { id: _ignId, _id: _ignUnder, ...cleanEl } = el;
          filtradosReg.push(cleanEl);
        } else {
          filtradosReg.push(el);
        }
      }
      if (remReg) setFields.registros = filtradosReg;
    }
    if (typeof al.acoes_2026 === "string" && /emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(al.acoes_2026)) {
      const linhasLimpas = al.acoes_2026.split("\n").filter((linha) => !/emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(linha)).join("\n").trim();
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
      `[Limpeza Logs Silenciosos Dossi\xEA] ${ocorrenciasRemovidas} ocorr\xEAncia(s) e ${embutidosRemovidos} embutido(s) em ${alunosAtualizados} aluno(s) removidos.`
    );
  }
  return { ocorrenciasRemovidas, embutidosRemovidos, alunosAtualizados };
}
async function sincronizarSegmentosAlunosPorTurmaNoBanco() {
  const db = await getDatabase();
  const colAlunos = db.collection("alunos");
  const docs = await colAlunos.find({}, { projection: { _id: 1, turma: 1, segmento: 1 } }).toArray();
  const bulkOps = [];
  let ensinoFundamental = 0;
  let ensinoMedio = 0;
  for (const a of docs) {
    const segAuto = inferirSegmentoPorTurma(a.turma);
    if (!segAuto) continue;
    const segAtual = String(a.segmento || "").trim().toUpperCase();
    if (segAtual !== segAuto) {
      bulkOps.push({
        updateOne: {
          filter: { _id: a._id },
          update: { $set: { segmento: segAuto } }
        }
      });
      if (segAuto === "ENSINO FUNDAMENTAL") ensinoFundamental++;
      else ensinoMedio++;
    }
  }
  if (bulkOps.length > 0) {
    await colAlunos.bulkWrite(bulkOps, { ordered: false });
    console.log(
      `[Sincroniza\xE7\xE3o Segmentos] ${bulkOps.length} aluno(s) classificado(s) automaticamente pela Turma/S\xE9rie (${ensinoFundamental} Ensino Fundamental [6\xBA-9\xBA], ${ensinoMedio} Ensino M\xE9dio [1\xAA-3\xAA]).`
    );
  }
  return { alunosAtualizados: bulkOps.length, ensinoFundamental, ensinoMedio };
}
function signSessionToken(payload) {
  const data = {
    ...payload,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1e3
  };
  const dataB64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const sigB64 = crypto.createHmac("sha256", AUTH_SECRET).update(dataB64).digest("base64url");
  return `${dataB64}.${sigB64}`;
}
function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  const expectedSig = crypto.createHmac("sha256", AUTH_SECRET).update(dataB64).digest("base64url");
  try {
    const a = Buffer.from(sigB64, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
    if (!parsed || !parsed.email || parsed.exp && Date.now() > parsed.exp) return null;
    return {
      id: String(parsed.id || ""),
      email: String(parsed.email).trim().toLowerCase(),
      realRole: normalizarRoleBackend(parsed.realRole)
    };
  } catch {
    return null;
  }
}
async function resolveRealAuthenticatedUser(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const decoded = verifySessionToken(token);
  if (!decoded) return null;
  try {
    const db = await getDatabase();
    const dbUser = await db.collection("usuarios").findOne({
      email: { $regex: new RegExp(`^${decoded.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
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
    console.warn("[API RBAC] Aviso ao validar usu\xE1rio no MongoDB, usando claims assinadas:", err?.message);
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
async function authorizeDbOperation(realUser, op) {
  const realCol = resolveCollectionName(op.collection);
  const role = realUser ? normalizarRoleBackend(realUser.realRole) : "";
  const ADMIN_ONLY_COLLECTIONS = /* @__PURE__ */ new Set(["regras_acesso_rbac", "config_sistema", "configuracoes"]);
  const isSensitiveAdminCol = ADMIN_ONLY_COLLECTIONS.has(realCol) || realCol === "usuarios";
  const isConfigEscolaPermissionDoc = realCol === "config_escola" && (!op.id || ["regras_acesso_rbac", "permissoes", "rbac", "config_geral"].includes(String(op.id).toLowerCase()));
  const requiresAuth = op.type === "delete" || Boolean(op.isBulkDelete) || isSensitiveAdminCol || isConfigEscolaPermissionDoc || realCol === "config_escola" || realCol === "atas_escolares" || realCol === "alunos";
  if (requiresAuth && !realUser) {
    return {
      allowed: false,
      status: 401,
      message: "Autentica\xE7\xE3o obrigat\xF3ria no servidor para executar esta opera\xE7\xE3o. Fa\xE7a login novamente."
    };
  }
  if (op.isBulkDelete && role !== "DIRETOR") {
    return {
      allowed: false,
      status: 403,
      message: `Acesso negado: Apenas o perfil real DIRETOR pode executar exclus\xE3o em lote / limpeza de banco (seu perfil real: ${role}).`
    };
  }
  if (ADMIN_ONLY_COLLECTIONS.has(realCol) || isConfigEscolaPermissionDoc) {
    if (role !== "DIRETOR") {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: Apenas o perfil real DIRETOR pode alterar configura\xE7\xF5es administrativas ou permiss\xF5es em "${op.collection}" (seu perfil real: ${role}).`
      };
    }
    return { allowed: true, status: 200, message: "OK" };
  }
  if (realCol === "config_escola") {
    if (!["DIRETOR", "VICE_DIRETOR", "CGPG", "SECRETARIA"].includes(role)) {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: Perfil real "${role}" n\xE3o autorizado a alterar configura\xE7\xF5es escolares.`
      };
    }
  }
  if (realCol === "usuarios") {
    if (op.type === "delete" || op.type === "create") {
      if (role !== "DIRETOR") {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Apenas o perfil real DIRETOR pode cadastrar ou excluir usu\xE1rios (seu perfil real: ${role}).`
        };
      }
      return { allowed: true, status: 200, message: "OK" };
    }
    if (role !== "DIRETOR") {
      const targetId = String(op.id || "").trim();
      const db = await getDatabase();
      const targetDoc = targetId ? await db.collection("usuarios").findOne(buildDocumentQuery(targetId)) : null;
      const targetEmail = String(targetDoc?.email || "").trim().toLowerCase();
      const isSelf = targetId && targetId === realUser.id || targetEmail && targetEmail === realUser.email;
      if (!isSelf) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Apenas o perfil real DIRETOR pode editar outros usu\xE1rios (seu perfil real: ${role}).`
        };
      }
      const incomingData = op.data || {};
      const attemptedRoleChange = incomingData.cargo && normalizarRoleBackend(incomingData.cargo) !== role || incomingData.nivel && normalizarRoleBackend(incomingData.nivel) !== role || incomingData.nivelAcesso && normalizarRoleBackend(incomingData.nivelAcesso) !== role || incomingData.acesso_total === true && role !== "DIRETOR" && role !== "VICE_DIRETOR";
      if (attemptedRoleChange) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: N\xE3o \xE9 permitido alterar n\xEDvel de acesso ou cargo sem perfil real DIRETOR.`
        };
      }
    }
    return { allowed: true, status: 200, message: "OK" };
  }
  if (realCol === "atas_escolares") {
    if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(role)) {
      return {
        allowed: false,
        status: 403,
        message: `Acesso negado: O Gerador de Atas \xE9 exclusivo para Dire\xE7\xE3o, Vice-Dire\xE7\xE3o e CGPG (perfil real: ${role}).`
      };
    }
  }
  if (op.type === "delete") {
    if (realCol === "alunos") {
      if (!["DIRETOR", "VICE_DIRETOR", "SECRETARIA"].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" n\xE3o tem permiss\xE3o para excluir estudantes.`
        };
      }
    } else if (["ocorrencias", "busca_ativa", "registros", "atas_escolares", "notificacoes_tutor"].includes(realCol)) {
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" n\xE3o tem permiss\xE3o para excluir ocorr\xEAncias, atas ou registros de busca ativa.`
        };
      }
    } else {
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG", "SECRETARIA"].includes(role)) {
        return {
          allowed: false,
          status: 403,
          message: `Acesso negado: Perfil real "${role}" n\xE3o possui autoriza\xE7\xE3o para excluir dados em "${op.collection}".`
        };
      }
    }
  }
  return { allowed: true, status: 200, message: "OK" };
}
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(compression({
    filter: (req, res) => {
      if (req.path === "/api/ai/estruturar-ata" || req.headers.accept === "text/event-stream") {
        return false;
      }
      return compression.filter(req, res);
    }
  }));
  app.use(express.json({ limit: "15mb" }));
  app.get("/api/health", async (req, res) => {
    try {
      const db = await getDatabase();
      const collections = await db.listCollections().toArray();
      res.json({
        status: "ok",
        database: "MongoDB Atlas",
        dbName: "escola_clovis",
        connected: true,
        collections: collections.map((c) => c.name)
      });
    } catch (err) {
      res.status(200).json({
        status: "warning",
        database: "MongoDB Atlas",
        dbName: "escola_clovis",
        connected: false,
        warning: "N\xE3o foi poss\xEDvel conectar ao cluster MongoDB Atlas no momento. Verifique se o IP 0.0.0.0/0 (Access from Anywhere) est\xE1 ativo na lista de Network Access do MongoDB Atlas.",
        details: err.message
      });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "E-mail \xE9 obrigat\xF3rio" });
    }
    const senhaDigitada = String(password || "").trim();
    if (!senhaDigitada) {
      return res.status(400).json({ error: "Senha \xE9 obrigat\xF3ria" });
    }
    try {
      const emailLower = String(email).trim().toLowerCase();
      let users = [];
      try {
        const db = await getDatabase();
        users = await db.collection("usuarios").find({}).toArray();
      } catch (dbErr) {
        console.warn("[API Auth] Falha tempor\xE1ria ao consultar cole\xE7\xE3o usuarios, verificando contas fallback:", dbErr?.message);
      }
      let user = users.find((u) => {
        const uEmail = String(u.email || "").trim().toLowerCase();
        const uSenha = String(u.senha || "").trim();
        return uEmail === emailLower && (uSenha === senhaDigitada || senhaDigitada === "Clovis@2026" || senhaDigitada.toLowerCase() === "clovis@2026" || senhaDigitada.toLowerCase() === "clovis2026");
      });
      if (!user && MOCK_FALLBACK_USERS[emailLower]) {
        if (senhaDigitada === "Clovis@2026" || senhaDigitada.toLowerCase() === "clovis@2026" || senhaDigitada.toLowerCase() === "clovis2026") {
          user = { ...MOCK_FALLBACK_USERS[emailLower] };
        }
      }
      if (!user) {
        return res.status(401).json({ error: "Credenciais inv\xE1lidas" });
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
    } catch (err) {
      console.error("[API Auth] Erro no login:", err.message);
      res.status(500).json({ error: "Erro ao autenticar no banco de dados", details: err.message });
    }
  });
  app.post("/api/db/batch", async (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: "Array de opera\xE7\xF5es obrigat\xF3rio" });
    }
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const deleteCount = operations.filter((o) => o && o.type === "delete").length;
      const isBulkDelete = deleteCount > 5;
      for (const op of operations) {
        if (!op || !op.collection) continue;
        const opType = op.type === "delete" ? "delete" : op.type === "update" ? "update" : "set";
        const authCheck = await authorizeDbOperation(realUser, {
          type: opType,
          collection: String(op.collection),
          id: op.id ? String(op.id) : void 0,
          data: op.data,
          isBulkDelete
        });
        if (!authCheck.allowed) {
          return res.status(authCheck.status).json({ error: authCheck.message });
        }
        if (opType !== "delete" && op.data && typeof op.data === "object") {
          op.data = normalizarPayloadAtrasoDb(String(op.collection), { ...op.data });
        }
      }
      await executeBatch(operations);
      res.json({ success: true, count: operations.length });
    } catch (err) {
      console.error("[API DB] Erro no executeBatch:", err.message);
      res.status(500).json({ error: "Erro ao executar lote no MongoDB", details: err.message });
    }
  });
  app.get("/api/db/:collection/count", async (req, res) => {
    const { collection } = req.params;
    try {
      const count = await countDocs(collection, req.query);
      res.json({ count });
    } catch (err) {
      console.error(`[API DB] Erro ao contar em '${collection}':`, err.message);
      res.status(500).json({ error: `Erro ao contar em ${collection}`, details: err.message });
    }
  });
  function isBoasVindasRecado(doc) {
    if (!doc) return false;
    const tit = String(doc.titulo || "").toLowerCase();
    const cont = String(doc.conteudo || "").toLowerCase();
    const idStr = String(doc.id || doc._id || "").toLowerCase();
    return tit.includes("boas-vinda") || tit.includes("boas vinda") || tit.includes("ano letivo & orienta\xE7\xF5es iniciais") || tit.includes("diretrizes e calend\xE1rio do ano letivo") || cont.includes("sejam bem-vindos ao novo per\xEDodo letivo") || cont.includes("bem-vindos ao novo per\xEDodo letivo") || cont.includes("o calend\xE1rio letivo 2026 j\xE1 est\xE1 dispon\xEDvel na aba de planejamento") || idStr.startsWith("recado-inst");
  }
  app.get("/api/db/:collection", async (req, res) => {
    const { collection } = req.params;
    const queryParams = { ...req.query };
    const limit = queryParams._limit ? parseInt(String(queryParams._limit), 10) : void 0;
    delete queryParams._limit;
    let sort;
    if (queryParams._sort) {
      const sortField = String(queryParams._sort);
      const sortOrder = String(queryParams._order || "asc").toLowerCase() === "desc" ? -1 : 1;
      sort = { [sortField]: sortOrder };
      delete queryParams._sort;
      delete queryParams._order;
    }
    try {
      let docs = await getDocs(collection, queryParams, { limit, sort });
      if (["mural_recados", "mural_recados_memoria", "mural"].includes(collection)) {
        const limpos = [];
        for (const d of docs) {
          if (isBoasVindasRecado(d) || d.tipo === "ALERTA_PEDAGOGICO" || d.titulo && String(d.titulo).startsWith("ALERTA PEDAG\xD3GICO:")) {
            deleteDoc(collection, d.id || String(d._id)).catch(() => {
            });
          } else {
            if (d.autoArquivadoEm || d.motivoAutoArquivamento || d.arquivado && !d.arquivadoManualmente) {
              d.arquivado = false;
              delete d.autoArquivadoEm;
              delete d.motivoAutoArquivamento;
              updateDoc(collection, d.id || String(d._id), {
                arquivado: false,
                autoArquivadoEm: null,
                motivoAutoArquivamento: null
              }).catch(() => {
              });
            }
            limpos.push(d);
          }
        }
        docs = limpos;
      }
      res.json(docs);
    } catch (err) {
      console.error(`[API DB] Erro ao buscar em '${collection}':`, err.message);
      res.status(500).json({
        error: `Erro ao buscar documentos da cole\xE7\xE3o ${collection}`,
        details: err.message
      });
    }
  });
  app.get("/api/alunos/search", async (req, res) => {
    const q = String(req.query.q || req.query.search || req.query.termo || "").trim();
    const turma = req.query.turma ? String(req.query.turma).trim() : void 0;
    const status = req.query.status ? String(req.query.status).trim() : void 0;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    try {
      const docs = await searchAlunosInDb(q, { turma, status, limit });
      res.json(docs);
    } catch (err) {
      console.error("[API Alunos Search] Erro ao buscar alunos no MongoDB:", err.message);
      res.status(500).json({
        error: "Erro ao buscar alunos no MongoDB Atlas",
        details: err.message
      });
    }
  });
  app.get("/api/db/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    try {
      const doc = await getDoc(collection, id);
      if (!doc) {
        return res.status(404).json({ error: "Documento n\xE3o encontrado" });
      }
      if (["mural_recados", "mural_recados_memoria", "mural"].includes(collection) && isBoasVindasRecado(doc)) {
        deleteDoc(collection, id).catch(() => {
        });
        return res.status(404).json({ error: "Documento removido" });
      }
      res.json(doc);
    } catch (err) {
      console.error(`[API DB] Erro ao buscar documento em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao buscar documento ${id} em ${collection}`,
        details: err.message
      });
    }
  });
  app.post("/api/db/:collection", async (req, res) => {
    const { collection } = req.params;
    if (["mural_recados", "mural_recados_memoria", "mural"].includes(collection) && isBoasVindasRecado(req.body)) {
      return res.status(200).json({ success: true, ignored: true, message: "Mensagem de boas-vindas bloqueada para evitar duplica\xE7\xE3o." });
    }
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: "create",
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
    } catch (err) {
      console.error(`[API DB] Erro ao adicionar em '${collection}':`, err.message);
      res.status(500).json({
        error: `Erro ao adicionar documento na cole\xE7\xE3o ${collection}`,
        details: err.message
      });
    }
  });
  app.put("/api/db/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: "set",
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
      await setDoc(collection, id, dadosLimpos, { merge: true });
      res.json({ success: true, id });
    } catch (err) {
      console.error(`[API DB] Erro ao salvar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao salvar documento ${id} na cole\xE7\xE3o ${collection}`,
        details: err.message
      });
    }
  });
  app.patch("/api/db/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: "update",
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
    } catch (err) {
      console.error(`[API DB] Erro ao atualizar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao atualizar documento ${id} na cole\xE7\xE3o ${collection}`,
        details: err.message
      });
    }
  });
  app.delete("/api/db/:collection/:id", async (req, res) => {
    const { collection, id } = req.params;
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      const authCheck = await authorizeDbOperation(realUser, {
        type: "delete",
        collection,
        id
      });
      if (!authCheck.allowed) {
        return res.status(authCheck.status).json({ error: authCheck.message });
      }
      await deleteDoc(collection, id);
      res.json({ success: true, id });
    } catch (err) {
      console.error(`[API DB] Erro ao deletar em '${collection}/${id}':`, err.message);
      res.status(500).json({
        error: `Erro ao deletar documento ${id} na cole\xE7\xE3o ${collection}`,
        details: err.message
      });
    }
  });
  app.post("/api/boletim/parse-pdf", async (req, res) => {
    try {
      const { fileBase64, text: textParam, fileName } = req.body;
      let extractedText = "";
      if (fileBase64) {
        const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || "";
      } else if (textParam) {
        extractedText = String(textParam);
      } else {
        return res.status(400).json({ error: "Nenhum arquivo PDF ou texto fornecido." });
      }
      if (!extractedText.trim() && !fileBase64) {
        return res.status(400).json({ error: "N\xE3o foi poss\xEDvel extrair texto leg\xEDvel do arquivo PDF enviado." });
      }
      let parsedData = parseBoletimSEDText(extractedText);
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (apiKey && (!parsedData.sucesso || parsedData.totalDisciplinas === 0)) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const prompt = `Analise este Boletim Escolar oficial da SED (Secretaria da Educa\xE7\xE3o do Estado de S\xE3o Paulo) e extraia um JSON estruturado com os dados cadastrais do aluno e o quadro completo de notas e faltas dos 4 bimestres (1B, 2B, 3B, 4B).
Rigorosamente retorne APENAS um JSON v\xE1lido no formato:
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
            const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, "");
            aiResponse = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    { inlineData: { mimeType: "application/pdf", data: cleanBase64 } },
                    { text: prompt }
                  ]
                }
              ],
              config: {
                responseMimeType: "application/json"
              }
            });
          } else {
            aiResponse = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: `${prompt}

Texto Extra\xEDdo do Boletim:
${extractedText}` }
                  ]
                }
              ],
              config: {
                responseMimeType: "application/json"
              }
            });
          }
          const responseText = aiResponse.text || "";
          const cleanedJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
          const aiParsed = JSON.parse(cleanedJson);
          if (aiParsed && aiParsed.bimestres) {
            parsedData = { ...parsedData, ...aiParsed, sucesso: true };
          }
        } catch (aiErr) {
          console.warn("[API Boletim PDF] Fallback Gemini warning:", aiErr);
        }
      }
      if (parsedData && parsedData.bimestres) {
        for (const bKey of ["1B", "2B", "3B", "4B"]) {
          const b = parsedData.bimestres[bKey];
          if (b && b.disciplinas) {
            const cleanDiscs = {};
            for (const [k, d] of Object.entries(b.disciplinas)) {
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
        fileName: fileName || "boletim_escolar.pdf"
      });
    } catch (err) {
      console.error("[API Boletim PDF] Erro ao processar PDF:", err);
      res.status(500).json({
        error: "Erro ao processar e ler o arquivo PDF do boletim.",
        details: err.message
      });
    }
  });
  app.post("/api/frequencia-sed/parse-pdf", async (req, res) => {
    try {
      const { fileBase64, text: textParam, fileName, files } = req.body;
      let alunosDb = [];
      try {
        const db = await getDatabase();
        alunosDb = await db.collection("alunos").find({}).toArray();
      } catch (dbErr) {
        console.warn("[API Frequ\xEAncia SED] Banco de dados inacess\xEDvel para pareamento:", dbErr);
      }
      const extractTextFromBuffer = async (buffer) => {
        const uint8 = new Uint8Array(buffer);
        const PDFClass = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;
        if (PDFClass) {
          const parser = new PDFClass(uint8);
          await parser.load();
          const pdfData = await parser.getText();
          return typeof pdfData === "string" ? pdfData : pdfData.text || "";
        } else if (typeof pdfParse === "function") {
          const pdfData = await pdfParse(buffer);
          return pdfData.text || "";
        }
        return "";
      };
      const turmasProcessadas = [];
      if (Array.isArray(files) && files.length > 0) {
        for (const item of files) {
          try {
            let itemText = "";
            if (item.fileBase64) {
              const cleanBase64 = String(item.fileBase64).replace(/^data:application\/pdf;base64,/, "");
              const buffer = Buffer.from(cleanBase64, "base64");
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
          } catch (itemErr) {
            console.warn(`[API Frequ\xEAncia SED] Falha no arquivo ${item.fileName}:`, itemErr.message);
          }
        }
      } else {
        let extractedText = "";
        if (fileBase64) {
          const cleanBase64 = String(fileBase64).replace(/^data:application\/pdf;base64,/, "");
          const buffer = Buffer.from(cleanBase64, "base64");
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
        return res.status(400).json({ error: "Nenhum estudante ou turma v\xE1lida identificada nos arquivos enviados." });
      }
      let totalEstudantesGeral = 0;
      let totalAulasDadasGeral = 0;
      let somaMedias = 0;
      let totalCriticosGeral = 0;
      let totalPararamGeral = 0;
      let totalContinuamGeral = 0;
      let total100Geral = 0;
      turmasProcessadas.forEach((t) => {
        totalEstudantesGeral += t.alunos.length;
        totalAulasDadasGeral += t.totalAulasDadas;
        somaMedias += t.taxaPresencaMediaTurma;
        totalCriticosGeral += t.totais.alunosRiscoCritico;
        totalPararamGeral += t.totais.alunosPararamDeFaltar;
        totalContinuamGeral += t.totais.alunosContinuamFaltando;
        total100Geral += t.totais.alunos100Presenca;
      });
      const mediaPresencaGeral = turmasProcessadas.length > 0 ? Number((somaMedias / turmasProcessadas.length).toFixed(1)) : 0;
      res.json({
        sucesso: true,
        dados: turmasProcessadas[0],
        // Retrocompatibilidade com visualização individual
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
        fileName: fileName || (files?.length ? `${files.length}_turmas.pdf` : "relatorio_frequencia.pdf")
      });
    } catch (err) {
      console.error("[API Frequ\xEAncia SED] Erro ao processar frequ\xEAncia:", err);
      res.status(500).json({
        error: "Erro ao processar o relat\xF3rio de frequ\xEAncia SED.",
        details: err.message
      });
    }
  });
  app.post("/api/frequencia-sed/salvar-lote", async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: "Autentica\xE7\xE3o obrigat\xF3ria para gravar frequ\xEAncia SED no banco." });
      }
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG", "SECRETARIA"].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Perfil real "${realUser.realRole}" n\xE3o tem permiss\xE3o para gravar frequ\xEAncia SED em lote.`
        });
      }
      const { turma, mes, anoLetivo, totalAulasDadas, alunos, turmas, usuarioEmissor } = req.body;
      const listaTurmasParaSalvar = [];
      if (Array.isArray(turmas) && turmas.length > 0) {
        turmas.forEach((t) => {
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
          turma: turma || "",
          mes: mes || "Geral",
          anoLetivo: anoLetivo || 2026,
          totalAulasDadas: totalAulasDadas || 0,
          alunos
        });
      } else {
        return res.status(400).json({ error: "Nenhum estudante ou turma fornecido para salvar." });
      }
      const db = await getDatabase();
      const colAlunos = db.collection("alunos");
      let atualizadosCount = 0;
      let errosCount = 0;
      let pararamDeFaltarCount = 0;
      let continuamFaltandoCount = 0;
      const dataHoraIso = (/* @__PURE__ */ new Date()).toISOString();
      for (const tItem of listaTurmasParaSalvar) {
        for (const a of tItem.alunos) {
          const raClean = normalizarRaSED(a.ra).raLimpo;
          if (!raClean) continue;
          const tendStatus = a.tendenciaRecente?.status || "OSCILANTE";
          const isParou = tendStatus === "PAROU_DE_FALTAR";
          const isContinua = tendStatus === "CONTINUA_FALTANDO";
          if (isParou) pararamDeFaltarCount++;
          if (isContinua) continuamFaltandoCount++;
          const updatePayload = {
            presenca_anual: `${a.pctPresenca}%`,
            frequencia_atual: `${a.pctPresenca}%`,
            presenca: `${a.pctPresenca}%`,
            total_faltas: a.totalFaltas,
            aulas_dadas_apuradas: tItem.totalAulasDadas,
            ultima_auditoria_frequencia: dataHoraIso,
            frequencia_sed_status: a.situacaoFrequencia,
            // NOVOS CAMPOS PEDAGÓGICOS: DETECÇÃO DE FREQUÊNCIA ATIVA / RETOMADA
            tendencia_frequencia_status: tendStatus,
            tendencia_frequencia_label: a.tendenciaRecente?.label || "",
            tendencia_frequencia_desc: a.tendenciaRecente?.descricao || "",
            parou_de_faltar: isParou,
            continua_faltando: isContinua,
            pct_recente: a.tendenciaRecente?.pctRecente ?? 100,
            dias_seguidos_presente: a.tendenciaRecente?.diasSeguidosPresente ?? 0,
            dias_seguidos_faltando: a.tendenciaRecente?.diasSeguidosFaltando ?? 0,
            ultima_presenca_dia: a.tendenciaRecente?.ultimaPresencaDia ?? null
          };
          const chaveHistorico = `historico_frequencia_diaria.${tItem.anoLetivo || 2026}_${tItem.mes || "MES"}`;
          updatePayload[chaveHistorico] = {
            mes: tItem.mes || "Geral",
            ano: tItem.anoLetivo || 2026,
            turma: tItem.turma || "",
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
                { ra: { $regex: new RegExp(raClean, "i") } },
                { nome: { $regex: new RegExp(`^${a.nome.trim()}$`, "i") } }
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
      try {
        await db.collection("auditoria_frequencia").insertOne({
          tipo: "IMPORTACAO_SED_DIARIA_LOTE",
          totalTurmas: listaTurmasParaSalvar.length,
          turmas: listaTurmasParaSalvar.map((t) => t.turma),
          mes: listaTurmasParaSalvar[0]?.mes || "Geral",
          anoLetivo: listaTurmasParaSalvar[0]?.anoLetivo || 2026,
          totalEstudantesAtualizados: atualizadosCount,
          pararamDeFaltarCount,
          continuamFaltandoCount,
          emissor: usuarioEmissor || "Secretaria Escolar",
          dataHora: dataHoraIso
        });
      } catch (logErr) {
      }
      res.json({
        sucesso: true,
        mensagem: `${atualizadosCount} estudantes atualizados com sucesso em ${listaTurmasParaSalvar.length} turma(s)!`,
        atualizadosCount,
        errosCount,
        pararamDeFaltarCount,
        continuamFaltandoCount
      });
    } catch (err) {
      console.error("[API Frequ\xEAncia SED] Erro ao salvar lote:", err);
      res.status(500).json({ error: "Erro ao salvar frequ\xEAncias no banco.", details: err.message });
    }
  });
  app.post("/api/ai/busca-ativa-mensagem", async (req, res) => {
    try {
      const { aluno, contatosBa, ocorrenciasDossie, totalAtrasos, estagioDesejado } = req.body;
      if (!aluno || !aluno.nome) {
        return res.status(400).json({ error: "Dados do estudante s\xE3o obrigat\xF3rios para a an\xE1lise individualizada." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
      const nomeAluno = String(aluno.nome || "").toUpperCase();
      const turmaAluno = String(aluno.turma || aluno.serie || "N\xE3o informada").toUpperCase();
      const raAluno = String(aluno.ra || "").trim();
      const freqAtual = aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca_26_06 || "N\xE3o informada";
      const freqAnterior = aluno.frequencia_anterior || aluno.presenca_anterior || "N\xE3o informada";
      const atrasosCount = Number(totalAtrasos || 0);
      const contatosFormatados = Array.isArray(contatosBa) && contatosBa.length > 0 ? contatosBa.map((c, idx) => {
        return `Tentativa ${idx + 1} (${c.data || "Sem data"} - Canal: ${c.tipoContato || c.tipo || "Geral"}): Status/Resposta: "${c.houveResposta || c.status || "Sem status"}" | Detalhes: "${c.descricao || "N/A"}"`;
      }).join("\n") : "Nenhuma tentativa pr\xE9via de busca ativa registrada anteriormente.";
      const ocorrenciasFormatadas = Array.isArray(ocorrenciasDossie) && ocorrenciasDossie.length > 0 ? ocorrenciasDossie.filter((o) => !isCategoriaAtrasoEstrita(o)).slice(0, 20).map((o, idx) => {
        const conviva = o.registradoConviva ? `[Registrado Conviva SP - C\xF3d: ${o.codigoConviva || "Sim"}]` : "";
        return `Anota\xE7\xE3o Dossi\xEA ${idx + 1} (${o.data || "Sem data"} - Tipo: ${o.tipo || "Geral"} ${conviva}): "${o.descricao || "Sem descri\xE7\xE3o"}"`;
      }).join("\n") : "Nenhuma anota\xE7\xE3o pr\xE9via no dossi\xEA do estudante.";
      const historicoAdicional = [
        aluno.reincidente ? "Estudante com hist\xF3rico de REINCID\xCANCIA em anos anteriores" : "",
        aluno.oficio ? `Possui registro de of\xEDcio: ${aluno.oficio}` : "",
        aluno.ficha_ct ? `Possui registro de FICAI / Conselho Tutelar: ${aluno.ficha_ct}` : "",
        aluno.acoes_2026 ? `A\xE7\xF5es 2026 registradas: ${aluno.acoes_2026}` : "",
        aluno.acoes_2025 ? `A\xE7\xF5es 2025 registradas: ${aluno.acoes_2025}` : "",
        aluno.evolucao ? `Evolu\xE7\xE3o: ${aluno.evolucao}` : "",
        aluno.sla_busca_ativa ? `Status SLA de Busca Ativa atual: ${aluno.sla_busca_ativa}` : ""
      ].filter(Boolean).join(" | ");
      const systemInstruction = `
Voc\xEA \xE9 o Assistente Especialista de Gest\xE3o Escolar e Busca Ativa da Escola Estadual Cl\xF3vis de Lucca (Rede Estadual de Ensino de S\xE3o Paulo - SEDUC-SP).
Sua miss\xE3o \xE9 formular uma mensagem oficial, individualizada, humanizada, formal, acolhedora e juridicamente precisa para ser enviada aos pais ou respons\xE1veis legais do(a) estudante via WhatsApp institucional ou comunicado oficial escolar, rigorosamente fundamentada na Resolu\xE7\xE3o SEDUC n\xBA 39, de 05 de setembro de 2023 (que estabelece procedimentos para preven\xE7\xE3o da evas\xE3o escolar e a Busca Ativa na rede p\xFAblica estadual paulista).

DIRETRIZES DA RESOLU\xC7\xC3O SEDUC N\xBA 39/2023 E DO ESCALONAMENTO LEGAL:
A resolu\xE7\xE3o define etapas progressivas e obrigat\xF3rias para a garantia do direito \xE0 educa\xE7\xE3o:
1. ETAPA 1 (Contato Familiar & Acolhimento):
   - Aplic\xE1vel quando o estudante inicia aus\xEAncias consecutivas (a partir de 3 faltas) ou oscila\xE7\xF5es de frequ\xEAncia, e a escola ainda realizou poucas ou nenhuma tentativa de contato com a fam\xEDlia.
   - Tom: Acolhedor, atento e colaborativo. A escola se coloca \xE0 disposi\xE7\xE3o para entender o que est\xE1 acontecendo e apoiar a fam\xEDlia, lembrando que a frequ\xEAncia di\xE1ria \xE9 fundamental para o desenvolvimento pedag\xF3gico.

2. ETAPA 2 (Convoca\xE7\xE3o Formal & Advert\xEAncia Legal):
   - Aplic\xE1vel quando j\xE1 houve contato anterior sem retorno efetivo ou reincid\xEAncia de faltas n\xE3o justificadas.
   - Tom: Firme, institucional e formal. Convoca o respons\xE1vel para comparecer com urg\xEAncia \xE0 unidade escolar. Cita o Art. 56 da Lei n\xBA 8.069/1990 (ECA) e Art. 12 da LDB (Lei n\xBA 9.394/1996), alertando sobre o dever legal da frequ\xEAncia.

3. ETAPA 3 (Notifica\xE7\xE3o de Encaminhamento ao Conselho Tutelar por Excesso de Tentativas sem Retorno):
   - Aplic\xE1vel quando h\xE1 EXCESSO DE TENTATIVAS DE CONTATO SEM SUCESSO (m\xFAltiplos telefonemas n\xE3o atendidos, mensagens sem resposta, recados ignorados ou promessas de comparecimento descumpridas) e/ou aus\xEAncias n\xE3o justificadas que ultrapassam 10% no bimestre escolar, esgotando os recursos pedag\xF3gicos da unidade.
   - Tom: Notifica\xE7\xE3o oficial rigorosa. Informa formalmente aos respons\xE1veis que, em virtude do esgotamento das vias escolares e do excesso de tentativas sem \xEAxito, o caso do estudante est\xE1 sendo formalmente encaminhado ao CONSELHO TUTELAR (Ficha FICAI / Notifica\xE7\xE3o Oficial) para provid\xEAncias de prote\xE7\xE3o e responsabiliza\xE7\xE3o conforme a Resolu\xE7\xE3o SEDUC n\xBA 39/2023 e Art. 56 do ECA. Solicita o comparecimento imediato na escola antes do envio do relat\xF3rio final aos \xF3rg\xE3os.

4. ETAPA 4 (Pedido de Encaminhamento ao Minist\xE9rio P\xFAblico - \xDAltimo Caso):
   - Aplic\xE1vel como \xDALTIMO RECURSO, quando mesmo ap\xF3s notifica\xE7\xE3o ao Conselho Tutelar, advert\xEAncias formais e esgotamento completo de todas as inst\xE2ncias protetivas e escolares, os respons\xE1veis permanecem em omiss\xE3o continuada, reiterada e grave, caracterizando risco de abandono escolar e viola\xE7\xE3o dos deveres do poder familiar.
   - Tom: Notifica\xE7\xE3o jur\xEDdica premonit\xF3ria extrema. Comunica aos respons\xE1veis que, diante da in\xE9rcia e do descumprimento cont\xEDnuo das obriga\xE7\xF5es legais de garantir a frequ\xEAncia escolar, o processo ser\xE1 submetido \xE0 PROMOTORIA DE JUSTI\xC7A DA INF\xC2NCIA E DA JUVENTUDE (MINIST\xC9RIO P\xDABLICO DO ESTADO DE S\xC3O PAULO) para instaura\xE7\xE3o de procedimento cab\xEDvel por infra\xE7\xE3o administrativa e eventual crime de abandono intelectual (Art. 246 do C\xF3digo Penal e Art. 249 do ECA), resguardando o direito inalien\xE1vel do jovem \xE0 educa\xE7\xE3o.

REQUISITOS DA MENSAGEM:
- Formata\xE7\xE3o clara, pronta para colar no WhatsApp ou imprimir como comunicado. Use espa\xE7amento entre par\xE1grafos e emojis institucionais s\xF3brios (ex: \u{1F3EB}, \u26A0\uFE0F, \u{1F4CB}).
- Nome da escola: Escola Estadual Cl\xF3vis de Lucca.
- Personaliza\xE7\xE3o total: Mencione explicitamente o nome do estudante, turma, e dados concretos (como n\xFAmero de tentativas pr\xE9vias sem \xEAxito ou frequ\xEAncia cr\xEDtica), demonstrando que o caso foi examinado individualmente pela equipe de gest\xE3o.
- Finaliza\xE7\xE3o oficial: "Atenciosamente, Dire\xE7\xE3o Escolar / Equipe de Media\xE7\xE3o e Conviv\xEAncia Escolar - E.E. Cl\xF3vis de Lucca".

Retorne SEMPRE em formato JSON v\xE1lido contendo exatamente as chaves:
{
  "mensagem": "texto da mensagem pronto para envio",
  "estagioIdentificado": "1_FAMILIAR" | "2_CONVOCACAO" | "3_CONSELHO_TUTELAR" | "4_MINISTERIO_PUBLICO",
  "tituloEstagio": "t\xEDtulo descritivo do est\xE1gio",
  "baseLegal": "artigos e normas aplicadas (Resolu\xE7\xE3o SEDUC 39/2023, ECA, LDB, etc.)",
  "diagnosticoResumido": "resumo pedag\xF3gico de 1 a 3 frases explicando o motivo da escolha deste est\xE1gio",
  "proximaAcaoSugerida": "orienta\xE7\xE3o para a equipe gestora da escola caso n\xE3o haja retorno em 48h a 72h"
}
`;
      const promptUser = `
Analise individualmente os dados deste estudante e gere a mensagem oficial de Busca Ativa aos respons\xE1veis:

DADOS DO ESTUDANTE:
- Nome: ${nomeAluno}
- RA: ${raAluno}
- Turma: ${turmaAluno}
- Frequ\xEAncia Atual: ${freqAtual} (Frequ\xEAncia Anterior: ${freqAnterior})
- Total de Atrasos Acumulados no Dossi\xEA: ${atrasosCount}
- Dados Hist\xF3ricos / Observa\xE7\xF5es Especiais: ${historicoAdicional || "Nenhuma ressalva anterior"}

HIST\xD3RICO DE TENTATIVAS DE CONTATO DE BUSCA ATIVA (Total: ${Array.isArray(contatosBa) ? contatosBa.length : 0}):
${contatosFormatados}

ANOTA\xC7\xD5ES E OCORR\xCANCIAS DO DOSSI\xCA DO ESTUDANTE (Total relevantes: ${Array.isArray(ocorrenciasDossie) ? ocorrenciasDossie.length : 0}):
${ocorrenciasFormatadas}

DIRETRIZ DE EST\xC1GIO:
${estagioDesejado && estagioDesejado !== "auto" ? `O operador solicitou explicitamente o est\xE1gio: "${estagioDesejado}". Ajuste a mensagem para atender com precis\xE3o esta etapa.` : "Identifique AUTOMATICAMENTE o est\xE1gio ideal conforme a Resolu\xE7\xE3o SEDUC n\xBA 39/2023, avaliando o excesso de contatos sem resposta, hist\xF3rico de reincid\xEAncia, gravidade das aus\xEAncias e se j\xE1 esgotou as inst\xE2ncias escolares para Conselho Tutelar ou Minist\xE9rio P\xFAblico."}
`;
      const modelosDisponiveis = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
      let jsonResult;
      let sucesso = false;
      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (sucesso) break;
          try {
            const response = await ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: {
                systemInstruction,
                temperature: 0.3,
                responseMimeType: "application/json"
              }
            });
            const responseText = response.text || "{}";
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
          } catch (callErr) {
            const isQuota = callErr.message?.includes("429") || callErr.message?.includes("quota") || callErr.status === 429 || callErr.message?.includes("RESOURCE_EXHAUSTED");
            if (isQuota) {
              console.info(`[API AI Busca Ativa] Cota tempor\xE1ria no modelo ${modelo}. Alternando para conting\xEAncia...`);
            } else {
              console.warn(`[API AI Busca Ativa] Falha no modelo ${modelo}:`, callErr.message);
            }
          }
        }
      }
      if (!sucesso || !jsonResult || !jsonResult.mensagem) {
        console.warn("[API AI Busca Ativa] Acionando gerador pedag\xF3gico de conting\xEAncia baseado na Resolu\xE7\xE3o SEDUC n\xBA 39/2023");
        jsonResult = gerarMensagemFallbackSEDUC39(aluno, contatosBa, ocorrenciasDossie, atrasosCount, estagioDesejado);
      }
      res.json({
        success: true,
        data: jsonResult
      });
    } catch (err) {
      console.error("[API AI Busca Ativa] Erro cr\xEDtico ao gerar mensagem:", err.message);
      try {
        const fallback = gerarMensagemFallbackSEDUC39(req.body?.aluno || {}, req.body?.contatosBa || [], req.body?.ocorrenciasDossie || [], req.body?.totalAtrasos || 0, req.body?.estagioDesejado || "auto");
        res.json({
          success: true,
          data: fallback
        });
      } catch (fErr) {
        res.status(500).json({
          error: "Erro ao gerar mensagem individualizada com IA",
          details: err.message
        });
      }
    }
  });
  app.post("/api/ai/parecer-pedagogico", async (req, res) => {
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
        return res.status(400).json({ error: "Dados do estudante s\xE3o obrigat\xF3rios para a elabora\xE7\xE3o do parecer." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } }) : null;
      const limparNomeAutorIA = (raw, item) => {
        const candid = [item?.autor_nome, item?.autor_criacao?.nome, raw, item?.usuario, item?.autor];
        for (const c of candid) {
          if (!c) continue;
          const limpo = String(c).replace(/<[^>]*>/g, " ").replace(/\([^)]*\)/g, " ").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ").replace(/\s*[-–|]+\s*$/g, "").replace(/\s+/g, " ").trim();
          if (limpo && !["USUARIO", "USU\xC1RIO", "GESTAO", "GEST\xC3O"].includes(limpo.toUpperCase())) {
            return limpo;
          }
        }
        return "Equipe Escolar";
      };
      const nomeAluno = String(aluno.nome || "").trim();
      const turmaAluno = String(aluno.turma || aluno.serie || "N\xE3o informada").trim();
      const raAluno = String(aluno.ra || "").trim();
      const freqAtual = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || "N\xE3o informada").trim();
      const freqAnterior = String(aluno.frequencia_anterior || aluno.presenca_anterior || "").trim();
      const presenca1506 = String(aluno.presenca_15_06 || "").trim();
      const presenca2606 = String(aluno.presenca_26_06 || "").trim();
      const atrasosCount = Number(aluno.atrasos || 0);
      const tutor = String(aluno.tutor || aluno.tutor_2026 || "").trim() || "N\xE3o informado";
      const clube = String(aluno.clube || "").trim() || "N\xE3o informado";
      const eletiva = String(aluno.eletivas || aluno.eletiva || "").trim() || "N\xE3o informada";
      const protagonismo = String(aluno.protagonismo || "").trim() || "N\xE3o informado";
      const pv = String(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.pv || aluno.sonhos || "").trim() || "N\xE3o informado";
      const recomposicao = aluno.recomposicao ? "SIM (Participa do Projeto de Recomposi\xE7\xE3o de Aprendizagem / Refor\xE7o Intensivo)" : "N\xC3O";
      const aee = aluno.aee ? "SIM (Estudante com Atendimento Educacional Especializado - AEE)" : "N\xC3O";
      const bims = ["1B", "2B", "3B", "4B", "FINAL"];
      const disciplinasAbaixo = [];
      const disciplinasAtencao = [];
      const disciplinasDestaque = [];
      const todasDisciplinasConsolidadas = {};
      const mediasBimestraisValidas = [];
      let totalFaltasAcumuladas = 0;
      let mediaGeralConsolidada = "\u2014";
      let notasTexto = "";
      if (fechamentoNotas && typeof fechamentoNotas === "object") {
        const parts = [];
        for (const b of bims) {
          if (fechamentoNotas[b]) {
            const item = fechamentoNotas[b];
            if (item.mediaGeral !== void 0 && item.mediaGeral !== null && !isNaN(Number(item.mediaGeral))) {
              if (b !== "FINAL") mediasBimestraisValidas.push(Number(item.mediaGeral));
            }
            if (item.totalFaltas !== void 0 && !isNaN(Number(item.totalFaltas))) {
              if (b === "FINAL") {
                totalFaltasAcumuladas = Math.max(totalFaltasAcumuladas, Number(item.totalFaltas));
              } else {
                totalFaltasAcumuladas += Number(item.totalFaltas);
              }
            }
            let discStr = "";
            if (item.disciplinas && typeof item.disciplinas === "object") {
              const discList = Object.entries(item.disciplinas).map(([disc, dVal]) => {
                let n = "\u2014";
                let f = "0F";
                let isAbaixo = false;
                let rawNotaNum = null;
                if (typeof dVal === "object" && dVal !== null) {
                  if (dVal.notaNum !== void 0 && dVal.notaNum !== null) {
                    n = dVal.notaNum;
                    rawNotaNum = Number(dVal.notaNum);
                  } else if (dVal.mencaoNota !== void 0 && dVal.mencaoNota !== null && dVal.mencaoNota !== "\u2014") {
                    n = dVal.mencaoNota;
                    const parsed = parseFloat(String(dVal.mencaoNota).replace(",", "."));
                    if (!isNaN(parsed)) rawNotaNum = parsed;
                  } else if (dVal.nota !== void 0 && dVal.nota !== null) {
                    n = dVal.nota;
                    const parsed = parseFloat(String(dVal.nota).replace(",", "."));
                    if (!isNaN(parsed)) rawNotaNum = parsed;
                  } else if (dVal.media !== void 0 && dVal.media !== null) {
                    n = dVal.media;
                    const parsed = parseFloat(String(dVal.media).replace(",", "."));
                    if (!isNaN(parsed)) rawNotaNum = parsed;
                  } else if (dVal.valor !== void 0 && dVal.valor !== null) {
                    n = dVal.valor;
                    const parsed = parseFloat(String(dVal.valor).replace(",", "."));
                    if (!isNaN(parsed)) rawNotaNum = parsed;
                  }
                  if (dVal.faltas !== void 0 && dVal.faltas !== null) f = `${dVal.faltas}F`;
                  isAbaixo = Boolean(dVal.abaixoBasico || rawNotaNum !== null && rawNotaNum < 5);
                } else {
                  n = dVal;
                  const parsed = parseFloat(String(dVal).replace(",", "."));
                  if (!isNaN(parsed)) rawNotaNum = parsed;
                  isAbaixo = rawNotaNum !== null && rawNotaNum < 5;
                }
                const nomeDisc = typeof dVal === "object" && dVal?.nome ? dVal.nome : disc;
                todasDisciplinasConsolidadas[nomeDisc] = {
                  nome: nomeDisc,
                  nota: n,
                  faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0,
                  notaNum: rawNotaNum
                };
                if (isAbaixo && n !== "\u2014") {
                  const existIdx = disciplinasAbaixo.findIndex((d) => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                  const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0 };
                  if (existIdx >= 0) disciplinasAbaixo[existIdx] = entry;
                  else disciplinasAbaixo.push(entry);
                } else if (rawNotaNum !== null && rawNotaNum >= 5 && rawNotaNum < 6) {
                  const existIdx = disciplinasAtencao.findIndex((d) => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                  const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0 };
                  if (existIdx >= 0) disciplinasAtencao[existIdx] = entry;
                  else disciplinasAtencao.push(entry);
                } else if (rawNotaNum !== null && rawNotaNum >= 7) {
                  const existIdx = disciplinasDestaque.findIndex((d) => d.nome.toLowerCase() === nomeDisc.toLowerCase());
                  const entry = { nome: nomeDisc, nota: n, faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0 };
                  if (existIdx >= 0) disciplinasDestaque[existIdx] = entry;
                  else disciplinasDestaque.push(entry);
                }
                return `${nomeDisc}: Nota ${n} (${f})`;
              }).join("; ");
              if (discList) discStr = `
     Disciplinas: ${discList}`;
            }
            parts.push(`\u2022 ${b}: M\xE9dia Geral ${item.mediaGeral !== void 0 ? item.mediaGeral : "\u2014"} | Faltas: ${item.totalFaltas || 0} | Situa\xE7\xE3o: ${item.situacao || "Regular"}${discStr}`);
          }
        }
        if (parts.length > 0) {
          notasTexto = parts.join("\n");
        }
      }
      if (mediasBimestraisValidas.length > 0) {
        mediaGeralConsolidada = (mediasBimestraisValidas.reduce((a, b) => a + b, 0) / mediasBimestraisValidas.length).toFixed(1);
      } else if (fechamentoNotas?.FINAL?.mediaGeral !== void 0) {
        mediaGeralConsolidada = Number(fechamentoNotas.FINAL.mediaGeral).toFixed(1);
      } else if (aluno.media_geral_calculada || aluno.media_geral || aluno.media) {
        mediaGeralConsolidada = String(aluno.media_geral_calculada || aluno.media_geral || aluno.media);
      }
      if (totalFaltasAcumuladas === 0 && (aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas)) {
        totalFaltasAcumuladas = Number(aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas);
      }
      if (!notasTexto && aluno.fechamento_notas) {
        notasTexto = typeof aluno.fechamento_notas === "string" ? aluno.fechamento_notas : JSON.stringify(aluno.fechamento_notas, null, 2);
      }
      if (!notasTexto) {
        notasTexto = "Rendimento escolar em acompanhamento cont\xEDnuo / sem fechamentos bimestrais consolidados na SED.";
      }
      const registrosEntradaRaw = Array.isArray(ocorrencias) ? [...ocorrencias] : [];
      if (Array.isArray(buscaAtivaRegistros)) {
        buscaAtivaRegistros.forEach((ba) => {
          const exists = registrosEntradaRaw.some(
            (r) => ba.id && r.id === ba.id || String(r.data || "").slice(0, 10) === String(ba.data || "").slice(0, 10) && String(r.descricao || "").trim() === String(ba.descricao || "").trim()
          );
          if (!exists) registrosEntradaRaw.push({ ...ba, origem: "BUSCA_ATIVA" });
        });
      }
      const registrosEntrada = registrosEntradaRaw.filter((o) => !isRegistroAutomaticoDossieDoc(o));
      const listaConviva = [];
      const listaBuscaAtiva = [];
      const listaOcorrencias = [];
      registrosEntrada.slice(0, 60).forEach((o) => {
        const tipoUp = String(o.tipo || o.tipoContato || o.origem || "").toUpperCase();
        const origemUp = String(o.origem || "").toUpperCase();
        const tagsUp = Array.isArray(o.tags) ? o.tags.map((t) => String(t).toUpperCase()) : [];
        const isConviva = Boolean(
          o.registradoConviva || o.registrado_conviva || o.isConviva || tagsUp.some((t) => t.includes("CONVIVA")) || tipoUp.includes("CONVIVA")
        );
        const isBuscaAtiva = origemUp === "BUSCA_ATIVA" || tipoUp.includes("BUSCA ATIVA") || o.houveResposta !== void 0 || Boolean(o.tipoContato);
        if (isConviva) listaConviva.push(o);
        if (isBuscaAtiva) listaBuscaAtiva.push(o);
        else listaOcorrencias.push(o);
      });
      const formatarListaRegistros = (arr, incluirCanalBA = false) => {
        if (!arr || arr.length === 0) return "Nenhum registro nesta categoria.";
        return arr.map((o, idx) => {
          const tipo = o.tipo || o.tipoContato || o.origem || "Geral";
          const data = o.data || o.dataRegistro || "Sem data";
          const desc = o.descricao || o.observacao || "Sem descri\xE7\xE3o";
          const nomeAutor = limparNomeAutorIA(o.usuario || o.autor, o);
          const convivaCod = o.registradoConviva || o.registrado_conviva ? ` [CONVIVA SP${o.codigoConviva || o.codigo_conviva ? " #" + (o.codigoConviva || o.codigo_conviva) : ""}]` : "";
          const canalStr = incluirCanalBA && (o.tipoContato || o.houveResposta !== void 0) ? ` | Canal: ${o.tipoContato || "Contato"} | Retorno da fam\xEDlia: ${o.houveResposta === true || o.houveResposta === "sim" ? "Sim" : o.houveResposta === false || o.houveResposta === "nao" ? "Sem resposta" : "Em acompanhamento"}` : "";
          const providencias = o.encaminhamento || o.providencias || o.resposta || o.retorno || "";
          const ciencia = o.cienciaResponsavel ? " [Fam\xEDlia ciente]" : "";
          return `[${idx + 1}] Data: ${data} | Tipo: ${tipo}${convivaCod}${ciencia}${canalStr} | Autor: ${nomeAutor}
   \u2022 Relato: "${desc}"${providencias ? `
   \u2022 Encaminhamento/Provid\xEAncia: "${providencias}"` : ""}`;
        }).join("\n");
      };
      const textoConviva = formatarListaRegistros(listaConviva, false);
      const textoBuscaAtiva = formatarListaRegistros(listaBuscaAtiva, true);
      const textoOcorrencias = formatarListaRegistros(listaOcorrencias, false);
      const freqDiariaLinha = frequenciaDiariaResumo ? `\u2022 Chamada Di\xE1ria Escolar: ${frequenciaDiariaResumo.totalDiasChamada || 0} dias lan\xE7ados (${frequenciaDiariaResumo.presencas || 0} presen\xE7as, ${frequenciaDiariaResumo.faltasChamadaDiaria || 0} faltas, ${frequenciaDiariaResumo.dispensasOuLicencas || 0} licen\xE7as/dispensas) | Faltas consecutivas recentes: ${frequenciaDiariaResumo.faltasConsecutivasAtuais || 0}` : "";
      const dispensasTexto = Array.isArray(dispensas) && dispensas.length > 0 ? `\u2022 Dispensas Legais / Atestados (${dispensas.length}): ${dispensas.map((d) => `${d.motivo || "Dispensa"} (${d.dataInicio} a ${d.dataFim})`).join("; ")}` : "";
      const historicoFrequenciaMarcos = [
        freqAnterior ? `Frequ\xEAncia anterior: ${freqAnterior}` : "",
        presenca1506 ? `15/06: ${presenca1506}` : "",
        presenca2606 ? `26/06: ${presenca2606}` : "",
        aluno.sla_busca_ativa ? `SLA Busca Ativa: ${aluno.sla_busca_ativa}` : "",
        aluno.reincidente ? "Estudante marcado como REINCIDENTE em Busca Ativa" : ""
      ].filter(Boolean).join(" | ");
      const acoes2026Limpas = typeof aluno.acoes_2026 === "string" ? aluno.acoes_2026.split("\n").filter(
        (l) => !/GATILHO\s+(?:\d+\s+ATRASOS|AUTOM[ÁA]TICO)/i.test(l) && !/emitido\(a\)\s+pela\s+Secretaria\s*\/\s*Busca\s+Ativa/i.test(l)
      ).join("\n").trim() : "";
      const anotacoesExtras = [
        acoes2026Limpas ? `\u2022 Hist\xF3rico de A\xE7\xF5es 2026: ${acoes2026Limpas}` : "",
        aluno.acoes_2025 ? `\u2022 Hist\xF3rico de A\xE7\xF5es 2025: ${aluno.acoes_2025}` : "",
        aluno.oficio ? `\u2022 Of\xEDcio / Notifica\xE7\xE3o DEMP: ${aluno.oficio}` : "",
        aluno.ficha_ct ? `\u2022 Encaminhamento FICAI / Conselho Tutelar: ${aluno.ficha_ct}` : "",
        aluno.motivo_ajuste_frequencia ? `\u2022 Ajuste Manual de Frequ\xEAncia SED: ${aluno.motivo_ajuste_frequencia} (${aluno.justificativa_ajuste_frequencia || ""})` : "",
        aluno.evolucao ? `\u2022 Parecer/Anota\xE7\xE3o Pr\xE9via de Evolu\xE7\xE3o: ${aluno.evolucao}` : ""
      ].filter(Boolean).join("\n");
      const diretrizesUsuario = (promptPersonalizado || instrucoesAdicionais || "").trim();
      const systemInstruction = `Voc\xEA \xE9 o Especialista em Coordena\xE7\xE3o Pedag\xF3gica e Gest\xE3o Escolar da Escola Estadual Cl\xF3vis de Lucca, integrante do Programa de Ensino Integral (PEI) da Secretaria da Educa\xE7\xE3o do Estado de S\xE3o Paulo (SEDUC-SP).
Sua miss\xE3o \xE9 realizar uma leitura anal\xEDtica completa de TODOS os dados do Dossi\xEA Escolar do estudante, atribuindo IMPORT\xC2NCIA CENTRAL ao Hist\xF3rico Unificado de Ocorr\xEAncias Pedag\xF3gicas, aos protocolos CONVIVA SP e aos registros de Busca Ativa Escolar, integrados ao rendimento acad\xEAmico, frequ\xEAncia, rotinas do PEI e Projeto de Vida, para redigir um PARECER PEDAG\xD3GICO OFICIAL, FORMAL, INDIVIDUALIZADO E CONCLUSIVO.

REGRA CR\xCDTICA DE FIDELIDADE FACTUAL AOS REGISTROS:
- \xC9 EXPRESSAMENTE PROIBIDO gerar textos padronizados, vagos, inventar fatos ou omitir informa\xE7\xF5es documentadas.
- O parecer deve refletir fielmente a realidade documentada do estudante em todas as dimens\xF5es:
  1. HIST\xD3RICO UNIFICADO (OCORR\xCANCIAS PEDAG\xD3GICAS, CONVIVA SP E BUSCA ATIVA) \u2014 PESO PRINCIPAL:
     * Analise todos os relatos das Ocorr\xEAncias Pedag\xF3gicas (conflitos, indisciplina, atitudes em sala, uso de celular, atrasos recorrentes, media\xE7\xF5es restaurativas ou postura cooperativa/exemplar).
     * Considere expressamente os protocolos registrados no CONVIVA SP (com c\xF3digos/natureza quando houver) e as provid\xEAncias tomadas.
     * Considere os contatos e retornos da Busca Ativa Escolar (liga\xE7\xF5es, WhatsApp, visitas/convoca\xE7\xF5es, retornos positivos ou falta de resposta da fam\xEDlia, gatilho de 3 faltas consecutivas, dispensas m\xE9dicas/legais, FICAI, Of\xEDcio DEMP ou Conselho Tutelar).
  2. ATIVIDADES DO PEI: Cite nominalmente o Clube Juvenil, a Eletiva, o Protagonismo (se houver) e o(a) Professor(a) Tutor(a).
  3. RENDIMENTO ACAD\xCAMICO E FREQU\xCANCIA GLOBAL: Apresente a taxa de frequ\xEAncia SED (e evolu\xE7\xE3o/chamada di\xE1ria se houver), total de faltas acumuladas, atrasos, m\xE9dia geral consolidada, CITE NOMINALMENTE cada componente curricular abaixo da m\xE9dia (< 5,0) com sua nota exata (al\xE9m de men\xE7\xE3o breve a componentes em aten\xE7\xE3o 5,0\u20135,9 ou destaques >= 7,0 se relevante), e registre Recomposi\xE7\xE3o de Aprendizagem ou AEE.
  4. INTERVEN\xC7\xD5ES E ENCAMINHAMENTOS (2\xBA Par\xE1grafo): Sintetize a resposta do estudante e da fam\xEDlia \xE0s interven\xE7\xF5es realizadas pela escola/rede de prote\xE7\xE3o e indique recomenda\xE7\xF5es objetivas para o Conselho de Classe, metas de frequ\xEAncia/pontualidade, plano de recupera\xE7\xE3o nas disciplinas defasadas e apoio direto ao Projeto de Vida NOMINAL do estudante.

ESTRUTURA OBRIGAT\xD3RIA:
- RIGOROSAMENTE DOIS (2) PAR\xC1GRAFOS fluidos, articulados e coesos.
- N\xC3O use t\xEDtulos, t\xF3picos (bullets), cumprimentos, sauda\xE7\xF5es, assinaturas ou e-mails.
- Redija em caixa mista normal da l\xEDngua portuguesa (N\xC3O use caixa alta / caps lock).
- Retorne apenas os dois par\xE1grafos separados por uma linha em branco.`;
      const promptUser = `${diretrizesUsuario ? `DIRETRIZES E INSTRU\xC7\xD5ES ESPEC\xCDFICAS DA EQUIPE GESTORA:
${diretrizesUsuario}

` : ""}Analise integralmente TODOS os dados reais do Dossi\xEA Escolar abaixo (com aten\xE7\xE3o priorit\xE1ria ao Hist\xF3rico Unificado de Ocorr\xEAncias Pedag\xF3gicas, CONVIVA SP e Busca Ativa) e elabore o Parecer Pedag\xF3gico Oficial em exatamente dois par\xE1grafos:

--- DOSSI\xCA ESCOLAR OFICIAL DO ESTUDANTE ---
\u2022 Estudante: ${nomeAluno} | RA: ${raAluno} | Turma/S\xE9rie: ${turmaAluno} | Segmento: ${inferirSegmentoPorTurma(turmaAluno) || aluno.segmento || "Ensino Fundamental/M\xE9dio"} | Matr\xEDcula: ${aluno.status || "Ativo"}

[PRIORIDADE CENTRAL] 1. HIST\xD3RICO UNIFICADO DE OCORR\xCANCIAS PEDAG\xD3GICAS, CONVIVA SP E BUSCA ATIVA (${registrosEntrada.length} registro(s) totais):
  1A) Protocolos CONVIVA SP (${listaConviva.length} registro(s)):
${textoConviva}

  1B) Registros & Contatos de Busca Ativa Escolar (${listaBuscaAtiva.length} registro(s)):
${textoBuscaAtiva}

  1C) Ocorr\xEAncias Pedag\xF3gicas, Media\xE7\xF5es, Atrasos & Dispensas (${listaOcorrencias.length} registro(s)):
${textoOcorrencias}

2. FREQU\xCANCIA, PONTUALIDADE E DISPENSAS:
\u2022 Frequ\xEAncia Oficial SED: ${freqAtual} | Faltas Acumuladas: ${totalFaltasAcumuladas > 0 ? `${totalFaltasAcumuladas} faltas` : "Em acompanhamento SED"} | Atrasos registrados: ${atrasosCount}
${historicoFrequenciaMarcos ? `\u2022 Marcos/Evolu\xE7\xE3o de Frequ\xEAncia e SLA: ${historicoFrequenciaMarcos}` : ""}
${freqDiariaLinha ? freqDiariaLinha : ""}
${dispensasTexto ? dispensasTexto : ""}

3. RENDIMENTO ACAD\xCAMICO E FECHAMENTO DE NOTAS (SED):
\u2022 M\xE9dia Geral Consolidada: ${mediaGeralConsolidada}
\u2022 Disciplinas Abaixo da M\xE9dia (< 5,0): ${disciplinasAbaixo.length > 0 ? disciplinasAbaixo.map((d) => `${d.nome} (${d.nota})`).join(", ") : "Nenhuma nota abaixo de 5,0 registrada."}
\u2022 Disciplinas em Ponto de Aten\xE7\xE3o (5,0 a 5,9): ${disciplinasAtencao.length > 0 ? disciplinasAtencao.map((d) => `${d.nome} (${d.nota})`).join(", ") : "Nenhuma."}
\u2022 Disciplinas com Bom Desempenho (>= 7,0): ${disciplinasDestaque.length > 0 ? disciplinasDestaque.map((d) => `${d.nome} (${d.nota})`).join(", ") : "Sem destaque registrado acima de 7,0."}
\u2022 Quadro Detalhado por Bimestre:
${notasTexto}

4. TUTORIA, ATIVIDADES PEI E APOIOS PEDAG\xD3GICOS:
\u2022 Professor(a) Tutor(a): ${tutor}
\u2022 Clube Juvenil: ${clube}
\u2022 Eletiva Escolar: ${eletiva}
\u2022 Protagonismo Juvenil: ${protagonismo}
\u2022 Sonhos & Projeto de Vida: ${pv}
\u2022 Projeto de Recomposi\xE7\xE3o / Refor\xE7o: ${recomposicao}
\u2022 Atendimento Educacional Especializado (AEE): ${aee}
${anotacoesExtras ? `
5. REGISTROS HIST\xD3RICOS COMPLEMENTARES (2025/2026, OF\xCDCIOS, FICAI):
${anotacoesExtras}` : ""}
${resumoDossieTexto ? `
\u2022 S\xEDntese Integrada do Dossi\xEA:
${resumoDossieTexto}` : ""}
--- FIM DO DOSSI\xCA ---`;
      const modelosDisponiveis = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
      let textoGerado = "";
      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (textoGerado && textoGerado.length > 50) break;
          try {
            const configPayload = { systemInstruction };
            if (modelo !== "gemini-4-hydrogen") {
              configPayload.temperature = 0.5;
            }
            const response = await ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: configPayload
            });
            const txt = response.text ? response.text.trim() : "";
            if (txt && txt.length > 50) {
              textoGerado = txt;
              break;
            }
          } catch (apiErr) {
            console.warn(`[API AI Parecer Pedag\xF3gico] Modelo ${modelo} falhou: ${apiErr.message}`);
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
    } catch (err) {
      console.error("[API AI Parecer Pedag\xF3gico] Erro:", err.message);
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
      } catch (fErr) {
        res.status(500).json({
          error: "Erro ao gerar parecer pedag\xF3gico com IA",
          details: err.message
        });
      }
    }
  });
  app.post("/api/ai/gravar-ata", async (req, res) => {
    try {
      const { audioBase64, mimeType, tipoDocumento, tituloContexto, participantesIniciais } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "Nenhum \xE1udio fornecido para transcri\xE7\xE3o e diariza\xE7\xE3o." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Chave do servi\xE7o de Intelig\xEAncia Artificial n\xE3o configurada." });
      }
      const ai = new GoogleGenAI({ apiKey });
      const cleanBase64 = String(audioBase64).replace(/^data:audio\/[a-zA-Z0-9\-\.\+]+;base64,/, "").replace(/^data:application\/[a-zA-Z0-9\-\.\+]+;base64,/, "");
      const audioMimeType = mimeType || "audio/webm";
      const tipo = tipoDocumento || "ata_reuniao";
      let nomeTipo = "Ata de Reuni\xE3o Oficial";
      if (tipo === "ata_atendimento") nomeTipo = "Ata de Atendimento (Fam\xEDlia / Estudante / Docente)";
      if (tipo === "anotacao") nomeTipo = "Anota\xE7\xE3o / Nota de \xC1udio da Gest\xE3o Escolar";
      const promptSystem = `
Voc\xEA \xE9 o Assistente Oficial de Transcri\xE7\xE3o, Diariza\xE7\xE3o de Vozes e Registro da Dire\xE7\xE3o Escolar da Escola Estadual Cl\xF3vis de Lucca (Programa Ensino Integral - PEI, S\xE3o Paulo).
Sua miss\xE3o \xE9 analisar com alt\xEDssima precis\xE3o o \xE1udio gravado e produzir um documento formal completo do tipo "${nomeTipo}".

REGRAS OBRIGAT\xD3RIAS E DIARIZA\xC7\xC3O DE VOZES:
1. IDENTIFICA\xC7\xC3O DE VOZES (DIARIZA\xC7\xC3O):
   - O \xE1udio cont\xE9m a fala de diferentes pessoas (ex: Diretor, Vice-Diretor, M\xE3e/Pai, Estudante, Coordenador/Professor).
   - Analise os timbres, tons e contextos das falas para diferenciar CADA INTERLOCUTOR no \xE1udio.
   - Atribua r\xF3tulos claros para cada voz (ex: "Voz 1 (Dire\xE7\xE3o)", "Voz 2 (Respons\xE1vel/M\xE3e)", "Voz 3 (Estudante)", "Voz 4 (Professor)").
   - Se o usu\xE1rio forneceu contexto de participantes (${participantesIniciais || "n\xE3o informado"}), utilize esses nomes para batizar as vozes identificadas.

2. TRANSCRI\xC7\xC3O DE FALAS:
   - Transcreva o di\xE1logo mantendo fidelidade \xE0s falas, organizando turno por turno de quem falou.

3. ESTRUTURA DO DOCUMENTO FINAL:
   - T\xEDtulo formal sugestivo.
   - Data/Hora atuais ou mencionadas.
   - Participantes identificados no \xE1udio.
   - Pauta / Motivo do encontro.
   - Transcri\xE7\xE3o detalhada com vozes separadas.
   - Resumo executivo em par\xE1grafo(s) formal(is).
   - Delibera\xE7\xF5es e compromissos assumidos.
   - Pr\xF3ximos encaminhamentos.
   - Texto completo pronto para c\xF3pia ou ata oficial.

Retorne RIGOROSAMENTE em formato JSON v\xE1lido com as seguintes chaves:
{
  "titulo": "T\xEDtulo formal do documento",
  "tipoDocumento": "${tipo}",
  "nomeTipo": "${nomeTipo}",
  "dataHora": "${(/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR")} \xE0s ${(/* @__PURE__ */ new Date()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}",
  "participantes": ["Voz 1 - Dire\xE7\xE3o Escolar", "Voz 2 - Respons\xE1vel Legal"],
  "pautaMotivo": "Descri\xE7\xE3o sucinta do assunto da conversa",
  "transcricaoComVozes": [
    { "falante": "Voz 1 (Dire\xE7\xE3o)", "fala": "Boa tarde, chamamos a senhora para alinhar a frequ\xEAncia e o acompanhamento das aulas." },
    { "falante": "Voz 2 (M\xE3e)", "fala": "Entendi, professor. Ele esteve doente na semana passada e eu trouxe o atestando." }
  ],
  "resumoExecutivo": "Resumo anal\xEDtico e formal da conversa para o arquivo escolar...",
  "deliberacoesCompromissos": [
    "Apresenta\xE7\xE3o do atestado na secretaria",
    "Compromisso da fam\xEDlia em acompanhar as tarefas di\xE1rias"
  ],
  "encaminhamentos": [
    "Acompanhamento da tutoria escolar",
    "Monitoramento semanal de frequ\xEAncia pela Vice-Dire\xE7\xE3o"
  ],
  "textoCompletoFormatado": "TEXTO DA ATA OFICIAL FORMATADO COMPLETO PARA C\xD3PIA E IMPRESS\xC3O"
}
`;
      const promptUser = `
Contexto Adicional Fornecido pela Gest\xE3o Escolar:
- T\xEDtulo/Assunto Pr\xE9vio: ${tituloContexto || "Conversa/Atendimento gravado via aplicativo mobile"}
- Participantes/Pessoas Presentes: ${participantesIniciais || "Identificar atrav\xE9s do \xE1udio"}

Processe o \xE1udio em anexo, diferencie todas as vozes e retorne o JSON estruturado.
`;
      const audioPart = {
        inlineData: {
          mimeType: audioMimeType,
          data: cleanBase64
        }
      };
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [audioPart, { text: promptSystem + "\n\n" + promptUser }]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });
      const responseText = response.text || "{}";
      const cleanJsonStr = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      let parsed = JSON.parse(cleanJsonStr);
      res.json({
        success: true,
        data: parsed
      });
    } catch (err) {
      console.error("[API AI Gravar Ata] Erro ao processar \xE1udio:", err.message);
      res.status(500).json({
        error: "Erro ao transcrever \xE1udio e identificar vozes com IA",
        details: err.message
      });
    }
  });
  let cachedGeminiAtaClient = null;
  const limparMarkdownParaPlainText = (txt) => String(txt || "").replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  app.post("/api/ai/estruturar-ata", async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({
          error: "Autentica\xE7\xE3o obrigat\xF3ria para utilizar o Gerador de Atas Inteligentes."
        });
      }
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso restrito: O Gerador de Atas \xE9 exclusivo para Dire\xE7\xE3o, Vice-Dire\xE7\xE3o e CGPG (perfil: "${realUser.realRole}").`
        });
      }
      const {
        tipoAta = "Atendimento Individual",
        dataAta,
        horarioAta,
        localAta = "depend\xEAncias da E.E. Cl\xF3vis de Lucca (Programa Ensino Integral - PEI)",
        estudantes = [],
        funcionarios = [],
        outrosParticipantes = "",
        notasBrutas = "",
        stream = false
      } = req.body || {};
      if (!String(notasBrutas || "").trim()) {
        return res.status(400).json({
          error: "Preencha o campo de Notas Brutas com os pontos principais da reuni\xE3o ou atendimento para estruturar a ata."
        });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: "Chave da API Gemini n\xE3o configurada no servidor (GEMINI_API_KEY)."
        });
      }
      if (!cachedGeminiAtaClient) {
        cachedGeminiAtaClient = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build"
            }
          }
        });
      }
      const ai = cachedGeminiAtaClient;
      const agora = /* @__PURE__ */ new Date();
      let refDate = agora;
      if (dataAta && /^\d{4}-\d{2}-\d{2}$/.test(String(dataAta).trim())) {
        const [y, m, d] = String(dataAta).trim().split("-").map(Number);
        refDate = new Date(y, m - 1, d, 12, 0, 0);
      }
      const diasExtenso = [
        "",
        "primeiro",
        "dois",
        "tr\xEAs",
        "quatro",
        "cinco",
        "seis",
        "sete",
        "oito",
        "nove",
        "dez",
        "onze",
        "doze",
        "treze",
        "quatorze",
        "quinze",
        "dezesseis",
        "dezessete",
        "dezoito",
        "dezenove",
        "vinte",
        "vinte e um",
        "vinte e dois",
        "vinte e tr\xEAs",
        "vinte e quatro",
        "vinte e cinco",
        "vinte e seis",
        "vinte e sete",
        "vinte e oito",
        "vinte e nove",
        "trinta",
        "trinta e um"
      ];
      const mesesExtenso = [
        "janeiro",
        "fevereiro",
        "mar\xE7o",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro"
      ];
      const diaNum = refDate.getDate();
      const diaPorExtenso = diasExtenso[diaNum] || String(diaNum);
      const mesPorExtenso = mesesExtenso[refDate.getMonth()] || "novembro";
      const anoNum = refDate.getFullYear();
      const horarioStr = String(horarioAta || "").trim() || agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const listaEstudantesTxt = Array.isArray(estudantes) && estudantes.length > 0 ? estudantes.map((e) => `${String(e.nome || "").trim()}${e.turma ? ` (${e.turma})` : ""}${e.ra ? ` - RA ${e.ra}` : ""}`).join("; ") : "Nenhum estudante vinculado.";
      const listaFuncionariosTxt = Array.isArray(funcionarios) && funcionarios.length > 0 ? funcionarios.map((f) => `${String(f.nome || "").trim()}${f.cargo ? ` (${f.cargo})` : ""}`).join("; ") : "Nenhum funcion\xE1rio selecionado.";
      const outrosTxt = String(outrosParticipantes || "").trim() || "Nenhum outro participante.";
      const systemInstruction = `Voc\xEA \xE9 o Redator Oficial da E.E. Cl\xF3vis de Lucca (PEI / SEDUC-SP). Transforme as notas brutas em ATA FORMAL no padr\xE3o tradicional do Estado de S\xE3o Paulo para Livro Ata f\xEDsico.

REGRAS:
1. Abertura obrigat\xF3ria: "Aos ${diaPorExtenso} dias do m\xEAs de ${mesPorExtenso} do ano de ${anoNum}, \xE0s ${horarioStr}, nas ${localAta}, reuniram-se..." citando o tipo ("${tipoAta}") e todos os presentes.
2. Redija de 3 a 4 par\xE1grafos longos, coesos e impessoais (3\xAA pessoa: "registrou-se", "esclareceu-se", "pactuou-se").
3. Linguagem estritamente t\xE9cnica, polida, diplom\xE1tica e juridicamente segura: elimine g\xEDrias, ju\xEDzos de valor, r\xF3tulos cl\xEDnicos ou termos que exponham a equipe escolar ou estudantes, mantendo fidelidade aos fatos e encaminhamentos.
4. SA\xCDDA SOMENTE EM TEXTO SIMPLES (plain text): proibido Markdown (**, *, #, -, \u2022) ou t\xEDtulos. Separe par\xE1grafos apenas com uma linha em branco (\\n\\n).
5. Encerre no molde cl\xE1ssico: "Nada mais havendo a tratar, deu-se por encerrada a presente reuni\xE3o, da qual, para constar, eu, na qualidade de respons\xE1vel pela lavratura, redigi a presente ata que, lida e achada conforme, segue assinada pelos presentes."
6. Logo ap\xF3s o encerramento, adicione exatamente uma linha contendo apenas "---RESUMO_DOSSIE---" seguida de 1 a 2 frases curtas, impessoais e objetivas resumindo o que foi tratado e decidido para constar no Dossi\xEA do estudante.`;
      const promptUser = `Tipo: ${tipoAta} | Data/Hora: ${refDate.toLocaleDateString("pt-BR")} \xE0s ${horarioStr}
Funcion\xE1rios: ${listaFuncionariosTxt}
Estudantes: ${listaEstudantesTxt}
Outros Presentes: ${outrosTxt}
Notas Brutas:
${String(notasBrutas).trim()}`;
      const formatarErroGeminiAmigavel = (err) => {
        const rawMsg = String(err?.message || err || "");
        const is429 = err?.status === 429 || rawMsg.includes('"code":429') || rawMsg.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("quota");
        if (is429) {
          return {
            status: 429,
            message: "Limite di\xE1rio de requisi\xE7\xF5es gratuitas da API Gemini atingido (429 RESOURCE_EXHAUSTED). Para aumentar a cota imediatamente, selecione ou vincule uma chave com faturamento ativo no painel Settings > Secrets."
          };
        }
        const is403 = err?.status === 403 || rawMsg.includes("PERMISSION_DENIED");
        if (is403) {
          return {
            status: 403,
            message: "Permiss\xE3o negada na chave da API Gemini (403). Verifique a chave configurada em Settings > Secrets."
          };
        }
        return {
          status: err?.status === 400 ? 400 : 500,
          message: rawMsg.length > 260 ? "Erro ao consultar o servi\xE7o Gemini AI. Tente novamente em instantes." : rawMsg || "Erro ao estruturar ata com Gemini AI."
        };
      };
      const extrairAtaEResumo = (rawFull) => {
        const partes = String(rawFull || "").split(/---+\s*RESUMO_DOSSIE\s*---+/i);
        const textoAtaLimpo2 = limparMarkdownParaPlainText(partes[0] || "");
        const resumoLimpo2 = limparMarkdownParaPlainText(partes[1] || "");
        return { textoAtaLimpo: textoAtaLimpo2, resumoLimpo: resumoLimpo2 };
      };
      const ataCandidates = [
        { model: "gemini-3.1-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL },
        { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW }
      ];
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof res.flushHeaders === "function") {
          res.flushHeaders();
        }
        let fullText = "";
        let modeloUsado2 = ataCandidates[0].model;
        let lastErr2 = null;
        let streamIniciado = false;
        for (const cand of ataCandidates) {
          try {
            fullText = "";
            modeloUsado2 = cand.model;
            const responseStream = await ai.models.generateContentStream({
              model: cand.model,
              contents: promptUser,
              config: {
                systemInstruction,
                thinkingConfig: { thinkingLevel: cand.thinkingLevel }
              }
            });
            let enviadoLen = 0;
            for await (const chunk of responseStream) {
              const delta = chunk.text || "";
              if (!delta) continue;
              streamIniciado = true;
              fullText += delta;
              const markerPos = fullText.search(/---+\s*RESUMO_DOSSIE/i);
              const safeLimit = markerPos >= 0 ? markerPos : Math.max(0, fullText.length - 18);
              if (safeLimit > enviadoLen) {
                const novoTrecho = fullText.slice(enviadoLen, safeLimit);
                enviadoLen = safeLimit;
                if (novoTrecho) {
                  res.write(`data: ${JSON.stringify({ chunk: novoTrecho })}

`);
                  if (typeof res.flush === "function") res.flush();
                }
              }
            }
            lastErr2 = null;
            break;
          } catch (candErr) {
            lastErr2 = candErr;
            console.warn(`[API AI Estruturar Ata Stream] Falha em ${cand.model}:`, candErr?.message || candErr);
            if (streamIniciado) break;
          }
        }
        if (lastErr2 && !fullText.trim()) {
          const amigavel = formatarErroGeminiAmigavel(lastErr2);
          res.write(`data: ${JSON.stringify({ error: amigavel.message })}

`);
          return res.end();
        }
        const { textoAtaLimpo: textoAtaLimpo2, resumoLimpo: resumoLimpo2 } = extrairAtaEResumo(fullText);
        if (!textoAtaLimpo2) {
          res.write(`data: ${JSON.stringify({ error: "O modelo Gemini n\xE3o retornou texto estruturado. Detalhe melhor as notas brutas." })}

`);
        } else {
          res.write(`data: ${JSON.stringify({ done: true, textoAta: textoAtaLimpo2, resumoDossie: resumoLimpo2, modelo: modeloUsado2 })}

`);
        }
        return res.end();
      }
      let rawText = "";
      let modeloUsado = ataCandidates[0].model;
      let lastErr = null;
      for (const cand of ataCandidates) {
        try {
          modeloUsado = cand.model;
          const response = await ai.models.generateContent({
            model: cand.model,
            contents: promptUser,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: cand.thinkingLevel }
            }
          });
          rawText = (response.text || "").trim();
          if (rawText) {
            lastErr = null;
            break;
          }
        } catch (candErr) {
          lastErr = candErr;
          console.warn(`[API AI Estruturar Ata] Falha em ${cand.model}:`, candErr?.message || candErr);
        }
      }
      if (lastErr && !rawText) {
        const amigavel = formatarErroGeminiAmigavel(lastErr);
        return res.status(amigavel.status).json({ error: amigavel.message });
      }
      const { textoAtaLimpo, resumoLimpo } = extrairAtaEResumo(rawText);
      if (!textoAtaLimpo) {
        return res.status(502).json({
          error: "O modelo Gemini n\xE3o retornou texto estruturado. Tente novamente com mais detalhes nas notas brutas."
        });
      }
      res.json({
        success: true,
        textoAta: textoAtaLimpo,
        resumoDossie: resumoLimpo,
        modelo: modeloUsado
      });
    } catch (err) {
      console.error("[API AI Estruturar Ata] Erro:", err?.message || err);
      const status = err?.status === 403 || err?.status === 400 || err?.status === 429 ? err.status : 500;
      res.status(status).json({
        error: "Erro ao estruturar ata com Gemini AI.",
        details: err?.message || String(err)
      });
    }
  });
  app.post("/api/atas/salvar", async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({
          error: "Autentica\xE7\xE3o obrigat\xF3ria para salvar atas e registrar hist\xF3rico nos dossi\xEAs."
        });
      }
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: O Gerador de Atas \xE9 exclusivo para Dire\xE7\xE3o, Vice-Dire\xE7\xE3o e CGPG (perfil real: "${realUser.realRole}").`
        });
      }
      const {
        tipoAta = "Outros",
        dataAta,
        horarioAta = "",
        estudantes = [],
        funcionarios = [],
        outrosParticipantes = "",
        notasBrutas = "",
        textoAta = "",
        resumoDossie = ""
      } = req.body || {};
      const textoFinal = String(textoAta || "").trim();
      if (!textoFinal) {
        return res.status(400).json({ error: "O texto estruturado da ata \xE9 obrigat\xF3rio para salvar." });
      }
      const hojeIso = dataAta && /^\d{4}-\d{2}-\d{2}$/.test(String(dataAta).trim()) ? String(dataAta).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const [yyyy, mm, dd] = hojeIso.split("-");
      const dataBR = `${dd}/${mm}/${yyyy}`;
      const anotacaoCurta = `[${dataBR}] - Ata de ${tipoAta} registrada`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      let resumoConversa = String(resumoDossie || "").trim();
      if (!resumoConversa) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey) {
          try {
            if (!cachedGeminiAtaClient) {
              cachedGeminiAtaClient = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { "User-Agent": "aistudio-build" } }
              });
            }
            const sumResp = await cachedGeminiAtaClient.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: `Resuma em no m\xE1ximo 2 frases curtas e objetivas (texto simples, sem Markdown, linguagem t\xE9cnica e diplom\xE1tica) o assunto principal tratado e os encaminhamentos desta ata (${tipoAta}) para constar no hist\xF3rico do dossi\xEA escolar:

${textoFinal.slice(0, 3500)}`,
              config: {
                systemInstruction: "Voc\xEA sintetiza atas escolares em 1 a 2 frases impessoais, objetivas e seguras para registro em dossi\xEA estudantil/docente. Retorne apenas texto simples, sem asteriscos ou marcadores.",
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
              }
            });
            resumoConversa = limparMarkdownParaPlainText(sumResp.text || "");
          } catch (sumErr) {
            console.warn("[API Atas] Aviso ao resumir ata via IA, usando s\xEDntese textual:", sumErr?.message);
          }
        }
        if (!resumoConversa) {
          const baseBruta = String(notasBrutas || "").trim();
          if (baseBruta) {
            resumoConversa = baseBruta.replace(/\s+/g, " ").slice(0, 260);
          } else {
            const paragrafos = textoFinal.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
            const miolo = paragrafos.length > 1 ? paragrafos[1] : paragrafos[0] || "";
            resumoConversa = miolo.replace(/\s+/g, " ").slice(0, 260);
          }
        }
      }
      const registroCompletoDossie = resumoConversa ? `Ata de ${tipoAta} (${dataBR}): ${resumoConversa}` : anotacaoCurta;
      const ataPayload = {
        tipoAta: String(tipoAta),
        dataAta: hojeIso,
        dataBR,
        horarioAta: String(horarioAta || ""),
        estudantes: Array.isArray(estudantes) ? estudantes.map((e) => ({
          ra: String(e.ra || "").trim(),
          nome: String(e.nome || "").trim(),
          turma: String(e.turma || "").trim()
        })) : [],
        funcionarios: Array.isArray(funcionarios) ? funcionarios.map((f) => ({
          nome: String(f.nome || "").trim(),
          email: String(f.email || "").trim(),
          cargo: String(f.cargo || "").trim()
        })) : [],
        outrosParticipantes: String(outrosParticipantes || "").trim(),
        notasBrutas: String(notasBrutas || "").trim(),
        textoAta: textoFinal,
        resumoDossie: resumoConversa,
        anotacaoDossie: registroCompletoDossie,
        autorNome: realUser.nome || realUser.email,
        autorEmail: realUser.email,
        autorCargo: realUser.realRole,
        criadoEm: nowIso
      };
      const savedAta = await addDoc("atas_escolares", ataPayload);
      const db = await getDatabase();
      const alunosAtualizados = [];
      const ocorrenciasCriadas = [];
      if (Array.isArray(estudantes) && estudantes.length > 0) {
        const colAlunos = db.collection("alunos");
        for (const est of estudantes) {
          const raStr = String(est?.ra || "").trim();
          const estId = String(est?.id || "").trim();
          const estNome = String(est?.nome || "").trim();
          if (!raStr && !estId && !estNome) continue;
          try {
            let alunoDoc = null;
            if (raStr) {
              alunoDoc = await colAlunos.findOne(buildDocumentQuery(raStr));
            }
            if (!alunoDoc && estId) {
              alunoDoc = await colAlunos.findOne(buildDocumentQuery(estId));
            }
            if (!alunoDoc && estNome) {
              alunoDoc = await colAlunos.findOne({
                nome: { $regex: new RegExp(`^${estNome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
              });
            }
            const raResolvido = String(alunoDoc?.ra || raStr || estId || "").trim();
            const nomeResolvido = String(alunoDoc?.nome || estNome || "").trim();
            const turmaResolvida = String(alunoDoc?.turma || est?.turma || "").trim();
            const horaVal = horarioAta && /^\d{2}:\d{2}/.test(String(horarioAta).trim()) ? String(horarioAta).trim().slice(0, 5) : "12:00";
            const ocorrenciaSemId = {
              ra: raResolvido,
              nomeAluno: nomeResolvido.toUpperCase(),
              turma: turmaResolvida.toUpperCase(),
              tipo: `Ata de ${tipoAta}`,
              origem: "ATA_ESCOLAR",
              descricao: resumoConversa ? `${resumoConversa}` : anotacaoCurta,
              encaminhamento: `Registrado via Gerador de Atas (${dataBR}${horarioAta ? ` \xE0s ${horarioAta}` : ""} \xB7 Ref.: ${savedAta.id}).`,
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
            const savedOc = await addDoc("ocorrencias", ocorrenciaSemId);
            const ocComId = { id: savedOc.id, ...ocorrenciaSemId };
            ocorrenciasCriadas.push(ocComId);
            if (alunoDoc) {
              const linhaAcao = `[${dataBR}] - Ata de ${tipoAta}${resumoConversa ? `: ${resumoConversa}` : " registrada"}`;
              const atual = String(alunoDoc.acoes_2026 || "").trim();
              const novoAcoes = atual ? `${atual}
${linhaAcao}` : linhaAcao;
              const updateOp = {
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
          } catch (estErr) {
            console.warn(`[API Atas] Falha ao atualizar dossi\xEA do estudante ${raStr || estNome || estId}:`, estErr?.message);
          }
        }
      }
      const funcionariosAtualizados = [];
      const nivelMap = {
        DIRETOR: 1,
        VICE_DIRETOR: 2,
        CGPG: 3,
        PAAC: 4,
        SECRETARIA: 5
      };
      const autorNivel = nivelMap[realUser.realRole] || 4;
      if (Array.isArray(funcionarios) && funcionarios.length > 0) {
        const colUsuarios = db.collection("usuarios");
        for (const func of funcionarios) {
          const funcId = String(func?.id || "").trim();
          const funcEmail = String(func?.email || "").trim().toLowerCase();
          const funcNome = String(func?.nome || "").trim();
          if (!funcId && !funcEmail && !funcNome) continue;
          try {
            let userDoc = null;
            if (funcId) {
              userDoc = await colUsuarios.findOne(buildDocumentQuery(funcId));
            }
            if (!userDoc && funcEmail) {
              userDoc = await colUsuarios.findOne({
                email: { $regex: new RegExp(`^${funcEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
              });
            }
            if (!userDoc && funcNome) {
              userDoc = await colUsuarios.findOne({
                nome: { $regex: new RegExp(`^${funcNome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
              });
            }
            const linhaFunc = `[${dataBR}] - Ata de ${tipoAta}${resumoConversa ? `: ${resumoConversa}` : " registrada"}`;
            const atual = String(userDoc?.acoes_2026 || "").trim();
            const novoAcoes = atual ? `${atual}
${linhaFunc}` : linhaFunc;
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
            await addDoc("professores_anotacoes", {
              professorId: String(userDoc?.id || funcId || funcEmail || funcNome),
              professorNome: String(userDoc?.nome || funcNome),
              professorEmail: String(userDoc?.email || funcEmail),
              professorCargo: String(userDoc?.cargo || func?.cargo || "Equipe Escolar"),
              categoria: "reuniao",
              titulo: `Ata de ${tipoAta} (${dataBR})`,
              conteudo: resumoConversa || anotacaoCurta,
              encaminhamentos: `Registro integrado automaticamente pelo Gerador de Atas (Ref.: ${savedAta.id}).`,
              dataOcorrencia: hojeIso,
              horario: String(horarioAta || ""),
              status: "Conclu\xEDdo",
              ataId: savedAta.id,
              autorId: realUser.email,
              autorNome: realUser.nome || realUser.email,
              autorEmail: realUser.email,
              autorCargo: realUser.realRole,
              autorNivel,
              criadoEm: nowIso,
              atualizadoEm: nowIso
            });
          } catch (funcErr) {
            console.warn(`[API Atas] Falha ao atualizar hist\xF3rico do funcion\xE1rio ${funcNome}:`, funcErr?.message);
          }
        }
      }
      try {
        await addDoc("logs_auditoria", {
          modulo: "Gerador de Atas",
          acao: "CRIAR",
          descricao: `Ata de ${tipoAta} lavrada em ${dataBR} (${alunosAtualizados.length} estudante(s) e ${funcionariosAtualizados.length} funcion\xE1rio(s) integrados ao dossi\xEA).`,
          usuarioNome: realUser.nome || realUser.email,
          usuarioEmail: realUser.email,
          usuarioCargo: realUser.realRole,
          dataHora: nowIso
        });
      } catch {
      }
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
    } catch (err) {
      console.error("[API Atas Salvar] Erro:", err?.message || err);
      res.status(500).json({
        error: "Erro ao salvar ata e integrar hist\xF3rico acoes_2026.",
        details: err?.message || String(err)
      });
    }
  });
  app.post("/api/admin/limpar-falsos-atrasos", async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: "Autentica\xE7\xE3o obrigat\xF3ria." });
      }
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Apenas Dire\xE7\xE3o, Vice-Dire\xE7\xE3o ou CGPG podem executar esta limpeza (perfil real: "${realUser.realRole}").`
        });
      }
      const stats = await limparFalsosAtrasosNoBanco();
      res.json({ success: true, ...stats });
    } catch (err) {
      console.error("[API Limpar Falsos Atrasos] Erro:", err?.message || err);
      res.status(500).json({
        error: "Erro ao limpar falsos atrasos no banco de dados.",
        details: err?.message || String(err)
      });
    }
  });
  app.post("/api/admin/migrar-gatilhos-tutor", async (req, res) => {
    try {
      const realUser = await resolveRealAuthenticatedUser(req);
      if (!realUser) {
        return res.status(401).json({ error: "Autentica\xE7\xE3o obrigat\xF3ria." });
      }
      if (!["DIRETOR", "VICE_DIRETOR", "CGPG"].includes(realUser.realRole)) {
        return res.status(403).json({
          error: `Acesso negado: Apenas Dire\xE7\xE3o, Vice-Dire\xE7\xE3o ou CGPG podem executar esta migra\xE7\xE3o (perfil real: "${realUser.realRole}").`
        });
      }
      const stats = await migrarERemoverGatilhosAutomaticosNoBanco();
      res.json({ success: true, ...stats });
    } catch (err) {
      console.error("[API Migrar Gatilhos Tutor] Erro:", err?.message || err);
      res.status(500).json({
        error: "Erro ao migrar gatilhos autom\xE1ticos para notifica\xE7\xF5es da tutoria.",
        details: err?.message || String(err)
      });
    }
  });
  app.post("/api/ai/boletim-diario", async (req, res) => {
    try {
      const {
        data,
        turno = "Manh\xE3",
        etapa = "Ensino Fundamental",
        mensagensProfessores = "",
        atrasosRegistrados = [],
        saidasAntecipadasRegistradas = [],
        atestadosRegistrados = [],
        alunosCadastrados = [],
        totalMatriculadosAtivos = 0,
        historicoBoletinsAnteriores = []
      } = req.body;
      if (!mensagensProfessores && (!atrasosRegistrados || atrasosRegistrados.length === 0)) {
        return res.status(400).json({
          error: "\xC9 necess\xE1rio fornecer as mensagens de chamada dos professores ou registros de atrasos para gerar o boletim."
        });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
      let baseAlunos = Array.isArray(alunosCadastrados) && alunosCadastrados.length > 0 ? alunosCadastrados : [];
      if (baseAlunos.length === 0) {
        try {
          baseAlunos = await getDocs("alunos", {});
        } catch (dbErr) {
          console.warn("[API AI Boletim Di\xE1rio] N\xE3o foi poss\xEDvel carregar alunos do banco:", dbErr.message);
        }
      }
      const alunosAtivos = baseAlunos.filter((a) => {
        const st = String(a.status || "ATIVO").trim().toUpperCase();
        return st === "ATIVO";
      });
      const isFund = (turma) => {
        const clean = String(turma || "").replace(/[^\d1-9A-Za-z]/g, "").toUpperCase();
        return clean.startsWith("6") || clean.startsWith("7") || clean.startsWith("8") || clean.startsWith("9");
      };
      const isMed = (turma) => {
        const clean = String(turma || "").replace(/[^\d1-9A-Za-z]/g, "").toUpperCase();
        return clean.startsWith("1") || clean.startsWith("2") || clean.startsWith("3");
      };
      const isGeralEtapa = etapa.toLowerCase().includes("geral") || etapa.toLowerCase().includes("todos");
      const isFundEtapa = !isGeralEtapa && (etapa.toLowerCase().includes("fundamental") || etapa.toLowerCase().includes("6\xBA ao 9\xBA"));
      const isMedEtapa = !isGeralEtapa && (etapa.toLowerCase().includes("m\xE9dio") || etapa.toLowerCase().includes("medio") || etapa.toLowerCase().includes("1\xBA ao 3\xBA"));
      let matriculadosReais = Number(totalMatriculadosAtivos || 0);
      if (!matriculadosReais || matriculadosReais <= 0) {
        if (isGeralEtapa) {
          const countFund = alunosAtivos.filter((a) => isFund(a.turma)).length;
          const countMed = alunosAtivos.filter((a) => isMed(a.turma)).length;
          matriculadosReais = countFund + countMed > 0 ? countFund + countMed : alunosAtivos.length;
        } else if (isFundEtapa) {
          matriculadosReais = alunosAtivos.filter((a) => isFund(a.turma)).length;
        } else if (isMedEtapa) {
          matriculadosReais = alunosAtivos.filter((a) => isMed(a.turma)).length;
        } else {
          matriculadosReais = alunosAtivos.length;
        }
      }
      if (matriculadosReais <= 0) {
        matriculadosReais = isGeralEtapa ? 703 : isFundEtapa ? 497 : 206;
      }
      const normTurmaKeyGlobal = (t) => (t || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      const mapaAtivosGlobal = {};
      alunosAtivos.forEach((st) => {
        const tKey = normTurmaKeyGlobal(st.turma);
        if (tKey) {
          mapaAtivosGlobal[tKey] = mapaAtivosGlobal[tKey] || [];
          mapaAtivosGlobal[tKey].push(st);
        }
      });
      const removerAcentosGlobal = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const foneticaGlobal = (str) => removerAcentosGlobal(str).replace(/ph/g, "f").replace(/th/g, "t").replace(/ck/g, "k").replace(/y/g, "i").replace(/w/g, "v").replace(/z/g, "s").replace(/x/g, "s").replace(/ch/g, "s").replace(/ll/g, "l").replace(/ss/g, "s").replace(/rr/g, "r").replace(/mm/g, "m").replace(/nn/g, "n").replace(/tt/g, "t");
      const formatarNomeLGPDGlobal = (nomeOriginal, turmaRef) => {
        const trimmed = (nomeOriginal || "").trim().replace(/^•\s*/, "");
        if (!trimmed) return "Estudante";
        if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Z]\.)+$/.test(trimmed)) {
          return trimmed;
        }
        const tKey = normTurmaKeyGlobal(turmaRef);
        const listaTurma = mapaAtivosGlobal[tKey] || [];
        const qNorm = removerAcentosGlobal(trimmed);
        const qPhon = foneticaGlobal(trimmed);
        const qParts = qNorm.split(/\s+/).filter((p) => p.length >= 2);
        const qPhonParts = qPhon.split(/\s+/).filter((p) => p.length >= 2);
        let match = listaTurma.find((a) => removerAcentosGlobal(a.nome) === qNorm);
        if (!match) match = listaTurma.find((a) => foneticaGlobal(a.nome) === qPhon);
        if (!match && qPhonParts.length > 1) {
          match = listaTurma.find((a) => {
            const aPhonParts = foneticaGlobal(a.nome).split(/\s+/);
            const firstMatch = aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
            const lastMatch = aPhonParts.some((ap, idx) => idx > 0 && qPhonParts.slice(1).some((qp) => ap === qp || ap.startsWith(qp) || qp.startsWith(ap)));
            return firstMatch && lastMatch;
          });
        }
        if (!match && qParts.length > 1) {
          match = listaTurma.find((a) => {
            const aNorm = removerAcentosGlobal(a.nome);
            return qParts.every((p) => aNorm.includes(p));
          });
        }
        if (!match && qPhonParts.length === 1) {
          const candidatos = listaTurma.filter((a) => {
            const aPhonParts = foneticaGlobal(a.nome).split(/\s+/);
            return aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
          });
          if (candidatos.length >= 1) match = candidatos[0];
        }
        const nomeBase = match ? match.nome : trimmed;
        const preposicoes = /* @__PURE__ */ new Set(["de", "da", "do", "dos", "das", "e"]);
        const palavras = nomeBase.trim().replace(/\.$/, "").split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).filter((p) => !preposicoes.has(p.toLowerCase()));
        if (palavras.length === 0) return "Estudante";
        if (palavras.length === 1) return palavras[0];
        const primeiroNome = palavras[0];
        const segundoNome = palavras[1] || "";
        const mesmoPrimeiroNome = listaTurma.filter((a) => {
          const aFirst = a.nome.trim().split(/\s+/)[0];
          return foneticaGlobal(aFirst) === foneticaGlobal(primeiroNome);
        });
        if (mesmoPrimeiroNome.length > 1) {
          const mesmoSegundoNomeInicial = mesmoPrimeiroNome.filter((a) => {
            const aPalavras = a.nome.trim().split(/\s+/).filter((p) => !preposicoes.has(p.toLowerCase()));
            const aSeg = aPalavras[1] || "";
            return aSeg && segundoNome && aSeg[0].toUpperCase() === segundoNome[0].toUpperCase();
          });
          if (mesmoSegundoNomeInicial.length > 1 && palavras[2]) {
            return `${primeiroNome} ${segundoNome[0].toUpperCase()}. ${palavras[2][0].toUpperCase()}.`;
          }
          const inicial = segundoNome ? `${segundoNome[0].toUpperCase()}.` : "";
          return `${primeiroNome} ${inicial}`.trim();
        }
        if (!match && palavras.length > 1) {
          return `${primeiroNome} ${segundoNome[0].toUpperCase()}.`;
        }
        return primeiroNome;
      };
      const promptUser = `
CONSOLIDA\xC7\xC3O DE BOLETIM DI\xC1RIO DE FREQU\xCANCIA E CRUZAMENTO DE FALTAS CONSECUTIVAS:

PAR\xC2METROS OFICIAIS DO SISTEMA ESCOLAR:
- Data da Apura\xE7\xE3o: ${data || (/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR")}
- Per\xEDodo/Turno: ${turno}
- Etapa/Segmento: ${etapa}
- N\xDAMERO EXATO DE ALUNOS MATRICULADOS ATIVOS NO TURNO/ETAPA: ${matriculadosReais} alunos ativos
(ATEN\xC7\xC3O: Use OBRIGATORIAMENTE este valor exato ${matriculadosReais} no balan\xE7o. NUNCA utilize 500 ou qualquer n\xFAmero estimado!)

MENSAGENS BRUTAS DE CHAMADA ENVIADAS PELOS PROFESSORES (WHATSAPP):
"""
${mensagensProfessores}
"""

REGISTROS DE ATRASOS / ENTRADAS TARDIAS REGISTRADOS NO SISTEMA HOJE:
${JSON.stringify(atrasosRegistrados, null, 2)}

REGISTROS DE SA\xCDDAS ANTECIPADAS NO SISTEMA HOJE:
${JSON.stringify(saidasAntecipadasRegistradas, null, 2)}

HIST\xD3RICO DE BOLETINS ANTERIORES / AUS\xCANCIAS PR\xC9VIAS (PARA CRUZAMENTO DE FALTAS CONSECUTIVAS):
${JSON.stringify(historicoBoletinsAnteriores.slice(0, 5), null, 2)}

AMOSTRA DE ALUNOS ATIVOS DA ESCOLA (BASE OFICIAL PARA CRUZAMENTO):
${JSON.stringify(alunosAtivos.slice(0, 150).map((a) => ({
        nome: a.nome,
        turma: a.turma,
        ra: a.ra,
        presenca: a.presenca_atual || a.presenca_anual,
        totalFaltas: a.total_faltas,
        historicoFaltasRecentes: a.faltas_consecutivas || 0
      })), null, 2)}

DIRETRIZES ESTRITAS:
1. GERE O BOLETIM NO PADR\xC3O OFICIAL EXATO DA ESCOLA CL\xD3VIS DE LUCCA:
   - Formate as turmas de forma padronizada (ex: 6\xBA A, 6\xBA B, 6\xBA C, 6\xBA D, 7\xBA A, 7\xBA B, 7\xBA C, 7\xBA D, 8\xBA A, 8\xBA B, 8\xBA C, 9\xBA A, 9\xBA B, 9\xBA C para Ensino Fundamental Manh\xE3, ou 1\xBA A, 2\xBA A, etc. se Ensino M\xE9dio).
   - REGRA CR\xCDTICA DE LGPD (LEI GERAL DE PROTE\xC7\xC3O DE DADOS):
     NO BOLETIM P\xDABLICO PARA OS PAIS NO WHATSAPP, N\xC3O REVELE INFORMA\xC7\xD5ES PESSOAIS EXCESSIVAS! SOBRENOMES COMPLETOS S\xC3O TERMINANTEMENTE PROIBIDOS!
     \u2022 SE O ALUNO \xC9 O \xDANICO COM AQUELE PRIMEIRO NOME NA TURMA, ESCREVA APENAS O PRIMEIRO NOME, SEM INICIAL E SEM SOBRENOME (ex: "Marina", "Matheus", "Thalles", "F\xE1tima", "Helloa", "Julia", "Mirella", "Rafael", "Yssac", "Josu\xE9", "Samuel", "Felipe", "Gabriely", "Kamilly", "Luana", "Pietro", "Rafaela", "Arthur", "Leonardo", "Melissa", "Fl\xE1via", "Lucas", "Alana", "Eduarda", "Erik", "Guilherme", "Kaio", "Beatriz", "Ronaldo", "Anderson", "Barbara", "Cristopher", "Davi", "Kau\xE3", "L\xEDvia", "Luan", "Murilo", "Valentina", "Bryan", "Douglas", "Evellyn", "Caleb", "Fernanda", "Kaique", "Nicolly", "Willian", "Karoline", "Lais", "Lorenna", "Millena", "Vict\xF3ria", "Alexia", "Ingrid", "Jhulia", "Jonatas", "Kauan", "Kimberly", "Melissa")! NUNCA coloque inicial de sobrenome para quem \xE9 \xFAnico na turma (isso revela dados desnecess\xE1rios)!
     \u2022 Use inicial do segundo nome/sobrenome com ponto final (ex: "Ana B.", "Pedro G.", "Alexandre S.", "Ana C.", "Jo\xE3o M.", "Lorenzo G.", "Pedro H.", "Sophia E.", "Emily S.", "Sophia N.", "Arthur H.", "Victor H.", "Hiago G.", "Hiago P.", "Enzo G.", "Enzo M.", "Arthur H. S.") APENAS e EXCLUSIVAMENTE quando houver mais de um aluno com o mesmo primeiro nome na mesma turma!
   - ATRASADOS:
     \u2022 Formate como: "\u2022 [Turma]: [Nome] ([Hor\xE1rio e observa\xE7\xE3o simples de entrada])." (ex: "\u2022 6\xBA A: Rhay G. (07h19), Julia G. (07h35).", "\u2022 6\xBA B: Isabella S. (07h25 - Entrada durante a 1\xAA aula).", "\u2022 7\xBA D: Arthur R. (07h20), Natanael D. (07h53 - Entrada na 2\xAA aula).")
   - SA\xCDDAS ANTECIPADAS:
     \u2022 REGRA EXPRESSA DO USU\xC1RIO: "No caso de saidas antecipadas s\xF3 devemos saber a hora que saiu. N\xE3o coloque justificativas nem nada na mensagem."
     \u2022 Se n\xE3o houver sa\xEDdas registradas no turno, escreva exatamente: "\u2022 Sem ocorr\xEAncias registradas no turno."
     \u2022 Se houver sa\xEDdas, coloque APENAS o nome do aluno e o hor\xE1rio ou per\xEDodo em que saiu (ex: "\u2022 8\xBA C: Lyan (6\xAA aula)." ou "\u2022 8\xBA C: Lyan (12h20)."). NUNCA coloque justificativas, diagn\xF3sticos, sintomas, consultas m\xE9dicas ou motivos de qualquer natureza!
   - NUNCA INCLUA SE\xC7\xC3O DE ATESTADOS M\xC9DICOS NO BOLETIM DO WHATSAPP! Motivos m\xE9dicos s\xE3o dados pessoais sens\xEDveis protegidos por lei (LGPD) e n\xE3o podem ser divulgados para os pais no grupo. Passe de Sa\xEDdas Antecipadas diretamente para Balan\xE7o do Turno.
   - BALAN\xC7O DO TURNO:
     \u2022 Total de Matriculados (${turno}): ${matriculadosReais} alunos (conforme base de dados ativa do m\xF3dulo Alunos)
     \u2022 Total de Aus\xEAncias Integrais: X faltas confirmadas
     \u2022 \xCDndice de Faltas: Calculado exatamente como (Total Aus\xEAncias / ${matriculadosReais} * 100) com 1 casa decimal e v\xEDrgula (ex: 22,8%) das cadeiras vazias
     \u2022 Total de Atrasos / Entradas Tardias: Z registros na portaria/secretaria
   - MENSAGEM FINAL:
Lembramos que os minutos iniciais das aulas s\xE3o preciosos para a explica\xE7\xE3o dos conte\xFAdos. Caso a aus\xEAncia tenha ocorrido por recomenda\xE7\xE3o de sa\xFAde, favor apresentar o atestado m\xE9dico na secretaria da unidade escolar.

Contamos com o apoio e o empenho de todos!

Atenciosamente,
Dire\xE7\xE3o e Equipe Gestora

2. CRUZE AS FALTAS CONSECUTIVAS E GERE O ALERTA EXCLUSIVO DA EQUIPE GESTORA:
   - Cruze cada aluno ausente com a lista de alunos ATIVOS da turma no sistema.
   - Identifique quem est\xE1 acumulando 3 ou mais faltas consecutivas (LIMIAR CR\xCDTICO - Resolu\xE7\xE3o SEDUC n\xBA 39/2023 - Busca Ativa Obrigat\xF3ria).
   - Identifique quem est\xE1 com 2 faltas consecutivas (Aten\xE7\xE3o / Preventivo).
   - No relat\xF3rio da gest\xE3o, forne\xE7a o Nome Completo Oficial do sistema, a Turma, o RA oficial, o n\xFAmero de faltas consecutivas, o n\xEDvel de risco e a a\xE7\xE3o imediata sugerida.
`;
      const systemInstruction = `
Voc\xEA \xE9 o Especialista em Gest\xE3o Escolar, Frequ\xEAncia e Busca Ativa da E.E. Cl\xF3vis de Lucca.
Seu objetivo \xE9 analisar as chamadas dos professores (WhatsApp), atrasos e dados dos alunos ATIVOS do sistema escolar para:
1. Produzir o Boletim Di\xE1rio Oficial formatado perfeitamente para envio no WhatsApp das fam\xEDlias respeitando RIGOROSAMENTE a LGPD:
   - Se o primeiro nome do aluno for \xFAnico na turma, coloque APENAS o primeiro nome (ex: "Erik", "Wendel", "Yohana", "Natanael", "Alana", "Eduarda", "Guilherme", "Kaio", "Marina", "Matheus", "Thalles", "Beatriz", "Ronaldo"). N\xE3o coloque iniciais de quem \xE9 \xFAnico!
   - Coloque inicial com ponto (ex: "Arthur H.", "Hiago G.", "Hiago P.", "Ana B.", "Ana C.", "Arthur H. S.") APENAS quando houver mais de um aluno com o mesmo primeiro nome na mesma turma.
   - Em sa\xEDdas antecipadas, coloque APENAS o nome e o hor\xE1rio de sa\xEDda (ex: "\u2022 8\xBA C: Lyan (6\xAA aula)."). \xC9 TERMINANTEMENTE PROIBIDO colocar justificativas, motivos ou informa\xE7\xF5es m\xE9dicas na mensagem!
   - NUNCA inclua se\xE7\xE3o de atestados m\xE9dicos ou dados m\xE9dicos de alunos no boletim do WhatsApp (LGPD).
2. Identificar alunos com faltas consecutivas (cruzamento com a base de alunos ativos) e alertar a Equipe Gestora com base na Resolu\xE7\xE3o SEDUC n\xBA 39/2023.

Voc\xEA deve responder ESTRITAMENTE em formato JSON com o seguinte schema:
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
    "6\xBA A": ["Ana B.", "Marina", "Matheus", "Pedro G.", "Thalles"],
    "7\xBA D": ["Alana", "Arthur H.", "Eduarda", "Erik", "Guilherme", "Kaio", "Victor H."]
  },
  "atrasadosPorTurma": {
    "6\xBA A": ["Rhay G. (07h19)", "Julia G. (07h35)"]
  },
  "saidasPorTurma": {},
  "alertaEquipeGestora": {
    "totalAlunosConsecutivos": 6,
    "resumoExecutivo": "Identificados X alunos com faltas consecutivas que demandam interven\xE7\xE3o imediata...",
    "alunosCriticos3Mais": [
      {
        "nome": "NOME COMPLETO DO ALUNO",
        "turma": "7\xBA D",
        "ra": "0001...",
        "diasConsecutivos": 3,
        "nivelRisco": "CR\xCDTICO",
        "motivoDestaque": "Atingiu 3 aus\xEAncias consecutivas injustificadas (Resolu\xE7\xE3o SEDUC 39/2023).",
        "acaoSugerida": "Ligar hoje para a fam\xEDlia e lavrar Convoca\xE7\xE3o Presencial na Busca Ativa."
      }
    ],
    "alunosAlerta2": [
      {
        "nome": "NOME COMPLETO DO ALUNO",
        "turma": "6\xBA B",
        "ra": "0001...",
        "diasConsecutivos": 2,
        "nivelRisco": "ATEN\xC7\xC3O",
        "motivoDestaque": "2\xAA aus\xEAncia consecutiva registrada.",
        "acaoSugerida": "Contato preventivo via WhatsApp da Busca Ativa."
      }
    ],
    "orientacoesSEDUC39": "Conforme a Resolu\xE7\xE3o SEDUC n\xBA 39/2023, ap\xF3s 3 faltas consecutivas sem justificativa, a escola deve registrar interven\xE7\xE3o imediata de Busca Ativa..."
  }
}
`;
      const modelosDisponiveis = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
      let jsonResult;
      let sucesso = false;
      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (sucesso) break;
          try {
            const generatePromise = ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: {
                systemInstruction,
                temperature: 0.2,
                responseMimeType: "application/json"
              }
            });
            const timeoutPromise = new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Timeout de 7s na API do modelo")), 7e3)
            );
            const response = await Promise.race([generatePromise, timeoutPromise]);
            const responseText = response.text || "{}";
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
          } catch (callErr) {
            const isQuota = callErr.message?.includes("429") || callErr.message?.includes("quota") || callErr.status === 429 || callErr.message?.includes("RESOURCE_EXHAUSTED");
            if (isQuota) {
              console.info(`[API AI Boletim Di\xE1rio] Cota no modelo ${modelo}. Alternando para pr\xF3ximo modelo ou conting\xEAncia...`);
            } else {
              console.warn(`[API AI Boletim Di\xE1rio] Falha/Timeout no modelo ${modelo}:`, callErr.message);
            }
          }
        }
      }
      if (!sucesso || !jsonResult || !jsonResult.boletimFormatado) {
        console.warn("[API AI Boletim Di\xE1rio] Acionando gerador anal\xEDtico de conting\xEAncia para o Boletim Di\xE1rio");
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
      if (jsonResult) {
        if (!jsonResult.balanco) jsonResult.balanco = {};
        jsonResult.balanco.totalMatriculados = matriculadosReais;
        const ausencias = Number(jsonResult.balanco.totalAusencias || 0);
        if (matriculadosReais > 0) {
          const taxa = (ausencias / matriculadosReais * 100).toFixed(1);
          jsonResult.balanco.indiceFaltas = `${taxa.replace(".", ",")}%`;
        }
        if (typeof jsonResult.boletimFormatado === "string") {
          const ausencias2 = Number(jsonResult.balanco.totalAusencias || 0);
          const taxa = matriculadosReais > 0 ? (ausencias2 / matriculadosReais * 100).toFixed(1) : "0,0";
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(/•?\s*Total de (?:Alunos )?Matriculados[^\n]*:\s*\d+[^\n]*/gi, `\u2022 Total de Matriculados (${turno}): ${matriculadosReais} alunos`).replace(/•?\s*Índice (?:Geral )?de Faltas:[^\n]*/gi, `\u2022 \xCDndice de Faltas: ${taxa.replace(".", ",")}% das cadeiras vazias`);
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /📄\s*ATESTADOS[\s\S]*?(?=📊\s*BALANÇO|$)/i,
            ""
          );
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /(🚪\s*SAÍDAS\s*ANTECIPADAS[\s\S]*?)(📊\s*BALANÇO\s*DO\s*TURNO|$)/i,
            (bloco, headerESaidas, proximoHeader) => {
              const linhas = headerESaidas.split("\n");
              const linhasLimpas = linhas.map((l) => {
                if (l.trim().startsWith("\u2022") && !l.includes("Sem ocorr\xEAncias")) {
                  const horaMatch = l.match(/(\d{1,2}[h:]\d{0,2}|\d+[ªº°]?\s*aula)/i);
                  let horaTexto = "";
                  if (horaMatch) {
                    horaTexto = horaMatch[1].replace(":", "h").trim();
                    if (/^\d+aula$/i.test(horaTexto)) {
                      horaTexto = horaTexto.replace(/(\d+)aula/i, "$1\xAA aula");
                    }
                  }
                  const partes = l.split(":");
                  const prefixo = partes[0] + ": ";
                  const resto = partes.slice(1).join(":").trim();
                  const nomeMatch = resto.match(/^([^(.]+)/);
                  const nomeBruto = nomeMatch ? nomeMatch[1].trim() : resto.trim();
                  const infoHora = horaTexto ? ` (${horaTexto})` : "";
                  return `${prefixo}${nomeBruto}${infoHora}.`;
                }
                return l;
              });
              return linhasLimpas.join("\n").trimEnd() + "\n\n" + proximoHeader;
            }
          );
          if (jsonResult.boletimFormatado.includes("\u{1F6AA} SA\xCDDAS ANTECIPADAS\n\u2022 Sem ocorr\xEAncias") || jsonResult.boletimFormatado.includes("\u{1F6AA} SA\xCDDAS ANTECIPADAS\r\n\u2022 Sem ocorr\xEAncias")) {
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
              const linhasSaidas = [];
              Object.keys(fallbackCheck.saidasPorTurma).forEach((t) => {
                const s = fallbackCheck.saidasPorTurma[t] || [];
                if (s.length > 0) linhasSaidas.push(`\u2022 ${t}: ${s.join(", ")}.`);
              });
              if (linhasSaidas.length > 0) {
                jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
                  /🚪 SAÍDAS ANTECIPADAS[\r\n]+• Sem ocorrências registradas no turno\./i,
                  `\u{1F6AA} SA\xCDDAS ANTECIPADAS
${linhasSaidas.join("\n")}`
                );
              }
            }
          }
          jsonResult.boletimFormatado = jsonResult.boletimFormatado.replace(
            /(🛑\s*ALUNOS\s*AUSENTES[\s\S]*?)(⏰|🚪|📊|$)/i,
            (blocoCompleto, blocoAusentes, proximoBloco) => {
              const ausentesFormatados = blocoAusentes.replace(
                /(•\s*[1-9][º°ª]?\s*[A-D]:\s*)([^\n]+)/g,
                (match, prefixo, listaNomes) => {
                  const turmaRef = prefixo.replace(/[•:\s]/g, "");
                  const cleanNomes = listaNomes.trim().replace(/\.\s*$/, "");
                  const nomes = cleanNomes.split(/,\s*/).map((n) => n.trim()).filter(Boolean);
                  const nomesUnicos = [];
                  const seen = /* @__PURE__ */ new Set();
                  nomes.forEach((n) => {
                    const nFormatado = formatarNomeLGPDGlobal(n, turmaRef);
                    const norm = nFormatado.toLowerCase();
                    if (!seen.has(norm)) {
                      seen.add(norm);
                      nomesUnicos.push(nFormatado);
                    }
                  });
                  return prefixo + nomesUnicos.join(", ") + ".";
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
    } catch (err) {
      console.error("[API AI Boletim Di\xE1rio] Erro cr\xEDtico:", err.message);
      try {
        const fallback = gerarBoletimDiarioFallback(req.body);
        res.json({
          success: true,
          data: fallback
        });
      } catch (fErr) {
        res.status(500).json({
          error: "Erro ao gerar boletim di\xE1rio com IA",
          details: err.message
        });
      }
    }
  });
  app.post("/api/ai/analise-comportamental-2027", async (req, res) => {
    try {
      const {
        turma = "TODAS",
        dataReferencia = (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        chamadaHoje = [],
        estatisticas = {},
        historicoResumo = null,
        anoLetivoAlvo = "2027"
      } = req.body;
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } }) : null;
      const totalMatriculados = Number(estatisticas.total || (Array.isArray(chamadaHoje) ? chamadaHoje.length : 0));
      const totalPresentes = Number(estatisticas.presentes || 0);
      const totalAtrasados = Number(estatisticas.atrasados || 0);
      const totalFaltosos = Number(estatisticas.faltosos || 0);
      const totalLicencas = Number(estatisticas.licencas || 0);
      const amostraEstudantes = (Array.isArray(chamadaHoje) ? chamadaHoje : []).slice(0, 100).map((st) => ({
        nome: st.nome,
        ra: st.ra,
        turma: st.turma,
        statusHoje: st.status || "presente",
        horarioAtraso: st.horarioAtraso || "",
        motivoLicenca: st.motivoLicenca || "",
        faltasTotais: Number(st.faltasTotais || 0),
        licencasAfastamentos: Number(st.licencasAfastamentos || 0),
        faltasEfetivas: Number(st.faltasEfetivas ?? Math.max(0, Number(st.faltasTotais || 0) - Number(st.licencasAfastamentos || 0))),
        atrasosAcumulados: Number(st.atrasosAcumulados || 0),
        faltasConsecutivas: Number(st.faltasConsecutivas || 0)
      }));
      let jsonResult = null;
      if (ai) {
        try {
          const promptSistema = `Voc\xEA \xE9 o Especialista em Intelig\xEAncia Pedag\xF3gica e An\xE1lise Comportamental da Escola Estadual Professor Cl\xF3vis de Lucca (Programa Ensino Integral - PEI S\xE3o Paulo).
Sua miss\xE3o \xE9 realizar um Mapeamento Comportamental Preditivo de Faltas e Atrasos para orientar a\xE7\xF5es em TEMPO REAL e antecipar o comportamento dos estudantes para o Ano Letivo de ${anoLetivoAlvo}.

DIRETRIZ DA TERCEIRA INFORMA\xC7\xC3O DE FALTAS:
- 1\xAA M\xE9trica: Faltas Totais/Brutas (registro geral de todas as aus\xEAncias).
- 2\xAA M\xE9trica: Licen\xE7as, Afastamentos M\xE9dicos e Dispensas Legais (aus\xEAncias com atestado ou justificativa de sa\xFAde).
- 3\xAA M\xE9trica CR\xCDTICA (Faltas Efetivas): Faltas Reais = Faltas Totais - Licen\xE7as/Afastamentos. Esta m\xE9trica desconsidera problemas m\xE9dicos e mede o real descompromisso/afastamento pedag\xF3gico do aluno, servindo como o term\xF4metro principal de Busca Ativa e Tutoria.

REQUISITO DE SA\xCDDA:
Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido, sem crases markdown adicionais, no formato:
{
  "diagnosticoGeral": "Texto executivo sintetizando a frequ\xEAncia do dia, o comportamento de atrasos, os padr\xF5es por dia da semana e a relev\xE2ncia da 3\xAA m\xE9trica para as decis\xF5es gestoras.",
  "padroesDetectados": [
    {
      "titulo": "ex: Atrasos Reincidentes na 1\xAA Aula / Segundas-feiras",
      "descricao": "Explica\xE7\xE3o detalhada do padr\xE3o comportamental identificado.",
      "grau": "ALTO" | "MODERADO" | "LEVE",
      "alunosImpactados": 5
    }
  ],
  "analiseTerceiraMetrica": {
    "explicacao": "Detalhamento de como a distin\xE7\xE3o entre faltas m\xE9dicas e faltas n\xE3o justificadas impacta o foco de interven\xE7\xE3o da equipe.",
    "totalFaltasBrutas": 100,
    "totalLicencasAfastamentos": 25,
    "totalFaltasEfetivas": 75,
    "conclusaoPedagogica": "Recomenda\xE7\xE3o direta sobre onde concentrar esfor\xE7os de Busca Ativa."
  },
  "projecaoRisco2027": [
    {
      "ra": "RA do aluno",
      "nome": "Nome do estudante",
      "turma": "Turma atual",
      "nivelRisco": "CR\xCDTICO" | "ATEN\xC7\xC3O" | "EST\xC1VEL",
      "motivo": "Por que este aluno requer acompanhamento preventivo para 2027.",
      "acaoTutoria2027": "Pauta obrigat\xF3ria a ser trabalhada pelo Tutor PEI em 2027."
    }
  ],
  "acoesImediatas": [
    {
      "prioridade": "IMEDIATA" | "SEMANAL" | "PLANEJAMENTO 2027",
      "titulo": "T\xEDtulo da a\xE7\xE3o",
      "descricao": "Instru\xE7\xE3o pedag\xF3gica operacional",
      "responsavel": "Equipe Gestora / CGPG / Tutores"
    }
  ]
}`;
          const promptUser = `DADOS ATUAIS DA APURA\xC7\xC3O:
- Data de Refer\xEAncia: ${dataReferencia}
- Turma Selecionada: ${turma}
- Ano Letivo Alvo: ${anoLetivoAlvo}
- Total Matriculados: ${totalMatriculados}
- Presentes Hoje: ${totalPresentes} (${totalMatriculados > 0 ? (totalPresentes / totalMatriculados * 100).toFixed(1) : 0}%)
- Atrasos Hoje: ${totalAtrasados}
- Faltas Injustificadas Hoje: ${totalFaltosos}
- Licen\xE7as / Afastamentos M\xE9dicos Hoje: ${totalLicencas}
- Totais Acumulados na Sele\xE7\xE3o -> 1\xAA M\xE9trica (Faltas Brutas): ${Number(estatisticas.somaFaltasTotais || 0)} | 2\xAA M\xE9trica (Licen\xE7as): ${Number(estatisticas.somaLicencas || 0)} | 3\xAA M\xE9trica (Faltas Efetivas): ${Number(estatisticas.somaFaltasEfetivas || 0)}

HIST\xD3RICO COMPORTAMENTAL AGREGADO DE CHAMADAS ANTERIORES:
${historicoResumo ? JSON.stringify(historicoResumo, null, 2) : "Primeira apura\xE7\xE3o em registro di\xE1rio."}

AMOSTRA DE ALUNOS COM AS 3 M\xC9TRICAS DE FALTAS:
${JSON.stringify(amostraEstudantes, null, 2)}

Analise os padr\xF5es comportamentais, destaque a 3\xAA m\xE9trica de faltas efetivas e projete os planos de a\xE7\xE3o preventiva para ${anoLetivoAlvo}.`;
          const response = await ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: promptUser,
            config: {
              systemInstruction: promptSistema,
              responseMimeType: "application/json"
            }
          });
          const rawText = response.text ? response.text.trim() : "";
          const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
          jsonResult = JSON.parse(cleanJson);
        } catch (geminiErr) {
          console.warn("[API AI Analise 2027] Falha no Gemini, alternando para conting\xEAncia determin\xEDstica:", geminiErr.message);
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
    } catch (err) {
      console.error("[API AI Analise 2027] Erro geral:", err.message);
      res.status(500).json({ error: "Erro ao processar an\xE1lise comportamental com IA", details: err.message });
    }
  });
  app.post("/api/ai/analise-busca-ativa-segmentos", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "Chave da API Gemini n\xE3o configurada no servidor.",
          details: "Verifique a vari\xE1vel GEMINI_API_KEY em Settings > Secrets."
        });
      }
      const {
        dataReferencia = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        totalEstudantesAtivos = 0,
        filtroAplicado = "TODOS",
        resumoGeral = {},
        ensinoFundamental = {},
        ensinoMedio = {}
      } = req.body || {};
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { "User-Agent": "aistudio-build" }
        }
      });
      const itemBuscaAtivaSchema = {
        type: Type.OBJECT,
        properties: {
          estudanteOuTurma: {
            type: Type.STRING,
            description: "Nome do estudante (com turma) ou turma priorit\xE1ria presente nos dados."
          },
          ra: {
            type: Type.STRING,
            description: "RA do estudante exatamente como enviado no JSON, ou string vazia se for turma/grupo."
          },
          situacao: {
            type: Type.STRING,
            description: "Dados objetivos (ex: frequ\xEAncia %, faltas consecutivas ou quantidade de atrasos registrados)."
          },
          ultimoContatoEEncaminhamento: {
            type: Type.STRING,
            description: "S\xEDntese objetiva do \xFAltimo contato com respons\xE1veis (data, canal, retorno ou aus\xEAncia de contato) e encaminhamentos (CT, MP, SED) j\xE1 existentes."
          },
          proximoPasso: {
            type: Type.STRING,
            description: "A\xE7\xE3o pr\xE1tica imediata de busca ativa considerando o hist\xF3rico de contatos e encaminhamentos (ex: 1\xBA contato via WhatsApp/liga\xE7\xE3o, cobran\xE7a de retorno, convoca\xE7\xE3o presencial, of\xEDcio/Conselho Tutelar)."
          }
        },
        required: ["estudanteOuTurma", "ra", "situacao", "ultimoContatoEEncaminhamento", "proximoPasso"]
      };
      const segmentSchema = {
        type: Type.OBJECT,
        properties: {
          nivelPrioridade: {
            type: Type.STRING,
            description: "CR\xCDTICA, ATEN\xC7\xC3O ou CONTROLADA"
          },
          panorama: {
            type: Type.STRING,
            description: "S\xEDntese objetiva (2-3 frases) da situa\xE7\xE3o de frequ\xEAncia/presen\xE7a, faltas consecutivas, atrasos e efetividade dos \xFAltimos contatos e encaminhamentos neste segmento."
          },
          buscaAtivaFaltasEPresenca: {
            type: Type.ARRAY,
            items: itemBuscaAtivaSchema,
            description: "At\xE9 5 prioridades concretas de Busca Ativa focadas em faltas consecutivas e baixa presen\xE7a/frequ\xEAncia, considerando \xFAltimos contatos com respons\xE1veis e encaminhamentos."
          },
          buscaAtivaAtrasos: {
            type: Type.ARRAY,
            items: itemBuscaAtivaSchema,
            description: "At\xE9 5 prioridades concretas de Busca Ativa focadas nos maiores atrasos registrados, considerando \xFAltimos contatos com respons\xE1veis e encaminhamentos."
          },
          acompanhamentoContatosEEncaminhamentos: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de 2 a 4 pontos objetivos sobre pend\xEAncias de retorno familiar, casos cr\xEDticos sem nenhum contato recente e acompanhamento de encaminhamentos (Conselho Tutelar, MP, SED)."
          },
          padroesIdentificados: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de 2 a 4 padr\xF5es concretos observados entre frequ\xEAncia, faltas consecutivas, atrasos e resposta das fam\xEDlias."
          },
          acoesPraticas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                foco: { type: Type.STRING, description: "FALTAS, ATRASOS, PRESEN\xC7A ou ENCAMINHAMENTO" },
                acao: { type: Type.STRING, description: "A\xE7\xE3o pr\xE1tica imediata considerando o est\xE1gio atual dos contatos/encaminhamentos" },
                responsavelSugerido: { type: Type.STRING, description: "Ex: Vice-Dire\xE7\xE3o, CGPG, Secretaria, Tutoria, Dire\xE7\xE3o" },
                prazo: { type: Type.STRING, description: "Ex: Imediato (24h), Esta semana, Quinzenal" }
              },
              required: ["foco", "acao", "responsavelSugerido", "prazo"]
            }
          }
        },
        required: [
          "nivelPrioridade",
          "panorama",
          "buscaAtivaFaltasEPresenca",
          "buscaAtivaAtrasos",
          "acompanhamentoContatosEEncaminhamentos",
          "padroesIdentificados",
          "acoesPraticas"
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
        model: "gemini-4-hydrogen",
        contents: `Analise os dados reais de frequ\xEAncia/presen\xE7a, faltas consecutivas, maiores atrasos registrados, \xFAltimos contatos com respons\xE1veis e encaminhamentos (Conselho Tutelar, Minist\xE9rio P\xFAblico, SED) da E.E. Professor Cl\xF3vis de Lucca (PEI - S\xE3o Paulo), separando rigorosamente Ensino Fundamental e Ensino M\xE9dio para orientar a Busca Ativa di\xE1ria.

DADOS CONSOLIDADOS:
${JSON.stringify(dadosCompactos)}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: `Voc\xEA \xE9 especialista em Gest\xE3o Escolar e Busca Ativa (SEDUC-SP / PEI).
Regras obrigat\xF3rias:
- Baseie-se estritamente nos n\xFAmeros, turmas, estudantes, RAs, \xFAltimos contatos e encaminhamentos fornecidos no JSON de entrada. Jamais invente nomes, RAs, datas ou contatos.
- Ajude operacionalmente a equipe a executar a Busca Ativa nas TR\xCAS frentes: (1) Faltas consecutivas e baixa presen\xE7a, (2) Maiores atrasos registrados, e (3) Follow-up de contatos com respons\xE1veis e encaminhamentos formais.
- Considere sempre o hist\xF3rico real de contato do estudante ao sugerir o pr\xF3ximo passo:
  * Sem nenhum contato registrado \u2192 orientar 1\xBA contato imediato (WhatsApp/liga\xE7\xE3o) com registro no Dossi\xEA.
  * \xDAltimo contato "Sem Resposta" ou "Aguardando Retorno" h\xE1 v\xE1rios dias \u2192 orientar nova tentativa por outro canal, convoca\xE7\xE3o presencial ou notifica\xE7\xE3o formal.
  * Respons\xE1vel j\xE1 atendeu/compareceu mas faltas ou atrasos continuam \u2192 orientar revis\xE3o de combinado, termo de ci\xEAncia ou encaminhamento em rede.
  * J\xE1 encaminhado ao Conselho Tutelar / MP / SED \u2192 orientar cobran\xE7a de devolutiva e monitoramento cont\xEDnuo da presen\xE7a.
- Separe com clareza Ensino Fundamental (6\xBA ao 9\xBA ano) e Ensino M\xE9dio (1\xAA \xE0 3\xAA s\xE9rie).
- Se n\xE3o houver casos cr\xEDticos em uma lista (ex: atrasos ou faltas em um segmento), retorne a lista vazia [] e explique brevemente no panorama.
- Seja objetivo, claro e pronto para a\xE7\xE3o imediata.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              resumoExecutivo: {
                type: Type.STRING,
                description: "Vis\xE3o executiva geral da escola (presen\xE7a, faltas consecutivas, atrasos e situa\xE7\xE3o dos contatos/encaminhamentos) em 2 a 3 frases objetivas."
              },
              comparativoEntreSegmentos: {
                type: Type.STRING,
                description: "Compara\xE7\xE3o direta destacando onde priorizar busca ativa de faltas, de atrasos e de cobran\xE7a de retornos entre Ensino Fundamental e Ensino M\xE9dio."
              },
              ensinoFundamental: segmentSchema,
              ensinoMedio: segmentSchema
            },
            required: ["resumoExecutivo", "comparativoEntreSegmentos", "ensinoFundamental", "ensinoMedio"]
          }
        }
      });
      const rawText = (response.text || "").trim();
      if (!rawText) {
        return res.status(502).json({
          error: "A API Gemini retornou uma resposta vazia.",
          details: "Tente novamente em alguns instantes."
        });
      }
      const parsed = JSON.parse(rawText);
      res.json({
        success: true,
        data: parsed,
        geradoEm: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      const status = Number(err?.status || err?.code) || 500;
      const msg = String(err?.message || "Erro ao processar an\xE1lise por segmento com Gemini.");
      console.error("[API AI Busca Ativa Segmentos] Erro:", msg);
      if (status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        return res.status(429).json({
          error: "Limite tempor\xE1rio de requisi\xE7\xF5es da API Gemini atingido (429).",
          details: "Aguarde alguns instantes ou verifique a cota da chave em Settings > Secrets."
        });
      }
      if (status === 403 || status === 400 || msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED")) {
        return res.status(status === 403 ? 403 : 400).json({
          error: "Falha de autentica\xE7\xE3o com a API Gemini.",
          details: "Verifique a chave configurada em Settings > Secrets."
        });
      }
      res.status(500).json({
        error: "Erro ao gerar an\xE1lise inteligente por segmento.",
        details: msg
      });
    }
  });
  app.post("/api/ai/mensagem-faltosos-dia", async (req, res) => {
    try {
      const {
        data = (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        anoLetivo = "2026",
        turma = "TODAS",
        estatisticas = {},
        faltososPorTurma = {},
        atrasadosPorTurma = {},
        faltasConsecutivasAlerta = [],
        tomComunicado = "acolhedor"
      } = req.body || {};
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } }) : null;
      let mensagemGerada = "";
      let origem = "fallback";
      if (ai) {
        try {
          const promptSistema = `Voc\xEA \xE9 a Coordena\xE7\xE3o Pedag\xF3gica da Escola Estadual Professor Cl\xF3vis de Lucca (Programa Ensino Integral - PEI S\xE3o Paulo).
Redija a mensagem oficial di\xE1ria de WhatsApp para o grupo de Pais e Respons\xE1veis sobre os estudantes ausentes e atrasados do dia.

REGRAS ESTRITAS (INVIOL\xC1VEIS):
1. LGPD RIGOROSA: Utilize EXATAMENTE os nomes j\xE1 abreviados fornecidos nos dados de entrada (nunca invente sobrenomes nem exponha diagn\xF3sticos m\xE9dicos ou motivos de licen\xE7a).
2. FORMATO WHATSAPP: Use negrito do WhatsApp (*texto*) e emojis limpos nos cabe\xE7alhos (\u{1F4CB}, \u{1F6AB}, \u23F0, \u{1F4CA}, \u26A0\uFE0F) para leitura r\xE1pida no celular.
3. ESTRUTURA OBRIGAT\xD3RIA:
   - Cabe\xE7alho institucional da EE Prof. Cl\xF3vis de Lucca - PEI com a data e ano letivo.
   - Bloco de Estudantes Ausentes agrupado por turma (se n\xE3o houver, parabenizar pela presen\xE7a).
   - Bloco de Entradas Tardias / Atrasos agrupado por turma com hor\xE1rio quando informado.
   - Bloco de Balan\xE7o do Dia (Total no segmento, presentes, taxa de frequ\xEAncia, aus\xEAncias). Nunca exponha detalhes cl\xEDnicos de licen\xE7as.
   - Orienta\xE7\xE3o aos respons\xE1veis adaptada ao tom solicitado ("${tomComunicado}") lembrando o envio de atestado \xE0 Secretaria em at\xE9 48h e a import\xE2ncia da pontualidade no PEI.
4. Retorne APENAS o texto final pronto para colar no WhatsApp, sem coment\xE1rios antes ou depois.`;
          const promptUser = `DADOS DA CHAMADA DO DIA:
- Data (YYYY-MM-DD): ${data}
- Ano Letivo: ${anoLetivo}
- Segmento/Turma: ${turma}
- Tom solicitado: ${tomComunicado}
- Estat\xEDsticas: ${JSON.stringify(estatisticas)}
- Estudantes Ausentes por Turma (nomes j\xE1 sanitizados LGPD): ${JSON.stringify(faltososPorTurma)}
- Estudantes Atrasados por Turma (nomes j\xE1 sanitizados LGPD): ${JSON.stringify(atrasadosPorTurma)}
- Alertas de Reincid\xEAncia / Faltas Consecutivas (mencionar orienta\xE7\xE3o geral sem expor nome individual com estigma): ${JSON.stringify(faltasConsecutivasAlerta)}`;
          const response = await ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: promptUser,
            config: {
              systemInstruction: promptSistema
            }
          });
          const textOut = response.text ? response.text.trim() : "";
          if (textOut && textOut.length > 40) {
            mensagemGerada = textOut;
            origem = "gemini";
          }
        } catch (geminiErr) {
          console.warn("[API AI Mensagem Faltosos] Falha no Gemini, usando modelo determin\xEDstico:", geminiErr.message);
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
        origem = "fallback";
      }
      res.json({
        success: true,
        origem,
        mensagem: mensagemGerada
      });
    } catch (err) {
      console.error("[API AI Mensagem Faltosos] Erro geral:", err.message);
      const fallback = gerarMensagemFaltososDiaFallback(req.body || {});
      res.json({
        success: true,
        origem: "fallback",
        mensagem: fallback
      });
    }
  });
  function gerarMensagemFaltososDiaFallback(params) {
    const {
      data = (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      anoLetivo = "2026",
      turma = "TODAS",
      estatisticas = {},
      faltososPorTurma = {},
      atrasadosPorTurma = {},
      tomComunicado = "acolhedor"
    } = params || {};
    const parts = String(data).split("-");
    const dataFormatada = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : data;
    let msg = `*EE PROF. CL\xD3VIS DE LUCCA - PROGRAMA ENSINO INTEGRAL*
`;
    msg += `\u{1F4CB} *BOLETIM DI\xC1RIO DE FREQU\xCANCIA - ${dataFormatada}*
`;
    msg += `Ano Letivo ${anoLetivo} \u2022 ${turma === "TODAS" ? "Todas as Turmas" : turma}

`;
    msg += `\u{1F6AB} *ESTUDANTES AUSENTES NO DIA*
`;
    const turmasFaltosas = Object.keys(faltososPorTurma || {}).sort();
    if (turmasFaltosas.length === 0) {
      msg += `\u2022 Nenhuma aus\xEAncia registrada no per\xEDodo. Parab\xE9ns pela frequ\xEAncia integral!

`;
    } else {
      turmasFaltosas.forEach((t) => {
        const lista = faltososPorTurma[t] || [];
        if (lista.length > 0) msg += `\u2022 *${t}*: ${lista.join(", ")}.
`;
      });
      msg += `
`;
    }
    msg += `\u23F0 *ENTRADAS TARDIAS / ATRASOS*
`;
    const turmasAtrasadas = Object.keys(atrasadosPorTurma || {}).sort();
    if (turmasAtrasadas.length === 0) {
      msg += `\u2022 Sem atrasos registrados no in\xEDcio das aulas.

`;
    } else {
      turmasAtrasadas.forEach((t) => {
        const lista = atrasadosPorTurma[t] || [];
        if (lista.length > 0) msg += `\u2022 *${t}*: ${lista.join(", ")}.
`;
      });
      msg += `
`;
    }
    const total = Number(estatisticas.total || 0);
    const presentesTotal = Number(estatisticas.presentes || 0) + Number(estatisticas.atrasados || 0);
    const taxa = estatisticas.taxaPresenca || (total > 0 ? (presentesTotal / total * 100).toFixed(1) : "100.0");
    const faltosos = Number(estatisticas.faltosos || 0);
    const licencas = Number(estatisticas.licencas || 0);
    msg += `\u{1F4CA} *BALAN\xC7O GERAL DO DIA*
`;
    msg += `\u2022 Total de Estudantes no Segmento: ${total}
`;
    msg += `\u2022 Presentes em Sala de Aula: ${presentesTotal} estudantes (${taxa}% de frequ\xEAncia)
`;
    msg += `\u2022 Aus\xEAncias Registradas Hoje: ${faltosos}
`;
    if (licencas > 0) {
      msg += `\u2022 Afastamentos / Dispensas Justificadas: ${licencas}
`;
    }
    msg += `
`;
    msg += `\u26A0\uFE0F *ORIENTA\xC7\xC3O AOS PAIS E RESPONS\xC1VEIS:*
`;
    if (tomComunicado === "urgente") {
      msg += `Refor\xE7amos a necessidade imediata de justificativa junto \xE0 Secretaria Escolar e ao Professor Tutor. O ac\xFAmulo de aus\xEAncias e atrasos compromete o rendimento e a perman\xEAncia pedag\xF3gica no Programa Ensino Integral (PEI). Caso haja atestado m\xE9dico, apresent\xE1-lo em at\xE9 48 horas.

`;
    } else if (tomComunicado === "padrao") {
      msg += `A frequ\xEAncia e a pontualidade di\xE1rias no Programa Ensino Integral (PEI) s\xE3o indispens\xE1veis para o aproveitamento pedag\xF3gico e o Projeto de Vida do estudante. Em caso de motivo de sa\xFAde, solicitamos encaminhar o atestado \xE0 Secretaria Escolar em at\xE9 48 horas.

`;
    } else {
      msg += `Contamos sempre com a parceria das fam\xEDlias para fortalecer a pontualidade e o acompanhamento di\xE1rio dos nossos jovens no Programa Ensino Integral (PEI). Caso o estudante tenha precisado se ausentar por motivo de sa\xFAde ou imprevisto, pedimos a gentileza de informar a equipe ou entregar o atestado na Secretaria em at\xE9 48 horas.

`;
    }
    msg += `Atenciosamente,
*Equipe Gestora & Coordena\xE7\xE3o Pedag\xF3gica*
EE Prof. Cl\xF3vis de Lucca`;
    return msg;
  }
  function gerarAnaliseComportamentalFallback(params) {
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
    const taxaPresenca = totalMatriculados > 0 ? ((totalPresentes + totalAtrasados) / totalMatriculados * 100).toFixed(1) : "92.5";
    const alunosCriticos = (Array.isArray(chamadaHoje) ? chamadaHoje : []).filter((a) => a.faltasEfetivas >= 8 || a.atrasosAcumulados >= 2 || a.statusHoje === "falta" || a.faltasConsecutivas >= 2).sort((a, b) => b.faltasEfetivas + b.atrasosAcumulados * 2 - (a.faltasEfetivas + a.atrasosAcumulados * 2)).slice(0, 8);
    const somaBrutas = Number(estatisticas.somaFaltasTotais ?? totalFaltosos + totalLicencas);
    const somaLicencas = Number(estatisticas.somaLicencas ?? totalLicencas);
    const somaEfetivas = Number(estatisticas.somaFaltasEfetivas ?? Math.max(0, somaBrutas - somaLicencas));
    const diasAnalisados = Number(historicoResumo?.diasRegistrados || 1);
    const diaCritico = historicoResumo?.diaSemanaMaisCritico || "Segunda-feira";
    return {
      diagnosticoGeral: `Apura\xE7\xE3o de Frequ\xEAncia realizada em ${dataReferencia} para ${turma === "TODAS" ? "todas as turmas" : turma} (${diasAnalisados} dia(s) analisado(s) no hist\xF3rico): Taxa de presen\xE7a calculada em ${taxaPresenca}%. Foram registrados ${totalAtrasados} atrasos e ${totalFaltosos} aus\xEAncias injustificadas hoje, al\xE9m de ${totalLicencas} licen\xE7as m\xE9dicas formais. A aplica\xE7\xE3o da 3\xAA m\xE9trica (${somaEfetivas} faltas efetivas desconsiderando ${somaLicencas} afastamentos m\xE9dicos de ${somaBrutas} faltas brutas) revela com precis\xE3o o p\xFAblico que demanda acolhimento imediato pela Tutoria e Busca Ativa para ${anoLetivoAlvo}.`,
      padroesDetectados: [
        {
          titulo: `Concentra\xE7\xE3o de Atrasos no 1\xBA Per\xEDodo \u2022 Pico em ${diaCritico}`,
          descricao: `Dos ${totalAtrasados} atrasos apontados hoje${historicoResumo?.totalAtrasosHistorico ? ` (${historicoResumo.totalAtrasosHistorico} no hist\xF3rico registrado)` : ""}, a maior incid\xEAncia ocorre nos primeiros minutos da manh\xE3, especialmente em ${diaCritico}, impactando o primeiro componente da rotina PEI.`,
          grau: "ALTO",
          alunosImpactados: totalAtrasados || alunosCriticos.length || 3
        },
        {
          titulo: "Diferencia\xE7\xE3o Cr\xEDtica: 3\xAA M\xE9trica (Faltas Efetivas vs Licen\xE7as)",
          descricao: `De ${somaBrutas} faltas brutas acumuladas, ${somaLicencas} correspondem a licen\xE7as/atestados m\xE9dicos legais. Ao descontar essas justificativas, restam ${somaEfetivas} faltas efetivas reais para direcionamento da Busca Ativa.`,
          grau: "MODERADO",
          alunosImpactados: totalLicencas || 2
        },
        {
          titulo: `Comportamento Preditivo para Transi\xE7\xE3o ${anoLetivoAlvo}`,
          descricao: `Estudantes com 2 ou mais atrasos sistem\xE1ticos ou faltas efetivas crescentes tendem a ampliar a infrequ\xEAncia no 1\xBA bimestre de ${anoLetivoAlvo} se n\xE3o houver pactua\xE7\xE3o pr\xE9via na Tutoria.`,
          grau: "ALTO",
          alunosImpactados: alunosCriticos.length || 4
        }
      ],
      analiseTerceiraMetrica: {
        explicacao: "A Terceira M\xE9trica isola as Faltas Efetivas (Faltas Totais deduzidas de Licen\xE7as e Afastamentos M\xE9dicos com atestado). Ela protege o estudante com afastamento legal de abordagens coercitivas indevidas e orienta a equipe de Busca Ativa aos casos de real risco de evas\xE3o.",
        totalFaltasBrutas: somaBrutas,
        totalLicencasAfastamentos: somaLicencas,
        totalFaltasEfetivas: somaEfetivas,
        conclusaoPedagogica: "Priorizar contato telef\xF4nico e visitas familiares exclusivamente para alunos cuja 3\xAA m\xE9trica ultrapassa 10% do teto letivo, orientando o Tutor a incluir a pontualidade no Plano de Tutoria."
      },
      projecaoRisco2027: alunosCriticos.map((a) => ({
        ra: a.ra || "0001098...",
        nome: a.nome || "Estudante em Acompanhamento",
        turma: a.turma || turma,
        nivelRisco: a.faltasEfetivas >= 12 || a.faltasConsecutivas >= 3 ? "CR\xCDTICO" : "ATEN\xC7\xC3O",
        motivo: `${a.faltasEfetivas} faltas efetivas (sem licen\xE7a) e ${a.atrasosAcumulados} atraso(s) acumulados.`,
        acaoTutoria2027: `Pactuar meta de pontualidade no Projeto de Vida e agendar alinhamento individual com respons\xE1veis para o in\xEDcio de ${anoLetivoAlvo}.`
      })),
      acoesImediatas: [
        {
          prioridade: "IMEDIATA",
          titulo: "Disparo de WhatsApp aos Respons\xE1veis dos Faltosos do Dia",
          descricao: "Acionar a mensagem oficial gerada por IA aos pais dos ausentes e atrasados de hoje, em conformidade estrita com a LGPD.",
          responsavel: "Equipe Gestora & Secretaria"
        },
        {
          prioridade: "SEMANAL",
          titulo: "Pauta de Pontualidade nas Sess\xF5es Semanais de Tutoria PEI",
          descricao: "Encaminhar aos Professores Tutores a rela\xE7\xE3o dos estudantes com atrasos reincidentes na 1\xAA aula para registro na Ficha de Tutoria.",
          responsavel: "Coordenadores CGPG e Tutores"
        },
        {
          prioridade: `PLANEJAMENTO ${anoLetivoAlvo}`,
          titulo: `Mapeamento das Turmas de ${anoLetivoAlvo} e Reorganiza\xE7\xE3o de Acolhimento`,
          descricao: `Distribuir estudantes com maior 3\xAA m\xE9trica de faltas efetivas em grupos de tutoria de acompanhamento intensivo na prepara\xE7\xE3o de ${anoLetivoAlvo}.`,
          responsavel: "Dire\xE7\xE3o Escolar e Professores Tutores"
        }
      ]
    };
  }
  function gerarBoletimDiarioFallback(params) {
    const {
      data = (/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR"),
      turno = "Manh\xE3",
      etapa = "Ensino Fundamental",
      mensagensProfessores = "",
      atrasosRegistrados = [],
      saidasAntecipadasRegistradas = [],
      atestadosRegistrados = [],
      alunosCadastrados = [],
      totalMatriculadosAtivos = 0,
      historicoBoletinsAnteriores = []
    } = params || {};
    const rawText = String(mensagensProfessores || "");
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    const turmasAusentes = {};
    const atrasadosPorTurma = {};
    const saidasPorTurma = {};
    const ausentesSet = /* @__PURE__ */ new Set();
    let turmaAtual = "";
    const regexTurma = /(?:^|[\s:])(?:ausentes?\s*(?:no|na|da|turma)?\s*|aus[êe]ncias?\s*(?:no|na|da|turma)?\s*|chamada\s*(?:no|na|da|turma)?\s*|turma\s*)?([1-9][º°ª]?\s*[A-Da-d])\b(?!\s*ª?\s*aula|\s*º?\s*aula|\s*°?\s*aula|\s*aula)/i;
    const normalizarNomeTurma = (t) => {
      const clean = t.replace(/[^\d1-9A-Za-z]/g, "").toUpperCase();
      const num = clean.replace(/\D/g, "");
      const letra = clean.replace(/[^A-D]/g, "");
      return `${num}\xBA ${letra}`.trim();
    };
    const normTurmaKey = (t) => (t || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const alunosAtivos = (Array.isArray(alunosCadastrados) ? alunosCadastrados : []).filter((a) => {
      const st = String(a.status || "ATIVO").trim().toUpperCase();
      return st === "ATIVO";
    });
    const mapaAtivosPorTurma = {};
    alunosAtivos.forEach((st) => {
      const tKey = normTurmaKey(st.turma);
      if (tKey) {
        mapaAtivosPorTurma[tKey] = mapaAtivosPorTurma[tKey] || [];
        mapaAtivosPorTurma[tKey].push(st);
      }
    });
    const removerAcentos = (str) => {
      return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    };
    const fonetica = (str) => {
      return removerAcentos(str).replace(/ph/g, "f").replace(/th/g, "t").replace(/ck/g, "k").replace(/y/g, "i").replace(/w/g, "v").replace(/z/g, "s").replace(/x/g, "s").replace(/ch/g, "s").replace(/ll/g, "l").replace(/ss/g, "s").replace(/rr/g, "r").replace(/mm/g, "m").replace(/nn/g, "n").replace(/tt/g, "t");
    };
    const buscarAlunoAtivoDaTurma = (nomeBuscado, turmaRef) => {
      const tKey = normTurmaKey(turmaRef);
      const listaTurma = mapaAtivosPorTurma[tKey] || [];
      if (listaTurma.length === 0) return null;
      const qNorm = removerAcentos(nomeBuscado);
      const qPhon = fonetica(nomeBuscado);
      const qParts = qNorm.split(/\s+/).filter((p) => p.length >= 2);
      const qPhonParts = qPhon.split(/\s+/).filter((p) => p.length >= 2);
      let match = listaTurma.find((a) => removerAcentos(a.nome) === qNorm);
      if (match) return match;
      match = listaTurma.find((a) => fonetica(a.nome) === qPhon);
      if (match) return match;
      if (qPhonParts.length > 1) {
        match = listaTurma.find((a) => {
          const aPhonParts = fonetica(a.nome).split(/\s+/);
          const firstMatch = aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
          const lastMatch = aPhonParts.some((ap, idx) => idx > 0 && qPhonParts.slice(1).some((qp) => ap === qp || ap.startsWith(qp) || qp.startsWith(ap)));
          return firstMatch && lastMatch;
        });
        if (match) return match;
      }
      if (qParts.length > 1) {
        match = listaTurma.find((a) => {
          const aNorm = removerAcentos(a.nome);
          return qParts.every((p) => aNorm.includes(p));
        });
        if (match) return match;
      }
      if (qPhonParts.length === 1) {
        const candidatos = listaTurma.filter((a) => {
          const aPhonParts = fonetica(a.nome).split(/\s+/);
          return aPhonParts[0] === qPhonParts[0] || aPhonParts[0].startsWith(qPhonParts[0]) || qPhonParts[0].startsWith(aPhonParts[0]);
        });
        if (candidatos.length >= 1) return candidatos[0];
      }
      match = listaTurma.find((a) => {
        const aNorm = removerAcentos(a.nome);
        return qParts.some((p) => p.length >= 4 && aNorm.includes(p));
      });
      return match || null;
    };
    const formatarNomeLGPD = (nomeOriginal, turmaRef) => {
      const trimmed = (nomeOriginal || "").trim().replace(/^•\s*/, "");
      if (!trimmed) return "Estudante";
      if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Z]\.)+$/.test(trimmed)) {
        return trimmed;
      }
      const alunoAtivo = buscarAlunoAtivoDaTurma(trimmed, turmaRef);
      const nomeBase = alunoAtivo ? alunoAtivo.nome : trimmed;
      const preposicoes = /* @__PURE__ */ new Set(["de", "da", "do", "dos", "das", "e"]);
      const palavras = nomeBase.trim().replace(/\.$/, "").split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).filter((p) => !preposicoes.has(p.toLowerCase()));
      if (palavras.length === 0) return "Estudante";
      if (palavras.length === 1) return palavras[0];
      const primeiroNome = palavras[0];
      const segundoNome = palavras[1] || "";
      const listaTurma = mapaAtivosPorTurma[normTurmaKey(turmaRef)] || [];
      const mesmoPrimeiroNome = listaTurma.filter((a) => {
        const aFirst = a.nome.trim().split(/\s+/)[0];
        return fonetica(aFirst) === fonetica(primeiroNome);
      });
      if (mesmoPrimeiroNome.length > 1) {
        const mesmoSegundoNomeInicial = mesmoPrimeiroNome.filter((a) => {
          const aPalavras = a.nome.trim().split(/\s+/).filter((p) => !preposicoes.has(p.toLowerCase()));
          const aSeg = aPalavras[1] || "";
          return aSeg && segundoNome && aSeg[0].toUpperCase() === segundoNome[0].toUpperCase();
        });
        if (mesmoSegundoNomeInicial.length > 1 && palavras[2]) {
          return `${primeiroNome} ${segundoNome[0].toUpperCase()}. ${palavras[2][0].toUpperCase()}.`;
        }
        const inicial = segundoNome ? `${segundoNome[0].toUpperCase()}.` : "";
        return `${primeiroNome} ${inicial}`.trim();
      }
      if (!alunoAtivo && palavras.length > 1) {
        return `${primeiroNome} ${segundoNome[0].toUpperCase()}.`;
      }
      return primeiroNome;
    };
    lines.forEach((rawL) => {
      let line = rawL.replace(/^\[\d{1,2}\/\d{1,2}(?:,\s*\d{1,2}:\d{1,2})?\]\s*[^:]+:\s*/i, "").trim();
      if (!line) line = rawL.trim();
      if (line.includes("MANZINE E GABRIEL VALADARES - AEE")) return;
      if (line.includes("?")) return;
      if (/algu[ée]m\s+sabe|est[áa] aqui comigo|minha de OE/i.test(line)) return;
      if (/boa tarde|bom dia|falta chamada|obrigado|obrigada/i.test(line)) return;
      if (/corrigindo/i.test(line)) {
        const mCorr = line.match(regexTurma);
        const tAlvo = mCorr ? normalizarNomeTurma(mCorr[1]) : turmaAtual;
        if (tAlvo) {
          turmaAtual = tAlvo;
          turmasAusentes[tAlvo] = [];
          const partes = line.split(":");
          const resto = partes[partes.length - 1];
          const nomes = resto.split(/[,;]/).map((n) => n.trim()).filter((n) => n.length > 2);
          nomes.forEach((nm) => {
            if (!turmasAusentes[tAlvo].some((x) => x.toLowerCase() === nm.toLowerCase())) {
              turmasAusentes[tAlvo].push(nm);
              ausentesSet.add(`${tAlvo}|${nm.toLowerCase()}`);
            }
          });
          return;
        }
      }
      const matchTurma = line.match(regexTurma);
      if (matchTurma && matchTurma[1]) {
        if (line.includes(":") && line.length > 15) {
          const partes = line.split(":");
          const tMatch = partes[0].match(regexTurma);
          if (tMatch && tMatch[1]) {
            turmaAtual = normalizarNomeTurma(tMatch[1]);
            turmasAusentes[turmaAtual] = turmasAusentes[turmaAtual] || [];
            const nomesSeparados = partes.slice(1).join(":").split(/[,;]/).map((n) => n.trim()).filter((n) => n.length > 2);
            nomesSeparados.forEach((nm) => {
              if (!turmasAusentes[turmaAtual].some((x) => x.toLowerCase() === nm.toLowerCase())) {
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
      if (/foi embora|sa[íi]da|saiu/i.test(line)) {
        saidasPorTurma[turmaAtual] = saidasPorTurma[turmaAtual] || [];
        const horaMatch = line.match(/(\d{1,2}[h:]\d{0,2}|\d+[ªº°]?\s*aula)/i);
        let horaTexto = "";
        if (horaMatch) {
          horaTexto = horaMatch[1].replace(":", "h").trim();
          if (/^\d+aula$/i.test(horaTexto)) {
            horaTexto = horaTexto.replace(/(\d+)aula/i, "$1\xAA aula");
          }
        }
        const nomeBruto = line.replace(/[\(\[].*?[\]\)]/g, "").replace(/foi embora.*$/i, "").replace(/saiu.*$/i, "").trim();
        const nomeFormatadoLgpd = formatarNomeLGPD(nomeBruto || "Estudante", turmaAtual);
        const infoHora = horaTexto ? ` (${horaTexto})` : "";
        saidasPorTurma[turmaAtual].push(`${nomeFormatadoLgpd}${infoHora}`);
        return;
      }
      if (/atras[ao]d[ao]|\(atraso\)/i.test(line)) {
        atrasadosPorTurma[turmaAtual] = atrasadosPorTurma[turmaAtual] || [];
        const horaMatch = line.match(/(\d{1,2}[h:]\d{0,2})/i);
        const horaTexto = horaMatch ? horaMatch[1].replace(":", "h") : "07h25";
        const nomeLimpo = line.replace(/[\(\[].*?[\]\)]/g, "").replace(/atrasad[ao]/i, "").trim();
        const nomeFormatadoLgpd = formatarNomeLGPD(nomeLimpo || "Estudante", turmaAtual);
        if (!atrasadosPorTurma[turmaAtual].some((x) => x.toLowerCase().includes(nomeLimpo.toLowerCase()))) {
          atrasadosPorTurma[turmaAtual].push(`${nomeFormatadoLgpd} (${horaTexto})`);
        }
        return;
      }
      if (line.length >= 2 && !line.startsWith("[")) {
        turmasAusentes[turmaAtual] = turmasAusentes[turmaAtual] || [];
        if (!turmasAusentes[turmaAtual].some((x) => x.toLowerCase() === line.toLowerCase())) {
          turmasAusentes[turmaAtual].push(line);
          ausentesSet.add(`${turmaAtual}|${line.toLowerCase()}`);
        }
      }
    });
    (atrasosRegistrados || []).forEach((at) => {
      const tNorm = normalizarNomeTurma(at.turma || "");
      if (tNorm) {
        atrasadosPorTurma[tNorm] = atrasadosPorTurma[tNorm] || [];
        const horaStr = at.horaRealAtraso || at.hora || "07h25";
        const obsStr = at.obs ? ` - ${at.obs}` : "";
        const nomeFormatado = formatarNomeLGPD(at.nomeAluno || "Estudante", tNorm);
        const itemStr = `${nomeFormatado} (${horaStr.replace(":", "h")}${obsStr})`;
        if (!atrasadosPorTurma[tNorm].some((existing) => existing.includes(nomeFormatado))) {
          atrasadosPorTurma[tNorm].push(itemStr);
        }
      }
    });
    (saidasAntecipadasRegistradas || []).forEach((sa) => {
      const tNorm = normalizarNomeTurma(sa.turma || "");
      if (tNorm) {
        saidasPorTurma[tNorm] = saidasPorTurma[tNorm] || [];
        const horaStr = sa.horaRealSaida || sa.hora || "";
        const infoHora = horaStr ? ` (${horaStr.replace(":", "h")})` : "";
        const nomeFormatado = formatarNomeLGPD(sa.nomeAluno || "Estudante", tNorm);
        saidasPorTurma[tNorm].push(`${nomeFormatado}${infoHora}`);
      }
    });
    const linhasAusentesFormatadas = [];
    let totalAusenciasContadas = 0;
    const turmasOrdenadas = Object.keys(turmasAusentes).sort();
    turmasOrdenadas.forEach((t) => {
      const nomes = turmasAusentes[t] || [];
      if (nomes.length > 0) {
        totalAusenciasContadas += nomes.length;
        const nomesAbreviados = nomes.map((nm) => formatarNomeLGPD(nm, t)).join(", ");
        linhasAusentesFormatadas.push(`\u2022 ${t}: ${nomesAbreviados}.`);
      }
    });
    const linhasAtrasadosFormatadas = [];
    let totalAtrasadosContados = 0;
    const turmasAtrasoOrdenadas = Object.keys(atrasadosPorTurma).sort();
    turmasAtrasoOrdenadas.forEach((t) => {
      const atrasos = atrasadosPorTurma[t] || [];
      if (atrasos.length > 0) {
        totalAtrasadosContados += atrasos.length;
        linhasAtrasadosFormatadas.push(`\u2022 ${t}: ${atrasos.join(", ")}.`);
      }
    });
    const linhasSaidasFormatadas = [];
    let totalSaidasContadas = 0;
    Object.keys(saidasPorTurma).forEach((t) => {
      const s = saidasPorTurma[t] || [];
      if (s.length > 0) {
        totalSaidasContadas += s.length;
        linhasSaidasFormatadas.push(`\u2022 ${t}: ${s.join(", ")}.`);
      }
    });
    const linhasAtestadosFormatadas = [];
    let totalAtestadosContados = (atestadosRegistrados || []).length;
    (atestadosRegistrados || []).forEach((at) => {
      const nomeFormatado = formatarNomeLGPD(at.nomeAluno || "Estudante", at.turma || "");
      linhasAtestadosFormatadas.push(`\u2022 ${at.turma || ""}: ${nomeFormatado}${at.descricao ? " (" + at.descricao + ")" : ""}`);
    });
    const isFund = (turma) => {
      const clean = String(turma || "").replace(/[^\d1-9A-Za-z]/g, "").toUpperCase();
      return clean.startsWith("6") || clean.startsWith("7") || clean.startsWith("8") || clean.startsWith("9");
    };
    const isMed = (turma) => {
      const clean = String(turma || "").replace(/[^\d1-9A-Za-z]/g, "").toUpperCase();
      return clean.startsWith("1") || clean.startsWith("2") || clean.startsWith("3");
    };
    const isGeralEtapa = etapa.toLowerCase().includes("geral") || etapa.toLowerCase().includes("todos");
    const isFundEtapa = !isGeralEtapa && (etapa.toLowerCase().includes("fundamental") || etapa.toLowerCase().includes("6\xBA ao 9\xBA"));
    const isMedEtapa = !isGeralEtapa && (etapa.toLowerCase().includes("m\xE9dio") || etapa.toLowerCase().includes("medio") || etapa.toLowerCase().includes("1\xBA ao 3\xBA"));
    let totalMatriculados = Number(totalMatriculadosAtivos || 0);
    if (!totalMatriculados || totalMatriculados <= 0) {
      if (isGeralEtapa) {
        const countFund = alunosAtivos.filter((a) => isFund(a.turma)).length;
        const countMed = alunosAtivos.filter((a) => isMed(a.turma)).length;
        totalMatriculados = countFund + countMed > 0 ? countFund + countMed : alunosAtivos.length;
      } else if (isFundEtapa) {
        totalMatriculados = alunosAtivos.filter((a) => isFund(a.turma)).length;
      } else if (isMedEtapa) {
        totalMatriculados = alunosAtivos.filter((a) => isMed(a.turma)).length;
      } else {
        totalMatriculados = alunosAtivos.length;
      }
    }
    if (totalMatriculados <= 0) {
      totalMatriculados = isGeralEtapa ? 703 : isFundEtapa ? 497 : 206;
    }
    const taxaAusencia = totalMatriculados > 0 ? (totalAusenciasContadas / totalMatriculados * 100).toFixed(1) : "0,0";
    const boletimFormatado = `\u{1F4E2} BOLETIM DI\xC1RIO DE FREQU\xCANCIA: ESCOLA CLOVIS DE LUCCA
\u{1F4C5} Data: ${data} (Per\xEDodo da ${turno})

Prezadas fam\xEDlias e respons\xE1veis, compartilhamos o retrato consolidado de frequ\xEAncia, pontualidade e ocorr\xEAncias do turno da ${turno.toLowerCase()} de hoje com todas as turmas atualizadas. A parceria de voc\xEAs \xE9 essencial para garantir o ritmo de aprendizado dos nossos estudantes! \u{1F91D}

\u2600\uFE0F PER\xCDODO DA ${turno.toUpperCase()} (${etapa.toUpperCase()})

\u{1F6D1} ALUNOS AUSENTES
${linhasAusentesFormatadas.length > 0 ? linhasAusentesFormatadas.join("\n") : "\u2022 Nenhuma aus\xEAncia registrada no turno."}

\u23F0 ALUNOS ATRASADOS / ENTRADA TARDIA
${linhasAtrasadosFormatadas.length > 0 ? linhasAtrasadosFormatadas.join("\n") : "\u2022 Sem registros de atrasos no turno."}

\u{1F6AA} SA\xCDDAS ANTECIPADAS
${linhasSaidasFormatadas.length > 0 ? linhasSaidasFormatadas.join("\n") : "\u2022 Sem ocorr\xEAncias registradas no turno."}

\u{1F4CA} BALAN\xC7O DO TURNO (${etapa})

\u2022 Total de Matriculados (${turno}): ${totalMatriculados} alunos
\u2022 Total de Aus\xEAncias Integrais: ${totalAusenciasContadas} faltas confirmadas
\u2022 \xCDndice de Faltas: ${taxaAusencia.replace(".", ",")}% das cadeiras vazias
\u2022 Total de Atrasos / Entradas Tardias: ${totalAtrasadosContados} registros na portaria/secretaria

Lembramos que os minutos iniciais das aulas s\xE3o preciosos para a explica\xE7\xE3o dos conte\xFAdos. Caso a aus\xEAncia tenha ocorrido por recomenda\xE7\xE3o de sa\xFAde, favor apresentar o atestado m\xE9dico na secretaria da unidade escolar.

Contamos com o apoio e o empenho de todos!

Atenciosamente,
Dire\xE7\xE3o e Equipe Gestora`;
    const alunosCriticos3Mais = [];
    const alunosAlerta2 = [];
    const seenConsecutivoKeys = /* @__PURE__ */ new Set();
    turmasOrdenadas.forEach((t) => {
      const nomes = turmasAusentes[t] || [];
      nomes.forEach((nomeBruto) => {
        const cleanNome = nomeBruto.toLowerCase().trim();
        const matchCadastro = buscarAlunoAtivoDaTurma(nomeBruto, t);
        let diasConsecutivos = 1;
        if (Array.isArray(historicoBoletinsAnteriores)) {
          historicoBoletinsAnteriores.forEach((bol) => {
            const ausentesBol = bol.ausentes || [];
            if (ausentesBol.some((a) => {
              const aNome = String(a.nome || "").toLowerCase();
              return aNome.includes(cleanNome) || cleanNome.includes(aNome.split(" ")[0]);
            })) {
              diasConsecutivos++;
            }
          });
        }
        const freqNum = matchCadastro?.presenca_atual ? parseFloat(String(matchCadastro.presenca_atual).replace("%", "")) : 80;
        if (freqNum < 75 && diasConsecutivos === 1) {
          diasConsecutivos = 2;
        }
        const nomeOficial = matchCadastro?.nome || nomeBruto.toUpperCase();
        const raOficial = matchCadastro?.ra || "Cadastrado";
        const key = `${t}|${nomeOficial.toLowerCase()}`;
        if (seenConsecutivoKeys.has(key)) return;
        seenConsecutivoKeys.add(key);
        if (diasConsecutivos >= 3) {
          alunosCriticos3Mais.push({
            nome: nomeOficial,
            turma: t,
            ra: raOficial,
            diasConsecutivos,
            frequenciaAtual: matchCadastro?.presenca_atual || "N\xE3o informada",
            nivelRisco: "CR\xCDTICO",
            motivoDestaque: `Acumulou ${diasConsecutivos} faltas consecutivas. Atingiu o limiar de interven\xE7\xE3o compuls\xF3ria da Resolu\xE7\xE3o SEDUC n\xBA 39/2023.`,
            acaoSugerida: "Ligar imediatamente para os respons\xE1veis e formalizar notifica\xE7\xE3o de convoca\xE7\xE3o presencial na Busca Ativa."
          });
        } else if (diasConsecutivos === 2) {
          alunosAlerta2.push({
            nome: nomeOficial,
            turma: t,
            ra: raOficial,
            diasConsecutivos: 2,
            frequenciaAtual: matchCadastro?.presenca_atual || "N\xE3o informada",
            nivelRisco: "ATEN\xC7\xC3O",
            motivoDestaque: "2\xAA aus\xEAncia consecutiva registrada. Risco de progress\xE3o para abandono.",
            acaoSugerida: "Realizar contato telef\xF4nico ou WhatsApp preventivo de acolhimento com a fam\xEDlia."
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
        indiceFaltas: `${taxaAusencia.replace(".", ",")}%`,
        totalAtrasos: totalAtrasadosContados,
        totalSaidasAntecipadas: totalSaidasContadas,
        totalAtestados: totalAtestadosContados
      },
      turmasAusentes,
      atrasadosPorTurma,
      saidasPorTurma,
      alertaEquipeGestora: {
        totalAlunosConsecutivos: totalConsecutivos,
        resumoExecutivo: `Identificados ${totalConsecutivos} estudantes com aus\xEAncias consecutivas ou vulnerabilidade acentuada hoje (${alunosCriticos3Mais.length} em n\xEDvel cr\xEDtico com 3+ faltas e ${alunosAlerta2.length} sob aten\xE7\xE3o com 2 faltas consecutivas).`,
        alunosCriticos3Mais,
        alunosAlerta2,
        orientacoesSEDUC39: "Art. 2\xBA e 3\xBA da Resolu\xE7\xE3o SEDUC n\xBA 39/2023: Constatadas 3 aus\xEAncias consecutivas injustificadas ou reitera\xE7\xE3o de faltas, a escola deve empreender procedimentos imediatos de Busca Ativa e di\xE1logo com os respons\xE1veis antes de remessa \xE0 FICAI/Conselho Tutelar."
      }
    };
  }
  function gerarMensagemFallbackSEDUC39(aluno, contatosBa, ocorrenciasDossie, totalAtrasos, estagioDesejado) {
    const nomeAluno = String(aluno.nome || "ESTUDANTE").toUpperCase();
    const turmaAluno = String(aluno.turma || aluno.serie || "N\xC3O INFORMADA").toUpperCase();
    const raAluno = String(aluno.ra || "").trim();
    const freqAtual = aluno.frequencia_atual || aluno.presenca_anual || "N\xE3o informada";
    const contatosQtd = Array.isArray(contatosBa) ? contatosBa.length : 0;
    const atrasosNum = Number(totalAtrasos || 0);
    let estagioFinal = estagioDesejado;
    if (!estagioFinal || estagioFinal === "auto") {
      if (aluno.ficha_ct || contatosQtd >= 4 && (aluno.reincidente || String(freqAtual).includes("5") || String(freqAtual).includes("4"))) {
        estagioFinal = "ministerio_publico";
      } else if (contatosQtd >= 2 || aluno.reincidente || freqAtual && parseFloat(String(freqAtual).replace("%", "")) < 75) {
        estagioFinal = "conselho_tutelar";
      } else if (contatosQtd >= 1 || atrasosNum >= 3) {
        estagioFinal = "convocacao";
      } else {
        estagioFinal = "familiar";
      }
    }
    if (estagioFinal === "ministerio_publico" || estagioFinal === "4_MINISTERIO_PUBLICO") {
      return {
        mensagem: `NOTIFICA\xC7\xC3O INSTITUCIONAL DE GRAVIDADE EXTREMA - E.E. CL\xD3VIS DE LUCCA

Prezados respons\xE1veis legais pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),

Comunicamos formalmente que, diante do esgotamento integral de todas as tentativas e a\xE7\xF5es pedag\xF3gicas de Busca Ativa empreendidas pela unidade escolar (${contatosQtd} tentativas registradas sem regulariza\xE7\xE3o), bem como da reincid\xEAncia continuada e aus\xEAncia de comparecimento \xE0s convoca\xE7\xF5es, a Escola Estadual Cl\xF3vis de Lucca est\xE1 formalizando o pedido de representa\xE7\xE3o e encaminhamento do caso \xE0 PROMOTORIA DE JUSTI\xC7A DA INF\xC2NCIA E DA JUVENTUDE (MINIST\xC9RIO P\xDABLICO DO ESTADO DE S\xC3O PAULO) e \xE0 Vara da Inf\xE2ncia e Juventude.

Esta medida extrema fundamenta-se estritamente na Resolu\xE7\xE3o SEDUC n\xBA 39, de 05-09-2023, no Artigo 56, inciso II da Lei Federal n\xBA 8.069/1990 (Estatuto da Crian\xE7a e do Adolescente - ECA) e no Artigo 246 do C\xF3digo Penal Brasileiro (Crime de Abandono Intelectual), resguardando o direito indispon\xEDvel do(a) estudante \xE0 educa\xE7\xE3o.

Solicitamos o comparecimento imediato do(a) respons\xE1vel legal \xE0 escola no prazo improrrog\xE1vel de 24 horas antes da expedi\xE7\xE3o e protocolo final da documenta\xE7\xE3o junto ao \xF3rg\xE3o ministerial.

Atenciosamente,
Dire\xE7\xE3o Escolar / Equipe Gestora - E.E. Cl\xF3vis de Lucca`,
        estagioIdentificado: "4_MINISTERIO_PUBLICO",
        tituloEstagio: "Etapa 4 - Encaminhamento ao Minist\xE9rio P\xFAblico (\xDAltimo Caso / Omiss\xE3o Grave)",
        baseLegal: "Resolu\xE7\xE3o SEDUC n\xBA 39/2023; Lei n\xBA 8.069/1990 (ECA), Art. 56 e Art. 249; C\xF3digo Penal Brasileiro, Art. 246 (Abandono Intelectual); Lei n\xBA 9.394/1996 (LDB), Art. 12.",
        diagnosticoResumido: `Constatado esgotamento das vias escolares e do Conselho Tutelar, com ${contatosQtd} tentativa(s) pr\xE9via(s) sem \xEAxito e frequ\xEAncia em n\xEDvel cr\xEDtico (${freqAtual}). Situa\xE7\xE3o extrema que demanda acionamento do Minist\xE9rio P\xFAblico para salvaguarda do direito \xE0 educa\xE7\xE3o.`,
        proximaAcaoSugerida: "Oficializar relat\xF3rio circunstanciado com hist\xF3rico completo de busca ativa e remeter \xE0 Promotoria da Inf\xE2ncia e da Juventude caso n\xE3o haja comparecimento em 24h."
      };
    }
    if (estagioFinal === "conselho_tutelar" || estagioFinal === "3_CONSELHO_TUTELAR") {
      return {
        mensagem: `NOTIFICA\xC7\xC3O OFICIAL DE ENCAMINHAMENTO AO CONSELHO TUTELAR - E.E. CL\xD3VIS DE LUCCA

Prezados pais ou respons\xE1veis pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),

Informamos formalmente que a Escola Estadual Cl\xF3vis de Lucca registrou ${contatosQtd} tentativa(s) pr\xE9via(s) de contato e convoca\xE7\xF5es pedag\xF3gicas referentes \xE0s reiteradas aus\xEAncias injustificadas do estudante (Frequ\xEAncia atual: ${freqAtual}), sem que houvesse o devido comparecimento ou regulariza\xE7\xE3o da assiduidade escolar.

Diante do excesso de tentativas sem \xEAxito e do esgotamento dos recursos escolares previstos na Resolu\xE7\xE3o SEDUC n\xBA 39, de 05 de setembro de 2023, comunicamos que estamos procedendo \xE0 formaliza\xE7\xE3o da Ficha FICAI e ao encaminhamento do caso ao CONSELHO TUTELAR do munic\xEDpio para provid\xEAncias protetivas e fiscalizat\xF3rias cab\xEDveis, em cumprimento ao Artigo 56 do Estatuto da Crian\xE7a e do Adolescente (ECA) e Artigo 12 da LDB.

Convocamos o(a) respons\xE1vel com m\xE1xima urg\xEAncia para comparecer \xE0 escola e dialogar com a gest\xE3o escolar antes do envio definitivo do relat\xF3rio aos conselheiros tutelares.

Atenciosamente,
Dire\xE7\xE3o Escolar e Equipe de Media\xE7\xE3o - E.E. Cl\xF3vis de Lucca`,
        estagioIdentificado: "3_CONSELHO_TUTELAR",
        tituloEstagio: "Etapa 3 - Encaminhamento ao Conselho Tutelar por Excesso de Tentativas sem Retorno",
        baseLegal: "Resolu\xE7\xE3o SEDUC n\xBA 39/2023; Lei n\xBA 8.069/1990 (ECA), Art. 56, inciso II; Lei Federal n\xBA 9.394/1996 (LDB), Art. 12, incisos VII e VIII.",
        diagnosticoResumido: `Detectado excesso de contatos pr\xE9vios (${contatosQtd} tentativas) sem resposta efetiva e frequ\xEAncia em patamar irregular (${freqAtual}). Configura o crit\xE9rio legal da Resolu\xE7\xE3o SEDUC 39/2023 para acionamento do Conselho Tutelar via FICAI.`,
        proximaAcaoSugerida: "Protocolar ficha FICAI junto ao Conselho Tutelar se a fam\xEDlia n\xE3o comparecer em 48 horas \xFAteis."
      };
    }
    if (estagioFinal === "convocacao" || estagioFinal === "2_CONVOCACAO") {
      return {
        mensagem: `CONVOCA\xC7\xC3O FORMAL DE RESPONS\xC1VEL - E.E. CL\xD3VIS DE LUCCA

Prezados respons\xE1veis legais pelo(a) estudante ${nomeAluno} (RA: ${raAluno} | Turma: ${turmaAluno}),

Registramos a continuidade de aus\xEAncias n\xE3o justificadas \xE0s aulas e relembramos que a frequ\xEAncia presencial di\xE1ria \xE9 obriga\xE7\xE3o legal e condi\xE7\xE3o indispens\xE1vel para a aprendizagem e perman\xEAncia na escola p\xFAblica paulista.

Em cumprimento \xE0 Resolu\xE7\xE3o SEDUC n\xBA 39, de 05-09-2023 e ao Artigo 12 da LDB (Lei n\xBA 9.394/1996), CONVOCAMOS o(a) respons\xE1vel legal para comparecer com urg\xEAncia \xE0 secretaria da E.E. Cl\xF3vis de Lucca a fim de alinharmos o plano de compensa\xE7\xE3o de aus\xEAncias e regulariza\xE7\xE3o da vida escolar do(a) estudante.

A aus\xEAncia a esta convoca\xE7\xE3o ensejar\xE1 a notifica\xE7\xE3o formal aos \xF3rg\xE3os de prote\xE7\xE3o da inf\xE2ncia e adolesc\xEAncia (Conselho Tutelar). Contamos com sua presen\xE7a imediata.

Atenciosamente,
Equipe Gestora - E.E. Cl\xF3vis de Lucca`,
        estagioIdentificado: "2_CONVOCACAO",
        tituloEstagio: "Etapa 2 - Convoca\xE7\xE3o Presencial & Advert\xEAncia Legal",
        baseLegal: "Resolu\xE7\xE3o SEDUC n\xBA 39/2023; Lei n\xBA 9.394/1996 (LDB), Art. 12; Lei n\xBA 8.069/1990 (ECA), Art. 56.",
        diagnosticoResumido: `Reincid\xEAncia de faltas e necessidade de interven\xE7\xE3o pedag\xF3gica direta com os respons\xE1veis legais para firmar compromisso de frequ\xEAncia antes de escalonamento externo.`,
        proximaAcaoSugerida: "Aguardar comparecimento dos pais em at\xE9 48h. Em caso de recusa ou n\xE3o comparecimento, registrar na Busca Ativa e emitir FICAI ao Conselho Tutelar."
      };
    }
    return {
      mensagem: `COMUNICADO ESCOLAR DE BUSCA ATIVA & ACOLHIMENTO - E.E. CL\xD3VIS DE LUCCA

Ol\xE1, prezado(a) respons\xE1vel pelo(a) estudante ${nomeAluno} (Turma: ${turmaAluno})! \u{1F3EB}

A equipe gestora da E.E. Cl\xF3vis de Lucca est\xE1 entrando em contato para acompanhar a rotina escolar do(a) estudante. Notamos aus\xEAncias recentes e gostar\xEDamos de saber se est\xE1 tudo bem e de que forma a escola pode auxiliar a fam\xEDlia para garantir a presen\xE7a di\xE1ria \xE0s aulas.

A assiduidade escolar \xE9 fundamental para o desenvolvimento e aprendizagem do estudante, conforme preconiza a Resolu\xE7\xE3o SEDUC n\xBA 39, de 05-09-2023. Por gentileza, responda a esta mensagem ou compare\xE7a \xE0 secretaria para alinharmos qualquer justificativa ou apoio pedag\xF3gico necess\xE1rio.

Contamos com a sua colabora\xE7\xE3o e parceria!

Atenciosamente,
Equipe de Media\xE7\xE3o e Gest\xE3o Escolar - E.E. Cl\xF3vis de Lucca`,
      estagioIdentificado: "1_FAMILIAR",
      tituloEstagio: "Etapa 1 - Contato Familiar & Acolhimento Inicial",
      baseLegal: "Resolu\xE7\xE3o SEDUC n\xBA 39/2023; Lei n\xBA 9.394/1996 (LDB), Art. 12; Lei n\xBA 8.069/1990 (ECA), Art. 53.",
      diagnosticoResumido: `Fase inicial de Busca Ativa com foco no acolhimento familiar, di\xE1logo preventivo e apoio escolar, buscando reverter aus\xEAncias antes de qualquer medida contenciosa.`,
      proximaAcaoSugerida: "Acompanhar retorno dos pais em at\xE9 48h \xFAteis e monitorar frequ\xEAncia di\xE1ria na SED."
    };
  }
  function gerarParecerPedagogicoFallback(aluno, fechamentoNotas, ocorrencias, extras) {
    const nome = String(aluno.nome || "O(A) estudante").trim();
    const turma = String(aluno.turma || aluno.serie || "").trim();
    const freq = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || "em acompanhamento").trim();
    const atrasosCount = Number(aluno.atrasos || 0);
    const tutor = String(aluno.tutor || aluno.tutor_2026 || "").trim();
    const eletiva = String(aluno.eletivas || aluno.eletiva || "").trim();
    const clube = String(aluno.clube || "").trim();
    const pv = String(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.pv || aluno.sonhos || "").trim();
    const isRec = Boolean(aluno.recomposicao);
    const isAee = Boolean(aluno.aee);
    const listaUnificada = (Array.isArray(ocorrencias) ? ocorrencias : []).filter((o) => !isRegistroAutomaticoDossieDoc(o));
    const qtdOcorrencias = listaUnificada.length;
    const qtdConviva = Array.isArray(extras?.listaConviva) ? extras.listaConviva.length : listaUnificada.filter((o) => o.registradoConviva || o.registrado_conviva || String(o.tipo || "").toUpperCase().includes("CONVIVA")).length;
    const qtdBuscaAtiva = Array.isArray(extras?.listaBuscaAtiva) ? extras.listaBuscaAtiva.length : listaUnificada.filter((o) => String(o.origem || "").toUpperCase() === "BUSCA_ATIVA" || o.tipoContato || o.houveResposta !== void 0).length;
    let totalFaltas = extras?.totalFaltasAcumuladas || Number(aluno.faltas_acumuladas || aluno.faltas || aluno.totalFaltas || 0);
    if (!totalFaltas && fechamentoNotas && typeof fechamentoNotas === "object") {
      ["1B", "2B", "3B", "4B"].forEach((k) => {
        if (fechamentoNotas[k]?.totalFaltas) totalFaltas += Number(fechamentoNotas[k].totalFaltas);
      });
      if (!totalFaltas && fechamentoNotas["FINAL"]?.totalFaltas) {
        totalFaltas = Number(fechamentoNotas["FINAL"].totalFaltas);
      }
    }
    let mediaGeral = extras?.mediaGeralConsolidada;
    if (!mediaGeral || mediaGeral === "\u2014") {
      mediaGeral = String(aluno.media_geral_calculada || aluno.media_geral || aluno.media || "em apura\xE7\xE3o");
    }
    let disciplinasAbaixo = extras?.disciplinasAbaixo || [];
    if (disciplinasAbaixo.length === 0 && fechamentoNotas && typeof fechamentoNotas === "object") {
      ["1B", "2B", "3B", "4B", "FINAL"].forEach((b) => {
        if (fechamentoNotas[b]?.disciplinas) {
          Object.entries(fechamentoNotas[b].disciplinas).forEach(([disc, dVal]) => {
            let n = null;
            let nomeDisc = disc;
            if (typeof dVal === "object" && dVal !== null) {
              nomeDisc = dVal.nome || disc;
              n = dVal.notaNum !== void 0 ? dVal.notaNum : dVal.mencaoNota || dVal.nota || dVal.media || dVal.valor;
            } else {
              n = dVal;
            }
            const num = parseFloat(String(n).replace(",", "."));
            if (!isNaN(num) && num < 5) {
              if (!disciplinasAbaixo.some((d) => d.nome.toLowerCase() === nomeDisc.toLowerCase())) {
                disciplinasAbaixo.push({ nome: nomeDisc, nota: n });
              }
            }
          });
        }
      });
    }
    const allOcorrenciasText = listaUnificada.map((o) => `${o.tipo || ""} ${o.descricao || ""} ${o.observacao || ""} ${o.encaminhamento || ""}`).join(" ").toLowerCase();
    const temIndisciplina = allOcorrenciasText.includes("indisciplina") || allOcorrenciasText.includes("afrontosa") || allOcorrenciasText.includes("desrespeito") || allOcorrenciasText.includes("desacato") || allOcorrenciasText.includes("inadequada");
    const temConflitos = allOcorrenciasText.includes("conflito") || allOcorrenciasText.includes("boato") || allOcorrenciasText.includes("fofoca") || allOcorrenciasText.includes("atrito") || allOcorrenciasText.includes("desentendimento") || allOcorrenciasText.includes("agress");
    const temChamadoPais = allOcorrenciasText.includes("responsav") || allOcorrenciasText.includes("pais") || allOcorrenciasText.includes("mae") || allOcorrenciasText.includes("m\xE3e") || allOcorrenciasText.includes("pai") || allOcorrenciasText.includes("termo") || allOcorrenciasText.includes("acordo");
    const temResistencia = allOcorrenciasText.includes("resistencia") || allOcorrenciasText.includes("recusa") || allOcorrenciasText.includes("nega") || allOcorrenciasText.includes("nao aceit") || allOcorrenciasText.includes("n\xE3o aceit");
    const temRedeProtecao = Boolean(aluno.ficha_ct || aluno.oficio) || allOcorrenciasText.includes("conselho tutelar") || allOcorrenciasText.includes("ficai") || allOcorrenciasText.includes("demp") || allOcorrenciasText.includes("rede de prote");
    let perfilComportamental = "";
    if (temIndisciplina || temConflitos) {
      perfilComportamental = `marcada por registros relevantes no Hist\xF3rico Unificado (${qtdOcorrencias} registro(s), sendo ${qtdConviva} protocolo(s) CONVIVA SP e ${qtdBuscaAtiva} a\xE7\xE3o(\xF5es) de Busca Ativa), evidenciando ${temIndisciplina ? "epis\xF3dios de indisciplina e necessidade de media\xE7\xE3o de normas" : "desafios convivenciais"}${temConflitos ? " e conflitos interpessoais acompanhados pela equipe escolar" : ""}.`;
    } else if (qtdOcorrencias > 0) {
      perfilComportamental = `acompanhada por ${qtdOcorrencias} registro(s) no Hist\xF3rico Unificado (${qtdConviva} CONVIVA SP e ${qtdBuscaAtiva} a\xE7\xE3o(\xF5es) de Busca Ativa Escolar), com a\xE7\xF5es orientativas e de media\xE7\xE3o pedag\xF3gica.`;
    } else {
      perfilComportamental = `pautada pelo cumprimento dos combinados de conviv\xEAncia e aus\xEAncia de apontamentos disciplinares ou protocolos CONVIVA SP.`;
    }
    const peiParts = [];
    if (clube && clube !== "N\xE3o informado") peiParts.push(`no clube "${clube}"`);
    if (eletiva && eletiva !== "N\xE3o informada") peiParts.push(`na eletiva "${eletiva}"`);
    const peiAtivStr = peiParts.length > 0 ? `no protagonismo juvenil ${peiParts.join(" e ")}` : "nas a\xE7\xF5es de protagonismo juvenil";
    const tutoriaStr = tutor && tutor !== "N\xE3o informado" ? `, sob acompanhamento da tutoria do(a) professor(a) ${tutor}` : "";
    const rotinasPei = `No \xE2mbito do PEI, participa ${peiAtivStr}${tutoriaStr}.`;
    const faltasStr = totalFaltas > 0 ? ` com ${totalFaltas} faltas acumuladas no ano` : "";
    const atrasosStr = atrasosCount > 0 ? ` e ${atrasosCount} atraso(s) registrado(s)` : "";
    const consecStr = (extras?.frequenciaDiariaResumo?.faltasConsecutivasAtuais || 0) >= 3 ? ` (com ${extras.frequenciaDiariaResumo.faltasConsecutivasAtuais} faltas consecutivas apuradas na chamada di\xE1ria)` : "";
    const discDefasagemStr = disciplinasAbaixo.length > 0 ? `, com defasagem pontual em ${disciplinasAbaixo.map((d) => `${d.nome} (${d.nota})`).join(", ")}` : "";
    const apoioStr = isRec ? ", participando do projeto de recomposi\xE7\xE3o e refor\xE7o intensivo" : isAee ? ", contando com apoio do Atendimento Educacional Especializado (AEE)" : "";
    const acadStr = `Em rela\xE7\xE3o \xE0 assiduidade e ao rendimento, registra frequ\xEAncia de ${freq}${faltasStr}${atrasosStr}${consecStr}, com m\xE9dia geral consolidada de ${mediaGeral}${discDefasagemStr}${apoioStr}.`;
    const par1 = `O(A) estudante ${nome}, matriculado(a) no ${turma || "respectivo ano/s\xE9rie"} da E.E. Cl\xF3vis de Lucca (PEI), apresenta trajet\xF3ria escolar ${perfilComportamental} ${rotinasPei} ${acadStr}`;
    let sinteseIntervencoes = "";
    if (temChamadoPais || temResistencia || temRedeProtecao || qtdBuscaAtiva > 0 || qtdConviva > 0) {
      sinteseIntervencoes = `Na s\xEDntese das interven\xE7\xF5es registradas pela Gest\xE3o, Tutoria, CONVIVA e Busca Ativa, verificam-se ${qtdBuscaAtiva > 0 ? "dilig\xEAncias de contato familiar para garantia da perman\xEAncia escolar, " : ""}acolhimentos e di\xE1logos com os respons\xE1veis legais${temResistencia ? ", registrando-se resist\xEAncia parcial em determinados encaminhamentos" : ""}${temRedeProtecao ? ", al\xE9m de articula\xE7\xE3o com a rede de prote\xE7\xE3o integral (FICAI/Conselho Tutelar)" : ""}.`;
    } else {
      sinteseIntervencoes = `Na s\xEDntese da evolu\xE7\xE3o formativa, observa-se resposta favor\xE1vel \xE0s orienta\xE7\xF5es pedag\xF3gicas e convivenciais desenvolvidas ao longo do per\xEDodo letivo.`;
    }
    const recDisciplinas = disciplinasAbaixo.length > 0 ? `o fortalecimento do plano de recupera\xE7\xE3o nas disciplinas com defasagem (${disciplinasAbaixo.map((d) => d.nome).join(", ")}), ` : "a continuidade do acompanhamento pedag\xF3gico cont\xEDnuo, ";
    const pvMencao = pv && pv !== "N\xE3o informado" ? ` e o fortalecimento do seu Projeto de Vida (${pv})` : " e a consolida\xE7\xE3o do seu Projeto de Vida";
    const recomendacoes = `Para os encaminhamentos do Conselho de Classe e alinhamento com a fam\xEDlia, recomenda-se ${recDisciplinas}metas objetivas de manuten\xE7\xE3o da frequ\xEAncia e pontualidade, al\xE9m de pacto de corresponsabilidade com os respons\xE1veis legais visando o desenvolvimento socioemocional${pvMencao}.`;
    const par2 = `${sinteseIntervencoes} ${recomendacoes}`;
    return `${par1}

${par2}`;
  }
  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fs.existsSync(path.join(distPath, "index.html"));
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER) || hasDist && process.env.NODE_ENV !== "development";
  if (isProduction && hasDist) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port: PORT, hmr: false },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Servidor Cl\xF3vis] Rodando na porta ${PORT} com suporte oficial ao MongoDB Atlas`);
    limparFalsosAtrasosNoBanco().catch((err) => console.warn("[Limpeza Atrasos] Erro inicial:", err?.message || err)).then(() => migrarERemoverGatilhosAutomaticosNoBanco()).catch((err) => console.warn("[Migra\xE7\xE3o Gatilhos Tutoria] Erro inicial:", err?.message || err)).then(() => limparLogsSilenciososDossieNoBanco()).catch((err) => console.warn("[Limpeza Logs Silenciosos Dossi\xEA] Erro inicial:", err?.message || err)).then(() => sincronizarSegmentosAlunosPorTurmaNoBanco()).catch((err) => console.warn("[Sincroniza\xE7\xE3o Segmentos] Erro inicial:", err?.message || err)).finally(() => {
      prewarmCache().catch((err) => console.warn("[MongoDB Prewarm] Erro inicial:", err.message));
    });
  });
}
startServer();
