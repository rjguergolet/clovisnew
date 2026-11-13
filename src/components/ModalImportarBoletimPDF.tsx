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
    <div
      className="fixed inset-0 z-[11000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/55 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      onClick={aoFechar}
    >
      <div
        className="bg-white w-full max-w-4xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[90vh] sm:my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Handle */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300"></div>
        </div>

        {/* Cabeçalho */}
        <div className="px-5 sm:px-6 py-4 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-file-pdf text-lg"></i>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-slate-900">Leitura Automática de Boletim SED (PDF)</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                  Auditoria SED vs Mapão
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Atualização automática de notas e faltas dos bimestres faltantes (alunos transferidos)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer shrink-0"
            title="Fechar"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {/* Card do Estudante Alvo Selecionado */}
        <div className="px-5 sm:px-6 py-3.5 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-semibold text-sm shrink-0">
              <i className="fa-solid fa-user-graduate"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900 text-sm">{nomeAluno}</span>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200/60 font-medium rounded-lg text-[11px]">
                  Turma {turmaAluno}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                RA: <strong className="text-slate-700">{raAluno}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-500 font-medium mr-1">No Mapão:</span>
            {(['1B', '2B', '3B', '4B'] as const).map(k => (
              <span
                key={k}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border border-l-4 flex items-center gap-1 ${
                  bimestresExistentes[k]
                    ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/60 border-l-emerald-500'
                    : 'bg-rose-50/90 text-rose-900 border-rose-200/60 border-l-rose-500'
                }`}
                title={bimestresExistentes[k] ? `${k}: Já registrado na nossa escola` : `${k}: Ausente / Pendente`}
              >
                <i className={`fa-solid ${bimestresExistentes[k] ? 'fa-check text-emerald-600' : 'fa-xmark text-rose-600'}`}></i>
                <span>{k}: {bimestresExistentes[k] ? 'OK' : 'Pendente'}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Corpo do Modal */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {erro && (
            <div className="p-3.5 bg-rose-50/90 border border-rose-200/60 border-l-4 border-l-rose-500 rounded-xl text-rose-900 text-xs flex items-start gap-2.5">
              <i className="fa-solid fa-triangle-exclamation text-rose-600 mt-0.5 text-sm shrink-0"></i>
              <div className="flex-1">
                <strong className="block font-semibold">Erro no processamento do documento:</strong>
                <span>{erro}</span>
              </div>
            </div>
          )}

          {!dadosParse && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleSelecionarArquivo(f);
                }}
                className="border-2 border-dashed border-emerald-300/80 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 rounded-2xl p-8 text-center transition cursor-pointer flex flex-col items-center justify-center gap-3 group"
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

                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-2xl transition group-hover:scale-105">
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-900">
                    Clique ou arraste o PDF do Boletim Escolar (SED) aqui
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    O sistema fará a leitura inteligente do cabeçalho oficial e da grade de notas e faltas dos 4 bimestres automaticamente.
                  </p>
                </div>

                <button
                  type="button"
                  className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs shadow-xs transition flex items-center gap-2 pointer-events-none"
                >
                  <i className="fa-solid fa-file-pdf"></i>
                  <span>Selecionar Arquivo PDF</span>
                </button>
              </div>

              <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setModoTextoManual(!modoTextoManual)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-paste text-xs"></i>
                  <span>{modoTextoManual ? 'Ocultar entrada de texto' : 'Colar o texto do boletim manualmente'}</span>
                </button>
                <span className="text-[11px] text-slate-400">Suporta o modelo oficial da SED (Secretaria da Educação)</span>
              </div>

              {modoTextoManual && (
                <div className="space-y-2.5 bg-slate-50/90 p-4 rounded-2xl border border-slate-200/80 animate-in fade-in">
                  <label htmlFor="textarea-texto-boletim" className="block text-xs font-semibold text-slate-700">
                    Cole abaixo o conteúdo copiado do Boletim Escolar SED:
                  </label>
                  <textarea
                    id="textarea-texto-boletim"
                    value={textoManual}
                    onChange={(e) => setTextoManual(e.target.value)}
                    rows={6}
                    placeholder="Cole aqui o texto copiado do PDF do boletim..."
                    className="w-full p-3 bg-white border border-slate-200/80 rounded-xl text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={handleProcessarTextoManual}
                    disabled={processando || !textoManual.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                    <span>Processar Texto Copiado</span>
                  </button>
                </div>
              )}

              {processando && (
                <div className="p-6 bg-emerald-50/80 border border-emerald-200/60 rounded-2xl text-center space-y-2">
                  <i className="fa-solid fa-spinner animate-spin text-2xl text-emerald-600"></i>
                  <p className="text-xs font-semibold text-emerald-900">
                    Lendo arquivo PDF e estruturando notas e faltas dos bimestres...
                  </p>
                </div>
              )}
            </div>
          )}

          {dadosParse && (
            <div className="space-y-5 animate-in fade-in">
              <div className="p-4 bg-slate-50/90 border border-slate-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-id-card text-emerald-600 text-sm"></i>
                    <h4 className="text-xs font-semibold text-slate-800">
                      Dados Identificados no Documento PDF
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDadosParse(null);
                      setArquivo(null);
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fa-solid fa-arrows-rotate text-[10px]"></i>
                    <span>Trocar Arquivo PDF</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-white p-3.5 rounded-xl border border-slate-200/80">
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Nome no Documento</span>
                    <strong className="text-slate-900 font-semibold truncate block">{dadosParse.aluno.nome || 'Não identificado'}</strong>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">RA no Documento</span>
                    <strong className="text-slate-900 font-mono tabular-nums block">{dadosParse.aluno.ra || dadosParse.aluno.raLimpo}</strong>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Escola de Origem</span>
                    <span className="text-slate-700 truncate block" title={dadosParse.aluno.escola}>{dadosParse.aluno.escola || 'Não identificada'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Turma / Ano Letivo</span>
                    <span className="text-slate-700 block tabular-nums">{dadosParse.aluno.turma || '-'} • {dadosParse.aluno.anoLetivo}</span>
                  </div>
                </div>

                {raConfere ? (
                  <div className="p-2.5 bg-emerald-50/90 border border-emerald-200/60 border-l-4 border-l-emerald-500 rounded-xl text-emerald-900 text-xs font-medium flex items-center gap-2">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>O RA no documento confere perfeitamente com o cadastro do aluno selecionado.</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-50/90 border border-amber-200/60 border-l-4 border-l-amber-500 rounded-xl text-amber-900 text-xs font-medium flex items-center gap-2">
                    <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
                    <span>Atenção: O RA do PDF ({dadosParse.aluno.raLimpo}) difere do aluno ({raLimpo}). Verifique se é o documento correto.</span>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-calendar-check text-indigo-600"></i>
                      <span>Bimestres Detectados para Atualização</span>
                    </h4>
                    <p className="text-xs text-slate-500">
                      Selecione quais bimestres faltantes devem ser gravados no cadastro deste aluno:
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200/60 rounded-xl text-xs font-semibold tabular-nums">
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
                        className={`p-3.5 rounded-2xl border transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                          !temDados
                            ? 'bg-slate-50 border-slate-200/80 opacity-60 cursor-not-allowed'
                            : selecionado
                            ? 'bg-emerald-50/70 border-emerald-400 shadow-xs ring-2 ring-emerald-500/20'
                            : 'bg-white border-slate-200/80 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selecionado}
                              disabled={!temDados}
                              onChange={() => {}}
                              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="font-bold text-sm text-slate-900">{k}</span>
                          </div>

                          {temDados ? (
                            jaExiste ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200/60">
                                Já no Mapão
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                                Pendência
                              </span>
                            )
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-500">
                              Sem dados
                            </span>
                          )}
                        </div>

                        {temDados ? (
                          <div className="space-y-1 text-xs tabular-nums">
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Frequência:</span>
                              <strong className="text-slate-800 font-semibold">{b.frequenciaBimestre}</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Faltas:</span>
                              <strong className="text-rose-700 font-semibold">{b.totalFaltas} falta(s)</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Média:</span>
                              <strong className="text-indigo-700 font-semibold">{b.mediaGeral.toFixed(1)}</strong>
                            </div>
                            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-slate-100">
                              <span>Disciplinas:</span>
                              <span>{Object.keys(b.disciplinas).length} componentes</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 py-2">
                            Não há notas registradas para este bimestre no PDF.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs">
                <div className="p-3 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-list-check text-slate-500 text-xs"></i>
                    <span className="text-xs font-semibold text-slate-700">
                      Conferência de Disciplinas e Notas do Documento
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl">
                    {(['1B', '2B', '3B', '4B'] as const).map(k => {
                      const temD = dadosParse.bimestres[k]?.temDados;
                      if (!temD) return null;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setAbaBimestreVisualizacao(k)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            abaBimestreVisualizacao === k
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <span>{k}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto max-h-56">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 text-[11px] font-semibold">
                        <th className="p-2.5">Componente Curricular</th>
                        <th className="p-2.5 text-center">Nota (N)</th>
                        <th className="p-2.5 text-center">Faltas (F)</th>
                        <th className="p-2.5 text-center">% Frequência</th>
                        <th className="p-2.5 text-center">Ausências Comp. (AC)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {Object.values(dadosParse.bimestres[abaBimestreVisualizacao]?.disciplinas || {}).map(d => (
                        <tr key={d.nome} className="hover:bg-slate-50/80">
                          <td className="p-2.5 font-medium text-slate-800">{d.nome}</td>
                          <td className="p-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-md font-semibold text-xs ${
                              d.notaNum !== null && d.notaNum < 5
                                ? 'bg-rose-50 text-rose-800 border border-rose-200/60'
                                : 'bg-slate-100 text-slate-800'
                            }`}>
                              {d.mencaoNota}
                            </span>
                          </td>
                          <td className="p-2.5 text-center font-medium text-slate-700">{d.faltas}</td>
                          <td className="p-2.5 text-center font-medium text-slate-700">{d.frequencia || '—'}</td>
                          <td className="p-2.5 text-center text-slate-500">{d.ausenciaCompensada || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-3.5 bg-indigo-50/80 border border-indigo-200/50 border-l-4 border-l-indigo-600 rounded-xl text-slate-800 text-xs flex items-start gap-2.5">
                <i className="fa-solid fa-shield-halved text-indigo-600 mt-0.5 text-sm shrink-0"></i>
                <div className="leading-relaxed">
                  <strong>Preservação Integral de Dados Escolares:</strong> Os bimestres desmarcados e os já fechados na E.E. Clóvis de Lucca (como o 3º Bimestre atual) <strong>não serão apagados nem alterados</strong>. Apenas as pendências selecionadas serão integradas e calculadas no Mapão do estudante.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé de Ações */}
        <div className="px-5 sm:px-6 py-4 bg-slate-50/80 border-t border-slate-200/80 flex flex-col-reverse sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={aoFechar}
            disabled={salvando}
            className="w-full sm:w-auto px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80 font-semibold rounded-xl text-xs transition cursor-pointer"
          >
            Cancelar
          </button>

          {dadosParse && (
            <button
              type="button"
              onClick={handleGravarBimestres}
              disabled={salvando || totalBimsParaGravar === 0}
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {salvando ? (
                <>
                  <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                  <span>Gravando no Banco de Dados...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk text-xs"></i>
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
