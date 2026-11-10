import React, { useState, useEffect, useMemo } from 'react';
import { 
  BoletimParseResult, 
  extrairBoletimDeArquivoPDF, 
  parseBoletimSEDText,
  aplicarBimestresFaltantesAoAluno 
} from '../modules/boletimPdfParser';

interface ModalImportarBoletimPDFProps {
  aluno: any;
  aberto: boolean;
  aoFechar: () => void;
  aoAtualizarSucesso?: (alunoAtualizado: any, bimestres: string[]) => void;
}

export default function ModalImportarBoletimPDF({
  aluno,
  aberto,
  aoFechar,
  aoAtualizarSucesso
}: ModalImportarBoletimPDFProps) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [processando, setProcessando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [dadosParse, setDadosParse] = useState<BoletimParseResult | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modoTextoManual, setModoTextoManual] = useState(false);
  const [textoManual, setTextoManual] = useState('');
  
  // Bimestres selecionados para gravação
  const [bimestresSelecionados, setBimestresSelecionados] = useState<Record<string, boolean>>({
    '1B': true,
    '2B': true,
    '3B': false,
    '4B': false
  });

  // Aba ativa para visualização detalhada das disciplinas extraídas
  const [abaBimestreVisualizacao, setAbaBimestreVisualizacao] = useState<'1B' | '2B' | '3B' | '4B'>('1B');

  // Reset do estado ao abrir
  useEffect(() => {
    if (aberto) {
      setArquivo(null);
      setProcessando(false);
      setSalvando(false);
      setDadosParse(null);
      setErro(null);
      setModoTextoManual(false);
      setTextoManual('');
    }
  }, [aberto, aluno]);

  // Identificar quais bimestres o aluno JÁ possui no sistema
  const bimestresExistentes = useMemo(() => {
    const res: Record<string, boolean> = { '1B': false, '2B': false, '3B': false, '4B': false };
    if (!aluno) return res;
    const fn = aluno.fechamento_notas || aluno.fechamentos || aluno.notas || aluno.boletim || {};
    ['1B', '2B', '3B', '4B'].forEach(k => {
      if (fn[k] && typeof fn[k] === 'object') {
        const d = fn[k];
        if (d.disciplinas && Object.keys(d.disciplinas).length > 0) res[k] = true;
        else if (d.frequenciaBimestre || d.totalFaltas !== undefined || d.mediaGeral !== undefined) res[k] = true;
      }
    });
    return res;
  }, [aluno]);

  // Ao obter resultado do parse, selecionar automaticamente os bimestres que o aluno AINDA NÃO TEM
  useEffect(() => {
    if (dadosParse && dadosParse.bimestres) {
      const novaSelecao: Record<string, boolean> = {};
      let primeiraComDados: '1B' | '2B' | '3B' | '4B' = '1B';
      let achouPrimeira = false;

      (['1B', '2B', '3B', '4B'] as Array<'1B' | '2B' | '3B' | '4B'>).forEach(k => {
        const b = dadosParse.bimestres[k];
        if (b && b.temDados) {
          if (!achouPrimeira) {
            primeiraComDados = k;
            achouPrimeira = true;
          }
          // Se o aluno NÃO tem esse bimestre na nossa escola, seleciona por padrão!
          novaSelecao[k] = !bimestresExistentes[k];
        } else {
          novaSelecao[k] = false;
        }
      });

      // Se nenhum ficou selecionado (ex: todos faltantes), seleciona os que têm dados no PDF
      if (!Object.values(novaSelecao).some(Boolean)) {
        (['1B', '2B', '3B', '4B'] as Array<'1B' | '2B' | '3B' | '4B'>).forEach(k => {
          if (dadosParse.bimestres[k]?.temDados) novaSelecao[k] = true;
        });
      }

      setBimestresSelecionados(novaSelecao);
      setAbaBimestreVisualizacao(primeiraComDados);
    }
  }, [dadosParse, bimestresExistentes]);

  if (!aberto || !aluno) return null;

  const raAluno = String(aluno.ra || aluno.docId || aluno.id || '').trim();
  const raLimpo = raAluno.replace(/\D/g, '').substring(0, 12);
  const nomeAluno = String(aluno.nome || 'Estudante').toUpperCase();
  const turmaAluno = String(aluno.turma || '-').toUpperCase();

  // Processar arquivo selecionado
  const handleSelecionarArquivo = async (file: File) => {
    if (!file) return;
    setArquivo(file);
    setProcessando(true);
    setErro(null);

    try {
      const resultado = await extrairBoletimDeArquivoPDF(file);
      if (!resultado || !resultado.sucesso) {
        throw new Error(resultado?.mensagem || 'Não foi possível extrair dados estruturados deste PDF.');
      }
      setDadosParse(resultado);
    } catch (err: any) {
      console.error('Erro ao ler PDF do boletim:', err);
      setErro(err.message || 'Erro ao processar arquivo PDF.');
    } finally {
      setProcessando(false);
    }
  };

  // Processar texto colado manualmente
  const handleProcessarTextoManual = () => {
    if (!textoManual.trim()) return;
    setProcessando(true);
    setErro(null);
    try {
      const resultado = parseBoletimSEDText(textoManual);
      if (!resultado.sucesso || (!resultado.bimestres['1B'].temDados && !resultado.bimestres['2B'].temDados)) {
        throw new Error('O texto colado não contém a estrutura de notas e faltas do Boletim Escolar SED.');
      }
      setDadosParse(resultado);
    } catch (err: any) {
      setErro(err.message || 'Falha ao analisar texto do boletim.');
    } finally {
      setProcessando(false);
    }
  };

  // Gravar no banco de dados e sincronizar o aluno
  const handleGravarBimestres = async () => {
    if (!dadosParse) return;

    const bimsParaGravar = (['1B', '2B', '3B', '4B'] as Array<'1B' | '2B' | '3B' | '4B'>).filter(
      k => bimestresSelecionados[k] && dadosParse.bimestres[k]?.temDados
    );

    if (bimsParaGravar.length === 0) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Selecione pelo menos um bimestre para gravar.', 'warning');
      }
      return;
    }

    setSalvando(true);
    try {
      const res = await aplicarBimestresFaltantesAoAluno(aluno, dadosParse, bimsParaGravar);

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(
          `Boletim atualizado com sucesso! ${res.bimestresAtualizados.join(', ')} integrado(s) ao sistema.`,
          'success',
          6000
        );
      }

      if (aoAtualizarSucesso) {
        aoAtualizarSucesso(res.alunoAtualizado, res.bimestresAtualizados);
      }

      aoFechar();
    } catch (err: any) {
      console.error('Erro ao salvar bimestres no banco:', err);
      setErro(err.message || 'Erro ao gravar bimestres no banco de dados.');
    } finally {
      setSalvando(false);
    }
  };

  // Verificar se o RA no PDF bate com o RA do aluno alvo
  const raConfere = dadosParse?.aluno?.raLimpo 
    ? (dadosParse.aluno.raLimpo === raLimpo || raLimpo.includes(dadosParse.aluno.raLimpo) || dadosParse.aluno.raLimpo.includes(raLimpo))
    : true;

  const totalBimsParaGravar = Object.keys(bimestresSelecionados).filter(
    k => bimestresSelecionados[k] && dadosParse?.bimestres[k as '1B' | '2B' | '3B' | '4B']?.temDados
  ).length;

  return (
    <div className="fixed inset-0 z-[11000] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="px-6 py-4 bg-linear-to-r from-emerald-850 via-teal-900 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <i className="fa-solid fa-file-pdf text-xl"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold leading-tight">Leitura Automática de Boletim SED (PDF)</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 uppercase">
                  Auditoria SED vs Mapão
                </span>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                Atualização automática de notas e faltas dos bimestres faltantes (alunos transferidos)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition cursor-pointer"
            title="Fechar"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {/* Card do Estudante Alvo Selecionado */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-900 flex items-center justify-center font-bold text-sm shrink-0">
              <i className="fa-solid fa-user-graduate"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-800 text-sm uppercase">{nomeAluno}</span>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-900 font-bold rounded text-[10px] uppercase">
                  Turma {turmaAluno}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                RA: <strong>{raAluno}</strong>
              </p>
            </div>
          </div>

          {/* Status Atual dos Bimestres na nossa escola */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium">Situação Atual no Mapão:</span>
            {(['1B', '2B', '3B', '4B'] as const).map(k => (
              <span
                key={k}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${
                  bimestresExistentes[k]
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-rose-100 text-rose-800 border-rose-300'
                }`}
                title={bimestresExistentes[k] ? `${k}: Já registrado na nossa escola` : `${k}: Ausente / Pendente`}
              >
                <i className={`fa-solid ${bimestresExistentes[k] ? 'fa-check text-emerald-600' : 'fa-xmark text-rose-600'}`}></i>
                <span>{k}: {bimestresExistentes[k] ? 'Registrado' : 'Pendente'}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">

          {/* Mensagem de Erro se houver */}
          {erro && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2.5">
              <i className="fa-solid fa-triangle-exclamation text-rose-600 mt-0.5 text-sm shrink-0"></i>
              <div className="flex-1">
                <strong className="block font-bold">Erro no processamento do documento:</strong>
                <span>{erro}</span>
              </div>
            </div>
          )}

          {/* Área de Envio do Arquivo PDF */}
          {!dadosParse && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleSelecionarArquivo(f);
                }}
                className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 rounded-2xl p-8 text-center transition cursor-pointer flex flex-col items-center justify-center gap-3 group"
                onClick={() => document.getElementById('input-arquivo-boletim-pdf')?.click()}
              >
                <input
                  type="file"
                  id="input-arquivo-boletim-pdf"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSelecionarArquivo(f);
                  }}
                />

                <div className="w-16 h-16 rounded-2xl bg-emerald-100 group-hover:bg-emerald-200 text-emerald-700 flex items-center justify-center text-3xl shadow-xs transition group-hover:scale-105">
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-800">
                    Clique ou arraste o PDF do Boletim Escolar (SED) aqui
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    O sistema fará a leitura inteligente do cabeçalho oficial e da grade de notas e faltas dos 4 bimestres automaticamente.
                  </p>
                </div>

                <button
                  type="button"
                  className="mt-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider shadow-sm transition flex items-center gap-2 pointer-events-none"
                >
                  <i className="fa-solid fa-file-pdf"></i>
                  <span>Selecionar Arquivo PDF</span>
                </button>
              </div>

              {/* Opção Alternativa: Colar Texto Manual */}
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setModoTextoManual(!modoTextoManual)}
                  className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-paste text-xs"></i>
                  <span>{modoTextoManual ? 'Ocultar entrada de texto' : 'Deseja colar o texto do boletim manualmente?'}</span>
                </button>
                <span className="text-[11px] text-slate-400">Suporta o modelo oficial da SED (Secretaria da Educação)</span>
              </div>

              {modoTextoManual && (
                <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200 animate-in fade-in">
                  <label htmlFor="textarea-texto-boletim" className="block text-xs font-bold text-slate-700">
                    Cole abaixo o conteúdo copiado do Boletim Escolar SED:
                  </label>
                  <textarea
                    id="textarea-texto-boletim"
                    value={textoManual}
                    onChange={(e) => setTextoManual(e.target.value)}
                    rows={6}
                    placeholder="Cole aqui o texto copiado do PDF do boletim..."
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={handleProcessarTextoManual}
                    disabled={processando || !textoManual.trim()}
                    className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                    <span>Processar Texto Copiado</span>
                  </button>
                </div>
              )}

              {/* Indicador de carregamento */}
              {processando && (
                <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2">
                  <i className="fa-solid fa-spinner animate-spin text-2xl text-emerald-700"></i>
                  <p className="text-xs font-bold text-emerald-900">
                    Lendo arquivo PDF e estruturando notas e faltas dos bimestres...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Dados Extraídos com Sucesso: Exibição e Seleção */}
          {dadosParse && (
            <div className="space-y-5 animate-in fade-in">

              {/* Cartão de Conferência dos Dados do Estudante */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-id-card text-emerald-700 text-sm"></i>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Dados Identificados no Documento PDF
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDadosParse(null);
                      setArquivo(null);
                    }}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 underline flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fa-solid fa-arrows-rotate text-[10px]"></i>
                    <span>Trocar Arquivo PDF</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-white p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Nome no Documento</span>
                    <strong className="text-slate-800 truncate block">{dadosParse.aluno.nome || 'Não identificado'}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">RA no Documento</span>
                    <strong className="text-slate-800 font-mono block">{dadosParse.aluno.ra || dadosParse.aluno.raLimpo}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Escola de Origem</span>
                    <span className="text-slate-700 truncate block" title={dadosParse.aluno.escola}>{dadosParse.aluno.escola || 'Não identificada'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Turma / Ano Letivo</span>
                    <span className="text-slate-700 block">{dadosParse.aluno.turma || '-'} • {dadosParse.aluno.anoLetivo}</span>
                  </div>
                </div>

                {/* Validação de RA */}
                {raConfere ? (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-bold flex items-center gap-2">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>O RA no documento confere perfeitamente com o cadastro do aluno selecionado.</span>
                  </div>
                ) : (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] font-bold flex items-center gap-2">
                    <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
                    <span>Atenção: O RA do PDF ({dadosParse.aluno.raLimpo}) difere do aluno ({raLimpo}). Verifique se é o documento correto.</span>
                  </div>
                )}
              </div>

              {/* Seção de Seleção dos Bimestres a Atualizar */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <i className="fa-solid fa-calendar-check text-indigo-700"></i>
                      <span>Bimestres Detectados para Atualização</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Selecione quais bimestres faltantes devem ser gravados no cadastro deste aluno:
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg text-xs font-bold">
                    {totalBimsParaGravar} bimestre(s) selecionado(s)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {(['1B', '2B', '3B', '4B'] as const).map(k => {
                    const b = dadosParse.bimestres[k];
                    const temDados = b?.temDados;
                    const jaExiste = bimestresExistentes[k];
                    const selecionado = !!bimestresSelecionados[k];

                    return (
                      <div
                        key={k}
                        onClick={() => {
                          if (temDados) {
                            setBimestresSelecionados(prev => ({ ...prev, [k]: !prev[k] }));
                          }
                        }}
                        className={`p-3.5 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                          !temDados
                            ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                            : selecionado
                            ? 'bg-emerald-50/80 border-emerald-400 shadow-xs ring-2 ring-emerald-300'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selecionado}
                              disabled={!temDados}
                              onChange={() => {}} // tratado no container
                              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="font-extrabold text-sm text-slate-800">{k}</span>
                          </div>

                          {temDados ? (
                            jaExiste ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                Já tem no Mapão
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                Resolverá Pendência
                              </span>
                            )
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-600">
                              Sem dados no PDF
                            </span>
                          )}
                        </div>

                        {temDados ? (
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Frequência:</span>
                              <strong className="text-slate-800">{b.frequenciaBimestre}</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Faltas:</span>
                              <strong className="text-rose-700">{b.totalFaltas} falta(s)</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Média:</span>
                              <strong className="text-blue-900">{b.mediaGeral.toFixed(1)}</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-500 text-[10px] pt-1 border-t border-slate-100">
                              <span>Disciplinas:</span>
                              <span>{Object.keys(b.disciplinas).length} componentes</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic py-2">
                            Não há notas registradas para este bimestre no PDF.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tabela de Visualização Detalhada das Disciplinas Extraídas */}
              <div className="space-y-2 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-list-check text-slate-600 text-xs"></i>
                    <span className="text-xs font-bold text-slate-700 uppercase">
                      Conferência de Disciplinas e Notas do Documento
                    </span>
                  </div>

                  {/* Abas dos bimestres com dados */}
                  <div className="flex items-center gap-1.5">
                    {(['1B', '2B', '3B', '4B'] as const).map(k => {
                      const temD = dadosParse.bimestres[k]?.temDados;
                      if (!temD) return null;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setAbaBimestreVisualizacao(k)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            abaBimestreVisualizacao === k
                              ? 'bg-emerald-700 text-white shadow-xs'
                              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          <span>{k}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Listagem das Disciplinas do Bimestre Ativo */}
                <div className="overflow-x-auto max-h-56 custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-[11px] uppercase">
                        <th className="p-2.5 font-bold">Componente Curricular</th>
                        <th className="p-2.5 font-bold text-center">Nota (N)</th>
                        <th className="p-2.5 font-bold text-center">Faltas (F)</th>
                        <th className="p-2.5 font-bold text-center">% Frequência</th>
                        <th className="p-2.5 font-bold text-center">Ausências Comp. (AC)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.values(dadosParse.bimestres[abaBimestreVisualizacao]?.disciplinas || {}).map(d => (
                        <tr key={d.nome} className="hover:bg-slate-50/80">
                          <td className="p-2 font-semibold text-slate-800">{d.nome}</td>
                          <td className="p-2 text-center">
                            <span className={`px-2 py-0.5 rounded font-black text-xs ${
                              d.notaNum !== null && d.notaNum < 5 
                                ? 'bg-rose-100 text-rose-800' 
                                : 'bg-slate-100 text-slate-800'
                            }`}>
                              {d.mencaoNota}
                            </span>
                          </td>
                          <td className="p-2 text-center font-bold text-slate-700">{d.faltas}</td>
                          <td className="p-2 text-center font-bold text-slate-700">{d.frequencia || '—'}</td>
                          <td className="p-2 text-center text-slate-500">{d.ausenciaCompensada || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Informação sobre Preservação dos Demais Bimestres */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2.5">
                <i className="fa-solid fa-shield-halved text-blue-700 mt-0.5 text-sm shrink-0"></i>
                <div className="leading-relaxed">
                  <strong>Preservação Integral de Dados Escolares:</strong> Os bimestres desmarcados e os já fechados na E.E. Clóvis de Lucca (como o 3º Bimestre atual) <strong>não serão apagados nem alterados</strong>. Apenas as pendências selecionadas serão integradas e calculadas no Mapão do estudante.
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Rodapé de Ações */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={aoFechar}
            disabled={salvando}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Cancelar
          </button>

          {dadosParse && (
            <button
              type="button"
              onClick={handleGravarBimestres}
              disabled={salvando || totalBimsParaGravar === 0}
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {salvando ? (
                <>
                  <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                  <span>Gravando no Banco de Dados...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk text-xs text-emerald-200"></i>
                  <span>Gravar e Atualizar {totalBimsParaGravar} Bimestre(s) Faltante(s)</span>
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
