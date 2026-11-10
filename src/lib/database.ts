/**
 * Cliente de Banco de Dados Oficial - MongoDB Atlas (EE Clóvis de Lucca)
 * Gerencia persistência, consultas e coleções com o cluster Atlas.
 */

export * from './mongoFirestoreBridge';
import { initializeFirestore, getFirestore, Firestore } from './mongoFirestoreBridge';

export const db: Firestore = initializeFirestore();

export function getDb(): Firestore {
  return db;
}

if (typeof window !== 'undefined') {
  (window as any).reactDb = db;
  (window as any).db = db;
}
