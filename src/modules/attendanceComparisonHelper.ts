// ============================================================================
// Comparativo de Presença: SED vs Mapão de Fechamento de Notas
// EE Clóvis de Lucca - Gestão Escolar PEI
// ============================================================================

export interface AttendanceComparisonResult {
  sedFreq: number | null; // Percentual SED (0 - 100) ou null se não houver
  sedFaltas: number | null; // Total de faltas no SED (se disponível)
  mapaoFreq: number | null; // Percentual Mapão (0 - 100) ou null se não houver
  mapaoFaltas: number | null; // Faltas totais no Mapão
  mapaoBimestre: string | null; // '1BIM' | '2BIM' | '3BIM' | '4BIM' | 'FINAL' ou null
  diff: number | null; // sedFreq - mapaoFreq (+ = SED maior/mais complacente, - = Mapão maior)
  status: 'divergente_critico' | 'divergente_alerta' | 'alinhado' | 'sem_mapao' | 'sem_sed' | 'sem_dados';
  mensagem: string;
  ajusteManual: boolean; // Indica se a frequência SED foi ajustada manualmente pela Direção
  motivoAjuste: string | null; // Motivo do caso especial / amparo legal
  justificativaAjuste: string | null;
}

/**
 * Normaliza um número percentual para o intervalo 0 - 100
 */
function parsePercentual(val: any): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    return Math.min(100, Math.max(0, val));
  }
  const limpo = String(val).replace('%', '').replace(',', '.').trim();
  const n = parseFloat(limpo);
  if (isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * Normaliza número inteiro de faltas
 */
function parseFaltas(val: any): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    return Math.max(0, Math.round(val));
  }
  const num = parseInt(String(val).replace(/\D/g, ''), 10);
  if (isNaN(num)) return null;
  return Math.max(0, num);
}

/**
 * Verifica se um fechamento bimestral do Mapão possui dados acadêmicos reais
 * (notas nas disciplinas, menções, média geral calculada ou avaliações).
 * Conforme regra da escola: NÃO se deve considerar a frequência do Mapão
 * quando não há nenhum outro dado; isso significa que o estudante foi transferido
 * após o fechamento do bimestre e não consta no Mapão da nossa escola.
 */
export function temDadosReaisNoMapao(bData: any): boolean {
  if (!bData || typeof bData !== 'object') return false;

  // 1. Situação explícita de transferência/remanejamento/cancelamento
  const situacao = String(bData.situacao || '').toUpperCase().trim();
  const isTransferido = situacao.includes('TRANSF') || 
                        situacao.includes('REMANEJ') || 
                        situacao.includes('CESSAD') || 
                        situacao.includes('CANCEL') ||
                        situacao.includes('NÃO CONSTA') ||
                        situacao.includes('NAO CONSTA');

  // 2. Média geral válida
  const hasMediaGeral = bData.mediaGeral !== null && 
                        bData.mediaGeral !== undefined && 
                        bData.mediaGeral !== '' && 
                        bData.mediaGeral !== '—' && 
                        !isNaN(Number(bData.mediaGeral));

  // 3. Disciplinas com notas ou menções registradas
  let hasDisciplinasComNotas = false;
  if (bData.disciplinas && typeof bData.disciplinas === 'object') {
    const listaDiscs = Object.values(bData.disciplinas);
    if (listaDiscs.length > 0) {
      hasDisciplinasComNotas = listaDiscs.some((d: any) => {
        if (!d) return false;
        const n = d.notaNum !== undefined ? d.notaNum : (d.nota !== undefined ? d.nota : d.valor);
        if (n !== null && n !== undefined && !isNaN(Number(n))) return true;
        if (d.mencaoNota && d.mencaoNota !== '—' && d.mencaoNota !== '' && d.mencaoNota !== 'N/A' && d.mencaoNota !== '-') return true;
        if (d.faltas !== undefined && d.faltas !== null && Number(d.faltas) > 0) return true;
        if (d.ausenciaCompensada && Number(d.ausenciaCompensada) > 0) return true;
        if (d.abaixoBasico === true) return true;
        return false;
      });
    }
  }

  // 4. Quantidade abaixo do básico ou lista de notas
  const hasOutrasNotas = (typeof bData.qtdAbaixoBasico === 'number' && bData.qtdAbaixoBasico > 0) ||
                         (Array.isArray(bData.notas) && bData.notas.some((nt: any) => nt !== null && nt !== undefined && nt !== '—' && nt !== ''));

  // Se for marcado como transferido e não tiver notas/disciplinas válidas, desconsiderar
  if (isTransferido && !hasMediaGeral && !hasDisciplinasComNotas && !hasOutrasNotas) {
    return false;
  }

  // DEVE possuir ao menos outro dado acadêmico no Mapão
  return hasMediaGeral || hasDisciplinasComNotas || hasOutrasNotas;
}

/**
 * Compara a presença registrada via SED com o Mapão de Fechamento de Notas para um estudante.
 */
export function compararFrequenciaAluno(aluno: any): AttendanceComparisonResult {
  const ajusteManual = !!(aluno?.frequencia_ajustada_direcao || aluno?.frequencia_atual?.ajuste_manual);
  const motivoAjuste = aluno?.motivo_ajuste_frequencia || aluno?.frequencia_atual?.motivo_ajuste || null;
  const justificativaAjuste = aluno?.justificativa_ajuste_frequencia || aluno?.frequencia_atual?.justificativa || null;

  if (!aluno) {
    return {
      sedFreq: null,
      sedFaltas: null,
      mapaoFreq: null,
      mapaoFaltas: null,
      mapaoBimestre: null,
      diff: null,
      status: 'sem_dados',
      mensagem: 'Aluno inválido ou sem registro',
      ajusteManual: false,
      motivoAjuste: null,
      justificativaAjuste: null
    };
  }

  // 1. Extrair frequência do SED
  let sedFreq: number | null = null;
  let sedFaltas: number | null = null;

  if (aluno.frequencia_atual && typeof aluno.frequencia_atual === 'object') {
    sedFreq = parsePercentual(
      aluno.frequencia_atual.presenca_percentual ??
      aluno.frequencia_atual.presenca ??
      aluno.frequencia_atual.porcentagem ??
      aluno.frequencia_atual.frequencia
    );
    sedFaltas = parseFaltas(
      aluno.frequencia_atual.faltas ??
      aluno.frequencia_atual.total_faltas ??
      aluno.frequencia_atual.faltas_total
    );
  }

  if (sedFreq === null) {
    sedFreq = parsePercentual(
      aluno.presenca_atual ??
      aluno.presenca_anual ??
      aluno.presenca_26_06 ??
      aluno.presenca ??
      aluno.frequencia
    );
  }

  if (sedFaltas === null) {
    sedFaltas = parseFaltas(
      aluno.total_faltas ??
      aluno.faltas ??
      aluno.faltasTotalAno ??
      aluno.faltas_ano
    );
  }

  // 2. Extrair presença do Mapão (exatamente a média dos bimestres que constam no módulo Boletim do Dossiê)
  let mapaoFreq: number | null = null;
  let mapaoFaltas: number | null = null;
  let mapaoBimestre: string | null = null;

  let fn = aluno.fechamento_notas || aluno.fechamentos || aluno.notas || aluno.boletim || {};
  if (typeof fn === 'string') {
    try {
      fn = JSON.parse(fn);
    } catch {
      fn = {};
    }
  }

  if (fn && typeof fn === 'object') {
    // Bimestres padrão mapeados no fechamento/boletim (1B, 2B, 3B, 4B)
    const bimestresConfig = [
      { keys: ['1B', '1BIM', '1ºB', '1bim', '1', '1º'], label: '1ºB' },
      { keys: ['2B', '2BIM', '2ºB', '2bim', '2', '2º'], label: '2ºB' },
      { keys: ['3B', '3BIM', '3ºB', '3bim', '3', '3º'], label: '3ºB' },
      { keys: ['4B', '4BIM', '4ºB', '4bim', '4', '4º'], label: '4ºB' }
    ];

    const bimestresValidos: { label: string; freq: number; faltas: number }[] = [];

    for (const cfg of bimestresConfig) {
      let bData: any = null;
      for (const k of cfg.keys) {
        if (fn[k]) {
          bData = fn[k];
          break;
        }
      }

      if (bData && typeof bData === 'object') {
        // REGRA CRÍTICA: Não considerar a frequência do Mapão quando não há nenhum outro dado.
        // Isso significa que o estudante foi transferido após o fechamento do bimestre e não consta no Mapão.
        if (!temDadosReaisNoMapao(bData)) {
          continue;
        }

        // Campo oficial do fechamento: frequenciaBimestre (ex: "95,0%" ou "95%"),
        // com fallbacks para frequenciaTotalAno, frequencia, presenca, freq
        const freqRaw = bData.frequenciaBimestre ?? bData.frequenciaTotalAno ?? bData.frequencia ?? bData.presenca ?? bData.freq ?? bData.porcentagem;
        let freqVal = parsePercentual(freqRaw);

        // Fallback: calcular a partir do total de aulas e faltas do bimestre se a porcentagem não vier explícita
        if (freqVal === null && bData.totalAulasDadas && bData.totalAulasDadas > 0 && bData.totalFaltas !== undefined) {
          const f = parseFaltas(bData.totalFaltas) || 0;
          freqVal = Math.max(0, Math.min(100, Math.round((1 - (f / bData.totalAulasDadas)) * 1000) / 10));
        }

        const faltasRaw = bData.totalFaltas ?? bData.faltas ?? bData.faltasTotalAno;
        const faltasVal = parseFaltas(faltasRaw) || 0;

        if (freqVal !== null) {
          bimestresValidos.push({ label: cfg.label, freq: freqVal, faltas: faltasVal });
        }
      }
    }

    const bFinal = fn['FINAL'] || fn['final'] || fn['Final'] || fn['Conselho Final'] || fn['CONSELHO_FINAL'];

    // Se encontramos bimestres com presença no boletim, calculamos a MÉDIA
    if (bimestresValidos.length > 0) {
      const somaFreq = bimestresValidos.reduce((acc, curr) => acc + curr.freq, 0);
      mapaoFreq = Math.round((somaFreq / bimestresValidos.length) * 10) / 10;
      mapaoBimestre = bimestresValidos.length > 1
        ? `Média (${bimestresValidos.map(b => b.label).join(', ')})`
        : bimestresValidos[0].label;

      // Faltas: exatamente a lógica do Boletim do Dossiê:
      // se houver faltas acumuladas no bFinal, utiliza; senão, soma dos bimestres
      const faltasFinal = (bFinal && temDadosReaisNoMapao(bFinal)) ? parseFaltas(bFinal.totalFaltas ?? bFinal.faltasTotalAno ?? bFinal.faltas) : null;
      if (faltasFinal !== null && faltasFinal > 0) {
        mapaoFaltas = faltasFinal;
      } else {
        mapaoFaltas = bimestresValidos.reduce((acc, curr) => acc + curr.faltas, 0);
      }
    } else if (bFinal && typeof bFinal === 'object' && temDadosReaisNoMapao(bFinal)) {
      // Se não há 1B..4B mas há fechamento FINAL com dados reais
      const freqFinalRaw = bFinal.frequenciaBimestre ?? bFinal.frequenciaTotalAno ?? bFinal.frequencia ?? bFinal.presenca ?? bFinal.freq;
      const freqFinalVal = parsePercentual(freqFinalRaw);
      if (freqFinalVal !== null) {
        mapaoFreq = freqFinalVal;
        mapaoBimestre = 'Final';
        mapaoFaltas = parseFaltas(bFinal.totalFaltas ?? bFinal.faltasTotalAno ?? bFinal.faltas);
      }
    } else if (Object.keys(fn).length > 0) {
      // Varredura dinâmica para outras estruturas de chaves no fechamento
      const bimsDinamicos: { label: string; freq: number; faltas: number }[] = [];
      Object.entries(fn).forEach(([k, bData]: [string, any]) => {
        if (bData && typeof bData === 'object' && k !== 'FINAL' && k !== 'final') {
          // Ignorar se não possuir nenhum outro dado acadêmico no Mapão
          if (!temDadosReaisNoMapao(bData)) return;

          const freqRaw = bData.frequenciaBimestre ?? bData.frequenciaTotalAno ?? bData.frequencia ?? bData.presenca ?? bData.freq;
          const freqVal = parsePercentual(freqRaw);
          if (freqVal !== null) {
            bimsDinamicos.push({
              label: bData.bimestre ? `${bData.bimestre}ºB` : k,
              freq: freqVal,
              faltas: parseFaltas(bData.totalFaltas ?? bData.faltas) || 0
            });
          }
        }
      });

      if (bimsDinamicos.length > 0) {
        const soma = bimsDinamicos.reduce((acc, curr) => acc + curr.freq, 0);
        mapaoFreq = Math.round((soma / bimsDinamicos.length) * 10) / 10;
        mapaoBimestre = bimsDinamicos.length > 1
          ? `Média (${bimsDinamicos.map(b => b.label).join(', ')})`
          : bimsDinamicos[0].label;
        mapaoFaltas = bimsDinamicos.reduce((acc, curr) => acc + curr.faltas, 0);
      }
    }
  }

  // 3. Calcular Diferença e Classificação de Risco
  if (sedFreq === null && mapaoFreq === null) {
    return {
      sedFreq: null,
      sedFaltas,
      mapaoFreq: null,
      mapaoFaltas,
      mapaoBimestre,
      diff: null,
      status: 'sem_dados',
      mensagem: 'Sem dados de frequência da SED e do Mapão',
      ajusteManual,
      motivoAjuste,
      justificativaAjuste
    };
  }

  if (sedFreq === null) {
    return {
      sedFreq: null,
      sedFaltas,
      mapaoFreq,
      mapaoFaltas,
      mapaoBimestre,
      diff: null,
      status: 'sem_sed',
      mensagem: 'Presente no Mapão, porém sem carga recente da SED',
      ajusteManual,
      motivoAjuste,
      justificativaAjuste
    };
  }

  if (mapaoFreq === null) {
    return {
      sedFreq,
      sedFaltas,
      mapaoFreq: null,
      mapaoFaltas,
      mapaoBimestre,
      diff: null,
      status: 'sem_mapao',
      mensagem: 'Presença SED disponível; não consta no Mapão da escola (estudante transferido após o fechamento ou sem notas registradas)',
      ajusteManual,
      motivoAjuste,
      justificativaAjuste
    };
  }

  // Diferença: SED - Mapão
  // Ex: SED = 85%, Mapão = 70% -> diff = +15% (Atenção: SED muito mais alto que o fechamento real do professor)
  const diff = Math.round((sedFreq - mapaoFreq) * 10) / 10;
  const absDiff = Math.abs(diff);

  let status: AttendanceComparisonResult['status'] = 'alinhado';
  let mensagem = 'Presenças alinhadas entre SED e Mapão';

  if (absDiff >= 15) {
    status = 'divergente_critico';
    mensagem = diff > 0 
      ? `SED (${sedFreq}%) está +${absDiff}% superior ao Mapão (${mapaoFreq}%)`
      : `Mapão (${mapaoFreq}%) está +${absDiff}% superior ao SED (${sedFreq}%)`;
  } else if (absDiff >= 5) {
    status = 'divergente_alerta';
    mensagem = diff > 0 
      ? `SED (${sedFreq}%) diverge +${absDiff}% do Mapão (${mapaoFreq}%)`
      : `Mapão (${mapaoFreq}%) diverge +${absDiff}% do SED (${sedFreq}%)`;
  }

  return {
    sedFreq,
    sedFaltas,
    mapaoFreq,
    mapaoFaltas,
    mapaoBimestre,
    diff,
    status,
    mensagem,
    ajusteManual,
    motivoAjuste,
    justificativaAjuste
  };
}

// ============================================================================
// Auditoria de Bimestres / Mapão Não Exportado (Estudantes Transferidos)
// ============================================================================

export const BIMESTRES_MAPAO_CONFIG = [
  { key: '1B', label: '1ºB', nome: '1º Bimestre', aliases: ['1B', '1BIM', '1ºB', '1bim', '1', '1º'] },
  { key: '2B', label: '2ºB', nome: '2º Bimestre', aliases: ['2B', '2BIM', '2ºB', '2bim', '2', '2º'] },
  { key: '3B', label: '3ºB', nome: '3º Bimestre', aliases: ['3B', '3BIM', '3ºB', '3bim', '3', '3º'] },
  { key: '4B', label: '4ºB', nome: '4º Bimestre', aliases: ['4B', '4BIM', '4ºB', '4bim', '4', '4º'] },
];

export interface StatusBimestreAluno {
  bimestreKey: string;
  label: string;
  nome: string;
  exportado: boolean;
  motivo?: string;
  mediaGeral?: number | null;
  frequencia?: number | null;
  faltas?: number | null;
}

export interface AnaliseMapaoTransferidoResult {
  aluno: any;
  ra: string;
  nome: string;
  turma: string;
  tutor: string;
  comparison: AttendanceComparisonResult;
  bimestresStatus: StatusBimestreAluno[];
  bimestresExportados: string[]; // labels, ex: ['2ºB']
  bimestresFaltando: string[]; // labels, ex: ['1ºB']
  bimestresEsperados: string[]; // labels esperados
  temPendencia: boolean;
  motivoDiagnostico: string;
  isProvavelTransferido: boolean;
  bimestreSugeridoParaDigitacao: string; // '1B', '2B', etc.
}

/**
 * Analisa a integridade dos bimestres do Mapão para um estudante específico,
 * identificando bimestres não exportados, ausentes ou pendentes de fechamento
 * (comum em estudantes matriculados via transferência no meio do ano).
 */
export function analisarBimestresAluno(
  aluno: any,
  bimestresEsperadosKeys: string[],
  comparison?: AttendanceComparisonResult
): AnaliseMapaoTransferidoResult {
  const comp = comparison || compararFrequenciaAluno(aluno);
  const ra = String(aluno?.ra || aluno?.docId || aluno?.id || '-');
  const nome = String(aluno?.nome || 'Aluno Sem Nome');
  const turma = String(aluno?.turma || '-').toUpperCase();
  const tutor = String(aluno?.tutor_2026 || aluno?.tutor || 'Não atribuído');

  let fn = aluno?.fechamento_notas || aluno?.fechamentos || aluno?.notas || aluno?.boletim || {};
  if (typeof fn === 'string') {
    try {
      fn = JSON.parse(fn);
    } catch {
      fn = {};
    }
  }

  const bimestresStatus: StatusBimestreAluno[] = [];
  const bimestresExportados: string[] = [];
  const bimestresFaltando: string[] = [];

  // Avaliar os bimestres esperados para a turma/escola
  for (const cfg of BIMESTRES_MAPAO_CONFIG) {
    if (!bimestresEsperadosKeys.includes(cfg.key)) {
      continue;
    }

    let bData: any = null;
    for (const alias of cfg.aliases) {
      if (fn && fn[alias]) {
        bData = fn[alias];
        break;
      }
    }

    const temDados = temDadosReaisNoMapao(bData);
    if (temDados) {
      const mediaRaw = bData.mediaGeral !== undefined && bData.mediaGeral !== null && bData.mediaGeral !== '—' 
        ? Number(bData.mediaGeral) 
        : null;
      const freqRaw = bData.frequenciaBimestre ?? bData.frequenciaTotalAno ?? bData.frequencia ?? bData.presenca ?? bData.freq;
      const faltasRaw = bData.totalFaltas ?? bData.faltas ?? bData.faltasTotalAno;

      bimestresStatus.push({
        bimestreKey: cfg.key,
        label: cfg.label,
        nome: cfg.nome,
        exportado: true,
        mediaGeral: mediaRaw !== null && !isNaN(mediaRaw) ? Math.round(mediaRaw * 10) / 10 : null,
        frequencia: parsePercentual(freqRaw),
        faltas: parseFaltas(faltasRaw)
      });
      bimestresExportados.push(cfg.label);
    } else {
      let motivo = 'Não consta no Mapão da turma';
      if (bData && typeof bData === 'object') {
        const sit = String(bData.situacao || '').toUpperCase();
        if (sit.includes('TRANSF') || sit.includes('TRANSFER')) {
          motivo = 'Marcado como transferido no fechamento';
        } else if (sit.includes('NÃO CONSTA') || sit.includes('NAO CONSTA')) {
          motivo = 'Consta como "Não Consta" na planilha';
        } else if (sit.includes('CESSAD') || sit.includes('REMANEJ')) {
          motivo = 'Matrícula remanejada/cessada';
        } else {
          motivo = 'Sem notas ou menções lançadas';
        }
      }

      bimestresStatus.push({
        bimestreKey: cfg.key,
        label: cfg.label,
        nome: cfg.nome,
        exportado: false,
        motivo,
        mediaGeral: null,
        frequencia: null,
        faltas: null
      });
      bimestresFaltando.push(cfg.label);
    }
  }

  // Verificar se há indicação explícita ou padrão de estudante transferido
  const textoStatus = String(aluno?.situacao || aluno?.status_matricula || aluno?.historico || aluno?.observacoes || '').toUpperCase();
  const temFlagTransferido = textoStatus.includes('TRANSF') || textoStatus.includes('REMANEJ') || textoStatus.includes('MUDOU') || textoStatus.includes('VEIO');

  const semNenhumMapao = bimestresExportados.length === 0;
  const temPendencia = bimestresFaltando.length > 0 || comp.status === 'sem_mapao';
  const isProvavelTransferido = temFlagTransferido || semNenhumMapao || (bimestresExportados.length > 0 && bimestresFaltando.length > 0);

  // Diagnóstico pedagógico contextualizado
  let motivoDiagnostico = '';
  if (semNenhumMapao) {
    motivoDiagnostico = 'Sem nenhum Mapão exportado no ano letivo (apenas frequência SED — provável transferência escolar ou aguardando digitação de histórico)';
  } else if (bimestresExportados.includes('2ºB') && bimestresFaltando.includes('1ºB')) {
    motivoDiagnostico = 'Sem Mapão do 1º Bimestre — Provável transferência externa matriculado a partir do 2º Bimestre';
  } else if (bimestresExportados.includes('1ºB') && bimestresFaltando.includes('2ºB')) {
    motivoDiagnostico = 'Sem Mapão do 2º Bimestre — Transferência recente, remanejamento ou pendência de fechamento docente';
  } else if (bimestresFaltando.length > 0) {
    motivoDiagnostico = `Pendente nos bimestres: ${bimestresFaltando.join(', ')} (turma possui fechamento exportado)`;
  } else {
    motivoDiagnostico = 'Todos os bimestres disponíveis foram consolidados no Mapão';
  }

  const primeiroFaltando = bimestresStatus.find(b => !b.exportado);
  const bimestreSugeridoParaDigitacao = primeiroFaltando ? primeiroFaltando.bimestreKey : '1B';

  const labelsEsperados = BIMESTRES_MAPAO_CONFIG
    .filter(c => bimestresEsperadosKeys.includes(c.key))
    .map(c => c.label);

  return {
    aluno,
    ra,
    nome,
    turma,
    tutor,
    comparison: comp,
    bimestresStatus,
    bimestresExportados,
    bimestresFaltando,
    bimestresEsperados: labelsEsperados,
    temPendencia,
    motivoDiagnostico,
    isProvavelTransferido,
    bimestreSugeridoParaDigitacao
  };
}

// Tornar disponível globalmente para módulos legados
if (typeof window !== 'undefined') {
  (window as any).compararFrequenciaAluno = compararFrequenciaAluno;
  (window as any).analisarBimestresAluno = analisarBimestresAluno;
}
