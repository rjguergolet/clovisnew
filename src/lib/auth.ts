/**
 * Cliente de Autenticação Oficial - MongoDB Atlas (EE Clóvis de Lucca)
 * Gerencia autenticação segura contra a coleção 'usuarios' do MongoDB Atlas.
 */

export * from './mongoAuthBridge';
import { getAuth } from './mongoAuthBridge';

export const auth = getAuth();

if (typeof window !== 'undefined') {
  (window as any).reactAuth = auth;
  (window as any).auth = auth;
}
