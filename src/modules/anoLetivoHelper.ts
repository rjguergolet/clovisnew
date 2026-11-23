/**
 * src/modules/anoLetivoHelper.ts
 * Utilitário central para controle dinâmico do Ano Letivo Vigente (2026 -> 2027 -> 2028...)
 * e filtragem segura para que registros operacionais de anos anteriores encerrados na Virada
 * não sejam considerados no ano letivo atual.
 */

export function obterAnoLetivoVigente(): number {
  if (typeof window !== 'undefined') {
    const winAno = Number((window as any).anoLetivoAtual);
    if (Number.isFinite(winAno) && winAno >= 2024 && winAno <= 2100) {
      return winAno;
    }
    try {
      const lsAno = Number(localStorage.getItem('clovis_ano_letivo'));
      if (Number.isFinite(lsAno) && lsAno >= 2024 && lsAno <= 2100) {
        return lsAno;
      }
    } catch {
      // ignore
    }
  }
  return 2026;
}

export function definirAnoLetivoVigenteLocal(ano: number): void {
  const anoVal = Number(ano);
  if (!Number.isFinite(anoVal) || anoVal < 2024 || anoVal > 2100) return;

  if (typeof window !== 'undefined') {
    (window as any).anoLetivoAtual = String(anoVal);
    (window as any).ANO_LETIVO_VIGENTE = anoVal;
    try {
      localStorage.setItem('clovis_ano_letivo', String(anoVal));
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent('clovis_ano_letivo_changed', { detail: String(anoVal) }));
  }
}

export async function sincronizarAnoLetivoComServidor(): Promise<number> {
  try {
    const res = await fetch('/api/config/ano-letivo');
    if (res.ok) {
      const data = await res.json();
      const ano = Number(data?.anoLetivo);
      if (Number.isFinite(ano) && ano >= 2024 && ano <= 2100) {
        definirAnoLetivoVigenteLocal(ano);
        return ano;
      }
    }
  } catch {
    // fallback silencioso para cache local
  }
  return obterAnoLetivoVigente();
}

export function extrairAnoRegistro(doc: any): number | null {
  if (!doc || typeof doc !== 'object') return null;

  const camposAno = [
    doc.anoLetivoRegistro,
    doc.anoLetivo,
    doc.ano_letivo,
    doc.anoLetivoAlvo,
    doc.ano
  ];
  for (const val of camposAno) {
    const n = Number(val);
    if (Number.isFinite(n) && n >= 2020 && n <= 2100) {
      return n;
    }
  }

  const rawData =
    doc.data ||
    doc.dataRegistro ||
    doc.dataContato ||
    doc.dataInicio ||
    doc.prazo ||
    doc.dataLimite ||
    doc.criadoEm ||
    doc.timestamp ||
    '';

  const s = String(rawData || '').trim();
  if (!s) return null;

  // YYYY-MM-DD ou ISO timestamp
  const matchIso = s.match(/^(\d{4})[-/]/);
  if (matchIso) {
    const y = Number(matchIso[1]);
    if (y >= 2020 && y <= 2100) return y;
  }

  // DD/MM/YYYY
  const matchBr = s.match(/^\d{2}\/\d{2}\/(\d{4})/);
  if (matchBr) {
    const y = Number(matchBr[1]);
    if (y >= 2020 && y <= 2100) return y;
  }

  return null;
}

/**
 * Retorna true se o registro pertence ao ano letivo vigente e não foi encerrado em uma Virada de Ano.
 * Ex.: após virar de 2026 -> 2027, tudo que estiver marcado com encerradoNaVirada === true
 * ou com ano estritamente menor que 2027 deixa de ser considerado operacionalmente.
 */
export function ehRegistroDoAnoVigente(doc: any, anoVigenteParam?: number): boolean {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.encerradoNaVirada === true || doc.arquivadoVirada === true) return false;

  const anoVigente = anoVigenteParam || obterAnoLetivoVigente();
  if (doc.anoCorteVigencia && Number(doc.anoCorteVigencia) > anoVigente) {
    return true;
  }

  const anoDoc = extrairAnoRegistro(doc);
  if (anoDoc !== null && anoDoc < anoVigente) {
    return false;
  }
  return true;
}
