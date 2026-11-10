/**
 * src/modules/boletimPdfParser.ts
 * Módulo para extração e atualização inteligente de Boletins Escolares SED em PDF
 * Desenvolvido especificamente para a E.E. Clóvis de Lucca para resolver pendências
 * de estudantes transferidos no módulo de Auditoria SED vs. Mapão.
 */

// Importações de banco de dados são feitas dinamicamente no cliente para compatibilidade plena com ESM no Node.js

export interface DisciplinaBoletim {
  nome: string;
  mencaoNota: string;
  notaNum: number | null;
  faltas: number;
  ausenciaCompensada: number;
  frequencia?: string | null;
  frequenciaNum?: number | null;
  abaixoBasico: boolean;
}

export interface BimestreBoletimExtraido {
  bimestre: number;
  bimestreKey: '1B' | '2B' | '3B' | '4B';
  temDados: boolean;
  disciplinas: Record<string, DisciplinaBoletim>;
  totalFaltas: number;
  frequenciaBimestre: string;
  frequenciaNum: number;
  mediaGeral: number;
  qtdAbaixoBasico: number;
  totalAulasDadas: number;
}

export interface AlunoBoletimExtraido {
  nome: string;
  ra: string;
  raLimpo: string;
  escola: string;
  turma: string;
  anoLetivo: number;
  tipoEnsino?: string;
  diretoria?: string;
}

export interface BoletimParseResult {
  sucesso: boolean;
  aluno: AlunoBoletimExtraido;
  bimestres: {
    '1B': BimestreBoletimExtraido;
    '2B': BimestreBoletimExtraido;
    '3B': BimestreBoletimExtraido;
    '4B': BimestreBoletimExtraido;
  };
  totalDisciplinas: number;
  textoExtraido?: string;
  mensagem?: string;
}

/**
 * Analisa o texto bruto de um Boletim Escolar oficial da SED (Secretaria da Educação do Estado de São Paulo)
 * e extrai com alta precisão os dados cadastrais do aluno e o quadro completo de notas e faltas dos 4 bimestres.
 */
export function parseBoletimSEDText(text: string): BoletimParseResult {
  const result: BoletimParseResult = {
    sucesso: true,
    aluno: {
      nome: '',
      ra: '',
      raLimpo: '',
      escola: '',
      turma: '',
      anoLetivo: 2026,
      tipoEnsino: '',
      diretoria: ''
    },
    bimestres: {
      '1B': { bimestre: 1, bimestreKey: '1B', temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: '0%', frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      '2B': { bimestre: 2, bimestreKey: '2B', temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: '0%', frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      '3B': { bimestre: 3, bimestreKey: '3B', temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: '0%', frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 },
      '4B': { bimestre: 4, bimestreKey: '4B', temDados: false, disciplinas: {}, totalFaltas: 0, frequenciaBimestre: '0%', frequenciaNum: 0, mediaGeral: 0, qtdAbaixoBasico: 0, totalAulasDadas: 50 }
    },
    totalDisciplinas: 0,
    textoExtraido: text
  };

  if (!text || typeof text !== 'string') {
    result.sucesso = false;
    result.mensagem = 'Texto do documento PDF vazio ou inválido.';
    return result;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Extração de Metadados e Cabeçalho do Aluno
  for (const line of lines) {
    // Nome do Aluno e RA
    const nomeRaMatch = line.match(/Nome(?:\s+do\s+Aluno)?:\s*(.+?)\s+RA:\s*([0-9Xx\s\-\.\/]+?)(?:\s+Ano Letivo|\s*\/SP|\s*$)/i);
    if (nomeRaMatch) {
      result.aluno.nome = nomeRaMatch[1].trim().toUpperCase();
      result.aluno.ra = nomeRaMatch[2].trim();
      result.aluno.raLimpo = result.aluno.ra.replace(/\D/g, '').substring(0, 12);
    } else {
      if (!result.aluno.nome) {
        const nMatch = line.match(/Nome(?:\s+do\s+Aluno)?:\s*([^R\n]+)/i);
        if (nMatch) result.aluno.nome = nMatch[1].trim().toUpperCase();
      }
      if (!result.aluno.ra) {
        const rMatch = line.match(/RA:\s*([0-9Xx\s\-\.\/]+?)(?:\s+Ano|\s*\/SP|\s*$)/i);
        if (rMatch) {
          result.aluno.ra = rMatch[1].trim();
          result.aluno.raLimpo = result.aluno.ra.replace(/\D/g, '').substring(0, 12);
        }
      }
    }

    // Diretoria
    const dirMatch = line.match(/Diretoria:\s*([^E\n]+?)(?:\s+Escola:|$)/i);
    if (dirMatch) result.aluno.diretoria = dirMatch[1].trim();

    // Escola
    const escMatch = line.match(/Escola:\s*([^\n]+)/i);
    if (escMatch) result.aluno.escola = escMatch[1].trim();

    // Tipo de Ensino
    const ensMatch = line.match(/Tipo(?:\s+de)?\s+Ensino:\s*([^T\n]+?)(?:\s+Turma:|$)/i);
    if (ensMatch) result.aluno.tipoEnsino = ensMatch[1].trim();

    // Turma
    const turMatch = line.match(/Turma:\s*([^\n]+)/i);
    if (turMatch) result.aluno.turma = turMatch[1].trim();

    // Ano Letivo
    const anoMatch = line.match(/Ano\s+Letivo:\s*(\d{4})/i);
    if (anoMatch) result.aluno.anoLetivo = parseInt(anoMatch[1], 10);
  }

  // Se não extraiu o RA limpo, tenta achar qualquer sequência de 10 a 13 dígitos
  if (!result.aluno.raLimpo) {
    const rawRaMatch = text.match(/\b(000\d{8,10}|\d{9,12})\b/);
    if (rawRaMatch) {
      result.aluno.raLimpo = rawRaMatch[1].substring(0, 12);
      if (!result.aluno.ra) result.aluno.ra = rawRaMatch[1];
    }
  }

  // 2. Extração das Linhas de Componentes Curriculares / Disciplinas
  // No Boletim SED, a linha de disciplina termina com as notas/faltas dos 4 bimestres e CF
  for (const line of lines) {
    const parsedRow = parseLinhaComponenteSED(line);
    if (!parsedRow) continue;

    const { discName, tokens } = parsedRow;
    const bKeys: Array<'1B' | '2B' | '3B' | '4B'> = ['1B', '2B', '3B', '4B'];

    for (let bIdx = 0; bIdx < 4; bIdx++) {
      const offset = bIdx * 4;
      if (tokens.length >= offset + 4) {
        const notaRaw = tokens[offset];
        const faltasRaw = tokens[offset + 1];
        const freqRaw = tokens[offset + 2];
        const acRaw = tokens[offset + 3];

        const hasData = (notaRaw !== '-' && notaRaw !== '') || 
                        (faltasRaw !== '-' && faltasRaw !== '') || 
                        (freqRaw !== '-' && freqRaw !== '');

        if (hasData) {
          const bKey = bKeys[bIdx];
          result.bimestres[bKey].temDados = true;

          const notaNum = notaRaw !== '-' && !isNaN(parseFloat(notaRaw.replace(',', '.'))) 
            ? parseFloat(notaRaw.replace(',', '.')) 
            : null;
          
          const faltasNum = faltasRaw !== '-' && !isNaN(parseInt(faltasRaw, 10)) 
            ? parseInt(faltasRaw, 10) 
            : 0;

          const freqNum = freqRaw !== '-' && freqRaw !== '' 
            ? parseFloat(freqRaw.replace('%', '').replace(',', '.')) 
            : null;

          const acNum = acRaw !== '-' && !isNaN(parseInt(acRaw, 10)) 
            ? parseInt(acRaw, 10) 
            : 0;

          result.bimestres[bKey].disciplinas[discName] = {
            nome: discName,
            mencaoNota: notaRaw !== '-' ? notaRaw : '—',
            notaNum,
            faltas: faltasNum,
            ausenciaCompensada: acNum,
            frequencia: freqRaw !== '-' ? freqRaw : null,
            frequenciaNum: freqNum,
            abaixoBasico: notaNum !== null ? notaNum < 5.0 : false
          };
        }
      }
    }
  }

  // 3. Apuração de Totais, Médias e Frequência Consolidada por Bimestre
  const disciplinasSet = new Set<string>();

  for (const [bKey, bData] of Object.entries(result.bimestres)) {
    if (bData.temDados) {
      const discs = Object.values(bData.disciplinas);
      let somaNotas = 0;
      let countNotas = 0;
      let totalFaltas = 0;
      let somaFreq = 0;
      let countFreq = 0;
      let qtdAbaixo = 0;

      for (const d of discs) {
        disciplinasSet.add(d.nome);
        if (d.notaNum !== null) {
          somaNotas += d.notaNum;
          countNotas++;
          if (d.notaNum < 5.0) qtdAbaixo++;
        }
        totalFaltas += d.faltas;
        if (d.frequenciaNum !== null && d.frequenciaNum !== undefined && !isNaN(d.frequenciaNum)) {
          somaFreq += d.frequenciaNum;
          countFreq++;
        }
      }

      bData.mediaGeral = countNotas > 0 ? Math.round((somaNotas / countNotas) * 10) / 10 : 0;
      bData.totalFaltas = totalFaltas;
      bData.qtdAbaixoBasico = qtdAbaixo;

      if (countFreq > 0) {
        const mediaFreq = Math.round((somaFreq / countFreq) * 10) / 10;
        bData.frequenciaNum = mediaFreq;
        bData.frequenciaBimestre = `${mediaFreq.toFixed(1)}%`;
      }
    }
  }

  result.totalDisciplinas = disciplinasSet.size;

  return result;
}

/**
 * Limpa nomes de disciplinas removendo códigos numéricos SED no final (ex: "ARTE 1813" -> "ARTE")
 */
export function limparNomeDisciplina(nomeCru: string): string {
  if (!nomeCru) return '';
  let s = String(nomeCru);

  // 1. Remove códigos numéricos entre parênteses ou colchetes em qualquer posição: ex "(1813)", "[1813]"
  s = s.replace(/\s*[\(\[]\s*\d+\s*[\)\]]\s*/g, ' ');

  // 2. Remove códigos numéricos no final do nome (ex: "ARTE 1813", "MATEMATICA - 1811", "CIENCIAS / 1814", "HISTORIA #1812")
  while (/[\s\-_–—/|#:]+\d+\s*$/i.test(s)) {
    s = s.replace(/[\s\-_–—/|#:]+\d+\s*$/i, '');
  }

  // 3. Caso números estejam grudados no final após letras (ex: "ARTE1813")
  s = s.replace(/([A-Za-zÀ-ÿ])\d{3,6}\s*$/g, '$1');

  // 4. Normalizar espaços em branco e caixa alta
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Função auxiliar que identifica e separa o nome do componente curricular
 * dos campos de valores do boletim escolar SED no final da linha.
 */
function parseLinhaComponenteSED(line: string): { discName: string; tokens: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Ignorar linhas de cabeçalhos e rodapés institucionais
  const ignorePatterns = [
    /^GOVERNO/i, /^SECRETARIA/i, /^Boletim Escolar/i, /^Nome/i, /^Diretoria/i,
    /^Tipo/i, /^Comp\./i, /^N\s+F/i, /^Siglas/i, /^CF\s*–/i, /^ET\s*–/i,
    /^AT\s*–/i, /^Resultado/i, /^\-\s*\d+/
  ];
  if (ignorePatterns.some(p => p.test(trimmed))) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 5) return null;

  // Percorre da direita para a esquerda identificando tokens de valores (notas, faltas, %, hífen, siglas)
  let valStartIdx = tokens.length - 1;
  while (valStartIdx >= 0) {
    const t = tokens[valStartIdx];
    const isVal = t === '-' || 
                  /^\d+$/.test(t) || 
                  /^\d+%$/.test(t) || 
                  /^\d+[\.,]\d+$/.test(t) || 
                  /^(ET|ES|EP|EXP|AT|AS|AR|AI)$/i.test(t);
    if (!isVal) break;
    valStartIdx--;
  }

  const nameTokens = tokens.slice(0, valStartIdx + 1);
  let valTokens = tokens.slice(valStartIdx + 1);

  // Se o primeiro token de valores for um código numérico de disciplina SED (ex: 1813) capturado pelo parser reverso
  if (valTokens.length > 0 && /^\d{4,6}$/.test(valTokens[0])) {
    valTokens.shift();
  }

  const rawDiscName = nameTokens.join(' ').trim();
  if (!rawDiscName || valTokens.length < 4) return null;

  const discName = limparNomeDisciplina(rawDiscName);
  if (!discName) return null;

  // Garantir que não capturou cabeçalhos de tabela como disciplina
  if (['COMP.', 'COMP', 'DISCIPLINA', 'DISCIPLINAS', 'CF'].includes(discName)) {
    return null;
  }

  return { discName, tokens: valTokens };
}

/**
 * Lê o arquivo PDF selecionado pelo usuário no navegador e extrai os dados via endpoint do servidor
 */
export async function extrairBoletimDeArquivoPDF(file: File): Promise<BoletimParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1] || (reader.result as string);

        const response = await fetch('/api/boletim/parse-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64: base64,
            fileName: file.name
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Erro do servidor (${response.status}) ao processar PDF.`);
        }

        const data = await response.json();
        resolve(data.dados);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Falha ao ler arquivo PDF no navegador.'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Grava e atualiza no banco de dados e em memória exclusivamente os bimestres faltantes
 * do estudante a partir dos dados extraídos do PDF do Boletim Escolar SED.
 */
export async function aplicarBimestresFaltantesAoAluno(
  alunoTarget: any,
  parsedBoletim: BoletimParseResult,
  bimestresParaAtualizar: Array<'1B' | '2B' | '3B' | '4B'> = ['1B', '2B', '3B', '4B']
): Promise<{ sucesso: boolean; bimestresAtualizados: string[]; alunoAtualizado: any }> {
  const raLimpo = String(alunoTarget?.ra || parsedBoletim.aluno.raLimpo).replace(/\D/g, '').substring(0, 12);
  if (!raLimpo) {
    throw new Error('RA do estudante não informado.');
  }

  const agoraISO = new Date().toISOString();
  const fnExistente = alunoTarget.fechamento_notas || alunoTarget.fechamentos || alunoTarget.notas || {};
  const fnClonado = typeof fnExistente === 'object' ? JSON.parse(JSON.stringify(fnExistente)) : {};

  const bimestresAtualizados: string[] = [];
  const updatePayload: Record<string, any> = {};

  const bKeys: Array<'1B' | '2B' | '3B' | '4B'> = ['1B', '2B', '3B', '4B'];

  for (const bKey of bKeys) {
    if (!bimestresParaAtualizar.includes(bKey)) continue;

    const bExtraido = parsedBoletim.bimestres[bKey];
    if (bExtraido && bExtraido.temDados) {
      const discSanitizadas: Record<string, DisciplinaBoletim> = {};
      for (const [k, d] of Object.entries(bExtraido.disciplinas || {})) {
        const cleanK = limparNomeDisciplina(k);
        const cleanNome = limparNomeDisciplina(d?.nome || k);
        discSanitizadas[cleanK] = {
          ...d,
          nome: cleanNome
        };
      }

      const payloadBimestre = {
        bimestre: bExtraido.bimestre,
        bimestreKey: bKey,
        anoLetivo: parsedBoletim.aluno.anoLetivo || 2026,
        turmaOriginal: parsedBoletim.aluno.turma || alunoTarget.turma || '',
        escolaOrigem: parsedBoletim.aluno.escola || 'Escola de Origem (Boletim SED)',
        tipoFechamento: `CONSELHO ${bKey} (BOLETIM SED IMPORTADO)`,
        totalAulasDadas: bExtraido.totalAulasDadas || 50,
        totalAulasDadasEletiva: 0,
        totalFaltas: bExtraido.totalFaltas,
        frequenciaBimestre: bExtraido.frequenciaBimestre,
        faltasTotalAno: bExtraido.totalFaltas,
        frequenciaTotalAno: bExtraido.frequenciaBimestre,
        mediaGeral: bExtraido.mediaGeral,
        qtdAbaixoBasico: bExtraido.qtdAbaixoBasico,
        situacao: 'EM CURSO',
        disciplinas: discSanitizadas,
        importado_via_pdf_sed: true,
        importado_em: agoraISO,
        atualizadoEm: agoraISO
      };

      fnClonado[bKey] = payloadBimestre;
      updatePayload[`fechamento_notas.${bKey}`] = payloadBimestre;
      bimestresAtualizados.push(bKey);
    }
  }

  if (bimestresAtualizados.length === 0) {
    throw new Error('Nenhum bimestre com notas e faltas válidas selecionado para gravação.');
  }

  updatePayload.ultima_atualizacao_notas = agoraISO;
  if (parsedBoletim.aluno.escola) {
    updatePayload.escola_origem_transferencia = parsedBoletim.aluno.escola;
  }

  // 1. Atualizar no banco de dados MongoDB / Firestore
  const { doc, updateDoc, setDoc, db } = await import('../lib/database.ts');
  const studentDocRef = doc(db, 'alunos', raLimpo);
  try {
    await updateDoc(studentDocRef, updatePayload);
  } catch {
    await setDoc(studentDocRef, updatePayload, { merge: true });
  }

  // 2. Atualizar estado em memória global (window.allStudentsData)
  if (typeof window !== 'undefined' && Array.isArray((window as any).allStudentsData)) {
    const idx = (window as any).allStudentsData.findIndex((s: any) => String(s.ra).replace(/\D/g, '') === raLimpo);
    if (idx !== -1) {
      const st = (window as any).allStudentsData[idx];
      if (!st.fechamento_notas) st.fechamento_notas = {};
      bimestresAtualizados.forEach(k => {
        st.fechamento_notas[k] = fnClonado[k];
      });
      st.ultima_atualizacao_notas = agoraISO;
      if (parsedBoletim.aluno.escola) {
        st.escola_origem_transferencia = parsedBoletim.aluno.escola;
      }
    }
  }

  // 3. Atualizar currentAlunoModalData se estiver aberto
  if (typeof window !== 'undefined' && (window as any).currentAlunoModalData) {
    const modalRa = String((window as any).currentAlunoModalData.ra || '').replace(/\D/g, '');
    if (modalRa === raLimpo) {
      if (!(window as any).currentAlunoModalData.fechamento_notas) {
        (window as any).currentAlunoModalData.fechamento_notas = {};
      }
      bimestresAtualizados.forEach(k => {
        (window as any).currentAlunoModalData.fechamento_notas[k] = fnClonado[k];
      });
      (window as any).currentAlunoModalData.ultima_atualizacao_notas = agoraISO;
    }
  }

  // 4. Disparar evento para atualizar Comparativo e Dashboards
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('student-data-updated', { detail: { ra: raLimpo, fechamento_notas: fnClonado } }));
    if (typeof (window as any).atualizarVisualizacaoBoletimModal === 'function') {
      (window as any).atualizarVisualizacaoBoletimModal();
    }
  }

  return {
    sucesso: true,
    bimestresAtualizados,
    alunoAtualizado: { ...alunoTarget, fechamento_notas: fnClonado }
  };
}
