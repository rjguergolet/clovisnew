/**
 * Módulo de Digitação e Ajuste Manual de Boletins e Frequências Bimestrais
 * E.E. Professor Clóvis de Lucca
 * 
 * Permite que TODOS os perfis (Professores, Coordenadores, Direção, Vice-Direção, Secretaria)
 * digitem ou ajustem as notas e a frequência bimestral de qualquer estudante,
 * especialmente alunos transferidos cujos dados não constam no Mapão oficial da escola.
 */

import { doc, updateDoc, setDoc, db } from '../lib/database';
import { limparNomeDisciplina } from './boletimPdfParser';

declare global {
  interface Window {
    abrirModalDigitarBoletim?: (ra?: string, bimestreInicial?: string) => void;
    showToast?: (msg: string, type?: string, duration?: number) => void;
    showErrorToast?: (msg: string, err?: any) => void;
    registrarLogAuditoria?: (dados: any) => void;
    atualizarVisualizacaoBoletimModal?: () => void;
    calcularMediaNotasEstudante?: (aluno: any) => any;
    applyStudentFilters?: () => void;
    atualizarDashboardGraficos?: () => void;
    currentAlunoModalData?: any;
    currentBimestreBoletim?: string;
  }
}

export type BimestreKey = '1B' | '2B' | '3B' | '4B' | 'FINAL';

const DISCIPLINAS_PADRAO_FUNDAMENTAL = [
  'Língua Portuguesa',
  'Arte',
  'Educação Física',
  'Língua Inglesa',
  'Matemática',
  'Ciências',
  'História',
  'Geografia',
  'Projeto de Vida',
  'Tecnologia e Inovação'
];

const DISCIPLINAS_PADRAO_MEDIO = [
  'Língua Portuguesa',
  'Arte',
  'Educação Física',
  'Língua Inglesa',
  'Matemática',
  'Física',
  'Química',
  'Biologia',
  'História',
  'Geografia',
  'Filosofia',
  'Sociologia',
  'Projeto de Vida',
  'Tecnologia e Inovação',
  'Eletiva'
];

function obterDisciplinasSugeridas(turma: string, segmento: string): string[] {
  const t = String(turma || '').toUpperCase();
  const s = String(segmento || '').toUpperCase();
  const isMedio = s.includes('MÉDIO') || s.includes('MEDIO') || t.includes('1') || t.includes('2') || t.includes('3') || t.includes('EM');
  return isMedio ? DISCIPLINAS_PADRAO_MEDIO : DISCIPLINAS_PADRAO_FUNDAMENTAL;
}

function obterOuCriarModalDOM(): HTMLElement {
  let modalContainer = document.getElementById('modal-digitar-boletim-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'modal-digitar-boletim-container';
    modalContainer.className = 'fixed inset-0 z-[10000] hidden items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs transition-opacity';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

/**
 * Abre o modal para digitação de boletim e frequência de qualquer aluno por qualquer perfil
 */
export function abrirModalDigitarBoletim(raTarget?: string, bimestreInicial: string = '1B'): void {
  const allStudents = (window as any).allStudentsData || [];
  
  // Se não passou RA, tenta pegar do modal de dossiê aberto
  let cleanRa = String(raTarget || '').trim();
  if (!cleanRa) {
    const hiddenRa = (document.getElementById('modal-aluno-ra-hidden') as HTMLInputElement)?.value;
    cleanRa = String(hiddenRa || '').trim();
  }

  const cleanDigits = cleanRa.replace(/\D/g, '').substring(0, 12);
  const aluno = allStudents.find((s: any) => 
    String(s.ra || '').trim() === cleanRa ||
    (cleanDigits && String(s.ra || '').replace(/\D/g, '').substring(0, 12) === cleanDigits)
  );

  if (!aluno) {
    if (typeof window.showToast === 'function') {
      window.showToast('Selecione um estudante válido para digitar o boletim.', 'warning');
    }
    return;
  }

  const modalEl = obterOuCriarModalDOM();
  let bimAtivo: BimestreKey = (['1B', '2B', '3B', '4B', 'FINAL'].includes(bimestreInicial) ? bimestreInicial : '1B') as BimestreKey;

  const userRole = (typeof (window as any).obterRoleAtual === 'function'
    ? (window as any).obterRoleAtual()
    : (window as any).currentUserRole) || 'USUÁRIO';

  // Renderiza a casca do modal
  const renderizarConteudoModal = () => {
    const fn = aluno.fechamento_notas || (aluno as any).fechamentos || (aluno as any).notas || {};
    const dadosBim = fn[bimAtivo] || {};

    // Frequência do bimestre (ex: 95.5%)
    let freqVal = '';
    const rawFreq = dadosBim.frequenciaBimestre ?? dadosBim.frequenciaTotalAno ?? dadosBim.frequencia ?? dadosBim.presenca;
    if (rawFreq !== undefined && rawFreq !== null && rawFreq !== '') {
      const numF = parseFloat(String(rawFreq).replace(',', '.').replace('%', '').trim());
      if (!isNaN(numF)) freqVal = numF.toFixed(1);
    }

    // Faltas do bimestre
    let faltasVal = '';
    if (dadosBim.totalFaltas !== undefined && dadosBim.totalFaltas !== null) {
      faltasVal = String(dadosBim.totalFaltas);
    }

    // Média Geral
    let mediaVal = '';
    if (dadosBim.mediaGeral !== undefined && dadosBim.mediaGeral !== null && !isNaN(Number(dadosBim.mediaGeral))) {
      mediaVal = Number(dadosBim.mediaGeral).toFixed(1);
    }

    // Situação
    const situacaoVal = dadosBim.situacao || (aluno.status === 'ativo' ? 'EM CURSO' : (aluno.status || 'EM CURSO')).toUpperCase();

    // Disciplinas existentes ou sugeridas (sempre sanitizadas sem códigos numéricos como 1813)
    const disciplinasExistentes = dadosBim.disciplinas || {};
    const nomesExistentes = Object.keys(disciplinasExistentes).map(n => limparNomeDisciplina(n));
    const sugeridas = obterDisciplinasSugeridas(aluno.turma, aluno.segmento).map(n => limparNomeDisciplina(n));

    // Unir mantendo existentes primeiro, depois sugeridas não inclusas
    const listaNomesDiscs = Array.from(new Set([...nomesExistentes, ...sugeridas])).filter(Boolean);

    modalEl.innerHTML = `
      <div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        <!-- Cabeçalho -->
        <div class="px-6 py-4 bg-linear-to-r from-blue-900 via-indigo-900 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300">
              <i class="fa-solid fa-file-pen text-lg"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold leading-tight">Digitar Boletim & Frequência Bimestral</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/30 text-blue-200 border border-blue-400/30 uppercase">
                  Ajuste de Transferido / Manual
                </span>
              </div>
              <p class="text-xs text-blue-200">Disponível para todos os perfis pedagógicos &bull; Lançamento direto com cálculo automático</p>
            </div>
          </div>
          <button type="button" id="btn-fechar-digitar-boletim" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer">
            <i class="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        <!-- Identificação do Aluno & Seletor de Bimestre -->
        <div class="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            <span class="text-xs font-black text-slate-800 uppercase tracking-tight block">${aluno.nome || 'Estudante'}</span>
            <span class="text-[11px] text-slate-500 font-mono">RA: ${aluno.ra} &bull; Turma: ${aluno.turma || '—'}</span>
          </div>

          <!-- Seletor de Bimestres -->
          <div class="flex items-center gap-1 bg-slate-200 p-1 rounded-lg text-xs font-bold">
            <button type="button" class="btn-trocar-bim px-2.5 py-1 rounded transition ${bimAtivo === '1B' ? 'bg-blue-700 text-white shadow-xs' : 'text-slate-700 hover:bg-white'}" data-bim="1B">1º Bimestre</button>
            <button type="button" class="btn-trocar-bim px-2.5 py-1 rounded transition ${bimAtivo === '2B' ? 'bg-blue-700 text-white shadow-xs' : 'text-slate-700 hover:bg-white'}" data-bim="2B">2º Bimestre</button>
            <button type="button" class="btn-trocar-bim px-2.5 py-1 rounded transition ${bimAtivo === '3B' ? 'bg-blue-700 text-white shadow-xs' : 'text-slate-700 hover:bg-white'}" data-bim="3B">3º Bimestre</button>
            <button type="button" class="btn-trocar-bim px-2.5 py-1 rounded transition ${bimAtivo === '4B' ? 'bg-blue-700 text-white shadow-xs' : 'text-slate-700 hover:bg-white'}" data-bim="4B">4º Bimestre</button>
            <button type="button" class="btn-trocar-bim px-2.5 py-1 rounded transition ${bimAtivo === 'FINAL' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-700 hover:bg-white'}" data-bim="FINAL">Final</button>
          </div>
        </div>

        <!-- Formulário com Scroll -->
        <form id="form-digitar-boletim" class="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          
          <!-- Banner explicativo -->
          <div class="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-start gap-2.5">
            <i class="fa-solid fa-circle-info text-indigo-600 mt-0.5 shrink-0 text-sm"></i>
            <div class="leading-relaxed">
              <strong>Lançamento para Alunos Transferidos / Sem Mapão:</strong> Os dados inseridos aqui passam a compor o Boletim do Dossiê do Estudante e o cálculo oficial de Frequência do Mapão, sanando ausências decorrentes de transferência escolar posterior ao fechamento.
            </div>
          </div>

          <!-- Linha 1: Frequência Bimestral, Faltas e Média Geral -->
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
            <div>
              <label for="input-boletim-freq" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Frequência Bimestre (%) <span class="text-rose-500">*</span>
              </label>
              <div class="relative">
                <input
                  type="number"
                  id="input-boletim-freq"
                  name="frequencia"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="ex: 95.0"
                  value="${freqVal}"
                  required
                  class="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-black text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
                <span class="absolute right-3 top-2.5 text-xs font-bold text-slate-400 pointer-events-none">%</span>
              </div>
            </div>

            <div>
              <label for="input-boletim-faltas" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Total de Faltas <span class="text-rose-500">*</span>
              </label>
              <input
                type="number"
                id="input-boletim-faltas"
                name="totalFaltas"
                min="0"
                step="1"
                placeholder="ex: 4"
                value="${faltasVal}"
                required
                class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-black text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label for="input-boletim-media" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Média Geral (0 a 10)
              </label>
              <input
                type="number"
                id="input-boletim-media"
                name="mediaGeral"
                step="0.1"
                min="0"
                max="10"
                placeholder="Auto ou Digite"
                value="${mediaVal}"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-black text-blue-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label for="input-boletim-situacao" class="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Situação
              </label>
              <select
                id="input-boletim-situacao"
                class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="EM CURSO" ${situacaoVal === 'EM CURSO' ? 'selected' : ''}>EM CURSO</option>
                <option value="APROVADO" ${situacaoVal === 'APROVADO' ? 'selected' : ''}>APROVADO</option>
                <option value="RETIDO" ${situacaoVal === 'RETIDO' ? 'selected' : ''}>RETIDO</option>
                <option value="TRANSFERIDO" ${situacaoVal === 'TRANSFERIDO' ? 'selected' : ''}>TRANSFERIDO</option>
              </select>
            </div>
          </div>

          <!-- Tabela de Disciplinas & Notas -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <i class="fa-solid fa-graduation-cap text-blue-700"></i>
                  <span>Notas e Faltas por Disciplina (${bimAtivo})</span>
                </h4>
                <p class="text-[11px] text-slate-500">Ao preencher as notas, a Média Geral do Bimestre é recalculada automaticamente.</p>
              </div>
              <button
                type="button"
                id="btn-adicionar-disciplina-row"
                class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold rounded-lg text-xs transition inline-flex items-center gap-1 cursor-pointer"
              >
                <i class="fa-solid fa-plus text-xs text-blue-600"></i>
                <span>+ Disciplina</span>
              </button>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <div class="max-h-72 overflow-y-auto custom-scrollbar">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th class="px-3 py-2">Componente Curricular / Disciplina</th>
                      <th class="px-3 py-2 w-28 text-center">Nota / Menção</th>
                      <th class="px-3 py-2 w-24 text-center">Faltas</th>
                      <th class="px-3 py-2 w-16 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody id="tbody-disciplinas-boletim" class="divide-y divide-slate-100">
                    ${listaNomesDiscs.map((nomeDisc) => {
                      const dInfo = (disciplinasExistentes[nomeDisc] || Object.entries(disciplinasExistentes).find(([k]) => limparNomeDisciplina(k) === nomeDisc)?.[1] || {}) as any;
                      const nVal = dInfo.notaNum !== null && dInfo.notaNum !== undefined ? dInfo.notaNum : (dInfo.mencaoNota || '');
                      const fVal = dInfo.faltas !== undefined && dInfo.faltas !== null ? dInfo.faltas : 0;
                      return `
                        <tr class="hover:bg-slate-50/80 transition disc-row">
                          <td class="px-3 py-2">
                            <input
                              type="text"
                              class="disc-nome-input w-full bg-transparent border-none text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-blue-400 rounded px-1"
                              value="${nomeDisc}"
                            />
                          </td>
                          <td class="px-3 py-2 text-center">
                            <input
                              type="text"
                              class="disc-nota-input w-20 px-2 py-1 bg-white border border-slate-200 rounded text-center text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="ex: 7.5"
                              value="${nVal}"
                            />
                          </td>
                          <td class="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="0"
                              class="disc-faltas-input w-16 px-2 py-1 bg-white border border-slate-200 rounded text-center text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="0"
                              value="${fVal}"
                            />
                          </td>
                          <td class="px-3 py-2 text-center">
                            <button
                              type="button"
                              class="btn-remover-disc text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer"
                              title="Remover disciplina da lista"
                            >
                              <i class="fa-solid fa-trash text-[11px]"></i>
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Botões de Ação do Rodapé -->
          <div class="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div class="text-[11px] text-slate-500">
              Registrado por: <strong>${userRole}</strong> &bull; Salvo com histórico em auditoria
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                id="btn-cancelar-digitar-boletim"
                class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                id="btn-salvar-digitar-boletim"
                class="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition flex items-center gap-2 cursor-pointer"
              >
                <i class="fa-solid fa-floppy-disk text-xs"></i>
                <span>Salvar Boletim (${bimAtivo})</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    `;

    // Configurar eventos
    configurarEventosModal();
  };

  const fechar = () => {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('flex');
    modalEl.innerHTML = '';
  };

  const configurarEventosModal = () => {
    // Fechar
    document.getElementById('btn-fechar-digitar-boletim')?.addEventListener('click', fechar);
    document.getElementById('btn-cancelar-digitar-boletim')?.addEventListener('click', fechar);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) fechar();
    });

    // Troca de bimestre
    modalEl.querySelectorAll('.btn-trocar-bim').forEach((btn) => {
      btn.addEventListener('click', () => {
        const novoBim = (btn as HTMLElement).dataset.bim as BimestreKey;
        if (novoBim) {
          bimAtivo = novoBim;
          renderizarConteudoModal();
        }
      });
    });

    // Adicionar nova linha de disciplina
    document.getElementById('btn-adicionar-disciplina-row')?.addEventListener('click', () => {
      const tbody = document.getElementById('tbody-disciplinas-boletim');
      if (!tbody) return;
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/80 transition disc-row';
      tr.innerHTML = `
        <td class="px-3 py-2">
          <input
            type="text"
            class="disc-nome-input w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Nova Disciplina"
            value=""
          />
        </td>
        <td class="px-3 py-2 text-center">
          <input
            type="text"
            class="disc-nota-input w-20 px-2 py-1 bg-white border border-slate-200 rounded text-center text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ex: 8.0"
            value=""
          />
        </td>
        <td class="px-3 py-2 text-center">
          <input
            type="number"
            min="0"
            class="disc-faltas-input w-16 px-2 py-1 bg-white border border-slate-200 rounded text-center text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
            value="0"
          />
        </td>
        <td class="px-3 py-2 text-center">
          <button
            type="button"
            class="btn-remover-disc text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer"
            title="Remover disciplina da lista"
          >
            <i class="fa-solid fa-trash text-[11px]"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
      tr.querySelector('.btn-remover-disc')?.addEventListener('click', () => {
        tr.remove();
        recalcularTotais();
      });
      tr.querySelector('.disc-nota-input')?.addEventListener('input', recalcularTotais);
      tr.querySelector('.disc-faltas-input')?.addEventListener('input', recalcularTotais);
    });

    // Remover linha de disciplina
    modalEl.querySelectorAll('.btn-remover-disc').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.disc-row');
        row?.remove();
        recalcularTotais();
      });
    });

    // Recálculo automático de notas e faltas ao digitar
    const recalcularTotais = () => {
      const notaInputs = modalEl.querySelectorAll<HTMLInputElement>('.disc-nota-input');
      const faltasInputs = modalEl.querySelectorAll<HTMLInputElement>('.disc-faltas-input');

      let somaNotas = 0;
      let countNotas = 0;
      notaInputs.forEach((inp) => {
        const raw = inp.value.replace(',', '.').trim();
        const n = parseFloat(raw);
        if (!isNaN(n)) {
          somaNotas += n;
          countNotas++;
        }
      });

      const mediaInput = document.getElementById('input-boletim-media') as HTMLInputElement;
      if (mediaInput && countNotas > 0) {
        mediaInput.value = (somaNotas / countNotas).toFixed(1);
      }

      let somaFaltas = 0;
      let hasFaltas = false;
      faltasInputs.forEach((inp) => {
        const f = parseInt(inp.value, 10);
        if (!isNaN(f) && f >= 0) {
          somaFaltas += f;
          hasFaltas = true;
        }
      });

      const faltasInput = document.getElementById('input-boletim-faltas') as HTMLInputElement;
      if (faltasInput && hasFaltas && (!faltasInput.value || faltasInput.value === '0')) {
        faltasInput.value = String(somaFaltas);
      }
    };

    modalEl.querySelectorAll('.disc-nota-input').forEach((inp) => {
      inp.addEventListener('input', recalcularTotais);
    });
    modalEl.querySelectorAll('.disc-faltas-input').forEach((inp) => {
      inp.addEventListener('input', recalcularTotais);
    });

    // Envio do formulário
    const form = document.getElementById('form-digitar-boletim') as HTMLFormElement;
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const inputFreq = document.getElementById('input-boletim-freq') as HTMLInputElement;
        const inputFaltas = document.getElementById('input-boletim-faltas') as HTMLInputElement;
        const inputMedia = document.getElementById('input-boletim-media') as HTMLInputElement;
        const selectSituacao = document.getElementById('input-boletim-situacao') as HTMLSelectElement;
        const btnSalvar = document.getElementById('btn-salvar-digitar-boletim') as HTMLButtonElement;

        const freqNum = parseFloat(inputFreq.value.replace(',', '.').trim());
        if (isNaN(freqNum) || freqNum < 0 || freqNum > 100) {
          if (typeof window.showToast === 'function') {
            window.showToast('Informe uma frequência válida entre 0% e 100%.', 'warning');
          }
          return;
        }

        const faltasNum = parseInt(inputFaltas.value, 10) || 0;
        const mediaNum = inputMedia.value ? parseFloat(inputMedia.value.replace(',', '.').trim()) : null;
        const situacaoStr = selectSituacao?.value || 'EM CURSO';

        // Coletar disciplinas
        const disciplinasMap: Record<string, any> = {};
        let qtdAbaixo = 0;
        const rows = modalEl.querySelectorAll<HTMLTableRowElement>('.disc-row');
        rows.forEach((row) => {
          const rawNome = (row.querySelector('.disc-nome-input') as HTMLInputElement)?.value.trim();
          const nome = limparNomeDisciplina(rawNome);
          const notaRaw = (row.querySelector('.disc-nota-input') as HTMLInputElement)?.value.trim();
          const faltasD = parseInt((row.querySelector('.disc-faltas-input') as HTMLInputElement)?.value, 10) || 0;

          if (!nome) return;

          let notaNum: number | null = null;
          const parsedN = parseFloat(notaRaw.replace(',', '.'));
          if (!isNaN(parsedN)) {
            notaNum = parsedN;
            if (notaNum < 5.0) qtdAbaixo++;
          }

          disciplinasMap[nome] = {
            nome,
            mencaoNota: notaRaw || (notaNum !== null ? notaNum.toFixed(1) : '—'),
            notaNum,
            faltas: faltasD,
            ausenciaCompensada: 0,
            abaixoBasico: notaNum !== null ? notaNum < 5.0 : false
          };
        });

        if (btnSalvar) {
          btnSalvar.disabled = true;
          btnSalvar.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs"></i><span>Salvando...</span>`;
        }

        const agoraISO = new Date().toISOString();
        const bimNum = bimAtivo === '1B' ? 1 : (bimAtivo === '2B' ? 2 : (bimAtivo === '3B' ? 3 : (bimAtivo === '4B' ? 4 : 5)));

        const payloadBimestre: any = {
          bimestre: bimNum,
          bimestreKey: bimAtivo,
          anoLetivo: 2026,
          turmaOriginal: aluno.turma || '',
          tipoFechamento: bimAtivo === 'FINAL' ? 'FECHAMENTO FINAL' : `CONSELHO ${bimAtivo}`,
          totalAulasDadas: 50,
          totalAulasDadasEletiva: 0,
          totalFaltas: faltasNum,
          frequenciaBimestre: `${freqNum.toFixed(1)}%`,
          faltasTotalAno: faltasNum,
          frequenciaTotalAno: `${freqNum.toFixed(1)}%`,
          mediaGeral: mediaNum,
          qtdAbaixoBasico: qtdAbaixo,
          situacao: situacaoStr,
          disciplinas: disciplinasMap,
          ajuste_manual: true,
          digitado_manualmente: true,
          digitado_por: userRole,
          atualizadoEm: agoraISO
        };

        const updatePayload: any = {
          [`fechamento_notas.${bimAtivo}`]: payloadBimestre,
          ultima_atualizacao_notas: agoraISO
        };

        if (bimAtivo === 'FINAL') {
          updatePayload.situacao_final_ano = situacaoStr;
        }

        try {
          const studentDocRef = doc(db, 'alunos', aluno.ra);
          try {
            await updateDoc(studentDocRef, updatePayload);
          } catch {
            await setDoc(studentDocRef, updatePayload, { merge: true });
          }

          // Atualizar estado em memória
          if (Array.isArray((window as any).allStudentsData)) {
            const idx = (window as any).allStudentsData.findIndex((s: any) => s.ra === aluno.ra);
            if (idx !== -1) {
              const st = (window as any).allStudentsData[idx];
              if (!st.fechamento_notas) st.fechamento_notas = {};
              st.fechamento_notas[bimAtivo] = payloadBimestre;
              st.ultima_atualizacao_notas = agoraISO;
              if (bimAtivo === 'FINAL') st.situacao_final_ano = situacaoStr;
            }
          }

          // Atualizar aluno ativo no dossiê se estiver aberto
          if ((window as any).currentAlunoModalData && (window as any).currentAlunoModalData.ra === aluno.ra) {
            if (!(window as any).currentAlunoModalData.fechamento_notas) {
              (window as any).currentAlunoModalData.fechamento_notas = {};
            }
            (window as any).currentAlunoModalData.fechamento_notas[bimAtivo] = payloadBimestre;
            (window as any).currentAlunoModalData.ultima_atualizacao_notas = agoraISO;
            if (bimAtivo === 'FINAL') {
              (window as any).currentAlunoModalData.situacao_final_ano = situacaoStr;
            }
            if (typeof window.atualizarVisualizacaoBoletimModal === 'function') {
              window.atualizarVisualizacaoBoletimModal();
            }
            if (typeof window.calcularMediaNotasEstudante === 'function') {
              const mediaInfo = window.calcularMediaNotasEstudante((window as any).currentAlunoModalData);
              const elMediaVal = document.getElementById('modal-display-media-val');
              const elMediaSub = document.getElementById('modal-display-media-sub');
              if (elMediaVal) elMediaVal.textContent = mediaInfo.mediaFormatada;
              if (elMediaSub) elMediaSub.textContent = `${mediaInfo.bimestresContados} bim (${mediaInfo.detalheBimestres})`;
            }
          }

          // Auditoria
          if (typeof window.registrarLogAuditoria === 'function') {
            window.registrarLogAuditoria({
              modulo: 'Boletim & Rendimento',
              acao: 'DIGITAR_BOLETIM_MANUAL',
              descricao: `${userRole} lançou/ajustou notas e frequência do ${bimAtivo} para o estudante ${aluno.nome} (RA: ${aluno.ra}): Freq ${freqNum.toFixed(1)}%, Faltas: ${faltasNum}, Média: ${mediaNum ?? '—'}`,
              detalhes: {
                ra: aluno.ra,
                nome: aluno.nome,
                turma: aluno.turma,
                bimestre: bimAtivo,
                frequencia: `${freqNum.toFixed(1)}%`,
                totalFaltas: faltasNum,
                mediaGeral: mediaNum,
                disciplinasTotal: Object.keys(disciplinasMap).length,
                atualizadoPor: userRole
              }
            });
          }

          if (typeof window.showToast === 'function') {
            window.showToast(`Boletim e frequência do ${bimAtivo} salvos com sucesso!`, 'success', 4000);
          }

          // Disparar eventos
          window.dispatchEvent(new CustomEvent('student-data-updated', { detail: { ra: aluno.ra } }));
          if (typeof window.applyStudentFilters === 'function') window.applyStudentFilters();
          if (typeof window.atualizarDashboardGraficos === 'function') window.atualizarDashboardGraficos();

          fechar();
        } catch (err: any) {
          console.error('Erro ao salvar boletim manual:', err);
          if (typeof window.showErrorToast === 'function') {
            window.showErrorToast('Erro ao salvar boletim no banco de dados.', err);
          } else if (typeof window.showToast === 'function') {
            window.showToast('Erro ao persistir boletim no banco de dados.', 'warning');
          }
          if (btnSalvar) {
            btnSalvar.disabled = false;
            btnSalvar.innerHTML = `<i class="fa-solid fa-floppy-disk text-xs"></i><span>Salvar Boletim (${bimAtivo})</span>`;
          }
        }
      });
    }
  };

  // Abre e renderiza o modal
  modalEl.classList.remove('hidden');
  modalEl.classList.add('flex');
  renderizarConteudoModal();
}

// Disponibilizar globalmente
if (typeof window !== 'undefined') {
  window.abrirModalDigitarBoletim = abrirModalDigitarBoletim;
}
