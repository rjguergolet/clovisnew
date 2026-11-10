/**
 * Inicializador da Aplicação MongoDB Atlas (EE Clóvis de Lucca)
 */

export interface MongoApp {
  name: string;
  options: Record<string, any>;
}

const defaultApp: MongoApp = {
  name: 'escola_clovis_mongodb',
  options: {}
};

const apps: MongoApp[] = [defaultApp];

export function initializeApp(config?: any, name?: string): MongoApp {
  if (name && name !== '[DEFAULT]') {
    const existing = apps.find(a => a.name === name);
    if (existing) return existing;
    const newApp: MongoApp = { name, options: config || {} };
    apps.push(newApp);
    return newApp;
  }
  return defaultApp;
}

export function getApps(): MongoApp[] {
  return apps;
}

export function getApp(name?: string): MongoApp {
  if (!name || name === '[DEFAULT]') return defaultApp;
  const found = apps.find(a => a.name === name);
  return found || defaultApp;
}

export async function deleteApp(app: MongoApp): Promise<void> {
  const idx = apps.findIndex(a => a.name === app.name);
  if (idx > -1 && app.name !== 'escola_clovis_mongodb') {
    apps.splice(idx, 1);
  }
}
