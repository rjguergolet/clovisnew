/**
 * src/modules/mapaoConselhoParser.ts
 * Parser de Alta Precisão e Motor de Triagem para o Módulo Especial — Conselho de Bimestre
 * E.E. Professor Clóvis de Lucca (Acesso Restrito: Direção, Vice-Direção e CGPG)
 *
 * Processa Mapões oficiais da SED-SP ("Registro e Controle do Rendimento Escolar") em PDF ou Excel (.xlsx),
 * extraindo dinamicamente todas as disciplinas (Ensino Fundamental e Ensino Médio), menções/notas (M),
 * faltas (F), ausências compensadas / reposições (AC), frequência do bimestre (Fre%) e frequência global
 * anual (FTAn / Fre An%), cruzando com a base de alunos (AEE, Tutor, RA) e classificando os casos de pauta.
 */

export type BimestreConselhoKey = '1B' | '2B' | '3B' | '4B' | 'FINAL';

export type StatusDeliberacaoConselho =
  | 'PENDENTE'
  | 'EM_PAUTA'
  | 'COMPENSACAO_AUSENCIAS'
  | 'RECUPERACAO_INTENSIVA'
  | 'PLANO_AEE'
  | 'APROVADO_CONSELHO'
  | 'RETENCAO_PREVISTA'
  | 'ACOMPANHAMENTO_TUTORIA';

export type PrioridadeConselho =
  | 'URGENTE_DUPLO'
  | 'CRITICO_FALTAS'
  | 'CRITICO_NOTAS'
  | 'FOCO_AEE'
  | 'ATENCAO_CONSELHO'
  | 'REGULAR'
  | 'INATIVO';

export interface DisciplinaMapaoDef {
  codigo: string;
  nome: string;
  nomeCurto: string;
  aulasDadas: number | null;
}

export interface NotaDisciplinaMapao {
  codigo: string;
  nome: string;
  nomeCurto: string;
  mencao: string;
  notaNum: number | null;
  faltas: number;
  ausenciaCompensada: number; // AC (Reposições / Compensação)
  aulasDadas: number | null;
  notaVermelha: boolean; // notaNum < 5.0 ou menção EP/I
}

export interface AlunoMapaoExtraido {
  numChamada: number;
  nome: string;
  situacao: string;
  isAtivo: boolean;
  disciplinas: Record<string, NotaDisciplinaMapao>;
  totalFaltasBimestre: number; // TF
  freqBimestreStr: string; // Fre(%)
  freqBimestreNum: number | null;
  faltasTotalAno: number; // FT An
  freqAnualStr: string; // Fre An(%)
  freqAnualNum: number | null;
  totalAusenciasCompensadas: number; // Soma de AC em todas as disciplinas
  mediaGlobalNotas: number | null;
  qtdNotasVermelhas: number;
  notasVermelhas: Array<{
    codigo: string;
    nome: string;
    nomeCurto: string;
    mencao: string;
    notaNum: number | null;
  }>;
}

export type ResultadoFinalConselho =
  | 'PENDENTE'
  | 'APROVADO'
  | 'APROVADO_CONSELHO'
  | 'REPROVADO_NOTA'
  | 'REPROVADO_FALTA'
  | 'REPROVADO_AMBOS'
  | 'TRANSFERIDO_BAIXA';

export interface DeliberacaoAlunoConselho {
  status: StatusDeliberacaoConselho;
  parecer: string;
  aeeManual?: boolean | null; // null/undefined = usar base; true/false = override no conselho
  resultadoFinal?: ResultadoFinalConselho;
  turmaAnoSeguinte?: string;
  atualizadoPor?: string;
  atualizadoEm?: string;
}

export interface BoletimBimestreResumo {
  bimestreKey: BimestreConselhoKey;
  label: string;
  mediaGeral: number | null;
  freqBimestreStr: string;
  freqAnualStr: string;
  totalFaltasBimestre: number;
  faltasTotalAno: number;
  qtdNotasVermelhas: number;
  disciplinasResumo: Array<{
    nome: string;
    nomeCurto: string;
    mencao: string;
    notaNum: number | null;
    faltas: number;
    ac: number;
    notaVermelha: boolean;
  }>;
}

export interface ParticipanteAssinaturaAta {
  nome: string;
  detalhe?: string;
}

export interface AtaConselhoTurmaData {
  dataReuniao: string;
  horarioInicio: string;
  horarioFim: string;
  localReuniao: string;
  tituloPersonalizado?: string;
  aberturaPanorama: string;
  oqueFoiFaladoDiscurso: string;
  oqueFoiPensadoEstrategias: string;
  decisoesEncaminhamentos: string;
  direcaoNome: string;
  viceDirecaoNome: string;
  cgpgNome: string;
  professores: ParticipanteAssinaturaAta[];
  alunosRepresentantes: ParticipanteAssinaturaAta[];
  convidados: ParticipanteAssinaturaAta[];
  linhasEmBrancoProfessores: number;
  linhasEmBrancoAlunos: number;
  linhasEmBrancoConvidados: number;
  incluirTabelaDeliberacoes: boolean;
  incluirQuadroResultadoFinal: boolean;
  atualizadoPor?: string;
  atualizadoEm?: string;
}

export interface AlunoConselhoClassificado extends AlunoMapaoExtraido {
  chaveAluno: string; // Chave determinística para persistência de deliberações (ex: "n19_JULIA_GABRIELLY")
  ra: string | null;
  vinculadoBase: boolean;
  isAEE: boolean;
  aeeOrigem: 'BASE' | 'MANUAL' | 'NAO';
  infoAEE: string;
  tutor: string;
  recomposicao: boolean;
  telefoneResponsavel: string;
  boletimHistorico: BoletimBimestreResumo[];
  // Flags oficiais de triagem do Conselho
  reprovandoPorFaltasGlobal: boolean; // Fre An < 75%
  perdidoEmFaltasExtremo: boolean; // Fre An < 70%
  riscoLimiteFaltas: boolean; // Fre An entre 75% e 79% OU Fre Bim < 75%
  criticoNotas4Mais: boolean; // >= 4 notas vermelhas
  alertaNotas1a3: boolean; // 1 a 3 notas vermelhas
  duploCritico: boolean; // Reprovando por faltas E >= 4 notas vermelhas
  precisaConversaConselho: boolean; // Pauta obrigatória no conselho
  prioridade: PrioridadeConselho;
  scoreGravidade: number;
  motivosConselho: string[];
  aulasCompensacaoEstimadas: number; // Estimativa de aulas/AC para atingir 75% global
  disciplinasComFaltaCritica: Array<{
    nome: string;
    nomeCurto: string;
    faltas: number;
    ac: number;
    aulasDadas: number;
    pctFreq: number;
  }>;
  deliberacao: DeliberacaoAlunoConselho;
}

export interface MapaoConselhoMetadata {
  anoLetivo: number;
  diretoria: string;
  escola: string;
  tipoEnsino: string;
  turmaOriginal: string;
  turmaNormalizada: string;
  tipoFechamento: string;
  bimestre: number;
  bimestreKey: BimestreConselhoKey;
  totalAulasDadas: number;
  totalAulasDadasEletiva: number;
  diretor: string;
  goe: string;
  disciplinas: DisciplinaMapaoDef[];
  arquivoOrigem?: string;
}

export interface MapaoConselhoParsed {
  sucesso: boolean;
  mensagem?: string;
  metadata: MapaoConselhoMetadata;
  alunos: AlunoMapaoExtraido[];
}

export interface ConselhoTurmaDoc {
  docId?: string;
  chaveTurmaBimestre: string; // ex: "2026_3B_6_ANO_A"
  metadata: MapaoConselhoMetadata;
  alunosRaw: AlunoMapaoExtraido[];
  deliberacoes: Record<string, DeliberacaoAlunoConselho>;
  observacoesGeraisTurma?: string;
  ataConselho?: AtaConselhoTurmaData;
  origemDados?: 'MAPAO_UPLOAD' | 'BOLETIM_SISTEMA';
  importadoPor?: string;
  importadoEm: string;
  atualizadoEm: string;
}

// ============================================================================
// DICIONÁRIO OFICIAL DE CÓDIGOS DE DISCIPLINAS SED-SP (EF + EM + PEI)
// ============================================================================
const SED_DISCIPLINA_POR_CODIGO: Record<string, { nome: string; curto: string }> = {
  '1100': { nome: 'LÍNGUA PORTUGUESA', curto: 'LP' },
  '1813': { nome: 'ARTE', curto: 'ARTE' },
  '1900': { nome: 'EDUCAÇÃO FÍSICA', curto: 'ED. FÍS.' },
  '2100': { nome: 'GEOGRAFIA', curto: 'GEO' },
  '2200': { nome: 'HISTÓRIA', curto: 'HIS' },
  '2300': { nome: 'SOCIOLOGIA', curto: 'SOC' },
  '2400': { nome: 'FILOSOFIA', curto: 'FIL' },
  '2500': { nome: 'BIOLOGIA', curto: 'BIO' },
  '2600': { nome: 'FÍSICA', curto: 'FÍS' },
  '2700': { nome: 'MATEMÁTICA', curto: 'MAT' },
  '2800': { nome: 'QUÍMICA', curto: 'QUÍ' },
  '2900': { nome: 'CIÊNCIAS', curto: 'CIE' },
  '3100': { nome: 'LÍNGUA INGLESA', curto: 'ING' },
  '8441': { nome: 'PROJETO DE VIDA', curto: 'P. VIDA' },
  '8465': { nome: 'ELETIVAS', curto: 'ELET.' },
  '8466': { nome: 'TECNOLOGIA E INOVAÇÃO', curto: 'TEC.' },
  '8467': { nome: 'LÍNGUA INGLESA', curto: 'ING' },
  '8468': { nome: 'CIÊNCIAS', curto: 'CIE' },
  '8469': { nome: 'PRÁTICAS EXPERIMENTAIS', curto: 'PRÁT. EXP.' },
  '8470': { nome: 'ORIENTAÇÃO DE ESTUDOS', curto: 'O.E.' },
  '52001': { nome: 'REDAÇÃO E LEITURA', curto: 'RED.' },
  '55207': { nome: 'ORIENTAÇÃO DE ESTUDO - MATEMÁTICA', curto: 'OE MAT' },
  '55208': { nome: 'ORIENTAÇÃO DE ESTUDO - LÍNGUA PORTUGUESA', curto: 'OE LP' },
  '55209': { nome: 'EDUCAÇÃO FINANCEIRA', curto: 'ED. FIN.' },
  '55210': { nome: 'TECNOLOGIA E ROBÓTICA', curto: 'ROBÓTICA' },
  '55211': { nome: 'PROGRAMAÇÃO', curto: 'PROG.' },
  '55212': { nome: 'EMPREENDEDORISMO', curto: 'EMPR.' },
  '55213': { nome: 'LIDERANÇA', curto: 'LID.' },
  '55214': { nome: 'ORATÓRIA', curto: 'ORAT.' },
  '55215': { nome: 'ARTE E MÍDIAS DIGITAIS', curto: 'MÍDIAS' },
  '55216': { nome: 'GEOPOLÍTICA', curto: 'GEOPOL.' },
  '55217': { nome: 'BIOTECNOLOGIA', curto: 'BIOTEC.' },
  '55218': { nome: 'QUÍMICA APLICADA', curto: 'QUÍ. APL.' },
  '55219': { nome: 'FÍSICA CRIATIVA', curto: 'FÍS. CRI.' },
  '55220': { nome: 'MATEMÁTICA APLICADA', curto: 'MAT. APL.' }
};

export function normalizarTextoComparacao(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarTurmaMapao(turmaRaw: string): string {
  if (!turmaRaw) return 'TURMA NÃO IDENTIFICADA';
  const norm = String(turmaRaw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/°/g, 'º')
    .trim();

  const match = norm.match(/\b([1-9])\s*[ºªO]?\s*(?:ANO|SERIE)?\s*([A-Z])\b/);
  if (match) {
    const num = parseInt(match[1], 10);
    const letra = match[2].toUpperCase();
    const isEM = norm.includes('SERIE') || norm.includes('MEDIO') || (num >= 1 && num <= 3);
    return isEM ? `${num}ª SÉRIE ${letra}` : `${num}º ANO ${letra}`;
  }

  return String(turmaRaw).replace(/\s+INTEGRAL.*$/i, '').trim().toUpperCase();
}

export function gerarChaveTurma(turma: string): string {
  const norm = normalizarTurmaMapao(turma);
  const m = norm.match(/([1-9]).*?([A-Z])$/);
  if (m) return `${m[1]}${m[2]}`;
  return normalizarTextoComparacao(norm).replace(/\s+/g, '_');
}

export function gerarChaveAlunoConselho(numChamada: number, nome: string): string {
  const clean = normalizarTextoComparacao(nome).replace(/\s+/g, '_');
  return `n${numChamada}_${clean}`;
}

export function gerarChaveTurmaBimestre(anoLetivo: number, bimestreKey: BimestreConselhoKey, turmaNormalizada: string): string {
  const slug = normalizarTextoComparacao(turmaNormalizada).replace(/\s+/g, '_');
  return `${anoLetivo || 2026}_${bimestreKey}_${slug}`;
}

export function detectarBimestreMapao(texto: string): {
  bimestre: number;
  bimestreKey: BimestreConselhoKey;
  tipoFechamento: string;
} {
  const norm = normalizarTextoComparacao(texto);
  if (
    norm.includes('CONSELHO FINAL') ||
    norm.includes('FECHAMENTO FINAL') ||
    norm.includes('RESULTADO FINAL') ||
    norm.includes('CONSELHO DE CLASSE FINAL')
  ) {
    return { bimestre: 5, bimestreKey: 'FINAL', tipoFechamento: 'Conselho Final' };
  }
  if (norm.includes('QUARTO BIMESTRE') || norm.includes('4 BIMESTRE') || norm.includes('4O BIMESTRE') || /\b4B\b/.test(norm)) {
    return { bimestre: 4, bimestreKey: '4B', tipoFechamento: 'Conselho Quarto Bimestre' };
  }
  if (norm.includes('TERCEIRO BIMESTRE') || norm.includes('3 BIMESTRE') || norm.includes('3O BIMESTRE') || /\b3B\b/.test(norm)) {
    return { bimestre: 3, bimestreKey: '3B', tipoFechamento: 'Conselho Terceiro Bimestre' };
  }
  if (norm.includes('SEGUNDO BIMESTRE') || norm.includes('2 BIMESTRE') || norm.includes('2O BIMESTRE') || /\b2B\b/.test(norm)) {
    return { bimestre: 2, bimestreKey: '2B', tipoFechamento: 'Conselho Segundo Bimestre' };
  }
  if (norm.includes('PRIMEIRO BIMESTRE') || norm.includes('1 BIMESTRE') || norm.includes('1O BIMESTRE') || /\b1B\b/.test(norm)) {
    return { bimestre: 1, bimestreKey: '1B', tipoFechamento: 'Conselho Primeiro Bimestre' };
  }
  return { bimestre: 3, bimestreKey: '3B', tipoFechamento: 'Conselho de Bimestre' };
}

function abreviarDisciplina(nome: string): string {
  const n = normalizarTextoComparacao(nome);
  if (n.includes('ORIENTACAO DE ESTUDO') && n.includes('PORTUGUES')) return 'OE LP';
  if (n.includes('ORIENTACAO DE ESTUDO') && n.includes('MATEMATICA')) return 'OE MAT';
  if (n.includes('LINGUA PORTUGUESA')) return 'LP';
  if (n.includes('LINGUA INGLESA')) return 'ING';
  if (n.includes('EDUCACAO FISICA')) return 'ED. FÍS.';
  if (n.includes('EDUCACAO FINANCEIRA')) return 'ED. FIN.';
  if (n.includes('PROJETO DE VIDA')) return 'P. VIDA';
  if (n.includes('REDACAO')) return 'RED.';
  if (n.includes('TECNOLOGIA')) return 'TEC.';
  if (n.includes('MATEMATICA')) return 'MAT';
  if (n.includes('CIENCIAS')) return 'CIE';
  if (n.includes('GEOGRAFIA')) return 'GEO';
  if (n.includes('HISTORIA')) return 'HIS';
  if (n.includes('BIOLOGIA')) return 'BIO';
  if (n.includes('FISICA')) return 'FÍS';
  if (n.includes('QUIMICA')) return 'QUÍ';
  if (n.includes('FILOSOFIA')) return 'FIL';
  if (n.includes('SOCIOLOGIA')) return 'SOC';
  if (n.includes('ELETIVA')) return 'ELET.';
  if (n === 'ARTE') return 'ARTE';
  const words = n.split(' ').filter(w => w.length > 2);
  if (words.length >= 2) {
    return `${words[0].slice(0, 4)}. ${words[1].slice(0, 3)}.`;
  }
  return n.slice(0, 8);
}

function parseNotaToken(raw: string): { mencao: string; notaNum: number | null; notaVermelha: boolean } {
  const s = String(raw || '').trim().toUpperCase();
  if (!s || s === '-' || s === '—' || s === 'N/A') {
    return { mencao: '—', notaNum: null, notaVermelha: false };
  }
  const num = parseFloat(s.replace(',', '.'));
  if (!Number.isNaN(num)) {
    const rounded = Math.round(num * 10) / 10;
    return {
      mencao: Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1),
      notaNum: rounded,
      notaVermelha: rounded < 5.0
    };
  }
  // Menções alfabéticas SED (EP = Engajamento Parcial, I = Insuficiente)
  const vermelha = s === 'EP' || s === 'I' || s === 'INSUFICIENTE' || s === 'NS';
  return { mencao: s, notaNum: null, notaVermelha: vermelha };
}

function parsePercentToken(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace('%', '').replace(',', '.').trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
}

/**
 * Tenta segmentar o cabeçalho textual de disciplinas entre "ALUNO SIT" e "TOTAL"
 * como fallback para códigos SED não mapeados no dicionário estático.
 */
function extrairNomesCabecalhoFallback(headerBlock: string, qtdCodigos: number): string[] {
  if (!headerBlock || qtdCodigos <= 0) return [];
  let cleaned = headerBlock
    .replace(/^[\s\S]*?ALUNO\s+SIT\s*/i, '')
    .replace(/\s*TOTAL[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  // Lista conhecida de nomes de componentes da SED para segmentação gulosa da esquerda para direita
  const conhecidos = [
    'ORIENTAÇAO DE ESTUDO - LINGUA PORTUGUESA',
    'ORIENTACAO DE ESTUDO - LINGUA PORTUGUESA',
    'ORIENTAÇAO DE ESTUDO - MATEMATICA',
    'ORIENTACAO DE ESTUDO - MATEMATICA',
    'ORIENTACAO DE ESTUDOS',
    'EDUCACAO FINANCEIRA',
    'TECNOLOGIA E INOVACAO',
    'TECNOLOGIA E ROBOTICA',
    'REDAÇAO E LEITURA',
    'REDACAO E LEITURA',
    'LINGUA PORTUGUESA',
    'EDUCACAO FISICA',
    'PRATICAS EXPERIMENTAIS',
    'PROJETO DE VIDA',
    'LINGUA INGLESA',
    'ARTE E MIDIAS DIGITAIS',
    'EMPREENDEDORISMO',
    'MATEMATICA',
    'SOCIOLOGIA',
    'GEOGRAFIA',
    'FILOSOFIA',
    'BIOLOGIA',
    'CIENCIAS',
    'ELETIVAS',
    'HISTORIA',
    'QUIMICA',
    'FISICA',
    'ARTE'
  ];

  const encontrados: string[] = [];
  let cursor = cleaned;
  const cursorNorm = () => normalizarTextoComparacao(cursor);

  while (cursor.trim().length > 0 && encontrados.length < qtdCodigos) {
    const cNorm = cursorNorm();
    let matchedLen = 0;
    let matchedLabel = '';
    for (const nome of conhecidos) {
      const nNorm = normalizarTextoComparacao(nome);
      if (cNorm.startsWith(nNorm)) {
        matchedLabel = nome;
        matchedLen = nNorm.length;
        break;
      }
    }
    if (matchedLabel) {
      encontrados.push(matchedLabel);
      // Remove aproximadamente o mesmo número de palavras de cursor
      const wordCount = matchedLabel.split(/\s+/).length;
      cursor = cursor.split(/\s+/).slice(wordCount).join(' ').trim();
    } else {
      break;
    }
  }

  return encontrados;
}

/**
 * Parser principal para texto extraído de PDF do Mapão SED ("Registro e Controle do Rendimento Escolar")
 */
export function parseMapaoConselhoText(textoBruto: string, fileName?: string): MapaoConselhoParsed {
  const emptyMeta: MapaoConselhoMetadata = {
    anoLetivo: 2026,
    diretoria: '',
    escola: 'EE Prof. Clóvis de Lucca',
    tipoEnsino: '',
    turmaOriginal: '',
    turmaNormalizada: '',
    tipoFechamento: '',
    bimestre: 3,
    bimestreKey: '3B',
    totalAulasDadas: 0,
    totalAulasDadasEletiva: 0,
    diretor: '',
    goe: '',
    disciplinas: [],
    arquivoOrigem: fileName
  };

  if (!textoBruto || typeof textoBruto !== 'string' || textoBruto.trim().length < 20) {
    return {
      sucesso: false,
      mensagem: 'Documento vazio ou ilegível. Envie o PDF oficial do Mapão gerado pela SED.',
      metadata: emptyMeta,
      alunos: []
    };
  }

  const rawLines = textoBruto.split(/\r?\n/).map(l => l.trim());

  // 1. Extração de Cabeçalho Institucional
  const anoMatch = textoBruto.match(/Ano\s+Letivo:\s*(\d{4})/i);
  const anoLetivo = anoMatch ? parseInt(anoMatch[1], 10) : 2026;

  const dirMatch = textoBruto.match(/Diretoria:\s*([^\n\r]+)/i);
  const diretoria = dirMatch ? dirMatch[1].trim() : 'São Bernardo do Campo';

  const escMatch = textoBruto.match(/Escola:\s*([^\n\r]+)/i);
  const escola = escMatch ? escMatch[1].trim() : 'Clovis de Lucca Professor';

  const ensMatch = textoBruto.match(/Tipo\s+de\s+Ensino:\s*([^\n\r]+)/i);
  const tipoEnsino = ensMatch ? ensMatch[1].trim() : '';

  const turmaMatch = textoBruto.match(/Turma:\s*([^\n\r]+)/i);
  const turmaOriginal = turmaMatch ? turmaMatch[1].trim() : '';
  const turmaNormalizada = normalizarTurmaMapao(turmaOriginal);

  const fechMatch = textoBruto.match(/Tipo\s+Fechamento:\s*([^\n\r]+)/i);
  const tipoFechRaw = fechMatch ? fechMatch[1].trim() : '';
  const bimInfo = detectarBimestreMapao(tipoFechRaw || fileName || textoBruto.slice(0, 1200));

  const aulasMatch = textoBruto.match(/Total\s+de\s+Aulas\s+Dadas:\s*(\d+)/i);
  const totalAulasDadas = aulasMatch ? parseInt(aulasMatch[1], 10) : 0;

  const eletivaMatch = textoBruto.match(/Total\s+de\s+Aulas\s+Dadas\s+Eletiva:\s*(\d+)/i);
  const totalAulasDadasEletiva = eletivaMatch ? parseInt(eletivaMatch[1], 10) : 0;

  // 2. Extração dinâmica dos códigos de disciplinas (linha com 4+ códigos numéricos de 3 a 6 dígitos)
  let codigosDisciplinas: string[] = [];
  let idxLinhaCodigos = -1;
  let idxLinhaHeaderStart = -1;

  for (let i = 0; i < Math.min(rawLines.length, 45); i++) {
    const l = rawLines[i];
    if (idxLinhaHeaderStart === -1 && /^ALUNO\s+SIT\b/i.test(l)) {
      idxLinhaHeaderStart = i;
    }
    if (/^(?:\d{3,6}\s+){3,}\d{3,6}$/.test(l)) {
      codigosDisciplinas = l.split(/\s+/).filter(Boolean);
      idxLinhaCodigos = i;
      break;
    }
  }

  // Extração das "Aulas Dadas: XX" no rodapé por disciplina
  const aulasDadasPorDisc: number[] = [];
  const aulasFooterMatches = textoBruto.matchAll(/Aulas\s+Dadas:\s*(\d+)/gi);
  for (const m of aulasFooterMatches) {
    // Evitar o "Total de Aulas Dadas:" do cabeçalho
    const startIdx = m.index ?? 0;
    const prefix = textoBruto.slice(Math.max(0, startIdx - 12), startIdx);
    if (/Total\s+de\s*$/i.test(prefix)) continue;
    aulasDadasPorDisc.push(parseInt(m[1], 10));
  }

  // Fallback de nomes a partir do bloco de cabeçalho entre ALUNO SIT e a linha de códigos
  const headerBlock =
    idxLinhaHeaderStart !== -1 && idxLinhaCodigos > idxLinhaHeaderStart
      ? rawLines.slice(idxLinhaHeaderStart, idxLinhaCodigos).join(' ')
      : '';
  const nomesFallback = extrairNomesCabecalhoFallback(headerBlock, codigosDisciplinas.length);

  const disciplinasDef: DisciplinaMapaoDef[] = codigosDisciplinas.map((cod, idx) => {
    const known = SED_DISCIPLINA_POR_CODIGO[cod];
    const nome = known ? known.nome : (nomesFallback[idx] || `DISCIPLINA ${cod}`);
    const nomeCurto = known ? known.curto : abreviarDisciplina(nome);
    const aulasDadas = idx < aulasDadasPorDisc.length ? aulasDadasPorDisc[idx] : null;
    return {
      codigo: cod,
      nome,
      nomeCurto,
      aulasDadas
    };
  });

  // 3. Extração precisa de todos os estudantes (suporta nomes quebrados em múltiplas linhas e múltiplas páginas)
  const STATUS_REGEX = /\b(Ativo|Transferido|Remanejado|Abandono|Inativo|Falecido|Reclassificado|NCOM|N[aã]o\s+Compareceu|Baixa(?:\s+Transfer[eê]ncia)?)\b/i;

  const isLinhaIgnoradaParaNome = (l: string): boolean => {
    if (!l) return true;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/i.test(l)) return true;
    if (/^(Registro e Controle|Ano Letivo|Diretoria:|Escola:|Tipo de Ensino|Turma:|Tipo Fechamento|Total de Aulas|ALUNO\s+SIT|Nº\s+M\s+F|N°\s+M\s+F|Aulas Dadas:|Legenda|M\s*-\s*Men|ES\s*-|ET\s*-|EP\s*-|F\s*-\s*Freq|AC\s*-\s*Aus|Diretor\b|GOE\b)/i.test(l)) {
      return true;
    }
    if (/^(%\)|FT|An|Fre|An\(|Fre\(|%\)\s*FT)$/i.test(l)) {
      return true;
    }
    if (/^(?:\d{3,6}\s+){3,}\d{3,6}$/.test(l)) return true;
    if (/^\d+$/.test(l)) return true;
    return false;
  };

  // Começa a varredura de estudantes após o cabeçalho da tabela (após linha de códigos ou Nº M F AC)
  let startScanIdx = idxLinhaCodigos !== -1 ? idxLinhaCodigos + 1 : 0;
  for (let i = startScanIdx; i < Math.min(rawLines.length, startScanIdx + 12); i++) {
    const ln = rawLines[i];
    if (/^(Nº|N°)\s+M\s+F\s+AC/i.test(ln) || /^(%\)|FT|An|Fre|An\(|Fre\(|%\)\s*FT)$/i.test(ln)) {
      startScanIdx = i + 1;
    }
  }

  const alunosExtraidos: AlunoMapaoExtraido[] = [];
  let nameBuffer: string[] = [];

  for (let i = startScanIdx; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Parar quando atingir o rodapé de Aulas Dadas ou Legenda
    if (/^Aulas\s+Dadas:\s*\d+/i.test(line) || /^Legenda$/i.test(line)) {
      break;
    }

    if (isLinhaIgnoradaParaNome(line)) {
      continue;
    }

    const matchStatus = line.match(STATUS_REGEX);
    if (matchStatus && matchStatus.index !== undefined) {
      const beforeStatus = line.slice(0, matchStatus.index).trim();
      const situacao = matchStatus[1].trim();
      const afterStatus = line.slice(matchStatus.index + matchStatus[0].length).trim();

      // Verifica se afterStatus tem dados numéricos de notas/faltas (caso contrário pode ser texto solto)
      const tokens = afterStatus.split(/\s+/).filter(Boolean);
      if (tokens.length < 6) {
        if (beforeStatus) nameBuffer.push(beforeStatus);
        continue;
      }

      if (beforeStatus) {
        nameBuffer.push(beforeStatus);
      }

      const nomeCompleto = nameBuffer
        .join(' ')
        .replace(/^\d{1,2}\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      nameBuffer = [];

      if (!nomeCompleto || nomeCompleto.length < 3) {
        continue;
      }

      // Últimos 4 tokens: TF, Fre(%), FTAn, FreAn(%)
      // Em alguns casos raros da SED sem acumulado anual, podem existir apenas 2 tokens (TF, Fre(%))
      let tf = 0;
      let freqBimStr = '—';
      let freqBimNum: number | null = null;
      let ftAn = 0;
      let freqAnStr = '—';
      let freqAnNum: number | null = null;
      let discTokens: string[] = tokens;

      const last4 = tokens.slice(-4);
      if (
        last4.length === 4 &&
        /^\d+$/.test(last4[0]) &&
        /%$/.test(last4[1]) &&
        /^\d+$/.test(last4[2]) &&
        /%$/.test(last4[3])
      ) {
        tf = parseInt(last4[0], 10) || 0;
        freqBimStr = last4[1];
        freqBimNum = parsePercentToken(last4[1]);
        ftAn = parseInt(last4[2], 10) || 0;
        freqAnStr = last4[3];
        freqAnNum = parsePercentToken(last4[3]);
        discTokens = tokens.slice(0, tokens.length - 4);
      } else {
        const last2 = tokens.slice(-2);
        if (last2.length === 2 && /^\d+$/.test(last2[0]) && /%$/.test(last2[1])) {
          tf = parseInt(last2[0], 10) || 0;
          freqBimStr = last2[1];
          freqBimNum = parsePercentToken(last2[1]);
          ftAn = tf;
          freqAnStr = freqBimStr;
          freqAnNum = freqBimNum;
          discTokens = tokens.slice(0, tokens.length - 2);
        }
      }

      // Número da chamada vem no primeiro token de discTokens
      const numChamada = parseInt(discTokens[0], 10) || (alunosExtraidos.length + 1);

      // Se o cabeçalho não detectou códigos, inferir a quantidade de disciplinas por discTokens / 4
      const numDiscs = disciplinasDef.length > 0 ? disciplinasDef.length : Math.floor(discTokens.length / 4);
      if (disciplinasDef.length === 0 && numDiscs > 0) {
        for (let k = 0; k < numDiscs; k++) {
          disciplinasDef.push({
            codigo: `D${k + 1}`,
            nome: `DISCIPLINA ${k + 1}`,
            nomeCurto: `D${k + 1}`,
            aulasDadas: null
          });
        }
      }

      const disciplinasAluno: Record<string, NotaDisciplinaMapao> = {};
      const notasNumericas: number[] = [];
      const notasVermelhas: AlunoMapaoExtraido['notasVermelhas'] = [];
      let totalAC = 0;

      for (let d = 0; d < numDiscs; d++) {
        const def = disciplinasDef[d];
        const baseIdx = d * 4;
        const rawM = discTokens[baseIdx + 1] ?? '-';
        const rawF = discTokens[baseIdx + 2] ?? '0';
        const rawAC = discTokens[baseIdx + 3] ?? '0';

        const parsedNota = parseNotaToken(rawM);
        const faltas = rawF === '-' ? 0 : (parseInt(rawF, 10) || 0);
        const ac = rawAC === '-' ? 0 : (parseInt(rawAC, 10) || 0);
        totalAC += ac;

        if (parsedNota.notaNum !== null) {
          notasNumericas.push(parsedNota.notaNum);
        }
        if (parsedNota.notaVermelha) {
          notasVermelhas.push({
            codigo: def.codigo,
            nome: def.nome,
            nomeCurto: def.nomeCurto,
            mencao: parsedNota.mencao,
            notaNum: parsedNota.notaNum
          });
        }

        disciplinasAluno[def.nome] = {
          codigo: def.codigo,
          nome: def.nome,
          nomeCurto: def.nomeCurto,
          mencao: parsedNota.mencao,
          notaNum: parsedNota.notaNum,
          faltas,
          ausenciaCompensada: ac,
          aulasDadas: def.aulasDadas,
          notaVermelha: parsedNota.notaVermelha
        };
      }

      const mediaGlobalNotas =
        notasNumericas.length > 0
          ? Math.round((notasNumericas.reduce((acc, n) => acc + n, 0) / notasNumericas.length) * 10) / 10
          : null;

      const isAtivo = /^ATIVO$/i.test(situacao);

      alunosExtraidos.push({
        numChamada,
        nome: nomeCompleto,
        situacao,
        isAtivo,
        disciplinas: disciplinasAluno,
        totalFaltasBimestre: tf,
        freqBimestreStr: freqBimStr,
        freqBimestreNum: freqBimNum,
        faltasTotalAno: ftAn,
        freqAnualStr: freqAnStr,
        freqAnualNum: freqAnNum,
        totalAusenciasCompensadas: totalAC,
        mediaGlobalNotas,
        qtdNotasVermelhas: notasVermelhas.length,
        notasVermelhas
      });
    } else {
      // Linha provável de continuação do nome do estudante (somente letras, espaços, acentos, apóstrofo, hífen)
      if (/^[A-ZÀ-ÿ\s'´`\-]{2,}$/i.test(line) && !/\b(DIRETOR|GOE|RODRIGO|JACQUES)\b/i.test(line)) {
        nameBuffer.push(line);
      }
    }
  }

  const metadata: MapaoConselhoMetadata = {
    anoLetivo,
    diretoria,
    escola,
    tipoEnsino,
    turmaOriginal: turmaOriginal || fileName || 'Turma não identificada',
    turmaNormalizada: turmaNormalizada || 'TURMA NÃO IDENTIFICADA',
    tipoFechamento: tipoFechRaw || bimInfo.tipoFechamento,
    bimestre: bimInfo.bimestre,
    bimestreKey: bimInfo.bimestreKey,
    totalAulasDadas,
    totalAulasDadasEletiva,
    diretor: '',
    goe: '',
    disciplinas: disciplinasDef,
    arquivoOrigem: fileName
  };

  return {
    sucesso: alunosExtraidos.length > 0,
    mensagem:
      alunosExtraidos.length > 0
        ? `Mapão processado com sucesso: ${alunosExtraidos.length} registros (${alunosExtraidos.filter(a => a.isAtivo).length} ativos) e ${disciplinasDef.length} componentes curriculares.`
        : 'Não foi possível localizar linhas de estudantes neste arquivo. Verifique se é o PDF oficial do Mapão SED.',
    metadata,
    alunos: alunosExtraidos
  };
}

/**
 * Parser complementar para Mapão SED exportado em Excel (.xlsx / .xls) no navegador
 */
export function parseMapaoConselhoExcelRows(rows: any[][], fileName?: string): MapaoConselhoParsed {
  const emptyMeta: MapaoConselhoMetadata = {
    anoLetivo: 2026,
    diretoria: 'São Bernardo do Campo',
    escola: 'EE Prof. Clóvis de Lucca',
    tipoEnsino: '',
    turmaOriginal: '',
    turmaNormalizada: '',
    tipoFechamento: '',
    bimestre: 3,
    bimestreKey: '3B',
    totalAulasDadas: 0,
    totalAulasDadasEletiva: 0,
    diretor: '',
    goe: '',
    disciplinas: [],
    arquivoOrigem: fileName
  };

  if (!Array.isArray(rows) || rows.length < 5) {
    return {
      sucesso: false,
      mensagem: 'Planilha vazia ou formato não reconhecido.',
      metadata: emptyMeta,
      alunos: []
    };
  }

  let anoLetivo = 2026;
  let turmaOriginal = '';
  let tipoFechRaw = '';
  let totalAulasDadas = 0;
  let totalAulasDadasEletiva = 0;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i] || [];
    const joined = row.map(c => String(c ?? '').trim()).filter(Boolean).join(' ');
    const anoM = joined.match(/Ano\s+Letivo:\s*(\d{4})/i);
    if (anoM) anoLetivo = parseInt(anoM[1], 10);
    const turM = joined.match(/Turma:\s*([^\t\n]+)/i);
    if (turM) turmaOriginal = turM[1].trim();
    const fechM = joined.match(/Tipo\s+Fechamento:\s*([^\t\n]+)/i);
    if (fechM) tipoFechRaw = fechM[1].trim();
    const aulM = joined.match(/Total\s+de\s+Aulas\s+Dadas:\s*(\d+)/i);
    if (aulM) totalAulasDadas = parseInt(aulM[1], 10);
    const elM = joined.match(/Total\s+de\s+Aulas\s+Dadas\s+Eletiva:\s*(\d+)/i);
    if (elM) totalAulasDadasEletiva = parseInt(elM[1], 10);

    if (row.some(c => String(c ?? '').trim().toUpperCase() === 'ALUNO')) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      sucesso: false,
      mensagem: 'Cabeçalho ALUNO não localizado na planilha Excel do Mapão.',
      metadata: emptyMeta,
      alunos: []
    };
  }

  const headerRow = rows[headerRowIdx] || [];
  const codeRow = rows[headerRowIdx + 1] || [];
  const subHeaderRow = rows[headerRowIdx + 2] || [];

  const discCols: Array<{ def: DisciplinaMapaoDef; startCol: number }> = [];
  let totalColStart = -1;

  for (let c = 2; c < headerRow.length; c++) {
    const hVal = String(headerRow[c] ?? '').trim().toUpperCase();
    if (hVal === 'TOTAL') {
      totalColStart = c;
      break;
    }
    if (hVal && hVal !== 'SIT' && hVal !== 'ALUNO') {
      const cod = String(codeRow[c] ?? '').trim();
      const known = SED_DISCIPLINA_POR_CODIGO[cod];
      const nome = known ? known.nome : hVal;
      discCols.push({
        def: {
          codigo: cod || `C${c}`,
          nome,
          nomeCurto: known ? known.curto : abreviarDisciplina(nome),
          aulasDadas: null
        },
        startCol: c
      });
    }
  }

  // Descobre índices das colunas TF, Fre(%), FTAn, FreAn(%)
  let colTF = totalColStart !== -1 ? totalColStart : -1;
  let colFre = totalColStart !== -1 ? totalColStart + 1 : -1;
  let colFTAn = totalColStart !== -1 ? totalColStart + 2 : -1;
  let colFreAn = totalColStart !== -1 ? totalColStart + 3 : -1;

  for (let c = 0; c < subHeaderRow.length; c++) {
    const s = String(subHeaderRow[c] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (s === 'TF') colTF = c;
    else if (s.startsWith('FRE(') && !s.includes('AN')) colFre = c;
    else if (s === 'FTAN') colFTAn = c;
    else if (s.includes('FREAN')) colFreAn = c;
  }

  const alunos: AlunoMapaoExtraido[] = [];

  for (let r = headerRowIdx + 3; r < rows.length; r++) {
    const row = rows[r] || [];
    const nome = String(row[0] ?? '').trim().toUpperCase();
    const situacao = String(row[1] ?? '').trim();
    if (!nome || nome.startsWith('AULAS DADAS') || nome.startsWith('LEGENDA')) continue;
    if (!situacao || !/(Ativo|Transferido|Remanejado|Abandono|Inativo|Falecido|Reclassificado|NCOM)/i.test(situacao)) continue;

    const numChamada = parseInt(String(row[discCols[0]?.startCol ?? 2] ?? ''), 10) || (alunos.length + 1);
    const disciplinas: Record<string, NotaDisciplinaMapao> = {};
    const notasNumericas: number[] = [];
    const notasVermelhas: AlunoMapaoExtraido['notasVermelhas'] = [];
    let totalAC = 0;

    for (const dc of discCols) {
      const rawM = String(row[dc.startCol + 1] ?? '-').trim();
      const rawF = String(row[dc.startCol + 2] ?? '0').trim();
      const rawAC = String(row[dc.startCol + 3] ?? '0').trim();
      const parsedNota = parseNotaToken(rawM);
      const faltas = parseInt(rawF, 10) || 0;
      const ac = parseInt(rawAC, 10) || 0;
      totalAC += ac;

      if (parsedNota.notaNum !== null) notasNumericas.push(parsedNota.notaNum);
      if (parsedNota.notaVermelha) {
        notasVermelhas.push({
          codigo: dc.def.codigo,
          nome: dc.def.nome,
          nomeCurto: dc.def.nomeCurto,
          mencao: parsedNota.mencao,
          notaNum: parsedNota.notaNum
        });
      }
      disciplinas[dc.def.nome] = {
        codigo: dc.def.codigo,
        nome: dc.def.nome,
        nomeCurto: dc.def.nomeCurto,
        mencao: parsedNota.mencao,
        notaNum: parsedNota.notaNum,
        faltas,
        ausenciaCompensada: ac,
        aulasDadas: dc.def.aulasDadas,
        notaVermelha: parsedNota.notaVermelha
      };
    }

    const tf = colTF !== -1 ? (parseInt(String(row[colTF] ?? '0'), 10) || 0) : 0;
    const rawFre = colFre !== -1 ? String(row[colFre] ?? '—').trim() : '—';
    const freqBimNum = parsePercentToken(rawFre);
    const ftAn = colFTAn !== -1 ? (parseInt(String(row[colFTAn] ?? '0'), 10) || 0) : tf;
    const rawFreAn = colFreAn !== -1 ? String(row[colFreAn] ?? rawFre).trim() : rawFre;
    const freqAnNum = parsePercentToken(rawFreAn);

    const mediaGlobalNotas =
      notasNumericas.length > 0
        ? Math.round((notasNumericas.reduce((a, b) => a + b, 0) / notasNumericas.length) * 10) / 10
        : null;

    alunos.push({
      numChamada,
      nome,
      situacao,
      isAtivo: /^ATIVO$/i.test(situacao),
      disciplinas,
      totalFaltasBimestre: tf,
      freqBimestreStr: freqBimNum !== null ? `${freqBimNum}%` : rawFre,
      freqBimestreNum: freqBimNum,
      faltasTotalAno: ftAn,
      freqAnualStr: freqAnNum !== null ? `${freqAnNum}%` : rawFreAn,
      freqAnualNum: freqAnNum,
      totalAusenciasCompensadas: totalAC,
      mediaGlobalNotas,
      qtdNotasVermelhas: notasVermelhas.length,
      notasVermelhas
    });
  }

  const bimInfo = detectarBimestreMapao(tipoFechRaw || fileName || '');
  return {
    sucesso: alunos.length > 0,
    mensagem:
      alunos.length > 0
        ? `Planilha Mapão processada: ${alunos.length} estudantes (${alunos.filter(a => a.isAtivo).length} ativos).`
        : 'Nenhum estudante encontrado na planilha.',
    metadata: {
      ...emptyMeta,
      anoLetivo,
      turmaOriginal: turmaOriginal || fileName || 'Turma não identificada',
      turmaNormalizada: normalizarTurmaMapao(turmaOriginal || fileName || ''),
      tipoFechamento: tipoFechRaw || bimInfo.tipoFechamento,
      bimestre: bimInfo.bimestre,
      bimestreKey: bimInfo.bimestreKey,
      totalAulasDadas,
      totalAulasDadasEletiva,
      disciplinas: discCols.map(d => d.def)
    },
    alunos
  };
}

// ============================================================================
// MOTOR DE CRUZAMENTO (AEE / BASE ESCOLAR) E TRIAGEM DO CONSELHO DE BIMESTRE
// ============================================================================

function detectarAeeNoCadastro(al: any): { isAEE: boolean; info: string } {
  if (!al) return { isAEE: false, info: '' };
  const raw = al.aee;
  const isFlag =
    raw === true ||
    ['SIM', 'S', 'TRUE', '1', 'ATIVO'].includes(String(raw ?? '').trim().toUpperCase()) ||
    Boolean(al.deficiencia && String(al.deficiencia).trim() && !/^(N[ÃA]O|NENHUMA|-)$/i.test(String(al.deficiencia).trim())) ||
    Boolean(al.laudo_aee && String(al.laudo_aee).trim());

  if (!isFlag) return { isAEE: false, info: '' };

  const detalhes = [
    al.deficiencia,
    al.tipo_aee,
    al.cid,
    al.laudo_aee,
    al.observacoes_aee,
    al.necessidade_especial
  ]
    .map(v => String(v ?? '').trim())
    .filter(v => v && !/^(N[ÃA]O|NENHUMA|-|SIM)$/i.test(v));

  return {
    isAEE: true,
    info: detalhes.length > 0 ? detalhes.join(' · ') : 'Atendimento Educacional Especializado (AEE)'
  };
}

function encontrarAlunoNaBase(nomeMapao: string, turmaMapao: string, baseAlunos: any[]): any | null {
  if (!Array.isArray(baseAlunos) || baseAlunos.length === 0) return null;
  const nomeNorm = normalizarTextoComparacao(nomeMapao);
  const turmaKey = gerarChaveTurma(turmaMapao);
  const tokensMapao = nomeNorm.split(' ').filter(Boolean);

  // 1. Nome exato + mesma turma
  const exatoMesmaTurma = baseAlunos.find(
    a => normalizarTextoComparacao(a.nome) === nomeNorm && gerarChaveTurma(a.turma || '') === turmaKey
  );
  if (exatoMesmaTurma) return exatoMesmaTurma;

  // 2. Nome exato na escola
  const exatoEscola = baseAlunos.find(a => normalizarTextoComparacao(a.nome) === nomeNorm);
  if (exatoEscola) return exatoEscola;

  // 3. Aproximado na mesma turma (primeiro e último nome iguais + >= 70% tokens)
  if (tokensMapao.length >= 2) {
    const alunosTurma = baseAlunos.filter(a => gerarChaveTurma(a.turma || '') === turmaKey);
    const pool = alunosTurma.length > 0 ? alunosTurma : baseAlunos;
    const aprox = pool.find(a => {
      const aTokens = normalizarTextoComparacao(a.nome).split(' ').filter(Boolean);
      if (aTokens.length < 2) return false;
      if (aTokens[0] !== tokensMapao[0] || aTokens[aTokens.length - 1] !== tokensMapao[tokensMapao.length - 1]) {
        return false;
      }
      const setA = new Set(aTokens);
      const comuns = tokensMapao.filter(t => setA.has(t)).length;
      return comuns >= Math.min(aTokens.length, tokensMapao.length) * 0.7;
    });
    if (aprox) return aprox;
  }

  return null;
}

export function classificarAlunosConselho(
  alunosRaw: AlunoMapaoExtraido[],
  metadata: MapaoConselhoMetadata,
  baseAlunos: any[] = [],
  deliberacoes: Record<string, DeliberacaoAlunoConselho> = {}
): AlunoConselhoClassificado[] {
  const lista: AlunoConselhoClassificado[] = alunosRaw.map(al => {
    const chaveAluno = gerarChaveAlunoConselho(al.numChamada, al.nome);
    const delibSalva: DeliberacaoAlunoConselho = deliberacoes[chaveAluno] || {
      status: 'PENDENTE',
      parecer: ''
    };

    const matchBase = encontrarAlunoNaBase(al.nome, metadata.turmaNormalizada || metadata.turmaOriginal, baseAlunos);
    const aeeBase = detectarAeeNoCadastro(matchBase);

    let isAEE = aeeBase.isAEE;
    let aeeOrigem: 'BASE' | 'MANUAL' | 'NAO' = aeeBase.isAEE ? 'BASE' : 'NAO';
    if (delibSalva.aeeManual === true) {
      isAEE = true;
      aeeOrigem = aeeBase.isAEE ? 'BASE' : 'MANUAL';
    } else if (delibSalva.aeeManual === false) {
      isAEE = false;
      aeeOrigem = 'NAO';
    }

    const freqAnual = al.freqAnualNum;
    const freqBim = al.freqBimestreNum;

    // Critérios oficiais do Conselho de Bimestre
    const reprovandoPorFaltasGlobal = al.isAtivo && freqAnual !== null && freqAnual < 75;
    const perdidoEmFaltasExtremo = al.isAtivo && freqAnual !== null && freqAnual < 70;
    const riscoLimiteFaltas =
      al.isAtivo &&
      !reprovandoPorFaltasGlobal &&
      ((freqAnual !== null && freqAnual < 80) || (freqBim !== null && freqBim < 75));

    const criticoNotas4Mais = al.isAtivo && al.qtdNotasVermelhas >= 4;
    const alertaNotas1a3 = al.isAtivo && al.qtdNotasVermelhas >= 1 && al.qtdNotasVermelhas <= 3;
    const duploCritico = reprovandoPorFaltasGlobal && criticoNotas4Mais;

    // Disciplinas com frequência individual crítica no bimestre (< 75% descontando AC)
    const disciplinasComFaltaCritica: AlunoConselhoClassificado['disciplinasComFaltaCritica'] = [];
    if (al.isAtivo) {
      Object.values(al.disciplinas).forEach(d => {
        if (d.aulasDadas && d.aulasDadas > 0 && d.faltas > 0) {
          const faltasLiquidas = Math.max(0, d.faltas - d.ausenciaCompensada);
          const pctFreq = Math.round(((d.aulasDadas - faltasLiquidas) / d.aulasDadas) * 100);
          if (pctFreq < 75) {
            disciplinasComFaltaCritica.push({
              nome: d.nome,
              nomeCurto: d.nomeCurto,
              faltas: d.faltas,
              ac: d.ausenciaCompensada,
              aulasDadas: d.aulasDadas,
              pctFreq
            });
          }
        }
      });
      disciplinasComFaltaCritica.sort((a, b) => a.pctFreq - b.pctFreq);
    }

    // Estimativa de aulas de compensação (AC) para sair de <75% na média global anual
    let aulasCompensacaoEstimadas = 0;
    if (reprovandoPorFaltasGlobal && freqAnual !== null && al.faltasTotalAno > 0) {
      const taxaFaltaAnual = Math.max(0.01, (100 - freqAnual) / 100);
      const totalAulasAnoEstimado = Math.round(al.faltasTotalAno / taxaFaltaAnual);
      const maxFaltasPermitidas = Math.floor(totalAulasAnoEstimado * 0.25);
      aulasCompensacaoEstimadas = Math.max(1, al.faltasTotalAno - maxFaltasPermitidas);
    }

    // Motivos objetivos para pauta do conselho
    const motivosConselho: string[] = [];
    if (al.isAtivo) {
      if (reprovandoPorFaltasGlobal) {
        motivosConselho.push(
          `Reprovando por faltas na média global: ${freqAnual}% anual (${al.faltasTotalAno} faltas acumuladas; mínimo legal 75%).`
        );
      }
      if (criticoNotas4Mais) {
        const resumoDisc = al.notasVermelhas.map(n => `${n.nomeCurto} (${n.mencao})`).join(', ');
        motivosConselho.push(`Crítico em rendimento: ${al.qtdNotasVermelhas} notas vermelhas (< 5,0): ${resumoDisc}.`);
      }
      if (isAEE) {
        motivosConselho.push(
          `Estudante AEE${aeeBase.info ? ` (${aeeBase.info})` : ''} — análise individualizada obrigatória em conselho.`
        );
      }
      if (riscoLimiteFaltas) {
        if (freqBim !== null && freqBim < 75) {
          motivosConselho.push(
            `Frequência do bimestre abaixo de 75% (${freqBim}% com ${al.totalFaltasBimestre} faltas) e global anual em zona limite (${freqAnual ?? '—'}%).`
          );
        } else {
          motivosConselho.push(
            `Frequência global anual em zona limite (${freqAnual}% com ${al.faltasTotalAno} faltas — risco de cair abaixo de 75%).`
          );
        }
      }
      if (alertaNotas1a3) {
        const resumoDisc = al.notasVermelhas.map(n => `${n.nomeCurto} (${n.mencao})`).join(', ');
        motivosConselho.push(
          `${al.qtdNotasVermelhas} nota${al.qtdNotasVermelhas > 1 ? 's' : ''} abaixo de 5,0: ${resumoDisc}.`
        );
      }
      if (al.mediaGlobalNotas !== null && al.mediaGlobalNotas < 5.5 && !criticoNotas4Mais) {
        motivosConselho.push(`Média global de notas baixa (${al.mediaGlobalNotas.toFixed(1)}).`);
      }
    }

    const precisaConversaConselho =
      al.isAtivo &&
      (reprovandoPorFaltasGlobal ||
        criticoNotas4Mais ||
        isAEE ||
        riscoLimiteFaltas ||
        alertaNotas1a3 ||
        (al.mediaGlobalNotas !== null && al.mediaGlobalNotas < 5.5));

    // Prioridade e Score de Gravidade
    let prioridade: PrioridadeConselho = 'REGULAR';
    let scoreGravidade = 0;

    if (!al.isAtivo) {
      prioridade = 'INATIVO';
      scoreGravidade = -100;
    } else if (duploCritico) {
      prioridade = 'URGENTE_DUPLO';
      scoreGravidade = 1000 + (isAEE ? 80 : 0) + (75 - (freqAnual ?? 75)) * 5 + al.qtdNotasVermelhas * 20;
    } else if (reprovandoPorFaltasGlobal) {
      prioridade = 'CRITICO_FALTAS';
      scoreGravidade = 700 + (isAEE ? 80 : 0) + (75 - (freqAnual ?? 75)) * 8 + al.qtdNotasVermelhas * 12;
    } else if (criticoNotas4Mais) {
      prioridade = 'CRITICO_NOTAS';
      scoreGravidade = 600 + (isAEE ? 80 : 0) + al.qtdNotasVermelhas * 25 + (freqAnual !== null ? Math.max(0, 85 - freqAnual) : 0);
    } else if (isAEE) {
      prioridade = 'FOCO_AEE';
      scoreGravidade = 450 + al.qtdNotasVermelhas * 20 + (freqAnual !== null ? Math.max(0, 85 - freqAnual) * 2 : 0);
    } else if (precisaConversaConselho) {
      prioridade = 'ATENCAO_CONSELHO';
      scoreGravidade =
        200 +
        (riscoLimiteFaltas ? 80 : 0) +
        al.qtdNotasVermelhas * 30 +
        (freqAnual !== null ? Math.max(0, 85 - freqAnual) * 3 : 0);
    } else {
      prioridade = 'REGULAR';
      scoreGravidade = 0;
    }

    const boletimHistorico = matchBase ? extrairBoletimHistoricoAluno(matchBase) : [];

    return {
      ...al,
      chaveAluno,
      ra: matchBase ? String(matchBase.ra || matchBase.id || '') : null,
      vinculadoBase: Boolean(matchBase),
      isAEE,
      aeeOrigem,
      infoAEE: isAEE ? (aeeBase.info || 'Marcado como AEE no Conselho') : '',
      tutor: matchBase ? String(matchBase.tutor_2026 || matchBase.tutor || matchBase.nomeTutor || '').trim() : '',
      recomposicao: Boolean(
        matchBase &&
          (matchBase.recomposicao === true ||
            ['SIM', 'S', 'TRUE'].includes(String(matchBase.recomposicao || '').toUpperCase()))
      ),
      telefoneResponsavel: matchBase
        ? String(matchBase.telefone || matchBase.contato || matchBase.celular || matchBase.whatsapp || '').trim()
        : '',
      boletimHistorico,
      reprovandoPorFaltasGlobal,
      perdidoEmFaltasExtremo,
      riscoLimiteFaltas,
      criticoNotas4Mais,
      alertaNotas1a3,
      duploCritico,
      precisaConversaConselho,
      prioridade,
      scoreGravidade,
      motivosConselho,
      aulasCompensacaoEstimadas,
      disciplinasComFaltaCritica,
      deliberacao: delibSalva
    };
  });

  return lista;
}

const BIMESTRE_META_MAP: Record<BimestreConselhoKey, { bimestre: number; label: string; tipoFechamento: string }> = {
  '1B': { bimestre: 1, label: '1º Bim', tipoFechamento: 'Conselho Primeiro Bimestre' },
  '2B': { bimestre: 2, label: '2º Bim', tipoFechamento: 'Conselho Segundo Bimestre' },
  '3B': { bimestre: 3, label: '3º Bim', tipoFechamento: 'Conselho Terceiro Bimestre' },
  '4B': { bimestre: 4, label: '4º Bim', tipoFechamento: 'Conselho Quarto Bimestre' },
  FINAL: { bimestre: 5, label: 'Final', tipoFechamento: 'Conselho Final' }
};

function localizarFechamentoNoAluno(fn: Record<string, any> | undefined, bimKey: BimestreConselhoKey): any | null {
  if (!fn || typeof fn !== 'object') return null;
  if (fn[bimKey]) return fn[bimKey];
  for (const [k, v] of Object.entries(fn)) {
    if (!v || typeof v !== 'object') continue;
    const kn = k.toUpperCase().trim();
    if (bimKey === '1B' && (kn === '1' || kn.startsWith('1B') || kn.includes('1º BIM'))) return v;
    if (bimKey === '2B' && (kn === '2' || kn.startsWith('2B') || kn.includes('2º BIM'))) return v;
    if (bimKey === '3B' && (kn === '3' || kn.startsWith('3B') || kn.includes('3º BIM'))) return v;
    if (bimKey === '4B' && (kn === '4' || kn.startsWith('4B') || kn.includes('4º BIM'))) return v;
    if (bimKey === 'FINAL' && (kn.includes('FINAL') || kn.includes('CONSELHO') || kn === 'CF')) return v;
  }
  return null;
}

export function extrairBoletimHistoricoAluno(aluno: any): BoletimBimestreResumo[] {
  const fn = aluno?.fechamento_notas || aluno?.fechamentos || aluno?.notas;
  if (!fn || typeof fn !== 'object') return [];

  const keys: BimestreConselhoKey[] = ['1B', '2B', '3B', '4B', 'FINAL'];
  const out: BoletimBimestreResumo[] = [];

  for (const key of keys) {
    const bObj = localizarFechamentoNoAluno(fn, key);
    if (!bObj || typeof bObj !== 'object') continue;

    const disciplinasRaw = bObj.disciplinas || {};
    const discLista: BoletimBimestreResumo['disciplinasResumo'] = [];
    const notasNumArr: number[] = [];
    let qtdVerm = 0;

    const entries = Array.isArray(disciplinasRaw)
      ? disciplinasRaw.map((d: any, i: number) => [String(d?.nome || d?.disciplina || `D${i + 1}`), d] as const)
      : Object.entries(disciplinasRaw);

    for (const [rawKey, rawVal] of entries) {
      if (rawVal === null || rawVal === undefined) continue;
      const valObj = typeof rawVal === 'object' ? (rawVal as any) : { nota: rawVal };
      const nome = String(valObj.nome || valObj.disciplina || rawKey).trim().toUpperCase();
      if (!nome) continue;

      const rawScore = valObj.notaNum !== undefined ? valObj.notaNum : (valObj.mencaoNota ?? valObj.nota ?? valObj.media ?? valObj.valor ?? '-');
      const parsedNota = parseNotaToken(String(rawScore ?? '-'));
      const faltas = Number(valObj.faltas || 0) || 0;
      const ac = Number(valObj.ausenciaCompensada || valObj.ac || 0) || 0;

      if (parsedNota.notaNum !== null) notasNumArr.push(parsedNota.notaNum);
      if (parsedNota.notaVermelha) qtdVerm++;

      discLista.push({
        nome,
        nomeCurto: abreviarDisciplina(nome),
        mencao: parsedNota.mencao,
        notaNum: parsedNota.notaNum,
        faltas,
        ac,
        notaVermelha: parsedNota.notaVermelha
      });
    }

    const mediaCalc =
      typeof bObj.mediaGeral === 'number'
        ? Math.round(bObj.mediaGeral * 10) / 10
        : notasNumArr.length > 0
        ? Math.round((notasNumArr.reduce((a, b) => a + b, 0) / notasNumArr.length) * 10) / 10
        : null;

    const freqBimStr = String(bObj.frequenciaBimestre ?? bObj.freqBimestre ?? '—');
    const freqAnStr = String(bObj.frequenciaTotalAno ?? bObj.freqAnual ?? freqBimStr);

    out.push({
      bimestreKey: key,
      label: BIMESTRE_META_MAP[key].label,
      mediaGeral: mediaCalc,
      freqBimestreStr: freqBimStr,
      freqAnualStr: freqAnStr,
      totalFaltasBimestre: Number(bObj.totalFaltas || 0) || 0,
      faltasTotalAno: Number(bObj.faltasTotalAno ?? bObj.totalFaltas ?? 0) || 0,
      qtdNotasVermelhas: typeof bObj.qtdAbaixoBasico === 'number' ? bObj.qtdAbaixoBasico : qtdVerm,
      disciplinasResumo: discLista
    });
  }

  return out;
}

/**
 * Sintetiza documentos de Conselho de Bimestre diretamente a partir de `alunos.fechamento_notas`
 * já importados anteriormente na escola (ex: 1º, 2º e 3º Bimestres), para turmas que ainda não
 * possuem um documento próprio salvo em `conselhos_bimestre`.
 */
export function construirConselhoTurmasDeBoletinsAlunos(
  baseAlunos: any[],
  anoLetivo: number,
  docsExistentes: ConselhoTurmaDoc[]
): ConselhoTurmaDoc[] {
  if (!Array.isArray(baseAlunos) || baseAlunos.length === 0) return [];

  const chavesExistentes = new Set(docsExistentes.map(d => d.chaveTurmaBimestre));
  const agrupado = new Map<
    string,
    {
      bimKey: BimestreConselhoKey;
      turmaNorm: string;
      turmaOrig: string;
      totalAulasDadas: number;
      totalAulasDadasEletiva: number;
      atualizadoEm: string;
      discMap: Map<string, DisciplinaMapaoDef>;
      alunosRaw: AlunoMapaoExtraido[];
    }
  >();

  const bimKeys: BimestreConselhoKey[] = ['1B', '2B', '3B', '4B', 'FINAL'];

  for (const al of baseAlunos) {
    if (!al || !al.nome) continue;
    const turmaBruta = String(al.turma || al.serie || '').trim();
    if (!turmaBruta) continue;
    const turmaNorm = normalizarTurmaMapao(turmaBruta);
    if (!turmaNorm || turmaNorm === 'TURMA NÃO IDENTIFICADA') continue;

    const fn = al.fechamento_notas || al.fechamentos || al.notas;
    if (!fn || typeof fn !== 'object') continue;

    for (const bimKey of bimKeys) {
      const chaveTurmaBimestre = gerarChaveTurmaBimestre(anoLetivo, bimKey, turmaNorm);
      if (chavesExistentes.has(chaveTurmaBimestre)) continue;

      const bObj = localizarFechamentoNoAluno(fn, bimKey);
      if (!bObj || typeof bObj !== 'object' || !bObj.disciplinas) continue;

      // Respeitar anoLetivo se especificado no fechamento
      const anoDoc = Number(bObj.anoLetivo);
      if (anoDoc && anoDoc !== anoLetivo) continue;

      let bucket = agrupado.get(chaveTurmaBimestre);
      if (!bucket) {
        bucket = {
          bimKey,
          turmaNorm,
          turmaOrig: String(bObj.turmaOriginal || turmaBruta),
          totalAulasDadas: Number(bObj.totalAulasDadas || 0) || 0,
          totalAulasDadasEletiva: Number(bObj.totalAulasDadasEletiva || 0) || 0,
          atualizadoEm: String(bObj.atualizadoEm || new Date().toISOString()),
          discMap: new Map(),
          alunosRaw: []
        };
        agrupado.set(chaveTurmaBimestre, bucket);
      }

      if (!bucket.totalAulasDadas && bObj.totalAulasDadas) {
        bucket.totalAulasDadas = Number(bObj.totalAulasDadas) || 0;
      }

      const disciplinesAluno: Record<string, NotaDisciplinaMapao> = {};
      const notasNum: number[] = [];
      const notasVermelhas: AlunoMapaoExtraido['notasVermelhas'] = [];
      let totalAC = 0;
      let numChamadaExtraido = Number(al.numero || al.chamada || 0) || 0;

      const entries = Array.isArray(bObj.disciplinas)
        ? bObj.disciplinas.map((d: any, i: number) => [String(d?.nome || d?.disciplina || `D${i + 1}`), d] as const)
        : Object.entries(bObj.disciplinas);

      for (const [rawK, rawV] of entries) {
        if (rawV === null || rawV === undefined) continue;
        const vObj = typeof rawV === 'object' ? (rawV as any) : { nota: rawV };
        const nomeDisc = String(vObj.nome || vObj.disciplina || rawK).trim().toUpperCase();
        if (!nomeDisc) continue;
        if (!numChamadaExtraido && vObj.numChamada) numChamadaExtraido = Number(vObj.numChamada) || 0;

        const cod = String(vObj.codigo || '').trim() || `D_${nomeDisc.slice(0, 4)}`;
        const curto = abreviarDisciplina(nomeDisc);
        const rawScore = vObj.mencaoNota ?? (vObj.notaNum !== undefined && vObj.notaNum !== null ? vObj.notaNum : vObj.nota ?? vObj.media ?? '-');
        const parsedNota = parseNotaToken(String(rawScore ?? '-'));
        const faltas = Number(vObj.faltas || 0) || 0;
        const ac = Number(vObj.ausenciaCompensada || vObj.ac || 0) || 0;
        const aulasDisc = vObj.aulasDadas ? Number(vObj.aulasDadas) : null;
        totalAC += ac;

        if (!bucket.discMap.has(nomeDisc)) {
          bucket.discMap.set(nomeDisc, {
            codigo: cod,
            nome: nomeDisc,
            nomeCurto: curto,
            aulasDadas: aulasDisc
          });
        }

        if (parsedNota.notaNum !== null) notasNum.push(parsedNota.notaNum);
        const isVerm = parsedNota.notaVermelha || vObj.abaixoBasico === true;
        if (isVerm) {
          notasVermelhas.push({
            codigo: cod,
            nome: nomeDisc,
            nomeCurto: curto,
            mencao: parsedNota.mencao,
            notaNum: parsedNota.notaNum
          });
        }

        disciplinesAluno[nomeDisc] = {
          codigo: cod,
          nome: nomeDisc,
          nomeCurto: curto,
          mencao: parsedNota.mencao,
          notaNum: parsedNota.notaNum,
          faltas,
          ausenciaCompensada: ac,
          aulasDadas: aulasDisc,
          notaVermelha: isVerm
        };
      }

      const rawFreBim = String(bObj.frequenciaBimestre ?? '—').trim();
      const freqBimNum = parsePercentToken(rawFreBim);
      const freqBimStr = freqBimNum !== null ? `${freqBimNum}%` : rawFreBim;

      const rawFreAn = String(bObj.frequenciaTotalAno ?? al.frequencia_atual ?? al.presenca_anual ?? rawFreBim).trim();
      const freqAnNum = parsePercentToken(rawFreAn);
      const freqAnStr = freqAnNum !== null ? `${freqAnNum}%` : rawFreAn;

      const statusUpper = String(al.status || bObj.situacao || 'Ativo').trim();
      const isAtivo = !/TRANSFER|BAIXA|ABANDONO|INATIVO|REMANEJ|FALEC/i.test(statusUpper);

      const mediaGlobal =
        typeof bObj.mediaGeral === 'number'
          ? Math.round(bObj.mediaGeral * 10) / 10
          : notasNum.length > 0
          ? Math.round((notasNum.reduce((a, b) => a + b, 0) / notasNum.length) * 10) / 10
          : null;

      bucket.alunosRaw.push({
        numChamada: numChamadaExtraido,
        nome: String(al.nome).trim().toUpperCase(),
        situacao: isAtivo ? 'Ativo' : statusUpper,
        isAtivo,
        disciplinas: disciplinesAluno,
        totalFaltasBimestre: Number(bObj.totalFaltas || 0) || 0,
        freqBimestreStr: freqBimStr,
        freqBimestreNum: freqBimNum,
        faltasTotalAno: Number(bObj.faltasTotalAno ?? bObj.totalFaltas ?? 0) || 0,
        freqAnualStr: freqAnStr,
        freqAnualNum: freqAnNum,
        totalAusenciasCompensadas: totalAC,
        mediaGlobalNotas: mediaGlobal,
        qtdNotasVermelhas: notasVermelhas.length,
        notasVermelhas
      });
    }
  }

  const sintetizados: ConselhoTurmaDoc[] = [];

  for (const [chaveTurmaBimestre, b] of agrupado.entries()) {
    if (b.alunosRaw.length === 0) continue;

    // Ordenar e preencher numChamada sequencial caso não exista no boletim
    b.alunosRaw.sort((a, c) => {
      if (a.numChamada && c.numChamada && a.numChamada !== c.numChamada) return a.numChamada - c.numChamada;
      return a.nome.localeCompare(c.nome, 'pt-BR');
    });
    b.alunosRaw.forEach((al, idx) => {
      if (!al.numChamada) al.numChamada = idx + 1;
    });

    const metaBim = BIMESTRE_META_MAP[b.bimKey];
    const isEM = b.turmaNorm.includes('SÉRIE') || b.turmaNorm.includes('SERIE');

    sintetizados.push({
      docId: chaveTurmaBimestre,
      chaveTurmaBimestre,
      origemDados: 'BOLETIM_SISTEMA',
      metadata: {
        anoLetivo,
        diretoria: 'São Bernardo do Campo',
        escola: 'EE Prof. Clóvis de Lucca',
        tipoEnsino: isEM ? 'Ensino Médio' : 'Ensino Fundamental - Anos Finais',
        turmaOriginal: b.turmaOrig,
        turmaNormalizada: b.turmaNorm,
        tipoFechamento: `${metaBim.tipoFechamento} (Boletim Integrado)`,
        bimestre: metaBim.bimestre,
        bimestreKey: b.bimKey,
        totalAulasDadas: b.totalAulasDadas,
        totalAulasDadasEletiva: b.totalAulasDadasEletiva,
        diretor: '',
        goe: '',
        disciplinas: Array.from(b.discMap.values()),
        arquivoOrigem: 'Boletim Integrado (fechamento_notas)'
      },
      alunosRaw: b.alunosRaw,
      deliberacoes: {},
      importadoPor: 'Sincronização Automática de Boletins',
      importadoEm: b.atualizadoEm,
      atualizadoEm: b.atualizadoEm
    });
  }

  return sintetizados;
}

/**
 * Sugere opções oficiais de Turma do Ano Seguinte para o Conselho Final
 */
export function sugerirTurmasAnoSeguinte(
  turmaAtual: string,
  resultadoFinal?: ResultadoFinalConselho
): { sugestaoPrincipal: string; opcoes: string[] } {
  const norm = normalizarTurmaMapao(turmaAtual);
  const m = norm.match(/^(\d)\s*[ºª]?\s*(?:ANO|SÉRIE|SERIE)?\s*([A-Z])$/);
  const letras = ['A', 'B', 'C', 'D', 'E'];

  if (resultadoFinal === 'TRANSFERIDO_BAIXA') {
    return {
      sugestaoPrincipal: 'Transferido / Baixa',
      opcoes: ['Transferido / Baixa']
    };
  }

  if (!m) {
    return {
      sugestaoPrincipal: norm,
      opcoes: [norm, 'CONCLUINTE / FORMADO (EM)', 'Transferido / Baixa']
    };
  }

  const num = parseInt(m[1], 10);
  const letra = m[2];
  const isEM = norm.includes('SÉRIE') || norm.includes('SERIE') || num <= 3;
  const isRetido =
    resultadoFinal === 'REPROVADO_NOTA' ||
    resultadoFinal === 'REPROVADO_FALTA' ||
    resultadoFinal === 'REPROVADO_AMBOS';

  const montarSerie = (n: number, em: boolean): string[] =>
    letras.map(l => (em ? `${n}ª SÉRIE ${l}` : `${n}º ANO ${l}`));

  const mesmasTurmas = montarSerie(num, isEM);

  let proximasTurmas: string[] = [];
  let sugestaoAprovado = '';

  if (!isEM) {
    if (num < 9) {
      proximasTurmas = montarSerie(num + 1, false);
      sugestaoAprovado = `${num + 1}º ANO ${letra}`;
    } else {
      proximasTurmas = montarSerie(1, true);
      sugestaoAprovado = `1ª SÉRIE ${letra}`;
    }
  } else {
    if (num < 3) {
      proximasTurmas = montarSerie(num + 1, true);
      sugestaoAprovado = `${num + 1}ª SÉRIE ${letra}`;
    } else {
      proximasTurmas = ['CONCLUINTE / FORMADO (EM)'];
      sugestaoAprovado = 'CONCLUINTE / FORMADO (EM)';
    }
  }

  const opcoesUnicas = Array.from(
    new Set(
      isRetido
        ? [...mesmasTurmas, ...proximasTurmas, 'Transferido / Baixa']
        : [...proximasTurmas, ...mesmasTurmas, 'Transferido / Baixa']
    )
  );

  return {
    sugestaoPrincipal: isRetido ? norm : sugestaoAprovado,
    opcoes: opcoesUnicas
  };
}

export function resumirEstatisticasTurma(alunos: AlunoConselhoClassificado[]) {
  const ativos = alunos.filter(a => a.isAtivo);
  const transferidos = alunos.filter(a => !a.isAtivo);
  const reprovandoFaltas = ativos.filter(a => a.reprovandoPorFaltasGlobal);
  const criticosNotas4Mais = ativos.filter(a => a.criticoNotas4Mais);
  const duplosCriticos = ativos.filter(a => a.duploCritico);
  const casosAEE = ativos.filter(a => a.isAEE);
  const casosAEEComAlerta = casosAEE.filter(a => a.reprovandoPorFaltasGlobal || a.qtdNotasVermelhas > 0 || a.riscoLimiteFaltas);
  const pautaConselho = ativos.filter(a => a.precisaConversaConselho);
  const regulares = ativos.filter(a => !a.precisaConversaConselho);
  const deliberados = pautaConselho.filter(a => a.deliberacao.status !== 'PENDENTE');

  const freqsAnuais = ativos.map(a => a.freqAnualNum).filter((v): v is number => v !== null);
  const mediaFreqAnual =
    freqsAnuais.length > 0 ? Math.round((freqsAnuais.reduce((s, n) => s + n, 0) / freqsAnuais.length) * 10) / 10 : null;

  const mediasNotas = ativos.map(a => a.mediaGlobalNotas).filter((v): v is number => v !== null);
  const mediaNotasTurma =
    mediasNotas.length > 0 ? Math.round((mediasNotas.reduce((s, n) => s + n, 0) / mediasNotas.length) * 10) / 10 : null;

  const totalAC = ativos.reduce((acc, a) => acc + a.totalAusenciasCompensadas, 0);

  // Estatísticas de Conselho Final e Enturmação do Ano Seguinte
  let aprovadosCount = 0;
  let aprovadosConselhoCount = 0;
  let reprovadosCount = 0;
  let pendentesFinalCount = 0;
  const destinoTurmasMap: Record<string, number> = {};

  ativos.forEach(a => {
    const rf = a.deliberacao.resultadoFinal;
    if (rf === 'APROVADO') aprovadosCount++;
    else if (rf === 'APROVADO_CONSELHO') aprovadosConselhoCount++;
    else if (rf === 'REPROVADO_FALTA' || rf === 'REPROVADO_NOTA' || rf === 'REPROVADO_AMBOS') reprovadosCount++;
    else if (rf !== 'TRANSFERIDO_BAIXA') pendentesFinalCount++;

    const dest = String(a.deliberacao.turmaAnoSeguinte || '').trim();
    if (dest) {
      destinoTurmasMap[dest] = (destinoTurmasMap[dest] || 0) + 1;
    }
  });

  return {
    totalRegistros: alunos.length,
    totalAtivos: ativos.length,
    totalTransferidos: transferidos.length,
    reprovandoFaltasCount: reprovandoFaltas.length,
    criticosNotas4MaisCount: criticosNotas4Mais.length,
    duplosCriticosCount: duplosCriticos.length,
    casosAEECount: casosAEE.length,
    casosAEEComAlertaCount: casosAEEComAlerta.length,
    pautaConselhoCount: pautaConselho.length,
    regularesCount: regulares.length,
    deliberadosCount: deliberados.length,
    aprovadosCount,
    aprovadosConselhoCount,
    reprovadosCount,
    pendentesFinalCount,
    destinoTurmasMap,
    mediaFreqAnual,
    mediaNotasTurma,
    totalAC
  };
}

export function ordenarTurmasEscolar(turmas: string[]): string[] {
  const rank = (t: string): [number, number, string] => {
    const norm = normalizarTurmaMapao(t);
    const m = norm.match(/^(\d).*?([A-Z])$/);
    if (!m) return [9, 99, norm];
    const num = parseInt(m[1], 10);
    const letra = m[2];
    const isEM = norm.includes('SÉRIE') || norm.includes('SERIE') || num <= 3;
    return [isEM ? 2 : 1, num, letra];
  };
  return [...turmas].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return ra[2].localeCompare(rb[2], 'pt-BR');
  });
}

export const DELIBERACAO_LABELS: Record<StatusDeliberacaoConselho, string> = {
  PENDENTE: 'Pendente de Pauta',
  EM_PAUTA: 'Em Discussão no Conselho',
  COMPENSACAO_AUSENCIAS: 'Compensação de Ausências / Reposição',
  RECUPERACAO_INTENSIVA: 'Recuperação Intensiva',
  PLANO_AEE: 'Plano AEE / Adaptação Curricular',
  ACOMPANHAMENTO_TUTORIA: 'Acompanhamento de Tutoria e Família',
  APROVADO_CONSELHO: 'Aprovado / Promovido pelo Conselho',
  RETENCAO_PREVISTA: 'Risco de Retenção Confirmado'
};

export const RESULTADO_FINAL_LABELS: Record<ResultadoFinalConselho, string> = {
  PENDENTE: 'A definir no Conselho',
  APROVADO: 'Aprovado (Promovido)',
  APROVADO_CONSELHO: 'Aprovado pelo Conselho',
  REPROVADO_NOTA: 'Reprovado por Rendimento',
  REPROVADO_FALTA: 'Reprovado por Faltas',
  REPROVADO_AMBOS: 'Reprovado (Nota e Faltas)',
  TRANSFERIDO_BAIXA: 'Transferido / Baixa'
};

export const PRIORIDADE_LABELS: Record<PrioridadeConselho, string> = {
  URGENTE_DUPLO: 'Crítico Duplo (Faltas + 4+ Verm.)',
  CRITICO_FALTAS: 'Reprovando por Faltas (< 75%)',
  CRITICO_NOTAS: '4+ Notas Vermelhas',
  FOCO_AEE: 'Foco AEE (Educação Especial)',
  ATENCAO_CONSELHO: 'Conversar no Conselho',
  REGULAR: 'Situação Regular',
  INATIVO: 'Transferido / Inativo'
};
