// ============================================================================
// MÓDULO: DASHBOARD DE ATRASOS, FALTAS & COMPARATIVO DE PRESENÇA (BI ESCOLAR)
// EE Clóvis de Lucca - Gestão de Assiduidade e Pontualidade
// ============================================================================

let chartInstAtrasos = null;
let chartInstFaltas = null;
let chartInstComparativo = null;

/**
 * Normaliza e limpa string de RA para comparação consistente
 */
function normalizarRa(ra) {
  if (!ra) return "";
  return String(ra).replace(/\D/g, "").substring(0, 12);
}

/**
 * Verifica se um registro/ocorrência corresponde a um atraso escolar
 */
function isOcorrenciaAtraso(oc) {
  if (!oc) return false;
  const tipoStr = String(oc.tipo || "").toUpperCase();
  const catStr = String(oc.categoria || "").toUpperCase();
  if (oc.isDispensa === true || tipoStr.includes("DISPENSA") || catStr.includes("DISPENSA") || tipoStr.includes("AFASTAMENTO")) {
    return false;
  }
  if (oc.isAtraso === true) return true;
  const descStr = String(oc.descricao || "").toUpperCase();
  const tituloStr = String(oc.titulo || "").toUpperCase();
  return (
    tipoStr.includes("ATRASO") ||
    catStr.includes("ATRASO") ||
    descStr.includes("ATRASO") ||
    descStr.startsWith("ATRASO") ||
    tituloStr.includes("ATRASO")
  );
}

/**
 * Extrai percentual numérico de presença (0 a 100)
 */
function extrairPresencaPercentual(aluno) {
  if (!aluno) return 100;
  const rawPresenca = aluno.presenca_anual ?? aluno.presenca ?? aluno.frequencia ?? aluno.presenca_26_06 ?? aluno.presenca_15_06;
  if (rawPresenca !== undefined && rawPresenca !== null && rawPresenca !== "") {
    const limpo = String(rawPresenca).replace("%", "").replace(",", ".").trim();
    const num = parseFloat(limpo);
    if (!isNaN(num)) {
      return Math.min(100, Math.max(0, num));
    }
  }
  
  // Se não houver presença direta, estima a partir das faltas acumuladas (ano com ~200 dias / ~1000 horas)
  const faltas = extrairFaltasTotal(aluno);
  if (faltas > 0) {
    const presencaEstimada = Math.max(0, 100 - (faltas / 200) * 100);
    return Math.round(presencaEstimada * 10) / 10;
  }

  return 100;
}

function temDadosReaisNoMapao(b) {
  if (!b || typeof b !== "object") return false;
  const situacao = String(b.situacao || "").toUpperCase().trim();
  if (situacao.includes("TRANSF") || situacao.includes("REMANEJ") || situacao.includes("CESSAD") || situacao.includes("CANCEL")) {
    return false;
  }
  const hasMedia = b.mediaGeral !== null && b.mediaGeral !== undefined && b.mediaGeral !== "" && b.mediaGeral !== "—" && !isNaN(Number(b.mediaGeral));
  let hasDiscs = false;
  if (b.disciplinas && typeof b.disciplinas === "object") {
    hasDiscs = Object.values(b.disciplinas).some(d => {
      if (!d) return false;
      const n = d.notaNum ?? d.nota ?? d.valor;
      if (n !== null && n !== undefined && !isNaN(Number(n))) return true;
      if (d.mencaoNota && d.mencaoNota !== "—" && d.mencaoNota !== "" && d.mencaoNota !== "N/A") return true;
      if (d.faltas && Number(d.faltas) > 0) return true;
      return false;
    });
  }
  return hasMedia || hasDiscs;
}

/**
 * Extrai total de faltas do aluno
 * Suporta dados do SED (frequencia_atual, presenca_anual), Mapão (fechamento_notas)
 * e histórico acumulado
 */
function extrairFaltasTotal(aluno) {
  if (!aluno) return 0;

  // 1. Verificar propriedades diretas comuns
  const rawFaltas = aluno.total_faltas ?? aluno.faltas ?? aluno.faltasTotalAno ?? aluno.faltas_ano ?? aluno.totalFaltas;
  if (rawFaltas !== undefined && rawFaltas !== null && rawFaltas !== "") {
    const num = parseInt(String(rawFaltas).replace(/\D/g, ""), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2. Verificar objeto frequencia_atual (importado do SED)
  if (aluno.frequencia_atual && typeof aluno.frequencia_atual === "object") {
    const fSed = aluno.frequencia_atual.total_faltas ?? aluno.frequencia_atual.faltas ?? aluno.frequencia_atual.faltas_total;
    if (fSed !== undefined && fSed !== null && fSed !== "") {
      const numSed = parseInt(String(fSed).replace(/\D/g, ""), 10);
      if (!isNaN(numSed) && numSed > 0) return numSed;
    }
  }

  // 3. Verificar fechamento_notas (Mapão de notas e faltas do Boletim)
  const fn = aluno.fechamento_notas || aluno.fechamentos || aluno.notas || aluno.boletim;
  if (fn && typeof fn === "object") {
    const bFinal = fn["FINAL"] || fn["final"];
    const b1 = fn["1B"] || fn["1BIM"] || fn["1ºB"];
    const b2 = fn["2B"] || fn["2BIM"] || fn["2ºB"];
    const b3 = fn["3B"] || fn["3BIM"] || fn["3ºB"];
    const b4 = fn["4B"] || fn["4BIM"] || fn["4ºB"];

    const fFinal = (bFinal && temDadosReaisNoMapao(bFinal)) ? parseInt(String(bFinal.totalFaltas ?? bFinal.faltasTotalAno ?? bFinal.faltas ?? "").replace(/\D/g, ""), 10) : 0;
    if (!isNaN(fFinal) && fFinal > 0) return fFinal;

    const somaBim = [b1, b2, b3, b4].reduce((acc, b) => {
      if (!b || !temDadosReaisNoMapao(b)) return acc;
      const fb = parseInt(String(b.totalFaltas ?? b.faltas ?? "").replace(/\D/g, ""), 10);
      return acc + (!isNaN(fb) ? fb : 0);
    }, 0);
    if (somaBim > 0) return somaBim;
  }

  // 4. Se não há total de faltas registrado mas temos percentual de presença (< 100%),
  // deduzir o índice de faltas aproximado com base no calendário anual letivo (200 dias / ~1000 horas)
  const presenca = extrairPresencaPercentual(aluno);
  if (presenca < 100 && presenca >= 0) {
    // Para cada 1% de ausência em ~200 dias de aula = 2 dias ou ~9-10 horas de falta
    const faltasCalculadas = Math.round(((100 - presenca) / 100) * 200);
    if (faltasCalculadas > 0) return faltasCalculadas;
  }

  return 0;
}

/**
 * Função principal para atualizar todos os dados, métricas, gráficos e tabela do Dashboard de Atrasos
 */
export function atualizarDashboardAtrasos() {
  try {
    const listaAlunos = Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0 
      ? window.allStudentsData 
      : [];

    // Consolida ocorrências de todas as fontes disponíveis (ocorrenciasCache, ocorrenciasTopLevel e embutidas nos alunos)
    let listaOcorrencias = [];
    if (Array.isArray(window.ocorrenciasCache) && window.ocorrenciasCache.length > 0) {
      listaOcorrencias = window.ocorrenciasCache;
    } else {
      const seenSig = new Set();
      const pushUnique = (oc, fallbackRa, fallbackNome) => {
        if (!oc) return;
        const ra = normalizarRa(oc.alunoRa || oc.ra || oc.raLimpo || fallbackRa || "");
        const dt = String(oc.data || oc.dataHora || oc.criadoEm || "").substring(0, 16);
        const desc = String(oc.descricao || oc.observacao || "").trim().toLowerCase();
        const sig = `${oc.id || ""}|${ra}|${dt}|${desc}`;
        if (seenSig.has(sig)) return;
        seenSig.add(sig);
        listaOcorrencias.push({
          ...oc,
          ra: oc.ra || fallbackRa || "",
          nomeAluno: oc.nomeAluno || oc.alunoNome || fallbackNome || ""
        });
      };

      if (Array.isArray(window.ocorrenciasTopLevel)) {
        window.ocorrenciasTopLevel.forEach(oc => pushUnique(oc, "", ""));
      }
      listaAlunos.forEach(al => {
        const arr = Array.isArray(al.ocorrencias) ? al.ocorrencias : (Array.isArray(al.registros) ? al.registros : []);
        arr.forEach(oc => pushUnique(oc, al.ra, al.nome));
      });
    }

    // Mapear turmas únicas para popular o filtro de turma se necessário
    const selectTurma = document.getElementById("dash-atrasos-filter-turma");
    const turmaSelecionada = (selectTurma?.value || "").toUpperCase().trim();

    if (selectTurma) {
      const turmasSet = new Set();
      listaAlunos.forEach(al => {
        const t = (al.turma || "").trim().toUpperCase();
        if (t) turmasSet.add(t);
      });
      const turmasOrdenadas = Array.from(turmasSet).sort();

      const valorAtual = selectTurma.value;
      let optionsHTML = '<option value="">Todas as Turmas</option>';
      turmasOrdenadas.forEach(t => {
        optionsHTML += `<option value="${t}" ${t === valorAtual ? 'selected' : ''}>Turma ${t}</option>`;
      });
      if (selectTurma.options.length <= 1 || selectTurma.options.length !== turmasOrdenadas.length + 1) {
        selectTurma.innerHTML = optionsHTML;
      }
    }

    // Mapa de atrasos por aluno: raLimpo -> array de ocorrências de atraso
    const atrasosPorAluno = new Map();
    const atrasosPorNome = new Map();

    const agora = new Date();
    const mesAtual = agora.getMonth();
    const anoAtual = agora.getFullYear();

    listaOcorrencias.forEach(oc => {
      if (!isOcorrenciaAtraso(oc)) return;

      const raOc = normalizarRa(oc.alunoRa || oc.ra || oc.raLimpo || "");
      if (raOc) {
        if (!atrasosPorAluno.has(raOc)) atrasosPorAluno.set(raOc, []);
        atrasosPorAluno.get(raOc).push(oc);
      }

      const nomeOc = String(oc.nomeAluno || oc.alunoNome || oc.aluno || "").trim().toUpperCase();
      if (nomeOc) {
        if (!atrasosPorNome.has(nomeOc)) atrasosPorNome.set(nomeOc, []);
        atrasosPorNome.get(nomeOc).push(oc);
      }
    });

    // Filtro de pesquisa rápida
    const searchInput = document.getElementById("dash-atrasos-search-input");
    const termoBusca = (searchInput?.value || "").trim().toLowerCase();

    // Filtro de ordenação
    const selectSort = document.getElementById("dash-atrasos-filter-sort");
    const tipoOrdenacao = selectSort?.value || "mais_atrasos";

    // Filtro de limite
    const selectLimit = document.getElementById("dash-atrasos-filter-limit");
    const limiteExibicao = parseInt(selectLimit?.value || "15", 10);

    // Processar cada aluno ativo
    let dadosEstudantes = [];
    let somaTotalAtrasos = 0;
    let somaTotalFaltas = 0;
    let somaPresenca = 0;
    let countPresenca = 0;
    let countAlunosComAtraso = 0;
    let countAlunosCriticos = 0;

    listaAlunos.forEach(aluno => {
      const status = String(aluno.status || aluno.situacao || "ATIVO").trim().toUpperCase();
      if (status !== "ATIVO") return;

      const turmaAluno = String(aluno.turma || "").trim().toUpperCase();
      if (turmaSelecionada && turmaAluno !== turmaSelecionada) return;

      const raAluno = String(aluno.ra || "").trim();
      const raLimpo = normalizarRa(raAluno);
      const nomeAluno = String(aluno.nome || "Estudante").trim().toUpperCase();

      // Filtro de busca textual
      if (termoBusca) {
        const matchesNome = nomeAluno.toLowerCase().includes(termoBusca);
        const matchesRa = raAluno.toLowerCase().includes(termoBusca) || raLimpo.includes(termoBusca);
        if (!matchesNome && !matchesRa) return;
      }

      // Cruzar atrasos das ocorrências gerais + atrasos na ficha do aluno
      const atrasosLista = atrasosPorAluno.get(raLimpo) || atrasosPorNome.get(nomeAluno) || [];
      let totalAtrasos = atrasosLista.length;

      // Se o aluno tiver campo explícito de atrasos cadastrado maior
      const atrasosCampo = parseInt(String(aluno.atrasos || aluno.total_atrasos || 0).replace(/\D/g, ""), 10);
      if (!isNaN(atrasosCampo) && atrasosCampo > totalAtrasos) {
        totalAtrasos = atrasosCampo;
      }

      // Contar atrasos no mês atual para o gatilho automático (a cada 3 atrasos no mês)
      let atrasosNoMes = 0;
      atrasosLista.forEach(oc => {
        const rawDt = oc.data || oc.dataHora || oc.criadoEm || "";
        if (rawDt) {
          const d = new Date(rawDt);
          if (!isNaN(d.getTime()) && d.getMonth() === mesAtual && d.getFullYear() === anoAtual) {
            atrasosNoMes++;
          }
        }
      });
      if (atrasosNoMes === 0 && totalAtrasos >= 3) {
        atrasosNoMes = totalAtrasos;
      }

      // Total de faltas
      const totalFaltas = extrairFaltasTotal(aluno);

      // Porcentagem de presença
      const presencaPct = extrairPresencaPercentual(aluno);

      // Data do último atraso registrado
      let ultimoAtrasoStr = "-";
      if (atrasosLista.length > 0) {
        const ordenados = [...atrasosLista].sort((a, b) => new Date(b.data || b.criadoEm || 0) - new Date(a.data || a.criadoEm || 0));
        const ult = ordenados[0];
        const dataReg = ult.data || ult.dataHora || ult.criadoEm || "";
        const horaReg = ult.hora || ult.horaRealAtraso || "";
        if (dataReg) {
          const dtFmt = dataReg.includes("T") ? new Date(dataReg).toLocaleDateString("pt-BR") : dataReg;
          ultimoAtrasoStr = `${dtFmt} ${horaReg}`.trim();
        }
      }

      // Acumular métricas para KPIs
      somaTotalAtrasos += totalAtrasos;
      somaTotalFaltas += totalFaltas;
      somaPresenca += presencaPct;
      countPresenca++;

      if (totalAtrasos > 0) {
        countAlunosComAtraso++;
      }

      const ehCritico = presencaPct < 75 || totalAtrasos >= 3;
      if (ehCritico) {
        countAlunosCriticos++;
      }

      dadosEstudantes.push({
        alunoObj: aluno,
        ra: raAluno,
        raLimpo: raLimpo,
        nome: nomeAluno,
        turma: turmaAluno || "-",
        tutor: String(aluno.tutor || aluno.tutor_2026 || "Sem Tutor").trim(),
        totalAtrasos: totalAtrasos,
        atrasosNoMes: atrasosNoMes,
        gatilhoTermoAtivo: atrasosNoMes >= 3 || totalAtrasos >= 3,
        totalFaltas: totalFaltas,
        presenca: presencaPct,
        ultimoAtraso: ultimoAtrasoStr,
        ehCritico: ehCritico
      });
    });

    // Atualizar Cards de Estatísticas no DOM
    const elTotalAtrasos = document.getElementById("dash-atrasos-total-atrasos");
    if (elTotalAtrasos) elTotalAtrasos.textContent = somaTotalAtrasos;

    const elAlunosComAtraso = document.getElementById("dash-atrasos-alunos-com-atraso");
    if (elAlunosComAtraso) elAlunosComAtraso.textContent = countAlunosComAtraso;

    const elTotalFaltas = document.getElementById("dash-atrasos-total-faltas");
    if (elTotalFaltas) elTotalFaltas.textContent = somaTotalFaltas;

    const elMediaFaltas = document.getElementById("dash-atrasos-media-faltas");
    if (elMediaFaltas) {
      const media = countPresenca > 0 ? (somaTotalFaltas / countPresenca).toFixed(1) : "0.0";
      elMediaFaltas.textContent = media;
    }

    const elPresencaMedia = document.getElementById("dash-atrasos-presenca-media");
    if (elPresencaMedia) {
      const mediaP = countPresenca > 0 ? (somaPresenca / countPresenca).toFixed(1) + "%" : "0.0%";
      elPresencaMedia.textContent = mediaP;
    }

    const elAlunosCriticos = document.getElementById("dash-atrasos-alunos-criticos");
    if (elAlunosCriticos) elAlunosCriticos.textContent = countAlunosCriticos;

    const badgeFiltro = document.getElementById("dash-atrasos-filter-badge");
    if (badgeFiltro) {
      if (turmaSelecionada) {
        badgeFiltro.textContent = `Turma ${turmaSelecionada}`;
        badgeFiltro.classList.remove("hidden");
      } else {
        badgeFiltro.classList.add("hidden");
      }
    }

    // Ordenação dos estudantes
    dadosEstudantes.sort((a, b) => {
      if (tipoOrdenacao === "mais_atrasos") {
        if (b.totalAtrasos !== a.totalAtrasos) return b.totalAtrasos - a.totalAtrasos;
        if (b.totalFaltas !== a.totalFaltas) return b.totalFaltas - a.totalFaltas;
        return a.presenca - b.presenca;
      }
      if (tipoOrdenacao === "mais_faltas") {
        if (b.totalFaltas !== a.totalFaltas) return b.totalFaltas - a.totalFaltas;
        if (b.totalAtrasos !== a.totalAtrasos) return b.totalAtrasos - a.totalAtrasos;
        return a.presenca - b.presenca;
      }
      if (tipoOrdenacao === "menor_presenca") {
        if (a.presenca !== b.presenca) return a.presenca - b.presenca;
        return b.totalAtrasos - a.totalAtrasos;
      }
      if (tipoOrdenacao === "nome_az") {
        return a.nome.localeCompare(b.nome);
      }
      return b.totalAtrasos - a.totalAtrasos;
    });

    // Guardar para exportação CSV
    window.__dadosDashboardAtrasos = dadosEstudantes;

    // Atualizar contador da tabela
    const elContadorTabela = document.getElementById("dash-atrasos-tabela-contador");
    if (elContadorTabela) {
      elContadorTabela.textContent = `${dadosEstudantes.length} Estudantes Filtrados`;
    }

    // Limitar para exibição na tabela conforme filtro
    const estudantesExibidos = dadosEstudantes.slice(0, limiteExibicao);

    // Renderizar Tabela
    renderizarTabelaAtrasos(estudantesExibidos);

    // Renderizar Gráficos com Chart.js se disponível
    if (typeof Chart !== "undefined") {
      renderizarGraficoAtrasos(dadosEstudantes);
      renderizarGraficoFaltas(dadosEstudantes);
      renderizarGraficoComparativo(dadosEstudantes);
    }
  } catch (err) {
    console.error("[DashboardAtrasos] Erro ao atualizar dashboard de atrasos:", err);
  }
}

/**
 * Renderiza as linhas da tabela de estudantes
 */
function renderizarTabelaAtrasos(estudantes) {
  const tbody = document.getElementById("dash-atrasos-tabela-corpo");
  if (!tbody) return;

  if (estudantes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-slate-400 font-medium">
          <i class="fa-solid fa-circle-info text-amber-500 mr-1.5"></i>
          Nenhum registro de aluno encontrado com os filtros selecionados.
        </td>
      </tr>
    `;
    return;
  }

  let html = "";
  estudantes.forEach((est, index) => {
    // Definir cor e situação de presença
    let corTextoPresenca = "text-emerald-700";
    let corBarraPresenca = "bg-emerald-500";
    let badgeSituacao = "";

    if (est.presenca < 75 || est.totalAtrasos >= 5) {
      corTextoPresenca = "text-rose-700";
      corBarraPresenca = "bg-rose-600";
      badgeSituacao = `
        <span class="px-2 py-0.5 bg-rose-100 text-rose-800 font-black text-[10px] rounded-full border border-rose-300 uppercase flex items-center justify-center gap-1">
          <i class="fa-solid fa-triangle-exclamation text-[9px]"></i> Crítico
        </span>
      `;
    } else if (est.presenca < 85 || est.totalAtrasos >= 3) {
      corTextoPresenca = "text-amber-700";
      corBarraPresenca = "bg-amber-500";
      badgeSituacao = `
        <span class="px-2 py-0.5 bg-amber-100 text-amber-800 font-black text-[10px] rounded-full border border-amber-300 uppercase flex items-center justify-center gap-1">
          <i class="fa-solid fa-circle-exclamation text-[9px]"></i> Atenção (Gatilho 3+)
        </span>
      `;
    } else {
      badgeSituacao = `
        <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-black text-[10px] rounded-full border border-emerald-300 uppercase flex items-center justify-center gap-1">
          <i class="fa-solid fa-circle-check text-[9px]"></i> Regular
        </span>
      `;
    }

    const badgeAtrasos = est.totalAtrasos > 0
      ? `<div class="flex flex-col items-center gap-0.5">
           <span class="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 font-black rounded-full text-xs inline-flex items-center gap-1"><i class="fa-solid fa-clock text-[9px]"></i> ${est.totalAtrasos}</span>
           ${est.gatilhoTermoAtivo ? `<span class="text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 rounded uppercase" title="Gatilho Automático: Termo de Ciência + Pauta na Tutoria">⚡ Termo + Tutoria</span>` : ''}
         </div>`
      : `<span class="text-slate-400 font-medium">0</span>`;

    const badgeFaltas = est.totalFaltas > 0
      ? `<span class="px-2 py-0.5 bg-rose-100 text-rose-900 border border-rose-300 font-black rounded-full text-xs inline-flex items-center gap-1"><i class="fa-solid fa-user-xmark text-[9px]"></i> ${est.totalFaltas}</span>`
      : `<span class="text-slate-400 font-medium">0</span>`;

    const btnGatilhoTermo = est.gatilhoTermoAtivo
      ? `<button 
          type="button" 
          onclick="if(window.emitirTermoCienciaFrequenciaGatilho) window.emitirTermoCienciaFrequenciaGatilho('${est.ra}', ${est.atrasosNoMes || est.totalAtrasos})" 
          class="px-2 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[10px] rounded-lg inline-flex items-center justify-center gap-1 shadow-2xs transition cursor-pointer"
          title="Emitir Termo de Ciência de Frequência e Pauta Obrigatória de Tutoria (${est.tutor})"
        >
          <i class="fa-solid fa-file-signature text-[10px]"></i>
          <span>Termo &amp; Tutoria</span>
        </button>`
      : "";

    html += `
      <tr class="hover:bg-amber-50/40 transition-colors">
        <td class="py-2.5 px-3 text-center font-bold text-slate-400 text-xs">${index + 1}</td>
        <td class="py-2.5 px-3">
          <button 
            type="button" 
            onclick="window.abrirFichaAluno('${est.ra}')" 
            class="text-left font-bold text-blue-900 hover:text-cyan-700 hover:underline cursor-pointer flex items-center gap-1.5 transition-colors group"
            title="Abrir Dossiê Completo de ${est.nome}"
          >
            <span class="group-hover:translate-x-0.5 transition-transform">${est.nome}</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[10px] opacity-60 group-hover:opacity-100 text-cyan-700"></i>
          </button>
          <div class="text-[10px] text-slate-400 font-mono">RA: ${est.ra || '-'} &bull; Tutor: <strong class="text-slate-600">${est.tutor}</strong></div>
        </td>
        <td class="py-2.5 px-3 text-center">
          <span class="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold text-xs rounded border border-slate-200">${est.turma}</span>
        </td>
        <td class="py-2.5 px-3 text-center">${badgeAtrasos}</td>
        <td class="py-2.5 px-3 text-center">${badgeFaltas}</td>
        <td class="py-2.5 px-3">
          <div class="w-full max-w-[150px]">
            <div class="flex items-center justify-between text-[11px] font-black mb-1">
              <span class="${corTextoPresenca}">${est.presenca.toFixed(1)}%</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div class="${corBarraPresenca} h-2 rounded-full transition-all" style="width: ${Math.min(100, Math.max(0, est.presenca))}%"></div>
            </div>
          </div>
        </td>
        <td class="py-2.5 px-3 text-center">${badgeSituacao}</td>
        <td class="py-2.5 px-3 text-center text-[11px] text-slate-600 font-medium">${est.ultimoAtraso}</td>
        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center gap-1.5 flex-wrap">
            ${btnGatilhoTermo}
            <button 
              type="button" 
              onclick="window.abrirFichaAluno('${est.ra}')" 
              class="px-2.5 py-1.5 bg-blue-900 hover:bg-blue-800 text-cyan-300 hover:text-white font-bold text-xs rounded-lg inline-flex items-center justify-center gap-1 shadow-2xs transition cursor-pointer"
              title="Abrir Dossiê Completo deste aluno"
            >
              <i class="fa-solid fa-folder-open text-xs"></i>
              <span>Dossiê</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Gráfico 1: Ranking dos Alunos que Mais Atrasam
 */
function renderizarGraficoAtrasos(todosEstudantes) {
  const canvas = document.getElementById("chart-atrasos-alunos");
  if (!canvas) return;

  if (chartInstAtrasos) {
    chartInstAtrasos.destroy();
    chartInstAtrasos = null;
  }

  // Filtrar alunos com atrasos ou pegar os top 12
  const alunosOrdenados = [...todosEstudantes]
    .sort((a, b) => b.totalAtrasos - a.totalAtrasos || b.totalFaltas - a.totalFaltas)
    .slice(0, 12);

  // Se nenhum aluno tiver atraso ainda, pegar os primeiros para visualização com placeholder
  const topAlunos = alunosOrdenados.filter(a => a.totalAtrasos > 0).length > 0 
    ? alunosOrdenados.filter(a => a.totalAtrasos > 0)
    : alunosOrdenados.slice(0, 8);

  const labels = topAlunos.map(a => formatarNomeResumido(a.nome));
  const data = topAlunos.map(a => a.totalAtrasos);

  chartInstAtrasos = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Quantidade de Atrasos",
          data: data,
          backgroundColor: "rgba(245, 158, 11, 0.85)", // Amber 500
          borderColor: "rgba(217, 119, 6, 1)",        // Amber 600
          borderWidth: 1.5,
          borderRadius: 6,
          hoverBackgroundColor: "rgba(217, 119, 6, 1)"
        }
      ]
    },
    options: {
      indexAxis: "y", // Barra horizontal
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) {
              const idx = items[0].dataIndex;
              const al = topAlunos[idx];
              return al ? `${al.nome} (Turma ${al.turma})` : "";
            },
            label: function (item) {
              return ` Total de Atrasos: ${item.parsed.x} | Clique para abrir Dossiê`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 11 } }
        },
        y: {
          ticks: {
            font: { size: 11, weight: "bold" },
            callback: function (val, index) {
              const text = this.getLabelForValue(index);
              return text.length > 20 ? text.substring(0, 18) + "..." : text;
            }
          }
        }
      },
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const index = elements[0].index;
          const target = topAlunos[index];
          if (target && target.ra && typeof window.abrirFichaAluno === "function") {
            window.abrirFichaAluno(target.ra);
          }
        }
      }
    }
  });
}

/**
 * Gráfico 2: Alunos com Mais Faltas
 */
function renderizarGraficoFaltas(todosEstudantes) {
  const canvas = document.getElementById("chart-faltas-alunos");
  if (!canvas) return;

  if (chartInstFaltas) {
    chartInstFaltas.destroy();
    chartInstFaltas = null;
  }

  // Filtrar alunos com mais faltas (top 12 com faltas > 0)
  let topFaltasAlunos = [...todosEstudantes]
    .filter(a => (a.totalFaltas > 0) || (a.presenca < 100))
    .sort((a, b) => b.totalFaltas - a.totalFaltas || a.presenca - b.presenca || b.totalAtrasos - a.totalAtrasos)
    .slice(0, 12);

  // Se nenhum aluno possuir faltas registradas ainda, listar os alunos com menor frequência percentual
  if (topFaltasAlunos.length === 0 && todosEstudantes.length > 0) {
    topFaltasAlunos = [...todosEstudantes]
      .sort((a, b) => a.presenca - b.presenca || b.totalAtrasos - a.totalAtrasos)
      .slice(0, 12);
  }

  const labels = topFaltasAlunos.map(a => formatarNomeResumido(a.nome));
  const data = topFaltasAlunos.map(a => a.totalFaltas);

  chartInstFaltas = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Total de Faltas",
          data: data,
          backgroundColor: "rgba(225, 29, 72, 0.85)", // Rose 600
          borderColor: "rgba(190, 18, 60, 1)",        // Rose 700
          borderWidth: 1.5,
          borderRadius: 6,
          hoverBackgroundColor: "rgba(190, 18, 60, 1)"
        }
      ]
    },
    options: {
      indexAxis: "y", // Barra horizontal
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function (items) {
              const idx = items[0].dataIndex;
              const al = topFaltasAlunos[idx];
              return al ? `${al.nome} (Turma ${al.turma})` : "";
            },
            label: function (item) {
              const al = topFaltasAlunos[item.dataIndex];
              const p = al ? al.presenca.toFixed(1) : "0";
              return ` Faltas: ${item.parsed.x} (Presença: ${p}%) | Clique para Dossiê`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 11 } }
        },
        y: {
          ticks: {
            font: { size: 11, weight: "bold" },
            callback: function (val, index) {
              const text = this.getLabelForValue(index);
              return text.length > 20 ? text.substring(0, 18) + "..." : text;
            }
          }
        }
      },
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const index = elements[0].index;
          const target = topFaltasAlunos[index];
          if (target && target.ra && typeof window.abrirFichaAluno === "function") {
            window.abrirFichaAluno(target.ra);
          }
        }
      }
    }
  });
}

/**
 * Gráfico 3: Comparativo de Presença e Correlação com Atrasos
 */
function renderizarGraficoComparativo(todosEstudantes) {
  const canvas = document.getElementById("chart-comparativo-presenca");
  if (!canvas) return;

  if (chartInstComparativo) {
    chartInstComparativo.destroy();
    chartInstComparativo = null;
  }

  // Agrupar estudantes em 3 faixas de frequência
  let faixaRegular = { totalAlunos: 0, totalAtrasos: 0, totalFaltas: 0 };
  let faixaAtencao = { totalAlunos: 0, totalAtrasos: 0, totalFaltas: 0 };
  let faixaRisco = { totalAlunos: 0, totalAtrasos: 0, totalFaltas: 0 };

  todosEstudantes.forEach(est => {
    if (est.presenca >= 85) {
      faixaRegular.totalAlunos++;
      faixaRegular.totalAtrasos += est.totalAtrasos;
      faixaRegular.totalFaltas += est.totalFaltas;
    } else if (est.presenca >= 75) {
      faixaAtencao.totalAlunos++;
      faixaAtencao.totalAtrasos += est.totalAtrasos;
      faixaAtencao.totalFaltas += est.totalFaltas;
    } else {
      faixaRisco.totalAlunos++;
      faixaRisco.totalAtrasos += est.totalAtrasos;
      faixaRisco.totalFaltas += est.totalFaltas;
    }
  });

  const labels = [
    "Presença Regular (>= 85%)",
    "Presença em Atenção (75% a 84.9%)",
    "Presença em Risco Crítico (< 75%)"
  ];

  const dataAlunos = [faixaRegular.totalAlunos, faixaAtencao.totalAlunos, faixaRisco.totalAlunos];
  const dataAtrasos = [faixaRegular.totalAtrasos, faixaAtencao.totalAtrasos, faixaRisco.totalAtrasos];

  chartInstComparativo = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Número de Estudantes",
          data: dataAlunos,
          backgroundColor: ["rgba(16, 185, 129, 0.85)", "rgba(245, 158, 11, 0.85)", "rgba(220, 38, 38, 0.85)"],
          borderColor: ["#059669", "#D97706", "#B91C1C"],
          borderWidth: 1.5,
          borderRadius: 6
        },
        {
          label: "Volume Total de Atrasos Acumulados",
          data: dataAtrasos,
          backgroundColor: "rgba(30, 58, 138, 0.75)", // Blue 900
          borderColor: "#1E3A8A",
          borderWidth: 1.5,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { font: { weight: "bold", size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              return ` ${ctx.dataset.label}: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

/**
 * Formata nome longo para exibição concisa nos eixos do gráfico (Primeiro e Último Sobrenome)
 */
function formatarNomeResumido(nome) {
  if (!nome) return "Aluno";
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 2) return partes.join(" ");
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Exporta os dados do Dashboard de Atrasos em arquivo CSV compatível com Excel e Google Sheets
 */
export function exportarAtrasosCSV() {
  try {
    const dados = window.__dadosDashboardAtrasos;
    if (!dados || dados.length === 0) {
      if (typeof window.showNotification === "function") {
        window.showNotification("Nenhum dado disponível para exportar no momento.", "warning");
      }
      return;
    }

    const colunas = [
      "Posicao",
      "Nome",
      "RA",
      "Turma",
      "Total_Atrasos",
      "Total_Faltas",
      "Presenca_Percentual",
      "Situacao",
      "Ultimo_Atraso_Registrado"
    ];

    let csvContent = "\uFEFF" + colunas.join(";") + "\n";

    dados.forEach((d, idx) => {
      let situacao = "Regular";
      if (d.presenca < 75 || d.totalAtrasos >= 5) situacao = "Crítico";
      else if (d.presenca < 85 || d.totalAtrasos >= 3) situacao = "Atenção";

      const linha = [
        idx + 1,
        `"${d.nome.replace(/"/g, '""')}"`,
        `"${d.ra}"`,
        `"${d.turma}"`,
        d.totalAtrasos,
        d.totalFaltas,
        `"${d.presenca.toFixed(1)}%"`,
        `"${situacao}"`,
        `"${d.ultimoAtraso}"`
      ];
      csvContent += linha.join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dataHoje = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_atrasos_faltas_clovis_${dataHoje}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (typeof window.showNotification === "function") {
      window.showNotification("Relatório de atrasos exportado com sucesso!", "success");
    }
  } catch (e) {
    console.error("[DashboardAtrasos] Erro ao exportar CSV:", e);
  }
}

// Disponibilizar no escopo global do navegador e sincronizar automaticamente
if (typeof window !== "undefined") {
  window.atualizarDashboardAtrasos = atualizarDashboardAtrasos;
  window.exportarAtrasosCSV = exportarAtrasosCSV;

  const isDashboardUnificadoAtivo = () =>
    ["dashboard", "dashboard-atrasos", "dashboard-notas", "dash-projetos-pei"].includes(window.currentActiveTab);

  window.addEventListener("studentsdataupdated", () => {
    if (isDashboardUnificadoAtivo()) {
      atualizarDashboardAtrasos();
    }
  });

  window.addEventListener("database-collection-changed", () => {
    if (isDashboardUnificadoAtivo()) {
      atualizarDashboardAtrasos();
    }
  });
}
