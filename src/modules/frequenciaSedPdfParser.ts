/**
 * src/modules/frequenciaSedPdfParser.ts
 * Parser de Alta Precisão para o "Relatório de Consulta da Frequência" oficial da SED (Secretaria da Educação SP)
 * Processa relatórios diários de presenças (dias 1 a 31) por Turma, calcula aulas dadas,
 * detecta se o aluno parou de faltar ou continua ausente, e pareia estritamente por RA.
 */

export interface TendenciaPresencaRecente {
  status: 'PAROU_DE_FALTAR' | 'CONTINUA_FALTANDO' | 'OSCILANTE' | '100_PRESENTE';
  label: string;
  badgeClass: string;
  pctRecente: number;
  diasSeguidosPresente: number;
  diasSeguidosFaltando: number;
  ultimaPresencaDia: number | null;
  descricao: string;
}

export interface AlunoFrequenciaDiaria {
  numChamada: number;
  nome: string;
  ra: string;
  raClean: string;
  raDigito?: string;
  uf?: string;
  diasPresenca: Record<number, number>; // dia 1..31 -> aulas presentes no dia
  totalPresencas: number;
  totalAulasDadas: number;
  totalFaltas: number;
  pctPresenca: number;
  situacaoFrequencia: 'CRITICO' | 'ATENCAO' | 'REGULAR'; // <75% = CRITICO, 75-84% = ATENCAO, >=85% = REGULAR
  tendenciaRecente: TendenciaPresencaRecente;
  alunoCadastrado?: any | null; // Aluno correspondente no banco Clóvis
  raEncontradoNoBanco: boolean;
}

export interface FrequenciaTurmaParsedResult {
  sucesso: boolean;
  mensagem?: string;
  turma: string;
  turmaNormalizada: string;
  mes: string;
  anoLetivo: number;
  disciplina: string;
  escola: string;
  diretoria?: string;
  tipoEnsino?: string;
  tipoRelatorio: 'Presenças' | 'Faltas';
  totalAulasDadas: number;
  diasLetivosCount: number;
  aulasDadasPorDia: Record<number, number>; // dia 1..31 -> max aulas dadas na turma
  taxaPresencaMediaTurma: number;
  alunos: AlunoFrequenciaDiaria[];
  totais: {
    totalAlunos: number;
    alunosAtivosEncontrados: number;
    alunosRiscoCritico: number; // < 75% (Demanda Busca Ativa)
    alunosAtencao: number;      // 75% a 84%
    alunos100Presenca: number;   // 100% assiduidade
    alunosPararamDeFaltar: number; // Retomaram presença recentemente
    alunosContinuamFaltando: number; // Ausentes nas últimas aulas
  };
  analiseDiasSemana: Record<string, { totalAulas: number; totalPresencas: number; taxa: number }>;
}

export interface FrequenciaMultiTurmasResult {
  sucesso: boolean;
  mensagem: string;
  turmas: FrequenciaTurmaParsedResult[];
  totaisGerais: {
    totalTurmas: number;
    totalEstudantes: number;
    totalAulasDadasGeral: number;
    mediaPresencaGeral: number;
    alunosRiscoCritico: number;
    alunosPararamDeFaltar: number;
    alunosContinuamFaltando: number;
    alunos100Presenca: number;
  };
}

/**
 * Normaliza o nome da turma da SED para o padrão da escola (ex: "6° Ano A Integral 7H T1 Anual" -> "6º ANO A")
 */
export function normalizarNomeTurmaSED(turmaRaw?: string): string {
  if (!turmaRaw) return 'TURMA NÃO IDENTIFICADA';
  let t = turmaRaw.trim().toUpperCase();

  t = t.replace(/°/g, 'º').replace(/ª/g, 'ª');

  const matchAno = t.match(/([1-9])\s*[ºo°]?\s*(?:ANO|SERIE|SÉRIE)?\s*([A-Z])/i);
  if (matchAno) {
    const num = matchAno[1];
    const letra = matchAno[2].toUpperCase();
    const isSerie = t.includes('SERIE') || t.includes('SÉRIE') || t.includes('EM') || t.includes('MÉDIO');
    return `${num}º ${isSerie ? 'SÉRIE' : 'ANO'} ${letra}`;
  }

  const matchCurto = t.match(/^([1-9])([A-Z])$/);
  if (matchCurto) {
    return `${matchCurto[1]}º ANO ${matchCurto[2]}`;
  }

  return t.replace(/\s+INTEGRAL.*$/i, '').trim();
}

/**
 * Limpa e padroniza o RA para comparação estrita (remove zeros à esquerda e caracteres não numéricos)
 */
export function normalizarRaSED(raRaw?: string): { raLimpo: string; raFormatado: string; digito: string } {
  if (!raRaw) return { raLimpo: '', raFormatado: '', digito: '' };
  const str = String(raRaw).trim().toUpperCase();
  
  let digito = '';
  const dMatch = str.match(/-([0-9Xx])/);
  if (dMatch) {
    digito = dMatch[1].toUpperCase();
  }

  const raApenasDigitos = str.replace(/\D/g, '');
  const raSemZeros = raApenasDigitos.replace(/^0+/, '');

  return {
    raLimpo: raSemZeros,
    raFormatado: str,
    digito
  };
}

/**
 * Calcula a tendência recente de frequência do estudante (se parou de faltar, continua ausente ou oscila)
 */
export function calcularTendenciaRecente(
  diasPresenca: Record<number, number>,
  pctTotalPresenca: number,
  listaDiasLetivos: number[],
  aulasDadasPorDia: Record<number, number>
): TendenciaPresencaRecente {
  if (listaDiasLetivos.length === 0) {
    return {
      status: 'OSCILANTE',
      label: 'Sem Dados Recentes',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      pctRecente: 100,
      diasSeguidosPresente: 0,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia: null,
      descricao: 'Sem dias letivos apurados no mês.'
    };
  }

  // Identifica o último dia com presença registrada
  let ultimaPresencaDia: number | null = null;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    if ((diasPresenca[d] || 0) > 0) {
      ultimaPresencaDia = d;
      break;
    }
  }

  // Janela dos últimos dias letivos (últimos 5 a 7 dias com aula na turma)
  const janelaTamanho = Math.min(5, listaDiasLetivos.length);
  const janelaRecente = listaDiasLetivos.slice(-janelaTamanho);

  let aulasRecentes = 0;
  let presencasRecentes = 0;
  for (const d of janelaRecente) {
    aulasRecentes += (aulasDadasPorDia[d] || 0);
    presencasRecentes += (diasPresenca[d] || 0);
  }

  const pctRecente = aulasRecentes > 0 
    ? Number(((presencasRecentes / aulasRecentes) * 100).toFixed(1))
    : 100;

  // Contagem de dias seguidos presente (do último dia letivo apurado para trás)
  let diasSeguidosPresente = 0;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    const aulasDia = aulasDadasPorDia[d] || 0;
    const presencaDia = diasPresenca[d] || 0;
    if (aulasDia > 0 && presencaDia >= (aulasDia * 0.7)) {
      diasSeguidosPresente++;
    } else {
      break;
    }
  }

  // Contagem de dias seguidos ausente (do último dia letivo apurado para trás)
  let diasSeguidosFaltando = 0;
  for (let i = listaDiasLetivos.length - 1; i >= 0; i--) {
    const d = listaDiasLetivos[i];
    const aulasDia = aulasDadasPorDia[d] || 0;
    const presencaDia = diasPresenca[d] || 0;
    if (aulasDia > 0 && presencaDia === 0) {
      diasSeguidosFaltando++;
    } else {
      break;
    }
  }

  // 1. Assiduidade Perfeita
  if (pctTotalPresenca >= 100) {
    return {
      status: '100_PRESENTE',
      label: '100% Assíduo',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-black',
      pctRecente: 100,
      diasSeguidosPresente,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia,
      descricao: 'Presença exemplar em todas as aulas dadas.'
    };
  }

  // 2. Parou de Faltar / Retomou Frequência
  // Se o aluno teve 3+ dias seguidos presente recentemente ou compareceu em >= 80% das aulas recentes sem faltas nos últimos 2 dias:
  if (diasSeguidosPresente >= 3 || (pctRecente >= 80 && diasSeguidosFaltando === 0)) {
    return {
      status: 'PAROU_DE_FALTAR',
      label: '✓ Parou de Faltar (Retomou)',
      badgeClass: 'bg-teal-100 text-teal-900 border-teal-300 font-black',
      pctRecente,
      diasSeguidosPresente,
      diasSeguidosFaltando: 0,
      ultimaPresencaDia,
      descricao: `Retomou a frequência escolar! Compareceu em ${pctRecente}% das aulas recentes (${diasSeguidosPresente} dias seguidos presente). A intervenção surtiu efeito!`
    };
  }

  // 3. Continua Faltando / Ausente Recentemente
  if (diasSeguidosFaltando >= 2 || pctRecente < 35) {
    return {
      status: 'CONTINUA_FALTANDO',
      label: '⚠️ Continua Faltando',
      badgeClass: 'bg-rose-100 text-rose-900 border-rose-300 font-black',
      pctRecente,
      diasSeguidosPresente: 0,
      diasSeguidosFaltando,
      ultimaPresencaDia,
      descricao: `Alerta: o estudante continua ausente nas aulas recentes (última presença registrada: dia ${ultimaPresencaDia ? `${ultimaPresencaDia}` : 'não identificada'}). Demanda busca ativa imediata!`
    };
  }

  // 4. Presença Oscilante / Parcial
  return {
    status: 'OSCILANTE',
    label: '⚡ Presença Oscilante',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
    pctRecente,
    diasSeguidosPresente,
    diasSeguidosFaltando,
    ultimaPresencaDia,
    descricao: `Frequência oscilante: compareceu em ${pctRecente}% das aulas recentes. Recomendada conversa de alinhamento com a tutoria.`
  };
}

/**
 * Analisa o texto bruto de um "Relatório de Consulta da Frequência" da SED
 */
export function parseRelatorioFrequenciaSED(textoBruto: string, baseAlunosEscola: any[] = []): FrequenciaTurmaParsedResult {
  if (!textoBruto || typeof textoBruto !== 'string' || textoBruto.trim().length === 0) {
    return {
      sucesso: false,
      mensagem: 'Texto do relatório está vazio ou inválido.',
      turma: '',
      turmaNormalizada: '',
      mes: '',
      anoLetivo: 2026,
      disciplina: '',
      escola: '',
      tipoRelatorio: 'Presenças',
      totalAulasDadas: 0,
      diasLetivosCount: 0,
      aulasDadasPorDia: {},
      taxaPresencaMediaTurma: 0,
      alunos: [],
      totais: {
        totalAlunos: 0,
        alunosAtivosEncontrados: 0,
        alunosRiscoCritico: 0,
        alunosAtencao: 0,
        alunos100Presenca: 0,
        alunosPararamDeFaltar: 0,
        alunosContinuamFaltando: 0
      },
      analiseDiasSemana: {}
    };
  }

  // 1. Extração de Cabeçalho Institucional
  const anoMatch = textoBruto.match(/Ano Letivo:\s*(\d{4})/i);
  const anoLetivo = anoMatch ? parseInt(anoMatch[1], 10) : new Date().getFullYear();

  const mesMatch = textoBruto.match(/(Janeiro|Fevereiro|Março|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)/i);
  const mes = mesMatch ? mesMatch[1] : 'Mês Não Identificado';

  const tipoRelatorioMatch = textoBruto.match(/(Presenças|Faltas)/i);
  const tipoRelatorio = (tipoRelatorioMatch && tipoRelatorioMatch[1].toLowerCase().includes('falta')) ? 'Faltas' : 'Presenças';

  const turmaMatch = textoBruto.match(/Turma:\s*([^\n\r]+)/i);
  const turmaRaw = turmaMatch ? turmaMatch[1].trim() : '';
  const turmaNormalizada = normalizarNomeTurmaSED(turmaRaw);

  const discMatch = textoBruto.match(/Disciplina:\s*([^\n\r]+)/i);
  const disciplina = discMatch ? discMatch[1].trim() : 'TODAS AS DISCIPLINAS (GLOBAL)';

  const escolaMatch = textoBruto.match(/Escola:\s*([^\n\r]+)/i);
  const escola = escolaMatch ? escolaMatch[1].trim() : 'EE Prof. Clóvis de Lucca';

  const dirMatch = textoBruto.match(/Diretoria:\s*([^\n\r]+)/i);
  const diretoria = dirMatch ? dirMatch[1].trim() : 'São Bernardo do Campo';

  const tipoEnsinoMatch = textoBruto.match(/Tipo de Ensino:\s*([^\n\r]+)/i);
  const tipoEnsino = tipoEnsinoMatch ? tipoEnsinoMatch[1].trim() : '';

  // 2. Extração dos Estudantes e Presenças Diárias
  const lines = textoBruto.split(/\r?\n/);
  const alunosTemp: {
    numChamada: number;
    nome: string;
    ra: string;
    raClean: string;
    diasPresenca: Record<number, number>;
    totalDeclarado: number;
  }[] = [];

  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) continue;

    if (
      l.startsWith('Relatório') ||
      l.startsWith('Ano Letivo') ||
      l.startsWith('Diretoria') ||
      l.startsWith('Tipo') ||
      l.startsWith('N°') ||
      l.startsWith('Nº') ||
      l.startsWith('Nome RA') ||
      l.startsWith('--') ||
      l.startsWith('Escola:') ||
      l.startsWith('Turma:') ||
      l.startsWith('Disciplina:')
    ) {
      continue;
    }

    const match = l.match(/^(\d+)\s+(.+?)\s+(\d{8,15}[-0-9Xx]*(?:\s*\/\s*[A-Z]{2})?)\s+([\d\s-]+?)\s+(\d+)$/);
    if (match) {
      const numChamada = parseInt(match[1], 10);
      const nome = match[2].trim().toUpperCase();
      const raOriginal = match[3].trim().toUpperCase();
      const { raLimpo } = normalizarRaSED(raOriginal);
      const diasTokens = match[4].trim().split(/\s+/);
      const totalDeclarado = parseInt(match[5], 10);

      const diasPresenca: Record<number, number> = {};
      diasTokens.forEach((val, idx) => {
        const diaNum = idx + 1;
        if (diaNum <= 31) {
          diasPresenca[diaNum] = val === '-' ? 0 : (parseInt(val, 10) || 0);
        }
      });

      alunosTemp.push({
        numChamada,
        nome,
        ra: raOriginal,
        raClean: raLimpo,
        diasPresenca,
        totalDeclarado
      });
    }
  }

  // 3. Cálculo Matemático de Aulas Dadas por Dia (Fidedigno por Exceção)
  const aulasDadasPorDia: Record<number, number> = {};
  let totalAulasDadasTurma = 0;
  let diasLetivosCount = 0;
  const listaDiasLetivos: number[] = [];

  for (let dia = 1; dia <= 31; dia++) {
    let maxAulasDia = 0;
    for (const a of alunosTemp) {
      const p = a.diasPresenca[dia] || 0;
      if (p > maxAulasDia) {
        maxAulasDia = p;
      }
    }
    aulasDadasPorDia[dia] = maxAulasDia;
    if (maxAulasDia > 0) {
      totalAulasDadasTurma += maxAulasDia;
      diasLetivosCount++;
      listaDiasLetivos.push(dia);
    }
  }

  // 4. Mapeamento da Base Escolar Existente por RA
  const mapaBaseAlunosPorRa = new Map<string, any>();
  const mapaBaseAlunosPorNome = new Map<string, any>();

  if (Array.isArray(baseAlunosEscola)) {
    baseAlunosEscola.forEach(al => {
      if (!al) return;
      const { raLimpo } = normalizarRaSED(al.ra);
      if (raLimpo) {
        mapaBaseAlunosPorRa.set(raLimpo, al);
      }
      const nUpper = String(al.nome || '').trim().toUpperCase();
      if (nUpper) {
        mapaBaseAlunosPorNome.set(nUpper, al);
      }
    });
  }

  // 5. Consolidação por Estudante e Análise de Tendência
  const alunosFinais: AlunoFrequenciaDiaria[] = [];
  let somaPorcentagens = 0;
  let countCriticos = 0;
  let countAtencao = 0;
  let count100 = 0;
  let countAtivosEncontrados = 0;
  let countPararamDeFaltar = 0;
  let countContinuamFaltando = 0;

  alunosTemp.forEach(a => {
    let totalPresencasCalculadas = 0;
    for (let d = 1; d <= 31; d++) {
      totalPresencasCalculadas += (a.diasPresenca[d] || 0);
    }

    const totalPresencas = (a.totalDeclarado > 0 && Math.abs(a.totalDeclarado - totalPresencasCalculadas) <= 5)
      ? a.totalDeclarado
      : totalPresencasCalculadas;

    const totalFaltas = Math.max(0, totalAulasDadasTurma - totalPresencas);
    const pctPresenca = totalAulasDadasTurma > 0
      ? Number(((totalPresencas / totalAulasDadasTurma) * 100).toFixed(1))
      : 100;

    let situacaoFrequencia: 'CRITICO' | 'ATENCAO' | 'REGULAR' = 'REGULAR';
    if (pctPresenca < 75) {
      situacaoFrequencia = 'CRITICO';
      countCriticos++;
    } else if (pctPresenca < 85) {
      situacaoFrequencia = 'ATENCAO';
      countAtencao++;
    } else {
      if (pctPresenca >= 100) count100++;
    }

    somaPorcentagens += pctPresenca;

    // Cálculo da Tendência Recente (Se parou de faltar ou continua ausente)
    const tendenciaRecente = calcularTendenciaRecente(
      a.diasPresenca,
      pctPresenca,
      listaDiasLetivos,
      aulasDadasPorDia
    );

    if (tendenciaRecente.status === 'PAROU_DE_FALTAR') {
      countPararamDeFaltar++;
    } else if (tendenciaRecente.status === 'CONTINUA_FALTANDO') {
      countContinuamFaltando++;
    }

    // Pareamento com base escolar existente
    const correspondente = mapaBaseAlunosPorRa.get(a.raClean) || mapaBaseAlunosPorNome.get(a.nome) || null;
    if (correspondente) {
      countAtivosEncontrados++;
    }

    alunosFinais.push({
      numChamada: a.numChamada,
      nome: a.nome,
      ra: a.ra,
      raClean: a.raClean,
      diasPresenca: a.diasPresenca,
      totalPresencas,
      totalAulasDadas: totalAulasDadasTurma,
      totalFaltas,
      pctPresenca,
      situacaoFrequencia,
      tendenciaRecente,
      alunoCadastrado: correspondente,
      raEncontradoNoBanco: Boolean(correspondente)
    });
  });

  const taxaPresencaMediaTurma = alunosFinais.length > 0
    ? Number((somaPorcentagens / alunosFinais.length).toFixed(1))
    : 0;

  return {
    sucesso: alunosFinais.length > 0,
    mensagem: alunosFinais.length > 0 
      ? `Relatório processado: ${alunosFinais.length} estudantes e ${totalAulasDadasTurma} aulas dadas apuradas.`
      : 'Nenhum estudante identificado no documento.',
    turma: turmaRaw,
    turmaNormalizada,
    mes,
    anoLetivo,
    disciplina,
    escola,
    diretoria,
    tipoEnsino,
    tipoRelatorio,
    totalAulasDadas: totalAulasDadasTurma,
    diasLetivosCount,
    aulasDadasPorDia,
    taxaPresencaMediaTurma,
    alunos: alunosFinais.sort((x, y) => x.pctPresenca - y.pctPresenca),
    totais: {
      totalAlunos: alunosFinais.length,
      alunosAtivosEncontrados: countAtivosEncontrados,
      alunosRiscoCritico: countCriticos,
      alunosAtencao: countAtencao,
      alunos100Presenca: count100,
      alunosPararamDeFaltar: countPararamDeFaltar,
      alunosContinuamFaltando: countContinuamFaltando
    },
    analiseDiasSemana: {}
  };
}
