/**
 * Utilitários gerais para a Escola Clóvis de Lucca
 */

export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/**
 * Extrai rigorosamente o percentual numérico de frequência (0 a 100).
 * Trata formatos como '85%', '85,5%', 0.85 e múltiplos campos da base.
 */
export function extrairPercentualFrequencia(aluno: any): number {
  if (!aluno) return 100;
  const raw = aluno.presenca_anual ?? aluno.presenca ?? aluno.frequencia ?? aluno.frequencia_anual ?? aluno.frequenciaNum;
  if (raw === undefined || raw === null || String(raw).trim() === '' || String(raw).trim() === '-' || String(raw).trim() === 'N/D') {
    return 100;
  }
  let str = String(raw).trim().replace('%', '').replace(',', '.');
  let num = parseFloat(str);
  if (isNaN(num)) return 100;
  if (num > 0 && num <= 1) {
    num = num * 100;
  }
  return num;
}

export async function copiarTabelaParaClipboard(
  linhas: (string | number | undefined | null)[][],
  cabecalhos?: string[]
): Promise<boolean> {
  try {
    const conteudoLinhas: string[] = [];
    if (cabecalhos && cabecalhos.length > 0) {
      conteudoLinhas.push(cabecalhos.join('\t'));
    }
    linhas.forEach(row => {
      conteudoLinhas.push(
        row.map(cell => {
          if (cell === null || cell === undefined) return '';
          return String(cell).replace(/[\t\n\r]/g, ' ').trim();
        }).join('\t')
      );
    });

    const tsvText = conteudoLinhas.join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(tsvText);
      return true;
    }

    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = tsvText;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
    return false;
  } catch (err) {
    console.error('Erro ao copiar dados para a área de transferência:', err);
    return false;
  }
}

export function normalizeTeacherName(name?: string | null): string {
  if (!name) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/^(prof\.?\s*|profa\.?\s*|professor\(a\)\s*|professora\s+|professor\s+)/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getPeriodoRotulo(periodo?: string | number | null): string {
  if (periodo === undefined || periodo === null || periodo === '') return 'Geral';
  const pStr = String(periodo).toLowerCase().trim();
  if (pStr === 'int1' || pStr.includes('intervalo 1')) return 'Intervalo';
  if (pStr === 'almoco' || pStr.includes('almoço')) return 'Almoço';
  if (pStr === 'int2' || pStr.includes('intervalo 2') || pStr.includes('tarde')) return 'Intervalo Tarde';
  if (pStr === 'jantar') return 'Jantar';
  if (/^\d+$/.test(pStr)) return `${pStr}ª Aula`;
  return String(periodo);
}

export function isBreakOrOffSlot(item?: any): boolean {
  if (!item) return true;
  if (typeof item === 'object') {
    const disc = String(item.disciplina || '').toLowerCase().trim();
    const turma = String(item.turma || '').toLowerCase().trim();
    const periodo = String(item.periodoId || '').toLowerCase().trim();

    // Intervalo Dirigido / Almoço Dirigido são atribuições de acompanhamento (NÃO são intervalo livre)
    const isDirigido = disc.includes('dirigid') || disc.includes('diversificad');
    if (
      !isDirigido &&
      (disc === 'intervalo' ||
        disc === 'almoço' ||
        disc === 'almoco' ||
        disc === 'jantar' ||
        disc === 'recreio')
    ) {
      return true;
    }

    if (
      disc === '' ||
      disc === '-' ||
      disc === '?' ||
      disc === 's' ||
      disc === '*' ||
      disc.includes('folga') ||
      disc === 'off' ||
      disc.startsWith('off ') ||
      disc.includes('bloqueio') ||
      disc === 'janela'
    ) {
      return true;
    }

    if (
      !isDirigido &&
      (periodo.startsWith('int') || periodo.includes('almoco') || periodo.includes('almoço') || periodo.includes('jantar')) &&
      (!disc || disc === 'intervalo' || disc === 'almoço' || disc === 'almoco' || disc === 'jantar')
    ) {
      return true;
    }

    if (turma === 'folga' || turma === 'off') return true;
    return false;
  }

  const str = String(item).toLowerCase().trim();
  const isDirigido = str.includes('dirigid') || str.includes('diversificad');
  if (
    !isDirigido &&
    (str === 'intervalo' || str === 'almoço' || str === 'almoco' || str === 'jantar' || str === 'recreio')
  ) {
    return true;
  }
  if (
    str === '' ||
    str === '-' ||
    str === '?' ||
    str === 's' ||
    str === '*' ||
    str.includes('folga') ||
    str === 'off' ||
    str.startsWith('off ') ||
    str.includes('bloqueio')
  ) {
    return true;
  }
  return false;
}

export function isInstitutionalOrAtpcCommitment(item?: any): boolean {
  if (!item) return false;
  if (isBreakOrOffSlot(item)) return false;

  const discRaw = typeof item === 'object' ? (item.disciplina || '') : String(item);
  const turmaRaw = typeof item === 'object' ? (item.turma || '') : '';
  const discUpper = String(discRaw).toUpperCase().trim();
  const turmaUpper = String(turmaRaw).toUpperCase().trim();

  const termosNaoRegencia = [
    'ATPC',
    'ATPCG',
    'ATPCA',
    'ALINHAMENTO',
    'ALINHMENTO',
    'FORMAÇÃO',
    'FORMACAO',
    'REUNIÃO',
    'REUNIAO',
    'ATENDIMENTO',
    'MULTIPLICA',
    'PLANEJAMENTO',
    'ALMOÇO DIRIGIDO',
    'ALMOCO DIRIGIDO',
    'INTERVALO DIRIGIDO',
    'INT. DIRIGIDO',
    'PLANTÃO',
    'PLANTAO'
  ];

  if (termosNaoRegencia.some(t => discUpper.includes(t) || turmaUpper === t)) {
    return true;
  }

  if (typeof item === 'object' && (item.contarSaldo === false || item.ativo === false)) {
    return true;
  }

  return false;
}

export function isRegularTeachingClass(item?: any): boolean {
  if (!item) return false;
  if (isBreakOrOffSlot(item)) return false;
  if (isInstitutionalOrAtpcCommitment(item)) return false;
  if (typeof item === 'object') {
    const periodo = String(item.periodoId || '').toLowerCase().trim();
    if (periodo.startsWith('int') || periodo.includes('almoco') || periodo.includes('almoço') || periodo.includes('jantar')) {
      return false;
    }
  }
  return true;
}

export function isBlockingSlotForSubstitution(item?: any): boolean {
  if (!item) return false;
  if (isBreakOrOffSlot(item)) return false;
  return isRegularTeachingClass(item) || isInstitutionalOrAtpcCommitment(item);
}

export function isRealProfessorName(name?: string | null): boolean {
  if (!name) return false;
  const s = String(name).trim();
  if (!s || s === '-' || s === '?' || s === '*' || s.toLowerCase() === 'prof. não informado' || s.toLowerCase() === 'n/a') {
    return false;
  }
  return true;
}

export function isRealSchoolTurma(turma?: string | null): boolean {
  if (!turma) return false;
  const t = String(turma).trim().toUpperCase();
  if (!t || t === '-' || t === '?' || t === 'GERAL' || t === 'ATENDIMENTO' || t === 'DIVERSAS TURMAS' || t.startsWith('GERAL (')) {
    return false;
  }
  if (['ATPC', 'ATPCG', 'ATPCA', 'ALMOÇO', 'ALMOCO', 'JANTAR', 'FORMAÇÃO', 'FORMACAO', 'ALINHAMENTO GERAL'].some(k => t === k || t.includes('ALINHAMENTO'))) {
    return false;
  }
  return /^[1-9]/.test(t) || t.includes('ANO') || t.includes('SÉRIE') || t.includes('SERIE');
}

export function sortTurmasPEI(turmas: string[]): string[] {
  const rankSerie = (t: string): number => {
    const u = String(t || '').trim().toUpperCase();
    const m = u.match(/^(\d+)/);
    if (!m) return 999;
    const n = parseInt(m[1], 10);
    // Ensino Fundamental (6º ao 9º) antes do Ensino Médio (1ª à 3ª)
    if (n >= 6 && n <= 9) return n;
    if (n >= 1 && n <= 3) return 10 + n;
    return 50 + n;
  };
  return Array.from(new Set(turmas.filter(Boolean).map(t => String(t).trim()))).sort((a, b) => {
    const realA = isRealSchoolTurma(a) ? 0 : 1;
    const realB = isRealSchoolTurma(b) ? 0 : 1;
    if (realA !== realB) return realA - realB;
    const rA = rankSerie(a);
    const rB = rankSerie(b);
    if (rA !== rB) return rA - rB;
    return a.localeCompare(b, 'pt-BR');
  });
}

export function normalizeHorarioItem(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const pidRaw = item.periodoId !== undefined && item.periodoId !== null ? String(item.periodoId).trim() : '';
  const pidNum = Number(pidRaw);
  const periodoId = pidRaw !== '' && !isNaN(pidNum) ? pidNum : pidRaw.toLowerCase();
  return {
    ...item,
    dia: normalizarDia(item.dia),
    periodoId,
    turma: String(item.turma || '').trim(),
    professor: String(item.professor || '').trim(),
    disciplina: String(item.disciplina || '').trim(),
    sala: String(item.sala || '').trim()
  };
}

export async function garantirBibliotecaDisponivel(
  nome: 'XLSX' | 'pdfjsLib' | 'Chart' | 'Papa',
  maxEsperaMs = 5000
): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any)[nome]) return (window as any)[nome];

  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if ((window as any)[nome]) {
        clearInterval(checkInterval);
        resolve((window as any)[nome]);
      } else if (Date.now() - inicio > maxEsperaMs) {
        clearInterval(checkInterval);
        reject(new Error(`Biblioteca ${nome} não carregou a tempo.`));
      }
    }, 50);
  });
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay = 180): (...args: Parameters<T>) => void {
  let timeoutId: any;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

export const OPCOES_AREAS_PEI = [
  'Exatas (EXA)',
  'Humanas (HUM)',
  'Linguagens (LGG)',
  'Ciências da Natureza (NAT)',
  'Gestão/Outros (OUT)'
];

export function normalizarArea(areaStr?: string | null): string {
  if (!areaStr) return 'Gestão/Outros (OUT)';
  const s = String(areaStr).trim();
  if (OPCOES_AREAS_PEI.includes(s)) return s;
  const upper = s.toUpperCase();
  if (upper.includes('EXA') || upper.includes('EXATAS') || upper.includes('MATEMÁTICA') || upper.includes('MATEMATICA') || upper.includes('FÍSICA') || upper.includes('FISICA')) return 'Exatas (EXA)';
  if (upper.includes('NAT') || upper.includes('NATUREZA') || upper.includes('BIOLOGIA') || upper.includes('QUÍMICA') || upper.includes('QUIMICA') || upper.includes('CIÊNCIAS') || upper.includes('CIENCIAS')) return 'Ciências da Natureza (NAT)';
  if (upper.includes('HUM') || upper.includes('HUMANAS') || upper.includes('HISTÓRIA') || upper.includes('HISTORIA') || upper.includes('GEOGRAFIA') || upper.includes('FILOSOFIA') || upper.includes('SOCIOLOGIA')) return 'Humanas (HUM)';
  if (upper.includes('LGG') || upper.includes('LINGUA') || upper.includes('PORTUGUÊS') || upper.includes('PORTUGUES') || upper.includes('ARTE') || upper.includes('INGLÊS') || upper.includes('INGLES') || upper.includes('EDUCAÇÃO FÍSICA') || upper.includes('EDUCACAO FISICA') || upper.includes('ED. FÍSICA') || upper.includes('ED FÍSICA')) return 'Linguagens (LGG)';
  if (upper.includes('OUT') || upper.includes('GESTÃO') || upper.includes('GESTAO') || upper.includes('DIVERSIFICADA') || upper.includes('PROJETO DE VIDA') || upper.includes('ELETIVA') || upper.includes('TUTORIA')) return 'Gestão/Outros (OUT)';
  return 'Gestão/Outros (OUT)';
}

export function encontrarAreaDisciplina(disciplina?: string | null): string {
  if (!disciplina) return 'Gestão/Outros (OUT)';
  return normalizarArea(disciplina);
}

export function podeExcluir(role?: string | null): boolean {
  if (typeof window !== 'undefined' && typeof (window as any).podeExcluir === 'function') {
    const res = (window as any).podeExcluir();
    if (typeof res === 'boolean') return res;
  }
  const currentRole = role || (typeof window !== 'undefined' ? ((window as any).obterRoleAtual?.() || (window as any).currentUserRole || localStorage.getItem('usuario_nivel') || localStorage.getItem('usuario_cargo')) : '');
  const r = String(currentRole || '').toUpperCase().trim().replace(/-/g, '_');
  return !r || r === 'DIRETOR' || r === 'SENIOR_GOE' || r === 'VICE_DIRETOR' || r === 'CGPG' || r === 'CGPCG' || r.includes('DIRETOR') || r === 'ADMIN';
}

export async function deletarEntidadeUniversal(collectionName: string, id: string): Promise<boolean> {
  try {
    const { doc, deleteDoc } = await import('./lib/database');
    await deleteDoc(doc(collectionName, id));
    return true;
  } catch (e) {
    console.error(`Erro ao deletar ${collectionName}/${id}:`, e);
    return false;
  }
}

export function extrairEMigrarDocentesDoHorario(horarios: any[], existentes: any[] = []): any[] {
  const map = new Map<string, any>();

  const isDisciplinaPoluida = (d?: string | null) => {
    if (!d) return true;
    const u = String(d).toUpperCase().trim();
    return (
      u === '' ||
      u === 'GERAL' ||
      u === '-' ||
      u === '?' ||
      u.includes('ATPC') ||
      u.includes('ALMOÇO') ||
      u.includes('ALMOCO') ||
      u.includes('JANTAR') ||
      u.includes('INTERVALO') ||
      u.includes('ALINHAMENTO') ||
      u.includes('ALINHMENTO') ||
      u.includes('FORMAÇÃO') ||
      u.includes('FORMACAO') ||
      u.includes('REUNIÃO') ||
      u.includes('REUNIAO') ||
      u === 'TUTORIA'
    );
  };

  if (Array.isArray(existentes)) {
    existentes.forEach(p => {
      const nome = (p?.nome || '').trim();
      if (!isRealProfessorName(nome)) return;
      const key = normalizeTeacherName(nome);
      if (!key) return;
      map.set(key, {
        ...p,
        nome,
        disciplina: p.disciplina || 'Geral',
        area: normalizarArea(p.area || encontrarAreaDisciplina(p.disciplina)),
        tipo: p.tipo || 'EFETIVO',
        turno: p.turno || 'INTEGRAL',
        saldoAulas: Number(p.saldoAulas ?? p.saldoInicial ?? 0)
      });
    });
  }

  if (Array.isArray(horarios)) {
    // Contar disciplina regular mais frequente por professor
    const freqDisc = new Map<string, Map<string, number>>();
    horarios.forEach(h => {
      const prof = (h?.professor || '').trim();
      if (!isRealProfessorName(prof)) return;
      const key = normalizeTeacherName(prof);
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, {
          nome: prof,
          disciplina: 'Geral',
          area: 'Gestão/Outros (OUT)',
          tipo: 'EFETIVO',
          turno: 'INTEGRAL',
          saldoAulas: 0
        });
      }

      if (isRegularTeachingClass(h) && h.disciplina && !isDisciplinaPoluida(h.disciplina)) {
        const dClean = String(h.disciplina).trim();
        if (!freqDisc.has(key)) freqDisc.set(key, new Map());
        const dMap = freqDisc.get(key)!;
        dMap.set(dClean, (dMap.get(dClean) || 0) + 1);
      }
    });

    freqDisc.forEach((dMap, key) => {
      const existing = map.get(key);
      if (!existing) return;
      let bestDisc = '';
      let bestCount = -1;
      dMap.forEach((cnt, disc) => {
        if (cnt > bestCount) {
          bestCount = cnt;
          bestDisc = disc;
        }
      });
      if (bestDisc && isDisciplinaPoluida(existing.disciplina)) {
        existing.disciplina = bestDisc;
        if (!existing.area || existing.area === 'Gestão/Outros (OUT)') {
          existing.area = encontrarAreaDisciplina(bestDisc);
        }
      }
    });
  }

  return Array.from(map.values()).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

export function isSameProfessor(name1?: string | null, name2?: string | null): boolean {
  if (!name1 || !name2) return false;
  const n1 = normalizeTeacherName(name1);
  const n2 = normalizeTeacherName(name2);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

export function getPeriodoOrder(periodo?: any): number {
  if (periodo === undefined || periodo === null || periodo === '') return 99;
  const pStr = String(periodo).toLowerCase().trim();
  if (pStr === 'int1' || pStr.includes('intervalo 1') || pStr === 'intervalo') return 2.5;
  if (pStr === 'almoco' || pStr.includes('almoço')) return 5.5;
  if (pStr === 'int2' || pStr.includes('intervalo 2') || pStr.includes('intervalo tarde')) return 9.5;
  if (pStr === 'jantar') return 12.5;

  // Extrai número da aula: '1', '1ª Aula', '1ª', etc. (evitando 'int1', 'int2')
  const match = pStr.match(/^(\d+)/) || pStr.match(/\b(\d+)\b/);
  if (match) {
    const num = parseInt(match[1], 10);
    return isNaN(num) ? 99 : num;
  }
  const digitsOnly = pStr.replace(/\D/g, '');
  if (digitsOnly) {
    const num = parseInt(digitsOnly, 10);
    return isNaN(num) ? 99 : num;
  }
  return 99;
}

export interface TeacherSchoolStatus {
  atSchool: boolean;
  reason: string;
}

export function isTeacherAtSchool(
  teacher?: any,
  dia?: any,
  periodoId?: any,
  indisponibilidadeProfs?: Record<string, any>,
  horariosEscola?: any[],
  cadastroProfessores?: any[]
): TeacherSchoolStatus {
  if (!teacher) {
    return { atSchool: true, reason: '' };
  }

  const diaNorm = normalizarDia(dia);
  const pOrder = getPeriodoOrder(periodoId);
  const pKey1 = `${diaNorm}-${periodoId}`;
  const pKey2 = `${diaNorm}_${periodoId}`;
  const pKey3 = `${diaNorm}-${pOrder}`;

  // 1. Checagem da Matriz de Indisponibilidade Docente (configurada no botão "Indisponibilidade Docente")
  if (indisponibilidadeProfs && typeof indisponibilidadeProfs === 'object') {
    const profKey = Object.keys(indisponibilidadeProfs).find(k => isSameProfessor(k, teacher));
    if (profKey) {
      const profMap = indisponibilidadeProfs[profKey];
      if (profMap && typeof profMap === 'object') {
        const slot = profMap[pKey1] || profMap[pKey2] || profMap[pKey3];
        if (slot) {
          if (slot.ausente === true || slot === true) {
            return {
              atSchool: false,
              reason: slot.motivo || 'Bloqueado na Indisponibilidade Docente'
            };
          }
        }
      }
    }
  }

  // 2. Se o professor tem aula ou compromisso institucional atribuído neste dia e período, ele está na escola
  if (Array.isArray(horariosEscola) && horariosEscola.length > 0) {
    const temAtividade = horariosEscola.some(h =>
      normalizarDia(h.dia) === diaNorm &&
      getPeriodoOrder(h.periodoId) === pOrder &&
      isSameProfessor(h.professor, teacher) &&
      !isBreakOrOffSlot(h)
    );
    if (temAtividade) {
      return { atSchool: true, reason: 'Em Atividade na Grade' };
    }
  }

  // 3. Checagem de Turno / Horário de Trabalho do Docente (em cadastroProfessores)
  const profObj = (cadastroProfessores || []).find(p => isSameProfessor(p?.nome, teacher));
  const turno = String(profObj?.turno || 'INTEGRAL').toUpperCase().trim();

  // Docente em Folga / Inativo / OFF
  if (['FOLGA', 'OFF', '-', 'S', 'INATIVO'].includes(turno)) {
    return {
      atSchool: false,
      reason: 'Docente em Folga / Inativo'
    };
  }

  // Turno MANHÃ: 1ª à 7ª aula (07:00 às 14:00)
  if (turno === 'MANHA' || turno === 'MANHÃ') {
    if (pOrder > 7) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Turno Manhã 1ª-7ª)'
      };
    }
    return { atSchool: true, reason: '' };
  }

  // Turno PEI_MANHA: 1ª à 9ª aula (07:00 às 16:00)
  if (turno === 'PEI_MANHA') {
    if (pOrder > 9) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Jornada PEI Manhã 1ª-9ª)'
      };
    }
    return { atSchool: true, reason: '' };
  }

  // Turno TARDE: 8ª à 14ª aula (14:20 às 21:20)
  if (turno === 'TARDE') {
    if (pOrder < 8) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Turno Tarde/Noite 8ª-14ª)'
      };
    }
    return { atSchool: true, reason: '' };
  }

  // Turno PEI_TARDE: 6ª à 14ª aula (12:20 às 21:20 - ATPC 6ª-7ª + Aulas EM 8ª-14ª)
  if (turno === 'PEI_TARDE') {
    if (pOrder < 6) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Jornada PEI Tarde/Noite 6ª-14ª)'
      };
    }
    return { atSchool: true, reason: '' };
  }

  // Turno NOITE: 10ª à 14ª aula
  if (turno === 'NOITE') {
    if (pOrder < 10) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Turno Noite 10ª-14ª)'
      };
    }
    return { atSchool: true, reason: '' };
  }

  // Turno INTEGRAL (ou padrão): infere a jornada real do docente na escola a partir da grade semanal
  // (Na EE Clóvis de Lucca existem docentes PEI Manhã 1ª-9ª e docentes PEI Tarde/Noite 6ª-14ª)
  if (turno === 'INTEGRAL' || !turno) {
    if (Array.isArray(horariosEscola) && horariosEscola.length > 0) {
      const ordersProf = horariosEscola
        .filter(h => isSameProfessor(h.professor, teacher) && !isBreakOrOffSlot(h))
        .map(h => getPeriodoOrder(h.periodoId))
        .filter(o => o >= 1 && o <= 14);

      if (ordersProf.length > 0) {
        const minO = Math.min(...ordersProf);
        const maxO = Math.max(...ordersProf);

        let minJornada = minO <= 2 ? 1 : minO;
        let maxJornada = maxO >= 13 ? 14 : maxO;

        // Jornada PEI Manhã típica (aulas 1-7 + ATPC 8-9)
        if (minO <= 6 && maxO <= 9) {
          minJornada = 1;
          maxJornada = 9;
        }
        // Jornada PEI Tarde/Noite típica (ATPC 6-7 + aulas EM 8-14)
        else if (minO >= 6 && maxO >= 10) {
          minJornada = 6;
          maxJornada = 14;
        }

        if (pOrder < minJornada || pOrder > maxJornada) {
          return {
            atSchool: false,
            reason: `Fora da jornada na grade (${minJornada}ª-${maxJornada}ª aula)`
          };
        }
        return { atSchool: true, reason: '' };
      }
    }
    return { atSchool: true, reason: '' };
  }

  return { atSchool: true, reason: '' };
}

export function normalizeDia(dia?: string | null): string {
  if (!dia) return 'segunda';
  const d = String(dia).toLowerCase().trim();
  if (d.includes('seg')) return 'segunda';
  if (d.includes('ter')) return 'terca';
  if (d.includes('qua')) return 'quarta';
  if (d.includes('qui')) return 'quinta';
  if (d.includes('sex')) return 'sexta';
  if (d.includes('sab')) return 'sabado';
  if (d.includes('dom')) return 'domingo';
  return d;
}

export function normalizarDia(dia?: string | null): string {
  return normalizeDia(dia);
}

export function normalizeSubstituicoesPeriodos(substituicoes: any[]): any[] {
  if (!Array.isArray(substituicoes)) return [];
  return substituicoes.map(sub => {
    if (!sub || typeof sub !== 'object') return {};
    return {
      ...sub,
      periodoId: sub.periodoId || sub.periodo || '',
      periodoRotulo: sub.periodoRotulo || getPeriodoRotulo(sub.periodoId || sub.periodo)
    };
  });
}

/**
 * Determina se o estudante está com matrícula ATIVA no sistema escolar Clóvis de Lucca.
 * Exclui inativos, transferidos, cessados, evadidos, cancelados ou desistentes.
 */
export function isAlunoAtivo(aluno: any): boolean {
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

export interface UsuarioProfessorMatch {
  professorNome: string;
  automatico: boolean;
  origem: 'explicito' | 'nome_exato' | 'primeiro_nome_unico' | 'email';
}

const TOKEN_STOPWORDS_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

function tokenizarNomePessoa(raw?: string | null): string[] {
  const norm = normalizeTeacherName(raw);
  if (!norm) return [];
  return norm
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length > 0 && !TOKEN_STOPWORDS_NOME.has(t));
}

/**
 * Faz o pareamento entre um usuário da coleção `usuarios` e um docente cadastrado
 * na grade horária / `cadastro_professores`.
 * Prioriza `usuario.professorVinculado` explícito e, na ausência, aplica pareamento
 * determinístico sem gerar falsos positivos para secretaria ou homônimos ambíguos.
 */
export function matchUsuarioProfessor(
  usuario: any,
  professores: any[]
): UsuarioProfessorMatch | null {
  if (!usuario || !Array.isArray(professores) || professores.length === 0) return null;

  const profsValidos = professores
    .map(p => (typeof p === 'string' ? { nome: p } : p))
    .filter(p => p && isRealProfessorName(p.nome));

  if (profsValidos.length === 0) return null;

  // 1. Vínculo explícito salvo no documento do usuário
  const explicito = String(usuario.professorVinculado || '').trim();
  if (explicito && explicito !== '__SEM_VINCULO__') {
    const foundExp = profsValidos.find(
      p => normalizeTeacherName(p.nome) === normalizeTeacherName(explicito) || isSameProfessor(p.nome, explicito)
    );
    if (foundExp) {
      return { professorNome: foundExp.nome.trim(), automatico: false, origem: 'explicito' };
    }
    return { professorNome: explicito, automatico: false, origem: 'explicito' };
  }
  if (explicito === '__SEM_VINCULO__') {
    return null;
  }

  // Não auto-vincular perfis administrativos puros (Secretaria)
  const cargoNorm = String(usuario.nivel || usuario.cargo || usuario.role || '').toUpperCase().trim();
  if (cargoNorm === 'SECRETARIA') {
    return null;
  }

  const uNomeNorm = normalizeTeacherName(usuario.nome || usuario.displayName || '');
  const uTokens = tokenizarNomePessoa(usuario.nome || usuario.displayName || '');
  if (uTokens.length === 0) return null;

  // 2. Match exato normalizado (nome completo ou mesmo conjunto completo de tokens)
  const exactMatch = profsValidos.find(p => normalizeTeacherName(p.nome) === uNomeNorm);
  if (exactMatch) {
    return { professorNome: exactMatch.nome.trim(), automatico: true, origem: 'nome_exato' };
  }

  // 3. Todos os tokens do nome do professor aparecem em ordem no nome do usuário
  // Ex: "RITA DE CASSIA" -> tokens ["rita", "cassia"] contidos no início de "RITA DE CASSIA MORMITO"
  const prefixMatches = profsValidos.filter(p => {
    const pTokens = tokenizarNomePessoa(p.nome);
    if (pTokens.length === 0) return false;
    if (pTokens.length > 1) {
      return pTokens.every(pt => uTokens.includes(pt));
    }
    return pTokens[0] === uTokens[0];
  });

  if (prefixMatches.length === 1) {
    return {
      professorNome: prefixMatches[0].nome.trim(),
      automatico: true,
      origem: 'primeiro_nome_unico'
    };
  }

  // 4. Desempate usando prefixo do e-mail institucional quando houver mais de 1 candidato
  const emailLocal = String(usuario.email || '').toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '');
  if (prefixMatches.length > 1 && emailLocal) {
    const byEmail = prefixMatches.find(p => {
      const pJoin = tokenizarNomePessoa(p.nome).join('');
      return pJoin && emailLocal.includes(pJoin);
    });
    if (byEmail) {
      return { professorNome: byEmail.nome.trim(), automatico: true, origem: 'email' };
    }
  }

  return null;
}
