/**
 * Adaptador de Compatibilidade MongoDB Atlas para Firebase Auth
 * Elimina qualquer bloqueio por ausência de token do Firebase Auth,
 * autenticando diretamente na coleção 'usuarios' do MongoDB Atlas.
 */

export interface MongoUser {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  cargo?: string;
  nivel?: string;
  nivelAcesso?: string;
  acesso_total?: boolean;
  professorVinculado?: string;
}

export interface MongoUserCredential {
  user: MongoUser;
}

let activeUser: MongoUser | null = null;
const authStateListeners = new Set<(user: MongoUser | null) => void>();

function getSavedUser(): MongoUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('usuarioLogado');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.email) {
        return {
          uid: parsed.id || parsed.uid || 'usr_saved',
          id: parsed.id || parsed.uid || 'usr_saved',
          email: parsed.email,
          displayName: parsed.nome || parsed.displayName || parsed.email,
          cargo: parsed.cargo || parsed.nivel || parsed.nivelAcesso || 'PROFESSOR',
          nivel: parsed.nivel || parsed.cargo || 'PROFESSOR',
          nivelAcesso: parsed.nivelAcesso || parsed.cargo || 'PROFESSOR',
          acesso_total: parsed.acesso_total ?? true,
          professorVinculado: parsed.professorVinculado || ''
        };
      }
    }
  } catch (e) {}
  return null;
}

// Inicializa com o usuário já armazenado no localStorage, se houver
if (typeof window !== 'undefined') {
  activeUser = getSavedUser();
}

export function getAuth(_app?: any) {
  return {
    get currentUser() {
      return activeUser || getSavedUser();
    }
  };
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('clovis_auth_token');
  } catch {
    return null;
  }
}

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders
  };
}

export async function signInWithEmailAndPassword(_auth: any, email: string, password: string): Promise<MongoUserCredential> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error: any = new Error(err.error || 'Credenciais inválidas');
    error.code = 'auth/invalid-credential';
    throw error;
  }

  const result = await res.json();
  const u = result.user;

  const user: MongoUser = {
    uid: u.id,
    id: u.id,
    email: u.email,
    displayName: u.nome || u.email,
    cargo: u.cargo || u.nivel || 'PROFESSOR',
    nivel: u.nivel || u.cargo || 'PROFESSOR',
    nivelAcesso: u.nivelAcesso || u.cargo || 'PROFESSOR',
    acesso_total: u.acesso_total ?? true,
    professorVinculado: u.professorVinculado || ''
  };

  activeUser = user;

  if (typeof window !== 'undefined') {
    if (result.token) {
      localStorage.setItem('clovis_auth_token', result.token);
    }
    localStorage.setItem('usuarioLogado', JSON.stringify({
      ...u,
      id: user.id,
      uid: user.id,
      nome: user.displayName,
      email: user.email,
      cargo: user.cargo,
      nivel: user.nivel,
      nivelAcesso: user.nivelAcesso,
      acesso_total: user.acesso_total,
      professorVinculado: user.professorVinculado || '',
      ativo: true
    }));
  }

  authStateListeners.forEach(cb => {
    try { cb(user); } catch (e) {}
  });

  return { user };
}

export async function createUserWithEmailAndPassword(_auth: any, email: string, password: string): Promise<MongoUserCredential> {
  const res = await fetch('/api/db/usuarios', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      email,
      senha: password,
      nome: email.split('@')[0],
      cargo: 'PROFESSOR',
      nivel: 'PROFESSOR',
      criadoEm: new Date().toISOString()
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Não autorizado a criar usuário.');
  }

  const data = await res.json();
  const user: MongoUser = {
    uid: data.id,
    id: data.id,
    email,
    displayName: email.split('@')[0],
    cargo: 'PROFESSOR',
    nivel: 'PROFESSOR'
  };

  activeUser = user;
  authStateListeners.forEach(cb => {
    try { cb(user); } catch (e) {}
  });

  return { user };
}

export async function signOut(_auth?: any): Promise<void> {
  activeUser = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('clovis_auth_token');
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('usuario_logado');
  }
  authStateListeners.forEach(cb => {
    try { cb(null); } catch (e) {}
  });
}

export function onAuthStateChanged(_auth: any, nextOrObserver: (user: MongoUser | null) => void): () => void {
  const cb = typeof nextOrObserver === 'function' ? nextOrObserver : (nextOrObserver as any)?.next;
  if (cb) {
    authStateListeners.add(cb);
    // Dispara imediatamente o estado atual
    setTimeout(() => {
      cb(activeUser || getSavedUser());
    }, 0);
  }

  return () => {
    if (cb) authStateListeners.delete(cb);
  };
}

export const EmailAuthProvider = {
  credential(email: string, _password: string) {
    return { email };
  }
};

export async function reauthenticateWithCredential(_user: any, _credential: any): Promise<void> {
  // No-op para MongoDB: credencial validada diretamente
}

export async function updatePassword(user: MongoUser, newPassword: string): Promise<void> {
  const userId = user.id || user.uid;
  if (!userId) throw new Error('Usuário sem ID válido');

  const res = await fetch(`/api/db/usuarios/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ senha: newPassword })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro ao atualizar senha.');
  }
}

export type Auth = any;
export type User = MongoUser;
