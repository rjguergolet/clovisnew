import React, { useMemo, useState } from 'react';
import { AlunoNormalizado } from '../../modules/inteligenciaDataEngine';

interface Dashboard2AcademicoProps {
  alunos: AlunoNormalizado[];
}

type BimestreKey = '1B' | '2B' | '3B' | '4B';

export default function Dashboard2Academico({ alunos }: Dashboard2AcademicoProps) {
  const [bimestreSelecionado, setBimestreSelecionado] = useState<BimestreKey>(() => {
    // Escolhe o bimestre mais recente com dados reais
    const ordem: BimestreKey[] = ['4B', '3B', '2B', '1B'];
    for (const b of ordem) {
      if (alunos.some((a) => Object.keys(a.notasPorBimestre[b].disciplinas).length > 0)) {
        return b;
      }
    }
    return '1B';
  });

  const [disciplinaSelecionada, setDisciplinaSelecionada] = useState<string>('TODAS');
  const [quadranteSelecionado, setQuadranteSelecionado] = useState<1 | 2 | 3 | 4 | 'TODOS'>(3);
  const [heatmapModo, setHeatmapModo] = useState<'percentual' | 'quantidade'>('percentual');
  const [hoverPonto, setHoverPonto] = useState<{
    ra: string;
    nome: string;
    turma: string;
    freq: number;
    media: number;
    recomposicao: boolean;
    aee: boolean;
  } | null>(null);

  const disciplinasDisponiveis = useMemo(() => {
    const counts = new Map<string, number>();
    alunos.forEach((al) => {
      const discs = al.notasPorBimestre[bimestreSelecionado].disciplinas;
      Object.keys(discs).forEach((d) => {
        counts.set(d, (counts.get(d) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([nome]) => nome);
  }, [alunos, bimestreSelecionado]);

  // 1. Heatmap Turmas x Disciplinas (notaNum < 5 / abaixoBasico: true)
  const heatmapData = useMemo(() => {
    const turmasSet = new Set<string>();
    alunos.forEach((al) => {
      if (al.turma && Object.keys(al.notasPorBimestre[bimestreSelecionado].disciplinas).length > 0) {
        turmasSet.add(al.turma);
      }
    });
    const turmas = Array.from(turmasSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const disciplinas = disciplinasDisponiveis.slice(0, 10);

    const celulas: Record<string, Record<string, { abaixo: number; total: number; pct: number }>> = {};
    turmas.forEach((t) => {
      celulas[t] = {};
      disciplinas.forEach((d) => {
        celulas[t][d] = { abaixo: 0, total: 0, pct: 0 };
      });
    });

    alunos.forEach((al) => {
      const t = al.turma;
      if (!celulas[t]) return;
      const discs = al.notasPorBimestre[bimestreSelecionado].disciplinas;
      disciplinas.forEach((d) => {
        const reg = discs[d];
        if (!reg) return;
        celulas[t][d].total++;
        if (reg.abaixoBasico || (reg.nota !== null && reg.nota < 5)) {
          celulas[t][d].abaixo++;
        }
      });
    });

    turmas.forEach((t) => {
      disciplinas.forEach((d) => {
        const c = celulas[t][d];
        c.pct = c.total > 0 ? Math.round((c.abaixo / c.total) * 100) : 0;
      });
    });

    return { turmas, disciplinas, celulas };
  }, [alunos, bimestreSelecionado, disciplinasDisponiveis]);

  // 2. Gráfico de Dispersão (Frequência x Rendimento) nos 4 quadrantes
  const dispersaoData = useMemo(() => {
    const pontos = alunos
      .map((al) => {
        const freq = al.notasPorBimestre[bimestreSelecionado].frequencia ?? al.mapaoFreq ?? al.sedFreq;
        const discObj =
          disciplinaSelecionada !== 'TODAS'
            ? al.notasPorBimestre[bimestreSelecionado].disciplinas[disciplinaSelecionada]
            : null;
        const media =
          disciplinaSelecionada !== 'TODAS'
            ? (discObj?.nota ?? null)
            : (al.notasPorBimestre[bimestreSelecionado].mediaGeral ?? al.mediaGeralAtual);

        if (freq === null || media === null) return null;

        let quadrante: 1 | 2 | 3 | 4 = 1;
        if (freq >= 75 && media >= 5) quadrante = 1; // Alta Freq / Alta Nota
        else if (freq < 75 && media < 5) quadrante = 2; // Baixa Freq / Baixa Nota (risco por evasão)
        else if (freq >= 75 && media < 5) quadrante = 3; // Alta Freq / Baixa Nota (prioridade Recomposição & AEE)
        else quadrante = 4; // Baixa Freq / Alta Nota

        return {
          aluno: al,
          ra: al.ra,
          nome: al.nome,
          turma: al.turma,
          freq,
          media,
          quadrante,
          recomposicao: al.recomposicao,
          aee: al.aee
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const contagens = {
      1: pontos.filter((p) => p.quadrante === 1).length,
      2: pontos.filter((p) => p.quadrante === 2).length,
      3: pontos.filter((p) => p.quadrante === 3).length,
      4: pontos.filter((p) => p.quadrante === 4).length
    };

    const filtrados =
      quadranteSelecionado === 'TODOS'
        ? pontos
        : pontos.filter((p) => p.quadrante === quadranteSelecionado);

    return {
      pontos,
      contagens,
      filtrados: filtrados.sort((a, b) => a.media - b.media)
    };
  }, [alunos, bimestreSelecionado, disciplinaSelecionada, quadranteSelecionado]);

  // 3. Evolução Bimestral por Série (1B a 4B)
  const evolucaoSeries = useMemo(() => {
    const seriesSet = new Set<string>();
    alunos.forEach((a) => {
      if (a.serie && a.serie !== 'Outros') seriesSet.add(a.serie);
    });
    const series = Array.from(seriesSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const bimestres: BimestreKey[] = ['1B', '2B', '3B', '4B'];
    const linhas = series.map((serie, idx) => {
      const alunosSerie = alunos.filter((a) => a.serie === serie);
      const pontos = bimestres.map((b) => {
        const valores: number[] = [];
        let vermelhas = 0;
        let totalAvaliacoes = 0;

        alunosSerie.forEach((al) => {
          if (disciplinaSelecionada === 'TODAS') {
            const m = al.notasPorBimestre[b].mediaGeral;
            if (m !== null) valores.push(m);
            const ds = Object.values(al.notasPorBimestre[b].disciplinas);
            ds.forEach((d) => {
              totalAvaliacoes++;
              if (d.abaixoBasico || (d.nota !== null && d.nota < 5)) vermelhas++;
            });
          } else {
            const d = al.notasPorBimestre[b].disciplinas[disciplinaSelecionada];
            if (d) {
              totalAvaliacoes++;
              if (d.nota !== null) valores.push(d.nota);
              if (d.abaixoBasico || (d.nota !== null && d.nota < 5)) vermelhas++;
            }
          }
        });

        const media =
          valores.length > 0
            ? Math.round((valores.reduce((acc, v) => acc + v, 0) / valores.length) * 10) / 10
            : null;
        const pctVermelhas =
          totalAvaliacoes > 0 ? Math.round((vermelhas / totalAvaliacoes) * 1000) / 10 : null;

        return { bimestre: b, media, vermelhas, pctVermelhas };
      });

      const cores = ['#1d2b4f', '#0891b2', '#7c3aed', '#059669', '#d97706', '#e11d48', '#2563eb'];
      return { serie, cor: cores[idx % cores.length], pontos };
    });

    return linhas;
  }, [alunos, disciplinaSelecionada]);

  const abrirFicha = (ra: string) => {
    if (typeof (window as any).abrirFichaAluno === 'function') {
      (window as any).abrirFichaAluno(ra);
    }
  };

  const corHeatmap = (pct: number, total: number) => {
    if (total === 0) return 'bg-slate-50 text-slate-400';
    if (pct >= 40) return 'bg-rose-600 text-white';
    if (pct >= 25) return 'bg-rose-200 text-rose-900';
    if (pct >= 12) return 'bg-amber-100 text-amber-900';
    if (pct > 0) return 'bg-emerald-50 text-emerald-800';
    return 'bg-emerald-100 text-emerald-900';
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho e Seletores de Bimestre / Disciplina */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#1d2b4f]">
            Painel 2 · Desempenho Acadêmico & Alerta de Conselho de Classe
          </h2>
          <p className="text-xs text-slate-600">
            Baseado em <code className="bg-slate-100 px-1 rounded">fechamento_notas</code> (1B a 4B), notas abaixo do básico (&lt; 5,0), Recomposição e AEE.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {(['1B', '2B', '3B', '4B'] as BimestreKey[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBimestreSelecionado(b)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  bimestreSelecionado === b
                    ? 'bg-[#1d2b4f] text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          <select
            value={disciplinaSelecionada}
            onChange={(e) => setDisciplinaSelecionada(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700"
          >
            <option value="TODAS">Todas as Disciplinas (Média Geral)</option>
            {disciplinasDisponiveis.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 1. Heatmap Turmas x Disciplinas */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Mapa de Calor: Turmas × Disciplinas ({bimestreSelecionado} · Nota &lt; 5,0 / Abaixo do Básico)
            </h3>
            <p className="text-xs text-slate-500">
              Identifica gargalos coletivos por componente curricular versus casos isolados.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setHeatmapModo('percentual')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                heatmapModo === 'percentual' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
              }`}
            >
              % Críticos
            </button>
            <button
              type="button"
              onClick={() => setHeatmapModo('quantidade')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                heatmapModo === 'quantidade' ? 'bg-[#1d2b4f] text-white' : 'text-slate-600'
              }`}
            >
              Qtd Alunos
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {heatmapData.turmas.length > 0 && heatmapData.disciplinas.length > 0 ? (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-2.5 px-3 text-left font-extrabold text-[#1d2b4f] sticky left-0 bg-slate-50">
                    Turma
                  </th>
                  {heatmapData.disciplinas.map((d) => (
                    <th key={d} className="py-2.5 px-2 text-center font-bold text-slate-600 max-w-[110px] truncate" title={d}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {heatmapData.turmas.map((t) => (
                  <tr key={t}>
                    <td className="py-2 px-3 font-extrabold text-slate-800 sticky left-0 bg-white border-r border-slate-100 whitespace-nowrap">
                      {t}
                    </td>
                    {heatmapData.disciplinas.map((d) => {
                      const c = heatmapData.celulas[t][d];
                      return (
                        <td key={d} className="p-1 text-center">
                          <div
                            className={`rounded-lg py-1.5 px-1 font-extrabold tabular-nums ${corHeatmap(c.pct, c.total)}`}
                            title={`${t} · ${d}: ${c.abaixo} de ${c.total} estudantes com nota < 5 (${c.pct}%)`}
                          >
                            {c.total === 0
                              ? '—'
                              : heatmapModo === 'percentual'
                                ? `${c.pct}%`
                                : `${c.abaixo}/${c.total}`}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-slate-500">
              Sem boletins lançados em <code className="bg-slate-100 px-1 rounded">fechamento_notas.{bimestreSelecionado}</code> para os filtros atuais.
            </div>
          )}
        </div>
      </div>

      {/* 2. Dispersão (Frequência x Rendimento) em 4 Quadrantes */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-extrabold text-[#1d2b4f]">
                Dispersão: Frequência (%) × Rendimento ({disciplinaSelecionada === 'TODAS' ? 'Média Geral' : disciplinaSelecionada})
              </h3>
              <p className="text-xs text-slate-500">
                Eixo X = Frequência (corte 75%) · Eixo Y = Nota (corte 5,0). Clique nos quadrantes abaixo para filtrar os estudantes.
              </p>
            </div>
          </div>

          {/* 4 Cards de Quadrante */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { id: 1 as const, label: 'Q1 · Alta Freq / Alta Nota', cor: 'border-emerald-200 bg-emerald-50 text-emerald-900', count: dispersaoData.contagens[1] },
              { id: 2 as const, label: 'Q2 · Baixa Freq / Baixa Nota', cor: 'border-rose-300 bg-rose-50 text-rose-900', count: dispersaoData.contagens[2] },
              { id: 3 as const, label: 'Q3 · Recomposição / AEE', cor: 'border-amber-300 bg-amber-50 text-amber-900', count: dispersaoData.contagens[3] },
              { id: 4 as const, label: 'Q4 · Baixa Freq / Alta Nota', cor: 'border-cyan-200 bg-cyan-50 text-cyan-900', count: dispersaoData.contagens[4] }
            ].map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setQuadranteSelecionado(quadranteSelecionado === q.id ? 'TODOS' : q.id)}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${q.cor} ${
                  quadranteSelecionado === q.id ? 'ring-2 ring-[#1d2b4f]' : 'opacity-85 hover:opacity-100'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-tight">{q.label}</div>
                <div className="text-lg font-extrabold tabular-nums mt-0.5">{q.count}</div>
              </button>
            ))}
          </div>

          {/* SVG Scatter Plot */}
          <div className="relative bg-slate-50 rounded-xl border border-slate-200 p-2">
            <svg viewBox="0 0 560 300" className="w-full h-auto overflow-visible">
              {/* Fundos dos 4 quadrantes (corte X=75% -> 420px? Escala X: 40..100 => 75 é (35/60)=58.3%) */}
              {/* Vamos usar escala X: 0..100 (x = 45 + (freq/100)*495), corte 75 => x = 45 + 0.75*495 = 416.25 */}
              {/* Escala Y: 0..10 (y = 265 - (nota/10)*240), corte 5.0 => y = 265 - 120 = 145 */}
              <rect x="45" y="25" width="371.25" height="120" fill="#ecfeff" opacity="0.55" />
              <rect x="416.25" y="25" width="123.75" height="120" fill="#ecfdf5" opacity="0.7" />
              <rect x="45" y="145" width="371.25" height="120" fill="#fff1f2" opacity="0.7" />
              <rect x="416.25" y="145" width="123.75" height="120" fill="#fffbeb" opacity="0.85" />

              {/* Linhas de corte */}
              <line x1="416.25" y1="25" x2="416.25" y2="265" stroke="#dc2626" strokeDasharray="4 4" strokeWidth="1.5" />
              <line x1="45" y1="145" x2="540" y2="145" stroke="#d97706" strokeDasharray="4 4" strokeWidth="1.5" />

              {/* Eixos */}
              <line x1="45" y1="265" x2="540" y2="265" stroke="#94a3b8" strokeWidth="1.2" />
              <line x1="45" y1="25" x2="45" y2="265" stroke="#94a3b8" strokeWidth="1.2" />

              {/* Rótulos dos eixos */}
              {[0, 25, 50, 75, 100].map((v) => {
                const x = 45 + (v / 100) * 495;
                return (
                  <g key={v}>
                    <text x={x} y="282" textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="700">
                      {v}%
                    </text>
                  </g>
                );
              })}
              {[0, 2.5, 5, 7.5, 10].map((n) => {
                const y = 265 - (n / 10) * 240;
                return (
                  <text key={n} x="38" y={y + 3} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="700">
                    {n.toFixed(1)}
                  </text>
                );
              })}

              <text x="422" y="37" fontSize="9" fill="#047857" fontWeight="800">Q1: Adequado</text>
              <text x="52" y="37" fontSize="9" fill="#0e7490" fontWeight="800">Q4: Risco Falta</text>
              <text x="52" y="258" fontSize="9" fill="#be123c" fontWeight="800">Q2: Evasão + Nota</text>
              <text x="422" y="258" fontSize="9" fill="#b45309" fontWeight="800">Q3: Recomposição/AEE</text>

              {/* Pontos */}
              {dispersaoData.pontos.map((p) => {
                const cx = 45 + (Math.min(100, Math.max(0, p.freq)) / 100) * 495;
                const cy = 265 - (Math.min(10, Math.max(0, p.media)) / 10) * 240;
                const fill =
                  p.quadrante === 1
                    ? '#059669'
                    : p.quadrante === 2
                      ? '#e11d48'
                      : p.quadrante === 3
                        ? '#d97706'
                        : '#0891b2';
                const dimmed = quadranteSelecionado !== 'TODOS' && p.quadrante !== quadranteSelecionado;
                return (
                  <circle
                    key={p.ra}
                    cx={cx}
                    cy={cy}
                    r={dimmed ? 3 : 4.5}
                    fill={fill}
                    opacity={dimmed ? 0.22 : 0.85}
                    stroke="#ffffff"
                    strokeWidth="1"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverPonto(p)}
                    onMouseLeave={() => setHoverPonto(null)}
                    onClick={() => abrirFicha(p.ra)}
                  />
                );
              })}
            </svg>

            {hoverPonto && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-[#1d2b4f] text-white text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold">{hoverPonto.nome} ({hoverPonto.turma})</span>
                <span className="tabular-nums">
                  Freq: <strong>{hoverPonto.freq.toFixed(1)}%</strong> · Nota: <strong>{hoverPonto.media.toFixed(1)}</strong>
                  {hoverPonto.recomposicao ? ' · [Recomposição]' : ''}
                  {hoverPonto.aee ? ' · [AEE]' : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Lista acionável do Quadrante selecionado (padrão Q3: Recomposição / AEE) */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-[#1d2b4f]">
                {quadranteSelecionado === 3
                  ? 'Prioridade Recomposição & AEE (Alta Freq + Baixa Nota)'
                  : quadranteSelecionado === 'TODOS'
                    ? 'Todos os Alunos Plotados'
                    : `Estudantes do Quadrante Q${quadranteSelecionado}`}
              </h3>
              <p className="text-xs text-slate-500 tabular-nums">
                {dispersaoData.filtrados.length} estudantes encontrados em {bimestreSelecionado}.
              </p>
            </div>
          </div>

          <div className="flex-1 max-h-[380px] overflow-y-auto divide-y divide-slate-100">
            {dispersaoData.filtrados.slice(0, 80).map((item) => (
              <div key={item.ra} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 text-xs">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => abrirFicha(item.ra)}
                    className="font-bold text-[#1d2b4f] hover:underline truncate block text-left cursor-pointer"
                  >
                    {item.nome}
                  </button>
                  <div className="text-[11px] text-slate-500">
                    {item.turma} · Tutor: {item.aluno.tutor || '—'}
                    {item.recomposicao && <span className="ml-1.5 text-amber-700 font-bold">[Recomposição]</span>}
                    {item.aee && <span className="ml-1.5 text-purple-700 font-bold">[AEE]</span>}
                  </div>
                </div>
                <div className="text-right tabular-nums shrink-0">
                  <div className={`font-extrabold ${item.media < 5 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    Nota {item.media.toFixed(1)}
                  </div>
                  <div className={`text-[11px] font-semibold ${item.freq < 75 ? 'text-rose-600' : 'text-slate-600'}`}>
                    Freq {item.freq.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
            {dispersaoData.filtrados.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                Nenhum estudante neste quadrante para o bimestre/disciplina selecionado.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Evolução Bimestral por Série (1B a 4B) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-extrabold text-[#1d2b4f]">
              Evolução Bimestral por Série (1º ao 4º Bimestre · {disciplinaSelecionada === 'TODAS' ? 'Média Geral' : disciplinaSelecionada})
            </h3>
            <p className="text-xs text-slate-500">
              Acompanhamento da média e redução do percentual de notas vermelhas (&lt; 5,0) ao longo do ano letivo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-7 bg-slate-50 rounded-xl border border-slate-200 p-3">
            <svg viewBox="0 0 520 220" className="w-full h-auto">
              {/* Grid horizontal 0..10 */}
              {[0, 2.5, 5, 7.5, 10].map((v) => {
                const y = 190 - (v / 10) * 165;
                return (
                  <g key={v}>
                    <line
                      x1="45"
                      y1={y}
                      x2="495"
                      y2={y}
                      stroke={v === 5 ? '#f59e0b' : '#e2e8f0'}
                      strokeDasharray={v === 5 ? '4 4' : undefined}
                      strokeWidth="1"
                    />
                    <text x="38" y={y + 3} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="700">
                      {v.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {(['1B', '2B', '3B', '4B'] as BimestreKey[]).map((b, i) => {
                const x = 85 + i * 125;
                return (
                  <text key={b} x={x} y="210" textAnchor="middle" fontSize="11" fill="#1d2b4f" fontWeight="800">
                    {b}
                  </text>
                );
              })}

              {evolucaoSeries.map((linha) => {
                const coords = linha.pontos
                  .map((pt, i) => {
                    if (pt.media === null) return null;
                    const x = 85 + i * 125;
                    const y = 190 - (Math.min(10, Math.max(0, pt.media)) / 10) * 165;
                    return { x, y, media: pt.media };
                  })
                  .filter((c): c is NonNullable<typeof c> => c !== null);

                if (coords.length === 0) return null;
                const dPath = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');

                return (
                  <g key={linha.serie}>
                    {coords.length > 1 && (
                      <path d={dPath} fill="none" stroke={linha.cor} strokeWidth="2.5" strokeLinecap="round" />
                    )}
                    {coords.map((c, idx) => (
                      <circle key={idx} cx={c.x} cy={c.y} r="4.5" fill={linha.cor} stroke="#fff" strokeWidth="1.5" />
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="lg:col-span-5 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <th className="py-2 px-2 text-left">Série</th>
                  <th className="py-2 px-2 text-center">1B</th>
                  <th className="py-2 px-2 text-center">2B</th>
                  <th className="py-2 px-2 text-center">3B</th>
                  <th className="py-2 px-2 text-center">4B</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {evolucaoSeries.map((linha) => (
                  <tr key={linha.serie}>
                    <td className="py-2 px-2 font-bold text-slate-800 flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: linha.cor }} />
                      <span>{linha.serie}</span>
                    </td>
                    {linha.pontos.map((p) => (
                      <td key={p.bimestre} className="py-2 px-2 text-center">
                        {p.media !== null ? (
                          <div>
                            <div className="font-extrabold text-[#1d2b4f]">{p.media.toFixed(1)}</div>
                            {p.pctVermelhas !== null && (
                              <div className="text-[10px] text-rose-600 font-semibold">{p.pctVermelhas}% &lt;5</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
