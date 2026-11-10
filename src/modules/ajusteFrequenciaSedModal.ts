/**
 * Módulo de Ajuste Manual de Frequência SED para Casos Especiais
 * Exclusivo para Direção e Vice-Direção Escolar (EE Clóvis de Lucca)
 */

import { doc, updateDoc, setDoc, db } from '../lib/database';
import { compararFrequenciaAluno } from './attendanceComparisonHelper';

declare global {
  interface Window {
    abrirModalAjusteFreqSED?: (ra: string) => void;
    showToast?: (msg: string, type?: string, duration?: number) => void;
    showErrorToast?: (msg: string, err?: any) => void;
    registrarLogAuditoria?: (dados: any) => void;
    applyStudentFilters?: () => void;
    atualizarDashboardGraficos?: () => void;
    renderBuscaAtiva?: () => void;
    calcularMediaNotasEstudante?: (aluno: any) => any;
  }
}

/**
 * Verifica se o usuário atual é Diretor ou Vice-Diretor
 */
function verificarAutorizacaoDirecao(): boolean {
  const role = (typeof (window as any).obterRoleAtual === 'function' 
    ? (window as any).obterRoleAtual() 
    : (window as any).currentUserRole) || 'PROFESSOR';
  const roleNorm = String(role).toUpperCase().replace(/-/g, '_').trim();
  return roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('DIRETOR') || roleNorm.includes('VICE');
}

/**
 * Cria ou recupera o elemento modal no DOM
 */
function obterOuCriarModalDOM(): HTMLElement {
  let modalContainer = document.getElementById('modal-ajuste-freq-sed-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'modal-ajuste-freq-sed-container';
    modalContainer.className = 'fixed inset-0 z-[9999] hidden items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs transition-opacity';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

/**
 * Abre o modal de ajuste manual de frequência na SED para casos especiais
 */
export function abrirModalAjusteFreqSED(ra: string): void {
  if (!verificarAutorizacaoDirecao()) {
    if (typeof window.showToast === 'function') {
      window.showToast('Acesso Restrito: Apenas a Direção e Vice-Direção possuem permissão para atualizar manualmente a frequência da SED para casos especiais.', 'warning', 5000);
    }
    return;
  }

  const allStudents = (window as any).allStudentsData || [];
  const cleanTarget = String(ra || '').replace(/\D/g, '').substring(0, 12);
  const aluno = allStudents.find((s: any) => 
    String(s.ra || '').trim() === String(ra).trim() ||
    String(s.ra || '').replace(/\D/g, '').substring(0, 12) === cleanTarget
  );

  if (!aluno) {
    if (typeof window.showToast === 'function') {
      window.showToast(`Estudante com RA ${ra} não encontrado na base de dados.`, 'warning');
    }
    return;
  }

  const comp = compararFrequenciaAluno(aluno);
  const modalEl = obterOuCriarModalDOM();

  // Valores iniciais sugeridos
  const sedFreqAtual = comp.sedFreq !== null ? comp.sedFreq : '';
  const sedFaltasAtual = comp.sedFaltas !== null ? comp.sedFaltas : '';
  const mapaoFreqAtual = comp.mapaoFreq !== null ? comp.mapaoFreq : null;
  const mapaoFaltasAtual = comp.mapaoFaltas !== null ? comp.mapaoFaltas : null;

  modalEl.innerHTML = `
    <div class="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
      
      <!-- Cabeçalho -->
      <div class="px-6 py-4 bg-linear-to-r from-blue-900 via-indigo-900 to-slate-900 text-white flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-300">
            <i class="fa-solid fa-scale-balanced text-lg"></i>
          </div>
          <div>
            <h3 class="text-base font-bold leading-tight">Ajuste de Frequência SED (Casos Especiais)</h3>
            <p class="text-xs text-blue-200">Exclusivo Direção e Vice-Direção Escolar &bull; Amparo Legal / Conselho</p>
          </div>
        </div>
        <button type="button" id="btn-fechar-modal-ajuste-freq" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>

      <!-- Informações do Estudante -->
      <div class="px-6 py-3.5 bg-blue-50/70 border-b border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <span class="text-[10px] font-bold text-slate-400 uppercase block">Estudante</span>
          <span class="font-extrabold text-blue-950 text-sm uppercase">${aluno.nome || 'ESTUDANTE'}</span>
          <span class="text-[11px] text-slate-500 block font-mono">RA: ${aluno.ra} &bull; Turma: ${aluno.turma || '—'}</span>
        </div>
        <div class="flex items-center gap-3 bg-white p-2 rounded-xl border border-blue-200">
          <div class="text-center px-2">
            <span class="text-[9px] font-bold text-slate-400 uppercase block">SED Atual</span>
            <span class="font-black text-blue-900 text-xs">${comp.sedFreq !== null ? comp.sedFreq.toFixed(1) + '%' : '—'}</span>
            <span class="text-[9px] text-slate-500 block">${comp.sedFaltas !== null ? comp.sedFaltas + ' f' : ''}</span>
          </div>
          <div class="h-6 w-px bg-slate-200"></div>
          <div class="text-center px-2">
            <span class="text-[9px] font-bold text-slate-400 uppercase block">Mapão (Média)</span>
            <span class="font-black text-indigo-900 text-xs">${comp.mapaoFreq !== null ? comp.mapaoFreq.toFixed(1) + '%' : '—'}</span>
            <span class="text-[9px] text-slate-500 block">${comp.mapaoFaltas !== null ? comp.mapaoFaltas + ' f' : ''}</span>
          </div>
        </div>
      </div>

      <!-- Formulário de Ajuste -->
      <form id="form-ajuste-freq-sed" class="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
        
        <!-- Botão de preenchimento rápido caso haja Mapão -->
        ${mapaoFreqAtual !== null ? `
          <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-xs text-indigo-900 font-medium">
              <i class="fa-solid fa-wand-magic-sparkles text-indigo-600"></i>
              <span>Média calculada do Mapão: <strong>${mapaoFreqAtual.toFixed(1)}%</strong> (${mapaoFaltasAtual ?? 0} faltas)</span>
            </div>
            <button type="button" id="btn-usar-mapao-freq" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap">
              Copiar do Mapão
            </button>
          </div>
        ` : ''}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Nova Frequência SED -->
          <div>
            <label for="input-nova-freq-sed" class="block text-xs font-bold text-slate-700 uppercase mb-1">
              Nova Frequência SED (%) <span class="text-rose-600">*</span>
            </label>
            <div class="relative">
              <input 
                type="number" 
                id="input-nova-freq-sed" 
                name="novaFreq" 
                step="0.1" 
                min="0" 
                max="100" 
                value="${sedFreqAtual}" 
                placeholder="Ex: 85.0" 
                required 
                class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-extrabold text-blue-900 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-bold text-slate-400">%</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1">Informe a frequência homologada (0 a 100).</p>
          </div>

          <!-- Total de Faltas -->
          <div>
            <label for="input-novas-faltas-sed" class="block text-xs font-bold text-slate-700 uppercase mb-1">
              Total de Faltas Homologadas
            </label>
            <input 
              type="number" 
              id="input-novas-faltas-sed" 
              name="novasFaltas" 
              min="0" 
              max="2000" 
              value="${sedFaltasAtual}" 
              placeholder="Ex: 24" 
              class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
            <p class="text-[10px] text-slate-400 mt-1">Calculado automaticamente ou ajustado manualmente.</p>
          </div>
        </div>

        <!-- Motivo / Amparo Legal -->
        <div>
          <label for="select-motivo-ajuste-freq" class="block text-xs font-bold text-slate-700 uppercase mb-1">
            Motivo do Caso Especial / Amparo Legal <span class="text-rose-600">*</span>
          </label>
          <select 
            id="select-motivo-ajuste-freq" 
            name="motivo" 
            required 
            class="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 transition"
          >
            <option value="Atestado Médico / Tratamento de Saúde (Res. SEDUC)">🏥 Atestado Médico Prolongado / Tratamento de Saúde (Res. SEDUC)</option>
            <option value="Decisão Homologada pelo Conselho de Classe / Escola">🏛️ Decisão Homologada pelo Conselho de Classe / Escola</option>
            <option value="Amparo à Maternidade / Licença Gestante (Lei nº 6.202/75)">🍼 Amparo Legal à Maternidade / Gestante (Lei nº 6.202/75)</option>
            <option value="Representação Escolar Oficial em Eventos Esportivos/Culturais">🏆 Representação Escolar Oficial (Esporte / Cultura / Olimpíadas)</option>
            <option value="Correção de Erro Material no Diário de Classe / SED">✏️ Correção de Erro Material de Lançamento no Diário / SED</option>
            <option value="Acolhimento de Recurso de Frequência pela Direção">⚖️ Acolhimento de Recurso de Frequência pela Direção</option>
            <option value="Outro Caso Excepcional Homologado pela Direção">📋 Outro Caso Excepcional Homologado pela Direção</option>
          </select>
        </div>

        <!-- Justificativa Detalhada -->
        <div>
          <label for="textarea-justificativa-ajuste-freq" class="block text-xs font-bold text-slate-700 uppercase mb-1">
            Justificativa Detalhada & Documento Comprobatório <span class="text-rose-600">*</span>
          </label>
          <textarea 
            id="textarea-justificativa-ajuste-freq" 
            name="justificativa" 
            rows="3" 
            required 
            placeholder="Descreva o número do protocolo, laudo médico, parecer do conselho de classe ou despacho da Direção que fundamenta a atualização da frequência..."
            class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
          >${aluno.justificativa_ajuste_frequencia || aluno.frequencia_atual?.justificativa || ''}</textarea>
        </div>

        <!-- Aviso Legal de Auditoria -->
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-[11px] text-amber-900 leading-snug">
          <i class="fa-solid fa-shield-halved text-amber-600 text-sm mt-0.5"></i>
          <div>
            <strong>Registro Oficial de Auditoria:</strong> Esta operação será vinculada ao seu login de Direção/Vice-Direção e arquivada nos registros de conformidade e auditoria escolar do sistema.
          </div>
        </div>

        <!-- Ações -->
        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button 
            type="button" 
            id="btn-cancelar-modal-ajuste-freq" 
            class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Cancelar
          </button>
          <button 
            type="submit" 
            id="btn-confirmar-ajuste-freq" 
            class="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl text-xs transition cursor-pointer flex items-center gap-2 shadow-md shadow-blue-900/20"
          >
            <i class="fa-solid fa-floppy-disk text-xs"></i>
            <span>Salvar Ajuste Especial</span>
          </button>
        </div>
      </form>
    </div>
  `;

  modalEl.classList.remove('hidden');
  modalEl.classList.add('flex');

  // Fechar
  const fechar = () => {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('flex');
    modalEl.innerHTML = '';
  };

  document.getElementById('btn-fechar-modal-ajuste-freq')?.addEventListener('click', fechar);
  document.getElementById('btn-cancelar-modal-ajuste-freq')?.addEventListener('click', fechar);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) fechar();
  });

  // Copiar do Mapão
  const btnUsarMapao = document.getElementById('btn-usar-mapao-freq');
  if (btnUsarMapao && mapaoFreqAtual !== null) {
    btnUsarMapao.addEventListener('click', () => {
      const inputFreq = document.getElementById('input-nova-freq-sed') as HTMLInputElement;
      const inputFaltas = document.getElementById('input-novas-faltas-sed') as HTMLInputElement;
      if (inputFreq) inputFreq.value = mapaoFreqAtual.toFixed(1);
      if (inputFaltas && mapaoFaltasAtual !== null) inputFaltas.value = String(mapaoFaltasAtual);
      const selectMotivo = document.getElementById('select-motivo-ajuste-freq') as HTMLSelectElement;
      if (selectMotivo) selectMotivo.value = 'Correção de Erro Material no Diário de Classe / SED';
    });
  }

  // Auto-cálculo estimado de faltas ao mudar percentual se campo de faltas estiver vazio
  const inputNovaFreq = document.getElementById('input-nova-freq-sed') as HTMLInputElement;
  const inputNovasFaltas = document.getElementById('input-novas-faltas-sed') as HTMLInputElement;
  if (inputNovaFreq && inputNovasFaltas) {
    inputNovaFreq.addEventListener('input', () => {
      const val = parseFloat(inputNovaFreq.value);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        if (!inputNovasFaltas.value || inputNovasFaltas.value === '0') {
          // Estimativa baseada nos 200 dias anuais
          const faltasEst = Math.max(0, Math.round((1 - (val / 100)) * 200));
          inputNovasFaltas.value = String(faltasEst);
        }
      }
    });
  }

  // Envio do formulário
  const form = document.getElementById('form-ajuste-freq-sed') as HTMLFormElement;
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!verificarAutorizacaoDirecao()) {
        if (typeof window.showToast === 'function') {
          window.showToast('Apenas a Direção Escolar possui permissão para salvar ajustes de frequência.', 'warning');
        }
        return;
      }

      const freqVal = parseFloat(inputNovaFreq.value);
      if (isNaN(freqVal) || freqVal < 0 || freqVal > 100) {
        if (typeof window.showToast === 'function') {
          window.showToast('Por favor, informe uma frequência válida entre 0% e 100%.', 'warning');
        }
        return;
      }

      const faltasVal = parseInt(inputNovasFaltas.value, 10) || 0;
      const motivo = (document.getElementById('select-motivo-ajuste-freq') as HTMLSelectElement).value;
      const justificativa = (document.getElementById('textarea-justificativa-ajuste-freq') as HTMLTextAreaElement).value.trim();

      if (!justificativa) {
        if (typeof window.showToast === 'function') {
          window.showToast('Por favor, insira a justificativa ou documento comprobatório para o caso especial.', 'warning');
        }
        return;
      }

      const btnSalvar = document.getElementById('btn-confirmar-ajuste-freq') as HTMLButtonElement;
      if (btnSalvar) {
        btnSalvar.disabled = true;
        btnSalvar.innerHTML = `<i class="fa-solid fa-spinner animate-spin text-xs"></i><span>Salvando Ajuste...</span>`;
      }

      const roleAtual = (typeof (window as any).obterRoleAtual === 'function' ? (window as any).obterRoleAtual() : 'DIREÇÃO');
      const agoraStr = new Date().toLocaleDateString('pt-BR');
      const agoraISO = new Date().toISOString();

      const payloadAjuste: any = {
        frequencia_atual: {
          valor: `${freqVal.toFixed(1)}%`,
          frequencia: `${freqVal.toFixed(1)}%`,
          total_faltas: faltasVal,
          data: `${agoraStr} (Ajuste Direção)`,
          ajuste_manual: true,
          ajustado_por: roleAtual,
          motivo_ajuste: motivo,
          justificativa: justificativa,
          data_ajuste: agoraISO
        },
        presenca_anual: `${freqVal.toFixed(1)}%`,
        frequencia_ajustada_direcao: true,
        motivo_ajuste_frequencia: motivo,
        justificativa_ajuste_frequencia: justificativa,
        data_ajuste_frequencia: agoraISO
      };

      try {
        const studentDocRef = doc(db, 'alunos', aluno.ra);
        try {
          await updateDoc(studentDocRef, payloadAjuste);
        } catch {
          await setDoc(studentDocRef, payloadAjuste, { merge: true });
        }

        // Atualizar estado em memória
        if (Array.isArray((window as any).allStudentsData)) {
          const idx = (window as any).allStudentsData.findIndex((s: any) => s.ra === aluno.ra);
          if (idx !== -1) {
            (window as any).allStudentsData[idx] = {
              ...(window as any).allStudentsData[idx],
              ...payloadAjuste
            };
          }
        }

        // Se o dossiê estiver aberto para este aluno, atualizar a visualização imediatamente
        const modalDossieRa = (document.getElementById('modal-aluno-ra-hidden') as HTMLInputElement)?.value;
        if (modalDossieRa === aluno.ra) {
          if (typeof (window as any).abrirFichaAluno === 'function') {
            (window as any).abrirFichaAluno(aluno.ra);
          } else {
            const elFreqVal = document.getElementById('modal-display-freq-val');
            if (elFreqVal) elFreqVal.textContent = `${freqVal.toFixed(1)}%`;
            const elFreqData = document.getElementById('modal-display-freq-data');
            if (elFreqData) elFreqData.textContent = `Ajuste Direção: ${agoraStr}`;
            const badgeAjuste = document.getElementById('modal-display-freq-ajustada-badge');
            if (badgeAjuste) {
              badgeAjuste.classList.remove('hidden');
              badgeAjuste.title = `Frequência SED ajustada pela Direção (${motivo}): ${justificativa}`;
            }
          }
        }

        // Registrar Log de Auditoria
        if (typeof window.registrarLogAuditoria === 'function') {
          window.registrarLogAuditoria({
            modulo: 'Auditoria de Frequência',
            acao: 'AJUSTE_FREQUENCIA_SED',
            descricao: `Direção atualizou manualmente a frequência SED do estudante ${aluno.nome} (RA: ${aluno.ra}) para ${freqVal.toFixed(1)}% (Faltas: ${faltasVal}). Motivo: ${motivo}`,
            detalhes: {
              ra: aluno.ra,
              nome: aluno.nome,
              turma: aluno.turma,
              frequenciaAnterior: comp.sedFreq,
              novaFrequencia: freqVal,
              faltas: faltasVal,
              motivo,
              justificativa,
              ajustadoPor: roleAtual
            }
          });
        }

        if (typeof window.showToast === 'function') {
          window.showToast(`Frequência na SED atualizada com sucesso para ${freqVal.toFixed(1)}% (Caso Especial arquivado).`, 'success', 4500);
        }

        // Notificar componentes
        window.dispatchEvent(new CustomEvent('student-data-updated', { detail: { ra: aluno.ra } }));
        if (typeof window.applyStudentFilters === 'function') window.applyStudentFilters();
        if (typeof window.atualizarDashboardGraficos === 'function') window.atualizarDashboardGraficos();
        if (typeof window.renderBuscaAtiva === 'function') window.renderBuscaAtiva();

        fechar();
      } catch (err: any) {
        console.error('Erro ao salvar ajuste de frequência:', err);
        if (typeof window.showErrorToast === 'function') {
          window.showErrorToast('Erro ao salvar ajuste de frequência no banco de dados.', err);
        } else if (typeof window.showToast === 'function') {
          window.showToast('Erro ao persistir alteração no banco de dados.', 'warning');
        }
        if (btnSalvar) {
          btnSalvar.disabled = false;
          btnSalvar.innerHTML = `<i class="fa-solid fa-floppy-disk text-xs"></i><span>Salvar Ajuste Especial</span>`;
        }
      }
    });
  }
}

// Disponibilizar globalmente
if (typeof window !== 'undefined') {
  window.abrirModalAjusteFreqSED = abrirModalAjusteFreqSED;
}
