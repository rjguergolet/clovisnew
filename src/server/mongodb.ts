import { MongoClient, Db, ObjectId, Document, Filter, UpdateFilter } from 'mongodb';

// Configurações de Conexão com MongoDB Atlas
const DEFAULT_MONGODB_URI = "mongodb+srv://rjguergolet_db_user:VOhSALVz8CcLe4qc@cluster0.isl7e97.mongodb.net/";
const DEFAULT_DB_NAME = "escola_clovis";

const uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME;

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let connectionPromise: Promise<Db> | null = null;

/**
 * Conecta ao MongoDB Atlas usando o driver oficial 'mongodb'
 * com pool de conexão singleton e reconexão automática resiliente
 */
export async function getDatabase(): Promise<Db> {
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
          serverSelectionTimeoutMS: 8000,
          connectTimeoutMS: 10000,
          maxPoolSize: 10,
          minPoolSize: 1,
          retryWrites: true,
          w: 'majority'
        });
      }

      await client.connect();
      console.log(`[MongoDB Atlas] Conexão ativa com sucesso ao banco '${dbName}'!`);
      dbInstance = client.db(dbName);
      return dbInstance;
    } catch (err: any) {
      connectionPromise = null;
      dbInstance = null;
      console.error('[MongoDB Atlas] Erro de conexão ao cluster Atlas:', err?.message || err);
      throw err;
    }
  })();

  return connectionPromise;
}

/**
 * Resolve apelidos e nomes legados para as coleções reais criadas no MongoDB Atlas
 */
export function resolveCollectionName(collectionName: string): string {
  const map: Record<string, string> = {
    horarios: 'clovis_horarios_cache',
    grade_horaria: 'clovis_horarios_cache',
    eventos: 'agenda_eventos',
    agenda: 'agenda_eventos',
    rotina_equipe: 'tarefas_equipe',
    tarefas: 'tarefas_equipe',
    professores: 'clovis_cadastro_professores',
    docentes: 'clovis_cadastro_professores',
    mural_recados: 'mural_recados_memoria',
    mural: 'mural_recados_memoria',
    periodos: 'clovis_periodos_aula',
    periodos_aula: 'clovis_periodos_aula',
    substituicoes: 'substituicoes_diarias',
  };
  return map[collectionName] || collectionName;
}

/**
 * Converte documento MongoDB BSON em um objeto JavaScript limpo
 */
export function formatMongoDoc<T = Record<string, any>>(doc: Document | null): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  const idStr = _id ? (typeof _id === 'object' && 'toHexString' in _id ? _id.toHexString() : String(_id)) : '';
  const resolvedId = (rest.id && String(rest.id).trim() !== '' && rest.id !== 'undefined')
    ? String(rest.id)
    : (idStr || (rest.ra ? String(rest.ra) : ''));

  delete (rest as any)._id;

  // Garante que o campo cientes (Mural de Recados) seja sempre um array legítimo
  if (rest.cientes !== undefined && rest.cientes !== null) {
    if (typeof rest.cientes === 'object' && (rest.cientes as any).__arrayUnion && Array.isArray((rest.cientes as any).elements)) {
      rest.cientes = (rest.cientes as any).elements;
    } else if (!Array.isArray(rest.cientes)) {
      rest.cientes = [];
    }
  }

  return {
    ...rest,
    ...(rest.ra ? { ra: String(rest.ra) } : {}),
    id: resolvedId
  } as T;
}

/**
 * Cria uma consulta flexível e segura para localizar documentos
 * por id, ra ou _id (suporta ObjectId e string)
 */
export function buildDocumentQuery(id: string | number): Filter<Document> {
  if (!id && id !== 0) {
    return { id: '__invalid_null_id__' };
  }

  const strId = String(id).trim();
  const conditions: Filter<Document>[] = [
    { id: strId },
    { ra: strId },
    { _id: strId as any }
  ];

  // Se for numérico, inclui busca por número para compatibilidade com importações legadas
  if (!isNaN(Number(strId)) && strId !== '') {
    conditions.push({ ra: Number(strId) as any });
    conditions.push({ id: Number(strId) as any });
  }

  // Se tiver formato exato de ObjectId (24 caracteres hexadecimais válidos)
  if (ObjectId.isValid(strId) && strId.length === 24) {
    try {
      conditions.push({ _id: new ObjectId(strId) });
    } catch (_) {}
  }

  return { $or: conditions };
}

/**
 * Sanitiza e prepara o payload para operações de atualização no MongoDB
 * Previne erros de mutabilidade no campo imutável '_id' e suporta arrayUnion
 * Remove id e _id de elementos de arrays (ex: ocorrências) para cumprir regras de integração
 */
export function parseDataForMongo(data: Record<string, any>): UpdateFilter<Document> {
  const setFields: Record<string, any> = {};
  const pushFields: Record<string, any> = {};
  const addToSetFields: Record<string, any> = {};

  for (const [key, val] of Object.entries(data || {})) {
    // Nunca incluir campos de identificação em $set
    if (key === '_id' || key === 'id') {
      continue;
    }

    if (val && typeof val === 'object' && val.__arrayUnion === true && Array.isArray(val.elements)) {
      // Sanitizar elementos de array (como ocorrências): nunca incluir id ou _id
      const sanitizedElements = val.elements.map((el: any) => {
        if (el && typeof el === 'object') {
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

  setFields.atualizadoEm = new Date().toISOString();

  const updateObj: any = { $set: setFields };

  if (Object.keys(addToSetFields).length > 0) {
    updateObj.$addToSet = addToSetFields;
  }
  if (Object.keys(pushFields).length > 0) {
    updateObj.$push = pushFields;
  }

  return updateObj;
}

// ==========================================================
// CAMADA DE CACHE EM MEMÓRIA DE ALTA PERFORMANCE (RAM CACHE)
// ==========================================================
interface CacheEntry {
  docs: any[];
  timestamp: number;
}

const collectionCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<any[]>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos de TTL

/**
 * Busca todos os alunos do MongoDB Atlas de forma ultra-otimizada
 * usando busca de IDs + chunks paralelos para contornar o gargalo de WAN
 */
async function fetchAllAlunosFromDb(): Promise<any[]> {
  const db = await getDatabase();
  const realName = 'alunos';

  // 1. Obter todos os _ids com projeção mínima (leva ~600ms)
  const idDocs = await db.collection(realName).find({}, { projection: { _id: 1 } }).toArray();
  if (!idDocs || idDocs.length === 0) return [];

  if (idDocs.length <= 50) {
    const rawDocs = await db.collection(realName).find({}).toArray();
    return rawDocs.map(doc => formatMongoDoc(doc)!).filter(Boolean);
  }

  // 2. Dividir em chunks paralelos de 75 IDs
  const chunkSize = 75;
  const chunks: any[][] = [];
  for (let i = 0; i < idDocs.length; i += chunkSize) {
    chunks.push(idDocs.slice(i, i + chunkSize).map(d => d._id));
  }

  // 3. Executar em paralelo
  const results = await Promise.all(chunks.map(async (cIds) => {
    const docs = await db.collection(realName).find({ _id: { $in: cIds } }).toArray();
    return docs;
  }));

  const allRaw = results.flat();
  return allRaw.map(doc => formatMongoDoc(doc)!).filter(Boolean);
}

/**
 * Carrega uma coleção do banco (com estratégia especializada para alunos)
 */
async function fetchCollectionFromDb(realName: string): Promise<any[]> {
  if (realName === 'alunos') {
    return fetchAllAlunosFromDb();
  }
  const db = await getDatabase();
  const rawDocs = await db.collection(realName).find({}).toArray();
  return rawDocs.map(doc => formatMongoDoc(doc)!).filter(Boolean);
}

/**
 * Atualiza o item de cache local após operações de escrita (Write-Through)
 */
function updateCacheItem(realName: string, id: string, data: Record<string, any>, isMerge: boolean) {
  const entry = collectionCache.get(realName);
  if (!entry || !Array.isArray(entry.docs)) return;

  const cleanId = String(id).trim();
  const idx = entry.docs.findIndex((d: any) => 
    String(d.id || '') === cleanId || 
    String(d.ra || '') === cleanId ||
    String(d.docId || '') === cleanId
  );

  const existingDoc = idx >= 0 ? entry.docs[idx] : {};
  const processedData: Record<string, any> = {};

  for (const [k, v] of Object.entries(data || {})) {
    if (v && typeof v === 'object' && v.__arrayUnion === true && Array.isArray(v.elements)) {
      const existingArr = Array.isArray(existingDoc[k]) ? [...existingDoc[k]] : [];
      v.elements.forEach((newEl: any) => {
        const jsonStr = JSON.stringify(newEl);
        if (!existingArr.some((ex: any) => JSON.stringify(ex) === jsonStr)) {
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
    ...(realName === 'alunos' ? { ra: cleanId } : {})
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

/**
 * Remove o item do cache local após deleteDoc
 */
function removeCacheItem(realName: string, id: string) {
  const entry = collectionCache.get(realName);
  if (!entry || !Array.isArray(entry.docs)) return;
  const cleanId = String(id).trim();
  entry.docs = entry.docs.filter((d: any) => 
    String(d.id || '') !== cleanId && 
    String(d.ra || '') !== cleanId &&
    String(d.docId || '') !== cleanId
  );
}

/**
 * Invalida o cache de uma coleção
 */
export function invalidateCollectionCache(collectionName: string) {
  const realName = resolveCollectionName(collectionName);
  collectionCache.delete(realName);
  pendingFetches.delete(realName);
}

/**
 * Pré-carrega coleções críticas no boot do servidor para que a primeira requisição do usuário seja imediata
 */
export async function prewarmCache(): Promise<void> {
  const collectionsToWarm = [
    'usuarios',
    'agenda_eventos',
    'mural_recados_memoria',
    'alunos'
  ];

  console.log('[MongoDB Prewarm] Pré-aquecendo cache essencial (otimizado para Render 512MB RAM)...');
  for (const col of collectionsToWarm) {
    try {
      const docs = await getDocs(col);
      console.log(`[MongoDB Prewarm] Coleção '${col}' carregada: ${docs.length} registros em RAM.`);
    } catch (err: any) {
      console.warn(`[MongoDB Prewarm] Aviso ao carregar '${col}':`, err?.message || err);
    }
  }
}

/**
 * Busca documentos de uma coleção com suporte a cache em memória de alta velocidade
 */
export async function getDocs<T = Record<string, any>>(
  collectionName: string, 
  filter: Record<string, any> = {},
  options: { sort?: Record<string, any>; limit?: number } = {}
): Promise<T[]> {
  const realName = resolveCollectionName(collectionName);
  const now = Date.now();

  const filterKeys = Object.keys(filter).filter(k => filter[k] !== undefined && filter[k] !== null && filter[k] !== '');
  const hasFilter = filterKeys.length > 0;

  let cachedEntry = collectionCache.get(realName);

  // Se o cache não existe ou expirou
  if (!cachedEntry || (now - cachedEntry.timestamp > CACHE_TTL_MS)) {
    if (!pendingFetches.has(realName)) {
      const fetchPromise = (async () => {
        try {
          const freshDocs = await fetchCollectionFromDb(realName);
          collectionCache.set(realName, { docs: freshDocs, timestamp: Date.now() });
          return freshDocs;
        } catch (err: any) {
          console.error(`[MongoDB Cache] Erro ao carregar ${realName}:`, err.message);
          if (collectionCache.has(realName)) {
            return collectionCache.get(realName)!.docs;
          }
          throw err;
        } finally {
          pendingFetches.delete(realName);
        }
      })();
      pendingFetches.set(realName, fetchPromise);
    }

    if (cachedEntry) {
      // Stale-while-revalidate: usa os dados atuais em RAM sem bloquear a requisição
    } else {
      // Espera a carga inicial
      await pendingFetches.get(realName);
      cachedEntry = collectionCache.get(realName);
    }
  }

  // Se a busca for de alunos com parâmetro de texto de busca (q, search, termo)
  if (realName === 'alunos' && (filter.q || filter.search || filter.termo)) {
    const queryText = String(filter.q || filter.search || filter.termo);
    const turma = filter.turma ? String(filter.turma) : undefined;
    const status = filter.status ? String(filter.status) : undefined;
    return (await searchAlunosInDb(queryText, { turma, status, limit: options.limit })) as T[];
  }

  // Se temos dados em cache, aplica filtragem, ordenação e limite em RAM (0ms de latência)
  if (cachedEntry && Array.isArray(cachedEntry.docs)) {
    let result = cachedEntry.docs as T[];

    if (hasFilter) {
      result = result.filter(doc => {
        for (const k of filterKeys) {
          const targetVal = String(filter[k]).toLowerCase();
          const docVal = String((doc as any)[k] ?? '').toLowerCase();
          if (docVal !== targetVal) return false;
        }
        return true;
      });
    }

    if (options.sort) {
      const [sortField, sortDir] = Object.entries(options.sort)[0] || [];
      if (sortField) {
        result = [...result].sort((a: any, b: any) => {
          const valA = a[sortField];
          const valB = b[sortField];
          if (valA === valB) return 0;
          if (valA === undefined || valA === null) return 1;
          if (valB === undefined || valB === null) return -1;
          return sortDir === -1 
            ? (valA < valB ? 1 : -1)
            : (valA > valB ? 1 : -1);
        });
      }
    }

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  // Fallback caso ocorra alguma anomalia: consulta direta no MongoDB
  const db = await getDatabase();
  let cursor = db.collection(realName).find(filter);
  if (options.sort) cursor = cursor.sort(options.sort);
  if (options.limit && options.limit > 0) cursor = cursor.limit(options.limit);
  const rawDocs = await cursor.toArray();
  return rawDocs.map(doc => formatMongoDoc<T>(doc)!) as T[];
}

/**
 * Normaliza strings para busca insensível a acentos e maiúsculas
 */
function normalizarTextoParaBusca(str: any): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Busca inteligente de alunos diretamente no MongoDB (com aceleração de cache em RAM)
 */
export async function searchAlunosInDb(
  queryText: string,
  options: { turma?: string; status?: string; limit?: number } = {}
): Promise<any[]> {
  const searchTerm = String(queryText || '').trim();
  const searchNorm = normalizarTextoParaBusca(searchTerm);
  const searchDigits = searchTerm.replace(/\D/g, '');
  const tokens = searchNorm ? searchNorm.split(/\s+/).filter(Boolean) : [];

  const filterTurma = options.turma ? options.turma.toUpperCase().trim() : '';
  const filterStatus = options.status ? options.status.toUpperCase().trim() : '';
  const limitCount = options.limit && options.limit > 0 ? options.limit : 100;

  // Garante que a base está carregada no cache em RAM
  const todos = await getDocs('alunos');
  if (!Array.isArray(todos) || todos.length === 0) {
    return [];
  }

  // Se não houver termo de busca, retorna os primeiros respeitando filtros
  if (tokens.length === 0 && !searchDigits) {
    let base = todos;
    if (filterTurma) {
      base = base.filter(s => (s.turma || '').toUpperCase() === filterTurma);
    }
    if (filterStatus) {
      base = base.filter(s => (s.status || 'ativo').toUpperCase() === filterStatus);
    }
    return base.slice(0, limitCount);
  }

  // Filtragem multi-token inteligente em RAM (< 1ms para 751 alunos)
  let filtrados = todos.filter(student => {
    const raStr = String(student.ra || student.id || '').toUpperCase();
    const raClean = raStr.replace(/\D/g, '');

    // Correspondência direta por RA (se digitou pelo menos 3 dígitos numéricos)
    if (searchDigits.length >= 3 && raClean.includes(searchDigits)) {
      return true;
    }

    const nomeNorm = normalizarTextoParaBusca(student.nome);
    const turmaNorm = normalizarTextoParaBusca(student.turma);
    const tutorNorm = normalizarTextoParaBusca(student.tutor || student.tutor_2026);
    const statusNorm = normalizarTextoParaBusca(student.status || 'ativo');
    const searchBlob = `${nomeNorm} ${raStr} ${raClean} ${turmaNorm} ${tutorNorm} ${statusNorm}`;

    return tokens.every(tk => searchBlob.includes(tk));
  });

  // Filtros adicionais opcionais de turma e status
  if (filterTurma) {
    const naTurma = filtrados.filter(s => (s.turma || '').toUpperCase() === filterTurma);
    if (naTurma.length > 0) filtrados = naTurma;
  }
  if (filterStatus && filterStatus !== 'TODOS') {
    filtrados = filtrados.filter(s => (s.status || 'ativo').toUpperCase() === filterStatus);
  }

  // Ordenação por relevância:
  // 1. RA exato no topo
  // 2. Nome iniciando com o termo de busca
  // 3. Primeiro nome iniciando com o primeiro token
  // 4. Ordem alfabética
  filtrados.sort((a, b) => {
    const aRa = String(a.ra || a.id || '');
    const bRa = String(b.ra || b.id || '');
    const aRaClean = aRa.replace(/\D/g, '');
    const bRaClean = bRa.replace(/\D/g, '');

    const aExactRa = aRa === searchTerm || (searchDigits.length >= 4 && aRaClean === searchDigits);
    const bExactRa = bRa === searchTerm || (searchDigits.length >= 4 && bRaClean === searchDigits);
    if (aExactRa && !bExactRa) return -1;
    if (!aExactRa && bExactRa) return 1;

    const aNomeNorm = normalizarTextoParaBusca(a.nome);
    const bNomeNorm = normalizarTextoParaBusca(b.nome);
    const aStarts = aNomeNorm.startsWith(searchNorm);
    const bStarts = bNomeNorm.startsWith(searchNorm);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    const aFirst = aNomeNorm.split(' ')[0] || '';
    const bFirst = bNomeNorm.split(' ')[0] || '';
    const firstToken = tokens[0] || '';
    const aFirstStarts = aFirst.startsWith(firstToken);
    const bFirstStarts = bFirst.startsWith(firstToken);
    if (aFirstStarts && !bFirstStarts) return -1;
    if (!aFirstStarts && bFirstStarts) return 1;

    return String(a.nome || '').localeCompare(String(b.nome || ''));
  });

  return filtrados.slice(0, limitCount);
}

/**
 * Conta documentos de uma coleção
 */
export async function countDocs(
  collectionName: string,
  filter: Record<string, any> = {}
): Promise<number> {
  const realName = resolveCollectionName(collectionName);
  const cachedEntry = collectionCache.get(realName);
  const filterKeys = Object.keys(filter).filter(k => filter[k] !== undefined && filter[k] !== null && filter[k] !== '');

  if (cachedEntry && Array.isArray(cachedEntry.docs) && filterKeys.length === 0) {
    return cachedEntry.docs.length;
  }

  const db = await getDatabase();
  return db.collection(realName).countDocuments(filter);
}

/**
 * Busca um único documento pelo seu identificador (id, ra ou _id)
 */
export async function getDoc<T = Record<string, any>>(
  collectionName: string, 
  id: string
): Promise<T | null> {
  const realName = resolveCollectionName(collectionName);
  const cleanId = String(id).trim();

  // Consulta imediata em memória se a coleção estiver em cache
  const cachedEntry = collectionCache.get(realName);
  if (cachedEntry && Array.isArray(cachedEntry.docs)) {
    const found = cachedEntry.docs.find((d: any) => 
      String(d.id || '') === cleanId || 
      String(d.ra || '') === cleanId || 
      String(d.docId || '') === cleanId ||
      String(d._id || '') === cleanId
    );
    if (found) {
      return found as T;
    }
  }

  const db = await getDatabase();
  const col = db.collection(realName);
  const query = buildDocumentQuery(id);
  const doc = await col.findOne(query);

  return formatMongoDoc<T>(doc);
}

/**
 * Salva ou atualiza um documento por ID (setDoc resiliente com merge e upsert)
 */
export async function setDoc(
  collectionName: string, 
  id: string, 
  data: Record<string, any>,
  options: { merge?: boolean } = { merge: true }
): Promise<void> {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);

  const filter = buildDocumentQuery(id);
  const cleanId = String(id).trim();

  // Atualiza cache em memória imediatamente
  updateCacheItem(realName, cleanId, data, options.merge !== false);

  if (options.merge) {
    const updateOperation = parseDataForMongo(data);
    const setOnInsert: Record<string, any> = { 
      id: cleanId, 
      criadoEm: data.criadoEm || new Date().toISOString() 
    };
    // Adiciona RA apenas para alunos e se não foi fornecido no payload de atualização
    if (collectionName === 'alunos' && !('ra' in (updateOperation.$set as any || {}))) {
      setOnInsert.ra = cleanId;
    }
    updateOperation.$setOnInsert = setOnInsert;
    await col.updateOne(filter, updateOperation, { upsert: true });
  } else {
    // Substituição total: limpa campos sensíveis e preserva IDs
    const payload: Record<string, any> = { ...data };
    delete payload._id;
    payload.id = cleanId;
    payload.atualizadoEm = new Date().toISOString();
    
    // Tenta substituir registro existente
    const result = await col.replaceOne(filter, payload, { upsert: true });
    if (!result.acknowledged) {
      throw new Error(`Falha ao substituir documento ${cleanId} na coleção ${realName}`);
    }
  }
}

/**
 * Adiciona um novo documento na coleção (addDoc)
 */
export async function addDoc(
  collectionName: string, 
  data: Record<string, any>
): Promise<{ id: string }> {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);

  const payload: Record<string, any> = {
    ...data,
    criadoEm: data.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
  delete payload._id;

  const result = await col.insertOne(payload);
  const id = result.insertedId.toHexString ? result.insertedId.toHexString() : result.insertedId.toString();

  // Garante persistência explícita do campo id
  await col.updateOne({ _id: result.insertedId }, { $set: { id } });

  // Atualiza cache em memória
  updateCacheItem(realName, id, { ...data, id }, false);

  return { id };
}

/**
 * Atualiza campos específicos de um documento existente com fallback para upsert
 */
export async function updateDoc(
  collectionName: string, 
  id: string, 
  data: Record<string, any>
): Promise<void> {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);

  const filter = buildDocumentQuery(id);
  const updateOperation = parseDataForMongo(data);
  const cleanId = String(id).trim();

  // Atualiza cache em memória imediatamente
  updateCacheItem(realName, cleanId, data, true);

  const setOnInsert: Record<string, any> = { 
    id: cleanId, 
    criadoEm: new Date().toISOString() 
  };
  if (collectionName === 'alunos' && !('ra' in (updateOperation.$set as any || {}))) {
    setOnInsert.ra = cleanId;
  }
  updateOperation.$setOnInsert = setOnInsert;

  await col.updateOne(filter, updateOperation, { upsert: true });
}

/**
 * Remove um documento por ID ou RA
 */
export async function deleteDoc(
  collectionName: string, 
  id: string
): Promise<void> {
  const db = await getDatabase();
  const realName = resolveCollectionName(collectionName);
  const col = db.collection(realName);

  // Remove do cache em memória
  removeCacheItem(realName, id);

  const filter = buildDocumentQuery(id);
  await col.deleteMany(filter);
}

/**
 * Executa lote de operações com consistência e tratamento de erro
 */
export async function executeBatch(
  operations: Array<{ type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }>
): Promise<void> {
  for (const op of operations) {
    if (!op || !op.collection || !op.id) continue;
    
    try {
      if (op.type === 'set') {
        const dadosLimpos = { ...(op.data || {}) };
        delete dadosLimpos.id;
        delete dadosLimpos._id;
        await setDoc(op.collection, op.id, dadosLimpos, { merge: true });
      } else if (op.type === 'update') {
        const dadosLimpos = { ...(op.data || {}) };
        delete dadosLimpos.id;
        delete dadosLimpos._id;
        await updateDoc(op.collection, op.id, dadosLimpos);
      } else if (op.type === 'delete') {
        await deleteDoc(op.collection, op.id);
      }
    } catch (opErr: any) {
      console.error(`[MongoDB Batch] Erro na operação ${op.type} em ${op.collection}/${op.id}:`, opErr.message);
      throw opErr;
    }
  }
}
