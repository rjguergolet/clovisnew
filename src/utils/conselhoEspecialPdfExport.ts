/**
 * src/utils/conselhoEspecialPdfExport.ts
 * Exportação Oficial em PDF (A4 Paisagem/Retrato) da Pauta Confidencial do Conselho de Bimestre
 * Exclusivo para Direção, Vice-Direção e CGPG — E.E. Professor Clóvis de Lucca
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlunoConselhoClassificado,
  AtaConselhoTurmaData,
  DELIBERACAO_LABELS,
  MapaoConselhoMetadata,
  RESULTADO_FINAL_LABELS,
  resumirEstatisticasTurma
} from '../modules/mapaoConselhoParser';

async function carregarLogoPngDataUrl(url: string): Promise<string | null> {
  if (!url || typeof document === 'undefined') return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Falha ao carregar logo'));
      el.src = url;
    });

    const size = 180;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const ratio = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
    const drawW = (img.naturalWidth || size) * ratio;
    const drawH = (img.naturalHeight || size) * ratio;
    ctx.drawImage(img, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function formatarDataPorExtensoPT(isoDate?: string): { br: string; extenso: string } {
  let d = new Date();
  if (isoDate && /^\d{4}-\d{2}-\d{2}/.test(isoDate)) {
    const [y, m, day] = isoDate.slice(0, 10).split('-').map(n => parseInt(n, 10));
    d = new Date(y, (m || 1) - 1, day || 1);
  }
  const br = d.toLocaleDateString('pt-BR');
  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro'
  ];
  const extenso = `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  return { br, extenso };
}

export function exportarPautaConselhoTurmaPDF(
  metadata: MapaoConselhoMetadata,
  alunos: AlunoConselhoClassificado[],
  observacoesGeraisTurma?: string,
  emitidoPor?: string
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;
  const stats = resumirEstatisticasTurma(alunos);
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  const horaAgora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Cabeçalho Institucional Confidencial
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(
    `E.E. PROF. CLÓVIS DE LUCCA · PAUTA CONFIDENCIAL DO CONSELHO (${metadata.tipoFechamento.toUpperCase()})`,
    marginX,
    9.5
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Turma: ${metadata.turmaNormalizada} (${metadata.turmaOriginal})  |  Ano Letivo: ${metadata.anoLetivo}  |  Aulas Dadas Bim.: ${metadata.totalAulasDadas || '—'}  |  Documento Restrito: Direção, Vice-Direção e CGPG`,
    marginX,
    15.5
  );
  doc.text(
    `Emitido em ${dataHoje} às ${horaAgora}${emitidoPor ? ` por ${emitidoPor}` : ''}  |  Ativos: ${stats.totalAtivos}  |  Transferidos: ${stats.totalTransferidos}`,
    marginX,
    20.5
  );

  // Faixa de Resumo Quantitativo
  let curY = 29;
  const boxW = (pageWidth - marginX * 2 - 9) / 4;
  const kpis = [
    {
      label: 'REPROVANDO POR FALTAS (< 75% GLOBAL)',
      value: `${stats.reprovandoFaltasCount}`,
      sub: `${stats.totalAtivos > 0 ? Math.round((stats.reprovandoFaltasCount / stats.totalAtivos) * 100) : 0}% dos ativos`,
      border: [220, 38, 38] as [number, number, number],
      fill: [254, 242, 242] as [number, number, number]
    },
    {
      label: 'CRÍTICOS COM 4+ NOTAS VERMELHAS',
      value: `${stats.criticosNotas4MaisCount}`,
      sub: stats.duplosCriticosCount > 0 ? `${stats.duplosCriticosCount} também reprovando por faltas` : 'Abaixo de 5,0 em 4+ disciplinas',
      border: [234, 88, 12] as [number, number, number],
      fill: [255, 247, 237] as [number, number, number]
    },
    {
      label: 'ESTUDANTES AEE NA TURMA',
      value: `${stats.casosAEECount}`,
      sub: `${stats.casosAEEComAlertaCount} com alerta de notas/faltas`,
      border: [79, 70, 229] as [number, number, number],
      fill: [238, 242, 255] as [number, number, number]
    },
    {
      label: 'TOTAL EM PAUTA PARA CONVERSA',
      value: `${stats.pautaConselhoCount}`,
      sub: `${stats.deliberadosCount} deliberados · Freq. média ${stats.mediaFreqAnual ?? '—'}%`,
      border: [15, 23, 42] as [number, number, number],
      fill: [248, 250, 252] as [number, number, number]
    }
  ];

  kpis.forEach((k, idx) => {
    const x = marginX + idx * (boxW + 3);
    doc.setFillColor(...k.fill);
    doc.setDrawColor(...k.border);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, curY, boxW, 16, 1.5, 1.5, 'FD');

    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(k.label, x + 3, curY + 4.5);

    doc.setTextColor(...k.border);
    doc.setFontSize(13);
    doc.text(k.value, x + 3, curY + 10.5);

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(k.sub, x + 15, curY + 10.5);
  });

  curY += 21;

  const ativos = alunos.filter(a => a.isAtivo);
  const pautaOrdenada = ativos
    .filter(a => a.precisaConversaConselho)
    .sort((a, b) => b.scoreGravidade - a.scoreGravidade || a.numChamada - b.numChamada);

  const renderSecaoTabela = (
    titulo: string,
    corHeader: [number, number, number],
    lista: AlunoConselhoClassificado[]
  ) => {
    if (lista.length === 0) return;

    if (curY > 175) {
      doc.addPage();
      curY = 14;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...corHeader);
    doc.text(`${titulo} (${lista.length})`, marginX, curY);
    curY += 2.5;

    const body = lista.map(a => {
      const tags: string[] = [];
      if (a.isAEE) tags.push('AEE');
      if (a.reprovandoPorFaltasGlobal) tags.push('REPROV. FALTAS');
      if (a.criticoNotas4Mais) tags.push('4+ VERMELHAS');
      if (a.riscoLimiteFaltas) tags.push('ZONA LIMITE');

      const redText =
        a.notasVermelhas.length > 0
          ? `${a.qtdNotasVermelhas}x: ${a.notasVermelhas.map(n => `${n.nomeCurto} (${n.mencao})`).join(', ')}`
          : 'Nenhuma';

      const resFinalLabel =
        metadata.bimestreKey === 'FINAL' &&
        a.deliberacao.resultadoFinal &&
        a.deliberacao.resultadoFinal !== 'PENDENTE'
          ? `Final: ${RESULTADO_FINAL_LABELS[a.deliberacao.resultadoFinal]}${a.deliberacao.turmaAnoSeguinte ? ` -> ${a.deliberacao.turmaAnoSeguinte}` : ''}`
          : '';

      const delibText = [
        DELIBERACAO_LABELS[a.deliberacao.status],
        resFinalLabel,
        a.deliberacao.parecer ? `Obs: ${a.deliberacao.parecer}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      return [
        String(a.numChamada),
        `${a.nome}${a.tutor ? `\nTutor: ${a.tutor}` : ''}`,
        tags.length > 0 ? tags.join(' · ') : 'Atenção',
        `${a.freqAnualStr}\n(${a.faltasTotalAno} F)`,
        `${a.freqBimestreStr}\n(${a.totalFaltasBimestre} F / ${a.totalAusenciasCompensadas} AC)`,
        a.mediaGlobalNotas !== null ? a.mediaGlobalNotas.toFixed(1) : '—',
        redText,
        delibText
      ];
    });

    autoTable(doc, {
      startY: curY,
      margin: { left: marginX, right: marginX },
      head: [[
        'Nº',
        'Estudante',
        'Alertas',
        'Global Anual',
        'Bimestre / AC',
        'Média',
        'Notas Vermelhas (< 5,0)',
        'Deliberação / Parecer do Conselho'
      ]],
      body,
      theme: 'grid',
      styles: {
        fontSize: 7.3,
        cellPadding: 2,
        textColor: [15, 23, 42],
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        valign: 'middle'
      },
      headStyles: {
        fillColor: corHeader,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.4
      },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' },
        1: { cellWidth: 50 },
        2: { cellWidth: 28 },
        3: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 26, halign: 'center' },
        5: { cellWidth: 13, halign: 'center' },
        6: { cellWidth: 56 },
        7: { cellWidth: 'auto' }
      }
    });

    curY = ((doc as any).lastAutoTable?.finalY || curY + 20) + 7;
  };

  const listaAEE = ativos
    .filter(a => a.isAEE)
    .sort((a, b) => b.scoreGravidade - a.scoreGravidade || a.numChamada - b.numChamada);
  renderSecaoTabela('1. FOCO PRIORITÁRIO — ESTUDANTES AEE (EDUCAÇÃO ESPECIAL)', [67, 56, 202], listaAEE);

  const listaFaltas = ativos
    .filter(a => a.reprovandoPorFaltasGlobal)
    .sort((a, b) => (a.freqAnualNum ?? 100) - (b.freqAnualNum ?? 100));
  renderSecaoTabela('2. ESTUDANTES REPROVANDO POR FALTAS NA MÉDIA GLOBAL (< 75% ANUAL)', [185, 28, 28], listaFaltas);

  const lista4Verm = ativos
    .filter(a => a.criticoNotas4Mais)
    .sort((a, b) => b.qtdNotasVermelhas - a.qtdNotasVermelhas);
  renderSecaoTabela('3. CASOS CRÍTICOS EM RENDIMENTO (4 OU MAIS NOTAS VERMELHAS)', [194, 65, 12], lista4Verm);

  const jaListados = new Set<string>([
    ...listaAEE.map(a => a.chaveAluno),
    ...listaFaltas.map(a => a.chaveAluno),
    ...lista4Verm.map(a => a.chaveAluno)
  ]);
  const demaisPauta = pautaOrdenada.filter(a => !jaListados.has(a.chaveAluno));
  renderSecaoTabela('4. DEMAIS ESTUDANTES PARA CONVERSA NO CONSELHO (ZONA LIMITE / 1 A 3 VERMELHAS)', [51, 65, 85], demaisPauta);

  if (pautaOrdenada.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Nenhum estudante ativo em alerta crítico ou de pauta obrigatória nesta turma segundo o Mapão oficial.', marginX, curY + 4);
    curY += 12;
  }

  if (observacoesGeraisTurma && observacoesGeraisTurma.trim()) {
    if (curY > 172) {
      doc.addPage();
      curY = 14;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('SÍNTESE / ENCAMINHAMENTOS GERAIS DA TURMA:', marginX, curY);
    curY += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const wrapped = doc.splitTextToSize(observacoesGeraisTurma.trim(), pageWidth - marginX * 2);
    doc.text(wrapped, marginX, curY);
    curY += wrapped.length * 4 + 6;
  }

  // Bloco de Assinaturas (Direção, Vice-Direção e CGPG)
  if (curY > 175) {
    doc.addPage();
    curY = 20;
  }
  const sigY = Math.max(curY + 12, 182);
  const sigW = (pageWidth - marginX * 2 - 24) / 3;
  const cargos = ['Direção Escolar', 'Vice-Direção Escolar', 'CGPG · Coordenação Geral'];
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  cargos.forEach((cargo, i) => {
    const sx = marginX + i * (sigW + 12);
    doc.line(sx, sigY, sx + sigW, sigY);
    doc.text(cargo, sx + sigW / 2, sigY + 4.5, { align: 'center' });
  });

  const slugTurma = metadata.turmaNormalizada.replace(/[^A-Z0-9]+/gi, '_');
  doc.save(`Pauta_Conselho_${slugTurma}_${metadata.bimestreKey}_${metadata.anoLetivo}.pdf`);
}

/**
 * Gera a ATA OFICIAL DO CONSELHO DE CLASSE / CONSELHO FINAL em PDF (A4 Retrato)
 * pronta para impressão e colheita de assinaturas de Direção, Vice, CGPG,
 * múltiplos professores, estudantes e convidados.
 */
export async function exportarAtaConselhoOficialPDF(
  metadata: MapaoConselhoMetadata,
  alunos: AlunoConselhoClassificado[],
  ata: AtaConselhoTurmaData,
  observacoesGeraisTurma?: string
): Promise<string> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentW = pageWidth - marginX * 2;
  const stats = resumirEstatisticasTurma(alunos);
  const { br: dataBR, extenso: dataExtenso } = formatarDataPorExtensoPT(ata.dataReuniao);

  const logoUrl =
    (typeof localStorage !== 'undefined' && localStorage.getItem('clovis_custom_logo')) || '/logo-clovis.svg';
  const logoPng = await carregarLogoPngDataUrl(logoUrl);

  const tituloAta =
    ata.tituloPersonalizado?.trim() ||
    (metadata.bimestreKey === 'FINAL'
      ? `ATA DO CONSELHO DE CLASSE E SÉRIE FINAL — ${metadata.anoLetivo}`
      : `ATA DO CONSELHO DE CLASSE (${metadata.tipoFechamento.toUpperCase()}) — ${metadata.anoLetivo}`);

  const drawHeader = (isFirst: boolean): number => {
    const topY = 10;
    if (isFirst && logoPng) {
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX, topY, 15, 15, 1.5, 1.5, 'FD');
      doc.addImage(logoPng, 'PNG', marginX + 1, topY + 1, 13, 13);
    }

    const textX = isFirst && logoPng ? marginX + 18 : marginX;
    doc.setFont('times', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(71, 85, 105);
    doc.text('GOVERNO DO ESTADO DE SÃO PAULO · SECRETARIA DA EDUCAÇÃO', textX, topY + 4);

    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('E.E. PROF. CLÓVIS DE LUCCA · PROGRAMA ENSINO INTEGRAL (PEI)', textX, topY + 9);

    doc.setFont('times', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Turma: ${metadata.turmaNormalizada}  |  Data: ${dataBR}${ata.horarioInicio ? ` · ${ata.horarioInicio}` : ''}${ata.horarioFim ? ` às ${ata.horarioFim}` : ''}  |  Local: ${ata.localReuniao || 'Unidade Escolar'}`,
      textX,
      topY + 14
    );

    const lineY = topY + 18;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.35);
    doc.line(marginX, lineY, pageWidth - marginX, lineY);
    return lineY + 7;
  };

  let curY = drawHeader(true);

  const ensureSpace = (neededMm: number) => {
    if (curY + neededMm > pageHeight - 18) {
      doc.addPage();
      curY = drawHeader(false);
    }
  };

  // Título Central
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(tituloAta, pageWidth / 2, curY, { align: 'center' });
  curY += 5;

  doc.setFont('times', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Turma: ${metadata.turmaNormalizada} (${metadata.turmaOriginal})`, pageWidth / 2, curY, {
    align: 'center'
  });
  curY += 7;

  // Parágrafo Formal de Abertura
  const horarioTexto = ata.horarioInicio
    ? `às ${ata.horarioInicio}${ata.horarioFim ? ` (encerramento previsto às ${ata.horarioFim})` : ''}`
    : 'em horário regimental';
  const aberturaFormal = `Aos ${dataExtenso}, ${horarioTexto}, na ${ata.localReuniao || 'dependência da unidade escolar'} da Escola Estadual Professor Clóvis de Lucca, reuniram-se os membros da Equipe Gestora (Direção, Vice-Direção e Coordenação Geral de Gestão Pedagógica — CGPG), o corpo docente, representantes dos estudantes e demais participantes convocados, para a realização da sessão de ${metadata.bimestreKey === 'FINAL' ? 'Conselho de Classe e Série Final' : `Conselho de Bimestre (${metadata.tipoFechamento})`} referente à turma ${metadata.turmaNormalizada}, Ano Letivo ${metadata.anoLetivo}, com base nos dados oficiais do Mapão da Secretaria Escolar Digital (SED).`;

  doc.setFont('times', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  const aberturaLines = doc.splitTextToSize(aberturaFormal, contentW);
  aberturaLines.forEach((ln: string) => {
    ensureSpace(5.5);
    doc.text(ln, marginX, curY);
    curY += 5.2;
  });
  curY += 3;

  // Bloco auxiliar para seções narrativas da Ata
  const renderSecaoTexto = (titulo: string, corpo?: string) => {
    const txt = String(corpo || '').trim();
    if (!txt) return;
    ensureSpace(14);
    doc.setFont('times', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(titulo, marginX, curY);
    curY += 5;

    doc.setFont('times', 'normal');
    doc.setFontSize(10.2);
    doc.setTextColor(30, 41, 59);
    const paragrafos = txt.replace(/\r\n/g, '\n').split(/\n+/).filter(Boolean);
    for (const p of paragrafos) {
      const lines = doc.splitTextToSize(p, contentW);
      for (const ln of lines) {
        ensureSpace(5.2);
        doc.text(ln, marginX, curY);
        curY += 4.9;
      }
      curY += 1.5;
    }
    curY += 2;
  };

  // Síntese numérica oficial do Mapão
  const resumoOficial = `Estudantes ativos apurados no Mapão: ${stats.totalAtivos} (${stats.totalTransferidos} transferidos/inativos). Frequência global anual média: ${stats.mediaFreqAnual ?? '—'}% · Média global de notas: ${stats.mediaNotasTurma !== null ? stats.mediaNotasTurma.toFixed(1) : '—'}. Casos prioritários mapeados: ${stats.reprovandoFaltasCount} estudante(s) abaixo de 75% na frequência global anual, ${stats.criticosNotas4MaisCount} com 4 ou mais notas abaixo de 5,0, e ${stats.casosAEECount} estudante(s) atendido(s) pelo AEE.`;
  renderSecaoTexto('I. PANORAMA OFICIAL DO MAPÃO E ABERTURA', [resumoOficial, ata.aberturaPanorama].filter(Boolean).join('\n'));
  renderSecaoTexto('II. O QUE FOI FALADO E DISCUTIDO PELO CONSELHO (ANÁLISE PEDAGÓGICA)', ata.oqueFoiFaladoDiscurso);
  renderSecaoTexto('III. O QUE FOI PENSADO E PROPOSTO (ESTRATÉGIAS, RECUPERAÇÃO E FOCO AEE)', ata.oqueFoiPensadoEstrategias);
  renderSecaoTexto(
    'IV. DECISÕES COLETIVAS E ENCAMINHAMENTOS',
    [ata.decisoesEncaminhamentos, observacoesGeraisTurma].filter(Boolean).join('\n')
  );

  // V. Tabela de Pauta / Deliberações Individuais
  const ativos = alunos.filter(a => a.isAtivo);
  const emPautaOuDeliberados = ativos
    .filter(a => a.precisaConversaConselho || a.deliberacao.status !== 'PENDENTE' || Boolean(a.deliberacao.parecer?.trim()))
    .sort((a, b) => b.scoreGravidade - a.scoreGravidade || a.numChamada - b.numChamada);

  if (ata.incluirTabelaDeliberacoes && emPautaOuDeliberados.length > 0) {
    ensureSpace(22);
    doc.setFont('times', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`V. REGISTRO DE ESTUDANTES ANALISADOS E DELIBERAÇÕES (${emPautaOuDeliberados.length})`, marginX, curY);
    curY += 3;

    autoTable(doc, {
      startY: curY,
      margin: { left: marginX, right: marginX },
      head: [['Nº', 'Estudante', 'Freq. Anual', 'Verm.', 'Motivo / Foco', 'Deliberação / Parecer']],
      body: emPautaOuDeliberados.map(a => {
        const flags: string[] = [];
        if (a.isAEE) flags.push('AEE');
        if (a.reprovandoPorFaltasGlobal) flags.push('Falta <75%');
        if (a.criticoNotas4Mais) flags.push('4+ Verm.');
        else if (a.qtdNotasVermelhas > 0) flags.push(`${a.qtdNotasVermelhas} Verm.`);
        if (flags.length === 0) flags.push('Pauta');

        const parecerTxt = [
          DELIBERACAO_LABELS[a.deliberacao.status],
          a.deliberacao.parecer || ''
        ]
          .filter(Boolean)
          .join(' — ');

        return [
          String(a.numChamada),
          a.nome,
          a.freqAnualStr,
          String(a.qtdNotasVermelhas),
          flags.join(', '),
          parecerTxt
        ];
      }),
      theme: 'grid',
      styles: {
        font: 'times',
        fontSize: 8,
        cellPadding: 1.8,
        textColor: [15, 23, 42],
        lineColor: [148, 163, 184],
        lineWidth: 0.2,
        valign: 'middle'
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8
      },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' },
        1: { cellWidth: 46 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 28 },
        5: { cellWidth: 'auto' }
      }
    });

    curY = ((doc as any).lastAutoTable?.finalY || curY + 20) + 6;
  }

  // VI. Quadro Oficial de Resultado Final e Enturmação para o Ano Seguinte (exclusivo do Conselho Final)
  const temResultadoFinal =
    metadata.bimestreKey === 'FINAL' &&
    (ata.incluirQuadroResultadoFinal ||
      alunos.some(a => a.deliberacao.resultadoFinal && a.deliberacao.resultadoFinal !== 'PENDENTE'));

  if (temResultadoFinal && alunos.length > 0) {
    ensureSpace(24);
    doc.setFont('times', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `VI. RESULTADO FINAL E ENTURMAÇÃO PARA O ANO LETIVO ${metadata.anoLetivo + 1}`,
      marginX,
      curY
    );
    curY += 4.5;

    const resumoFinalTxt = `Aprovados: ${stats.aprovadosCount}  |  Aprovados pelo Conselho: ${stats.aprovadosConselhoCount}  |  Reprovados: ${stats.reprovadosCount}  |  A definir: ${stats.pendentesFinalCount}  |  Transferidos/Inativos: ${stats.totalTransferidos}`;
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(resumoFinalTxt, marginX, curY);
    curY += 3;

    const todosOrdenados = [...alunos].sort((a, b) => a.numChamada - b.numChamada);
    autoTable(doc, {
      startY: curY,
      margin: { left: marginX, right: marginX },
      head: [['Nº', 'Estudante', 'Situação', 'Freq. Anual', 'Média', 'Resultado Final', `Turma ${metadata.anoLetivo + 1}`]],
      body: todosOrdenados.map(a => {
        const resKey = a.isAtivo
          ? (a.deliberacao.resultadoFinal || 'PENDENTE')
          : 'TRANSFERIDO_BAIXA';
        const resLabel = RESULTADO_FINAL_LABELS[resKey];
        const proxTurma = a.isAtivo
          ? (a.deliberacao.turmaAnoSeguinte || 'A definir')
          : 'Transferido';
        return [
          String(a.numChamada),
          `${a.nome}${a.isAEE ? ' (AEE)' : ''}`,
          a.situacao,
          a.freqAnualStr,
          a.mediaGlobalNotas !== null ? a.mediaGlobalNotas.toFixed(1) : '—',
          resLabel,
          proxTurma
        ];
      }),
      theme: 'grid',
      styles: {
        font: 'times',
        fontSize: 7.8,
        cellPadding: 1.7,
        textColor: [15, 23, 42],
        lineColor: [148, 163, 184],
        lineWidth: 0.2,
        valign: 'middle'
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8
      },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' },
        1: { cellWidth: 50 },
        2: { cellWidth: 20, halign: 'center' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 13, halign: 'center' },
        5: { cellWidth: 36 },
        6: { cellWidth: 'auto', fontStyle: 'bold' }
      }
    });

    curY = ((doc as any).lastAutoTable?.finalY || curY + 20) + 6;
  }

  // Fechamento Formal da Ata
  ensureSpace(16);
  doc.setFont('times', 'normal');
  doc.setFontSize(10.2);
  doc.setTextColor(15, 23, 42);
  const encerramentoTxt =
    'Nada mais havendo a tratar, deu-se por encerrada a sessão do Conselho, lavrando-se a presente ata que, após lida e achada conforme, vai devidamente assinada pela Equipe Gestora, corpo docente, representantes discentes e convidados presentes.';
  const encLines = doc.splitTextToSize(encerramentoTxt, contentW);
  encLines.forEach((ln: string) => {
    ensureSpace(5.5);
    doc.text(ln, marginX, curY);
    curY += 5;
  });
  curY += 5;

  // Helper para renderizar blocos de assinaturas em 2 colunas sem quebrar linhas entre páginas
  const renderGrupoAssinaturas = (
    tituloGrupo: string,
    itens: Array<{ linha1: string; linha2?: string }>
  ) => {
    if (itens.length === 0) return;
    ensureSpace(24);
    doc.setFont('times', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(tituloGrupo, marginX, curY);
    curY += 10;

    const colW = (contentW - 12) / 2;
    doc.setDrawColor(71, 85, 105);
    doc.setLineWidth(0.3);

    for (let i = 0; i < itens.length; i += 2) {
      ensureSpace(17);
      const left = itens[i];
      const right = itens[i + 1];

      // Coluna esquerda
      doc.line(marginX, curY, marginX + colW, curY);
      doc.setFont('times', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(left.linha1, colW)[0] || left.linha1, marginX + colW / 2, curY + 4, {
        align: 'center'
      });
      if (left.linha2) {
        doc.setFont('times', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(71, 85, 105);
        doc.text(doc.splitTextToSize(left.linha2, colW)[0] || left.linha2, marginX + colW / 2, curY + 7.8, {
          align: 'center'
        });
      }

      // Coluna direita
      if (right) {
        const rightX = marginX + colW + 12;
        doc.line(rightX, curY, rightX + colW, curY);
        doc.setFont('times', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        doc.text(doc.splitTextToSize(right.linha1, colW)[0] || right.linha1, rightX + colW / 2, curY + 4, {
          align: 'center'
        });
        if (right.linha2) {
          doc.setFont('times', 'normal');
          doc.setFontSize(7.8);
          doc.setTextColor(71, 85, 105);
          doc.text(doc.splitTextToSize(right.linha2, colW)[0] || right.linha2, rightX + colW / 2, curY + 7.8, {
            align: 'center'
          });
        }
      }

      curY += 15;
    }
    curY += 2;
  };

  // 1. Equipe Gestora (Direção, Vice-Direção, CGPG)
  renderGrupoAssinaturas('ASSINATURAS — EQUIPE GESTORA (DIREÇÃO, VICE-DIREÇÃO E CGPG)', [
    {
      linha1: ata.direcaoNome?.trim() || 'Direção Escolar',
      linha2: ata.direcaoNome?.trim() ? 'Direção Escolar' : 'Assinatura e Carimbo'
    },
    {
      linha1: ata.viceDirecaoNome?.trim() || 'Vice-Direção Escolar',
      linha2: ata.viceDirecaoNome?.trim() ? 'Vice-Direção Escolar' : 'Assinatura e Carimbo'
    },
    {
      linha1: ata.cgpgNome?.trim() || 'CGPG · Coordenação Geral de Gestão Pedagógica',
      linha2: ata.cgpgNome?.trim() ? 'CGPG · Coordenação Pedagógica' : 'Assinatura e Carimbo'
    }
  ]);

  // 2. Professores (Vários docentes + linhas extras em branco para assinatura presencial)
  const profAssinaturas: Array<{ linha1: string; linha2?: string }> = (ata.professores || [])
    .filter(p => p.nome.trim())
    .map(p => ({
      linha1: p.nome.trim(),
      linha2: p.detalhe?.trim() ? `Professor(a) · ${p.detalhe.trim()}` : 'Professor(a)'
    }));
  const extrasProf = Math.max(0, Number(ata.linhasEmBrancoProfessores) || 0);
  for (let i = 0; i < extrasProf; i++) {
    profAssinaturas.push({
      linha1: `Professor(a) / Componente Curricular`,
      linha2: 'Nome legível e Assinatura'
    });
  }
  renderGrupoAssinaturas('ASSINATURAS — CORPO DOCENTE (PROFESSORES DA TURMA)', profAssinaturas);

  // 3. Estudantes Representantes
  const alunosAssinaturas: Array<{ linha1: string; linha2?: string }> = (ata.alunosRepresentantes || [])
    .filter(a => a.nome.trim())
    .map(a => ({
      linha1: a.nome.trim(),
      linha2: a.detalhe?.trim() || `Representante Discente · ${metadata.turmaNormalizada}`
    }));
  const extrasAl = Math.max(0, Number(ata.linhasEmBrancoAlunos) || 0);
  for (let i = 0; i < extrasAl; i++) {
    alunosAssinaturas.push({
      linha1: 'Estudante Representante',
      linha2: 'Nome legível e Assinatura'
    });
  }
  renderGrupoAssinaturas('ASSINATURAS — REPRESENTANTES DOS ESTUDANTES', alunosAssinaturas);

  // 4. Convidados / Equipe de Apoio / Responsáveis
  const convAssinaturas: Array<{ linha1: string; linha2?: string }> = (ata.convidados || [])
    .filter(c => c.nome.trim())
    .map(c => ({
      linha1: c.nome.trim(),
      linha2: c.detalhe?.trim() || 'Convidado(a) / Participante'
    }));
  const extrasConv = Math.max(0, Number(ata.linhasEmBrancoConvidados) || 0);
  for (let i = 0; i < extrasConv; i++) {
    convAssinaturas.push({
      linha1: 'Convidado(a) / Responsável / Equipe de Apoio',
      linha2: 'Nome legível, Função e Assinatura'
    });
  }
  renderGrupoAssinaturas('ASSINATURAS — CONVIDADOS E DEMAIS PARTICIPANTES', convAssinaturas);

  // Rodapé com paginação oficial
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('times', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `E.E. Prof. Clóvis de Lucca · Ata Oficial do Conselho (${metadata.turmaNormalizada}) · Página ${p} de ${totalPages}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  const slugTurma = metadata.turmaNormalizada.replace(/[^A-Z0-9]+/gi, '_');
  const fileName = `Ata_Conselho_${slugTurma}_${metadata.bimestreKey}_${metadata.anoLetivo}.pdf`;
  doc.save(fileName);
  return fileName;
}
