/**
 * Utilitários gerais para o Sistema de Gestão de Equipamentos e Empréstimos e Módulos Escolares
 */

export function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function isEmprestimoAtrasado(dataDevolucaoPrevista?: string | null, status?: string): boolean {
  if (status === 'Devolvido') return false;
  if (!dataDevolucaoPrevista) return false;
  const today = new Date().toISOString().split('T')[0];
  return dataDevolucaoPrevista < today;
}

export function getStatusBadgeConfig(status?: string, dataDevolucao?: string) {
  if (status === 'Devolvido') {
    return {
      label: 'Devolvido',
      className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    };
  }
  if (isEmprestimoAtrasado(dataDevolucao, status)) {
    return {
      label: 'Atrasado',
      className: 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    };
  }
  return {
    label: 'Pendente',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  };
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

export function isRegularTeachingClass(item?: any): boolean {
  if (!item) return false;
  if (typeof item === 'object') {
    if (item.contarSaldo === false || item.ativo === false) return false;
    const disc = String(item.disciplina || '').toLowerCase().trim();
    const turma = String(item.turma || '').toLowerCase().trim();
    const periodo = String(item.periodoId || '').toLowerCase().trim();
    if (disc.includes('intervalo') || disc.includes('almoço') || disc.includes('almoco') || disc.includes('folga') || disc.includes('off') || disc === '-') return false;
    if (periodo.startsWith('int') || periodo.includes('almoco') || periodo.includes('almoço') || periodo.includes('jantar')) return false;
    if (turma.includes('folga') || turma.includes('off') || turma === '-') return false;
    return true;
  }
  const str = String(item).toLowerCase().trim();
  if (str.includes('intervalo') || str.includes('almoço') || str.includes('almoco') || str.includes('folga') || str.includes('off') || str === '-') return false;
  return true;
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
  if (upper.includes('EXA') || upper.includes('EXATAS') || upper.includes('MATEMÁTICA') || upper.includes('FÍSICA')) return 'Exatas (EXA)';
  if (upper.includes('NAT') || upper.includes('NATUREZA') || upper.includes('BIOLOGIA') || upper.includes('QUÍMICA') || upper.includes('CIÊNCIAS')) return 'Ciências da Natureza (NAT)';
  if (upper.includes('HUM') || upper.includes('HUMANAS') || upper.includes('HISTÓRIA') || upper.includes('GEOGRAFIA') || upper.includes('FILOSOFIA') || upper.includes('SOCIOLOGIA')) return 'Humanas (HUM)';
  if (upper.includes('LGG') || upper.includes('LINGUA') || upper.includes('PORTUGUÊS') || upper.includes('ARTE') || upper.includes('INGLÊS') || upper.includes('EDUCAÇÃO FÍSICA')) return 'Linguagens (LGG)';
  if (upper.includes('OUT') || upper.includes('GESTÃO') || upper.includes('DIVERSIFICADA') || upper.includes('PROJETO DE VIDA') || upper.includes('ELETIVA') || upper.includes('TUTORIA')) return 'Gestão/Outros (OUT)';
  return 'Gestão/Outros (OUT)';
}

export function encontrarAreaDisciplina(disciplina?: string | null): string {
  if (!disciplina) return 'Gestão/Outros (OUT)';
  return normalizarArea(disciplina);
}

export function podeExcluir(role?: string | null): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'DIRETOR' || r === 'VICE_DIRETOR' || r.includes('DIRETOR');
}

export async function deletarEntidadeUniversal(collectionName: string, id: string): Promise<boolean> {
  try {
    const { db } = await import('./lib/database');
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db as any, collectionName, id));
    return true;
  } catch (e) {
    console.error(`Erro ao deletar ${collectionName}/${id}:`, e);
    return false;
  }
}

export function extrairEMigrarDocentesDoHorario(horarios: any[]): any[] {
  if (!Array.isArray(horarios)) return [];
  const map = new Map<string, any>();
  horarios.forEach(h => {
    const prof = (h.professor || '').trim();
    if (prof) {
      const key = normalizeTeacherName(prof);
      if (!map.has(key)) {
        map.set(key, { nome: prof, disciplina: h.disciplina || '', area: h.area || '' });
      }
    }
  });
  return Array.from(map.values());
}

export function isSameProfessor(name1?: string | null, name2?: string | null): boolean {
  if (!name1 || !name2) return false;
  const n1 = normalizeTeacherName(name1);
  const n2 = normalizeTeacherName(name2);
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

  // 2. Se o professor tem aula atribuída nesta escola neste dia e período, ele está presente na escola
  if (Array.isArray(horariosEscola) && horariosEscola.length > 0) {
    const temAula = horariosEscola.some(h =>
      normalizarDia(h.dia) === diaNorm &&
      getPeriodoOrder(h.periodoId) === pOrder &&
      isSameProfessor(h.professor, teacher)
    );
    if (temAula) {
      return { atSchool: true, reason: 'Em Aula Atribuída' };
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

  // Turno MANHÃ: Trabalha exclusivamente no período da manhã (1ª à 7ª aula, até 14:00)
  if (turno === 'MANHA' || turno === 'MANHÃ') {
    if (pOrder > 7) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Turno Manhã)'
      };
    }
  }

  // Turno TARDE: Trabalha exclusivamente no período da tarde (7ª à 12ª aula)
  if (turno === 'TARDE') {
    if (pOrder < 7) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Turno Tarde)'
      };
    }
  }

  // Turno INTEGRAL (padrão PEI): 1ª à 9ª aula (07:00 às 16:00)
  // Períodos noturnos (10ª à 14ª aula / jantar) estão fora do horário regular de trabalho PEI
  if (turno === 'INTEGRAL' || !turno) {
    if (pOrder > 9) {
      return {
        atSchool: false,
        reason: 'Fora do Horário de Trabalho (Jornada PEI: 1ª-9ª aula)'
      };
    }
  }

  // 4. Se o docente está dentro da sua jornada de trabalho e não possui bloqueio:
  // ele está disponível na escola (vazio / livre para substituição no motor PEI)
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


