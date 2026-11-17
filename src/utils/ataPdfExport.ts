import { jsPDF } from 'jspdf';

export interface AtaExportData {
  tipoAta: string;
  dataBR?: string;
  dataAta?: string;
  horarioAta?: string;
  textoAta: string;
  estudantes?: Array<{ nome: string; turma?: string; ra?: string }>;
  funcionarios?: Array<{ nome: string; cargo?: string }>;
  outrosParticipantes?: string;
  autorNome?: string;
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

function formatarDataBRSeguro(dataIso?: string, dataBR?: string): string {
  if (dataBR && /\d{2}\/\d{2}\/\d{4}/.test(dataBR)) return dataBR;
  if (dataIso && /^\d{4}-\d{2}-\d{2}/.test(dataIso)) {
    const [y, m, d] = dataIso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date().toLocaleDateString('pt-BR');
}

export async function gerarLivroAtaPdf(ata: AtaExportData): Promise<string> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const contentWidth = pageWidth - marginX * 2;
  const dataExibicao = formatarDataBRSeguro(ata.dataAta, ata.dataBR);

  const logoUrl =
    (typeof localStorage !== 'undefined' && localStorage.getItem('clovis_custom_logo')) ||
    '/logo-clovis.svg';
  const logoPng = await carregarLogoPngDataUrl(logoUrl);

  const drawHeader = (isFirstPage: boolean) => {
    const topY = 12;
    if (isFirstPage && logoPng) {
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX, topY, 15, 15, 1.5, 1.5, 'FD');
      doc.addImage(logoPng, 'PNG', marginX + 1, topY + 1, 13, 13);
    }

    const textX = isFirstPage && logoPng ? marginX + 18 : marginX;
    doc.setFont('times', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GOVERNO DO ESTADO DE SÃO PAULO · SECRETARIA DA EDUCAÇÃO', textX, topY + 4);

    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('ESCOLA ESTADUAL CLÓVIS DE LUCCA · PROGRAMA ENSINO INTEGRAL (PEI)', textX, topY + 9);

    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Livro de Atas Oficial · ${ata.tipoAta} · Data: ${dataExibicao}${ata.horarioAta ? ` às ${ata.horarioAta}` : ''}`,
      textX,
      topY + 14
    );

    const lineY = isFirstPage ? topY + 18 : topY + 17;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.35);
    doc.line(marginX, lineY, pageWidth - marginX, lineY);
    return lineY + 8;
  };

  let cursorY = drawHeader(true);

  // Título da Ata para o Livro Físico
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`ATA DE ${String(ata.tipoAta || 'REUNIÃO').toUpperCase()}`, pageWidth / 2, cursorY, {
    align: 'center'
  });
  cursorY += 9;

  // Parágrafos em texto simples com recuo tradicional de livro ata
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  const lineHeight = 5.8;

  const paragrafos = String(ata.textoAta || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

  for (const p of paragrafos) {
    const linhas = doc.splitTextToSize(p, contentWidth);
    for (let i = 0; i < linhas.length; i++) {
      if (cursorY + lineHeight > pageHeight - 24) {
        doc.addPage();
        cursorY = drawHeader(false);
        doc.setFont('times', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
      }
      doc.text(linhas[i], marginX, cursorY);
      cursorY += lineHeight;
    }
    cursorY += 3.5;
  }

  // Bloco de Assinaturas para Livro Ata
  const assinantes: string[] = [];
  (ata.funcionarios || []).forEach(f => {
    if (f?.nome) assinantes.push(`${f.nome}${f.cargo ? ` (${f.cargo})` : ''}`);
  });
  (ata.estudantes || []).forEach(e => {
    if (e?.nome) assinantes.push(`${e.nome}${e.turma ? ` (${e.turma})` : ''}`);
  });
  if (ata.outrosParticipantes && ata.outrosParticipantes.trim()) {
    ata.outrosParticipantes
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(o => assinantes.push(o));
  }

  if (assinantes.length > 0) {
    cursorY += 8;
    if (cursorY + 30 > pageHeight - 20) {
      doc.addPage();
      cursorY = drawHeader(false);
    }

    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.text('ASSINATURAS DOS PRESENTES:', marginX, cursorY);
    cursorY += 10;

    doc.setFont('times', 'normal');
    doc.setFontSize(9.5);
    const colWidth = (contentWidth - 10) / 2;

    for (let i = 0; i < assinantes.length; i += 2) {
      if (cursorY + 18 > pageHeight - 18) {
        doc.addPage();
        cursorY = drawHeader(false) + 6;
      }

      const leftName = assinantes[i];
      const rightName = assinantes[i + 1];

      doc.setDrawColor(71, 85, 105);
      doc.line(marginX, cursorY, marginX + colWidth, cursorY);
      doc.text(doc.splitTextToSize(leftName, colWidth)[0] || leftName, marginX, cursorY + 4.5);

      if (rightName) {
        const rightX = marginX + colWidth + 10;
        doc.line(rightX, cursorY, rightX + colWidth, cursorY);
        doc.text(doc.splitTextToSize(rightName, colWidth)[0] || rightName, rightX, cursorY + 4.5);
      }

      cursorY += 15;
    }
  }

  // Rodapé com numeração de páginas
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('times', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `E.E. Clóvis de Lucca · Documento formatado para Livro de Atas · Página ${p} de ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  const safeTipo = String(ata.tipoAta || 'Ata')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_');
  const safeDate = dataExibicao.replace(/\//g, '-');
  const fileName = `Livro_Ata_${safeTipo}_${safeDate}.pdf`;
  doc.save(fileName);
  return fileName;
}

export function imprimirLivroAta(ata: AtaExportData): void {
  if (typeof document === 'undefined') return;
  const dataExibicao = formatarDataBRSeguro(ata.dataAta, ata.dataBR);

  const escapeHtml = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const paragrafosHtml = String(ata.textoAta || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const assinantes: string[] = [];
  (ata.funcionarios || []).forEach(f => {
    if (f?.nome) assinantes.push(`${f.nome}${f.cargo ? ` (${f.cargo})` : ''}`);
  });
  (ata.estudantes || []).forEach(e => {
    if (e?.nome) assinantes.push(`${e.nome}${e.turma ? ` (${e.turma})` : ''}`);
  });
  if (ata.outrosParticipantes && ata.outrosParticipantes.trim()) {
    ata.outrosParticipantes
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(o => assinantes.push(o));
  }

  const assinaturasHtml = assinantes.length > 0
    ? `<div class="signatures">
         <h4>Assinaturas dos Presentes</h4>
         <div class="sig-grid">
           ${assinantes
             .map(nome => `<div class="sig-item"><div class="sig-line"></div><span>${escapeHtml(nome)}</span></div>`)
             .join('')}
         </div>
       </div>`
    : '';

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Livro Ata - ${escapeHtml(ata.tipoAta)}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 20mm 20mm 22mm; }
    body {
      font-family: "Times New Roman", Times, Georgia, serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 12pt;
      line-height: 1.65;
    }
    .header {
      border-bottom: 1.5px solid #334155;
      padding-bottom: 8px;
      margin-bottom: 18px;
    }
    .header .gov { font-size: 9pt; font-weight: bold; color: #475569; letter-spacing: 0.4px; }
    .header .school { font-size: 12pt; font-weight: bold; color: #0f172a; margin-top: 2px; }
    .header .meta { font-size: 9.5pt; color: #334155; margin-top: 3px; }
    h2.title {
      text-align: center;
      font-size: 12.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 16px 0;
    }
    p {
      text-align: justify;
      text-indent: 1.25cm;
      margin: 0 0 11px 0;
    }
    .signatures {
      margin-top: 28px;
      page-break-inside: avoid;
    }
    .signatures h4 {
      font-size: 10pt;
      text-transform: uppercase;
      margin: 0 0 16px 0;
      color: #334155;
    }
    .sig-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px 28px;
    }
    .sig-item {
      text-align: center;
      font-size: 9.5pt;
    }
    .sig-line {
      border-top: 1px solid #334155;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="gov">GOVERNO DO ESTADO DE SÃO PAULO · SECRETARIA DA EDUCAÇÃO</div>
    <div class="school">ESCOLA ESTADUAL CLÓVIS DE LUCCA · PROGRAMA ENSINO INTEGRAL (PEI)</div>
    <div class="meta">Livro de Atas Oficial · ${escapeHtml(ata.tipoAta)} · Data: ${escapeHtml(dataExibicao)}${ata.horarioAta ? ` às ${escapeHtml(ata.horarioAta)}` : ''}</div>
  </div>
  <h2 class="title">ATA DE ${escapeHtml(String(ata.tipoAta || 'REUNIÃO').toUpperCase())}</h2>
  <div class="body-content">${paragrafosHtml}</div>
  ${assinaturasHtml}
</body>
</html>`);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }
  }, 200);
}
