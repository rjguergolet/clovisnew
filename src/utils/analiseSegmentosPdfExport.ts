import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type SegmentoRelatorioPdf = 'GERAL' | 'ENSINO FUNDAMENTAL' | 'ENSINO MÉDIO';
export type TipoRelatorioPdf = 'GERAL' | 'FALTAS' | 'ATRASOS';
export type ModoSaidaPdf = 'download' | 'print';

export interface ContatoResumoPdf {
  data?: string;
  canal?: string;
  statusRetorno?: string;
  resumo?: string;
}

export interface EncaminhamentoResumoPdf {
  data?: string;
  tipo?: string;
  resumo?: string;
}

export interface EstudanteRelatorioPdf {
  ra?: string;
  nome?: string;
  turma?: string;
  frequencia?: string;
  faltasConsecutivas?: number;
  atrasos?: number;
  sla?: string;
  totalContatos?: number;
  diasSemContato?: number | null;
  ultimoContato?: ContatoResumoPdf | null;
  ultimoEncaminhamento?: EncaminhamentoResumoPdf | null;
}

export interface TurmaAfetadaPdf {
  turma: string;
  total: number;
  emAlertaFreq: number;
  faltasConsec: number;
  totalAtrasos: number;
  semContato: number;
}

export interface DadosSegmentoPdf {
  segmento: string;
  totalAtivos: number;
  mediaFrequencia: number | null;
  presencaRegular: number;
  alertaBuscaAtiva: number;
  faltasConsecutivas2Mais: number;
  faltasConsecutivas3Mais: number;
  atrasosRecorrentes: number;
  totalAtrasosSegmento: number;
  encaminhadosConselhoOuRede: number;
  emRiscoSemNenhumContato: number;
  aguardandoOuSemRetornoFamiliar: number;
  turmasMaisAfetadas: TurmaAfetadaPdf[];
  todosFaltasEPresenca: EstudanteRelatorioPdf[];
  todosAtrasos: EstudanteRelatorioPdf[];
}

export interface ItemBuscaAtivaIaPdf {
  estudanteOuTurma?: string;
  ra?: string;
  situacao?: string;
  ultimoContatoEEncaminhamento?: string;
  proximoPasso?: string;
}

export interface AcaoPraticaIaPdf {
  foco?: string;
  acao?: string;
  responsavelSugerido?: string;
  prazo?: string;
}

export interface SecaoIaSegmentoPdf {
  nivelPrioridade?: string;
  panorama?: string;
  buscaAtivaFaltasEPresenca?: Array<ItemBuscaAtivaIaPdf | string>;
  buscaAtivaAtrasos?: Array<ItemBuscaAtivaIaPdf | string>;
  acompanhamentoContatosEEncaminhamentos?: string[];
  padroesIdentificados?: string[];
  acoesPraticas?: Array<AcaoPraticaIaPdf | string>;
}

export interface RelatorioIaSegmentosPdf {
  resumoExecutivo?: string;
  comparativoEntreSegmentos?: string;
  ensinoFundamental?: SecaoIaSegmentoPdf;
  ensinoMedio?: SecaoIaSegmentoPdf;
}

export interface AnaliseSegmentosPdfInput {
  logoUrl?: string;
  emitidoPor?: string;
  dataEmissao?: string;
  segmento: SegmentoRelatorioPdf;
  tipo: TipoRelatorioPdf;
  modo: ModoSaidaPdf;
  relatorioIa: RelatorioIaSegmentosPdf;
  dadosEF: DadosSegmentoPdf;
  dadosEM: DadosSegmentoPdf;
}

function limparTextoPdf(raw: any): string {
  return String(raw ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatarDataSimples(iso?: string): string {
  if (!iso) return '—';
  const s = String(iso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function formatarUltimoContato(al: EstudanteRelatorioPdf): string {
  if (!al.ultimoContato) {
    return 'Nenhum contato registrado';
  }
  const dt = formatarDataSimples(al.ultimoContato.data);
  const canal = limparTextoPdf(al.ultimoContato.canal || 'Contato');
  const status = limparTextoPdf(al.ultimoContato.statusRetorno || '');
  const dias = typeof al.diasSemContato === 'number' ? ` (há ${al.diasSemContato}d)` : '';
  const totalTxt = al.totalContatos && al.totalContatos > 1 ? ` [${al.totalContatos}x]` : '';
  return `${dt}${dias} • ${canal}${status ? ` — ${status}` : ''}${totalTxt}`;
}

function formatarEncaminhamento(al: EstudanteRelatorioPdf): string {
  if (al.ultimoEncaminhamento) {
    const dt = formatarDataSimples(al.ultimoEncaminhamento.data);
    const tipo = limparTextoPdf(al.ultimoEncaminhamento.tipo || 'Encaminhamento');
    return `${dt} • ${tipo}`;
  }
  const sla = limparTextoPdf(al.sla || '');
  if (sla === 'ENCAMINHADO_CONSELHO') return 'Encaminhado ao Conselho / Rede';
  return 'Sem encaminhamento formal';
}

async function carregarLogoPngDataUrl(url?: string): Promise<string | null> {
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

function getLastTableY(doc: jsPDF, fallbackY: number): number {
  const last = (doc as any).lastAutoTable;
  return last && typeof last.finalY === 'number' ? last.finalY : fallbackY;
}

function filtrarAcoesPorTipo(
  acoes: Array<AcaoPraticaIaPdf | string> | undefined,
  tipo: TipoRelatorioPdf
): Array<AcaoPraticaIaPdf | string> {
  if (!Array.isArray(acoes)) return [];
  if (tipo === 'GERAL') return acoes;
  const filtradas = acoes.filter(a => {
    const txt = typeof a === 'string'
      ? a.toUpperCase()
      : `${a.foco || ''} ${a.acao || ''}`.toUpperCase();
    if (tipo === 'ATRASOS') {
      return txt.includes('ATRASO') || txt.includes('PONTUAL') || txt.includes('ENTRADA') || txt.includes('HORÁRIO') || txt.includes('HORARIO') || txt.includes('CONTATO');
    }
    if (tipo === 'FALTAS') {
      return txt.includes('FALTA') || txt.includes('FREQU') || txt.includes('PRESEN') || txt.includes('EVAS') || txt.includes('CONSELHO') || txt.includes('CONTATO') || txt.includes('ENCAMINH');
    }
    return true;
  });
  return filtradas.length > 0 ? filtradas : acoes;
}

function imprimirBlobPdfViaIframe(blob: Blob, fallbackSave: () => void): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    fallbackSave();
    return;
  }
  const url = URL.createObjectURL(blob);
  const existing = document.getElementById('iframe-print-analise-ia-pdf');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'iframe-print-analise-ia-pdf';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  iframe.src = url;

  const cleanup = () => {
    setTimeout(() => {
      try {
        iframe.remove();
        URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup error
      }
    }, 60000);
  };

  iframe.onload = () => {
    try {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          cleanup();
        } catch {
          fallbackSave();
          cleanup();
        }
      }, 350);
    } catch {
      fallbackSave();
      cleanup();
    }
  };

  iframe.onerror = () => {
    fallbackSave();
    cleanup();
  };

  document.body.appendChild(iframe);
}

export async function gerarRelatorioAnaliseSegmentosPdf(input: AnaliseSegmentosPdfInput): Promise<string> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const logoPng = await carregarLogoPngDataUrl(input.logoUrl);

  const dataEmissao = input.dataEmissao || new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const labelSegmento =
    input.segmento === 'ENSINO FUNDAMENTAL'
      ? 'ENSINO FUNDAMENTAL (6º AO 9º ANO)'
      : input.segmento === 'ENSINO MÉDIO'
        ? 'ENSINO MÉDIO (1ª À 3ª SÉRIE)'
        : 'GERAL (ENSINO FUNDAMENTAL E ENSINO MÉDIO)';

  const labelTipo =
    input.tipo === 'FALTAS'
      ? 'SOMENTE FALTAS CONSECUTIVAS & PRESENÇA'
      : input.tipo === 'ATRASOS'
        ? 'SOMENTE MAIORES ATRASOS REGISTRADOS'
        : 'RELATÓRIO GERAL (FALTAS, PRESENÇA E ATRASOS)';

  const tituloPrincipal = `RELATÓRIO DE BUSCA ATIVA — ${labelTipo}`;
  const subtituloEscopo = `Segmento: ${labelSegmento}${input.emitidoPor ? `   •   Emitido por: ${limparTextoPdf(input.emitidoPor)}` : ''}`;

  const desenharCabecalhoPagina = (): number => {
    const topY = 9;
    if (logoPng) {
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, topY, 15, 15, 1.5, 1.5, 'FD');
      doc.addImage(logoPng, 'PNG', margin + 1, topY + 1, 13, 13);
    }

    const textX = logoPng ? margin + 18 : margin;
    const rightColW = 38;
    const maxTitleW = contentWidth - (textX - margin) - rightColW;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text('GOVERNO DO ESTADO DE SÃO PAULO • SECRETARIA DA EDUCAÇÃO', textX, topY + 3);

    doc.setFontSize(10);
    doc.setTextColor(23, 37, 84);
    doc.text('E.E. CLÓVIS DE LUCCA • PROGRAMA DE ENSINO INTEGRAL (PEI)', textX, topY + 7.2);

    doc.setFontSize(8.2);
    doc.setTextColor(30, 64, 175);
    const linhasTit = doc.splitTextToSize(tituloPrincipal, maxTitleW);
    doc.text(linhasTit[0] || tituloPrincipal, textX, topY + 11.4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    const linhasSub = doc.splitTextToSize(subtituloEscopo, maxTitleW + 10);
    doc.text(linhasSub[0] || subtituloEscopo, textX, topY + 15.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`Emissão: ${dataEmissao}`, pageWidth - margin, topY + 4.5, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Análise IA + Base Real', pageWidth - margin, topY + 8.5, { align: 'right' });

    doc.setDrawColor(23, 37, 84);
    doc.setLineWidth(0.5);
    doc.line(margin, topY + 17.5, pageWidth - margin, topY + 17.5);
    return topY + 21.5;
  };

  let curY = desenharCabecalhoPagina();

  const garantirEspaco = (alturaNecessaria: number) => {
    if (curY + alturaNecessaria > pageHeight - 16) {
      doc.addPage();
      curY = desenharCabecalhoPagina();
    }
  };

  const desenharTituloSecao = (texto: string, rgb: [number, number, number] = [23, 37, 84]) => {
    garantirEspaco(11);
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(margin, curY, contentWidth, 6.8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text(limparTextoPdf(texto).toUpperCase(), margin + 2.8, curY + 4.6);
    curY += 9.2;
  };

  const desenharSubtitulo = (texto: string, rgb: [number, number, number] = [30, 41, 59]) => {
    garantirEspaco(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    doc.text(limparTextoPdf(texto), margin, curY + 3.2);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, curY + 4.6, pageWidth - margin, curY + 4.6);
    curY += 6.8;
  };

  const desenharParagrafo = (texto: string, opts?: { boldPrefix?: string; fontSize?: number; fill?: boolean }) => {
    const clean = limparTextoPdf(texto);
    if (!clean) return;
    const fontSize = opts?.fontSize || 8.2;
    const fullText = opts?.boldPrefix ? `${opts.boldPrefix}: ${clean}` : clean;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    const padX = opts?.fill ? 3 : 0;
    const lines = doc.splitTextToSize(fullText, contentWidth - padX * 2);
    const lineH = fontSize * 0.48;
    const boxH = lines.length * lineH + (opts?.fill ? 4.5 : 1.5);
    garantirEspaco(boxH + 2);

    if (opts?.fill) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, curY, contentWidth, boxH, 1.2, 1.2, 'FD');
      doc.setTextColor(30, 41, 59);
      doc.text(lines, margin + padX, curY + 3.8);
      curY += boxH + 2.5;
    } else {
      doc.setTextColor(51, 65, 85);
      doc.text(lines, margin, curY + 3);
      curY += boxH + 1.5;
    }
  };

  const desenharGradeKpis = (itens: Array<{ label: string; valor: string; destaque?: 'rose' | 'amber' | 'blue' | 'slate' }>) => {
    const cols = itens.length;
    const gap = 2;
    const boxW = (contentWidth - gap * (cols - 1)) / cols;
    const boxH = 12.5;
    garantirEspaco(boxH + 3);

    itens.forEach((it, idx) => {
      const x = margin + idx * (boxW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, curY, boxW, boxH, 1.2, 1.2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(100, 116, 139);
      doc.text(limparTextoPdf(it.label).toUpperCase(), x + boxW / 2, curY + 4.3, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      if (it.destaque === 'rose') doc.setTextColor(190, 18, 60);
      else if (it.destaque === 'amber') doc.setTextColor(180, 83, 9);
      else if (it.destaque === 'blue') doc.setTextColor(29, 78, 216);
      else doc.setTextColor(15, 23, 42);
      doc.text(limparTextoPdf(it.valor), x + boxW / 2, curY + 9.8, { align: 'center' });
    });

    curY += boxH + 3.5;
  };

  // Resumo executivo global quando for GERAL
  if (input.segmento === 'GERAL') {
    const totalAtivos = input.dadosEF.totalAtivos + input.dadosEM.totalAtivos;
    const totalBa = input.dadosEF.alertaBuscaAtiva + input.dadosEM.alertaBuscaAtiva;
    const totalConsec = input.dadosEF.faltasConsecutivas2Mais + input.dadosEM.faltasConsecutivas2Mais;
    const totalAtrasos = input.dadosEF.totalAtrasosSegmento + input.dadosEM.totalAtrasosSegmento;
    const totalSemContato = input.dadosEF.emRiscoSemNenhumContato + input.dadosEM.emRiscoSemNenhumContato;
    const totalSemRetorno = input.dadosEF.aguardandoOuSemRetornoFamiliar + input.dadosEM.aguardandoOuSemRetornoFamiliar;

    desenharTituloSecao('Síntese Executiva da Unidade Escolar');
    if (input.tipo === 'FALTAS') {
      desenharGradeKpis([
        { label: 'Ativos Total', valor: String(totalAtivos), destaque: 'slate' },
        { label: 'Alerta Busca Ativa', valor: String(totalBa), destaque: totalBa > 0 ? 'rose' : 'slate' },
        { label: 'Faltas Consec. (2+)', valor: String(totalConsec), destaque: totalConsec > 0 ? 'rose' : 'slate' },
        { label: 'Sem Contato', valor: String(totalSemContato), destaque: totalSemContato > 0 ? 'rose' : 'slate' },
        { label: 'Sem Retorno', valor: String(totalSemRetorno), destaque: totalSemRetorno > 0 ? 'amber' : 'slate' }
      ]);
    } else if (input.tipo === 'ATRASOS') {
      const alunosComAtraso = input.dadosEF.todosAtrasos.length + input.dadosEM.todosAtrasos.length;
      const atrasosRec = input.dadosEF.atrasosRecorrentes + input.dadosEM.atrasosRecorrentes;
      desenharGradeKpis([
        { label: 'Ativos Total', valor: String(totalAtivos), destaque: 'slate' },
        { label: 'Estudantes c/ Atraso', valor: String(alunosComAtraso), destaque: alunosComAtraso > 0 ? 'amber' : 'slate' },
        { label: 'Atrasos Recorrentes (2+)', valor: String(atrasosRec), destaque: atrasosRec > 0 ? 'amber' : 'slate' },
        { label: 'Total de Atrasos', valor: String(totalAtrasos), destaque: totalAtrasos > 0 ? 'amber' : 'slate' },
        { label: 'Sem Contato', valor: String(totalSemContato), destaque: totalSemContato > 0 ? 'rose' : 'slate' }
      ]);
    } else {
      desenharGradeKpis([
        { label: 'Ativos', valor: String(totalAtivos), destaque: 'slate' },
        { label: 'Busca Ativa', valor: String(totalBa), destaque: totalBa > 0 ? 'rose' : 'slate' },
        { label: 'Faltas Cons.', valor: String(totalConsec), destaque: totalConsec > 0 ? 'rose' : 'slate' },
        { label: 'Atrasos Reg.', valor: String(totalAtrasos), destaque: totalAtrasos > 0 ? 'amber' : 'slate' },
        { label: 'Sem Contato', valor: String(totalSemContato), destaque: totalSemContato > 0 ? 'rose' : 'slate' },
        { label: 'Sem Retorno', valor: String(totalSemRetorno), destaque: totalSemRetorno > 0 ? 'amber' : 'slate' }
      ]);
    }

    if (input.relatorioIa.resumoExecutivo) {
      desenharParagrafo(input.relatorioIa.resumoExecutivo, { boldPrefix: 'Resumo Executivo', fill: true });
    }
    if (input.relatorioIa.comparativoEntreSegmentos) {
      desenharParagrafo(input.relatorioIa.comparativoEntreSegmentos, { boldPrefix: 'Comparativo Fundamental vs. Médio', fill: true });
    }
  }

  const segmentosParaImprimir: Array<{
    titulo: string;
    cor: [number, number, number];
    stats: DadosSegmentoPdf;
    ia?: SecaoIaSegmentoPdf;
  }> = [];

  if (input.segmento === 'GERAL' || input.segmento === 'ENSINO FUNDAMENTAL') {
    segmentosParaImprimir.push({
      titulo: 'Ensino Fundamental (6º ao 9º Ano)',
      cor: [23, 37, 84],
      stats: input.dadosEF,
      ia: input.relatorioIa.ensinoFundamental
    });
  }
  if (input.segmento === 'GERAL' || input.segmento === 'ENSINO MÉDIO') {
    segmentosParaImprimir.push({
      titulo: 'Ensino Médio (1ª à 3ª Série)',
      cor: [30, 58, 138],
      stats: input.dadosEM,
      ia: input.relatorioIa.ensinoMedio
    });
  }

  const renderTabelaIaPrioritarios = (
    titulo: string,
    corHead: [number, number, number],
    itens: Array<ItemBuscaAtivaIaPdf | string> | undefined,
    emptyMsg: string
  ) => {
    desenharSubtitulo(titulo, corHead);
    const list = Array.isArray(itens) ? itens : [];
    if (list.length === 0) {
      desenharParagrafo(emptyMsg);
      return;
    }
    const rows = list.map(it => {
      if (typeof it === 'string') {
        return [limparTextoPdf(it), '—', '—', '—'];
      }
      const nomeRa = limparTextoPdf(it.estudanteOuTurma || 'Estudante / Turma') + (it.ra ? `\nRA: ${limparTextoPdf(it.ra)}` : '');
      return [
        nomeRa,
        limparTextoPdf(it.situacao || '—'),
        limparTextoPdf(it.ultimoContatoEEncaminhamento || 'Sem registro prévio'),
        limparTextoPdf(it.proximoPasso || '—')
      ];
    });

    autoTable(doc, {
      startY: curY,
      margin: { left: margin, right: margin },
      head: [['Estudante / Turma', 'Situação Atual', 'Último Contato & Encaminhamento', 'Próximo Passo Recomendado (IA)']],
      body: rows,
      theme: 'grid',
      showHead: 'everyPage',
      styles: {
        font: 'helvetica',
        fontSize: 7.4,
        cellPadding: 2,
        textColor: [30, 41, 59],
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
        valign: 'top',
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: corHead,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.4
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        0: { cellWidth: 38, fontStyle: 'bold' },
        1: { cellWidth: 42 },
        2: { cellWidth: 50 },
        3: { cellWidth: contentWidth - 130 }
      }
    });
    curY = getLastTableY(doc, curY) + 4;
  };

  segmentosParaImprimir.forEach((seg, segIdx) => {
    if (segIdx > 0) {
      doc.addPage();
      curY = desenharCabecalhoPagina();
    }

    const prio = limparTextoPdf(seg.ia?.nivelPrioridade || 'ATENÇÃO').toUpperCase();
    desenharTituloSecao(
      `${seg.titulo} — Prioridade: ${prio} • Média Freq.: ${seg.stats.mediaFrequencia !== null ? `${seg.stats.mediaFrequencia}%` : '—'}`,
      seg.cor
    );

    if (input.tipo === 'FALTAS') {
      desenharGradeKpis([
        { label: 'Estudantes Ativos', valor: String(seg.stats.totalAtivos), destaque: 'slate' },
        { label: 'Alerta Busca Ativa', valor: String(seg.stats.alertaBuscaAtiva), destaque: seg.stats.alertaBuscaAtiva > 0 ? 'rose' : 'slate' },
        { label: 'Faltas Consec. (2+)', valor: String(seg.stats.faltasConsecutivas2Mais), destaque: seg.stats.faltasConsecutivas2Mais > 0 ? 'rose' : 'slate' },
        { label: 'Faltas Consec. (3+)', valor: String(seg.stats.faltasConsecutivas3Mais), destaque: seg.stats.faltasConsecutivas3Mais > 0 ? 'rose' : 'slate' },
        { label: 'Sem Contato', valor: String(seg.stats.emRiscoSemNenhumContato), destaque: seg.stats.emRiscoSemNenhumContato > 0 ? 'rose' : 'slate' },
        { label: 'Encaminhados', valor: String(seg.stats.encaminhadosConselhoOuRede), destaque: 'blue' }
      ]);
    } else if (input.tipo === 'ATRASOS') {
      desenharGradeKpis([
        { label: 'Estudantes Ativos', valor: String(seg.stats.totalAtivos), destaque: 'slate' },
        { label: 'Com Atraso Reg.', valor: String(seg.stats.todosAtrasos.length), destaque: seg.stats.todosAtrasos.length > 0 ? 'amber' : 'slate' },
        { label: 'Recorrentes (2+)', valor: String(seg.stats.atrasosRecorrentes), destaque: seg.stats.atrasosRecorrentes > 0 ? 'amber' : 'slate' },
        { label: 'Total Atrasos', valor: String(seg.stats.totalAtrasosSegmento), destaque: seg.stats.totalAtrasosSegmento > 0 ? 'amber' : 'slate' },
        { label: 'Sem Contato', valor: String(seg.stats.emRiscoSemNenhumContato), destaque: seg.stats.emRiscoSemNenhumContato > 0 ? 'rose' : 'slate' },
        { label: 'Sem Retorno', valor: String(seg.stats.aguardandoOuSemRetornoFamiliar), destaque: seg.stats.aguardandoOuSemRetornoFamiliar > 0 ? 'amber' : 'slate' }
      ]);
    } else {
      desenharGradeKpis([
        { label: 'Ativos', valor: String(seg.stats.totalAtivos), destaque: 'slate' },
        { label: 'Busca Ativa', valor: String(seg.stats.alertaBuscaAtiva), destaque: seg.stats.alertaBuscaAtiva > 0 ? 'rose' : 'slate' },
        { label: 'Faltas Cons.', valor: String(seg.stats.faltasConsecutivas2Mais), destaque: seg.stats.faltasConsecutivas2Mais > 0 ? 'rose' : 'slate' },
        { label: 'Atrasos', valor: String(seg.stats.totalAtrasosSegmento), destaque: seg.stats.totalAtrasosSegmento > 0 ? 'amber' : 'slate' },
        { label: 'Sem Contato', valor: String(seg.stats.emRiscoSemNenhumContato), destaque: seg.stats.emRiscoSemNenhumContato > 0 ? 'rose' : 'slate' },
        { label: 'Encaminh.', valor: String(seg.stats.encaminhadosConselhoOuRede), destaque: 'blue' }
      ]);
    }

    if (seg.ia?.panorama) {
      desenharParagrafo(seg.ia.panorama, { boldPrefix: 'Panorama do Segmento', fill: true });
    }

    // =========================================================================
    // BLOCO 1: FALTAS CONSECUTIVAS & PRESENÇA (para GERAL e FALTAS)
    // =========================================================================
    if (input.tipo === 'GERAL' || input.tipo === 'FALTAS') {
      renderTabelaIaPrioritarios(
        'Análise IA — Prioridades de Busca Ativa (Faltas Consecutivas & Presença)',
        [159, 18, 57],
        seg.ia?.buscaAtivaFaltasEPresenca,
        'Nenhum alerta crítico de faltas consecutivas ou baixa frequência identificado neste segmento.'
      );

      desenharSubtitulo(
        `Relação Completa de Estudantes — Faltas Consecutivas & Alerta de Presença (${seg.stats.todosFaltasEPresenca.length})`,
        [159, 18, 57]
      );
      if (seg.stats.todosFaltasEPresenca.length === 0) {
        desenharParagrafo('Nenhum estudante ativo com faltas consecutivas ou alerta de frequência neste segmento.');
      } else {
        const rowsFaltas = seg.stats.todosFaltasEPresenca.map((al, i) => [
          String(i + 1),
          `${limparTextoPdf(al.nome || 'Estudante')}\nRA: ${limparTextoPdf(al.ra || '—')}`,
          limparTextoPdf(al.turma || '—'),
          limparTextoPdf(al.frequencia || '—'),
          al.faltasConsecutivas && al.faltasConsecutivas > 0 ? `${al.faltasConsecutivas} dia(s)` : '0',
          formatarUltimoContato(al),
          formatarEncaminhamento(al)
        ]);

        autoTable(doc, {
          startY: curY,
          margin: { left: margin, right: margin },
          head: [['#', 'Estudante / RA', 'Turma', 'Freq.', 'F. Cons.', 'Último Contato / Retorno', 'Encaminhamento']],
          body: rowsFaltas,
          theme: 'grid',
          showHead: 'everyPage',
          styles: {
            font: 'helvetica',
            fontSize: 7.1,
            cellPadding: 1.8,
            textColor: [30, 41, 59],
            lineColor: [203, 213, 225],
            lineWidth: 0.2,
            valign: 'top',
            overflow: 'linebreak'
          },
          headStyles: {
            fillColor: [136, 19, 55],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7.2
          },
          alternateRowStyles: { fillColor: [255, 241, 242] },
          columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 44, fontStyle: 'bold' },
            2: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            3: { cellWidth: 14, halign: 'center' },
            4: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            5: { cellWidth: 50 },
            6: { cellWidth: contentWidth - 145 }
          }
        });
        curY = getLastTableY(doc, curY) + 4.5;
      }
    }

    // =========================================================================
    // BLOCO 2: MAIORES ATRASOS REGISTRADOS (para GERAL e ATRASOS)
    // =========================================================================
    if (input.tipo === 'GERAL' || input.tipo === 'ATRASOS') {
      renderTabelaIaPrioritarios(
        'Análise IA — Prioridades de Busca Ativa (Maiores Atrasos Registrados)',
        [146, 64, 14],
        seg.ia?.buscaAtivaAtrasos,
        'Nenhum caso prioritário de atrasos identificado pela IA neste segmento.'
      );

      desenharSubtitulo(
        `Relação Completa de Estudantes — Maiores Atrasos Registrados (${seg.stats.todosAtrasos.length})`,
        [146, 64, 14]
      );
      if (seg.stats.todosAtrasos.length === 0) {
        desenharParagrafo('Nenhum estudante ativo com atrasos registrados neste segmento.');
      } else {
        const rowsAtrasos = seg.stats.todosAtrasos.map((al, i) => [
          String(i + 1),
          `${limparTextoPdf(al.nome || 'Estudante')}\nRA: ${limparTextoPdf(al.ra || '—')}`,
          limparTextoPdf(al.turma || '—'),
          `${Number(al.atrasos || 0)}x`,
          limparTextoPdf(al.frequencia || '—'),
          formatarUltimoContato(al),
          formatarEncaminhamento(al)
        ]);

        autoTable(doc, {
          startY: curY,
          margin: { left: margin, right: margin },
          head: [['#', 'Estudante / RA', 'Turma', 'Atrasos', 'Freq.', 'Último Contato / Retorno', 'Encaminhamento']],
          body: rowsAtrasos,
          theme: 'grid',
          showHead: 'everyPage',
          styles: {
            font: 'helvetica',
            fontSize: 7.1,
            cellPadding: 1.8,
            textColor: [30, 41, 59],
            lineColor: [203, 213, 225],
            lineWidth: 0.2,
            valign: 'top',
            overflow: 'linebreak'
          },
          headStyles: {
            fillColor: [146, 64, 14],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7.2
          },
          alternateRowStyles: { fillColor: [255, 251, 235] },
          columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 44, fontStyle: 'bold' },
            2: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            3: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            4: { cellWidth: 14, halign: 'center' },
            5: { cellWidth: 50 },
            6: { cellWidth: contentWidth - 145 }
          }
        });
        curY = getLastTableY(doc, curY) + 4.5;
      }
    }

    // =========================================================================
    // BLOCO 3: CONTATOS, ENCAMINHAMENTOS, PADRÕES E PLANO DE AÇÃO
    // =========================================================================
    const acomp = Array.isArray(seg.ia?.acompanhamentoContatosEEncaminhamentos)
      ? seg.ia!.acompanhamentoContatosEEncaminhamentos!
      : [];
    if (acomp.length > 0) {
      desenharSubtitulo('Acompanhamento de Contatos com Responsáveis & Encaminhamentos', [30, 41, 59]);
      acomp.forEach(item => desenharParagrafo(`• ${item}`, { fontSize: 7.8 }));
    }

    const padroes = Array.isArray(seg.ia?.padroesIdentificados) ? seg.ia!.padroesIdentificados! : [];
    if (padroes.length > 0 && input.tipo === 'GERAL') {
      desenharSubtitulo('Padrões Identificados pela Análise IA', [30, 41, 59]);
      padroes.forEach(item => desenharParagrafo(`• ${item}`, { fontSize: 7.8 }));
    }

    const acoes = filtrarAcoesPorTipo(seg.ia?.acoesPraticas, input.tipo);
    if (acoes.length > 0) {
      desenharSubtitulo('Plano de Ação Prático Recomendado', [23, 37, 84]);
      const rowsAcoes = acoes.map(a => {
        if (typeof a === 'string') return ['BUSCA ATIVA', limparTextoPdf(a), 'Gestão / Busca Ativa', 'Imediato'];
        return [
          limparTextoPdf(a.foco || 'BUSCA ATIVA'),
          limparTextoPdf(a.acao || '—'),
          limparTextoPdf(a.responsavelSugerido || 'Gestão'),
          limparTextoPdf(a.prazo || 'Imediato')
        ];
      });
      autoTable(doc, {
        startY: curY,
        margin: { left: margin, right: margin },
        head: [['Foco', 'Ação Prática', 'Responsável Sugerido', 'Prazo']],
        body: rowsAcoes,
        theme: 'grid',
        showHead: 'everyPage',
        styles: {
          font: 'helvetica',
          fontSize: 7.4,
          cellPadding: 2,
          textColor: [30, 41, 59],
          lineColor: [203, 213, 225],
          lineWidth: 0.2,
          valign: 'top',
          overflow: 'linebreak'
        },
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.4
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 28, fontStyle: 'bold' },
          1: { cellWidth: contentWidth - 88 },
          2: { cellWidth: 36 },
          3: { cellWidth: 24, halign: 'center' }
        }
      });
      curY = getLastTableY(doc, curY) + 5;
    }
  });

  // Bloco de assinaturas ao final do documento
  garantirEspaco(24);
  curY += 6;
  const sigW = (contentWidth - 16) / 3;
  const sigLabels = ['Direção / Vice-Direção', 'Coordenação Pedagógica (CGPG)', 'Responsável pela Busca Ativa'];
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  sigLabels.forEach((lbl, idx) => {
    const sx = margin + idx * (sigW + 8);
    doc.line(sx, curY + 8, sx + sigW, curY + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text(lbl, sx + sigW / 2, curY + 12, { align: 'center' });
  });

  // Rodapé institucional e numeração em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `E.E. Clóvis de Lucca • ${tituloPrincipal} (${labelSegmento})`,
      margin,
      pageHeight - 6.8
    );
    doc.text(`Página ${p} de ${totalPages}`, pageWidth - margin, pageHeight - 6.8, { align: 'right' });
  }

  const slugSeg =
    input.segmento === 'ENSINO FUNDAMENTAL'
      ? 'ensino-fundamental'
      : input.segmento === 'ENSINO MÉDIO'
        ? 'ensino-medio'
        : 'geral';
  const slugTipo =
    input.tipo === 'FALTAS' ? 'so-faltas' : input.tipo === 'ATRASOS' ? 'so-atrasos' : 'completo';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `Relatorio_Busca_Ativa_${slugSeg}_${slugTipo}_${dateStamp}.pdf`;

  if (input.modo === 'print') {
    const blob = doc.output('blob');
    imprimirBlobPdfViaIframe(blob, () => doc.save(fileName));
  } else {
    doc.save(fileName);
  }

  return fileName;
}
