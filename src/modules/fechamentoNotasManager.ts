/**
 * Módulo de Fechamento de Rendimento Escolar & Notas Bimestrais (SED)
 * E.E. Professor Clóvis de Lucca
 * 
 * Permite importar e processar relatórios e planilhas oficiais de fechamento
 * bimestral da SED (Conselho 1º e 2º Bimestres) via Excel (.xlsx), PDF (.pdf) ou texto.
 * Realiza o cruzamento e vinculação automática com a base de estudantes sem necessidade de RA,
 * utilizando pareamento inteligente por Turma + Nome Completo e tolerância a variações ortográficas.
 */

import { doc, writeBatch, db } from '../lib/database';
import { garantirBibliotecaDisponivel } from '../utils';

export type BimestrePeriodoKey = '1B' | '2B' | '3B' | '4B' | 'FINAL';

export interface DisciplinaFechamento {
  nome: string;
  codigo?: string;
  mencaoNota: string;
  notaNum: number | null;
  faltas: number;
  ausenciaCompensada: number;
  numChamada?: number;
  abaixoBasico: boolean;
}

export interface AlunoFechamentoParsed {
  nome: string;
  situacao: string;
  disciplinas: Record<string, DisciplinaFechamento>;
  totalFaltas: number;
  frequenciaBimestre: string;
  faltasTotalAno?: number;
  frequenciaTotalAno?: string;
  mediaGeral: number | null;
  qtdAbaixoBasico: number;
}

export interface MetadataFechamento {
  anoLetivo: number;
  turmaOriginal: string;
  turmaNormalizada: string;
  tipoFechamento: string;
  bimestre: number; // 1, 2, 3, 4, ou 5 (Fechamento Final)
  bimestreKey: BimestrePeriodoKey;
  totalAulasDadas: number;
  totalAulasDadasEletiva?: number;
  disciplinasDetectadas: string[];
}

export interface ParsedFechamentoResult {
  metadata: MetadataFechamento;
  alunos: AlunoFechamentoParsed[];
}

export interface VinculoAlunoResult {
  alunoParsed: AlunoFechamentoParsed;
  alunoBase: any | null;
  tipoVinculo: 'turma_e_nome' | 'apenas_nome' | 'aproximado' | 'nao_encontrado';
  confianca: number;
  raSugerido: string | null;
  turmaBase: string | null;
  manualOverrideRa?: string;
}

// ----------------------------------------------------
// Normalizadores de Texto
// ----------------------------------------------------

export function normalizarNome(nome: string): string {
  if (!nome) return '';
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '') // remove pontuação
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarTurma(turma: string): string {
  if (!turma) return '';
  const str = String(turma)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  // Procura padrões como "6° ANO A", "6º ANO A", "6A", "1ª SERIE A", "1A"
  const match = str.match(/([1-9]|1[0-2])\s*(?:º|°|O|A|ª)?\s*(?:ANO|SERIE)?\s*([A-Z])/i);
  if (match) {
    return `${match[1]}${match[2]}`.toUpperCase();
  }

  return str.replace(/[^A-Z0-9]/g, '');
}

export function detectarBimestreTexto(
  texto: string,
  padrao: number | string = 1
): { bimestre: number; bimestreKey: BimestrePeriodoKey; tipo: string } {
  const t = (texto || '').toUpperCase();

  // 1. Detecção de Fechamento Final / Conselho de Classe Final / Anual
  if (
    t.includes('CONSELHO FINAL') ||
    t.includes('FECHAMENTO FINAL') ||
    t.includes('RENDIMENTO FINAL') ||
    t.includes('RESULTADO FINAL') ||
    t.includes('ENCERRAMENTO ANUAL') ||
    t.includes('FECHAMENTO ANUAL') ||
    t.includes('CONSELHO DE CLASSE FINAL') ||
    t.includes('FINAL') ||
    t.includes('ANUAL')
  ) {
    return { bimestre: 5, bimestreKey: 'FINAL', tipo: 'Fechamento Final / Conselho de Classe Final' };
  }

  // 2. Detecção dos 4 bimestres
  if (t.includes('QUARTO BIMESTRE') || t.includes('4º BIMESTRE') || t.includes('4° BIMESTRE') || t.includes('4B') || t.includes('4ºB')) {
    return { bimestre: 4, bimestreKey: '4B', tipo: 'Conselho Quarto Bimestre' };
  }
  if (t.includes('TERCEIRO BIMESTRE') || t.includes('3º BIMESTRE') || t.includes('3° BIMESTRE') || t.includes('3B') || t.includes('3ºB')) {
    return { bimestre: 3, bimestreKey: '3B', tipo: 'Conselho Terceiro Bimestre' };
  }
  if (t.includes('SEGUNDO BIMESTRE') || t.includes('2º BIMESTRE') || t.includes('2° BIMESTRE') || t.includes('2B') || t.includes('2ºB')) {
    return { bimestre: 2, bimestreKey: '2B', tipo: 'Conselho Segundo Bimestre' };
  }
  if (t.includes('PRIMEIRO BIMESTRE') || t.includes('1º BIMESTRE') || t.includes('1° BIMESTRE') || t.includes('1B') || t.includes('1ºB')) {
    return { bimestre: 1, bimestreKey: '1B', tipo: 'Conselho Primeiro Bimestre' };
  }

  // 3. Caso não detectado no texto, usa o padrão informado pelo usuário
  if (String(padrao).toUpperCase() === 'FINAL' || padrao === 5 || padrao === '5') {
    return { bimestre: 5, bimestreKey: 'FINAL', tipo: 'Fechamento Final / Conselho de Classe Final' };
  }

  const bimNum = typeof padrao === 'number' ? padrao : parseInt(String(padrao), 10);
  if (bimNum === 4) return { bimestre: 4, bimestreKey: '4B', tipo: 'Conselho Quarto Bimestre' };
  if (bimNum === 3) return { bimestre: 3, bimestreKey: '3B', tipo: 'Conselho Terceiro Bimestre' };
  if (bimNum === 2) return { bimestre: 2, bimestreKey: '2B', tipo: 'Conselho Segundo Bimestre' };
  if (bimNum === 5) return { bimestre: 5, bimestreKey: 'FINAL', tipo: 'Fechamento Final / Conselho de Classe Final' };

  return { bimestre: 1, bimestreKey: '1B', tipo: 'Conselho Primeiro Bimestre' };
}

// ----------------------------------------------------
// Disciplinas Padrão da SED (Ensino Fundamental e Médio)
// ----------------------------------------------------
export const DISCIPLINAS_PADRAO_FUNDAMENTAL = [
  'ARTE',
  'CIENCIAS',
  'EDUCACAO FISICA',
  'ELETIVAS',
  'GEOGRAFIA',
  'HISTORIA',
  'LINGUA INGLESA',
  'LINGUA PORTUGUESA',
  'MATEMATICA',
  'ORIENTAÇAO DE ESTUDO - LINGUA PORTUGUESA',
  'ORIENTAÇAO DE ESTUDO - MATEMATICA',
  'PROJETO DE VIDA',
  'REDAÇAO E LEITURA',
  'TECNOLOGIA E INOVACAO'
];

export function limparNomeDisciplina(nomeCru: string): string {
  if (!nomeCru) return '';
  let s = String(nomeCru);

  // 1. Remove códigos numéricos entre parênteses ou colchetes em qualquer posição: ex "(1813)", "[1813]"
  s = s.replace(/\s*[\(\[]\s*\d+\s*[\)\]]\s*/g, ' ');

  // 2. Remove códigos numéricos no final do nome (ex: "ARTE 1813", "MATEMATICA - 1811", "CIENCIAS / 1814", "HISTORIA #1812")
  // Executa em loop caso haja mais de um código numérico no final
  while (/[\s\-_–—/|#:]+\d+\s*$/i.test(s)) {
    s = s.replace(/[\s\-_–—/|#:]+\d+\s*$/i, '');
  }

  // 3. Caso números estejam grudados no final após letras (ex: "ARTE1813")
  s = s.replace(/([A-Za-zÀ-ÿ])\d{3,6}\s*$/g, '$1');

  // 4. Normalizar espaços em branco e caixa alta
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}


function parseNotaValor(valor: any): { mencaoNota: string; notaNum: number | null; abaixoBasico: boolean } {
  if (valor === undefined || valor === null) {
    return { mencaoNota: '—', notaNum: null, abaixoBasico: false };
  }
  const str = String(valor).trim().toUpperCase();
  if (!str || str === '-' || str === '—' || str === 'SEM NOTA') {
    return { mencaoNota: '—', notaNum: null, abaixoBasico: false };
  }

  // Tentar parse numérico
  const numClean = str.replace(',', '.');
  const num = parseFloat(numClean);
  if (!isNaN(num)) {
    return {
      mencaoNota: num.toFixed(1).replace('.0', ''),
      notaNum: Math.round(num * 10) / 10,
      abaixoBasico: num < 5.0
    };
  }

  // Menções alfabéticas
  const isAbaixo = str === 'I' || str === 'EP' || str === 'INSUFICIENTE';
  return {
    mencaoNota: str,
    notaNum: null,
    abaixoBasico: isAbaixo
  };
}

// ----------------------------------------------------
// Parser para Excel (.xlsx / .xls)
// ----------------------------------------------------
export async function parseFechamentoExcel(
  arrayBuffer: ArrayBuffer,
  options: { bimestrePadrao?: number | string; turmaPadrao?: string } = {}
): Promise<ParsedFechamentoResult> {
  let XLSX = (window as any).XLSX;
  if (!XLSX) {
    try {
      XLSX = await garantirBibliotecaDisponivel('XLSX');
    } catch (e) {
      throw new Error('Biblioteca XLSX (SheetJS) não está disponível no momento.');
    }
  }

  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('A planilha está vazia ou ilegível.');
  }

  let anoLetivo = 2026;
  let turmaOriginal = options.turmaPadrao || '';
  let tipoFechamento = '';
  let totalAulasDadas = 0;
  let totalAulasDadasEletiva = 0;

  // 1. Varrer primeiras 15 linhas procurando cabeçalho
  let headerRowIndex = -1;
  let subheaderRowIndex = -1;

  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const rowStr = rawRows[r].map(c => String(c)).join(' ');

    const matchAno = rowStr.match(/Ano\s*Letivo:\s*(\d{4})/i);
    if (matchAno) anoLetivo = parseInt(matchAno[1], 10);

    const matchTurma = rowStr.match(/Turma:\s*([^–\n\r]+)/i);
    if (matchTurma && !turmaOriginal) {
      turmaOriginal = matchTurma[1].trim();
    }

    const matchTipo = rowStr.match(/Tipo\s*Fechamento:\s*([^–\n\r]+)/i);
    if (matchTipo) {
      tipoFechamento = matchTipo[1].trim();
    }

    const matchAulas = rowStr.match(/Total\s*de\s*Aulas\s*Dadas:\s*(\d+)/i);
    if (matchAulas) totalAulasDadas = parseInt(matchAulas[1], 10);

    const matchEletiva = rowStr.match(/Total\s*de\s*Aulas\s*Dadas\s*Eletiva:\s*(\d+)/i);
    if (matchEletiva) totalAulasDadasEletiva = parseInt(matchEletiva[1], 10);

    // Identificar linha das disciplinas (contém ARTE, MATEMATICA, etc.)
    const upperRow = rowStr.toUpperCase();
    if (
      (upperRow.includes('ARTE') || upperRow.includes('CIENCIAS') || upperRow.includes('MATEMATICA')) &&
      headerRowIndex === -1
    ) {
      headerRowIndex = r;
    }

    // Identificar linha do subheader (contém ALUNO, SIT, Nº, M, F, AC)
    if (
      (upperRow.includes('ALUNO') && upperRow.includes('SIT')) ||
      (upperRow.includes('Nº') && upperRow.includes('M') && upperRow.includes('F'))
    ) {
      subheaderRowIndex = r;
    }
  }

  // Determinar bimestre ou fechamento final
  const bimInfo = detectarBimestreTexto(tipoFechamento || sheetName, options.bimestrePadrao || 1);
  const bimestre = bimInfo.bimestre;
  const bimestreKey = bimInfo.bimestreKey;
  if (!tipoFechamento) tipoFechamento = bimInfo.tipo;

  // Extrair disciplinas
  const disciplinasDetectadas: { nome: string; colStart: number }[] = [];
  if (headerRowIndex !== -1) {
    const discRow = rawRows[headerRowIndex];
    for (let c = 2; c < discRow.length; c++) {
      const val = discRow[c];
      if (val && typeof val === 'string' && val.trim()) {
        const limpo = limparNomeDisciplina(val);
        if (limpo && limpo !== 'TOTAL' && limpo !== 'SIT' && limpo !== 'ALUNO') {
          disciplinasDetectadas.push({ nome: limpo, colStart: c });
        }
      }
    }
  }

  // Se não detectou disciplinas por cabeçalho, usa o padrão SED Fundamental
  if (disciplinasDetectadas.length === 0) {
    let col = 2;
    for (const disc of DISCIPLINAS_PADRAO_FUNDAMENTAL) {
      disciplinasDetectadas.push({ nome: disc, colStart: col });
      col += 4; // Nº, M, F, AC
    }
  }

  // 2. Extrair Estudantes
  const alunosParsed: AlunoFechamentoParsed[] = [];
  const startRow = Math.max(headerRowIndex, subheaderRowIndex) + 1;

  for (let r = startRow; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const nomeCandidate = String(row[0] || '').trim();
    if (!nomeCandidate || nomeCandidate.toUpperCase().includes('TOTAL') || nomeCandidate.toUpperCase() === 'ALUNO') {
      continue;
    }

    // Situação na col 1
    const situacao = String(row[1] || 'Ativo').trim();

    // Dicionário de disciplinas do aluno
    const disciplinas: Record<string, DisciplinaFechamento> = {};
    const notasValidas: number[] = [];
    let qtdAbaixoBasico = 0;

    for (let d = 0; d < disciplinasDetectadas.length; d++) {
      const disc = disciplinasDetectadas[d];
      const colBase = disc.colStart;

      const numChamada = parseInt(String(row[colBase] || '0'), 10) || undefined;
      const rawNota = row[colBase + 1];
      const faltas = parseInt(String(row[colBase + 2] || '0'), 10) || 0;
      const ac = parseInt(String(row[colBase + 3] || '0'), 10) || 0;

      const notaInfo = parseNotaValor(rawNota);
      if (notaInfo.notaNum !== null) {
        notasValidas.push(notaInfo.notaNum);
      }
      if (notaInfo.abaixoBasico) {
        qtdAbaixoBasico++;
      }

      disciplinas[disc.nome] = {
        nome: disc.nome,
        mencaoNota: notaInfo.mencaoNota,
        notaNum: notaInfo.notaNum,
        faltas,
        ausenciaCompensada: ac,
        numChamada,
        abaixoBasico: notaInfo.abaixoBasico
      };
    }

    // Colunas de Total no final
    // TF | Fre(%) | FTAn | Fre An(%)
    const lastColIndex = row.length - 1;
    let totalFaltas = 0;
    let frequenciaBimestre = '—';
    let faltasTotalAno: number | undefined = undefined;
    let frequenciaTotalAno: string | undefined = undefined;

    // Busca colunas de total a partir do final ou da última disciplina
    for (let c = row.length - 4; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (val.includes('%')) {
        if (frequenciaBimestre === '—') {
          frequenciaBimestre = val;
        } else {
          frequenciaTotalAno = val;
        }
      } else {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
          if (totalFaltas === 0) {
            totalFaltas = num;
          } else if (faltasTotalAno === undefined) {
            faltasTotalAno = num;
          }
        }
      }
    }

    // Se totalFaltas não foi localizado na linha, soma das disciplinas
    if (totalFaltas === 0) {
      totalFaltas = Object.values(disciplinas).reduce((acc, d) => acc + (d.faltas || 0), 0);
    }

    const mediaGeral = notasValidas.length > 0
      ? Math.round((notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length) * 10) / 10
      : null;

    alunosParsed.push({
      nome: nomeCandidate,
      situacao,
      disciplinas,
      totalFaltas,
      frequenciaBimestre,
      faltasTotalAno,
      frequenciaTotalAno,
      mediaGeral,
      qtdAbaixoBasico
    });
  }

  return {
    metadata: {
      anoLetivo,
      turmaOriginal: turmaOriginal || 'Turma Não Especificada',
      turmaNormalizada: normalizarTurma(turmaOriginal),
      tipoFechamento,
      bimestre,
      bimestreKey,
      totalAulasDadas,
      totalAulasDadasEletiva,
      disciplinasDetectadas: disciplinasDetectadas.map(d => d.nome)
    },
    alunos: alunosParsed
  };
}

// ----------------------------------------------------
// Parser para PDF Oficial da SED (Registro de Rendimento)
// ----------------------------------------------------
export async function parseFechamentoPDF(
  arrayBuffer: ArrayBuffer,
  options: { bimestrePadrao?: number | string; turmaPadrao?: string } = {}
): Promise<ParsedFechamentoResult> {
  let pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    try {
      pdfjsLib = await garantirBibliotecaDisponivel('pdfjsLib');
    } catch (e) {
      throw new Error('Biblioteca PDF.js não carregada a tempo. Você pode também usar a planilha Excel (.xlsx) ou colar os dados.');
    }
  }

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    
    // Agrupar itens por linha baseando-se na coordenada Y
    const items = content.items as Array<{ str: string; transform: number[] }>;
    // Ordenar itens por Y decrescente (topo para baixo) e X crescente (esquerda para direita)
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 3) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    let currentY = -9999;
    let pageLines: string[] = [];
    let currentLine = '';

    for (const item of items) {
      const y = Math.round(item.transform[5]);
      if (Math.abs(y - currentY) > 4) {
        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }
        currentY = y;
        currentLine = item.str;
      } else {
        currentLine += ' ' + item.str;
      }
    }
    if (currentLine.trim()) {
      pageLines.push(currentLine.trim());
    }

    fullText += '\n' + pageLines.join('\n');
  }

  return parseFechamentoTexto(fullText, options);
}

// ----------------------------------------------------
// Parser de Texto (Extraído do PDF ou Colado pelo Usuário)
// ----------------------------------------------------
export function parseFechamentoTexto(
  texto: string,
  options: { bimestrePadrao?: number | string; turmaPadrao?: string } = {}
): ParsedFechamentoResult {
  if (!texto || !texto.trim()) {
    throw new Error('O conteúdo para processamento está vazio.');
  }

  let anoLetivo = 2026;
  let turmaOriginal = options.turmaPadrao || '';
  let tipoFechamento = '';
  let totalAulasDadas = 0;
  let totalAulasDadasEletiva = 0;

  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Extrair metadados do cabeçalho
  for (const l of linhas) {
    const matchAno = l.match(/Ano\s*Letivo:\s*(\d{4})/i);
    if (matchAno) anoLetivo = parseInt(matchAno[1], 10);

    const matchTurma = l.match(/Turma:\s*([^–\n\r]+)/i);
    if (matchTurma && !turmaOriginal) {
      turmaOriginal = matchTurma[1].trim();
    }

    const matchTipo = l.match(/Tipo\s*Fechamento:\s*([^–\n\r]+)/i);
    if (matchTipo) {
      tipoFechamento = matchTipo[1].trim();
    }

    const matchAulas = l.match(/Total\s*de\s*Aulas\s*Dadas:\s*(\d+)/i);
    if (matchAulas) totalAulasDadas = parseInt(matchAulas[1], 10);

    const matchEletiva = l.match(/Total\s*de\s*Aulas\s*Dadas\s*Eletiva:\s*(\d+)/i);
    if (matchEletiva) totalAulasDadasEletiva = parseInt(matchEletiva[1], 10);
  }

  const bimInfo = detectarBimestreTexto(tipoFechamento || texto, options.bimestrePadrao || 1);
  const bimestre = bimInfo.bimestre;
  const bimestreKey = bimInfo.bimestreKey;
  if (!tipoFechamento) tipoFechamento = bimInfo.tipo;

  // Disciplinas detectadas
  const disciplinasDetectadas = [...DISCIPLINAS_PADRAO_FUNDAMENTAL];

  // Regex para linha de estudante:
  // [Nome do Aluno] (Ativo|Transferido|Abandono|Inativo) [tokens de notas e faltas...]
  const statusKeywords = ['Ativo', 'Transferido', 'Inativo', 'Abandono', 'Falecido', 'Não Compareceu'];
  const statusRegex = new RegExp(`\\b(${statusKeywords.join('|')})\\b`, 'i');

  const alunosParsed: AlunoFechamentoParsed[] = [];

  for (const linha of linhas) {
    // Ignorar linhas de cabeçalho
    if (
      linha.includes('Registro e Controle') ||
      linha.includes('Secretaria da Educação') ||
      linha.includes('Tipo de Ensino:') ||
      linha.includes('ALUNO SIT') ||
      linha.startsWith('Nº M F AC') ||
      linha.includes('Total de Aulas Dadas') ||
      linha.includes('Total Geral')
    ) {
      continue;
    }

    const matchStatus = linha.match(statusRegex);
    if (!matchStatus || matchStatus.index === undefined) {
      continue;
    }

    const idxStatus = matchStatus.index;
    const nomeAluno = linha.substring(0, idxStatus).trim();
    const situacao = matchStatus[1];
    const restoLinha = linha.substring(idxStatus + matchStatus[0].length).trim();

    // Nome deve ter pelo menos duas palavras e caracteres válidos
    if (!nomeAluno || nomeAluno.split(' ').length < 2 || /\d/.test(nomeAluno)) {
      continue;
    }

    // Dividir os tokens numéricos e de menção
    // Ex: "1 8 4 0 1 6 4 0 ... 51 88% 51 85%"
    const tokens = restoLinha.split(/\s+/).filter(Boolean);
    if (tokens.length < 8) {
      continue;
    }

    // Ultimos 4 tokens são: TF, Fre(%), FTAn, Fre An(%)
    let tf = 0;
    let freBim = '—';
    let ftAn: number | undefined = undefined;
    let freAn: string | undefined = undefined;

    let totalTokensSlice = tokens.slice(-4);
    if (totalTokensSlice.some(t => t.includes('%'))) {
      for (const tok of totalTokensSlice) {
        if (tok.includes('%')) {
          if (freBim === '—') freBim = tok;
          else freAn = tok;
        } else {
          const n = parseInt(tok, 10);
          if (!isNaN(n)) {
            if (tf === 0) tf = n;
            else if (ftAn === undefined) ftAn = n;
          }
        }
      }
    }

    // Tokens das disciplinas são os anteriores aos totais
    const discTokens = tokens.slice(0, tokens.length - 4);
    const disciplinas: Record<string, DisciplinaFechamento> = {};
    const notasValidas: number[] = [];
    let qtdAbaixoBasico = 0;

    // Cada disciplina consome 4 tokens: Nº, M, F, AC
    const qtdDisciplinas = Math.floor(discTokens.length / 4);

    for (let d = 0; d < disciplinasDetectadas.length; d++) {
      const discNome = disciplinasDetectadas[d];
      const startTok = d * 4;

      if (startTok + 3 < discTokens.length) {
        const numChamada = parseInt(discTokens[startTok], 10) || undefined;
        const rawMencao = discTokens[startTok + 1];
        const faltas = parseInt(discTokens[startTok + 2], 10) || 0;
        const ac = parseInt(discTokens[startTok + 3], 10) || 0;

        const notaInfo = parseNotaValor(rawMencao);
        if (notaInfo.notaNum !== null) {
          notasValidas.push(notaInfo.notaNum);
        }
        if (notaInfo.abaixoBasico) {
          qtdAbaixoBasico++;
        }

        disciplinas[discNome] = {
          nome: discNome,
          mencaoNota: notaInfo.mencaoNota,
          notaNum: notaInfo.notaNum,
          faltas,
          ausenciaCompensada: ac,
          numChamada,
          abaixoBasico: notaInfo.abaixoBasico
        };
      } else {
        disciplinas[discNome] = {
          nome: discNome,
          mencaoNota: '—',
          notaNum: null,
          faltas: 0,
          ausenciaCompensada: 0,
          abaixoBasico: false
        };
      }
    }

    if (tf === 0) {
      tf = Object.values(disciplinas).reduce((acc, d) => acc + (d.faltas || 0), 0);
    }

    const mediaGeral = notasValidas.length > 0
      ? Math.round((notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length) * 10) / 10
      : null;

    alunosParsed.push({
      nome: nomeAluno,
      situacao,
      disciplinas,
      totalFaltas: tf,
      frequenciaBimestre: freBim,
      faltasTotalAno: ftAn,
      frequenciaTotalAno: freAn,
      mediaGeral,
      qtdAbaixoBasico
    });
  }

  return {
    metadata: {
      anoLetivo,
      turmaOriginal: turmaOriginal || 'Turma Não Especificada',
      turmaNormalizada: normalizarTurma(turmaOriginal),
      tipoFechamento,
      bimestre,
      bimestreKey,
      totalAulasDadas,
      totalAulasDadasEletiva,
      disciplinasDetectadas
    },
    alunos: alunosParsed
  };
}

// ----------------------------------------------------
// Motor de Pareamento Inteligente (Sem RA)
// ----------------------------------------------------
export function vincularAlunosComBase(
  parsed: ParsedFechamentoResult,
  baseAlunos: any[]
): VinculoAlunoResult[] {
  const normTurmaDoc = normalizarTurma(parsed.metadata.turmaOriginal);
  const resultados: VinculoAlunoResult[] = [];

  for (const item of parsed.alunos) {
    const normNomeRow = normalizarNome(item.nome);
    const rowTokens = normNomeRow.split(' ').filter(Boolean);

    // 1. Prioridade Máxima: Turma e Nome Completo Idênticos
    let match = baseAlunos.find(s => {
      const sNome = normalizarNome(s.nome);
      const sTurma = normalizarTurma(s.turma);
      return sNome === normNomeRow && normTurmaDoc && sTurma === normTurmaDoc;
    });

    if (match) {
      resultados.push({
        alunoParsed: item,
        alunoBase: match,
        tipoVinculo: 'turma_e_nome',
        confianca: 1.0,
        raSugerido: match.ra,
        turmaBase: match.turma
      });
      continue;
    }

    // 2. Prioridade 2: Nome Completo Idêntico (mesmo que a turma na base esteja formatada diferente)
    const matchesPorNome = baseAlunos.filter(s => normalizarNome(s.nome) === normNomeRow);
    if (matchesPorNome.length === 1) {
      resultados.push({
        alunoParsed: item,
        alunoBase: matchesPorNome[0],
        tipoVinculo: 'apenas_nome',
        confianca: 0.95,
        raSugerido: matchesPorNome[0].ra,
        turmaBase: matchesPorNome[0].turma
      });
      continue;
    } else if (matchesPorNome.length > 1) {
      // Se houver homônimos, prefere o aluno ativo
      const ativo = matchesPorNome.find(s => String(s.status || 'ATIVO').toUpperCase() === 'ATIVO');
      const escolhido = ativo || matchesPorNome[0];
      resultados.push({
        alunoParsed: item,
        alunoBase: escolhido,
        tipoVinculo: 'apenas_nome',
        confianca: 0.9,
        raSugerido: escolhido.ra,
        turmaBase: escolhido.turma
      });
      continue;
    }

    // 3. Prioridade 3: Pareamento Aproximado Seguro
    // Verifica se primeiro e último nome coincidem na mesma turma ou na base
    const candidatoAprox = baseAlunos.find(s => {
      const sNome = normalizarNome(s.nome);
      const sTokens = sNome.split(' ').filter(Boolean);
      if (sTokens.length < 2 || rowTokens.length < 2) return false;

      // Primeiro e último nome devem ser idênticos
      if (sTokens[0] !== rowTokens[0] || sTokens[sTokens.length - 1] !== rowTokens[rowTokens.length - 1]) {
        return false;
      }

      // Proporção de tokens coincidentes
      const setBase = new Set(sTokens);
      const coincidentes = rowTokens.filter(t => setBase.has(t));
      const threshold = Math.min(sTokens.length, rowTokens.length) * 0.7;
      return coincidentes.length >= threshold;
    });

    if (candidatoAprox) {
      resultados.push({
        alunoParsed: item,
        alunoBase: candidatoAprox,
        tipoVinculo: 'aproximado',
        confianca: 0.85,
        raSugerido: candidatoAprox.ra,
        turmaBase: candidatoAprox.turma
      });
      continue;
    }

    // 4. Não localizado na base
    resultados.push({
      alunoParsed: item,
      alunoBase: null,
      tipoVinculo: 'nao_encontrado',
      confianca: 0,
      raSugerido: null,
      turmaBase: null
    });
  }

  return resultados;
}

// ----------------------------------------------------
// Gravação Otimizada no Firestore (Batches Paralelos Ultrarrápidos)
// ----------------------------------------------------
export async function salvarFechamentoNoFirestore(
  vinculos: VinculoAlunoResult[],
  metadata: MetadataFechamento,
  onProgress?: (porcentagem: number, salvos?: number, total?: number) => void
): Promise<{ sucessos: number; ignorados: number; erros: number }> {
  const bimKey = metadata.bimestreKey;
  const agoraISO = new Date().toISOString();

  // Filtrar apenas vínculos válidos
  const itensParaSalvar = vinculos.filter(v => v.alunoBase && (v.alunoBase.ra || v.alunoBase.docId || v.alunoBase.id));

  if (itensParaSalvar.length === 0) {
    return { sucessos: 0, ignorados: vinculos.length, erros: 0 };
  }

  // Sanitizador auxiliar para garantir que nenhum código numérico (ex: 1813) persista nos nomes ou chaves das disciplinas
  function sanitizarDisciplinasObj(disciplinas: Record<string, DisciplinaFechamento>): Record<string, DisciplinaFechamento> {
    if (!disciplinas || typeof disciplinas !== 'object') return {};
    const limpo: Record<string, DisciplinaFechamento> = {};
    for (const [k, d] of Object.entries(disciplinas)) {
      const cleanK = limparNomeDisciplina(k);
      const cleanName = limparNomeDisciplina(d?.nome || k);
      limpo[cleanK] = {
        ...d,
        nome: cleanName
      };
    }
    return limpo;
  }

  // 1. ATUALIZAÇÃO OTIMISTA EM MEMÓRIA IMEDIATA (0ms de espera para o usuário)
  const allStudents = (typeof window !== 'undefined' && (window as any).allStudentsData) ? (window as any).allStudentsData : [];
  for (const item of itensParaSalvar) {
    const studentInMem = allStudents.find((s: any) => 
      (s.ra && item.alunoBase.ra && String(s.ra) === String(item.alunoBase.ra)) ||
      (s.docId && item.alunoBase.docId && String(s.docId) === String(item.alunoBase.docId)) ||
      (s.id && item.alunoBase.id && String(s.id) === String(item.alunoBase.id))
    );
    if (studentInMem) {
      if (!studentInMem.fechamento_notas) {
        studentInMem.fechamento_notas = {};
      }
      studentInMem.fechamento_notas[bimKey] = {
        bimestre: metadata.bimestre,
        bimestreKey: bimKey,
        anoLetivo: metadata.anoLetivo,
        turmaOriginal: metadata.turmaOriginal,
        tipoFechamento: metadata.tipoFechamento,
        totalAulasDadas: metadata.totalAulasDadas,
        totalAulasDadasEletiva: metadata.totalAulasDadasEletiva || 0,
        totalFaltas: item.alunoParsed.totalFaltas,
        frequenciaBimestre: item.alunoParsed.frequenciaBimestre,
        faltasTotalAno: item.alunoParsed.faltasTotalAno,
        frequenciaTotalAno: item.alunoParsed.frequenciaTotalAno,
        mediaGeral: item.alunoParsed.mediaGeral,
        qtdAbaixoBasico: item.alunoParsed.qtdAbaixoBasico,
        disciplinas: sanitizarDisciplinasObj(item.alunoParsed.disciplinas),
        atualizadoEm: agoraISO
      };
      if (bimKey === 'FINAL' && item.alunoParsed.situacao) {
        studentInMem.situacao_final_ano = item.alunoParsed.situacao;
      }
      studentInMem.ultima_atualizacao_notas = agoraISO;
    }
  }

  // Notificar progresso inicial
  if (onProgress) {
    onProgress(15, 0, itensParaSalvar.length);
  }

  // Trava para evitar que o listener onSnapshot recalcule todo o feed em loop
  if (typeof window !== 'undefined') {
    (window as any).__salvandoEmLote = true;
  }

  // Obter instâncias e utilitários consistentes do Firestore
  const activeDb = db;
  const activeDoc = doc;
  const activeWriteBatch = writeBatch;

  // Dividir em lotes otimizados (150 itens por lote para máxima velocidade no Firestore)
  const BATCH_SIZE = 150;
  const chunks: VinculoAlunoResult[][] = [];
  for (let i = 0; i < itensParaSalvar.length; i += BATCH_SIZE) {
    chunks.push(itensParaSalvar.slice(i, i + BATCH_SIZE));
  }

  let sucessos = 0;
  let erros = 0;
  let concluidos = 0;

  try {
    // Execução paralela de todos os lotes com Promise.all para latência mínima de rede
    await Promise.all(
      chunks.map(async (chunk) => {
        const batch = activeWriteBatch(activeDb);

        for (const item of chunk) {
          const targetDocId = String(item.alunoBase.docId || item.alunoBase.id || item.alunoBase.ra);
          const parsed = item.alunoParsed;
          const docRef = activeDoc(activeDb, 'alunos', targetDocId);

          const payloadFechamentoBimestre = {
            bimestre: metadata.bimestre,
            bimestreKey: bimKey,
            anoLetivo: metadata.anoLetivo,
            turmaOriginal: metadata.turmaOriginal,
            tipoFechamento: metadata.tipoFechamento,
            totalAulasDadas: metadata.totalAulasDadas,
            totalAulasDadasEletiva: metadata.totalAulasDadasEletiva || 0,
            totalFaltas: parsed.totalFaltas,
            frequenciaBimestre: parsed.frequenciaBimestre,
            faltasTotalAno: parsed.faltasTotalAno || parsed.totalFaltas,
            frequenciaTotalAno: parsed.frequenciaTotalAno || parsed.frequenciaBimestre,
            mediaGeral: parsed.mediaGeral,
            qtdAbaixoBasico: parsed.qtdAbaixoBasico,
            disciplinas: sanitizarDisciplinasObj(parsed.disciplinas),
            atualizadoEm: agoraISO
          };

          const updateData: Record<string, any> = {
            [`fechamento_notas.${bimKey}`]: payloadFechamentoBimestre,
            ultima_atualizacao_notas: agoraISO
          };

          if (bimKey === 'FINAL' && item.alunoParsed.situacao) {
            updateData.situacao_final_ano = item.alunoParsed.situacao;
          }

          batch.update(docRef, updateData);
        }

        try {
          await batch.commit();
          sucessos += chunk.length;
          concluidos += chunk.length;
          if (onProgress) {
            const pct = Math.min(100, Math.round((concluidos / itensParaSalvar.length) * 100));
            onProgress(pct, concluidos, itensParaSalvar.length);
          }
        } catch (err: any) {
          console.warn('Falha no update batch (pode ser doc inexistente), executando fallback seguro...', err);
          // Fallback resiliente com merge: true
          try {
            const fallbackBatch = activeWriteBatch(activeDb);
            for (const item of chunk) {
              const targetDocId = String(item.alunoBase.docId || item.alunoBase.id || item.alunoBase.ra);
              const parsed = item.alunoParsed;
              const docRef = activeDoc(activeDb, 'alunos', targetDocId);

              const payloadFechamentoBimestre = {
                bimestre: metadata.bimestre,
                bimestreKey: bimKey,
                anoLetivo: metadata.anoLetivo,
                turmaOriginal: metadata.turmaOriginal,
                tipoFechamento: metadata.tipoFechamento,
                totalAulasDadas: metadata.totalAulasDadas,
                totalAulasDadasEletiva: metadata.totalAulasDadasEletiva || 0,
                totalFaltas: parsed.totalFaltas,
                frequenciaBimestre: parsed.frequenciaBimestre,
                faltasTotalAno: parsed.faltasTotalAno || parsed.totalFaltas,
                frequenciaTotalAno: parsed.frequenciaTotalAno || parsed.frequenciaBimestre,
                mediaGeral: parsed.mediaGeral,
                qtdAbaixoBasico: parsed.qtdAbaixoBasico,
                disciplinas: sanitizarDisciplinasObj(parsed.disciplinas),
                atualizadoEm: agoraISO
              };

              fallbackBatch.set(
                docRef,
                {
                  fechamento_notas: {
                    [bimKey]: payloadFechamentoBimestre
                  },
                  ultima_atualizacao_notas: agoraISO,
                  ...(bimKey === 'FINAL' && item.alunoParsed.situacao ? { situacao_final_ano: item.alunoParsed.situacao } : {})
                },
                { merge: true }
              );
            }
            await fallbackBatch.commit();
            sucessos += chunk.length;
            concluidos += chunk.length;
            if (onProgress) {
              const pct = Math.min(100, Math.round((concluidos / itensParaSalvar.length) * 100));
              onProgress(pct, concluidos, itensParaSalvar.length);
            }
          } catch (fallbackErr) {
            console.error('Erro no fallback do lote:', fallbackErr);
            erros += chunk.length;
          }
        }
      })
    );
  } finally {
    if (typeof window !== 'undefined') {
      (window as any).__salvandoEmLote = false;
    }
  }

  // Notificar 100%
  if (onProgress) {
    onProgress(100, sucessos, itensParaSalvar.length);
  }

  // Disparar evento para atualizar reativamente qualquer tela ou componente React aberto
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fechamentonotasatualizado', { detail: { metadata, sucessos } }));
    window.dispatchEvent(new CustomEvent('taborrolechange'));
  }

  return {
    sucessos,
    ignorados: vinculos.length - itensParaSalvar.length,
    erros
  };
}

// ----------------------------------------------------
// Renderizador HTML do Boletim Bimestral na Ficha do Aluno
// ----------------------------------------------------
export function renderizarBoletimAlunoHtml(
  aluno: any,
  modo: '1B' | '2B' | '3B' | '4B' | 'FINAL' | 'comparativo' = '1B'
): string {
  if (!aluno) {
    return `<div class="p-6 text-center text-slate-400">Nenhum estudante selecionado.</div>`;
  }

  function sanitizarPeriodoFechamento(periodoData: any) {
    if (!periodoData || typeof periodoData !== 'object') return periodoData;
    const discOrig = periodoData.disciplinas || {};
    const discLimpo: Record<string, DisciplinaFechamento> = {};
    for (const [key, d] of Object.entries(discOrig)) {
      const cleanKey = limparNomeDisciplina(key);
      const cleanNome = limparNomeDisciplina((d as any)?.nome || key);
      discLimpo[cleanKey] = {
        ...(d as any),
        nome: cleanNome
      };
    }
    return {
      ...periodoData,
      disciplinas: discLimpo
    };
  }

  const notasObj = aluno.fechamento_notas || {};
  const b1 = sanitizarPeriodoFechamento(notasObj['1B']);
  const b2 = sanitizarPeriodoFechamento(notasObj['2B']);
  const b3 = sanitizarPeriodoFechamento(notasObj['3B']);
  const b4 = sanitizarPeriodoFechamento(notasObj['4B']);
  const bFinal = sanitizarPeriodoFechamento(notasObj['FINAL']);

  const bimestresDisponiveis = [
    { key: '1B', label: '1º Bimestre', data: b1 },
    { key: '2B', label: '2º Bimestre', data: b2 },
    { key: '3B', label: '3º Bimestre', data: b3 },
    { key: '4B', label: '4º Bimestre', data: b4 },
    { key: 'FINAL', label: 'Fechamento Final', data: bFinal }
  ].filter(b => !!b.data);

  if (bimestresDisponiveis.length === 0) {
    return `
      <div class="p-8 text-center space-y-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
        <div class="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center mx-auto text-xl">
          <i class="fa-solid fa-graduation-cap"></i>
        </div>
        <h4 class="font-bold text-slate-800 text-sm uppercase">Nenhum fechamento de nota importado ainda</h4>
        <p class="text-xs text-slate-500 max-w-md mx-auto">
          As notas dos 4 bimestres e do fechamento final ainda não foram registradas para este estudante. Você pode importar o relatório oficial de rendimento da turma na aba <strong>Dashboard</strong> ou digitar manualmente abaixo (ideal para estudantes transferidos).
        </p>
        <div class="pt-2">
          <button 
            type="button" 
            onclick="window.abrirModalDigitarBoletim('${aluno.ra}', '${modo || '1B'}')" 
            class="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition inline-flex items-center gap-2 cursor-pointer"
          >
            <i class="fa-solid fa-file-pen text-xs"></i>
            <span>Digitar Boletim & Frequência do Aluno</span>
          </button>
        </div>
      </div>
    `;
  }

  const badgeNotaFormat = (d: any) => {
    if (!d || d.mencaoNota === '—' || !d.mencaoNota) return '<span class="text-slate-400 font-mono">—</span>';
    const n = d.notaNum;
    let bg = 'bg-slate-100 text-slate-700';
    if (n !== null && n !== undefined) {
      if (n >= 7) bg = 'bg-emerald-100 text-emerald-800 border border-emerald-300';
      else if (n >= 5) bg = 'bg-blue-100 text-blue-800 border border-blue-300';
      else bg = 'bg-rose-100 text-rose-800 border border-rose-300 font-black';
    } else if (d.abaixoBasico) {
      bg = 'bg-rose-100 text-rose-800 font-black';
    }
    return `<span class="px-2 py-0.5 rounded font-extrabold text-xs inline-block ${bg}">${d.mencaoNota}</span>`;
  };

  // ----------------------------------------------------
  // MODO COMPARATIVO / QUADRO ANUAL COMPLETO
  // ----------------------------------------------------
  if (modo === 'comparativo') {
    const todasDisciplinas = Array.from(
      new Set(
        [
          ...Object.keys(b1?.disciplinas || {}),
          ...Object.keys(b2?.disciplinas || {}),
          ...Object.keys(b3?.disciplinas || {}),
          ...Object.keys(b4?.disciplinas || {}),
          ...Object.keys(bFinal?.disciplinas || {})
        ].map(k => limparNomeDisciplina(k))
      )
    ).filter(Boolean);

    // Calcular faltas acumuladas do ano
    const totalFaltasAcumuladas = (bFinal?.totalFaltas !== undefined && bFinal?.totalFaltas > 0)
      ? bFinal.totalFaltas
      : (b1?.totalFaltas || 0) + (b2?.totalFaltas || 0) + (b3?.totalFaltas || 0) + (b4?.totalFaltas || 0);

    const freqAnualStr = bFinal?.frequenciaBimestre && bFinal.frequenciaBimestre !== '—'
      ? bFinal.frequenciaBimestre
      : (bFinal?.frequenciaTotalAno || '—');

    // Calcular Média Geral dos Bimestres Subidos
    const bimestresComNotaValida = [b1, b2, b3, b4].filter(b => b && b.mediaGeral !== null && b.mediaGeral !== undefined && !isNaN(Number(b.mediaGeral)));
    const mediaGeralAcumulada = bimestresComNotaValida.length > 0
      ? (bimestresComNotaValida.reduce((acc, b) => acc + Number(b.mediaGeral), 0) / bimestresComNotaValida.length).toFixed(1)
      : (bFinal?.mediaGeral !== null && bFinal?.mediaGeral !== undefined ? Number(bFinal.mediaGeral).toFixed(1) : (aluno.media_geral ? Number(aluno.media_geral).toFixed(1) : '—'));

    const mediaColorClass = mediaGeralAcumulada !== '—' && Number(mediaGeralAcumulada) < 5.0
      ? 'text-rose-700 bg-rose-50 border-rose-300'
      : (mediaGeralAcumulada !== '—' && Number(mediaGeralAcumulada) < 6.0
        ? 'text-amber-700 bg-amber-50 border-amber-300'
        : 'text-emerald-700 bg-emerald-50 border-emerald-300');

    return `
      <div class="space-y-4">
        <!-- Banner Executivo: Média Geral das Notas Subidas -->
        <div class="p-3.5 bg-blue-50/90 border border-blue-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center font-black text-lg shadow-sm shrink-0">
              <i class="fa-solid fa-graduation-cap"></i>
            </div>
            <div>
              <span class="text-xs font-black text-blue-950 uppercase tracking-wide block">
                Média Geral Consolidada &bull; Notas Subidas SED
              </span>
              <span class="text-[11px] text-blue-700 font-medium">
                ${bimestresComNotaValida.length > 0 
                  ? `Média calculada sobre ${bimestresComNotaValida.length} bimestre(s) importado(s) (${bimestresComNotaValida.map(b => b.bimestreKey || (b === b1 ? '1ºB' : b === b2 ? '2ºB' : b === b3 ? '3ºB' : '4ºB')).join(', ')})` 
                  : (bFinal?.mediaGeral ? 'Nota Oficial do Conselho Final' : 'Nenhum fechamento bimestral importado até o momento')}
              </span>
            </div>
          </div>
          <div class="text-left sm:text-right shrink-0">
            <span class="text-[10px] uppercase text-slate-500 block font-bold">Média Geral do Aluno</span>
            <span class="inline-block text-lg font-black px-3 py-0.5 rounded-lg border ${mediaColorClass}">
              ${mediaGeralAcumulada}
            </span>
          </div>
        </div>

        <!-- Resumo dos 4 Bimestres + Fechamento Final -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <!-- 1º Bimestre -->
          <div class="bg-blue-50/80 p-3 rounded-xl border border-blue-200 shadow-2xs">
            <span class="text-[10px] font-bold text-blue-800 uppercase block">1º Bimestre</span>
            <div class="text-xl font-black text-blue-950 mt-1">
              ${b1?.mediaGeral !== null && b1?.mediaGeral !== undefined ? b1.mediaGeral : '—'}
            </div>
            <span class="text-[10px] text-blue-600 block">${b1 ? `${b1.totalFaltas || 0} faltas &bull; ${b1.frequenciaBimestre || '—'}` : 'Não importado'}</span>
          </div>

          <!-- 2º Bimestre -->
          <div class="bg-indigo-50/80 p-3 rounded-xl border border-indigo-200 shadow-2xs">
            <span class="text-[10px] font-bold text-indigo-800 uppercase block">2º Bimestre</span>
            <div class="text-xl font-black text-indigo-950 mt-1">
              ${b2?.mediaGeral !== null && b2?.mediaGeral !== undefined ? b2.mediaGeral : '—'}
            </div>
            <span class="text-[10px] text-indigo-600 block">${b2 ? `${b2.totalFaltas || 0} faltas &bull; ${b2.frequenciaBimestre || '—'}` : 'Não importado'}</span>
          </div>

          <!-- 3º Bimestre -->
          <div class="bg-purple-50/80 p-3 rounded-xl border border-purple-200 shadow-2xs">
            <span class="text-[10px] font-bold text-purple-800 uppercase block">3º Bimestre</span>
            <div class="text-xl font-black text-purple-950 mt-1">
              ${b3?.mediaGeral !== null && b3?.mediaGeral !== undefined ? b3.mediaGeral : '—'}
            </div>
            <span class="text-[10px] text-purple-600 block">${b3 ? `${b3.totalFaltas || 0} faltas &bull; ${b3.frequenciaBimestre || '—'}` : 'Não importado'}</span>
          </div>

          <!-- 4º Bimestre -->
          <div class="bg-cyan-50/80 p-3 rounded-xl border border-cyan-200 shadow-2xs">
            <span class="text-[10px] font-bold text-cyan-800 uppercase block">4º Bimestre</span>
            <div class="text-xl font-black text-cyan-950 mt-1">
              ${b4?.mediaGeral !== null && b4?.mediaGeral !== undefined ? b4.mediaGeral : '—'}
            </div>
            <span class="text-[10px] text-cyan-600 block">${b4 ? `${b4.totalFaltas || 0} faltas &bull; ${b4.frequenciaBimestre || '—'}` : 'Não importado'}</span>
          </div>

          <!-- Fechamento Final -->
          <div class="bg-amber-50 p-3 rounded-xl border border-amber-300 shadow-2xs col-span-2 sm:col-span-1">
            <span class="text-[10px] font-bold text-amber-900 uppercase block flex items-center gap-1">
              <i class="fa-solid fa-trophy text-amber-600 text-[10px]"></i> Fechamento Final
            </span>
            <div class="text-xl font-black text-amber-950 mt-1">
              ${bFinal?.mediaGeral !== null && bFinal?.mediaGeral !== undefined ? bFinal.mediaGeral : '—'}
            </div>
            <span class="text-[10px] text-amber-800 block font-semibold">
              ${aluno.situacao_final_ano || bFinal?.situacao || (bFinal ? 'Conselho Realizado' : 'Aguardando')} &bull; ${totalFaltasAcumuladas} F
            </span>
          </div>
        </div>

        <!-- Tabela do Quadro Anual Completo -->
        <div class="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <div class="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <i class="fa-solid fa-table-list text-indigo-600"></i>
              Quadro Geral de Rendimento e Frequência Anual
            </span>
            <span class="text-[11px] text-slate-500 font-medium">
              Total Faltas do Ano: <strong>${totalFaltasAcumuladas}</strong> &bull; Freq Anual: <strong>${freqAnualStr}</strong>
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs min-w-[650px]">
              <thead>
                <tr class="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-200">
                  <th class="p-3">Componente Curricular</th>
                  <th class="p-2.5 text-center bg-blue-100/50">1ºB (N/F)</th>
                  <th class="p-2.5 text-center bg-indigo-100/50">2ºB (N/F)</th>
                  <th class="p-2.5 text-center bg-purple-100/50">3ºB (N/F)</th>
                  <th class="p-2.5 text-center bg-cyan-100/50">4ºB (N/F)</th>
                  <th class="p-2.5 text-center bg-amber-100/60 font-black">Final (Nota)</th>
                  <th class="p-2.5 text-center">Faltas Ano</th>
                  <th class="p-2.5 text-center">Situação Componente</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${todasDisciplinas.map(discNome => {
                  const d1 = b1?.disciplinas?.[discNome];
                  const d2 = b2?.disciplinas?.[discNome];
                  const d3 = b3?.disciplinas?.[discNome];
                  const d4 = b4?.disciplinas?.[discNome];
                  const df = bFinal?.disciplinas?.[discNome];

                  const formatCell = (d: any, bg: string) => {
                    if (!d || (d.mencaoNota === '—' && !d.faltas)) {
                      return `<td class="p-2 text-center text-slate-400 font-mono ${bg}">—</td>`;
                    }
                    return `
                      <td class="p-2 text-center ${bg}">
                        <div class="flex items-center justify-center gap-1.5">
                          ${badgeNotaFormat(d)}
                          <span class="text-[10px] font-mono text-slate-500">${d.faltas || 0}F</span>
                        </div>
                      </td>
                    `;
                  };

                  const faltasTotaisDisc = (df?.faltas !== undefined && df?.faltas > 0)
                    ? df.faltas
                    : (d1?.faltas || 0) + (d2?.faltas || 0) + (d3?.faltas || 0) + (d4?.faltas || 0);

                  // Status de Desempenho do Componente
                  let statusHtml = `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">Em Curso</span>`;
                  if (df?.notaNum !== null && df?.notaNum !== undefined) {
                    if (df.notaNum >= 5.0) {
                      statusHtml = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-extrabold flex items-center justify-center gap-1"><i class="fa-solid fa-check text-[9px]"></i>Aprovado</span>`;
                    } else {
                      statusHtml = `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[10px] font-extrabold flex items-center justify-center gap-1"><i class="fa-solid fa-triangle-exclamation text-[9px]"></i>Retido/Exame</span>`;
                    }
                  } else {
                    const notasExistentes = [d1?.notaNum, d2?.notaNum, d3?.notaNum, d4?.notaNum].filter(n => n !== null && n !== undefined) as number[];
                    if (notasExistentes.length > 0) {
                      const mediaTemp = notasExistentes.reduce((a, b) => a + b, 0) / notasExistentes.length;
                      if (mediaTemp >= 5.0) {
                        statusHtml = `<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">Média Atual: ${mediaTemp.toFixed(1)}</span>`;
                      } else {
                        statusHtml = `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">Abaixo (Média: ${mediaTemp.toFixed(1)})</span>`;
                      }
                    }
                  }

                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="p-3 font-bold text-slate-800 uppercase">${limparNomeDisciplina(discNome)}</td>
                      ${formatCell(d1, 'bg-blue-50/20')}
                      ${formatCell(d2, 'bg-indigo-50/20')}
                      ${formatCell(d3, 'bg-purple-50/20')}
                      ${formatCell(d4, 'bg-cyan-50/20')}
                      <td class="p-2 text-center bg-amber-50/30">
                        ${df ? badgeNotaFormat(df) : '<span class="text-slate-400 font-mono">—</span>'}
                      </td>
                      <td class="p-2 text-center font-mono font-bold text-slate-700">${faltasTotaisDisc}</td>
                      <td class="p-2 text-center">${statusHtml}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------
  // MODO INDIVIDUAL: 1B, 2B, 3B, 4B ou FINAL
  // ----------------------------------------------------
  const periodoMap: Record<string, { data: any; label: string; key: BimestrePeriodoKey }> = {
    '1B': { data: b1, label: '1º Bimestre', key: '1B' },
    '2B': { data: b2, label: '2º Bimestre', key: '2B' },
    '3B': { data: b3, label: '3º Bimestre', key: '3B' },
    '4B': { data: b4, label: '4º Bimestre', key: '4B' },
    'FINAL': { data: bFinal, label: 'Fechamento Final', key: 'FINAL' }
  };

  const periodoEscolhido = periodoMap[modo] || periodoMap['1B'];
  const bData = periodoEscolhido.data;

  // Se o período selecionado não tiver dados ainda, avisa com opções de navegação rápida
  if (!bData) {
    return `
      <div class="p-8 text-center space-y-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
        <div class="w-12 h-12 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center mx-auto text-xl">
          <i class="fa-solid fa-calendar-xmark"></i>
        </div>
        <div>
          <h4 class="font-bold text-slate-800 text-sm uppercase">
            ${periodoEscolhido.label} ainda não foi importado para este estudante
          </h4>
          <p class="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Você pode importar a planilha ou PDF deste período na aba <strong>Dashboard</strong> ou escolher outro período disponível abaixo:
          </p>
        </div>
        <div class="flex flex-wrap justify-center items-center gap-2 pt-2">
          <button type="button" onclick="window.abrirModalDigitarBoletim('${aluno.ra}', '${periodoEscolhido.key}')" class="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs rounded-lg uppercase shadow-2xs transition cursor-pointer flex items-center gap-1.5">
            <i class="fa-solid fa-file-pen text-xs"></i>
            <span>Digitar ${periodoEscolhido.label}</span>
          </button>
          ${bimestresDisponiveis.map(b => `
            <button type="button" onclick="window.selecionarBimestreBoletim('${b.key}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg uppercase shadow-2xs transition cursor-pointer">
              Ver ${b.label}
            </button>
          `).join('')}
          <button type="button" onclick="window.selecionarBimestreBoletim('comparativo')" class="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg uppercase transition cursor-pointer flex items-center gap-1.5">
            <i class="fa-solid fa-table-list text-xs"></i>
            <span>Ver Quadro Anual Completo</span>
          </button>
        </div>
      </div>
    `;
  }

  const isFinal = periodoEscolhido.key === 'FINAL';
  const discList = Object.values(bData.disciplinas || {}) as DisciplinaFechamento[];

  return `
    <div class="space-y-4">
      <!-- Cabeçalho de Metadados do Período -->
      <div class="${isFinal ? 'bg-gradient-to-r from-amber-700 via-amber-800 to-amber-900' : 'bg-gradient-to-r from-blue-900 to-indigo-900'} text-white p-4 rounded-xl shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider ${isFinal ? 'text-amber-200' : 'text-cyan-300'}">
            ${bData.tipoFechamento || (isFinal ? 'Conselho de Classe Final & Fechamento Anual' : `Conselho de Classe - ${bData.bimestre}º Bimestre`)} &bull; Ano Letivo ${bData.anoLetivo || 2026}
          </span>
          <h3 class="text-base font-black uppercase text-white mt-0.5">
            ${bData.turmaOriginal || aluno.turma || 'Turma PEI'}
          </h3>
          <p class="text-xs ${isFinal ? 'text-amber-100' : 'text-blue-200'}">
            ${isFinal ? `Total de Aulas Dadas no Ano: <strong>${bData.totalAulasDadas || '—'}</strong>` : `Total de Aulas Dadas no Bimestre: <strong>${bData.totalAulasDadas || '—'}</strong>`}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            type="button" 
            onclick="window.abrirModalDigitarBoletim('${aluno.ra}', '${periodoEscolhido.key}')" 
            class="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-lg text-xs font-bold uppercase transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Digitar ou ajustar notas e frequência deste bimestre"
          >
            <i class="fa-solid fa-pen-to-square text-xs"></i>
            <span>Editar / Ajustar Bimestre</span>
          </button>
          <span class="px-3 py-1 bg-white/10 backdrop-blur-xs text-white border border-white/20 rounded-lg text-xs font-bold uppercase flex items-center gap-1.5">
            ${isFinal ? '<i class="fa-solid fa-trophy text-amber-300"></i>' : ''}
            ${isFinal ? 'Fechamento Final Oficial SED' : `${bData.bimestreKey || '1B'} Oficial SED`}
          </span>
        </div>
      </div>

      <!-- Resumo Numérico -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">
            ${isFinal ? 'Média Geral Final' : 'Média Geral do Bimestre'}
          </span>
          <div class="text-2xl font-black ${isFinal ? 'text-amber-950' : 'text-blue-950'} mt-1">
            ${bData.mediaGeral !== null && bData.mediaGeral !== undefined ? bData.mediaGeral : '—'}
          </div>
          <span class="text-[10px] text-slate-400">Componentes curriculares avaliados</span>
        </div>

        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">
            ${isFinal ? 'Total de Faltas no Ano' : 'Total de Faltas no Bimestre'}
          </span>
          <div class="text-2xl font-black text-slate-800 mt-1">
            ${bData.totalFaltas || 0}
          </div>
          <span class="text-[10px] text-slate-400">Ausências registradas em diário</span>
        </div>

        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">
            ${isFinal ? 'Frequência Anual Final' : 'Frequência no Bimestre'}
          </span>
          <div class="text-2xl font-black text-emerald-700 mt-1">
            ${bData.frequenciaBimestre || bData.frequenciaTotalAno || '—'}
          </div>
          <span class="text-[10px] text-slate-400">Meta SEDUC-SP: &ge; 75%</span>
        </div>

        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">
            ${isFinal ? 'Situação Final do Aluno' : 'Componentes em Alerta (< 5,0)'}
          </span>
          <div class="text-xl font-black ${isFinal ? 'text-indigo-900' : ((bData.qtdAbaixoBasico || 0) > 0 ? 'text-rose-600' : 'text-emerald-700')} mt-1">
            ${isFinal ? (aluno.situacao_final_ano || bData.situacao || aluno.status || 'Promovido') : (bData.qtdAbaixoBasico || 0)}
          </div>
          <span class="text-[10px] text-slate-400">
            ${isFinal ? 'Resultado oficial Conselho de Classe' : 'Necessitam recomposição pedagógica'}
          </span>
        </div>
      </div>

      <!-- Tabela Oficial de Disciplinas -->
      <div class="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-200">
              <th class="p-3">Componente Curricular</th>
              <th class="p-3 text-center">Menção / Nota</th>
              <th class="p-3 text-center">Faltas</th>
              <th class="p-3 text-center">Ausências Compensadas (AC)</th>
              <th class="p-3 text-center">Status de Desempenho</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${discList.map(d => {
              const n = d.notaNum;
              let badgeBg = 'bg-slate-100 text-slate-700';
              let statusText = 'Satisfatório';
              let statusBg = 'bg-slate-100 text-slate-600';

              if (n !== null && n !== undefined) {
                if (n >= 7.0) {
                  badgeBg = 'bg-emerald-100 text-emerald-800 border border-emerald-300';
                  statusText = isFinal ? 'Aprovado / Adequado' : 'Adequado / Avançado';
                  statusBg = 'bg-emerald-50 text-emerald-800';
                } else if (n >= 5.0) {
                  badgeBg = 'bg-blue-100 text-blue-800 border border-blue-300';
                  statusText = isFinal ? 'Aprovado / Básico' : 'Básico';
                  statusBg = 'bg-blue-50 text-blue-800';
                } else {
                  badgeBg = 'bg-rose-100 text-rose-800 border border-rose-300 font-black';
                  statusText = isFinal ? 'Retido / Necessita Exame' : 'Abaixo do Básico (Atenção)';
                  statusBg = 'bg-rose-50 text-rose-800 font-bold';
                }
              } else if (d.abaixoBasico) {
                badgeBg = 'bg-rose-100 text-rose-800 border border-rose-300 font-black';
                statusText = 'Em Processo / Atenção';
                statusBg = 'bg-rose-50 text-rose-800 font-bold';
              }

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3 font-bold text-slate-800 uppercase">${limparNomeDisciplina(d.nome)}</td>
                  <td class="p-3 text-center">
                    <span class="px-3 py-1 rounded font-black text-xs inline-block ${badgeBg}">
                      ${d.mencaoNota || '—'}
                    </span>
                  </td>
                  <td class="p-3 text-center font-mono text-slate-700">${d.faltas || 0}</td>
                  <td class="p-3 text-center font-mono text-slate-500">${d.ausenciaCompensada || 0}</td>
                  <td class="p-3 text-center">
                    <span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase inline-block ${statusBg}">
                      ${statusText}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Tornar disponível globalmente para clovisLegacyApp.js e outros scripts
if (typeof window !== 'undefined') {
  (window as any).fechamentoNotasManager = {
    normalizarNome,
    normalizarTurma,
    detectarBimestreTexto,
    parseFechamentoExcel,
    parseFechamentoPDF,
    parseFechamentoTexto,
    vincularAlunosComBase,
    salvarFechamentoNoFirestore,
    renderizarBoletimAlunoHtml
  };
}
