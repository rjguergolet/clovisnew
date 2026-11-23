import React, { useMemo, useState } from 'react';
import { AlunoNormalizado } from '../../modules/inteligenciaDataEngine';

interface Dashboard8AprovacaoSPProps {
  alunos: AlunoNormalizado[];
  userRoleNorm: string;
  onAbrirBuscaAtiva: (aluno: AlunoNormalizado) => void;
}

type PeriodoApuracao = 'ANUAL' | '1B' | '2B' | '3B' | '4B';

type NivelRiscoRetencao =
  | 'RETENCAO_DUPLA'
  | 'RETENCAO_FREQUENCIA'
  | 'RETENCAO_NOTAS'
  | 'NAO_CERTIFICACAO_3EM'
  | 'PROGRESSAO_PARCIAL'
  | 'MARGEM_LIMITE'
  | 'REGULAR';

type FiltroRisco =
  | 'IMINENTE'
  | 'RETENCAO_DUPLA'
  | 'RETENCAO_FREQUENCIA'
  | 'RETENCAO_NOTAS'
  | 'PROGRESSAO_PARCIAL'
  | 'MARGEM_LIMITE'
  | 'TERCEIRA_EM'
  | 'TODOS';

type OrdenacaoRisco = 'gravidade' | 'disciplinas' | 'frequencia' | 'media' | 'nome';

interface DisciplinaAvaliada {
  nome: string;
  media: number | null;
  abaixo5: boolean;
  margem5a6: boolean;
  bimestresComNota: number;
  faltas: number;
}

interface AvaliacaoRetencaoAluno {
  aluno: AlunoNormalizado;
  nivel: NivelRiscoRetencao;
  rotuloNivel: string;
  isRiscoIminente: boolean;
  isTerceiraEM: boolean;
  isNonoEF: boolean;
  isEnsinoMedio: boolean;
  freqReferencia: number | null;
  fonteFreq: string;
  mediaGeral: number | null;
  disciplinasAbaixo5: DisciplinaAvaliada[];
  disciplinasMargem: DisciplinaAvaliada[];
  totalDisciplinasAvaliadas: number;
  motivoNormativo: string;
  acaoRecomendada: string;
  scoreGravidade: number;
}

function extrairNumeroSerie(turma: string, serie: string): number | null {
  const texto = `${turma || ''} ${serie || ''}`.trim();
  const m = texto.match(/\b([1-9])\s*[ºª°o]?/);
  return m ? parseInt(m[1], 10) : null;
}

function avaliarAlunoCriteriosSP(
  al: AlunoNormalizado,
  periodo: PeriodoApuracao
): AvaliacaoRetencaoAluno {
  const numSerie = extrairNumeroSerie(al.turma, al.serie);
  const segUpper = String(al.segmento || '').toUpperCase();
  const isEnsinoMedio =
    segUpper.includes('MÉDIO') ||
    segUpper.includes('MEDIO') ||
    (numSerie !== null && numSerie >= 1 && numSerie <= 3);
  const isTerceiraEM = isEnsinoMedio && numSerie === 3;
  const isNonoEF = !isEnsinoMedio && numSerie === 9;

  // 1. Apuração de disciplinas no período escolhido (Consolidado Anual ou Bimestre)
  const bimestresAlvo: Array<'1B' | '2B' | '3B' | '4B'> =
    periodo === 'ANUAL' ? ['1B', '2B', '3B', '4B'] : [periodo];

  const acumulador = new Map<
    string,
    { soma: number; qtd: number; abaixoFlag: boolean; faltas: number }
  >();

  bimestresAlvo.forEach((b) => {
    const discs = al.notasPorBimestre[b]?.disciplinas || {};
    Object.entries(discs).forEach(([nomeDisc, info]) => {
      const atual = acumulador.get(nomeDisc) || {
        soma: 0,
        qtd: 0,
        abaixoFlag: false,
        faltas: 0
      };
      if (info.nota !== null && !Number.isNaN(info.nota)) {
        atual.soma += info.nota;
        atual.qtd += 1;
      } else if (info.abaixoBasico) {
        atual.abaixoFlag = true;
      }
      atual.faltas += info.faltas || 0;
      acumulador.set(nomeDisc, atual);
    });
  });

  const todasDisciplinas: DisciplinaAvaliada[] = Array.from(acumulador.entries()).map(
    ([nome, d]) => {
      const media = d.qtd > 0 ? Math.round((d.soma / d.qtd) * 10) / 10 : null;
      const abaixo5 = media !== null ? media < 5 : d.abaixoFlag;
      const margem5a6 = media !== null && media >= 5 && media < 6;
      return {
        nome,
        media,
        abaixo5,
        margem5a6,
        bimestresComNota: d.qtd,
        faltas: d.faltas
      };
    }
  );

  const disciplinasAbaixo5 = todasDisciplinas
    .filter((d) => d.abaixo5)
    .sort((a, b) => (a.media ?? -1) - (b.media ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const disciplinasMargem = todasDisciplinas
    .filter((d) => d.margem5a6)
    .sort((a, b) => (a.media ?? 99) - (b.media ?? 99) || a.nome.localeCompare(b.nome, 'pt-BR'));

  // Média geral do período
  const notasValidas = todasDisciplinas
    .map((d) => d.media)
    .filter((n): n is number => n !== null);
  const mediaGeral =
    notasValidas.length > 0
      ? Math.round((notasValidas.reduce((acc, n) => acc + n, 0) / notasValidas.length) * 10) / 10
      : periodo === 'ANUAL'
        ? al.mediaGeralAtual
        : (al.notasPorBimestre[periodo]?.mediaGeral ?? al.mediaGeralAtual);

  // 2. Frequência efetiva (LDB Art. 24: mínimo 75% independente do rendimento)
  const fontesFreq: Array<{ valor: number; fonte: string }> = [];
  if (al.sedFreq !== null) fontesFreq.push({ valor: al.sedFreq, fonte: 'SED' });
  if (periodo !== 'ANUAL' && al.notasPorBimestre[periodo]?.frequencia !== null) {
    fontesFreq.push({
      valor: al.notasPorBimestre[periodo].frequencia as number,
      fonte: `Mapão ${periodo}`
    });
  } else if (al.mapaoFreq !== null) {
    fontesFreq.push({ valor: al.mapaoFreq, fonte: al.mapaoBimestre ? `Mapão ${al.mapaoBimestre}` : 'Mapão' });
  }
  if (al.diariaFreq !== null && al.diariaTotalDias >= 5) {
    fontesFreq.push({ valor: al.diariaFreq, fonte: 'Chamada Diária' });
  }

  let freqReferencia: number | null = null;
  let fonteFreq = '—';
  if (fontesFreq.length > 0) {
    // Prioriza SED como referência oficial, mas se outra fonte consolidada já indicar <75%, destaca a menor
    const abaixo75 = fontesFreq.filter((f) => f.valor < 75).sort((a, b) => a.valor - b.valor);
    if (abaixo75.length > 0) {
      freqReferencia = abaixo75[0].valor;
      fonteFreq = abaixo75[0].fonte;
    } else {
      freqReferencia = fontesFreq[0].valor;
      fonteFreq = fontesFreq[0].fonte;
    }
  }

  const qtdAbaixo5 =
    disciplinasAbaixo5.length > 0
      ? disciplinasAbaixo5.length
      : periodo === 'ANUAL'
        ? al.qtdAbaixoBasicoAtual
        : (al.notasPorBimestre[periodo]?.qtdAbaixoBasico || 0);

  const freqAbaixo75 = freqReferencia !== null && freqReferencia < 75;
  const freqLimitrofe = freqReferencia !== null && freqReferencia >= 75 && freqReferencia < 80;
  const retencaoPorNota = qtdAbaixo5 >= 4 || (qtdAbaixo5 === 0 && mediaGeral !== null && mediaGeral < 5);

  // 3. Classificação segundo critérios oficiais do Estado de SP (LDB, CEE 155/2017, SEDUC 143/2021, 64/2022, 39/2023)
  let nivel: NivelRiscoRetencao = 'REGULAR';
  let rotuloNivel = 'Situação regular';
  let motivoNormativo = 'Frequência >= 75% e rendimento satisfatório nos componentes avaliados.';
  let acaoRecomendada = 'Manter acompanhamento regular em sala e tutoria.';

  if (freqAbaixo75 && (retencaoPorNota || (isTerceiraEM && qtdAbaixo5 >= 1))) {
    nivel = 'RETENCAO_DUPLA';
    rotuloNivel = 'Retenção iminente · Frequência e Notas';
    motivoNormativo = `Frequência ${freqReferencia?.toFixed(1)}% (< 75%, LDB Art. 24) combinada com ${qtdAbaixo5} componente(s) abaixo de 5,0.`;
    acaoRecomendada = isTerceiraEM
      ? 'Intervenção imediata da Gestão + Busca Ativa + Compensação de Ausências + plano intensivo de recuperação (risco de não conclusão da 3ª série).'
      : 'Acionar Busca Ativa imediata, verificar compensação de ausências e incluir em recuperação intensiva com pactuação familiar.';
  } else if (freqAbaixo75) {
    nivel = 'RETENCAO_FREQUENCIA';
    rotuloNivel = 'Retenção iminente · Frequência < 75%';
    motivoNormativo = `Frequência apurada em ${freqReferencia?.toFixed(1)}% (${fonteFreq}) — abaixo do mínimo legal de 75% (LDB Art. 24, independente das notas).`;
    acaoRecomendada = al.temCompensacaoEntregue
      ? 'Validar compensação de ausências entregue no Conselho de Classe e monitorar retorno presencial diário.'
      : 'Busca Ativa urgente, convocação dos responsáveis e oferta formal de Compensação de Ausências.';
  } else if (retencaoPorNota) {
    nivel = 'RETENCAO_NOTAS';
    rotuloNivel = 'Retenção iminente · 4+ Disciplinas < 5,0';
    motivoNormativo = isEnsinoMedio
      ? `${qtdAbaixo5} componentes abaixo de 5,0 — excede o limite de até 3 componentes da Progressão Parcial (Res. SEDUC 143/2021).`
      : isNonoEF
        ? `${qtdAbaixo5} componentes abaixo de 5,0 no 9º ano (final de ciclo EF) — sujeito à retenção em Conselho de Classe.`
        : `${qtdAbaixo5} componentes abaixo de 5,0 no EF — demanda recuperação intensiva obrigatória e deliberação em Conselho (Delib. CEE 155/2017).`;
    acaoRecomendada =
      'Priorizar na Recomposição de Aprendizagem, recuperação paralela/intensiva e alinhamento nominal com professores e família.';
  } else if (isTerceiraEM && qtdAbaixo5 >= 1) {
    nivel = 'NAO_CERTIFICACAO_3EM';
    rotuloNivel = 'Risco 3ª Série EM · Não certificação';
    motivoNormativo = `Concluinte da 3ª série EM com ${qtdAbaixo5} componente(s) abaixo de 5,0 — pendências impedem a certificação de conclusão.`;
    acaoRecomendada =
      'Plano de recuperação final focado nos componentes pendentes antes do Conselho de Classe conclusivo.';
  } else if (qtdAbaixo5 >= 1 && qtdAbaixo5 <= 3) {
    nivel = 'PROGRESSAO_PARCIAL';
    rotuloNivel =
      qtdAbaixo5 === 3
        ? 'Limite Progressão Parcial (3 disc. < 5,0)'
        : `Progressão Parcial / Recuperação (${qtdAbaixo5} disc. < 5,0)`;
    motivoNormativo = isEnsinoMedio
      ? `${qtdAbaixo5} componente(s) abaixo de 5,0 — dentro do teto de até 3 para Progressão Parcial${qtdAbaixo5 === 3 ? ' (qualquer nova queda leva à retenção)' : ''}.`
      : `${qtdAbaixo5} componente(s) abaixo de 5,0 — requer estudos de recuperação contínua/paralela (Delib. CEE 155/2017).`;
    acaoRecomendada =
      qtdAbaixo5 === 3
        ? 'Atenção máxima: está no limite de 3 disciplinas. Garantir recuperação imediata em ao menos 1 componente.'
        : 'Encaminhar atividades de recuperação paralela e acompanhar fechamento com o Tutor.';
  } else if (freqLimitrofe || al.faltasConsecutivas >= 3 || disciplinasMargem.length >= 3) {
    nivel = 'MARGEM_LIMITE';
    const razoes: string[] = [];
    if (freqLimitrofe && freqReferencia !== null) razoes.push(`frequência limítrofe (${freqReferencia.toFixed(1)}%)`);
    if (al.faltasConsecutivas >= 3) razoes.push(`${al.faltasConsecutivas} faltas consecutivas (30d)`);
    if (disciplinasMargem.length >= 3) razoes.push(`${disciplinasMargem.length} disciplinas entre 5,0 e 5,9`);
    rotuloNivel = 'Zona limítrofe · Prevenção';
    motivoNormativo = `Em margem estreita de aprovação: ${razoes.join(' · ')}.`;
    acaoRecomendada = 'Monitoramento preventivo via Tutoria e Busca Ativa antes de cruzar o teto de retenção.';
  }

  const isRiscoIminente =
    nivel === 'RETENCAO_DUPLA' ||
    nivel === 'RETENCAO_FREQUENCIA' ||
    nivel === 'RETENCAO_NOTAS' ||
    nivel === 'NAO_CERTIFICACAO_3EM';

  // Score objetivo de ordenação por gravidade real
  let scoreGravidade = 0;
  if (nivel === 'RETENCAO_DUPLA') scoreGravidade += 4000;
  else if (nivel === 'RETENCAO_FREQUENCIA') scoreGravidade += 3000;
  else if (nivel === 'RETENCAO_NOTAS') scoreGravidade += 2600;
  else if (nivel === 'NAO_CERTIFICACAO_3EM') scoreGravidade += 2400;
  else if (nivel === 'PROGRESSAO_PARCIAL') scoreGravidade += qtdAbaixo5 === 3 ? 1600 : 1100;
  else if (nivel === 'MARGEM_LIMITE') scoreGravidade += 600;

  if (freqReferencia !== null && freqReferencia < 75) {
    scoreGravidade += Math.round((75 - freqReferencia) * 20);
  }
  scoreGravidade += qtdAbaixo5 * 95;
  scoreGravidade += al.faltasConsecutivas * 35;
  if (isTerceiraEM) scoreGravidade += 120;
  if (isNonoEF) scoreGravidade += 60;
  if (mediaGeral !== null && mediaGeral < 5) scoreGravidade += Math.round((5 - mediaGeral) * 50);

  return {
    aluno: al,
    nivel,
    rotuloNivel,
    isRiscoIminente,
    isTerceiraEM,
    isNonoEF,
    isEnsinoMedio,
    freqReferencia,
    fonteFreq,
    mediaGeral,
    disciplinasAbaixo5,
    disciplinasMargem,
    totalDisciplinasAvaliadas: todasDisciplinas.length,
    motivoNormativo,
    acaoRecomendada,
    scoreGravidade
  };
}

export default function Dashboard8AprovacaoSP({
  alunos,
  userRoleNorm,
  onAbrirBuscaAtiva
}: Dashboard8AprovacaoSPProps) {
  const [periodo, setPeriodo] = useState<PeriodoApuracao>('ANUAL');
  const [filtroRisco, setFiltroRisco] = useState<FiltroRisco>('IMINENTE');
  const [turmaFoco, setTurmaFoco] = useState<string>('TODAS');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoRisco>('gravidade');
  const [expandidoRa, setExpandidoRa] = useState<string | null>(null);
  const [mostrarCriterios, setMostrarCriterios] = useState<boolean>(false);

  const podeAcionarBuscaAtiva =
    userRoleNorm === 'DIRETOR' ||
    userRoleNorm === 'SENIOR_GOE' ||
    userRoleNorm === 'VICE_DIRETOR' ||
    userRoleNorm.includes('VICE') ||
    userRoleNorm === 'CGPG' ||
    userRoleNorm === 'CGPCG' ||
    userRoleNorm === 'SECRETARIA';

  const avaliacoes = useMemo(() => {
    return alunos.map((al) => avaliarAlunoCriteriosSP(al, periodo));
  }, [alunos, periodo]);

  const kpis = useMemo(() => {
    const iminentes = avaliacoes.filter((a) => a.isRiscoIminente);
    const dupla = avaliacoes.filter((a) => a.nivel === 'RETENCAO_DUPLA');
    const freqCritica = avaliacoes.filter(
      (a) => a.nivel === 'RETENCAO_FREQUENCIA' || a.nivel === 'RETENCAO_DUPLA'
    );
    const notasCriticas = avaliacoes.filter(
      (a) => a.nivel === 'RETENCAO_NOTAS' || a.nivel === 'RETENCAO_DUPLA' || a.nivel === 'NAO_CERTIFICACAO_3EM'
    );
    const progressaoParcial = avaliacoes.filter((a) => a.nivel === 'PROGRESSAO_PARCIAL');
    const margemLimite = avaliacoes.filter((a) => a.nivel === 'MARGEM_LIMITE');
    const terceiraEmRisco = avaliacoes.filter(
      (a) => a.isTerceiraEM && (a.isRiscoIminente || a.nivel === 'PROGRESSAO_PARCIAL')
    );
    const semBuscaAtiva = iminentes.filter(
      (a) => a.aluno.statusBuscaAtiva === 'Sem Registro'
    ).length;

    const taxaRiscoIminente =
      avaliacoes.length > 0
        ? Math.round((iminentes.length / avaliacoes.length) * 1000) / 10
        : 0;

    return {
      totalBase: avaliacoes.length,
      iminentes: iminentes.length,
      taxaRiscoIminente,
      dupla: dupla.length,
      freqCritica: freqCritica.length,
      notasCriticas: notasCriticas.length,
      progressaoParcial: progressaoParcial.length,
      margemLimite: margemLimite.length,
      terceiraEmRisco: terceiraEmRisco.length,
      semBuscaAtiva
    };
  }, [avaliacoes]);

  // Turmas com maior número de alunos em risco iminente (clicáveis para filtrar na hora)
  const turmasCriticas = useMemo(() => {
    const map = new Map<string, { turma: string; iminentes: number; progParcial: number; total: number }>();
    avaliacoes.forEach((av) => {
      const t = av.aluno.turma || 'SEM TURMA';
      const cur = map.get(t) || { turma: t, iminentes: 0, progParcial: 0, total: 0 };
      cur.total++;
      if (av.isRiscoIminente) cur.iminentes++;
      if (av.nivel === 'PROGRESSAO_PARCIAL') cur.progParcial++;
      map.set(t, cur);
    });
    return Array.from(map.values())
      .filter((t) => t.iminentes > 0 || t.progParcial > 0)
      .sort((a, b) => b.iminentes - a.iminentes || b.progParcial - a.progParcial || a.turma.localeCompare(b.turma, 'pt-BR'))
      .slice(0, 10);
  }, [avaliacoes]);

  const listaFiltrada = useMemo(() => {
    let base = avaliacoes;

    if (turmaFoco !== 'TODAS') {
      base = base.filter((a) => a.aluno.turma === turmaFoco);
    }

    if (filtroRisco === 'IMINENTE') {
      base = base.filter((a) => a.isRiscoIminente);
    } else if (filtroRisco === 'RETENCAO_DUPLA') {
      base = base.filter((a) => a.nivel === 'RETENCAO_DUPLA');
    } else if (filtroRisco === 'RETENCAO_FREQUENCIA') {
      base = base.filter(
        (a) => a.nivel === 'RETENCAO_FREQUENCIA' || a.nivel === 'RETENCAO_DUPLA'
      );
    } else if (filtroRisco === 'RETENCAO_NOTAS') {
      base = base.filter(
        (a) =>
          a.nivel === 'RETENCAO_NOTAS' ||
          a.nivel === 'RETENCAO_DUPLA' ||
          a.nivel === 'NAO_CERTIFICACAO_3EM'
      );
    } else if (filtroRisco === 'PROGRESSAO_PARCIAL') {
      base = base.filter((a) => a.nivel === 'PROGRESSAO_PARCIAL');
    } else if (filtroRisco === 'MARGEM_LIMITE') {
      base = base.filter((a) => a.nivel === 'MARGEM_LIMITE');
    } else if (filtroRisco === 'TERCEIRA_EM') {
      base = base.filter((a) => a.isTerceiraEM && a.nivel !== 'REGULAR');
    }

    const sorted = base.slice();
    sorted.sort((a, b) => {
      if (ordenacao === 'nome') return a.aluno.nome.localeCompare(b.aluno.nome, 'pt-BR');
      if (ordenacao === 'disciplinas') {
        return (
          b.disciplinasAbaixo5.length - a.disciplinasAbaixo5.length ||
          b.scoreGravidade - a.scoreGravidade
        );
      }
      if (ordenacao === 'frequencia') {
        return (a.freqReferencia ?? 999) - (b.freqReferencia ?? 999) || b.scoreGravidade - a.scoreGravidade;
      }
      if (ordenacao === 'media') {
        return (a.mediaGeral ?? 99) - (b.mediaGeral ?? 99) || b.scoreGravidade - a.scoreGravidade;
      }
      return b.scoreGravidade - a.scoreGravidade || a.aluno.nome.localeCompare(b.aluno.nome, 'pt-BR');
    });

    return sorted;
  }, [avaliacoes, filtroRisco, turmaFoco, ordenacao]);

  const abrirDossie = (ra: string, aba: 'dossie' | 'busca-ativa' = 'dossie') => {
    const fn = (window as any).abrirFichaAluno;
    if (typeof fn === 'function') {
      fn(ra, aba);
    }
  };

  const exportarListaRetencaoCsv = () => {
    const headers = [
      'RA',
      'Estudante',
      'Turma',
      'Segmento',
      'Classificacao_SP',
      'Frequencia_Ref_%',
      'Fonte_Freq',
      'Faltas_Consec_30d',
      'Media_Geral',
      'Qtd_Disciplinas_Abaixo_5',
      'Disciplinas_Abaixo_5',
      'Status_Busca_Ativa',
      'Motivo_Normativo',
      'Acao_Recomendada'
    ];
    const linhas = listaFiltrada.map((av) => [
      av.aluno.ra,
      `"${av.aluno.nome.replace(/"/g, '""')}"`,
      av.aluno.turma,
      av.aluno.segmento,
      `"${av.rotuloNivel}"`,
      av.freqReferencia !== null ? av.freqReferencia.toFixed(1) : '',
      `"${av.fonteFreq}"`,
      av.aluno.faltasConsecutivas,
      av.mediaGeral !== null ? av.mediaGeral.toFixed(1) : '',
      av.disciplinasAbaixo5.length,
      `"${av.disciplinasAbaixo5.map((d) => `${d.nome} (${d.media !== null ? d.media.toFixed(1) : 'I'})`).join(', ').replace(/"/g, '""')}"`,
      `"${av.aluno.statusBuscaAtiva}"`,
      `"${av.motivoNormativo.replace(/"/g, '""')}"`,
      `"${av.acaoRecomendada.replace(/"/g, '""')}"`
    ]);

    const csv = '\uFEFF' + [headers.join(';'), ...linhas.map((l) => l.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `risco_retencao_sp_${periodo.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const estiloNivel = (nivel: NivelRiscoRetencao) => {
    switch (nivel) {
      case 'RETENCAO_DUPLA':
        return 'text-rose-800 font-bold';
      case 'RETENCAO_FREQUENCIA':
      case 'RETENCAO_NOTAS':
      case 'NAO_CERTIFICACAO_3EM':
        return 'text-red-700 font-semibold';
      case 'PROGRESSAO_PARCIAL':
        return 'text-amber-700 font-semibold';
      case 'MARGEM_LIMITE':
        return 'text-slate-700 font-semibold';
      default:
        return 'text-emerald-700 font-medium';
    }
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho Normativo + Ações do Painel */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Critérios de Aprovação (Rede Estadual SP) &amp; Risco Iminente de Retenção
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Base legal: LDB Art. 24 (frequência mínima 75%) · Deliberação CEE-SP 155/2017 · Resoluções SEDUC-SP 143/2021, 64/2022 e 39/2023 (nota mínima 5,0 · teto de 3 componentes em Progressão Parcial)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => setMostrarCriterios((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <i className={`fa-solid ${mostrarCriterios ? 'fa-chevron-up' : 'fa-scale-balanced'} text-[11px] text-slate-500`}></i>
              <span>{mostrarCriterios ? 'Ocultar Critérios SP' : 'Ver Critérios Oficiais SP'}</span>
            </button>

            <button
              type="button"
              onClick={exportarListaRetencaoCsv}
              className="px-3 py-1.5 rounded-lg bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <i className="fa-solid fa-file-csv text-[11px]"></i>
              <span>Exportar Lista ({listaFiltrada.length})</span>
            </button>
          </div>
        </div>

        {/* Referência Normativa Oficial SP (Expandível sob demanda) */}
        {mostrarCriterios && (
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-xs text-slate-700">
            <div>
              <div className="font-bold text-slate-900 mb-1">1. Frequência Mínima (75%)</div>
              <p className="leading-relaxed text-slate-600">
                Exigência legal de <strong>75% do total de horas letivas</strong> (LDB Art. 24). A apuração é <strong>independente das notas</strong>: abaixo de 75%, o estudante pode ser retido por falta mesmo com média suficiente, exigindo Busca Ativa e Compensação de Ausências.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-900 mb-1">2. Nota Mínima e Progressão Parcial</div>
              <p className="leading-relaxed text-slate-600">
                Escala de 0 a 10 com média de referência <strong>5,0</strong> por componente. No Ensino Médio (Res. SEDUC 143/2021 e 64/2022), rendimento &lt; 5,0 em <strong>até 3 componentes</strong> permite Progressão Parcial; <strong>4 ou mais componentes &lt; 5,0</strong> configura risco iminente de retenção.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-900 mb-1">3. Fundamental (6º–9º) e 3ª Série EM</div>
              <p className="leading-relaxed text-slate-600">
                No Ensino Fundamental (6º–9º), prevalece a recuperação contínua/intensiva com atenção redobrada no <strong>9º ano (final de ciclo)</strong> e frequência &lt; 75%. Na <strong>3ª série do EM</strong>, pendências em componentes ou frequência impedem a certificação de conclusão.
              </p>
            </div>
            <div>
              <div className="font-bold text-slate-900 mb-1">4. Conselho de Classe e Recuperação</div>
              <p className="leading-relaxed text-slate-600">
                Pela Deliberação CEE-SP 155/2017, a decisão final é colegiada no <strong>Conselho de Classe/Série</strong>, sendo obrigatória a oferta prévia de estudos de recuperação paralela/intensiva e garantido o direito de pedido de reconsideração à família.
              </p>
            </div>
          </div>
        )}

        {/* Faixa de KPIs Clicáveis (Single-Elevation, Hairline Dividers, Tabular Numerals) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <button
            type="button"
            onClick={() => setFiltroRisco('IMINENTE')}
            className={`px-4 py-3.5 text-left transition cursor-pointer ${
              filtroRisco === 'IMINENTE' ? 'bg-rose-50/70' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-[11px] font-semibold text-rose-700">Risco Iminente de Retenção</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono tabular-nums text-rose-700">{kpis.iminentes}</span>
              <span className="text-xs font-mono tabular-nums text-slate-500">{kpis.taxaRiscoIminente}%</span>
            </div>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              {kpis.dupla} duplo risco · {kpis.semBuscaAtiva} sem busca ativa
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroRisco('RETENCAO_FREQUENCIA')}
            className={`px-4 py-3.5 text-left transition cursor-pointer ${
              filtroRisco === 'RETENCAO_FREQUENCIA' ? 'bg-red-50/70' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-[11px] font-semibold text-slate-700">Frequência &lt; 75% (LDB)</span>
            <span className="block text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
              {kpis.freqCritica}
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Retenção independente de nota
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroRisco('RETENCAO_NOTAS')}
            className={`px-4 py-3.5 text-left transition cursor-pointer ${
              filtroRisco === 'RETENCAO_NOTAS' ? 'bg-red-50/70' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-[11px] font-semibold text-slate-700">Notas Críticas (4+ &lt; 5,0 / 3ª EM)</span>
            <span className="block text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
              {kpis.notasCriticas}
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Acima do teto de 3 dependências
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroRisco('PROGRESSAO_PARCIAL')}
            className={`px-4 py-3.5 text-left transition cursor-pointer ${
              filtroRisco === 'PROGRESSAO_PARCIAL' ? 'bg-amber-50/70' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-[11px] font-semibold text-amber-800">Progressão Parcial (1–3 &lt; 5,0)</span>
            <span className="block text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
              {kpis.progressaoParcial}
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Recuperação obrigatória / dependência
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFiltroRisco('MARGEM_LIMITE')}
            className={`px-4 py-3.5 text-left transition cursor-pointer col-span-2 sm:col-span-1 ${
              filtroRisco === 'MARGEM_LIMITE' ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-[11px] font-semibold text-slate-700">Zona Limítrofe (75–80% / 3+ cons.)</span>
            <span className="block text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {kpis.margemLimite}
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Prevenção antes da retenção
            </span>
          </button>
        </div>
      </div>

      {/* Turmas com Maior Concentração de Risco Iminente (Clicáveis) */}
      {turmasCriticas.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-3.5 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="text-xs font-semibold text-slate-700">
              Concentração por Turma (clique para filtrar a lista)
            </span>
            {turmaFoco !== 'TODAS' && (
              <button
                type="button"
                onClick={() => setTurmaFoco('TODAS')}
                className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
              >
                Mostrar todas as turmas
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {turmasCriticas.map((t) => {
              const selecionada = turmaFoco === t.turma;
              return (
                <button
                  key={t.turma}
                  type="button"
                  onClick={() => setTurmaFoco(selecionada ? 'TODAS' : t.turma)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2 ${
                    selecionada
                      ? 'bg-[#1d2b4f] text-white border-[#1d2b4f]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-white'
                  }`}
                >
                  <span>{t.turma}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      selecionada ? 'text-cyan-300' : t.iminentes > 0 ? 'text-rose-700' : 'text-amber-700'
                    }`}
                  >
                    {t.iminentes} imin. · {t.progParcial} pp
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabela Principal Clicável de Estudantes em Risco Iminente */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Barra de Controles da Lista */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-3 print:hidden">
          {/* Segmento de Filtros Rápidos */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'IMINENTE', label: `Risco Iminente (${kpis.iminentes})` },
                { id: 'RETENCAO_DUPLA', label: `Duplo Risco (${kpis.dupla})` },
                { id: 'RETENCAO_FREQUENCIA', label: `Freq. < 75% (${kpis.freqCritica})` },
                { id: 'RETENCAO_NOTAS', label: `Notas Críticas (${kpis.notasCriticas})` },
                { id: 'PROGRESSAO_PARCIAL', label: `Prog. Parcial (${kpis.progressaoParcial})` },
                { id: 'TERCEIRA_EM', label: `3ª Série EM (${kpis.terceiraEmRisco})` },
                { id: 'TODOS', label: `Todos (${kpis.totalBase})` }
              ] as Array<{ id: FiltroRisco; label: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFiltroRisco(btn.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  filtroRisco === btn.id
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Seletor de Período (Anual vs Bimestre) + Ordenação */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as PeriodoApuracao)}
              aria-label="Período de apuração"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none"
            >
              <option value="ANUAL">Apuração: Consolidado Anual (1B–4B)</option>
              <option value="4B">Apuração: 4º Bimestre</option>
              <option value="3B">Apuração: 3º Bimestre</option>
              <option value="2B">Apuração: 2º Bimestre</option>
              <option value="1B">Apuração: 1º Bimestre</option>
            </select>

            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as OrdenacaoRisco)}
              aria-label="Ordenação da lista"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none"
            >
              <option value="gravidade">Ordenar: Maior Risco de Retenção</option>
              <option value="disciplinas">Ordenar: Mais Disciplinas &lt; 5,0</option>
              <option value="frequencia">Ordenar: Menor Frequência</option>
              <option value="media">Ordenar: Menor Média Geral</option>
              <option value="nome">Ordenar: Nome (A–Z)</option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold text-slate-500">
                <th className="py-3 px-4">Estudante · Turma</th>
                <th className="py-3 px-3">Enquadramento SP</th>
                <th className="py-3 px-3 text-right">Frequência</th>
                <th className="py-3 px-3 text-right">Disc. &lt; 5,0</th>
                <th className="py-3 px-3 text-right">Média</th>
                <th className="py-3 px-3">Acompanhamento</th>
                <th className="py-3 px-4 text-right print:hidden">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {listaFiltrada.slice(0, 150).map((av) => {
                const { aluno } = av;
                const aberto = expandidoRa === aluno.ra;
                return (
                  <React.Fragment key={aluno.ra}>
                    <tr
                      onClick={() => setExpandidoRa(aberto ? null : aluno.ra)}
                      className={`transition cursor-pointer ${
                        aberto
                          ? 'bg-slate-50'
                          : av.nivel === 'RETENCAO_DUPLA'
                            ? 'bg-rose-50/35 hover:bg-rose-50/60'
                            : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-start gap-2">
                          <i
                            className={`fa-solid ${aberto ? 'fa-chevron-down text-slate-700' : 'fa-chevron-right text-slate-400'} text-[10px] mt-1 shrink-0`}
                          ></i>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 leading-snug">
                              {aluno.nome}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                              {aluno.turma} · {aluno.segmento} · RA {aluno.ra}
                              {aluno.tutor && aluno.tutor !== 'Sem Tutor' ? ` · Tutor: ${aluno.tutor}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-[260px]">
                        <div className={`text-xs leading-snug ${estiloNivel(av.nivel)}`}>
                          {av.rotuloNivel}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5" title={av.motivoNormativo}>
                          {av.disciplinasAbaixo5.length > 0
                            ? av.disciplinasAbaixo5
                                .slice(0, 3)
                                .map((d) => `${d.nome} (${d.media !== null ? d.media.toFixed(1) : 'I'})`)
                                .join(' · ') +
                              (av.disciplinasAbaixo5.length > 3
                                ? ` +${av.disciplinasAbaixo5.length - 3}`
                                : '')
                            : av.motivoNormativo}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={
                            av.freqReferencia !== null && av.freqReferencia < 75
                              ? 'text-rose-700 font-bold'
                              : av.freqReferencia !== null && av.freqReferencia < 80
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-800 font-semibold'
                          }
                        >
                          {av.freqReferencia !== null ? `${av.freqReferencia.toFixed(1)}%` : '—'}
                        </div>
                        <div className="text-[10px] font-sans text-slate-400">
                          {av.fonteFreq}
                          {aluno.faltasConsecutivas >= 2 ? ` · ${aluno.faltasConsecutivas}d cons.` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            av.disciplinasAbaixo5.length >= 4
                              ? 'text-rose-700 font-bold'
                              : av.disciplinasAbaixo5.length >= 1
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                          }
                        >
                          {av.disciplinasAbaixo5.length}
                        </span>
                        {av.totalDisciplinasAvaliadas > 0 && (
                          <span className="text-[10px] text-slate-400">/{av.totalDisciplinasAvaliadas}</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            av.mediaGeral !== null && av.mediaGeral < 5
                              ? 'text-rose-700 font-bold'
                              : av.mediaGeral !== null && av.mediaGeral < 6
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-800 font-semibold'
                          }
                        >
                          {av.mediaGeral !== null ? av.mediaGeral.toFixed(1) : '—'}
                        </span>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div
                          className={`text-xs font-medium ${
                            aluno.statusBuscaAtiva === 'Conselho Tutelar'
                              ? 'text-rose-700'
                              : aluno.statusBuscaAtiva === 'Sem Registro' && av.isRiscoIminente
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-700'
                          }`}
                        >
                          {aluno.statusBuscaAtiva}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {aluno.temCompensacaoEntregue
                            ? 'Compensação entregue'
                            : aluno.recomposicao
                              ? 'Em Recomposição'
                              : aluno.aee
                                ? 'Atendido AEE'
                                : 'Sem compensação'}
                        </div>
                      </td>

                      <td
                        className="py-3 px-4 text-right whitespace-nowrap print:hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirDossie(aluno.ra, 'dossie')}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold transition cursor-pointer"
                          >
                            Dossiê
                          </button>
                          {podeAcionarBuscaAtiva && (
                            <button
                              type="button"
                              onClick={() => onAbrirBuscaAtiva(aluno)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#1d2b4f] hover:bg-blue-900 text-white text-[11px] font-semibold transition cursor-pointer"
                            >
                              Busca Ativa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Detalhamento Normativo e Pedagógico ao Clicar na Linha */}
                    {aberto && (
                      <tr className="bg-slate-50/90 border-b border-slate-200">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs">
                            {/* Bloco 1: Disciplinas Críticas */}
                            <div>
                              <div className="font-bold text-slate-900 mb-1.5">
                                Componentes Curriculares abaixo de 5,0 ({av.disciplinasAbaixo5.length})
                              </div>
                              {av.disciplinasAbaixo5.length > 0 ? (
                                <div className="space-y-1">
                                  {av.disciplinasAbaixo5.map((d) => (
                                    <div
                                      key={d.nome}
                                      className="flex items-center justify-between gap-2 py-1 border-b border-slate-200/70 last:border-0"
                                    >
                                      <span className="text-slate-800 font-medium truncate">{d.nome}</span>
                                      <span className="font-mono tabular-nums font-bold text-rose-700 shrink-0">
                                        {d.media !== null ? d.media.toFixed(1) : 'Insuf.'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-slate-500">
                                  Nenhum componente abaixo de 5,0 no período selecionado.
                                </p>
                              )}

                              {av.disciplinasMargem.length > 0 && (
                                <div className="mt-2.5 text-[11px] text-slate-600">
                                  <span className="font-semibold text-slate-700">Margem 5,0–5,9: </span>
                                  {av.disciplinasMargem
                                    .map((d) => `${d.nome} (${d.media?.toFixed(1)})`)
                                    .join(' · ')}
                                </div>
                              )}
                            </div>

                            {/* Bloco 2: Tripla Frequência & Busca Ativa */}
                            <div>
                              <div className="font-bold text-slate-900 mb-1.5">
                                Apuração de Frequência (Mínimo Legal 75%)
                              </div>
                              <div className="space-y-1 text-slate-700 tabular-nums">
                                <div className="flex justify-between py-1 border-b border-slate-200/70">
                                  <span className="text-slate-500">Frequência SED</span>
                                  <span className={`font-mono font-semibold ${aluno.sedFreq !== null && aluno.sedFreq < 75 ? 'text-rose-700' : 'text-slate-900'}`}>
                                    {aluno.sedFreq !== null ? `${aluno.sedFreq.toFixed(1)}%` : '—'}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-200/70">
                                  <span className="text-slate-500">Frequência Mapão {aluno.mapaoBimestre || ''}</span>
                                  <span className={`font-mono font-semibold ${aluno.mapaoFreq !== null && aluno.mapaoFreq < 75 ? 'text-rose-700' : 'text-slate-900'}`}>
                                    {aluno.mapaoFreq !== null ? `${aluno.mapaoFreq.toFixed(1)}%` : '—'}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1 border-b border-slate-200/70">
                                  <span className="text-slate-500">Chamada Diária ({aluno.diariaTotalDias}d)</span>
                                  <span className={`font-mono font-semibold ${aluno.diariaFreq !== null && aluno.diariaFreq < 75 ? 'text-rose-700' : 'text-slate-900'}`}>
                                    {aluno.diariaFreq !== null ? `${aluno.diariaFreq.toFixed(1)}%` : '—'}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-slate-500">Faltas consecutivas (últimos 30d)</span>
                                  <span className={`font-mono font-semibold ${aluno.faltasConsecutivas >= 3 ? 'text-rose-700' : 'text-slate-900'}`}>
                                    {aluno.faltasConsecutivas} dia(s)
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Bloco 3: Parecer Normativo & Encaminhamento */}
                            <div className="flex flex-col justify-between gap-3">
                              <div>
                                <div className="font-bold text-slate-900 mb-1.5">
                                  Diagnóstico Normativo &amp; Próximo Passo
                                </div>
                                <p className="text-slate-700 leading-relaxed">{av.motivoNormativo}</p>
                                <p className="text-blue-900 font-medium leading-relaxed mt-2">
                                  Recomendação: {av.acaoRecomendada}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 print:hidden">
                                <button
                                  type="button"
                                  onClick={() => abrirDossie(aluno.ra, 'dossie')}
                                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
                                >
                                  Abrir Dossiê Completo
                                </button>
                                {podeAcionarBuscaAtiva && (
                                  <button
                                    type="button"
                                    onClick={() => abrirDossie(aluno.ra, 'busca-ativa')}
                                    className="px-3 py-1.5 rounded-lg bg-[#1d2b4f] hover:bg-blue-900 text-white text-xs font-semibold cursor-pointer"
                                  >
                                    Ir para Busca Ativa no Dossiê
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-sm text-slate-500">
                    Nenhum estudante enquadrado neste filtro de retenção para o período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {listaFiltrada.length > 150 && (
          <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            Exibindo os 150 casos de maior gravidade de {listaFiltrada.length} estudantes filtrados. Utilize os filtros por turma, segmento ou busca para refinar.
          </div>
        )}
      </div>
    </div>
  );
}
