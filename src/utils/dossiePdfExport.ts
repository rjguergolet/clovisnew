import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface DossiePdfOcorrencia {
  id?: string;
  origem?: string;
  tipo?: string;
  data?: string;
  descricao?: string;
  observacao?: string;
  encaminhamento?: string;
  tipoContato?: string;
  houveResposta?: boolean | string | null;
  usuario?: string;
  autor?: string;
  autor_nome?: string;
  autor_email?: string;
  isAtraso?: boolean;
  isDispensa?: boolean;
  dataInicio?: string;
  dataFim?: string;
  motivoDispensa?: string;
  rawDoc?: any;
}

export interface DossiePdfInput {
  logoUrl: string;
  nome: string;
  raVal: string;
  numChamada: string;
  turma: string;
  status: string;
  segmento: string;
  freqVal: string;
  freqData: string;
  atrasos: number;
  mediaFormatada: string;
  detalheBimestres: string;
  bimestresContados: number;
  recomposicaoVal: string;
  aeeVal: string;
  tutor: string;
  clube: string;
  eletiva: string;
  protagonismo: string;
  projetoVida: string;
  evolucao: string;
  dataEmissao: string;
  fechamentoNotas: Record<string, any>;
  situacaoFinal?: string;
  ocorrencias: DossiePdfOcorrencia[];
  extrairSomenteNomeAutor: (autorRaw: any, recordObj?: any) => string;
  formatarDataBR?: (dt: any) => string;
}

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
    const offsetX = (size - drawW) / 2;
    const offsetY = (size - drawH) / 2;
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function limparNomeDisciplinaPdf(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLastTableY(doc: jsPDF, fallbackY: number): number {
  const last = (doc as any).lastAutoTable;
  return last && typeof last.finalY === 'number' ? last.finalY : fallbackY;
}

export async function gerarESalvarDossieAlunoPdf(dados: DossiePdfInput): Promise<string> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 13;
  const contentWidth = pageWidth - margin * 2;

  const logoPng = await carregarLogoPngDataUrl(dados.logoUrl);

  const desenharCabecalho = () => {
    const topY = 10;
    if (logoPng) {
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, topY, 16, 16, 1.5, 1.5, 'FD');
      doc.addImage(logoPng, 'PNG', margin + 1, topY + 1, 14, 14);
    }

    const textX = logoPng ? margin + 19 : margin;
    const rightColWidth = 42;
    const maxTitleW = contentWidth - (textX - margin) - rightColWidth;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GOVERNO DO ESTADO DE SÃO PAULO • SECRETARIA DA EDUCAÇÃO', textX, topY + 3.2);

    doc.setFontSize(10.5);
    doc.setTextColor(23, 37, 84);
    doc.text('E.E. CLÓVIS DE LUCCA • PROGRAMA DE ENSINO INTEGRAL (PEI)', textX, topY + 7.8);

    doc.setFontSize(8.5);
    doc.setTextColor(30, 64, 175);
    const tituloEstudante = `DOSSIÊ ESCOLAR OFICIAL: ${dados.nome.toUpperCase()}`;
    const linhasNome = doc.splitTextToSize(tituloEstudante, maxTitleW);
    doc.text(linhasNome[0] || tituloEstudante, textX, topY + 12.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `RA: ${dados.raVal}   •   Turma: ${dados.turma.toUpperCase()}   •   Nº: ${dados.numChamada}`,
      textX,
      topY + 16.4
    );

    // Bloco direito: Emissão & Status
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(`Emissão: ${dados.dataEmissao}`, pageWidth - margin, topY + 5, { align: 'right' });

    const isAtivo = String(dados.status || 'ATIVO').toUpperCase() === 'ATIVO';
    doc.setFontSize(7.5);
    doc.setTextColor(isAtivo ? 6 : 146, isAtivo ? 95 : 64, isAtivo ? 70 : 14);
    doc.text(`STATUS: ${String(dados.status || 'ATIVO').toUpperCase()}`, pageWidth - margin, topY + 10.5, {
      align: 'right'
    });

    // Linha divisória oficial
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.6);
    doc.line(margin, topY + 19.5, pageWidth - margin, topY + 19.5);
    doc.setLineWidth(0.2);

    return topY + 23.5;
  };

  let y = desenharCabecalho();

  const desenharTituloSecao = (titulo: string, subtitulo?: string) => {
    if (y + 16 > pageHeight - 18) {
      doc.addPage();
      y = desenharCabecalho();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 58, 138);
    doc.text(titulo.toUpperCase(), margin, y);
    if (subtitulo) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(subtitulo, pageWidth - margin, y, { align: 'right' });
    }
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y + 1.4, pageWidth - margin, y + 1.4);
    y += 3.2;
  };

  // =========================================================================
  // 1. IDENTIFICAÇÃO DO ESTUDANTE & FREQUÊNCIA ESCOLAR
  // =========================================================================
  desenharTituloSecao('1. Identificação do Estudante & Frequência Escolar', 'SED SP / Frequência Oficial');

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      valign: 'middle'
    },
    columnStyles: {
      0: { fillColor: [241, 245, 249], fontStyle: 'bold', cellWidth: 38 },
      1: { cellWidth: contentWidth / 2 - 38 },
      2: { fillColor: [241, 245, 249], fontStyle: 'bold', cellWidth: 36 },
      3: { cellWidth: contentWidth / 2 - 36 }
    },
    body: [
      [
        'Nome do Aluno:',
        { content: dados.nome.toUpperCase(), styles: { fontStyle: 'bold', textColor: [23, 37, 84] } },
        'RA (SED):',
        { content: dados.raVal, styles: { fontStyle: 'bold' } }
      ],
      [
        'Turma / Série:',
        { content: `${dados.turma.toUpperCase()} (Nº ${dados.numChamada})`, styles: { fontStyle: 'bold', textColor: [30, 58, 138] } },
        'Segmento:',
        dados.segmento.toUpperCase()
      ],
      [
        'Frequência Atual:',
        {
          content: `${dados.freqVal} (${dados.freqData})`,
          styles: {
            fontStyle: 'bold',
            textColor: dados.freqVal.includes('%') && parseFloat(dados.freqVal) < 75 ? [185, 28, 28] : [30, 58, 138]
          }
        },
        'Atrasos Registrados:',
        { content: `${dados.atrasos} evento(s)`, styles: { fontStyle: 'bold', textColor: [146, 64, 14] } }
      ],
      [
        'Média Geral SED:',
        {
          content: `${dados.mediaFormatada} (${dados.detalheBimestres})`,
          styles: { fontStyle: 'bold' }
        },
        'Bimestres SED:',
        dados.bimestresContados > 0 ? `${dados.bimestresContados} bimestre(s)` : 'Aguardando SED'
      ],
      [
        'Projeto Recomposição:',
        dados.recomposicaoVal === 'SIM' ? 'SIM (Reforço Intensivo)' : 'NÃO',
        'Educação Especial (AEE):',
        dados.aeeVal === 'SIM' ? 'SIM (Atendimento Especializado)' : 'NÃO'
      ]
    ]
  });

  y = getLastTableY(doc, y) + 5;

  // =========================================================================
  // 2. TUTORIA, PROTAGONISMO JUVENIL & PROJETO DE VIDA
  // =========================================================================
  desenharTituloSecao('2. Tutoria, Protagonismo Juvenil & Projeto de Vida');

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      valign: 'middle'
    },
    columnStyles: {
      0: { fillColor: [241, 245, 249], fontStyle: 'bold', cellWidth: 38 },
      1: { cellWidth: contentWidth / 2 - 38 },
      2: { fillColor: [241, 245, 249], fontStyle: 'bold', cellWidth: 36 },
      3: { cellWidth: contentWidth / 2 - 36 }
    },
    body: [
      ['Tutor Responsável:', dados.tutor.toUpperCase(), 'Clube Juvenil:', dados.clube.toUpperCase()],
      ['Eletiva Escolar:', dados.eletiva.toUpperCase(), 'Protagonismo:', dados.protagonismo.toUpperCase()],
      [
        'Sonhos & Projeto de Vida:',
        { content: dados.projetoVida || '—', colSpan: 3, styles: { fontStyle: 'italic' } }
      ]
    ]
  });

  y = getLastTableY(doc, y) + 5;

  // =========================================================================
  // 3. PARECER PEDAGÓGICO & EVOLUÇÃO DO ESTUDANTE
  // =========================================================================
  desenharTituloSecao('3. Parecer Pedagógico & Evolução do Estudante');

  const parecerTexto = dados.evolucao && dados.evolucao.trim() !== '' && dados.evolucao.trim() !== '—'
    ? dados.evolucao.trim()
    : 'Nenhum parecer cadastrado até o momento.';

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 3,
      lineColor: [203, 213, 225],
      lineWidth: 0.2,
      fillColor: [248, 250, 252],
      textColor: [30, 41, 59],
      overflow: 'linebreak'
    },
    body: [[parecerTexto]]
  });

  y = getLastTableY(doc, y) + 5;

  // =========================================================================
  // 4. RENDIMENTO ESCOLAR & FECHAMENTO DE NOTAS (SED)
  // =========================================================================
  desenharTituloSecao('4. Rendimento Escolar & Fechamento de Notas (SED)', 'Quadro Comparativo Oficial');

  const fn = dados.fechamentoNotas || {};
  const bKeys = ['1B', '2B', '3B', '4B', 'FINAL'];
  const discMap = new Map<string, Record<string, string>>();

  bKeys.forEach(bk => {
    const periodo = fn[bk];
    if (periodo && periodo.disciplinas && typeof periodo.disciplinas === 'object') {
      Object.entries(periodo.disciplinas).forEach(([key, dVal]: [string, any]) => {
        const nomeDisc = limparNomeDisciplinaPdf((dVal && typeof dVal === 'object' && dVal.nome) ? dVal.nome : key);
        if (!nomeDisc) return;
        if (!discMap.has(nomeDisc)) discMap.set(nomeDisc, {});
        const entry = discMap.get(nomeDisc)!;
        let notaStr = '—';
        if (dVal && typeof dVal === 'object') {
          if (dVal.mencaoNota !== undefined && dVal.mencaoNota !== null && dVal.mencaoNota !== '') {
            notaStr = String(dVal.mencaoNota);
          } else if (dVal.notaNum !== undefined && dVal.notaNum !== null) {
            notaStr = String(dVal.notaNum);
          } else if (dVal.nota !== undefined && dVal.nota !== null) {
            notaStr = String(dVal.nota);
          }
          if (dVal.faltas !== undefined && dVal.faltas !== null && Number(dVal.faltas) > 0) {
            notaStr += ` (${dVal.faltas}F)`;
          }
        } else if (dVal !== undefined && dVal !== null) {
          notaStr = String(dVal);
        }
        entry[bk] = notaStr;
      });
    }
  });

  if (discMap.size > 0) {
    const rowsNotas = Array.from(discMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([disc, vals]) => [
        disc,
        vals['1B'] || '—',
        vals['2B'] || '—',
        vals['3B'] || '—',
        vals['4B'] || '—',
        vals['FINAL'] || '—'
      ]);

    rowsNotas.push([
      'MÉDIA GERAL / FALTAS',
      fn['1B'] ? `${fn['1B'].mediaGeral ?? '—'} (${fn['1B'].totalFaltas ?? 0}F)` : '—',
      fn['2B'] ? `${fn['2B'].mediaGeral ?? '—'} (${fn['2B'].totalFaltas ?? 0}F)` : '—',
      fn['3B'] ? `${fn['3B'].mediaGeral ?? '—'} (${fn['3B'].totalFaltas ?? 0}F)` : '—',
      fn['4B'] ? `${fn['4B'].mediaGeral ?? '—'} (${fn['4B'].totalFaltas ?? 0}F)` : '—',
      fn['FINAL'] ? `${fn['FINAL'].mediaGeral ?? '—'} (${fn['FINAL'].totalFaltas ?? 0}F)` : (dados.situacaoFinal || 'Em Curso')
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [30, 41, 59],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center'
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 1.6,
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
        halign: 'center'
      },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold', cellWidth: 62 }
      },
      head: [['Componente Curricular', '1º Bim', '2º Bim', '3º Bim', '4º Bim', 'Final']],
      body: rowsNotas,
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.row.index === rowsNotas.length - 1) {
          hookData.cell.styles.fillColor = [239, 246, 255];
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.textColor = [30, 58, 138];
        }
      }
    });
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [30, 41, 59],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center'
      },
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2,
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        halign: 'center'
      },
      head: [['1º Bimestre', '2º Bimestre', '3º Bimestre', '4º Bimestre', 'Conselho Final', 'Média Consolidada']],
      body: [[
        fn['1B']?.mediaGeral !== undefined ? `${fn['1B'].mediaGeral}${fn['1B'].totalFaltas !== undefined ? ` (${fn['1B'].totalFaltas}F)` : ''}` : '—',
        fn['2B']?.mediaGeral !== undefined ? `${fn['2B'].mediaGeral}${fn['2B'].totalFaltas !== undefined ? ` (${fn['2B'].totalFaltas}F)` : ''}` : '—',
        fn['3B']?.mediaGeral !== undefined ? `${fn['3B'].mediaGeral}${fn['3B'].totalFaltas !== undefined ? ` (${fn['3B'].totalFaltas}F)` : ''}` : '—',
        fn['4B']?.mediaGeral !== undefined ? `${fn['4B'].mediaGeral}${fn['4B'].totalFaltas !== undefined ? ` (${fn['4B'].totalFaltas}F)` : ''}` : '—',
        fn['FINAL']?.mediaGeral !== undefined ? String(fn['FINAL'].mediaGeral) : (dados.situacaoFinal || 'Em Curso'),
        `${dados.mediaFormatada} (${dados.detalheBimestres})`
      ]]
    });
  }

  y = getLastTableY(doc, y) + 5;

  // =========================================================================
  // 5. HISTÓRICO UNIFICADO DE OCORRÊNCIAS PEDAGÓGICAS, CONVIVA E BUSCA ATIVA
  //    (Sem Controle Conviva, sem e-mail, autor em destaque sutil embaixo)
  // =========================================================================
  desenharTituloSecao(
    '5. Histórico Unificado de Ocorrências Pedagógicas, CONVIVA e Busca Ativa',
    `${dados.ocorrencias.length} registro(s)`
  );

  if (dados.ocorrencias.length > 0) {
    const bodyAcoes = dados.ocorrencias.map((ac, idx) => {
      const dataStr = dados.formatarDataBR
        ? (dados.formatarDataBR(ac.data) || ac.data || '—')
        : (ac.data || '—');

      const origemUp = String(ac.origem || '').toUpperCase();
      const isBA = origemUp === 'BUSCA_ATIVA';
      const tipoLabel = `${isBA ? 'BUSCA ATIVA' : 'OCORRÊNCIA'}\n${String(ac.tipo || (isBA ? 'BUSCA ATIVA' : 'OCORRÊNCIA')).toUpperCase()}`;

      const descLimpa = String(ac.descricao || ac.observacao || '—').trim();
      const partesRelato: string[] = [descLimpa];

      if (isBA && (ac.tipoContato || (ac.houveResposta !== null && ac.houveResposta !== undefined))) {
        const canal = ac.tipoContato ? `Canal: ${ac.tipoContato}` : '';
        const retorno = ac.houveResposta === true || ac.houveResposta === 'sim'
          ? 'Retorno da família: Sim'
          : (ac.houveResposta === false || ac.houveResposta === 'nao' ? 'Retorno da família: Sem resposta' : '');
        const linhaBa = [canal, retorno].filter(Boolean).join(' • ');
        if (linhaBa) partesRelato.push(linhaBa);
      }

      if (ac.isDispensa && ac.dataInicio && ac.dataFim) {
        const ini = String(ac.dataInicio).split('-').reverse().join('/');
        const fim = String(ac.dataFim).split('-').reverse().join('/');
        partesRelato.push(`Período de Dispensa: ${ini} a ${fim}${ac.motivoDispensa ? ` (${ac.motivoDispensa})` : ''}`);
      }

      const encLimpo = String(ac.encaminhamento || '').trim();
      if (encLimpo && !descLimpa.toLowerCase().includes(encLimpo.toLowerCase())) {
        partesRelato.push(`Encaminhamento: ${encLimpo}`);
      }

      const nomeAutor = dados.extrairSomenteNomeAutor(ac.usuario || ac.autor, ac.rawDoc || ac);
      partesRelato.push(`Registrado por: ${nomeAutor}`);

      return [
        String(idx + 1),
        String(dataStr),
        tipoLabel,
        partesRelato.join('\n')
      ];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      showHead: 'everyPage',
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [30, 41, 59],
        fontStyle: 'bold',
        fontSize: 7.5
      },
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2.2,
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
        valign: 'top',
        overflow: 'linebreak'
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9, fontStyle: 'bold', textColor: [100, 116, 139] },
        1: { cellWidth: 21, fontSize: 7.5 },
        2: { cellWidth: 32, fontStyle: 'bold', fontSize: 7.5 },
        3: { cellWidth: contentWidth - 62 }
      },
      head: [['#', 'Data', 'Origem / Tipo', 'Registro / Relato & Encaminhamentos']],
      body: bodyAcoes
    });
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 3,
        fillColor: [248, 250, 252],
        textColor: [100, 116, 139],
        fontStyle: 'italic'
      },
      body: [['Nenhum registro de ocorrência pedagógica ou busca ativa localizado no histórico do estudante.']]
    });
  }

  y = getLastTableY(doc, y) + 8;

  // =========================================================================
  // TERMO DE CIÊNCIA & ASSINATURAS OFICIAIS (2x2 COM ESPAÇO REAL DE ASSINATURA)
  // =========================================================================
  const alturaBlocoAssinaturas = 52;
  if (y + alturaBlocoAssinaturas > pageHeight - 14) {
    doc.addPage();
    y = desenharCabecalho() + 4;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TERMO DE CIÊNCIA & VALIDAÇÃO INSTITUCIONAL', pageWidth / 2, y, { align: 'center' });
  y += 4;

  const colW = (contentWidth - 16) / 2;
  const xLeft = margin;
  const xRight = margin + colW + 16;

  const assinaturas = [
    { x: xLeft, row: 0, titulo: 'PROFESSOR(A) TUTOR(A) PEI', sub: dados.tutor.toUpperCase() },
    { x: xRight, row: 0, titulo: 'COORDENAÇÃO PEDAGÓGICA', sub: 'EQUIPE DE GESTÃO PEI • CARIMBO / ASSINATURA' },
    { x: xLeft, row: 1, titulo: 'DIREÇÃO ESCOLAR', sub: 'E.E. CLÓVIS DE LUCCA • CARIMBO / ASSINATURA' },
    { x: xRight, row: 1, titulo: 'RESPONSÁVEL LEGAL', sub: 'CIÊNCIA DA FAMÍLIA • DATA: ____/____/2026' }
  ];

  assinaturas.forEach(item => {
    const baseLineY = y + (item.row === 0 ? 14 : 35); // 14mm livre acima da linha!
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.3);
    doc.line(item.x, baseLineY, item.x + colW, baseLineY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(item.titulo, item.x + colW / 2, baseLineY + 3.8, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    const subTrunc = item.sub.length > 44 ? item.sub.slice(0, 41) + '...' : item.sub;
    doc.text(subTrunc, item.x + colW / 2, baseLineY + 7.2, { align: 'center' });
  });

  // Rodapé com paginação em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `E.E. CLÓVIS DE LUCCA • PROGRAMA DE ENSINO INTEGRAL • DOCUMENTO OFICIAL DE USO ESCOLAR`,
      margin,
      pageHeight - 7
    );
    doc.text(`Página ${p} de ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  const nomeSlug = String(dados.nome || 'Estudante')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 45);
  const raSlug = String(dados.raVal || 'RA').replace(/[^a-zA-Z0-9_-]+/g, '');
  const fileName = `Dossie_${nomeSlug}_${raSlug}.pdf`;

  doc.save(fileName);
  return fileName;
}
