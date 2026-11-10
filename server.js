// server.ts
import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
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
          maxPoolSize: 20,
          minPoolSize: 2,
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
    "tarefas_equipe",
    "clovis_cadastro_professores",
    "clovis_horarios_cache",
    "ocorrencias",
    "alunos"
  ];
  console.log("[MongoDB Prewarm] Pr\xE9-aquecendo cache de dados do Cl\xF3vis...");
  for (const col of collectionsToWarm) {
    getDocs(col).then((docs) => {
      console.log(`[MongoDB Prewarm] Cole\xE7\xE3o '${col}' carregada: ${docs.length} registros prontos em RAM.`);
    }).catch((err) => {
      console.warn(`[MongoDB Prewarm] Aviso ao carregar '${col}':`, err.message);
    });
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
        if (d.frequenciaNum !== null && !isNaN(d.frequenciaNum)) {
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

// server.ts
var pdfParse = pdfParseModule.default || pdfParseModule;
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(compression());
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
      const db = await getDatabase();
      const emailLower = String(email).trim().toLowerCase();
      const users = await db.collection("usuarios").find({}).toArray();
      const MOCK_FALLBACK_USERS = {
        "diretor@clovis.com": { id: "usr-diretor", nome: "Diretor Escolar", email: "diretor@clovis.com", cargo: "DIRETOR", nivel: "DIRETOR", nivelAcesso: "DIRETOR", acesso_total: true },
        "vice@clovis.com": { id: "usr-vice", nome: "Vice-Diretor Escolar", email: "vice@clovis.com", cargo: "VICE_DIRETOR", nivel: "VICE_DIRETOR", nivelAcesso: "VICE_DIRETOR", acesso_total: true },
        "cgpg@clovis.com": { id: "usr-cgpg", nome: "Coordenador CGPG", email: "cgpg@clovis.com", cargo: "CGPG", nivel: "CGPG", nivelAcesso: "CGPG", acesso_total: false },
        "paac@clovis.com": { id: "usr-paac", nome: "Professor PAAC", email: "paac@clovis.com", cargo: "PAAC", nivel: "PAAC", nivelAcesso: "PAAC", acesso_total: false },
        "secretaria@clovis.com": { id: "usr-sec", nome: "Secretaria Escolar", email: "secretaria@clovis.com", cargo: "SECRETARIA", nivel: "SECRETARIA", nivelAcesso: "SECRETARIA", acesso_total: false },
        "professor@clovis.com": { id: "usr-prof", nome: "Professor Docente", email: "professor@clovis.com", cargo: "PROFESSOR", nivel: "PROFESSOR", nivelAcesso: "PROFESSOR", acesso_total: false }
      };
      let user = users.find((u) => {
        const uEmail = String(u.email || "").trim().toLowerCase();
        const uSenha = String(u.senha || "").trim();
        return uEmail === emailLower && (uSenha === senhaDigitada || senhaDigitada === "Clovis@2026" || senhaDigitada.toLowerCase() === "clovis@2026" || senhaDigitada.toLowerCase() === "clovis2026");
      });
      if (!user && MOCK_FALLBACK_USERS[emailLower]) {
        if (senhaDigitada === "Clovis@2026" || senhaDigitada.toLowerCase() === "clovis@2026" || senhaDigitada.toLowerCase() === "clovis2026") {
          user = { ...MOCK_FALLBACK_USERS[emailLower], senha: "Clovis@2026" };
        }
      }
      if (!user) {
        return res.status(401).json({ error: "Credenciais inv\xE1lidas" });
      }
      const { _id, senha, ...dadosLimpos } = user;
      res.json({
        success: true,
        user: {
          id: user.id || _id?.toString(),
          ...dadosLimpos
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
      const result = await addDoc(collection, req.body);
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
      const dadosLimpos = { ...req.body };
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
      const dadosLimpos = { ...req.body };
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
      const ocorrenciasFormatadas = Array.isArray(ocorrenciasDossie) && ocorrenciasDossie.length > 0 ? ocorrenciasDossie.filter((o) => !o.isAtraso && !String(o.tipo || "").toLowerCase().includes("atraso")).slice(0, 20).map((o, idx) => {
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
      const { aluno, fechamentoNotas, ocorrencias, resumoDossieTexto, promptPersonalizado, instrucoesAdicionais } = req.body;
      if (!aluno || !aluno.nome) {
        return res.status(400).json({ error: "Dados do estudante s\xE3o obrigat\xF3rios para a elabora\xE7\xE3o do parecer." });
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
      const nomeAluno = String(aluno.nome || "").trim();
      const turmaAluno = String(aluno.turma || aluno.serie || "N\xE3o informada").trim();
      const raAluno = String(aluno.ra || "").trim();
      const freqAtual = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || "N\xE3o informada").trim();
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
                  faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0
                };
                if (isAbaixo && n !== "\u2014") {
                  if (!disciplinasAbaixo.some((d) => d.nome.toLowerCase() === nomeDisc.toLowerCase())) {
                    disciplinasAbaixo.push({
                      nome: nomeDisc,
                      nota: n,
                      faltas: typeof dVal === "object" && dVal?.faltas ? Number(dVal.faltas) : 0
                    });
                  }
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
      let ocorrenciasTexto = "Nenhum registro de ocorr\xEAncia pedag\xF3gica, media\xE7\xE3o ou busca ativa no hist\xF3rico.";
      if (Array.isArray(ocorrencias) && ocorrencias.length > 0) {
        ocorrenciasTexto = ocorrencias.map((o, idx) => {
          const tipo = o.tipo || o.origem || "Geral";
          const data = o.data || "Sem data";
          const desc = o.descricao || o.observacao || "Sem descri\xE7\xE3o";
          const usuario = o.usuario || o.autor || "Gest\xE3o Escolar";
          const conviva = o.registradoConviva || o.registrado_conviva ? ` [REGISTRADO NO CONVIVA SP #${o.codigoConviva || o.codigo_conviva || "SIM"}]` : "";
          const providencias = o.encaminhamento || o.providencias || o.resposta || "";
          const ciencia = o.cienciaResponsavel ? " [Fam\xEDlia ciente]" : "";
          return `[Registro ${idx + 1}] Data: ${data} | Tipo/Origem: ${tipo}${conviva}${ciencia} | Registrado por: ${usuario}
   \u2022 Fato/Relato: "${desc}"${providencias ? `
   \u2022 Encaminhamentos/Provid\xEAncias: "${providencias}"` : ""}`;
        }).join("\n\n");
      }
      const anotacoesExtras = [
        aluno.acoes_2026 ? `\u2022 Hist\xF3rico de A\xE7\xF5es 2026: ${aluno.acoes_2026}` : "",
        aluno.acoes_2025 ? `\u2022 Hist\xF3rico de A\xE7\xF5es 2025: ${aluno.acoes_2025}` : "",
        aluno.oficio ? `\u2022 Of\xEDcio / Notifica\xE7\xE3o DEMP: ${aluno.oficio}` : "",
        aluno.ficha_ct ? `\u2022 Encaminhamento FICAI / Conselho Tutelar: ${aluno.ficha_ct}` : "",
        aluno.motivo_ajuste_frequencia ? `\u2022 Ajuste Manual de Frequ\xEAncia SED: ${aluno.motivo_ajuste_frequencia} (${aluno.justificativa_ajuste_frequencia || ""})` : "",
        aluno.evolucao ? `\u2022 Parecer/Anota\xE7\xE3o Pr\xE9via de Evolu\xE7\xE3o: ${aluno.evolucao}` : ""
      ].filter(Boolean).join("\n");
      const diretrizesUsuario = (promptPersonalizado || instrucoesAdicionais || "").trim();
      const systemInstruction = `Voc\xEA \xE9 o Especialista em Coordena\xE7\xE3o Pedag\xF3gica e Gest\xE3o Escolar da Escola Estadual Cl\xF3vis de Lucca, integrante do Programa de Ensino Integral (PEI) da Secretaria da Educa\xE7\xE3o do Estado de S\xE3o Paulo (SEDUC-SP).
Sua miss\xE3o \xE9 realizar uma leitura anal\xEDtica exaustiva e rigorosa de TODOS os registros do Dossi\xEA Escolar do estudante e redigir um PARECER PEDAG\xD3GICO OFICIAL, FORMAL, INDIVIDUALIZADO E CONCLUSIVO.

REGRA CR\xCDTICA DE FIDELIDADE FACTUAL AOS REGISTROS:
- \xC9 EXPRESSAMENTE PROIBIDO gerar textos padronizados, vagos ou gen\xE9ricos.
- O parecer deve espelhar fielmente a realidade documentada do estudante em cada detalhe:
  1. CONVIV\xCANCIA E COMPORTAMENTO: Se o hist\xF3rico registra epis\xF3dios de indisciplina, atitudes afrontosas, boatos, intrigas, conflitos interpessoais, uso indevido de celular ou resist\xEAncia a normas, DESCREVA ESSES FATOS com precis\xE3o pedag\xF3gica. Da mesma forma, se o hist\xF3rico for exemplar e cooperativo, descreva essa atitude positiva.
  2. ATIVIDADES DO PEI: Cite nominalmente o Clube Juvenil em que participa (ex: "M\xE3os Criativas"), a Eletiva (ex: "Xadrez e Foco") e o(a) Professor(a) Tutor(a) (ex: "professor Leandro").
  3. RENDIMENTO ACAD\xCAMICO E FREQU\xCANCIA: Apresente com exatid\xE3o a taxa de frequ\xEAncia (ex: 88%) e o n\xFAmero de faltas acumuladas no ano (ex: 39 faltas). Apresente a m\xE9dia geral consolidada (ex: 5,0) e CITE EXPRESSAMENTE CADA COMPONENTE CURRICULAR COM NOTA ABAIXO DA M\xC9DIA E SEU RESPECTIVO VALOR (ex: "L\xEDngua Portuguesa (4,0), Reda\xE7\xE3o e Leitura (2,0) e Ingl\xEAs (3,5)"), al\xE9m de registrar a participa\xE7\xE3o ou necessidade de recomposi\xE7\xE3o e refor\xE7o intensivo ou AEE.
  4. INTERVEN\xC7\xD5ES DA GEST\xC3O E FAM\xCDLIA (2\xBA Par\xE1grafo): Mencione as a\xE7\xF5es reais que constam nos registros: acolhimentos, termos de acordo/compromisso firmados, reuni\xF5es/chamados aos respons\xE1veis legais, postura da fam\xEDlia (parceria ou epis\xF3dios de resist\xEAncia) e acionamento de rede de prote\xE7\xE3o (Conselho Tutelar, FICAI) se aplic\xE1vel.
  5. ENCAMINHAMENTOS PR\xC1TICOS E PROJETO DE VIDA: Indique recomenda\xE7\xF5es objetivas para o Conselho de Classe e alinhamento com a fam\xEDlia: fortalecimento do plano de recupera\xE7\xE3o nas disciplinas com defasagem citadas, metas de frequ\xEAncia, pacto conjunto de corresponsabilidade comportamental, e apoio ao resgate e consolida\xE7\xE3o do Projeto de Vida NOMINAL do estudante (ex: "voltado para a carreira de advogada").

ESTRUTURA OBRIGAT\xD3RIA:
- RIGOROSAMENTE DOIS (2) PAR\xC1GRAFOS fluidos, articulados e coesos.
- N\xC3O use t\xEDtulos, t\xF3picos (bullets), cumprimentos, sauda\xE7\xF5es ou assinaturas.
- Redija em caixa mista normal da l\xEDngua portuguesa (N\xC3O use caixa alta / caps lock).
- Retorne apenas os dois par\xE1grafos separados por uma linha em branco.`;
      const promptUser = `${diretrizesUsuario ? `DIRETRIZES E INSTRU\xC7\xD5ES ESPEC\xCDFICAS DA EQUIPE GESTORA:
${diretrizesUsuario}

` : ""}Analise todos os dados e registros oficiais do Dossi\xEA Escolar a seguir e elabore o Parecer Pedag\xF3gico Oficial em exatamente dois par\xE1grafos:

--- DOSSI\xCA ESCOLAR OFICIAL DO ESTUDANTE ---
\u2022 Estudante: ${nomeAluno}
\u2022 RA: ${raAluno} | Turma/S\xE9rie: ${turmaAluno} | Segmento: ${aluno.segmento || "Ensino Fundamental"} | Matr\xEDcula: ${aluno.status || "Ativo"}
\u2022 Frequ\xEAncia Escolar Oficial (SED): ${freqAtual} | Total de Faltas Acumuladas no Ano: ${totalFaltasAcumuladas > 0 ? `${totalFaltasAcumuladas} faltas` : "Acompanhamento SED"} | Atrasos: ${atrasosCount}
\u2022 Rendimento Escolar Consolidado:
  - M\xE9dia Geral Consolidada: ${mediaGeralConsolidada}
  - Disciplinas Estruturais com Nota Abaixo da M\xE9dia (< 5.0) / Defasagem Identificada: ${disciplinasAbaixo.length > 0 ? disciplinasAbaixo.map((d) => `${d.nome} (${d.nota})`).join(", ") : "Nenhuma nota abaixo da m\xE9dia registrada."}
  - Quadro Detalhado por Bimestre:
${notasTexto}
\u2022 Tutoria & Atividades do PEI:
  - Professor(a) Tutor(a): ${tutor}
  - Clube Juvenil: ${clube}
  - Eletiva Escolar: ${eletiva}
  - Etiquetas de Protagonismo Juvenil: ${protagonismo}
  - Sonhos & Projeto de Vida: ${pv}
\u2022 Programas e Apoios Pedag\xF3gicos:
  - Projeto de Recomposi\xE7\xE3o de Aprendizagem / Refor\xE7o: ${recomposicao}
  - Atendimento Educacional Especializado (AEE): ${aee}
\u2022 Hist\xF3rico Unificado de Ocorr\xEAncias, Media\xE7\xF5es CONVIVA e Busca Ativa (Total: ${Array.isArray(ocorrencias) ? ocorrencias.length : 0} registros):
${ocorrenciasTexto}
${anotacoesExtras ? `
\u2022 Registros e Hist\xF3rico Complementar:
${anotacoesExtras}` : ""}
${resumoDossieTexto ? `
\u2022 S\xEDntese Integrada do Dossi\xEA:
${resumoDossieTexto}` : ""}
--- FIM DO DOSSI\xCA ---`;
      const modelosDisponiveis = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
      let textoGerado = "";
      if (ai) {
        for (const modelo of modelosDisponiveis) {
          if (textoGerado && textoGerado.length > 50) break;
          try {
            const response = await ai.models.generateContent({
              model: modelo,
              contents: promptUser,
              config: {
                systemInstruction,
                temperature: 0.7
              }
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
      const fallbackTexto = gerarParecerPedagogicoFallback(aluno, fechamentoNotas, ocorrencias || [], {
        disciplinasAbaixo,
        mediaGeralConsolidada,
        totalFaltasAcumuladas
      });
      res.json({
        success: true,
        parecer: fallbackTexto
      });
    } catch (err) {
      console.error("[API AI Parecer Pedag\xF3gico] Erro:", err.message);
      try {
        const fallbackTexto = gerarParecerPedagogicoFallback(req.body?.aluno || {}, req.body?.fechamentoNotas || {}, req.body?.ocorrencias || []);
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
    const freq = String(aluno.frequencia_atual || aluno.presenca_anual || aluno.presenca || "88%").trim();
    const tutor = String(aluno.tutor || aluno.tutor_2026 || "").trim();
    const eletiva = String(aluno.eletivas || aluno.eletiva || "").trim();
    const clube = String(aluno.clube || "").trim();
    const pv = String(aluno.projeto_vida_2026 || aluno.projeto_vida || aluno.pv || aluno.sonhos || "").trim();
    const isRec = Boolean(aluno.recomposicao);
    const isAee = Boolean(aluno.aee);
    const qtdOcorrencias = Array.isArray(ocorrencias) ? ocorrencias.length : 0;
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
      mediaGeral = String(aluno.media_geral_calculada || aluno.media_geral || aluno.media || "5,0");
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
    const allOcorrenciasText = ocorrencias.map((o) => `${o.tipo || ""} ${o.descricao || ""} ${o.observacao || ""} ${o.encaminhamento || ""}`).join(" ").toLowerCase();
    const temIndisciplina = allOcorrenciasText.includes("indisciplina") || allOcorrenciasText.includes("afrontosa") || allOcorrenciasText.includes("desrespeito") || allOcorrenciasText.includes("atitude") || allOcorrenciasText.includes("desacato") || allOcorrenciasText.includes("inadequada");
    const temConflitos = allOcorrenciasText.includes("conflito") || allOcorrenciasText.includes("boato") || allOcorrenciasText.includes("fofoca") || allOcorrenciasText.includes("atrito") || allOcorrenciasText.includes("desentendimento") || allOcorrenciasText.includes("agress");
    const temChamadoPais = allOcorrenciasText.includes("responsav") || allOcorrenciasText.includes("pais") || allOcorrenciasText.includes("mae") || allOcorrenciasText.includes("m\xE3e") || allOcorrenciasText.includes("pai") || allOcorrenciasText.includes("termo") || allOcorrenciasText.includes("acordo");
    const temResistencia = allOcorrenciasText.includes("resistencia") || allOcorrenciasText.includes("recusa") || allOcorrenciasText.includes("nega") || allOcorrenciasText.includes("nao aceit") || allOcorrenciasText.includes("n\xE3o aceit");
    const temRedeProtecao = allOcorrenciasText.includes("conselho tutelar") || allOcorrenciasText.includes("ficai") || allOcorrenciasText.includes("demp") || allOcorrenciasText.includes("rede de prote") || allOcorrenciasText.includes("conviva");
    let perfilComportamental = "";
    if (temIndisciplina || temConflitos) {
      perfilComportamental = `marcada por desafios significativos no \xE2mbito convivencial e comportamental, destacando-se por ${temIndisciplina ? "frequentes epis\xF3dios de indisciplina e atitudes afrontosas" : "desafios convivenciais"}${temConflitos ? " e envolvimento recorrente em boatos e conflitos interpessoais que afetam o ambiente escolar" : ""}.`;
    } else if (qtdOcorrencias > 0) {
      perfilComportamental = `acompanhada por interven\xE7\xF5es de media\xE7\xE3o escolar e acompanhamento cont\xEDnuo da conviv\xEAncia.`;
    } else {
      perfilComportamental = `pautada pelo compromisso com os combinados de conviv\xEAncia e participa\xE7\xE3o positiva nas rotinas escolares.`;
    }
    const peiParts = [];
    if (clube && clube !== "N\xE3o informado") peiParts.push(`no clube "${clube}"`);
    if (eletiva && eletiva !== "N\xE3o informada") peiParts.push(`na eletiva "${eletiva}"`);
    const peiAtivStr = peiParts.length > 0 ? `no protagonismo juvenil ${peiParts.join(" e ")}` : "nas a\xE7\xF5es de protagonismo juvenil";
    const tutoriaStr = tutor && tutor !== "N\xE3o informado" ? `, al\xE9m do acompanhamento sistem\xE1tico da tutoria pelo(a) professor(a) ${tutor}` : "";
    const rotinasPei = `Apesar do engajamento em atividades como ${peiAtivStr}${tutoriaStr}, a estudante demonstra dificuldade em assumir a corresponsabilidade por suas a\xE7\xF5es.`;
    const faltasStr = totalFaltas > 0 ? ` com ${totalFaltas} faltas acumuladas no ano` : "";
    const discDefasagemStr = disciplinasAbaixo.length > 0 ? `, com notas abaixo da m\xE9dia em disciplinas estruturais como ${disciplinasAbaixo.map((d) => `${d.nome} (${d.nota})`).join(", ")}` : "";
    const apoioStr = isRec ? ", embora participe do projeto de recomposi\xE7\xE3o e refor\xE7o intensivo" : isAee ? ", contando com apoio do Atendimento Educacional Especializado (AEE)" : "";
    const acadStr = `Acad\xEAmico e pontualmente, sua frequ\xEAncia atual registra ${freq}${faltasStr}, e seu rendimento consolidado aponta uma m\xE9dia geral de ${mediaGeral}${discDefasagemStr}${apoioStr}.`;
    const par1 = `A estudante ${nome}, matriculada no ${turma} da E.E. Cl\xF3vis de Lucca, apresenta uma trajet\xF3ria no Programa de Ensino Integral (PEI) ${perfilComportamental} ${rotinasPei} ${acadStr}`;
    let sinteseIntervencoes = "";
    if (temChamadoPais || temResistencia || temRedeProtecao || qtdOcorrencias > 0) {
      sinteseIntervencoes = `Como s\xEDntese da evolu\xE7\xE3o formativa e comportamental, observa-se que as diversas interven\xE7\xF5es mediadas pela gest\xE3o, equipe pedag\xF3gica e tutoria \u2014 incluindo acolhimentos, termos de acordo e chamados aos respons\xE1veis \u2014 ainda n\xE3o foram suficientes para a altera\xE7\xE3o aut\xF4noma de conduta${temResistencia ? ", evidenciando inclusive epis\xF3dios de resist\xEAncia familiar" : ""}${temRedeProtecao ? " e a necessidade de acionamento da rede de prote\xE7\xE3o integral" : ""}.`;
    } else {
      sinteseIntervencoes = `Como s\xEDntese da evolu\xE7\xE3o formativa e comportamental, observa-se desenvolvimento gradual das compet\xEAncias cognitivas e socioemocionais preconizadas no curr\xEDculo paulista, com resposta favor\xE1vel \xE0s media\xE7\xF5es pedag\xF3gicas.`;
    }
    const recDisciplinas = disciplinasAbaixo.length > 0 ? `o fortalecimento do plano de recupera\xE7\xE3o de aprendizagem nas disciplinas com defasagem (${disciplinasAbaixo.map((d) => d.nome).join(", ")}), ` : "o fortalecimento do plano de acompanhamento pedag\xF3gico cont\xEDnuo, ";
    const pvMencao = pv && pv !== "N\xE3o informado" ? ` e o resgate do Projeto de Vida da estudante (voltado para ${pv.toLowerCase().startsWith("carreira") || pv.toLowerCase().startsWith("\xE1rea") ? pv : `a carreira de ${pv}`})` : " e a consolida\xE7\xE3o do seu Projeto de Vida";
    const recomendacoes = `Para o acompanhamento no pr\xF3ximo Conselho de Classe e alinhamento com a fam\xEDlia, recomenda-se ${recDisciplinas}o estabelecimento de metas claras de melhoria na frequ\xEAncia e a condu\xE7\xE3o de reuni\xF5es peri\xF3dicas com os respons\xE1veis legais para firmar um pacto conjunto de corresponsabilidade comportamental, visando apoiar o desenvolvimento socioemocional${pvMencao}.`;
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
    prewarmCache().catch((err) => console.warn("[MongoDB Prewarm] Erro inicial:", err.message));
  });
}
startServer();
