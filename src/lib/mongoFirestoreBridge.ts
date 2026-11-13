/**
 * Adaptador de Compatibilidade MongoDB Atlas para API do Firestore
 * Substitui chamadas ao Google Firestore por consultas diretas ao MongoDB Atlas (banco escola_clovis)
 * eliminando completamente erros de 'Missing or insufficient permissions' e dependência de Firebase Auth.
 */

export interface MongoDocRef {
  type: 'doc';
  collection: string;
  id: string;
  path: string;
}

export interface MongoCollectionRef {
  type: 'collection';
  collection: string;
  path: string;
}

export interface MongoQueryConstraint {
  type: 'where' | 'orderBy' | 'limit' | 'startAfter';
  field?: string;
  op?: string;
  value?: any;
}

export interface MongoQuery {
  type: 'query';
  collectionRef: MongoCollectionRef;
  constraints: MongoQueryConstraint[];
}

export interface MongoDocumentSnapshot<T = any> {
  id: string;
  ref: MongoDocRef;
  exists: () => boolean;
  data: () => T | undefined;
}

export interface MongoQuerySnapshot<T = any> {
  docs: MongoDocumentSnapshot<T>[];
  size: number;
  empty: boolean;
  forEach: (callback: (doc: MongoDocumentSnapshot<T>) => void) => void;
}

// Ouvintes locais para emular tempo real (onSnapshot)
const listeners = new Map<string, Set<(snapshot: any) => void>>();
const docListeners = new Map<string, Set<(snapshot: any) => void>>();
const notifyDebounceTimers = new Map<string, any>();

export function notifyCollectionChanged(collectionName: string, docId?: string) {
  if (!collectionName) return;

  if (docId) {
    const docKey = `${collectionName}/${docId}`;
    const dSet = docListeners.get(docKey);
    if (dSet && dSet.size > 0) {
      getDoc(doc(null as any, collectionName, docId)).then(snap => {
        dSet.forEach(cb => {
          try { cb(snap); } catch (e) { console.warn('Erro no callback do doc onSnapshot:', e); }
        });
      }).catch(() => {});
    }
  }

  if (notifyDebounceTimers.has(collectionName)) {
    clearTimeout(notifyDebounceTimers.get(collectionName));
  }

  const timer = setTimeout(() => {
    notifyDebounceTimers.delete(collectionName);
    const set = listeners.get(collectionName);
    if (set && set.size > 0) {
      getDocs(collection(null as any, collectionName)).then(snap => {
        set.forEach(cb => {
          try { cb(snap); } catch (e) { console.warn('Erro no callback do onSnapshot:', e); }
        });
      }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('database-collection-changed', { detail: { collection: collectionName, docId } }));
    }
  }, 100);

  notifyDebounceTimers.set(collectionName, timer);
}

export function collection(_db: any, pathName: string, ...segments: string[]): MongoCollectionRef {
  const full = [pathName, ...segments].filter(Boolean).join('/');
  return {
    type: 'collection',
    collection: full,
    path: full
  };
}

export function doc(dbOrCol: any, ...segments: string[]): MongoDocRef {
  let colName = '';
  let id = '';

  if (dbOrCol && dbOrCol.type === 'collection') {
    colName = dbOrCol.collection;
    id = segments.filter(Boolean).join('/') || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } else if (typeof dbOrCol === 'string') {
    const parts = [dbOrCol, ...segments].filter(Boolean);
    colName = parts[0] || '';
    id = parts.slice(1).join('/') || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  } else {
    colName = segments[0] || '';
    id = segments.slice(1).join('/') || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  return {
    type: 'doc',
    collection: colName,
    id,
    path: `${colName}/${id}`
  };
}

export function query(colRef: MongoCollectionRef, ...constraints: MongoQueryConstraint[]): MongoQuery {
  return {
    type: 'query',
    collectionRef: colRef,
    constraints: constraints.filter(Boolean)
  };
}

export function where(field: string, op: string, value: any): MongoQueryConstraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MongoQueryConstraint {
  return { type: 'orderBy', field, value: direction };
}

export function limit(count: number): MongoQueryConstraint {
  return { type: 'limit', value: count };
}

export function startAfter(...values: any[]): MongoQueryConstraint {
  return { type: 'startAfter', value: values };
}

export async function getDocs<T = any>(queryOrCol: MongoCollectionRef | MongoQuery, _options?: any): Promise<MongoQuerySnapshot<T>> {
  let colName = '';
  const queryParams = new URLSearchParams();

  if (queryOrCol.type === 'collection') {
    colName = queryOrCol.collection;
  } else if (queryOrCol.type === 'query') {
    colName = queryOrCol.collectionRef.collection;
    for (const c of queryOrCol.constraints) {
      if (c.type === 'where' && c.field && c.op === '==' && c.value !== undefined) {
        queryParams.set(c.field, String(c.value));
      } else if (c.type === 'limit' && c.value) {
        queryParams.set('_limit', String(c.value));
      } else if (c.type === 'orderBy' && c.field) {
        queryParams.set('_sort', String(c.field));
        queryParams.set('_order', String(c.value || 'asc'));
      }
    }
  }

  const queryString = queryParams.toString();
  const url = `/api/db/${encodeURIComponent(colName)}${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ao consultar ${colName}`);
    }
    const dataList = await res.json();
    const array = Array.isArray(dataList) ? dataList : [];

    // Persiste no cache local do navegador para resiliência instantânea
    try {
      if (typeof window !== 'undefined' && array.length > 0) {
        if (colName === 'alunos') {
          if (!queryString && array.length >= 500) {
            (window as any).allStudentsData = array;
            if ((window as any).smartCache) {
              (window as any).smartCache.set('alunos_cache', array);
            }
          } else {
            // Se for consulta filtrada ou parcial, funde com a base sem sobrescrever os 751 alunos
            const atuais = (window as any).allStudentsData || [];
            const mapa = new Map(atuais.map((s: any) => [String(s.ra || s.id), s]));
            array.forEach((s: any) => mapa.set(String(s.ra || s.id), s));
            (window as any).allStudentsData = Array.from(mapa.values());
            if ((window as any).smartCache && (window as any).allStudentsData.length >= 500) {
              (window as any).smartCache.set('alunos_cache', (window as any).allStudentsData);
            }
          }
        } else if (colName === 'ocorrencias') {
          (window as any).ocorrenciasCache = array;
          if ((window as any).smartCache) {
            (window as any).smartCache.set('ocorrencias_cache', array);
          }
        }
      }
    } catch (_) {}

    const docs: MongoDocumentSnapshot<T>[] = array.map((item: any) => {
      const docId = String(item.id || item.ra || item._id || '');
      if (item && item.cientes !== undefined && item.cientes !== null) {
        if (typeof item.cientes === 'object' && item.cientes.__arrayUnion && Array.isArray(item.cientes.elements)) {
          item.cientes = item.cientes.elements;
        } else if (!Array.isArray(item.cientes)) {
          item.cientes = [];
        }
      }
      return {
        id: docId,
        ref: doc(colName, docId),
        exists: () => true,
        data: () => ({ ...item, id: docId })
      };
    });

    return {
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (cb) => docs.forEach(cb)
    };
  } catch (err: any) {
    console.warn(`[MongoDB Atlas] Aviso ao consultar '${colName}':`, err.message);
    let cachedArray: any[] = [];
    try {
      if (typeof window !== 'undefined') {
        const win = window as any;
        if (colName === 'alunos') {
          if (Array.isArray(win.allStudentsData) && win.allStudentsData.length > 0) {
            cachedArray = win.allStudentsData;
          } else if (win.smartCache) {
            const sc = win.smartCache.get('alunos_cache', 120);
            if (Array.isArray(sc)) cachedArray = sc;
          }
          if (cachedArray.length === 0) {
            const raw = localStorage.getItem('alunos_cache') || localStorage.getItem('clovis_cache_alunos');
            if (raw) cachedArray = JSON.parse(raw);
          }
        } else if (colName === 'ocorrencias') {
          if (Array.isArray(win.ocorrenciasCache) && win.ocorrenciasCache.length > 0) {
            cachedArray = win.ocorrenciasCache;
          } else if (win.smartCache) {
            const sc = win.smartCache.get('ocorrencias_cache', 120);
            if (Array.isArray(sc)) cachedArray = sc;
          }
          if (cachedArray.length === 0) {
            const raw = localStorage.getItem('ocorrencias_cache') || localStorage.getItem('clovis_cache_ocorrencias');
            if (raw) cachedArray = JSON.parse(raw);
          }
        } else {
          const cachedStr = localStorage.getItem(`clovis_cache_${colName}`) || localStorage.getItem(`${colName}_cache`);
          if (cachedStr) {
            const parsed = JSON.parse(cachedStr);
            if (Array.isArray(parsed)) cachedArray = parsed;
          }
        }
      }
    } catch (e) {}

    const docs: MongoDocumentSnapshot<T>[] = cachedArray.map((item: any) => {
      const docId = String(item.id || item.ra || item._id || '');
      return {
        id: docId,
        ref: doc(colName, docId),
        exists: () => true,
        data: () => ({ ...item, id: docId })
      };
    });

    return {
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (cb) => docs.forEach(cb)
    };
  }
}

export const getDocsFromCache = getDocs;
export const getDocsFromServer = getDocs;

export async function getDoc<T = any>(docRef: MongoDocRef): Promise<MongoDocumentSnapshot<T>> {
  const { collection: colName, id } = docRef;
  const url = `/api/db/${encodeURIComponent(colName)}/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url);
    if (res.status === 404) {
      return {
        id,
        ref: docRef,
        exists: () => false,
        data: () => undefined
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    return {
      id: String(data.id || data.ra || id),
      ref: docRef,
      exists: () => Boolean(data),
      data: () => data
    };
  } catch (err: any) {
    console.warn(`[MongoDB Atlas] Erro ao buscar doc ${colName}/${id}:`, err.message);
    return {
      id,
      ref: docRef,
      exists: () => false,
      data: () => undefined
    };
  }
}

export async function setDoc(docRef: MongoDocRef, data: any, _options?: { merge?: boolean }): Promise<void> {
  const { collection: colName, id } = docRef;
  const url = `/api/db/${encodeURIComponent(colName)}/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, id, ...(colName === 'alunos' ? { ra: id } : {}) })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || errJson.details || `Erro ao salvar documento em ${colName}/${id}`);
  }

  notifyCollectionChanged(colName, id);
}

export async function addDoc(colRef: MongoCollectionRef, data: any): Promise<MongoDocRef> {
  const colName = colRef.collection;
  const url = `/api/db/${encodeURIComponent(colName)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || errJson.details || `Erro ao adicionar documento em ${colName}`);
  }

  const result = await res.json();
  const id = result.id || `gen_${Date.now()}`;

  notifyCollectionChanged(colName, id);

  return {
    type: 'doc',
    collection: colName,
    id,
    path: `${colName}/${id}`
  };
}

export async function updateDoc(docRef: MongoDocRef, data: any): Promise<void> {
  await setDoc(docRef, data, { merge: true });
}

export async function deleteDoc(docRef: MongoDocRef): Promise<void> {
  const { collection: colName, id } = docRef;
  const url = `/api/db/${encodeURIComponent(colName)}/${encodeURIComponent(id)}`;

  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || errJson.details || `Erro ao deletar documento de ${colName}/${id}`);
  }
  notifyCollectionChanged(colName, id);
}

export function writeBatch(_db?: any) {
  const operations: Array<{ type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }> = [];

  return {
    set(docRef: MongoDocRef, data: any, _options?: any) {
      operations.push({ type: 'set', collection: docRef.collection, id: docRef.id, data });
      return this;
    },
    update(docRef: MongoDocRef, data: any) {
      operations.push({ type: 'update', collection: docRef.collection, id: docRef.id, data });
      return this;
    },
    delete(docRef: MongoDocRef) {
      operations.push({ type: 'delete', collection: docRef.collection, id: docRef.id });
      return this;
    },
    async commit(): Promise<void> {
      if (operations.length === 0) return;
      const res = await fetch('/api/db/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `Erro ao persistir lote de operações (HTTP ${res.status})`);
      }

      const cols = new Set(operations.map(o => o.collection));
      cols.forEach(c => notifyCollectionChanged(c));
    }
  };
}

export function onSnapshot(
  target: MongoCollectionRef | MongoQuery | MongoDocRef,
  onNext: (snapshot: any) => void,
  _onError?: (error: any) => void
): () => void {
  let isSubscribed = true;

  if (target.type === 'doc') {
    const docKey = `${target.collection}/${target.id}`;
    getDoc(target).then(snap => {
      if (isSubscribed) onNext(snap);
    }).catch(err => {
      if (_onError) _onError(err);
    });

    if (!docListeners.has(docKey)) {
      docListeners.set(docKey, new Set());
    }
    const dHandler = (snap: any) => {
      if (isSubscribed) onNext(snap);
    };
    docListeners.get(docKey)!.add(dHandler);

    return () => {
      isSubscribed = false;
      docListeners.get(docKey)?.delete(dHandler);
    };
  }

  const colName = target.type === 'collection' ? target.collection : target.collectionRef.collection;

  // Carregamento inicial imediato
  getDocs(target).then(snap => {
    if (isSubscribed) onNext(snap);
  }).catch(err => {
    if (_onError) _onError(err);
  });

  // Registra listener no sistema de eventos locais
  if (!listeners.has(colName)) {
    listeners.set(colName, new Set());
  }
  const handler = (snap: any) => {
    if (isSubscribed) onNext(snap);
  };
  listeners.get(colName)!.add(handler);

  return () => {
    isSubscribed = false;
    listeners.get(colName)?.delete(handler);
  };
}

export async function getCountFromServer(target: MongoCollectionRef | MongoQuery): Promise<{ data: () => { count: number } }> {
  const colName = target.type === 'collection' ? target.collection : target.collectionRef.collection;
  try {
    const res = await fetch(`/api/db/${encodeURIComponent(colName)}/count`);
    if (res.ok) {
      const json = await res.json();
      return { data: () => ({ count: json.count || 0 }) };
    }
  } catch (e) {}

  const docs = await getDocs(target);
  return { data: () => ({ count: docs.size }) };
}

export function serverTimestamp(): string {
  return new Date().toISOString();
}

export function arrayUnion(...elements: any[]): any {
  return { __arrayUnion: true, elements };
}

export function initializeFirestore(_app?: any, _settings?: any): any {
  return { type: 'mongo-database', name: 'escola_clovis' };
}

export function memoryLocalCache(): any {
  return {};
}

export function getFirestore(_app?: any): any {
  return { type: 'mongo-database', name: 'escola_clovis' };
}

export type Firestore = any;
